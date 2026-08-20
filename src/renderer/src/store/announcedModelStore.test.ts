import { describe, it, expect } from 'vitest'
import {
  createAnnouncedModelStore,
  initialAnnouncedModelState,
  selectAnnouncedModel,
  type AnnouncedModel
} from './announcedModelStore'

// Plain-function store tests over isolated createAnnouncedModelStore() instances — the
// screenSnapshotStore.test / runConfigStore.test idiom. No React, no bridge: the store is pure renderer
// state with a single set-on-event mutation. `model` is held VERBATIM (untrusted, model-influenced
// daemon-relayed text; the plain-text-never-HTML rendering discipline belongs to #560) — no normalising,
// no lowercasing, no allow-list, no family regex, no shape check.

const announced = (over: Partial<AnnouncedModel> = {}): AnnouncedModel => ({
  model: 'claude-haiku-4-5-20251001',
  truncated: false,
  ...over
})

describe('announcedModelStore', () => {
  it('starts not-yet-announced — announced is null (AC4)', () => {
    const store = createAnnouncedModelStore()
    expect(store.getState().announced).toBeNull()
    expect(selectAnnouncedModel(store.getState())).toBeNull()
  })

  it('setAnnouncedModel records the announcement; selectAnnouncedModel returns it (AC1)', () => {
    const store = createAnnouncedModelStore()
    const a = announced()
    store.getState().setAnnouncedModel(a)
    expect(selectAnnouncedModel(store.getState())).toEqual({
      model: 'claude-haiku-4-5-20251001',
      truncated: false
    })
  })

  it('a later announcement wholly replaces the held one — no merge (AC3)', () => {
    const store = createAnnouncedModelStore()
    store.getState().setAnnouncedModel(announced({ model: 'old-model', truncated: true }))
    store.getState().setAnnouncedModel(announced({ model: 'new-model', truncated: false }))
    expect(selectAnnouncedModel(store.getState())).toEqual({
      model: 'new-model',
      truncated: false
    })
  })

  it('writes a verbatim repeat again rather than deduping it (AC3)', () => {
    const store = createAnnouncedModelStore()
    store.getState().setAnnouncedModel(announced({ model: 'same-model' }))
    const first = selectAnnouncedModel(store.getState())
    store.getState().setAnnouncedModel(announced({ model: 'same-model' }))
    const second = selectAnnouncedModel(store.getState())
    expect(second).toEqual(first)
    expect(second).toEqual({ model: 'same-model', truncated: false })
  })

  it('holds an empty identifier as a REAL record, not null (AC4 empty-string arm)', () => {
    const store = createAnnouncedModelStore()
    store.getState().setAnnouncedModel(announced({ model: '' }))
    const held = selectAnnouncedModel(store.getState())
    expect(held).not.toBeNull()
    expect(held?.model).toBe('')
    expect(held).toEqual({ model: '', truncated: false })
  })

  it('holds an identifier that appears in no published model list byte-for-byte (AC1)', () => {
    const store = createAnnouncedModelStore()
    // claude echoes an identifier at least as specific as the one it was given: `claude-haiku-4-5`
    // announces back undated and appears in no published list. A lookup miss is #560's ordinary case;
    // the store must not date-stamp, family-map, or allow-list it away.
    store.getState().setAnnouncedModel(announced({ model: 'claude-haiku-4-5' }))
    expect(selectAnnouncedModel(store.getState())?.model).toBe('claude-haiku-4-5')
  })

  it('holds mixed case, underscores, dots and a control character byte-for-byte (AC1)', () => {
    const store = createAnnouncedModelStore()
    // No normalising and no lowercasing. The control character / terminal escape is held as-is because
    // the escaping obligation belongs to the DOM sink (#560), not to this holder.
    const raw = 'Claude_Opus.4-5_BETA\u001b[31m\u0007'
    store.getState().setAnnouncedModel(announced({ model: raw }))
    expect(selectAnnouncedModel(store.getState())?.model).toBe(raw)
  })

  it('holds truncated: true alongside the identifier (AC2)', () => {
    const store = createAnnouncedModelStore()
    store.getState().setAnnouncedModel(announced({ model: 'claude-opus-4-5-2025', truncated: true }))
    expect(selectAnnouncedModel(store.getState())).toEqual({
      model: 'claude-opus-4-5-2025',
      truncated: true
    })
  })

  it('a write differing only in truncated replaces — the report is not sticky (AC2)', () => {
    const store = createAnnouncedModelStore()
    store.getState().setAnnouncedModel(announced({ model: 'claude-opus-4-5', truncated: true }))
    store.getState().setAnnouncedModel(announced({ model: 'claude-opus-4-5', truncated: false }))
    expect(selectAnnouncedModel(store.getState())).toEqual({
      model: 'claude-opus-4-5',
      truncated: false
    })
  })

  it('keeps two stores independent (DI)', () => {
    const a = createAnnouncedModelStore()
    const b = createAnnouncedModelStore()
    a.getState().setAnnouncedModel(announced())
    expect(selectAnnouncedModel(a.getState())).not.toBeNull()
    expect(selectAnnouncedModel(b.getState())).toBeNull()
  })

  it('starts from an injected initial state (DI)', () => {
    const seed = announced({ model: 'seeded-model', truncated: true })
    const store = createAnnouncedModelStore({ announced: seed })
    expect(selectAnnouncedModel(store.getState())).toEqual(seed)
  })

  it('initialAnnouncedModelState is a null announcement', () => {
    expect(initialAnnouncedModelState).toEqual({ announced: null })
  })

  it('keeps the setAnnouncedModel reference stable across updates', () => {
    const store = createAnnouncedModelStore()
    const before = store.getState().setAnnouncedModel
    store.getState().setAnnouncedModel(announced())
    expect(store.getState().setAnnouncedModel).toBe(before)
  })

  it('clearAnnouncedModel returns a held announcement to not-yet-announced (#593 AC1)', () => {
    const store = createAnnouncedModelStore({ announced: announced({ model: 'model-on-A' }) })
    store.getState().clearAnnouncedModel()
    expect(store.getState().announced).toBeNull()
    expect(selectAnnouncedModel(store.getState())).toBeNull()
  })

  it('clearAnnouncedModel drops a degenerate empty-identifier record to null, not to that record (#593 AC1)', () => {
    // The one case that distinguishes the two sentinels the store deliberately keeps apart: a received
    // `{ model: '', truncated: false }` is a REAL announcement while held, but the pairing-ended state is
    // the freshly-launched `null` — never an announcement carrying an empty identifier.
    const store = createAnnouncedModelStore({ announced: { model: '', truncated: false } })
    store.getState().clearAnnouncedModel()
    expect(selectAnnouncedModel(store.getState())).toBeNull()
  })

  it('clearAnnouncedModel is unconditional — clearing an already-clear store stays null (#593 AC3)', () => {
    const store = createAnnouncedModelStore()
    store.getState().clearAnnouncedModel()
    expect(selectAnnouncedModel(store.getState())).toBeNull()
    store.getState().clearAnnouncedModel()
    expect(selectAnnouncedModel(store.getState())).toBeNull()
  })

  it('a clear does not make the store one-shot — a later announcement records normally', () => {
    const store = createAnnouncedModelStore({ announced: announced({ model: 'model-on-A' }) })
    store.getState().clearAnnouncedModel()
    store.getState().setAnnouncedModel(announced({ model: 'model-on-B', truncated: true }))
    expect(selectAnnouncedModel(store.getState())).toEqual({
      model: 'model-on-B',
      truncated: true
    })
  })

  it('keeps the clearAnnouncedModel reference stable across updates', () => {
    const store = createAnnouncedModelStore()
    const before = store.getState().clearAnnouncedModel
    store.getState().setAnnouncedModel(announced())
    store.getState().clearAnnouncedModel()
    expect(store.getState().clearAnnouncedModel).toBe(before)
  })
})
