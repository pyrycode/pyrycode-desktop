# Background-task roster store

The renderer's held copy of each open conversation's live background-task set — a dedicated,
unidirectional Zustand store fed by a headless subscription binding that observes all **three** typed
daemon events in the family — the [daemon-event channel](daemon-event-channel.md)'s `backgroundTaskRoster`
aggregate, `backgroundTaskStarted` scalar and `backgroundTaskUpdated` scalar arms — joining them per task
so the panel (#581) and the composer's count pill (#1435) read one source of truth.

Introduced in [#573](../codebase/573.md), split from #567 alongside #574 (the two scalar arms,
`backgroundTaskStarted`/`backgroundTaskUpdated`). #574 was itself later split into
[#576](../codebase/576.md) (joined `backgroundTaskStarted`, reshaping the held value to be per-task) and
[#577](../codebase/577.md) (joined the last arm, `backgroundTaskUpdated`/`patch`). None of #573/#576/#577
shipped a visible surface — the store shipped populated and unread, deliberately, the same posture
\#564/\#565/\#566 already shipped for the underlying wire arms; #581 was the first reader (the panel), #1435
the second (the composer's count pill), and #1561 gave the pill its own selector distinct from the
panel's.

**Split 2026-09-23**, once #1561's finished-task-count work would have pushed this document over the size
cap. This page now holds only the introduction above and the small configuration section below. The four
larger sections moved to their own pages, linked from their stub headings:

- [What it does](background-task-roster-store-model.md) — the join semantics of the three frames, the two
  silences, and the `connected`/pairing-boundary reset story.
- [Internals](background-task-roster-store-internals.md) — the store's types and setters
  (`setRoster`/`setStartedTask`/`setUpdatedTask`/`resetRostersFor`/`clearAllRosters`), the bridge and its
  data path, and the full data-flow diagram, including `selectLiveTaskCountFor` (#1561).
- [Edge cases and limitations](background-task-roster-store-edge-cases.md) — untrusted-text handling,
  reconnect narrowing, the `unlistedStarts` hold (#1563), and the finished-task-count gaps (#1561).
- [Related](background-task-roster-store-related.md) — cross-references to the tickets and sibling stores
  this store's design draws on or was drawn from.

## Configuration and usage

- Mounted app-level in `src/renderer/src/App.tsx`, as the **seventh** headless leaf, after
  `<RelayLinkData/>` — one stable, app-lifetime listener with no subscribe/unsubscribe churn as the route
  flips, because either frame can arrive before the panel is ever mounted, and for a conversation the
  user is not looking at. The inline numbered leaf comments in `App.tsx` stop at "fifth" (`RelayLinkData`
  landed without one) — count the JSX, not the comments.
- No import surface at #573's ship: `useBackgroundTaskRosterStore`/`selectRosterFor` had no consumer
  until #581 (the panel); `selectLiveTaskCountFor` (#1561) had no consumer until the composer's count
  pill (#1435) switched onto it the same ticket that added it.
- `tasks` is a **display** map — its collection shape is not an invitation to iterate it as a work list
  something acts on. Nothing in this store or its bridge iterates it.
- `clearAllRosters` ([#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139)) is wired into
  `PairedShell.tsx`'s shared `clearPairingDeps` object, beside `clearAllBacklogs`, and invoked only from
  [`clearPairingScopedState`](paired-shell.md#related) — never from a bridge arm or directly from a
  component. Neither `clearPairingScopedState` call site needed an edit: per-path divergence is the exact
  bug that helper exists to prevent.
