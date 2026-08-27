import { describe, it, expect } from 'vitest'
import { createHostLabelStore, initialHostLabelState, selectHostLabel } from './hostLabelStore'

// Plain-function store tests over isolated createHostLabelStore() instances — the serverInfoStore.test
// idiom. No React, no bridge: the store is pure renderer state with a single record-what-the-loader-
// mapped mutation. Unlike serverInfoStore's object-or-null, the held value is a FOUR-arm discriminated
// union nested under one field, where the three settled arms must stay mutually distinct — never-stored
// is not unreadable, and a stored empty label is neither (ADR 0005).

describe('hostLabelStore', () => {
  it('starts at the pre-settle loading arm (AC1)', () => {
    const store = createHostLabelStore()
    expect(selectHostLabel(store.getState())).toEqual({ status: 'loading' })
  })

  it('setHostLabel records a stored label; the selector returns it (AC1)', () => {
    const store = createHostLabelStore()
    store.getState().setHostLabel({ status: 'stored', label: 'pyrybox' })
    expect(selectHostLabel(store.getState())).toEqual({ status: 'stored', label: 'pyrybox' })
  })

  it('holds a stored EMPTY label as a stored label — not absence, not unreadable (AC2)', () => {
    const store = createHostLabelStore()
    store.getState().setHostLabel({ status: 'stored', label: '' })
    const held = selectHostLabel(store.getState())
    expect(held).toEqual({ status: 'stored', label: '' })
    expect(held).not.toEqual({ status: 'not-stored' })
    expect(held).not.toEqual({ status: 'error' })
  })

  it('keeps the three settled arms mutually distinct (AC2)', () => {
    const store = createHostLabelStore()

    store.getState().setHostLabel({ status: 'stored', label: 'pyrybox' })
    const stored = selectHostLabel(store.getState())
    expect(stored).not.toEqual({ status: 'not-stored' })
    expect(stored).not.toEqual({ status: 'error' })

    store.getState().setHostLabel({ status: 'not-stored' })
    const notStored = selectHostLabel(store.getState())
    expect(notStored).toEqual({ status: 'not-stored' })
    expect(notStored).not.toEqual({ status: 'error' })

    store.getState().setHostLabel({ status: 'error' })
    const error = selectHostLabel(store.getState())
    expect(error).toEqual({ status: 'error' })
    expect(error).not.toEqual({ status: 'not-stored' })
  })

  it('leaves no stale label key on a stored → not-stored transition (AC2)', () => {
    const store = createHostLabelStore()
    store.getState().setHostLabel({ status: 'stored', label: 'pyrybox' })
    store.getState().setHostLabel({ status: 'not-stored' })
    const held = selectHostLabel(store.getState())
    expect(held).not.toHaveProperty('label')
    expect(held).toEqual({ status: 'not-stored' })
  })

  it('leaves no stale label key on a stored → error transition (AC2)', () => {
    const store = createHostLabelStore()
    store.getState().setHostLabel({ status: 'stored', label: 'pyrybox' })
    store.getState().setHostLabel({ status: 'error' })
    const held = selectHostLabel(store.getState())
    expect(held).not.toHaveProperty('label')
    expect(held).toEqual({ status: 'error' })
  })

  it('keeps two stores independent (DI)', () => {
    const a = createHostLabelStore()
    const b = createHostLabelStore()
    a.getState().setHostLabel({ status: 'stored', label: 'pyrybox' })
    expect(selectHostLabel(a.getState())).toEqual({ status: 'stored', label: 'pyrybox' })
    expect(selectHostLabel(b.getState())).toEqual({ status: 'loading' })
  })

  it('starts from an injected initial state (DI)', () => {
    const store = createHostLabelStore({ hostLabel: { status: 'stored', label: 'seed' } })
    expect(selectHostLabel(store.getState())).toEqual({ status: 'stored', label: 'seed' })
  })

  it('initialHostLabelState is the loading arm', () => {
    expect(initialHostLabelState).toEqual({ hostLabel: { status: 'loading' } })
  })

  it('keeps the setHostLabel reference stable across updates', () => {
    const store = createHostLabelStore()
    const before = store.getState().setHostLabel
    store.getState().setHostLabel({ status: 'error' })
    expect(store.getState().setHostLabel).toBe(before)
  })
})
