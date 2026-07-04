// The composition adapter that DRIVES a Noise session over the reconnect supervisor, living in the
// Electron background process. It sits between two primitives that know nothing of each other: the
// #22 supervisor heals a relay connection across transient drops and classifies fatal close codes
// into one `terminal` event, but its frames are opaque bytes; the #7 session performs the
// `Noise_IK_25519_ChaChaPoly_BLAKE2s` handshake + AEAD transport, but knows nothing of the socket.
// This driver starts a FRESH handshake on every `connected` (v2 has no session resume), carries
// frames through the #5 codec, and surfaces the combined lifecycle through one typed sink.
//
// It is a THIN COMPOSITION of three proven primitives, consumed unchanged — no new crypto. Keys and
// the `hello` early-data are injected from above (sourced later by #42/#43/#10); this ticket wires
// the plumbing, not the key sourcing. It stays entirely in src/main — keys, sockets, the handshake,
// and raw bytes never reach the renderer (CLAUDE.md "Keep the transport out of the window"; ADR
// 0002). The sink is a plain in-process callback the background-process consumer owns; nothing here
// touches IPC, the preload bridge, or the renderer.
//
// LOG-FREE by construction (inherited #5/#7/#22/#30): no console.*, and every caught error is
// CLASSIFIED into a static reason and the caught object DROPPED — a codec/wasm error message can
// echo transcript/frame bytes, so it never reaches the sink or a log.
import { createRelaySupervisor } from './relaySupervisor'
import type {
  RelaySupervisor,
  RelaySupervisorConfig,
  RelaySupervisorEvent
} from './relaySupervisor'
import type { RelayConnectionConfig } from './relayConnection'
import { createNoiseSession } from './noiseSession'
import type {
  NoiseSession,
  NoiseSessionConfig,
  NoiseSessionErrorReason,
  NoiseSessionEvent
} from './noiseSession'
import { base64StdDecode, base64StdEncode, decodeInnerFrame, encodeInnerFrame } from './codec'

/**
 * Cap on inbound frames buffered during the async gap between a synchronous `connected` and the
 * async `createNoiseSession`. The legitimate daemon sends nothing before it receives handshake
 * message 1, so any pre-session frame is already anomalous and a deep queue is a memory-exhaustion
 * vector a hostile on-path relay could flood. Any small constant bounds it; excess is dropped
 * fail-safe. (Architect open question — developer picks; see security review §6.)
 */
export const MAX_PENDING_FRAMES = 8

/**
 * The sink's error-reason set: the session's own reasons, plus the three adapter-boundary failures.
 * A closed set of static strings — never carries key/token/frame/plaintext bytes.
 */
export type RelaySessionErrorReason =
  | NoiseSessionErrorReason // 'handshake-read-failed' | 'transport-decrypt-failed' | 'unexpected-frame'
  | 'inbound-frame-decode-failed' // decodeInnerFrame / base64StdDecode threw at the relay boundary (fail-closed)
  | 'outbound-frame-encode-failed' // encodeInnerFrame over-cap, or supervisor.send threw (not connected)
  | 'session-load-failed' // createNoiseSession rejected (NoiseLoadError / wasm load timeout)

/** The single typed sink to the background-process consumer above. Sealed union on `type`. */
export type RelaySessionEvent =
  | { type: 'handshake-complete'; helloAck: Uint8Array } // forwarded from the session
  | { type: 'message'; plaintext: Uint8Array } // forwarded from the session (decrypted app frame)
  | { type: 'terminal'; code: number; reason: string } // forwarded from the supervisor (incl. 4426/4421/4401)
  | { type: 'error'; reason: RelaySessionErrorReason } // session errors + adapter-boundary errors

/** Caller-supplied configuration for the driven session. */
export interface NoiseRelayDriverConfig {
  /** Relay params, minus onEvent — the driver owns the supervisor's onEvent to route classification. */
  connection: Omit<RelayConnectionConfig, 'onEvent'>
  /** Noise key material + hello early-data, injected from above (sourced later by #42/#43/#10). */
  session: {
    staticPrivateKey: Uint8Array
    remoteStaticPublicKey: Uint8Array
    prologue: Uint8Array
    hello: Uint8Array
    loadTimeoutMs?: number
  }
  /** The single typed sink. A trusted internal sink; must not throw (mirrors #7/#22 onEvent discipline). */
  onEvent: (event: RelaySessionEvent) => void
  /** WS close codes the supervisor treats as terminal. Passthrough; default DEFAULT_FATAL_CLOSE_CODES. */
  fatalCloseCodes?: ReadonlySet<number>
  /** DI seams — default to the real factories. Tests inject fakes. */
  createSupervisor?: (config: RelaySupervisorConfig) => RelaySupervisor
  createSession?: (config: NoiseSessionConfig) => Promise<NoiseSession>
}

/** Handle for the driven session. */
export interface NoiseRelayDriver {
  /** Post-handshake app-message send. Delegates to the current session; inert before handshake-complete / after terminal. */
  sendMessage(plaintext: Uint8Array): void
  /** Idempotent teardown: stop the supervisor (→ one terminal), close the current session, drop buffered frames. */
  stop(): void
}

/**
 * Construct the driver: build the supervisor with the driver's OWN onEvent (that is where
 * classification routing lives, so the driver constructs rather than receives it), and start
 * driving a fresh Noise session on every (re)connect. Dialing starts immediately (supervisor
 * idiom) — the consumer constructs the driver when it wants to connect. `onEvent` must not throw.
 */
export function createNoiseRelayDriver(config: NoiseRelayDriverConfig): NoiseRelayDriver {
  const createSupervisor = config.createSupervisor ?? createRelaySupervisor
  const createSession = config.createSession ?? createNoiseSession

  // The generation counter fences every connection: supervisor events are synchronous but
  // createSession is async, so a late-resolving or stale session must never install itself or send
  // under a superseded key. Each session and each per-connection closure captures the `gen` it was
  // created under; a mismatch means it has been superseded and must no-op.
  let generation = 0
  // The live session for the current generation; null during the async-create gap, before the
  // first connect, and after terminal.
  let session: NoiseSession | null = null
  // Raw Noise frames that arrived during the async-create gap, replayed in order once the session
  // resolves. Bounded at MAX_PENDING_FRAMES (excess dropped fail-safe).
  let pending: Uint8Array[] = []

  function emit(event: RelaySessionEvent): void {
    config.onEvent(event)
  }

  // Drop the current connection's session and any buffered frames. Callers bump `generation`
  // first, so any in-flight createSession for the old generation self-closes on resolve.
  function teardownConnection(): void {
    session?.close()
    session = null
    pending = []
  }

  function onConnected(): void {
    const gen = ++generation
    teardownConnection()

    // The session's very first sendFrame is always handshake message 1, so this per-connection
    // flag resets noise_init↔noise_msg with no shared mutable state across reconnects.
    let firstFrame = true

    // Outbound: the session's raw Noise bytes → base64-std → InnerFrameV2 → supervisor.send. The
    // session's sendFrame contract forbids throwing back into it, so codec/send throws are caught
    // here and classified. A stale session's writes are dropped by the generation guard.
    const sendFrame = (raw: Uint8Array): void => {
      if (gen !== generation) return
      const type = firstFrame ? 'noise_init' : 'noise_msg'
      firstFrame = false
      try {
        supervisor.send(encodeInnerFrame({ v: 2, type, data: base64StdEncode(raw) }))
      } catch {
        emit({ type: 'error', reason: 'outbound-frame-encode-failed' })
      }
    }

    // Inbound session events: forward the session's own events (NoiseSessionEvent is a subset of
    // RelaySessionEvent — its reason set is a subset of RelaySessionErrorReason — so it passes
    // through) once past the generation guard.
    const route = (event: NoiseSessionEvent): void => {
      if (gen !== generation) return
      emit(event)
    }

    void createSession({
      staticPrivateKey: config.session.staticPrivateKey,
      remoteStaticPublicKey: config.session.remoteStaticPublicKey,
      prologue: config.session.prologue,
      hello: config.session.hello,
      loadTimeoutMs: config.session.loadTimeoutMs,
      sendFrame,
      onEvent: route
    })
      .then((s) => {
        // A superseded session is closed BEFORE start() — it never sends a spurious noise_init.
        if (gen !== generation) {
          s.close()
          return
        }
        session = s
        s.start() // sends message 1 first…
        const buffered = pending
        pending = []
        for (const raw of buffered) s.onFrame(raw) // …then buffered frames replay as its replies
      })
      .catch(() => {
        if (gen === generation) emit({ type: 'error', reason: 'session-load-failed' })
      })
  }

  // The untrusted→trusted boundary: decode one inbound frame through the #5 codec (fail-closed on
  // any malformed input — the caught error is dropped, never forwarded, as its message could echo
  // transcript bytes) and route its raw Noise bytes to the session, or buffer them if the session
  // is still resolving. The inner `type` label is NOT branched on: the session state machine +
  // Noise AEAD decide interpretation, so a hostile `type` cannot misroute.
  function onMessage(frame: Uint8Array): void {
    let raw: Uint8Array
    try {
      raw = base64StdDecode(decodeInnerFrame(frame).data)
    } catch {
      emit({ type: 'error', reason: 'inbound-frame-decode-failed' })
      return
    }
    if (session) {
      session.onFrame(raw)
    } else if (pending.length < MAX_PENDING_FRAMES) {
      pending.push(raw)
    }
    // else: bounded — drop the excess fail-safe.
  }

  // The authoritative end (a fatal close code or a stop()), emitted by the supervisor exactly once.
  // Bump the generation to invalidate any in-flight create, tear down, and surface terminal.
  function onTerminal(code: number, reason: string): void {
    generation++
    teardownConnection()
    emit({ type: 'terminal', code, reason })
  }

  function onSupervisorEvent(event: RelaySupervisorEvent): void {
    switch (event.type) {
      case 'connected':
        onConnected()
        break
      case 'message':
        onMessage(event.frame)
        break
      case 'terminal':
        onTerminal(event.code, event.reason)
        break
    }
  }

  const supervisor = createSupervisor({
    connection: config.connection,
    onEvent: onSupervisorEvent,
    fatalCloseCodes: config.fatalCloseCodes
  })

  function sendMessage(plaintext: Uint8Array): void {
    // Inert if no session; the session is also inert before transport state, so a pre-handshake
    // call is a silent no-op (matches the session contract).
    session?.sendMessage(plaintext)
  }

  // stop() drives supervisor.stop(), which synchronously emits terminal{1000,'stopped'} back
  // through onTerminal — one teardown path, no duplication. Idempotent via the supervisor's guard.
  function stop(): void {
    supervisor.stop()
  }

  return { sendMessage, stop }
}
