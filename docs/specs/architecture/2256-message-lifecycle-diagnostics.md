# Canonical message lifecycle diagnostics

## Files read
- `e2e/message-lifecycle-diagnostics.spec.ts` → owned mounted case, trusted input, stdout lifecycle collection, drop and route-refusal assertions.
- `e2e/live-user-receipts.spec.ts` → native launch with explicit canonical replies and duplicate full-item delivery.
- `e2e/fixtures/canonicalThread.ts` → authored facts, advancing versions, retained snapshots and correlated data/final replies.
- `e2e/fixtures/launchPairedApp.ts` and `threadPublisher.ts` → native bypass and fixture teardown.
- `src/main/daemonConnection.ts` → `acknowledgeThreadItem` requires matching full user facts and authenticated device identity.
- `docs/knowledge/features/development-verification.md`, `development-verification-evidence-that-cannot-pass-too-early.md` and `e2e-harness.md` → positive processing barriers and queue handles.
- Root `CLAUDE.md`, knowledge index, package/config files, `docs/recorded-tests.md` and `docs/client-replay-migration.md` → Linux checks and unchanged replay/live proof boundaries.

## Context
Replace compatibility-generated thread facts in the single diagnostics scenario with explicit daemon facts. This is one independently useful test migration, without production or visual changes. No ADR needed. No in-flight feature branch overlaps the owned spec. Estimate: approximately 220 written lines including plan/evidence, zero production files, zero exported types, one consumer and four acceptance behaviours; no new error state machine. All sizing ceilings hold.

## Design
Use `createCanonicalThread` for the opening assistant fact and query replies, with explicit current session, epoch, version and unique safe item orders. Launch in native mode and compose replies explicitly; capture outbound requests and message payloads. Require an actual version-zero opening request and rendered canonical content. Read the public device identity through preload.

Whitespace produces no send or queued diagnostic. Idle input retains exactly queued/sent diagnostics without an authored receipt. Scoped responding state and the existing Stop barrier establish running mode. Before acceptance, a rendered assistant update must leave the running lifecycle at queued/sent. Accept only an explicitly authored queued user fact matching the captured message ID and public device ID, with authoritative text and a queue handle distinct from its item ID.

Repeat the identical full user fact at advancing delivery versions directly through native transport. Resynchronize retained publisher facts/version before publishing a later assistant sentinel. After that sentinel renders, assert one unchanged queued row/item identity, real Drop control, and exactly one acknowledgment. Clicking Drop must send exactly one dequeue for the authored handle and append exactly one local cancellation record. Retain UUID, total queued records and both secret-exclusion assertions. Unknown-conversation input still traverses both typed IPC channels, yielding queued/dropped route-refused without a third send.

## State + concurrency model
Only test-local publisher facts/version, requests and stdout records are added. All frames travel through the existing fake encrypted transport and mounted app. Launcher teardown owns resources; the stdout subscription is removed in `finally`. No production state or async lifecycle changes.

## State transitions and identity reuse
All rows are covered by `idle and running composer submissions reach diagnostics, and drop is a local request`.

| Event | Required observation |
| --- | --- |
| Whitespace then idle submission | No whitespace send; exactly queued/sent for captured idle ID |
| Responding then running submission | Stop visible; assistant activity alone leaves queued/sent |
| Explicit acceptance then repeated same item/revision | One acknowledgment, unchanged authoritative queue row and handle after later rendered sentinel |
| Drop same queued message | Exactly one dequeue and one user-cancel-request, four records |
| Unknown conversation | Exactly queued/dropped route-refused, still only two sends |

## Error handling
Retain route-refused control and content-free diagnostics. Native mode bypasses only publisher duplicate authoring rejection, never app validation. No new production failures, retries or timeout changes.

## Testing strategy
First require rendered canonical opening content in the existing legacy scenario and observe the missing-fact failure. Then migrate the fixture and run the owned case with retries disabled and its native prerequisite. Run applicable publisher/lifecycle units, pre-verify, typecheck, client-test typecheck, focused TypeScript checking including the changed spec and its imported helpers, and build after final main merge. Record Linux revision and executed/passed/failed/skipped counts. Reuse the dispatcher/verifier's matching complete configured application gate including captured replay and native prerequisites; do not duplicate that full suite. macOS is outside scope.

## Open Questions
None.

## Documentation handoff
- Pending documentation stage: preserve canonical activation, captured history, protected-storage coverage and existing live-only assertions/proof boundaries in `docs/recorded-tests.md` and `docs/client-replay-migration.md`. No fresh provider, encryption or physical-effect proof is introduced; combined feature acceptance remains with #2211.
