# #1563 — the pill and panel show only tasks claude lists as background

## Files read

- `src/renderer/src/store/backgroundTaskRosterStore.ts` → `createBackgroundTaskRosterStore` (`setRoster`, `setStartedTask`, `setUpdatedTask`, `resetRostersFor`, `clearAllRosters`), `BackgroundTaskRosterState`, `selectRosterFor`. This is the only production file that changes.
- `src/renderer/src/store/backgroundTaskRosterStore.test.ts`: the store's contract tests. Several of them assume that a started frame alone creates an entry, so they get reworked.
- `src/renderer/src/store/backgroundTaskRosterBridge.test.ts` → the `seam` real-store tests. Five of them emit `taskStarted` with no roster and read the task back through `selectRosterFor`. They need a listing roster, or their expectation inverts.
- `src/renderer/src/store/backgroundTaskRosterBridge.ts` → `subscribeBackgroundTaskRoster`. The routing from frame to setter is unchanged.
- `src/renderer/src/clearPairingScopedState.test.ts` → the "real stores: a background task started on the ended pairing" case. Its started-only `c-unlisted` task now lands in the new hold, so the pairing clear's assertion has to reach that hold too.
- `docs/knowledge/features/background-task-roster-store.md`: the "two silences" rule and the join semantics this ticket narrows.
- Consumers `ComposerErrorSlotControl` and `BackgroundTaskPanel` read only `selectRosterFor`. They are untouched, and that is the point of the design.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=111-3525

Node 111-3525 is the composer's status row. It has the thinking indicator on the left and a red-fill pill on the right, and the task-count pill sits in the same slot. This ticket changes no treatment, empty state or token. It only changes which tasks reach `selectRosterFor`, so no visual capture is needed and the fidelity check is intentionally not applicable.

## Context

claude emits `task_started` for foreground Bash calls that run longer than about 3 s (`is_backgrounded: false`). The daemon drops that flag, and no roster ever lists those calls. `setStartedTask` puts every start into the conversation's `tasks`, and only a later roster removes anything from there. So a foreground call lights the pill forever (#1558). The roster line is claude's background set, so `tasks` must hold only what a roster has listed.

## Design

A new state field holds the started tasks that no roster has listed yet. It sits outside `rosters`, so `selectRosterFor`, the pill's arithmetic and the "two silences" (`null` vs observed-empty) all stay as they are.

```ts
export interface BackgroundTaskRosterState {
  rosters: ReadonlyMap<string, BackgroundTaskRosterEntry>
  /** conversationId → taskId → started-sourced record no roster has listed yet. Never read by a surface. */
  unlistedStarts: ReadonlyMap<string, ReadonlyMap<string, HeldBackgroundTask>>
}
```

The name is `unlistedStarts`, not "unlisted", because "unlisted" already means "a conversation in no server's list" in `resetRostersFor`'s docs.

Setter behaviour:

- **`setRoster`**: for each row, the candidate is `rosters[conv].tasks.get(id) ?? unlistedStarts[conv].get(id)`. The started-sourced-keeps-whole and `latestUpdate` carry rules are unchanged, so a held start moves into `tasks` whole. It then **deletes `unlistedStarts[conv]`**, which drops every hold that the roster did not list. This bounds the holds by activity. The deletion is copy-on-write and happens only when the key is present, and the `rosters` write is unconditional as today.
- **`setStartedTask`**: if `rosters[conv]?.tasks.has(taskId)`, the task is upgraded in place exactly as today (position, `droppedTasks` and `latestUpdate` are all preserved). Otherwise the record is written into `unlistedStarts[conv][taskId]`, carrying any `latestUpdate` already held there, and `rosters` is left **by reference**. The roster-before-start ordering of 2.1.280 lands on the first branch.
- **`setUpdatedTask`**: a hit in the listed `tasks` works as today. Otherwise it tries `unlistedStarts[conv][taskId]` and records the patch there. If neither place holds the task, it returns `s` itself, silently. An update still never opens a task.
- **`resetRostersFor(ids)`**: drops the held keys in `ids` from **both** maps. If neither map holds a listed key, it returns `s`, the existing short-circuit extended to the second map. Surviving entries in both maps come back by reference.
- **`clearAllRosters`**: returns `initialBackgroundTaskRosterState` unless both maps are already empty, in which case it returns `s`.
- `initialBackgroundTaskRosterState` gains `unlistedStarts: new Map()`. The `init` parameter keeps its type, so a DI seed must now state both fields.

Docblocks to correct:

- The header's join paragraph.
- `BackgroundTaskRosterState`: an absent key now means "no roster has arrived", not "no frame".
- The factory docblock's `setStartedTask` and `setUpdatedTask` paragraphs.
- GROWTH BOUND: holds for a conversation are now emptied by every roster for that conversation, and only a conversation that never receives one keeps them until a reset or clear.
- The reset and clear paragraphs, which now cover both maps.
- `selectRosterFor`'s "key absent" row.

## State + concurrency model

Pure synchronous zustand setters, copy-on-write, with no async work and nothing to cancel. The single-listener arrival order of the bridge is unchanged.

## Error handling

There are no new failure modes. Misses stay silent, with no log line, because a log would leak command text (#126).

## Testing strategy

All of it is vitest at store level. The existing bridge seam tests prove the frame → store path end to end. No e2e is needed because the surfaces read `selectRosterFor` unchanged.

- AC1: a start with no roster leaves `selectRosterFor` returning `null` and the state's `rosters` identical by reference. After an empty roster, a start leaves the entry at `tasks.size === 0`, by reference.
- AC2: start → roster listing it gives a listed task with `toolCallId`, the full description and a prior `latestUpdate` (start → update → roster). Roster → start upgrades in place, which the existing tests already cover.
- AC3: a later roster that omits a task removes it. An empty roster gives an empty entry, which the existing tests cover. A start → roster that does not list it drops the hold, and a later roster listing that id rebuilds it roster-sourced (`toolCallId: null`).
- AC4: roster lists t1, then start and update for t1, and the task stays listed.
- AC5: `resetRostersFor` and `clearAllRosters` empty `unlistedStarts` for the dropped conversations. The reset leaves other conversations' holds by reference. The reset short-circuit still returns `s` when neither map holds a listed key. The clear on a store holding only unlisted starts is not a no-op.
- Existing tests that relied on a start creating an entry get a listing roster (store, bridge seam) or are inverted (`drives a real store … on one started emit`).

## Open questions

None.

## Documentation handoff

Pending for the documentation stage: `docs/knowledge/features/background-task-roster-store.md` § "What it does" (the `backgroundTaskStarted` bullet) and § "How it works". A started frame now reaches the surfaces only once a roster lists the task, a new `unlistedStarts` hold keeps the others, and both clears drop it.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings. The daemon-relayed `taskId`, `conversationId`, description and patch are held as opaque data, keyed in `Map`s only, never plain objects. So a `__proto__` id cannot write through `Object.prototype`. A test is added for the new map, with a `__proto__` conversation in the reset.
- [Tokens] No findings. No secrets are touched.
- [File / storage] SHOULD FIX, enforced by review: `unlistedStarts` holds the same `local_bash` command text as `tasks`. It must stay in-memory zustand state, with no web storage and no persistence middleware. Nothing in the design persists it.
- [Electron attack surface] No findings. The change is renderer-only store logic with no new IPC channel or bridge.
- [Network & I/O] No findings. There is no I/O.
- [Pairing boundary] No findings. This was a MUST FIX, and the design above already carries the fix: `clearAllRosters` must drop `unlistedStarts` wholesale, or a departed pairing's command lines survive. The design returns the initial state whenever either map is non-empty, and the AC5 test covers a store holding only unlisted starts. The same applies to `resetRostersFor` on the reconnect edge.
- [Growth / DoS] No findings beyond the status quo. A hostile or buggy daemon that streams starts with no roster used to grow `tasks` without bound until a reset. It now grows `unlistedStarts` the same way, until any roster for that conversation arrives, or a reset or clear. That is strictly tighter than before. No eviction policy is added for an unobserved failure.
- [Logging] No findings. Misses stay silent, and no text reaches a log.
- [Rendering] No findings. No surface reads `unlistedStarts`, and the existing inert-text rendering of `tasks` is unchanged.
- [Concurrency] No findings. The setters are synchronous with no awaits, so there is no check-then-act race.
- [Threat model] Hostile relay reordering: roster/start order is already handled either way round. A dropped roster leaves a hold invisible (under-report), never a stale pill (over-report).

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-23
