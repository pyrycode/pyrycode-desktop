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

## Validation evidence — 2026-10-20
Linux x64; implementation `68388cb2e78ce5b482d248c2c37e12e349b9cc4a`, main `3fd12cc640d4`. Node 25.8.0, Electron 33.4.11, SQLite addon 12.4.1. Final pre-verify passed all five checks and all 43 affected unit cases; `npm run build`, `npm run typecheck:client-tests` and the additional scratch-config typecheck of the new Electron spec passed. Node-native preparation finished before the final Electron rebuild; none overlapped replay. No production files changed.

| Check | Executed / passed / failed / skipped | Configured / actual workers | Retained evidence under `/tmp/builder-2190/` |
| --- | --- | --- | --- |
| Corrected causal unit regression against original classifier | 43 / 24 / 19 / 0 | Vitest | `unit-causal-red-corrected.log` |
| Final unit regression / pre-verify | 43 / 43 / 0 / 0 | Vitest | `unit-final.log`, `pre-verify.log` |
| Actual-Electron original classifier | 1 / 0 / 1 / 0 | 3 / 1 | `electron-causal-red.json`, `.log`, `electron-causal-red-results/` |
| Actual-Electron committed correction | 1 / 1 / 0 / 0 | 3 / 1 | `electron-final.json`, `.log`, `electron-final-results/` |
| Guarded paired complete-thread batch | 4 / 4 / 0 / 0 | 3 / 3 | `paired.json`, `.log`, `paired-results/` |
| Complete guarded recorded suite | 29 / 29 / 0 / 1 | 1 / 1 | `recorded-full.json`, `.log`, `recorded-full-results/` |

All browser runs used zero retries. The paired run used `--fully-parallel --workers 3 --repeat-each 2 --retries 0` and selected exactly:
- `a real daemon lazily fills a served gap after more than 200 entries written while Electron is closed`
- `daemon-built thread streams, places an agent, reconnects, resets and reopens saved items`

Both paired history executions matched 32 requests / emitted 63 frames, and both thread executions matched 45 / 378, all zero remaining. The full suite retained those totals and all 29 exchanges completed with zero remaining. Both guarded commands used `node scripts/run-offline-replay.mjs --profile complete-thread`, list/JSON/zero-executed reporters and separate artifact directories; both reported zero forbidden launches and restored normal output successfully. The sole existing fixme is `real claude picks up a saved channel system prompt at Reset session` (upstream `pyrycode/pyrycode#2436`); no assertion was newly skipped or weakened. Subsequent configured application acceptance belongs to the dispatcher; this is recorded-client evidence, not fresh provider evidence.

The actual-Electron red attachment records a genuine `sqliteReady: true` followed by a deliberately omitted inspector value, which the original classifier rejected as SQLite failure. The corrected control records that same missing observation followed by another genuine successful SQLite load/open/query/close on each of two processes using the same saved profile. A persisted client-owned marker proves profile reuse; both processes exited with code zero and no teardown failures. This establishes unavailable inspection as the controlled category, not the cause of the historical macOS event. Its original reported 4 / 3 / 1 / 0 batch and 10 matched / 21 emitted / 22 remaining exchange remain failed, separately retained in the earlier-run bundle described above; its raw paired report is not present in that bundle or on this host.

Both replay logs identify clean compiled source `68388cb2e78ce5b482d248c2c37e12e349b9cc4a`, profile `complete-thread`, and the same seven emitted bundle hashes. `paired-summary.json` and `recorded-full-summary.json` retain that map, actual worker indices, every input checksum and capture source, and all exchange counts. The history/thread inputs remain unchanged:

| Input | SHA-256 |
| --- | --- |
| `daemon-history-on-open` | `de0b1166b6e05e0792228c07be25c20498b117914e673558222eac12cd4e6d2c` |
| `claude-thread` | `53a3db11cfab2d5041b511d7be4d030ab5b2b8449b7fdb3ea1d7e5e3db552ae3` |

Both captures identify Desktop `00ec821f9380b00cf2dfc0dd4817ee15584106a5`, daemon `58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`, binary SHA-256 `5f5b3b9ce42eda74024637f4929dd720d36c1226ce6e370eb62fbe9e6b22f7c0`; thread records Claude 2.1.280, history `not-spawned`. Report SHA-256:
- `electron-causal-red.json`: `a7787f188490b5e97b52401cd4cb98a2abf9c428abaf830bba47b62ea1bc8f9b`
- `electron-final.json`: `427e6527cc6a1f629275df0ba3f57cededa24882114fa92adba313c16ca5ac84`
- `paired.json`: `4c9eb9344b486d9d7f6aaf134ef118dcb1e6b69ccc869622005e561a67cd7fd4`
- `recorded-full.json`: `ecf8bac30d39a00a8bb499fa4f940e0a0586ab0f98ae9a9526a57398a051b124`

## Revisions
2026-10-20 — Verifier finding 1: the actual-Electron control's assertions could print
raw inspector exception details or unexpected values before the shared reader
sanitized them. A local `assertSuccessfulNativeProbe` guard will emit static failure
categories for these two paths. The control still forwards each genuine probe and
omits only the first successful observation per process. Parameterized Playwright
regressions inject exception details and unexpected scalar/object values, require
the exact static category, and check error messages/stacks for fixture content using
boolean assertions. The existing two-process Electron control proves genuine
success forwarding and saved-profile reuse remain intact.

This repairs the existing content-free diagnostic invariant, with no new deliverable,
exported symbol, consumer migration, production file, lifecycle state or dependency.
Approximately 70 additional written lines keep total scoped work below 350 lines.
No remote feature branch overlaps the code/test files. Re-run the affected unit file,
pre-verify, build, client-test and control-spec typechecks before Electron-native
preparation, then the complete control spec, guarded paired batch and complete
guarded recorded suite. Preserve all prior reports and store rework evidence under
`/tmp/builder-2190/rework-*`; historical macOS causality remains unknown.

## Documentation handoff
- Pending for the documentation stage: `docs/knowledge/features/development-verification.md`
  § Replay native storage prerequisite / Replay inspection after profile relaunch and
  `docs/recorded-tests.md` § Replay contract: document explicit true/false classification,
  bounded non-boolean unavailability, and preserved generic synchronous empty values.
- Pending for the documentation stage: carry counted Linux causal, Electron, paired
  and complete replay evidence, provenance and artifact paths into those sections;
  retain the historical failed batch separately and its trigger as unknown.
