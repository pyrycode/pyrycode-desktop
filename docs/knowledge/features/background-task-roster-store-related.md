# Background-task roster store — related

Split from [Background-task roster store](background-task-roster-store.md) on 2026-09-23, once #1561's
finished-task-count work pushed the shared doc over the size cap. Part of the same store; see
[What it does](background-task-roster-store-model.md), [Internals](background-task-roster-store-internals.md),
and [Edge cases](background-task-roster-store-edge-cases.md) for the store itself.

## Related

- [Daemon-event channel](daemon-event-channel.md) / [#566 codebase notes](../codebase/566.md) / [#564
  codebase notes](../codebase/564.md) — the transport half this store consumes (`backgroundTaskRoster`
  and `backgroundTaskStarted` events, `BackgroundTask` wire row type); both shipped first, neither's wire
  contract touched by this store's reshapes.
- [Queue store](queue-store.md) / [#293 codebase notes](../codebase/293.md) / [#197 codebase
  notes](../codebase/197.md) — the exact structural precedent this store mirrors (daemon-state snapshot,
  keyed by conversation, store + bridge, render deferred) and the one thing that must **not** be cloned
  from it: `selectBacklogFor`'s `?? EMPTY_BACKLOG` collapse, which would silently violate this store's
  AC5 (never-observed vs. observed-empty). [#1138](https://github.com/pyrycode/pyrycode-desktop/issues/1138)
  scoped `queueStore`'s own `connected` reset one week before
  [#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139) ran the identical argument here, at
  the time one notch harsher: `queue_state` re-asserted a non-empty conversation while this family
  re-asserted nothing, ever. [#569](https://github.com/pyrycode/pyrycode-desktop/issues/569) retired that comparison — the roster now has a
  re-assertion path too, so the two families sit at the *same* notch: each re-asserts on the reconnecting
  server's edge and neither reaches a conversation whose pairing has since ended.
- [Modal store + bridge](modal-store-bridge.md) — the rejected alternative posture for the `connected`
  edge (folded into the translator as a `reconnected` action); this store takes the `queueBridge` posture
  instead, since each translator returns a value rather than a member of an action union.
- [`clearPairingScopedState`](paired-shell.md#related) —
  [#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139) added this store's `clearAllRosters`
  as the dep set's twelfth member. **This store used to be that helper's header's own named
  counter-example** — cited as a store the `connected` edge already clears for its own reasons, so it
  "does not belong here at all". Scoping the edge to the reconnecting server retired that claim: a new
  pairing's first `connected` resolves an empty conversation list and drops nothing, so the store now
  answers YES to the header's discriminator ("does a reconnect to the same daemon need to clear it?") and
  still belongs in the set — the same split `queueStore` already lives with since #1138.
- [#573 codebase notes](../codebase/573.md) — the original roster-only shape; its § "Open questions
  carried forward" (lines 74-78) predicted a widened per-conversation entry that #576's and #577's specs
  both found impossible — disbelieve that section; see [#577's codebase notes](../codebase/577.md) §
  "Correcting a stale prediction still on disk" for the correction of record.
- [#576 codebase notes](../codebase/576.md) — the per-task join reshape (`HeldBackgroundTask`,
  `toolCallId` provenance predicate) this doc's shape builds on; its "Open mutation-control gap" is the
  SHOULD FIX #577's AC4 test closes.
- [#577 codebase notes](../codebase/577.md) — the `backgroundTaskUpdated`/`patch` join this doc now fully
  describes: the `latestUpdate` nested type, the `setUpdatedTask` setter, the third bridge translator, and
  the trap in the `setRoster` rebuild branch (a field that "no roster row can report" is two different
  kinds, and picking the wrong kind is silent and untested by any pre-existing test).
- [#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139) · Spec:
  `docs/specs/architecture/1139-background-task-roster-reconnect-reset-scoped-to-server.md` — scopes the
  `connected` reset to the reconnecting server (`resetRostersFor`, replacing the nullary `resetRosters`)
  and adds the pairing-boundary `clearAllRosters`, applying [#1138](https://github.com/pyrycode/pyrycode-desktop/issues/1138)'s
  `queueStore` fix here on what was then the harsher case: this family had no re-assertion path at all,
  and the content at risk (`description`/`patch`) is a literal shell command line, not a queued message's
  `text`. [#569](https://github.com/pyrycode/pyrycode-desktop/issues/569) later gave the family a re-assertion path, narrowing but not closing the gap
  this ticket's `clearAllRosters` covers. Security
  review PASS with one MUST FIX (the pairing boundary), fixed in the design as shipped; two OUT OF SCOPE
  findings deferred to #1089 (a hostile daemon's own conversation-list contents narrowing a reset's scope,
  and the store's pre-existing conversation-id-only keying letting a daemon cross-attribute a roster to
  the wrong server's view — neither introduced nor fixed by this ticket).
- [#1563](https://github.com/pyrycode/pyrycode-desktop/issues/1563) · Spec:
  `docs/specs/architecture/1563-background-tasks-listed-only.md` — fixed the stuck "N tasks running" pill
  of [#1558](https://github.com/pyrycode/pyrycode-desktop/issues/1558): claude sends
  `system/task_started` for foreground Bash calls too (`is_backgrounded: false`, a flag the daemon's
  `BackgroundTaskStarted` never carries), and no roster ever lists such a call, so `setStartedTask`'s old
  unconditional upsert lit the pill for good. The roster is claude's own statement of the background set,
  so a start for a task no roster has listed now waits in a new `unlistedStarts` hold that neither surface
  reads, and moves into `tasks` whole — `toolCallId`, description, any recorded patch — the moment a
  roster lists it. `resetRostersFor` and `clearAllRosters` were widened to drop the same conversation's
  `unlistedStarts` alongside its `rosters` entry, so the same `local_bash` command-line content the
  pre-#1139 gap was about does not reappear through the new hold. Security review PASS (self-review); no
  MUST FIX, since the design already routed both existing clears through the new map.
- [Slash-command-list store](slash-command-list-store.md) — the shape this store lent onward: keyed
  `ReadonlyMap`, copy-on-write, `?? null` selector. That store deliberately did **not** copy this
  store's `connected` reset branch — which, at the time, was the sole enforcement of this store's own
  AC5; since [#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139) that enforcement is split
  across the scoped `connected` edge and `clearAllRosters` (see the `clearPairingScopedState` entry
  above).
- [#581 codebase notes](../codebase/581.md) / [Conversation shell — Background-task
  panel](conversation-shell-background-tasks.md#background-task-panel-581-cap-and-cut-display-since-582-latest-patch-since-583) — the store's first real reader: the shell of
  #568's panel (split three ways: #581 → #582 → #583), reading `selectRosterFor(conversationId)` and
  rendering only `description` + `taskType` per held task. `droppedTasks`/`truncatedFields` remain
  unread until #582; `latestUpdate`/`patch` remain unread until #583. Since [#569](https://github.com/pyrycode/pyrycode-desktop/issues/569), the panel
  reads a still-live task list after a reconnect too, because the daemon's own reconcile repopulates the
  store the panel reads from.
- **#569** — proved that the `connected`-edge clear and the daemon's reconcile-on-connect burst
  (pyrycode#2077-#2080) land in that order through the real transport, so a roster re-asserted at connect
  time is never wiped by the clear that precedes it. No production code changed: the store, the bridge
  and the panel already composed correctly (see [What it does](background-task-roster-store-model.md),
  [Internals § Data flow](background-task-roster-store-internals.md#data-flow), and [Edge
  cases](background-task-roster-store-edge-cases.md) above, all updated in place). One new spec,
  `e2e/background-task-reconnect.spec.ts`, drives a genuine reconnect through `launchPairedApp`'s
  `reconnectResendFrames` (#416's harness) and pins the two silences apart across it. Plan:
  `docs/specs/architecture/569-background-task-roster-reconnect.md`.
- [#1560](https://github.com/pyrycode/pyrycode-desktop/issues/1560) — the prerequisite that carried
  `status` and `summary` onto the `backgroundTaskUpdated` daemon event and IPC arm, both open strings,
  `''` on every patch-bearing frame; shipped dormant (no renderer bridge or store change), the same
  ship-first-read-later posture #573/#576/#577 used for the wire arms this store already joins.
- [#1561](https://github.com/pyrycode/pyrycode-desktop/issues/1561) · Spec:
  `docs/specs/architecture/1561-task-count-drops-finished-tasks.md` — the pill's first real removal path
  beyond roster omission: `BackgroundTaskUpdatedSnapshot` gains `status`, a new `finishedTasks:
  ReadonlyMap<string, ReadonlySet<string>>` state field holds the ids a `setUpdatedTask` HIT has reported
  exactly `completed` / `failed` / `stopped` (`summary` stays uncopied), and `selectLiveTaskCountFor`
  reads the roster's listed tasks minus that set, plus `droppedTasks` — see [§ The pill's
  count](background-task-roster-store-internals.md#the-pills-count-selectlivetaskcountfor-1561). The
  composer pill ([Conversation shell — composer status row § Background-task count
  pill](conversation-shell-composer-status.md#background-task-count-pill-the-slots-last-occupant-1435))
  is its first and, so far, only reader; the panel keeps reading `selectRosterFor` and keeps listing a
  finished task until a roster omits it (#1246 owns rendering the panel's own finished state). Security
  review PASS (self-review) with one SHOULD FIX — `clearAllRosters` must drop `finishedTasks` too, and its
  short-circuit must consider it — fixed in the design as shipped. One accepted, unguarded gap carried to
  [Edge cases](background-task-roster-store-edge-cases.md): a reconnect's reconcile burst re-listing an
  already-finished task counts it again, since `resetRostersFor` drops `finishedTasks` with the rosters it
  scopes to.
