import { describe, it, expect, afterEach, vi } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import type { RawData } from 'ws'
import http from 'node:http'
import type { Duplex } from 'node:stream'
import type { AddressInfo } from 'node:net'
import {
  createRelayConnection,
  RelayNotConnectedError,
  type RelayEvent
} from './relayConnection'
import type { DiagnosticEvent, DiagnosticLog } from '../diagnosticLog'

// These tests stand up a real in-process `ws` server (the "content-blind test forwarder"
// the Go mirror used with httptest) rather than mocking `ws`. Cadences are driven through
// the test-only `timing` parameter and small `connectTimeoutMs`/`maxFrameBytes` so the whole
// suite runs well under a second on real timers.

// --- server-side byte normaliser (mirror of the module's inbound normaliser) ---
function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return data
}

interface FakeRelay {
  url: string
  pings: () => number
  headers: () => http.IncomingHttpHeaders | undefined
  received: () => Array<{ data: Uint8Array; isBinary: boolean }>
  close: () => Promise<void>
}

// A parameterisable in-process relay: accept (+ optional per-connection behaviour), refuse
// the upgrade, or suppress auto-pong so the client's pong-deadline fires.
async function startRelay(
  opts: {
    refuse?: boolean
    autoPong?: boolean
    onConnect?: (socket: WebSocket) => void
  } = {}
): Promise<FakeRelay> {
  const wss = new WebSocketServer({
    port: 0,
    autoPong: opts.autoPong ?? true,
    verifyClient: opts.refuse ? () => false : undefined
  })
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()))
  const port = (wss.address() as AddressInfo).port

  let pings = 0
  let lastHeaders: http.IncomingHttpHeaders | undefined
  const sockets: WebSocket[] = []
  const received: Array<{ data: Uint8Array; isBinary: boolean }> = []

  wss.on('connection', (socket, request) => {
    lastHeaders = request.headers
    sockets.push(socket)
    socket.on('ping', () => {
      pings += 1
    })
    socket.on('message', (data: RawData, isBinary: boolean) => {
      received.push({ data: toBytes(data), isBinary })
    })
    opts.onConnect?.(socket)
  })

  return {
    url: `ws://127.0.0.1:${port}`,
    pings: () => pings,
    headers: () => lastHeaders,
    received: () => received,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.terminate()
        wss.close(() => resolve())
      })
  }
}

// A bare HTTP server that accepts the TCP connection and the upgrade request but never
// answers it — the client stays in CONNECTING until its connect-deadline fires.
async function startBlackHole(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200)
    res.end()
  })
  const held: Duplex[] = []
  server.on('upgrade', (_req, socket) => {
    held.push(socket) // hold the socket open, never respond
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as AddressInfo).port
  return {
    url: `ws://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of held) s.destroy()
        server.close(() => resolve())
      })
  }
}

// A bare HTTP server that answers the WS upgrade with a raw non-101 status (e.g. 404 for a
// client that dialed without /v1/client), then closes — so the client sees a real unexpected
// HTTP response and fires 'unexpected-response'. Modeled on startBlackHole.
async function startRejectingRelay(
  status: number
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200)
    res.end()
  })
  const sockets: Duplex[] = []
  server.on('upgrade', (_req, socket) => {
    sockets.push(socket)
    socket.write(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
    socket.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as AddressInfo).port
  return {
    url: `ws://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy()
        server.close(() => resolve())
      })
  }
}

// A fake DiagnosticLog that captures the content-free field envelopes each call site passes,
// so a test asserts over exactly what would be serialized — never a stamped/serialized line.
function captureLog(): { records: DiagnosticEvent[]; log: DiagnosticLog } {
  const records: DiagnosticEvent[] = []
  return { records, log: { event: (fields) => records.push(fields) } }
}

// Records every event and lets a test await the first event matching a predicate.
function makeSink(): {
  events: RelayEvent[]
  onEvent: (event: RelayEvent) => void
  waitFor: (pred: (e: RelayEvent) => boolean, timeoutMs?: number) => Promise<RelayEvent>
} {
  const events: RelayEvent[] = []
  const waiters: Array<{ pred: (e: RelayEvent) => boolean; resolve: (e: RelayEvent) => void }> = []
  return {
    events,
    onEvent(event) {
      events.push(event)
      for (const w of [...waiters]) {
        if (w.pred(event)) {
          waiters.splice(waiters.indexOf(w), 1)
          w.resolve(event)
        }
      }
    },
    waitFor(pred, timeoutMs = 1000) {
      const existing = events.find(pred)
      if (existing) return Promise.resolve(existing)
      return new Promise<RelayEvent>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('timed out waiting for relay event')),
          timeoutMs
        )
        waiters.push({
          pred,
          resolve: (e) => {
            clearTimeout(timer)
            resolve(e)
          }
        })
      })
    }
  }
}

const messages = (events: RelayEvent[]): Array<Extract<RelayEvent, { type: 'message' }>> =>
  events.filter((e): e is Extract<RelayEvent, { type: 'message' }> => e.type === 'message')

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

describe('createRelayConnection', () => {
  it('opens the connection with the caller-supplied headers, unmodified (AC1)', async () => {
    const relay = await startRelay()
    cleanups.push(() => relay.close())
    const sink = makeSink()
    const headers = {
      'x-pyrycode-server': 's1',
      'x-pyrycode-device-name': 'desk',
      'user-agent': 'pyrycode-desktop/0'
    }
    const handle = createRelayConnection({ url: relay.url, headers, onEvent: sink.onEvent })
    cleanups.push(() => handle.close())

    await sink.waitFor((e) => e.type === 'connected')

    const seen = relay.headers()
    expect(seen?.['x-pyrycode-server']).toBe('s1')
    expect(seen?.['x-pyrycode-device-name']).toBe('desk')
    expect(seen?.['user-agent']).toBe('pyrycode-desktop/0')
  })

  it('aborts a hung upgrade within the connect timeout as a connection failure (AC2)', async () => {
    const relay = await startBlackHole()
    cleanups.push(() => relay.close())
    const sink = makeSink()
    const handle = createRelayConnection({
      url: relay.url,
      headers: {},
      connectTimeoutMs: 150,
      onEvent: sink.onEvent
    })
    cleanups.push(() => handle.close())

    const closed = await sink.waitFor((e) => e.type === 'closed', 500)
    expect(closed).toEqual({ type: 'closed', code: 1006, reason: 'connect-timeout' })
    expect(sink.events.some((e) => e.type === 'connected')).toBe(false)
  })

  it('surfaces a refused upgrade as a terminal closed, never hanging (AC2)', async () => {
    const relay = await startRelay({ refuse: true })
    cleanups.push(() => relay.close())
    const sink = makeSink()
    const handle = createRelayConnection({ url: relay.url, headers: {}, onEvent: sink.onEvent })
    cleanups.push(() => handle.close())

    const closed = await sink.waitFor((e) => e.type === 'closed', 500)
    expect(closed).toMatchObject({ type: 'closed', code: 1006, reason: 'connect-error' })
    expect(sink.events.some((e) => e.type === 'connected')).toBe(false)
  })

  it('keeps the connection alive by sending idle pings (AC3)', async () => {
    const relay = await startRelay() // autoPong on — the pongs keep the connection alive
    cleanups.push(() => relay.close())
    const sink = makeSink()
    const handle = createRelayConnection(
      { url: relay.url, headers: {}, onEvent: sink.onEvent },
      { idlePingIntervalMs: 40 }
    )
    cleanups.push(() => handle.close())

    await sink.waitFor((e) => e.type === 'connected')
    await new Promise((r) => setTimeout(r, 160))

    expect(relay.pings()).toBeGreaterThanOrEqual(1)
    expect(sink.events.some((e) => e.type === 'closed')).toBe(false)
  })

  it('closes the connection when no pong arrives within the pong timeout (AC3)', async () => {
    const relay = await startRelay({ autoPong: false }) // never pongs
    cleanups.push(() => relay.close())
    const sink = makeSink()
    const handle = createRelayConnection(
      { url: relay.url, headers: {}, onEvent: sink.onEvent },
      { idlePingIntervalMs: 40, pongTimeoutMs: 60 }
    )
    cleanups.push(() => handle.close())

    await sink.waitFor((e) => e.type === 'connected')
    const closed = await sink.waitFor((e) => e.type === 'closed', 500)
    expect(closed).toMatchObject({ type: 'closed', reason: 'pong-timeout' })
  })

  it('closes on an oversized inbound frame without emitting a partial frame (AC4)', async () => {
    const relay = await startRelay({
      onConnect: (socket) => socket.send(Buffer.alloc(2048))
    })
    cleanups.push(() => relay.close())
    const sink = makeSink()
    const handle = createRelayConnection({
      url: relay.url,
      headers: {},
      maxFrameBytes: 1024,
      onEvent: sink.onEvent
    })
    cleanups.push(() => handle.close())

    // The raw ws close code is deliberately NOT asserted here, and re-adding it re-opens a flake
    // (#1123). `ws`'s own client-side code for an oversized inbound frame is 1006 — the 1009 goes
    // only to the peer (ws 8.21) — and the module's normalisation to 1009 lands only if 'error'
    // reaches it before 'close', which is a `ws` internal, not a contract this repo owns. Under
    // full-suite load this case observed 1006 once on the #1122 gate run. What is asserted is the
    // order-independent half the package overview mandates (§ Edge cases: "assert oversize by
    // terminal close + no message emitted, never by the raw ws close code") — and it is what proves
    // the `maxPayload` cap actually dropped the frame rather than delivering it truncated, which is
    // a real-socket property no mock can witness. The 1009 / max-frame-exceeded normalisation is
    // pinned deterministically in relayConnection.oversize.test.ts.
    await sink.waitFor((e) => e.type === 'closed', 500)
    expect(sink.events.filter((e) => e.type === 'closed')).toHaveLength(1)
    expect(sink.events.some((e) => e.type === 'message')).toBe(false)
  })

  it('emits inbound frames as opaque bytes, byte-for-byte (AC5)', async () => {
    const jsonBytes = new Uint8Array(Buffer.from(JSON.stringify({ hello: 'world' })))
    const rawBytes = new Uint8Array([0x00, 0x01, 0xff, 0x7f, 0x80])
    const relay = await startRelay({
      onConnect: (socket) => {
        socket.send(jsonBytes)
        socket.send(rawBytes)
      }
    })
    cleanups.push(() => relay.close())
    const sink = makeSink()
    const handle = createRelayConnection({ url: relay.url, headers: {}, onEvent: sink.onEvent })
    cleanups.push(() => handle.close())

    await sink.waitFor(() => messages(sink.events).length >= 2, 500)

    const frames = messages(sink.events)
    expect(Array.from(frames[0].frame)).toEqual(Array.from(jsonBytes))
    expect(Array.from(frames[1].frame)).toEqual(Array.from(rawBytes))
  })

  it('writes outbound frames to the socket unchanged, binary and text (AC5)', async () => {
    const relay = await startRelay()
    cleanups.push(() => relay.close())
    const sink = makeSink()
    const handle = createRelayConnection({ url: relay.url, headers: {}, onEvent: sink.onEvent })
    cleanups.push(() => handle.close())

    await sink.waitFor((e) => e.type === 'connected')
    handle.send(new Uint8Array([1, 2, 3, 250]))
    handle.send('hello-text')

    await vi.waitFor(() => expect(relay.received()).toHaveLength(2), { timeout: 1000 })
    const [first, second] = relay.received()
    expect(first.isBinary).toBe(true)
    expect(Array.from(first.data)).toEqual([1, 2, 3, 250])
    expect(second.isBinary).toBe(false)
    expect(Buffer.from(second.data).toString()).toBe('hello-text')
  })

  it('throws on send with no live connection, before connect and after close (AC5)', async () => {
    const relay = await startRelay()
    cleanups.push(() => relay.close())
    const sink = makeSink()
    const handle = createRelayConnection({ url: relay.url, headers: {}, onEvent: sink.onEvent })
    cleanups.push(() => handle.close())

    // Still connecting — no live socket yet.
    expect(() => handle.send(new Uint8Array([1]))).toThrow(RelayNotConnectedError)

    await sink.waitFor((e) => e.type === 'connected')
    handle.close()
    await sink.waitFor((e) => e.type === 'closed')

    // After the terminal close.
    expect(() => handle.send('x')).toThrow(RelayNotConnectedError)
  })

  it('emits exactly one closed on a remote drop and then refuses sends (lifecycle)', async () => {
    const relay = await startRelay({
      onConnect: (socket) => setTimeout(() => socket.terminate(), 20)
    })
    cleanups.push(() => relay.close())
    const sink = makeSink()
    const handle = createRelayConnection({ url: relay.url, headers: {}, onEvent: sink.onEvent })
    cleanups.push(() => handle.close())

    await sink.waitFor((e) => e.type === 'connected')
    await sink.waitFor((e) => e.type === 'closed', 500)

    // A follow-up close() emits nothing further — terminal-once.
    handle.close()
    await new Promise((r) => setTimeout(r, 30))
    expect(sink.events.filter((e) => e.type === 'closed')).toHaveLength(1)
    expect(() => handle.send('x')).toThrow(RelayNotConnectedError)
  })

  it('closes cleanly when close() is called before the connection opens', async () => {
    const relay = await startRelay()
    cleanups.push(() => relay.close())
    const sink = makeSink()
    const handle = createRelayConnection({ url: relay.url, headers: {}, onEvent: sink.onEvent })
    cleanups.push(() => handle.close())

    handle.close() // synchronous — the socket is still CONNECTING
    await sink.waitFor((e) => e.type === 'closed', 500)
    expect(sink.events.filter((e) => e.type === 'closed')).toHaveLength(1)
    expect(sink.events.some((e) => e.type === 'connected')).toBe(false)
  })
})

describe('createRelayConnection — content-free diagnostic logging (#127)', () => {
  it('logs the unexpected HTTP upgrade status and terminates without hanging (AC1)', async () => {
    const relay = await startRejectingRelay(404)
    cleanups.push(() => relay.close())
    const sink = makeSink()
    const captured = captureLog()
    const handle = createRelayConnection({
      url: `${relay.url}/v1/client`,
      headers: {},
      // Large connect deadline: a log-only handler would hang until this fires (the ws trap),
      // so a prompt terminal proves the handler drives termination itself, not the timeout.
      connectTimeoutMs: 5000,
      diagnosticLog: captured.log,
      onEvent: sink.onEvent
    })
    cleanups.push(() => handle.close())

    const closed = await sink.waitFor((e) => e.type === 'closed', 500)
    expect(closed).toMatchObject({ type: 'closed', code: 1006, reason: 'connect-error' })
    expect(sink.events.some((e) => e.type === 'connected')).toBe(false)

    const records = captured.records.filter((r) => r.event === 'relay-unexpected-response')
    expect(records).toEqual([
      { event: 'relay-unexpected-response', status: 404, host: '127.0.0.1', path: '/v1/client' }
    ])
  })

  it('logs relay-open with safe coordinates on connect (AC2)', async () => {
    const relay = await startRelay()
    cleanups.push(() => relay.close())
    const sink = makeSink()
    const captured = captureLog()
    const handle = createRelayConnection({
      url: `${relay.url}/v1/client`,
      headers: {},
      diagnosticLog: captured.log,
      onEvent: sink.onEvent
    })
    cleanups.push(() => handle.close())

    await sink.waitFor((e) => e.type === 'connected')

    expect(captured.records.filter((r) => r.event === 'relay-open')).toEqual([
      { event: 'relay-open', host: '127.0.0.1', path: '/v1/client', connectionId: expect.any(String) }
    ])
  })

  it('logs relay-closed with the numeric code and static classification on a module close (AC2)', async () => {
    const relay = await startRelay({ autoPong: false }) // never pongs → pong-timeout
    cleanups.push(() => relay.close())
    const sink = makeSink()
    const captured = captureLog()
    const handle = createRelayConnection(
      {
        url: `${relay.url}/v1/client`,
        headers: {},
        diagnosticLog: captured.log,
        onEvent: sink.onEvent
      },
      { idlePingIntervalMs: 40, pongTimeoutMs: 60 }
    )
    cleanups.push(() => handle.close())

    await sink.waitFor((e) => e.type === 'closed', 500)

    expect(captured.records.filter((r) => r.event === 'relay-closed')).toEqual([
      {
        event: 'relay-closed',
        connectionId: expect.any(String),
        status: 1006,
        code: 'pong-timeout',
        host: '127.0.0.1',
        path: '/v1/client'
      }
    ])
  })

  it('logs relay-closed with a numeric code and no classification on a peer close (AC2)', async () => {
    const relay = await startRelay({
      onConnect: (socket) => setTimeout(() => socket.terminate(), 20)
    })
    cleanups.push(() => relay.close())
    const sink = makeSink()
    const captured = captureLog()
    const handle = createRelayConnection({
      url: `${relay.url}/v1/client`,
      headers: {},
      diagnosticLog: captured.log,
      onEvent: sink.onEvent
    })
    cleanups.push(() => handle.close())

    await sink.waitFor((e) => e.type === 'connected')
    await sink.waitFor((e) => e.type === 'closed', 500)

    const closed = captured.records.filter((r) => r.event === 'relay-closed')
    expect(closed).toHaveLength(1)
    expect(typeof closed[0].status).toBe('number')
    // A peer/library close leaves `pending` null → the static classification is undefined (present
    // but dropped by JSON.stringify), never the attacker-controlled wire close `reason`.
    expect(closed[0].code).toBeUndefined()
  })

  it('never logs the token, the URL query, or a header value (AC3)', async () => {
    const relay = await startRelay({
      onConnect: (socket) => setTimeout(() => socket.terminate(), 20)
    })
    cleanups.push(() => relay.close())
    const sink = makeSink()
    const captured = captureLog()
    const handle = createRelayConnection({
      url: `${relay.url}/v1/client?token=SUPERSECRET`,
      headers: { 'x-pyrycode-token': 'SUPERSECRET' },
      diagnosticLog: captured.log,
      onEvent: sink.onEvent
    })
    cleanups.push(() => handle.close())

    await sink.waitFor((e) => e.type === 'connected')
    await sink.waitFor((e) => e.type === 'closed', 500)

    expect(captured.records.length).toBeGreaterThanOrEqual(2) // relay-open + relay-closed
    for (const value of captured.records.flatMap((r) => Object.values(r))) {
      expect(String(value)).not.toContain('SUPERSECRET')
    }
    for (const record of captured.records) {
      expect(record.host).toBe('127.0.0.1')
      expect(record.path).toBe('/v1/client')
    }
  })

  it('does not log and does not throw when no diagnosticLog is injected (backward-compat)', async () => {
    const relay = await startRelay({
      onConnect: (socket) => setTimeout(() => socket.terminate(), 20)
    })
    cleanups.push(() => relay.close())
    const sink = makeSink()
    const handle = createRelayConnection({
      url: `${relay.url}/v1/client`,
      headers: {},
      onEvent: sink.onEvent
    })
    cleanups.push(() => handle.close())

    await sink.waitFor((e) => e.type === 'connected')
    const closed = await sink.waitFor((e) => e.type === 'closed', 500)
    expect(closed).toMatchObject({ type: 'closed' })
  })
})

it('correlates real socket handoffs with distinct open/close connection ids and never observes refused writes', async () => {
  const relay = await startRelay()
  cleanups.push(() => relay.close())
  const connectionIds: string[] = []
  for (let i = 0; i < 3; i++) {
    const captured = captureLog()
    const sink = makeSink()
    const handle = createRelayConnection({ url: relay.url, headers: {}, onEvent: sink.onEvent, diagnosticLog: captured.log })
    cleanups.push(() => handle.close())
    const observe = vi.fn()
    expect(() => handle.send('x', observe)).toThrow(RelayNotConnectedError)
    expect(observe).not.toHaveBeenCalled()
    await sink.waitFor(event => event.type === 'connected')
    const write = vi.spyOn(WebSocket.prototype, 'send').mockImplementationOnce(() => { throw new Error('SECRET') })
    expect(() => handle.send('x', observe)).toThrow()
    expect(observe).not.toHaveBeenCalled()
    write.mockRestore()
    handle.send('x', observe)
    const opened = captured.records.find(record => record.event === 'relay-open')
    expect(observe).toHaveBeenCalledTimes(1)
  expect(observe).toHaveBeenCalledWith({ type: 'sent', connectionId: opened?.connectionId })
    expect(() => handle.send('x', () => { throw new Error('SECRET') })).not.toThrow()
    handle.close()
    await sink.waitFor(event => event.type === 'closed')
    const closed = captured.records.find(record => record.event === 'relay-closed')
    expect(closed?.connectionId).toBe(opened?.connectionId)
    connectionIds.push(opened!.connectionId!)
    expect(() => handle.send('x', observe)).toThrow(RelayNotConnectedError)
    expect(observe).toHaveBeenCalledTimes(1)
  }
  expect(new Set(connectionIds).size).toBe(3)
})
