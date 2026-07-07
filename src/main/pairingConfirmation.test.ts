import { describe, it, expect, vi } from 'vitest'
import { blake2s } from '@noble/hashes/blake2'
import { EncryptionUnavailableError } from './secureStore'
import type { PairedServerRecord, PairedServerStore } from './pairedServerStore'
import { createPairingConfirmation } from './pairingConfirmation'

// The BLAKE2s digest primitive is partially mocked: by default it calls through to the real
// @noble/hashes blake2s, so the parity/determinism vectors below exercise the genuine hash. A test
// that needs to drive deriveFingerprint's fingerprint-unavailable path (#101 AC3/AC4) forces ONE
// throw via mockImplementationOnce — no runtime actually lacking BLAKE2s is needed to prove the
// digest step returns a typed reason instead of throwing.
vi.mock('@noble/hashes/blake2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@noble/hashes/blake2')>()
  return { ...actual, blake2s: vi.fn(actual.blake2s) }
})

// The one injected edge — PairedServerStore — is faked in-file: no keychain, no filesystem (the
// ticket's AC5). A `save` spy backed by an array is enough; `load` is unused here but the interface
// requires it, so it is a stub. This mirrors pairedServerStore.test.ts's injected-seam scaffold.
function fakeStore(): { store: PairedServerStore; saves: PairedServerRecord[] } {
  const saves: PairedServerRecord[] = []
  const store: PairedServerStore = {
    save: vi.fn(async (record: PairedServerRecord) => {
      saves.push(record)
    }),
    load: async () => null
  }
  return { store, saves }
}

/** A store whose `save` always rejects — the keychain-unavailable / persist-failure path. */
function rejectingStore(error: Error): { store: PairedServerStore; save: ReturnType<typeof vi.fn> } {
  const save = vi.fn(async () => {
    throw error
  })
  return { store: { save, load: async () => null }, save }
}

const b64 = (bytes: number[]): string => Buffer.from(bytes).toString('base64')
const zeros = (n: number): number[] => Array(n).fill(0)
const seq = (n: number): number[] => Array.from({ length: n }, (_, i) => i)

// A valid record: a canonical standard-base64 32-byte key, plus a recognizable token to prove it
// never leaks into the fingerprint.
const RECORD: PairedServerRecord = {
  server: 'pyrybox-1',
  relay: 'wss://pyrycode-relay.pyryco.de/v1/client',
  token: 'tok_SECRET_abc123',
  server_static_pubkey: b64(seq(32))
}

describe('createPairingConfirmation', () => {
  it('derives a deterministic fingerprint that depends only on server_static_pubkey (AC1)', () => {
    const { store } = fakeStore()
    const confirmation = createPairingConfirmation({ store })

    const a = confirmation.prepare(RECORD)
    const b = confirmation.prepare(RECORD)
    const differentToken = confirmation.prepare({ ...RECORD, token: 'tok_OTHER', server: 'pyrybox-9' })
    const differentKey = confirmation.prepare({ ...RECORD, server_static_pubkey: b64(zeros(32)) })

    if (!a.ok || !b.ok || !differentToken.ok || !differentKey.ok) throw new Error('expected ok')
    // Same key → same fingerprint, twice.
    expect(a.fingerprint).toBe(b.fingerprint)
    // Non-pubkey fields do not affect the fingerprint.
    expect(differentToken.fingerprint).toBe(a.fingerprint)
    // A different key → a different fingerprint.
    expect(differentKey.fingerprint).not.toBe(a.fingerprint)
  })

  it('matches the daemon fixed vector for a 32-zero-byte key (AC1)', () => {
    const { store } = fakeStore()
    const confirmation = createPairingConfirmation({ store })

    const prepared = confirmation.prepare({ ...RECORD, server_static_pubkey: b64(zeros(32)) })

    if (!prepared.ok) throw new Error('expected ok')
    // Pinned literal (NOT recomputed here) — byte-identical to the daemon's internal/pair.Fingerprint.
    expect(prepared.fingerprint).toBe('32:0b:5e:a9:9e:65:3b:c2')
  })

  it('matches a second pinned vector for the 0..31 byte-sequence key (AC1)', () => {
    const { store } = fakeStore()
    const confirmation = createPairingConfirmation({ store })

    // RECORD's key is b64(seq(32)) = bytes 0..31 — a non-zero known key. Pinned literal is a genuine
    // BLAKE2s-256(0x00..0x1f)[:8], a second byte-identity canary for the digest swap (#101).
    const prepared = confirmation.prepare(RECORD)

    if (!prepared.ok) throw new Error('expected ok')
    expect(prepared.fingerprint).toBe('05:82:56:07:d7:fd:f2:d8')
  })

  it('returns fingerprint-unavailable — no throw, no confirm, no save — when the digest fails (#101 AC4)', () => {
    // Force ONE digest throw (mirrors a BLAKE2s primitive being unreachable at runtime). The
    // fingerprint step must ABSORB it into a typed reject reason, not throw out of prepare — else the
    // ipcMain.handle invoke rejects and the pairing screen wedges forever in `submitting`.
    vi.mocked(blake2s).mockImplementationOnce(() => {
      throw new Error('boom')
    })
    const { store, saves } = fakeStore()
    const confirmation = createPairingConfirmation({ store })

    const prepared = confirmation.prepare(RECORD)

    expect(prepared.ok).toBe(false)
    if (prepared.ok) throw new Error('expected reject')
    expect(prepared.reason).toBe('fingerprint-unavailable')
    // A digest failure builds NO confirm closure — structurally unpersistable, like a malformed key.
    expect('confirm' in prepared).toBe(false)
    expect(saves).toHaveLength(0)
    expect(store.save).not.toHaveBeenCalled()
  })

  it('formats the fingerprint as 8 colon-separated lowercase-hex bytes', () => {
    const { store } = fakeStore()
    const confirmation = createPairingConfirmation({ store })

    const prepared = confirmation.prepare(RECORD)

    if (!prepared.ok) throw new Error('expected ok')
    expect(prepared.fingerprint).toMatch(/^[0-9a-f]{2}(:[0-9a-f]{2}){7}$/)
    expect(prepared.fingerprint).toHaveLength(23)
  })

  it('persists nothing when only deriving the fingerprint (AC2)', () => {
    const { store, saves } = fakeStore()
    const confirmation = createPairingConfirmation({ store })

    confirmation.prepare(RECORD)

    expect(saves).toHaveLength(0)
    expect(store.save).not.toHaveBeenCalled()
  })

  it('persists exactly once, through the store, only via confirm (AC2, AC3)', async () => {
    const { store, saves } = fakeStore()
    const confirmation = createPairingConfirmation({ store })

    const prepared = confirmation.prepare(RECORD)
    if (!prepared.ok) throw new Error('expected ok')

    await prepared.confirm()

    expect(store.save).toHaveBeenCalledTimes(1)
    expect(saves[0]).toEqual(RECORD)
  })

  it('is idempotent across a double confirm — same bytes, one logical record (AC2)', async () => {
    const { store, saves } = fakeStore()
    const confirmation = createPairingConfirmation({ store })

    const prepared = confirmation.prepare(RECORD)
    if (!prepared.ok) throw new Error('expected ok')

    await prepared.confirm()
    await prepared.confirm()

    expect(store.save).toHaveBeenCalledTimes(2)
    expect(saves[0]).toEqual(saves[1])
    expect(saves[1]).toEqual(RECORD)
  })

  it('makes a malformed key structurally unpersistable — no confirm handle, no save (AC2)', () => {
    const cases: Array<{ label: string; pubkey: string; reason: string }> = [
      { label: 'not base64', pubkey: '!!!', reason: 'pubkey-not-base64' },
      { label: '31 bytes', pubkey: b64(zeros(31)), reason: 'pubkey-wrong-length' },
      { label: '33 bytes', pubkey: b64(zeros(33)), reason: 'pubkey-wrong-length' }
    ]

    for (const { label, pubkey, reason } of cases) {
      const { store, saves } = fakeStore()
      const confirmation = createPairingConfirmation({ store })

      const prepared = confirmation.prepare({ ...RECORD, server_static_pubkey: pubkey })

      expect(prepared.ok, label).toBe(false)
      if (prepared.ok) throw new Error('expected reject')
      expect(prepared.reason, label).toBe(reason)
      // No confirm handle exists on a reject arm — a malformed key cannot be persisted.
      expect('confirm' in prepared, label).toBe(false)
      expect(saves, label).toHaveLength(0)
      expect(store.save, label).not.toHaveBeenCalled()
    }
  })

  it('binds confirm to the fingerprinted snapshot, not the caller reference (TOCTOU)', async () => {
    const { store, saves } = fakeStore()
    const confirmation = createPairingConfirmation({ store })
    const caller: PairedServerRecord = { ...RECORD }

    const prepared = confirmation.prepare(caller)
    if (!prepared.ok) throw new Error('expected ok')
    // Mutate the caller's object after prepare, before confirm.
    caller.server_static_pubkey = b64(zeros(32))
    caller.token = 'tok_SWAPPED'
    await prepared.confirm()

    expect(saves[0].server_static_pubkey).toBe(RECORD.server_static_pubkey)
    expect(saves[0].token).toBe(RECORD.token)
  })

  it('propagates a store.save failure out of confirm without catching it', async () => {
    const { store, save } = rejectingStore(new EncryptionUnavailableError())
    const confirmation = createPairingConfirmation({ store })

    const prepared = confirmation.prepare(RECORD)
    if (!prepared.ok) throw new Error('expected ok')

    await expect(prepared.confirm()).rejects.toBeInstanceOf(EncryptionUnavailableError)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('never returns the token/key from the fingerprint step (AC4)', () => {
    const { store } = fakeStore()
    const confirmation = createPairingConfirmation({ store })

    const prepared = confirmation.prepare(RECORD)
    if (!prepared.ok) throw new Error('expected ok')

    expect(prepared.fingerprint).not.toContain(RECORD.token)
    expect(prepared.fingerprint).not.toContain(RECORD.server_static_pubkey)
    // The ok-object exposes only the fingerprint and an opaque confirm callable — never the record.
    expect(Object.keys(prepared).sort()).toEqual(['confirm', 'fingerprint', 'ok'])
  })

  it('is log-free across every path (AC4)', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {})
    )
    try {
      const { store } = fakeStore()
      const confirmation = createPairingConfirmation({ store })

      // Happy derive + confirm.
      const ok = confirmation.prepare(RECORD)
      if (ok.ok) await ok.confirm()
      // Both malformed-key rejects.
      confirmation.prepare({ ...RECORD, server_static_pubkey: '!!!' })
      confirmation.prepare({ ...RECORD, server_static_pubkey: b64(zeros(31)) })
      // store.save rejects.
      const rejecting = createPairingConfirmation({ store: rejectingStore(new Error('boom')).store })
      const bad = rejecting.prepare(RECORD)
      if (bad.ok) await bad.confirm().catch(() => {})
      // Digest failure — the catch that maps to fingerprint-unavailable must stay log-free (#101 AC5).
      vi.mocked(blake2s).mockImplementationOnce(() => {
        throw new Error('boom')
      })
      confirmation.prepare(RECORD)

      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})
