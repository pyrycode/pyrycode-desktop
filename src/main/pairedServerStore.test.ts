import { describe, it, expect, vi } from 'vitest'
import { EncryptionUnavailableError, type SecureStore } from './secureStore'
import {
  createPairedServerStore,
  PAIRED_SERVER_NAME,
  MalformedPairedServerRecordError,
  type PairedServerRecord
} from './pairedServerStore'

// The one injected edge — SecureStore — is faked in-file: no keychain, no filesystem (the ticket's
// AC5; mirrors deviceKeypair.test.ts / secureStore.test.ts). Serialization is pure, so there is no
// second seam to fake. The fake is Map-backed, records writes, and exposes toggles for the two
// SecureStore failure modes: set fails when encryption is unavailable, and get throws (rather than
// masking as absence) on a decrypt failure. `store` is the shared persistence a "restart" re-reads.
function fakeSecureStore(): {
  secureStore: SecureStore
  store: Map<string, Uint8Array>
  writes: Uint8Array[]
  control: { setError: Error | null; getError: Error | null; deleteError: Error | null }
} {
  const store = new Map<string, Uint8Array>()
  const writes: Uint8Array[] = []
  const control: { setError: Error | null; getError: Error | null; deleteError: Error | null } = {
    setError: null,
    getError: null,
    deleteError: null
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
        if (control.deleteError) throw control.deleteError
        store.delete(name)
      }
    }
  }
}

const RECORD: PairedServerRecord = {
  server: 'pyrybox-1',
  relay: 'wss://relay.example/pair',
  token: 'tok_abc123',
  server_static_pubkey: 'c2VydmVyLXN0YXRpYy1rZXk='
}

/** Seed the store with an arbitrary UTF-8 string as if it were a decrypted blob. */
const seed = (store: Map<string, Uint8Array>, name: string, text: string): void => {
  store.set(name, new TextEncoder().encode(text))
}

describe('createPairedServerStore', () => {
  it('round-trips the record through save then load (AC1, AC2)', async () => {
    const { secureStore, store } = fakeSecureStore()
    const paired = createPairedServerStore({ secureStore })

    await paired.save(RECORD)
    const loaded = await paired.load()

    expect(loaded).toEqual(RECORD)
    // Exactly one blob landed, under the milestone-1 name...
    expect(store.size).toBe(1)
    const blob = store.get(PAIRED_SERVER_NAME)
    expect(blob).toBeDefined()
    // ...and it is UTF-8 JSON of the four fields (proves it was serialized, not held in memory).
    const parsed = JSON.parse(new TextDecoder().decode(blob as Uint8Array))
    expect(parsed).toEqual(RECORD)
  })

  it('returns null when nothing is paired (AC3)', async () => {
    const { secureStore } = fakeSecureStore()
    const paired = createPairedServerStore({ secureStore })

    await expect(paired.load()).resolves.toBeNull()
  })

  it('propagates a decrypt failure instead of masking a tampered record as not-paired (AC3)', async () => {
    const { secureStore, store, control } = fakeSecureStore()
    seed(store, PAIRED_SERVER_NAME, JSON.stringify(RECORD))
    control.getError = new Error('authenticated decryption failed')
    const paired = createPairedServerStore({ secureStore })

    await expect(paired.load()).rejects.toThrow('authenticated decryption failed')
  })

  it('rejects a present-but-malformed blob as MalformedPairedServerRecordError, never null (AC3)', async () => {
    const cases: Array<{ label: string; text: string }> = [
      { label: 'non-JSON bytes', text: 'not json at all' },
      { label: 'JSON null', text: 'null' },
      { label: 'object missing token', text: JSON.stringify({ ...RECORD, token: undefined }) },
      { label: 'token is a number', text: JSON.stringify({ ...RECORD, token: 42 }) }
    ]

    for (const { label, text } of cases) {
      const { secureStore, store } = fakeSecureStore()
      seed(store, PAIRED_SERVER_NAME, text)
      const paired = createPairedServerStore({ secureStore })

      await expect(paired.load(), label).rejects.toBeInstanceOf(MalformedPairedServerRecordError)
    }
  })

  it('overwrites on re-pair: the latest save wins and only one blob is kept (AC2)', async () => {
    const { secureStore, store } = fakeSecureStore()
    const paired = createPairedServerStore({ secureStore })
    const repaired: PairedServerRecord = { ...RECORD, server: 'pyrybox-2', token: 'tok_new' }

    await paired.save(RECORD)
    await paired.save(repaired)

    expect(await paired.load()).toEqual(repaired)
    expect(store.size).toBe(1)
  })

  it('drops caller stray fields — only the four record fields are persisted', async () => {
    const { secureStore, store } = fakeSecureStore()
    const paired = createPairedServerStore({ secureStore })

    await paired.save({ ...RECORD, extra: 'leak-me' } as PairedServerRecord)

    const parsed = JSON.parse(new TextDecoder().decode(store.get(PAIRED_SERVER_NAME) as Uint8Array))
    expect(parsed).toEqual(RECORD)
    expect('extra' in parsed).toBe(false)
  })

  it('fails loud when encryption is unavailable and persists nothing (AC4)', async () => {
    const { secureStore, control, writes } = fakeSecureStore()
    const paired = createPairedServerStore({ secureStore })

    control.setError = new EncryptionUnavailableError()

    await expect(paired.save(RECORD)).rejects.toBeInstanceOf(EncryptionUnavailableError)
    expect(writes).toHaveLength(0)
  })

  it('keys the store under the milestone-1 single-pyrybox name by default', async () => {
    const { secureStore, store } = fakeSecureStore()
    const paired = createPairedServerStore({ secureStore })

    await paired.save(RECORD)

    expect(PAIRED_SERVER_NAME).toBe('pyrycode.paired_server')
    expect(store.has(PAIRED_SERVER_NAME)).toBe(true)
  })

  it('honors an injected store name (the deferred per-server-id keying seam)', async () => {
    const { secureStore, store } = fakeSecureStore()
    const paired = createPairedServerStore({
      secureStore,
      name: 'pyrycode.paired_server.server-xyz'
    })

    await paired.save(RECORD)

    expect(store.has('pyrycode.paired_server.server-xyz')).toBe(true)
    expect(store.has(PAIRED_SERVER_NAME)).toBe(false)
  })

  it('erases the record so a later load reports not-paired (AC2)', async () => {
    const { secureStore, store } = fakeSecureStore()
    const paired = createPairedServerStore({ secureStore })

    await paired.save(RECORD)
    await paired.clear()

    expect(await paired.load()).toBeNull()
    expect(store.size).toBe(0)
  })

  it('is idempotent: clearing a never-paired store resolves and stays not-paired (AC3)', async () => {
    const { secureStore, store } = fakeSecureStore()
    const paired = createPairedServerStore({ secureStore })

    await expect(paired.clear()).resolves.toBeUndefined()
    expect(await paired.load()).toBeNull()
    expect(store.size).toBe(0)
  })

  it('erases ONLY the paired-server record, preserving the device static keypair (AC1, AC4)', async () => {
    const { secureStore, store } = fakeSecureStore()
    seed(store, PAIRED_SERVER_NAME, JSON.stringify(RECORD))
    // The device static keypair lives under its own name in the same secret chain (deviceKeypair.ts
    // DEVICE_STATIC_KEY_NAME). Erasing the pairing must not rotate the device identity (AC4).
    seed(store, 'pyrycode.device_static', 'device-static-keypair-bytes')
    const paired = createPairedServerStore({ secureStore })

    await paired.clear()

    expect(store.has(PAIRED_SERVER_NAME)).toBe(false)
    expect(store.has('pyrycode.device_static')).toBe(true)
  })

  it('clears the injected store name, not a hardcoded literal (the deferred per-server-id seam)', async () => {
    const { secureStore, store } = fakeSecureStore()
    const paired = createPairedServerStore({
      secureStore,
      name: 'pyrycode.paired_server.server-xyz'
    })
    seed(store, 'pyrycode.paired_server.server-xyz', JSON.stringify(RECORD))
    seed(store, PAIRED_SERVER_NAME, JSON.stringify(RECORD))

    await paired.clear()

    expect(store.has('pyrycode.paired_server.server-xyz')).toBe(false)
    expect(store.has(PAIRED_SERVER_NAME)).toBe(true)
  })

  it('fails closed: a delete failure propagates rather than reporting success', async () => {
    const { secureStore, store, control } = fakeSecureStore()
    seed(store, PAIRED_SERVER_NAME, JSON.stringify(RECORD))
    control.deleteError = new Error('persistence unavailable')
    const paired = createPairedServerStore({ secureStore })

    await expect(paired.clear()).rejects.toThrow('persistence unavailable')
  })

  it('is log-free across save, load, and every error path (AC4)', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {})
    )
    try {
      // save + load + clear happy path.
      const ok = fakeSecureStore()
      const okStore = createPairedServerStore({ secureStore: ok.secureStore })
      await okStore.save(RECORD)
      await okStore.load()
      await okStore.clear()

      // Delete-failure error path.
      const noDelete = fakeSecureStore()
      noDelete.control.deleteError = new Error('persistence unavailable')
      await createPairedServerStore({ secureStore: noDelete.secureStore })
        .clear()
        .catch(() => {})

      // Keychain-unavailable error path.
      const noEnc = fakeSecureStore()
      noEnc.control.setError = new EncryptionUnavailableError()
      await createPairedServerStore({ secureStore: noEnc.secureStore })
        .save(RECORD)
        .catch(() => {})

      // Decrypt-failure error path.
      const undecryptable = fakeSecureStore()
      seed(undecryptable.store, PAIRED_SERVER_NAME, JSON.stringify(RECORD))
      undecryptable.control.getError = new Error('authenticated decryption failed')
      await createPairedServerStore({ secureStore: undecryptable.secureStore })
        .load()
        .catch(() => {})

      // Malformed-blob error path.
      const bad = fakeSecureStore()
      seed(bad.store, PAIRED_SERVER_NAME, 'not json')
      await createPairedServerStore({ secureStore: bad.secureStore })
        .load()
        .catch(() => {})

      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})
