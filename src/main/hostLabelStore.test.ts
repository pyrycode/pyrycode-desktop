import { describe, it, expect, vi } from 'vitest'
import { EncryptionUnavailableError, type SecureStore } from './secureStore'
import {
  createHostLabelStore,
  HOST_LABEL_FORMAT_VERSION,
  HOST_LABEL_NAME,
  MalformedHostLabelError
} from './hostLabelStore'

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

      // The keyed happy path (#1155): the same four verbs per server, plus the by-id erase.
      const keyed = fakeSecureStore()
      const keyedStore = createHostLabelStore({ secureStore: keyed.secureStore })
      await keyedStore.saveFor('server-a', LABEL)
      await keyedStore.loadFor('server-a')
      await keyedStore.loadFor('never-stored')
      await keyedStore.clearFor('server-a')
      await keyedStore.loadFor('server-a')

      // The keyed error paths: a legacy blob (read as empty, never logged) and a recognized-but-
      // broken envelope (raises). Neither may name the id, the bytes, or how many servers are stored.
      const legacy = fakeSecureStore()
      seed(legacy.store, HOST_LABEL_NAME, LABEL)
      await createHostLabelStore({ secureStore: legacy.secureStore }).loadFor('server-a')

      const brokenEnvelope = fakeSecureStore()
      seed(brokenEnvelope.store, HOST_LABEL_NAME, '{"v":1,"labels":[{"server":"a"}]}')
      await createHostLabelStore({ secureStore: brokenEnvelope.secureStore })
        .loadFor('a')
        .catch(() => {})

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

// The per-server labels (#1155). The keyed triple lives over the SAME blob under the SAME name as
// the un-keyed one; nothing here is wired to a caller in this slice, so both formats never coexist
// in a shipped state. The un-keyed tests above stay green untouched — that is the Strangler Fig
// property this block sits beside, not one it replaces.
describe('createHostLabelStore — per-server labels (#1155)', () => {
  const A = 'server-a'
  const B = 'server-b'

  /** The stored blob, parsed. Proves a write really produced the versioned envelope, not a memo. */
  const readEnvelope = (store: Map<string, Uint8Array>): unknown =>
    JSON.parse(new TextDecoder().decode(store.get(HOST_LABEL_NAME) as Uint8Array))

  /** A well-formed envelope as a string, for seeding a "written by this version" blob. */
  const envelope = (labels: unknown): string =>
    JSON.stringify({ v: HOST_LABEL_FORMAT_VERSION, labels })

  it('keeps a label per server: a second machine does not overwrite the first (AC1)', async () => {
    const { secureStore, store } = fakeSecureStore()
    const labels = createHostLabelStore({ secureStore })

    await labels.saveFor(A, 'Pyrybox')
    await labels.saveFor(B, 'Pyrybox II')

    expect(await labels.loadFor(A)).toBe('Pyrybox')
    expect(await labels.loadFor(B)).toBe('Pyrybox II')
    // Still ONE blob under ONE name — the collection lives inside it, the way pairedServerStore's
    // does. A per-server store NAME would show up here as a second entry.
    expect(store.size).toBe(1)
    expect(store.has(HOST_LABEL_NAME)).toBe(true)
  })

  it('outlives the instance that wrote it: a reopened store reads both back (AC1)', async () => {
    const { secureStore } = fakeSecureStore()

    const first = createHostLabelStore({ secureStore })
    await first.saveFor(A, 'Pyrybox')
    await first.saveFor(B, 'Pyrybox II')

    // A second store over the same persistence is what models a restart.
    const reopened = createHostLabelStore({ secureStore })
    expect(await reopened.loadFor(A)).toBe('Pyrybox')
    expect(await reopened.loadFor(B)).toBe('Pyrybox II')
  })

  it('re-saving one server replaces only that label (AC1)', async () => {
    const { secureStore, store } = fakeSecureStore()
    const labels = createHostLabelStore({ secureStore })

    await labels.saveFor(A, 'Pyrybox')
    await labels.saveFor(B, 'Pyrybox II')
    await labels.saveFor(A, 'Renamed')

    expect(await labels.loadFor(A)).toBe('Renamed')
    expect(await labels.loadFor(B)).toBe('Pyrybox II')
    // Replace-by-key, not append: the id appears once, so a later read cannot see a stale label.
    expect(readEnvelope(store)).toEqual({
      v: HOST_LABEL_FORMAT_VERSION,
      labels: [
        { server: B, label: 'Pyrybox II' },
        { server: A, label: 'Renamed' }
      ]
    })
  })

  it('erases one server and leaves every other label stored (AC2)', async () => {
    const { secureStore } = fakeSecureStore()
    const labels = createHostLabelStore({ secureStore })

    await labels.saveFor(A, 'Pyrybox')
    await labels.saveFor(B, 'Pyrybox II')
    await labels.clearFor(A)

    expect(await labels.loadFor(A)).toBeNull()
    expect(await labels.loadFor(B)).toBe('Pyrybox II')
  })

  it('clearFor an unheld id changes nothing and writes nothing (AC2)', async () => {
    const { secureStore, writes } = fakeSecureStore()
    const labels = createHostLabelStore({ secureStore })

    await labels.saveFor(A, 'Pyrybox')
    const writesAfterSave = writes.length

    await expect(labels.clearFor('never-stored')).resolves.toBeUndefined()

    // No match resolves without a keychain round-trip, so an erase that had nothing to erase can
    // never raise EncryptionUnavailableError.
    expect(writes).toHaveLength(writesAfterSave)
    expect(await labels.loadFor(A)).toBe('Pyrybox')
  })

  it('deletes the blob when the last label goes, sparing the neighbouring credentials (AC2)', async () => {
    const { secureStore, store } = fakeSecureStore()
    // The paired-server record (a bearer token) and the device static keypair live under their own
    // names in the same chain. A `name` derived from the id would erase one of them here.
    seed(store, 'pyrycode.paired_server', 'paired-server-record-bytes')
    seed(store, 'pyrycode.device_static', 'device-static-keypair-bytes')
    const labels = createHostLabelStore({ secureStore })

    await labels.saveFor(A, 'Pyrybox')
    await labels.clearFor(A)

    // No blob, rather than an empty envelope: "absent" stays the one at-rest form of nothing stored,
    // which is where clear() also ends.
    expect(store.has(HOST_LABEL_NAME)).toBe(false)
    expect(store.has('pyrycode.paired_server')).toBe(true)
    expect(store.has('pyrycode.device_static')).toBe(true)
  })

  it('keeps absent, stored-empty and unreadable distinct per server (AC3)', async () => {
    const { secureStore, store } = fakeSecureStore()
    const labels = createHostLabelStore({ secureStore })

    // Absent id → never stored.
    expect(await labels.loadFor(A)).toBeNull()

    // A stored '' is a value, not absence — and it does not make its NEIGHBOUR absent either.
    await labels.saveFor(A, '')
    await labels.saveFor(B, 'Pyrybox II')
    const empty = await labels.loadFor(A)
    expect(empty).toBe('')
    expect(empty).not.toBeNull()
    expect(await labels.loadFor(B)).toBe('Pyrybox II')

    // Present, decrypts, not valid UTF-8 → raises, never read as never-stored. Seeded as raw bytes:
    // TextEncoder cannot produce this, so it is unreachable through either version's save.
    store.set(HOST_LABEL_NAME, new Uint8Array([0xff, 0xfe, 0xfd]))
    await expect(labels.loadFor(A)).rejects.toBeInstanceOf(MalformedHostLabelError)
  })

  it('propagates a decrypt failure from a keyed read rather than masking it as absence (AC3)', async () => {
    const { secureStore, store, control } = fakeSecureStore()
    seed(store, HOST_LABEL_NAME, envelope([{ server: A, label: 'Pyrybox' }]))
    control.getError = new Error('authenticated decryption failed')

    await expect(createHostLabelStore({ secureStore }).loadFor(A)).rejects.toThrow(
      'authenticated decryption failed'
    )
  })

  it('raises on a recognized-but-broken envelope, and a keyed save recovers it (AC3)', async () => {
    // Past the version marker the blob is unambiguously ours, so a broken one is format drift, not
    // the old format — it must raise rather than silently drop a server's label. Saving is the only
    // recovery, exactly as re-pairing is pairedServerStore's, so save overwrites what no read parses.
    const cases: Array<{ label: string; text: string }> = [
      { label: 'labels is not an array', text: envelope('nope') },
      { label: 'labels is missing', text: JSON.stringify({ v: HOST_LABEL_FORMAT_VERSION }) },
      { label: 'entry is not an object', text: envelope([null]) },
      { label: 'entry is an array', text: envelope([['a', 'b']]) },
      { label: 'entry is missing label', text: envelope([{ server: A }]) },
      { label: 'entry label is not a string', text: envelope([{ server: A, label: 1 }]) },
      { label: 'entry server is not a string', text: envelope([{ server: 1, label: 'x' }]) },
      {
        label: 'repeated server id',
        text: envelope([
          { server: A, label: 'x' },
          { server: A, label: 'y' }
        ])
      }
    ]

    for (const { label, text } of cases) {
      const { secureStore, store } = fakeSecureStore()
      seed(store, HOST_LABEL_NAME, text)
      const labels = createHostLabelStore({ secureStore })

      await expect(labels.loadFor(A), label).rejects.toBeInstanceOf(MalformedHostLabelError)
      // The erase stays strict — it surfaces the corruption rather than hiding it.
      await expect(labels.clearFor(A), label).rejects.toBeInstanceOf(MalformedHostLabelError)
      // ...and the save still lands, leaving a readable one-entry collection behind.
      await expect(labels.saveFor(A, 'Pyrybox'), label).resolves.toBeUndefined()

      expect(await labels.loadFor(A), label).toBe('Pyrybox')
      expect(readEnvelope(store), label).toEqual({
        v: HOST_LABEL_FORMAT_VERSION,
        labels: [{ server: A, label: 'Pyrybox' }]
      })
    }
  })

  it('rejects a keyed save on a decrypt failure and persists nothing (AC3)', async () => {
    const { secureStore, store, control, writes } = fakeSecureStore()
    seed(store, HOST_LABEL_NAME, envelope([{ server: A, label: 'Pyrybox' }]))
    control.getError = new Error('authenticated decryption failed')

    // Not folded into the malformed case: an undecryptable blob may be transient keychain state, so
    // overwriting it would discard every real label that is still in there.
    await expect(createHostLabelStore({ secureStore }).saveFor(B, 'Pyrybox II')).rejects.toThrow(
      'authenticated decryption failed'
    )
    expect(writes).toHaveLength(0)
  })

  it('never puts an untrusted server id on the persistence name (AC4)', async () => {
    // `constructor` and `__proto__` are the detectors for the two ways this goes wrong: an
    // object-keyed collection (prototype pollution / a bogus duplicate) and a name-derived-from-id
    // store (a write outside this store's own blob). `../pyrycode.paired_server` is the traversal
    // shape; '' is the degenerate id.
    const ids = ['__proto__', 'constructor', '../pyrycode.paired_server', '', 'x'.repeat(4096)]

    for (const id of ids) {
      const { secureStore, store } = fakeSecureStore()
      seed(store, 'pyrycode.paired_server', 'paired-server-record-bytes')
      const labels = createHostLabelStore({ secureStore })

      await labels.saveFor(id, LABEL)

      // The blob went under this store's own fixed name and nowhere else — no `pyrycode.host_label.x`
      // entry, and the neighbouring credential untouched.
      expect(store.has(HOST_LABEL_NAME), id).toBe(true)
      expect(store.size, id).toBe(2)
      expect(new TextDecoder().decode(store.get('pyrycode.paired_server') as Uint8Array), id).toBe(
        'paired-server-record-bytes'
      )

      // Retrievable under that id only: matched with === against the entry's own field.
      expect(await labels.loadFor(id), id).toBe(LABEL)
      expect(await labels.loadFor('some-other-server'), id).toBeNull()

      // Nothing was written through an object key, so Object.prototype gained nothing.
      expect(Object.prototype).not.toHaveProperty('label')
      expect(({} as Record<string, unknown>).label, id).toBeUndefined()

      await labels.clearFor(id)
      expect(await labels.loadFor(id), id).toBeNull()
      expect(store.has('pyrycode.paired_server'), id).toBe(true)
    }
  })

  it('reads a single-slot blob as no labels stored, then replaces it (AC5)', async () => {
    // A blob the single-slot version wrote is a BARE string with no id attached, so it cannot name a
    // server and is not carried over — a deliberate loss. The trap: JSON.parse rejects most old
    // labels but not all of them, so "it failed to parse" is not the test. The version marker is.
    const oldLabels = ['Pyrybox', '[]', '{}', 'null', '123', '"quoted"', '{"v":2,"labels":[]}']

    for (const old of oldLabels) {
      const { secureStore, store } = fakeSecureStore()
      seed(store, HOST_LABEL_NAME, old)
      const labels = createHostLabelStore({ secureStore })

      // No labels for ANY id, and no throw — this is the one unreadable-as-new blob that must not
      // raise, because it is the only thing that reaches the decoder and is neither our format nor
      // invalid UTF-8 (safeStorage is AEAD, so tampering fails decryption upstream).
      expect(await labels.loadFor(A), old).toBeNull()
      expect(await labels.loadFor(''), old).toBeNull()
      await expect(labels.clearFor(A), old).resolves.toBeUndefined()

      // The first keyed save replaces it wholesale.
      await labels.saveFor(A, 'Pyrybox')
      expect(await labels.loadFor(A), old).toBe('Pyrybox')
      expect(readEnvelope(store), old).toEqual({
        v: HOST_LABEL_FORMAT_VERSION,
        labels: [{ server: A, label: 'Pyrybox' }]
      })
    }
  })

  it('serializes concurrent keyed mutations so none is clobbered', async () => {
    const { secureStore } = fakeSecureStore()
    const labels = createHostLabelStore({ secureStore })

    // Three read-modify-write cycles in flight at once. Unserialized, all three read the same empty
    // collection and the last write wins — this module's own single-slot defect from the other
    // direction, and the race the "deliberately no read-modify-write helper" note warned about.
    await Promise.all([
      labels.saveFor(A, 'Pyrybox'),
      labels.saveFor(B, 'Pyrybox II'),
      labels.saveFor('server-c', 'Pyrybox III')
    ])

    expect(await labels.loadFor(A)).toBe('Pyrybox')
    expect(await labels.loadFor(B)).toBe('Pyrybox II')
    expect(await labels.loadFor('server-c')).toBe('Pyrybox III')
  })

  it('serializes an erase against a save rather than losing one to the gap', async () => {
    const { secureStore } = fakeSecureStore()
    const labels = createHostLabelStore({ secureStore })
    await labels.saveFor(A, 'Pyrybox')

    await Promise.all([labels.saveFor(B, 'Pyrybox II'), labels.clearFor(A)])

    expect(await labels.loadFor(A)).toBeNull()
    expect(await labels.loadFor(B)).toBe('Pyrybox II')
  })

  it('does not wedge the mutation queue when one keyed mutation fails', async () => {
    const { secureStore, control } = fakeSecureStore()
    const labels = createHostLabelStore({ secureStore })
    control.setError = new EncryptionUnavailableError()

    await expect(labels.saveFor(A, 'Pyrybox')).rejects.toBeInstanceOf(EncryptionUnavailableError)
    control.setError = null
    await labels.saveFor(B, 'Pyrybox II')

    expect(await labels.loadFor(B)).toBe('Pyrybox II')
  })

  it('leaves the un-keyed triple writing and reading the single-slot format unchanged', async () => {
    const { secureStore, store } = fakeSecureStore()
    const labels = createHostLabelStore({ secureStore })

    await labels.save(LABEL)

    // Still BARE UTF-8, not JSON. `save` is the one un-keyed member #1156 left with no caller at
    // all, and it is deliberately NOT taught the envelope — teaching a dead writer a second format
    // would be surface with no reader.
    expect(new TextDecoder().decode(store.get(HOST_LABEL_NAME) as Uint8Array)).toBe(LABEL)
    expect(await labels.load()).toBe(LABEL)
    // And that blob is, to the keyed reader, exactly the legacy format.
    expect(await labels.loadFor(A)).toBeNull()
  })
})

// The un-keyed reader over the KEYED blob (#1156). Once pairing writes through `saveFor`, the
// zero-argument stored-host-label query is reading a blob written in the envelope format — the one
// state #1155's header called out as "the one state that would put an envelope in front of the
// un-keyed reader". `load` is the seam that answers it, so these tests own that boundary: what it
// must return, and just as importantly what it must never return.
describe('createHostLabelStore — the un-keyed load over a keyed blob (#1156)', () => {
  const A = 'server-a'
  const B = 'server-b'
  const C = 'server-c'

  it('reads a one-entry envelope back as that entry’s label, never as the envelope text (AC4)', async () => {
    const { secureStore, store } = fakeSecureStore()
    const labels = createHostLabelStore({ secureStore })

    await labels.saveFor(A, LABEL)

    expect(await labels.load()).toBe(LABEL)
    // The regression this guards is specific: the raw blob IS JSON, and returning it verbatim is
    // both what the un-keyed reader used to do and short enough to clear the read bound, so it would
    // surface as the operator's machine name rather than as an error.
    expect(new TextDecoder().decode(store.get(HOST_LABEL_NAME) as Uint8Array)).toContain('"v":1')
    expect(await labels.load()).not.toContain('"v":1')
  })

  it('reads back the MOST RECENTLY stored label when several servers are held (AC4)', async () => {
    const { secureStore } = fakeSecureStore()
    const labels = createHostLabelStore({ secureStore })

    // Driven through saveFor rather than a hand-written blob, so this pins SAVE order — the property
    // the single-slot blob had (last writer wins) — and not merely array order.
    await labels.saveFor(A, 'Pyrybox')
    await labels.saveFor(B, 'Pyrybox II')
    await labels.saveFor(C, 'Pyrybox III')

    expect(await labels.load()).toBe('Pyrybox III')
  })

  it('follows a re-save to the front: replacing a server’s label makes it the most recent', async () => {
    const { secureStore } = fakeSecureStore()
    const labels = createHostLabelStore({ secureStore })

    await labels.saveFor(A, 'Pyrybox')
    await labels.saveFor(B, 'Pyrybox II')
    await labels.saveFor(A, 'Pyrybox renamed')

    // saveFor drops the old entry and appends, so a replacement is the newest save, exactly as a
    // second single-slot `save` would have been.
    expect(await labels.load()).toBe('Pyrybox renamed')
  })

  it('follows an erase: the newest SURVIVING label is what comes back', async () => {
    const { secureStore } = fakeSecureStore()
    const labels = createHostLabelStore({ secureStore })

    await labels.saveFor(A, 'Pyrybox')
    await labels.saveFor(B, 'Pyrybox II')
    await labels.clearFor(B)

    expect(await labels.load()).toBe('Pyrybox')
  })

  it('keeps a stored EMPTY label a value: it must not collapse into never-stored', async () => {
    const { secureStore } = fakeSecureStore()
    const labels = createHostLabelStore({ secureStore })

    await labels.saveFor(A, '')

    // `''` is falsy, so a truthiness test on the newest entry would type-check, read naturally, pass
    // every test above, and silently merge two of the read channel's three outcomes here.
    expect(await labels.load()).toBe('')
  })

  it('resolves null once the last keyed label is erased', async () => {
    const { secureStore, store } = fakeSecureStore()
    const labels = createHostLabelStore({ secureStore })

    await labels.saveFor(A, LABEL)
    await labels.clearFor(A)

    expect(store.has(HOST_LABEL_NAME)).toBe(false)
    expect(await labels.load()).toBeNull()
  })

  it('resolves null for an EMPTY envelope rather than handing back the envelope text', async () => {
    const { secureStore, store } = fakeSecureStore()
    // Unreachable through saveFor/clearFor — clearFor deletes the blob when the last entry goes —
    // so this is hand-seeded. It exists because it is the one remaining decoded shape that could put
    // JSON in front of the renderer, and "no entries" must read as nothing stored.
    seed(store, HOST_LABEL_NAME, `{"v":${HOST_LABEL_FORMAT_VERSION},"labels":[]}`)

    await expect(createHostLabelStore({ secureStore }).load()).resolves.toBeNull()
  })

  it('still returns a LEGACY bare blob verbatim, including empty and BOM-leading text', async () => {
    for (const text of [LABEL, '', '﻿Pyrybox', 'Pyryböx — Juhana’s 🖥', '{}', '[]', '123']) {
      const { secureStore, store } = fakeSecureStore()
      seed(store, HOST_LABEL_NAME, text)

      // Every one of these is "not our envelope", so the un-keyed read is unchanged for every blob
      // that can exist on an installed machine today — including the JSON-ish ones that parse.
      expect(await createHostLabelStore({ secureStore }).load()).toBe(text)
    }
  })

  it('still raises on invalid UTF-8, so unreadable stays distinct from never-stored', async () => {
    const { secureStore, store } = fakeSecureStore()
    store.set(HOST_LABEL_NAME, new Uint8Array([0xff, 0xfe, 0xfd]))

    await expect(createHostLabelStore({ secureStore }).load()).rejects.toBeInstanceOf(
      MalformedHostLabelError
    )
  })

  it('raises on envelope DRIFT — past the version marker a broken blob is not legacy', async () => {
    const drifted = [
      `{"v":${HOST_LABEL_FORMAT_VERSION},"labels":"nope"}`,
      `{"v":${HOST_LABEL_FORMAT_VERSION},"labels":[{"server":"a"}]}`,
      `{"v":${HOST_LABEL_FORMAT_VERSION},"labels":[{"server":"a","label":1}]}`,
      `{"v":${HOST_LABEL_FORMAT_VERSION},"labels":[{"server":"a","label":"x"},{"server":"a","label":"y"}]}`
    ]
    for (const text of drifted) {
      const { secureStore, store } = fakeSecureStore()
      seed(store, HOST_LABEL_NAME, text)

      // Drift must surface as unreadable rather than as a plausible-looking string or a dropped
      // label — the same rule loadFor follows, now applied at the un-keyed read too.
      await expect(createHostLabelStore({ secureStore }).load()).rejects.toBeInstanceOf(
        MalformedHostLabelError
      )
    }
  })

  it('reveals only ONE label — never the collection, a server id, or how many are stored', async () => {
    const { secureStore } = fakeSecureStore()
    const labels = createHostLabelStore({ secureStore })

    await labels.saveFor(A, 'Pyrybox')
    await labels.saveFor(B, 'Pyrybox II')

    // Returning the envelope, a joined list, or a count would tell a compromised renderer how many
    // machines the operator has paired and what they are called — a capability the zero-argument
    // query does not have today and must not gain here.
    const read = await labels.load()
    expect(read).toBe('Pyrybox II')
    expect(read).not.toContain('Pyrybox II"')
    expect(read).not.toContain(A)
    expect(read).not.toContain(B)
  })

  it('erases every server’s label through the un-keyed clear (AC3)', async () => {
    const { secureStore, store } = fakeSecureStore()
    const labels = createHostLabelStore({ secureStore })

    await labels.saveFor(A, 'Pyrybox')
    await labels.saveFor(B, 'Pyrybox II')
    // The whole-collection unpair arm held a `clear`-only handle precisely because `clear` deletes
    // the ONE blob the keyed collection lives in, so "no label stored for any server" was already
    // what it does under the new at-rest shape — no `clearAll` member was ever needed. #1163 deleted
    // that arm and `clear` now has no production caller; this pins the member's behaviour until the
    // follow-up removes it (see hostLabelStore's header for why it is not removed here).
    await labels.clear()

    expect(store.has(HOST_LABEL_NAME)).toBe(false)
    expect(await labels.load()).toBeNull()
    expect(await labels.loadFor(A)).toBeNull()
    expect(await labels.loadFor(B)).toBeNull()
  })

  it('is log-free across the un-keyed read of every blob shape', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {})
    )
    try {
      const keyed = fakeSecureStore()
      const keyedStore = createHostLabelStore({ secureStore: keyed.secureStore })
      await keyedStore.saveFor(A, LABEL)
      await keyedStore.load()

      const drift = fakeSecureStore()
      seed(drift.store, HOST_LABEL_NAME, `{"v":${HOST_LABEL_FORMAT_VERSION},"labels":[{}]}`)
      await createHostLabelStore({ secureStore: drift.secureStore })
        .load()
        .catch(() => {})

      const empty = fakeSecureStore()
      seed(empty.store, HOST_LABEL_NAME, `{"v":${HOST_LABEL_FORMAT_VERSION},"labels":[]}`)
      await createHostLabelStore({ secureStore: empty.secureStore }).load()

      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})
