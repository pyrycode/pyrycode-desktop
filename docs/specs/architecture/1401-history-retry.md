# History failure and explicit Retry

## Files read

- `src/renderer/src/store/historyPageBridge.ts` — `requestOlderHistory`, `historyAskDeps`, `subscribeHistoryPage`: existing demand and correlated settlement path.
- `src/renderer/src/store/conversationTimelineStore.ts` — `markHistoryRequested`, `recordHistoryFailure`, `recordHistoryPage`: preserve rows and successful coverage; stamp ownership.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` — `ComposerErrorSlot`, `ComposerErrorSlotControl`, `ComposerUsageLimitNotice`: status priority and existing visual treatment.
- `src/renderer/src/screens/conversation/conversationActionAvailability.ts` — `connectedConversationHostNow`: activation-time connection and host resolution.
- `src/renderer/src/store/activeConversationStore.ts` — `selectActiveConversation`: displayed conversation identity.
- `src/renderer/src/store/historyDemand.test.ts` — explicit demand tests: retained cursor and pending suppression.
- `e2e/history-on-open.spec.ts` — held fake replies and genuine upward input.
- `docs/knowledge/features/request-history-send.md`, “The one fact that shapes every piece”: main owns correlation because pages carry no conversation id.
- `docs/knowledge/features/chat-history.md`, “Received-state admission and ownership”: demand after either failure classification remains valid.
- `docs/knowledge/features/conversation-shell-composer-status.md`, actionable-error button and usage-limit sections: reuse the single slot and existing token styling.
- `docs/knowledge/features/development-verification.md`: static rendering cannot prove activation; hold a response for pending assertions.

## Design source

https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-5408

The inspected input area places the compact status action at the right of the status row above the message box. Reuse the existing small error button, body-small typography, error/on-error theme colors and status-message layout; this ticket adds text and Retry, with no new assets or surrounding composer redesign.

## Context and sizing

One deliverable: recover a failed history page explicitly without losing loaded history. Estimated 500–550 written lines including plan and tests, 2 production files, at most 4 new exported types/components, 1 consumer needing update, 4 acceptance criteria, and fewer than 10 guard branches. This reuses the seams that the larger #1321 analogue introduced. No wire or IPC changes. Codegraph reported an uninitialized index; repository search supplied the reading list. Refreshed remote feature branches show no overlapping planned files.

## Design

Add `historyRetry.ts` beside the conversation screen with a pure selector for a settled failure owned by the displayed host and an injected activation helper. Capture the displayed conversation object, host, and failure record. At activation, require the same displayed object, connected host, same owned failure record and `retryable: true`; then delegate to `requestOlderHistory`. Its successful coverage supplies the unchanged opaque cursor and its page limit remains zero, exactly as for the failed request. The synchronous pending mark discards duplicate clicks and upward demand.

`ComposerErrorSlotControl` subscribes to the displayed host and its held history failure. Pass history as the last optional occupant to `ComposerErrorSlot`, after recovery, refusal, settings error, stopping report and usage notice. Preserve connection/repair precedence. Pass actual null for an absent usage reading, rather than a non-null element whose render is empty. History shows the fixed copy “Could not load older messages” and a Retry button only on retryable failures. Reuse existing recovery/status and small-button classes.

## State and concurrency

No new store state, subscriptions to events, async jobs or timers. The existing history bridge settles pending requests and applies correlated pages. Starting Retry replaces failed state with requested state, retaining rows and coverage. A later failure supplies fresh retryability; success removes the affordance. Opening, reconnect, response arrival and rendering never request a page. Existing upward-demand behavior after nonretryable failures remains unchanged.

## Error handling

Existing typed failure classifications remain in the holder. Only static client copy reaches this UI. Activation emits a content-free `history-retry` diagnostic with static `requested` code; no cursor, host, conversation or daemon error text is logged. Stale or unavailable actions return without dispatch.

## Testing strategy

- Write failing state/markup tests before production changes. Cover same-page retry, pending suppression, unchanged rows/coverage, new failure classification and success; host/conversation gates, stale captured actions, navigation and disconnect; status priority and absent-notice fallback.
- Add a focused fake-transport Playwright spec delivering both refusal classifications, retrying a held same-page request once, retaining visible rows, then releasing its correlated success. Capture error states at desktop and minimum width for visual review.
- Run touched Vitest files, `npm run build`, and the focused Playwright spec. Full regression belongs to the verifier.

## Documentation handoff

Pending for the documentation stage: “The documentation stage updates the history request/paging and composer-status topics to describe explicit Retry, its retryability and host gates, preserved coverage, and the unchanged upward-demand behavior. The inbound decode contract must not describe `historyRequestFailed` or `systemPromptReceived` as lacking consumers: the independent history and system-prompt bridges already own them. The unrelated exhaustive bridges' null arms remain intentional.”

Paths/sections: `docs/knowledge/features/request-history-send.md` (request behavior and inbound decode), `docs/knowledge/features/chat-history.md` (Received-state admission and ownership), and `docs/knowledge/features/conversation-shell-composer-status.md` (status occupants and priority). Shared documentation is not edited by the builder.

## Open questions

None. The request path always uses limit zero; retaining coverage therefore reproduces the failed request without new cursor or limit state.
