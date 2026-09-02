import { describe, it, expect } from 'vitest'
import type { WireModelOption } from '@shared/wire/types'
import {
  createModelListStore,
  selectModelListFor,
  initialModelListState
} from './modelListStore'

// Rows are transcribed from the measured entries pinned in `src/shared/wire/types.test.ts`'s
// `model-list wire vocabulary (#971)` block, so no test passes on a tidier list than the daemon sends:
// a `resolved_model` that arrives as the raw literal `<unmeasured>` on four of the five live rows, the
// two bracketed `value`s that nothing may split, a row reporting a cut `value`, and Haiku's row as the
// all-real case. Two rows are HAND-AUTHORED and labelled as such — no committed fixture carries a
// `truncated_fields: []` or one naming `effort_levels`, and both are needed to pin the distinctions
// this store must not collapse.
const defaultRow: WireModelOption = {
  resolved_model: '<unmeasured>',
  value: 'default',
  display_name: 'Default (recommended)',
  effort_levels: ['low', 'medium', 'high', 'xhigh', 'max'],
  supports_auto_mode: true,
  truncated_fields: null
}

const fable: WireModelOption = {
  resolved_model: '<unmeasured>',
  value: 'claude-fable-5[1m]',
  display_name: 'Fable',
  effort_levels: ['low', 'medium', 'high', 'xhigh', 'max'],
  supports_auto_mode: true,
  // A cut `value` is load-bearing rather than decoration: `value` is the one field a client sends
  // back, and a mid-token cut stays alphanumeric and is ACCEPTED, so the operator picks one row and
  // gets a different model with no error frame anywhere. The store must carry the report through.
  truncated_fields: ['value']
}

const haiku: WireModelOption = {
  resolved_model: 'claude-haiku-4-5-20251001',
  value: 'haiku',
  display_name: 'Haiku',
  // KNOWN none: an empty `effort_levels` with nothing reported cut means this model exposes no
  // effort control. Contrast `opusCutEffort` below, which reads UNKNOWN from the same `[]`.
  effort_levels: [],
  supports_auto_mode: false,
  truncated_fields: null
}

// HAND-AUTHORED: `truncated_fields` is exempt from the daemon's array normalisation, so `[]` and
// `null` are DISTINCT values on this field. Both appear here so a collapse in either direction reddens.
const sonnetEmptyCut: WireModelOption = {
  resolved_model: '<unmeasured>',
  value: 'sonnet',
  display_name: 'Sonnet',
  effort_levels: ['low', 'medium', 'high', 'xhigh', 'max'],
  supports_auto_mode: true,
  truncated_fields: []
}

// HAND-AUTHORED: the UNKNOWN case. The wire collapses absent, null and empty `effort_levels` into the
// same `[]`, so a `truncated_fields` naming `effort_levels` is the ONLY signal separating "cut to
// nothing, or shortened" from "this model exposes no effort control". Read as "none", a cut list
// silently removes an effort control the model actually supports — which is why #976 needs both this
// row and `haiku` to survive the store intact and distinguishable.
const opusCutEffort: WireModelOption = {
  resolved_model: '<unmeasured>',
  value: 'opus[1m]',
  display_name: 'Opus (1M context)',
  effort_levels: [],
  supports_auto_mode: true,
  truncated_fields: ['effort_levels']
}

describe('modelListStore', () => {
  it('holds one conversation’s published list, readable through the selector (AC1)', () => {
    const store = createModelListStore()
    store.getState().setModelList({
      conversationId: 'conv-1',
      models: [defaultRow, haiku],
      droppedModels: 2
    })

    expect(selectModelListFor('conv-1')(store.getState())).toEqual({
      models: [defaultRow, haiku],
      droppedModels: 2
    })
  })

  it('leaves every other conversation untouched, by reference (AC1)', () => {
    const store = createModelListStore()
    store
      .getState()
      .setModelList({ conversationId: 'conv-1', models: [defaultRow], droppedModels: 0 })
    const beforeA = selectModelListFor('conv-1')(store.getState())

    store.getState().setModelList({ conversationId: 'conv-2', models: [haiku], droppedModels: 7 })

    // Not merely equal: the SAME entry object, so a component watching conv-1 sees `Object.is` true
    // and does not re-render on a write for conv-2. A frame for one conversation can never replace or
    // merge into another's.
    expect(selectModelListFor('conv-1')(store.getState())).toBe(beforeA)
    expect(selectModelListFor('conv-2')(store.getState())).toEqual({
      models: [haiku],
      droppedModels: 7
    })
  })

  it('replaces a conversation’s list wholesale — nothing merges (AC1)', () => {
    const store = createModelListStore()
    store.getState().setModelList({
      conversationId: 'conv-1',
      models: [defaultRow, fable],
      droppedModels: 4
    })
    store.getState().setModelList({ conversationId: 'conv-1', models: [haiku], droppedModels: 0 })

    // The frame is a SNAPSHOT of the identities claude will run as right now, never a delta: a row
    // present only in the first frame is gone, and the drop count follows the newest frame rather
    // than accumulating across the two.
    expect(selectModelListFor('conv-1')(store.getState())).toEqual({
      models: [haiku],
      droppedModels: 0
    })
  })

  it('reads null for a conversation no frame has arrived for, and an empty ENTRY for one that published nothing (AC1)', () => {
    const store = createModelListStore()
    store
      .getState()
      .setModelList({ conversationId: 'published-nothing', models: [], droppedModels: 0 })

    // The two states in one test so neither assertion can pass vacuously. `models: []` is a POSITIVE
    // STATEMENT that claude offered nothing — the daemon normalises a nil slice, so it is never null;
    // an absent key is UNKNOWN. They must never both surface to a consumer as a bare empty list, which
    // is exactly what a `?? EMPTY_LIST` collapse in the selector would do, with no type error.
    expect(selectModelListFor('never-arrived')(store.getState())).toBeNull()
    const published = selectModelListFor('published-nothing')(store.getState())
    expect(published).not.toBeNull()
    expect(published).toEqual({ models: [], droppedModels: 0 })
  })

  it('an empty list still carries the frame’s own drop count (AC1, AC4)', () => {
    const store = createModelListStore()
    // Every row cut: the list is not empty, it is entirely dropped. A store that treated an empty
    // list as "no news" would lose the count that says so.
    store.getState().setModelList({ conversationId: 'conv-1', models: [], droppedModels: 12 })

    expect(selectModelListFor('conv-1')(store.getState())).toEqual({
      models: [],
      droppedModels: 12
    })
  })

  it('holds the rows VERBATIM — the same array and the same row objects (AC3)', () => {
    const store = createModelListStore()
    const models = [defaultRow, fable, haiku, sonnetEmptyCut, opusCutEffort]
    store.getState().setModelList({ conversationId: 'conv-1', models, droppedModels: 0 })

    const entry = selectModelListFor('conv-1')(store.getState())
    // Identity, not equality. No per-row mapping exists on this path, which is what makes "nothing is
    // normalised, lowercased, trimmed or shape-checked" true BY CONSTRUCTION rather than by a guard.
    // This assertion is the whole defence against someone introducing one later.
    expect(entry?.models).toBe(models)
    expect(entry?.models[0]).toBe(defaultRow)
    expect(entry?.models[4]).toBe(opusCutEffort)
  })

  it('preserves the daemon’s published order (AC3)', () => {
    const store = createModelListStore()
    store.getState().setModelList({
      conversationId: 'conv-1',
      models: [defaultRow, opusCutEffort, fable, sonnetEmptyCut, haiku],
      droppedModels: 2
    })

    // The list is cut FROM THE TAIL, so the rows carried are claude's first N in claude's own order.
    // Order is meaning: nothing may re-sort before a reader is told what was lost.
    expect(selectModelListFor('conv-1')(store.getState())?.models.map((row) => row.value)).toEqual([
      'default',
      'opus[1m]',
      'claude-fable-5[1m]',
      'sonnet',
      'haiku'
    ])
  })

  it('keeps each row’s own truncated_fields — null never collapsed into [], nothing hoisted across rows (AC3)', () => {
    const store = createModelListStore()
    const models = [defaultRow, fable, haiku, sonnetEmptyCut, opusCutEffort]
    store.getState().setModelList({ conversationId: 'conv-1', models, droppedModels: 0 })

    const rows = selectModelListFor('conv-1')(store.getState())?.models ?? []
    expect(rows.map((row) => row.truncated_fields)).toEqual([
      null, // nothing was cut for this row
      ['value'], // the field a client sends back, cut mid-token and still accepted
      null,
      [], // a DISTINCT value from null — `truncated_fields` is exempt from normalisation
      ['effort_levels'] // the only signal that this row's empty effort list means UNKNOWN, not "none"
    ])
    // No flattened "something was truncated" flag anywhere on the entry: a hoisted list would be one
    // no reader could attribute back to the row it describes, and the frame carries none either.
    expect(selectModelListFor('conv-1')(store.getState())).not.toHaveProperty('truncated_fields')
    expect(selectModelListFor('conv-1')(store.getState())).toEqual({ models, droppedModels: 0 })
  })

  it('holds every string field and every effort level untouched (AC3)', () => {
    const store = createModelListStore()
    store
      .getState()
      .setModelList({ conversationId: 'conv-1', models: [defaultRow, haiku], droppedModels: 0 })

    const rows = selectModelListFor('conv-1')(store.getState())?.models ?? []
    // `<unmeasured>` is a RAW literal, angle brackets and all — claude-authored text that means
    // "claude did not report a resolved identifier", never an identifier itself. It survives verbatim.
    expect(rows[0]).toEqual({
      resolved_model: '<unmeasured>',
      value: 'default',
      display_name: 'Default (recommended)',
      effort_levels: ['low', 'medium', 'high', 'xhigh', 'max'],
      supports_auto_mode: true,
      truncated_fields: null
    })
    // `supports_auto_mode: false` is a VALUE — claude refuses `auto` permission mode per model, and an
    // absent key in claude's reply decodes to `false`, which is the correct reading rather than a
    // missing one. #682 greys the mode out from it, so a store dropping it would grey nothing out.
    expect(rows[1].supports_auto_mode).toBe(false)
    expect(rows[1].effort_levels).toEqual([])
    expect(rows[1].resolved_model).toBe('claude-haiku-4-5-20251001')
  })

  it('holds a bracketed value verbatim and never parseable — nothing derives a family from it (AC3)', () => {
    const store = createModelListStore()
    store
      .getState()
      .setModelList({ conversationId: 'conv-1', models: [fable, opusCutEffort], droppedModels: 0 })

    // `value` is the ARGUMENT a client passes back, not a dated identifier: a literal (`default`), a
    // bare alias (`sonnet`), or a bracketed variant. Splitting it to derive a family or present it as
    // a version is the tempting mistake, so the brackets are asserted rather than only commented.
    const rows = selectModelListFor('conv-1')(store.getState())?.models ?? []
    expect(rows.map((row) => row.value)).toEqual(['claude-fable-5[1m]', 'opus[1m]'])
  })

  it('holds droppedModels: 0 as a VALUE, never as an absence (AC4)', () => {
    const store = createModelListStore()
    store
      .getState()
      .setModelList({ conversationId: 'conv-1', models: [defaultRow, haiku], droppedModels: 0 })

    const entry = selectModelListFor('conv-1')(store.getState())
    expect(entry?.droppedModels).toBe(0)
    expect(entry).toHaveProperty('droppedModels')
    // The list's true size is `models.length + droppedModels`, and the store carries both numbers so
    // a consumer CAN compute it. Nothing here recomputes the count from the number of rows carried,
    // reconciles the two, or treats a list of exactly ten as a signal — the ten-entry cap is a
    // daemon-side producer cap, not a wire constant.
    expect((entry?.models.length ?? 0) + (entry?.droppedModels ?? 0)).toBe(2)
  })

  it('carries a drop count beside a SHORT list — the length is never the truncation signal (AC4)', () => {
    const store = createModelListStore()
    // The committed upstream fixture does not satisfy the producer's own invariant (five rows beside
    // `dropped_models: 2`), because it pins shape rather than capturing live traffic. Trust the field,
    // not the length: a five-row list reporting two dropped is held exactly as it arrived.
    store.getState().setModelList({
      conversationId: 'conv-1',
      models: [defaultRow, opusCutEffort, fable, sonnetEmptyCut, haiku],
      droppedModels: 2
    })

    const entry = selectModelListFor('conv-1')(store.getState())
    expect(entry?.models).toHaveLength(5)
    expect(entry?.droppedModels).toBe(2)
  })

  it('starts empty and is copy-on-write — no map is mutated in place', () => {
    const store = createModelListStore()
    expect(store.getState().lists.size).toBe(0)
    expect(initialModelListState.lists.size).toBe(0)

    const beforeMap = store.getState().lists
    store
      .getState()
      .setModelList({ conversationId: 'conv-1', models: [defaultRow], droppedModels: 0 })

    expect(store.getState().lists).not.toBe(beforeMap)
    expect(beforeMap.size).toBe(0)
    // The exported initial state is shared by every instance, so a setter that mutated it would leak
    // one test's list into the next store — and, once #977's pairing clear returns this constant by
    // reference, would leak one pairing's rows into the next.
    expect(initialModelListState.lists.size).toBe(0)
  })

  it('keys the map by conversationId alone — no index is ever built from row text', () => {
    const store = createModelListStore()
    // `display_name` is claude-authored text, so `index[row.display_name] = row` with a `__proto__`
    // label would write through to Object.prototype. The rows stay an ARRAY and the one keyed
    // structure is the outer map, keyed by the routing key and by nothing else. A row carrying that
    // label is held like any other and alters no prototype.
    const hostile: WireModelOption = { ...defaultRow, display_name: '__proto__', value: '__proto__' }
    store.getState().setModelList({ conversationId: 'conv-1', models: [hostile], droppedModels: 0 })

    expect(selectModelListFor('conv-1')(store.getState())?.models[0]).toBe(hostile)
    expect(selectModelListFor('__proto__')(store.getState())).toBeNull()
    expect(Object.prototype).not.toHaveProperty('value')
    expect(({} as Record<string, unknown>).display_name).toBeUndefined()
  })

  it('accepts a seeded initial state (the DI factory)', () => {
    const store = createModelListStore({
      lists: new Map([['conv-1', { models: [defaultRow], droppedModels: 3 }]])
    })

    expect(selectModelListFor('conv-1')(store.getState())).toEqual({
      models: [defaultRow],
      droppedModels: 3
    })
    expect(selectModelListFor('conv-2')(store.getState())).toBeNull()
  })
})
