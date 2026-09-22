# #1561 — the task count pill drops tasks claude has reported finished

## Files read

- `src/renderer/src/store/backgroundTaskRosterStore.ts` → `BackgroundTaskRosterState`, `BackgroundTaskUpdatedSnapshot`, `HeldBackgroundTask`, `createBackgroundTaskRosterStore` (`setRoster`, `setStartedTask`, `setUpdatedTask`, `resetRostersFor`, `clearAllRosters`), `selectRosterFor`: the store this slice extends, and the docblocks the ticket says to correct.
- `src/renderer/src/store/backgroundTaskRosterBridge.ts` → `translateBackgroundTaskUpdated`: the translator that drops `status` today.
- `src/shared/ipc/events.ts` → the `backgroundTaskUpdated` arm: carries `status: string` (open string, #1560) and `summary: string`. Nothing new crosses IPC.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ComposerErrorSlotControl` (the `taskCount` derivation and its "THE TRUE ROSTER SIZE" comment), `NO_TASK_ROSTER`, `ComposerTaskCount`: the pill.
- `src/renderer/src/screens/conversation/BackgroundTaskPanel.tsx` → reads `selectRosterFor`; unchanged by this slice (#1246 owns a Finished group).
- `src/renderer/src/store/backgroundTaskRosterStore.test.ts` → the `updated()` snapshot helper, so a new snapshot field does not cascade through its call sites.
- `e2e/background-task-reconnect.spec.ts` → the `frame` / `roster` / `task` / `fake` / `openPanel` helpers the new spec mirrors, and the pill locator `.composer-status__tasks`.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=111-3525

The composer status row: a status reading on the left and the error slot on the right, which the task-count pill occupies when nothing outranks it. The pill's treatment and its absent state are unchanged. Only the number feeding it changes, so there is no markup or CSS change to compare against the frame.

## Context

The pill reads `tasks.size + droppedTasks`, and a task leaves `tasks` only when a later roster omits it. On claude 2.1.280 an empty roster usually lands one line before the `background_task_updated` carrying `status: "completed"`, but nothing guarantees it, and when it does not come the pill stays lit (observed live for 30+ minutes). #1560 carries `status` on the IPC arm; this slice carries it into the store and uses it as a second removal path from the **count**. The panel's list is unchanged: a finished task stays listed until a roster omits it.

## Design

### Terminal status held beside the tasks, not on them

`BackgroundTaskRosterState` gains a third map:

```ts
finishedTasks: ReadonlyMap<string, ReadonlySet<string>>   // conversationId → taskIds claude reported terminal
```

Why a set of ids beside `rosters` / `unlistedStarts` rather than a field on `HeldBackgroundTask`: "finished" is a fact about a task id that must survive every rebuild of the record (roster row rebuild, start upgrade, hold → listed move). As a field it would need a carry-over at three construction sites, each a silent-drop hazard like the one `latestUpdate` documents. Beside the records, no setter that rebuilds a record can lose it, and `setStartedTask` needs no change at all to satisfy AC3. It also leaves every `HeldBackgroundTask` fixture untouched.

### Write paths

- `BackgroundTaskUpdatedSnapshot` gains `status: string`, copied verbatim by `translateBackgroundTaskUpdated` (fresh named-field literal, as today). `summary` stays uncopied.
- `isTerminalTaskStatus(status: string): boolean` — exact match on `completed`, `failed`, `stopped`; everything else, `''` included, is alive. Not exported beyond the store; the field is never narrowed to a union.
- `setUpdatedTask`: the miss path is unchanged (returns the state object itself, silently). On a hit (listed or held in `unlistedStarts`) it records `latestUpdate` as today and, when the status is terminal, also adds the id to `finishedTasks` for that conversation. A non-terminal status never touches `finishedTasks`, so it neither removes nor restores (AC2).
- `setRoster`: keeps the conversation's finished ids that appear in the new roster's rows and drops the rest (an empty result deletes the key; no finished set means `finishedTasks` is handed back by reference). This bounds the set by the roster, answering the store's own growth rule for model-influenced ids, and keeps a finish recorded against a hold when the roster then lists it (AC3's second sentence).
- `setStartedTask`: unchanged. It never writes `finishedTasks`, so a start naming a finished task does not restore it (AC3).
- `resetRostersFor` / `clearAllRosters`: drop `finishedTasks` for the same keys / wholesale, and include it in their same-reference short-circuits.

### Read path

```ts
export const selectLiveTaskCountFor =
  (conversationId: string) => (s: BackgroundTaskRosterState): number
```

`0` when no roster is held; otherwise the listed tasks whose id is not in the conversation's finished set, plus `droppedTasks` (AC4 — a dropped entry has no id to match). Returns a primitive, so it is reference-stable for `useSyncExternalStore` with no memo. Living in the store is what lets #1246's panel share one definition of "alive" with the pill.

`ComposerErrorSlotControl` reads `selectLiveTaskCountFor(open.id)` (and a hoisted `NO_TASK_COUNT = () => 0` for the no-conversation arm) in place of the `selectRosterFor` read and the inline arithmetic. `NO_TASK_ROSTER` and the `BackgroundTaskRosterEntry` import go if nothing else in the file uses them.

### Docblock corrections (ticket-mandated)

"Deliberately carries NO terminal / finished / failed state" on `HeldBackgroundTask`, "a patch is never a finish signal: this family reports no terminal event" on `HeldBackgroundTaskUpdate`, the "absence … is this family's only removal path" claims in `HeldBackgroundTask` and `createBackgroundTaskRosterStore`, and "THE TRUE ROSTER SIZE" above `taskCount` in `ConversationScreen.tsx`. The corrected text says: the status on an update is the finish signal for the COUNT; the patch is still not; the list's membership is still roster-only.

## State + concurrency model

No new async work. All writes stay on the one synchronous daemon-event listener in `BackgroundTaskRosterData`. Copy-on-write as elsewhere in the store; a write for one conversation leaves every other conversation's set by reference.

## Error handling

No new failure modes. An unmatched update stays a silent same-reference no-op (the common case on 2.1.280). An unrecognised status is treated as alive, never logged. No logging is added: status is a daemon token beside patch text, and the store logs nothing today.

## Testing strategy

Vitest, `backgroundTaskRosterStore.test.ts` (new `describe` for #1561, through the `updated()` helper with a `status` default of `''`):

- one listed task + `completed` update → count 0; two listed + `failed` for one → count 1; `stopped` also counts as terminal.
- `''` and an unrecognised token (`'running'`, `'Completed'`) do not remove; `''` after a terminal does not restore.
- after a terminal, a roster listing it again → still not counted; a `setStartedTask` naming it → still not counted.
- terminal recorded while the task waits in `unlistedStarts`, then a roster lists it → not counted.
- `droppedTasks` still adds with a finished task present; no roster → 0.
- a roster omitting a finished task prunes its id (the set is bounded by the roster).
- a miss still returns the state object itself, terminal status or not.
- the panel's read (`selectRosterFor`) still lists a finished task.
- `resetRostersFor` / `clearAllRosters` drop finished ids.

Vitest, `backgroundTaskRosterBridge.test.ts`: `translateBackgroundTaskUpdated` copies `status` verbatim (existing exact-literal assertions gain the field) and still omits `summary`.

Playwright, new `e2e/background-task-finished-count.spec.ts` (fake transport): roster lists two tasks → "2 tasks running"; `background_task_updated` `completed` for one → "1 task running"; one with `status: ''` for the other → still "1 task running"; `stopped` for the other → pill absent, while the panel still lists both rows. This is the only proof that `ComposerErrorSlotControl` reads the new selector.

## Open questions

- Whether the pill should drop out on a finished id after a roster omission then re-listing (a new id collision) — not handled: the prune on omission means such a re-list counts again. Task ids are claude-generated per task and no re-list after omission has been observed.

## Documentation handoff

Pending for the documentation stage: the background-task package overview under `docs/knowledge/features/` should record that the pill's count is `selectLiveTaskCountFor` (listed tasks without a terminal status, plus `droppedTasks`), that the update's `status` is the count's second removal path, and that list membership remains roster-only.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings. `status` is daemon-relayed and may be model-influenced. It crosses into the renderer already typed on the `backgroundTaskUpdated` arm (#1560), and this slice only compares it by exact equality against three client-owned constants in `isTerminalTaskStatus`. The string itself is never stored, rendered or logged; only the task id already held in the store is recorded. `summary`, which has carried a literal command line, is not copied by `translateBackgroundTaskUpdated`.
- [Hostile daemon response] Accepted, stated: a daemon (or claude) that sends a terminal status for live work hides it from the pill, an under-report of the same kind a premature empty roster already produces. The panel still lists the task, so the work stays visible there. An unknown token keeps the pill lit, as today, rather than hiding live work.
- [Growth / exhaustion] No findings. `setUpdatedTask` writes to `finishedTasks` only on a HIT, so every finished id is an id already held in `tasks` or `unlistedStarts`; `setRoster` prunes the set to the roster's rows, and the reset and pairing clear drop it. The set is therefore bounded by what the store already holds, with no append-only growth keyed by a model-influenced id. Map/Set only, never a plain object keyed by id, so a `__proto__` id cannot write through `Object.prototype`.
- [Pairing boundary / storage] SHOULD FIX (implement in Phase B, verifier to check): `clearAllRosters` must return `initialBackgroundTaskRosterState` with an empty `finishedTasks`, and its short-circuit must consider `finishedTasks`, so a departed pairing's task ids do not latch. Nothing is persisted; no web storage is added.
- [Logs] No findings. No log line is added; the miss path stays silent.
- [Tokens, files, crypto, network, Electron surface] Not applicable: this slice adds no IPC channel, no preload API, no file, no socket and no key handling. Nothing new crosses IPC.
- [Concurrency] No findings. All writes stay on the single synchronous daemon-event listener in `BackgroundTaskRosterData`; no await is introduced.
- [Reconnect re-listing a finished task] OUT OF SCOPE per the ticket: `resetRostersFor` drops the finished set with the rosters, so a reconcile burst re-listing a finished task counts it again. Not observed; no follow-up ticket filed.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-23

## Revisions

- 2026-09-23: the Security review section above was added after the first plan commit, which went in before the `security-sensitive` label was checked. The design is unchanged by it; it was run before any implementation code.
