// A supervisor over the single-shot relay connection (#21), living in the Electron background
// process. It wraps `createRelayConnection` so the handshake and message layers above see a
// connection that HEALS ITSELF after transient drops instead of dying on the first blip: after
// a retryable disconnect it re-dials with capped exponential backoff + ±20% jitter, resets the
// backoff once a connection has stayed up beyond the stable-uptime threshold, treats a fatal
// close code as terminal (the reconnect-storm DoS mitigation, AC #3), tears down cleanly, and
// forwards inbound frames byte-for-byte.
//
// It lives entirely in src/main — keys, sockets, timers, and raw bytes never reach the renderer
// (CLAUDE.md "Keep the transport out of the window"; ADR 0002). The supervised lifecycle and
// inbound frames leave through an injected `onEvent` sink the background-process consumer owns;
// nothing here touches IPC, the preload bridge, or the renderer.
//
// It is LOG-FREE by construction (inherited from #21). Frames carry payload and
// `connection.headers` carry identity — a stray console.log would leak either to main-process
// stdout. All diagnostics travel as RelaySupervisorEvent data; the consumer decides whether to
// log and must not log frame contents or the connection headers.
import {
  createRelayConnection,
  RelayNotConnectedError,
  type RelayConnection,
  type RelayConnectionConfig,
  type RelayEvent
} from './relayConnection'

// Wire-spec reconnect cadence (protocol-mobile.md § Reconnect). The relay implements the
// symmetric side, so these are NOT tunable in production — they are only overridable through
// the test-only `timing` parameter of createRelaySupervisor, never through the public config.
const WIRE_BASE_DELAY_MS = 1_000
const WIRE_MAX_DELAY_MS = 30_000
const WIRE_STABLE_UPTIME_MS = 60_000
const WIRE_JITTER_RATIO = 0.2

/**
 * Wire-spec default fatal close codes for the /v2/client leg (protocol-mobile.md § Error codes):
 * 4401 unauthorized (bad device token), 4412 app build older than the host's minimum (#1613),
 * 4421 protocol mismatch, 4426 Noise handshake failure — each fails identically on retry, so
 * reconnecting is a permanent-reject storm. Excludes 4409 (a binary-leg code the client never
 * receives) and 4404 (transient binary-offline, retryable).
 */
export const DEFAULT_FATAL_CLOSE_CODES: ReadonlySet<number> = new Set([4401, 4412, 4421, 4426])

/**
 * Synthetic terminal close code for the fail-closed reload path (#83): an automatic re-dial whose
 * `resolveConnection` returns null (no stored paired-server record) ends supervision with this code.
 * It is a CLIENT-SIDE sentinel — chosen in the WebSocket private-use range and NEVER sent on the
 * wire — carried on the `terminal` event so the consumer surfaces a non-connected daemon event
 * instead of spinning re-dials at a phantom server (AC3).
 */
export const NO_PAIRED_RECORD_CLOSE_CODE = 4000

/**
 * A supervised lifecycle event. Sealed discriminated union on `type`. Distinct from #21's
 * RelayEvent. A transient `closed` drop is still ABSORBED (re-dialled) — supervision continues —
 * but since #328 it is ALSO surfaced as `relay-closed` so a higher layer can drive the relay-leg
 * status indicator; the only TERMINAL member remains `terminal` — a fatal close code (AC #3) or a
 * clean stop (AC #4).
 */
export type RelaySupervisorEvent =
  // A fresh underlying connection is live. Re-emitted on EVERY (re)connect — the consumer
  // re-handshakes here (v2 has no session resume).
  | { type: 'connected' }
  // One opaque inbound frame, forwarded byte-for-byte.
  | { type: 'message'; frame: Uint8Array }
  // The current relay connection dropped with a RETRYABLE close code; supervision CONTINUES (a
  // re-dial is scheduled). Distinct from `terminal`, which ENDS supervision. The `connected` member
  // above is the paired "relay up" signal (#328). Carries the raw WS close code (not a secret —
  // `terminal` already carries one) so a higher layer can classify it (4404 vs an ordinary drop).
  | { type: 'relay-closed'; code: number }
  // Supervision ended, emitted exactly once: a fatal close code or a stop().
  | { type: 'terminal'; code: number; reason: string }

/** Caller-supplied configuration for the supervised connection. */
export interface RelaySupervisorConfig {
  /** The #21 connection params, minus onEvent — the supervisor owns onEvent to route classification. */
  connection: Omit<RelayConnectionConfig, 'onEvent'>
  /** The supervised consumer sink (DI at the composition root; testable with a vi.fn()). */
  onEvent: (event: RelaySupervisorEvent) => void
  /** WS close codes that halt supervision as terminal. Default DEFAULT_FATAL_CLOSE_CODES. */
  fatalCloseCodes?: ReadonlySet<number>
  /**
   * Optional per-dial connection provider (#83). When set, every AUTOMATIC re-dial re-sources the
   * connection through it instead of reusing the construction-time `connection` snapshot, so a
   * re-pair mid-session dials the fresh relay/server/token. The FIRST dial always uses `connection`
   * (no reason to reload microseconds after the consumer already loaded it). A resolved `null` means
   * no stored record → fail closed with NO_PAIRED_RECORD_CLOSE_CODE. A store-agnostic async function,
   * never the store itself — the transport stays IPC-free. Absent → the construction-time snapshot is
   * reused on every dial (unchanged pre-#83 behaviour).
   */
  resolveConnection?: () => Promise<Omit<RelayConnectionConfig, 'onEvent'> | null>
  /** Injected connection factory. Default createRelayConnection. Tests pass a fake. */
  createConnection?: (config: RelayConnectionConfig) => RelayConnection
}

/** Handle for the supervised connection. */
export interface RelaySupervisor {
  /**
   * Delegate to the current live connection. Throws RelayNotConnectedError when none is live
   * (before first connect, during a backoff gap, or after terminal). No buffering across a
   * reconnect — v2 re-handshakes and re-sends from the layer above.
   */
  send(frame: string | Uint8Array): void
  /**
   * Idempotent teardown (AC #4): stop reconnecting, cancel the pending backoff timer, release
   * the underlying connection, and emit one terminal { code: 1000, reason: 'stopped' }. No
   * dangling timers remain.
   */
  stop(): void
}

/**
 * Supervise a relay connection with reconnect + capped jittered backoff. Dialing starts
 * immediately (no initial backoff). The optional second parameter overrides the wire-spec
 * cadence, scheduler, and jitter source and is TEST-ONLY — production callers pass one argument,
 * locking the non-tunable cadence by construction. `onEvent` is a trusted internal sink; it must
 * not throw.
 */
export function createRelaySupervisor(
  config: RelaySupervisorConfig,
  timing: {
    baseDelayMs?: number
    maxDelayMs?: number
    stableUptimeMs?: number
    jitterRatio?: number
    setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
    clearTimer?: (handle: ReturnType<typeof setTimeout>) => void
    random?: () => number
  } = {}
): RelaySupervisor {
  const baseDelayMs = timing.baseDelayMs ?? WIRE_BASE_DELAY_MS
  const maxDelayMs = timing.maxDelayMs ?? WIRE_MAX_DELAY_MS
  const stableUptimeMs = timing.stableUptimeMs ?? WIRE_STABLE_UPTIME_MS
  const jitterRatio = timing.jitterRatio ?? WIRE_JITTER_RATIO
  const setTimer = timing.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = timing.clearTimer ?? ((handle) => clearTimeout(handle))
  const random = timing.random ?? Math.random
  const fatalCloseCodes = config.fatalCloseCodes ?? DEFAULT_FATAL_CLOSE_CODES
  const createConnection = config.createConnection ?? createRelayConnection

  // `attempt` is the 0-based index of the NEXT backoff step. `stabilityTimer` and `backoffTimer`
  // are mutually exclusive in time: the former is armed only while connected, the latter only
  // during a backoff gap. At most one supervisor-owned timer exists at any instant.
  let attempt = 0
  let stopped = false
  let terminalEmitted = false
  let current: RelayConnection | null = null
  let backoffTimer: ReturnType<typeof setTimeout> | null = null
  let stabilityTimer: ReturnType<typeof setTimeout> | null = null
  // The first dial uses the construction-time `connection` (see resolveConnection's doc). Flipped
  // false once the first dial has picked its connection; single-writer, never reset.
  let firstDial = true

  function clearBackoffTimer(): void {
    if (backoffTimer !== null) {
      clearTimer(backoffTimer)
      backoffTimer = null
    }
  }

  function clearStabilityTimer(): void {
    if (stabilityTimer !== null) {
      clearTimer(stabilityTimer)
      stabilityTimer = null
    }
  }

  // base = min(baseDelayMs · 2^n, maxDelayMs); factor ∈ [1 - jitterRatio, 1 + jitterRatio).
  function jitteredDelay(n: number): number {
    const base = Math.min(baseDelayMs * 2 ** n, maxDelayMs)
    const factor = 1 + (random() * 2 - 1) * jitterRatio
    return base * factor
  }

  // The single terminal path: runs once, marks the supervisor stopped so late connection events
  // are ignored, clears both timers, releases the underlying connection, and emits `terminal`
  // exactly once. After it, no timers remain and no further events are forwarded (AC #4).
  function emitTerminal(code: number, reason: string): void {
    if (terminalEmitted) return
    terminalEmitted = true
    stopped = true
    clearBackoffTimer()
    clearStabilityTimer()
    if (current !== null) {
      const conn = current
      current = null
      conn.close()
    }
    config.onEvent({ type: 'terminal', code, reason })
  }

  // The reset-only stability signal: the current connection has stayed up ≥ stableUptimeMs, so
  // the next retry starts from the first backoff step again (AC #2). No emit, no dial.
  function onStable(): void {
    attempt = 0
    stabilityTimer = null
  }

  function onConnEvent(event: RelayEvent): void {
    if (stopped) return
    switch (event.type) {
      case 'connected':
        config.onEvent({ type: 'connected' })
        stabilityTimer = setTimer(onStable, stableUptimeMs)
        break
      case 'message':
        // Forward the same Uint8Array reference — opaque bytes, no copy, no interpretation.
        config.onEvent({ type: 'message', frame: event.frame })
        break
      case 'closed': {
        clearStabilityTimer()
        current = null
        if (fatalCloseCodes.has(event.code)) {
          emitTerminal(event.code, event.reason)
        } else {
          // Arm the re-dial BEFORE surfacing the drop: the backoff is the load-bearing recovery, so
          // scheduling it first guarantees a transient drop always recovers even in the (contract-
          // forbidden but defended) case of a misbehaving sink throwing on the emit below. Then
          // surface the retryable close upward (#328) — the relay-leg "offline"/"daemon-absent"
          // signal the driver classifies one layer up — while the drop stays absorbed and re-dialled.
          backoffTimer = setTimer(dial, jitteredDelay(attempt))
          attempt++
          config.onEvent({ type: 'relay-closed', code: event.code })
        }
        break
      }
    }
  }

  // Dial one connection. The first dial (and every dial when no provider is set) uses the
  // construction-time `connection` synchronously — no `await` is reached, preserving the "dials
  // immediately on creation" invariant and every existing re-dial test. An AUTOMATIC re-dial with a
  // provider re-sources the connection: it awaits resolveConnection(), fails closed on a null record
  // (NO_PAIRED_RECORD_CLOSE_CODE), and re-checks `stopped` after the await so a stop() that raced the
  // reload during the (connection-less) backoff gap aborts the dial.
  async function dial(): Promise<void> {
    backoffTimer = null
    if (stopped) return
    const resolveConnection = config.resolveConnection
    let conn: Omit<RelayConnectionConfig, 'onEvent'>
    if (firstDial || resolveConnection === undefined) {
      conn = config.connection
      firstDial = false
    } else {
      const resolved = await resolveConnection()
      if (stopped) return
      if (resolved === null) {
        emitTerminal(NO_PAIRED_RECORD_CLOSE_CODE, 'no-paired-record')
        return
      }
      conn = resolved
    }
    current = createConnection({ ...conn, onEvent: onConnEvent })
  }

  function send(frame: string | Uint8Array): void {
    if (current === null) {
      throw new RelayNotConnectedError()
    }
    // Delegates to #21's send, which itself throws if the socket is not OPEN (e.g. connecting).
    current.send(frame)
  }

  function stop(): void {
    emitTerminal(1000, 'stopped')
  }

  // First attempt is instant — no initial backoff. The first dial takes the synchronous path (it
  // uses config.connection), so the connection is created before this returns; void the promise it
  // nominally yields.
  void dial()

  return { send, stop }
}
