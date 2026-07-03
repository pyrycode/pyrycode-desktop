// #29 Noise spike (1/2): a THROWAWAY IK-initiator harness proving a chosen JS Noise library
// drives `Noise_IK_25519_ChaChaPoly_BLAKE2s` with early-data. This is not the production Noise
// session module (#7); #30 is the first consumer, and it swaps the JS<->JS loopback for the
// real relay transport with NO change to this initiator.
//
// Selected library: `noise-c.wasm` — an Emscripten/WASM build of rweather/noise-c, the
// reference C implementation. It implements BLAKE2s specifically (the load-bearing constraint;
// most pure-JS Noise libraries ship BLAKE2b and would fail the suite silently), the suite is
// chosen by the exact protocol-name string, and the cryptography is vetted (no hand-rolling).
// It runs in the Electron MAIN process (Node/WASM), never the renderer — the transport-out-of-
// the-window rule. See the PR findings note (folded into docs/knowledge/codebase/29.md).
//
// This module MIRRORS relayConnection.ts's contract: raw Uint8Array frames go out through a
// `sendFrame` sink, inbound frames arrive via `onFrame`, lifecycle/errors leave as typed
// events through `onEvent`. In #30 the mapping is trivial: relay {type:'connected'} -> start(),
// relay {type:'message',frame} -> onFrame(frame), harness sendFrame = relay.send.
//
// LOG-FREE by construction (copied from relayConnection.ts): no console.*, and NO key, token,
// or frame/plaintext bytes in any diagnostic. A caught wasm-library error is CLASSIFIED into a
// static reason, never forwarded or logged — a library error string can echo transcript bytes.
import createNoise, { type NoiseCipherState, type NoiseLib } from 'noise-c.wasm'
import { NOISE_PROTOCOL } from '../../shared/wire/types'

// Empty associated-data for every transport frame — the v2 suite's mandate (the daemon's
// CipherState has no AD parameter; see pyrycode #433 `internal/noise`). Shared, never mutated.
const EMPTY_AD = new Uint8Array(0)

/** Config for one throwaway IK initiator. Keys are raw 32-byte X25519; nothing is persisted. */
export interface NoiseInitiatorConfig {
  /** Client static X25519 private key (32B). IK transmits the client static inside message 1. */
  staticPrivateKey: Uint8Array
  /** Daemon static X25519 public key (32B). The IK initiator knows it up front (QR in prod). */
  remoteStaticPublicKey: Uint8Array
  /** Handshake prologue; zero-length matches the daemon. Kept explicit and configurable. */
  prologue: Uint8Array
  /** Early-data for message 1 — a hello-shaped body carrying the device token. */
  hello: Uint8Array
  /** Outbound raw-frame sink. In #30 this is relay.send. Must not throw back into the harness. */
  sendFrame: (frame: Uint8Array) => void
  /** Typed event sink. Must not throw (mirrors relayConnection's onEvent discipline). */
  onEvent: (event: NoiseInitiatorEvent) => void
}

/** Closed set of static error reasons — never carries key/token/frame bytes. */
export type NoiseInitiatorErrorReason =
  | 'handshake-read-failed' // message 2 failed MAC / malformed / wrong-suite peer
  | 'transport-decrypt-failed' // a post-handshake frame failed to open
  | 'unexpected-frame' // a frame arrived in the wrong state

/** One event from the initiator. Sealed discriminated union on `type`. */
export type NoiseInitiatorEvent =
  | { type: 'handshake-complete'; helloAck: Uint8Array } // peer early-data recovered from msg 2
  | { type: 'message'; plaintext: Uint8Array } // decrypted post-handshake frame
  | { type: 'error'; reason: NoiseInitiatorErrorReason } // static reason only — never bytes

/** Handle for one throwaway IK initiator. */
export interface NoiseInitiator {
  /** Write message 1 (carrying the hello) to sendFrame. Call exactly once; inert after close. */
  start(): void
  /** Feed one inbound frame: drive the message-2 read, then post-handshake transport decrypt. */
  onFrame(frame: Uint8Array): void
  /** Post-handshake: AEAD-seal one plaintext to sendFrame. Inert before completion / after close. */
  sendMessage(plaintext: Uint8Array): void
  /** Free the wasm handshake + cipher states. Idempotent; leaves every entry point inert. */
  close(): void
}

// A single memoized wasm instance at module scope: the initiator and (in the test) the responder
// share one instance, closer to #7's single-instance model and avoiding a double wasm init. The
// shared lib is process-lived; close() frees per-handshake / per-cipher-state objects, not this.
let libPromise: Promise<NoiseLib> | null = null

/** Load (once) and memoize the noise-c wasm library. Rejects if the wasm cannot initialize. */
export function loadNoiseLib(): Promise<NoiseLib> {
  if (libPromise === null) {
    libPromise = new Promise<NoiseLib>((resolve, reject) => {
      try {
        createNoise((lib) => resolve(lib))
      } catch (err) {
        reject(err instanceof Error ? err : new Error('noise-c.wasm failed to load'))
      }
    })
  }
  return libPromise
}

type InitiatorState = 'idle' | 'awaiting-handshake-reply' | 'transport' | 'closed'

/**
 * Construct and Initialize an IK initiator, returning the handle WITHOUT sending. Sending is a
 * separate start() — deliberately not on the factory: the JS<->JS loopback in #30's drop-in is
 * synchronous, so a send inside the async factory would race the peer's wiring.
 */
export async function createNoiseInitiator(config: NoiseInitiatorConfig): Promise<NoiseInitiator> {
  const lib = await loadNoiseLib()
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
  let state: InitiatorState = 'idle'

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

  function fail(reason: NoiseInitiatorErrorReason): void {
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
