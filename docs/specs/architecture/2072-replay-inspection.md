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
