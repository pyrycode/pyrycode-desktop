import { describe, it, expect } from 'vitest'
import {
  createSecureStore,
  type SecretEncryption,
  type SecretPersistence
} from './secureStore'
import { selectSecretEncryption, TEST_SECRET_BACKEND_ENV_FLAG } from './secretBackend'

// The dev affordance is exercised through its real entry point — selectSecretEncryption — never
// by importing the module-private keychainFreeSecretEncryption. The injected `real` factory is a
// trivial in-file fake (mirroring the relayPolicy.test.ts / secureStore.test.ts fake idiom): a
// sentinel backend whose isAvailable() is false (a stand-in for the keychain-less real backend)
// plus a call-count, so a test can prove both identity (selection returned the real one) and that
// the real factory was NOT invoked on the dev path. Because secretBackend.ts imports no `electron`,
// this whole file runs in plain Node.

function fakeReal(): {
  real: () => SecretEncryption
  sentinel: SecretEncryption
  callCount: () => number
} {
  let callCount = 0
  // A single stable sentinel so identity (`=== sentinel`) is observable, and exposed separately so an
  // identity probe never itself invokes the factory (keeping callCount a clean measure of how many
  // times selectSecretEncryption constructed the real backend). Its isAvailable() is false — it stands
  // in for the real, keychain-less backend that fails closed.
  const sentinel: SecretEncryption = {
    isAvailable: () => false,
    encrypt: (plaintext) => plaintext,
    decrypt: (ciphertext) => ciphertext
  }
  return {
    real: () => {
      callCount += 1
      return sentinel
    },
    sentinel,
    callCount: () => callCount
  }
}

// A Map-backed SecretPersistence for the end-to-end round-trip through createSecureStore (mirrors
// secureStore.test.ts's fakePersistence).
function fakePersistence(): SecretPersistence {
  const store = new Map<string, Uint8Array>()
  return {
    async read(name) {
      return store.get(name) ?? null
    },
    async write(name, bytes) {
      store.set(name, bytes)
    },
    async delete(name) {
      store.delete(name)
    }
  }
}

describe('selectSecretEncryption', () => {
  it('returns the real backend by default — unpackaged, no flag (AC4a)', () => {
    const { real, sentinel, callCount } = fakeReal()
    const selected = selectSecretEncryption({ isPackaged: false, env: {}, real })

    // Identity: the exact real() sentinel is returned (so the keychain-free backend was not chosen),
    // and it still reports unavailable — the fail-closed real backend, unchanged.
    expect(selected).toBe(sentinel)
    expect(selected.isAvailable()).toBe(false)
    // real() was invoked exactly once to build the selection.
    expect(callCount()).toBe(1)
  })

  it('short-circuits on isPackaged before the flag — packaged + opt-in still returns the real backend (AC4c)', () => {
    const { real, sentinel, callCount } = fakeReal()
    const selected = selectSecretEncryption({
      isPackaged: true,
      env: { [TEST_SECRET_BACKEND_ENV_FLAG]: '1' },
      real
    })

    // isPackaged wins: the returned backend is the real one, still fail-closed (isAvailable false),
    // byte-identical to today regardless of the env flag.
    expect(selected).toBe(sentinel)
    expect(selected.isAvailable()).toBe(false)
    expect(callCount()).toBe(1)
  })

  it('selects the keychain-free backend when unpackaged AND opted in, without touching the real factory (AC4b)', () => {
    const { real, sentinel, callCount } = fakeReal()
    const selected = selectSecretEncryption({
      isPackaged: false,
      env: { [TEST_SECRET_BACKEND_ENV_FLAG]: '1' },
      real
    })

    expect(selected).not.toBe(sentinel)
    // isAvailable() === true so secureStore.set no longer fails closed on the dev path.
    expect(selected.isAvailable()).toBe(true)
    // The real factory was never invoked — selecting the fake does not construct the real backend.
    expect(callCount()).toBe(0)
  })

  it('round-trips arbitrary and empty byte blobs through the keychain-free backend (AC4b, AC2)', () => {
    const { real } = fakeReal()
    const backend = selectSecretEncryption({
      isPackaged: false,
      env: { [TEST_SECRET_BACKEND_ENV_FLAG]: '1' },
      real
    })

    const payload = new Uint8Array([1, 2, 3, 4, 5])
    const ciphertext = backend.encrypt(payload)
    // A transform actually ran: the ciphertext differs from the plaintext (raw plaintext is never stored).
    expect(Array.from(ciphertext)).not.toEqual(Array.from(payload))
    expect(Array.from(backend.decrypt(ciphertext))).toEqual(Array.from(payload))

    // Byte-blind: no text/encoding assumptions — tricky bytes and empty input both round-trip.
    const tricky = new Uint8Array([0x00, 0x80, 0xff, 0x7f])
    expect(Array.from(backend.decrypt(backend.encrypt(tricky)))).toEqual(Array.from(tricky))

    const empty = new Uint8Array(0)
    expect(Array.from(backend.decrypt(backend.encrypt(empty)))).toEqual([])
  })

  it('is stateless — a blob encrypted by one selection decrypts on an independently-selected backend (AC2)', () => {
    const { real } = fakeReal()
    const opts = { isPackaged: false, env: { [TEST_SECRET_BACKEND_ENV_FLAG]: '1' }, real }
    const a = selectSecretEncryption(opts)
    const b = selectSecretEncryption(opts)

    const payload = new Uint8Array([9, 8, 7])
    // No per-instance/module state: b decrypts what a encrypted.
    expect(Array.from(b.decrypt(a.encrypt(payload)))).toEqual(Array.from(payload))
  })

  it('opts in only on the exact string "1" — every other value falls back to the real backend', () => {
    for (const value of ['0', '', 'true', 'yes', ' 1', '1 ']) {
      const { real, sentinel } = fakeReal()
      const selected = selectSecretEncryption({
        isPackaged: false,
        env: { [TEST_SECRET_BACKEND_ENV_FLAG]: value },
        real
      })
      expect(selected.isAvailable(), `flag=${JSON.stringify(value)}`).toBe(false)
      expect(selected, `flag=${JSON.stringify(value)}`).toBe(sentinel)
    }
    // unset (undefined) also falls back to the real backend.
    const { real, sentinel } = fakeReal()
    const unset = selectSecretEncryption({ isPackaged: false, env: {}, real })
    expect(unset).toBe(sentinel)
    expect(unset.isAvailable()).toBe(false)
  })

  it('lets secureStore.set succeed and round-trip on the dev path instead of failing closed (AC2)', async () => {
    const { real } = fakeReal()
    const encryption = selectSecretEncryption({
      isPackaged: false,
      env: { [TEST_SECRET_BACKEND_ENV_FLAG]: '1' },
      real
    })
    const store = createSecureStore({ encryption, persistence: fakePersistence() })

    const secret = new Uint8Array([42, 7, 255, 0])
    // With the real (keychain-less) backend this would throw EncryptionUnavailableError; on the dev
    // path it persists and reads back byte-for-byte within the run.
    await store.set('device-key', secret)
    expect(Array.from((await store.get('device-key')) ?? [])).toEqual(Array.from(secret))
  })
})
