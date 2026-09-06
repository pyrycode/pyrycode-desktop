import { describe, it, expect } from 'vitest'
import * as unpairContract from './unpair'
import { UNPAIR_SERVER_CHANNEL, MAX_SERVER_ID_LENGTH, isUnpairServerRequest } from './unpair'
import { MAX_PASTE_LENGTH } from './pairing'

describe('unpair channels', () => {
  it('pins the IPC channel string', () => {
    // The preload invoker ships on this and the main handler registers on it; a drift between the two
    // sides would break the round-trip.
    expect(UNPAIR_SERVER_CHANNEL).toBe('pyry:unpair-server')
  })

  it('exports NO whole-collection channel — nothing here names "pyry:unpair" (#1163)', () => {
    // AC3, pinned on the contract side: #1163 deleted UNPAIR_CHANNEL along with its handler, its
    // preload method and its registration, so the app registers no whole-collection erase and no
    // module can name one through this contract. Walked over the module's whole export set rather
    // than asserting the old identifier is undefined, so a re-added constant reddens this under ANY
    // name. The surviving channel is a distinct string, so it does not trip the check itself.
    expect(Object.values(unpairContract)).not.toContain('pyry:unpair')
  })

  it('bounds the server id at the pairing paste bound', () => {
    // Aliased rather than an independently chosen number: every persisted `server` id arrived
    // inside a paste bounded by MAX_PASTE_LENGTH, so no held record can be made unforgettable by
    // this bound. A tighter number would risk exactly that lockout.
    expect(MAX_SERVER_ID_LENGTH).toBe(MAX_PASTE_LENGTH)
  })
})

describe('isUnpairServerRequest', () => {
  it('accepts a string serverId, including one carrying an extra field (structural minimum)', () => {
    expect(isUnpairServerRequest({ serverId: 'pyrybox' })).toBe(true)
    expect(isUnpairServerRequest({ serverId: 'pyrybox', extra: 'ignored' })).toBe(true)
  })

  it('rejects null, undefined, and non-object values', () => {
    expect(isUnpairServerRequest(null)).toBe(false)
    expect(isUnpairServerRequest(undefined)).toBe(false)
    expect(isUnpairServerRequest('pyrybox')).toBe(false)
    expect(isUnpairServerRequest(42)).toBe(false)
  })

  it('rejects a missing or non-string serverId, and an array', () => {
    expect(isUnpairServerRequest({})).toBe(false)
    expect(isUnpairServerRequest({ server: 'pyrybox' })).toBe(false)
    expect(isUnpairServerRequest({ serverId: 42 })).toBe(false)
    expect(isUnpairServerRequest({ serverId: null })).toBe(false)
    expect(isUnpairServerRequest({ serverId: ['pyrybox'] })).toBe(false)
    // An array has no `serverId` key, so the missing-key test already rejects it.
    expect(isUnpairServerRequest(['pyrybox'])).toBe(false)
  })

  it('rejects a present-but-undefined serverId', () => {
    // Reachable, not hypothetical: Electron's IPC uses the structured clone algorithm, which
    // PRESERVES an own property whose value is undefined (unlike JSON.stringify, which drops it).
    // `serverId` is REQUIRED, so — unlike isPairingRequest's optional `label` — this must reject.
    expect(isUnpairServerRequest({ serverId: undefined })).toBe(false)
  })

  it('bounds the length: accepts exactly MAX_SERVER_ID_LENGTH, rejects one over', () => {
    expect(isUnpairServerRequest({ serverId: 'a'.repeat(MAX_SERVER_ID_LENGTH) })).toBe(true)
    expect(isUnpairServerRequest({ serverId: 'a'.repeat(MAX_SERVER_ID_LENGTH + 1) })).toBe(false)
  })

  it('accepts an empty serverId — emptiness is the handler’s "no held record" refusal, not the guard’s', () => {
    // The guard is STRUCTURAL. A stored record's `server` is only checked for string-ness by
    // parseRecord, so an empty id is storable; rejecting it here would make such a record
    // unforgettable through this path while the guard gained nothing.
    expect(isUnpairServerRequest({ serverId: '' })).toBe(true)
  })

  it('treats a prototype-shaped serverId as an ordinary string', () => {
    // The id is compared with === against each decoded entry's own `server` field and never becomes
    // a store name, a path, or an object key, so these are inert — accepted here and refused one
    // step later as "names no held record".
    expect(isUnpairServerRequest({ serverId: '__proto__' })).toBe(true)
    expect(isUnpairServerRequest({ serverId: '../../etc/passwd' })).toBe(true)
  })
})
