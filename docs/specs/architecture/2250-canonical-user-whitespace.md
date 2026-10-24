# Canonical delivered and queued whitespace proof

## Files read
- `e2e/user-whitespace.spec.ts` → `send`, `readBubbleMetrics`, `readCharBoxes`, `readStackMetrics`: retain the six delivered and three queued controls and all mounted measurements.
- `e2e/fixtures/canonicalThread.ts` → `createCanonicalThread`: authored facts, scope/version ownership and correlated data/final query replies.
- `e2e/fixtures/threadPublisher.ts` → `selectThreadPublisher`: canonical selection bypasses the scripted adapter.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`: trusted pairing/opening and canonical push routing.
- `e2e/canonical-thread.spec.ts` → canonical opening scenario: actual request observation and explicit current-session binding.
- `e2e/composer-reset-send.spec.ts` → reset scenario: typed public device identity and explicit acceptance tied to outbound message identity.
- `src/shared/wire/thread.ts` → `ThreadItem`, `ThreadUpdate`: complete user facts and owned updates.
- `src/shared/wire/types.ts` → `ConversationSummary`, `SendMessagePayload`: session binding and outbound identity.
- `docs/knowledge/INDEX.md`, `CLAUDE.md`, `docs/knowledge/features/development-verification.md`: canonical publisher contract; command receipt cannot establish acceptance.
- `docs/knowledge/features/development-verification-layout-and-input.md`: computed layout and genuine mounted input proof boundaries.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`: replay/native prerequisites remain with the configured application gate.

## Context
Replace legacy fixture input in the existing whitespace scenario with authored daemon thread facts. The current delivered measurements observe optimistic rows; this migration must first observe pending state, then explicitly accept each send. No production or visual change is requested. Feature root is #2209; #2211 owns combined acceptance. The merged prerequisite is `928f28fe`.

One deliverable: the existing mounted whitespace proof runs through the canonical publisher. Estimate: about 200–240 added/changed test and plan lines, zero production files, zero new exported surfaces, zero consumer migrations, four acceptance behaviours and no new error state machine. No in-flight remote feature branch changes the owned spec.

## Design
Keep all measurement helpers, fixture text, composer fill/click order, assertions and tolerances. Select `threadMode: 'canonical'` with one explicit summary/current-session binding, epoch and initial version. Observe actual decoded outbound requests without legacy aliases. Let the shared publisher supply query replies and final certification.

For each trusted send, capture its outbound `SendMessagePayload`, assert the local user row and Sending state while acceptance is withheld, then add a complete delivered `user_message` with the public device ID from `window.pyry.deviceIdentity()` and the captured message ID. Require the canonical row identity, exact text, settled count and absence of Sending before measuring delivered geometry. Use unique safe positive item orders and monotonically advancing versions. No revision update is needed for newly added immutable facts.

Publish the three queue fixtures as complete queued `user_message` items with explicit nonzero queue handles, session, status, activity, visibility and ordering. Keep the hostile trailing spaces verbatim. Preserve queued/delivered selectors and their separate controls. No shared fixtures change.

## State + concurrency model
All fixture state belongs to one scenario and publisher. Outbound capture does not publish acceptance. Test-side publication happens only after the awaited pending assertions. Existing fixture teardown owns app, relay, daemon and display lifetimes; no new long-lived task or subscription is introduced.

## State transitions and identity reuse
| Event | Mounted coverage |
| --- | --- |
| Opening empty canonical thread | Existing named whitespace scenario observes a real version-zero catch-up before sends. |
| Six sequential sends with distinct outbound identities | Same scenario checks pending before acceptance, then the matching canonical row and settled user count for each send. |
| Three queue items added after delivery | Same scenario checks three queue rows and preserves all queued geometry/containment assertions. |

## Error handling
No new application failure mode. Missing typed device identity, malformed outbound send facts or absent canonical rows fail the test. Publisher scope/order/version validation remains authoritative. No increased timeout, retry, skip or inferred acceptance.

## Testing strategy
- First add canonical-row expectations to the existing optimistic fixture and run the owned spec to demonstrate the missing acceptance boundary.
- Migrate fixture input and run `e2e/user-whitespace.spec.ts` with retries zero, retaining its original full scenario and all measured controls.
- Run affected canonical publisher/selection units, the pre-verify check after final main merge, `npm run typecheck`, `npm run typecheck:client-tests` and `npm run build` on Linux.
- Record revision and executed/passed/failed/skipped counts. Dispatcher/verifier owns the complete configured application gate, including captured-client replay, protected history/storage and native prerequisites; do not duplicate that suite. macOS is outside scope. No fresh provider/encryption/physical-effect proof is introduced.

## Open Questions
None.
