// The secret-at-rest primitive for the Electron background process: a generic, key-domain-blind
// key–value store over named opaque byte blobs. Every long-lived secret the desktop client holds
// — the device static private key (#43), the paired-server record (#44), later pairing state —
// is built on this one auditable surface. It has no notion of "device key" or "server record":
// consumers serialize their own structures to bytes and store them by a string name.
//
// It lives entirely in src/main — keys and raw bytes never reach the renderer, the preload
// bridge, or IPC (CLAUDE.md "Keep the transport out of the window"; ADR 0002). The two effectful
// edges — encryption (OS keychain) and persistence (filesystem) — are INJECTED interfaces, so the
// core is a pure, keychain-free, filesystem-free orchestration that unit-tests with fakes (the
// relayConnection `onEvent` precedent). The real adapters ship in their own files:
// electronSecretEncryption.ts and fileSecretPersistence.ts.
//
// It is LOG-FREE by construction. No secret value — plaintext or ciphertext — may reach stdout, a
// log file, or a crash reporter, so there is no console.* anywhere in this module. Secrets are
// opaque Uint8Array locals, never named fields of a logged struct.

/**
 * Injected encryption seam — byte-in / byte-out, availability-gated. The core never sees the
 * keychain; a fake in tests is a trivial reversible transform.
 */
export interface SecretEncryption {
  /**
   * True only when secrets can be encrypted with real OS-keychain protection. When false, the
   * store fails loudly — it MUST NOT fall back to plaintext. See electronSecretEncryption.
   */
  isAvailable(): boolean
  /** Encrypt plaintext into opaque ciphertext. */
  encrypt(plaintext: Uint8Array): Uint8Array
  /** Decrypt ciphertext back to the original plaintext; throws on tamper / key rotation. */
  decrypt(ciphertext: Uint8Array): Uint8Array
}

/**
 * Injected persistence seam — a named opaque-blob store. No crypto, no name interpretation beyond
 * safe storage-key mapping. A fake in tests is a Map<string, Uint8Array>.
 */
export interface SecretPersistence {
  /** The stored bytes, or null when the name is absent. */
  read(name: string): Promise<Uint8Array | null>
  /** Persist bytes under name, replacing any prior value. */
  write(name: string, bytes: Uint8Array): Promise<void>
  /** Remove the named blob; a no-op when the name is absent. */
  delete(name: string): Promise<void>
}

/** The secure key–value store. String name → opaque bytes; no key-domain semantics. */
export interface SecureStore {
  /**
   * Encrypt value and persist the ciphertext. Rejects with EncryptionUnavailableError — WITHOUT
   * touching persistence — when encryption is unavailable, so plaintext never hits disk.
   */
  set(name: string, value: Uint8Array): Promise<void>
  /**
   * Decrypt and return the stored bytes, or null when the name is absent. A decrypt failure
   * (tamper, keychain rotation) propagates as a throw — it is NOT masked as absence.
   */
  get(name: string): Promise<Uint8Array | null>
  /** Remove the named secret; idempotent (an absent name is a no-op). */
  delete(name: string): Promise<void>
}

/**
 * Thrown by SecureStore.set when SecretEncryption.isAvailable() is false. The message is static —
 * it carries no secret, no name, and no value.
 */
export class EncryptionUnavailableError extends Error {
  constructor(message = 'secret encryption is not available') {
    super(message)
    this.name = 'EncryptionUnavailableError'
  }
}

/**
 * Build a SecureStore over the two injected effectful edges. The core is three tiny
 * orchestrations — no crypto, no fs, no encoding of its own.
 */
export function createSecureStore(deps: {
  encryption: SecretEncryption
  persistence: SecretPersistence
}): SecureStore {
  const { encryption, persistence } = deps
  return {
    async set(name, value) {
      // Fail-closed FIRST: check availability before any persistence call, so plaintext is never
      // written on the unavailable path (AC2).
      if (!encryption.isAvailable()) throw new EncryptionUnavailableError()
      await persistence.write(name, encryption.encrypt(value))
    },
    async get(name) {
      const ciphertext = await persistence.read(name)
      // Absent → null; present-but-undecryptable → let decrypt's throw propagate. Masking a
      // corrupt/tampered blob as absence would be a silent-downgrade risk.
      return ciphertext === null ? null : encryption.decrypt(ciphertext)
    },
    async delete(name) {
      await persistence.delete(name)
    }
  }
}
