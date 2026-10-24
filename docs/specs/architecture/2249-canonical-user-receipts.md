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

## Revisions
2026-10-24: User bubbles contain message text and timestamp in the same container. Exact `getByText` cannot establish either pending text presence or conflict absence there. Keep the original assertions and additionally use row text for the pending/absence checks, after the corresponding positive assistant barrier. No production or shared-fixture change was needed.

## Verification — Linux
Executed implementation revision `b2aa72d17ca6831636ac73e188c6506fec8336dd` on Linux x86_64, 2026-10-24. Final merge of `origin/main` (`a653c019873c03288c96e721559a0b183a693be6`) was already current. Build provenance reports `profile: normal`, `sourceDirty: false`; later changes only record evidence in this plan.

| Check | Executed / passed / failed / skipped |
| --- | --- |
| Pre-verify, all five checks green; `threadSendStore.test.ts` | 13 / 13 / 0 / 0 |
| Canonical publisher and item-store units | 56 / 56 / 0 / 0 |
| Final owned Playwright spec plus configured native writer prerequisite | 2 / 2 / 0 / 0 |
| Owned receipt scenario alone, included in the preceding run | 1 / 1 / 0 / 0 |

`npm install --no-audit --no-fund`, `npm run typecheck`, `npm run typecheck:client-tests`, focused `tsc --noEmit -p /tmp/builder-2249/tsconfig.focused.json` and `npm run build` pass. The focused config includes the owned spec, which the normal client-test include list does not cover. Node checks completed before restoring SQLite with `npm run rebuild:electron` for final application execution.

Final mounted command: `npx playwright test e2e/live-user-receipts.spec.ts --retries 0 --reporter=json`. Both `live user envelopes draw with daemon time and preserve one optimistic echo` and `finite protected writer backlog preserves native keyboard and both event loops` executed/passed with retry 0. No global errors, skips, flaky results or teardown failures; all three setup attachments report first-attempt opened responders and valid matching upgrades. Screenshots remain at `/tmp/builder-2249/{received,echo}.png` (1280×800).

Retained development failures: `legacy-authority-red.json` records 2 executed, 1 passed, 1 failed, 0 skipped: the strengthened authoritative-text oracle detects the legacy adapter substituting local text. `canonical-receipts.json` records the same counts for the exact-text selector issue, corrected without changing production. `canonical-receipts-fixed.json` records a precommit 2/2 passing run. All have zero retries; none replaces the final committed-run evidence.

Fresh evidence is under `/tmp/builder-2249/`: `final-pre-verify.log`, `pre-verify-unit-evidence/`, `final-related-units.json`, final typecheck/build/install/native logs, `final-build-provenance.json` and `final-receipts.json` with stderr log. Final Playwright report SHA-256: `59e5ea5a88348bc653e32c18ac2cd13ef61cde43b2f689985613e761e9b0af5f`; related-unit report: `b5910b0798925847a64ee774a6953f16ad43f66a089dd485bb57aa197d078313`.

Complete configured application/replay/native acceptance remains pending with the dispatcher/verifier, which must identify the owned receipt scenario as executed at the matching candidate. No duplicate complete-suite run was added. No fresh provider, encryption or physical-effect proof is claimed; macOS is outside this ticket's verification scope. Final scope remains one owned spec and this plan, below the admitted estimate and all numeric ceilings.
