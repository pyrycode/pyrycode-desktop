# Canonical queue action scenarios

## Files read
- `e2e/queued-backlog-interrupt.spec.ts` → backlog/drop/interrupt case: retain mounted product assertions and captured requests.
- `e2e/queued-send-now.spec.ts` → geometry and send-now cases: preserve all input, layout and processing barriers.
- `e2e/fixtures/canonicalThread.ts` → `createCanonicalThread`: authored updates, exact revision ownership and correlated query certificates.
- `e2e/fixtures/threadPublisher.ts` → `selectThreadPublisher`: canonical selection bypasses the legacy adapter.
- `e2e/canonical-thread.spec.ts` → canonical opening example and actual catch-up assertions.
- `e2e/thread-activation.spec.ts` → authenticated `deviceIdentity` and queue content/action handle shape.
- `src/shared/wire/thread.ts` → `ThreadItem`, `ThreadUpdate`: canonical facts and revision contracts.
- `src/renderer/src/screens/conversation/threadItemPresentation.ts` → `presentation`: supported user statuses and content.
- `docs/knowledge/features/thread-runtime.md`, `e2e-harness.md`, `development-verification.md`: explicit sessions/acceptance and positive processing barriers.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`: configured replay retains native prerequisites and original live-only proof boundaries.
- Root `CLAUDE.md` and `docs/knowledge/INDEX.md`: repository conventions and owning topics.

## Context
Migrate the existing queue-action acceptance surface as one test-fixture adoption, with no product behavior or visual changes. The merged prerequisite is `928f28fe`. Existing send-now, drop and interrupt behavior is reused. No new dependency or ADR is needed.

## Design
Both specs select `threadMode: 'canonical'` with one `createCanonicalThread` per launch, an explicit current session, epoch and opening version. Capture actual outgoing thread queries and reject legacy history requests in assertions. Opening and later content use authored `ThreadItem` facts; the publisher supplies correlated data and separate final certificates.

Real composer sends retain their captured message IDs. Read the public authenticated device identity through `window.pyry.deviceIdentity()`, then explicitly publish accepted own user items with both identity fields. Queue item IDs/orders differ from `content.queued_msg_id` action handles. Publish queued, dropped (`shown: false`) and delivered revisions with increasing versions and exact base revisions. Keep unrelated delivered/queued items intact. Deliver twice using a later authoritative revision of the same identity, then an assistant-content barrier before checking uniqueness.

Geometry seeds an assistant item and two queued items directly. Keep the original width, hover, wrapping, opacity and keyboard assertions. Session-settings replies remain correlated with explicit envelope session provenance and conversation ownership; retain mid-turn input and context reading. Turn-state pushes are explicitly scoped to that session. Commands themselves produce no acceptance or settling facts.

No overlapping in-flight branches touch the two owned files at planning time. Scope: about 350–450 written lines including plan/evidence; zero production files, exported surfaces or changed consumer contracts, five acceptance criteria and no new reject state machine. All edits stay in the two owned specs and this plan.

## State + concurrency model
Only test-owned publisher state changes. Versions advance in test order after positive rendered/captured barriers. Existing fixture teardown owns Electron, relay and subscriptions; no new long-lived tasks or runtime state.

## State transitions and identity reuse
| Event | Mounted coverage |
| --- | --- |
| Composer send accepted with authenticated device/message identity | backlog case and Send now case |
| Own queued item replaces local echo; unmatched item remains separate | backlog case |
| Drop click emits once, row waits for authoritative hidden revision | backlog case |
| Idle → thinking → interrupt click → idle, with controls retained after click | backlog case |
| Send-now click emits once without dequeue/additional send | Send now case |
| Queued → delivered under same item ID; repeated delivery stays one row | Send now case, followed by assistant barrier |
| Both widths and repeated hover/focus preserve geometry | geometry case |

## Error handling
Preserve existing failure controls and timeouts. Identity failure fails setup explicitly; publisher rejects invalid epoch/version/revision ownership and unsupported legacy content. No production failure mode changes.

## Testing strategy
- First select canonical mode with existing legacy content and observe the owned scenario fail on unsupported legacy input; then migrate its facts.
- Run all three owned mounted cases on Linux with `--retries 0`; retain all existing product assertions and strengthen non-optimistic/identity checks.
- Run applicable publisher fixture units through pre-verify, `npm run typecheck`, `npm run typecheck:client-tests`, and focused TypeScript checking with a scratch config including both specs and their imported helpers.
- After final main merge, run pre-verify and `npm run build`. Record executed revision, OS and counts here.
- The dispatcher owns the normal complete configured application gate, including captured-client replay; do not duplicate that suite. These synthetic tests add no fresh provider, encryption or physical-effect proof. macOS is outside verification scope.

## Open Questions
None: use the merged canonical publisher and existing typed bridge.
