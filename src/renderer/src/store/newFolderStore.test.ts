import { describe, it, expect } from 'vitest'
import {
  createNewFolderStore,
  initialNewFolderState,
  reduceNewFolder,
  selectNewFolderRoundTrip,
  type NewFolderState
} from './newFolderStore'

// Plain-function store tests over isolated createNewFolderStore() instances — the
// runSettingsWriteStore.test idiom. No React, no bridge: the store is pure renderer state driven by a
// sealed event union through one `dispatch`. The in-flight gate (AC3) lives in the pure reducer, so
// the gated no-ops are asserted directly against reduceNewFolder — including the same-object-reference
// identity zustand relies on to skip a notify.

const inFlight: NewFolderState = { roundTrip: { status: 'in-flight' } }
const created: NewFolderState = { roundTrip: { status: 'created', path: '/home/pyry/project' } }
const rejected: NewFolderState = { roundTrip: { status: 'rejected' } }

describe('newFolderStore reducer', () => {
  it('starts idle', () => {
    const store = createNewFolderStore()
    expect(selectNewFolderRoundTrip(store.getState())).toEqual({ status: 'idle' })
  })

  it('createRequested moves idle → in-flight (dialog-driven, ungated) (AC2)', () => {
    const store = createNewFolderStore()
    store.getState().dispatch({ type: 'createRequested' })
    expect(selectNewFolderRoundTrip(store.getState())).toEqual({ status: 'in-flight' })
  })

  it('createRequested moves rejected → in-flight (retry after a correction) (AC2)', () => {
    const store = createNewFolderStore(rejected)
    store.getState().dispatch({ type: 'createRequested' })
    expect(selectNewFolderRoundTrip(store.getState())).toEqual({ status: 'in-flight' })
  })

  it('folderCreated while in-flight → created, capturing path verbatim (AC2)', () => {
    const store = createNewFolderStore(inFlight)
    // A path with `..` and spaces is stored uncoerced — opaque display text, never fs-resolved.
    store.getState().dispatch({ type: 'folderCreated', path: '/home/pyry/../my project' })
    expect(selectNewFolderRoundTrip(store.getState())).toEqual({
      status: 'created',
      path: '/home/pyry/../my project'
    })
  })

  it('folderRejected while in-flight → rejected (bare) (AC2)', () => {
    const store = createNewFolderStore(inFlight)
    store.getState().dispatch({ type: 'folderRejected' })
    expect(selectNewFolderRoundTrip(store.getState())).toEqual({ status: 'rejected' })
  })

  it('reset moves created → idle with no stale path leaking (AC4, nesting invariant)', () => {
    const store = createNewFolderStore(created)
    store.getState().dispatch({ type: 'reset' })
    // The whole roundTrip object is swapped wholesale, so no `path` key survives the transition.
    expect(selectNewFolderRoundTrip(store.getState())).toEqual({ status: 'idle' })
  })

  it('reset moves every status → idle (AC4)', () => {
    for (const seed of [inFlight, created, rejected]) {
      const store = createNewFolderStore(seed)
      store.getState().dispatch({ type: 'reset' })
      expect(selectNewFolderRoundTrip(store.getState())).toEqual({ status: 'idle' })
    }
  })
})

describe('newFolderStore in-flight gate (AC3)', () => {
  // A daemon reply is honored ONLY while in-flight. Because workspaceFolderRejected is bare (no
  // correlation key), this gate is the sole guard against a stale or unsolicited reply flipping state.
  // A gated event must return the SAME state object so zustand's functional set skips the notify.

  it('folderCreated while idle is ignored — same state reference', () => {
    const next = reduceNewFolder(initialNewFolderState, { type: 'folderCreated', path: '/x' })
    expect(Object.is(next, initialNewFolderState)).toBe(true)
  })

  it('folderCreated while already created is ignored — same state reference', () => {
    const next = reduceNewFolder(created, { type: 'folderCreated', path: '/other' })
    expect(Object.is(next, created)).toBe(true)
  })

  it('folderRejected while idle is ignored — same state reference', () => {
    const next = reduceNewFolder(initialNewFolderState, { type: 'folderRejected' })
    expect(Object.is(next, initialNewFolderState)).toBe(true)
  })

  it('folderRejected while created is ignored — same state reference', () => {
    const next = reduceNewFolder(created, { type: 'folderRejected' })
    expect(Object.is(next, created)).toBe(true)
  })

  it('folderRejected while already rejected is ignored — same state reference', () => {
    const next = reduceNewFolder(rejected, { type: 'folderRejected' })
    expect(Object.is(next, rejected)).toBe(true)
  })
})

describe('selectNewFolderRoundTrip', () => {
  it('returns the roundTrip slice (the sole read surface, AC5)', () => {
    expect(selectNewFolderRoundTrip(created)).toBe(created.roundTrip)
  })
})

describe('newFolderStore DI + independence', () => {
  it('seeds from an injected initial state', () => {
    const store = createNewFolderStore(created)
    expect(selectNewFolderRoundTrip(store.getState())).toEqual({
      status: 'created',
      path: '/home/pyry/project'
    })
  })

  it('keeps two stores independent', () => {
    const a = createNewFolderStore()
    const b = createNewFolderStore()
    a.getState().dispatch({ type: 'createRequested' })
    expect(selectNewFolderRoundTrip(a.getState())).toEqual({ status: 'in-flight' })
    expect(selectNewFolderRoundTrip(b.getState())).toEqual({ status: 'idle' })
  })

  it('keeps the dispatch reference stable across updates', () => {
    const store = createNewFolderStore()
    const before = store.getState().dispatch
    store.getState().dispatch({ type: 'createRequested' })
    expect(store.getState().dispatch).toBe(before)
  })

  it('initialNewFolderState is idle', () => {
    expect(initialNewFolderState).toEqual({ roundTrip: { status: 'idle' } })
  })
})
