// The production Noise session for the Electron MAIN process: a PURE CRYPTO UNIT that performs the
// `Noise_IK_25519_ChaChaPoly_BLAKE2s` handshake (the injected `hello` rides as early-data on IK
// message 1; `hello_ack` is recovered from message 2), then encrypts/decrypts transport frames so
// the relay socket (a sibling wiring ticket) can carry a confidential, authenticated channel to
// the daemon. The suite is load-bearing — a mismatch fails the handshake silently (ADR 0002) — so
// NOISE_PROTOCOL is reused verbatim, never retyped.
//
// Keys are INJECTED as config (raw 32-byte X25519 static private + remote static public); this
// module sources no key from storage and constructs no envelope — both are separate concerns. In
// `transport` state it does PEEK the decrypted envelope's `type` (via decodeEnvelope) to recognize
// the daemon's in-session `rekey_request` control frame (#108) and surface it as a distinct typed
// trigger — a type-peek only: it still constructs no envelope and interprets no payload, and
// app-message decoding stays downstream in parseInboundMessage.
// On that recognized `rekey_request` (#111) the session also ACTS: it runs a FRESH in-session IK
// handshake as initiator — same injected static keys and NOISE_PROTOCOL suite, EMPTY early-data
// both ways (no hello re-sent, no hello_ack) — and on the daemon's reply atomically swaps its
// cipher states for the freshly derived pair, so a long-lived session outlives the daemon's rekey
// interval. A failed or wrong-state rekey leaves the pre-rekey ciphers intact and the session usable.
// While that rekey is in flight the session ALSO reads one OUTER label — the inbound frame's
// InnerFrameV2 `type`, passed down by the driver (#532). It is consulted in exactly one state,
// `awaiting-rekey-reply`, to tell the daemon's handshake reply (`noise_resp`) apart from an app
// frame the daemon fanned out under the still-live old ciphers before our rekey msg1 landed — two
// frame kinds that are legitimately in flight at once, which the state machine alone cannot
// separate. It is used for ROUTING only: it selects a path, never a key, and the AEAD stays the sole
// authority on whether a frame opens. Every other state ignores it. See onFrame for the full model.
// The crypto is `noise-c.wasm` (a vetted Emscripten build of rweather/noise-c, the reference C
// implementation; no hand-rolled crypto), loaded once via the shared ./noiseLib loader.
//
// It MIRRORS relayConnection.ts's contract: raw Uint8Array frames go out through a `sendFrame`
// sink, inbound frames arrive via `onFrame`, and lifecycle/errors leave as typed events through
// `onEvent`. It runs in the main process only, never the renderer (transport-out-of-the-window).
//
// CONTENT-FREE logging by construction: no console.*, and NO key, token, or PLAINTEXT bytes in any
// diagnostic. A caught wasm-library error is CLASSIFIED into a static reason, and the error OBJECT is
// never forwarded or logged — a library error string can echo transcript bytes. The one exception is
// the raw failing frame at the three INBOUND-read catches: those bytes are pre-decryption (AEAD
// ciphertext / Noise handshake message 2 / rekey reply — never client plaintext or a secret), so
// they are logged content-free (capped hex) through the optional injected DiagnosticLog (#133). The
// OUTBOUND-write catches stay byte-free — message 1 carries the device token.
import { notifySend, type SendOutcome } from './sendObservation'
import { type NoiseCipherState } from 'noise-c.wasm'
import { NOISE_PROTOCOL } from '../../shared/wire/types'
import { encodeSafeBytes, type DiagnosticLog } from '../diagnosticLog'
import { decodeEnvelope } from './codec'
import { loadNoiseLib } from './noiseLib'

// Empty associated-data for every transport frame — the v2 suite's mandate (the daemon's
// CipherState has no AD parameter; see pyrycode #433 `internal/noise`). Shared, never mutated.
const EMPTY_AD = new Uint8Array(0)

/** Config for one Noise session. Keys are raw 32-byte X25519, injected; nothing is persisted. */
export interface NoiseSessionConfig {
  /** Client static X25519 private key (32B), injected. IK transmits the client static in msg 1. */
  staticPrivateKey: Uint8Array
  /** Daemon static X25519 public key (32B), injected. The IK initiator knows it up front (QR). */
  remoteStaticPublicKey: Uint8Array
  /** Handshake prologue; zero-length matches the daemon. Kept explicit and configurable. */
  prologue: Uint8Array
  /** Early-data for message 1 — an opaque hello body (the sibling ticket builds it). */
  hello: Uint8Array
  /** Outbound raw-frame sink (e.g. relay.send). Must not throw back into the session. */
  sendFrame: (frame: Uint8Array, observe?: (outcome: SendOutcome) => void) => void
  /** Typed event sink. Must not throw (mirrors relayConnection's onEvent discipline). */
  onEvent: (event: NoiseSessionEvent) => void
  /** Forwarded to loadNoiseLib as its load deadline; omit for the loader default. */
  loadTimeoutMs?: number
  /** Optional content-free diagnostic sink (#126/#133). When set, a pre-decryption inbound-read
   *  failure logs its static reason + the capped raw failing bytes (safe: pre-decryption ciphertext /
   *  handshake material). Absent → silent (optional-inject discipline; mirrors inboundMessage /
   *  relayConnection). Injected by the driver, which forwards its own constant logger. */
  diagnosticLog?: DiagnosticLog
}

/**
 * Cap on outbound plaintexts held while the session is parked in `awaiting-rekey-reply` (#533).
 *
 * WHY A BOUND EXISTS AT ALL: nothing on the client ever gives up on that state — a client-side rekey
 * deadline was deferred by #532 and is not filed — so the only backstop is the daemon's own 30s reply
 * timer closing at WS 4426. The window's worst-case lifetime is therefore a relay-controlled interval,
 * and every send inside it accumulates USER PLAINTEXT in main-process memory. This is a
 * memory-residency limit on secret material, not tidiness. It is also bounded in BYTES for free:
 * encodeEnvelope rejects anything over MAX_PLAINTEXT_BYTES upstream in daemonConnection, so the worst
 * case is a deterministic MAX_BUFFERED_SENDS x 65519 (~512 KiB), with no second cap needed here.
 *
 * DELIBERATE DIVERGENCE from MAX_PENDING_FRAMES (noiseRelayDriver.ts): that buffer drops silently,
 * because a pre-session frame from a hostile relay is already anomalous garbage. Here the dropped
 * item is the user's own message, so the drop is surfaced as `rekey-send-buffer-full`.
 */
export const MAX_BUFFERED_SENDS = 8

/** Closed set of static error reasons — never carries key/token/frame bytes. */
export type NoiseSessionErrorReason =
  | 'handshake-read-failed' // message 2 failed MAC / malformed / wrong-suite peer
  | 'transport-decrypt-failed' // a post-handshake frame failed to open
  | 'unexpected-frame' // a frame arrived in the wrong state
  // #533, both raised only for the rekey window. Each reaches daemonConnection's generic `case
  // 'error'` -> emitFailed -> failed{retryable:false}: a terminal, non-retryable connection failure
  // in the UI. ACCEPTED DELIBERATELY, including for the overflow case — do not
  // add a softer mapping downstream. Precedent: `transport-decrypt-failed` is explicitly
  // non-terminal here and still lands as failed{retryable:false} at the UI, so a recoverable
  // session-level anomaly already reads as a hard UI failure; a bespoke severity class would be an
  // architecture change, not an S bug fix. And an overflowing window is genuinely anomalous — a
  // healthy window is one relay round-trip, so 9 sends inside it means the connection is already
  // heading for the daemon's 4426 teardown.
  | 'rekey-send-buffer-full' // a send arrived with the window buffer already at MAX_BUFFERED_SENDS; that ONE send was dropped
  | 'rekey-send-abandoned' // the rekey failed; every buffered plaintext was discarded unsent

/** One event from the session. Sealed discriminated union on `type`. */
export type NoiseSessionEvent =
  | { type: 'handshake-complete'; helloAck: Uint8Array } // peer early-data recovered from msg 2
  | { type: 'message'; plaintext: Uint8Array } // decrypted post-handshake frame
  | { type: 'rekey-requested' } // daemon rekey_request control frame recognized; bare signal, #109 acts on it
  | { type: 'error'; reason: NoiseSessionErrorReason } // static reason only — never bytes

/** Handle for one Noise session. */
export interface NoiseSession {
  /** Write message 1 (carrying the hello) to sendFrame. Call exactly once; inert after close. */
  start(): void
  /** Feed one inbound frame: drive the message-2 read, then post-handshake transport decrypt.
   *  `innerType` is the frame's InnerFrameV2 `type` label when the caller has one (the production
   *  driver always does). It is consulted in EXACTLY ONE state, `awaiting-rekey-reply`, for routing
   *  only (#532); every other state ignores it outright. Omitted → unlabelled, which routes exactly
   *  as it did pre-#532. */
  onFrame(frame: Uint8Array, innerType?: string): void
  /** Post-handshake: AEAD-seal one plaintext to sendFrame. Inert before completion / after close. */
  sendMessage(plaintext: Uint8Array, observe?: (outcome: SendOutcome) => void): void
  /** Free the wasm handshake + cipher states. Idempotent; leaves every entry point inert. */
  close(): void
}

type SessionState =
  | 'idle'
  | 'awaiting-handshake-reply'
  | 'transport'
  | 'awaiting-rekey-reply' // #111: fresh IK handshake in flight; OLD ciphers held live until the swap
  | 'closed'

// The v2 control-envelope type the daemon seals to trigger an in-session re-key. Mirrors the
// daemon's `protocol.TypeRekeyRequest` (pyrycode #454); wire source: protocol-mobile.md § Re-key.
// Deliberately module-private and deliberately NOT a member of the shared `EnvelopeType` union:
// like the daemon's `TypeRekeyRequest` (kept out of its app-dispatch `v1TypeSet`), it is a control
// type, not an app-dispatch type — `parseInboundMessage` never switches on it.
const REKEY_REQUEST_TYPE = 'rekey_request'

// The InnerFrameV2 `type` the daemon puts on every one of its IK handshake replies — initial msg2,
// rekey msg2, reconnect msg2 (pyrycode internal/relay/v2session_handshake.go:241,
// v2session_rekey.go:146). Module-private for the same reason REKEY_REQUEST_TYPE is: one spelling,
// one place. It is unambiguously a daemon→client-only tag — the real daemon rejects an INBOUND
// `noise_resp` from a client as a state-machine violation (v2session.go:669-676) — which is what
// makes it usable as the reply marker in the one state that needs one (#532).
const NOISE_RESP_TYPE = 'noise_resp'

// True iff `plaintext` decodes as an Envelope whose type is the rekey trigger. TOTAL by
// construction: it reuses the vetted, fail-closed decodeEnvelope and swallows its WireDecodeError
// to `false`, so ANY decode/peek failure (malformed UTF-8/JSON, non-object, missing/mistyped
// field) yields `false` and the caller falls through to the unchanged message path — a peek
// failure is never a rejection. Reads only `.type`; the control payload (`{reason}`) is discarded,
// never interpreted. Structural only: carries no key/token/frame/plaintext bytes out.
function isRekeyRequest(plaintext: Uint8Array): boolean {
  try {
    return decodeEnvelope(plaintext).type === REKEY_REQUEST_TYPE
  } catch {
    return false
  }
}

/**
 * Construct and Initialize the session, returning the handle WITHOUT sending. Sending is a
 * separate start() — deliberately not on the factory: a synchronous peer would otherwise race the
 * async factory's wiring. Rejects with NoiseLoadError if the shared wasm load fails or times out
 * (AC4) — the only surface where no handle exists yet, so a rejection is the correct async shape.
 */
export async function createNoiseSession(config: NoiseSessionConfig): Promise<NoiseSession> {
  const lib = await loadNoiseLib({ timeoutMs: config.loadTimeoutMs })
  // `hs` is nulled the moment it is consumed or auto-freed by the library on a thrown error, so
  // no entry point ever calls into a freed wasm handshake object.
  let hs: ReturnType<typeof lib.HandshakeState> | null = lib.HandshakeState(
    NOISE_PROTOCOL,
    lib.constants.NOISE_ROLE_INITIATOR
  )
  // noise-c treats a zero-length prologue as "no prologue set"; both mix an empty prologue, so
  // this matches the daemon's empty-prologue handshake exactly.
  hs.Initialize(
    config.prologue.length > 0 ? config.prologue : null,
    config.staticPrivateKey,
    config.remoteStaticPublicKey,
    null
  )

  let sendCipher: NoiseCipherState | null = null
  let recvCipher: NoiseCipherState | null = null
  let state: SessionState = 'idle'
  // #533: outbound PLAINTEXT held while parked in `awaiting-rekey-reply`, flushed after the swap.
  // Holds session-OWNED copies (see sendMessage) and never a sealed frame (see the flush). Bounded by
  // MAX_BUFFERED_SENDS; emptied at all three exits from that state — the swap, the reply-read
  // failure, and close() — which is why nothing can outlive one window.
  const bufferedSends: Array<{ plaintext: Uint8Array; observe?: (outcome: SendOutcome) => void }> = []

  // Free every wasm object we still own. On a handshake read/write error the library already
  // freed `hs` (and we nulled it); on a transport decrypt error the cipher states survive. Each
  // free is guarded so teardown is idempotent and never throws.
  function freeAll(): void {
    for (const obj of [hs, sendCipher, recvCipher]) {
      try {
        obj?.free()
      } catch {
        /* already freed / teardown */
      }
    }
    hs = null
    sendCipher = null
    recvCipher = null
  }

  function fail(reason: NoiseSessionErrorReason): void {
    config.onEvent({ type: 'error', reason })
  }

  // Like fail(), but ALSO logs the raw failing inbound bytes content-free before surfacing the error.
  // Used ONLY at the three INBOUND-read catches, where `frame` is the pre-decryption bytes that failed
  // (AEAD ciphertext / handshake message 2 / rekey reply — safe to keep, Bucket 1). The outbound-write
  // catches stay on plain fail(): they hold no inbound frame, and message 1 carries the device token.
  // The bytes reach only config.diagnosticLog (the main-process sink), never config.onEvent.
  function failWithFrame(reason: NoiseSessionErrorReason, frame: Uint8Array): void {
    config.diagnosticLog?.event({
      event: 'noise-frame-failed',
      code: reason,
      bytes: frame.length,
      safeBytes: encodeSafeBytes(frame)
    })
    fail(reason)
  }

  function start(): void {
    if (state !== 'idle' || hs === null) return
    let msg1: Uint8Array
    try {
      msg1 = hs.WriteMessage(config.hello)
    } catch {
      // Practically unreachable for a well-formed hello; the library auto-freed hs on throw.
      hs = null
      state = 'closed'
      fail('unexpected-frame')
      return
    }
    state = 'awaiting-handshake-reply'
    config.sendFrame(msg1)
  }

  // #111: the daemon's rekey action. On a recognized `rekey_request` (transport-branch recognition),
  // run a FRESH in-session IK handshake as INITIATOR — the same injected static keys and
  // NOISE_PROTOCOL suite as the initial handshake, but EMPTY early-data (no hello is re-sent). This
  // parks the session in `awaiting-rekey-reply` holding the OLD ciphers live; the daemon's reply
  // drives the atomic swap in onFrame. The pinned remoteStaticPublicKey IS the client-side peer
  // continuity guarantee — a mid-session peer swap can't complete this handshake (→ read failure,
  // old ciphers intact); there is no phantom client-side static compare (the client supplies `rs`).
  function beginRekey(): void {
    // Belt (deterministic): only ever reached from the transport branch, so this is defensive.
    if (state !== 'transport' || sendCipher === null || recvCipher === null) return
    let fresh: ReturnType<typeof lib.HandshakeState>
    let msg1: Uint8Array
    try {
      fresh = lib.HandshakeState(NOISE_PROTOCOL, lib.constants.NOISE_ROLE_INITIATOR)
      // Byte-identical to the initial Initialize: same keys, same empty-prologue handling.
      fresh.Initialize(
        config.prologue.length > 0 ? config.prologue : null,
        config.staticPrivateKey,
        config.remoteStaticPublicKey,
        null
      )
      msg1 = fresh.WriteMessage(EMPTY_AD) // empty early-data — NOT config.hello (spec § Re-key)
    } catch {
      // Practically unreachable for a well-formed empty-early-data write; the library auto-freed the
      // fresh handshake on throw. The OLD ciphers are untouched — stay in `transport`, usable.
      fail('handshake-read-failed')
      return
    }
    // Ordering is load-bearing: set hs + state BEFORE sendFrame, because a synchronous re-entrant
    // sendFrame can drive the daemon's reply straight back into onFrame (mirrors start()).
    hs = fresh
    state = 'awaiting-rekey-reply'
    config.sendFrame(msg1)
  }

  function onFrame(frame: Uint8Array, innerType?: string): void {
    if (state === 'closed') return // inert after teardown — never touch freed wasm
    if (state === 'transport') {
      if (recvCipher === null) return
      let plaintext: Uint8Array
      try {
        plaintext = recvCipher.DecryptWithAd(EMPTY_AD, frame)
      } catch {
        failWithFrame('transport-decrypt-failed', frame) // cipher survives; non-terminal
        return
      }
      // Recognition (#108): a decrypted `rekey_request` control envelope is the daemon's in-session
      // rekey trigger — surface a bare signal and divert. Everything else (a well-formed app
      // message, an unmodeled control type, non-Envelope bytes, or a peek that throws) falls through
      // UNCHANGED, carrying the identical plaintext. Additive: parseInboundMessage stays the sole
      // app-message decode gate; recognition only diverts a positively-matched control frame.
      if (isRekeyRequest(plaintext)) {
        config.onEvent({ type: 'rekey-requested' }) // #108 observable signal, retained
        beginRekey() // #111 action: run the fresh IK handshake + arm the atomic swap
        return
      }
      config.onEvent({ type: 'message', plaintext })
      return
    }
    if (state === 'awaiting-rekey-reply') {
      // #532: the ONE state where the inner-frame label is consulted. The daemon does not stop the
      // world for a rekey — it keeps fanning out transport frames under the OLD CipherStates for the
      // whole awaiting-reply window, and only its handleRekeyInit swaps (pyrycode #450). So an app
      // frame emitted after `rekey_request` but before our `noise_init` landed is TCP-ordered AHEAD
      // of the reply. Two frame kinds are legitimately in flight at once and ONLY the label separates
      // them; the Noise state machine alone is provably insufficient here, which is why this state
      // (and only this state) reads it. The real daemon resolved the mirror-image problem the same
      // way (v2session.go:664-669), and fakeDaemon was corrected to match in #524.
      //
      // The test is POSITIVE on `noise_resp`, not negative on `noise_msg`: an unknown or hostile
      // label therefore takes the gentler window-transport branch below (non-terminal, reply slot
      // preserved) instead of burning the one-shot handshake read. An ABSENT label means the reply,
      // which is exactly the pre-#532 assumption, now written down — unreachable from production
      // (decodeInnerFrame rejects a non-string `type`, codec.ts), so it is a unit-test affordance.
      //
      // The label picks a PATH, never a key: both paths were already reachable, both objects
      // (`hs`, `recvCipher`) existed before the frame arrived, and the AEAD remains the sole
      // authority on whether a frame opens. A relabelling relay only changes WHICH of two
      // pre-existing rejections an already-doomed frame receives — never a downgrade, a transport
      // bypass, or a key/nonce reuse. Same argument as fakeDaemon.ts's, in the mirror direction.
      if (innerType !== undefined && innerType !== NOISE_RESP_TYPE) {
        if (recvCipher === null) return // defensive: beginRekey requires both ciphers and clears neither
        let plaintext: Uint8Array
        try {
          plaintext = recvCipher.DecryptWithAd(EMPTY_AD, frame)
        } catch {
          // Non-terminal and, crucially, NOT a reply: `hs` and `state` are untouched, so the one-shot
          // handshake read survives and a genuine reply arriving afterwards still completes the swap.
          failWithFrame('transport-decrypt-failed', frame)
          return
        }
        // Deliberately NO isRekeyRequest re-check here, unlike the `transport` branch. A
        // `rekey_request` interleaved into an already-open window is not representable — beginRekey's
        // own `state !== 'transport'` guard would no-op it — but emitting `rekey-requested` would
        // still arm the driver's rekeyInitPending latch, which would then mis-tag the NEXT outbound
        // app frame as `noise_init` after the swap; the daemon would route that app frame into its
        // reconnect handler and fail closed. A faithful daemon never sends one here (in its
        // awaiting-rekey-init substate it emits only msg2 and the resume frame); a hostile one gets
        // its frame surfaced as an ordinary unmodeled envelope to parseInboundMessage, which is benign.
        config.onEvent({ type: 'message', plaintext })
        return
      }
      if (hs === null) return // defensive: this state always holds the fresh handshake
      let pair: [NoiseCipherState, NoiseCipherState]
      try {
        hs.ReadMessage(frame, true) // daemon reply; discard early-data (no hello_ack on a rekey)
        pair = hs.Split() // consumes + frees hs; returns [send, recv] role-adjusted, no pair swap
      } catch {
        // Malformed / wrong-suite reply, or a mid-session peer swap the pinned static can't complete.
        // The library auto-freed hs and NO cipher was reassigned — both still hold the OLD keys.
        hs = null
        state = 'transport' // usable — NOT closed (the load-bearing difference from the initial handshake)
        // #533: discard the window buffer, unsent. Re-sending under the surviving old ciphers is not
        // an option — the client cannot tell "our noise_init never landed" (old keys still valid at
        // the daemon) from "the daemon swapped and its reply was corrupted" (an old-cipher send is
        // then the fatal 4421 case above); both present identically as this failed ReadMessage, so
        // the only safe branch assumes the worst.
        //
        // CLEAR BEFORE EITHER EMIT: fail()/failWithFrame() call a synchronous consumer that can
        // re-enter sendMessage, and `state` is already back to `transport` — a stale item left in the
        // buffer could otherwise be picked up by a LATER window's flush.
        const abandoned = bufferedSends.length > 0
        for (const item of bufferedSends.splice(0)) {
          notifySend(item.observe, { type: 'dropped', reason: 'rekey-abandoned' })
        }
        failWithFrame('handshake-read-failed', frame) // `frame` is the daemon's rekey reply (pre-decryption)
        if (abandoned) fail('rekey-send-abandoned') // once per discard — never a count, which would correlate with user activity
        return
      }
      // Atomic swap (AC2/AC4): install BOTH new ciphers before freeing either old one. ReadMessage
      // and Split are the only fallible ops and already ran; nothing between the two assignments can
      // throw or await, so the session is never left with one new cipher and one old.
      const prevSend = sendCipher
      const prevRecv = recvCipher
      sendCipher = pair[0]
      recvCipher = pair[1]
      for (const obj of [prevSend, prevRecv]) {
        try {
          obj?.free()
        } catch {
          /* already freed / teardown */
        }
      }
      hs = null
      state = 'transport'
      flushBufferedSends() // #533: strictly after both assignments + the state restore — seals under the NEW cipher
      return // swap complete; emit no event — the implicit ack is the resumed round-trip (no rekey_ack)
    }
    if (state === 'idle' || hs === null) {
      fail('unexpected-frame') // a frame before start()
      return
    }
    // awaiting-handshake-reply: read message 2 (recovers hello_ack), then split into transport.
    let helloAck: Uint8Array
    try {
      helloAck = hs.ReadMessage(frame, true) ?? EMPTY_AD
      const [send, recv] = hs.Split() // consumes + frees hs; returns [send, recv] role-adjusted
      sendCipher = send
      recvCipher = recv
    } catch {
      hs = null // library auto-freed the handshake state on the throw
      state = 'closed'
      failWithFrame('handshake-read-failed', frame) // `frame` is the daemon's handshake message 2 (pre-decryption)
      return
    }
    hs = null
    state = 'transport'
    config.onEvent({ type: 'handshake-complete', helloAck })
  }

  function sendMessage(plaintext: Uint8Array, observe?: (outcome: SendOutcome) => void): void {
    // #533: the rekey window. Sealing here would be FATAL, not merely lossy — the client enters this
    // state only AFTER handing its own noise_init to sendFrame, so this send is TCP-ordered BEHIND
    // that frame, and the daemon swaps BOTH ciphers the moment it processes it. An old-cipher frame
    // landing afterwards fails the daemon's new recv and takes its tampered-frame branch: WS 4421 and
    // session removal. So hold it and re-seal after the swap.
    //
    // Hold the PLAINTEXT, never a sealed frame: a CipherState is a per-direction nonce counter, so
    // sealing now would burn nonce n under a cipher that is about to be freed and leave a gap the
    // daemon's receive side cannot tolerate (the mirror of the hold-back hazard documented in
    // noiseSession.test.ts's capture-and-replay test). Buffering plaintext keeps the send-nonce
    // stream contiguous by construction — nothing is sealed until it is actually sent.
    if (state === 'awaiting-rekey-reply') {
      if (bufferedSends.length >= MAX_BUFFERED_SENDS) {
        // Drop the INCOMING send, never evict the oldest: eviction would silently break issue
        // ordering and discard the message the user considers longest-sent, and this keeps the error
        // in 1:1 correspondence with the sendMessage call that failed.
        notifySend(observe, { type: 'dropped', reason: 'rekey-buffer-full' })
        fail('rekey-send-buffer-full')
        return
      }
      // Copy, don't retain the caller's reference. `sendMessage` consumes its argument synchronously
      // today, so a caller may legally hand over a scratch buffer it intends to reuse; retaining it
      // across a relay round-trip would turn that legal caller into a corruption bug with no
      // compile-time signal. The copy is also what makes "the buffer holds no plaintext" a statement
      // about memory this session owns.
      bufferedSends.push({ plaintext: plaintext.slice(), observe })
      return
    }
    if (state !== 'transport' || sendCipher === null) {
      notifySend(observe, { type: 'dropped', reason: 'send-refused' })
      return
    }
    try {
      config.sendFrame(sendCipher.EncryptWithAd(EMPTY_AD, plaintext), observe)
    } catch (error) {
      notifySend(observe, { type: 'dropped', reason: 'send-failed' })
      throw error // Preserve existing caller-owned failure handling.
    }
  }

  // #533: drain the window buffer. Called ONLY at the end of the atomic swap — after both cipher
  // assignments and after `state = 'transport'` — so every held plaintext seals under the NEW send
  // cipher, in issue order.
  //
  // TAKE, then drain: `config.sendFrame` is a synchronous sink that can drive a reply straight back
  // into onFrame (the same re-entrancy hazard beginRekey's ordering comment documents), so iterating
  // the live array while a re-entrant call mutates it is the bug this avoids. splice(0) also makes a
  // double-drain unrepresentable, so no plaintext can be sealed twice.
  //
  // Drain through `sendMessage`, not a private seal loop. This is security-load-bearing: the entry
  // point re-reads the LIVE `sendCipher` on every iteration. A loop capturing a cipher reference
  // could seal under `prevSend`, which the swap free()s — a use-after-free on a wasm object, and a
  // frame the daemon can only reject. And if a re-entrant frame opens a SECOND rekey mid-flush, going
  // back through the entry point re-buffers the remaining items and flushes them after that swap,
  // still in issue order; a captured-cipher loop would seal them under a cipher no longer current.
  function flushBufferedSends(): void {
    const pending = bufferedSends.splice(0)
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i]
      try {
        sendMessage(item.plaintext, item.observe)
      } catch (error) {
        for (const remaining of pending.slice(i + 1)) {
          notifySend(remaining.observe, { type: 'dropped', reason: 'rekey-abandoned' })
        }
        throw error
      }
    }
  }

  function close(): void {
    if (state === 'closed') return
    state = 'closed'
    for (const item of bufferedSends.splice(0)) {
      notifySend(item.observe, { type: 'dropped', reason: 'rekey-teardown' })
    }
    freeAll()
  }

  return { start, onFrame, sendMessage, close }
}
