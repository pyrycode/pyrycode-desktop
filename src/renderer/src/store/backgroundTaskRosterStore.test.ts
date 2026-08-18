import { describe, it, expect } from 'vitest'
import {
  createBackgroundTaskRosterStore,
  initialBackgroundTaskRosterState,
  selectRosterFor,
  type BackgroundTaskRosterEntry
} from './backgroundTaskRosterStore'
import type { BackgroundTask } from '@shared/wire/types'

// Plain-function store tests over isolated createBackgroundTaskRosterStore() instances — the
// queueStore.test idiom. No React, no bridge: the store is pure renderer state with one
// set-on-snapshot mutation and one reset. The held rows are the wire BackgroundTask[] held VERBATIM
// (snake_case), keyed by conversationId and superseded whole-value by each later roster (SNAPSHOT
// truth, not merge/append).
//
// The distinction this whole ticket turns on rides every read assertion: `null` means "no roster has
// ever arrived", an entry with `tasks: []` means "observed, nothing alive". The queueStore precedent
// collapses exactly this pair via `?? EMPTY_BACKLOG`, and cloning that collapse here would fail
// silently — hence the explicit `toBeNull()` / `not.toBeNull()` pairs below.

const noCut: BackgroundTask = {
  task_id: 't1',
  task_type: 'local_bash',
  description: 'grep -rn "a<b&c" .',
  truncated_fields: null
}
const cutDescription: BackgroundTask = {
  task_id: 't2',
  task_type: 'local_bash',
  description: 'npm test -- src/renderer',
  truncated_fields: ['description']
}

describe('backgroundTaskRosterStore', () => {
  it('starts with nothing observed — selectRosterFor returns null, not an empty entry (AC4)', () => {
    const store = createBackgroundTaskRosterStore()
    expect(store.getState().rosters.size).toBe(0)
    // `null` is the "no roster has ever arrived" reading, and it is a stable reference for free —
    // no EMPTY_* constant exists here, deliberately.
    expect(selectRosterFor('c1')(store.getState())).toBeNull()
  })

  it('records a roster; the rows come back verbatim by reference (AC1, AC2)', () => {
    const store = createBackgroundTaskRosterStore()
    const tasks: readonly BackgroundTask[] = [noCut, cutDescription]
    store.getState().setRoster({ conversationId: 'c1', tasks, droppedTasks: 0 })

    const held = selectRosterFor('c1')(store.getState())
    expect(held).not.toBeNull()
    // Same reference, same order, still snake_case — no copy, no coercion, no per-row remap.
    expect(held?.tasks).toBe(tasks)
    expect(held?.tasks[0].task_id).toBe('t1')
  })

  it('holds a fresh named-field entry — the write key never leaks into the held value', () => {
    const store = createBackgroundTaskRosterStore()
    const snapshot = { conversationId: 'c1', tasks: [noCut], droppedTasks: 0 }
    store.getState().setRoster(snapshot)

    const held = selectRosterFor('c1')(store.getState())
    // Not the snapshot object itself, and carrying exactly the two entry fields.
    expect(held).not.toBe(snapshot)
    expect(held).toEqual({ tasks: [noCut], droppedTasks: 0 })
    expect(Object.keys(held as BackgroundTaskRosterEntry).sort()).toEqual(['droppedTasks', 'tasks'])
  })

  it('a later roster replaces the held set wholesale — absence is the only removal path (AC1)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut, cutDescription], droppedTasks: 0 })
    store.getState().setRoster({ conversationId: 'c1', tasks: [cutDescription], droppedTasks: 0 })

    // `noCut` is gone: no merge, no append, no dedupe — the newest roster is the whole truth.
    expect(selectRosterFor('c1')(store.getState())?.tasks).toEqual([cutDescription])
  })

  it('keeps each conversation independent — a roster for one never clobbers another (AC1)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setRoster({ conversationId: 'c2', tasks: [cutDescription], droppedTasks: 1 })

    expect(selectRosterFor('c1')(store.getState())?.tasks).toEqual([noCut])
    expect(selectRosterFor('c2')(store.getState())?.tasks).toEqual([cutDescription])
  })

  it('leaves a foreign-key write reference-stable — a c2 roster does not churn a c1 watcher', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    const before = selectRosterFor('c1')(store.getState())
    store.getState().setRoster({ conversationId: 'c2', tasks: [cutDescription], droppedTasks: 0 })
    const after = selectRosterFor('c1')(store.getState())

    // Object.is true — the map is cloned but c1's entry object is untouched, so no re-render.
    expect(after).toBe(before)
  })

  it('records an empty roster as "observed, nothing alive" — never as never-observed (AC4)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setRoster({ conversationId: 'c1', tasks: [], droppedTasks: 0 })

    const held = selectRosterFor('c1')(store.getState())
    // Both halves of the pair the whole ticket turns on: NOT null (the roster was observed) and
    // empty (nothing is alive). The key is written, never deleted.
    expect(held).not.toBeNull()
    expect(held?.tasks).toEqual([])
    expect(store.getState().rosters.has('c1')).toBe(true)
  })

  it('tells observed-empty apart from never-observed through the read surface alone (AC4)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [], droppedTasks: 0 })

    expect(selectRosterFor('c1')(store.getState())).toEqual({ tasks: [], droppedTasks: 0 })
    expect(selectRosterFor('c2')(store.getState())).toBeNull()
  })

  it('holds droppedTasks alongside the rows — a capped roster reads apart (AC3)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setRoster({ conversationId: 'c2', tasks: [noCut], droppedTasks: 2 })

    // `0` is a value, never consulted for truthiness; the true roster size is tasks.length + dropped.
    expect(selectRosterFor('c1')(store.getState())?.droppedTasks).toBe(0)
    expect(selectRosterFor('c2')(store.getState())?.droppedTasks).toBe(2)
  })

  it("preserves each row's truncated_fields — null stays null, [] stays [] (AC2)", () => {
    const store = createBackgroundTaskRosterStore()
    const emptyCut: BackgroundTask = { ...cutDescription, task_id: 't3', truncated_fields: [] }
    store.getState().setRoster({
      conversationId: 'c1',
      tasks: [noCut, cutDescription, emptyCut],
      droppedTasks: 0
    })

    // Asserted on the RETRIEVED rows, not the input: `null` ("nothing was cut for this row") is a
    // distinct value from `[]` and is never collapsed into it, and the lists stay per row.
    const rows = selectRosterFor('c1')(store.getState())?.tasks
    expect(rows?.[0].truncated_fields).toBeNull()
    expect(rows?.[1].truncated_fields).toEqual(['description'])
    expect(rows?.[2].truncated_fields).toEqual([])
  })

  it('resetRosters returns every conversation to never-observed (AC5, AC4)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setRoster({ conversationId: 'c2', tasks: [], droppedTasks: 3 })
    store.getState().resetRosters()

    expect(store.getState().rosters.size).toBe(0)
    // Back to null, NOT to an observed-empty entry — a previous pairing's command lines are gone and
    // the reader cannot mistake the cleared state for "the daemon says nothing is running".
    expect(selectRosterFor('c1')(store.getState())).toBeNull()
    expect(selectRosterFor('c2')(store.getState())).toBeNull()
  })

  it('resetRosters on an already-empty map is a same-reference no-op (first connect)', () => {
    const store = createBackgroundTaskRosterStore()
    const before = store.getState()
    store.getState().resetRosters()
    // Returning the identical state lets zustand's Object.is short-circuit — `connected` fires on
    // every (re)handshake, so a no-op reset must churn no listener.
    expect(store.getState()).toBe(before)
  })

  it('reset then a new roster repopulates one conversation — replacement truth unchanged (AC5)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut, cutDescription], droppedTasks: 1 })
    store.getState().resetRosters()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })

    expect(selectRosterFor('c1')(store.getState())).toEqual({ tasks: [noCut], droppedTasks: 0 })
  })

  it('keeps two stores independent (DI)', () => {
    const x = createBackgroundTaskRosterStore()
    const y = createBackgroundTaskRosterStore()
    x.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })

    expect(selectRosterFor('c1')(x.getState())?.tasks).toEqual([noCut])
    expect(selectRosterFor('c1')(y.getState())).toBeNull()
    expect(y.getState().rosters.size).toBe(0)
  })

  it('starts from an injected initial state (DI)', () => {
    const seed = new Map<string, BackgroundTaskRosterEntry>([
      ['c1', { tasks: [noCut], droppedTasks: 4 }]
    ])
    const store = createBackgroundTaskRosterStore({ rosters: seed })
    expect(selectRosterFor('c1')(store.getState())).toEqual({ tasks: [noCut], droppedTasks: 4 })
  })

  it('initialBackgroundTaskRosterState is an empty map', () => {
    expect(initialBackgroundTaskRosterState).toEqual({ rosters: new Map() })
  })

  it('keeps the setter references stable across updates', () => {
    const store = createBackgroundTaskRosterStore()
    const setRoster = store.getState().setRoster
    const resetRosters = store.getState().resetRosters
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })

    expect(store.getState().setRoster).toBe(setRoster)
    expect(store.getState().resetRosters).toBe(resetRosters)
  })
})
