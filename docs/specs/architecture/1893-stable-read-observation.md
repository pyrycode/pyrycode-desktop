# Stable visible-tail read observation

## Files read
- `src/renderer/src/store/conversationReadPublisher.ts` → `useReadObservation`, `readTargetFor`: committed display eligibility and retained identity; the publisher's deduplication remains unchanged.
- `src/renderer/src/store/conversationReadPublisher.test.ts` → retained and folded durable-target scenarios: identity contract to preserve.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ConversationScreen`, `ThreadBody`: sole hook caller and numeric `data-read-row` nodes.
- `e2e/visible-tail-read.spec.ts` → existing visible-tail scenarios: actual outbound targets and focus/reader/scroll gates.
- `e2e/thread-scroll-work.spec.ts` → `instrument`: spec-local attribution separates read work from scroll-pin work.
- `docs/knowledge/features/conversation-last-read-store.md` → How it works: observation must follow display commit; initially unknown identity and late contracts must remain eligible.
- `docs/knowledge/features/conversation-unread.md` → publication does not confirm a mark; ambiguous host ownership cannot publish.
- `docs/knowledge/features/development-verification.md` → Visible-tail read publication: mounted fake tests and committed-content barriers, rather than static effects or immediate absence checks.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, shared working practice: repository ownership and validation requirements.

## Context
Every streamed commit currently reconstructs read observation and scans every item and DOM read row to rediscover the same tail. Reuse setup while its conversation, numeric newest-message row identity and mounted pane/thread/tail nodes survive. This changes no appearance or layout. No ADR is needed. Remote feature-branch inspection found no overlap in the planned files.

## Design
Keep `readTargetFor(slice)`'s retained row-bound contributions and transient display-state IDs unchanged. Replace its forward newest-message reduction with a shared backwards search that stops at the newest user/assistant item. This avoids scanning the long preceding thread solely to discover the row.

`useReadObservation` retains a setup record in a hook-local ref: conversation ID, numeric key, pane/thread/tail nodes, observation callback and disposal function. A layout effect reconciles that record after every commit. A matching connected tail inside the same mounted thread reuses setup. Otherwise dispose the old setup and find the new tail with a targeted numeric-key selector, never an all-row query. Reader coverage, missing conversation/slice/nodes/key dispose setup.

A separate committed ref contains only the current rendered slice and its derived durable target, updated in the layout effect. Stable observer/list/scroll/focus callbacks read this ref, never a timeline store snapshot. Each commit explicitly rechecks visibility, so unchanged geometry can still publish a new target. Setup is allowed when the initial durable target is unknown; publication alone requires a known target.

## State + concurrency model
No store or IPC shape changes. React commit is the only writer of the committed ref. Synchronous callbacks inspect current list ownership/read eligibility but use committed timeline identity. One ResizeObserver observes thread, pane, tail and measured chrome. One scroll listener, focus listener and list subscription belong to each setup. Replacement and a dedicated unmount layout-effect cleanup dispose all of them. No new asynchronous tasks or streams.

## Error handling
Preserve silent ineligibility for unknown identity, ambiguous/mismatched host, blur, hidden document/content, queued content, reader coverage and offscreen tails. Keep existing publisher coalescing, reconnect and send-failure behavior. There are no new I/O boundaries or failure modes.

## Testing strategy
- Add spec-local browser instrumentation before conversation mount. Attribute constructors, observer targets, listener adds/removals, list subscription adds/removals and tail queries to read observation, excluding scroll-pin work and oracle discovery.
- On short and 400-row threads, settle setup, then send same-row deltas in separate committed frames. Require zero setup/discovery churn and advancing outbound durable targets. Verify one advance retains row key and bounding rectangle exactly.
- Change the newest message, cover/uncover with the reader, and navigate away/back; require one active setup with connected targets and no retained listeners/subscription after unmount.
- Existing ID-less replay/admitted-history and late-contract tests cover initial unknown targets and independently changing eligibility. Run all `e2e/visible-tail-read.spec.ts` scenarios and existing publisher units.
- First run the new churn regression against the pre-fix renderer, recording the setup-count failure; then run the repair. Final merge of main precedes pre-verify (full units/typecheck) and build. No live tests are changed.

## Open Questions
None. The simpler reconciliation inside one per-commit layout effect avoids adding row metadata to the timeline store or changing consumers.

## Size check
One deliverable (stable read observation preserving publication); about 350 written lines including plan/tests. Zero new exported types/components/stores, one production caller, four observable acceptance criteria, no new reject branches. Within all sizing limits.

## Revisions
2026-10-08 validation: the new regression failed against the unchanged `9aa12511` publisher on both 30-row and 400-row threads. Three separate commits produced 3 observer constructions, 3 discovery queries, 6 listener additions and 3 list subscriptions on each thread. The original six browser scenarios passed. The repair reduces those setup counts to zero, including growing content, while publishing geometry-preserving durable advances. Added direct hidden/queued/document-visibility gates and a received-but-uncommitted frame check; admitted ID-less history must reuse the initially unknown observation. A non-delta daemon event intentionally flushes buffered deltas, so the pending-frame oracle drives focus/scroll callbacks without sending a list. No production design change.
