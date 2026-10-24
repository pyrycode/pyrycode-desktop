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
- Preserve all original product assertions and audit the final diff. Reuse the dispatcher/verifier’s exact-candidate complete configured application/captured-client gate once; the accepted results below now satisfy that requirement. No new live proof; macOS is outside this Linux ticket’s verification scope.

## Open Questions
None. The merged publisher supplies every required authored content path without shared-harness changes.

## Scope check
Forecast about 240 written lines including plan/evidence, zero production files, zero new exported types/components/stores, three local launch consumers, four acceptance criteria and zero new production reject branches. The fixture and its only consuming spec remain together; all numeric ceilings hold.

## Builder verification — Linux x86_64, 2026-10-24
Tested implementation `b58259bfd5c7c296570bc6f872a57906cb120826`, containing main `eafa6ce94837`. Normal build provenance records that revision with `sourceDirty: false`; the following commit records evidence only.

- Test-first canonical selection against the old responder rejected `canonical unsupported frame: message`: 2 executed, 1 passed native prerequisite, 1 failed owned scenario, 0 skipped, retries zero. Retained failure: `/tmp/builder-2264/red.json`, `red.log`, `red-results/`. This control is not acceptance.
- Final command: `PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/builder-2264/final.json npx playwright test e2e/message-side-actions.spec.ts --retries 0 --reporter list,json --output /tmp/builder-2264/final-results`. All three original owned scenarios and the native protected-writer/keyboard/event-loop prerequisite executed/passed: **4 executed, 4 passed, 0 failed/skipped/flaky**, retries zero, no global errors. Original clipboard serialization and prerequisite were retained. Started `2026-10-24T19:34:44.646Z`, duration 41.579 seconds.
- `stream-copy-readiness` remains attached to the third case: consecutive button/scroll observations match with focus and hover true. The unchanged trusted-click receipt and exact OS clipboard assertion passed after the earlier different-value control.
- Final pre-verify: **5/5 checks passed**, including application typecheck and canonical publisher units **17 executed/passed, 0 failed/skipped**. Evidence: `/tmp/builder-2264/pre-verify.log`, `build/dispatcher-tests/unit-7hp364if`. `npm run typecheck:client-tests`, focused `npx tsc --noEmit -p /tmp/builder-2264/tsconfig.json` (owned spec, imported helpers and preload declarations), and `npm run build` passed. Node preparation completed before final Electron preparation and mounted execution; logs remain in `/tmp/builder-2264/`.
- TypeScript assertion audit preserves all **98 original non-dequeue assertion expressions** unchanged. The original dequeue count assertion now reads per-test captured requests and additionally checks the exact conversation/queue handle. `/tmp/builder-2264/assertion-audit.log`. Source audit finds no legacy content frame types, compatibility publisher or history aliases in the owned spec.
- Final report SHA-256: `cf546183397542c70f72f36e019564d79aedcd01681e01d8ffb637e147efcd21`; final list log: `aaaa2b7fc1510215cb65478e6a1293ef8af7e604f441e837538e1607420a2bd7`; pre-verify log: `513e3d4a7989311721023ed7143aa1af8eeea5503cd3ab00967c4761dcc0ff79`.
- The dispatcher/verifier’s matching complete configured application/captured-client gate **passed** at `5e3b01e33ace9147463dd8da2422e5fcc9f724cc`: 542 executed/passed, 0 failed, 4 skipped, zero retries/flaky. The accepted verifier confirms all three owned cases, canonical activation/reconnect, captured history, protected storage/native prerequisites and all 29 captured-client cases passed. See the accepted evidence below. Original live-only assertions remain unchanged; no fresh provider or physical-effect proof is claimed. macOS is outside this Linux ticket’s verification scope.

Final scope: approximately 150 added lines across the owned spec and plan, zero production files or new exports; all ceilings remain satisfied.

## Accepted verifier evidence — Linux x86_64, 2026-10-24

The [accepted verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2275#issuecomment-6388813234)
reviews clean candidate `5e3b01e33ace9147463dd8da2422e5fcc9f724cc`; its only change
after builder implementation `b58259bf` is this plan's original evidence record.
The complete gate's three owned cases and native protected-writer/keyboard/event-loop
prerequisite are present and passed, with the original clipboard serialization.
All 29 captured exchanges completed with zero remaining requests and no reported
mismatch. Four skips are two macOS badge cases, macOS window reopen and the existing
system-prompt Reset fixme. None counts as passed.

Dispatcher unit gate 4 records 10,045 executed/passed, 0 failed, 3 skipped in the
supplied JUnit report; this counted total takes precedence over the verdict prose's
10,144. Typechecks/build and native preparation passed. The
[durable evidence record](../../knowledge/features/development-verification-replay-validation.md#canonical-side-action-validation)
retains the full counts and barriers. This supersedes the earlier pending-gate
handoff without rerunning tests. Combined family acceptance remains with #2212.
