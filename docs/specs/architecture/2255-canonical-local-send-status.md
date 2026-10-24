# Canonical local send status and icon transitions

## Files read
- `e2e/status-icon-local-send.spec.ts` → owned mounted lifecycle and ordered assertions.
- `e2e/canonical-thread.spec.ts` → canonical launcher selection and opening-query oracle.
- `e2e/live-user-receipts.spec.ts` → authenticated device identity and explicit user acceptance.
- `e2e/fixtures/canonicalThread.ts` → `createCanonicalThread`: retained facts, correlated data and separate final certificates.
- `src/shared/wire/thread.ts` → `ThreadItem`, `ThreadUpdate`: unique orders and exact-base revisions.
- `src/renderer/src/store/threadSendStore.ts` → `matches`, `settle`: device/message identity and queued lifecycle.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/e2e-harness.md`, `docs/knowledge/features/development-verification.md`, `docs/knowledge/features/development-verification-evidence-that-cannot-pass-too-early.md` → canonical authoring and positive processing barriers.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`, `playwright.config.ts`, `tsconfig.client-tests.json` → replay/native proof boundaries and focused spec typechecking.

## Context
Migrate one ordered mounted local-send lifecycle from #2220, under acceptance parent #2211 and feature root #2209. Reuse merged #2210; change only the owned spec and this plan. No visual or production change, no ADR or documentation deliverable. The remote feature-branch audit found no overlap in the owned spec.

## Design
Select `threadMode: 'canonical'` with one publisher, an explicit summary/current session, epoch, version 1 and a finished opening assistant fact. Advertise complete thread capability. Capture outbound requests without supplying legacy replies. Positively render the opening fact before asserting the actual conversation's version-zero `thread_catch_up`.

Keep the trusted composer interactions and all existing label, count, spinning/still, icon visibility and exact failure-copy assertions. Capture the first outgoing message ID and authenticated public device identity. Author two shown/active queued user facts with distinct item identities, orders and genuine queue handles: a foreign-device fact and an id-less fact. They must render as two queued rows while local feedback remains Sending. Give the foreign-device fact the captured message ID so device matching is independently necessary; give the id-less fact the own device identity so message matching is necessary.

Retire those two queued rows by exact-base hidden/inactive revisions, and add the matching own-device/message queued fact. Waiting establishes its acceptance; assert one queued row and retained authored text. Deliver that same item with its original queue handle, revising status/activity and distinct visible text. Observe delivered text before checking absence of queued rows, local feedback and spinning.

Scope thinking/idle and session-error envelopes to the explicit owning session and conversation. After idle, publish a positive assistant marker on the ordered stream before the existing absence assertions. Keep the second local send and session-failure control in their original order. No command receipt or assistant activity can settle acceptance.

## State + concurrency model
No new application state or jobs. The publisher retains authored facts synchronously; fixture teardown continues to own Electron, relay and daemon resources. All pushes traverse the existing encrypted fake transport. Versions advance for every update; item revisions use the exact retained base.

## State transitions and identity reuse
All rows are covered by the existing test `the status row reads Sending, then Waiting for Claude, then Thinking, with the icon turning throughout`.

| Event | Required oracle |
| --- | --- |
| Opening query | Canonical opening fact rendered; actual scoped catch-up observed. |
| First local submit | Sending and visible spinner before authored acceptance. |
| Foreign device / missing message identity | Two rendered queue rows; Sending retained. |
| Matching queued acceptance | Waiting and spinner; one authored queued row. |
| Same accepted item delivered | Changed delivered text before queue/feedback/spinner absence. |
| Scoped thinking then idle | Thinking/spinner, then ordered marker before still visible icon and absent label. |
| Second submit under same session | Sending/spinner reappear; scoped failure shows exact client copy before clearing feedback. |

## Error handling
Retain the session.blocked control and exact client-owned error text. No new failure mode or production rejection branch. Canonical publisher rejects invalid authoring rather than translating legacy events.

## Testing strategy
- Test-first migration oracle: add opening query/fact assertions and observe failure with the old fixture before canonical fact implementation.
- Run the owned Playwright spec on Linux with retries zero and original timeouts, including configured native prerequisite.
- Run applicable publisher/selection/send-store unit files, pre-verify, app and client-test typechecks, focused TypeScript covering the changed spec and transitive helpers, and build after final main merge.
- Reuse the dispatcher's matching normal complete configured application gate, including captured clients/native prerequisites; do not duplicate the full suite here. Record counted evidence and exact candidate revision. No new live provider, encryption or physical-effect claim. macOS is outside scope.

## Open Questions
None. Keep compatibility for unmigrated siblings; no shared helper edits are needed.

## Scope check
One mounted behaviour, four acceptance criteria, approximately 240 written lines including plan/evidence, no production files, new exported types, consumer migrations or production error branches. The written plan remains below every ceiling.

## Validation evidence
Linux x64, 2026-10-24. Implementation revision `ecb1e40d901c11c5754f88d9df63b4ce2a3306c9`, containing final main `a040d524f5ba`. Normal clean build provenance records that implementation revision and `sourceDirty: false`. This evidence-only addition changes no executable input.

- Red control: the new opening-fact assertion failed with the legacy fixture at `Canonical status thread ready`; 2 executed, 1 passed (native prerequisite), 1 failed (owned case), 0 skipped/retries. `/tmp/builder-2255/red.{log,json}` preserves the expected failure.
- Migrated owned run: 2 executed/passed, 0 failed/skipped/retries, including the named local-send case and configured native-writer prerequisite. `/tmp/builder-2255/owned.{log,json}`.
- Final clean candidate run: `npx playwright test e2e/status-icon-local-send.spec.ts --retries=0 --reporter=list,json`; 2 executed/passed, 0 failed/skipped/retries. The owned `the status row reads Sending, then Waiting for Claude, then Thinking, with the icon turning throughout` case executed and passed. `/tmp/builder-2255/owned-final.{log,json}`.
- Pre-verify: all 5 checks passed; canonical publisher units 17 executed/passed, 0 failed/skipped. `/tmp/builder-2255/pre-verify-final.log`, structured evidence under `/tmp/builder-2255/unit-final/unit-vblxfctt/`.
- Send-store units: 13 executed/passed, 0 failed/skipped; `/tmp/builder-2255/send-unit.{log,json}`. Combined applicable unit total: 30 executed/passed.
- `npm run typecheck` (pre-verify/build), `npm run typecheck:client-tests`, focused `npx tsc --noEmit --strict --skipLibCheck --esModuleInterop --module ESNext --moduleResolution Bundler --target ES2023 --lib ES2023,DOM,DOM.Iterable --jsx react-jsx e2e/status-icon-local-send.spec.ts src/preload/index.d.ts src/main/transport/noise-c.wasm.d.ts`, and `npm run build` passed. Logs: `/tmp/builder-2255/{pre-verify-final,client-types-final,focused-types,build}.log`.
- Initial redundant manual Node preparation overlapped pre-verify's own preparation, causing build-directory collisions before any unit executed. Failed logs remain at `/tmp/builder-2255/{node-native,pre-verify}.log`. Sequential pre-verify preparation succeeded; send-store units followed it, then Electron preparation succeeded before final mounted execution. No native preparation overlapped the final mounted run.

Dispatcher/verifier owns the normal complete configured application gate, including captured clients, canonical activation, captured history, protected storage and native prerequisites. Retain its matching candidate counts alongside this builder evidence; do not substitute this focused run or duplicate the complete suite. No fresh provider, encryption or physical-effect acceptance is claimed. Original replay/live boundaries remain unchanged; macOS is outside this ticket's verification scope.

Final scope: 113 written lines before evidence, plus this evidence section; comfortably below the admitted estimate and all ceilings. No implementation deviation or unresolved question.
