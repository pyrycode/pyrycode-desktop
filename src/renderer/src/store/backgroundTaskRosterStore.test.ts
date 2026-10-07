import { describe, it, expect } from 'vitest'
import {
  createBackgroundTaskRosterStore,
  initialBackgroundTaskRosterState,
  selectFinishedTasksFor,
  selectLiveTaskCountFor,
  selectRosterFor,
  type BackgroundTaskRosterEntry,
  type BackgroundTaskProgressSnapshot,
  type BackgroundTaskStartedSnapshot,
  type BackgroundTaskUpdatedSnapshot,
  type HeldBackgroundTask
} from './backgroundTaskRosterStore'
import type { BackgroundTask } from '@shared/wire/types'

// Plain-function store tests over isolated createBackgroundTaskRosterStore() instances — the
// queueStore.test idiom. No React, no bridge: the store is pure renderer state with three
// set-on-event mutations and one reset. The held value is PER TASK (`HeldBackgroundTask`, camelCase,
// keyed by `taskId`) rather than the wire rows verbatim, because a started-sourced task carries a
// `toolCallId` and a fuller description that no roster row can report, and an updated task carries a
// `latestUpdate` no roster row can report either. The roster stays replacement truth for MEMBERSHIP:
// a held task absent from a new roster is dropped whichever frame first reported it.
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
 *  because no roster row carries one, `truncatedFields` assigned straight across, and
 *  `latestUpdate: null` because no update has ever matched — distinct from a recorded empty patch. */
const heldNoCut: HeldBackgroundTask = {
  taskId: 't1',
  toolCallId: null,
  taskType: 'local_bash',
  description: 'grep -rn "a<b&c" .',
  truncatedFields: null,
  latestUpdate: null,
  status: null,
  summary: null,
  progress: null
}
const heldCutDescription: HeldBackgroundTask = {
  taskId: 't2',
  toolCallId: null,
  taskType: 'local_bash',
  description: 'npm test -- src/renderer',
  truncatedFields: ['description'],
  latestUpdate: null,
  status: null,
  summary: null,
  progress: null
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

/** A `background_task_updated` write unit for `t1` — the two ids plus four fields: no `toolCallId`,
 *  no `description`, no `taskType`, and it gains `patch`, `status` and `summary`. */
function updated(
  overrides: Partial<BackgroundTaskUpdatedSnapshot> = {}
): BackgroundTaskUpdatedSnapshot {
  return {
    conversationId: 'c1',
    taskId: 't1',
    patch: '{"is_backgrounded":true}',
    status: '',
    summary: '',
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

  // #1563 — claude sends `task_started` for FOREGROUND work too (a Bash call past ~3 s, with
  // `is_backgrounded: false` the daemon drops), and no roster ever lists it. The roster line is the
  // background set, so a start reaches the read surface only once a roster lists its task; until then
  // it waits in `unlistedStarts`, which neither the pill nor the panel reads.
  describe('listed-only surfaces (#1563)', () => {
    it('a start no roster has listed reaches no surface — never-observed stays null (AC1)', () => {
      const store = createBackgroundTaskRosterStore()
      const before = store.getState().rosters
      store.getState().setStartedTask(started({ conversationId: 'c9' }))

      // Still "No background-task report yet", not "No background tasks": creating an entry here
      // would collapse the two silences.
      expect(heldFor(store, 'c9')).toBeNull()
      expect(store.getState().rosters).toBe(before)
      expect(store.getState().unlistedStarts.get('c9')?.get('t1')).toEqual({
        taskId: 't1',
        toolCallId: 'tc-1',
        startedToolCallId: 'tc-1',
        taskType: 'local_bash',
        description: 'grep -rn "a<b&c" . --include="*.ts" --color=never',
        truncatedFields: null,
        latestUpdate: null,
        status: null,
        summary: null,
        progress: null
      })
    })

    it('a start after an empty roster leaves the observed-empty entry by reference (AC1)', () => {
      const store = createBackgroundTaskRosterStore()
      store.getState().setRoster({ conversationId: 'c1', tasks: [], droppedTasks: 0 })
      const before = heldFor(store, 'c1')
      store.getState().setStartedTask(started())

      expect(heldFor(store, 'c1')).toBe(before)
      expect(heldFor(store, 'c1')?.tasks.size).toBe(0)
    })

    it('a roster listing a held start moves it in whole — toolCallId, label and patch (AC2)', () => {
      const store = createBackgroundTaskRosterStore()
      store.getState().setStartedTask(started())
      // Arrives before any roster: it must hit the hold, not miss on the absent entry.
      store.getState().setUpdatedTask(updated({ truncatedFields: ['patch'] }))
      store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 1 })

      expect(heldTask(store, 'c1', 't1')).toEqual({
        taskId: 't1',
        toolCallId: 'tc-1',
        startedToolCallId: 'tc-1',
        taskType: 'local_bash',
        description: 'grep -rn "a<b&c" . --include="*.ts" --color=never',
        truncatedFields: null,
        latestUpdate: { patch: '{"is_backgrounded":true}', truncatedFields: ['patch'] },
        status: null,
        summary: null,
        progress: null
      })
      expect(heldFor(store, 'c1')?.droppedTasks).toBe(1)
      // Moved, not copied: the hold is gone once a roster has spoken for the conversation.
      expect(store.getState().unlistedStarts.has('c1')).toBe(false)
    })

    it('a roster that does not list a held start drops it; a later listing is roster-sourced (AC3)', () => {
      const store = createBackgroundTaskRosterStore()
      store.getState().setStartedTask(started())
      store.getState().setRoster({ conversationId: 'c1', tasks: [], droppedTasks: 0 })

      // The foreground call of #1558: an empty roster, no pill, and the hold is not kept for later.
      expect(heldFor(store, 'c1')?.tasks.size).toBe(0)
      expect(store.getState().unlistedStarts.has('c1')).toBe(false)

      // A timeout later moves the same call to the background: it comes back through the roster alone.
      store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
      expect(heldTask(store, 'c1', 't1')).toEqual(heldNoCut)
    })

    it('empties only the rostered conversation’s holds — another’s survive by reference', () => {
      const store = createBackgroundTaskRosterStore()
      store.getState().setStartedTask(started({ conversationId: 'c1' }))
      store.getState().setStartedTask(started({ conversationId: 'c2' }))
      const c2Holds = store.getState().unlistedStarts.get('c2')
      store.getState().setRoster({ conversationId: 'c1', tasks: [], droppedTasks: 0 })

      expect(store.getState().unlistedStarts.get('c2')).toBe(c2Holds)
    })

    it('a start or update for a task a roster listed leaves it shown (AC4)', () => {
      const store = createBackgroundTaskRosterStore()
      store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
      store.getState().setStartedTask(started())
      store.getState().setUpdatedTask(updated())

      expect(heldIds(store, 'c1')).toEqual(['t1'])
      expect(heldTask(store, 'c1', 't1')?.toolCallId).toBe('tc-1')
      expect(heldTask(store, 'c1', 't1')?.latestUpdate?.patch).toBe('{"is_backgrounded":true}')
      // The upgrade went into the listed row, never into a hold.
      expect(store.getState().unlistedStarts.size).toBe(0)
    })

    it('an update for a task held nowhere still opens nothing (AC2 of #577)', () => {
      const store = createBackgroundTaskRosterStore()
      store.getState().setStartedTask(started())
      const before = store.getState()
      store.getState().setUpdatedTask(updated({ taskId: 'nope' }))

      expect(store.getState()).toBe(before)
    })

    it('resetRostersFor drops the listed conversations’ holds, and leaves others by reference (AC5)', () => {
      const store = createBackgroundTaskRosterStore()
      store.getState().setStartedTask(started({ conversationId: 'b1' }))
      store.getState().setStartedTask(started({ conversationId: 'a1' }))
      const a1Holds = store.getState().unlistedStarts.get('a1')
      store.getState().resetRostersFor(new Set(['b1']))

      expect(store.getState().unlistedStarts.has('b1')).toBe(false)
      expect(store.getState().unlistedStarts.get('a1')).toBe(a1Holds)
    })

    it('resetRostersFor hands the state back when neither map holds a listed key', () => {
      const store = createBackgroundTaskRosterStore()
      store.getState().setStartedTask(started({ conversationId: 'a1' }))
      const before = store.getState()
      store.getState().resetRostersFor(new Set(['b1']))

      expect(store.getState()).toBe(before)
    })

    it('treats __proto__ as an ordinary conversation key in the holds too', () => {
      const store = createBackgroundTaskRosterStore()
      store.getState().setStartedTask(started({ conversationId: '__proto__' }))
      expect(store.getState().unlistedStarts.get('__proto__')?.has('t1')).toBe(true)

      store.getState().resetRostersFor(new Set(['__proto__']))
      expect(store.getState().unlistedStarts.size).toBe(0)
    })

    it('clearAllRosters drops a store holding only unlisted starts — never a no-op (AC5)', () => {
      const store = createBackgroundTaskRosterStore()
      store.getState().setStartedTask(started({ conversationId: 'c-gone' }))
      store.getState().clearAllRosters()

      // The pairing boundary guarantee (#1139): a departed pairing's command lines survive nowhere,
      // including a place no surface reads.
      expect(store.getState().unlistedStarts.size).toBe(0)
      expect(store.getState()).toMatchObject(initialBackgroundTaskRosterState)
    })
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
        startedToolCallId: 'tc-1',
      taskType: 'local_bash',
      description: 'grep -rn "a<b&c" . --include="*.ts" --color=never',
      truncatedFields: null,
      latestUpdate: null,
      status: null,
      summary: null,
      progress: null
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
        startedToolCallId: 'tc-1',
      taskType: 'local_bash',
      description: 'grep -rn "a<b&c" . --include="*.ts" --color=never',
      truncatedFields: null,
      latestUpdate: null,
      status: null,
      summary: null,
      progress: null
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
    // Listed after the starts (#1563), and the rows' own lists are ['task_type'] so a collapse onto
    // the ROW's list cannot pass for the started frame's.
    store.getState().setRoster({
      conversationId: 'c1',
      tasks: ['a', 'b', 'c'].map((id) => ({ ...noCut, task_id: id, truncated_fields: ['task_type'] })),
      droppedTasks: 0
    })

    expect(heldTask(store, 'c1', 'a')?.truncatedFields).toBeNull()
    expect(heldTask(store, 'c1', 'b')?.truncatedFields).toEqual([])
    expect(heldTask(store, 'c1', 'c')?.truncatedFields).toEqual(['description'])
  })

  it('records an update as the latest patch on a ROSTER-sourced task (AC1)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })

    // Before any update the task reads as having NO patch at all — not an empty one.
    expect(heldTask(store, 'c1', 't1')?.latestUpdate).toBeNull()
    store.getState().setUpdatedTask(updated({ truncatedFields: ['patch'] }))

    expect(heldTask(store, 'c1', 't1')?.latestUpdate).toEqual({
      patch: '{"is_backgrounded":true}',
      truncatedFields: ['patch']
    })
    // An update frame reports none of the other fields, so none of them move.
    expect(heldTask(store, 'c1', 't1')?.description).toBe('grep -rn "a<b&c" .')
    expect(heldTask(store, 'c1', 't1')?.taskType).toBe('local_bash')
    expect(heldTask(store, 'c1', 't1')?.toolCallId).toBeNull()
    expect(heldTask(store, 'c1', 't1')?.truncatedFields).toBeNull()
  })

  it('records an update as the latest patch on a STARTED-sourced task (AC1)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setStartedTask(started())
    expect(heldTask(store, 'c1', 't1')?.latestUpdate).toBeNull()

    store.getState().setUpdatedTask(updated())

    expect(heldTask(store, 'c1', 't1')?.latestUpdate).toEqual({
      patch: '{"is_backgrounded":true}',
      truncatedFields: null
    })
    // The provenance predicate is untouched: recording a patch never demotes a started-sourced task.
    expect(heldTask(store, 'c1', 't1')?.toolCallId).toBe('tc-1')
    expect(heldTask(store, 'c1', 't1')?.description).toBe(
      'grep -rn "a<b&c" . --include="*.ts" --color=never'
    )
  })

  it('holds the LATEST patch only — never an accumulating history (AC1)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setUpdatedTask(updated({ patch: 'first' }))
    store.getState().setUpdatedTask(updated({ patch: 'second', truncatedFields: [] }))

    // Latest-wins, one record: an append-only history keyed by a model-influenced `task_id` and fed
    // by a push stream would be unbounded growth on attacker-influenceable input.
    expect(heldTask(store, 'c1', 't1')?.latestUpdate).toEqual({
      patch: 'second',
      truncatedFields: []
    })
  })

  it("records patch: '' as a VALUE — distinct from having no patch at all (AC1)", () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setUpdatedTask(updated({ patch: '' }))

    // `patch: ''` means claude sent no change; it always arrives on the wire (no `omitempty`), so it
    // is never an absence. This test fails the moment anyone writes `if (snapshot.patch)` on the path.
    expect(heldTask(store, 'c1', 't1')?.latestUpdate).not.toBeNull()
    expect(heldTask(store, 'c1', 't1')?.latestUpdate?.patch).toBe('')
  })

  it('ignores an update for an unknown taskId in a known conversation (AC2)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    const before = store.getState()
    store.getState().setUpdatedTask(updated({ taskId: 'nope' }))

    // Same state reference — zustand's Object.is short-circuits, so no listener churns, and "creates
    // no partial entry" is provable rather than enumerated. An update never OPENS a task.
    expect(store.getState()).toBe(before)
    expect(heldIds(store, 'c1')).toEqual(['t1'])
  })

  it('ignores an update for an unknown conversationId — it opens no entry (AC2)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    const before = store.getState()
    store.getState().setUpdatedTask(updated({ conversationId: 'cX' }))

    expect(store.getState()).toBe(before)
    expect(store.getState().rosters.has('cX')).toBe(false)
    // Still never-observed through the read surface, not observed-empty.
    expect(selectRosterFor('cX')(store.getState())).toBeNull()
  })

  it("keeps the patch's cut report distinct from the task's own — never merged (AC3)", () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({
      conversationId: 'c1',
      tasks: [{ ...noCut, truncated_fields: ['description'] }],
      droppedTasks: 0
    })
    store.getState().setUpdatedTask(updated({ truncatedFields: ['patch'] }))

    // Three lists, three vocabularies (the roster row's names `task_id`/`task_type`/`description`,
    // the update's names `task_id`/`patch`). Nesting the update's under `latestUpdate` is what keeps
    // every entry attributable back to the field it describes; one flattened list could not be.
    expect(heldTask(store, 'c1', 't1')?.truncatedFields).toEqual(['description'])
    expect(heldTask(store, 'c1', 't1')?.latestUpdate?.truncatedFields).toEqual(['patch'])
  })

  it('preserves truncatedFields on the UPDATE path — null stays null, [] stays [] (AC3)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({
      conversationId: 'c1',
      tasks: [noCut, cutDescription, { ...noCut, task_id: 't3' }],
      droppedTasks: 0
    })
    store.getState().setUpdatedTask(updated({ taskId: 't1', truncatedFields: null }))
    store.getState().setUpdatedTask(updated({ taskId: 't2', truncatedFields: [] }))
    store.getState().setUpdatedTask(updated({ taskId: 't3', truncatedFields: ['patch'] }))

    // A straight assignment, no `?? []`: `null` means nothing was cut and is a distinct value. Not a
    // type error and no other assertion breaks if it collapses, so this test is the whole defence.
    expect(heldTask(store, 'c1', 't1')?.latestUpdate?.truncatedFields).toBeNull()
    expect(heldTask(store, 'c1', 't2')?.latestUpdate?.truncatedFields).toEqual([])
    expect(heldTask(store, 'c1', 't3')?.latestUpdate?.truncatedFields).toEqual(['patch'])
  })

  it("carries a ROSTER-sourced task's patch across a roster that refreshes its row (AC4)", () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setUpdatedTask(updated({ truncatedFields: ['patch'] }))
    store.getState().setRoster({
      conversationId: 'c1',
      tasks: [
        { task_id: 't1', task_type: 'remote_agent', description: 'newer label', truncated_fields: [] }
      ],
      droppedTasks: 0
    })

    // The single test that kills BOTH mistakes the shipped docstring invites. Leaving the rebuild
    // branch as #576 shipped it drops the patch; widening the provenance predicate to keep the record
    // whole freezes the label instead. Only refreshing the row's fields AND riding the patch across
    // passes both halves.
    expect(heldTask(store, 'c1', 't1')).toEqual({
      taskId: 't1',
      toolCallId: null,
      taskType: 'remote_agent',
      description: 'newer label',
      truncatedFields: [],
      latestUpdate: { patch: '{"is_backgrounded":true}', truncatedFields: ['patch'] },
      status: null,
      summary: null,
      progress: null
    })
  })

  it("carries a STARTED-sourced task's patch across a roster, record kept whole (AC4)", () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setStartedTask(started())
    store.getState().setUpdatedTask(updated())
    store.getState().setRoster({
      conversationId: 'c1',
      tasks: [
        { task_id: 't1', task_type: 'remote_agent', description: 'newer label', truncated_fields: [] }
      ],
      droppedTasks: 0
    })

    // The started-sourced half of AC4: the record rides across WHOLE, so the row's changed label and
    // type never overwrite the started frame's authoritative copies, and the patch comes with it. Its
    // roster-sourced twin above is what kills the `&& held.toolCallId !== null` deletion (#576's open
    // SHOULD FIX) — this one pins the branch that deletion would swallow everything into, so the pair
    // discriminates both directions. Not redundant — do not prune either.
    expect(heldTask(store, 'c1', 't1')).toEqual({
      taskId: 't1',
      toolCallId: 'tc-1',
        startedToolCallId: 'tc-1',
      taskType: 'local_bash',
      description: 'grep -rn "a<b&c" . --include="*.ts" --color=never',
      truncatedFields: null,
      latestUpdate: { patch: '{"is_backgrounded":true}', truncatedFields: null },
      status: null,
      summary: null,
      progress: null
    })
  })

  it("carries a patch across a LATER started frame — it reports none (AC4's principle)", () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setUpdatedTask(updated())
    store.getState().setStartedTask(started())

    // Claude orders these, not the daemon, so a started frame can follow the update for the task it
    // opened. It reports no patch, so it must not erase one — the same rule that stops an update
    // frame from touching the label. Every field the started frame DOES report is still authoritative.
    expect(heldTask(store, 'c1', 't1')?.latestUpdate).toEqual({
      patch: '{"is_backgrounded":true}',
      truncatedFields: null
    })
    expect(heldTask(store, 'c1', 't1')?.toolCallId).toBe('tc-1')
  })

  it('does not resurrect a patched task the newest roster omits (AC4)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setUpdatedTask(updated())
    store.getState().setRoster({ conversationId: 'c1', tasks: [cutDescription], droppedTasks: 0 })

    // Membership still wins over carry-over: a recorded patch is not a claim the task is alive, and
    // absence from a later roster stays this family's only removal path.
    expect(heldTask(store, 'c1', 't1')).toBeUndefined()
    expect(heldIds(store, 'c1')).toEqual(['t2'])
  })

  it('resetRostersFor clears recorded patches along with everything else it drops (#573 AC5)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setStartedTask(started({ conversationId: 'c2', taskId: 't9' }))
    store.getState().setUpdatedTask(updated({ conversationId: 'c1', taskId: 't1' }))
    store.getState().setUpdatedTask(updated({ conversationId: 'c2', taskId: 't9' }))
    store.getState().resetRostersFor(new Set(['c1', 'c2']))
    // c2's start and patch were never listed, so they sat in the hold (#1563) — it goes too.
    expect(store.getState().unlistedStarts.size).toBe(0)

    // A patch key may carry command text, so the connected edge clearing it is what keeps the
    // RECONNECTING server's previous connection out of the next one. Nothing here is persisted, so
    // nothing survives. The previous-PAIRING half of that guarantee is `clearAllRosters` since #1139.
    expect(selectRosterFor('c1')(store.getState())).toBeNull()
    expect(selectRosterFor('c2')(store.getState())).toBeNull()
  })

  it('clearAllRosters clears recorded patches along with everything else (#573 AC5, AC4)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setStartedTask(started({ conversationId: 'c2', taskId: 't9' }))
    store.getState().setUpdatedTask(updated({ conversationId: 'c1', taskId: 't1' }))
    store.getState().setUpdatedTask(updated({ conversationId: 'c2', taskId: 't9' }))
    store.getState().clearAllRosters()
    expect(store.getState().unlistedStarts.size).toBe(0)

    // The pairing-boundary half, and the one that takes NO id at all: a departed pairing's patch text
    // and command lines go whether or not any server's conversation list ever named the conversation.
    expect(selectRosterFor('c1')(store.getState())).toBeNull()
    expect(selectRosterFor('c2')(store.getState())).toBeNull()
  })

  it('leaves the selector reference-stable across an update (no per-call construction)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setRoster({ conversationId: 'c2', tasks: [cutDescription], droppedTasks: 0 })
    store.getState().setUpdatedTask(updated())

    // The entry is built at write time, so two reads hand back the SAME object — adding a per-task
    // field is exactly where a fresh-object-per-selector-call regression creeps in.
    expect(heldFor(store, 'c1')).toBe(heldFor(store, 'c1'))

    // And an update for one conversation leaves every other entry Object.is identical.
    const beforeC2 = heldFor(store, 'c2')
    store.getState().setUpdatedTask(updated({ patch: 'again' }))
    expect(heldFor(store, 'c2')).toBe(beforeC2)
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
    store.getState().setRoster({ conversationId: 'c2', tasks: [cutDescription], droppedTasks: 0 })

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

  it('resetRostersFor returns the listed conversations to never-observed, started-sourced included (#573 AC5)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setStartedTask(started({ conversationId: 'c2' }))
    store.getState().resetRostersFor(new Set(['c1', 'c2']))

    expect(store.getState().rosters.size).toBe(0)
    expect(store.getState().unlistedStarts.size).toBe(0)
    // Back to null, NOT to an observed-empty entry — the reconnecting server's previous connection is
    // gone whichever frame reported each task, and the reader cannot mistake the cleared state for
    // "the daemon says nothing is running".
    expect(selectRosterFor('c1')(store.getState())).toBeNull()
    expect(selectRosterFor('c2')(store.getState())).toBeNull()
  })

  it('resetRostersFor on an already-empty map is a same-reference no-op (first connect)', () => {
    const store = createBackgroundTaskRosterStore()
    const before = store.getState()
    store.getState().resetRostersFor(new Set(['c1']))
    // Returning the identical state lets zustand's Object.is short-circuit — `connected` fires on
    // every (re)handshake, so a no-op reset must churn no listener.
    expect(store.getState()).toBe(before)
  })

  it('a scoped reset then a new roster repopulates one conversation — replacement truth unchanged (#573 AC5)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setStartedTask(started())
    store.getState().resetRostersFor(new Set(['c1']))
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })

    // The cleared toolCallId does not come back, and that is still exactly right after #569: the
    // daemon's reconcile-on-connect re-asserts ROSTERS only (pyrycode#2077-#2080), never a
    // `background_task_started`, so a task the app had upgraded to started-sourced comes back
    // roster-sourced — without its `toolCallId` and with the row's tighter-capped label. This case
    // used to call that "#569's gap"; it is not a gap any more but the reconcile's stated shape, and
    // the assertion below is what pins the narrowing rather than merely describing it.
    expect(heldTask(store, 'c1', 't1')).toEqual(heldNoCut)
  })

  // #1139 — since #1117 the app holds one live connection per paired server, so a `connected` edge
  // means "THIS server's connection came back" and the reset must drop only that server's held
  // rosters. The caller resolves which conversations those are from the server-keyed conversation
  // list; this store only ever sees the resulting id set, which is therefore CLIENT-held.
  describe('resetRostersFor (scoped reconnect reset, #1139)', () => {
    /** Two servers' worth of held state: `a1` on server A, `b1` on server B, and `orphan` under a
     *  conversation no server's list names — a background task can legitimately start for one whose
     *  list has not arrived. */
    const twoServers = (): Store => {
      const store = createBackgroundTaskRosterStore()
      store.getState().setRoster({ conversationId: 'a1', tasks: [noCut], droppedTasks: 0 })
      store.getState().setRoster({ conversationId: 'b1', tasks: [cutDescription], droppedTasks: 3 })
      store.getState().setRoster({ conversationId: 'orphan', tasks: [noCut], droppedTasks: 0 })
      return store
    }

    it('drops exactly the listed conversations and leaves every other held one (AC1)', () => {
      const store = twoServers()
      store.getState().resetRostersFor(new Set(['b1']))

      expect(selectRosterFor('b1')(store.getState())).toBeNull()
      expect(heldIds(store, 'a1')).toEqual(['t1'])
      expect(heldIds(store, 'orphan')).toEqual(['t1'])
    })

    it('leaves a roster whose conversation is in NO list alone — the accepted consequence (AC2)', () => {
      // Pinned so a later widening of the reset's scope is a deliberate change rather than drift.
      // `clearAllRosters` is the only thing that ever collects such an entry.
      const store = twoServers()
      store.getState().resetRostersFor(new Set(['a1']))
      store.getState().resetRostersFor(new Set(['b1']))

      expect(heldIds(store, 'orphan')).toEqual(['t1'])
    })

    it('drops nothing for an empty id set — the not-loaded and loaded-empty reading (AC2)', () => {
      // `selectConversationIdsFor` collapses "this server has no list yet" and "it reported zero
      // conversations" into the one `EMPTY_CONVERSATION_IDS` reference; both mean drop nothing. A new
      // pairing's first `connected` is exactly this case, which is why `clearAllRosters` exists.
      const store = twoServers()
      const before = store.getState()
      store.getState().resetRostersFor(new Set())

      expect(store.getState()).toBe(before)
    })

    it('hands the state object straight back when no held key is listed (subscriber short-circuit)', () => {
      // The generalisation of the old whole-map reset's `size === 0` guard: a reconnect of a server
      // that holds nothing here must make zustand's Object.is fire and wake NO listener at all.
      const store = twoServers()
      const before = store.getState()
      store.getState().resetRostersFor(new Set(['c-not-held', 'c-also-not-held']))

      expect(store.getState()).toBe(before)
    })

    it('returns every surviving entry BY REFERENCE — a watcher of another conversation never re-renders', () => {
      const store = twoServers()
      const beforeA = heldFor(store, 'a1')
      store.getState().resetRostersFor(new Set(['b1']))

      expect(heldFor(store, 'a1')).toBe(beforeA)
    })

    it('drops a conversation whole — started-sourced tasks and recorded patches go with it (#573 AC5)', () => {
      const store = createBackgroundTaskRosterStore()
      const t9: BackgroundTask = { ...noCut, task_id: 't9' }
      store.getState().setRoster({ conversationId: 'b1', tasks: [t9], droppedTasks: 0 })
      store.getState().setRoster({ conversationId: 'a1', tasks: [t9], droppedTasks: 0 })
      store.getState().setStartedTask(started({ conversationId: 'b1', taskId: 't9' }))
      store.getState().setUpdatedTask(updated({ conversationId: 'b1', taskId: 't9' }))
      store.getState().setStartedTask(started({ conversationId: 'a1', taskId: 't9' }))
      store.getState().setUpdatedTask(updated({ conversationId: 'a1', taskId: 't9' }))
      store.getState().resetRostersFor(new Set(['b1']))

      // The reset deletes the map key, so it cannot half-drop an entry: the `toolCallId` only the
      // started frame reports and the patch only the update frame reports go together.
      expect(selectRosterFor('b1')(store.getState())).toBeNull()
      expect(heldTask(store, 'a1', 't9')?.toolCallId).toBe('tc-1')
      expect(heldTask(store, 'a1', 't9')?.latestUpdate?.patch).toBe('{"is_backgrounded":true}')
    })

    it('treats __proto__, constructor and the empty string as ordinary conversation keys', () => {
      // The reset iterates a Map's held keys and tests membership with Set.has — never a bare object
      // keyed by id, per `ServerOrigin`'s docblock — so these ids drop and survive like any other.
      // Swapping either collection for a `Record<string, …>` reddens here rather than silently
      // reading `Object.prototype` back out of the store.
      const store = createBackgroundTaskRosterStore()
      for (const id of ['__proto__', 'constructor', '']) {
        store.getState().setRoster({ conversationId: id, tasks: [noCut], droppedTasks: 0 })
      }
      expect(heldIds(store, '__proto__')).toEqual(['t1'])

      store.getState().resetRostersFor(new Set(['__proto__', '']))
      expect(selectRosterFor('__proto__')(store.getState())).toBeNull()
      expect(selectRosterFor('')(store.getState())).toBeNull()
      expect(heldIds(store, 'constructor')).toEqual(['t1'])
    })
  })

  // #1139 — the pairing-boundary drop. It exists because scoping the reconnect reset above removed the
  // self-heal that kept this store out of `clearPairingScopedState`: a new pairing's first `connected`
  // resolves an empty conversation list and drops nothing, and the daemon's reconcile re-asserts a roster
  // only for the conversations of the pairing that reported it, never a departed pairing's. That last
  // clause used to read "and NOTHING re-asserts a roster"; #569 retired the premise and left both the
  // drop and the assertions below exactly as they were.
  describe('clearAllRosters (pairing-boundary drop, #1139)', () => {
    it('returns every conversation to never-observed, listed or not (AC4)', () => {
      const store = createBackgroundTaskRosterStore()
      store.getState().setRoster({ conversationId: 'a1', tasks: [noCut], droppedTasks: 0 })
      store.getState().setStartedTask(started({ conversationId: 'b1' }))
      store.getState().setRoster({ conversationId: 'orphan', tasks: [cutDescription], droppedTasks: 0 })
      store.getState().clearAllRosters()

      expect(store.getState().rosters.size).toBe(0)
      expect(store.getState().unlistedStarts.size).toBe(0)
      // Including the entry every scoped reset leaves alone: this clear is the only thing that ever
      // collects a roster held for a conversation no server's list carried.
      expect(selectRosterFor('a1')(store.getState())).toBeNull()
      expect(selectRosterFor('b1')(store.getState())).toBeNull()
      expect(selectRosterFor('orphan')(store.getState())).toBeNull()
    })

    it('is a same-reference no-op on an already-empty map (subscriber short-circuit)', () => {
      const store = createBackgroundTaskRosterStore()
      const before = store.getState()
      store.getState().clearAllRosters()

      expect(store.getState()).toBe(before)
    })

    it('returns initialBackgroundTaskRosterState BY REFERENCE, the clearAllBacklogs shape', () => {
      const store = createBackgroundTaskRosterStore()
      store.getState().setRoster({ conversationId: 'a1', tasks: [noCut], droppedTasks: 0 })
      store.getState().clearAllRosters()

      expect(store.getState().rosters).toBe(initialBackgroundTaskRosterState.rosters)
    })
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
    const store = createBackgroundTaskRosterStore({
      agentTimeline: new Map(),
      rosterAgentIds: new Map(),
      rosters: seed,
      unlistedStarts: new Map(),
      finishedTasks: new Map(),
      pendingStops: new Map()
    })
    expect(heldFor(store, 'c1')).toEqual({
      tasks: new Map([['t1', heldNoCut]]),
      droppedTasks: 4
    })
  })

  it('initialBackgroundTaskRosterState holds six empty maps', () => {
    expect(initialBackgroundTaskRosterState).toEqual({
      agentTimeline: new Map(),
      rosterAgentIds: new Map(),
      rosters: new Map(),
      unlistedStarts: new Map(),
      finishedTasks: new Map(),
      pendingStops: new Map()
    })
  })

  it('keeps the setter references stable across updates', () => {
    const store = createBackgroundTaskRosterStore()
    const setRoster = store.getState().setRoster
    const setStartedTask = store.getState().setStartedTask
    const setUpdatedTask = store.getState().setUpdatedTask
    const resetRostersFor = store.getState().resetRostersFor
    const clearAllRosters = store.getState().clearAllRosters
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setStartedTask(started())
    store.getState().setUpdatedTask(updated())

    expect(store.getState().setRoster).toBe(setRoster)
    expect(store.getState().setStartedTask).toBe(setStartedTask)
    expect(store.getState().setUpdatedTask).toBe(setUpdatedTask)
    expect(store.getState().resetRostersFor).toBe(resetRostersFor)
    expect(store.getState().clearAllRosters).toBe(clearAllRosters)
  })
})

// #1561: an update's `status` is the count's second removal path. The roster still decides what the
// panel LISTS; a terminal status only takes a listed task out of the pill's count, so a lost or late
// empty roster no longer leaves the pill lit for the rest of the session.
describe('selectLiveTaskCountFor — terminal status leaves the count (#1561)', () => {
  const count = (store: Store, conversationId = 'c1'): number =>
    selectLiveTaskCountFor(conversationId)(store.getState())
  const listBoth = (store: Store, droppedTasks = 0): void =>
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut, cutDescription], droppedTasks })

  it('reads 0 while no roster has arrived', () => {
    expect(count(createBackgroundTaskRosterStore())).toBe(0)
  })

  it('drops the only listed task on completed, leaving 0 (AC1)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    expect(count(store)).toBe(1)
    store.getState().setUpdatedTask(updated({ status: 'completed' }))
    expect(count(store)).toBe(0)
  })

  it.each(['completed', 'failed', 'stopped'])('treats %s as terminal: two listed read 1 (AC1)', (status) => {
    const store = createBackgroundTaskRosterStore()
    listBoth(store)
    store.getState().setUpdatedTask(updated({ taskId: 't2', status }))
    expect(count(store)).toBe(1)
  })

  it('leaves a finished task LISTED — only the count changes', () => {
    const store = createBackgroundTaskRosterStore()
    listBoth(store)
    store.getState().setUpdatedTask(updated({ status: 'completed' }))
    expect([...(selectRosterFor('c1')(store.getState())?.tasks.keys() ?? [])]).toEqual(['t1', 't2'])
  })

  // Exact match only: a case variant or a token the daemon has not emitted keeps the pill lit rather
  // than hiding live work.
  it.each(['', 'running', 'Completed', 'completed '])('does not remove on status %j (AC2)', (status) => {
    const store = createBackgroundTaskRosterStore()
    listBoth(store)
    store.getState().setUpdatedTask(updated({ status }))
    expect(count(store)).toBe(2)
  })

  it('does not restore a finished task on a later empty or unknown status (AC2)', () => {
    const store = createBackgroundTaskRosterStore()
    listBoth(store)
    store.getState().setUpdatedTask(updated({ status: 'failed' }))
    store.getState().setUpdatedTask(updated({ status: '' }))
    store.getState().setUpdatedTask(updated({ status: 'running' }))
    expect(count(store)).toBe(1)
  })

  it('does not return a finished task on a later roster that lists it again (AC3)', () => {
    const store = createBackgroundTaskRosterStore()
    listBoth(store)
    store.getState().setUpdatedTask(updated({ status: 'completed' }))
    listBoth(store)
    expect(count(store)).toBe(1)
  })

  it('does not return a finished task on a later started frame naming it (AC3)', () => {
    const store = createBackgroundTaskRosterStore()
    listBoth(store)
    store.getState().setUpdatedTask(updated({ status: 'completed' }))
    store.getState().setStartedTask(started())
    expect(count(store)).toBe(1)
    listBoth(store)
    expect(count(store)).toBe(1)
  })

  it('keeps a finish recorded while the start waited unlisted, once a roster lists it (AC3)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setStartedTask(started())
    store.getState().setUpdatedTask(updated({ status: 'stopped' }))
    listBoth(store)
    expect(count(store)).toBe(1)
  })

  it('still adds droppedTasks, which carry no id to match a status against (AC4)', () => {
    const store = createBackgroundTaskRosterStore()
    listBoth(store, 3)
    store.getState().setUpdatedTask(updated({ status: 'completed' }))
    expect(count(store)).toBe(4)
  })

  it('returns the state itself for a terminal update naming a task held nowhere', () => {
    const store = createBackgroundTaskRosterStore()
    listBoth(store)
    const before = store.getState()
    store.getState().setUpdatedTask(updated({ taskId: 'gone', status: 'completed' }))
    store.getState().setUpdatedTask(updated({ conversationId: 'c9', status: 'completed' }))
    expect(store.getState()).toBe(before)
    expect(before.finishedTasks.size).toBe(0)
  })

  it('prunes a finished id once a roster omits the task, so the set stays bounded by the roster', () => {
    const store = createBackgroundTaskRosterStore()
    listBoth(store)
    store.getState().setUpdatedTask(updated({ status: 'completed' }))
    store.getState().setRoster({ conversationId: 'c1', tasks: [cutDescription], droppedTasks: 0 })
    expect(store.getState().finishedTasks.has('c1')).toBe(false)
    expect(count(store)).toBe(1)
  })

  it('leaves another conversation\'s finished set by reference on a roster write', () => {
    const store = createBackgroundTaskRosterStore()
    listBoth(store)
    store.getState().setUpdatedTask(updated({ status: 'completed' }))
    const finished = store.getState().finishedTasks
    store.getState().setRoster({ conversationId: 'c2', tasks: [noCut], droppedTasks: 0 })
    expect(store.getState().finishedTasks).toBe(finished)
  })

  it('drops finished ids on the reconnecting server\'s reset and on the pairing clear', () => {
    const store = createBackgroundTaskRosterStore()
    listBoth(store)
    store.getState().setUpdatedTask(updated({ status: 'completed' }))
    store.getState().resetRostersFor(new Set(['c1']))
    expect(store.getState().finishedTasks.size).toBe(0)

    const paired = createBackgroundTaskRosterStore()
    listBoth(paired)
    paired.getState().setUpdatedTask(updated({ status: 'completed' }))
    paired.getState().clearAllRosters()
    expect(paired.getState().finishedTasks).toBe(initialBackgroundTaskRosterState.finishedTasks)
  })

  it('clears a store holding only a finished hold rather than short-circuiting', () => {
    const store = createBackgroundTaskRosterStore({
      agentTimeline: new Map(),
      rosterAgentIds: new Map(),
      rosters: new Map(),
      unlistedStarts: new Map(),
      finishedTasks: new Map([['c1', new Set(['t1'])]]),
      pendingStops: new Map()
    })
    store.getState().clearAllRosters()
    expect(store.getState().finishedTasks.size).toBe(0)
    store.setState({ finishedTasks: new Map([['c1', new Set(['t1'])]]) })
    store.getState().resetRostersFor(new Set(['c1']))
    expect(store.getState().finishedTasks.size).toBe(0)
  })
})

// #1635: the panel's read of one conversation's finished ids, which splits its list into Running and
// Finished. It hands back the HELD set, so the panel re-renders only when this conversation's
// membership changes.
describe('selectFinishedTasksFor — the panel grouping read (#1635)', () => {
  const finished = (store: Store, conversationId = 'c1'): ReadonlySet<string> | null =>
    selectFinishedTasksFor(conversationId)(store.getState())

  it('reads null while nothing has finished', () => {
    const store = createBackgroundTaskRosterStore()
    expect(finished(store)).toBeNull()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    expect(finished(store)).toBeNull()
  })

  it('reads the finished ids after a terminal status', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut, cutDescription], droppedTasks: 0 })
    store.getState().setUpdatedTask(updated({ taskId: 't2', status: 'failed' }))
    expect([...(finished(store) ?? [])]).toEqual(['t2'])
  })

  it('returns the same held set across a write for another conversation', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setUpdatedTask(updated({ status: 'completed' }))
    const before = finished(store)
    store.getState().setRoster({ conversationId: 'c2', tasks: [noCut], droppedTasks: 0 })
    store.getState().setUpdatedTask(updated({ conversationId: 'c2', status: 'completed' }))
    expect(finished(store)).toBe(before)
    expect(finished(store, 'c2')).not.toBe(before)
  })
})

// #1639: the held status word and terminal summary the panel's tag and summary line read. Both ride on
// the record, so every setter that rebuilds a record has to carry them, and each rebuild site has its
// own test here: dropping either field from one literal compiles clean and breaks nothing else.
describe('status word and terminal summary (#1639)', () => {
  it('holds the latest non-empty status word and keeps it across a later empty status (AC1)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    expect(heldTask(store, 'c1', 't1')?.status).toBeNull()
    store.getState().setUpdatedTask(updated({ status: '' }))
    expect(heldTask(store, 'c1', 't1')?.status).toBeNull()
    store.getState().setUpdatedTask(updated({ status: 'completed', summary: 'done' }))
    store.getState().setUpdatedTask(updated({ status: '' }))
    expect(heldTask(store, 'c1', 't1')?.status).toBe('completed')
  })

  it('holds an unknown word while the task stays counted as running (AC1)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setUpdatedTask(updated({ status: 'paused', summary: 'not terminal' }))
    expect(heldTask(store, 'c1', 't1')?.status).toBe('paused')
    // A non-terminal frame records no summary, whatever it carried.
    expect(heldTask(store, 'c1', 't1')?.summary).toBeNull()
    expect(selectLiveTaskCountFor('c1')(store.getState())).toBe(1)
    expect(selectFinishedTasksFor('c1')(store.getState())).toBeNull()
  })

  it('records the terminal frame summary with its own cut report, null passed straight across (AC2)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut, cutDescription], droppedTasks: 0 })
    store.getState().setUpdatedTask(updated({ status: 'completed', summary: 'built in 38s' }))
    store.getState().setUpdatedTask(
      updated({ taskId: 't2', status: 'failed', summary: 'exit 1', truncatedFields: ['summary'] })
    )
    expect(heldTask(store, 'c1', 't1')?.summary).toEqual({ text: 'built in 38s', truncatedFields: null })
    expect(heldTask(store, 'c1', 't2')?.summary).toEqual({ text: 'exit 1', truncatedFields: ['summary'] })
    // An empty summary is a recorded value, not an absence: the view decides it draws no line.
    store.getState().setUpdatedTask(updated({ status: 'stopped', summary: '' }))
    expect(heldTask(store, 'c1', 't1')?.summary).toEqual({ text: '', truncatedFields: null })
  })

  it('keeps the summary across a later non-terminal frame', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setUpdatedTask(updated({ status: 'completed', summary: 'done' }))
    store.getState().setUpdatedTask(updated({ status: '', summary: '' }))
    expect(heldTask(store, 'c1', 't1')?.summary?.text).toBe('done')
  })

  it('carries both across a roster that lists a roster-sourced task again (AC1)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setUpdatedTask(updated({ status: 'failed', summary: 'exit 1' }))
    store.getState().setRoster({ conversationId: 'c1', tasks: [{ ...noCut, description: 'newer' }], droppedTasks: 0 })
    const held = heldTask(store, 'c1', 't1')
    expect(held?.description).toBe('newer')
    expect(held?.status).toBe('failed')
    expect(held?.summary?.text).toBe('exit 1')
  })

  it('carries both across a roster that lists a started-sourced task again', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setStartedTask(started())
    store.getState().setUpdatedTask(updated({ status: 'stopped', summary: 'stopped by user' }))
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    expect(heldTask(store, 'c1', 't1')?.status).toBe('stopped')
    expect(heldTask(store, 'c1', 't1')?.summary?.text).toBe('stopped by user')
  })

  it('carries both across a start that arrives after the update', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setUpdatedTask(updated({ status: 'completed', summary: 'done' }))
    store.getState().setStartedTask(started())
    expect(heldTask(store, 'c1', 't1')?.toolCallId).toBe('tc-1')
    expect(heldTask(store, 'c1', 't1')?.status).toBe('completed')
    expect(heldTask(store, 'c1', 't1')?.summary?.text).toBe('done')
  })

  it('records both on an unlisted hold and moves them in with the listing', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setStartedTask(started())
    store.getState().setUpdatedTask(updated({ status: 'failed', summary: 'exit 2' }))
    expect(store.getState().unlistedStarts.get('c1')?.get('t1')?.status).toBe('failed')
    store.getState().setStartedTask(started())
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    expect(heldTask(store, 'c1', 't1')?.status).toBe('failed')
    expect(heldTask(store, 'c1', 't1')?.summary).toEqual({ text: 'exit 2', truncatedFields: null })
  })

  it('records nothing for an update naming a task held nowhere', () => {
    const store = createBackgroundTaskRosterStore()
    const before = store.getState()
    store.getState().setUpdatedTask(updated({ status: 'completed', summary: 'done' }))
    expect(store.getState()).toBe(before)
  })
})

/** A `background_task_progress` write unit for `t1` (#1640): the two ids plus the running report. */
function progress(
  overrides: Partial<BackgroundTaskProgressSnapshot> = {}
): BackgroundTaskProgressSnapshot {
  return {
    conversationId: 'c1',
    taskId: 't1',
    currentActivity: 'Reading alpha.txt',
    subagentType: 'general-purpose',
    lastToolName: 'Read',
    totalTokens: 18000,
    toolUses: 4,
    durationMs: 161000,
    truncatedFields: null,
    ...overrides
  }
}

describe('latest progress report (#1640)', () => {
  it('holds the report on a listed task, truncatedFields: null straight across', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setTaskProgress(progress())
    expect(heldTask(store, 'c1', 't1')?.progress).toEqual({
      currentActivity: 'Reading alpha.txt',
      subagentType: 'general-purpose',
      lastToolName: 'Read',
      totalTokens: 18000,
      toolUses: 4,
      durationMs: 161000,
      truncatedFields: null
    })
    expect(heldTask(store, 'c1', 't1')?.progress?.truncatedFields).toBeNull()
  })

  it('replaces an older report with a newer one, counters as received (never summed)', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setTaskProgress(progress())
    store.getState().setTaskProgress(
      progress({ currentActivity: 'Writing beta.txt', toolUses: 3, truncatedFields: ['description'] })
    )
    const held = heldTask(store, 'c1', 't1')?.progress
    expect(held?.currentActivity).toBe('Writing beta.txt')
    expect(held?.toolUses).toBe(3)
    expect(held?.truncatedFields).toEqual(['description'])
  })

  it('keeps the report across a later roster and a later started frame for the task', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setTaskProgress(progress())
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    expect(heldTask(store, 'c1', 't1')?.progress?.currentActivity).toBe('Reading alpha.txt')
    store.getState().setStartedTask(started())
    expect(heldTask(store, 'c1', 't1')?.toolCallId).toBe('tc-1')
    expect(heldTask(store, 'c1', 't1')?.progress?.currentActivity).toBe('Reading alpha.txt')
    // …and a roster after the start keeps the started record whole, report included.
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    expect(heldTask(store, 'c1', 't1')?.progress?.currentActivity).toBe('Reading alpha.txt')
  })

  it('records a report on an unlisted hold and moves it in with the listing', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setStartedTask(started())
    store.getState().setTaskProgress(progress())
    expect(heldFor(store, 'c1')).toBeNull()
    expect(store.getState().unlistedStarts.get('c1')?.get('t1')?.progress?.lastToolName).toBe('Read')
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    expect(heldTask(store, 'c1', 't1')?.progress?.lastToolName).toBe('Read')
  })

  it('creates nothing for a report naming a task or a conversation the store does not hold', () => {
    const store = createBackgroundTaskRosterStore()
    const empty = store.getState()
    store.getState().setTaskProgress(progress())
    expect(store.getState()).toBe(empty)
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    const before = store.getState()
    store.getState().setTaskProgress(progress({ taskId: 'nope' }))
    store.getState().setTaskProgress(progress({ conversationId: 'c9' }))
    expect(store.getState()).toBe(before)
  })

  it('leaves the finished set, the count and the latest update alone', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', tasks: [noCut], droppedTasks: 0 })
    store.getState().setUpdatedTask(updated({ status: 'completed' }))
    const finished = store.getState().finishedTasks
    store.getState().setTaskProgress(progress())
    expect(store.getState().finishedTasks).toBe(finished)
    expect(selectLiveTaskCountFor('c1')(store.getState())).toBe(0)
    expect(heldTask(store, 'c1', 't1')?.latestUpdate?.patch).toBe('{"is_backgrounded":true}')
    expect(heldTask(store, 'c1', 't1')?.status).toBe('completed')
  })
})

describe('connect Agent provenance and placement', () => {
  const agent = (id: string, tool_call_id?: string, description = id): BackgroundTask => ({
    task_id: id, task_type: 'local_agent', description, truncated_fields: null, tool_call_id
  })
  it('refreshes roster metadata despite an id, and preserves started metadata even with an empty started id', () => {
    const store = createBackgroundTaskRosterStore()
    const roster = (row: BackgroundTask) => store.getState().setRoster({ conversationId: 'c1', droppedTasks: 0, tasks: [row] })
    roster(agent('t1', 'roster-id', 'first'))
    roster({ ...agent('t1', 'roster-id', 'refreshed'), truncated_fields: ['description'] })
    expect(heldTask(store, 'c1', 't1')).toMatchObject({ toolCallId: 'roster-id', description: 'refreshed', truncatedFields: ['description'] })
    store.getState().setStartedTask(started({ toolCallId: '', taskType: 'started-type', description: 'started' }))
    roster(agent('t1', 'roster-id', 'third'))
    expect(heldTask(store, 'c1', 't1')).toMatchObject({ toolCallId: 'roster-id', description: 'started', taskType: 'started-type', truncatedFields: null })
    expect(store.getState().agentTimeline.get('c1')?.get('t1')).toMatchObject({ toolCallId: 'roster-id', description: 'started', confirmed: true })
  })
  it('prefers roster ids, falls back to started ids and does not reorder established starts', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setStartedTask(started({ taskId: 'b', toolCallId: 'started-b', taskType: 'local_agent' }))
    store.getState().setStartedTask(started({ taskId: 'a', toolCallId: 'started-a', taskType: 'local_agent' }))
    const roster = (rows: BackgroundTask[]) => store.getState().setRoster({ conversationId: 'c1', droppedTasks: 0, tasks: rows })
    roster([agent('a', 'roster-a'), agent('b', ''), agent('c', ' c '), agent('unknown', '')])
    const evidence = () => store.getState().agentTimeline.get('c1')
    expect([...evidence()?.keys() ?? []]).toEqual(['b', 'a', 'c'])
    expect(evidence()?.get('a')?.toolCallId).toBe('roster-a')
    expect(evidence()?.get('b')?.toolCallId).toBe('started-b')
    const identity = evidence()?.get('a')?.identity
    roster([agent('c', ' c '), agent('a'), agent('b', 'roster-b')])
    expect([...evidence()?.keys() ?? []]).toEqual(['b', 'a', 'c'])
    expect(evidence()?.get('a')?.toolCallId).toBe('started-a')
    expect(evidence()?.get('a')?.identity).toBe(identity)
  })
  it('refreshes display types without qualifying non-agent rosters from started types', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setRoster({ conversationId: 'c1', droppedTasks: 0, tasks: [agent('t1', 'r')] })
    store.getState().setRoster({ conversationId: 'c1', droppedTasks: 0, tasks: [{ ...agent('t1', 'r'), task_type: 'local_bash' }] })
    expect(heldTask(store, 'c1', 't1')?.taskType).toBe('local_bash')
    store.getState().setStartedTask(started({ taskId: 'other', taskType: 'local_agent', toolCallId: 'other' }))
    store.getState().setRoster({ conversationId: 'c1', droppedTasks: 0, tasks: [{ ...agent('other', 'other'), task_type: 'local_bash' }] })
    expect(store.getState().agentTimeline.get('c1')?.get('other')?.confirmed).toBe(false)
  })
})

it('retains a provisional terminal through empty repeated starts, then resets identity at ownership boundaries', () => {
  const store = createBackgroundTaskRosterStore()
  const roster = () => store.getState().setRoster({ conversationId: 'c1', droppedTasks: 0, tasks: [
    { task_id: 't1', tool_call_id: 'r', task_type: 'local_agent', description: 'work', truncated_fields: null }
  ] })
  roster()
  const first = store.getState().agentTimeline.get('c1')?.get('t1')
  store.getState().setRoster({ conversationId: 'c1', droppedTasks: 0, tasks: [] })
  expect(selectLiveTaskCountFor('c1')(store.getState())).toBe(0)
  expect(store.getState().agentTimeline.get('c1')?.get('t1')?.finishBefore).toBeNull()
  store.getState().setUpdatedTask(updated({ status: 'future-status' }), 4)
  expect(store.getState().agentTimeline.get('c1')?.get('t1')?.finishBefore).toBeNull()
  store.getState().setUpdatedTask(updated({ status: 'completed' }), 4)
  store.getState().setStartedTask(started({ toolCallId: '', taskType: 'local_agent' }))
  store.getState().setUpdatedTask(updated({ status: 'stopped' }), 9)
  expect(store.getState().agentTimeline.get('c1')?.get('t1')).toMatchObject({ toolCallId: 'r', finishBefore: 4, finishOrder: 1 })
  store.getState().resetRostersFor(new Set(['c1']))
  expect(store.getState().agentTimeline.has('c1')).toBe(false)
  roster()
  const second = store.getState().agentTimeline.get('c1')?.get('t1')?.identity
  expect(second).not.toBe(first?.identity)
  store.getState().clearAllRosters()
  expect(store.getState().agentTimeline.size).toBe(0)
  roster()
  expect(store.getState().agentTimeline.get('c1')?.get('t1')?.identity).not.toBe(second)
})
