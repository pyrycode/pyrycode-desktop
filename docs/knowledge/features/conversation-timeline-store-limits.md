# Conversation timeline store — Limits

Retention, send windows and row identity in the [conversation timeline](conversation-timeline-store.md).

## Edge cases and limitations

- **Ordering is arrival order, not `seq`.** `seq` is carried on `assistantDelta` through the
  translator but not consulted anywhere in this slice — `reduceTimeline` (#121) already ignores it,
  trusting the ordered transport.
- **Orphan/duplicate `toolResult` and turn-phase churn are the reducer's concern**, already
  same-reference no-ops (#121) — not re-handled by the store or bridge.
- **No dedicated test for `useTimelineBridge`.** A bare hook is untestable without a React renderer
  (none in this repo), exactly as `useDaemonEventBridge` has none — its behavior is fully carried by
  the pure `subscribeTimeline` tests. See [#202 codebase notes](../codebase/202.md) § Lessons learned.
- **Zero live traffic until [#179](../codebase/179.md).** Through #178, desktop withheld the
  `interactive` capability, so no `assistant_delta`/`turn_end`/`turn_state`/`tool_use`/`tool_result`
  frame reached this bridge in production — the store, bridge, #203's `Timeline` view, and #215's
  `ThinkingIndicator` view were built and tested against injected `DaemonEvent`s/`ThreadItem[]`/booleans
  only. #179 flipped `interactive`; all five now carry live daemon traffic, plus a sixth,
  renderer-sourced `userText` event the composer echo dispatches directly (not via the bridge).
- **The `toolCall` item's `result` fills as of [#229](../codebase/229.md), rendered as of
  [#230](../codebase/230.md).** The transport-to-reducer chain resolves its correlated `toolCall`'s
  `result` in place, visible via `selectItems`; the success/error visual landed in #230.
- **`stalled` is onset-only — no daemon "cleared" frame exists ([#317](../codebase/317.md)).** The
  reducer derives the clear entirely client-side, on the next `assistantDelta`/`toolUse`/`toolResult`/
  `turnState` arm; a stall with no following turn activity stays shown indefinitely, by design.
- **`apiRetry` is the deliberate inverse of `stalled`: it does NOT clear on turn activity
  ([#493](../codebase/493.md)).** The wire's `api_retry` frame carries an explicit falling edge
  (`active: false`), so the four turn-activity arms carry the scalar through unchanged instead of
  clearing it — a retry stays shown across intervening `assistantDelta`/`toolUse`/`toolResult`/
  `turnState` events, and clears only on its own falling edge. Copying `stalled`'s guard-widening
  pattern here would silently swallow a live retry on the next stream event.
- **Compaction liveness and retained completion are separate.** The `compacting`
  boolean survives turn activity and clears on its falling edge, reconnect or reset.
  A reconnect clears status directly, never by dispatching a synthetic false frame,
  so it cannot manufacture a completed divider. Received rows and any pending
  metadata association survive scrolling, navigation and reconnect while the
  [keyed holder](conversation-timeline-holder.md) retains that conversation.
- **Held state and saved rows have separate lifetimes.** A timeline reset, holder
  clear or eviction drops its in-memory dividers and pending association.
  [Local chat history](chat-history.md#storage-and-concurrency) retains received
  divider rows on disk and restores them on demand while offline, never the pending
  association. This feature does not recover missed offline events or replay
  `compaction_boundary` from history. History's existing `compacting` decoder carries
  outcomes, but prepending its reduced rows does not create a live pending association.
- **The relay never resumes a session and desktop advertises no replay cursor, so a reconnect cannot
  recover a lost falling edge — it can only reconcile forward** ([#538](../codebase/538.md)). The daemon
  re-asserts only the outstanding modal (#877) and the queued backlog (#878) on connect, never
  `api_retry`/`compacting`/`turn_state`, so a status genuinely still live across the reconnect shows no
  banner until the daemon's next edge. Accepted by design: a briefly-missing banner beats a
  permanently-stuck one.
- **`localSendPending` has no daemon falling edge — a bridge
  reconcile is not optional the way it is for `apiRetry`/`compacting` ([#650](../codebase/650.md)).**
  A send whose bridge call throws still posts the echo (`composerSend.ts`'s swallowed-failure
  contract), so the window opens for a message that never left the machine, and with the connection
  still up it closes on `turn_state`, reconnect, `session_error` or reset/holder clear.
  Navigation retains the keyed send window; the old switch reset affects only the flat store.
  This is the send-failure surface #650 deliberately left out of scope, not an
  oversight — engineering a timeout around it would be new client state defending an unobserved
  failure mode.
- **A send issued while the previous turn is still finishing closes the *new* window on the
  *previous* turn's `turn_state{idle}` ([#650](../codebase/650.md)).** `turnState`'s clear is
  unconditional on any phase, so the indicator can go briefly dark before the daemon reports the new
  turn. Decided as the ticket-sanctioned reading rather than defended — the queued-message path
  (#293/#294) is where that case properly lives.
- **A `reconnected` reconcile can now MINT an empty slice in the [keyed holder](conversation-timeline-holder.md)
  ([#785](https://github.com/pyrycode/pyrycode-desktop/issues/785)).** `reduceTimeline` on a fresh `initialTimelineState` has nothing to clear
  and returns the same reference, but `dispatchFor`'s key-absent branch still creates the slice
  unconditionally and inserts it at the head — the holder's existing, deliberate contract ("a fold for an
  id the client has never opened creates that id's slice rather than dropping it"), not new behavior this
  ticket added. It only fires when the open conversation has nothing retained yet; since
  [#786](https://github.com/pyrycode/pyrycode-desktop/issues/786) wired `markViewed` at the activation
  seam, opening a conversation already creates and promotes its slice, so a later `reconnected` reconcile
  finds an existing slice rather than minting a fresh one for any conversation that has actually been
  opened.
- **Row identity survives both prepends and settlement.** Array-index React keys made
  history prepends reuse connected nodes for different content and broke scroll anchoring;
  the origin-relative `firstRowKey + index` fix then became insufficient when queued
  settlement began moving rows within the list. The timeline now retains numeric `rowKeys`
  and a `nextRowKey` counter independently of item order. History prepends allocate new
  keys from that counter and retain all held keys. `prependedRows` still tracks inserted
  rows for the fallback `firstRowKey` path and saved-history contract.
  Saved-timeline admission initializes keys as `index - prependedRows` and the counter as
  `items.length - prependedRows` **before the first render**. Lazy initialization at the
  first live update or prepend would change every restored origin, disconnect nodes and
  transfer expansion to different rows. Queue projection carries `FoldedRow.itemIndex`;
  statistics/cursor use source indices, and React keys plus all tool/ancestor/run expansion
  lookups use those retained identities. Unit and mounted restoration regressions cover
  both live-first and prepend-first updates with connected Agent/Read/run nodes.
- **`prependHistoryFor` is not idempotent, by design** ([#1223](https://github.com/pyrycode/pyrycode-desktop/issues/1223)).
  Applying the same page twice prepends its non-`userText` rows twice — only `userText` rows are
  suppressed, by the AC4 echo dedup. Unreachable today; see the
  [history write path](conversation-timeline-store-internals.md) for why a guard was
  deliberately not built here.
- **User demand checks the near-top band, including zero.** Unknown coverage asks
  for the first page; received coverage uses its retained cursor unless `atStart`
  is true. Local reads and pending requests discard demand. Empty/short pages and
  prepend scroll events do not chain requests; failures require new connected
  input. See [history admission](chat-history.md#received-state-admission-and-ownership)
  and [zero-offset compensation](conversation-shell-scroll-pin.md#user-demand-and-prepend-position).
