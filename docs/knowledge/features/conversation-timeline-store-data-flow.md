# Conversation timeline store — data flow

Part of [Conversation timeline store internals](conversation-timeline-store-internals.md).
The diagram traces live delivery, reader demand and served-page admission.

## Data flow

The mounted `useTimelineBridge` explicitly injects browser animation-frame
scheduling into `subscribeTimeline`. Only `assistantDelta` deliveries wait: the
first schedules the next runnable callback, and further arrivals join its FIFO
without postponing it. That callback folds each event individually inside
`batchTimeline` for both stores, publishing once per store for an uninterrupted
delta burst. There is no millisecond deadline while the window is suspended.
Without frame options, injected subscriptions and ordinary store actions remain
synchronous; the subscription returns its original unsubscribe handle.

Translation captures each delta's conversation, sequence, parent-tool identity,
creation timestamp, live join key, durable history-entry id and receipt host during
delivery. Deferred keyed writes pass that captured host to `dispatchFor`, including
explicit null when no host was supplied. Neither a later receipt nor the selected
host can supply ownership at flush time; switching the open conversation cannot
redirect the queued text. Individual folds preserve grouping and history joins.

`threadUpdate` and `threadRepairNeeded` return at subscription entry, preserving
legacy store identity and the scheduled delta frame. Returning null only from the
translator would still flush pending deltas before ignoring the event.
`src/renderer/src/store/threadUpdates.test.ts` covers both translator no-ops and a
pending-delta subscription: neither indication dispatches or cancels the frame,
and the original callback later applies its delta once. These thread indications
belong to the [separate item-application path](inbound-message-decode-limits.md#thread-transport-ownership-and-coverage).

Every other non-delta daemon event flushes earlier deltas before translation or
reconnect handling, even when the translator returns null. Both stores also flush
before ordinary action reads and setters: tool/terminal/stall events, history admission,
local echo, queue removal and reset/clear retain their order and immediate handling.
These boundaries can add publications within the same frame. Flush detaches the
FIFO and invalidates/cancels its callback before folding, so recursive boundaries
and canceled callbacks cannot apply it again or settle a newer burst. Cleanup
unsubscribes, settles accepted work once and removes boundary listeners; stale
callbacks cannot mutate state after unsubscribe or restore cleared state.

Rendering publication and received-state persistence use separate observations.
The mounted history writer observes every staged fold with its captured host,
rather than waiting for the final publication after the preload receipt expires.
Window-close shutdown calls `flushTimeline` while that observer remains attached,
then detaches and drains protected storage before preload acknowledges shutdown.
See [store and binding internals](conversation-timeline-store-internals.md#the-store-srcrenderersrcstoretimelinestorets).

```
daemon frame ─(#199/#214/#217/#229/#315/#492/#495 transport, snake→camel)→
   DaemonEvent{assistantDelta|turnEnd|turnState|toolUse|toolResult|stallDetected|apiRetry|compacting}
   → window.pyry.onDaemonEvent (preload channel)
   → subscribeTimeline listener → translateTimelineEvent + capture attribution/sidecars
   → assistantDelta: FIFO until next animation frame or ordering boundary; other owned arms: immediate
   → flat dispatch + keyed dispatchFor → individual reducer/display folds
        → subscribeTimelineWrites: per-fold received-state capture for protected history
        → batchTimeline: one rendering publication per store for the delta-only burst
   → TimelineState / conversation-keyed slice
   → selectItems / selectPhase / selectStalled / selectApiRetry / selectCompacting
                                   (selectItems read by #203's Timeline view, now also carrying pending
                                   toolCall items from #217 with results resolved by #229; selectPhase
                                   read by #215's ThinkingIndicator view, narrowed by #493's and #496's
                                   shouldShowThinking clauses; selectStalled read by #317's StallIndicator
                                   view; selectApiRetry read by #493's ApiRetryIndicator view;
                                   selectCompacting read by #496's CompactingIndicator view)

fresh handshake ─(daemonConnection.ts:483, handshake-complete)→ DaemonEvent{connected, ack}
   → window.pyry.onDaemonEvent → subscribeTimeline → translateTimelineEvent → { type: 'reconnected' }
   → timelineStore.dispatch → reduceTimeline → phase/stalled/apiRetry/compacting/localSendPending cleared,
                                                 items untouched
   → timelineWriteTarget(event, null, getOpenConversationId) → the open conversation's id, or null if none
   → if non-null: conversationTimelineStore.dispatchFor(id, event) → that slice's chrome reconciled the
                                                 same way, its items untouched by reference (#785)
   (#538 — a separate, connection-lifecycle path alongside the stream path above, not a stream arrival;
    #785 gives it its first write into the keyed holder, addressed to the conversation on screen)

session boundary ─(sessionTransition, #286)→ translateTimelineEvent → { type: 'sessionBoundary', ... }
   → timelineStore.dispatch → reduceTimeline → a fresh sessionBoundary row tail-appended
   → timelineTargetFor(event) → event.conversationId (since #1559 — the frame's own id, never the screen)
   → conversationTimelineStore.dispatchFor(event.conversationId, event) → the same row tail-appended into
                                                 THAT conversation's retained slice, whether or not it is
                                                 open (#785 for the fan-out shape, #1559 for the key)
   (#1559: the wire has carried this arm's conversation_id since #1192; before #1559 this function
    returned null for it here and timelineWriteTarget filed the row into whichever chat was ON SCREEN —
    reset chat A, switch to chat B while the wrap-up turn ran, and the divider drew in B, never in A)

operator presses Enter ─(composerSend.ts, submitMessage, guard passed)→ optimistic echo
   → timelineStore.dispatch({ type: 'userText', text }) → reduceTimeline →
       localSendPending: { messageId: event.messageId ?? '', queued: false }   [#1725, was `true`]
   → selectLocalSendPending (read by ConversationScreen's workingIndicatorStateWithLocalSend, composed
                              on top of #215's shouldShowThinking/workingIndicatorState gate)
   (#650 — renderer-sourced, no daemon frame, no bridge involvement; closed by the next turnState,
    reconnected, or reset arm above, never by a fourth path of its own)
   → a queue_state for this conversation listing that messageId later flips queued: true via
     conversationTimelineStore.markLocalSendQueued — see Queue store § The data path and
     Conversation timeline holder § How it works (#1725; sticky, and keyed-holder-only — it does not
     reach the flat timelineStore above)

trusted upward thread input, connected owner, visible gap between overlays →
   requestGapHistory(historyAskDeps, conversationId, gap.olderId)
   → current failed gap / no resume position ? return
     : requestHistoryPage(cursor: gap.cursor or nearest newer receipt cursor, purpose: 'gap')
       → pending read/request ? return : markHistoryRequested(id, host, cursor, 'gap', gap.olderId)
       → sendCommand(requestHistory, cursor, limit: 200)
   // No visible gap: use the oldest-end path below. Each page needs fresh input.

trusted upward thread input near top without visible gap, connected owner →
   requestOlderHistory(historyAskDeps, conversationId, nearTop)
   → pending local read/request or received atStart ? return
     : requestHistoryPage → markHistoryRequested(id, host, cursor, 'older')
       → sendCommand(requestHistory, cursor: last successful cursor or '', limit: 200)
   // Scroll events and page settlement create no backwards demand.

owned connected opening / owning-host connected edge →
   createNewestHistoryDemand.sync(target, connected)
   → loading read / pending request ? defer existing demand
     : consume demand → requestHistoryPage(cursor: '', purpose: 'newest', limit: 200)
   // Departure/disconnect cancels delayed demand; settlement never creates it.

served history page ─(#1222 ask + transport decode, #1227 per-entry decode)→ DaemonEvent{historyPageReceived,
   conversationId, entries: HistoryTimelineEntry[], servedIds?, cursor, atStart}
   → window.pyry.onDaemonEvent (SAME channel, a FIFTH independent listener — historyPageBridge.ts, not
                                 subscribeTimeline)
   → subscribeHistoryPage → collect lifecycle from original chronological entries
        compare served coverage for the legacy row-only fold
        mounted path passes original typed entries even on a fully covered page
   → prependHistoryFor(conversationId, items, retainBoundary, entries)
        → reconcileHistory(held.timeline, held.display, entries, held.liveKeys, retainBoundary, disjointNewest)
        → admit unseen display contributions in durable-id order, merge held content,
          insert new rows at held chronological boundaries, retain orphan patches
        → return entry boundary keys for original-page lifecycle placement mapping
        → spread held slice with timeline/display; held live state survives
   → conversationTimelineStore.getState().recordHistoryPage(conversationId, cursor, atStart, servedIds)
        → detect/advance gaps from held served evidence and complete page ids
        → bound receipts, rebuild exact retained ids/highestId, retain oldest-end coverage on newest/gap
        → supersede loading saved-read owner; preserve settled saved presentation
   (#1223 — no reader wiring needed beyond the existing selectTimelineFor(conversationId): the keyed
    holder's read surface does not distinguish a live-appended row from a prepended one. Draw runs BEFORE
    settle so a page for a since-evicted slice still finds a key to record against.)

refused history ask ─(daemon-error tier's fourth member — see Request history send § Correlation)→
   DaemonEvent{historyRequestFailed, conversationId, reason, retryable}
   → window.pyry.onDaemonEvent → subscribeHistoryPage's settleFailure arm
   → conversationTimelineStore.getState().recordHistoryFailure(conversationId, reason, retryable)   (#1259)
   (all six `reason` members retain rows/coverage and expose failure without a timer or re-ask;
    captured cursor/purpose/gap survives; explicit Retry requires retryable/current ownership)
```
