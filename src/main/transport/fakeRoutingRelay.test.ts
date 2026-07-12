import { describe, it, expect, afterEach, vi } from 'vitest'
import { WebSocket } from 'ws'
import type { RawData } from 'ws'
import { startFakeRoutingRelay, type FakeRoutingRelay } from './fakeRoutingRelay'

// These tests drive the routing relay with two RAW `ws` clients: a fake raw app on /v1/client and
// a fake routing peer on /v1/server (JSON RoutingEnvelope wire). No real daemon, no claude, no UI,
// no network beyond loopback. Real timers — the suite runs sub-second. The harness (connect with a
// transient-reset retry, nextText, nextClose, cleanups/afterEach) is lifted from
// fakeRelayForwarder.test.ts, the sibling this relay mirrors.

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return data
}

// A transient pre-open dial reset (#104): under full-suite CPU contention a raw dial to the
// already-listening relay can hit one ("socket hang up" / ECONNRESET / ECONNREFUSED / an
// HTTP-upgrade "Parse Error" when the upgrade response is malformed under CPU starvation), which an
// immediate re-dial clears. Post-close it simply exhausts attempts and rejects.
function isTransientDialError(err: Error): boolean {
  const code = (err as NodeJS.ErrnoException).code
  return (
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    /socket hang up/i.test(err.message) ||
    /Parse Error/i.test(err.message) // pre-open HTTP-upgrade parse race under full-suite CPU load
  )
}

function connect(
  url: string,
  opts: { headers?: Record<string, string>; attemptsLeft?: number } = {}
): Promise<WebSocket> {
  const { headers, attemptsLeft = 5 } = opts
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, headers ? { headers } : undefined)
    const onDialError = (err: Error): void => {
      ws.terminate() // drop the half-open socket before re-dialling so none leaks
      if (attemptsLeft > 1 && isTransientDialError(err)) {
        setTimeout(() => resolve(connect(url, { headers, attemptsLeft: attemptsLeft - 1 })), 20)
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

// The next inbound frame on a leg, decoded to UTF-8 text (both legs speak JSON text frames).
function nextText(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.once('message', (data: RawData) => resolve(Buffer.from(toBytes(data)).toString('utf-8')))
  })
}

// The WS close code the leg observes.
function nextClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.once('close', (code: number) => resolve(code)))
}

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const c of cleanups.splice(0)) await c()
})

async function standUpRelay(): Promise<FakeRoutingRelay> {
  const relay = await startFakeRoutingRelay()
  cleanups.push(() => relay.close())
  return relay
}

// The single routing peer registers on /v1/server (header captured but not validated — leg
// identity is by path; the fake is single-server).
async function serverLeg(relay: FakeRoutingRelay): Promise<WebSocket> {
  const ws = await connect(`${relay.url}/v1/server`, { headers: { 'x-pyrycode-server': 'srv-1' } })
  cleanups.push(() => ws.terminate())
  return ws
}

async function clientLeg(relay: FakeRoutingRelay, token = 'tok'): Promise<WebSocket> {
  const ws = await connect(`${relay.url}/v1/client`, { headers: { 'x-pyrycode-token': token } })
  cleanups.push(() => ws.terminate())
  return ws
}

// Learn a client's relay-assigned conn_id by having it speak one (opaque, probe) frame and reading
// the wrapped envelope on the server leg. Consumes that client's FIRST frame (the token-bearing one).
async function learnConnId(server: WebSocket, client: WebSocket): Promise<string> {
  const wrapped = nextText(server)
  client.send('{"probe":1}')
  return JSON.parse(await wrapped).conn_id
}

describe('startFakeRoutingRelay — lifecycle parity (AC1)', () => {
  it('exposes an ephemeral loopback url and holds whenReady until BOTH server and a client leg are up', async () => {
    const relay = await standUpRelay()
    expect(relay.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/)

    await serverLeg(relay)
    let resolved = false
    void relay.whenReady().then(() => {
      resolved = true
    })
    // A macrotask tick with only the server leg up: still pending (the timeout has not fired).
    await new Promise((r) => setTimeout(r, 20))
    expect(resolved).toBe(false)

    await clientLeg(relay)
    await relay.whenReady()
    await Promise.resolve() // flush the earlier .then microtask
    expect(resolved).toBe(true)
  })

  it('rejects whenReady() with a static message when a leg never connects', async () => {
    const relay = await standUpRelay()
    await serverLeg(relay)
    await expect(relay.whenReady(50)).rejects.toThrow(/both legs did not connect within 50ms/)
  })

  it('rejects a pending whenReady() when close() runs first, and close() is idempotent', async () => {
    const relay = await standUpRelay()
    await serverLeg(relay)

    const pending = relay.whenReady()
    // Two close() calls: both resolve, no throw, no double server-close.
    await Promise.all([relay.close(), relay.close()])
    await expect(pending).rejects.toThrow(/closed before both legs connected/)
  })

  it('tears down the server leg and every client leg on close, then refuses fresh dials', async () => {
    const relay = await standUpRelay()
    const server = await serverLeg(relay)
    const client = await clientLeg(relay)
    await relay.whenReady()

    const serverClosed = new Promise<void>((r) => server.once('close', () => r()))
    const clientClosed = new Promise<void>((r) => client.once('close', () => r()))
    await relay.close()
    await Promise.all([serverClosed, clientClosed])
    expect(server.readyState).toBe(WebSocket.CLOSED)
    expect(client.readyState).toBe(WebSocket.CLOSED)

    await expect(connect(`${relay.url}/v1/client`, { headers: { 'x-pyrycode-token': 't' } })).rejects.toThrow()
  })
})

describe('startFakeRoutingRelay — client → server wrap + first-frame token (AC2)', () => {
  it('wraps each client frame as a routing envelope, injecting the token on the FIRST frame only', async () => {
    const relay = await standUpRelay()
    const server = await serverLeg(relay)
    const client = await clientLeg(relay, 'tok-abc')
    await relay.whenReady()

    const first = nextText(server)
    client.send('{"v":2,"type":"noise_msg","data":"AAA="}')
    const firstEnv = JSON.parse(await first)
    expect(firstEnv.conn_id).toMatch(/^c-\d+$/)
    expect(firstEnv.token).toBe('tok-abc')
    expect(firstEnv.frame).toEqual({ v: 2, type: 'noise_msg', data: 'AAA=' })
    const connId = firstEnv.conn_id

    const second = nextText(server)
    client.send('{"v":2,"type":"noise_msg","data":"BBB="}')
    const secondEnv = JSON.parse(await second)
    expect('token' in secondEnv).toBe(false) // omitted on every subsequent frame
    expect(secondEnv.conn_id).toBe(connId) // same conn_id
    expect(secondEnv.frame).toEqual({ v: 2, type: 'noise_msg', data: 'BBB=' })
  })
})

describe('startFakeRoutingRelay — server → client unwrap + close_code (AC3)', () => {
  it('unwraps a routing envelope to a raw client frame, then forwards-and-closes on close_code', async () => {
    const relay = await standUpRelay()
    const server = await serverLeg(relay)
    const client = await clientLeg(relay)
    await relay.whenReady()
    const connId = await learnConnId(server, client)

    // Plain frame: client receives the inner frame bytes raw (text), no close.
    const atClient = nextText(client)
    server.send(JSON.stringify({ conn_id: connId, frame: { v: 2, type: 'assistant', data: 'ZZ==' } }))
    expect(JSON.parse(await atClient)).toEqual({ v: 2, type: 'assistant', data: 'ZZ==' })

    // Frame + close_code: the client observes the frame THEN a close with that exact code.
    const atClient2 = nextText(client)
    const closed = nextClose(client)
    server.send(JSON.stringify({ conn_id: connId, frame: { err: 'bye' }, close_code: 4401 }))
    expect(JSON.parse(await atClient2)).toEqual({ err: 'bye' })
    expect(await closed).toBe(4401)
  })

  it('closes a client with no prior frame on a close-only envelope', async () => {
    const relay = await standUpRelay()
    const server = await serverLeg(relay)
    const client = await clientLeg(relay)
    await relay.whenReady()
    const connId = await learnConnId(server, client)

    let gotFrame = false
    client.on('message', () => {
      gotFrame = true
    })
    const closed = nextClose(client)
    server.send(JSON.stringify({ conn_id: connId, close_code: 4408 }))
    expect(await closed).toBe(4408)
    expect(gotFrame).toBe(false)
  })
})

describe('startFakeRoutingRelay — conn-id multiplexing (AC4)', () => {
  it('assigns distinct conn_ids and routes each daemon→client frame to the correct client only', async () => {
    const relay = await standUpRelay()
    const server = await serverLeg(relay)
    const clientA = await clientLeg(relay, 'a')
    const clientB = await clientLeg(relay, 'b')
    await relay.whenReady()

    const idA = await learnConnId(server, clientA)
    const idB = await learnConnId(server, clientB)
    expect(idA).not.toBe(idB)

    // A frame addressed to idB reaches clientB and not clientA.
    let aGot = false
    clientA.on('message', () => {
      aGot = true
    })
    const atB = nextText(clientB)
    server.send(JSON.stringify({ conn_id: idB, frame: { to: 'b' } }))
    expect(JSON.parse(await atB)).toEqual({ to: 'b' })
    expect(aGot).toBe(false)
  })
})

describe('startFakeRoutingRelay — content-blindness & robustness (AC5)', () => {
  it('wraps/unwraps arbitrary JSON frames it has no types for, without interpretation', async () => {
    const relay = await standUpRelay()
    const server = await serverLeg(relay)
    const client = await clientLeg(relay)
    await relay.whenReady()

    const wrapped = nextText(server)
    client.send('{"x":[1,2,3],"nested":{"k":"v"}}')
    const env = JSON.parse(await wrapped)
    expect(env.frame).toEqual({ x: [1, 2, 3], nested: { k: 'v' } })

    const atClient = nextText(client)
    server.send(JSON.stringify({ conn_id: env.conn_id, frame: { totally: 'unknown', shape: true } }))
    expect(JSON.parse(await atClient)).toEqual({ totally: 'unknown', shape: true })
  })

  it('is log-free across a full wrap → unwrap → close cycle, never logging the token', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const relay = await standUpRelay()
    const server = await serverLeg(relay)
    const client = await clientLeg(relay, 'secret-token-xyz')
    await relay.whenReady()

    const wrapped = nextText(server)
    client.send('{"v":2,"type":"noise_msg","data":"AAA="}')
    const connId = JSON.parse(await wrapped).conn_id
    const closed = nextClose(client)
    server.send(JSON.stringify({ conn_id: connId, frame: { err: 'x' }, close_code: 4401 }))
    await closed

    expect(logSpy).not.toHaveBeenCalled()
    expect(errSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('drops a malformed server-leg frame and keeps routing a subsequent valid one', async () => {
    const relay = await standUpRelay()
    const server = await serverLeg(relay)
    const client = await clientLeg(relay)
    await relay.whenReady()
    const connId = await learnConnId(server, client)

    server.send('not json{') // fail-closed decode → dropped
    const atClient = nextText(client)
    server.send(JSON.stringify({ conn_id: connId, frame: { ok: 1 } }))
    expect(JSON.parse(await atClient)).toEqual({ ok: 1 })
  })

  it('survives an out-of-range close_code without crashing the relay', async () => {
    const relay = await standUpRelay()
    const server = await serverLeg(relay)
    const clientA = await clientLeg(relay, 'a')
    const clientB = await clientLeg(relay, 'b')
    await relay.whenReady()
    const idA = await learnConnId(server, clientA)
    const idB = await learnConnId(server, clientB)

    // 99999 is not a valid WS close code — ws.close throws; the guarded handler swallows it so the
    // relay keeps serving. (It poisons clientA's own socket, but that is a hostile/malformed input;
    // the invariant is that the relay process stays alive.)
    server.send(JSON.stringify({ conn_id: idA, close_code: 99999 }))

    // Proof the relay is still routing: a valid frame to a healthy client still arrives.
    const atB = nextText(clientB)
    server.send(JSON.stringify({ conn_id: idB, frame: { still: 'alive' } }))
    expect(JSON.parse(await atB)).toEqual({ still: 'alive' })
  })
})
