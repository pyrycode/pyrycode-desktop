## Files read

- `QuestionPanel.tsx` → `QuestionPanelView`, pick event mappers: plain-text controls and native grouping.
- `ConversationScreen.tsx` → `Timeline`, `ComposerSlot`, `QuestionPanelSlot`, `useThreadScrollPin`: owning chat, composer coverage and resize observations.
- `conversation.css` → question controls and permission overrides: preserve shared permission styling.
- `questionBatches.ts`, `questionBatchStore.ts`, `questionBridge.ts`, `questionPicksStore.ts` → reducers, selectors, dispatch ordering: memory-only lifecycle and redelivery.
- `src/main/index.ts` → question response correlation routing; `activeConversationStore.ts` → current navigation identity: stale callbacks retain their original owner and must reject after navigation.
- `questionResolution.ts`, `promptResponseAvailability.ts` → resolution and activation gate: optimistic sends, trimmed complete answers and owning-host availability.
- `composerSlot.test.tsx`, `QuestionPanel.test.tsx`, question/offline/permission and live specs under `e2e/`: existing coverage to adapt.
- `docs/knowledge/INDEX.md`, `CLAUDE.md`, conversation-shell question-panel and scroll-pin overviews, development-verification: leaf subscriptions, static-render limitations and resize pin behavior.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=756-8626

All question cards stack under “Claude has questions” inside history, with tertiary header labels and the existing PyryMark, surface boxes with primary-container borders, and a centered batch action row. Reuse theme typography, spacing, control and input tokens; composer and desktop footer stay below history.

## Context

The stepped composer replacement prevents reviewing or navigating while answering. This delivers one inline questionnaire behavior. No ADR is needed. Overlaps #1721 and #1726 are additive wiring/queued controls, not dependencies.

## Design

`Timeline` gains an optional trailing React node; the live screen supplies a store-bound question-history leaf even with empty/offline history. Saved message projections contain no question content. `ComposerSlot` covers its composer only for permission/trust. The question leaf retains a native hidden wrapper for the same precedence.

`QuestionPanelView` receives all questions and selections plus position-addressed edit callbacks. It draws every question in server order with separate client-owned positional radio names and one action row. Remove tabs and stepping. `resolveQuestionAnswers` remains the sole completion/payload computation.

Fresh requests replace the previous batch for the same conversation. The bridge clears retired picks before publishing replacement state; same-ID redelivery keeps picks and resolution excludes removed positions. At activation, compare the captured batch object with the current owning batch, check permission and host availability, then derive current answers. Edits also require current identity and valid positions. Stale callbacks therefore cannot recreate cleared picks or affect replacements.

## State + concurrency model

Keep the existing question and picks stores, without persistence or new async jobs. The history leaf subscribes narrowly to its batch, permission presence and picks. Existing thread ResizeObserver sees its direct-child growth and preserves the reader's following flag; it already disconnects on teardown. Synchronous guarded responses retain picks-first optimistic dismissal and reconnect reconciliation.

## Error handling

Offline local edits stay enabled; both response buttons and activation guards require owning-host availability. Existing guarded send helpers swallow bridge throws and clear optimistically; unresolved requests can reappear after reconnect. No new error state, IPC command, log content or wire change.

## Testing strategy

- Static rendering: all cards, independent group names, escaped daemon text, one gated action row, trailing history placement and permission-only composer coverage.
- Existing reducer/resolution tests: replacement ownership, removed positions, all-answer validation and optimistic failure clearing; guard tests cover stale edits/responses.
- Adapt existing fake-transport question, offline-held-response and permission scenarios: independent choices/Other, navigation retention, replacement/redelivery, offline gates, refusal/answer, permission drafts and scroll position. Capture integrated desktop at design and minimum sizes for Figma comparison.
- Adapt both real-Claude question specs to select every question without stepping, preserving continuation proof. Dispatcher owns live execution per issue refinement and shared working practice.

## Open Questions

None. Cleaner-shape check: compose the existing history leaf and pure controls; avoid moving transient prompts into message/timeline state or adding a response state machine.

## Security review

**Verdict:** PASS

- Trust boundaries: daemon fields stay React text children, never identifiers/attributes; control identity uses client-owned positions. Existing typed IPC commands remain the boundary.
- Tokens: no new credentials; request IDs remain memory-only correlation values and never DOM attributes or logs.
- File/storage operations: no new writes, browser storage or saved-message entries; draft state stays in memory.
- Electron attack surface: no new bridge/channel/window/navigation surface; existing isolation and main-side command validation remain in force.
- Cryptography: no crypto changes; transport and Noise remain in main.
- Network/I/O: existing synchronous response commands and reconnect reconciliation; offline activation checked immediately.
- Errors/logs/telemetry: existing content-free send failure events only; no drafts, request IDs or answers logged.
- Concurrency: MUST FIX addressed in design — captured object identity, current owner, permission and host checks precede synchronous edits/responses; duplicate callbacks see a cleared batch.
- Threat alignment: hostile question text is escaped; malformed redelivery positions are excluded. Relay/drop and token theft protections remain the main transport and safeStorage contracts, unchanged by this renderer ticket.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-05

## Revisions

2026-10-05: Retired-pick cleanup belongs in `questionBatchStore.dispatch` before publishing the reducer's replacement, rather than in the bridge. This covers every request installer and keeps the bridge's existing signature and subscription unchanged.

2026-10-05: The screen also reads pending-batch presence to omit the empty-history welcome while questions are present. Picks remain leaf-only. Visual comparison scopes the Other label/input width and body-large actions to `.question-batch`, preserving permission styling.

2026-10-05: `createQuestionBatchStore` receives a retirement callback; only the app singleton wires it to the picks store, preserving isolated factory tests. Captures are consolidated in the inline-question spec; legacy permission/offline scratch captures timed out in this runtime and are removed without removing behavioral assertions. Final written additions are below 800 lines (about 590), with one new component and no new state machine.

2026-10-05: Guard retained callbacks against active-conversation identity as well, so navigation invalidates old handlers even while their batch remains pending for later return. Main independently routes responses by its existing question correlation owner.
