import { describe, it, expect } from 'vitest'
import {
  createSessionIdStore,
  initialSessionIdState,
  selectSessionId
} from './sessionIdStore'

// Plain-function store tests over isolated createSessionIdStore() instances — the
// conversationListStore.test idiom. No React, no bridge: the store is pure renderer state with a
// single set-on-marker mutation. The held value is a bare routing-id string (no wire type, no
// camelCase remap), superseded whole-value by each later session_transition.

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
})
