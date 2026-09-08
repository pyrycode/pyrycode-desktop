import { describe, it, expect } from 'vitest'
import {
  HOST_LABEL_CHANNEL,
  HOST_LABEL_SERVER_CHANNEL,
  HOST_LABEL_SET_CHANNEL,
  isHostLabelServerRequest,
  isHostLabelSetRequest
} from './hostLabel'
import { MAX_SERVER_ID_LENGTH } from './unpair'
import { MAX_HOST_LABEL_LENGTH, MAX_PASTE_LENGTH } from './pairing'

describe('host-label channels', () => {
  it('pins all three IPC channel strings, and keeps them mutually distinct', () => {
    // The preload invokers ship on these and the main handlers register on them; a drift between
    // the two sides would break the round-trip silently. Distinctness is the load-bearing half:
    // the keyed read reaches a listener holding a `loadFor`-only store handle, the zero-argument
    // one a `load`-only handle, and the SET channel the only handle in the family that can write,
    // so no two may ever collapse onto one registration.
    expect(HOST_LABEL_CHANNEL).toBe('pyry:host-label')
    expect(HOST_LABEL_SERVER_CHANNEL).toBe('pyry:host-label-server')
    expect(HOST_LABEL_SET_CHANNEL).toBe('pyry:host-label-set')
    expect(new Set([HOST_LABEL_CHANNEL, HOST_LABEL_SERVER_CHANNEL, HOST_LABEL_SET_CHANNEL]).size).toBe(
      3
    )
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

describe('isHostLabelSetRequest', () => {
  it('accepts both strings, including a request carrying an extra field (structural minimum)', () => {
    expect(isHostLabelSetRequest({ serverId: 'pyrybox', label: 'Pyrybox' })).toBe(true)
    expect(isHostLabelSetRequest({ serverId: 'pyrybox', label: 'Pyrybox', extra: 'ignored' })).toBe(
      true
    )
  })

  it('rejects null, undefined, and non-object values', () => {
    expect(isHostLabelSetRequest(null)).toBe(false)
    expect(isHostLabelSetRequest(undefined)).toBe(false)
    expect(isHostLabelSetRequest('pyrybox')).toBe(false)
    expect(isHostLabelSetRequest(42)).toBe(false)
  })

  it('requires BOTH fields — either one missing or non-string rejects, and so does an array', () => {
    expect(isHostLabelSetRequest({})).toBe(false)
    expect(isHostLabelSetRequest({ serverId: 'pyrybox' })).toBe(false)
    expect(isHostLabelSetRequest({ label: 'Pyrybox' })).toBe(false)
    expect(isHostLabelSetRequest({ server: 'pyrybox', label: 'Pyrybox' })).toBe(false)
    expect(isHostLabelSetRequest({ serverId: 42, label: 'Pyrybox' })).toBe(false)
    expect(isHostLabelSetRequest({ serverId: 'pyrybox', label: 42 })).toBe(false)
    expect(isHostLabelSetRequest({ serverId: null, label: 'Pyrybox' })).toBe(false)
    expect(isHostLabelSetRequest({ serverId: 'pyrybox', label: null })).toBe(false)
    expect(isHostLabelSetRequest({ serverId: ['pyrybox'], label: 'Pyrybox' })).toBe(false)
    expect(isHostLabelSetRequest({ serverId: 'pyrybox', label: ['Pyrybox'] })).toBe(false)
    // An array carries neither key, so the missing-key tests already reject it — no Array.isArray
    // branch of its own is needed, and this pins that. #1149's ruling, third application.
    expect(isHostLabelSetRequest(['pyrybox'])).toBe(false)
  })

  it('rejects a present-but-undefined field, on either side', () => {
    // Reachable, not hypothetical: Electron's IPC uses the structured clone algorithm, which
    // PRESERVES an own property whose value is undefined (unlike JSON.stringify, which drops it).
    // BOTH fields are required here — unlike isPairingRequest's optional `label`, because on this
    // channel absence and emptiness are one answer ("no label") decided by the main-side trim, and a
    // second representation would be a way for the two to disagree.
    expect(isHostLabelSetRequest({ serverId: undefined, label: 'Pyrybox' })).toBe(false)
    expect(isHostLabelSetRequest({ serverId: 'pyrybox', label: undefined })).toBe(false)
  })

  it('bounds each field independently, at its own imported constant', () => {
    const id = 'a'.repeat(MAX_SERVER_ID_LENGTH)
    const label = 'b'.repeat(MAX_HOST_LABEL_LENGTH)

    expect(isHostLabelSetRequest({ serverId: id, label })).toBe(true)
    expect(isHostLabelSetRequest({ serverId: `${id}a`, label })).toBe(false)
    expect(isHostLabelSetRequest({ serverId: id, label: `${label}b` })).toBe(false)
    // Independence: a long-but-legal value in one field must not excuse the other, which a single
    // shared bound (or a bound applied to only one field) would silently do.
    expect(isHostLabelSetRequest({ serverId: id, label: 'Pyrybox' })).toBe(true)
    expect(isHostLabelSetRequest({ serverId: 'pyrybox', label })).toBe(true)
  })

  it('bounds the RAW label, before any trim — a value that would trim to within the bound is refused', () => {
    // The guard is structural: it bounds what crosses the wire, not what survives normalisation.
    // That is exactly the test isPairingRequest applies to the value the pairing path sends (which
    // `hostLabelToSend` has already trimmed renderer-side), so accepting an over-long value here
    // because it happens to trim short would make this channel laxer than the write it mirrors.
    const trimsToExactlyMax = ` ${'b'.repeat(MAX_HOST_LABEL_LENGTH)} `
    expect(trimsToExactlyMax.trim().length).toBe(MAX_HOST_LABEL_LENGTH)
    expect(isHostLabelSetRequest({ serverId: 'pyrybox', label: trimsToExactlyMax })).toBe(false)
  })

  it('accepts an empty serverId and an empty label — both are answered later, not here', () => {
    // The empty id is #1149's settled ruling, unchanged: emptiness is structural, and an id naming
    // no paired server is refused one step later by the existence check rather than by the guard.
    // The empty LABEL is this channel's own case and is not a refusal at all — it is the request to
    // CLEAR, which the main-side trim turns into a `clearFor` call.
    expect(isHostLabelSetRequest({ serverId: '', label: 'Pyrybox' })).toBe(true)
    expect(isHostLabelSetRequest({ serverId: 'pyrybox', label: '' })).toBe(true)
    expect(isHostLabelSetRequest({ serverId: 'pyrybox', label: '   ' })).toBe(true)
  })

  it('treats a prototype-shaped serverId as an ordinary string', () => {
    // Inert for the same reason as on the read channel: `saveFor` and `clearFor` compare the id with
    // === against each decoded entry's own `server` FIELD and it never becomes a store name, a
    // persistence path, or an object key. See hostLabelStore's HOST_LABEL_NAME.
    expect(isHostLabelSetRequest({ serverId: '__proto__', label: 'Pyrybox' })).toBe(true)
    expect(isHostLabelSetRequest({ serverId: 'constructor', label: 'Pyrybox' })).toBe(true)
    expect(isHostLabelSetRequest({ serverId: '../../pyrycode.paired_server', label: 'x' })).toBe(true)
  })

  it('is pure and never throws on a hostile shape', () => {
    // The `in` tests are short-circuited by the typeof/null tests ahead of them, which is what lets
    // the guard sit OUTSIDE the handler's try — a throwing guard there would escape as an
    // Electron-serialized error carrying a main-process stack trace.
    expect(() => isHostLabelSetRequest(Object.create(null))).not.toThrow()
    expect(() => isHostLabelSetRequest(Symbol('x'))).not.toThrow()
    expect(() => isHostLabelSetRequest(() => 'x')).not.toThrow()
  })
})
