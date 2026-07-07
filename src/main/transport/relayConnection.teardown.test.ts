import type { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRelayConnection, type RelayEvent } from './relayConnection'

// Superseded-connection teardown pin — mobile #496 parity (close-then-connect race).
//
// `relayConnection.teardownAndEmitClosed` (relayConnection.ts:147-155) is the load-bearing
// guarantee behind the supervisor's safety: `relaySupervisor.onConnEvent` (relaySupervisor.ts:190)
// is a SINGLE shared handler with NO per-connection generation fence — on any `closed` it nulls the
// live `current` and re-dials. Desktop is safe from mobile #496 ("a superseded connection clobbers
// the live one") ONLY because a torn-down connection can never fire again. That guarantee lives
// entirely at this layer, in two mutually-redundant mechanisms:
//   1. `ws.removeAllListeners()` (relayConnection.ts:153) — removes every socket handler, so a late
//      raw event reaches no code.
//   2. the per-handler `if (closed) return` guards (148/158/178/190) — each handler short-circuits
//      once `closed` is true.
// Because they are redundant, a naive "re-fire a raw event and assert nothing happens" test stays
// green even if you delete EITHER one (the other still stops the event). So each mechanism is
// pinned by the assertion that targets IT specifically: mechanism 1 by the post-teardown
// listener-count check (first test); mechanism 2 by re-invoking the captured 'close' handler after
// teardown (second test). See docs/specs/architecture/35-*.md § Design "Why two assertions".
//
// COVERAGE BOUNDARY (do not overstate): these are CONNECTION-LAYER pins. Green means "a torn-down
// relayConnection does not fire again", NOT "the supervisor is race-free" — the latter is derived
// from this guarantee plus the shared-handler wiring and is argued in prose (spec § Security
// review), not asserted here. Removing only one of the two redundant guards leaves the observable
// re-emit inert; each guard is caught solely by its own targeted assertion below, not by the
// re-emit.

// ---- test-only socket seam ----
// `relayConnection` does `new WebSocket(...)` with no injection seam, so the only way to hand it a
// controllable socket is to replace the 'ws' module. FakeWebSocket is a synchronous EventEmitter:
// its `on` / `emit` / `removeAllListeners` / `listenerCount` / `listeners` are the REAL
// EventEmitter methods — those ARE the mechanism under test, so they must not be stubbed. The test
// drives the lifecycle by emitting the same raw events `ws` fires ('open' → connected;
// 'close' → terminal closed). `instances` is created via vi.hoisted so the vi.mock factory (which
// vitest lifts above the imports) can push into it; the class is defined inside the factory (which
// runs lazily, when relayConnection first imports 'ws') for the same before-initialization reason.
const { instances } = vi.hoisted(() => ({ instances: [] as EventEmitter[] }))

vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events')
  class FakeWebSocket extends EventEmitter {
    static readonly OPEN = 1
    readyState = 0
    // Never invoked here: the lifecycle is driven by emitting raw events, and teardown always
    // reaches 'close' before the connect/ping timers fire. Present only for surface completeness.
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

// Synchronous event recorder — the fake emits synchronously, so no async waitFor is needed.
function makeSink(): { events: RelayEvent[]; onEvent: (event: RelayEvent) => void } {
  const events: RelayEvent[] = []
  return { events, onEvent: (event) => events.push(event) }
}

const closedEvents = (events: RelayEvent[]): RelayEvent[] => events.filter((e) => e.type === 'closed')

// Every event `relayConnection` registers a socket listener for (open/message/pong/error/close).
const SOCKET_EVENTS = ['open', 'message', 'pong', 'error', 'close'] as const

beforeEach(() => {
  instances.length = 0
})

describe('relayConnection teardown — superseded connection never re-enters onEvent (mobile #496 parity)', () => {
  it('drops every late raw socket event after teardown and leaves the socket listener-free (pins removeAllListeners)', () => {
    const sink = makeSink()
    createRelayConnection({
      url: 'wss://relay.example/v1/client',
      headers: {},
      onEvent: sink.onEvent
    })
    const [ws] = instances
    expect(ws).toBeDefined()

    ws.emit('open')
    expect(sink.events.filter((e) => e.type === 'connected')).toHaveLength(1)

    ws.emit('close', 1006, Buffer.from('drop'))
    expect(closedEvents(sink.events)).toEqual([{ type: 'closed', code: 1006, reason: 'drop' }])

    // A hostile / on-path relay keeps pushing after we tore the connection down. These raw events
    // must reach nobody. We deliberately do NOT emit a raw 'error': Node's EventEmitter THROWS on
    // an 'error' with no listener, which — after removeAllListeners has run — would throw under the
    // CORRECT code yet NOT throw if the error listener were still attached, inverting the
    // assertion. The 'error' handler's removal is pinned below by listenerCount('error') === 0.
    expect(() => {
      ws.emit('close', 4999, Buffer.from('late'))
      ws.emit('message', new Uint8Array([1, 2, 3]))
    }).not.toThrow()

    // Still terminal-once: no second closed, no stray message, connected unchanged.
    expect(closedEvents(sink.events)).toHaveLength(1)
    expect(sink.events.filter((e) => e.type === 'message')).toHaveLength(0)
    expect(sink.events.filter((e) => e.type === 'connected')).toHaveLength(1)

    // The biting assertion: teardown removed EVERY socket listener. Absent
    // relayConnection.ts:153 (`ws.removeAllListeners()`) these counts are non-zero and this fails,
    // even though the re-emit above stays inert (the per-handler `closed` guard still covers it).
    for (const name of SOCKET_EVENTS) {
      expect(ws.listenerCount(name)).toBe(0)
    }
    expect(ws.eventNames()).toHaveLength(0)
  })

  it('ignores a re-entered close handler after teardown — terminal closed stays idempotent (pins the closed guard)', () => {
    const sink = makeSink()
    createRelayConnection({
      url: 'wss://relay.example/v1/client',
      headers: {},
      onEvent: sink.onEvent
    })
    const [ws] = instances
    expect(ws).toBeDefined()

    ws.emit('open')

    // Capture the module's 'close' handler BEFORE teardown. This is intentionally white-box: it is
    // the ONLY way to re-enter `teardownAndEmitClosed` past `removeAllListeners()` (which deletes
    // this very handler), so it isolates the `if (closed) return` guard from removeAllListeners'
    // belt-and-suspenders redundancy — the mechanism the first test cannot reach.
    const [closeHandler] = ws.listeners('close')
    expect(closeHandler).toBeTypeOf('function')

    ws.emit('close', 1006, Buffer.from('drop'))
    expect(closedEvents(sink.events)).toHaveLength(1)

    // Re-invoke the captured handler directly, as a late socket 'close' would have. The teardown
    // `closed` guard must swallow it. Absent relayConnection.ts:148 (`if (closed) return`) this
    // re-runs teardown and emits a second `closed`.
    expect(() => closeHandler(1006, Buffer.from('drop-again'))).not.toThrow()
    expect(closedEvents(sink.events)).toHaveLength(1)
  })
})
