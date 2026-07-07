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
// The crypto is `noise-c.wasm` (a vetted Emscripten build of rweather/noise-c, the reference C
// implementation; no hand-rolled crypto), loaded once via the shared ./noiseLib loader.
//
// It MIRRORS relayConnection.ts's contract: raw Uint8Array frames go out through a `sendFrame`
// sink, inbound frames arrive via `onFrame`, and lifecycle/errors leave as typed events through
// `onEvent`. It runs in the main process only, never the renderer (transport-out-of-the-window).
//
// LOG-FREE by construction: no console.*, and NO key, token, or frame/plaintext bytes in any
// diagnostic. A caught wasm-library error is CLASSIFIED into a static reason, never forwarded or
// logged — a library error string can echo transcript bytes.
import { type NoiseCipherState } from 'noise-c.wasm'
import { NOISE_PROTOCOL } from '../../shared/wire/types'
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
  sendFrame: (frame: Uint8Array) => void
  /** Typed event sink. Must not throw (mirrors relayConnection's onEvent discipline). */
  onEvent: (event: NoiseSessionEvent) => void
  /** Forwarded to loadNoiseLib as its load deadline; omit for the loader default. */
  loadTimeoutMs?: number
}

/** Closed set of static error reasons — never carries key/token/frame bytes. */
export type NoiseSessionErrorReason =
  | 'handshake-read-failed' // message 2 failed MAC / malformed / wrong-suite peer
  | 'transport-decrypt-failed' // a post-handshake frame failed to open
  | 'unexpected-frame' // a frame arrived in the wrong state

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
  /** Feed one inbound frame: drive the message-2 read, then post-handshake transport decrypt. */
  onFrame(frame: Uint8Array): void
  /** Post-handshake: AEAD-seal one plaintext to sendFrame. Inert before completion / after close. */
  sendMessage(plaintext: Uint8Array): void
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

  function onFrame(frame: Uint8Array): void {
    if (state === 'closed') return // inert after teardown — never touch freed wasm
    if (state === 'transport') {
      if (recvCipher === null) return
      let plaintext: Uint8Array
      try {
        plaintext = recvCipher.DecryptWithAd(EMPTY_AD, frame)
      } catch {
        fail('transport-decrypt-failed') // cipher survives; non-terminal
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
        fail('handshake-read-failed')
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
      fail('handshake-read-failed')
      return
    }
    hs = null
    state = 'transport'
    config.onEvent({ type: 'handshake-complete', helloAck })
  }

  function sendMessage(plaintext: Uint8Array): void {
    if (state !== 'transport' || sendCipher === null) return // inert before completion / after close
    config.sendFrame(sendCipher.EncryptWithAd(EMPTY_AD, plaintext))
  }

  function close(): void {
    if (state === 'closed') return
    state = 'closed'
    freeAll()
  }

  return { start, onFrame, sendMessage, close }
}
