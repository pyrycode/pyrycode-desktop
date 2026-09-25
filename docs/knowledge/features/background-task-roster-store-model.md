# Background-task roster store — what it does

Split from [Background-task roster store](background-task-roster-store.md) on 2026-09-23, once #1561's
finished-task-count work pushed the shared doc over the size cap. Part of the same store; see the parent
page for its introduction and history, [Internals](background-task-roster-store-internals.md) for the
store and bridge implementation, [Edge cases](background-task-roster-store-edge-cases.md), and
[Related](background-task-roster-store-related.md) for cross-references.

## What it does

Holds each conversation's currently-believed-live background-task set, keyed by `conversationId`, with
each task keyed within it by `taskId` — the **join** of what the two frames each report, rather than
either source held verbatim:

- A `backgroundTaskRoster` frame is **replacement truth for membership**: a task present in an earlier
  roster and absent from a later one is no longer held, whether it was first learned from a roster row
  or from a `backgroundTaskStarted` frame. Absence from a later roster is still this family's only
  removal path from the LIST. Since #1561 the family also reports a terminal `status` on an update, and
  that removes a task from the pill's COUNT instead, without touching the list — see [§ Live task
  count](background-task-roster-store-internals.md#the-pills-count-selectlivetaskcountfor-1561) and
  [Edge cases](background-task-roster-store-edge-cases.md). An empty roster (`tasks: []`) still writes an entry —
  the daemon's positive statement "nothing is alive for this conversation" — never dropped, filtered, or
  coalesced as "no news". Since #1563, a roster is also the only thing that settles a start it did not
  list: every roster for a conversation drops whatever that conversation is still holding from an
  earlier, unlisted start, since claude's roster line is its own statement of the background set and a
  row it never lists is not in it.
- A `backgroundTaskStarted` frame **upgrades a task its conversation's roster has already listed**,
  carrying in a `toolCallId` and a fuller, higher-cap `description` that no roster row can report. A
  start for a task no roster has listed does not reach either surface — since #1563 it waits, unseen, in
  a separate hold (`unlistedStarts`, see [Internals](background-task-roster-store-internals.md)) until a
  roster either lists it or speaks for the conversation without it. Once a task is started-sourced, a later roster naming the same `taskId` leaves
  its held record untouched rather than overwriting it — the daemon's own roster-cap comment states the
  roster label is the same text under a tighter cap and that the authoritative full copy already crossed
  the wire on the started frame, so refreshing from the row would throw the better copy away permanently
  (the started frame never repeats). A task the app only ever learns about from a roster has
  `toolCallId: null` — never a placeholder, since `''` is a real, colliding `tool_call_id` value the wire
  can send.
- A `backgroundTaskUpdated` frame **records the latest patch onto an already-held task** — never opens
  one. `patch` (opaque text, held verbatim) and its own cut report are latest-wins, one nested record
  ([#577](../codebase/577.md)): `null` means no update has ever matched the task, `{ patch: '', … }` is a
  recorded value meaning "claude sent no change", and the two never substitute for each other. An update
  naming an unknown conversation or an unknown `taskId` is silently ignored. Unlike the started frame's
  fields, a patch **survives** a roster replacement of its task regardless of provenance — no roster row
  can report a patch, so a later roster's row still refreshes the task's label/type/own cut report while
  leaving the recorded patch alone. Since #1560 the same frame also carries `status` (an open string,
  `''` on every patch-bearing frame) and `summary`; #1561 reads `status` — exact match on `completed` /
  `failed` / `stopped` — as the family's one finish signal and records it beside the task, never on it
  (see [§ Live task count](background-task-roster-store-internals.md#the-pills-count-selectlivetaskcountfor-1561)).
  Since #1639 the same frame's `status` and `summary` are also held **on** `HeldBackgroundTask`
  (`status`/`summary`, distinct from the `finishedTasks` set above) so the panel's tag and a finished
  row's summary line can draw them — see [Internals § How it
  works](background-task-roster-store-internals.md#how-it-works) and [Conversation shell — background
  tasks § Status tag and summary](conversation-shell-background-tasks.md#status-tag-and-summary-1639).
  `summary` is untrusted model-authored text, the same class as `description` and `patch`, rendered only
  as inert escaped text.
- A `backgroundTaskProgress` frame (#1638 decodes it, #1640 reads it) **records a running task's latest
  progress report** — joined the same way `backgroundTaskUpdated` is, on `conversationId` + `taskId` and
  never on arrival order, checking the listed task first and then the unlisted hold. Latest wins, one
  record per task (`HeldBackgroundTask.progress`), and it rides across a later roster or started rebuild
  the same way `latestUpdate`/`status`/`summary` already do, since neither a roster row nor a started
  frame can report it. A report for a task held in neither place is silently dropped, the same
  `Object.is`-provable miss `setUpdatedTask` already has: a report never opens a task. It is **not** a
  finish signal — it never touches `finishedTasks` or a roster's `droppedTasks` — and its three counters
  (`totalTokens`, `toolUses`, `durationMs`) are claude's cumulative readings, held exactly as received,
  never summed or diffed and not guaranteed monotonic; the frame is rate-bounded, so a gap between reports
  says nothing about a stall. `currentActivity`, `subagentType` and `lastToolName` are untrusted model-
  and tool-authored text, the same class as `description`/`patch`/`summary` — the activity in particular
  names a file on the operator's host. See [Conversation shell — background tasks § Progress
  block](conversation-shell-background-tasks.md#progress-block-1640) for the reader.

Deliberately **not** a [session store](session-store.md) or [timeline store](conversation-timeline-store.md)
facet: like `queue_state`, this family is daemon *state* (SSOT pyrycode #720), not part of claude's turn
stream, so it gets its own store rather than folding into `reduceTimeline`.

On the `connected` daemon edge, the store drops the **reconnecting server's own** held rosters, started-
sourced and roster-sourced tasks alike — and, since #569, the daemon's own reconcile repopulates them
safely rather than leaving the drop as the last word. Upstream (pyrycode#2077-#2080),
`background_task_roster` joined the daemon's reconcile-on-connect set (beside outstanding `modal_shown`
per pyrycode#877 and `queue_state` per non-empty backlog per pyrycode#878): on any (re)connection the
daemon unicasts one roster per conversation whose bound session has reported one, snapshot-shaped and
correlated by `conversation_id`, so `setRoster`'s unconditional replacement applies it idempotently and
the burst's order — the daemon walks its registry in insertion order, not a contract — is immaterial.
**Two silences, and they stay apart.** A session that reported an *explicit empty* roster reconciles to
`tasks: []` and reads "observed, nothing alive" ("No background tasks"). A session that has *never*
reported one is simply *absent* from the burst, stays dropped, and reads `null` — "nothing has been
reported", never "nothing is alive" ("No background-task report yet"). The `backgroundTaskStarted`/
`backgroundTaskUpdated` scalars are **not** in the reconcile set, so a task the app had upgraded to
started-sourced comes back roster-sourced after a reconnect, without its `toolCallId` or fuller label — a
real narrowing, pinned by a store test rather than merely stated. What makes the drop safe rather than
destructive is that the clear and the reconciled burst ride one listener in arrival order — proved
end-to-end through the real transport, not merely argued from the two call sites' code, by
`e2e/background-task-reconnect.spec.ts`.

Since [#1117](daemon-connection-routing.md) the app holds one live connection per paired server, so
`connected` means "*this* server's connection came back", not the app's one connection coming back — the
edge was originally a nullary whole-map clear, which
[#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139) scoped to the reconnecting server's own
conversations (sourced from the [server-keyed conversation
list](conversation-list-store.md#one-slot-per-server-since-1086)), the same fix
[#1138](https://github.com/pyrycode/pyrycode-desktop/issues/1138) shipped for [`queueStore`](queue-store.md)
one week earlier. Scoping the edge retired the self-heal that had kept this store out of
[`clearPairingScopedState`](paired-shell.md#related): a new pairing's first `connected` resolves an empty
conversation list, matches no held roster, and would otherwise drop nothing at all. So the store also
joined that set — a second, nullary setter drops **every** conversation's held roster wholesale at a
pairing boundary (unpairing, or pairing another server), closing the gap the scoped edge opened. This
family had no re-assertion path of any kind, so unlike `queueStore`'s drained-conversation case, every
roster latched for the life of the process until this clear was added. Since #569 the daemon's reconcile
re-asserts a roster, but only for the conversations of the *pairing that reported them* — a new pairing's
first `connected` still resolves an empty conversation list and drops nothing — so the clear remains
required for the unchanged reason: a departed pairing's `local_bash` command lines and `patch` text would
otherwise still be attributed, indefinitely, to a machine the operator has left.
