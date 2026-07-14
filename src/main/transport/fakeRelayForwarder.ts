// A reusable in-process, content-blind `ws` relay forwarder — TEST-ONLY infrastructure.
//
// It stands up one in-process `ws` server on an ephemeral loopback port and splices RAW frames
// byte-for-byte between two legs: the real client under test on `…/v1/client` and a fake
// daemon on `…/v1/server`. Neither leg's frames are decoded, inspected, or altered — the relay
// is content-blind, exactly like the production v2 relay. It is the plumbing half of the
// round-trip harness (#90); the fake daemon (#91) and the round-trip test (#89) import it. It
// generalises the records-only `startRelay` inlined in relayConnection.test.ts into a two-leg
// splice, and lives as a plain `.ts` (not a `.test.ts`) so those siblings can import it.
//
// Content-blindness is enforced by the import list: this module imports only `ws` and Node
// built-ins. It MUST NOT import ./codec, the Noise modules, or any wire type — forwarding is
// opaque-byte plumbing. Legs are identified by the HTTP upgrade PATH (`/v1/client` vs
// `/v1/server`), never by frame bytes, so content-blindness (a property of frames, not of the
// upgrade line) holds. The module is log-free, mirroring relayConnection.ts: a stray
// console.log in shared test infra pollutes every consumer's output.
import { WebSocket, WebSocketServer } from 'ws'
import type { RawData } from 'ws'

/** The two-leg, content-blind forwarder handle. */
export interface FakeRelayForwarder {
  /** Base dial URL, e.g. ws://127.0.0.1:54123 — NO trailing path. The consumer appends the leg
   *  path itself: `${url}/v1/client` for the real client, `${url}/v1/server` for the fake
   *  daemon. */
  url: string
  /**
   * Resolves once BOTH legs are registered server-side — the readiness gate that closes the
   * 101-response-before-handler-registration race. Rejects with a static message after
   * `timeoutMs` (default 1000), or if close() runs before both legs connect. Cached: repeated
   * calls share one promise; the first call's timeout governs.
   */
  whenReady(timeoutMs?: number): Promise<void>
  /**
   * Terminate the CURRENT client leg to simulate a mid-session relay drop (#416). The socket's
   * abnormal 1006 close is retryable, so a supervised client auto-reconnects; the leg slot is nulled
   * on the close so the fresh `/v1/client` dial RE-SPLICES to the still-connected server leg instead
   * of being terminated. No-op when no client leg is connected. The server leg is unaffected.
   * Content-blind and modal-agnostic: it terminates a socket, never inspecting a frame.
   */
  dropClientLeg(): void
  /**
   * Terminates both legs and closes the server. Idempotent: a second call returns the same
   * promise and never re-closes. Mirrors the existing startRelay close contract.
   */
  close(): Promise<void>
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
 * Normalise one inbound WS message to a single Uint8Array. `ws` delivers a Buffer (a Uint8Array
 * subclass — no copy) in the default nodebuffer mode; the array/ArrayBuffer arms cover
 * fragmented and arraybuffer-mode delivery. This is loss-less re-assembly, not inspection — the
 * only bytes the relay ever touches. Reused verbatim from relayConnection's toFrame/toBytes.
 */
function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return data
}

/**
 * Identify a leg by the upgrade request PATH (query string stripped). Path-based routing is
 * deterministic under concurrent dial (unlike arrival order) and mirrors the client's existing
 * URL shape. Any other path yields null and is refused by the caller.
 */
function legFor(requestUrl: string | undefined): 'client' | 'server' | null {
  if (requestUrl === undefined) return null
  const path = requestUrl.split('?')[0]
  if (path.endsWith('/v1/client')) return 'client'
  if (path.endsWith('/v1/server')) return 'server'
  return null
}

const DEFAULT_READY_TIMEOUT_MS = 1000

/**
 * Stand up the forwarder on an ephemeral loopback port. Resolves once the server is listening
 * (the returned `url` is dial-ready). Entirely in-process: no Go toolchain, no external
 * network, so it runs unconditionally under `npm test`.
 */
export function startFakeRelayForwarder(): Promise<FakeRelayForwarder> {
  const wss = new WebSocketServer({ port: 0 })

  let clientLeg: WebSocket | null = null
  let serverLeg: WebSocket | null = null
  let closed = false
  // Guards the single readiness deferred against a double settle and against a whenReady()
  // call re-arming a timer after resolution/rejection/close.
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

  wss.on('connection', (socket, request) => {
    const leg = legFor(request.url)
    // Unknown path, or a duplicate on an already-filled leg: terminate; never fill a slot.
    // Defensive — test infrastructure never does this.
    if (leg === null) {
      socket.terminate()
      return
    }
    if (leg === 'client') {
      if (clientLeg !== null) {
        socket.terminate()
        return
      }
      clientLeg = socket
    } else {
      if (serverLeg !== null) {
        socket.terminate()
        return
      }
      serverLeg = socket
    }

    socket.on('message', (data: RawData, isBinary: boolean) => {
      const dest = leg === 'client' ? serverLeg : clientLeg
      // Peer not connected yet (only if a consumer sends before awaiting whenReady): drop
      // silently — the readiness gate is the consumer's contract for avoiding this.
      if (dest === null || dest.readyState !== WebSocket.OPEN) return
      // Byte-for-byte, opcode-preserving: forward the normalised bytes and the isBinary flag
      // verbatim so a binary frame stays binary and a text frame stays text. The relay never
      // reads, parses, or branches on frame content.
      dest.send(toBytes(data), { binary: isBinary })
    })

    // Free the leg slot on this socket's close so a re-dial can re-splice (#416). The identity guard
    // (`slot === socket`) is load-bearing: a LATE close of an already-superseded old socket must NOT
    // null the freshly re-spliced new leg. A closed leg drops nothing else — the opposite (still-open)
    // leg is untouched, so a client-leg drop leaves the server leg (the fake daemon) connected.
    socket.on('close', () => {
      if (leg === 'client') {
        if (clientLeg === socket) clientLeg = null
      } else if (serverLeg === socket) {
        serverLeg = null
      }
    })

    if (clientLeg !== null && serverLeg !== null) settleReady()
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

  // Terminate the current client leg (the mid-session drop). `terminate()` forces an abnormal 1006
  // close, which a supervised client treats as retryable; the leg is nulled by this socket's `close`
  // handler so the ensuing re-dial re-splices. No-op when no client leg is connected.
  function dropClientLeg(): void {
    if (clientLeg !== null) clientLeg.terminate()
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
    if (clientLeg !== null) clientLeg.terminate()
    if (serverLeg !== null) serverLeg.terminate()
    closePromise = new Promise<void>((resolve) => wss.close(() => resolve()))
    return closePromise
  }

  return new Promise<FakeRelayForwarder>((resolve, reject) => {
    wss.once('listening', () => {
      const address = wss.address()
      if (address === null || typeof address === 'string') {
        // An ephemeral loopback bind always yields an AddressInfo; narrow rather than cast.
        wss.close()
        reject(new Error('fake relay: server address unavailable'))
        return
      }
      resolve({ url: `ws://127.0.0.1:${address.port}`, whenReady, dropClientLeg, close })
    })
    wss.once('error', reject)
  })
}
