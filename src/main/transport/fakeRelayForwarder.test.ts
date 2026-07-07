import { describe, it, expect, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import type { RawData } from 'ws'
import { startFakeRelayForwarder } from './fakeRelayForwarder'

// These tests drive the forwarder with two RAW `ws` clients (not createRelayConnection): the
// forwarder is byte-level plumbing, so the round-trip integration through the real client is
// #89's job, not this suite's. Real timers — the suite runs sub-second on loopback.

// Server-side byte normaliser, the mirror of the module's inbound normaliser (see
// relayConnection.test.ts). Used to compare what a leg receives byte-for-byte.
function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return data
}

// A transient pre-open dial reset — the connection is reset before the WebSocket upgrade
// completes. Under full-suite CPU contention a raw dial to the already-listening forwarder can
// hit one ("socket hang up" / ECONNRESET), which an immediate re-dial clears (#104). ECONNREFUSED
// is the loopback accept-backlog-overflow variant of the same transient; it also covers the
// post-close "fresh dial refused" case, which simply exhausts the attempts and rejects.
function isTransientDialError(err: Error): boolean {
  const code = (err as NodeJS.ErrnoException).code
  return code === 'ECONNRESET' || code === 'ECONNREFUSED' || /socket hang up/i.test(err.message)
}

// Dial a raw ws client and resolve once it is OPEN. A pre-open transient reset is re-dialled up to
// `attemptsLeft` times against the already-listening server — deterministic convergence on a
// recoverable reset, NOT a blind whole-test retry (no assertion re-runs, so a real logic bug is
// never masked; a genuinely-down target still fails fast once attempts are exhausted). On open the
// pre-open reject handler is swapped for a benign swallow so a later reset never crashes the
// process (mirrors fakeDaemon.ts's dial lifecycle).
function connect(url: string, attemptsLeft = 5): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const onDialError = (err: Error): void => {
      ws.terminate() // drop the half-open socket before re-dialling so none leaks
      if (attemptsLeft > 1 && isTransientDialError(err)) {
        setTimeout(() => resolve(connect(url, attemptsLeft - 1)), 20)
        return
      }
      reject(err)
    }
    ws.once('error', onDialError)
    ws.once('open', () => {
      ws.off('error', onDialError)
      ws.on('error', () => {})
      resolve(ws)
    })
  })
}

// The next inbound frame on a leg, normalised to bytes plus its opcode flag.
function nextFrame(ws: WebSocket): Promise<{ data: Uint8Array; isBinary: boolean }> {
  return new Promise((resolve) => {
    ws.once('message', (data: RawData, isBinary: boolean) => {
      resolve({ data: toBytes(data), isBinary })
    })
  })
}

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

describe('startFakeRelayForwarder', () => {
  it('forwards a frame byte-identical in both directions, content-blind (AC2, AC3)', async () => {
    const forwarder = await startFakeRelayForwarder()
    cleanups.push(() => forwarder.close())
    const client = await connect(`${forwarder.url}/v1/client`)
    cleanups.push(() => client.terminate())
    const server = await connect(`${forwarder.url}/v1/server`)
    cleanups.push(() => server.terminate())
    await forwarder.whenReady()

    // Boundary bytes that are neither valid JSON nor a Noise frame — arbitrary opaque bytes
    // double as the content-blindness assertion.
    const clientToServer = new Uint8Array([0x00, 0x01, 0xff, 0x7f, 0x80])
    const atServer = nextFrame(server)
    client.send(clientToServer, { binary: true })
    expect(Array.from((await atServer).data)).toEqual(Array.from(clientToServer))

    const serverToClient = new Uint8Array([0x42, 0xde, 0xad, 0xbe, 0xef])
    const atClient = nextFrame(client)
    server.send(serverToClient, { binary: true })
    expect(Array.from((await atClient).data)).toEqual(Array.from(serverToClient))
  })

  it('preserves the opcode — a binary frame stays binary, a text frame stays text', async () => {
    const forwarder = await startFakeRelayForwarder()
    cleanups.push(() => forwarder.close())
    const client = await connect(`${forwarder.url}/v1/client`)
    cleanups.push(() => client.terminate())
    const server = await connect(`${forwarder.url}/v1/server`)
    cleanups.push(() => server.terminate())
    await forwarder.whenReady()

    const atServerBinary = nextFrame(server)
    client.send(new Uint8Array([1, 2, 3, 250]), { binary: true })
    const binary = await atServerBinary
    expect(binary.isBinary).toBe(true)
    expect(Array.from(binary.data)).toEqual([1, 2, 3, 250])

    const atServerText = nextFrame(server)
    client.send('hello-text', { binary: false })
    const text = await atServerText
    expect(text.isBinary).toBe(false)
    expect(Buffer.from(text.data).toString()).toBe('hello-text')
  })

  it('holds whenReady() pending until the second leg registers, then resolves (AC4)', async () => {
    const forwarder = await startFakeRelayForwarder()
    cleanups.push(() => forwarder.close())
    const client = await connect(`${forwarder.url}/v1/client`)
    cleanups.push(() => client.terminate())

    let resolved = false
    void forwarder.whenReady().then(() => {
      resolved = true
    })
    // A macrotask tick with only one leg up: still pending (the 1000ms timeout has not fired).
    await new Promise((r) => setTimeout(r, 20))
    expect(resolved).toBe(false)

    const server = await connect(`${forwarder.url}/v1/server`)
    cleanups.push(() => server.terminate())
    await forwarder.whenReady()
    await Promise.resolve() // flush the earlier .then microtask
    expect(resolved).toBe(true)
  })

  it('lets a consumer send immediately after whenReady() without racing registration (AC4)', async () => {
    const forwarder = await startFakeRelayForwarder()
    cleanups.push(() => forwarder.close())
    // Dial both legs, then send with NO sleep — the gate must have held until both registered.
    const client = await connect(`${forwarder.url}/v1/client`)
    cleanups.push(() => client.terminate())
    const server = await connect(`${forwarder.url}/v1/server`)
    cleanups.push(() => server.terminate())

    await forwarder.whenReady()
    const atServer = nextFrame(server)
    client.send(new Uint8Array([9, 8, 7]), { binary: true })
    expect(Array.from((await atServer).data)).toEqual([9, 8, 7])
  })

  it('rejects whenReady() with a static message when a leg never connects', async () => {
    const forwarder = await startFakeRelayForwarder()
    cleanups.push(() => forwarder.close())
    const client = await connect(`${forwarder.url}/v1/client`)
    cleanups.push(() => client.terminate())

    await expect(forwarder.whenReady(50)).rejects.toThrow(
      /both legs did not connect within 50ms/
    )
  })

  it('rejects a pending whenReady() when close() runs before both legs connect', async () => {
    const forwarder = await startFakeRelayForwarder()
    const client = await connect(`${forwarder.url}/v1/client`)
    cleanups.push(() => client.terminate())

    const pending = forwarder.whenReady()
    await forwarder.close()
    await expect(pending).rejects.toThrow(/closed before both legs connected/)
  })

  it('closes both legs and the server on teardown, idempotently (AC5)', async () => {
    const forwarder = await startFakeRelayForwarder()
    const client = await connect(`${forwarder.url}/v1/client`)
    cleanups.push(() => client.terminate())
    const server = await connect(`${forwarder.url}/v1/server`)
    cleanups.push(() => server.terminate())
    await forwarder.whenReady()

    const clientClosed = new Promise<void>((r) => client.once('close', () => r()))
    const serverClosed = new Promise<void>((r) => server.once('close', () => r()))

    // Two close() calls: both resolve, no throw, no double server-close.
    await Promise.all([forwarder.close(), forwarder.close()])
    await Promise.all([clientClosed, serverClosed])
    expect(client.readyState).toBe(WebSocket.CLOSED)
    expect(server.readyState).toBe(WebSocket.CLOSED)

    // The server has stopped listening — a fresh dial is refused.
    await expect(connect(`${forwarder.url}/v1/client`)).rejects.toThrow()
  })

  it('runs entirely in-process on an ephemeral loopback port (AC4)', async () => {
    const forwarder = await startFakeRelayForwarder()
    cleanups.push(() => forwarder.close())
    expect(forwarder.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/)
  })
})
