# Background-task roster store — internals

Split from [Background-task roster store](background-task-roster-store.md) on 2026-09-23, once #1561's
finished-task-count work pushed the shared doc over the size cap. Part of the same store; see
[What it does](background-task-roster-store-model.md) for the model this implements,
[Edge cases](background-task-roster-store-edge-cases.md), and
[Related](background-task-roster-store-related.md) for cross-references.

## How it works

### The store (`src/renderer/src/store/backgroundTaskRosterStore.ts`)

```ts
export interface HeldBackgroundTaskUpdate {                    // the latest patch + its OWN cut report (#577)
  patch: string                                                 // opaque text, held verbatim, never parsed
  truncatedFields: readonly string[] | null
}
export interface HeldBackgroundTaskSummary {                   // the terminal frame's text + ITS OWN cut report (#1639)
  text: string                                                  // untrusted model-authored text; inert escaped text only
  truncatedFields: readonly string[] | null
}
export interface HeldBackgroundTaskProgress {                  // the latest running report, join keys stripped (#1640)
  currentActivity: string         // untrusted; names a file on the operator's host for local_bash
  subagentType: string
  lastToolName: string            // '' drops its segment and separator in the meta line
  totalTokens: number             // claude's CUMULATIVE reading, held exactly as received — never summed/diffed
  toolUses: number
  durationMs: number
  truncatedFields: readonly string[] | null   // WIRE names — a cut activity is named `description`, not `currentActivity`
}
export interface HeldBackgroundTask {                          // per-task, renderer-side camelCase (#576)
  taskId: string
  startedToolCallId?: string      // presence = started metadata provenance, including an empty id
  rosterToolCallId?: string       // latest usable roster placement hint
  toolCallId: string | null       // roster-first, then started fallback; only nonempty ids can place rows
  taskType: string
  description: string
  truncatedFields: readonly string[] | null
  latestUpdate: HeldBackgroundTaskUpdate | null   // null = no update has ever matched this task (#577)
  status: string | null           // latest NON-EMPTY status word any update reported; '' leaves it unchanged (#1639)
  summary: HeldBackgroundTaskSummary | null   // set only from a HIT whose status is terminal (#1639)
  progress: HeldBackgroundTaskProgress | null   // null = no progress report has ever matched this task (#1640)
}
export interface BackgroundTaskRosterEntry {
  tasks: ReadonlyMap<string, HeldBackgroundTask>   // keyed by taskId, built at WRITE time; insertion order = roster order
  droppedTasks: number                             // roster's ONLY truncation report; true size = tasks.size + droppedTasks
}
export interface BackgroundTaskRosterSnapshot {                // roster write unit — wire rows, unchanged shape
  conversationId: string
  tasks: readonly BackgroundTask[]
  droppedTasks: number
}
export interface BackgroundTaskStartedSnapshot {               // started write unit (#576) — toolCallId non-nullable, the frame always reports one
  conversationId: string
  taskId: string
  toolCallId: string
  taskType: string
  description: string
  truncatedFields: readonly string[] | null
}
export interface BackgroundTaskUpdatedSnapshot {               // update write unit (#577) — SIX fields since #1639
  conversationId: string
  taskId: string
  patch: string
  status: string                                                // open string (#1560); '' on every patch-bearing frame; only isTerminalTaskStatus reads it (#1561)
  summary: string                                                // open string (#1560); copied verbatim (#1639), held only from a terminal HIT
  truncatedFields: readonly string[] | null
}
export interface BackgroundTaskProgressSnapshot {              // progress write unit (#1640) — NINE fields, flat like its siblings
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
export interface BackgroundAgentTimeline {
  identity?: number              // client-owned identity, never recycled by this store factory
  historyOnly?: boolean         // cannot manufacture a provisional row
  historyStarted?: boolean      // validated historical local_agent start with nonempty join
  finishFromHistory?: boolean   // finishBefore resolves row identity, not live receipt order
  description?: string           // held text survives roster removal; display bounds apply later
  toolCallId: string              // exact placement join; frozen once terminal
  confirmed: boolean             // live roster qualification or valid historical start + terminal
  finishBefore: number | null    // immutable first terminal placement boundary
  finishOrder: number | null     // immutable conversation-local terminal ordinal
}
export interface BackgroundTaskRosterState {
  agentTimeline: ReadonlyMap<string, ReadonlyMap<string, BackgroundAgentTimeline>> // established evidence order; new roster entries append
  rosterAgentIds: ReadonlyMap<string, ReadonlySet<string>> // latest roster's exact local_agent ids, independent of display types
  rosters: ReadonlyMap<string, BackgroundTaskRosterEntry>          // key absent = no roster has arrived (#1563)
  unlistedStarts: ReadonlyMap<string, ReadonlyMap<string, HeldBackgroundTask>>   // conv -> taskId -> started-sourced hold no roster has listed yet (#1563); no surface reads it
  finishedTasks: ReadonlyMap<string, ReadonlySet<string>>          // conv -> taskId claude reported terminal; count + panel grouping
  pendingStops: ReadonlyMap<string, ReadonlySet<string>>           // conv -> taskId with an outstanding user stop; renderer-only
}
export type BackgroundTaskRosterStore = BackgroundTaskRosterState & {
  recordHistoryPlacements: (conversationId: string, placements: readonly HistoryAgentPlacement[]) => void
  setRoster: (snapshot: BackgroundTaskRosterSnapshot) => void
  setStartedTask: (snapshot: BackgroundTaskStartedSnapshot) => void   // #576
  setUpdatedTask: (snapshot: BackgroundTaskUpdatedSnapshot, finishBefore?: number) => void // also retains first terminal placement
  setTaskProgress: (snapshot: BackgroundTaskProgressSnapshot) => void   // #1640; never touches finishedTasks or droppedTasks
  resetRostersFor: (conversationIds: ReadonlySet<string>) => void   // connected edge, scoped (#1139)
  clearAllRosters: () => void                                       // pairing-boundary drop, nullary (#1139)
  beginTaskStop: (conversationId: string, taskId: string) => boolean  // synchronous claim before send
  endTaskStopWait: (conversationId: string, taskId: string) => void    // correlated refusal settlement
}

createBackgroundTaskRosterStore(init?)     // vanilla createStore — one isolated instance per test (DI seam)
backgroundTaskRosterStore                  // app-wide singleton
useBackgroundTaskRosterStore(selector)     // narrow-slice React binding: useStore(store, selector)
selectRosterFor(conversationId)(state)          // selector FACTORY — the panel's read surface (#568), returns `?? null`
selectLiveTaskCountFor(conversationId)(state)   // selector FACTORY — the pill's read surface (#1561), returns a primitive count
selectFinishedTasksFor(conversationId)(state)   // selector FACTORY — the panel's grouping read (#1635), returns `?? null`
selectPendingTaskStopsFor(conversationId)(state) // selector FACTORY — the panel's held wait set, returns `?? null`
```

Keyed by `conversationId`, not a flat slot, for the same reason [`queueStore`](queue-store.md) is: the
daemon fans these frames out to every interactive connection and each carries `conversation_id`, so
frames for *different* conversations can arrive back-to-back and a flat "hold the latest" slot would let
one clobber another. **Nine named mutation methods** (`recordHistoryPlacements`, `setRoster`, `setStartedTask`, `setUpdatedTask`,
`setTaskProgress`, `resetRostersFor`, `clearAllRosters`, `beginTaskStop`, `endTaskStopWait`) preserve the
existing store contract. #1561 added no extra setter, only a third state field
(`finishedTasks`) three of the setters also maintain, and #1640's `setTaskProgress` is a fourth "record"
setter beside `setRoster`/`setStartedTask`/`setUpdatedTask`, not a fourth state field — its report lives
on `HeldBackgroundTask` itself. Mirrors `queueStore`'s DI-factory → singleton → hook → selector structure
and its `ReadonlyMap` copy-on-write idiom throughout: clone the outer map, clone the inner map, replace;
never mutate `s.rosters`, an entry, or an entry's `tasks` in place — and, since #1563, never mutate
`s.unlistedStarts` or one of its per-conversation inner maps in place either, a rule #1561 extends to
`s.finishedTasks` and `s.pendingStops`, and also applies to `s.agentTimeline` and
`s.rosterAgentIds`; it is the same conversation-keyed-map shape one level further in, copy-on-write
throughout. Also mirrors `queueStore`'s setter
PAIR for the pairing-lifecycle problem ([#1138](https://github.com/pyrycode/pyrycode-desktop/issues/1138) /
[#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139)): a scoped `…For` reset beside a
nullary whole-map clear, both iterating the HELD keys rather than the input set, so the work is bounded
by what this store holds rather than by a server's conversation count.

`setRoster` rebuilds the conversation's task map **in row order**. For each task it
records the current nonempty roster id as `rosterToolCallId`, or undefined when absent/empty,
and selects `toolCallId = rosterToolCallId ?? held?.startedToolCallId ?? null`.
Started metadata is kept only when `startedToolCallId !== undefined`, even if empty;
the held record itself is reused when placement readings also match. Otherwise a fresh
roster-sourced record refreshes description, type and its own cut report. Receiving a
roster id does not stop later metadata refreshes.

`latestUpdate`, `status`, `summary` and `progress` ride across either branch individually:
no roster row reports them. Treating any of them as provenance freezes roster metadata;
omitting their carry-over drops a report at the next roster. See [the original patch
carry-over trap](../codebase/577.md). `droppedTasks` comes from the snapshot unconditionally.
An empty `tasks: []` still writes an observed-empty entry rather than deleting its key.

Since #1561, `setRoster` also prunes the conversation's `finishedTasks` set to the ids the new roster
still lists — a finish outlives a roster that lists the task again (including a hold that finished before
any roster did, see `setUpdatedTask` below), and dies with a roster that omits it, the same lifetime the
task's own record has. `finishedTasks` (the outer map) is handed back **by reference** when the
conversation held no finished ids to begin with; otherwise a fresh outer map is built and the
conversation's key is deleted, never set to an empty `Set`, whenever nothing survives the prune —
matching the map's own no-key-for-nothing convention elsewhere in this store.

Since #1563 the candidate a row's held record is read from is `tasks.get(id) ?? unlistedStarts[conv]?.get(id)`
— a start no earlier roster had listed moves into `tasks` with its metadata and reports retained,
joining the row's placement id the instant a roster names it. Every roster for a conversation then also drops
that conversation's remaining `unlistedStarts` entry outright (copy-on-write, and skipped when there was
none to drop in the first place): the rows the roster just listed have already moved into `tasks` above,
and whatever is left in the hold is foreground work claude's own background set does not include. A
foreground call a timeout later moves to the background comes back the ordinary way, through a bare
roster row with no matching `unlistedStarts` entry, roster-sourced with its optional placement id.

`setStartedTask` (#576, new; #577 gained the same carry-over; #1563 narrowed what it can create) now only
**upgrades** a task its conversation's roster has already listed, in place — `Map.set` keeps an existing
key's position, so the upgrade preserves roster display order. Claude orders these frames, not the
daemon, so a started frame can precede any roster for its conversation, *and* can arrive after an update
for the task it is about to open; on claude 2.1.280 the roster listing a `run_in_background` task arrives
just *before* that task's own start, so the upgrade path is the common one. A start for a task no roster
has listed goes into `unlistedStarts[conv][taskId]` instead — carrying forward any `latestUpdate` already
held there — and `rosters` is handed back **by reference**: no entry is created for a conversation with
no roster, so neither surface changes (AC1) — before #1563 this branch created the entry unconditionally.
The snapshot's `description`/`taskType`/`truncatedFields`
**replace** whatever the task held, in either place; the three frames' `truncatedFields` lists name
different vocabularies, so a started frame's list replaces rather than unions with a roster row's.
`droppedTasks` is **preserved** from the existing listed entry — a started frame reports nothing about
roster truncation and must not reset the count; an unlisted hold has no `droppedTasks` to preserve in the
first place. A held `latestUpdate` is likewise **preserved**, in either place — a started frame reports no
patch, so it must not silently erase one recorded before it arrived. Since #1639, `status` and `summary`
are preserved the same way, from the listed record or the hold, whichever the task is found in — a
started frame reports neither, so an update that already tagged or finished the task must survive an
upgrade that arrives after it. Since #1640, `progress` is preserved the same way — a started frame reports
no running report either.

Every start records `startedToolCallId` presence. A later nonempty start replaces
that reading; a later empty start keeps an already-usable started id while refreshing
authoritative metadata. The held placement still prefers its roster reading.

`setUpdatedTask` (#577, new; #1563 widened where it looks) records **one task's latest patch and its own
cut report**, joined on `conversationId` + `taskId` and never on arrival order — an update can arrive
before the roster or started frame that first names its task, including while that task is still an
unlisted hold. It checks the listed `tasks` first, then `unlistedStarts`, and writes the patch into
whichever place holds the task — an update must not be lost just because its task's roster has not
arrived yet. An update naming an unknown conversation, or a `taskId` held in **neither** place,
leaves display records unchanged. It returns the state object itself unless existing
`agentTimeline` evidence captures its first terminal boundary; that evidence survives roster omission.
An update never opens a task or creates a display conversation entry, because a patch
is a change report about something already
alive, not an announcement. On a hit, `latestUpdate` is replaced wholesale (latest-wins — never an
accumulating list) and nothing else on the held record is touched: an update frame reports no
`description`, `taskType`, `toolCallId`, or task-level `truncatedFields`. Both miss branches are silent,
deliberately — a "dropped an unmatched update" log line is exactly where patch text could leak into a
file (the content-free diagnostics rule, #126). Since #1561, a HIT whose `status` is exactly `completed`,
`failed` or `stopped` (`isTerminalTaskStatus`, an unexported exact-match helper against a hoisted
`TERMINAL_TASK_STATUSES` set — never a narrowed union, since `status` is an open string by design) also
records `taskId` into the conversation's `finishedTasks`. A display-record miss cannot add
finished panel/pill membership. On claude 2.1.280 the emptier roster usually lands one line
before the terminal update, so timeline placement must retain its own finish evidence
independently of this membership path.

Since #1639, a HIT also writes `status` and `summary` onto the held record (both places a hit can land —
the listed `tasks` map and an `unlistedStarts` hold — through one shared `outcome(prior)` helper so the two
sites cannot drift): `status` becomes `snapshot.status === '' ? prior.status : snapshot.status` — a `''`
frame (the common patch-only case) leaves the held word exactly where a fresh non-empty word wrote it,
never resetting it to `null`. `summary` is written only when `isTerminalTaskStatus(snapshot.status)` is
true, as `{ text: snapshot.summary, truncatedFields: snapshot.truncatedFields }`; a non-terminal frame
after a terminal one keeps the prior summary rather than overwriting it with an update that carries none.
This is a second, independent read of the same `status`/`isTerminalTaskStatus` value `finishedTasks`
already computes in the same setter — `status`/`summary` are what the panel **draws**, `finishedTasks` is
what decides membership and the count, and the two must never be merged into one field: [Conversation
shell — background tasks § Status tag and
summary](conversation-shell-background-tasks.md#status-tag-and-summary-1639) is the reader.

**Why `finishedTasks` is a set held beside the task records, never a field on `HeldBackgroundTask`
itself.** A field would need a carry-over at every site that rebuilds a record — `setRoster`'s
started-sourced-keep vs. fresh-row branches, `setStartedTask`'s upgrade, and a hold moving from
`unlistedStarts` into `tasks` — mirroring the exact `latestUpdate`-carry-over trap [#577's codebase
notes](../codebase/577.md) already names once for that field. Missing the carry-over at any one of those
sites compiles clean and breaks no other test: a finished task would silently re-enter the count the next
time its record happened to be rebuilt. Held in a separate, conversation-keyed set instead, no rebuild of
`HeldBackgroundTask` can lose it, and `setStartedTask` needed no change at all to keep a start from
reviving a finished id — it simply never writes to the set.

Provenance and placement availability are independent. Presence of `startedToolCallId`
protects the fuller metadata even after an empty-id start. Testing `toolCallId !== null`
would mistake a roster id for started provenance and freeze stale descriptions/types/cut
reports; testing started-id truthiness would lose authoritative empty-id metadata.
`latestUpdate` also cannot establish provenance: a patched roster-sourced task still refreshes.

`setTaskProgress` (#1640, new) records **one task's latest progress report**, joined on
`conversationId` + `taskId` exactly like `setUpdatedTask` — the listed `tasks` map first, then
`unlistedStarts` — a report naming a task held in neither place returns the state object
**itself** unchanged. Unlike a terminal update, a progress miss cannot capture timeline
finish evidence. On a hit it replaces `progress` wholesale (latest-wins, never a
history) and touches nothing else — not `latestUpdate`, `status`, `summary`, `droppedTasks`, or
`finishedTasks`: a progress report is not a finish signal and carries no patch. The three counters
(`totalTokens`, `toolUses`, `durationMs`) are written exactly as received, since the daemon's readings
are cumulative but not guaranteed monotonic and this store never sums or diffs them.

**The one place the `queueStore` precedent is deliberately *not* cloned.** `queueStore.selectBacklogFor`
returns `s.backlogs.get(id) ?? EMPTY_BACKLOG`, collapsing "never observed" and "observed, empty" into the
same bare `[]` — correct for `queue_state`, but this store needs the two distinguishable (AC5, ex-AC4).
The fix is `selectRosterFor`'s `?? null` instead of `?? EMPTY_BACKLOG`, typed
`BackgroundTaskRosterEntry | null`:

| store contents for `c1` | `selectRosterFor('c1')` | meaning |
| --- | --- | --- |
| key absent from `rosters` | `null` | no roster has ever arrived for this conversation — `unlistedStarts` may still hold an unseen start (#1563) |
| `{ tasks: Map{}, droppedTasks: 0 }` | that entry | observed, nothing alive |
| `{ tasks: Map{t}, droppedTasks: 2 }` | that entry | 1 task carried, 3 truly alive |

`null` is a stable reference by construction, so — unlike `queueStore`'s hoisted `EMPTY_BACKLOG` — this
store needs **no `EMPTY_*` constant at all**: one fewer export, one fewer thing to get wrong. The
nullable return type also forces #568 to branch, so the distinction can't be ignored accidentally. There
is deliberately no whole-map analogue of `queueStore`'s `selectBacklogs`: the reset here clears the map
wholesale and nothing else reads the map, so shipping an unread read surface would repeat the exact
dead-export `queueStore` already carries (see [queue store § Edge cases](queue-store.md)).

### Retained Agent timeline evidence

`agentTimeline` is a conversation/task Map for the
[background Agent projection](conversation-shell-tool-row-header-groups.md#started-background-agents).
An exact `local_agent` roster row creates confirmed evidence from a nonempty roster
id, falling back to a usable held started id, without a loaded launch or start frame.
A usable exact `local_agent` live start creates unconfirmed evidence before the roster.
Map insertion order retains received-start order; new connect entries append in roster
order. Refreshes, later starts and older pages never delete/reinsert established entries.
Ids compare exactly without trimming/coercion. Confirmed unmatched live evidence can
synthesize a provisional Agent; a loaded matching non-Agent suppresses that presentation.

`rosterAgentIds` holds the latest roster's exact `local_agent` task ids; only `setRoster`
replaces it. Live start and later roster confirmation use this set. Display
`HeldBackgroundTask.taskType` cannot qualify a live join: even an empty-id start can
replace that display type, letting a roster-listed `local_bash` task wrongly relocate
an Agent if trusted. Omission removes eligibility for new live joins, while established
confirmation and minimal unconfirmed evidence survive. `unlistedStarts` display records
still prune normally; neither retained evidence nor `finishedTasks` extends membership.

`recordHistoryPlacements` writes only `agentTimeline`, never live roster setters.
`HistoryAgentPlacement` carries a placement-only started/updated event and its mapped
ordinary-row boundary `before`. A start must name exactly `local_agent` with a nonempty
tool-call id. A finish must be exactly `completed`, `failed` or `stopped`. Either may
arrive first on separate newest-first pages; unmatched evidence stays until it joins.
A finish alone can retain an empty join, filled by its later valid start. Historical
qualification requires both start and terminal, without current roster membership;
projection additionally requires a loaded call named exactly `Agent`. Starts alone
and unmatched finishes create no running/provisional rows (`historyOnly`), and
foreground, non-Agent, other-type and empty-id joins retain ordinary placement.

When history attaches to live evidence, its start id must match the retained id.
It can qualify a held live finish, without changing established identity/order.
Conversely, the first live terminal update promotes `historyStarted` qualification
when a validated historical start/launch loaded first. Qualification only in the
history writer misses this order: terminal replay then finds an already settled
entry and cannot repair it. Both writers preserve a known finish rather than revive
it; exact completed/failed/stopped regressions cover history → live → history.

Live `setUpdatedTask(snapshot, finishBefore?)` captures the first terminal boundary
against existing evidence, even before confirmation or after roster removal. The
app-mounted task listener supplies the addressed timeline's `nextRowKey` synchronously,
including inactive conversations, with item-count/zero fallback. It records an ordinal
above the conversation's largest held `finishOrder`. Historical terminals instead
retain stable ordinary-row identity with `finishFromHistory`; older pages receive
ordinals before retained finishes, preserving finish-entry order for tied anchors.
Projection resolves historical anchor position separately from live receipt chronology;
numeric prepend keys cannot establish history order. Repeated terminals never replace
an established boundary/order. Roster omission, progress and nonterminal/unknown/empty
statuses never finish or revive a row. See [page/echo/tail boundary mapping](conversation-timeline-store-internals.md#background-agent-history-placement).

Retained descriptions refresh from live held metadata; history-only entries hold the
start description. Identity stays fixed. Empty later readings preserve an existing
join; usable live readings can change it while running. Once terminal, a nonempty
join stays fixed, so repeated starts cannot detach a settled row whose launch loads
later. Late launch/child pages attach to that row and marker, preserving expansion
and navigation. Evidence outlives roster membership; replay leaves roster/panel/pill
counts and live turn state untouched.

The maps are memory-only under existing owning-host receipt and conversation boundaries.
Scoped reconnect drops evidence and roster eligibility for the server's listed chats;
pairing clear drops all. Other conversations retain evidence references. The identity
counter belongs to the store factory and survives both resets: recycling it would give
a fresh provisional row an old mounted Timeline's expansion. Saved snapshots contain
no task frames; durable admission/persistence and automatic newest-page requests
remain #1814/#1815.

Actual-store `backgroundAgentTimeline.test.ts` and `backgroundTaskRosterStore.test.ts`
cover genuine roster provenance, empty-start overwrite, fallback/omission, stable
order, immutable finishes and identities across clears. Pre-confirmed projection
fixtures alone cannot expose wrong qualification. `finishedAgentHistory.test.ts`
covers cross-page joins, live overlap in both orders, tied finishes, echo/tail anchors,
isolated roster/turn state and retained identity. See [recorded browser evidence](conversation-shell-tool-row-header-groups.md#verification).

### The pill's count, `selectLiveTaskCountFor` (#1561)

`selectRosterFor` is the panel's read; the composer status row's count pill needs a number, not an entry,
and needs the *live* number — the roster's raw size stayed lit for a task claude had already reported
finished whenever the emptier roster that usually precedes the terminal update did not arrive first (the
defect this ticket fixes). `selectLiveTaskCountFor(conversationId)(state)` is a second selector factory,
returning a **primitive**:

```ts
export const selectLiveTaskCountFor =
  (conversationId: string) => (s: BackgroundTaskRosterState): number => {
    const entry = s.rosters.get(conversationId)
    if (entry === undefined) return 0
    const finished = s.finishedTasks.get(conversationId)
    let live = 0
    for (const taskId of entry.tasks.keys()) if (finished?.has(taskId) !== true) live++
    return live + entry.droppedTasks
  }
```

`0` on a missing roster collapses "never observed" and "observed, nothing alive" into one reading — the
exact collapse `selectRosterFor`'s `?? null` refuses to make for the panel, and a collapse the pill is
entitled to make since both readings render no pill either way. `droppedTasks` always adds unconditionally
— a dropped row carries no id, so it can never be matched against `finishedTasks`. Being a primitive
(rather than the held entry itself), it is reference-stable for `useSyncExternalStore` with no memo, the
same property `selectRosterFor`'s stable-reference return already had. This is now the **one** definition
of "alive" for anything that counts live background tasks — the composer pill reads it in place of its old
inline `roster.tasks.size + roster.droppedTasks` arithmetic (see [Conversation shell — composer status row
§ Background-task count pill](conversation-shell-composer-status.md#background-task-count-pill-the-slots-last-occupant-1435)) — so a later surface counting the same thing cannot silently disagree with the pill about
what counts as finished. The panel still lists a finished task until a roster omits it, and reads
`finishedTasks` separately for Running/Finished grouping through `selectFinishedTasksFor` below.

### The panel's grouping read, `selectFinishedTasksFor` (#1635)

The panel's Running/Finished split ([Conversation shell — background tasks § List
redraw](conversation-shell-background-tasks.md#list-redraw-1635)) needed a third selector, not a second
call to `selectLiveTaskCountFor`'s logic: the count selector already folds `finishedTasks` into a number,
but the panel needs the **set itself**, one conversation at a time, to test membership per row:

```ts
export const selectFinishedTasksFor =
  (conversationId: string) =>
  (s: BackgroundTaskRosterState): ReadonlySet<string> | null =>
    s.finishedTasks.get(conversationId) ?? null
```

Same selector-factory shape as `selectRosterFor` and the same held-reference discipline the rest of this
store keeps: `finishedTasks`'s copy-on-write means a write for a *different* conversation never rebuilds
this conversation's set, so `Object.is` holds and the panel does not re-render on someone else's finish.
Unlike `selectRosterFor`, the `null` collapse here is **safe** rather than a distinction to preserve: with
no roster (`selectRosterFor` returning `null`) there is no populated arm to group in the first place, so a
`finishedTasks` reading of `null` versus "empty set" makes no visible difference to the one caller
(`BackgroundTaskPanel`, passing the result through as `finishedTaskIds`). `finishedTasks` gained no fourth
reader from this ticket — `setRoster`'s prune and `setUpdatedTask`'s terminal-status write are unchanged,
and `resetRostersFor`/`clearAllRosters` drop it exactly as before this selector existed.

### Pending stop waits

`pendingStops: ReadonlyMap<string, ReadonlySet<string>>` holds one outstanding user stop per listed
conversation/task pair, in memory only. `beginTaskStop(conversationId, taskId)` reads current state and
returns false for a missing listed task, its own cut `task_id`, a finished id or an already-pending pair.
Otherwise it copies that conversation's set and the outer map, records the wait, and returns true.
The [panel handler](conversation-shell-background-tasks.md#stop-task) claims before its existing void
send, with no intervening await, so repeated activation or a stale render cannot send twice. The claim
does not change rosters or finished membership; host capability and connection checks belong to the
panel, not this store.

`selectPendingTaskStopsFor(conversationId)` returns the held set by reference or `null`. A write for
another conversation preserves this set's identity. `keepTaskStopWaits` prunes only the named
conversation, preserves the outer map on no change, and deletes an empty set's conversation key.
`endTaskStopWait` uses it to clear exactly one pair; an unknown pair is a same-state no-op.

Accepted stops produce no reply and have no timeout. Settlement uses existing app-owned lifecycle:

- `setRoster` intersects waits with the rebuilt listed task map; omission, including an empty roster,
  settles a pair, while a roster still listing it keeps the wait.
- `setUpdatedTask` clears its pair on an exact `completed`/`failed`/`stopped` hit, alongside recording
  finished membership. Nonterminal updates and `setTaskProgress` retain waits.
- The bridge passes `backgroundTaskStopRejected`'s send-time-recorded `conversationId`/`taskId` to
  `endTaskStopWait`. Another task or the same id in another conversation is untouched.
- `resetRostersFor` deletes waits for the reconnecting server's listed conversation ids alongside the
  other maps; `clearAllRosters` clears every map at the pairing boundary.

Neither drawer closure nor conversation unmount clears these waits. A drawer-local subscription or
the MCP sheet's unmount cleanup would re-enable a button before daemon settlement; the existing
app-mounted `BackgroundTaskRosterData` listener owns this path throughout navigation.
`backgroundTaskStop.test.ts` covers duplicate claims, pair isolation, terminal statuses, nonterminal
preservation, omission, cut-id refusal, scoped reset and pairing clear. Its injected bridge test settles
waits with no drawer and uses a client `serverId` stamp conflicting with `ack.server_id` to pin reset
scope. The [panel testing section](conversation-shell-background-tasks.md#stop-task-testing) records
static-render snapshot requirements and fake-transport interaction proof.

`resetRostersFor(conversationIds)` ([#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139),
the `connected`-edge reset) iterates the **held** map's own keys, not the id set, and deletes the ones
that are members — work bounded by what this store holds, not by the server's conversation count.
Membership is tested with `Set.has`, never a bare object lookup, which is also what keeps `__proto__`,
`constructor` and `''` unremarkable conversation keys. Deleting the map key drops a conversation **whole**
— a started frame's `toolCallId` and an update frame's `latestUpdate` go with the roster row they joined,
so the reset can never half-drop an entry. Every surviving entry comes back **by reference**. Since #1563
it independently deletes the same conversation ids from `unlistedStarts`, so a start no roster ever
listed does not outlive its server's reconnect either — the two maps are filtered separately (a
conversation can be a member of one, the other, both, or neither), and both drops are copy-on-write.
Since #1561 it filters `finishedTasks` the same third way, so a departed server's finished ids do not
latch past its own reconnect either. It filters `pendingStops` independently by the same ids. When no
held roster, hold, finish, stop or Agent-evidence key is listed — a first
connect, a reconnect of a server holding nothing here, or a map holding only conversations outside the id
set — the state object is handed straight back, generalising the original `resetRosters`' `size === 0`
short-circuit so zustand's `Object.is` fires and no listener wakes. A
conversation this store holds a roster for that appears in **no** server's list survives every scoped
reset — the accepted consequence of scoping by the list (a background task can start for a conversation
whose list has not arrived), pinned by a test rather than left to drift wider later.

`clearAllRosters` ([#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139), the
**pairing-boundary** drop) is nullary — the `clearAllBacklogs`/`clearAllConversations` shape — so no
daemon-supplied conversation id or server origin can steer which command lines and patches survive a
boundary the operator crossed deliberately. It returns `initialBackgroundTaskRosterState` by reference and
carries the same short-circuit across membership and retained evidence: it returns
`s` only when `rosters`, `unlistedStarts`, `finishedTasks`, `pendingStops` and `agentTimeline`
are all already empty (`rosterAgentIds` shares roster lifetime), since a store holding
only unlisted holds or only finished ids is not an empty store and the same `local_bash` command text they
carry must not survive the boundary either — a departed pairing's finished task ids must not latch onto a
later pairing's roster either. It is invoked only from
[`clearPairingScopedState`](paired-shell.md#related), never from a bridge arm or a component, and it is
the only setter that reaches a roster held under a conversation no server's list ever carried.

### The data path (`src/renderer/src/store/backgroundTaskRosterBridge.ts`)

```ts
translateBackgroundTaskRoster(event: DaemonEvent): BackgroundTaskRosterSnapshot | null
// switch (event.type) { case 'backgroundTaskRoster': return { conversationId, tasks, droppedTasks }; default: return null }

translateBackgroundTaskStarted(event: DaemonEvent): BackgroundTaskStartedSnapshot | null   // #576, sibling translator
// switch (event.type) { case 'backgroundTaskStarted': return { conversationId, taskId, toolCallId, taskType, description, truncatedFields }; default: return null }

translateBackgroundTaskUpdated(event: DaemonEvent): BackgroundTaskUpdatedSnapshot | null   // #577, third sibling translator
// switch (event.type) { case 'backgroundTaskUpdated': return { conversationId, taskId, patch, status, summary, truncatedFields }; default: return null }   // status added #1561, summary added #1639

translateBackgroundTaskProgress(event: DaemonEvent): BackgroundTaskProgressSnapshot | null   // #1640, fourth sibling translator
// switch (event.type) { case 'backgroundTaskProgress': return { conversationId, taskId, currentActivity, subagentType, lastToolName, totalTokens, toolUses, durationMs, truncatedFields }; default: return null }

originOf(event: DaemonEvent): ConversationListOrigin   // since #1139 — reads #1068's stamp, never event.ack

subscribeBackgroundTaskRoster(onDaemonEvent, setRoster, resetRostersForServer, setStartedTask, setUpdatedTask, setTaskProgress, endTaskStopWait?): () => void   // optional trailing refusal writer; app composition supplies it
// onDaemonEvent(event => {
//   if (event.type === 'connected') { resetRostersForServer(originOf(event)); return }
//   if (event.type === 'backgroundTaskStopRejected') { endTaskStopWait?.(event.conversationId, event.taskId); return }
//   const roster = translateBackgroundTaskRoster(event); if (roster !== null) { setRoster(roster); return }
//   const started = translateBackgroundTaskStarted(event); if (started !== null) { setStartedTask(started); return }
//   const updated = translateBackgroundTaskUpdated(event); if (updated !== null) { setUpdatedTask(updated); return }
//   const progress = translateBackgroundTaskProgress(event); if (progress !== null) setTaskProgress(progress)
// })

BackgroundTaskRosterData(): null
// headless component, one subscribe effect (deps []), mounted app-level in App.tsx as the SEVENTH leaf
// the composition root (#1139): resolves origin -> conversation ids via conversationListStore, THEN
// calls backgroundTaskRosterStore.getState().resetRostersFor(ids) — see below
```

The daemon pushes roster/start/update/progress frames unsolicited. The panel separately sends stop
commands; the bridge consumes their typed refusal without raw error text, while successful settlement
uses the ordinary roster/update path. Each translator remains a pure single-arm filter, unconditional: there is
deliberately no `if (event.tasks.length === 0) return null` on the roster side, since an empty roster is
the frame's payoff signal (AC5, ex-AC4), not "no news"; there is likewise no `if (event.patch)` on the
update side, since `patch: ''` always arrives on the wire (no `omitempty`) and is a value meaning "claude
sent no change". The guards downstream are all `!== null`, which pin *filtering*, not *truthiness* (a
snapshot object is truthy even when its `tasks` are empty or its `patch` is `''`). `default: null` on all
four, not `assertNever`: this is an independent subscriber in the `queueBridge`/`sessionIdBridge`
posture, not one of the three typecheck-gating exhaustive bridges — which already no-op all four arms
from #564/#565/#566/#1638. `translateBackgroundTaskRoster` is behaviourally unchanged by the #576/#577 reshapes
— the row → `HeldBackgroundTask` mapping happens inside `setRoster`, not the translator, because that is
where the prior state the join needs lives. The four arms are mutually exclusive, so the subscriber's
branches short-circuit in order (`connected` → stop refusal → roster → started → updated → progress) and each matched
branch returns; order is a readability choice, not a correctness one. `translateBackgroundTaskProgress`
(#1640) copies all nine fields verbatim, the same posture as its three siblings, and reads `truncatedFields`
straight across (`null` never collapses into `[]`).

**The `connected` reset enforces half of a security requirement (#573's AC5); the other half moved to
`clearAllRosters` ([#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139)).** Until #1139 this
branch was the SOLE enforcement, wholesale: the relay re-emits `connected` on every (re)handshake and a
new pairing always re-handshakes, so a nullary reset here stopped a previous pairing's literal command
lines (`description`, for `local_bash`-typed tasks, and `patch`, whose keys may carry the same class of
text under a structured-looking shape — #577) from surviving into a new one. Since #1117 the app holds one
connection per paired server, so `connected` means "*this* server's connection came back", and #1139
scoped the reset to that server's own listed conversations (via `originOf`, reading #1068's client-bound
stamp, never `event.ack`). Scoping keeps the *reconnect* half of AC5 — the reconnecting server's own
previous connection never leaks forward — but retires the *previous-pairing* half: a new pairing's first
`connected` resolves an empty conversation list, matches no held roster, and would otherwise drop nothing
at all. That half now lives in `clearAllRosters`, in [`clearPairingScopedState`](paired-shell.md#related)'s
dep set — this store is no longer excluded from it (see
[Related](background-task-roster-store-related.md)).

The reset is still a leading branch in `subscribeBackgroundTaskRoster` *before* any translator runs — the
`queueBridge` posture, not `modalBridge`'s `reconnected`-as-translator-action posture — because each
translator returns a **value** (a snapshot), and folding the reset into any of them would force its return
type to widen into an action union, destroying the property that a translator is a pure arm→snapshot
filter. That property is also why #576 and #577 each added a **sibling** translator (for
`backgroundTaskStarted`, then `backgroundTaskUpdated`) rather than widening
`translateBackgroundTaskRoster`'s return type into a tagged union. Turning the origin into conversation
ids is the *caller's* job (`BackgroundTaskRosterData`, via #1086's `selectConversationIdsFor`), so the
bridge itself stays store-free and drivable with a plain spy — `originOf` is a module-private copy of the
`queueBridge`/`relayLinkBridge`/`conversationListBridge`/`daemonEventBridge` idiom, not an import, for the
reason each of those states.

`BackgroundTaskRosterData` derefs `window.pyry` only inside its effect, never during render, so it
server-renders to `''` without a bridge mock — the `QueueData`/`SessionIdData` invariant `App.test.tsx`'s
no-window-stub `<App/>` render depends on. Its name and props are unchanged by the #576 join, so
`App.tsx` itself is untouched.

### Data flow

```
App mount → <BackgroundTaskRosterData/> (app-level, seventh headless leaf)
  → subscribe effect: window.pyry.onDaemonEvent → subscribeBackgroundTaskRoster (live immediately, no request)

daemon → background_task_roster frame → parseBackgroundTaskRosterPayload → backgroundTaskRoster DaemonEvent [#566]
  → DAEMON_EVENT_CHANNEL → subscribeBackgroundTaskRoster listener
    → translateBackgroundTaskRoster → { conversationId, tasks, droppedTasks } (or null → skip)
    → backgroundTaskRosterStore.setRoster(snapshot)
      [rebuilds in roster order; retains started metadata, refreshes roster metadata;
       placement prefers roster id then started fallback; retains separate Agent evidence]
  → selectRosterFor(openId) / useBackgroundTaskRosterStore   (the panel's read)

daemon → background_task_started frame → parseBackgroundTaskStartedPayload → backgroundTaskStarted DaemonEvent [#564]
  → DAEMON_EVENT_CHANNEL → subscribeBackgroundTaskRoster listener (roster translator returns null first)
    → translateBackgroundTaskStarted → { conversationId, taskId, toolCallId, taskType, description, truncatedFields }
    → backgroundTaskRosterStore.setStartedTask(snapshot)
      [upgrades a listed task in place, otherwise holds it unseen in unlistedStarts; preserves droppedTasks
       AND a held latestUpdate; description/taskType/truncatedFields replace whatever the task held]
  → selectRosterFor(openId) / useBackgroundTaskRosterStore   (the panel's read; unlisted holds stay invisible)

daemon → background_task_updated frame → parseBackgroundTaskUpdatedPayload → backgroundTaskUpdated DaemonEvent [#565]
  (the DaemonEvent gained status/summary under #1560, both crossing verbatim, '' included; #1561 carries
   status — the family's only finish signal — into the snapshot below; #1639 carries summary too)
  → DAEMON_EVENT_CHANNEL → subscribeBackgroundTaskRoster listener (roster + started translators return null first)
    → translateBackgroundTaskUpdated → { conversationId, taskId, patch, status, summary, truncatedFields }   [#1561, #1639]
    → BackgroundTaskRosterData captures the addressed timeline's nextRowKey
    → backgroundTaskRosterStore.setUpdatedTask(snapshot, finishBefore)
      [joins on conversationId + taskId, never on order; miss on unknown conversation OR unknown taskId
       leaves display records unchanged, silently; existing agentTimeline evidence can still retain
       its first terminal boundary/order after removal; on a hit replaces latestUpdate wholesale,
       writes status/summary onto the held record for display (#1639), and, when status is exactly
       completed/failed/stopped, also files taskId into finishedTasks (#1561) — two independent reads of
       the same terminal check, one for the DRAWN tag, one for MEMBERSHIP]
  → selectRosterFor(openId) / useBackgroundTaskRosterStore   (the panel's read, #568 — now also reads
    task.status/task.summary per row, #1639)
  → selectLiveTaskCountFor(openId) / useBackgroundTaskRosterStore   (the pill's read, #1561 — excludes a
    finished id from the count; the panel's list is untouched)

daemon → background_task_progress frame → parseBackgroundTaskProgressPayload → backgroundTaskProgress DaemonEvent [#1638]
  → DAEMON_EVENT_CHANNEL → subscribeBackgroundTaskRoster listener (roster + started + updated translators return null first)
    → translateBackgroundTaskProgress → { conversationId, taskId, currentActivity, subagentType, lastToolName, totalTokens, toolUses, durationMs, truncatedFields }   [#1640]
    → backgroundTaskRosterStore.setTaskProgress(snapshot)
      [joins on conversationId + taskId like setUpdatedTask; miss on unknown conversation OR unknown
       taskId returns state unchanged, silently; on a hit replaces progress wholesale and touches nothing
       else — not latestUpdate, status, summary, droppedTasks or finishedTasks]
  → selectRosterFor(openId) / useBackgroundTaskRosterStore   (the panel's read — now also reads
    task.progress per running row, #1640)

Stop task click → recheck owning host status/capability → beginTaskStop(conversationId, taskId)
  → if claimed: stopBackgroundTask command → main → stop_background_task frame
  → selectPendingTaskStopsFor(openId) disables only that pair; acceptance is silent
  → backgroundTaskStopRejected → endTaskStopWait(conversationId, taskId) clears only its correlated pair
  → or ordinary terminal update / roster omission above clears its wait
  [app listener continues through drawer closure and conversation switches; no timeout]

relay (re)handshake → daemonConnection.ts emits connected DaemonEvent, stamped with its origin (#1068)
  → DAEMON_EVENT_CHANNEL (in-order) → subscribeBackgroundTaskRoster listener
    → originOf(event) → ConversationListOrigin (#1068's stamp, never event.ack)   [#1139]
    → selectConversationIdsFor(origin)(conversationListStore.getState())   [#1086, this server's ids]
    → backgroundTaskRosterStore.resetRostersFor(ids)   [only the listed keys dropped — started-sourced
                                                         tasks, recorded patches and stop waits go with them — or
                                                         same-ref no-op if none match]
  → then the daemon's reconcile burst arrives on the SAME channel, one background_task_roster per
    conversation whose bound session has reported one (pyrycode#2077-#2080, #569): each lands through
    the ordinary setRoster(snapshot) path above, correlated by conversationId and not by burst position
  → a conversation ABSENT from the burst stays dropped → selectRosterFor reads null ("No background-task
    report yet"); one re-asserted with tasks: [] reads observed-empty ("No background tasks")
  → backgroundTaskStarted/backgroundTaskUpdated are NOT in the reconcile set, so a started-sourced task's
    started id/provenance and fuller label do not survive — it comes back roster-sourced,
    possibly with an optional roster launch id for provisional timeline placement

pairing ends (unpair only, since #1141 — pairing another server adds a server rather than ending one) → clearPairingScopedState()   [#1139]
  → backgroundTaskRosterStore.clearAllRosters()   [every conversation's roster and stop waits dropped, or same-ref
                                                    no-op if already empty]
```
