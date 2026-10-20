# Trustworthy replay native prerequisite observation

## Files read
- `CLAUDE.md`, `docs/knowledge/INDEX.md`: repository and verification boundaries.
- `docs/knowledge/features/development-verification.md` → Replay native storage prerequisite / Replay inspection after profile relaunch: preserve synchronous inspection and sequential native preparation.
- `docs/recorded-tests.md` → Replay contract: guarded complete-thread selection, provenance and restoration.
- `e2e/fixtures/replayNativeStorage.ts` → `readReplayMainProcess`, `probeReplayNativeStorage`, `assertReplayNativeStorage`: optional inspector values currently reach a truthiness check.
- `e2e/fixtures/replayNativeStorage.test.ts`: existing native failure, synchronous-reader and relaunch contracts.
- `e2e/fixtures/desktopIsolation.ts` → `launchIsolatedApp`, `createLaunchFateLog`: isolated launches and awaited process retirement.
- `e2e/smoke.spec.ts`: local profile ownership and unconditional fate attachment pattern.

## Context
One deliverable: classify the replay SQLite prerequisite truthfully. The historical macOS batch remains failed; its trigger is unknown. Retrieved #2153 bundle `5fb3a102637f268ca9e008c4fbf091d34621eeb7f40d7b41ed796993ed0a299e` (digest `ec57a3b3a85353172d2fbb6cb8532d690e34de92147dd6a1201c289d46d80a8e`) under `/tmp/builder-2190/evidence-2153/`. It contains the builder log, not the raw paired-3 report. Preserve the reported 4 executed / 3 passed / 1 failed separately from new evidence; do not infer false versus absent from that report.

Sizing: approximately 300–350 written lines, zero production files, zero new exported symbols, zero consumer migrations, four observable criteria and no new state machine. No overlapping remote feature branch touches the three proposed code/test files. No ADR needed.

## Design
Keep generic synchronous reads unchanged, including valid undefined/false/zero/null/empty results and promise-result rejection. At `assertReplayNativeStorage`, only explicit `true` succeeds and explicit `false` immediately emits the existing static SQLite diagnostic. Every other observation polls within the existing five seconds/100 ms interval and ends with the existing distinct inspection-unavailable diagnostic. Fatal inspector errors still propagate immediately. No callback, SQLite operation, scenario assertion, capture matcher or transport changes.

## State + concurrency model
No new stored state or background tasks. Keep the caller-owned polling deadline. The Electron control owns a temporary profile, closes and awaits each process before relaunching the same profile, and removes it after both processes stop. Inspector sessions remain per-application and uncached.

## State transitions and identity reuse
| Event | Regression |
| --- | --- |
| Absent/non-boolean result then genuine boolean success | `waits for a conclusive boolean after an absent or non-boolean observation` |
| Persistent absent/non-boolean observation | `bounds non-boolean inspection without diagnosing SQLite` |
| Absence then false; immediate false | `rejects conclusive false immediately after absence`; existing native failure cases |
| Fatal error | `propagates fatal prerequisite errors without polling` |
| Same saved profile reopened with a fresh inspector session | `missing inspector values do not diagnose native failure on launch or profile relaunch`; existing `uses the new process session when a profile is relaunched` |

## Error handling
Preserve content-free static diagnostics and immediate fatal-error propagation. Missing inspection is neither success nor native failure. Native load/open/query/close failures remain false. The controlled Electron test drops one real inspector result per process, then forwards genuine subsequent results; it never fabricates success and records booleans/counts only.

## Testing strategy
- Write and run the new unit regressions red, then implement and run the whole affected file. Fake timers establish the unchanged five-second limit and immediate false/fatal rejection. Retain all generic-reader cases; add empty string/object and native close-failure coverage.
- Add an actual-Electron spec using the isolated launcher: persist a client-owned marker, close/await exit, reopen the profile, and exercise one missing result followed by real SQLite success on both launches. Attach content-free counts and launch fate. Watch this control fail before the fix and pass afterwards.
- After final main merge: install, pre-verify for the affected unit file, build and client-test typecheck. Finish Node checks before `npm run rebuild:electron`.
- Linux: guarded complete-thread paired batch, both named history/thread scenarios twice, three configured/actual workers, retries zero. Require 4 executed/passed, zero failed/skipped, history 32/63 and thread 45/378 request/frame totals with zero remaining.
- Follow with complete guarded recorded replay; retain worker/count/build/profile/input evidence and original failures under `/tmp/builder-2190/`. Dispatcher owns the later application gate. macOS is outside this run's verification scope.

## Open Questions
None. The controlled missing-result mechanism is independently demonstrated; the historical trigger remains unknown.
