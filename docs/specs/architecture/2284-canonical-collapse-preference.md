# Canonical collapse preference gate

## Files read
- `e2e/collapse-tool-uses-preference.spec.ts` → `tools` and all three cases: preserve the mounted preference, keyboard, geometry and relaunch assertions.
- `e2e/fixtures/canonicalThread.ts` → `createCanonicalThread`: independently owned summaries, ordered facts and correlated query certificates.
- `e2e/fixtures/launchPairedApp.ts` → `LaunchPairedAppOptions`, `LaunchControl`, `SEEDED_ROW`, `SECOND_SEEDED_ROW`: per-host canonical selection and saved-profile launch ownership.
- `e2e/fixtures/threadPublisher.ts` → `selectThreadPublisher`: canonical mode bypasses legacy translation.
- `src/shared/wire/thread.ts` → `ThreadItem`: numeric identity, explicit order, revision and session.
- `e2e/background-task-drawer.spec.ts` → `capturingFake`: observe real opening queries and reject legacy history aliases after positive content.
- `docs/knowledge/INDEX.md`, `CLAUDE.md`, `docs/knowledge/features/development-verification.md`, `docs/knowledge/features/e2e-harness.md`, `docs/knowledge/features/collapse-tool-uses-preference-store.md`: test boundaries and full-process persistence proof.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`, `playwright.config.ts`, `tsconfig.client-tests.json`, `docs/specs/architecture/2269-canonical-background-task-drawer.md`: replay/native prerequisites, focused type coverage and measured analogue.

## Change
Replace legacy `tools` frames with complete shared-wire tool facts. A local host factory accepts a conversation summary and canonical items, creates a fresh publisher with explicit current session, epoch and version, and observes outgoing envelopes without supplying content replies. Select canonical mode independently for both hosts in each width case and both launches of the persistence case, including the reused profile: six publishers across three executions. The publisher answers summaries and thread queries. No item mutations or live readings are needed; seed adjacent running Read tools with numeric IDs, unique orders, revision 1, session/agent/turn attribution and the original first/second input summaries.

After positive rendered tool barriers, assert each host received its own version-zero opening query and no legacy history alias. Preserve default collapse, immediate retained-chat and cross-host off/on behavior, mouse/Enter/Space, Settings order, joined-row geometry, full exit/relaunch explicit off and unrelated notifications remaining enabled. Preserve timeouts and fixture teardown. Put captures under this ticket's scratch directory. No production/UI/shared-helper change, new export, failure mode or ADR. No overlapping remote feature branch touches the owned spec.

One independently useful behavior slice; approximately 140 written lines including plan/evidence, zero production files, zero new exports, four local option-selection sites, two acceptance criteria and zero production reject branches. Both sketch and written plan fit the sizing ceilings.

## Testing strategy
- Test first: observe actual requests in the legacy mounted width case; after its positive tool barrier require zero legacy history aliases and record the expected failure. Retain that oracle after migration.
- Width cases cover repeated preference changes, Settings round trips and retained conversation/host identity. `explicit collapse off survives a full app relaunch` covers profile reuse after full Electron exit with a separately constructed publisher. Existing fixture teardown owns all jobs; no new lifecycle state.
- After final main merge: pre-verify with `e2e/fixtures/canonicalThread.test.ts`; applicable preference units; app and client-test typechecks; focused strict TypeScript including this spec and its imported helpers; `npm run build`.
- Run the owned Playwright spec on Linux with retries zero, retaining the configured native-writer prerequisite, exact revision/build identity and executed/passed/failed/skipped counts. Finish Node checks before Electron native preparation; never rebuild during mounted execution.
- Dispatcher/verifier owns the normal complete configured gate and matching candidate evidence, including captured replay, canonical activation, captured history, protected storage and native prerequisites. Do not duplicate a complete suite here. Existing live-only assertions/exclusions remain intact; this migration supplies no fresh provider, encryption or physical-effect proof. macOS is outside verification scope. No documentation handoff is requested.

## Revisions
2026-10-24: The initial legacy control passed because this spec does not enable the adapter's history aliases. Retain zero-alias and real scoped opening-query assertions, and strengthen the oracle to require authored item IDs 101/102 on the positively visible ordinary rows of each host. The isolated legacy control then failed at the missing 101 row after the original off/visible assertions passed. Canonical seeds reuse these numeric IDs across independently owned hosts. No production contract changes.
