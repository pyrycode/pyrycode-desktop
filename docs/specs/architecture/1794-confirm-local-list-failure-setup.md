# Confirm the local-list failure setup (#1794)

## Files read
- `CLAUDE.md` and `docs/knowledge/INDEX.md`: test-first conventions and owning topics.
- `docs/knowledge/features/e2e-harness.md` → Tolerating a transient inspection-context loss on reads: reads may retry; controls need affirmative evidence before resend.
- `docs/knowledge/features/development-verification.md` → What each test tier proves: deterministic regressions and mounted fake-transport proof are distinct.
- `docs/knowledge/features/chat-history.md` → Results and failure preservation: unreadable lists remain absent with a host-local notice; pairing remains intact.
- `e2e/chat-history-recording.spec.ts` → local list read failures stay beside the saved host: the failed setup and existing product assertions.
- `e2e/fixtures/mainProcessRead.ts` → readMainProcess/isTransientContextLoss: reuse discrimination for read-back only.
- `e2e/fixtures/mainProcessRead.test.ts` → evaluator: deterministic inspection failure testing pattern.
- `e2e/fixtures/launchPairedApp.ts` → LaunchControl/onLaunched: runs after launch, before firstWindow and pairing drive, but is not a guarantee against inspection loss.
- `src/main/chatHistoryHandler.ts` → chat-history registration: preserve the real handler for operations other than readList.
- `e2e/fixtures/desktopIsolation.ts` and `electronLaunch.ts`: Linux shown-window capture and sandbox launch requirements.

## Context
The original failure log `/work/Projects/pyrycode-desktop-agents/logs/verifier-gate_#1765_6.log` reports inspection-context destruction at the handler-installation evaluation, before any UI assertion. Its launch-fate reports runningAtOutcome true, exitCode 0, signal null and no teardown failures. `/work/Projects/pyrycode-desktop-agents/logs/2026-10-05T21-56-56-361Z_verifier-gate-rerun_#1765.log` records a retry-0 pass in 1666 ms. These establish an ambiguous mutation acknowledgement, not renderer navigation, an app crash, or whether the callback ran. The fix addresses that setup ambiguity; the underlying reason Electron lost the inspection context is unproven.

One deliverable: reliable, confirmed test-side storage-error setup. Estimated total written work ~330 lines including deterministic tests and this plan; zero production files, zero new exported types/components/stores, one consumer, four observable acceptance criteria, fewer than ten reject branches. #1778 overlaps this spec only in separate copy-button assertions; build through with local edits.

## Design
Add the single-consumer `e2e/fixtures/localListFailure.ts` helper `installUnreadableLocalList(app)` returning content-free installation/inspection/context-loss counts. Keep the setup after the fake endpoints close; moving it to onLaunched alone would not resolve ambiguous acknowledgement.

The installation evaluation synchronously captures the existing chat-history handler, installs a wrapper returning unreadable for readList only, and records the wrapper identity in main-process test state. All other operations delegate to the captured handler. A guard verifies an existing marker still matches the registered handler and avoids a second replacement if a late evaluation runs.

Always inspect the actual registered handler against the marker after installation. Only an explicit absent observation after a transient installation error permits one further guarded installation evaluation. A lost acknowledgement with an installed wrapper requires no resend. Inspect at most three times per attempt and install at most twice. An inconclusive read never authorizes mutation or passes setup. Use readMainProcess only for the read-back callback, never for installation.

Before reload/assertions, invoke readList through the real renderer IPC bridge for the saved host and require the exact unreadable result. Attach setup counters to the Playwright result. Retain the original one-host, one-notice/copy, zero-row/thread assertions and 800-pixel capture; strengthen the notice association to that host's content. No pairing edits, production changes, new dependencies, sleeps or timeout/retry increases.

## State + concurrency model
Only a main-process test marker holding the installed wrapper is added; no production store or asynchronous background task. Registration and marker publication are synchronous in one evaluation. The marker guard handles delayed execution without double replacement. The app's existing fixture teardown disposes of the marker. Fatal errors stop the test before reload.

## Error handling
Transient installation errors trigger bounded read-back. Fatal installation/read errors and non-Error throws propagate unchanged. Missing original handler, marker/registration mismatch, unconfirmed success, exhausted reads or two unsuccessful installations fail setup. No external defect is established by the original logs.

## Testing strategy
- Vitest drives the actual callbacks with an in-memory IPC fake: successful setup, loss before effect, loss after effect, lost inspection, permanent absent/context-loss failure, late guarded execution, and fatal/non-Error errors. Check replacement counts and preservation of non-list operations.
- Watch the new regression fail before implementation; then run the helper tests.
- Run the named Playwright scenario ten times with retries disabled and the complete recording spec once. Record executed/passed/failed/skipped counts and logs under `/tmp/builder-1794/`.
- After final main merge, run the pre-verify check and npm run build. Dispatcher owns the full default tier; no real-Claude tests change.

## Open Questions
None. No design or documentation change is requested; the documentation stage may fold the bounded confirmation lesson into the harness overview.
