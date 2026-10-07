// The daemon's live background-task set, kept per conversation as one unidirectional source of truth
// for the panel slice (#568). Pure renderer state — no IPC, no preload bridge, no transport. The data
// path (backgroundTaskRosterBridge.ts) observes three typed daemon events — the `backgroundTaskRoster`
// aggregate (#566), the `backgroundTaskStarted` scalar (#564) and the `backgroundTaskUpdated` scalar
// (#565) — and JOINS them here on `conversationId` + `taskId`, never on arrival order: ordering within
// a turn is claude's, not the daemon's, so a roster can arrive either side of the started frame for a
// task it lists, and an update can arrive for a task neither has named yet.
//
// The ROSTER decides what is LISTED (#1563); an update's terminal `status` decides what is COUNTED (#1561). claude sends a start for foreground work too — a Bash call
// past about three seconds, `is_backgrounded: false`, a flag the daemon drops — and no roster ever lists
// it; claude's roster line is the background set. So `rosters` holds only what a roster has listed, and a
// start for a task no roster has listed waits in `unlistedStarts`, which no surface reads, until a
// roster either lists it (it moves in whole) or speaks for the conversation without it (it is dropped).
// A task claude reports `completed` / `failed` / `stopped` stays listed until a roster omits it, but
// leaves the pill's count at once (#1561): the empty roster that usually precedes that frame on claude
// 2.1.280 is not guaranteed, and without it the pill stayed lit for the rest of the session.
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
// documents and keys around). Four named setters rather than a reducer — record a conversation's
// roster, record one started task, record one task's latest patch, and clear everything on the
// `connected` edge — because a discriminated-union action set for four operations is still ceremony
// without benefit.
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
// `taskType: local_bash` IS the literal command line claude ran, and its `latestUpdate.patch` is the
// same class of text under a structured-looking shape (see `HeldBackgroundTaskUpdate`). This store
// neither renders nor interprets either — #568 must render both as INERT PLAIN TEXT (never an HTML
// sink, an attribute, or a URL) and must never execute or re-shell them. `tasks` is a DISPLAY set; its
// collection shape is not an invitation to iterate it as a work list something acts on. Nothing here
// iterates it. Nothing here is persisted either, and it must not be: what keeps a previous PAIRING's
// command lines and patches from ever appearing is `clearAllRosters` at the pairing boundary (#1139),
// and web storage would survive that boundary. Until #1139 the sole guard was `resetRosters` on the
// `connected` edge; scoping that edge to the reconnecting server moved the pairing half of the
// guarantee onto the new clear, and the no-persistence obligation is unchanged by the move — it is
// re-attributed here, not weakened.
//
// This store answers to BOTH pairing-lifecycle mechanisms, the `queueStore` posture (#1138): the
// `connected` edge drops the reconnecting server's rosters (`resetRostersFor`, #573 scoped by #1139)
// and the pairing-scoped clear (`clearAllRosters`, #1139) lands in `clearPairingScopedState`'s
// injected dep set. See `createBackgroundTaskRosterStore`'s docblock for why scoping the first one
// required the second.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { BackgroundTask } from '@shared/wire/types'

/** The latest change claude reported about ONE task, plus the cut report FOR THAT PATCH — one record,
 *  because a held task cannot sensibly carry a patch cut report without a patch, and nesting makes that
 *  disagreement unrepresentable rather than merely untested.
 *
 *  `patch` is held VERBATIM as OPAQUE TEXT and is never parsed here. It is not guaranteed to be valid
 *  JSON: the daemon truncates it at construction, so a truncated object no longer parses (its own
 *  golden fixture is cut mid-token), which is why the daemon types it as a plain string rather than raw
 *  JSON. `patch: ''` is a VALUE meaning "claude sent no change" — it always arrives on the wire (the
 *  daemon's field has no `omitempty`) — and is a DIFFERENT reading from `latestUpdate: null`, which
 *  means no update has ever matched the task. Neither substitutes for the other. A reader that wants
 *  the patch's keys must parse BEHIND AN ERROR BRANCH that falls back to inert text, and must never
 *  enumerate a closed key set (the daemon enumerates none, because a mapping that listed the keys it
 *  knew would silently discard every key claude ships next).
 *
 *  `truncatedFields` here is the PATCH's own cut report and names a different vocabulary (`task_id` /
 *  `patch`) from the task's own list — hence a second field rather than a third competitor for the
 *  first one, which is what keeps every list attributable back to the field it describes. It reports
 *  the CAP CUT ONLY: the daemon also scrubs invalid UTF-8 by deletion, so `patch` may differ from
 *  claude's bytes without appearing here. Record it, never cross-check it against the patch. `null`
 *  ("nothing was cut") is assigned straight across and never collapsed into `[]`.
 *
 *  Deliberately NOT a history: latest-wins, one record per task. An append-only list keyed by a
 *  `task_id` the model influences and fed by the daemon's push stream would be unbounded growth on
 *  attacker-influenceable input — the daemon's own cap (`maxTaskPatch`, 4 KiB) is per FRAME, not per
 *  task. And a PATCH is never a finish signal, so nothing here may be read as `completed` / `failed`. The
 *  finish signal is the update's own `status` (#1561), which is not held on this record at all: it is
 *  recorded as a finished id in `BackgroundTaskRosterState.finishedTasks`.
 *
 *  SECURITY: `patch` is UNTRUSTED, model-influenced daemon-relayed text whose keys may carry command
 *  text exactly as `description` does. #568 must render it as INERT PLAIN TEXT — never HTML (no
 *  `innerHTML` / `dangerouslySetInnerHTML`), never into an attribute or a URL — and must never execute,
 *  re-shell, or otherwise feed it to something that runs it. The daemon states this rule in THIS
 *  frame's own section rather than delegating it to the sibling's, because a patch's structured shape
 *  makes it the more tempting thing to feed somewhere structured. This store has no DOM sink and runs
 *  no `JSON.parse`; carrying the constraint here is how it reaches the reader. */
export interface HeldBackgroundTaskUpdate {
  patch: string
  truncatedFields: readonly string[] | null
}

/** The summary claude sent with a task's TERMINAL status (#1639), plus that frame's cut report, so the
 *  panel can tell whether `summary` was cut. Recorded only from a frame whose status is terminal and
 *  kept across every later frame, terminal ones replacing it. `text: ''` is a recorded value (the frame
 *  always carries the field); the view is what decides an empty summary draws no line.
 *
 *  `truncatedFields` is the whole frame's list, straight across — `null` is never collapsed into `[]`.
 *
 *  SECURITY: `text` is UNTRUSTED, model-authored text, observed carrying a literal command line. It is
 *  the same class as `description` and `patch`: inert escaped text only, never an attribute, a class
 *  name, a key or a log line. */
export interface HeldBackgroundTaskSummary {
  text: string
  truncatedFields: readonly string[] | null
}

/** The latest progress report claude sent about a RUNNING task (#1640): the whole
 *  `backgroundTaskProgress` arm minus its join keys. Latest wins and no history is kept, for the reason
 *  `HeldBackgroundTaskUpdate` gives. The three counters are claude's cumulative readings, held exactly as
 *  received: never summed across reports and not guaranteed monotonic. The frames are rate-bounded, so
 *  the time since the last report says nothing about a stall.
 *
 *  `truncatedFields` is this report's own cut list, straight across (`null` is never collapsed into
 *  `[]`). Its contents are WIRE names, so a cut current activity is named `description`.
 *
 *  SECURITY: `currentActivity`, `subagentType` and `lastToolName` are UNTRUSTED model- and tool-authored
 *  text, and the current activity names a file on the operator's host. Inert escaped text only: never an
 *  attribute (not even a `title` tooltip for the ellipsised line), a class name, a key, a path or a log. */
export interface HeldBackgroundTaskProgress {
  currentActivity: string
  subagentType: string
  lastToolName: string
  totalTokens: number
  toolUses: number
  durationMs: number
  truncatedFields: readonly string[] | null
}

/** ONE background task as this app holds it — the join of what the three frames each report, mapped to
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
 *  check would silently demote to roster-sourced.
 *
 *  A field added here that NO ROSTER ROW CAN REPORT is one of exactly two kinds, and choosing wrongly
 *  is silent — both readings compile and break no test:
 *
 *    - It GATES KEEPING THE RECORD WHOLE, like `toolCallId`. The started frame reports a copy of every
 *      OTHER field too, and its copies are authoritative (fuller label, tighter-capped row), so once
 *      that frame has been seen there is nothing a later row can improve.
 *    - It RIDES ACROSS THE REBUILD INDIVIDUALLY, like `latestUpdate`. An update frame reports NOTHING
 *      but the patch pair, so the row's other fields must still refresh from each new roster. Widening
 *      the provenance predicate to cover it would freeze a patched roster-sourced task's label, type
 *      and own cut report forever; leaving it out of the rebuilt literal would drop the patch at the
 *      next roster.
 *
 *  `truncatedFields` is assigned straight across from whichever frame supplied it — `null` ("nothing
 *  was cut") is a distinct value from `[]` and is never collapsed into it. The three frames' lists name
 *  DIFFERENT vocabularies (started: `task_id` / `tool_call_id` / `description` / `task_type`; roster
 *  row: `task_id` / `task_type` / `description`; update: `task_id` / `patch`), so a started frame
 *  REPLACES this list rather than unioning with it: one flattened list per task would be a list no
 *  reader can attribute back to a field. The update's list is kept apart under `latestUpdate` for that
 *  same reason, rather than competing for this field.
 *
 *  `latestUpdate: HeldBackgroundTaskUpdate | null`, REQUIRED and nullable rather than optional, for the
 *  reason above `toolCallId` carries: an optional property lets a construction site silently omit it
 *  and still compile, and the roster rebuild is exactly such a site. `null` means NO UPDATE HAS EVER
 *  MATCHED this task — a different reading from a recorded `{ patch: '', … }`, which means claude sent
 *  no change. Named `latestUpdate`, not `patch`, so latest-wins is stated at every read site.
 *
 *  `taskId` is carried in the value as well as being the map key — redundant by one field so that #568
 *  can iterate values without threading entry keys alongside them.
 *
 *  Whether a task is FINISHED is not decided here (#1561): an update's terminal `status` is recorded as
 *  an id in `BackgroundTaskRosterState.finishedTasks`, BESIDE this record, so no rebuild of the record — a
 *  roster row, a start upgrading it, a hold moving in — can drop it. Absence from a later roster is still
 *  the only thing that removes a task from the LIST; a terminal status only removes it from the COUNT
 *  (`selectLiveTaskCountFor`).
 *
 *  `status` and `summary` (#1639) are what the panel DRAWS for that state, and both are the
 *  rides-across-the-rebuild kind above: no roster row and no started frame can report them. `status` is
 *  the latest NON-EMPTY word any update reported — `null` means none has arrived, and a `''` frame leaves
 *  it unchanged. It stays the open string the daemon sent, never narrowed to a union, and it never decides
 *  grouping or the count. `summary` is the terminal frame's (see `HeldBackgroundTaskSummary`); `null`
 *  means no terminal frame has arrived. Required and nullable, like `latestUpdate`, so every construction
 *  site has to state them.
 *
 *  `progress` (#1640) is the latest running report (see `HeldBackgroundTaskProgress`), the same
 *  rides-across kind; `null` means no report has matched the task. */
export interface HeldBackgroundTask {
  taskId: string
  toolCallId: string | null
  taskType: string
  description: string
  truncatedFields: readonly string[] | null
  latestUpdate: HeldBackgroundTaskUpdate | null
  status: string | null
  summary: HeldBackgroundTaskSummary | null
  progress: HeldBackgroundTaskProgress | null
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

/** The update write unit — the `backgroundTaskUpdated` daemon-event arm minus its `type` tag. SIX
 *  fields: no `toolCallId`, no `description`, no `taskType`, and it gains `patch`, `status` and
 *  `summary`. `status` is an OPEN string (#1560), `''` on every patch-bearing frame, and it is never
 *  narrowed to a union (#1561). `summary` is untrusted model-authored text, held only from a terminal
 *  frame (#1639). Flat, like its sibling above and like the arm itself, so the translator stays a
 *  copy-the-named-fields filter; `setUpdatedTask` is what assembles the nested held records. */
export interface BackgroundTaskUpdatedSnapshot {
  conversationId: string
  taskId: string
  patch: string
  status: string
  summary: string
  truncatedFields: readonly string[] | null
}

/** The progress write unit (#1640) — the `backgroundTaskProgress` daemon-event arm minus its `type` tag,
 *  flat like its siblings; `setTaskProgress` assembles the nested held record. */
export interface BackgroundTaskProgressSnapshot {
  conversationId: string
  taskId: string
  currentActivity: string
  subagentType: string
  lastToolName: string
  totalTokens: number
  toolUses: number
  durationMs: number
  truncatedFields: readonly string[] | null
}

/** The whole state: each conversation's held task set, keyed by `conversationId`. A key ABSENT from
 *  `rosters` means "NO roster has arrived for that conversation" and is a DISTINCT state from a present
 *  entry holding an empty `tasks` map ("observed, nothing alive") — see `selectRosterFor`, which
 *  preserves that distinction rather than collapsing it. `ReadonlyMap` signals the setters REPLACE the
 *  map, never mutate it in place.
 *
 *  `unlistedStarts` (#1563) holds, per conversation and then per `taskId`, the started-sourced records
 *  no roster has listed yet. It sits OUTSIDE `rosters` on purpose: held on the entry, a start for a
 *  conversation with no roster would create one and flip the panel from "no report yet" to "no
 *  background tasks", the collapse the TWO SILENCES paragraph forbids; outside it, `tasks` keeps
 *  meaning "listed", so the pill's arithmetic and `selectRosterFor` are untouched. Nothing reads it but
 *  the setters. It carries the same untrusted command-line text as `tasks`, so the same no-persistence
 *  rule and both clears apply to it.
 *
 *  `finishedTasks` (#1561) holds, per conversation, the ids of tasks claude has reported terminal on a
 *  `background_task_updated`. Beside the records rather than on them, so no setter that rebuilds a
 *  record can lose it, and a start or a roster naming the task again cannot restore it to the count.
 *  Every id in it is an id held in `rosters` or `unlistedStarts` of the same conversation: it is written
 *  only on an update that HITS, pruned to the rows of each roster, and dropped by both clears. Read by
 *  `selectLiveTaskCountFor` for the pill and `selectFinishedTasksFor` for the panel's groups (#1635). */
export interface BackgroundAgentTimeline {
  toolCallId: string
  confirmed: boolean
  /** First live terminal arrival: insert before this retained ordinary row key. */
  finishBefore: number | null
  /** Conversation-local first terminal arrival order, including when boundaries are equal. */
  finishOrder: number | null
}

export interface BackgroundTaskRosterState {
  agentTimeline: ReadonlyMap<string, ReadonlyMap<string, BackgroundAgentTimeline>>
  /** Latest roster's exact local_agent ids; started-sourced display types cannot qualify a join. */
  rosterAgentIds: ReadonlyMap<string, ReadonlySet<string>>
  rosters: ReadonlyMap<string, BackgroundTaskRosterEntry>
  unlistedStarts: ReadonlyMap<string, ReadonlyMap<string, HeldBackgroundTask>>
  finishedTasks: ReadonlyMap<string, ReadonlySet<string>>
  /** One outstanding user stop per listed conversation/task pair; never persisted. */
  pendingStops: ReadonlyMap<string, ReadonlySet<string>>
}

/** Store shape = state + the eight mutation entry points: record one conversation's roster, record one
 *  started task, record one task's latest patch, record one task's latest progress report (#1640), drop the reconnecting server's rosters on the
 *  `connected` edge (#573's AC5, scoped by #1139), and drop EVERY conversation's at a pairing boundary
 *  (#1139), and claim/settle one stop wait (#1771). Named setters preserve the existing store contract. */
export type BackgroundTaskRosterStore = BackgroundTaskRosterState & {
  setRoster: (snapshot: BackgroundTaskRosterSnapshot) => void
  setStartedTask: (snapshot: BackgroundTaskStartedSnapshot) => void
  setUpdatedTask: (snapshot: BackgroundTaskUpdatedSnapshot, finishBefore?: number) => void
  setTaskProgress: (snapshot: BackgroundTaskProgressSnapshot) => void
  resetRostersFor: (conversationIds: ReadonlySet<string>) => void
  clearAllRosters: () => void
  beginTaskStop: (conversationId: string, taskId: string) => boolean
  endTaskStopWait: (conversationId: string, taskId: string) => void
}

export const initialBackgroundTaskRosterState: BackgroundTaskRosterState = {
  agentTimeline: new Map(),
  rosterAgentIds: new Map(),
  rosters: new Map(),
  unlistedStarts: new Map(),
  finishedTasks: new Map(),
  pendingStops: new Map()
}

/** The three tokens claude reports for a finished task, matched EXACTLY (#1561). Everything else is
 *  alive — `''`, which every patch-bearing frame carries, and any token the daemon has not emitted yet —
 *  so an unknown status keeps the pill lit rather than hiding live work. */
const TERMINAL_TASK_STATUSES: ReadonlySet<string> = new Set(['completed', 'failed', 'stopped'])

function isTerminalTaskStatus(status: string): boolean {
  return TERMINAL_TASK_STATUSES.has(status)
}

/** `finishedTasks` with `taskId` recorded for `conversationId`, copy-on-write. */
function withFinished(
  finishedTasks: ReadonlyMap<string, ReadonlySet<string>>,
  conversationId: string,
  taskId: string
): ReadonlyMap<string, ReadonlySet<string>> {
  const ids = new Set(finishedTasks.get(conversationId))
  ids.add(taskId)
  const next = new Map(finishedTasks)
  next.set(conversationId, ids)
  return next
}

// Retain only waits whose pair is still eligible. Preserve unrelated sets and no-change identity.
function keepTaskStopWaits(
  pending: ReadonlyMap<string, ReadonlySet<string>>,
  conversationId: string,
  keep: (taskId: string) => boolean
): ReadonlyMap<string, ReadonlySet<string>> {
  const held = pending.get(conversationId)
  if (held === undefined) return pending
  const kept = new Set([...held].filter(keep))
  if (kept.size === held.size) return pending
  const next = new Map(pending)
  if (kept.size === 0) next.delete(conversationId)
  else next.set(conversationId, kept)
  return next
}

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
 * row with `toolCallId: null` and the held `latestUpdate` carried onto it. That carry-over is the one
 * thing the rebuild preserves, and it is deliberately NOT folded into the provenance predicate: no
 * roster row can report a patch, but a row CAN report a better label, type and cut report, so a patched
 * roster-sourced task must still refresh from each new row (AC4). Widening the predicate instead would
 * freeze such a task's label forever, and omitting the field from the rebuilt literal would drop its
 * patch at the next roster — both compile clean, which is why each has its own test. Keeping the started record is AC2 and the point of this slice: the
 * daemon's own cap comment states the roster label is the same text under a tighter cap and that its
 * authoritative full-length copy already crossed the wire on the `background_task_started` the row
 * joins back to, so refreshing from the row would throw the better copy away at the first roster and
 * never get it back (the started frame never repeats). Roster-sourced records ARE rebuilt from each new
 * row, so the roster stays replacement truth for everything it can actually report.
 *
 * MEMBERSHIP is replacement truth regardless of provenance (AC5): a held task whose id is absent from
 * the new roster is simply not carried over, whether a roster or a started frame first reported it.
 * That absence is the only removal path from the LIST; a terminal status removes a task only from the
 * COUNT (#1561, see `setUpdatedTask`). `droppedTasks` is taken from the snapshot unconditionally. The
 * conversation's `finishedTasks` are pruned to the new rows, so a finish outlives a roster that lists
 * the task again (or lists a hold that finished before any roster did) and dies with one that omits it.
 *
 * The roster write is UNCONDITIONAL, and that is the point of this store: an empty `tasks: []` sets
 * that key to an entry holding no tasks ("the daemon says nothing is alive for this conversation" — the
 * payoff signal of pyrycode#1240), it does NOT delete the key and is never dropped, filtered, or
 * coalesced as "no news". Because a present-but-empty entry and an absent key are different map
 * states, `selectRosterFor` can hand back `null` for the latter and keep the two apart.
 *
 * `setRoster` also reads the conversation's `unlistedStarts` when it looks up a row's held record, so a
 * start that arrived before the roster listing it moves in whole. It then deletes that conversation's
 * holds outright: the listed ones have moved, and the rest are work the roster, claude's background set,
 * does not count. A foreground call that a timeout later moves to the background comes back through a
 * roster alone, roster-sourced, with `toolCallId: null`.
 *
 * `setStartedTask` UPGRADES a task a roster already listed, in place in its conversation's entry — on
 * claude 2.1.280 the roster listing a `run_in_background` task arrives just BEFORE its start, so this is
 * the common order. A start for a task no roster has listed goes into `unlistedStarts` instead, and
 * `rosters` is handed back by reference, so no entry is created and no surface changes (#1563). `Map.set`
 * keeps an existing key's position, so an in-place upgrade preserves roster order. The snapshot's
 * `description` / `taskType` / `truncatedFields` REPLACE whatever the task held (AC2), and
 * `truncatedFields` in particular replaces rather than unions — the frames' lists name different
 * vocabularies. `droppedTasks` is PRESERVED from the existing entry: a started frame reports nothing
 * about roster truncation and must not reset the count. A held `latestUpdate` is PRESERVED for the same
 * reason — a started frame reports no patch, and claude may emit it after the update for the task it
 * opened. That holds in either place: a hold carries its patch across a repeated start too.
 *
 * `setUpdatedTask` records ONE task's latest patch and its own cut report, joined on `conversationId` +
 * `taskId`, in whichever place holds the task — the listed `tasks` first, else `unlistedStarts`, since
 * an update can arrive for a start no roster has listed yet (#1563). It is the only setter that can
 * MISS: an update naming a task held in neither place returns the state object ITSELF unchanged. It
 * never opens a task and never creates a conversation entry, because a patch is a change report about
 * something already alive, not an announcement — and the same-reference return is what makes "creates
 * no partial entry" provable by `Object.is` rather than by enumerating what did not appear. On a hit it
 * replaces `latestUpdate` wholesale (latest-wins, never an accumulating list), records a non-empty
 * `status` word and a terminal frame's `summary` (#1639), and touches NOTHING else: an update frame
 * reports no `description`, `taskType`, `toolCallId`, or task-level `truncatedFields`.
 * The two cut reports stay distinct fields rather than merging, since they name different vocabularies.
 * A hit whose `status` is terminal also records the task id in `finishedTasks` (#1561), which takes it
 * out of the count and keeps it out — a later `''` or unknown status never removes that id, and
 * `setStartedTask` never touches the set. A miss records nothing, terminal or not: the empty roster
 * usually lands first on claude 2.1.280, so the miss is the common case and must stay a no-op.
 * Both miss branches are SILENT — a "dropped an unmatched update" log line is exactly where patch text
 * would leak into a file (the content-free diagnostics rule, #126).
 *
 * GROWTH BOUND, stated rather than defended: the daemon caps a roster at 8 rows and every frame at the
 * 65519-byte envelope, but it emits a roster only when claude emits one — it synthesises none. Every
 * roster for a conversation empties that conversation's `unlistedStarts`, so the holds are bounded by
 * activity: only a conversation that never receives a roster keeps its holds, until a reset or the
 * pairing clear drops them, and their count is bounded only by how many started frames claude emits
 * there. At ~5 KB per held task that is not a plausible exhaustion vector from a bounded-frame stream,
 * and no speculative eviction policy is built for a failure nobody has observed. None of it is visible:
 * no surface reads a hold (#1563).
 *
 * `resetRostersFor` (#573's AC5) is the `connected` edge: the relay re-emits `connected` on every
 * (re)handshake, so the reconnecting server's held rosters are dropped and every task it reported
 * before the drop — started-sourced ones included — stops being readable. Retaining that set instead
 * would present a stale list as live, which is why the drop is unconditional.
 *
 * THE ROSTER IS NOW REPOPULATED, and that is what makes the drop safe rather than merely honest (#569).
 * This family JOINED the daemon's reconcile-on-connect set upstream (pyrycode#2077-#2080, beside the
 * outstanding `modal_shown` of pyrycode#877 and the non-empty `queue_state` of pyrycode#878): on any
 * (re)connection the daemon unicasts one `background_task_roster` for EVERY conversation whose bound
 * session has reported one. Snapshot-shaped and correlated by `conversation_id`, so `setRoster`'s
 * unconditional replacement applies it idempotently by construction and the burst's ORDER is immaterial —
 * the daemon walks its registry in insertion order and that order is not a contract. A reconciled frame
 * also carries NO `event_id` (it is kept out of the replay ring); `Envelope.event_id` is optional and
 * nothing on this path reads it, so its absence is not malformedness.
 *
 * TWO SILENCES, AND THEY MUST NOT BE COLLAPSED — the reason `selectRosterFor` below keeps `null` apart
 * from a present-but-empty entry, restated here because this is the paragraph a reader lands on when
 * asking what a reconnect leaves behind. A session that reported an EMPTY roster is reconciled as an
 * explicit empty snapshot (`tasks: []`) and reads "observed, nothing alive". A session that has NEVER
 * reported one is simply ABSENT from the burst, stays dropped, and reads `null` — "nothing has been
 * reported", never "nothing is alive". A relay that drops a reconciled frame degrades a conversation to
 * the second reading, which is an honest under-report rather than a stale over-report.
 *
 * What is NOT re-asserted is a `background_task_started` frame: the reconcile carries rosters only, so a
 * task the app had upgraded to started-sourced comes back roster-sourced, without its `toolCallId` or its
 * fuller label. That is a real narrowing and it is pinned by this store's own test rather than merely
 * stated. The ordering this depends on — the `connected` clear landing BEFORE the burst, since a roster
 * applied ahead of it would be wiped — is proved end-to-end through the real transport by
 * e2e/background-task-reconnect.spec.ts.
 *
 * SCOPED, not wholesale (#1139). #573 shipped this as a nullary clear of the WHOLE map, which was right
 * while the app had one connection; since #1117 it holds one per paired server and `connected` means
 * "THIS server's connection came back", so a whole-map clear discarded the other server's rosters — and
 * unlike the `queueStore` case that argument was first made for, NOTHING ever put them back, since no
 * frame in this family is re-sent on connect. The caller resolves which conversations belong to the
 * reconnecting server from the server-keyed conversation list (#1086's `selectConversationIdsFor`) and
 * hands the ids across; the ids are therefore CLIENT-HELD, never a daemon-supplied field naming a
 * server. A conversation this store holds a roster for that appears in no server's list is left alone —
 * the accepted consequence of scoping by the list, and a real case here rather than a corner one,
 * because a background task can start for a conversation whose list has not arrived.
 *
 * Iterates the HELD keys, not the id set, so the work is bounded by what this store holds rather than
 * by the server's conversation count, and membership is a `Set.has` over a `Map`'s own keys — never a
 * bare object keyed by id, per `ServerOrigin`'s docblock, so a `__proto__` conversation id cannot write
 * through `Object.prototype`. Deleting the map key drops a conversation WHOLE, so the reset can never
 * half-drop an entry: a started frame's `toolCallId` and an update frame's `latestUpdate` go with the
 * roster rows they joined. The same keys are deleted from `unlistedStarts` (#1563), so a start no
 * roster listed does not outlive its server's reconnect either. Copy-on-write like the setters, and
 * every surviving entry comes back BY REFERENCE, so a component watching another conversation sees
 * `Object.is` true and does not re-render. #573's `size === 0` short-circuit generalises: when NO held
 * key in either map is listed the state object is handed straight back, so a first connect, a
 * reconnect of a server holding nothing here, and a map holding only unlisted conversations all wake no
 * listener at all.
 *
 * `clearAllRosters` (#1139) is the PAIRING-boundary drop, and it exists because scoping the reconnect
 * reset above removed the self-heal that kept this store out of `clearPairingScopedState`'s dep set —
 * the `conversationListStore` (#531 excluded it, #1086 scoped it and had to add it) and `queueStore`
 * (#1138) sequence, repeated a third time. While the reconnect reset cleared the WHOLE map, a
 * re-pairing's first `connected` blanked every latched roster on its way past; scoped, that same edge
 * resolves the new pairing's empty conversation list, matches no held key, and hands the state object
 * straight back. Nothing else evicts a roster, and the re-assertion above does not reach this boundary:
 * the daemon reconciles only for the conversations of the pairing that reported them, so a NEW pairing's
 * first `connected` re-asserts nothing about the departed one's. This used to read "no re-assertion path
 * of ANY kind, strictly worse than the queue's case"; #569 retires that comparison — the roster's
 * re-assertion now exists and, exactly like the queue's, simply does not reach a pairing that ended. The
 * clear is required for the unchanged reason: a departed pairing's `local_bash` command lines and patch
 * text would otherwise latch for the life of the process. Run against `clearPairingScopedState`'s discriminator — "does a reconnect to the SAME
 * daemon need to clear it?" — the answer is now BOTH mechanisms, each covering what the other cannot:
 * the edge covers the reconnecting server's listed conversations, this covers everything at a pairing
 * change, including a roster held under a conversation no server's list ever carried.
 *
 * It drops `unlistedStarts` too (#1563): those holds carry the same command lines, and a store holding
 * only them is NOT an empty store for the short-circuit below. `finishedTasks` (#1561) is dropped and
 * checked the same way, on both clears, so a departed pairing's task ids do not latch.
 *
 * NULLARY BY DESIGN, the `clearAllBacklogs` / `clearAllConversations` shape: it takes no conversation id
 * and no server origin, so no daemon-supplied field can steer which command lines and patches survive a
 * boundary the operator crossed deliberately. It returns `initialBackgroundTaskRosterState` BY REFERENCE
 * and carries the `size === 0` subscriber short-circuit for the same reason its siblings do — a
 * redundant clear hands the state object straight back, so zustand's `Object.is` fires and no listener
 * wakes.
 */
export function createBackgroundTaskRosterStore(
  init: BackgroundTaskRosterState = initialBackgroundTaskRosterState
) {
  return createStore<BackgroundTaskRosterStore>((set, get) => ({
    ...init,
    // Claim before the caller sends. A stale render or repeated activation cannot send twice.
    beginTaskStop: (conversationId, taskId) => {
      const state = get()
      const task = state.rosters.get(conversationId)?.tasks.get(taskId)
      if (task === undefined || task.truncatedFields?.includes('task_id') === true ||
          state.finishedTasks.get(conversationId)?.has(taskId) === true ||
          state.pendingStops.get(conversationId)?.has(taskId) === true) return false
      const ids = new Set(state.pendingStops.get(conversationId)).add(taskId)
      set({ pendingStops: new Map(state.pendingStops).set(conversationId, ids) })
      return true
    },
    endTaskStopWait: (conversationId, taskId) => set(state => {
      const pendingStops = keepTaskStopWaits(state.pendingStops, conversationId, id => id !== taskId)
      return pendingStops === state.pendingStops ? state : { pendingStops }
    }),
    setRoster: (snapshot) =>
      set((s) => {
        const agentIds = new Set(snapshot.tasks.filter(row => row.task_type === 'local_agent').map(row => row.task_id))
        const rosterAgentIds = new Map(s.rosterAgentIds).set(snapshot.conversationId, agentIds)
        const evidence = new Map(s.agentTimeline.get(snapshot.conversationId))
        for (const [id, entry] of evidence) {
          if (agentIds.has(id) && !entry.confirmed) evidence.set(id, { ...entry, confirmed: true })
        }
        const agentTimeline = new Map(s.agentTimeline).set(snapshot.conversationId, evidence)
        const previous = s.rosters.get(snapshot.conversationId)?.tasks
        const holds = s.unlistedStarts.get(snapshot.conversationId)
        const tasks = new Map<string, HeldBackgroundTask>()
        for (const row of snapshot.tasks) {
          // A held start is always started-sourced, so a listing moves it in WHOLE (#1563).
          const held = previous?.get(row.task_id) ?? holds?.get(row.task_id)
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
                  truncatedFields: row.truncated_fields,
                  // The patch pair RIDES ACROSS the rebuild: no roster row can report it, and unlike
                  // `toolCallId` it must not gate keeping the record whole, or the row's own fields
                  // would freeze. `??` is right HERE and is not the collapse the rule above forbids —
                  // it normalises "no prior record" and "held, never updated" to the one reading they
                  // share, and no wire value passes through it.
                  latestUpdate: held?.latestUpdate ?? null,
                  // The status word and summary ride across for the same reason (#1639).
                  status: held?.status ?? null,
                  summary: held?.summary ?? null,
                  // …and the running report (#1640).
                  progress: held?.progress ?? null
                }
          )
        }
        const next = new Map(s.rosters)
        next.set(snapshot.conversationId, { tasks, droppedTasks: snapshot.droppedTasks })
        // A finish survives a roster that lists the task and dies with one that omits it (#1561).
        const finished = s.finishedTasks.get(snapshot.conversationId)
        let finishedTasks = s.finishedTasks
        if (finished !== undefined) {
          const kept = new Set([...finished].filter((id) => tasks.has(id)))
          const nextFinished = new Map(s.finishedTasks)
          if (kept.size === 0) nextFinished.delete(snapshot.conversationId)
          else nextFinished.set(snapshot.conversationId, kept)
          finishedTasks = nextFinished
        }
        // Every roster empties the conversation's holds: the listed ones moved in above, the rest were
        // foreground work no roster will ever name (#1563).
        const pendingStops = keepTaskStopWaits(s.pendingStops, snapshot.conversationId, id => tasks.has(id))
        if (holds === undefined) return { rosters: next, finishedTasks, pendingStops, agentTimeline, rosterAgentIds }
        const unlistedStarts = new Map(s.unlistedStarts)
        unlistedStarts.delete(snapshot.conversationId)
        return { rosters: next, unlistedStarts, finishedTasks, pendingStops, agentTimeline, rosterAgentIds }
      }),
    setStartedTask: (snapshot) =>
      set((s) => {
        const existing = s.rosters.get(snapshot.conversationId)
        const listed = existing?.tasks.get(snapshot.taskId)
        const holds = s.unlistedStarts.get(snapshot.conversationId)
        const prior = listed ?? holds?.get(snapshot.taskId)
        let agentTimeline = s.agentTimeline
        const evidence = s.agentTimeline.get(snapshot.conversationId)
        if (!evidence?.has(snapshot.taskId) && snapshot.taskType === 'local_agent' && snapshot.toolCallId.length > 0) {
          agentTimeline = new Map(s.agentTimeline).set(snapshot.conversationId,
            new Map(evidence).set(snapshot.taskId, { toolCallId: snapshot.toolCallId,
              confirmed: s.rosterAgentIds.get(snapshot.conversationId)?.has(snapshot.taskId) === true,
              finishBefore: null, finishOrder: null }))
        }
        const record: HeldBackgroundTask = {
          taskId: snapshot.taskId,
          toolCallId: snapshot.toolCallId,
          taskType: snapshot.taskType,
          description: snapshot.description,
          truncatedFields: snapshot.truncatedFields,
          // Same carry-over as the roster path: a started frame reports no patch, status or summary, so
          // an update that arrived before it (claude's ordering, not the daemon's) is not thrown away.
          latestUpdate: prior?.latestUpdate ?? null,
          status: prior?.status ?? null,
          summary: prior?.summary ?? null,
          progress: prior?.progress ?? null
        }
        if (existing === undefined || listed === undefined) {
          // No roster lists this task, so it is held where no surface reads it (#1563): `rosters` is
          // handed back by reference and no entry is created for a never-observed conversation.
          const nextHolds = new Map(holds)
          nextHolds.set(snapshot.taskId, record)
          const unlistedStarts = new Map(s.unlistedStarts)
          unlistedStarts.set(snapshot.conversationId, nextHolds)
          return { unlistedStarts, agentTimeline }
        }
        const tasks = new Map(existing.tasks)
        tasks.set(snapshot.taskId, record)
        const next = new Map(s.rosters)
        next.set(snapshot.conversationId, { tasks, droppedTasks: existing.droppedTasks })
        return { rosters: next, agentTimeline }
      }),
    setUpdatedTask: (snapshot, finishBefore = 0) =>
      set((s) => {
        const existing = s.rosters.get(snapshot.conversationId)
        const held = existing?.tasks.get(snapshot.taskId)
        const latestUpdate = { patch: snapshot.patch, truncatedFields: snapshot.truncatedFields }
        const terminal = isTerminalTaskStatus(snapshot.status)
        const evidence = s.agentTimeline.get(snapshot.conversationId)
        const agent = evidence?.get(snapshot.taskId)
        const agentTimeline = terminal && agent?.finishBefore === null
          ? new Map(s.agentTimeline).set(snapshot.conversationId,
              new Map(evidence).set(snapshot.taskId, { ...agent, finishBefore,
                finishOrder: [...(evidence?.values() ?? [])].reduce((last, entry) => Math.max(last, entry.finishOrder ?? 0), 0) + 1 }))
          : s.agentTimeline
        const pendingStops = terminal
          ? keepTaskStopWaits(s.pendingStops, snapshot.conversationId, id => id !== snapshot.taskId)
          : s.pendingStops
        // Written only on a hit, below: a finished id is always an id this store already holds.
        const finishedTasks = terminal
          ? withFinished(s.finishedTasks, snapshot.conversationId, snapshot.taskId)
          : s.finishedTasks
        // #1639: the word the tag draws and the summary a finished row shows. `''` keeps the held word;
        // only a terminal frame's summary is recorded, and a later non-terminal frame keeps it.
        const outcome = (
          prior: HeldBackgroundTask
        ): Pick<HeldBackgroundTask, 'latestUpdate' | 'status' | 'summary'> => ({
          latestUpdate,
          status: snapshot.status === '' ? prior.status : snapshot.status,
          summary: terminal
            ? { text: snapshot.summary, truncatedFields: snapshot.truncatedFields }
            : prior.summary
        })
        if (existing === undefined || held === undefined) {
          // Not listed: a start may be waiting for its roster, and its update must not be lost (#1563).
          const holds = s.unlistedStarts.get(snapshot.conversationId)
          const pending = holds?.get(snapshot.taskId)
          // A miss in both places returns the state object ITSELF, so zustand's `Object.is`
          // short-circuits and no listener churns: an update never OPENS a task and never creates a
          // conversation entry. Silently, too — a "dropped an unmatched update" log line would put
          // patch text in a file.
          if (holds === undefined || pending === undefined) return agentTimeline === s.agentTimeline ? s : { agentTimeline }
          const nextHolds = new Map(holds)
          nextHolds.set(snapshot.taskId, { ...pending, ...outcome(pending) })
          const unlistedStarts = new Map(s.unlistedStarts)
          unlistedStarts.set(snapshot.conversationId, nextHolds)
          return { unlistedStarts, finishedTasks, pendingStops, agentTimeline }
        }
        const tasks = new Map(existing.tasks)
        // A spread is right here and not in the translators: this is a same-type held → held write
        // whose whole meaning is "every other field is untouched", and an update reports none of them.
        // `truncatedFields` straight across — no `??`, no `|| []` (AC3). `Map.set` on an existing key
        // keeps its position, so display order is untouched.
        tasks.set(snapshot.taskId, { ...held, ...outcome(held) })
        const next = new Map(s.rosters)
        // `droppedTasks` PRESERVED: an update reports nothing about roster truncation.
        next.set(snapshot.conversationId, { tasks, droppedTasks: existing.droppedTasks })
        return { rosters: next, finishedTasks, pendingStops, agentTimeline }
      }),
    // #1640: the same join as `setUpdatedTask` — the listed task first, else the unlisted hold — and the
    // same silent same-reference miss, so a report never opens a task. A hit replaces `progress` whole
    // and touches nothing else: a report is not a finish, so `finishedTasks` and the count stay put.
    setTaskProgress: (snapshot) =>
      set((s) => {
        const progress: HeldBackgroundTaskProgress = {
          currentActivity: snapshot.currentActivity,
          subagentType: snapshot.subagentType,
          lastToolName: snapshot.lastToolName,
          totalTokens: snapshot.totalTokens,
          toolUses: snapshot.toolUses,
          durationMs: snapshot.durationMs,
          truncatedFields: snapshot.truncatedFields
        }
        const existing = s.rosters.get(snapshot.conversationId)
        const held = existing?.tasks.get(snapshot.taskId)
        if (existing === undefined || held === undefined) {
          const holds = s.unlistedStarts.get(snapshot.conversationId)
          const pending = holds?.get(snapshot.taskId)
          if (holds === undefined || pending === undefined) return s
          const nextHolds = new Map(holds)
          nextHolds.set(snapshot.taskId, { ...pending, progress })
          const unlistedStarts = new Map(s.unlistedStarts)
          unlistedStarts.set(snapshot.conversationId, nextHolds)
          return { unlistedStarts }
        }
        const tasks = new Map(existing.tasks)
        tasks.set(snapshot.taskId, { ...held, progress })
        const next = new Map(s.rosters)
        next.set(snapshot.conversationId, { tasks, droppedTasks: existing.droppedTasks })
        return { rosters: next }
      }),
    resetRostersFor: (conversationIds) =>
      set((s) => {
        const doomedAgents = [...s.agentTimeline.keys()].filter(id => conversationIds.has(id))
        const doomed = [...s.rosters.keys()].filter((id) => conversationIds.has(id))
        const doomedHolds = [...s.unlistedStarts.keys()].filter((id) => conversationIds.has(id))
        const doomedFinished = [...s.finishedTasks.keys()].filter((id) => conversationIds.has(id))
        const doomedStops = [...s.pendingStops.keys()].filter(id => conversationIds.has(id))
        if (doomedAgents.length === 0 && doomed.length === 0 && doomedHolds.length === 0 && doomedFinished.length === 0 && doomedStops.length === 0) return s
        const next = new Map(s.rosters)
        for (const id of doomed) next.delete(id)
        const rosterAgentIds = new Map(s.rosterAgentIds)
        for (const id of doomed) rosterAgentIds.delete(id)
        const unlistedStarts = new Map(s.unlistedStarts)
        for (const id of doomedHolds) unlistedStarts.delete(id)
        const finishedTasks = new Map(s.finishedTasks)
        for (const id of doomedFinished) finishedTasks.delete(id)
        const pendingStops = new Map(s.pendingStops)
        for (const id of doomedStops) pendingStops.delete(id)
        const agentTimeline = new Map(s.agentTimeline)
        for (const id of doomedAgents) agentTimeline.delete(id)
        return { rosters: next, unlistedStarts, finishedTasks, pendingStops, agentTimeline, rosterAgentIds }
      }),
    clearAllRosters: () =>
      set((s) =>
        s.agentTimeline.size === 0 && s.rosters.size === 0 && s.unlistedStarts.size === 0 && s.finishedTasks.size === 0 && s.pendingStops.size === 0
          ? s
          : initialBackgroundTaskRosterState
      )
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
 * `queue_state` but would silently violate AC5 here, because "no roster has ever arrived" and
 * "observed, nothing alive" would then both read as a bare empty collection — with no type error and no
 * failing test unless one is written for it. The three readings are distinct:
 *
 *   key absent                            → `null`         no roster has ever arrived
 *   `{ tasks: Map{}, droppedTasks: 0 }`   → that entry     observed, nothing alive
 *   `{ tasks: Map{t}, droppedTasks: 2 }`  → that entry     1 task carried, 3 truly alive
 *
 * `null` is a STABLE reference by construction, which is the whole reason queueStore hoists
 * `EMPTY_BACKLOG` to module scope (a fresh `[]` per selector call churns re-renders) — so this slice
 * needs no `EMPTY_*` constant at all. It returns the HELD ENTRY ITSELF, never a freshly built object or
 * array: the task map is assembled at write time precisely so this stays true. The nullable return type
 * also forces #568 to branch, so the distinction cannot be ignored accidentally. And it is what makes
 * AC5 verifiable: after either drop every key it reached is absent, so those conversations read `null` —
 * genuinely back to "nothing observed" rather than indistinguishable from observed-empty. Which keys a
 * drop reaches differs by mechanism since #1139 — `resetRostersFor` reaches the reconnecting server's
 * listed conversations, `clearAllRosters` reaches every one — so this is no longer a whole-store claim
 * on the `connected` edge; it holds per dropped key.
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

/**
 * The panel's grouping read (#1635) — one conversation's finished task ids, which split its list into a
 * Running and a Finished group. Returns the HELD set or `null` ("nothing finished"), never a fresh set:
 * `withFinished` and `setRoster`'s prune build a new set only when this conversation's membership
 * changes, so a write for another conversation leaves the result `Object.is`-identical and the panel
 * does not re-render. `null` is safe to collapse here, unlike in `selectRosterFor`: with no roster there
 * are no rows to group.
 */
export const selectFinishedTasksFor =
  (conversationId: string) =>
  (s: BackgroundTaskRosterState): ReadonlySet<string> | null =>
    s.finishedTasks.get(conversationId) ?? null

/**
 * The pill's count (#1561) — a selector FACTORY bound to one `conversationId`, and the one definition of
 * "alive" the composer pill and any later panel reading share: the listed tasks claude has not reported
 * terminal, plus `droppedTasks`. `droppedTasks` always adds, because a dropped entry carries no id to
 * match a status against, and the daemon caps a roster at 8 rows.
 *
 * `0` when no roster has arrived. That collapses "never observed" into "nothing alive", which the pill
 * is entitled to do (both render no pill) and `selectRosterFor` deliberately does not. A PRIMITIVE, so
 * it is reference-stable for `useSyncExternalStore` without a memo.
 */
export const selectLiveTaskCountFor =
  (conversationId: string) =>
  (s: BackgroundTaskRosterState): number => {
    const entry = s.rosters.get(conversationId)
    if (entry === undefined) return 0
    const finished = s.finishedTasks.get(conversationId)
    let live = 0
    for (const taskId of entry.tasks.keys()) if (finished?.has(taskId) !== true) live++
    return live + entry.droppedTasks
  }

/** App-lifetime waits for one conversation, returned by reference for narrow subscriptions. */
export const selectPendingTaskStopsFor =
  (conversationId: string) =>
  (state: BackgroundTaskRosterState): ReadonlySet<string> | null =>
    state.pendingStops.get(conversationId) ?? null
