import { describe, it, expect } from 'vitest'
import {
  createRunSettingsWriteStore,
  initialRunSettingsWriteState,
  selectEffectiveSettings,
  selectError,
  selectPendingFields,
  type RunSettingsWriteState,
  type SettingsChange
} from './runSettingsWriteStore'
import type { RunConfigSnapshot } from './runConfigStore'

// Plain-function store tests over isolated createRunSettingsWriteStore() instances — the
// runConfigStore.test idiom. No React, no bridge: the store is pure renderer state driven by a
// sealed event union through one `dispatch`. The pure `selectEffectiveSettings` derivation is
// asserted directly against a fake snapshot, mirroring how #187 tests its data path in isolation.

const snap: RunConfigSnapshot = {
  model: 'sonnet',
  effort: 'low',
  yolo: false,
  usedTokens: 0,
  windowTokens: 0
}

const change = (c: SettingsChange): SettingsChange => c

describe('runSettingsWriteStore reducer', () => {
  it('starts empty: no pending, no confirmed overrides, no error', () => {
    const store = createRunSettingsWriteStore()
    const s = store.getState()
    expect(s.pending.size).toBe(0)
    expect(s.confirmed).toEqual({})
    expect(selectError(s)).toBeNull()
  })

  it('changeDispatched records the pending change and optimistically reflects it; confirmed + snapshot base unchanged; error cleared (AC1)', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'model', value: 'opus' })
    })
    const s = store.getState()
    expect(s.pending.get('c1')).toEqual({ field: 'model', value: 'opus' })
    // Optimistic: the effective view shows the requested value...
    expect(selectEffectiveSettings(snap, s).model).toBe('opus')
    // ...while the last confirmed value is left unchanged (no override committed yet).
    expect(s.confirmed.model).toBeUndefined()
    expect(selectError(s)).toBeNull()
  })

  it('changeDispatched clears a prior rejection error (a fresh attempt supersedes it)', () => {
    const store = createRunSettingsWriteStore({
      pending: new Map(),
      confirmed: {},
      error: 'effort'
    })
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'model', value: 'opus' })
    })
    expect(selectError(store.getState())).toBeNull()
  })

  it('settingsConfirmed with a matching changeId commits the SENT value into confirmed and clears the pending marker (AC2)', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'effort', value: 'high' })
    })
    store.getState().dispatch({ type: 'settingsConfirmed', changeId: 'c1' })
    const s = store.getState()
    expect(s.pending.has('c1')).toBe(false)
    expect(s.confirmed.effort).toBe('high')
    // The effective view still shows the value after the pending marker clears (now via confirmed).
    expect(selectEffectiveSettings(snap, s).effort).toBe('high')
  })

  it('settingsRejected with a matching changeId rolls the view back and raises the field error; no optimistic value survives (AC3)', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'yolo', value: true })
    })
    // Optimistic overlay is visible before rejection.
    expect(selectEffectiveSettings(snap, store.getState()).yolo).toBe(true)

    store.getState().dispatch({ type: 'settingsRejected', changeId: 'c1' })
    const s = store.getState()
    expect(s.pending.has('c1')).toBe(false)
    expect(s.confirmed.yolo).toBeUndefined()
    expect(selectError(s)).toBe('yolo')
    // Rolled back to the snapshot base (no optimistic value survives the failure).
    expect(selectEffectiveSettings(snap, s).yolo).toBe(false)
  })

  it('settingsConfirmed with a non-matching changeId is a no-op — no commit (AC4 fail-closed)', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'model', value: 'opus' })
    })
    store.getState().dispatch({ type: 'settingsConfirmed', changeId: 'other' })
    const s = store.getState()
    expect(s.pending.has('c1')).toBe(true) // still pending — nothing resolved
    expect(s.confirmed.model).toBeUndefined() // nothing committed
    expect(selectError(s)).toBeNull()
  })

  it('settingsRejected with a non-matching changeId is a no-op — no rollback, error unchanged (AC4 fail-closed)', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'model', value: 'opus' })
    })
    store.getState().dispatch({ type: 'settingsRejected', changeId: 'stale' })
    const s = store.getState()
    expect(s.pending.has('c1')).toBe(true)
    expect(selectError(s)).toBeNull()
    expect(selectEffectiveSettings(snap, s).model).toBe('opus') // overlay intact
  })

  it('tells two outstanding changes apart by changeId: confirming one resolves only its change (AC4)', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'model', value: 'opus' })
    })
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c2',
      change: change({ field: 'effort', value: 'high' })
    })
    store.getState().dispatch({ type: 'settingsConfirmed', changeId: 'c1' })
    const s = store.getState()
    expect(s.pending.has('c1')).toBe(false)
    expect(s.confirmed.model).toBe('opus')
    // The other change stays pending with its optimistic overlay intact.
    expect(s.pending.has('c2')).toBe(true)
    expect(selectEffectiveSettings(snap, s).effort).toBe('high')
    expect(s.confirmed.effort).toBeUndefined()
  })

  it('two outstanding changes to the SAME field: the effective view shows the last-dispatched value', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'model', value: 'opus' })
    })
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c2',
      change: change({ field: 'model', value: 'haiku' })
    })
    expect(selectEffectiveSettings(snap, store.getState()).model).toBe('haiku')
  })

  it('same-field changes resolve to the correct confirmed value regardless of resolution order', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'model', value: 'opus' })
    })
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c2',
      change: change({ field: 'model', value: 'haiku' })
    })
    // Resolve the FIRST-dispatched one first; the second's overlay must still win the view.
    store.getState().dispatch({ type: 'settingsConfirmed', changeId: 'c1' })
    expect(selectEffectiveSettings(snap, store.getState()).model).toBe('haiku')
    // Then resolve the second; confirmed lands haiku and no pending overlay remains.
    store.getState().dispatch({ type: 'settingsConfirmed', changeId: 'c2' })
    const s = store.getState()
    expect(s.confirmed.model).toBe('haiku')
    expect(s.pending.size).toBe(0)
    expect(selectEffectiveSettings(snap, s).model).toBe('haiku')
  })
})

describe('selectEffectiveSettings composition', () => {
  it('precedence per field: pending overlay > confirmed override > snapshot base', () => {
    const state: RunSettingsWriteState = {
      pending: new Map([['c1', { field: 'model', value: 'pending-model' }]]),
      confirmed: { model: 'confirmed-model', effort: 'confirmed-effort' },
      error: null
    }
    const effective = selectEffectiveSettings(snap, state)
    expect(effective.model).toBe('pending-model') // pending wins over confirmed + base
    expect(effective.effort).toBe('confirmed-effort') // confirmed wins over base
    expect(effective.yolo).toBe(snap.yolo) // falls through to snapshot base
  })

  it('holds empty-string and yolo:false overrides verbatim — never coerced', () => {
    const state: RunSettingsWriteState = {
      pending: new Map(),
      confirmed: { model: '', yolo: false },
      error: null
    }
    const nonEmptyBase: RunConfigSnapshot = { ...snap, model: 'sonnet', yolo: true }
    const effective = selectEffectiveSettings(nonEmptyBase, state)
    expect(effective.model).toBe('') // '' override held, not fallen-through to the base
    expect(effective.yolo).toBe(false) // false override held, not fallen-through to the base
  })

  it('falls to empty-string / empty-string / false when the snapshot is null', () => {
    const state: RunSettingsWriteState = { pending: new Map(), confirmed: {}, error: null }
    expect(selectEffectiveSettings(null, state)).toEqual({ model: '', effort: '', yolo: false })
  })
})

describe('selectPendingFields', () => {
  it('flags exactly the fields with an outstanding pending change', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'model', value: 'opus' })
    })
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c2',
      change: change({ field: 'yolo', value: true })
    })
    expect(selectPendingFields(store.getState())).toEqual({
      model: true,
      effort: false,
      yolo: true
    })
  })

  it('clears a field flag once its change resolves', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'model', value: 'opus' })
    })
    store.getState().dispatch({ type: 'settingsConfirmed', changeId: 'c1' })
    expect(selectPendingFields(store.getState()).model).toBe(false)
  })
})

describe('runSettingsWriteStore DI + independence', () => {
  it('seeds from an injected initial state', () => {
    const store = createRunSettingsWriteStore({
      pending: new Map([['c1', { field: 'effort', value: 'high' }]]),
      confirmed: { model: 'opus' },
      error: 'yolo'
    })
    const s = store.getState()
    expect(s.pending.get('c1')).toEqual({ field: 'effort', value: 'high' })
    expect(s.confirmed.model).toBe('opus')
    expect(selectError(s)).toBe('yolo')
  })

  it('keeps two stores independent', () => {
    const a = createRunSettingsWriteStore()
    const b = createRunSettingsWriteStore()
    a.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'model', value: 'opus' })
    })
    expect(a.getState().pending.size).toBe(1)
    expect(b.getState().pending.size).toBe(0)
  })

  it('keeps the dispatch reference stable across updates', () => {
    const store = createRunSettingsWriteStore()
    const before = store.getState().dispatch
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'model', value: 'opus' })
    })
    expect(store.getState().dispatch).toBe(before)
  })

  it('initialRunSettingsWriteState is empty', () => {
    expect(initialRunSettingsWriteState.pending.size).toBe(0)
    expect(initialRunSettingsWriteState.confirmed).toEqual({})
    expect(initialRunSettingsWriteState.error).toBeNull()
  })
})
