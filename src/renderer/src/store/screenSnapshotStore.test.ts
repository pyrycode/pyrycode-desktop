import { describe, it, expect } from 'vitest'
import {
  createScreenSnapshotStore,
  initialScreenSnapshotState,
  selectScreenSnapshot,
  type ScreenSnapshot
} from './screenSnapshotStore'

// Plain-function store tests over isolated createScreenSnapshotStore() instances — the
// runConfigStore.test / conversationListStore.test idiom. No React, no bridge: the store is pure
// renderer state with a single set-on-event mutation. `text`/`ts` are held VERBATIM (untrusted
// daemon-relayed content; the plain-text rendering discipline belongs to #324) — no camelCase remap,
// no coercion, no validation.

const snapshot = (over: Partial<ScreenSnapshot> = {}): ScreenSnapshot => ({
  text: 'rendered screen',
  ts: '2026-07-10T12:00:00Z',
  ...over
})

describe('screenSnapshotStore', () => {
  it('starts not-loaded — snapshot is null (AC1)', () => {
    const store = createScreenSnapshotStore()
    expect(store.getState().snapshot).toBeNull()
    expect(selectScreenSnapshot(store.getState())).toBeNull()
  })

  it('setSnapshot records the snapshot; selectScreenSnapshot returns it (AC1)', () => {
    const store = createScreenSnapshotStore()
    const s = snapshot({ text: 'hi' })
    store.getState().setSnapshot(s)
    expect(selectScreenSnapshot(store.getState())).toEqual(s)
  })

  it('a later setSnapshot replaces the held snapshot — most recent wins, no merge (AC1)', () => {
    const store = createScreenSnapshotStore()
    store.getState().setSnapshot(snapshot({ text: 'old', ts: '2026-07-10T12:00:00Z' }))
    store.getState().setSnapshot(snapshot({ text: 'new', ts: '2026-07-10T12:01:00Z' }))
    expect(selectScreenSnapshot(store.getState())).toEqual({
      text: 'new',
      ts: '2026-07-10T12:01:00Z'
    })
  })

  it('holds an empty text verbatim — "" is a real held value, NOT null (AC1)', () => {
    const store = createScreenSnapshotStore()
    store.getState().setSnapshot(snapshot({ text: '' }))
    const held = selectScreenSnapshot(store.getState())
    expect(held).not.toBeNull()
    expect(held).toEqual({ text: '', ts: '2026-07-10T12:00:00Z' })
  })

  it('keeps two stores independent (DI)', () => {
    const a = createScreenSnapshotStore()
    const b = createScreenSnapshotStore()
    a.getState().setSnapshot(snapshot())
    expect(selectScreenSnapshot(a.getState())).not.toBeNull()
    expect(selectScreenSnapshot(b.getState())).toBeNull()
  })

  it('starts from an injected initial state (DI)', () => {
    const seed = snapshot({ text: 'seed' })
    const store = createScreenSnapshotStore({ snapshot: seed })
    expect(selectScreenSnapshot(store.getState())).toEqual(seed)
  })

  it('initialScreenSnapshotState is a null snapshot', () => {
    expect(initialScreenSnapshotState).toEqual({ snapshot: null })
  })

  it('keeps the setSnapshot reference stable across updates', () => {
    const store = createScreenSnapshotStore()
    const before = store.getState().setSnapshot
    store.getState().setSnapshot(snapshot())
    expect(store.getState().setSnapshot).toBe(before)
  })
})
