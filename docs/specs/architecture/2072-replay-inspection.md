## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md` and its live-test-diagnosis topic: test boundaries and native-addon prerequisite.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`: preserve recorded contracts, causal checkpoints and launch guard.
- `e2e/fixtures/mainProcessRead.ts` → `readMainProcess`, `isTransientContextLoss`: existing sentinel and polling contract.
- `e2e/fixtures/replayNativeStorage.ts` and its tests → `probeReplayNativeStorage`: real in-memory addon probe, sanitized rebuild diagnostic.
- `e2e/fixtures/historyQueryEvidence.ts` and its tests → `installHistoryQueryEvidence`: lost acknowledgements require confirmed identity, not blind installation retries.
- `e2e/real-daemon-history-on-open.spec.ts` → `mainRead`: polling already exists but cannot restore inspector liveness.
- `e2e/fixtures/realDaemon.ts` → `withIsolatedElectronApp`; `clientScenario.ts` → replay open hook: one prerequisite check per opened process, including relaunch.
- Installed Playwright `coreBundle.js` → `CRExecutionContext.evaluateWithArguments`, Electron dispatcher: main evaluation unconditionally requests `awaitPromise: true`, and rewrites protocol errors as destroyed contexts.

## Context

Both #2069 failures at `340f6a961a` occur after profile relaunch: thread loses the native probe acknowledgement (6 exchange requests remain), and history exhausts inspection polling (14 remain). Both pass unchanged at two workers/retries zero on rerun (0 remain). #2068 fails at the same history read. Original JSON reports and downloaded #2069 verifier bundle were inspected before editing either scenario.

Unchanged `5c0793c7` reproduction `/tmp/builder-2072/diagnostic-2.log` captures six consecutive `Runtime.callFunctionOn: Promise was collected` failures at `__threadHistoryAsks`. A same-process control in `diagnostic-3.log` shows even a synchronous constant fails with awaitPromise enabled, while the original history read succeeds with awaitPromise disabled. `diagnostic-4.log` rejects scheduling a Node turn as a recovery. These establish inspector await-promise liveness loss, not missing history, stale observer identity or strict replay drift. The original occurrences did not retain raw inspector errors; the reproduction establishes their mechanism at the identical boundary.

## Design

Add one synchronous inspection function beside the existing replay-native probe, consumed only by that prerequisite and history's `mainRead`. Use Playwright's existing local Electron main inspector session with `Runtime.evaluate`, `includeCommandLineAPI: true`, `returnByValue: true`, and `awaitPromise: false`. Serialize only the client-owned synchronous callback's source, calling it with `require('electron')`. No daemon values enter the expression. This deliberately bypasses the broken await path, rather than adding retries to it. The internal Playwright session access is isolated here; the repository pins Playwright in its lockfile. No application API or caller-wide migration.

Return the existing `NOT_YET_AVAILABLE` sentinel only for recognized transient inspection failures; propagate unrelated transport errors. JavaScript exceptions and an unexpected promise result fail explicitly. Primitive false/undefined/null and empty arrays remain valid observations. Native prerequisite polling retains a five-second bound and the existing rebuild diagnostic for a valid false probe. History retains its original five-second polling and every scenario assertion.

Cleaner-shape check: existing public evaluate retries cannot repair the demonstrated persistent loss; public evaluateHandle also uses the same unconditional awaitPromise path. A new IPC/preload bridge or repository-wide evaluator replacement would expand this ticket unnecessarily. Use one small scoped synchronous adapter.

Overlap: remote `feature/2026` edits legacy history branches; no required dependency. Keep the local change confined to `mainRead` and its import. Its other changes and assertions remain untouched.

Size re-count: one deliverable, about 350–450 written lines including plan/evidence and tests, one new exported function, two consumer sites, four acceptance behaviors, at most five failure branches; within every builder ceiling.

## State + concurrency model

No application state, subscriptions or background jobs are added. Each inspection addresses the session owned by its current ElectronApplication; no inspector/session handle is cached across relaunch. The synchronous read runs once per attempt. Existing observer installation and identity checks remain unchanged.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| Relaunch with same profile/new inspector session | Both original replay scenarios; synchronous-inspection unit verifies two app/session identities. |
| Lost inspection followed by valid false/empty result | Synchronous inspection and native prerequisite units; false must still reject the addon. |
| Persistent inspection loss | Native prerequisite fake-timer unit reaches the existing five-second bound. |
| Lost observer installation acknowledgement/repeated install | Existing `historyQueryEvidence.test.ts` retains exactly one listener and collected requests. |
| Fatal transport/JavaScript failure | Synchronous inspection units fail immediately without retrying mutations. |

## Error handling

Inspector protocol failures retain their original Error when propagated. Classify only known context/collected-promise loss as unavailable; no raw protocol response, expression, native loader error, credential or daemon payload is logged. Callback exceptions receive a static inspection diagnostic; valid addon load/open/query failure continues to produce the existing rebuild instruction.

## Testing strategy

- Test first with an inspector fake that rejects awaitPromise inspection but returns actual callback results for synchronous inspection; it must fail against the original evaluate-only probe.
- Cover false/empty values, unavailable versus valid undefined, persistent loss, fatal errors, callback exceptions, promise rejection, current-session identity and exact synchronous options.
- Retain and run existing addon-probe and observer-identity regressions.
- Run both original cases in five consecutive focused Linux runs, two workers, retries zero (10 executions), then the complete guarded recorded suite. Inspect exchange attachments for zero remaining requests and the guard for zero forbidden launches. Existing system-prompt-reset fixme remains explicit.
- Final main merge, pre-verify (full units/typecheck) and build; verifier owns configured full application gate. No live-provider or second-OS acceptance is claimed.

## Open Questions

None. Record exact controlled regression and final counted evidence below before handoff.

## Validation evidence

Linux x64, 2026-10-16; fixture/scenario implementation `db6c6bb9`, main `5c0793c77057`. The first paired run started with the same uncommitted implementation; the only subsequent scenario/fixture edit was the explanatory `mainRead` comment. The final unit table explicitly wraps array values as test arguments; `targeted-final.log` confirms all 23 targeted cases pass. No captured fixture bytes or scenario assertions changed.

- Controlled red: `/tmp/builder-2072/red-unit.log`, 6 executed, 5 passed, 1 failed, 0 skipped. `checks storage when the inspector loses every awaitPromise acknowledgement` fails with the original destroyed-context error. Repaired targeted run: `green-unit.log`, 23 executed/passed, 0 failed/skipped, including all 19 native/synchronous-inspection cases and all 4 observer-registration cases.
- Five consecutive guarded runs: `focused-1.json` through `focused-5.json` and corresponding `.log` files under `/tmp/builder-2072/`. Each actually used two workers with `--fully-parallel --workers 2 --retries 0`: 2 executed/passed, 0 failed/skipped/flaky/retries. Aggregate: 10 executed/passed. Every guard reports zero forbidden launches. Every thread exchange matched 45 requests/emitted 378 frames; every history exchange matched 32/emitted 63; all ten have zero remaining requests.
- Capture provenance remains Desktop `00ec821f9380b00cf2dfc0dd4817ee15584106a5`, daemon `58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`, daemon binary SHA256 `5f5b3b9ce42eda74024637f4929dd720d36c1226ce6e370eb62fbe9e6b22f7c0`. These establish offline recorded behavior, not current provider or physical effects. macOS is outside this Linux ticket's verification scope.
- Lifecycle coverage cross-check: `uses the new process session when a profile is relaunched`; `distinguishes unavailable inspection from a value`; `bounds persistent inspection loss without claiming the addon is unavailable`; `still rejects a valid false addon result after an unavailable inspection`; `propagates unrelated fatal errors unchanged and once`; and existing `retains one listener and all observations when installation is ...` (acknowledged/lost before/lost after execution).
- The first pre-verify attempt used the Electron SQLite ABI and failed 167 native-storage tests (9,151 passed, 3 skipped). A sanitized direct Node probe confirmed `NODE_MODULE_VERSION` mismatch (Node ABI 141). This is retained in `pre-verify.log`; final Node-ABI gate evidence follows after replay, so the incompatible runtimes do not rebuild the addon while the other is executing.
- Complete guarded `npm run e2e:recorded -- --reporter=list,json`: `recorded-full.log` / `recorded-full.json`, original one-worker configuration, retries zero; 29 executed/passed, 0 failed/flaky, 1 existing fixme (`real claude picks up a saved channel system prompt at Reset session`). All 29 exchange attachments have zero remaining requests, including both repaired cases; zero forbidden launches. No provider credential or live process is needed or claimed.
- Final main fetch/merge remained at `5c0793c77057`. After `npm run rebuild:node`, `pre-verify-final.log` records all 5 gates passing: 403 unit files, 9,318 executed/passed, 0 failed, 3 existing skips. `build-verified.log`, `client-typecheck.log` and `docs-check.log` record passing build, client-test typecheck and docs guard. The addon is restored for Electron after Node verification; the incompatible initial unit run remains explicitly failed above.
- Final scope: zero application production files, one new exported fixture function, two consumer sites and four files including this plan; below every sizing ceiling. Observer installation, mutations, original scenario assertions and recordings remain unchanged. The verifier owns the configured complete application gate.
