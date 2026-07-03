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
 * 4401 unauthorized (bad device token), 4421 protocol mismatch, 4426 Noise handshake failure —
 * each fails identically on retry, so reconnecting is a permanent-reject storm. Excludes 4409
 * (a binary-leg code the client never receives) and 4404 (transient binary-offline, retryable).
 */
export const DEFAULT_FATAL_CLOSE_CODES: ReadonlySet<number> = new Set([4401, 4421, 4426])

/**
 * A supervised lifecycle event. Sealed discriminated union on `type`. Distinct from #21's
 * RelayEvent: here a transient `closed` drop is ABSORBED (re-dialled) and never surfaced, so the
 * only terminal member is `terminal` — a fatal close code (AC #3) or a clean stop (AC #4).
 */
export type RelaySupervisorEvent =
  // A fresh underlying connection is live. Re-emitted on EVERY (re)connect — the consumer
  // re-handshakes here (v2 has no session resume).
  | { type: 'connected' }
  // One opaque inbound frame, forwarded byte-for-byte.
  | { type: 'message'; frame: Uint8Array }
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
          backoffTimer = setTimer(dial, jitteredDelay(attempt))
          attempt++
        }
        break
      }
    }
  }

  function dial(): void {
    backoffTimer = null
    if (stopped) return
    current = createConnection({ ...config.connection, onEvent: onConnEvent })
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

  // First attempt is instant — no initial backoff.
  dial()

  return { send, stop }
}
