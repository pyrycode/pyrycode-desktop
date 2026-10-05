# Conversation timeline store — Configuration and usage

Detail from the [conversation timeline overview](conversation-timeline-store.md).

## Configuration and usage

- **`useTimelineBridge(getOpenConversationId)` mounts in `App.tsx`**, right after `useDaemonEventBridge()`
  ([#203](../codebase/203.md), shipped) — app-lifetime, unconditional, one stable listener. Since
  [#785](https://github.com/pyrycode/pyrycode-desktop/issues/785) it takes one argument: `openConversationId`, a module-level constant defined
  in `App.tsx` that reads `activeConversationStore` via `selectActiveConversation`. Passing an inline
  arrow instead would resubscribe the listener on every `App` render — the constant is what keeps the
  hook's effect dependency array (`[getOpenConversationId]`) stable across the app's lifetime.
- **`selectItems`/`selectPhase`/`selectStalled`/`selectApiRetry`/`selectCompacting`/`selectLocalSendPending`
  were read in `ConversationScreen` from #203 (`selectItems`) through #650 (`selectLocalSendPending`), each
  gaining its reader as it gained a real source — see the [related contracts](conversation-timeline-store-related.md). As of
  [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758), none of the six is read there any more:
  the container now subscribes once to the [keyed holder](conversation-timeline-holder.md)'s
  `selectTimelineFor(openConversationId)` and destructures the same six `TimelineState` fields from that
  slice. See [Conversation shell § The open-conversation reader
  cutover](conversation-shell-actions-menu-and-reader-cutover.md#the-open-conversation-reader-cutover-758). This store's own selectors stay
  exported (unused re-exports of `threadTimeline`'s own) and this
  store stays dual-written; only the container's read side moved.
- Import surface (still exported, no longer imported by `ConversationScreen`):
  `import { useTimelineStore, selectItems, selectPhase, selectStalled, selectApiRetry,
  selectCompacting, selectLocalSendPending } from '@renderer/store/timelineStore'` and
  `import { useTimelineBridge } from '@renderer/store/timelineBridge'`. `ConversationScreen` still imports
  `useTimelineStore` alone, for the composer's `dispatch` write.
- Live conversation-owned events route through `timelineTargetFor` into the keyed
  holder; the legacy flat store remains dual-written. Refusal recovery reads and
  updates the retained keyed slice, never the flat slot.
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
  indicator](conversation-shell-working-indicator.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967-splits-the-local-send-window-into-sending-and-waiting-for-claude-since-1725).
- **`useHistoryPageBridge()` mounts in `App.tsx`** ([#1223](https://github.com/pyrycode/pyrycode-desktop/issues/1223)),
  beside `useQuestionBridge()` rather than replacing it — the first rework pass on this ticket landed a
  hunk that deleted the neighbouring call while keeping its now-unused-looking import, which compiled and
  passed every renderer unit test (a static server render mounts no effects) and only reddened the three
  `question-*` e2e specs. Takes no `openConversationId` unlike `useTimelineBridge`: a page's
  `conversationId` is required and client-owned, so there is nothing to fall back to.
- **`historyPageBridge.ts` has one asker, `requestOlderHistory`.** Its production
  caller is the scroll pin's trusted upward input handler, never activation or
  `onScroll`. `historyAskDeps` reads the current held slice and supplying host,
  marks before sending, and uses retained successful coverage independently of
  pending/failed request state. See [history admission](chat-history.md#received-state-admission-and-ownership).
