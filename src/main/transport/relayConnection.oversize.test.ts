import type { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRelayConnection, type RelayEvent } from './relayConnection'
import type { DiagnosticEvent, DiagnosticLog } from '../diagnosticLog'

// Oversize close-code normalisation pin — the DETERMINISTIC half of AC4 (#1123).
//
// `relayConnection`'s 'error' handler rewrites the terminal close of an oversized inbound frame to
// `{code: 1009, reason: 'max-frame-exceeded'}`, matching the wire-spec `message.too_long`. That
// rewrite only happens if 'error' reaches the module BEFORE 'close': once 'close' has landed,
// `teardownAndEmitClosed` has already run `ws.removeAllListeners()`, so a late 'error' reaches no
// code at all. Against a real `ws` server that ordering is a library internal, not a contract this
// repo owns — `ws`'s own client-side code for an oversized frame is 1006 (the 1009 goes only to the
// peer, verified on ws 8.21), so a real-socket spec asserting 1009 has a load-dependent verdict. It
// flaked exactly once that way on the #1122 gate run, observing 1006.
//
// So the raw close code is pinned HERE, where the ordering is driven rather than observed, and the
// real-socket case in relayConnection.test.ts asserts only the two order-independent halves of the
// contract ("terminal close, no `message` escapes") that the package overview mandates
// (docs/knowledge/features/relay-connection.md § Edge cases). Neither file's verdict depends on
// which `ws` event lands first.
//
// COVERAGE BOUNDARY (do not overstate): green here means "the module classifies a max-frame error
// into the 1009 terminal and does not over-classify anything else". It does NOT prove `ws` actually
// drops the oversized frame instead of delivering it truncated — that is a real-socket property and
// it keeps its witness in relayConnection.test.ts, which is why that case was narrowed rather than
// deleted.

// ---- test-only socket seam ----
// Same shape as relayConnection.teardown.test.ts's seam, and deliberately a SECOND copy rather than
// a shared import: `vi.mock` is file-scoped, so a mocked spec cannot live in relayConnection.test.ts
// (which stands up a real `ws` server), and lifting this fake out of the teardown spec would mean
// editing a file whose two pins #1123 requires to pass unmodified. `FakeWebSocket` is a synchronous
// EventEmitter — emitting a raw event runs the module's handler on the same tick, so no case needs a
// timer, a socket, or a `waitFor`.
const { instances } = vi.hoisted(() => ({ instances: [] as EventEmitter[] }))

vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events')
  class FakeWebSocket extends EventEmitter {
    static readonly OPEN = 1
    readyState = 0
    // Never invoked here: the lifecycle is driven by emitting raw events, and every case reaches its
    // terminal 'close' long before the module's connect/ping timers could fire.
    send = vi.fn()
    close = vi.fn()
    terminate = vi.fn()
    ping = vi.fn()
    constructor(_url: string, _options?: unknown) {
      super()
      instances.push(this)
    }
  }
  return { WebSocket: FakeWebSocket }
})

// The ws error for an inbound frame over `maxPayload`. `err.code` is the ONLY field the module's
// `isMaxFrameError` reads, so nothing else needs to be modelled.
const MAX_FRAME_ERROR = Object.assign(new Error('Max payload size exceeded'), {
  code: 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'
})

function makeSink(): { events: RelayEvent[]; onEvent: (event: RelayEvent) => void } {
  const events: RelayEvent[] = []
  return { events, onEvent: (event) => events.push(event) }
}

function captureLog(): { records: DiagnosticEvent[]; log: DiagnosticLog } {
  const records: DiagnosticEvent[] = []
  return { records, log: { event: (fields) => records.push(fields) } }
}

const closedEvents = (events: RelayEvent[]): RelayEvent[] => events.filter((e) => e.type === 'closed')

// Opens one connection over the fake socket and hands back the sink, the captured log, and the fake
// so a case can drive raw events in a chosen order.
function openConnection(): {
  ws: EventEmitter
  sink: ReturnType<typeof makeSink>
  captured: ReturnType<typeof captureLog>
} {
  const sink = makeSink()
  const captured = captureLog()
  createRelayConnection({
    url: 'wss://relay.example/v1/client',
    headers: {},
    diagnosticLog: captured.log,
    onEvent: sink.onEvent
  })
  const [ws] = instances
  expect(ws).toBeDefined()
  ws.emit('open')
  return { ws, sink, captured }
}

const relayClosedRecords = (records: DiagnosticEvent[]): DiagnosticEvent[] =>
  records.filter((r) => r.event === 'relay-closed')

beforeEach(() => {
  instances.length = 0
})

describe('relayConnection oversize — 1009 normalisation, driven not observed (#1123)', () => {
  it('normalises an oversized inbound frame to a 1009 / max-frame-exceeded terminal, overriding the socket close code', () => {
    const { ws, sink } = openConnection()

    // The real ordering on ws 8.21: `receiverOnError` closes with 1009 toward the peer and emits
    // 'error' synchronously, so the module classifies before its own 'close' arrives carrying the
    // client-side 1006. Driving it here makes the verdict independent of that internal.
    ws.emit('error', MAX_FRAME_ERROR)
    ws.emit('close', 1006, Buffer.from(''))

    // Absent `pending = {code: 1009, reason: 'max-frame-exceeded'}` in the module's 'error' handler,
    // the terminal falls back to the socket's own 1006 and this fails on EVERY run.
    expect(closedEvents(sink.events)).toEqual([
      { type: 'closed', code: 1009, reason: 'max-frame-exceeded' }
    ])
    // The oversized frame is dropped, never delivered whole or truncated.
    expect(sink.events.some((e) => e.type === 'message')).toBe(false)
  })

  it('logs the oversize terminal as relay-closed with the numeric 1009 and the static classification', () => {
    const { ws, captured } = openConnection()

    ws.emit('error', MAX_FRAME_ERROR)
    ws.emit('close', 1006, Buffer.from(''))

    // The one production-observable difference the normalisation buys (traced in #1123): the
    // content-free diagnostic record. `code` is a module-STATIC string, never a wire value.
    expect(relayClosedRecords(captured.records)).toEqual([
      {
        event: 'relay-closed',
        status: 1009,
        code: 'max-frame-exceeded',
        host: 'relay.example',
        path: '/v1/client'
      }
    ])
  })

  it('leaves a non-oversize post-open error unclassified — the peer close code and reason are forwarded as-is', () => {
    const { ws, sink, captured } = openConnection()

    // A transport error that is NOT a max-frame error. Widening `isMaxFrameError` (say, to a bare
    // truthy check) would keep both cases above green and be caught only here.
    ws.emit('error', Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))
    ws.emit('close', 1011, Buffer.from('boom'))

    expect(closedEvents(sink.events)).toEqual([{ type: 'closed', code: 1011, reason: 'boom' }])

    const records = relayClosedRecords(captured.records)
    expect(records).toHaveLength(1)
    expect(records[0].status).toBe(1011)
    // No module-authored close → no static classification, and the attacker-controlled wire reason
    // ('boom') is NOT substituted for it.
    expect(records[0].code).toBeUndefined()
  })
})
