// The daemon's live background-task set, kept per conversation as one unidirectional source of truth
// for the panel slice (#568). Pure renderer state — no IPC, no preload bridge, no transport. The data
// path (backgroundTaskRosterBridge.ts) observes two typed daemon events — the `backgroundTaskRoster`
// aggregate (#566) and the `backgroundTaskStarted` scalar (#564) — and JOINS them here on
// `conversationId` + `taskId`, never on arrival order: ordering within a turn is claude's, not the
// daemon's, so a roster can arrive either side of the started frame for a task it lists.
//
// A dedicated store in the queueStore posture: these frames are daemon STATE, not part of claude's
// turn stream (they carry no turn_id and open and close no turn — the queue_state rule, SSOT
// pyrycode #720), so they get their own store and are never folded into the thread-timeline reducer.
// It mirrors queueStore's DI-factory → singleton → hook → selector structure and its ReadonlyMap
// copy-on-write.
//
// The held value is PER TASK (`HeldBackgroundTask`, camelCase, keyed by `taskId`) rather than the wire
// rows verbatim. #573 held the rows by reference in snake_case, which is the correct house rule for a
// nested array passed through untouched; it stops applying the moment a join exists, because a
// started-sourced task carries a `toolCallId` and a fuller description that NO roster row can report
// (`BackgroundTask` deliberately has no `tool_call_id` — CLAUDE.md and ADR 0002 forbid drifting it and
// src/shared/wire/types.test.ts pins the absence). Synthesising a `BackgroundTask` for a started-only
// task would put a manufactured object into a type documented as mirroring the daemon field-for-field,
// so the mapping goes the other way: both sources map INTO the renderer-side held record.
//
// That mapping is what falsifies #573's header claim that "`truncated_fields: null` is never collapsed
// into `[]`" holds BY CONSTRUCTION, since there is now exactly the per-row mapping in which a collapse
// could occur. What defends it instead is (a) a straight assignment on both write paths — no `??`
// anywhere near `truncatedFields` — and (b) two tests, one per path, that fail if a collapse is
// introduced (AC3). A collapse is not a type error and breaks no other test; those tests are the whole
// defence.
//
// Keyed by `conversationId`, NOT a flat slot: the daemon fans these frames out to every interactive
// connection and each carries `conversation_id`, so frames for DIFFERENT conversations arrive in
// sequence and a single "hold the latest" slot would let one clobber another (the clobber queueStore
// documents and keys around). Three named setters rather than a reducer — record a conversation's
// roster, record one started task, and clear everything on the `connected` edge — because a
// discriminated-union action set for three operations is still ceremony without benefit.
// Unidirectional is preserved: read-only selectors, one write path per frame, and no setter is
// two-way-bound from a component.
//
// The names `BackgroundTaskRosterEntry` / `setRoster` / `selectRosterFor` / `backgroundTaskRosterStore`
// are KEPT even though the entry now holds a joined set rather than a verbatim roster: the roster frame
// is still replacement truth for the set's MEMBERSHIP, so "roster" is still the right word, and
// renaming would churn every test call site and App.tsx for no behavioural gain (CLAUDE.md's "don't
// refactor adjacent code while you are there"). Retained deliberately, not by oversight.
//
// SECURITY: a task's `description` is untrusted, model-influenced daemon-relayed text and for
// `taskType: local_bash` IS the literal command line claude ran. This store neither renders nor
// interprets it — #568 must render it as INERT PLAIN TEXT (never an HTML sink, an attribute, or a
// URL) and must never execute or re-shell it. `tasks` is a DISPLAY set; its collection shape is not an
// invitation to iterate it as a work list something acts on. Nothing here iterates it. Nothing here is
// persisted either, and it must not be: `resetRosters` on the `connected` edge is what keeps a previous
// PAIRING's command lines from ever appearing, and web storage would survive that boundary.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { BackgroundTask } from '@shared/wire/types'

/** ONE background task as this app holds it — the join of what the two frames each report, mapped to
 *  renderer-side camelCase from whichever source last spoke about it.
 *
 *  `toolCallId: string | null`, REQUIRED and nullable rather than optional: only the
 *  `background_task_started` frame reports a tool call, and a task the app only ever learns about from
 *  a roster genuinely has none. `null` is outside the identifier's domain, so it cannot be mistaken for
 *  a real tool call — whereas `''` is the SAME identifier `toolUse` / `toolResult` carry and would join
 *  wrongly against a real one. Required-and-nullable also makes every construction site state the
 *  value; an optional property would let one silently omit it and still compile.
 *
 *  That field doubles as the PROVENANCE PREDICATE: a held task is started-sourced exactly when
 *  `toolCallId !== null`, which is exact by the wire's construction (the started frame always reports
 *  one, no roster row ever can). It must be tested with `!== null` and NEVER for truthiness —
 *  `requireString` admits `''`, so a daemon-sent `tool_call_id: ''` is a valid value that a truthiness
 *  check would silently demote to roster-sourced. Any field added here that a roster row cannot report
 *  must join that predicate.
 *
 *  `truncatedFields` is assigned straight across from whichever frame supplied it — `null` ("nothing
 *  was cut") is a distinct value from `[]` and is never collapsed into it. The two frames' lists name
 *  DIFFERENT vocabularies (started: `task_id` / `tool_call_id` / `description` / `task_type`; roster
 *  row: `task_id` / `task_type` / `description`), so a started frame REPLACES this list rather than
 *  unioning with it: one flattened list per task would be a list no reader can attribute back to a
 *  field.
 *
 *  `taskId` is carried in the value as well as being the map key — redundant by one field so that #568
 *  can iterate values without threading entry keys alongside them.
 *
 *  Deliberately carries NO terminal / finished / failed state: the daemon reports no finish, so absence
 *  from a LATER roster is the only removal path this family has, and modelling anything more would be a
 *  claim the wire cannot support. */
export interface HeldBackgroundTask {
  taskId: string
  toolCallId: string | null
  taskType: string
  description: string
  truncatedFields: readonly string[] | null
}

/** The held value for ONE conversation: the tasks currently believed alive, keyed by `taskId`, plus the
 *  roster's own truncation report. `ReadonlyMap` rather than an array: the join and the upsert are each
 *  one expression, duplicate `task_id`s are impossible by construction rather than by a scan, and JS
 *  `Map` preserves insertion order so display order is still ROSTER order. The map is built at WRITE
 *  time, so `selectRosterFor` can hand back the held entry itself and construct nothing per call.
 *
 *  `droppedTasks` is the roster's ONLY truncation report — the daemon caps a roster at 8 rows
 *  (`maxTaskRosterEntries`) — so THE TRUE ROSTER SIZE IS `tasks.size + droppedTasks`, and a reader that
 *  shows only the carried tasks silently presents a capped roster as the whole one. `0` is a value,
 *  never consulted for truthiness. A started frame reports nothing about roster truncation, so
 *  `setStartedTask` PRESERVES this count rather than resetting it. */
export interface BackgroundTaskRosterEntry {
  tasks: ReadonlyMap<string, HeldBackgroundTask>
  droppedTasks: number
}

/** The roster write unit — one conversation's roster snapshot = the `backgroundTaskRoster` daemon-event
 *  arm minus its `type` tag, carrying the WIRE ROWS as they arrived. Deliberately no longer extends
 *  `BackgroundTaskRosterEntry`: the entry's `tasks` is the held map, this one's is the wire array. The
 *  bridge hands the rows over verbatim and `setRoster` does the row → `HeldBackgroundTask` mapping,
 *  because that is where the prior state the join needs lives. */
export interface BackgroundTaskRosterSnapshot {
  conversationId: string
  tasks: readonly BackgroundTask[]
  droppedTasks: number
}

/** The started write unit — the `backgroundTaskStarted` daemon-event arm minus its `type` tag. Six
 *  fields, and `toolCallId` is NON-nullable here because the frame always reports one; the nullability
 *  appears only in `HeldBackgroundTask`, where a roster-sourced task has none. */
export interface BackgroundTaskStartedSnapshot {
  conversationId: string
  taskId: string
  toolCallId: string
  taskType: string
  description: string
  truncatedFields: readonly string[] | null
}

/** The whole state: each conversation's held task set, keyed by `conversationId`. A key ABSENT from the
 *  map means "NO frame has ever arrived for that conversation" and is a DISTINCT state from a present
 *  entry holding an empty `tasks` map ("observed, nothing alive") — see `selectRosterFor`, which
 *  preserves that distinction rather than collapsing it. `ReadonlyMap` signals the setters REPLACE the
 *  map, never mutate it in place. */
export interface BackgroundTaskRosterState {
  rosters: ReadonlyMap<string, BackgroundTaskRosterEntry>
}

/** Store shape = state + the three mutation entry points: record one conversation's roster, record one
 *  started task, and clear everything on the `connected` edge (AC5). */
export type BackgroundTaskRosterStore = BackgroundTaskRosterState & {
  setRoster: (snapshot: BackgroundTaskRosterSnapshot) => void
  setStartedTask: (snapshot: BackgroundTaskStartedSnapshot) => void
  resetRosters: () => void
}

export const initialBackgroundTaskRosterState: BackgroundTaskRosterState = { rosters: new Map() }

/**
 * DI-friendly, React-free store — one isolated instance per test. Copy-on-write throughout (the
 * queueStore idiom): clone the outer map, clone the inner map, replace. Never mutate `s.rosters`, an
 * entry, or an entry's `tasks` in place. A write for one conversation leaves every other entry object
 * identical, so a component watching a different `conversationId` sees `Object.is` true and does not
 * re-render.
 *
 * `setRoster` rebuilds the conversation's set from the snapshot's rows IN ROW ORDER. For each row: if a
 * task is already held for that `task_id` AND is started-sourced (`toolCallId !== null` — see
 * `HeldBackgroundTask`), the held record is KEPT UNCHANGED; otherwise a fresh record is built from the
 * row with `toolCallId: null`. Keeping the started record is AC2 and the point of this slice: the
 * daemon's own cap comment states the roster label is the same text under a tighter cap and that its
 * authoritative full-length copy already crossed the wire on the `background_task_started` the row
 * joins back to, so refreshing from the row would throw the better copy away at the first roster and
 * never get it back (the started frame never repeats). Roster-sourced records ARE rebuilt from each new
 * row, so the roster stays replacement truth for everything it can actually report.
 *
 * MEMBERSHIP is replacement truth regardless of provenance (AC5): a held task whose id is absent from
 * the new roster is simply not carried over, whether a roster or a started frame first reported it.
 * That absence is this family's only removal path — the daemon reports no finish. `droppedTasks` is
 * taken from the snapshot unconditionally.
 *
 * The roster write is UNCONDITIONAL, and that is the point of this store: an empty `tasks: []` sets
 * that key to an entry holding no tasks ("the daemon says nothing is alive for this conversation" — the
 * payoff signal of pyrycode#1240), it does NOT delete the key and is never dropped, filtered, or
 * coalesced as "no news". Because a present-but-empty entry and an absent key are different map
 * states, `selectRosterFor` can hand back `null` for the latter and keep the two apart.
 *
 * `setStartedTask` upserts one task into its conversation's entry, CREATING the entry when no frame has
 * arrived for that conversation yet — claude orders these, not the daemon, so a started frame may
 * precede the roster that lists it, or arrive for a conversation no roster ever follows for. `Map.set`
 * keeps an existing key's position, so upgrading a roster-held task in place preserves roster order
 * while a genuinely new task appends. The snapshot's `description` / `taskType` / `truncatedFields`
 * REPLACE whatever the task held (AC2), and `truncatedFields` in particular replaces rather than
 * unions — the two frames' lists name different vocabularies. `droppedTasks` is PRESERVED from the
 * existing entry (or `0` when creating one): a started frame reports nothing about roster truncation and
 * must not reset the count.
 *
 * GROWTH BOUND, stated rather than defended: the daemon caps a roster at 8 rows and every frame at the
 * 65519-byte envelope, but it emits a roster only when claude emits one — it synthesises none. So a
 * started task for a conversation that never receives a subsequent roster is held until the `connected`
 * edge clears it, and the count of such tasks is bounded only by how many started frames claude emits
 * between rosters, times the conversations seen since connect. At ~5 KB per held task that is not a
 * plausible exhaustion vector from a bounded-frame stream, and no speculative eviction policy is built
 * for a failure nobody has observed. The one user-visible consequence: a started-only task stays listed
 * until a roster contradicts it — already true of every task in this family, because the wire reports
 * no finish.
 *
 * `resetRosters` (AC5) is the `connected` edge: the relay re-emits `connected` on every (re)handshake
 * and a new pairing always re-handshakes, so clearing the WHOLE map here is what keeps a previous
 * connection's — or a previous PAIRING's — tasks from ever appearing, started-sourced ones included.
 * Clearing the map IS returning every conversation to "nothing observed", so no per-key eviction loop is
 * needed. Nothing repopulates it: these frames are not in the daemon's reconcile-on-connect set (that
 * set is outstanding `modal_shown` per pyrycode#877 and `queue_state` per non-empty backlog per
 * pyrycode#878) and this app advertises no `last_event_id`, so the set reads `null` until claude next
 * emits one. That is the correct, honest behaviour — retaining the pre-disconnect set would present a
 * stale list as live (#569 owns closing that gap, and it needs a daemon-side change). Copy-on-write like
 * the setters; returning the SAME state reference when the map is already empty makes zustand's
 * `Object.is` short-circuit fire — no listener churn on a first connect or a reconnect that held nothing.
 */
export function createBackgroundTaskRosterStore(
  init: BackgroundTaskRosterState = initialBackgroundTaskRosterState
) {
  return createStore<BackgroundTaskRosterStore>((set) => ({
    ...init,
    setRoster: (snapshot) =>
      set((s) => {
        const previous = s.rosters.get(snapshot.conversationId)?.tasks
        const tasks = new Map<string, HeldBackgroundTask>()
        for (const row of snapshot.tasks) {
          const held = previous?.get(row.task_id)
          // `!== null`, never truthiness: `''` is a valid `tool_call_id` and still proves the started
          // frame was seen, so a truthy check would demote such a task and lose its fuller label.
          tasks.set(
            row.task_id,
            held !== undefined && held.toolCallId !== null
              ? held
              : {
                  taskId: row.task_id,
                  toolCallId: null,
                  taskType: row.task_type,
                  description: row.description,
                  // Straight across — no `?? []`. `null` means nothing was cut for this row and is a
                  // distinct value; this assignment plus its test is the whole AC3 defence.
                  truncatedFields: row.truncated_fields
                }
          )
        }
        const next = new Map(s.rosters)
        next.set(snapshot.conversationId, { tasks, droppedTasks: snapshot.droppedTasks })
        return { rosters: next }
      }),
    setStartedTask: (snapshot) =>
      set((s) => {
        const existing = s.rosters.get(snapshot.conversationId)
        const tasks = new Map<string, HeldBackgroundTask>(existing?.tasks)
        tasks.set(snapshot.taskId, {
          taskId: snapshot.taskId,
          toolCallId: snapshot.toolCallId,
          taskType: snapshot.taskType,
          description: snapshot.description,
          truncatedFields: snapshot.truncatedFields
        })
        const next = new Map(s.rosters)
        next.set(snapshot.conversationId, { tasks, droppedTasks: existing?.droppedTasks ?? 0 })
        return { rosters: next }
      }),
    resetRosters: () => set((s) => (s.rosters.size === 0 ? s : { rosters: new Map() }))
  }))
}

/** App-wide singleton — the one source of truth the data path writes and #568 reads. */
export const backgroundTaskRosterStore = createBackgroundTaskRosterStore()

/** Narrow-slice React binding for #568. Selecting a single conversation's roster avoids cross-facet
 *  re-renders. */
export function useBackgroundTaskRosterStore<T>(selector: (s: BackgroundTaskRosterStore) => T): T {
  return useStore(backgroundTaskRosterStore, selector)
}

/**
 * The primary read surface (#568) — a selector FACTORY bound to one `conversationId`.
 *
 * `?? null`, and NOT the queueStore precedent's `?? EMPTY_BACKLOG`: that collapse is correct for
 * `queue_state` but would silently violate AC5 here, because "no frame has ever arrived" and
 * "observed, nothing alive" would then both read as a bare empty collection — with no type error and no
 * failing test unless one is written for it. The three readings are distinct:
 *
 *   key absent                            → `null`         no frame has ever arrived
 *   `{ tasks: Map{}, droppedTasks: 0 }`   → that entry     observed, nothing alive
 *   `{ tasks: Map{t}, droppedTasks: 2 }`  → that entry     1 task carried, 3 truly alive
 *
 * `null` is a STABLE reference by construction, which is the whole reason queueStore hoists
 * `EMPTY_BACKLOG` to module scope (a fresh `[]` per selector call churns re-renders) — so this slice
 * needs no `EMPTY_*` constant at all. It returns the HELD ENTRY ITSELF, never a freshly built object or
 * array: the task map is assembled at write time precisely so this stays true. The nullable return type
 * also forces #568 to branch, so the distinction cannot be ignored accidentally. And it is what makes
 * AC5 verifiable: after `resetRosters` every key is absent, so every conversation reads `null` —
 * genuinely back to "nothing observed" rather than indistinguishable from observed-empty.
 *
 * Narrow-slice-correct: a write for a DIFFERENT conversation produces a new map, but
 * `newMap.get(openId)` returns the SAME entry object → `Object.is` true → no re-render of a component
 * watching `openId`. These selectors are the sole read path, never two-way-bound from a component.
 * There is deliberately no whole-map analogue of `selectBacklogs`: the reset clears the map wholesale
 * and nothing else reads it, so shipping one would ship an unread read surface.
 */
export const selectRosterFor =
  (conversationId: string) =>
  (s: BackgroundTaskRosterState): BackgroundTaskRosterEntry | null =>
    s.rosters.get(conversationId) ?? null
