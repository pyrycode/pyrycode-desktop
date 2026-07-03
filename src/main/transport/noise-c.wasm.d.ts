// Ambient declaration for `noise-c.wasm` (an Emscripten/WASM build of rweather/noise-c).
// The package ships no types, so this declares ONLY the surface the #29 Noise spike uses:
// the async init function, the handshake/cipher state machines, keypair generation, and the
// handful of constants the harness references by name. Confirmed against the installed
// 0.4.0 wrapper (node_modules/noise-c.wasm/src/index.js). Method names mirror the Noise
// spec's object model (HandshakeState / CipherState).
declare module 'noise-c.wasm' {
  /** One half of the post-handshake transport pair returned by HandshakeState.Split(). */
  export interface NoiseCipherState {
    /** AEAD-seal `plaintext` with associated data `ad` (empty Uint8Array for the v2 suite). */
    EncryptWithAd(ad: Uint8Array, plaintext: Uint8Array): Uint8Array
    /** AEAD-open `ciphertext`; throws on MAC failure (the wasm object survives the throw). */
    DecryptWithAd(ad: Uint8Array, ciphertext: Uint8Array): Uint8Array
    /** Free the underlying wasm cipher state. */
    free(): void
  }

  /** The Noise handshake state machine for one role. */
  export interface NoiseHandshakeState {
    /**
     * Set prologue + keys and start the handshake. Any argument may be `null`. The library
     * derives the local static public key from the private `s`. On error the wasm object is
     * freed automatically before the throw.
     */
    Initialize(
      prologue: Uint8Array | null,
      s: Uint8Array | null,
      rs: Uint8Array | null,
      psk: Uint8Array | null
    ): void
    /** Current action: one of the NOISE_ACTION_* constants. */
    GetAction(): number
    /** Produce the next handshake message, carrying `payload` as early-data. Frees on error. */
    WriteMessage(payload?: Uint8Array | null): Uint8Array
    /**
     * Consume one inbound handshake message. With `payloadNeeded` true the peer's early-data
     * is returned; otherwise `null`. On error the wasm object is freed automatically (unless
     * `fallbackSupported`) before the throw.
     */
    ReadMessage(
      message: Uint8Array,
      payloadNeeded?: boolean,
      fallbackSupported?: boolean
    ): Uint8Array | null
    /** The channel-binding hash once the handshake is complete (32 bytes for BLAKE2s). */
    GetHandshakeHash(): Uint8Array
    /**
     * Split into the post-handshake transport ciphers. noise-c returns them already
     * role-adjusted as `[send, recv]` for BOTH roles, and frees this handshake state.
     */
    Split(): [NoiseCipherState, NoiseCipherState]
    /** Free the underlying wasm handshake state. */
    free(): void
  }

  /** The subset of noise-c constants the spike references by name. */
  export interface NoiseConstants {
    NOISE_ROLE_INITIATOR: number
    NOISE_ROLE_RESPONDER: number
    NOISE_DH_CURVE25519: number
    NOISE_DH_CURVE448: number
    NOISE_ACTION_WRITE_MESSAGE: number
    NOISE_ACTION_READ_MESSAGE: number
    NOISE_ACTION_SPLIT: number
    NOISE_ACTION_FAILED: number
    readonly [name: string]: number
  }

  /** The library instance handed to the init callback once the wasm is ready. */
  export interface NoiseLib {
    constants: NoiseConstants
    /** Construct a handshake state for `protocolName` in `role` (callable without `new`). */
    HandshakeState(protocolName: string, role: number): NoiseHandshakeState
    /** Generate a fresh keypair for `curveId`, returned as `[privateKey, publicKey]`. */
    CreateKeyPair(curveId: number): [Uint8Array, Uint8Array]
  }

  /** Async init: `createNoise(cb)` or `createNoise(options, cb)`; `cb(lib)` fires when ready. */
  interface CreateNoise {
    (callback: (lib: NoiseLib) => void): void
    (options: Record<string, unknown>, callback: (lib: NoiseLib) => void): void
  }

  const createNoise: CreateNoise
  export default createNoise
}
