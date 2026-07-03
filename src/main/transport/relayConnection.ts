// One secure-WebSocket connection to the relay, living in the Electron background process.
// This is the connection primitive at the base of the connect–send–stream round-trip: it
// opens one `wss://` connection, keeps it alive with a heartbeat, caps inbound frame size,
// carries RAW frames in both directions, and closes — for the lifetime of exactly one
// connection. It is a semantics-blind byte pipe: the Noise handshake, the frame codec, and
// event parsing land on top of it later and consume it as opaque bytes. Reconnect with
// backoff wraps it later (the supervisor, #22); there is no reconnect here.
//
// It lives entirely in src/main — keys, sockets, and raw bytes never reach the renderer
// (CLAUDE.md "Keep the transport out of the window"; ADR 0002). Lifecycle and inbound frames
// leave through an injected `onEvent` sink the background-process consumer owns; nothing here
// touches IPC, the preload bridge, or the renderer.
//
// It is LOG-FREE by construction. The caller-supplied headers carry device/server identity,
// and frame bytes carry payload — a stray console.log would leak either to main-process
// stdout. All diagnostics travel as RelayEvent data; the consumer decides whether to log and
// must not log frame contents or the headers.
import { WebSocket } from 'ws'
import type { RawData } from 'ws'

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_FRAME_BYTES = 1 << 20 // 1 MiB — the relay's per-message cap (message.too_long).
// Wire-spec heartbeat cadence (protocol-mobile.md § Heartbeat). The relay implements the
// symmetric side, so these are NOT tunable in production — they are only overridable through
// the test-only `timing` parameter of createRelayConnection, never through the public config.
const WIRE_IDLE_PING_INTERVAL_MS = 30_000
const WIRE_PONG_TIMEOUT_MS = 30_000

/**
 * Caller-supplied configuration for one relay connection. The module is identity- and
 * semantics-blind: it does not construct or interpret the header semantics, and it does not
 * validate or interpret the URL beyond handing it to `ws`.
 */
export interface RelayConnectionConfig {
  /** Caller-supplied, e.g. wss://<relay>/v1/client. Used verbatim. The deployed relay routes
   *  only /v1/client (404 on any other path). Reference: pyrycode-mobile
   *  OkHttpRelayTransport.kt. */
  url: string
  /** Caller-supplied request headers, verbatim (server-id, device-name, token, user-agent).
   *  Never logged. The deployed relay requires the x-pyrycode-token header (400 without it).
   *  Reference: pyrycode-mobile OkHttpRelayTransport.kt. */
  headers: Record<string, string>
  /** WS-upgrade deadline in ms; a hung upgrade is aborted after this. Default 10_000. */
  connectTimeoutMs?: number
  /** Inbound WS frame cap in bytes; a larger frame closes the connection. Default 1 MiB. */
  maxFrameBytes?: number
  /** The background-process consumer sink. Injected at the composition root (#22). */
  onEvent: (event: RelayEvent) => void
}

/**
 * A single event from one relay connection. Sealed discriminated union on `type`. Raw frames
 * are OPAQUE bytes — no Noise decode, no framing interpretation. The terminal `closed` event
 * is emitted exactly once; the consumer tells "never connected" from "dropped after connect"
 * by whether it saw `connected` first.
 */
export type RelayEvent =
  | { type: 'connected' }
  | { type: 'message'; frame: Uint8Array }
  | { type: 'closed'; code: number; reason: string }

/** Handle for one live (or connecting) relay connection. */
export interface RelayConnection {
  /**
   * Write one opaque outbound frame as-is. A string is written as a text frame, bytes as a
   * binary frame — the module forces no opcode. Throws RelayNotConnectedError when the socket
   * is not OPEN (an attempted send with no live connection surfaces an error, never a silent
   * drop).
   */
  send(frame: string | Uint8Array): void
  /**
   * Idempotent local close (WS 1000). Tears down timers and listeners; the terminal `closed`
   * event fires once via onEvent. Safe to call before `connected`.
   */
  close(): void
}

/** Thrown by RelayConnection.send when no connection is live (readyState !== OPEN). */
export class RelayNotConnectedError extends Error {
  constructor(message = 'relay connection is not open') {
    super(message)
    this.name = 'RelayNotConnectedError'
  }
}

/**
 * Open one relay connection. Dialing starts immediately; lifecycle and inbound frames arrive
 * via config.onEvent. The optional second parameter overrides the wire-spec heartbeat cadence
 * and is TEST-ONLY — production callers pass one argument, locking the non-tunable 30s/30s
 * cadence by construction. `onEvent` is a trusted internal sink; it must not throw.
 */
export function createRelayConnection(
  config: RelayConnectionConfig,
  timing: { idlePingIntervalMs?: number; pongTimeoutMs?: number } = {}
): RelayConnection {
  const connectTimeoutMs = config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
  const maxFrameBytes = config.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES
  const idlePingIntervalMs = timing.idlePingIntervalMs ?? WIRE_IDLE_PING_INTERVAL_MS
  const pongTimeoutMs = timing.pongTimeoutMs ?? WIRE_PONG_TIMEOUT_MS

  let opened = false
  let closed = false
  // The terminal code+reason to emit. For module-initiated closes (connect-timeout,
  // pong-timeout, oversize, local close) it is set before self-terminating so the terminal
  // event is deterministic; for peer/library closes it stays null and the 'close' event's own
  // code+reason are forwarded as-is.
  let pending: { code: number; reason: string } | null = null

  let pingInterval: ReturnType<typeof setInterval> | null = null
  let pongDeadline: ReturnType<typeof setTimeout> | null = null

  const ws = new WebSocket(config.url, { headers: config.headers, maxPayload: maxFrameBytes })

  // Own the connect deadline rather than ws's `handshakeTimeout`: a single owned timer yields
  // a deterministic 'connect-timeout' reason (terminate() during CONNECTING emits 'close'
  // 1006) without string-matching ws's internal error text, and avoids two abort paths racing
  // on an equal deadline.
  let connectTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    if (closed || opened) return
    pending = { code: 1006, reason: 'connect-timeout' }
    ws.terminate()
  }, connectTimeoutMs)

  function clearConnectTimer(): void {
    if (connectTimer !== null) {
      clearTimeout(connectTimer)
      connectTimer = null
    }
  }

  function clearPongDeadline(): void {
    if (pongDeadline !== null) {
      clearTimeout(pongDeadline)
      pongDeadline = null
    }
  }

  function clearPingInterval(): void {
    if (pingInterval !== null) {
      clearInterval(pingInterval)
      pingInterval = null
    }
  }

  // The single terminal path: runs once, clears every timer, removes every listener so no late
  // ws event can re-enter onEvent, and emits `closed` exactly once.
  function teardownAndEmitClosed(code: number, reason: string): void {
    if (closed) return
    closed = true
    clearConnectTimer()
    clearPingInterval()
    clearPongDeadline()
    ws.removeAllListeners()
    config.onEvent({ type: 'closed', code, reason })
  }

  ws.on('open', () => {
    if (closed) return
    opened = true
    clearConnectTimer()
    config.onEvent({ type: 'connected' })
    // Ping unconditionally every idle interval (matching the Go mirror's pingLoop): this
    // guarantees <= idle interval between keepalives, the invariant the relay's symmetric side
    // expects. Arm a single pong-deadline; a 'pong' clears it, its expiry tears the connection.
    pingInterval = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return
      ws.ping()
      if (pongDeadline === null) {
        pongDeadline = setTimeout(() => {
          pending = { code: 1006, reason: 'pong-timeout' }
          ws.terminate()
        }, pongTimeoutMs)
      }
    }, idlePingIntervalMs)
  })

  ws.on('message', (data: RawData) => {
    if (closed) return
    config.onEvent({ type: 'message', frame: toFrame(data) })
  })

  ws.on('pong', () => {
    clearPongDeadline()
  })

  ws.on('error', (err: Error) => {
    // Never re-throw out of the handler. Do not copy err.message into the event — a ws TLS or
    // hostname error can embed the URL. Classify into a short static reason instead. A pending
    // reason already set (connect-timeout, pong-timeout, client-closing) wins.
    if (closed || pending !== null) return
    if (isMaxFrameError(err)) {
      // ws drops the oversized frame and closes; its own close code is 1006, but the observable
      // terminal code is normalised to 1009 to match the relay's `message.too_long`.
      pending = { code: 1009, reason: 'max-frame-exceeded' }
    } else if (!opened) {
      // Pre-open failure: DNS, refused, TLS, or a rejected upgrade.
      pending = { code: 1006, reason: 'connect-error' }
    }
    // Other post-open errors: let the following 'close' forward the peer/library code+reason.
  })

  ws.on('close', (code: number, reason: Buffer) => {
    const terminal = pending ?? { code, reason: reason.toString() }
    teardownAndEmitClosed(terminal.code, terminal.reason)
  })

  function send(frame: string | Uint8Array): void {
    if (ws.readyState !== WebSocket.OPEN) {
      throw new RelayNotConnectedError()
    }
    ws.send(frame)
  }

  function close(): void {
    if (closed) return
    if (pending === null) pending = { code: 1000, reason: 'client closing' }
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1000, 'client closing')
    } else {
      ws.terminate()
    }
  }

  return { send, close }
}

/**
 * Normalise one inbound WS message to a single Uint8Array. `ws` delivers a Buffer (a
 * Uint8Array subclass — no copy) in the default nodebuffer mode; the array/ArrayBuffer arms
 * cover fragmented and arraybuffer-mode delivery. The ticket guarantees one WS message = one
 * frame.
 */
function toFrame(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return data
}

/** True for the ws error raised when an inbound frame exceeds `maxPayload`. */
function isMaxFrameError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'
  )
}
