import { describe, it, expect } from 'vitest'
import {
  createRelayLinkStore,
  initialRelayLinkState,
  selectRelayLinkStatus,
  selectRelayLinkStatusFor
} from './relayLinkStore'

// Plain-function store tests over isolated createRelayLinkStore() instances — the
// sessionIdStore.test idiom. No React, no bridge: the store is pure renderer state with a single
// set-on-arm mutation. The held value is the closed RelayLinkStatus category (no wire remap),
// superseded whole-value by each later relayLinkChanged. `null` is the distinct initial
// not-connected state (AC1) — definitionally none of the three categories.

describe('relayLinkStore', () => {
  it('starts not-connected — status is null (AC1, AC3)', () => {
    const store = createRelayLinkStore()
    expect(store.getState().status).toBeNull()
    expect(selectRelayLinkStatus(store.getState())).toBeNull()
  })

  it('setRelayLinkStatus records the status; selectRelayLinkStatus returns it (AC5)', () => {
    const store = createRelayLinkStore()
    store.getState().setRelayLinkStatus('connected')
    expect(selectRelayLinkStatus(store.getState())).toBe('connected')
  })

  it('each of the three categories round-trips through the setter/selector (AC5)', () => {
    for (const status of ['connected', 'offline', 'daemon-absent'] as const) {
      const store = createRelayLinkStore()
      store.getState().setRelayLinkStatus(status)
      expect(selectRelayLinkStatus(store.getState())).toBe(status)
    }
  })

  it('a later setRelayLinkStatus replaces the held status — most recent wins, whole-value replace', () => {
    const store = createRelayLinkStore()
    store.getState().setRelayLinkStatus('connected')
    store.getState().setRelayLinkStatus('offline')
    expect(selectRelayLinkStatus(store.getState())).toBe('offline')
  })

  it('keeps two stores independent (DI)', () => {
    const a = createRelayLinkStore()
    const b = createRelayLinkStore()
    a.getState().setRelayLinkStatus('connected')
    expect(selectRelayLinkStatus(a.getState())).toBe('connected')
    expect(selectRelayLinkStatus(b.getState())).toBeNull()
  })

  it('starts from an injected initial state (DI)', () => {
    const store = createRelayLinkStore({ status: 'daemon-absent', statuses: new Map() })
    expect(selectRelayLinkStatus(store.getState())).toBe('daemon-absent')
  })

  it('initialRelayLinkState is a null status over an empty index', () => {
    expect(initialRelayLinkState).toEqual({ status: null, statuses: new Map() })
  })

  it('keeps the setRelayLinkStatus reference stable across updates', () => {
    const store = createRelayLinkStore()
    const before = store.getState().setRelayLinkStatus
    store.getState().setRelayLinkStatus('connected')
    expect(store.getState().setRelayLinkStatus).toBe(before)
  })
})

// ---------------------------------------------------------------------------------------------
// One slot per server (#1134). The app-wide cell above keeps every one of its assertions; these
// cover the index beside it, which is what makes one machine's relay socket dropping read as that
// machine's link being down rather than as the whole app's.
// ---------------------------------------------------------------------------------------------

const A = 'srv-a'
const B = 'srv-b'

describe('relayLinkStore — one slot per server (#1134)', () => {
  it('keeps two servers independent — a write for one leaves the other untouched (AC1)', () => {
    const store = createRelayLinkStore()
    store.getState().setRelayLinkStatus('connected', A)
    store.getState().setRelayLinkStatus('offline', B)

    expect(selectRelayLinkStatusFor(A)(store.getState())).toBe('connected')
    expect(selectRelayLinkStatusFor(B)(store.getState())).toBe('offline')
  })

  it('an offline for one server leaves a connected server connected (AC1)', () => {
    // The direction that would have been wrong before: with one cell, B's link going down took A's
    // reading with it, and on a healthy socket A's next status change is never.
    const store = createRelayLinkStore()
    store.getState().setRelayLinkStatus('connected', A)
    store.getState().setRelayLinkStatus('offline', B)
    store.getState().setRelayLinkStatus('daemon-absent', B)

    expect(selectRelayLinkStatusFor(A)(store.getState())).toBe('connected')
    expect(selectRelayLinkStatusFor(B)(store.getState())).toBe('daemon-absent')
  })

  it('tells a server that has not reported from one that has (AC2)', () => {
    const store = createRelayLinkStore()
    expect(selectRelayLinkStatusFor(A)(store.getState())).toBeUndefined()

    store.getState().setRelayLinkStatus('offline', A)
    expect(selectRelayLinkStatusFor(A)(store.getState())).toBe('offline')
    // ...and an origin nothing wrote still reads not-heard-from, next to one that did.
    expect(selectRelayLinkStatusFor(B)(store.getState())).toBeUndefined()
  })

  it('keeps the present-null origin and the absent origin in separate slots', () => {
    // A PRESENT null is the not-paired stand-in's origin (`connectionRegistry` builds it with
    // `serverId: null` and dials it like any other); an ABSENT one is a producer that never went
    // through a binding. Coalescing them would erase the one distinction the key domain exists for.
    const store = createRelayLinkStore()
    store.getState().setRelayLinkStatus('connected', null)
    store.getState().setRelayLinkStatus('offline')

    expect(selectRelayLinkStatusFor(null)(store.getState())).toBe('connected')
    expect(selectRelayLinkStatusFor(undefined)(store.getState())).toBe('offline')
  })

  it('an origin-less write still files, under the unstamped slot (the write stays total)', () => {
    const store = createRelayLinkStore()
    store.getState().setRelayLinkStatus('daemon-absent')

    expect(selectRelayLinkStatusFor(undefined)(store.getState())).toBe('daemon-absent')
    expect(selectRelayLinkStatus(store.getState())).toBe('daemon-absent')
  })

  it('the app-wide read is the most recently written status, and starts null (AC3)', () => {
    const store = createRelayLinkStore()
    expect(selectRelayLinkStatus(store.getState())).toBeNull()

    store.getState().setRelayLinkStatus('connected', A)
    expect(selectRelayLinkStatus(store.getState())).toBe('connected')
    store.getState().setRelayLinkStatus('offline', B)
    expect(selectRelayLinkStatus(store.getState())).toBe('offline')
    store.getState().setRelayLinkStatus('daemon-absent', A)
    expect(selectRelayLinkStatus(store.getState())).toBe('daemon-absent')
  })

  it('with one server paired the app-wide read is identical to the unkeyed store’s (AC3)', () => {
    // The sidebar's relay dot reads this value and nothing else, so "identical at every point"
    // is the whole of criterion 3 for its one production consumer.
    const store = createRelayLinkStore()
    const seen: (string | null)[] = [selectRelayLinkStatus(store.getState())]
    for (const status of ['connected', 'offline', 'daemon-absent'] as const) {
      store.getState().setRelayLinkStatus(status, A)
      seen.push(selectRelayLinkStatus(store.getState()))
    }
    expect(seen).toEqual([null, 'connected', 'offline', 'daemon-absent'])
  })

  it('writes copy-on-write — the previously held index is never mutated', () => {
    const store = createRelayLinkStore()
    store.getState().setRelayLinkStatus('connected', A)
    const before = store.getState().statuses
    store.getState().setRelayLinkStatus('offline', B)
    const after = store.getState().statuses

    expect(after).not.toBe(before)
    expect(before.get(B)).toBeUndefined()
    expect(before.get(A)).toBe('connected')
    // An untouched server's slot survives the copy by value.
    expect(after.get(A)).toBe('connected')
  })

  it('gives a __proto__ origin its own slot and inherits nothing from Object.prototype', () => {
    // A bare-object index would take this write into the prototype chain. ServerOrigin's header
    // rules the index a Map for exactly this reason; asserted rather than assumed.
    const store = createRelayLinkStore()
    store.getState().setRelayLinkStatus('offline', '__proto__')
    const { statuses } = store.getState()

    expect(statuses.get('__proto__')).toBe('offline')
    expect(statuses.get('toString')).toBeUndefined()
    expect(Object.getPrototypeOf(statuses)).toBe(Map.prototype)
  })

  it('keeps two stores’ indexes independent (DI)', () => {
    const a = createRelayLinkStore()
    const b = createRelayLinkStore()
    a.getState().setRelayLinkStatus('connected', A)

    expect(selectRelayLinkStatusFor(A)(a.getState())).toBe('connected')
    expect(selectRelayLinkStatusFor(A)(b.getState())).toBeUndefined()
  })
})
