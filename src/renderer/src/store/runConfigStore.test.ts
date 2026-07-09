import { describe, it, expect } from 'vitest'
import {
  createRunConfigStore,
  initialRunConfigState,
  selectSnapshot,
  type RunConfigSnapshot
} from './runConfigStore'

// Plain-function store tests over isolated createRunConfigStore() instances — the sessionStore.test
// idiom. No React, no bridge: the store is pure renderer state with a single set-on-event mutation.
// The two usage figures (usedTokens / windowTokens, #192) are held verbatim like model/effort/yolo;
// their values are immaterial to these store-mechanics tests (0/0 unless the case is about them).

describe('runConfigStore', () => {
  it('starts with a null snapshot (nothing received yet)', () => {
    const store = createRunConfigStore()
    expect(store.getState().snapshot).toBeNull()
    expect(selectSnapshot(store.getState())).toBeNull()
  })

  it('setSnapshot records the snapshot; selectSnapshot returns it (AC3)', () => {
    const store = createRunConfigStore()
    const snap: RunConfigSnapshot = {
      model: 'claude-x',
      effort: 'high',
      yolo: true,
      usedTokens: 146000,
      windowTokens: 200000
    }
    store.getState().setSnapshot(snap)
    expect(selectSnapshot(store.getState())).toEqual(snap)
  })

  it('holds the two usage figures verbatim — not coerced (AC3, #192 fields)', () => {
    const store = createRunConfigStore()
    store
      .getState()
      .setSnapshot({ model: '', effort: '', yolo: false, usedTokens: 146000, windowTokens: 200000 })
    const held = selectSnapshot(store.getState())
    expect(held?.usedTokens).toBe(146000)
    expect(held?.windowTokens).toBe(200000)
  })

  it('a later setSnapshot replaces the held value — most recent snapshot wins (AC4)', () => {
    const store = createRunConfigStore()
    store
      .getState()
      .setSnapshot({ model: 'a', effort: 'low', yolo: false, usedTokens: 10000, windowTokens: 200000 })
    store
      .getState()
      .setSnapshot({ model: 'b', effort: 'high', yolo: true, usedTokens: 20000, windowTokens: 200000 })
    expect(selectSnapshot(store.getState())).toEqual({
      model: 'b',
      effort: 'high',
      yolo: true,
      usedTokens: 20000,
      windowTokens: 200000
    })
  })

  it('holds empty model, empty effort, yolo:false, and windowTokens:0 verbatim — not null, not coerced (AC5)', () => {
    const store = createRunConfigStore()
    store.getState().setSnapshot({ model: '', effort: '', yolo: false, usedTokens: 0, windowTokens: 0 })
    const held = selectSnapshot(store.getState())
    expect(held).not.toBeNull()
    expect(held).toEqual({ model: '', effort: '', yolo: false, usedTokens: 0, windowTokens: 0 })
  })

  it('keeps two stores independent', () => {
    const a = createRunConfigStore()
    const b = createRunConfigStore()
    a.getState().setSnapshot({ model: 'a', effort: 'low', yolo: false, usedTokens: 0, windowTokens: 0 })
    expect(selectSnapshot(a.getState())).not.toBeNull()
    expect(selectSnapshot(b.getState())).toBeNull()
  })

  it('starts from an injected initial state (DI)', () => {
    const snap: RunConfigSnapshot = {
      model: 'm',
      effort: 'e',
      yolo: true,
      usedTokens: 5000,
      windowTokens: 100000
    }
    const store = createRunConfigStore({ snapshot: snap })
    expect(selectSnapshot(store.getState())).toEqual(snap)
  })

  it('initialRunConfigState is a null snapshot', () => {
    expect(initialRunConfigState).toEqual({ snapshot: null })
  })

  it('keeps the setSnapshot reference stable across updates', () => {
    const store = createRunConfigStore()
    const before = store.getState().setSnapshot
    store.getState().setSnapshot({ model: 'a', effort: 'low', yolo: false, usedTokens: 0, windowTokens: 0 })
    expect(store.getState().setSnapshot).toBe(before)
  })
})
