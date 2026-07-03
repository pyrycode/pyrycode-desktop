// The real SecretEncryption over Electron safeStorage, which encrypts with a key held in the OS
// keychain (Keychain on macOS, DPAPI on Windows, libsecret/kwallet on Linux). This is the only
// module that imports `electron`. It is thin, type-checked glue — verified by `npm run build` and
// manual/integration, NOT unit-tested (it needs the Electron runtime and a real keychain, the same
// reason the store injects fakes in tests).
import { safeStorage } from 'electron'
import type { SecretEncryption } from './secureStore'

/**
 * A SecretEncryption backed by Electron safeStorage. Bridges the byte-level seam to safeStorage's
 * string API via base64.
 *
 * Why base64 and not latin1/binary: safeStorage.encryptString encodes its argument as UTF-8 and
 * decryptString returns a UTF-8 string. base64's alphabet is pure ASCII (< 0x80), so it survives
 * the UTF-8 round-trip byte-for-byte. A latin1 string would re-encode any byte >= 0x80 as a 2-byte
 * UTF-8 sequence and corrupt on the way back. The ~33% size inflation is negligible and correct.
 */
export function electronSecretEncryption(): SecretEncryption {
  return {
    isAvailable() {
      if (!safeStorage.isEncryptionAvailable()) return false
      // Linux gotcha: with no keyring, safeStorage can fall back to a `basic_text` backend where
      // isEncryptionAvailable() returns true but "encryption" is obfuscation with a hardcoded key
      // — not real protection. Treat it as unavailable so the store stays fail-closed rather than
      // silently storing weakly-obfuscated secrets. getSelectedStorageBackend is Linux-only, so
      // guard the call behind the platform check.
      if (
        process.platform === 'linux' &&
        safeStorage.getSelectedStorageBackend() === 'basic_text'
      ) {
        return false
      }
      return true
    },
    encrypt(plaintext) {
      return safeStorage.encryptString(Buffer.from(plaintext).toString('base64'))
    },
    decrypt(ciphertext) {
      const base64 = safeStorage.decryptString(Buffer.from(ciphertext))
      return new Uint8Array(Buffer.from(base64, 'base64'))
    }
  }
}
