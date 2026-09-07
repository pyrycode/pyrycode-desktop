# Conversation timeline store

The renderer's read/write surface over the [thread timeline](thread-timeline.md) model: a dedicated,
unidirectional Zustand store wrapping the pure `reduceTimeline` reducer, plus a
`daemonEventBridge`-shaped translator + React binding that feeds it from the v2 interactive-stream
`DaemonEvent` arms, from a served history page, and from the composer's own optimistic echo. Together,
the store and its bridges are what every render slice below reads and paints — the "single, ordered
source of truth" [#203](../codebase/203.md)'s spec called for.

Introduced in [#202](../codebase/202.md), built directly on [#121](../codebase/121.md) (the pure
[thread timeline](thread-timeline.md) model, shipped). Grew ten owned `DaemonEvent` arms, ten
`TimelineState` scalars/write paths, and — since [#1223](../codebase/1223.md) — a second, keyed axis (the
[keyed holder](conversation-timeline-holder.md)) plus a **fifth** independent channel subscriber,
`historyPageBridge.ts`, that draws a served history page and, since [#1259](https://github.com/pyrycode/pyrycode-desktop/issues/1259)/[#1260](https://github.com/pyrycode/pyrycode-desktop/issues/1260),
asks for one — first on opening a conversation, then again each time the operator scrolls back to its
top, until the daemon reports the start of the log. The full ticket-by-ticket account of how each piece
arrived is in [Conversation timeline store — history](conversation-timeline-store-history.md); this page
covers what's true today.

## Where the detail lives

Each section below keeps the heading it had here, so an existing `#anchor` still resolves once the link points at the right file.

- [Internals](conversation-timeline-store-internals.md) — The store itself, the translator and React binding that feed it from the daemon event stream, and the flow between them.
- [History](conversation-timeline-store-history.md) — The ticket-by-ticket changelog of every arm, scalar, write path and channel subscriber this store and its bridges have grown.

## What it does

Turns the ten owned `DaemonEvent` arms into `ThreadEvent`s and folds them into `TimelineState` via
`reduceTimeline`, exposing `selectItems`/`selectPhase`/`selectStalled`/`selectApiRetry`/
`selectCompacting`/`selectLocalSendPending` as the read surface. A stream arrival (an
`assistant_delta` chunk, a `turn_end` marker, a `tool_use` call, its `tool_result` outcome, a `stall`
onset, an `api_retry` edge, a `compacting` edge) re-renders only components selecting a timeline
slice — orthogonal to `sessionStore` and `runConfigStore`. The ninth arm, `connected`→`reconnected`
([#538](../codebase/538.md)), is not stream content at all — it is the connection-lifecycle reconcile
that clears the timeline's transient chrome on a fresh handshake. `localSendPending`
([#650](../codebase/650.md)) is written by neither path: it is set by the renderer-sourced `userText`
event the composer dispatches directly (see below), the store's one non-bridge write source.

## Configuration and usage

- **`useTimelineBridge(getOpenConversationId)` mounts in `App.tsx`**, right after `useDaemonEventBridge()`
  ([#203](../codebase/203.md), shipped) — app-lifetime, unconditional, one stable listener. Since
  [#785](https://github.com/pyrycode/pyrycode-desktop/issues/785) it takes one argument: `openConversationId`, a module-level constant defined
  in `App.tsx` that reads `activeConversationStore` via `selectActiveConversation`. Passing an inline
  arrow instead would resubscribe the listener on every `App` render — the constant is what keeps the
  hook's effect dependency array (`[getOpenConversationId]`) stable across the app's lifetime.
- **`selectItems`/`selectPhase`/`selectStalled`/`selectApiRetry`/`selectCompacting`/`selectLocalSendPending`
  were read in `ConversationScreen` from #203 (`selectItems`) through #650 (`selectLocalSendPending`), each
  gaining its reader as it gained a real source — see the individual tickets linked below. As of
  [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758), none of the six is read there any more:
  the container now subscribes once to the [keyed holder](conversation-timeline-holder.md)'s
  `selectTimelineFor(openConversationId)` and destructures the same six `TimelineState` fields from that
  slice. See [Conversation shell § The open-conversation reader
  cutover](conversation-shell-actions-menu-and-reader-cutover.md#the-open-conversation-reader-cutover-758). This store's own selectors stay
  exported (unused re-exports of `threadTimeline`'s own, not dead code — see § Configuration below) and this
  store stays dual-written; only the container's read side moved.
- Import surface (still exported, no longer imported by `ConversationScreen`):
  `import { useTimelineStore, selectItems, selectPhase, selectStalled, selectApiRetry,
  selectCompacting, selectLocalSendPending } from '@renderer/store/timelineStore'` and
  `import { useTimelineBridge } from '@renderer/store/timelineBridge'`. `ConversationScreen` still imports
  `useTimelineStore` alone, for the composer's `dispatch` write.
- No conversation-id scoping in this slice — `conversation_id` was already dropped at the #199
  transport (single active conversation); the bridge translates and dispatches unconditionally.
- **`connected` → `reconnected` needed no reader wiring** ([#538](../codebase/538.md)) — it drove the
  same `selectStalled`/`selectApiRetry`/`selectCompacting`/`selectPhase` selectors
  [#317](../codebase/317.md)/[#493](../codebase/493.md)/[#496](../codebase/496.md)/[#215](../codebase/215.md)
  once wired to `ConversationScreen`'s indicators. Since [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758)
  moved that reader to the [keyed holder](conversation-timeline-holder.md), the reconnect-clears-chrome
  behaviour the operator sees comes from [#785](https://github.com/pyrycode/pyrycode-desktop/issues/785)'s
  `reconnected` write into the open conversation's slice instead — this store still clears the same fields
  on the same event, but that clear is no longer the one rendered.
- **`selectLocalSendPending` had a real source as of [#650](../codebase/650.md) (the composer's
  `userText` dispatch) and its one reader from the same ticket through
  [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758)** — `ConversationScreen`'s
  `workingIndicatorStateWithLocalSend(status, localSendPending)`, composed on top of (not folded
  into) #215's `workingIndicatorState` gate, so #493's/#496's supersede clauses are inherited rather
  than restated. `localSendPending` now reaches that same function as one of the six
  [keyed-holder](conversation-timeline-holder.md) fields the container destructures. See
  [Conversation shell § Thinking / working
  indicator](conversation-shell-turn-status.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967).
- **`useHistoryPageBridge()` mounts in `App.tsx`** ([#1223](https://github.com/pyrycode/pyrycode-desktop/issues/1223)),
  beside `useQuestionBridge()` rather than replacing it — the first rework pass on this ticket landed a
  hunk that deleted the neighbouring call while keeping its now-unused-looking import, which compiled and
  passed every renderer unit test (a static server render mounts no effects) and only reddened the three
  `question-*` e2e specs. Takes no `openConversationId` unlike `useTimelineBridge`: a page's
  `conversationId` is required and client-owned, so there is nothing to fall back to.
- **`historyPageBridge.ts` has two askers as of [#1260](https://github.com/pyrycode/pyrycode-desktop/issues/1260):**
  `requestOpeningHistory` (fired once per activation, [#1259](https://github.com/pyrycode/pyrycode-desktop/issues/1259))
  and `requestOlderHistory` (fired from `useThreadScrollPin`'s `onScroll`, right after its existing pin
  write, passing the container's own `conversationId`). The production deps singleton feeding both was
  renamed `OpeningHistoryDeps`/`openingHistoryDeps` → `HistoryAskDeps`/`historyAskDeps` — same shape, six
  call sites across two production files plus the spec — since the old name would read as a claim about
  which asker it serves.

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
- **`compacting` follows the same inversion as `apiRetry`, a plain `boolean` rather than a `| null`
  record ([#496](../codebase/496.md)).** The wire's `compacting` frame also carries an explicit falling
  edge, so it too survives turn activity and clears only on its own signal — the two `&& !state.stalled`
  guards did not gain a compaction term either. Unlike `apiRetry` there is no counter to discard on
  clear, so the state is a bare liveness flag, not a status record.
- **The relay never resumes a session and desktop advertises no replay cursor, so a reconnect cannot
  recover a lost falling edge — it can only reconcile forward** ([#538](../codebase/538.md)). The daemon
  re-asserts only the outstanding modal (#877) and the queued backlog (#878) on connect, never
  `api_retry`/`compacting`/`turn_state`, so a status genuinely still live across the reconnect shows no
  banner until the daemon's next edge. Accepted by design: a briefly-missing banner beats a
  permanently-stuck one.
- **`localSendPending` is the one chrome scalar with no daemon falling edge at all — a bridge
  reconcile is not optional the way it is for `apiRetry`/`compacting` ([#650](../codebase/650.md)).**
  A send whose bridge call throws still posts the echo (`composerSend.ts`'s swallowed-failure
  contract), so the window opens for a message that never left the machine, and with the connection
  still up there is nothing that closes it until a `turn_state`, a reconnect, a conversation switch,
  or an unpair. This is the send-failure surface #650 deliberately left out of scope, not an
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
- **A prepend keys off the conversation's origin, not the head of the held array**
  ([#1260](https://github.com/pyrycode/pyrycode-desktop/issues/1260), fixing what [#1223](https://github.com/pyrycode/pyrycode-desktop/issues/1223)
  shipped). `ConversationScreen` originally keyed timeline rows by array index (see [Thread timeline §
  Edge cases](thread-timeline.md#edge-cases-and-limitations)) on the premise that the list never inserts
  mid-list — true of `reduceTimeline`'s own array, false of a page landing at the head via
  `prependHistoryFor`. Under an index key, prepending N rows made React match key 0 to key 0, so every
  already-drawn row was updated in place with a *different* item's content instead of N new nodes
  appearing at the head; Chromium's scroll anchoring then measured its anchor node's own offset before
  and after and compensated by the wrong delta, since that node never actually moved. Not harmless
  reconciliation churn: measured by mutation, the reader's row drifted from a viewport top of 112px to
  848px. The slice now carries a fourth field, `prependedRows: number` (0 on every fresh slice, raised by
  `fresh.length` — never `items.length` — only on the branch of `prependHistoryFor` that actually
  inserts), read by `selectPrependedRowsFor(id)` and passed to `Timeline` as an optional `firstRowKey`
  prop (`ConversationScreen` passes `firstRowKey={-prependedRows}`; every pre-#1260 render site passes
  nothing and defaults to 0). An item row keys as `firstRowKey + index`, unchanged by an append and
  shifted by exactly a prepend's count, so every surviving row keeps its key and only the new rows are
  new.
- **`prependHistoryFor` is not idempotent, by design** ([#1223](https://github.com/pyrycode/pyrycode-desktop/issues/1223)).
  Applying the same page twice prepends its non-`userText` rows twice — only `userText` rows are
  suppressed, by the AC4 echo dedup. Unreachable today; see § the write path above for why a guard was
  deliberately not built here.
- **The walk asks from a band above the top, never from the top itself** ([#1260](https://github.com/pyrycode/pyrycode-desktop/issues/1260)).
  `requestOlderHistory(deps, conversationId, nearTop)` sends only when the held reading is `loaded` with
  `atStart` false and `nearTop` is true; `requested`/`failed`/`null` all decline (see [Internals § The
  opening ask](conversation-timeline-store-internals.md#the-opening-ask-1259) for why `null` never
  restarts a walk mid-screen). `nearTop` comes from `isNearTop(metrics)`
  (`threadScrollPosition.ts`), true within `HISTORY_ASK_BAND_PX` (200) of the scroll wall rather than
  only at it, because Chromium suppresses scroll anchoring at a scroll offset of exactly zero — the one
  position where the mechanism holding the reader's place while a page lands above them is off. `atStart`
  is the only stop: nothing here counts entries or compares a page against the `limit` it was asked
  with, so neither an empty page nor a short one is read as the end of the log. A page too small to push
  the reader out of the band leaves them still near the top, and Chromium's own anchoring adjustment
  after a prepend is itself a scroll event — so a handful of small pages can walk several steps for one
  operator scroll, with no further operator action. See [Conversation shell § Thread scroll
  pin](conversation-shell-scroll-pin.md) for the band's arithmetic.

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
  `sessionTransition`/`connected` as the only two id-less owned arms — the group [#785](https://github.com/pyrycode/pyrycode-desktop/issues/785)
  goes on to attribute.
- [#785](https://github.com/pyrycode/pyrycode-desktop/issues/785) — `timelineWriteTarget`, the write-key
  resolution downstream of `timelineTargetFor`: files `sessionBoundary`/`reconnected` into the retained
  slice of the conversation on screen (or drops them, inventing no key, when none is open) via an
  injected `getOpenConversationId` getter from `App.tsx`, keeping `timelineTargetFor` and
  `subscribeTimeline` byte-identical. Spec: `docs/specs/architecture/785-open-conversation-timeline-arms.md`.
- [#1013](https://github.com/pyrycode/pyrycode-desktop/issues/1013) — the `now?: () => number` clock
  parameter on `translateTimelineEvent`/`subscribeTimeline`, and `useTimelineBridge`'s `Date.now` wiring:
  implementation summary above. See [Thread timeline § Types](thread-timeline.md#types) for the full
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
  (`messageReceived`→`userText`, live-lane-dormant by construction), and adds the fifth channel subscriber
  (`historyPageBridge.ts`) and fifth store write path (`prependHistoryFor`) covered in full above.
  Blocked-by [#1222](request-history-send.md) (the ask + transport decode) and
  [#1227](request-history-send.md) (the per-entry payload decode); [#1224](https://github.com/pyrycode/pyrycode-desktop/issues/1224)
  (the walk) and [#1225](https://github.com/pyrycode/pyrycode-desktop/issues/1225) (joining a page to the
  live stream) are still open. Spec:
  `docs/specs/architecture/1223-draw-a-history-page-through-the-timeline-reducer.md`.
- [#1259](https://github.com/pyrycode/pyrycode-desktop/issues/1259) — the opening ask, covered above; split
  from #1224 alongside [#1260](https://github.com/pyrycode/pyrycode-desktop/issues/1260) (the walk). Spec:
  `docs/specs/architecture/1259-history-on-open.md`.
- [#1260](https://github.com/pyrycode/pyrycode-desktop/issues/1260) — the walk: `requestOlderHistory`
  beside `requestOpeningHistory` (both now under the renamed `historyAskDeps`), the `prependedRows`
  slice field and `Timeline`'s `firstRowKey` prop that make a prepend key-stable, covered above and in
  full in [History](conversation-timeline-store-history.md). See [Conversation shell § Thread scroll
  pin](conversation-shell-scroll-pin.md) for the trigger band and `thread-scroll-pin.spec.ts` for the
  anchoring proof. Spec: `docs/specs/architecture/1260-history-scroll-back-walk.md`.
