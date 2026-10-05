# Conversation timeline store — Related contracts

Detail from the [conversation timeline overview](conversation-timeline-store.md).

## Related

- [Conversation timeline holder](conversation-timeline-holder.md) — a separate store (#755, split from
  #675) keying a whole `TimelineState` per `conversationId` instead of holding one flat slot for the open
  conversation. Not a replacement for this store: it runs alongside, importing
  `TimelineState`/`ThreadEvent`/`reduceTimeline` from the same [thread timeline](thread-timeline.md)
  module this store wraps. [#756](../codebase/756.md) made `useTimelineBridge` and the composer's echo
  write it too, dual-write; [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758) cut
  `ConversationScreen` over to it as the sole render source — this store keeps being dual-written but is
  no longer read by the screen.
- [#756 codebase notes](../codebase/756.md) — `timelineTargetFor`, the `subscribeTimeline` arity widen,
  and the `useTimelineBridge` fan-out: implementation summary, code review, and lessons learned.
- [#784 codebase notes](../codebase/784.md) — widens `DaemonEvent.unrecognizedMessage` with
  `conversationId`, moving it into `timelineTargetFor`'s id-carrying group and leaving
  `sessionTransition`/`connected` as the only two id-less owned arms at the time — the group
  [#785](https://github.com/pyrycode/pyrycode-desktop/issues/785) goes on to attribute, until
  [#1559](https://github.com/pyrycode/pyrycode-desktop/issues/1559) narrows it to `connected` alone.
- [#785](https://github.com/pyrycode/pyrycode-desktop/issues/785) — `timelineWriteTarget`, the write-key
  resolution downstream of `timelineTargetFor`: at the time, filed `sessionBoundary`/`reconnected` into
  the retained slice of the conversation on screen (or dropped them, inventing no key, when none was
  open) via an injected `getOpenConversationId` getter from `App.tsx`, keeping `timelineTargetFor` and
  `subscribeTimeline` byte-identical. Spec: `docs/specs/architecture/785-open-conversation-timeline-arms.md`.
- [#1559](https://github.com/pyrycode/pyrycode-desktop/issues/1559) — routes the session-reset
  separator by the frame's own `conversationId` instead of the conversation on screen. Moves
  `sessionTransition` into `timelineTargetFor`'s id-carrying group (`connected` is now the only arm
  left there) and drops `sessionBoundary` from `timelineWriteTarget`'s open-conversation fallback
  (`reconnected` is now the only arm that reads it). Fixes both the cross-conversation misfile (reset
  channel A, switch to channel B mid wrap-up, and the divider used to draw in B) and the #1225 duplicate
  divider this arm caused by contributing no live join key. Spec:
  `docs/specs/architecture/1559-session-boundary-routing.md`.
- [#1013](https://github.com/pyrycode/pyrycode-desktop/issues/1013) — the `now?: () => number` clock
  parameter on `translateTimelineEvent`/`subscribeTimeline`, and `useTimelineBridge`'s `Date.now` wiring:
  see [bridge internals](conversation-timeline-store-internals.md). See [Thread timeline § Types](thread-timeline-internals.md#types) for the full
  `createdAt` contract this seam feeds.
- [Thread timeline (conversation model)](thread-timeline.md) — the `ThreadItem`/`ThreadEvent`/
  `reduceTimeline` model this store wraps verbatim.
- [Daemon-event bridge (renderer)](daemon-event-bridge.md) — the sibling bridge this one mirrors in
  shape and shares the `onDaemonEvent` channel with.
- [Session store](session-store.md) / [ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md)
  — the DI-factory → singleton → hook → selectors shape `timelineStore.ts` mirrors.
- [Run configuration store](run-config-store.md) — the leaner single-setter store shape this one
  deliberately does *not* use (a real reducer exists here; a single setter would not fit).
- [#199 codebase notes](../codebase/199.md) — the transport slice: wire types, decode, and the
  `assistantDelta`/`turnEnd` `DaemonEvent` arms this bridge consumes.
- [#202 codebase notes](../codebase/202.md) — implementation summary and patterns established.
- [#214 codebase notes](../codebase/214.md) — the `turnState` transport slice: wire types, decode, and
  the third arm this bridge's `translateTimelineEvent` owns, giving `selectPhase` its first real
  source.
- [#215 codebase notes](../codebase/215.md) — `selectPhase`'s first reader, the `ThinkingIndicator`
  render slice.
- [#217 codebase notes](../codebase/217.md) — the `toolUse` transport slice: wire types, decode, and
  the fourth arm this bridge's `translateTimelineEvent` owns, the first to drive a durable `toolCall`
  item; unblocks the render slice [#218](https://github.com/pyrycode/pyrycode-desktop/issues/218) and
  feeds the correlation ticket [#229](../codebase/229.md).
- [#229 codebase notes](../codebase/229.md) — the `toolResult` transport slice, the last of the vertical:
  wire types, decode, and the fifth arm this bridge's `translateTimelineEvent` owns, the first to
  **resolve** a durable `ThreadItem` in place (via `fillResult`, #121) rather than append one or set a
  scalar; also the ticket that surfaced the third-bridge (`modalBridge.ts`) touchpoint cost. Unblocks the
  render slice [#230](https://github.com/pyrycode/pyrycode-desktop/issues/230).
- [Modal-prompt model](modal-prompt-model.md) / [#201 codebase notes](../codebase/201.md) — the
  `modalShown`/`modalDismissed` transport slice: the first `DaemonEvent` pair this bridge does **not**
  own, added to the inverse-filter `null` list instead; the real consumer is the third, independent
  [modal store + bridge](modal-store-bridge.md), shipped in [#223](../codebase/223.md).
- [ADR 0008 — Conversation-timeline model](../decisions/0008-thread-timeline-model.md).
- [ADR 0009 — Modal-prompt model](../decisions/0009-modal-prompt-model.md) — the vertical [#201](../codebase/201.md) is the transport slice of; this store deliberately stays outside it.
- [#203 codebase notes](../codebase/203.md) — mounts `useTimelineBridge`, reads
  `selectItems`, and paints the streamed assistant text — the blank-thread-critical slice [#179](../codebase/179.md)
  later flipped live.
- [Conversation create](conversation-create.md) / [#241 codebase notes](../codebase/241.md) — the
  `conversationCreated` transport slice: another `DaemonEvent` arm this bridge does **not** own,
  folded into the inverse-filter `null` list alongside `modalShown`/`modalDismissed`; the real
  consumer is the render sibling [#242](https://github.com/pyrycode/pyrycode-desktop/issues/242).
- [#254 codebase notes](../codebase/254.md) — the `sessionTransition` transport slice: another
  `DaemonEvent` arm this bridge does **not** own, folded into the inverse-filter `null` list (not a
  timeline item, unlike `turnState`); the real consumer is the [session-id store](session-id-store.md)
  ([#259](../codebase/259.md), shipped).
- [Session settings send](session-settings-send.md) / [#264 codebase notes](../codebase/264.md) — the
  `sessionSettingsUpdated`/`sessionSettingsRejected` transport slices: two more `DaemonEvent` arms this
  bridge does **not** own, folded into the inverse-filter `null` list alongside `sessionTransition`;
  the real consumer is the [Run configuration write store](run-settings-write-store.md)
  ([#256](../codebase/256.md), shipped).
- [#248 codebase notes](../codebase/248.md) — the `modalAnswerRejected` transport slice: another
  `DaemonEvent` arm this bridge does **not** own, folded into the inverse-filter `null` list alongside
  `modalShown`/`modalDismissed`/`sessionTransition`; the real, still-dormant owner is the
  [modal store + bridge](modal-store-bridge.md), render lands in
  [#249](https://github.com/pyrycode/pyrycode-desktop/issues/249).
- [#179 codebase notes](../codebase/179.md) — flips `interactive` live, and adds `Composer`'s direct
  `userText` dispatch as this store's sixth write path (renderer-sourced, not bridge-translated).
- [#315 codebase notes](../codebase/315.md) — the `stall` transport slice: wire type, decode, and the
  (at ship time) nullary `stallDetected` `DaemonEvent` arm, shipped dormant (all three bridges nulled
  it). [#732](../codebase/732.md) later widened the arm with `conversationId`; `ThreadEvent.stallDetected`
  stays nullary, so this bridge's mapping is unaffected.
- [#317 codebase notes](../codebase/317.md) — the render slice: moves `stallDetected` from this
  bridge's inverse-filter `null` list to a sixth owned arm, adds the `stalled` scalar and
  `selectStalled`, and gives it its first reader, `ConversationScreen`'s `StallIndicator`.
- [#492 codebase notes](../codebase/492.md) — the `api_retry` transport slice: wire type, decode, and
  the non-nullary `apiRetry` `DaemonEvent` arm, shipped dormant (all three bridges nulled it).
- [#493 codebase notes](../codebase/493.md) — the render slice: moves `apiRetry` from this bridge's
  inverse-filter `null` list to a seventh owned arm, adds the `apiRetry: ApiRetryStatus | null` scalar
  and `selectApiRetry` — with the clear semantics deliberately inverted from `stalled` — and gives it
  its first reader, `ConversationScreen`'s `ApiRetryIndicator` plus the `shouldShowThinking` supersede
  predicate.
- [#495 codebase notes](../codebase/495.md) — the `compacting` transport slice: wire type, decode, and
  the non-nullary `compacting` `DaemonEvent` arm, shipped dormant (all three bridges nulled it).
- [#496 codebase notes](../codebase/496.md) — the render slice: moves `compacting` from this bridge's
  inverse-filter `null` list to an eighth owned arm, adds the `compacting: boolean` scalar and
  `selectCompacting` — `apiRetry`'s clear-semantics inversion again, minus the counter — and gives it
  its first reader, `ConversationScreen`'s `CompactingIndicator` plus a second `shouldShowThinking`
  clause.
- [#538 codebase notes](../codebase/538.md) — moves `connected` from this bridge's null fall-through
  cluster to a ninth owned arm, mapping it to the nullary `reconnected` `ThreadEvent`; `reduceTimeline`'s
  new arm clears `phase`/`stalled`/`apiRetry`/`compacting` while preserving `items` by reference — the
  Mode B reconnect reconcile [`modalStore` #415](../codebase/415.md) / `queueStore` #197 already have.
  `daemonEventBridge.ts` and `sessionStore.ts` stay independent consumers of the same `connected` edge.
- [#642 codebase notes](../codebase/642.md) — the transport slice: decodes `tool_use.input` into the
  optional `DaemonEvent.toolUse.input` field, shipped dormant, carried to the IPC boundary.
- [#643 codebase notes](../codebase/643.md) — widens the fourth owned arm's `ThreadEvent`/`ThreadItem`
  pair with `input`, the first widen on this arm to also touch the appended item, not just the event.
  Still dormant — [#645](https://github.com/pyrycode/pyrycode-desktop/issues/645) renders it.
- [#650 codebase notes](../codebase/650.md) — adds a sixth `TimelineState` scalar,
  `localSendPending`, and `selectLocalSendPending`, but no tenth owned arm: it is written by the
  existing renderer-sourced `userText` arm rather than any `DaemonEvent`, closed by `turnState` and
  `reconnected` (both early-outs widened to match) and cleared for free by `reset`. First reader:
  `ConversationScreen`'s `workingIndicatorStateWithLocalSend`, composed on `workingIndicatorState`
  rather than folded into `ThreadStatus`.
- [#773 codebase notes](../codebase/773.md) — widens the fifth owned arm's `ThreadEvent`/`ThreadItem`
  pair with `resultDetail`, in one ticket rather than #642/#643's two-ticket split, since a scalar has
  no daemon-chosen keys to separate decode from carry over. Still dormant —
  [#856](https://github.com/pyrycode/pyrycode-desktop/issues/856) renders it.
- [#1223](https://github.com/pyrycode/pyrycode-desktop/issues/1223) — draws a served history page: widens
  `translateTimelineEvent`'s parameter to `DaemonEvent | HistoryTimelineEvent`, adds its tenth owned arm
  (`messageReceived`→`userText`, initially history-only; now also [routed live](conversation-timeline-store.md#live-user-receipts)), and adds the fifth channel subscriber
  (`historyPageBridge.ts`) and fifth store write path (`prependHistoryFor`) covered in [internals](conversation-timeline-store-internals.md).
  Blocked-by [#1222](request-history-send.md) (the ask + transport decode) and
  [#1227](request-history-send.md) (the per-entry payload decode); [#1224](https://github.com/pyrycode/pyrycode-desktop/issues/1224)
  split into [#1259](https://github.com/pyrycode/pyrycode-desktop/issues/1259) (the opening ask) and
  [#1260](https://github.com/pyrycode/pyrycode-desktop/issues/1260) (the walk), both shipped — see below —
  and [#1225](https://github.com/pyrycode/pyrycode-desktop/issues/1225) (joining a page to the live
  stream) has since shipped too. Spec:
  `docs/specs/architecture/1223-draw-a-history-page-through-the-timeline-reducer.md`.
- [#1259](https://github.com/pyrycode/pyrycode-desktop/issues/1259) — the earlier opening ask, covered in [History](conversation-timeline-store-history.md); split
  from #1224 alongside [#1260](https://github.com/pyrycode/pyrycode-desktop/issues/1260) (the walk). Spec:
  `docs/specs/architecture/1259-history-on-open.md`.
- [#1260](https://github.com/pyrycode/pyrycode-desktop/issues/1260) — the walk: `requestOlderHistory`
  beside `requestOpeningHistory` (both now under the renamed `historyAskDeps`), the `prependedRows`
  slice field and `Timeline`'s `firstRowKey` prop that make a prepend key-stable, covered in [limits](conversation-timeline-store-limits.md#edge-cases-and-limitations) and in
  full in [History](conversation-timeline-store-history.md). See [Conversation shell § Thread scroll
  pin](conversation-shell-scroll-pin.md) for the trigger band and `thread-scroll-pin.spec.ts` for the
  anchoring proof. Spec: `docs/specs/architecture/1260-history-scroll-back-walk.md`.
- [#1225](https://github.com/pyrycode/pyrycode-desktop/issues/1225) — the last slice of the #1088 family:
  joins a served page to the live stream on (`type`, `ts`) so an entry present on both draws once. Adds
  `daemonTs` (optional envelope metadata, initially forwarded on ten arms and now also on user receipts —
  see [Daemon event channel — emit and subscribe §
  `DaemonEventTimestamp`](daemon-event-channel-plumbing.md#daemoneventtimestamp--the-per-frame-comparand-1225)),
  a `liveKeys` set on `ConversationSlice`, and a page-side `withoutLiveEntries` pre-filter in
  `historyPageBridge.ts` that suppresses only a contiguous run at the page's newest end — never a scatter,
  which the rework leg found could strand a `tool_result` or fold a turn's text out of order. Every
  unresolvable case fails open (a duplicate row), never closed (a dropped one). Covered in full in
  [Internals § The history/live
  join](conversation-timeline-store-internals.md#the-historylive-join-1225) and in
  [History](conversation-timeline-store-history.md). Spec, including the full security review and both
  MUST FIX Revisions: `docs/specs/architecture/1225-history-live-join.md`.
