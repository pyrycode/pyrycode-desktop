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

    const closed = await sink.waitFor((e) => e.type === 'closed', 500)
    expect(closed).toMatchObject({ type: 'closed', code: 1009 })
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
