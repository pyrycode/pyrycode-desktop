import { describe, it, expect } from 'vitest'
import {
  createSessionIdStore,
  initialSessionIdState,
  selectSessionId
} from './sessionIdStore'

// Plain-function store tests over isolated createSessionIdStore() instances — the
// conversationListStore.test idiom. No React, no bridge: the store is pure renderer state with two
// independent whole-value writes — set-on-marker and clear-on-context-end (#529). The held value is a
// bare routing-id string (no wire type, no camelCase remap), superseded whole-value by each later
// session_transition and returned to the exported initial state by the clear.

describe('sessionIdStore', () => {
  it('starts not-seen — sessionId is null (AC1)', () => {
    const store = createSessionIdStore()
    expect(store.getState().sessionId).toBeNull()
    expect(selectSessionId(store.getState())).toBeNull()
  })

  it('setSessionId records the id; selectSessionId returns it (AC2)', () => {
    const store = createSessionIdStore()
    store.getState().setSessionId('s1')
    expect(selectSessionId(store.getState())).toBe('s1')
  })

  it('a later setSessionId replaces the held id — most recent wins, whole-value replace (AC2)', () => {
    const store = createSessionIdStore()
    store.getState().setSessionId('s1')
    store.getState().setSessionId('s2')
    expect(selectSessionId(store.getState())).toBe('s2')
  })

  it('holds an empty string verbatim — "" is a real id, NOT null (AC4)', () => {
    const store = createSessionIdStore()
    store.getState().setSessionId('')
    const held = selectSessionId(store.getState())
    expect(held).not.toBeNull()
    expect(held).toBe('')
  })

  it('keeps two stores independent (DI)', () => {
    const a = createSessionIdStore()
    const b = createSessionIdStore()
    a.getState().setSessionId('a')
    expect(selectSessionId(a.getState())).toBe('a')
    expect(selectSessionId(b.getState())).toBeNull()
  })

  it('starts from an injected initial state (DI)', () => {
    const store = createSessionIdStore({ sessionId: 'seed' })
    expect(selectSessionId(store.getState())).toBe('seed')
  })

  it('initialSessionIdState is a null id', () => {
    expect(initialSessionIdState).toEqual({ sessionId: null })
  })

  it('keeps the setSessionId reference stable across updates', () => {
    const store = createSessionIdStore()
    const before = store.getState().setSessionId
    store.getState().setSessionId('s1')
    expect(store.getState().setSessionId).toBe(before)
  })

  it('clearSessionId after a set yields the exported initial state (#529)', () => {
    const store = createSessionIdStore()
    store.getState().setSessionId('s1')
    store.getState().clearSessionId()
    // Asserted against the exported constant, not a literal — so this survives a second field.
    expect(store.getState()).toMatchObject(initialSessionIdState)
    expect(selectSessionId(store.getState())).toBeNull()
  })

  it('clearSessionId from the initial state is a no-op, not an error (#529)', () => {
    const store = createSessionIdStore()
    expect(() => store.getState().clearSessionId()).not.toThrow()
    expect(store.getState()).toMatchObject(initialSessionIdState)
    // A second consecutive clear is equally inert.
    store.getState().clearSessionId()
    expect(store.getState()).toMatchObject(initialSessionIdState)
  })

  it('clears an empty-string id too — "" is a real held id, and the clear returns to null (#529)', () => {
    const store = createSessionIdStore()
    store.getState().setSessionId('')
    store.getState().clearSessionId()
    expect(selectSessionId(store.getState())).toBeNull()
  })

  it('setSessionId still records after a clear — the clear does not damage the setter (#529)', () => {
    const store = createSessionIdStore()
    store.getState().setSessionId('s1')
    store.getState().clearSessionId()
    store.getState().setSessionId('s2')
    expect(selectSessionId(store.getState())).toBe('s2')
  })

  it('keeps two stores independent across a clear (DI, #529)', () => {
    const a = createSessionIdStore()
    const b = createSessionIdStore()
    a.getState().setSessionId('a')
    b.getState().setSessionId('b')
    a.getState().clearSessionId()
    expect(selectSessionId(a.getState())).toBeNull()
    expect(selectSessionId(b.getState())).toBe('b')
  })

  it('keeps the clearSessionId reference stable across updates (#529)', () => {
    const store = createSessionIdStore()
    const before = store.getState().clearSessionId
    store.getState().setSessionId('s1')
    store.getState().clearSessionId()
    expect(store.getState().clearSessionId).toBe(before)
  })
})
