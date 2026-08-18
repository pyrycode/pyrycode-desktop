import { describe, it, expect } from 'vitest'
import {
  createBackgroundTaskRosterStore,
  initialBackgroundTaskRosterState,
  selectRosterFor,
  type BackgroundTaskRosterEntry,
  type BackgroundTaskStartedSnapshot,
  type HeldBackgroundTask
} from './backgroundTaskRosterStore'
import type { BackgroundTask } from '@shared/wire/types'

// Plain-function store tests over isolated createBackgroundTaskRosterStore() instances — the
// queueStore.test idiom. No React, no bridge: the store is pure renderer state with two set-on-event
// mutations and one reset. The held value is now PER TASK (`HeldBackgroundTask`, camelCase, keyed by
// `taskId`) rather than the wire rows verbatim, because a started-sourced task carries a `toolCallId`
// and a fuller description that no roster row can report. The roster stays replacement truth for
// MEMBERSHIP: a held task absent from a new roster is dropped whichever frame first reported it.
//
// The distinction #573 turned on still rides every read assertion: `null` means "no frame has ever
// arrived", an entry with an empty `tasks` map means "observed, nothing alive". The queueStore
// precedent collapses exactly this pair via `?? EMPTY_BACKLOG`, and cloning that collapse here would
// fail silently — hence the explicit `toBeNull()` / `not.toBeNull()` pairs below.
//
// Two collapses are load-bearing and each has its own test, because neither is a type error and
// neither breaks any other assertion in this file: `truncatedFields: null` must never become `[]` (on
// BOTH write paths, AC3), and a roster-sourced `toolCallId` must be `null` rather than `''` (AC4).

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

/** The two wire rows above as a roster write holds them: mapped to camelCase, `toolCallId: null`
 *  because no roster row carries one, `truncatedFields` assigned straight across. */
const heldNoCut: HeldBackgroundTask = {
  taskId: 't1',
  toolCallId: null,
  taskType: 'local_bash',
  description: 'grep -rn "a<b&c" .',
  truncatedFields: null
}
const heldCutDescription: HeldBackgroundTask = {
  taskId: 't2',
  toolCallId: null,
  taskType: 'local_bash',
  description: 'npm test -- src/renderer',
  truncatedFields: ['description']
}

/** A `background_task_started` write unit for `t1` — same task as `noCut`, but with the `toolCallId`
 *  only this frame reports and the full-length label the roster row's tighter cap shortened. */
function started(
  overrides: Partial<BackgroundTaskStartedSnapshot> = {}
): BackgroundTaskStartedSnapshot {
  return {
    conversationId: 'c1',
    taskId: 't1',
    toolCallId: 'tc-1',
    taskType: 'local_bash',
    description: 'grep -rn "a<b&c" . --include="*.ts" --color=never',
    truncatedFields: null,
    ...overrides
  }
}

type Store = ReturnType<typeof createBackgroundTaskRosterStore>

const heldFor = (store: Store, conversationId: string): BackgroundTaskRosterEntry | null =>
  selectRosterFor(conversationId)(store.getState())

const heldTask = (
  store: Store,
  conversationId: string,
  taskId: string
): HeldBackgroundTask | undefined => heldFor(store, conversationId)?.tasks.get(taskId)

const heldIds = (store: Store, conversationId: string): string[] => [
  ...(heldFor(store, conversationId)?.tasks.keys() ?? [])
]

describe('backgroundTaskRosterStore', () => {
  it('starts with nothing observed — selectRosterFor returns null, not an empty entry (AC5)', () => {
    const store = createBackgroundTaskRosterStore()
    expect(store.getState().rosters.size).toBe(0)
    // `null` is the "no frame has ever arrived" reading, and it is a stable reference for free —
    // no EMPTY_* constant exists here, deliberately.
    expect(selectRosterFor('c1')(store.getState())).toBeNull()
  })

  it('records a roster as per-task held records keyed by taskId (AC1)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({
      conversationId: 'c1',
      tasks: [noCut, cutDescription],
      droppedTasks: 0
    })

    const held = heldFor(store, 'c1')
    expect(held).not.toBeNull()
    // Field-by-field, not by reference: the rows are no longer held verbatim, because a mapping is
    // what lets a started-sourced record live in the same set. `toolCallId` is null for both.
    expect(held?.tasks).toEqual(
      new Map([
        ['t1', heldNoCut],
        ['t2', heldCutDescription]
      ])
    )
    expect(heldIds(store, 'c1')).toEqual(['t1', 't2'])
  })

  it('holds a fresh named-field entry — the write key never leaks into the held value', () => {
    const store = createBackgroundTaskRosterStore()
    const snapshot = { conversationId: 'c1', tasks: [noCut], droppedTasks: 0 }
    store.getState().setRoster(snapshot)

    const held = heldFor(store, 'c1')
    // Not the snapshot object itself, and carrying exactly the two entry fields.
    expect(held).not.toBe(snapshot)
    expect(held).toEqual({ tasks: new Map([['t1', heldNoCut]]), droppedTasks: 0 })
    expect(Object.keys(held as BackgroundTaskRosterEntry).sort()).toEqual(['droppedTasks', 'tasks'])
  })

  it('a roster-sourced task has toolCallId null — never an empty-string placeholder (AC4)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })

    // `''` is the same identifier toolUse / toolResult carry, so a placeholder would join wrongly
    // against a real tool call. `null` is outside that domain and cannot collide. Assert BOTH.
    expect(heldTask(store, 'c1', 't1')?.toolCallId).toBeNull()
    expect(heldTask(store, 'c1', 't1')?.toolCallId).not.toBe('')
  })

  it('holds a started task under its conversationId and taskId, for a never-observed conversation (AC1)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setStartedTask(started({ conversationId: 'c9' }))

    // No roster has named this task; the entry is created anyway, so the started frame is never lost
    // waiting for one (claude orders these, not the daemon — a roster may never follow).
    expect(heldFor(store, 'c9')).not.toBeNull()
    expect(heldTask(store, 'c9', 't1')).toEqual({
      taskId: 't1',
      toolCallId: 'tc-1',
      taskType: 'local_bash',
      description: 'grep -rn "a<b&c" . --include="*.ts" --color=never',
      truncatedFields: null
    })
    expect(heldFor(store, 'c9')?.droppedTasks).toBe(0)
  })

  it("a started event replaces a roster-held task's label and adds the toolCallId (AC2)", () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setStartedTask(started())

    // The roster row carries a shorter-capped copy of the SAME text; the started frame is
    // authoritative for every field it reports, and it alone reports the tool call.
    expect(heldTask(store, 'c1', 't1')).toEqual({
      taskId: 't1',
      toolCallId: 'tc-1',
      taskType: 'local_bash',
      description: 'grep -rn "a<b&c" . --include="*.ts" --color=never',
      truncatedFields: null
    })
  })

  it('upgrades a roster-held task in place — roster order is preserved (AC2)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({
      conversationId: 'c1',
      tasks: [noCut, cutDescription],
      droppedTasks: 0
    })
    store.getState().setStartedTask(started())

    // Map.set on an existing key keeps its position, so an upgrade never reorders the display list.
    expect(heldIds(store, 'c1')).toEqual(['t1', 't2'])
  })

  it('a roster arriving AFTER the started keeps the started record intact (AC4)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setStartedTask(started())
    store.getState().setRoster({
      conversationId: 'c1',
      tasks: [noCut, cutDescription],
      droppedTasks: 0
    })

    // Ordering within a turn is claude's, not the daemon's, so the join is on conversationId +
    // taskId and never on arrival order. The fuller description and the toolCallId both survive the
    // replacement; refreshing from the row would throw the better copy away and never get it back.
    expect(heldTask(store, 'c1', 't1')).toEqual({
      taskId: 't1',
      toolCallId: 'tc-1',
      taskType: 'local_bash',
      description: 'grep -rn "a<b&c" . --include="*.ts" --color=never',
      truncatedFields: null
    })
    // A roster-sourced peer in the same frame is still rebuilt from its row.
    expect(heldTask(store, 'c1', 't2')).toEqual(heldCutDescription)
    expect(heldIds(store, 'c1')).toEqual(['t1', 't2'])
  })

  it("a started event's truncatedFields REPLACE the roster row's, never union with them", () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({
      conversationId: 'c1',
      tasks: [{ ...noCut, truncated_fields: ['description'] }],
      droppedTasks: 0
    })
    store.getState().setStartedTask(started({ truncatedFields: ['task_type'] }))

    // The two lists name DIFFERENT vocabularies (the started frame's includes `tool_call_id`, the
    // row's cannot), so one flattened list per task would be a list no reader can attribute back to
    // a field. Exactly the started frame's list, and only it.
    expect(heldTask(store, 'c1', 't1')?.truncatedFields).toEqual(['task_type'])
  })

  it("preserves each row's truncated_fields on the ROSTER path — null stays null, [] stays [] (AC3)", () => {
    const store = createBackgroundTaskRosterStore()
    const emptyCut: BackgroundTask = { ...cutDescription, task_id: 't3', truncated_fields: [] }
    store.getState().setRoster({
      conversationId: 'c1',
      tasks: [noCut, cutDescription, emptyCut],
      droppedTasks: 0
    })

    // Asserted on the RETRIEVED records, not the input. #573 got this for free — there was no
    // per-row mapping in which a collapse could occur. There is one now, so this test IS the
    // guarantee: it fails the moment `row.truncated_fields ?? []` is written.
    expect(heldTask(store, 'c1', 't1')?.truncatedFields).toBeNull()
    expect(heldTask(store, 'c1', 't2')?.truncatedFields).toEqual(['description'])
    expect(heldTask(store, 'c1', 't3')?.truncatedFields).toEqual([])
  })

  it('preserves truncatedFields on the STARTED path — null stays null, [] stays [] (AC3)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setStartedTask(started({ taskId: 'a', truncatedFields: null }))
    store.getState().setStartedTask(started({ taskId: 'b', truncatedFields: [] }))
    store.getState().setStartedTask(started({ taskId: 'c', truncatedFields: ['description'] }))

    expect(heldTask(store, 'c1', 'a')?.truncatedFields).toBeNull()
    expect(heldTask(store, 'c1', 'b')?.truncatedFields).toEqual([])
    expect(heldTask(store, 'c1', 'c')?.truncatedFields).toEqual(['description'])
  })

  it('marks a task started-sourced even when toolCallId is the empty string', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setStartedTask(started({ toolCallId: '' }))
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })

    // requireString admits `''`, so a daemon-sent `tool_call_id: ''` decodes to `''` — truthy-false,
    // but still proof the started frame was seen. This test fails if provenance is written as
    // `if (task.toolCallId)`: the task would silently demote to roster-sourced and the later roster
    // would overwrite its fuller label.
    expect(heldTask(store, 'c1', 't1')?.toolCallId).toBe('')
    expect(heldTask(store, 'c1', 't1')?.description).toBe(
      'grep -rn "a<b&c" . --include="*.ts" --color=never'
    )
  })

  it('a later roster drops a started-sourced task it does not list (AC5)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setStartedTask(started())
    store.getState().setRoster({ conversationId: 'c1', tasks: [cutDescription], droppedTasks: 0 })

    // Replacement truth for MEMBERSHIP applies to both kinds: absence from a later roster is this
    // family's only removal path, and a started-sourced task is not exempt from it.
    expect(heldTask(store, 'c1', 't1')).toBeUndefined()
    expect(heldIds(store, 'c1')).toEqual(['t2'])
  })

  it('a later roster replaces the held set wholesale — absence is the only removal path (AC5)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({
      conversationId: 'c1',
      tasks: [noCut, cutDescription],
      droppedTasks: 0
    })
    store.getState().setRoster({ conversationId: 'c1', tasks: [cutDescription], droppedTasks: 0 })

    // `noCut` is gone: no merge, no append, no dedupe — the newest roster is the whole membership.
    expect(heldIds(store, 'c1')).toEqual(['t2'])
    expect(heldTask(store, 'c1', 't2')).toEqual(heldCutDescription)
  })

  it('preserves droppedTasks across a started write — a started frame reports no truncation', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 3 })
    store.getState().setStartedTask(started())

    // The started frame says nothing about how many rows the roster cap cut, so it must not reset
    // the count to 0 — that would silently present a capped roster as the whole one.
    expect(heldFor(store, 'c1')?.droppedTasks).toBe(3)
  })

  it('keeps each conversation independent — a write for one never clobbers another (AC1)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setStartedTask(started({ conversationId: 'c2', taskId: 't2' }))

    expect(heldIds(store, 'c1')).toEqual(['t1'])
    expect(heldIds(store, 'c2')).toEqual(['t2'])
  })

  it('leaves a foreign-key write reference-stable — a c2 started does not churn a c1 watcher', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    const before = heldFor(store, 'c1')
    store.getState().setStartedTask(started({ conversationId: 'c2' }))
    const after = heldFor(store, 'c1')

    // Object.is true — the map is cloned but c1's entry object is untouched, so no re-render.
    expect(after).toBe(before)
  })

  it('records an empty roster as "observed, nothing alive" — never as never-observed (AC5)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setRoster({ conversationId: 'c1', tasks: [], droppedTasks: 0 })

    // Both halves of the pair: NOT null (a roster was observed) and empty (nothing is alive). The
    // key is written, never deleted.
    const held = heldFor(store, 'c1')
    expect(held).not.toBeNull()
    expect(held?.tasks.size).toBe(0)
    expect(store.getState().rosters.has('c1')).toBe(true)
  })

  it('tells observed-empty apart from never-observed through the read surface alone (AC5)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [], droppedTasks: 0 })

    expect(selectRosterFor('c1')(store.getState())).toEqual({ tasks: new Map(), droppedTasks: 0 })
    expect(selectRosterFor('c2')(store.getState())).toBeNull()
  })

  it('holds droppedTasks alongside the tasks — a capped roster reads apart', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setRoster({ conversationId: 'c2', tasks: [noCut], droppedTasks: 2 })

    // `0` is a value, never consulted for truthiness; the true roster size is tasks.size + dropped.
    expect(heldFor(store, 'c1')?.droppedTasks).toBe(0)
    expect(heldFor(store, 'c2')?.droppedTasks).toBe(2)
  })

  it('resetRosters returns every conversation to never-observed, started-sourced included (AC5)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setStartedTask(started({ conversationId: 'c2' }))
    store.getState().resetRosters()

    expect(store.getState().rosters.size).toBe(0)
    // Back to null, NOT to an observed-empty entry — a previous pairing's command lines are gone,
    // whichever frame reported them, and the reader cannot mistake the cleared state for "the
    // daemon says nothing is running".
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
    store.getState().setStartedTask(started())
    store.getState().resetRosters()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })

    // The cleared toolCallId does not come back: nothing repopulates a started frame after a
    // (re)handshake, so the task reads roster-sourced again. That is #569's gap, stated honestly.
    expect(heldTask(store, 'c1', 't1')).toEqual(heldNoCut)
  })

  it('keeps two stores independent (DI)', () => {
    const x = createBackgroundTaskRosterStore()
    const y = createBackgroundTaskRosterStore()
    x.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })

    expect(heldIds(x, 'c1')).toEqual(['t1'])
    expect(selectRosterFor('c1')(y.getState())).toBeNull()
    expect(y.getState().rosters.size).toBe(0)
  })

  it('starts from an injected initial state (DI)', () => {
    const seed = new Map<string, BackgroundTaskRosterEntry>([
      ['c1', { tasks: new Map([['t1', heldNoCut]]), droppedTasks: 4 }]
    ])
    const store = createBackgroundTaskRosterStore({ rosters: seed })
    expect(heldFor(store, 'c1')).toEqual({
      tasks: new Map([['t1', heldNoCut]]),
      droppedTasks: 4
    })
  })

  it('initialBackgroundTaskRosterState is an empty map', () => {
    expect(initialBackgroundTaskRosterState).toEqual({ rosters: new Map() })
  })

  it('keeps the setter references stable across updates', () => {
    const store = createBackgroundTaskRosterStore()
    const setRoster = store.getState().setRoster
    const setStartedTask = store.getState().setStartedTask
    const resetRosters = store.getState().resetRosters
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setStartedTask(started())

    expect(store.getState().setRoster).toBe(setRoster)
    expect(store.getState().setStartedTask).toBe(setStartedTask)
    expect(store.getState().resetRosters).toBe(resetRosters)
  })
})
