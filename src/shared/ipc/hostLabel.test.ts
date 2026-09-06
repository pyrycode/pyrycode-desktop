import { describe, it, expect } from 'vitest'
import {
  HOST_LABEL_CHANNEL,
  HOST_LABEL_SERVER_CHANNEL,
  isHostLabelServerRequest
} from './hostLabel'
import { MAX_SERVER_ID_LENGTH } from './unpair'
import { MAX_PASTE_LENGTH } from './pairing'

describe('host-label channels', () => {
  it('pins both IPC channel strings, and keeps them distinct', () => {
    // The preload invokers ship on these and the main handlers register on them; a drift between
    // the two sides would break the round-trip silently. Distinctness is the load-bearing half:
    // the keyed request reaches a listener holding a `loadFor`-only store handle, and the
    // zero-argument one a `load`-only handle, so the two must never collapse onto one registration.
    expect(HOST_LABEL_CHANNEL).toBe('pyry:host-label')
    expect(HOST_LABEL_SERVER_CHANNEL).toBe('pyry:host-label-server')
    expect(HOST_LABEL_SERVER_CHANNEL).not.toBe(HOST_LABEL_CHANNEL)
  })

  it('bounds the server id at the SAME constant the unpair path uses — never a second number', () => {
    // #1157 reuses MAX_SERVER_ID_LENGTH rather than minting its own bound, and this pins the reuse
    // by identity rather than by value: a copied literal that happened to agree today would pass a
    // value comparison and drift silently the first time either side moved. The alias chain to
    // MAX_PASTE_LENGTH is what guarantees no held record can be made unaddressable by the check —
    // every persisted `server` id arrived inside a paste that bound already limited.
    expect(MAX_SERVER_ID_LENGTH).toBe(MAX_PASTE_LENGTH)
  })
})

describe('isHostLabelServerRequest', () => {
  it('accepts a string serverId, including one carrying an extra field (structural minimum)', () => {
    expect(isHostLabelServerRequest({ serverId: 'pyrybox' })).toBe(true)
    expect(isHostLabelServerRequest({ serverId: 'pyrybox', extra: 'ignored' })).toBe(true)
  })

  it('rejects null, undefined, and non-object values', () => {
    expect(isHostLabelServerRequest(null)).toBe(false)
    expect(isHostLabelServerRequest(undefined)).toBe(false)
    expect(isHostLabelServerRequest('pyrybox')).toBe(false)
    expect(isHostLabelServerRequest(42)).toBe(false)
  })

  it('rejects a missing or non-string serverId, and an array', () => {
    expect(isHostLabelServerRequest({})).toBe(false)
    expect(isHostLabelServerRequest({ server: 'pyrybox' })).toBe(false)
    expect(isHostLabelServerRequest({ serverId: 42 })).toBe(false)
    expect(isHostLabelServerRequest({ serverId: null })).toBe(false)
    expect(isHostLabelServerRequest({ serverId: ['pyrybox'] })).toBe(false)
    // An array has no `serverId` key, so the missing-key test already rejects it — no
    // Array.isArray branch of its own is needed, and this pins that.
    expect(isHostLabelServerRequest(['pyrybox'])).toBe(false)
  })

  it('rejects a present-but-undefined serverId', () => {
    // Reachable, not hypothetical: Electron's IPC uses the structured clone algorithm, which
    // PRESERVES an own property whose value is undefined (unlike JSON.stringify, which drops it).
    // `serverId` is REQUIRED, so — unlike isPairingRequest's optional `label` — this must reject,
    // and the typeof test does it on its own. #1149's settled ruling, applied here for the same
    // reason.
    expect(isHostLabelServerRequest({ serverId: undefined })).toBe(false)
  })

  it('bounds the length: accepts exactly MAX_SERVER_ID_LENGTH, rejects one over', () => {
    expect(isHostLabelServerRequest({ serverId: 'a'.repeat(MAX_SERVER_ID_LENGTH) })).toBe(true)
    expect(isHostLabelServerRequest({ serverId: 'a'.repeat(MAX_SERVER_ID_LENGTH + 1) })).toBe(false)
  })

  it('accepts an empty serverId — emptiness is the store’s answer, not the guard’s', () => {
    // The guard is STRUCTURAL, and `parseEntry` only checks a stored `server` for string-ness, so
    // an empty id is storable. Refusing it here would make such a record's label unreadable through
    // this path while buying nothing: an empty id naming no entry is answered `not-stored` one step
    // later, exactly like any other unheld id. #1149's second settled ruling.
    expect(isHostLabelServerRequest({ serverId: '' })).toBe(true)
  })

  it('treats a prototype-shaped serverId as an ordinary string', () => {
    // The id is compared with === against each decoded entry's own `server` FIELD and never becomes
    // a store name, a persistence path, or an object key, so these are inert — accepted here and
    // answered `not-stored` one step later. See hostLabelStore's HOST_LABEL_NAME, which rejects
    // composing the persistence name from the id for exactly this reason.
    expect(isHostLabelServerRequest({ serverId: '__proto__' })).toBe(true)
    expect(isHostLabelServerRequest({ serverId: 'constructor' })).toBe(true)
    expect(isHostLabelServerRequest({ serverId: '../../pyrycode.paired_server' })).toBe(true)
  })
})
