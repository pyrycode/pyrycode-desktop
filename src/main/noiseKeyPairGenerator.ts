// The real KeyPairGenerator over noise-c.wasm's CreateKeyPair — the X25519 keygen edge for the
// device static identity (#43). This is the only module here that loads the wasm; it is thin,
// type-checked glue verified by `npm run build` and by the transport ticket's integration path,
// NOT unit-tested (it needs the wasm — the same reason deviceKeypair injects a fake in tests, and
// the precedent electronSecretEncryption.ts sets for an effectful edge).
//
// It calls the SAME library and curve (NOISE_DH_CURVE25519) the Noise_IK handshake will use, so
// the generated key format is handshake-compatible by construction (#29). CreateKeyPair draws from
// crypto.getRandomValues (a CSPRNG); the private key is never logged.
import createNoise, { type NoiseLib } from 'noise-c.wasm'
import type { DeviceKeyPair, KeyPairGenerator } from './deviceKeypair'

// A single memoized wasm instance at module scope — the process-lived library, initialized once.
// This rolls its own loader rather than importing loadNoiseLib from the throwaway spike
// (noiseSpike.ts, slated for deletion by #7); format compatibility comes from calling the same
// package, not from sharing the loader. #7 consolidates wasm loading and this folds into it.
let libPromise: Promise<NoiseLib> | null = null

function loadNoiseLib(): Promise<NoiseLib> {
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

export function noiseKeyPairGenerator(): KeyPairGenerator {
  return {
    async generate(): Promise<DeviceKeyPair> {
      const lib = await loadNoiseLib()
      const [privateKey, publicKey] = lib.CreateKeyPair(lib.constants.NOISE_DH_CURVE25519)
      return { privateKey, publicKey }
    }
  }
}
