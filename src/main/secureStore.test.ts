import { describe, it, expect } from 'vitest'
import {
  createSecureStore,
  EncryptionUnavailableError,
  type SecretEncryption,
  type SecretPersistence
} from './secureStore'

// Both effectful edges are faked in-file — no keychain, no filesystem (the ticket's Technical
// Notes; the relayConnection `onEvent` precedent). Mirrors the describe/it/expect + in-file-fake
// idiom of relayConnection.test.ts.

const MARKER = 0xc7
const XOR = 0x5a

// A reversible SecretEncryption: prefix a marker byte, then XOR every payload byte. Ciphertext
// is always one byte longer than plaintext AND byte-different (even for an empty input), so a
// round-trip is observable and "stored value !== plaintext" is provable. `decrypt` throws when
// the marker is missing, standing in for authenticated-decryption failure on a foreign blob.
function fakeEncryption(opts: { available?: boolean } = {}): SecretEncryption & {
  encryptCount(): number
} {
  let encryptCount = 0
  return {
    isAvailable: () => opts.available ?? true,
    encrypt(plaintext) {
      encryptCount += 1
      const out = new Uint8Array(plaintext.length + 1)
      out[0] = MARKER
      for (let i = 0; i < plaintext.length; i += 1) out[i + 1] = plaintext[i] ^ XOR
      return out
    },
    decrypt(ciphertext) {
      if (ciphertext.length < 1 || ciphertext[0] !== MARKER) {
        throw new Error('fake decrypt: not a ciphertext this key produced')
      }
      const out = new Uint8Array(ciphertext.length - 1)
      for (let i = 1; i < ciphertext.length; i += 1) out[i - 1] = ciphertext[i] ^ XOR
      return out
    },
    encryptCount: () => encryptCount
  }
}

// A Map-backed SecretPersistence that records writes, so tests can assert both "never written on
// the unavailable path" and "the stored bytes are ciphertext, not plaintext".
function fakePersistence(): {
  persistence: SecretPersistence
  writes: Array<{ name: string; bytes: Uint8Array }>
  store: Map<string, Uint8Array>
} {
  const store = new Map<string, Uint8Array>()
  const writes: Array<{ name: string; bytes: Uint8Array }> = []
  return {
    store,
    writes,
    persistence: {
      async read(name) {
        return store.get(name) ?? null
      },
      async write(name, bytes) {
        writes.push({ name, bytes })
        store.set(name, bytes)
      },
      async delete(name) {
        store.delete(name)
      }
    }
  }
}

describe('createSecureStore', () => {
  it('round-trips a secret and stores ciphertext, never the plaintext (AC3, AC2)', async () => {
    const encryption = fakeEncryption()
    const { persistence, writes } = fakePersistence()
    const store = createSecureStore({ encryption, persistence })

    const secret = new Uint8Array([1, 2, 3, 4, 5])
    await store.set('device-key', secret)

    // What landed in persistence is the ciphertext (encrypt ran before write), not the plaintext.
    expect(writes).toHaveLength(1)
    expect(encryption.encryptCount()).toBe(1)
    expect(Array.from(writes[0].bytes)).not.toEqual(Array.from(secret))
    expect(writes[0].bytes[0]).toBe(MARKER)

    const round = await store.get('device-key')
    expect(round).not.toBeNull()
    expect(Array.from(round ?? [])).toEqual(Array.from(secret))
  })

  it('resolves null for an absent name rather than throwing (AC3)', async () => {
    const { persistence } = fakePersistence()
    const store = createSecureStore({ encryption: fakeEncryption(), persistence })

    await expect(store.get('never-set')).resolves.toBeNull()
  })

  it('deletes a secret and treats an absent-name delete as a no-op (AC3)', async () => {
    const { persistence } = fakePersistence()
    const store = createSecureStore({ encryption: fakeEncryption(), persistence })

    await store.set('token', new Uint8Array([9, 9, 9]))
    await store.delete('token')
    await expect(store.get('token')).resolves.toBeNull()

    await expect(store.delete('was-never-there')).resolves.toBeUndefined()
  })

  it('fails loudly and writes nothing when encryption is unavailable (AC2)', async () => {
    const encryption = fakeEncryption({ available: false })
    const { persistence, writes } = fakePersistence()
    const store = createSecureStore({ encryption, persistence })

    await expect(store.set('token', new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(
      EncryptionUnavailableError
    )
    // Plaintext never hit persistence — the availability check gates before any write.
    expect(writes).toHaveLength(0)
    expect(encryption.encryptCount()).toBe(0)
  })

  it('propagates a decrypt failure instead of masking corruption as absence', async () => {
    const encryption = fakeEncryption()
    const { persistence, store: backing } = fakePersistence()
    // A blob the fake key cannot decrypt (no marker byte) — tamper / keychain-rotation stand-in.
    backing.set('corrupt', new Uint8Array([0x00, 0x01, 0x02]))
    const store = createSecureStore({ encryption, persistence })

    await expect(store.get('corrupt')).rejects.toThrow()
  })

  it('round-trips arbitrary and empty byte blobs without encoding assumptions', async () => {
    const encryption = fakeEncryption()
    const { persistence } = fakePersistence()
    const store = createSecureStore({ encryption, persistence })

    const tricky = new Uint8Array([0x00, 0x80, 0xff, 0x7f, 0x01])
    await store.set('tricky', tricky)
    expect(Array.from((await store.get('tricky')) ?? [])).toEqual(Array.from(tricky))

    const empty = new Uint8Array(0)
    await store.set('empty', empty)
    const roundEmpty = await store.get('empty')
    expect(roundEmpty).not.toBeNull()
    expect(roundEmpty?.length).toBe(0)
  })
})
