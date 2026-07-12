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
// CONTENT-FREE logging by construction (inherited #5/#7/#22/#30): no console.*, and every caught
// error OBJECT is CLASSIFIED into a static reason and DROPPED — a codec/wasm error message can echo
// transcript/frame bytes, so it never reaches the sink or a log. The one exception is the raw failing
// frame at the inbound-frame-decode-failed catch: those bytes are pre-decryption (a base64-wrapped,
// still-encrypted InnerFrameV2 / malformed length prefix — never plaintext), so they are logged
// content-free (capped hex) through the optional injected DiagnosticLog (#133), which the driver also
// forwards into each session it builds so the session's own read-failure catches can do the same.
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
import { encodeSafeBytes, type DiagnosticLog } from '../diagnosticLog'

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
  | { type: 'relay-link-up' } // the relay socket is up — forwarded from the supervisor's `connected` (#328)
  | { type: 'relay-link-down'; code: number } // the relay socket dropped (retryable) — forwarded from `relay-closed` (#328)
  | { type: 'terminal'; code: number; reason: string } // forwarded from the supervisor (incl. 4426/4421/4401)
  | { type: 'error'; reason: RelaySessionErrorReason } // session errors + adapter-boundary errors

/** Noise key material + hello early-data for one dial's session, sourced from the paired-server record. */
export interface SessionMaterial {
  staticPrivateKey: Uint8Array
  remoteStaticPublicKey: Uint8Array
  prologue: Uint8Array
  hello: Uint8Array
  loadTimeoutMs?: number
}

/** One dial's fully-derived config: the connection half (headers) + the session half (key/hello). */
export interface DialConfig {
  connection: Omit<RelayConnectionConfig, 'onEvent'>
  session: SessionMaterial
}

/**
 * Load the current paired-server record → derive one dial's config (#83). `null` = no stored record
 * (fail closed). A store-agnostic async function constructed by the connection consumer above (it
 * owns the paired-server store); the transport receives only this function, never the store — no
 * keys, sockets, or IPC leak into it.
 */
export type DialConfigProvider = () => Promise<DialConfig | null>

/** Caller-supplied configuration for the driven session. */
export interface NoiseRelayDriverConfig {
  /** Relay params, minus onEvent — the driver owns the supervisor's onEvent to route classification. */
  connection: Omit<RelayConnectionConfig, 'onEvent'>
  /** Noise key material + hello early-data for the FIRST dial, injected from above (#42/#43/#10). */
  session: SessionMaterial
  /** The single typed sink. A trusted internal sink; must not throw (mirrors #7/#22 onEvent discipline). */
  onEvent: (event: RelaySessionEvent) => void
  /** WS close codes the supervisor treats as terminal. Passthrough; default DEFAULT_FATAL_CLOSE_CODES. */
  fatalCloseCodes?: ReadonlySet<number>
  /**
   * Optional per-dial config provider (#83). When set, every AUTOMATIC supervisor reconnect
   * re-sources BOTH halves from storage: one load() feeds the supervisor's connection (via the
   * wrapper below) and the driver's next session material. Absent → `connection`/`session` are reused
   * on every reconnect (unchanged pre-#83 behaviour). The FIRST connect always uses `session`.
   */
  loadDialConfig?: DialConfigProvider
  /** Optional content-free diagnostic sink (#126/#133). The driver uses it directly for the framing
   *  decode failure (onMessage) AND forwards it into each session's config, so both pre-decryption
   *  boundaries converge here. Absent → silent. NOT carried on SessionMaterial: the driver injects its
   *  own constant, so a #83 per-dial reload never has to thread it through DialConfig. */
  diagnosticLog?: DiagnosticLog
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
  // #83 reload-per-dial state. `firstConnect` gates the first connect onto config.session (no reason
  // to reload the record microseconds after the consumer already loaded it). `pendingSession` is the
  // session material the LATEST resolveConnection reload stashed, consumed by the next onConnected.
  // Single-writer per dial (resolveConnection writes during a re-dial; onConnected reads after it
  // connects; supervisor dials never overlap), so the value read is always the one this dial
  // resolved.
  let firstConnect = true
  let pendingSession: SessionMaterial | null = null

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

    // Pick this dial's session material (#83): on an automatic reconnect (a provider is set and this
    // is past the first connect) it's the freshly-reloaded `pendingSession` the supervisor's
    // resolveConnection stashed from the SAME load() that fed the reconnect's connection — so headers
    // and key never split across a re-pair. On the first connect, or with no provider, it's the
    // construction-time config.session, exactly as before.
    const material = config.loadDialConfig && !firstConnect ? pendingSession : config.session
    firstConnect = false

    // Defensive type-narrowing: the supervisor fail-closes on a null resolveConnection BEFORE it
    // emits `connected`, so a null here is structurally unreachable on the reload path. Surface an
    // error rather than dereference null.
    if (material === null) {
      emit({ type: 'error', reason: 'session-load-failed' })
      return
    }

    // Two per-connection latches decide which outbound frames are Noise handshake inits (tagged
    // noise_init so the daemon routes them to a handshake path, not transport-decrypt). `firstFrame`
    // is the connection's very first sendFrame — handshake message 1. `rekeyInitPending` is the
    // fresh msg1 of an in-session rekey (#112): the session emits `rekey-requested` (arming the
    // latch in `route`) then synchronously hands its rekey msg1 to `sendFrame` within the same
    // onFrame turn, so this latch is armed exactly when that one frame arrives. Both reset per
    // connection with no shared mutable state across reconnects; both are one-shot.
    let firstFrame = true
    let rekeyInitPending = false

    // Outbound: the session's raw Noise bytes → base64-std → InnerFrameV2 → supervisor.send. The
    // session's sendFrame contract forbids throwing back into it, so codec/send throws are caught
    // here and classified. A stale session's writes are dropped by the generation guard.
    const sendFrame = (raw: Uint8Array): void => {
      if (gen !== generation) return
      const type = firstFrame || rekeyInitPending ? 'noise_init' : 'noise_msg'
      firstFrame = false
      rekeyInitPending = false
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
      // The rekey trigger (#108) is still NOT propagated to the RelaySessionEvent sink (it is
      // deliberately absent from that union) — dropping it here also restores the
      // NoiseSessionEvent ⊆ RelaySessionEvent subset TypeScript needs for the emit below to narrow.
      // But #112 gives it a side effect: arm the init-framing latch so the session's next outbound
      // frame — its fresh rekey msg1, handed to `sendFrame` synchronously right after this emit —
      // is tagged noise_init and routed to the daemon's rekey responder instead of being
      // transport-decrypted (which fails AEAD → WS 4421).
      if (event.type === 'rekey-requested') {
        rekeyInitPending = true
        return
      }
      emit(event)
    }

    void createSession({
      staticPrivateKey: material.staticPrivateKey,
      remoteStaticPublicKey: material.remoteStaticPublicKey,
      prologue: material.prologue,
      hello: material.hello,
      loadTimeoutMs: material.loadTimeoutMs,
      sendFrame,
      onEvent: route,
      // The driver's OWN constant logger (not from SessionMaterial) so the session's pre-decryption
      // read-failure catches log through the same sink as the framing catch below (#133).
      diagnosticLog: config.diagnosticLog
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
      // The caught WireDecodeError object is still dropped (its message could echo more than the
      // bounded prefix); only the static code + the capped raw pre-decryption frame are logged (#133).
      config.diagnosticLog?.event({
        event: 'relay-frame-decode-failed',
        code: 'inbound-frame-decode-failed',
        bytes: frame.length,
        safeBytes: encodeSafeBytes(frame)
      })
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
        // AC2's "in addition to": surface the relay-leg "socket up" signal (#328) as a SECOND
        // consumer of the same connect, THEN start the fresh handshake. Emitted first (the socket
        // came up); onConnected is unchanged. A thin forward — no classification here.
        emit({ type: 'relay-link-up' })
        onConnected()
        break
      case 'message':
        onMessage(event.frame)
        break
      case 'relay-closed':
        // Forward the retryable socket drop up as the relay-leg "down" signal (#328). The raw close
        // code passes through verbatim — classification (4404 → daemon-absent vs an ordinary drop →
        // offline) is wire semantics, done one layer up in daemonConnection, exactly like
        // `terminal{code}`. No generation fencing: driven directly by a supervisor event, and
        // daemonConnection's per-dial onEvent wrapper drops a superseded driver's events.
        emit({ type: 'relay-link-down', code: event.code })
        break
      case 'terminal':
        onTerminal(event.code, event.reason)
        break
    }
  }

  // The supervisor's per-dial connection provider (#83), present only when loadDialConfig is set.
  // ONE load() feeds both halves of a re-dial: the supervisor gets `connection`, and onConnected
  // reads the stashed `pendingSession` — so a re-pair mid-dial can't split the headers from the key.
  // It MUST catch a thrown loadDialConfig and return null (fail closed identically to the no-record
  // case): a decodeServerKey / keychain / MalformedPairedServerRecordError throw could echo the
  // key/token, so the caught object is DROPPED, and null pendingSession so a stale prior session is
  // never reused. Without this catch the throw would escape as an unhandled rejection at the
  // supervisor's `await` (violating AC3's "never a throw out of the transport").
  const loadDialConfig = config.loadDialConfig
  const resolveConnection = loadDialConfig
    ? async (): Promise<Omit<RelayConnectionConfig, 'onEvent'> | null> => {
        try {
          const dc = await loadDialConfig()
          pendingSession = dc?.session ?? null
          return dc?.connection ?? null
        } catch {
          pendingSession = null
          return null
        }
      }
    : undefined

  const supervisor = createSupervisor({
    connection: config.connection,
    resolveConnection,
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
