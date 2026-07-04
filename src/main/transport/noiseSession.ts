// The production Noise session for the Electron MAIN process: a PURE CRYPTO UNIT that performs the
// `Noise_IK_25519_ChaChaPoly_BLAKE2s` handshake (the injected `hello` rides as early-data on IK
// message 1; `hello_ack` is recovered from message 2), then encrypts/decrypts transport frames so
// the relay socket (a sibling wiring ticket) can carry a confidential, authenticated channel to
// the daemon. The suite is load-bearing — a mismatch fails the handshake silently (ADR 0002) — so
// NOISE_PROTOCOL is reused verbatim, never retyped.
//
// Keys are INJECTED as config (raw 32-byte X25519 static private + remote static public); this
// module sources no key from storage and constructs no envelope — both are separate concerns.
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

type SessionState = 'idle' | 'awaiting-handshake-reply' | 'transport' | 'closed'

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
      config.onEvent({ type: 'message', plaintext })
      return
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
