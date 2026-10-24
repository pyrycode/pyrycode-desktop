# Canonical background task outcomes and summaries

## Files read
- `e2e/background-task-status-summary.spec.ts` → owned mounted scenario, `panelFor` and synthetic task literals: preserve trusted interactions and outcome/refresh assertions.
- `e2e/fixtures/canonicalThread.ts` → `createCanonicalThread`: retained facts, exact-base updates, correlated queries and separate final certificates.
- `e2e/fixtures/launchPairedApp.ts`, `e2e/canonical-thread.spec.ts` → canonical selection and actual opening-request observation.
- `src/shared/wire/thread.ts` → `ThreadItem`, `ThreadUpdate`: explicit identity, lifecycle, order and revision contracts.
- `src/renderer/src/screens/conversation/threadTaskPresentation.ts` → `threadTaskPresentations`: saved linked description/report, terminal tags and shown membership.
- `src/renderer/src/screens/conversation/threadItemPresentation.ts` → `taskLinked`: matching task/tool identities.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/e2e-harness.md`, `docs/knowledge/features/development-verification.md`, `docs/knowledge/features/development-verification-evidence-that-cannot-pass-too-early.md` → mounted proof, native preparation order and positive barriers.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`, `playwright.config.ts`, `tsconfig.client-tests.json` → configured gate ownership, preserved replay/live boundaries and focused TypeScript coverage.
- `docs/specs/architecture/2255-canonical-local-send-status.md` and implementation `ecb1e40d` → nearest analogue: 59 added implementation lines, 32 deleted, plus plan/evidence.

## Context
Migrate one mounted task-outcome lifecycle from #2227, under implementation family #2213 and feature root #2209. Keep scope to the owned spec and plan. Reuse merged canonical publishing; no production, visual or documentation changes and no ADR. Remote feature-branch audit found no overlap in the owned spec. #2228 retains its shared outcome work; #2153/#2191 remain separate repairs.

## Design
Select `{ threadMode: 'canonical', thread }` with complete thread capability. Seed the conversation summary/current-session identity, epoch, version 1 and two shown, active `tool_call` facts with unique orders, explicit session/agent attribution and matching task/tool links and saved descriptions. Capture outgoing envelopes without supplying content. Observe the actual conversation's version-zero opening `thread_catch_up` and positive task content before claiming canonical activation.

Keep the existing drawer interaction and Running/no-summary assertions. Publish advancing `thread_item_changed` versions with exact base revisions: build becomes inactive/finished with its saved report, relay inactive/failed with its distinct report. Preserve both identities, links, descriptions and reports. Refresh the build description at the same item/task identity, explicitly retaining terminal status, inactivity and report. Wait for RELISTED before checking retained outcomes/summaries and absent pill.

Hide the relay through a newer exact-base `shown: false` revision. Wait for `Finished · 1` before checking its absent row, while the build retains RELISTED, Completed and its summary. No roster omission, legacy content or history aliases supply facts. Keep compatibility available to unmigrated siblings.

## State + concurrency model
Only fixture-owned canonical facts and the existing application stores change. Updates ride one ordered transport; publisher validates ownership and retains each revision for queries. Existing launcher owns teardown. No new async task, subscription or production state.

## State transitions and identity reuse
All rows are covered by `a completed and a failed task move to Finished with their own tags and summaries` in the owned spec.

| Event | Proof |
| --- | --- |
| Opening query, two active facts | Actual version-zero catch-up plus two positive task descriptions, Running · 2 and no summaries. |
| Build and relay terminal revisions | Finished · 2, respective Completed/Failed tags and distinct summaries. |
| Description refresh reuses build item/task identity | RELISTED processing barrier, retained tags/reports, no running pill and still two rows. |
| Hidden relay revision reuses its identity | Finished · 1 barrier, relay absent and refreshed completed build intact. |

## Error handling
Retain existing fixture failure controls/timeouts. Canonical publisher rejects invalid revisions or unsupported legacy authoring. No new production failure mode or rejection branch.

## Testing strategy
- Add an opening-content oracle first and observe it fail against the legacy fixture, then migrate the publishers.
- Run pre-verify with the canonical publisher unit file, app/client-test typechecks, focused TypeScript covering this spec and imported helpers, and build after final main merge. Finish Node checks before Electron preparation.
- Run the owned mounted spec with retries zero on Linux, retaining the configured native-writer prerequisite. Record exact revision/build identity and executed/passed/failed/skipped counts.
- Dispatcher owns the complete configured application gate, including captured-client replay; verifier checks matching candidate evidence without a duplicate full-suite run for this slice. Preserve canonical activation, captured history, protected storage, native prerequisites and original live-only assertions. No fresh provider, encryption or physical-effect proof; macOS outside scope.

## Open Questions
None. No shared-file changes are needed.

## Scope check
One independently useful mounted lifecycle migration, four acceptance criteria, approximately 200 written lines including plan/evidence, zero production files, new exports, simultaneous consumer changes or production error branches. Both sketch and written plan fit every ceiling.

## Validation evidence
Linux x64, 2026-10-24. Implementation `78dca8b3`; final tested merge/build revision `588dcf964fb11c6260ba69f0a93606ae1a41aaa2`, containing main `e185d6c6bce352c877b7c7ab22287a6522e250bf` and the additive #2269 drawer migration. Compilation-time provenance is `profile: normal`, `sourceDirty: false`. This subsequent evidence-only commit changes no executable input.

- Test-first red: opening `2 tasks running` oracle failed before legacy roster publication; 2 executed, 1 passed (native prerequisite), 1 failed (owned case), 0 skipped/retries. `/tmp/builder-2272/red.{log,json}`.
- Initial migrated run: owned scenario and native prerequisite both passed; 2 executed/passed, 0 failed/skipped/retries. `/tmp/builder-2272/owned.{log,json}`.
- Final pre-verify: all 5 checks passed after the final main merge. Canonical publisher units: 17 executed/passed, 0 failed/skipped. `/tmp/builder-2272/pre-verify-final.log`, structured evidence `/tmp/builder-2272/unit-final/unit-bhr1gd73/`.
- Final `npm run typecheck`, `npm run typecheck:client-tests`, focused `npx tsc --noEmit --strict --skipLibCheck --esModuleInterop --module ESNext --moduleResolution Bundler --target ES2023 --lib ES2023,DOM,DOM.Iterable --jsx react-jsx e2e/background-task-status-summary.spec.ts src/preload/index.d.ts src/main/transport/noise-c.wasm.d.ts`, and `npm run build` passed. Logs `/tmp/builder-2272/{pre-verify-final,client-types-final,focused-types-final,build-final}.log`. Node checks finished before final Electron preparation (`electron-final.log`).
- First final-candidate mounted invocation failed the unchanged native-writer prerequisite at its existing 65-second completion poll: 1 executed/failed, 0 passed, 1 dependent owned case not run, retries zero. It had persisted 7,564/8,333 facts. Preserve `/tmp/builder-2272/owned-final.{log,json}` and complete attachments/context under `/tmp/builder-2272/failed-final-results/`. Additional symptom recorded on existing tracker #2273; no causal repair is claimed.
- Separate unchanged final-candidate invocation: `npx playwright test e2e/background-task-status-summary.spec.ts --retries=0 --reporter=list,json --output=/tmp/builder-2272/owned-final-rerun-results`; 2 executed/passed, 0 failed/skipped/retries. Both the owned task-outcome case and configured native-writer prerequisite passed. `/tmp/builder-2272/owned-final-rerun.{log,json}` and `owned-final-rerun-results/`. This pass does not erase the earlier native timing failure.

Retained build provenance: `/tmp/builder-2272/build-provenance.json`; SHA-256 manifest: `/tmp/builder-2272/build-sha256.txt`. Main bundle `4ba11a8bae93d14a3d407eb2b182513d10c13b321f759ff5551f3bb0b91d3783`, preload `0430e6aac5d4c276ae9e2d22447431b4c388c5e1bd68dbe3c7a7d9bada0d4df7`, renderer `1a4440d011695fafc6ab9b063d9723a7ff828b1517d087464fa48f8fa1238fca`.

Dispatcher/verifier retains the complete configured application gate, including captured-client replay, canonical activation, captured history, protected storage and native prerequisites. Reuse its matching candidate evidence without a duplicate complete run here. Original live-only assertions remain required; this migration establishes no fresh provider, encryption or physical-effect proof. macOS is outside this Linux ticket's verification scope. No design deviations or unresolved questions; final written scope remains below the estimate and every ceiling.
