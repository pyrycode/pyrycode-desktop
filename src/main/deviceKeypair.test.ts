import { describe, it, expect, vi } from 'vitest'
import { EncryptionUnavailableError, type SecureStore } from './secureStore'
import {
  createDeviceKeypairStore,
  DEVICE_STATIC_KEY_NAME,
  MalformedDeviceKeypairError,
  type DeviceKeyPair,
  type KeyPairGenerator
} from './deviceKeypair'

// Both effectful edges are faked in-file — no keychain, no filesystem, no wasm (the ticket's AC5;
// mirrors secureStore.test.ts's in-file-fake idiom). The SecureStore fake is Map-backed and
// records writes; the KeyPairGenerator fake returns deterministic bytes so "generated exactly
// once" and "the SAME pair across launches" are both provable.

const bytes = (u: Uint8Array): number[] => Array.from(u)
const equalPair = (a: DeviceKeyPair, b: DeviceKeyPair): boolean =>
  bytes(a.privateKey).join() === bytes(b.privateKey).join() &&
  bytes(a.publicKey).join() === bytes(b.publicKey).join()

// A Map-backed SecureStore that records writes and exposes toggles for the two failure modes the
// real store surfaces: set fails when encryption is unavailable, and get throws (rather than
// masking as absence) on a decrypt failure. `store` is the shared persistence a "restart" re-reads.
function fakeSecureStore(): {
  secureStore: SecureStore
  store: Map<string, Uint8Array>
  writes: Uint8Array[]
  control: { setError: Error | null; getError: Error | null }
} {
  const store = new Map<string, Uint8Array>()
  const writes: Uint8Array[] = []
  const control: { setError: Error | null; getError: Error | null } = {
    setError: null,
    getError: null
  }
  return {
    store,
    writes,
    control,
    secureStore: {
      async set(name, value) {
        if (control.setError) throw control.setError
        writes.push(value)
        store.set(name, value)
      },
      async get(name) {
        if (control.getError) throw control.getError
        return store.get(name) ?? null
      },
      async delete(name) {
        store.delete(name)
      }
    }
  }
}

// A counting KeyPairGenerator: each call returns a DISTINCT pair (keyed on the call count), so an
// equal pair across two ensure() calls proves generation happened exactly once — not twice with a
// coincidental collision.
function countingGenerator(): KeyPairGenerator & { count(): number } {
  let count = 0
  return {
    count: () => count,
    async generate() {
      count += 1
      return {
        privateKey: new Uint8Array(32).fill(count),
        publicKey: new Uint8Array(32).fill(0x80 + count)
      }
    }
  }
}

describe('createDeviceKeypairStore', () => {
  it('generates and persists the private key on first use (AC1)', async () => {
    const { secureStore, store } = fakeSecureStore()
    const gen = countingGenerator()
    const keypair = createDeviceKeypairStore({ secureStore, generator: gen })

    const pair = await keypair.ensure()

    expect(gen.count()).toBe(1)
    expect(bytes(pair.privateKey)).toEqual(bytes(new Uint8Array(32).fill(1)))
    // The persisted blob is priv‖pub = 64 bytes; its first 32 bytes are the private key.
    const blob = store.get(DEVICE_STATIC_KEY_NAME)
    expect(blob).toBeDefined()
    expect(blob).toHaveLength(64)
    expect(bytes((blob as Uint8Array).subarray(0, 32))).toEqual(bytes(pair.privateKey))
  })

  it('is generate-once: a second call in the same process returns the SAME pair (AC2)', async () => {
    const { secureStore, writes } = fakeSecureStore()
    const gen = countingGenerator()
    const keypair = createDeviceKeypairStore({ secureStore, generator: gen })

    const first = await keypair.ensure()
    const second = await keypair.ensure()

    expect(equalPair(first, second)).toBe(true)
    expect(gen.count()).toBe(1)
    expect(writes).toHaveLength(1)
  })

  it('is generate-once across a restart: a fresh store over the same persistence never regenerates (AC2)', async () => {
    const shared = fakeSecureStore()
    const gen1 = countingGenerator()
    const first = await createDeviceKeypairStore({
      secureStore: shared.secureStore,
      generator: gen1
    }).ensure()

    // Simulate a relaunch: a brand-new store handle over the SAME persisted blob, fresh generator.
    const gen2 = countingGenerator()
    const afterRestart = await createDeviceKeypairStore({
      secureStore: shared.secureStore,
      generator: gen2
    }).ensure()

    expect(equalPair(first, afterRestart)).toBe(true)
    expect(gen2.count()).toBe(0) // read the persisted pair, never generated a fresh one
  })

  it('exposes the public key for use as the initiator static key (AC3)', async () => {
    const { secureStore } = fakeSecureStore()
    const gen = countingGenerator()
    const keypair = createDeviceKeypairStore({ secureStore, generator: gen })

    const pair = await keypair.ensure()

    expect(pair.publicKey).toHaveLength(32)
    expect(bytes(pair.publicKey)).toEqual(bytes(new Uint8Array(32).fill(0x81)))
  })

  it('serializes concurrent first-calls: generation and persistence happen at most once (AC2)', async () => {
    const { secureStore, writes } = fakeSecureStore()
    const gen = countingGenerator()
    const keypair = createDeviceKeypairStore({ secureStore, generator: gen })

    const [a, b] = await Promise.all([keypair.ensure(), keypair.ensure()])

    expect(equalPair(a, b)).toBe(true)
    expect(gen.count()).toBe(1)
    expect(writes).toHaveLength(1)
  })

  it('fails loud when encryption is unavailable and does not poison the memo (AC4)', async () => {
    const { secureStore, control, writes } = fakeSecureStore()
    const gen = countingGenerator()
    const keypair = createDeviceKeypairStore({ secureStore, generator: gen })

    control.setError = new EncryptionUnavailableError()
    await expect(keypair.ensure()).rejects.toBeInstanceOf(EncryptionUnavailableError)
    expect(writes).toHaveLength(0) // nothing persisted; the unpersisted pair is not returned

    // A later retry (keychain now available) still succeeds — the rejected memo was cleared.
    control.setError = null
    const pair = await keypair.ensure()
    expect(pair.publicKey).toHaveLength(32)
    expect(writes).toHaveLength(1)
  })

  it('propagates a decrypt failure without regenerating the identity', async () => {
    const { secureStore, control, store } = fakeSecureStore()
    const gen = countingGenerator()
    // A stored blob is present, but get throws (tamper / keychain rotation) — the real store's
    // fail-loud posture. Silently regenerating would rotate the device identity.
    store.set(DEVICE_STATIC_KEY_NAME, new Uint8Array(64).fill(0x11))
    control.getError = new Error('authenticated decryption failed')
    const keypair = createDeviceKeypairStore({ secureStore, generator: gen })

    await expect(keypair.ensure()).rejects.toThrow('authenticated decryption failed')
    expect(gen.count()).toBe(0)
  })

  it('rejects a present-but-wrong-length blob as MalformedDeviceKeypairError, never regenerating', async () => {
    const { secureStore, store } = fakeSecureStore()
    const gen = countingGenerator()
    store.set(DEVICE_STATIC_KEY_NAME, new Uint8Array(10)) // not 64 bytes
    const keypair = createDeviceKeypairStore({ secureStore, generator: gen })

    await expect(keypair.ensure()).rejects.toBeInstanceOf(MalformedDeviceKeypairError)
    expect(gen.count()).toBe(0)
  })

  it('keys the store under the milestone-1 single-pyrybox name by default', async () => {
    const { secureStore, store } = fakeSecureStore()
    const keypair = createDeviceKeypairStore({ secureStore, generator: countingGenerator() })

    await keypair.ensure()

    expect(DEVICE_STATIC_KEY_NAME).toBe('pyrycode.device_static')
    expect(store.has(DEVICE_STATIC_KEY_NAME)).toBe(true)
  })

  it('honors an injected store name (the deferred per-server-id keying seam)', async () => {
    const { secureStore, store } = fakeSecureStore()
    const keypair = createDeviceKeypairStore({
      secureStore,
      generator: countingGenerator(),
      name: 'pyrycode.device_static.server-xyz'
    })

    await keypair.ensure()

    expect(store.has('pyrycode.device_static.server-xyz')).toBe(true)
    expect(store.has(DEVICE_STATIC_KEY_NAME)).toBe(false)
  })

  it('is log-free across generate, persist, and error paths (AC4)', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {})
    )
    try {
      // Generate + persist path.
      const ok = fakeSecureStore()
      await createDeviceKeypairStore({
        secureStore: ok.secureStore,
        generator: countingGenerator()
      }).ensure()

      // Keychain-unavailable error path.
      const noEnc = fakeSecureStore()
      noEnc.control.setError = new EncryptionUnavailableError()
      await createDeviceKeypairStore({
        secureStore: noEnc.secureStore,
        generator: countingGenerator()
      })
        .ensure()
        .catch(() => {})

      // Malformed-blob error path.
      const bad = fakeSecureStore()
      bad.store.set(DEVICE_STATIC_KEY_NAME, new Uint8Array(3))
      await createDeviceKeypairStore({
        secureStore: bad.secureStore,
        generator: countingGenerator()
      })
        .ensure()
        .catch(() => {})

      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})
