# #1725 — "Sending…" and "Waiting for Claude" before "Thinking…"

## Files read

- `src/renderer/src/store/threadTimeline.ts` → `TimelineState.localSendPending`, the `userText`, `turnState`, `dropUserText` and `reconnected` arms of `reduceTimelineContent`, `initialTimelineState`, `selectLocalSendPending`: the #650 send window this ticket refines.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `WorkingIndicatorState`, `statusRowCopy`, `THINKING_COPY` and its sibling constants, `ThinkingIndicator`, `workingIndicatorState`, `workingIndicatorStateWithLocalSend`, `isStatusIconTurning`, the container's `indicatorState` derivation: where the label and the glyph gate are chosen.
- `src/renderer/src/store/queueBridge.ts` → `subscribeQueue`, `QueueData`: the one place a decoded `queueState` reaches the renderer stores.
- `src/renderer/src/store/conversationTimelineStore.ts` → `dispatchFor`, `dispatchLocalEcho`, `ConversationTimelineStore`: the per-conversation slices the screen reads; the update branch's same-reference short-circuit is the shape the new action mirrors.
- `src/renderer/src/store/chatHistoryWriter.ts` → the `echo` test in the writer loop: the one production reader of `localSendPending` as a boolean.
- `src/shared/wire/types.ts` → `QueuedItem.message_id?`: the client-minted id the daemon relays (pyrycode#2092).
- `e2e/status-icon-local-send.spec.ts` (rewritten), `e2e/queued-backlog-interrupt.spec.ts` → `queueStateFrame`, `sentMessageId`, `capturingQueueInterruptFake`: the capture pattern for reading the minted `message_id` back off the outbound frame.

Overlap: `origin/feature/1723` edits a comment in `threadTimeline.ts`'s `reconnected` arm; no shared logic, so a later merge may touch that file only.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=112-3530

The status label group inside the composer status area `111-3525`: the snowflake glyph and one label run in `--color-primary`. Unchanged by this ticket; only the label copy gains two client-owned strings, "Sending…" and "Waiting for Claude", in the same `.composer-status__label` element and geometry.

## Context

#650 shows "Thinking…" from the composer's accept until the daemon's first `turn_state`. On 2026-10-03 the daemon accepted messages while its claude child was crash-looping and the row said "Thinking…" for minutes. The daemon already tells us when it holds a message: every `send_message` is enqueued and each enqueue pushes a `queue_state` whose items carry the client's own `message_id`. So the local window splits into two honest stages, keyed on that fact. No ADR needed.

## Design

**Store shape.** `TimelineState.localSendPending` changes type from `boolean` to `LocalSendPending | null`:

```ts
export interface LocalSendPending {
  readonly messageId: string   // the newest local send's composer-minted id; '' when none was minted
  readonly queued: boolean     // sticky: a queue_state for this conversation has listed messageId
}
```

One field, so the window and its stage cannot disagree. `null` replaces `false`; every arm that carries `state.localSendPending` is untouched, the three clears write `null`, the two early-out guards read `=== null`.

- `userText` arm (not `received`): `{ messageId: event.messageId ?? '', queued: false }`. A second send replaces it, so the label follows the newest sent id.
- New pure `markLocalSendQueued(state, queued: readonly QueuedItem[]): TimelineState` in `threadTimeline.ts`: returns `state` unchanged unless the window is open, not yet queued, its `messageId !== ''`, and some item's `message_id === messageId`; then `queued: true`. Never sets it back: a later snapshot without the item leaves it (claude committed it). An empty or foreign `message_id` never matches.
- `ConversationTimelineStore.markLocalSendQueued(conversationId, queued)`: applies the pure function to a held slice; no slice or no change ⇒ returns the state object (no churn, never creates a slice).
- `QueueData` in `queueBridge.ts`: the `setBacklog` callback also calls `conversationTimelineStore.getState().markLocalSendQueued(snapshot.conversationId, snapshot.queued)`. `subscribeQueue`'s signature is unchanged. `queue_state` still does not enter `reduceTimeline` or `ThreadEvent`.

**View.** `WorkingIndicatorState` gains `'sending'` and `'waiting'`. `statusRowCopy` returns `SENDING_COPY = 'Sending…'` and `WAITING_COPY = 'Waiting for Claude'` (both exported, client-owned).

- `workingIndicatorStateWithLocalSend(status, localSendPending: LocalSendPending | null)`: daemon answer wins (unchanged); `null` ⇒ null; otherwise the same gate re-call, whose `'thinking'` answer maps to `queued ? 'waiting' : 'sending'`. So "Thinking…" now comes only from a daemon `turn_state{thinking}`.
- `isStatusIconTurning(phase, state)`: `isTurnRunning(phase) || state === 'sending' || state === 'waiting'`. The local window no longer yields `'thinking'`, so that clause moves to the two new members; the glyph turns throughout as before.
- `ThinkingIndicator`: no change; the tool-name branch stays scoped to `thinking`/`working`.
- `isTurnRunning` and the interrupt control: unchanged, they read `phase` alone.

## State + concurrency model

No new async work. The queue subscription already exists (`QueueData`, cleaned up in its effect); this adds one synchronous store write per snapshot. `queue_state` and `turn_state` arrive on the same ordered daemon-event stream, so a snapshot that lists the item and then a `turn_state` close the window in order. The window still closes on any `turn_state`, `reconnected` and `reset`.

## Error handling

No new failure modes. A snapshot for a conversation with no slice is ignored. A `queue_state` that never arrives (the crash-loop before enqueue, or a dropped frame) leaves "Sending…", which is the honest reading; a time limit is out of scope.

## Testing strategy

Vitest:
- `threadTimeline.test.ts`: `userText` opens `{ messageId, queued: false }`; a second send replaces the id; `markLocalSendQueued` sets queued on a matching id, ignores a foreign id, an empty `message_id`, an absent `message_id`, a closed window; queued sticks across an empty snapshot; same reference when nothing changes; `turnState` still clears to `null`. Existing boolean assertions retyped to `null` / non-null.
- `conversationTimelineStore.test.ts`: the action updates a held slice, is a no-op (same state) for an unknown conversation or an unmatched id.
- `ConversationScreen.test.tsx`: `workingIndicatorStateWithLocalSend` returns `'sending'` / `'waiting'` / daemon state; static render of `ThinkingIndicator` for both new states shows the copy; `isStatusIconTurning` true for both new states and never on a local `'thinking'`. The 17 existing calls retyped from `true`/`false`.

Playwright (`e2e/status-icon-local-send.spec.ts`, rewritten): idle control → real send ⇒ "Sending…" spinning → `queue_state` with a foreign id ⇒ still "Sending…" → `queue_state` with the captured `message_id` ⇒ "Waiting for Claude" spinning → empty `queue_state` ⇒ still "Waiting for Claude" → `turn_state{thinking}` ⇒ "Thinking…" → `turn_state{idle}` ⇒ off.

## Open Questions

- Do any other fake-transport specs assert "Thinking…" right after a send? Grep showed only this spec asserts it after a send; confirm during implementation.
- A Codex conversation will read "Waiting for Claude". The ticket names Claude's copy only; noted for a follow-up rather than widened here.

## Revisions

**2026-10-05, Phase B.** Open questions resolved, design unchanged:
- No other fake-transport spec asserts "Thinking…" right after a send: `thinking-progress-estimate.spec.ts` pushes `turn_state{thinking}` with no send, and `thread-scroll-pin.spec.ts` sends mid-turn, where the daemon phase wins.
- The Codex copy stays out of scope; a Codex conversation reads "Waiting for Claude" until a follow-up selects it by agent, as `resettingLabel` does.
- The e2e spec gates each "label unchanged" read on the queued rows a snapshot draws (`[data-thread-role="queued"]` count), so the read happens after the snapshot was applied rather than passing before it lands.
