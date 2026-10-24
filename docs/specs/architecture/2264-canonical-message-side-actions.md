# Canonical message side-action fixtures

## Files read
- `e2e/message-side-actions.spec.ts`: `frames` and all three mounted sizing, hover/focus and trusted clipboard scenarios.
- `e2e/fixtures/canonicalThread.ts`: `createCanonicalThread` retains authored facts and correlates query replies.
- `e2e/fixtures/threadPublisher.ts`, `e2e/fixtures/launchPairedApp.ts`: canonical selection covers opening, replies and pushes without the compatibility publisher.
- `e2e/send-and-stream.spec.ts`, `e2e/queued-backlog-interrupt.spec.ts`: public device identity, accepted user facts, queue status and exact item barriers.
- `src/shared/wire/thread.ts`: `ThreadItem` and `ThreadUpdate` identity/revision contracts.
- Root `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/conversation-shell-message-bubble.md`, `docs/knowledge/features/e2e-harness.md`: layout and native-input proof boundaries.
- `docs/knowledge/features/development-verification.md`, `docs/recorded-tests.md`, `docs/client-replay-migration.md`: validation ownership and preserved replay/live assertions.

## Context
Migrate the existing side-action fixture to daemon-built facts without production or visual changes. This is one local input-contract migration; the three existing scenarios prove its sizing and action behavior. Reuse merged #2210 and the family’s accepted identity patterns. Remote feature-branch audit found no overlap with the owned spec. No ADR is needed.

## Design
Replace module-wide responder state with a fresh local fixture per scenario. Seed an explicit conversation summary/current session, epoch and empty opening window; select canonical mode and complete-thread capabilities. Observe the opening catch-up and let the publisher return correlated data/final certificates.

Capture outbound sends and author delivered user items using the actual public device ID and outbound message ID. Supply timestamps and explicit attachment IDs/filenames. Author distinct finished assistant facts, with increasing item IDs/orders and thread versions. Each submitted message must reach its exact supplied read row before proceeding, so a local echo cannot satisfy acceptance.

Keep fixture helpers in this spec. Add the independent active assistant stream as an authored item only after the attached send’s exact finished reply has rendered without a cursor. Author the queued user fact and standalone attachment-offer fact directly. Preserve dequeue observation, all layout assertions, original timeouts, prior different clipboard value, trusted Copy input, consecutive-frame focus/hover/geometry readiness and its evidence attachment.

## State + concurrency model
Only per-test identity/version counters and outbound observations change. Existing launch fixture owns Electron, socket and listener teardown. No new production state or async tasks.

## State transitions and identity reuse
| Event | Mounted coverage |
| --- | --- |
| Opening and correlated empty catch-up | all three scenarios, before first submission |
| Repeated submissions, including duplicate short text | sizing/neighbour-gap scenario; exact distinct accepted read rows |
| Completed attached send before independent active stream | side copy/row cap scenario; exact assistant text and cursor absence precede partial text/cursor presence |
| Upload completion retains attachment identity and row focus | side copy/row cap scenario |
| Queued fact then trusted drop command | side copy/row cap scenario; geometry and exact outbound queue handle |
| Standalone attachment offer | side copy/row cap scenario; explicit attachment identity and unchanged chrome |

## Error handling
Retain public identity failure as a fixture error. Canonical publisher enforces scope, version, order and revision ownership. No new production failure modes; no legacy content or history aliases in the owned spec.

## Testing strategy
- Test first: select canonical mode against the old responder and observe rejection of legacy content in the existing first scenario, then migrate inputs.
- Run all three owned scenarios on Linux with retries zero and the configured clipboard project/native prerequisite.
- After final main merge, run pre-verify with canonical publisher units, application/client typechecks, a scratch focused TypeScript project including this spec/imported helpers/preload declarations, and build. Prepare Node checks before Electron-native checks.
- Preserve all original product assertions and audit the final diff. Reuse the later dispatcher/verifier’s exact-candidate complete configured application/captured-client gate once; that gate remains required and pending. No new live proof; macOS is outside this Linux ticket’s verification scope.

## Open Questions
None. The merged publisher supplies every required authored content path without shared-harness changes.

## Scope check
Forecast about 240 written lines including plan/evidence, zero production files, zero new exported types/components/stores, three local launch consumers, four acceptance criteria and zero new production reject branches. The fixture and its only consuming spec remain together; all numeric ceilings hold.
