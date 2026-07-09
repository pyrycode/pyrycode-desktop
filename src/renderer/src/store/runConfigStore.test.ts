import { describe, it, expect } from 'vitest'
import {
  createRunConfigStore,
  initialRunConfigState,
  selectSnapshot,
  type RunConfigSnapshot
} from './runConfigStore'

// Plain-function store tests over isolated createRunConfigStore() instances — the sessionStore.test
// idiom. No React, no bridge: the store is pure renderer state with a single set-on-event mutation.

describe('runConfigStore', () => {
  it('starts with a null snapshot (nothing received yet)', () => {
    const store = createRunConfigStore()
    expect(store.getState().snapshot).toBeNull()
    expect(selectSnapshot(store.getState())).toBeNull()
  })

  it('setSnapshot records the snapshot; selectSnapshot returns it (AC3)', () => {
    const store = createRunConfigStore()
    const snap: RunConfigSnapshot = { model: 'claude-x', effort: 'high', yolo: true }
    store.getState().setSnapshot(snap)
    expect(selectSnapshot(store.getState())).toEqual(snap)
  })

  it('a later setSnapshot replaces the held value — most recent snapshot wins (AC4)', () => {
    const store = createRunConfigStore()
    store.getState().setSnapshot({ model: 'a', effort: 'low', yolo: false })
    store.getState().setSnapshot({ model: 'b', effort: 'high', yolo: true })
    expect(selectSnapshot(store.getState())).toEqual({ model: 'b', effort: 'high', yolo: true })
  })

  it('holds empty model, empty effort, and yolo:false verbatim — not null, not coerced (AC5)', () => {
    const store = createRunConfigStore()
    store.getState().setSnapshot({ model: '', effort: '', yolo: false })
    const held = selectSnapshot(store.getState())
    expect(held).not.toBeNull()
    expect(held).toEqual({ model: '', effort: '', yolo: false })
  })

  it('keeps two stores independent', () => {
    const a = createRunConfigStore()
    const b = createRunConfigStore()
    a.getState().setSnapshot({ model: 'a', effort: 'low', yolo: false })
    expect(selectSnapshot(a.getState())).not.toBeNull()
    expect(selectSnapshot(b.getState())).toBeNull()
  })

  it('starts from an injected initial state (DI)', () => {
    const snap: RunConfigSnapshot = { model: 'm', effort: 'e', yolo: true }
    const store = createRunConfigStore({ snapshot: snap })
    expect(selectSnapshot(store.getState())).toEqual(snap)
  })

  it('initialRunConfigState is a null snapshot', () => {
    expect(initialRunConfigState).toEqual({ snapshot: null })
  })

  it('keeps the setSnapshot reference stable across updates', () => {
    const store = createRunConfigStore()
    const before = store.getState().setSnapshot
    store.getState().setSnapshot({ model: 'a', effort: 'low', yolo: false })
    expect(store.getState().setSnapshot).toBe(before)
  })
})
