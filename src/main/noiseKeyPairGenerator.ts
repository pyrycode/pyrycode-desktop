// The real KeyPairGenerator over noise-c.wasm's CreateKeyPair — the X25519 keygen edge for the
// device static identity (#43). Thin, type-checked glue verified by `npm run build` and by the
// transport ticket's integration path, NOT unit-tested (it needs the wasm — the same reason
// deviceKeypair injects a fake in tests, and the precedent electronSecretEncryption.ts sets for
// an effectful edge).
//
// It calls the SAME library and curve (NOISE_DH_CURVE25519) the Noise_IK handshake will use, so
// the generated key format is handshake-compatible by construction (#29). CreateKeyPair draws from
// crypto.getRandomValues (a CSPRNG); the private key is never logged.
//
// The wasm is loaded through the shared, hardened loader in transport/noiseLib — the ONE
// process-lived instance the Noise session also uses (#7 consolidated the two duplicate loaders
// into it). A load failure now surfaces as a NoiseLoadError rejection instead of hanging; the
// createDeviceKeypairStore memo already clears on a rejecting generate(), so a retry can proceed.
import { loadNoiseLib } from './transport/noiseLib'
import type { DeviceKeyPair, KeyPairGenerator } from './deviceKeypair'

export function noiseKeyPairGenerator(): KeyPairGenerator {
  return {
    async generate(): Promise<DeviceKeyPair> {
      const lib = await loadNoiseLib()
      const [privateKey, publicKey] = lib.CreateKeyPair(lib.constants.NOISE_DH_CURVE25519)
      return { privateKey, publicKey }
    }
  }
}
