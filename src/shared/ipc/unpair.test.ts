import { describe, it, expect } from 'vitest'
import {
  UNPAIR_CHANNEL,
  UNPAIR_SERVER_CHANNEL,
  MAX_SERVER_ID_LENGTH,
  isUnpairServerRequest
} from './unpair'
import { MAX_PASTE_LENGTH } from './pairing'

describe('unpair channels', () => {
  it('pins both IPC channel strings, and keeps them distinct', () => {
    // The preload invokers ship on these and the main handlers register on them; a drift between
    // the two sides would break the round-trip. Distinctness is the load-bearing half: the
    // per-server request reaches a listener that has no whole-collection erase to call, so the two
    // channels must never collapse onto one registration.
    expect(UNPAIR_CHANNEL).toBe('pyry:unpair')
    expect(UNPAIR_SERVER_CHANNEL).toBe('pyry:unpair-server')
    expect(UNPAIR_SERVER_CHANNEL).not.toBe(UNPAIR_CHANNEL)
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
