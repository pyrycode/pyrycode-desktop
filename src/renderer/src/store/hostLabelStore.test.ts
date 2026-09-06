import { describe, it, expect } from 'vitest'
import { createHostLabelStore, initialHostLabelState, selectHostLabelFor } from './hostLabelStore'

// Plain-function store tests over isolated createHostLabelStore() instances — the serverInfoStore.test
// idiom. No React, no bridge: the store is pure renderer state with a single record-what-the-loader-
// mapped mutation. The held value is a FOUR-arm discriminated union nested under one field, where the
// three settled arms must stay mutually distinct — never-stored is not unreadable, and a stored empty
// label is neither (ADR 0005).
//
// #1199 re-keyed the slot by server id, so the arm tests below are joined by two of their own: one
// server's write must leave every other server's held value REFERENTIALLY identical (AC1), and a slot
// nothing has been read for must answer the created-in arm rather than a neighbour's value.

const A = 'server-a'
const B = 'server-b'

describe('hostLabelStore', () => {
  it('answers the pre-settle loading arm for a server nothing has been read for (AC1)', () => {
    const store = createHostLabelStore()
    expect(selectHostLabelFor(A)(store.getState())).toEqual({ status: 'loading' })
  })

  it('answers the loading arm for the frame that names no server at all (AC5)', () => {
    // The sidebar's first render: `serverInfoStore` is empty, so the row has no id to read by. That
    // frame must collapse to the SAME created-in arm a not-yet-read server does, because `hostRowLabel`
    // turns both into the fallback word and AC5 pins the launch markup unchanged.
    const store = createHostLabelStore()
    expect(selectHostLabelFor(null)(store.getState())).toEqual({ status: 'loading' })
  })

  it('returns the SAME default reference on every call (narrow-slice correctness)', () => {
    // A fresh `{ status: 'loading' }` literal per call would make a `useSyncExternalStore` reader see a
    // new value on every store notification and re-render forever. The default is a shared constant.
    const store = createHostLabelStore()
    const first = selectHostLabelFor(A)(store.getState())
    expect(selectHostLabelFor(A)(store.getState())).toBe(first)
    expect(selectHostLabelFor(B)(store.getState())).toBe(first)
    expect(selectHostLabelFor(null)(store.getState())).toBe(first)
  })

  it('setHostLabelFor records a stored label under its own id; the selector returns it (AC1)', () => {
    const store = createHostLabelStore()
    store.getState().setHostLabelFor(A, { status: 'stored', label: 'pyrybox' })
    expect(selectHostLabelFor(A)(store.getState())).toEqual({ status: 'stored', label: 'pyrybox' })
  })

  it('leaves every other server referentially identical across a write (AC1)', () => {
    // The copy-on-write guarantee stated as an IDENTITY, not an equality: `Object.is` is what a narrow
    // slice compares, so a rebuilt-but-equal value would still re-render every other row.
    const store = createHostLabelStore()
    store.getState().setHostLabelFor(B, { status: 'stored', label: 'macbook' })
    const untouched = selectHostLabelFor(B)(store.getState())

    store.getState().setHostLabelFor(A, { status: 'stored', label: 'pyrybox' })

    expect(selectHostLabelFor(B)(store.getState())).toBe(untouched)
    expect(selectHostLabelFor(A)(store.getState())).toEqual({ status: 'stored', label: 'pyrybox' })
  })

  it('leaves an unread server on the loading arm when a named one resolves (AC3)', () => {
    // "A named machine and an unnamed one resolve independently" — the store half of it. Server B was
    // never read, so it must not inherit A's outcome.
    const store = createHostLabelStore()
    store.getState().setHostLabelFor(A, { status: 'stored', label: 'pyrybox' })
    expect(selectHostLabelFor(B)(store.getState())).toEqual({ status: 'loading' })
  })

  it('confines an error arm to the server it was written for (AC2)', () => {
    const store = createHostLabelStore()
    store.getState().setHostLabelFor(A, { status: 'stored', label: 'pyrybox' })
    store.getState().setHostLabelFor(B, { status: 'error' })
    expect(selectHostLabelFor(A)(store.getState())).toEqual({ status: 'stored', label: 'pyrybox' })
    expect(selectHostLabelFor(B)(store.getState())).toEqual({ status: 'error' })
  })

  it('holds a stored EMPTY label as a stored label — not absence, not unreadable (AC2)', () => {
    const store = createHostLabelStore()
    store.getState().setHostLabelFor(A, { status: 'stored', label: '' })
    const held = selectHostLabelFor(A)(store.getState())
    expect(held).toEqual({ status: 'stored', label: '' })
    expect(held).not.toEqual({ status: 'not-stored' })
    expect(held).not.toEqual({ status: 'error' })
  })

  it('keeps the three settled arms mutually distinct (AC2)', () => {
    const store = createHostLabelStore()

    store.getState().setHostLabelFor(A, { status: 'stored', label: 'pyrybox' })
    const stored = selectHostLabelFor(A)(store.getState())
    expect(stored).not.toEqual({ status: 'not-stored' })
    expect(stored).not.toEqual({ status: 'error' })

    store.getState().setHostLabelFor(A, { status: 'not-stored' })
    const notStored = selectHostLabelFor(A)(store.getState())
    expect(notStored).toEqual({ status: 'not-stored' })
    expect(notStored).not.toEqual({ status: 'error' })

    store.getState().setHostLabelFor(A, { status: 'error' })
    const error = selectHostLabelFor(A)(store.getState())
    expect(error).toEqual({ status: 'error' })
    expect(error).not.toEqual({ status: 'not-stored' })
  })

  it('leaves no stale label key on a stored → not-stored transition (AC2)', () => {
    const store = createHostLabelStore()
    store.getState().setHostLabelFor(A, { status: 'stored', label: 'pyrybox' })
    store.getState().setHostLabelFor(A, { status: 'not-stored' })
    const held = selectHostLabelFor(A)(store.getState())
    expect(held).not.toHaveProperty('label')
    expect(held).toEqual({ status: 'not-stored' })
  })

  it('leaves no stale label key on a stored → error transition (AC2)', () => {
    const store = createHostLabelStore()
    store.getState().setHostLabelFor(A, { status: 'stored', label: 'pyrybox' })
    store.getState().setHostLabelFor(A, { status: 'error' })
    const held = selectHostLabelFor(A)(store.getState())
    expect(held).not.toHaveProperty('label')
    expect(held).toEqual({ status: 'error' })
  })

  it('never lets one machine name reach another id, even mid-transition (AC1)', () => {
    // The nesting argument with a second machine to leak to: a flat `{ status, label? }` under zustand's
    // shallow merge would carry A's `label` into B's slot on B's value-free arm.
    const store = createHostLabelStore()
    store.getState().setHostLabelFor(A, { status: 'stored', label: 'pyrybox' })
    store.getState().setHostLabelFor(B, { status: 'not-stored' })
    expect(selectHostLabelFor(B)(store.getState())).not.toHaveProperty('label')
  })

  it('keeps two stores independent (DI)', () => {
    const a = createHostLabelStore()
    const b = createHostLabelStore()
    a.getState().setHostLabelFor(A, { status: 'stored', label: 'pyrybox' })
    expect(selectHostLabelFor(A)(a.getState())).toEqual({ status: 'stored', label: 'pyrybox' })
    expect(selectHostLabelFor(A)(b.getState())).toEqual({ status: 'loading' })
  })

  it('starts from an injected initial state (DI)', () => {
    const store = createHostLabelStore({
      byServer: new Map([[A, { status: 'stored', label: 'seed' } as const]])
    })
    expect(selectHostLabelFor(A)(store.getState())).toEqual({ status: 'stored', label: 'seed' })
  })

  it('does not mutate the injected initial map on a write (DI)', () => {
    // Copy-on-write, stated against the caller's own object: a shared `initialHostLabelState` is handed
    // to every default-constructed store, so an in-place `set` would bleed one test's write into the
    // next store built after it.
    const seed = new Map()
    const store = createHostLabelStore({ byServer: seed })
    store.getState().setHostLabelFor(A, { status: 'error' })
    expect(seed.size).toBe(0)
  })

  it('initialHostLabelState is an empty map', () => {
    expect(initialHostLabelState.byServer.size).toBe(0)
  })

  it('keeps the setHostLabelFor reference stable across updates', () => {
    const store = createHostLabelStore()
    const before = store.getState().setHostLabelFor
    store.getState().setHostLabelFor(A, { status: 'error' })
    expect(store.getState().setHostLabelFor).toBe(before)
  })
})
