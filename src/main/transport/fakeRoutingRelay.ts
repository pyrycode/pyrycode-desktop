// A routing-aware, in-process `ws` relay — TEST-ONLY infrastructure, the routing counterpart to
// fakeRelayForwarder.ts.
//
// It stands up one in-process `ws` server on an ephemeral loopback port with two upgrade paths:
//   - `…/v1/client` — the RAW leg, byte-identical to what the app already dials for
//     fakeRelayForwarder (same path, same headers), so nothing in the production dial path changes.
//   - `…/v1/server` — the ROUTING-ENVELOPE leg a real `pyry` daemon registers on. Frames here are
//     JSON `RoutingEnvelope` values (see routingEnvelope.ts), which the raw forwarder cannot bridge.
//
// This is the piece a real-daemon UI e2e (#252, the consumer) needs: a raw forwarder only works
// because its fake daemon also speaks raw frames, but a real daemon speaks the routing protocol on
// its relay leg. The lifecycle scaffolding (`deferred`, `legFor`, `toBytes`, the cached
// `whenReady` gate, the idempotent `close`) is adapted verbatim from fakeRelayForwarder.ts; the
// only new behaviour is the routing translation on the server leg and conn-id multiplexing across
// client legs.
//
// Content-blindness is enforced by the import list: this module imports only `ws`, Node built-ins,
// and the local ./routingEnvelope codec. It MUST NOT import ./codec, the Noise modules, or any
// @shared wire type — the inner application `frame` is opaque bytes it never decodes. Legs are
// identified by the HTTP upgrade PATH, never by frame bytes. The module is log-free, mirroring
// fakeRelayForwarder.ts: a stray console.* in shared test infra pollutes every consumer's output —
// and the client's pairing `token` (plaintext credential material) must never reach a log.
import { WebSocket, WebSocketServer } from 'ws'
import type { RawData } from 'ws'
import { encodeRoutingEnvelope, decodeRoutingEnvelope } from './routingEnvelope'

/** The routing-aware relay handle. Mirrors FakeRelayForwarder's lifecycle contract field-for-field. */
export interface FakeRoutingRelay {
  /** Base dial URL, e.g. ws://127.0.0.1:54123 — NO trailing path. The consumer appends the leg
   *  path itself: `${url}/v1/client` for the real app, `${url}/v1/server` for the daemon/peer. */
  url: string
  /**
   * Resolves once the server leg AND at least one client leg are both registered — the routing
   * analog of the forwarder's two-leg gate (server + first client = the minimum for a round-trip).
   * Additional clients after the first do not re-arm the resolved gate. Rejects with a static
   * message after `timeoutMs` (default 1000), or if close() runs before both legs connect. Cached:
   * repeated calls share one promise; the first call's timeout governs.
   */
  whenReady(timeoutMs?: number): Promise<void>
  /**
   * Terminates the server leg and every client leg, then closes the server. Idempotent: a second
   * call returns the same promise and never re-closes.
   */
  close(): Promise<void>
}

/** One registered raw client leg. `token` is the client's `x-pyrycode-token` upgrade-header value,
 *  injected into the FIRST client→server envelope only; `firstFrameSent` is single-writer state
 *  mutated solely in this client's `'message'` handler (a socket's messages are serialised by the
 *  event loop — no cross-handler race). */
interface ClientLeg {
  socket: WebSocket
  token: string
  firstFrameSent: boolean
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

// No-op initialisers keep the executor's synchronous assignment from needing a definite-
// assignment `!`; the Promise executor runs before the constructor returns, so the real
// resolve/reject are always in place before either is called.
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * Normalise one inbound WS message to a single Uint8Array — loss-less re-assembly, not inspection.
 * `ws` delivers a Buffer (a Uint8Array subclass, no copy) in the default nodebuffer mode; the
 * array/ArrayBuffer arms cover fragmented and arraybuffer-mode delivery. Reused verbatim from
 * fakeRelayForwarder's toBytes.
 */
function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return data
}

/** Both legs speak JSON text frames; decode the normalised bytes to a UTF-8 string. */
function toText(data: RawData): string {
  return Buffer.from(toBytes(data)).toString('utf-8')
}

/**
 * Identify a leg by the upgrade request PATH (query string stripped). Path-based routing is
 * deterministic under concurrent dial (unlike arrival order) and mirrors the client's existing URL
 * shape. Any other path yields null and is refused by the caller.
 */
function legFor(requestUrl: string | undefined): 'client' | 'server' | null {
  if (requestUrl === undefined) return null
  const path = requestUrl.split('?')[0]
  if (path.endsWith('/v1/client')) return 'client'
  if (path.endsWith('/v1/server')) return 'server'
  return null
}

/** The single value of an upgrade header (Node lowercases keys; a repeated header arrives as an
 *  array — the `http.IncomingHttpHeaders` value shape). Absent → '', which encodeRoutingEnvelope
 *  omits (Go `omitempty`). */
function headerValue(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0] ?? ''
  return raw ?? ''
}

const DEFAULT_READY_TIMEOUT_MS = 1000

/**
 * Stand up the relay on an ephemeral loopback port. Resolves once the server is listening (the
 * returned `url` is dial-ready). Entirely in-process: no daemon, no external network, so it runs
 * unconditionally under `npm test`.
 */
export function startFakeRoutingRelay(): Promise<FakeRoutingRelay> {
  const wss = new WebSocketServer({ port: 0 })

  // Single source of relay state, all in this closure — a second startFakeRoutingRelay() is fully
  // independent (no module-level mutable state).
  let serverLeg: WebSocket | null = null
  const clients = new Map<string, ClientLeg>()
  let connSeq = 0
  let closed = false
  // Guards the single readiness deferred against a double settle and against a whenReady() call
  // re-arming a timer after resolution/rejection/close.
  let readySettled = false
  let readyTimer: ReturnType<typeof setTimeout> | null = null
  let closePromise: Promise<void> | null = null

  const ready = deferred<void>()
  // Internal handler so a rejection with no external awaiter (e.g. close() before whenReady())
  // never surfaces as an unhandledRejection. External await/then still observe the rejection.
  ready.promise.catch(() => {})

  function clearReadyTimer(): void {
    if (readyTimer !== null) {
      clearTimeout(readyTimer)
      readyTimer = null
    }
  }

  function settleReady(): void {
    if (readySettled) return
    readySettled = true
    clearReadyTimer()
    ready.resolve()
  }

  // Ready once the server leg AND at least one client leg are both registered.
  function maybeSettleReady(): void {
    if (serverLeg !== null && clients.size > 0) settleReady()
  }

  // Client → server: wrap each raw client frame as a routing envelope and write it to the server
  // leg as text, injecting the token on the FIRST frame for this conn-id only. Drops silently if
  // the server leg is not OPEN (the whenReady gate is the consumer's contract for avoiding this).
  function onClientMessage(connId: string, client: ClientLeg, data: RawData): void {
    if (serverLeg === null || serverLeg.readyState !== WebSocket.OPEN) return
    const frameText = toText(data)
    const token = client.firstFrameSent ? undefined : client.token
    serverLeg.send(encodeRoutingEnvelope(connId, frameText, token), { binary: false })
    client.firstFrameSent = true
  }

  // Server → client: unwrap the routing envelope and forward the inner frame RAW to the client
  // identified by conn-id; honour a close_code by closing that client AFTER the frame write.
  function onServerMessage(data: RawData): void {
    const env = decodeRoutingEnvelope(toText(data))
    if (env === null) return // fail-closed decode: drop the frame, keep serving
    const client = clients.get(env.connId)
    if (client === undefined) return // client already went away, or a bad reference
    if (env.frameText !== null && client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(env.frameText, { binary: false })
    }
    if (env.closeCode !== 0) {
      // Send-then-close preserves order on one socket: the client observes the (error) frame
      // before the close, matching Go's phoneSendPump. Guard the close: an out-of-range code
      // makes ws.close throw synchronously — one bad envelope must not crash the relay.
      try {
        client.socket.close(env.closeCode)
      } catch {
        // invalid WS close code — swallow and keep serving
      }
    }
  }

  wss.on('connection', (socket, request) => {
    const leg = legFor(request.url)
    // Unknown path: terminate; never fill a slot. Defensive — test infrastructure never does this.
    if (leg === null) {
      socket.terminate()
      return
    }

    if (leg === 'server') {
      // First-claim-wins: a second /v1/server upgrade is terminated (mirrors the forwarder's
      // already-filled-leg guard). The x-pyrycode-server header is the real daemon's registration
      // signal; the fake is single-server, so it is captured-but-unvalidated (leg identity is by
      // path).
      if (serverLeg !== null) {
        socket.terminate()
        return
      }
      serverLeg = socket
      socket.on('message', (data: RawData) => onServerMessage(data))
      maybeSettleReady()
      return
    }

    // A client leg: assign a fresh conn-id, capture the token, and register for multiplexed routing.
    const token = headerValue(request.headers['x-pyrycode-token'])
    const connId = `c-${++connSeq}`
    const client: ClientLeg = { socket, token, firstFrameSent: false }
    clients.set(connId, client)
    socket.on('message', (data: RawData) => onClientMessage(connId, client, data))
    // Drop the entry on disconnect so a stale conn-id is never routed to a dead socket (mirrors
    // Go's delete(s.phones, connID)).
    socket.on('close', () => {
      clients.delete(connId)
    })
    maybeSettleReady()
  })

  function whenReady(timeoutMs: number = DEFAULT_READY_TIMEOUT_MS): Promise<void> {
    // Arm the timeout once, on the first call while still pending. Later calls share the same
    // promise and do not re-arm — the first call's timeout governs.
    if (!readySettled && !closed && readyTimer === null) {
      readyTimer = setTimeout(() => {
        readyTimer = null
        if (readySettled) return
        readySettled = true
        ready.reject(new Error(`fake relay: both legs did not connect within ${timeoutMs}ms`))
      }, timeoutMs)
    }
    return ready.promise
  }

  function close(): Promise<void> {
    if (closePromise !== null) return closePromise
    closed = true
    clearReadyTimer()
    // Unblock an awaiting consumer if teardown beats both legs; a no-op once ready has settled.
    if (!readySettled) {
      readySettled = true
      ready.reject(new Error('fake relay: closed before both legs connected'))
    }
    if (serverLeg !== null) serverLeg.terminate()
    for (const client of clients.values()) client.socket.terminate()
    closePromise = new Promise<void>((resolve) => wss.close(() => resolve()))
    return closePromise
  }

  return new Promise<FakeRoutingRelay>((resolve, reject) => {
    wss.once('listening', () => {
      const address = wss.address()
      if (address === null || typeof address === 'string') {
        // An ephemeral loopback bind always yields an AddressInfo; narrow rather than cast.
        wss.close()
        reject(new Error('fake relay: server address unavailable'))
        return
      }
      resolve({ url: `ws://127.0.0.1:${address.port}`, whenReady, close })
    })
    wss.once('error', reject)
  })
}
