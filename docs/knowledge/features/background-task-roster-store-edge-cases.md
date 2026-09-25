# Background-task roster store — edge cases and limitations

Split from [Background-task roster store](background-task-roster-store.md) on 2026-09-23, once #1561's
finished-task-count work pushed the shared doc over the size cap. Part of the same store; see
[What it does](background-task-roster-store-model.md) and
[Internals](background-task-roster-store-internals.md) for the model and implementation these edge cases
qualify, and [Related](background-task-roster-store-related.md) for cross-references.

## Edge cases and limitations

- **No two-way binding.** `setRoster`/`setStartedTask`/`setUpdatedTask`/`resetRostersFor`/`clearAllRosters`
  are invoked only by `subscribeBackgroundTaskRoster`'s wiring and `clearPairingScopedState`; components
  read exclusively through `selectRosterFor` (the panel) and, since #1561, `selectLiveTaskCountFor` (the
  pill) — neither selector can be written from a component.
- **No coercion or validation on either write path.** The store trusts #566's and #564's fail-closed
  decode completely. The wire row → `HeldBackgroundTask` mapping inside `setRoster` is a straight,
  named-field copy with no defaulting or derivation except `toolCallId: null` for a roster-sourced row —
  the one value in the held shape not sourced from the wire, deliberately outside the identifier domain
  so it cannot be mistaken for a real tool-call id.
- **`description` and `patch` are both untrusted, model-influenced daemon-relayed text.** `description`
  for `taskType: local_bash` is the literal command line claude ran; `patch`'s keys may carry the same
  class of text under a more tempting, structured-looking shape (JSON-like, but not guaranteed parseable
  — the daemon truncates it at construction, so a truncated object no longer parses). This slice has no
  DOM sink itself and runs no `JSON.parse`, key enumeration, or derived state on `patch` — #568 (not yet
  built) must render both as inert plain text only, never `innerHTML`/`dangerouslySetInnerHTML`, an
  attribute, or a URL, and must never execute or re-shell either. A reader that wants `patch`'s keys must
  parse behind an error branch that falls back to inert text, and must never enumerate a closed key set.
- **`patch`'s `truncatedFields` reports the cap cut only.** The daemon also scrubs invalid UTF-8 by
  deletion, so `patch` may differ from claude's bytes without appearing in that list — it is recorded,
  never cross-checked against the patch text.
- **Repopulated after a reconnect, roster-only, since [#569](https://github.com/pyrycode/pyrycode-desktop/issues/569).**
  Like `queue_state`, `background_task_roster` joined the daemon's reconcile-on-connect set upstream
  (pyrycode#2077-#2080): on any (re)connection the daemon unicasts one roster per conversation whose
  bound session has reported one, and each lands through the ordinary `setRoster` path. The two silences
  stay apart — a conversation reconciled with an explicit empty roster reads observed-empty; one absent
  from the burst stays dropped and reads `null` from `selectRosterFor` until claude next emits a frame.
  `backgroundTaskStarted`/`backgroundTaskUpdated` are **not** in the reconcile set, so a started-sourced
  task's `toolCallId` and fuller label do not survive a reconnect — it comes back roster-sourced, a real
  narrowing pinned by a store test. Proved end-to-end through the real transport (not merely modeled) by
  `e2e/background-task-reconnect.spec.ts`.
- **A roster held for a conversation in no server's list survives every scoped reset**
  ([#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139)) — the accepted consequence of
  scoping the reconnect edge by the conversation list rather than by anything wider, and a real case here
  rather than a corner one: a `backgroundTaskStarted` frame can arrive for a conversation whose list has
  not arrived yet. Pinned by a dedicated test so a later widening of the scope is a deliberate change.
  Because no `connected` edge ever reaches it, its retention window is "until the pairing ends" rather
  than "until the next connect" — `clearAllRosters` is the only thing that ever collects it, accepted on
  the same ~5 KB-per-task bound the store's header already carries, from a bounded-frame stream with no
  observed exhaustion.
- **Scoping the reconnect reset retired the argument that kept this store out of
  `clearPairingScopedState`.** Before [#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139),
  the `connected` edge's nullary whole-map clear meant a re-pairing's first `connected` blanked every
  latched roster on its way past, so a dedicated pairing-boundary clear would have been dead code. Once
  the edge scoped to the reconnecting server's own conversations, the new pairing's first `connected`
  instead resolves an *empty* conversation list and drops nothing — and, at the time, this family had no
  re-assertion path of any kind, so a departed pairing's rosters would otherwise have rendered
  indefinitely, forever attributed to a machine the operator has left. Since #569 the daemon's reconcile
  does re-assert a roster, but only for the conversations of the pairing that reported them, so a departed
  pairing's is never reached and the same risk stands. #1139 closed it with `clearAllRosters` (see § How it
  works) — the same sequence [`conversationListStore`'s AC5](conversation-list-store.md#edge-cases-and-limitations)
  and [`queueStore`](queue-store.md#edge-cases-and-limitations) each ran through one ticket earlier: a
  store's exclusion from `clearPairingScopedState` is a claim about a *different* mechanism keeping it
  fresh, and that claim can go stale without anyone touching the store itself.
- **A patch is never a finish signal; an update's `status` is (#1561).** A task's disappearance from a
  later roster is still the *list's* only removal path, whether it was roster-sourced or started-sourced
  or has a recorded patch — this store never infers a finish by diffing rosters, and the panel keeps
  listing a finished task until a roster omits it. What changed under #1561 is the *count*:
  `background_task_updated` now carries a `status` (#1560) and an exact match on `completed` / `failed` /
  `stopped` removes a task from `selectLiveTaskCountFor` alone, recorded in `finishedTasks` beside the
  task record rather than read off `HeldBackgroundTask`, `patch`, or a roster diff. Everything else in
  this bullet's earlier claim — that a patch itself carries no terminal state, and that the LIST has no
  removal path but a later roster's omission — still holds.
- **An unlisted start is invisible, not merely stale — and evicted three ways, not two.** Before #1563
  (see [Related](background-task-roster-store-related.md)), a started-only task was shown, and stayed shown, until a roster contradicted it or a
  reset/clear ran — the stuck "N tasks running" pill of #1558. Since #1563 such a start is held in
  `unlistedStarts`, which no surface reads, so it never lights the pill or the panel in the first place. A
  start for a conversation that never gets a subsequent roster is still held until something clears it:
  the same reset/clear pair as before (its server's next `connected` edge, if its conversation is
  listed — #1139; or, for a conversation no server's list ever named, the next pairing boundary,
  `clearAllRosters`) **plus a third, tighter path** — any later roster for that same conversation, since
  #1563 makes every roster drop its conversation's remaining `unlistedStarts` regardless of what it lists.
  #1558's two foreground calls sat in a conversation whose rosters kept flowing normally, so that third
  path now clears their kind of hold within one roster round-trip rather than waiting for a reconnect or a
  pairing change. Bounded per task (~5 KB, by the daemon's per-frame caps) but not bounded in count while a
  conversation genuinely never gets a roster; named and accepted in #576's spec, then narrowed further in
  #1563's, rather than defended with a speculative eviction policy, since sustained exhaustion has not
  been observed.
- **`latestUpdate` is latest-wins, deliberately not a history.** An append-only list keyed by a
  model-influenced `task_id`, fed by the daemon's push stream, would be unbounded growth on
  attacker-influenceable input; the daemon's own per-frame cap (`maxTaskPatch`, 4 KiB) is per frame, not
  per task, so only "one held record per task" keeps the bound meaningful (#577).
- **A finished id does not survive a reconnect's own reconcile burst re-listing the task — accepted, not
  guarded (#1561).** `resetRostersFor` drops a server's `finishedTasks` with its rosters (see [§ The
  pill's count](background-task-roster-store-internals.md#the-pills-count-selectlivetaskcountfor-1561)),
  so if the daemon's reconcile burst then re-lists a task this store had already recorded terminal, the
  pill counts it again until claude reports it terminal a second time. Not observed and not guarded
  against — `finishedTasks` is a fact about the current connection's view, not a durable record of what
  claude has ever reported, and no follow-up ticket has been filed.
- **No reader wired in this slice.** Shipped populated and unread through #573/#576/#577 — #568 (the
  panel) was still open. **#581 is now the first reader** — see below. **#1435 is the second**: the
  composer status row's trailing slot reads the count as a plain number, never iterating `tasks` or
  reading `description`/`latestUpdate.patch`. Originally `tasks.size + droppedTasks`, the roster's raw
  size; **since #1561 it reads `selectLiveTaskCountFor` instead** (see [§ The pill's
  count](background-task-roster-store-internals.md#the-pills-count-selectlivetaskcountfor-1561)), which
  excludes a task claude has reported terminal — the roster's raw size kept the pill lit for a task that
  had already finished whenever the emptier roster that usually precedes the terminal frame did not land
  first. **`finishedTasks` gained a second reader, the panel, since #1635**: the panel does not read
  `selectLiveTaskCountFor` (a number cannot say *which* rows to move), so it reads the set directly
  through [`selectFinishedTasksFor`](background-task-roster-store-internals.md#the-panels-grouping-read-selectfinishedtasksfor-1635)
  and still lists a finished task, now in its own group, until a roster omits it — the list's removal path
  named two bullets up is unchanged by having a second reader.
