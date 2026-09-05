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

/** A second and third machine — distinct `server` ids, the collection's key (#1069). */
const SECOND: PairedServerRecord = {
  server: 'pyrybox-2',
  relay: 'wss://relay.example/pair',
  token: 'tok_second',
  server_static_pubkey: 'c2Vjb25kLXN0YXRpYy1rZXk='
}
const THIRD: PairedServerRecord = {
  server: 'pyrybox-3',
  relay: 'wss://other-relay.example/pair',
  token: 'tok_third',
  server_static_pubkey: 'dGhpcmQtc3RhdGljLWtleQ=='
}

/** Seed the store with an arbitrary UTF-8 string as if it were a decrypted blob. */
const seed = (store: Map<string, Uint8Array>, name: string, text: string): void => {
  store.set(name, new TextEncoder().encode(text))
}

/** The persisted blob, parsed — what actually landed on "disk", not what the store reports. */
const readBlob = (store: Map<string, Uint8Array>): unknown =>
  JSON.parse(new TextDecoder().decode(store.get(PAIRED_SERVER_NAME) as Uint8Array))

describe('createPairedServerStore', () => {
  it('round-trips the record through save then load (AC1, AC2)', async () => {
    const { secureStore, store } = fakeSecureStore()
    const paired = createPairedServerStore({ secureStore })

    await paired.save(RECORD)
    const loaded = await paired.load()

    expect(loaded).toEqual(RECORD)
    // Exactly one blob landed, under the single store name...
    expect(store.size).toBe(1)
    expect(store.get(PAIRED_SERVER_NAME)).toBeDefined()
    // ...and it is UTF-8 JSON of a one-entry COLLECTION of the four fields (#1069) — proving it was
    // serialized, not held in memory.
    expect(readBlob(store)).toEqual([RECORD])
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

  it('re-pair: the latest save is what load() reports, and one blob is still all that is kept', async () => {
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

    const parsed = readBlob(store) as Array<Record<string, unknown>>
    expect(parsed).toEqual([RECORD])
    expect('extra' in parsed[0]).toBe(false)
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

  it('honors an injected store name (the test seam; the name is never derived from a server id)', async () => {
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

  it('clears the injected store name, not a hardcoded literal', async () => {
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
      // Every accessor's happy path, the collection members included (#1069).
      const ok = fakeSecureStore()
      const okStore = createPairedServerStore({ secureStore: ok.secureStore })
      await okStore.save(RECORD)
      await okStore.save(SECOND)
      await okStore.load()
      await okStore.loadById(RECORD.server)
      await okStore.loadById('never-paired')
      await okStore.list()
      await okStore.clearServer(RECORD.server)
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

      // Malformed-blob error paths, the collection-shaped ones included (#1069).
      for (const text of ['not json', '[{"server":"a"}]', JSON.stringify([RECORD, RECORD])]) {
        const bad = fakeSecureStore()
        seed(bad.store, PAIRED_SERVER_NAME, text)
        await createPairedServerStore({ secureStore: bad.secureStore })
          .list()
          .catch(() => {})
      }

      // Save-over-a-corrupt-blob recovery path: it swallows the malformed error, so it is exactly
      // the path where a stray console.* would be tempting.
      const corrupt = fakeSecureStore()
      seed(corrupt.store, PAIRED_SERVER_NAME, 'not json')
      await createPairedServerStore({ secureStore: corrupt.secureStore }).save(RECORD)

      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})

// The collection layout (#1069): one blob under the SAME name holding an ordered array keyed by
// `server` id, so pairing a second machine stops discarding the first. A "relaunch" here is a second
// createPairedServerStore over the same backing Map — the module holds no cache, so that is the whole
// of what a process restart changes.
describe('createPairedServerStore — more than one paired server', () => {
  it('holds two servers: both survive a relaunch, by id and from the list (AC1)', async () => {
    const { secureStore, store } = fakeSecureStore()
    const paired = createPairedServerStore({ secureStore })

    await paired.save(RECORD)
    await paired.save(SECOND)
    const relaunched = createPairedServerStore({ secureStore })

    expect(await relaunched.loadById(RECORD.server)).toEqual(RECORD)
    expect(await relaunched.loadById(SECOND.server)).toEqual(SECOND)
    expect(await relaunched.list()).toEqual([RECORD, SECOND])
    // Still exactly one blob, still under the unchanged name — SecureStore has no list operation.
    expect(store.size).toBe(1)
    expect(store.has(PAIRED_SERVER_NAME)).toBe(true)
  })

  it('reports null / empty for a server that was never paired (AC1)', async () => {
    const { secureStore } = fakeSecureStore()
    const paired = createPairedServerStore({ secureStore })

    expect(await paired.list()).toEqual([])
    expect(await paired.loadById('never-paired')).toBeNull()

    await paired.save(RECORD)

    expect(await paired.loadById('never-paired')).toBeNull()
  })

  it('save replaces by key, leaves every other entry unchanged, and becomes the newest (AC2)', async () => {
    const { secureStore } = fakeSecureStore()
    const paired = createPairedServerStore({ secureStore })
    const rotated: PairedServerRecord = { ...RECORD, token: 'tok_rotated' }

    await paired.save(RECORD)
    await paired.save(SECOND)
    await paired.save(THIRD)
    await paired.save(rotated)

    // Replaced in place by key, not appended beside itself — and moved to the newest slot.
    expect(await paired.list()).toEqual([SECOND, THIRD, rotated])
    expect(await paired.loadById(RECORD.server)).toEqual(rotated)
    expect(await paired.loadById(SECOND.server)).toEqual(SECOND)
    expect(await paired.loadById(THIRD.server)).toEqual(THIRD)
    expect(await paired.load()).toEqual(rotated)
  })

  it('load() reports the most recently saved entry, null only when empty (AC3)', async () => {
    const { secureStore } = fakeSecureStore()
    const paired = createPairedServerStore({ secureStore })

    expect(await paired.load()).toBeNull()

    await paired.save(RECORD)
    expect(await paired.load()).toEqual(RECORD)

    await paired.save(SECOND)
    expect(await paired.load()).toEqual(SECOND)

    // ...and it survives the relaunch: entry order is the persisted order, not in-memory state.
    expect(await createPairedServerStore({ secureStore }).load()).toEqual(SECOND)
  })

  it('clearServer leaves the others paired and repoints load() at the newest survivor (AC4)', async () => {
    const { secureStore, store } = fakeSecureStore()
    const paired = createPairedServerStore({ secureStore })

    await paired.save(RECORD)
    await paired.save(SECOND)
    await paired.save(THIRD)
    await paired.clearServer(THIRD.server)

    expect(await paired.loadById(THIRD.server)).toBeNull()
    expect(await paired.list()).toEqual([RECORD, SECOND])
    expect(await paired.load()).toEqual(SECOND)
    // The erased server's bearer token is gone from what is actually on disk, not just from the view.
    expect(JSON.stringify(readBlob(store))).not.toContain(THIRD.token)
  })

  it('clearServer on the final entry leaves no blob behind (AC4)', async () => {
    const { secureStore, store } = fakeSecureStore()
    const paired = createPairedServerStore({ secureStore })

    await paired.save(RECORD)
    await paired.clearServer(RECORD.server)

    // Not an empty array on disk: "no blob" stays the one at-rest form of not-paired.
    expect(store.size).toBe(0)
    expect(await paired.load()).toBeNull()
    expect(await paired.list()).toEqual([])
  })

  it('clearServer for an unheld id changes nothing and writes nothing (AC4)', async () => {
    const { secureStore, store, writes } = fakeSecureStore()
    const paired = createPairedServerStore({ secureStore })

    await paired.save(RECORD)
    const writesAfterSave = writes.length

    await expect(paired.clearServer('never-paired')).resolves.toBeUndefined()

    expect(writes).toHaveLength(writesAfterSave)
    expect(await paired.list()).toEqual([RECORD])
    expect(store.has(PAIRED_SERVER_NAME)).toBe(true)
  })

  it('clear() still empties the whole collection, so no token survives an unpair (AC4)', async () => {
    const { secureStore, store } = fakeSecureStore()
    const paired = createPairedServerStore({ secureStore })

    await paired.save(RECORD)
    await paired.save(SECOND)
    await paired.clear()

    expect(await paired.load()).toBeNull()
    expect(await paired.list()).toEqual([])
    expect(store.size).toBe(0)
  })

  it('migrates a single-record blob into a one-entry collection (AC5)', async () => {
    const { secureStore, store } = fakeSecureStore()
    // Exactly what the single-record version wrote: the bare four-field object.
    seed(store, PAIRED_SERVER_NAME, JSON.stringify(RECORD))
    const paired = createPairedServerStore({ secureStore })

    expect(await paired.list()).toEqual([RECORD])
    expect(await paired.loadById(RECORD.server)).toEqual(RECORD)
    expect(await paired.load()).toEqual(RECORD)
  })

  it('reads a legacy blob without rewriting it, then writes only the new shape (AC5)', async () => {
    const { secureStore, store, writes } = fakeSecureStore()
    seed(store, PAIRED_SERVER_NAME, JSON.stringify({ ...RECORD, extra: 'leak-me' }))
    const paired = createPairedServerStore({ secureStore })

    await paired.load()
    // A read is a read: migration never puts a write on load()'s path, where an unavailable keychain
    // would throw inside a call site that has never had to handle one.
    expect(writes).toHaveLength(0)

    await paired.save(SECOND)

    // Once a save has happened the old shape is never written again — and the stray field the legacy
    // blob carried is dropped from the rewritten entry, not just from the returned record.
    expect(readBlob(store)).toEqual([RECORD, SECOND])
  })

  it('rejects a collection blob that is neither shape, never null and never empty (AC5)', async () => {
    const cases: Array<{ label: string; text: string }> = [
      { label: 'array with an incomplete element', text: '[{"server":"a"}]' },
      { label: 'array of non-objects', text: '[1,2]' },
      { label: 'array containing null', text: JSON.stringify([RECORD, null]) },
      { label: 'duplicate server ids', text: JSON.stringify([RECORD, { ...SECOND, server: RECORD.server }]) },
      { label: 'a bare JSON string', text: '"pyrybox-1"' },
      { label: 'a bare JSON number', text: '42' }
    ]

    for (const { label, text } of cases) {
      const { secureStore, store } = fakeSecureStore()
      seed(store, PAIRED_SERVER_NAME, text)
      const paired = createPairedServerStore({ secureStore })

      await expect(paired.load(), label).rejects.toBeInstanceOf(MalformedPairedServerRecordError)
      await expect(paired.list(), label).rejects.toBeInstanceOf(MalformedPairedServerRecordError)
      await expect(paired.loadById('pyrybox-1'), label).rejects.toBeInstanceOf(
        MalformedPairedServerRecordError
      )
    }
  })

  it('carries no field value in the malformed message — not the id, not the index (AC5)', async () => {
    const { secureStore, store } = fakeSecureStore()
    seed(store, PAIRED_SERVER_NAME, JSON.stringify([RECORD, RECORD]))
    const paired = createPairedServerStore({ secureStore })

    await expect(paired.list()).rejects.toThrow('stored paired-server record is malformed')
  })

  it('treats an empty array as an empty collection, not as a malformed blob', async () => {
    const { secureStore, store } = fakeSecureStore()
    seed(store, PAIRED_SERVER_NAME, '[]')
    const paired = createPairedServerStore({ secureStore })

    expect(await paired.load()).toBeNull()
    expect(await paired.list()).toEqual([])
    expect(await paired.loadById(RECORD.server)).toBeNull()
  })

  it('serializes concurrent mutations so neither server is lost', async () => {
    const { secureStore } = fakeSecureStore()
    const paired = createPairedServerStore({ secureStore })

    // Both read-modify-write cycles are in flight at once. Unserialized, the second would read the
    // pre-write collection and clobber the first — this ticket's own defect from the other direction.
    await Promise.all([paired.save(RECORD), paired.save(SECOND), paired.save(THIRD)])

    expect(await paired.list()).toEqual([RECORD, SECOND, THIRD])
  })

  it('does not wedge the mutation queue when one mutation fails', async () => {
    const { secureStore, control } = fakeSecureStore()
    const paired = createPairedServerStore({ secureStore })
    control.setError = new EncryptionUnavailableError()

    await expect(paired.save(RECORD)).rejects.toBeInstanceOf(EncryptionUnavailableError)
    control.setError = null
    await paired.save(SECOND)

    expect(await paired.list()).toEqual([SECOND])
  })

  it('recovers a corrupt blob by re-pairing: save overwrites what no read can parse', async () => {
    // The collection layout turned `save` from a blind write into a read-modify-write, and with it
    // gave it the ability to reject on a stored blob. That matters because saving IS the app's only
    // recovery from a corrupt one: a malformed blob routes to welcome, welcome offers only the Pair
    // CTA, and clear() sits behind Settings on the paired route. A strict save would loop the user
    // welcome → pair → persist-failed with no in-app exit.
    const cases: Array<{ label: string; text: string }> = [
      { label: 'non-JSON bytes', text: 'not json at all' },
      { label: 'JSON null', text: 'null' },
      { label: 'array with an incomplete element', text: '[{"server":"a"}]' },
      { label: 'duplicate server ids', text: JSON.stringify([RECORD, RECORD]) }
    ]

    for (const { label, text } of cases) {
      const { secureStore, store } = fakeSecureStore()
      seed(store, PAIRED_SERVER_NAME, text)
      const paired = createPairedServerStore({ secureStore })

      // The read still reports the corruption to whoever asks...
      await expect(paired.load(), label).rejects.toBeInstanceOf(MalformedPairedServerRecordError)
      // ...and the re-pair still lands, leaving a readable one-entry collection behind.
      await expect(paired.save(SECOND), label).resolves.toBeUndefined()

      expect(await paired.load(), label).toEqual(SECOND)
      expect(readBlob(store), label).toEqual([SECOND])
    }
  })

  it('save still rejects on a decrypt failure and persists nothing', async () => {
    const { secureStore, store, control, writes } = fakeSecureStore()
    seed(store, PAIRED_SERVER_NAME, JSON.stringify([RECORD]))
    control.getError = new Error('authenticated decryption failed')
    const paired = createPairedServerStore({ secureStore })

    // Not folded into the malformed case: an undecryptable blob may be transient keychain state, so
    // overwriting it would discard real pairings that are still there.
    await expect(paired.save(SECOND)).rejects.toThrow('authenticated decryption failed')

    expect(writes).toHaveLength(0)
    control.getError = null
    expect(await paired.list()).toEqual([RECORD])
  })

  it('keeps the by-id erase strict on a corrupt blob, leaving clear() as the total erase', async () => {
    const { secureStore, store } = fakeSecureStore()
    seed(store, PAIRED_SERVER_NAME, 'not json at all')
    const paired = createPairedServerStore({ secureStore })

    // Unlike save, a partial erase over an unreadable collection has nothing to keep: resolving
    // would report a token gone from disk while the bytes holding it are still there.
    await expect(paired.clearServer(RECORD.server)).rejects.toBeInstanceOf(
      MalformedPairedServerRecordError
    )
    expect(store.has(PAIRED_SERVER_NAME)).toBe(true)

    // clear() never reads, so the whole-store erase reaches a corrupt blob unchanged.
    await paired.clear()
    expect(store.size).toBe(0)
  })

  it('fails closed on a partial erase: a write failure leaves the prior blob intact', async () => {
    const { secureStore, store, control } = fakeSecureStore()
    const paired = createPairedServerStore({ secureStore })

    await paired.save(RECORD)
    await paired.save(SECOND)
    control.setError = new EncryptionUnavailableError()

    await expect(paired.clearServer(RECORD.server)).rejects.toBeInstanceOf(
      EncryptionUnavailableError
    )
    // Never half-erased: the caller learns the token may still be on disk, and it still is.
    control.setError = null
    expect(await paired.list()).toEqual([RECORD, SECOND])
    expect(store.size).toBe(1)
  })
})
