import { describe, it, expect, vi } from 'vitest'
import { EncryptionUnavailableError, type SecureStore } from './secureStore'
import { createHostLabelStore, HOST_LABEL_NAME, MalformedHostLabelError } from './hostLabelStore'

// The one injected edge — SecureStore — is faked in-file: no keychain, no filesystem (mirrors
// pairedServerStore.test.ts / deviceKeypair.test.ts). Encoding is pure, so there is no second seam
// to fake. The fake is Map-backed, records writes, and exposes toggles for the three SecureStore
// failure modes: set fails when encryption is unavailable, get throws (rather than masking as
// absence) on a decrypt failure, and delete fails when persistence is unavailable. `store` is the
// shared persistence a "restart" re-reads.
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

const LABEL = 'Pyrybox'

/** Seed the store with an arbitrary UTF-8 string as if it were a decrypted blob. */
const seed = (store: Map<string, Uint8Array>, name: string, text: string): void => {
  store.set(name, new TextEncoder().encode(text))
}

describe('createHostLabelStore', () => {
  it('reads back through a freshly built store: the label outlives the instance that wrote it (AC1)', async () => {
    const { secureStore, store } = fakeSecureStore()

    await createHostLabelStore({ secureStore }).save(LABEL)
    // A second store over the SAME persistence is what models a restart — the round-trip is
    // asserted against the shared Map, never against the instance that wrote it.
    const reopened = createHostLabelStore({ secureStore })

    await expect(reopened.load()).resolves.toBe(LABEL)
    expect(store.size).toBe(1)
    expect(store.has(HOST_LABEL_NAME)).toBe(true)
  })

  it('round-trips non-ASCII text as UTF-8 bytes', async () => {
    const { secureStore, store } = fakeSecureStore()
    const labels = createHostLabelStore({ secureStore })
    const label = 'Pyryböx — Juhana’s 🖥'

    await labels.save(label)

    expect(await labels.load()).toBe(label)
    // The blob really is the UTF-8 encoding of the label (proves it was serialized, not memoized).
    expect(new TextDecoder().decode(store.get(HOST_LABEL_NAME) as Uint8Array)).toBe(label)
  })

  it('round-trips a BOM-leading label with the BOM intact', async () => {
    const { secureStore } = fakeSecureStore()
    const labels = createHostLabelStore({ secureStore })
    const label = '﻿Pyrybox'

    await labels.save(label)

    // Fails against a default TextDecoder, which STRIPS a leading U+FEFF — this test pins
    // `ignoreBOM: true` in decodeLabel.
    expect(await labels.load()).toBe(label)
  })

  it('reports never-stored as null (AC2)', async () => {
    const { secureStore } = fakeSecureStore()

    await expect(createHostLabelStore({ secureStore }).load()).resolves.toBeNull()
  })

  it('distinguishes a stored empty string from absence (AC2)', async () => {
    const { secureStore } = fakeSecureStore()
    const labels = createHostLabelStore({ secureStore })

    await labels.save('')

    const loaded = await labels.load()
    expect(loaded).toBe('')
    expect(loaded).not.toBeNull()
  })

  it('rejects a present-but-invalid-UTF-8 blob as MalformedHostLabelError, never null (AC3)', async () => {
    const { secureStore, store } = fakeSecureStore()
    // Seeded as raw bytes, NOT via seed(): TextEncoder can only produce valid UTF-8, so the one
    // malformation this encoding admits is unreachable through the text helper.
    store.set(HOST_LABEL_NAME, new Uint8Array([0xff, 0xfe, 0xfd]))
    const labels = createHostLabelStore({ secureStore })

    // `rejects` fails the test if the promise RESOLVES, so this is also the assertion that a
    // corrupt blob is never reported as absence.
    await expect(labels.load()).rejects.toBeInstanceOf(MalformedHostLabelError)
  })

  it('propagates a decrypt failure instead of masking a tampered label as absence (AC3)', async () => {
    const { secureStore, store, control } = fakeSecureStore()
    seed(store, HOST_LABEL_NAME, LABEL)
    control.getError = new Error('authenticated decryption failed')
    const labels = createHostLabelStore({ secureStore })

    await expect(labels.load()).rejects.toThrow('authenticated decryption failed')
  })

  it('overwrites: the latest save wins and only one blob is kept', async () => {
    const { secureStore, store } = fakeSecureStore()
    const labels = createHostLabelStore({ secureStore })

    await labels.save(LABEL)
    await labels.save('Pyrybox II')

    expect(await labels.load()).toBe('Pyrybox II')
    expect(store.size).toBe(1)
  })

  it('erases the label so a later load reports absence (AC4)', async () => {
    const { secureStore, store } = fakeSecureStore()
    const labels = createHostLabelStore({ secureStore })

    await labels.save(LABEL)
    await labels.clear()

    expect(await labels.load()).toBeNull()
    expect(store.size).toBe(0)
  })

  it('is idempotent: clearing a never-stored label resolves and stays absent (AC4)', async () => {
    const { secureStore, store } = fakeSecureStore()
    const labels = createHostLabelStore({ secureStore })

    await expect(labels.clear()).resolves.toBeUndefined()
    expect(await labels.load()).toBeNull()
    expect(store.size).toBe(0)
  })

  it('erases ONLY the label, preserving the neighbouring credentials in the same secret chain', async () => {
    const { secureStore, store } = fakeSecureStore()
    seed(store, HOST_LABEL_NAME, LABEL)
    // The paired-server record (a bearer token) and the device static keypair live under their own
    // names in the same chain. A name collision here would erase a credential.
    seed(store, 'pyrycode.paired_server', 'paired-server-record-bytes')
    seed(store, 'pyrycode.device_static', 'device-static-keypair-bytes')

    await createHostLabelStore({ secureStore }).clear()

    expect(store.has(HOST_LABEL_NAME)).toBe(false)
    expect(store.has('pyrycode.paired_server')).toBe(true)
    expect(store.has('pyrycode.device_static')).toBe(true)
  })

  it('keys the store under the milestone-1 single-pyrybox name by default', async () => {
    const { secureStore, store } = fakeSecureStore()

    await createHostLabelStore({ secureStore }).save(LABEL)

    expect(HOST_LABEL_NAME).toBe('pyrycode.host_label')
    expect(store.has(HOST_LABEL_NAME)).toBe(true)
  })

  it('honors an injected store name and clears it, not a hardcoded literal', async () => {
    const { secureStore, store } = fakeSecureStore()
    const labels = createHostLabelStore({ secureStore, name: 'pyrycode.host_label.server-xyz' })
    seed(store, HOST_LABEL_NAME, 'other-host')

    await labels.save(LABEL)
    expect(store.has('pyrycode.host_label.server-xyz')).toBe(true)
    expect(await labels.load()).toBe(LABEL)

    await labels.clear()
    expect(store.has('pyrycode.host_label.server-xyz')).toBe(false)
    expect(store.has(HOST_LABEL_NAME)).toBe(true)
  })

  it('fails loud when encryption is unavailable and persists nothing', async () => {
    const { secureStore, control, writes } = fakeSecureStore()
    control.setError = new EncryptionUnavailableError()

    await expect(createHostLabelStore({ secureStore }).save(LABEL)).rejects.toBeInstanceOf(
      EncryptionUnavailableError
    )
    expect(writes).toHaveLength(0)
  })

  it('fails closed: a delete failure propagates rather than reporting success', async () => {
    const { secureStore, store, control } = fakeSecureStore()
    seed(store, HOST_LABEL_NAME, LABEL)
    control.deleteError = new Error('persistence unavailable')

    await expect(createHostLabelStore({ secureStore }).clear()).rejects.toThrow(
      'persistence unavailable'
    )
  })

  it('is log-free across save, load, clear, and every error path (AC5)', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {})
    )
    try {
      // save + load + clear happy path.
      const ok = fakeSecureStore()
      const okStore = createHostLabelStore({ secureStore: ok.secureStore })
      await okStore.save(LABEL)
      await okStore.load()
      await okStore.clear()
      await okStore.load()

      // Keychain-unavailable error path.
      const noEnc = fakeSecureStore()
      noEnc.control.setError = new EncryptionUnavailableError()
      await createHostLabelStore({ secureStore: noEnc.secureStore })
        .save(LABEL)
        .catch(() => {})

      // Decrypt-failure error path.
      const undecryptable = fakeSecureStore()
      seed(undecryptable.store, HOST_LABEL_NAME, LABEL)
      undecryptable.control.getError = new Error('authenticated decryption failed')
      await createHostLabelStore({ secureStore: undecryptable.secureStore })
        .load()
        .catch(() => {})

      // Invalid-UTF-8 error path.
      const bad = fakeSecureStore()
      bad.store.set(HOST_LABEL_NAME, new Uint8Array([0xff, 0xfe, 0xfd]))
      await createHostLabelStore({ secureStore: bad.secureStore })
        .load()
        .catch(() => {})

      // Delete-failure error path.
      const noDelete = fakeSecureStore()
      noDelete.control.deleteError = new Error('persistence unavailable')
      await createHostLabelStore({ secureStore: noDelete.secureStore })
        .clear()
        .catch(() => {})

      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})
