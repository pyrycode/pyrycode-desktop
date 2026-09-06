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
      permissionMode: 'bypassPermissions',
      usedTokens: 146000,
      windowTokens: 200000
    }
    store.getState().setSnapshot(snap)
    expect(selectSnapshot(store.getState())).toEqual(snap)
  })

  it('holds the two usage figures verbatim — not coerced (AC3, #192 fields)', () => {
    const store = createRunConfigStore()
    store.getState().setSnapshot({
      model: '',
      effort: '',
      yolo: false,
      permissionMode: 'default',
      usedTokens: 146000,
      windowTokens: 200000
    })
    const held = selectSnapshot(store.getState())
    expect(held?.usedTokens).toBe(146000)
    expect(held?.windowTokens).toBe(200000)
  })

  it('holds the permission mode verbatim — not coerced, not derived from yolo (#1020)', () => {
    const store = createRunConfigStore()
    // `bypassPermissions` beside `yolo: false` is a pair a real daemon never sends — asserted here
    // precisely because the store must not reconcile them. It records what it was handed.
    store.getState().setSnapshot({
      model: '',
      effort: '',
      yolo: false,
      permissionMode: 'bypassPermissions',
      usedTokens: 0,
      windowTokens: 0
    })
    expect(selectSnapshot(store.getState())?.permissionMode).toBe('bypassPermissions')
  })

  it('holds permissionMode: "" (no session resolved) verbatim — not a mode, not null (#1020)', () => {
    const store = createRunConfigStore()
    // The all-zero reply's reading. `snapshot: null` is the distinct "nothing loaded" state, so a
    // held `''` must stay a real snapshot carrying a real `''` rather than collapsing into either.
    store.getState().setSnapshot({
      model: '',
      effort: '',
      yolo: false,
      permissionMode: '',
      usedTokens: 0,
      windowTokens: 0
    })
    const held = selectSnapshot(store.getState())
    expect(held).not.toBeNull()
    expect(held?.permissionMode).toBe('')
  })

  it('a later setSnapshot replaces the held value — most recent snapshot wins (AC4)', () => {
    const store = createRunConfigStore()
    store.getState().setSnapshot({
      model: 'a',
      effort: 'low',
      yolo: false,
      permissionMode: 'default',
      usedTokens: 10000,
      windowTokens: 200000
    })
    store.getState().setSnapshot({
      model: 'b',
      effort: 'high',
      yolo: true,
      permissionMode: 'bypassPermissions',
      usedTokens: 20000,
      windowTokens: 200000
    })
    expect(selectSnapshot(store.getState())).toEqual({
      model: 'b',
      effort: 'high',
      yolo: true,
      permissionMode: 'bypassPermissions',
      usedTokens: 20000,
      windowTokens: 200000
    })
  })

  it('holds empty model, empty effort, yolo:false, and windowTokens:0 verbatim — not null, not coerced (AC5)', () => {
    const store = createRunConfigStore()
    const zeros = {
      model: '',
      effort: '',
      yolo: false,
      permissionMode: '',
      usedTokens: 0,
      windowTokens: 0
    }
    store.getState().setSnapshot(zeros)
    const held = selectSnapshot(store.getState())
    expect(held).not.toBeNull()
    expect(held).toEqual(zeros)
  })

  it('keeps two stores independent', () => {
    const a = createRunConfigStore()
    const b = createRunConfigStore()
    a.getState().setSnapshot({
      model: 'a',
      effort: 'low',
      yolo: false,
      permissionMode: 'default',
      usedTokens: 0,
      windowTokens: 0
    })
    expect(selectSnapshot(a.getState())).not.toBeNull()
    expect(selectSnapshot(b.getState())).toBeNull()
  })

  it('starts from an injected initial state (DI)', () => {
    const snap: RunConfigSnapshot = {
      model: 'm',
      effort: 'e',
      yolo: true,
      permissionMode: 'bypassPermissions',
      usedTokens: 5000,
      windowTokens: 100000
    }
    const store = createRunConfigStore({ snapshot: snap })
    expect(selectSnapshot(store.getState())).toEqual(snap)
  })

  it('initialRunConfigState is a null snapshot', () => {
    expect(initialRunConfigState).toEqual({ snapshot: null })
  })

  it('clearSnapshot returns a populated store to "nothing received yet" (#1167)', () => {
    const store = createRunConfigStore({
      snapshot: {
        model: 'opus',
        effort: 'high',
        yolo: true,
        permissionMode: 'bypassPermissions',
        usedTokens: 146000,
        windowTokens: 200000
      }
    })
    store.getState().clearSnapshot()
    // Back to the DISTINCT not-loaded state, not to an all-zero snapshot: `''`/`false`/`0` are real
    // readings the daemon sends, and every control that draws its not-known rendering keys on the
    // fall-through a null snapshot produces, not on the zeros.
    expect(selectSnapshot(store.getState())).toBeNull()
    expect(store.getState()).toMatchObject(initialRunConfigState)
  })

  it('clearSnapshot on an already-clear store is a no-op (#1167)', () => {
    const store = createRunConfigStore()
    store.getState().clearSnapshot()
    expect(selectSnapshot(store.getState())).toBeNull()
  })

  it('a cleared store still records the next snapshot (#1167)', () => {
    // The clear is a lifetime move, not a latch: the newly opened conversation's own reply must land
    // in a store that has been cleared moments before, which is the ONLY sequence production runs.
    const store = createRunConfigStore()
    store.getState().clearSnapshot()
    const next: RunConfigSnapshot = {
      model: 'sonnet',
      effort: 'low',
      yolo: false,
      permissionMode: 'default',
      usedTokens: 1000,
      windowTokens: 200000
    }
    store.getState().setSnapshot(next)
    expect(selectSnapshot(store.getState())).toEqual(next)
  })

  it('keeps two stores independent across a clear (#1167)', () => {
    const a = createRunConfigStore({
      snapshot: {
        model: 'a',
        effort: 'low',
        yolo: false,
        permissionMode: 'default',
        usedTokens: 0,
        windowTokens: 0
      }
    })
    const b = createRunConfigStore({
      snapshot: {
        model: 'b',
        effort: 'high',
        yolo: true,
        permissionMode: 'plan',
        usedTokens: 0,
        windowTokens: 0
      }
    })
    a.getState().clearSnapshot()
    expect(selectSnapshot(a.getState())).toBeNull()
    expect(selectSnapshot(b.getState())?.model).toBe('b')
  })

  it('keeps the setSnapshot reference stable across updates', () => {
    const store = createRunConfigStore()
    const before = store.getState().setSnapshot
    store.getState().setSnapshot({
      model: 'a',
      effort: 'low',
      yolo: false,
      permissionMode: 'default',
      usedTokens: 0,
      windowTokens: 0
    })
    expect(store.getState().setSnapshot).toBe(before)
  })
})
