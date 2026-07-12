import { describe, it, expect } from 'vitest'
import {
  createRelayLinkStore,
  initialRelayLinkState,
  selectRelayLinkStatus
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
    const store = createRelayLinkStore({ status: 'daemon-absent' })
    expect(selectRelayLinkStatus(store.getState())).toBe('daemon-absent')
  })

  it('initialRelayLinkState is a null status', () => {
    expect(initialRelayLinkState).toEqual({ status: null })
  })

  it('keeps the setRelayLinkStatus reference stable across updates', () => {
    const store = createRelayLinkStore()
    const before = store.getState().setRelayLinkStatus
    store.getState().setRelayLinkStatus('connected')
    expect(store.getState().setRelayLinkStatus).toBe(before)
  })
})
