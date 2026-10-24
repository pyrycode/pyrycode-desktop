# Send and queue migration: integrated acceptance

## Files read
- `CLAUDE.md`, `docs/knowledge/INDEX.md`: repository ownership and verification boundaries.
- `docs/knowledge/features/development-verification.md` → Source and contract checks: canonical facts, independent host publishers and correlated query certificates.
- `docs/knowledge/features/development-verification-replay-validation.md` and its canonical publisher, queue-settlement and lifecycle-diagnostics topics: retained child counts, build identities, historical failures and exclusions.
- `docs/specs/architecture/2248-send-and-stream.md` → completed verifier evidence: distinguish focused proof from the configured gate and use report counts over prose aggregates.
- `e2e/fixtures/threadPublisher.ts` → `selectThreadPublisher`: canonical/native modes bypass `createScriptedThread`; compatibility remains for other cohorts.
- `e2e/fixtures/queueSettlementThread.ts` → `createQueueSettlementThread`: authored canonical queries with intentional native duplicate/revision probes.
- `e2e/fixtures/queueTurnEvidence.ts` → `createQueueTurnEvidence`: preserve canonical `turn_end`, marker order and exactly-once completion checks.
- `package.json`, `tsconfig.client-tests.json`, `playwright.config.ts`: application/client checks, omitted fake-spec compiler coverage and unchanged native-writer/clipboard/parallel configuration.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`: replay provenance, strict exchange completion, genuine local native prerequisites and live-only exclusions.

## Change
Record one integrated acceptance result for the existing 12-spec send/queue/offline cohort. No production, fixture, scenario, assertion, timeout or skip change is planned. Short-plan form applies because this evidence-only change adds no type, state or failure mode. There is no visible design change or ADR requirement.

The initial candidate is main `d86f547c0a7787917ecb1355c0ae1c12fceffd38`, containing all eight merged slices:

| Slice | Merge | Existing scenario coverage |
| --- | --- | --- |
| #2248 / PR #2252 | `b7c343eb` | `send-and-stream.spec.ts` |
| #2249 / PR #2253 | `257fbda1` | `live-user-receipts.spec.ts` |
| #2250 / PR #2257 | `c5d12375` | `user-whitespace.spec.ts` |
| #2254 / PR #2260 | `a040d524` | `queue-delivery-evidence.spec.ts`, `queued-own-settlement.spec.ts` |
| #2255 / PR #2261 | `f25c78cc` | `status-icon-local-send.spec.ts` |
| #2256 / PR #2262 | `eafa6ce9` | `message-lifecycle-diagnostics.spec.ts` |
| #2221 / PR #2251 | `d192a094` | `queued-send-now.spec.ts`, `queued-backlog-interrupt.spec.ts` |
| #2222 / PR #2258 | `d86f547c` | `disconnected-message-delivery.spec.ts`, `offline-conversation-actions.spec.ts`, `offline-held-responses.spec.ts` |

All paths in the coverage column are under `e2e/`. Infrastructure #2210 / PR #2218 is merged at `928f28fe`; #2219/#2220 are replacement history. Scope is one useful combined proof, approximately 100 written lines, zero production files/new exports/consumer updates/reject branches and three criteria. The remote-branch overlap check inspected 47 branches and found no overlap with this plan. Recount before commit satisfies every builder ceiling.

Preserve explicit accepted-user identities, acceptance versus transport write, queued order/status, disconnected drafts, send-now/drop/interrupt commands, no duplicate delivery and positive processing/publication barriers. Reconnect and older-page replies remain correlated canonical facts on each host. Native exact-wire controls remain intentional; they must not be forced through strict publisher mutation. No legacy content/history alias may supply cohort content. Compatibility for other cohorts and shared real/replay assertions remain intact.

## Testing strategy
- After the final main merge, install dependencies and run pre-verify with `--test-file e2e/fixtures/canonicalThread.test.ts`, application/client-test typechecks, a scratch focused TypeScript configuration including all 12 cohort specs, imported helpers, publisher/selector units, preload and wasm declarations, and `npm run build`. Retain Linux candidate identity, commands, counts and artifacts. Complete Node-native work before any Electron-native preparation.
- The dispatcher/verifier owns the complete normal configured gate: units and application/client checks, normal-profile build and complete configured `npm run e2e` (or its equivalent configured Playwright stage after build), including default captured-client replay, native writer and protected-storage prerequisites. Reuse its matching artifacts once; do not duplicate focused/full executions just to generate a report. No tests are added or changed here, so no new red/green cycle is appropriate.
- The verifier must retain executed revision/dirty/profile and output hashes, Linux, executed/passed/failed/skipped counts, retry indices, skip reasons and artifact references; inspect every cohort case plus replay/native prerequisites. Child-focused passes alone never establish combined acceptance. #2222's accepted stage `14e3a0b0a9eee9968f143abbe091231b7b450cf22360f9afa71ef3fdefeb6a6d` at `0af2e04f` records 10045 units passed/3 skipped and 542 application tests passed/4 skipped; it is retained child evidence, not a fresh #2211 pass. Prefer counted reports over the larger historical prose totals.
- Historical failures remain failed. Unrelated failures stay bounded separately; #2153, #2191 and #2169 are not dependencies absent a demonstrated causal prerequisite. Original security checks, live-only assertions and replay exclusions remain binding. This migration adds no fresh provider/daemon, encryption or physical-effect claim and requires no new live capture. macOS is outside this Linux ticket's verification scope.

## Documentation handoff
Pending for the documentation stage:
> Record the combined candidate, counted Linux acceptance and links to retained child evidence in the owning replay-validation topic reached from `docs/knowledge/features/development-verification-replay-validation.md`. Reuse existing child documentation. Preserve exclusions and the proof boundaries documented in `docs/recorded-tests.md` and `docs/client-replay-migration.md`; no API or wire-reference change is required.

Use the existing canonical publisher, queue-settlement and lifecycle-diagnostics sections linked by that index; retain original child evidence and historical failures. Complete this synthesis after the matching #2211 verifier gate. Builder completion establishes the reviewable integration/evidence handoff, not a claim that the pending gate already passed.
