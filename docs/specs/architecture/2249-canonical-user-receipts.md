# Canonical receipt identity and duplicate handling

## Files read
- `e2e/live-user-receipts.spec.ts` → receipt scenario: retain trusted send, peer/own rows, daemon time, screenshots and ordered processing barrier.
- `e2e/fixtures/canonicalThread.ts` → `createCanonicalThread`, `publish`, `reply`: authored facts and correlated data/final certificates; duplicate authoring deliberately rejects.
- `e2e/fixtures/threadPublisher.ts` → `selectThreadPublisher`: native selection bypasses the legacy adapter and preserves exact controls.
- `e2e/fixtures/launchPairedApp.ts` → `startFakeServer`: compose publisher replies explicitly in native mode; existing teardown owns resources.
- `src/shared/wire/thread.ts` → `ThreadItem`, `ThreadUpdate`: complete facts and exact-base revisions.
- `src/main/deviceKeypair.ts` → `readDeviceIdentity`: typed public identity, never host/text inference.
- `src/renderer/src/store/threadSendStore.ts` → `matches`, `settle`: both device and outbound message ID establish acceptance.
- `src/renderer/src/store/threadItemStore.ts` → `applyFull`: equal/older replacement facts retain accepted content.
- `src/shared/threadTextExtension.ts` → `isSameRevisionTextExtension`: conflicting controls must replace text, not extend it.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`, `docs/knowledge/features/thread-runtime.md`: canonical ownership, positive barriers and acceptance boundaries.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`, `playwright.config.ts`: preserve normal replay/native prerequisites; complete gate belongs to dispatcher/verifier.

## Context
One mounted receipt invariant, split from #2219 under feature root #2209: peer and own messages retain canonical identity, authoritative text and daemon time across stale repetitions. Shared prerequisite #2210 is merged at `928f28fe`. No production, visual or shared-fixture change; no ADR needed. Remote feature-branch audit found no overlap in the owned spec.

## Design
Use one `createCanonicalThread` with an explicit conversation summary/current session, epoch, version and initial assistant opening marker. Select native launcher mode and call the publisher explicitly for valid pushes and query replies. This follows the refiner's resolved native-control contract: automatic canonical push interception would reject the deliberate duplicate facts before the app sees them.

Observe actual outbound envelopes. Assert an opening `thread_catch_up` for the selected conversation and positively render its canonical marker. The publisher retains query certification and scope ownership. Add a complete peer `user_message` with a distinct device/message pair and daemon timestamp.

Capture `window.pyry.deviceIdentity()` through the existing typed bridge. Drive the original composer fill/Enter, observe the outbound `SendMessagePayload`, and assert its optimistic row before supplying acceptance. An intervening canonical assistant marker must leave that local text visible and daemon accepted text absent. Then publish the own-device full item using the captured public identity and actual outbound message ID; its deliberately different authoritative text and daemon time must replace the optimistic row exactly once. Exercise one exact-base revision to establish the held accepted text before conflicts.

Deliver repeated equal-revision and conflicting equal/older-revision full items directly over the native daemon at advancing delivery versions. These controls intentionally bypass publisher authoring validation, never production validation. Re-sync publisher facts/version with the known authoritative set before publishing a later canonical assistant barrier. Only after that barrier renders assert one row per message, unchanged authoritative text/time and absent conflicting copies.

## State + concurrency model
Only spec-local facts, outbound observations and a monotonic delivery version are added. Acceptance is held by sequential awaited assertions, not a timer. No subscriptions or jobs; the launch fixture retains all existing app/daemon teardown.

## State transitions and identity reuse
All rows below are covered by `live user envelopes draw with daemon time and preserve one optimistic echo`.

| Event | Mounted assertion |
| --- | --- |
| Opening query | Actual conversation request and rendered canonical opening marker |
| Peer delivery | One peer row and daemon timestamp |
| Own send before acceptance, then unrelated assistant activity | One optimistic row remains; accepted daemon text is absent after positive marker |
| Explicit own acceptance and exact-base revision | Captured device/message pair reconciles to one authoritative row with daemon time |
| Repeated/equal/older conflicting full facts | Later assistant barrier precedes unchanged text/time/count and conflict absence assertions |

## Error handling
No new failure mode. Existing publisher validation, native protocol validation, launch errors and assertion failures remain authoritative. Invalid authoring is not silently discarded or enabled in the shared publisher.

## Testing strategy
- First strengthen the old adapter scenario with a deliberately different accepted-text oracle and observe its failure, then replace its legacy fact authoring.
- Run the owned mounted spec with `--retries 0`, retaining the configured native writer prerequisite and existing timeouts.
- Run pre-verify with `src/renderer/src/store/threadSendStore.test.ts`, plus relevant canonical publisher/item-store units, application/client typechecks and build after final main merge. Prepare Node/Electron native ABIs sequentially as required.
- Record exact Linux revision and executed/passed/failed/skipped counts here. Dispatcher/verifier runs the complete configured application gate once, including captured-client replay/native prerequisites, and must identify this scenario as executed. No duplicate complete-suite run, fresh provider/encryption/physical-effect proof, or macOS check.

## Open Questions
None. Native selection with explicit publisher composition resolves exact-wire duplicate delivery without shared changes.

## Scope check
One independently testable receipt outcome, four acceptance criteria, approximately 240 total written lines (about 160 spec and 80 plan/evidence), zero production files/exports/state-machine reject branches and one scenario consumer. All numeric ceilings hold.
