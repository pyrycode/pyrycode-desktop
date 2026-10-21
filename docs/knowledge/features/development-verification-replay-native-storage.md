# Development verification — replay native storage and inspection

[Development verification](development-verification.md) owns the shared verification
map. This reference separates native SQLite readiness from inspector availability,
preserves effort-scenario proof across process handoff, and retains counted
regression and saved-profile replay evidence.

## Replay native storage prerequisite

Node and Electron require different `better-sqlite3` native addon ABIs. Rebuild
for Electron after installation or a Node rebuild before replay; the
[replay contract](../../recorded-tests.md#replay-contract) describes the command
and startup diagnostic. A missing Electron addon can look like captured-contract
drift: unavailable history storage makes a restarted profile send a fresh
`thread_catch_up` cursor. Diagnose native storage before changing recorded
requests or query ordering. The replay fixture checks an in-memory database in
each opened Electron main process, including relaunches, before device binding.
The probe proves addon load/open/query/close, not protected-profile persistence.
History IPC cannot substitute for this pre-pair check because it requires paired
host membership.

The probe returns `{ ready: true, stage: 'complete' }` only after genuine addon
load, database open, `SELECT 1` and close all succeed. A native failure returns
`ready: false` with one static stage and category:

| Field | Allowed values / meaning |
| --- | --- |
| `stage` | `resolve`, `load`, `open`, `query`, `close` identify the failed operation |
| `category` | `module-not-found`, `native-load`, `type-error`, `error`, `non-error` classify the exception without its text |
| `cleanup` | Optional category for a close failure after query failure; the primary query stage/category remain intact |

The prerequisite validates and reconstructs these fields before notifying its
observer, discarding arbitrary inspector fields. It accepts validated complete
observations and still accepts conclusive boolean `true`. Validated failures or
boolean `false` reject immediately, without another poll. Classified failures use
`Replay requires working Electron SQLite (<stage>/<category>); run npm run rebuild:electron before replay.`
Boolean false retains the same diagnostic without the parenthesized classification.
Neither form exposes native messages, paths or stacks or establishes an ABI cause.

Missing or unrecognized observations, including truthy strings, numbers and
unvalidated objects, remain inconclusive. These and transient inspector loss
retain the five-second deadline and 100 ms polling interval, reporting static
`unavailable` observations. Persistent unavailability ends with
`Replay main-process inspection unavailable`. Inspection exceptions report
`inspection-failed` separately from native failure and propagate immediately,
including fatal session/transport errors. The generic reader's values remain
unchanged; validation belongs to the prerequisite.

### Cold native loading and process controls

`better-sqlite3` loads its addon lazily inside `Database`. Treating its JavaScript
import as completed native loading misclassifies loader errors as `open` failures.
Implicit `bindings.getFileName` discovery also depends on `Error.prepareStackTrace`:
when inspection interrupts an active V8 stack formatter, V8 suppresses the nested
formatter, and first-use discovery can throw even with a healthy native artifact.
The probe resolves the installed package root, supplies it as `module_root` to
the package's existing `bindings` loader while the stage is `load`, and passes
the genuine addon through `Database`'s `nativeBinding` option before attempting
`open`. This preserves supported native search locations without pinning a binary
path, retrying a failure or manufacturing readiness.

In [`replay-native-storage.spec.ts`](../../../e2e/replay-native-storage.spec.ts),
the classified prerequisite is the first native operation on each owned initial
and saved-profile process. A prior successful historical probe would warm the
binding and hide its first-use failure. Historical-algorithm comparisons therefore
own separate processes; static `cold`/`warm`/`unavailable` observations describe
binding state without exposing cache paths. Controls exercise active stack
formatting and normal loading with real SQLite, retain saved-marker/profile and
process-exit assertions, and then test missing-result handling using further
genuine probes. Unit controls distinguish default-adapter load failure from a
loaded binding rejecting open, and preserve query failure when close also fails.

The replay lifecycle collects per-process validated observations before device
binding and writes the `replay-native-storage` attachment during teardown.
Direct unit invocations of `_clientReplay` must supply its third test-info argument: the retirement
adapter models `Pick<TestInfo, 'attach'>` and supplies an asynchronous attachment
stub. Omitting it throws during teardown and can replace the expected retirement
error; preserving retirement assertions requires honoring this fixture contract.

Finish pre-verify's Node rebuild before Electron-native preparation and browser
checks; running them concurrently can change the addon underneath a launched app.
The [#2097 repair evidence](https://github.com/pyrycode/pyrycode-desktop/pull/2105)
retains seven storage failures from that overlap in `rework-specs.json`. After
sequential native preparation, `rework-final.json` recorded 37 executed/passed,
0 failed/skipped, covering the complete thread-activation, whitespace and reader-menu
specs. These reports are under `/tmp/builder-2097/`; the failed run remains failed.
See [saved traversal diagnostics](e2e-harness-context-recovery.md#saved-traversal-diagnostics)
for the separate listener-confirmation repair and accepted configured-gate evidence.

The [effort-default verifier evidence](https://github.com/pyrycode/pyrycode-desktop/pull/2071#issuecomment-6220345807)
records Linux x64 results for #2069. Failed unchanged-main evidence remains failed:
**1 executed, 0 passed, 1 failed, 0 skipped**, zero forbidden launches. At request
41 on connection 2, actual `thread_catch_up` used epoch `""` / version 0 instead
of the recorded saved epoch / version 14, followed by worker exit 7. Rebuilding
SQLite for Electron made the identical archived app/capture pass: **1 executed,
1 passed, 0 failed, 0 skipped**, zero forbidden launches. The
[plan's evidence paths](../../specs/architecture/2069-replay-native-storage.md#validation-evidence)
retain `baseline-native.log`, `historical-main-recorded.log` and the successful
`native-ready.log` under `/tmp/builder-2069/`.

The original focused effort-default scenario was present and passed:
**1 executed, 1 passed, 0 failed, 0 skipped** (`candidate-focused.log`). Complete
guarded replay recorded **29 executed, 29 passed, 0 failed, 1 existing
system-prompt-reset fixme**, zero retries and zero forbidden launches
(`recorded-final.log` / `recorded-final.json` in the same evidence directory).
Effort-default, model-recall and daemon-session-settings were present and passed;
all 29 exchanges had zero remaining requests. Effort-default matched all 96
requests and emitted 396 frames with the capture, original assertions, strict
matcher and causal barriers unchanged. These are recorded offline Linux results;
current provider behavior and live physical effects are not established, and
macOS is outside this ticket's verification scope.

## Replay inspection after profile relaunch

Bounded `app.evaluate` polling cannot recover persistent inspector await-promise
loss. At unchanged main `5c0793c7`, controlled inspection of `__threadHistoryAsks`
failed six consecutive times with `Runtime.callFunctionOn: Promise was collected`.
Even an awaited constant failed while the same-process synchronous history read
succeeded with `awaitPromise: false`; scheduling a Node turn did not restore it.
The original #2069 failures at `340f6a961a` retained only Playwright's rewritten
destroyed-context error: thread lost `assertReplayNativeStorage` after relaunch
(6 requests remaining), and history exhausted `mainRead` (14 remaining).
The unchanged rerun passed both with zero remaining; #2068 hit the same history
boundary. The controlled reproduction establishes the mechanism at that boundary;
the original reports do not expose their underlying protocol errors.

[`readReplayMainProcess`](../../../e2e/fixtures/replayNativeStorage.ts) bypasses
the awaited path only for the SQLite prerequisite and history's synchronous
`mainRead` observations. Public `evaluateHandle` also forces `awaitPromise` and
is not an alternative. The adapter obtains the current app's local inspector
session on every call; it never caches a session across relaunch. Playwright's
internal `_connection.toImpl(app)._nodeSession` access is isolated here and depends
on the lockfile-pinned implementation. Dependency upgrades must retain the
synchronous-inspection regressions and both relaunch replay checks. See the
[inspection contract](e2e-harness-context-recovery.md#persistent-awaited-inspector-loss)
for valid empty values, bounded unavailability and mutation boundaries.

The generic reader preserves `false`, zero, null, undefined, empty strings, arrays
and objects. It rejects promise-returning callbacks; native-observation validation
belongs to `assertReplayNativeStorage`, not to history's `mainRead`. Missing
inspector values must therefore remain valid generic observations while the
prerequisite waits for a conclusive result. Fresh session selection and the
original native load/open/query/close checks remain required after relaunch.

Assertions on raw inspector fields can leak exception descriptions, stacks,
paths or unexpected values before the shared reader sanitizes them. The
actual-Electron control uses static failure categories and asserts derived
booleans for content-free message/stack checks. After the cold prerequisite
succeeds, its missing-result wrapper omits the first of two further genuine
successful probe results per process and forwards the second. A test-supplied
success would conceal the very prerequisite being checked.

The [verifier evidence](https://github.com/pyrycode/pyrycode-desktop/pull/2073#issuecomment-6221253088)
records Linux x64 on 2026-10-16, implementation `db6c6bb9`, reviewed head
`20fd3f8b`, main `5c0793c7`. These are retained results, not documentation reruns:

- Controlled regression `checks storage when the inspector loses every
  awaitPromise acknowledgement`: original **6 executed, 5 passed, 1 failed,
  0 skipped**; repaired targeted run **23 executed/passed, 0 failed/skipped**,
  including that case and all four observer-registration cases.
- Five consecutive focused guarded runs each used two actual workers,
  `--fully-parallel --workers 2 --retries 0`: **2 executed/passed, 0 failed/skipped**
  per run, **10 executed/passed, 0 failed/skipped** total. Both named scenarios
  were present and passed in every run:
  `daemon-built thread streams, places an agent, reconnects, resets and reopens saved items`
  and `a real daemon lazily fills a served gap after more than 200 entries written while Electron is closed`.
  Every thread exchange matched 45 requests/emitted 378 frames; history matched
  32/emitted 63. All ten had zero remaining requests and zero forbidden launches.
- Subsequent complete guarded `npm run e2e:recorded` used one worker, retries zero:
  **29 executed/passed, 0 failed, 1 skipped**. Both named cases were present and
  passed; all 29 exchanges had zero remaining requests, with zero forbidden launches.
  The explicit skip remains `real claude picks up a saved channel system prompt at Reset session`.
- Configured application gate used two actual workers, retries zero:
  **492 executed, 491 passed, 1 failed, 4 skipped**. Both named cases passed on
  their first attempt with the same complete exchanges above; all 29 replay
  exchanges had zero remaining requests. The unrelated visible-tail failure is
  tracked in #2074; its separate rerun was **2 executed/passed, 0 failed/skipped**.
  This does not turn the original full gate into a failure-free run. Skips were
  three macOS-only cases and the system-prompt-reset fixme.

Capture bytes, assertions, strict matching and causal barriers are unchanged:
Desktop source `00ec821f9380b00cf2dfc0dd4817ee15584106a5`, daemon source
`58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`, binary SHA256
`5f5b3b9ce42eda74024637f4929dd720d36c1226ce6e370eb62fbe9e6b22f7c0`.
The [plan's evidence paths](../../specs/architecture/2072-replay-inspection.md#validation-evidence)
retain diagnostics, red/green regression reports and `focused-1` through
`focused-5` plus `recorded-full` reports under `/tmp/builder-2072/`.
Offline replay establishes no fresh provider/daemon or physical-effect evidence;
macOS is outside this Linux ticket's verification scope. The SQLite ABI
prerequisite above still applies independently of inspection availability.

## Counted Linux native observation validation

These retained Linux x64 results on 2026-10-20 were accepted by the
[PR #2194 verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2194#issuecomment-6298418522),
authoritative accepted stage
`5e2100fb2bd9e7834060a62b93de2a05348b2c31fedd0e53fb3c0bf50c72dda4`.
They are recorded evidence, not documentation-stage runs. The reviewed head is
`7bcaabad0dc7d0460146fcac4714e18e7dd6048f`; scoped code is unchanged from the
counted repair `5569f7cff359a9ac942c1c35642b0c2f1f1a5194` (main `ebe063cf`).
The [plan's original and rework validation](../../specs/architecture/2190-replay-native-observation.md#rework-validation--2026-10-20)
retains report hashes, provenance and artifacts under `/tmp/builder-2190/`.

| Check | Executed / passed / failed / skipped | Artifact under `/tmp/builder-2190/` | Configured / actual workers |
| --- | --- | --- | --- |
| Original classifier, causal units | 43 / 24 / 19 / 0 | `unit-causal-red-corrected.log` | Vitest |
| Corrected units / final rework pre-verify | 43 / 43 / 0 / 0 | `unit-final.log`, `rework-pre-verify.log` | Vitest |
| Original classifier, actual-Electron control | 1 / 0 / 1 / 0 | `electron-causal-red.json` | 3 / 1 |
| Initial correction, actual-Electron control | 1 / 1 / 0 / 0 | `electron-final.json` | 3 / 1 |
| Original raw assertions, diagnostic leak controls | 3 / 0 / 3 / 0 | `rework-diagnostic-leak-red.json` | 3 / 1 |
| Static diagnostic controls | 3 / 3 / 0 / 0 | `rework-diagnostic-green.json` | 3 / 1 |
| Complete native control spec | 4 / 4 / 0 / 0 | `rework-electron.json` | 3 / 1 |
| Guarded complete-thread paired batch | 4 / 4 / 0 / 0 | `rework-paired.json` | 3 / 3 concurrent slots |
| Complete guarded complete-thread replay | 29 / 29 / 0 / 1 | `rework-recorded-full.json` | 1 / 1 |
| Supplied dispatcher unit gate 4 | 9940 / 9940 / 0 / 3 | Dispatcher gate report | Unit gate |
| Supplied dispatcher application gate 7 | 533 / 533 / 0 / 4 | Dispatcher gate report | Not counted in supplied report |

Each browser report above also has its matching `.log` and `-results/` directory;
`rework-paired-summary.json` and `rework-recorded-full-summary.json` retain every
input checksum/capture source, seven-bundle hash map and worker identity. The
accepted verdict separately reports 10,026 executed/passed units, zero failed,
three skipped; that count differs from the supplied gate-4 summary above and is
retained as a separate reported observation. The supplied report has no overall
pass marker; the authoritative verifier stage is accepted. No count is inferred
from an exit code alone.

### Controlled missing-result and diagnostic regressions

The causal unit cases include later true, persistent absence/non-booleans,
absence followed by false, immediate false/fatal failure, all generic empty values,
promise rejection and fresh relaunch sessions. The Electron case
`missing inspector values do not diagnose native failure on launch or profile relaunch`
is present and passed in `rework-electron.json` and application gate 7. Its attachment
records two genuine successful load/open/query/close probes on each of two processes:
the first value is omitted and the second forwarded. A persisted client-owned
marker proves saved-profile reuse; both processes exit zero with no teardown
failures. The original classifier rejects the omitted observation despite genuine
SQLite success. The three diagnostic regressions fail before the static-category
repair and pass afterward, propagating after one read without injected content
in error messages/stacks. All four controls passed in the configured application
gate according to the accepted verdict.

### Guarded replay and exchange totals

Both named cases are present and passed twice in the paired batch and once in
the full replay and supplied application gate:

- `a real daemon lazily fills a served gap after more than 200 entries written while Electron is closed`
- `daemon-built thread streams, places an agent, reconnects, resets and reopens saved items`

The paired command uses `node scripts/run-offline-replay.mjs --profile complete-thread`
with the two-case grep, `--fully-parallel --workers 3 --repeat-each 2 --retries 0`.
Actual parallel slots are 0/1/2, with three peak executing tests; process indices
0/1/2/3 reflect slot reuse and are all retained. Each paired history exchange
matches 32 requests / emits 63 frames; each thread exchange matches 45 / 378,
all zero remaining. The subsequent full command uses the same guarded profile
with one configured/actual worker. All 29 full-suite exchanges complete with zero
remaining, including those history/thread totals. The sole full-replay skip,
`real claude picks up a saved channel system prompt at Reset session`, is also
explicitly skipped in application gate 7 and remains tracked by
[upstream #2436](https://github.com/pyrycode/pyrycode/issues/2436).
All builder browser runs use retries zero; both guarded rework commands report
zero forbidden launches and successful normal-output restoration.

### Build and capture provenance

Both rework replay logs identify clean compiled repair `5569f7cf`, profile
`complete-thread` and identical seven-bundle hashes. History input SHA-256 is
`de0b1166b6e05e0792228c07be25c20498b117914e673558222eac12cd4e6d2c`;
thread is `53a3db11cfab2d5041b511d7be4d030ab5b2b8449b7fdb3ea1d7e5e3db552ae3`.
Both unchanged captures identify Desktop
`00ec821f9380b00cf2dfc0dd4817ee15584106a5`, daemon
`58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`, binary SHA-256
`5f5b3b9ce42eda74024637f4929dd720d36c1226ce6e370eb62fbe9e6b22f7c0`;
thread records Claude 2.1.280 and history `not-spawned`. Original successful
builder evidence on `68388cb2` remains in `paired.*`, `recorded-full.*` and their
summaries, separately from all causal failures and final rework artifacts.

Pre-verify's five checks, build and client/control typechecks passed; completed
Node checks precede `rework-native-preparation.log`, with no native rebuild
overlapping replay. Full capture matching, device/connection ownership, causal
checkpoints, profile-retirement waits, final completion and original history/thread
assertions remain intact. No production storage or transport changed. These are
recorded-client and local native results; fresh provider/daemon acceptance was
not required. macOS is outside this Linux ticket's verification scope.

### Historical failure remains separate

The historical #2153 macOS arm64 paired batch on `1dd48a53536f1fbdae4e049c49e3ef583472dcea`
remains reported as **4 executed / 3 passed / 1 failed / 0 skipped**, retries zero,
three workers. Its second history execution fails at the native prerequisite
after relaunch, before catch-up acceptance, with **10 matched / 21 emitted /
22 remaining**. Two preceding batches passed 8/8; no native rebuild overlapped
and the addon was unchanged. The historical trigger remains unknown: the
controlled missing-result mechanism establishes neither an ABI mismatch nor
the historical Linux history trigger.

Original paths are `/tmp/builder-2153/paired-3.json`, `paired-3.log` and
`paired-3-results/`. The earlier-run bundle
`5fb3a102637f268ca9e008c4fbf091d34621eeb7f40d7b41ed796993ed0a299e`, retained
under `/tmp/builder-2190/evidence-2153/`, has digest
`ec57a3b3a85353172d2fbb6cb8532d690e34de92147dd6a1201c289d46d80a8e`.
It contains the builder log but none of those raw paired artifacts and no artifact
pointers; the raw files are unavailable on the execution host. These historical
counts remain reported evidence rather than independently parsed results. New
acceptance never replaces that failure or supplies its missing causal observation.

## Counted Linux cold-loading validation

These retained Linux x64 results, 2026-10-20–21, were accepted by the
[PR #2207 verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2207#issuecomment-6305773535),
authoritative accepted stage
`c1a554150e9605690eedbd4e432a86611f3ddb39d0ff7993f76135ce03dfbb94`,
reviewed head `bde37dd75b089bc83123d7b57e148a4a2a89c94b`.
They are recorded evidence, not documentation-stage executions. The
[plan's recovery validation](../../specs/architecture/2204-replay-native-false.md#recovery-validation--linux-x64-2026-10-20)
and [fixture-contract rework](../../specs/architecture/2204-replay-native-false.md#verifier-rework--2026-10-21)
retain commands, report/log hashes, native classifications and earlier failures.

| Check | Executed / passed / failed / skipped | Artifact under `/tmp/builder-2204/` |
| --- | --- | --- |
| Default-adapter / formatter units before correction | 57 / 55 / 2 / 0 | `recovery-causal-unit-red.log` |
| Actual-Electron formatter regression before correction | 7 / 6 / 1 / 0 | `recovery-causal-electron-red.json` |
| Repaired native units / final pre-verify | 57 / 57 / 0 / 0 | `recovery-unit-final/`, `recovery-pre-verify-final.log` |
| Repaired complete Electron control spec | 7 / 7 / 0 / 0 | `recovery-electron-final.json` |
| Post-correction guarded complete-thread paired acceptance | 4 / 4 / 0 / 0 | `recovery-paired-final.json` |
| Retirement adapter before its fix | 9 / 1 / 8 / 0 | `rework-20261021/retirement-red.log` |
| Repaired retirement and native units | 66 / 66 / 0 / 0 | `rework-20261021/affected-green.log` |
| Final structured retirement controls | 9 / 9 / 0 / 0 | `rework-20261021/unit-final/` |
| Supplied dispatcher unit gate 4 | 10016 / 10016 / 0 / 3 | Supplied gate report |
| Supplied dispatcher application gate 7 | 539 / 538 / 1 / 4 | Supplied gate report |

### Causal controls and gate boundaries

The default-adapter units
`classifies first-use lazy native binding failure through the default adapter as load`
and `establishes cold native readiness during an active V8 stack formatter`
fail before correction and pass in the repaired 57-test run; the companion
`distinguishes a loaded binding rejecting a genuine open through the default adapter`
keeps loading distinct from opening.

The actual-Electron case
`cold native prerequisite survives active stack formatting on launch and relaunch`
is present and fails in the causal red report, then passes in the final
7 executed / 7 passed / 0 failed / 0 skipped spec. The separate case
`historical cold native probe fails during stack formatting in separate processes`
also passes there: the old algorithm returns false cold on initial launch and
saved-profile relaunch, then succeeds outside formatting with the same addon.
Both classified modes establish cold readiness before further probes. All eight
owned control processes exit zero without teardown failure. The original
missing-inspector-values case and three content-free diagnostic controls pass
in the same final spec. This proves a first-use mechanism with genuine local
SQLite operations, without inferring an ABI mismatch.

The accepted verdict confirms all seven native controls and both named paired
scenarios passed on their first attempt in application gate 7. The supplied
gate report explicitly confirms the two formatter cases and both paired titles
passed in that **539 executed / 538 passed / 1 failed / 4 skipped** run. Its
unrelated failure, `Fetch bulk cancellation never promotes a queued mutation on document-bind`,
remains failed and is tracked by [#2208](https://github.com/pyrycode/pyrycode-desktop/issues/2208).
The verdict reports the separate dispatcher rerun as **2 executed / 2 passed /
0 failed / 0 skipped** and acceptance under the flaky-failure policy; it does
not turn the original gate into a failure-free run. The verdict separately
reports **10114 executed / 10114 passed / 0 failed / 3 skipped** units, including
all nine retirement controls. That total differs from the supplied gate-4
summary and is retained as a separate reported observation. The supplied report
has no overall pass marker; the authoritative verifier stage is accepted.

The initial fixture integration regression remains retained: its complete unit
gate recorded **10114 / 10106 / 8 / 3**, and the exact eight-case comparison
failed on the PR while passing on unchanged main. The third-argument attachment
stub repair preserves every retirement, forwarding, deadline, cleanup and causal
error assertion. Its affected 66-test run includes all nine retirement and 57
native controls; this adapter-only rework claims no new builder Electron run.

### Paired acceptance and provenance

Both exact cases are present and passed twice in `recovery-paired-final.json`:

- `a real daemon lazily fills a served gap after more than 200 entries written while Electron is closed`
- `daemon-built thread streams, places an agent, reconnects, resets and reopens saved items`

The command uses `node scripts/run-offline-replay.mjs --profile complete-thread`
with exactly those two titles, `--fully-parallel --workers 3 --repeat-each 2 --retries 0`.
Configured and actually overlapping worker slots are 0/1/2, overlapping from
23:54:07.086 through at least 23:54:13.461 UTC on 2026-10-20; slot 0 reuse has
worker index 3. All ten per-process prerequisites complete. Every history exchange
matches 32 requests / emits 63 frames / has zero remaining; each thread exchange
is 45 / 378 / 0. There are zero forbidden launches, retries, skips or top-level
report errors. Captures, full envelopes, causal checkpoints and original
application assertions remain unchanged.

Executed build is `2a9fa07724d78eb24845280ddf45f50fe01225d3`, dirty=false,
profile `complete-thread`. Each browser JSON has matching `.log` and `-results/`
artifacts. `recovery-summary.json` retains worker intervals, classifications,
launch fates, seven compiled bundle hashes, report/log hashes and capture
provenance. SHA-256 identities:

| Artifact | SHA-256 |
| --- | --- |
| Causal Electron red | `619a093f5e0837f28be0ed0a80f7686bd0be8ed24eae94eb9d030b24ccea0285` |
| Final Electron | `ed063a3f926406b4c657005bf7a688d496cff265b0229a41a2f9a07d8014f24b` |
| Final paired | `0b4e50019b8de512ece0cbe1d61805a2d07d687f57bbd9a612e9e2dcb7bd4964` |
| Recovery summary | `23273b79997ceb8ee3e5701d3c001edfad624611d819e5b5df052ee17a828aa2` |

History input remains
`de0b1166b6e05e0792228c07be25c20498b117914e673558222eac12cd4e6d2c`;
thread remains `53a3db11cfab2d5041b511d7be4d030ab5b2b8449b7fdb3ea1d7e5e3db552ae3`.
Capture provenance remains Desktop `00ec821f9380b00cf2dfc0dd4817ee15584106a5`,
daemon `58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`, daemon binary
`5f5b3b9ce42eda74024637f4929dd720d36c1226ce6e370eb62fbe9e6b22f7c0`.
All Node checks and build finish before Electron native preparation; builds,
rebuilds and execution are sequential. Final pre-verify, strict harness typecheck
and build pass; the final native artifact is
`1aebb6e757848aee805967d82dc09ce25b7797964e2d4afe7222dfabf4eaf9fc`.
The subsequent adapter rework also passes all five pre-verify checks and build.
No test/build job remains running at builder handoff. These results establish
local native readiness and captured-client behavior; no fresh provider/daemon
acceptance was requested. macOS is outside this Linux ticket's verification scope.

### Historical explicit false remains unattributed

The #2191 macOS arm64 batch remains **4 executed / 2 passed / 2 failed / 0 skipped**,
three workers, retries zero, executed `f2a58a2e`, dirty=true, complete-thread.
Both saved-profile failures explicitly returned false before protected paging:
thread **38 matched / 345 emitted / 7 remaining**, history **10 / 21 / 22**.
No rebuild overlapped execution. Original retention paths are
`/tmp/builder-2191/index-candidate-paired.json`, its same-stem `.log` and
`index-candidate-results/`; the reported report hash is
`e8c076dd31d05cf5f7e380cf3c76c88db74db086cc32db36d56377ddb9b7c1e7`.
The retrieved bundle under `/tmp/builder-2204/evidence-2191/` contains the builder
log without the full original report/results or artifact pointers. These remain
reported counts; no missing failed-stage provenance is reconstructed.

The controlled stack-discovery defect does not attribute those historical
failures to this mechanism, an ABI mismatch or index-flush caches. Keep them
separate from #2191's paging stall, #2153's saved-only assertion and #2201's
reconnect failure. Earlier diagnostic paired passes in the plan remain diagnostic,
and every earlier failure remains failed; none is replaced by post-correction
acceptance or establishes an unrelated repair dependency.

## Effort scenario proof ownership

In [`real-claude-effort-default.spec.ts`](../../../e2e/real-claude-effort-default.spec.ts),
`page = (await relaunch()).page` cannot replace old handles when relaunch rejects.
Unconditional final capture through the old observer can then throw a closed-page
error, replace the relaunch failure and prevent disposal. The directly consumed
[`withEffortScenarioProof`](../../../e2e/fixtures/effortScenarioProof.ts) keeps setup,
scenario execution, handoff and finalization inside one first-error boundary.
It preserves the first thrown value, including a non-Error value. Without an
earlier failure, failed setup, required capture/disposal/attachment, unexpected
closure or relaunch still fails; missing evidence cannot manufacture success.

Each process owns one observer. Handoff clears current ownership, captures the
retiring page while available, attempts disposal, then attaches proof including
any classified disposal failure. Only successful retirement proceeds to relaunch
and replacement observation. Final capture, disposal and attachment are attempted
independently even after a scenario failure. Final attachment includes retained
retirement proof again, including when its first attachment failed. The outer
`withIsolatedElectronApp` continues process/profile cleanup while preserving its
incoming error. Observer setup releases partial resources; disposal attempts CDP
detach even when stopping the page listener fails. This is a scenario-local
boundary, not a shared lifecycle API or production settings repair.

Attachments identify process ordinal, `retirement`/`final` phase and availability:
`current` means a successful snapshot in that phase, `last-available` means cached
diagnostics, and `unavailable` means no snapshot for that owner. Process 1 retirement
proof cannot stand in for process 2 final proof. `retirement-requested` and
`relaunch-requested` distinguish intended handoff from `unexpected-closure`;
`replacement-failed` identifies rejection before replacement handles return,
including a failed prerequisite, without asserting its underlying cause.
Lifecycle entries use static phases/failure categories and event/sample counts,
without raw inspector/native errors, paths, settings payloads or daemon content.
Existing proof snapshots remain separate from those lifecycle diagnostics.

The observer caches only successful snapshots. `mark`, `confirmations`,
`readingsSince` and `waitForEffortProof` still request fresh observations; cached
diagnostics never satisfy settings or freshness assertions. The
[`effortScenarioProof.test.ts`](../../../e2e/fixtures/effortScenarioProof.test.ts)
regressions exercise the helper actually consumed by the scenario: rejection after
old-page closure but before replacement return, secondary diagnostic failures,
unexpected closure, successful handoff, setup failures and required finalization
without an earlier error. Isolated-profile coverage also checks incoming-error
preservation through the outer cleanup boundary.

### Counted macOS effort failure-preservation evidence

These retained macOS arm64 results, 2026-10-20, were accepted by the
[PR #2200 verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2200),
authoritative accepted stage
`9846673d6a2be07006145766f8f509284fa592d7548c697b8e2581ceec48ee58`.
They are recorded evidence, not documentation-stage executions. The clean executed
build was `734e6a03dcabc645c65250a93dc87913e7359b87`, normal profile,
`sourceDirty: false`, with main `83a7fc075bfe` merged. Reviewed head
`0abab663bd99a2250dc7233e22e04becf977b3f3` changes only plan evidence afterward.
The [plan's validation evidence](../../specs/architecture/2196-effort-proof-finalization.md#validation-evidence--macos-arm64-2026-10-20)
retains exact commands, report hashes and capture provenance. Artifacts under
`/tmp/builder-2196/` include `evidence-summary.json`, seven-bundle hashes, input
identities, exchange totals and lifecycle phases.

| Check | Executed / passed / failed / skipped | Artifact under `/tmp/builder-2196/` |
| --- | --- | --- |
| Extracted original finalization, causal regression | 10 / 1 / 9 / 0 | `causal-red.log` |
| Initial repaired causal regression | 10 / 10 / 0 / 0 | `causal-green.log` |
| Final proof, isolated-profile and effort-ordering units | 33 / 33 / 0 / 0 | `unit-final.log` |
| Final proof pre-verify, all five checks passed | 13 / 13 / 0 / 0 | `pre-verify-proof-approved.log` |
| Final isolated-profile pre-verify, all five checks passed | 9 / 9 / 0 / 0 | `pre-verify-retirement.log` |
| Exact guarded effort replay | 1 / 1 / 0 / 0 | `recorded-focused.json` |
| Subsequent complete guarded replay | 29 / 29 / 0 / 1 | `recorded-full.json` |

Both replay reports have matching `.log` and `-results/` artifacts. The exact
`applied effort, confirmed preference, restart, chat recall and channel creation choice`
case is present and passed in both, consuming 96 matched requests / 396 emitted
frames / zero remaining. Both commands used one configured/actual worker, retries
zero and zero forbidden launches. All 29 full-suite exchanges completed:
773 matched / 3,216 emitted / zero remaining. The sole skip remains
`real claude picks up a saved channel system prompt at Reset session`, the existing
fixme tracked by [upstream #2436](https://github.com/pyrycode/pyrycode/issues/2436).

The focused command was `node scripts/run-offline-replay.mjs --grep "applied effort, confirmed preference, restart, chat recall and channel creation choice" --retries 0 --reporter=list,json`;
the subsequent full command omitted only the grep. The linked plan retains report
output arguments and the preceding unit, client-test typecheck, pre-verify, build
and `npm run rebuild:electron` commands. Node checks and build passed before
`native-preparation.log`; no native rebuild overlapped replay. The approved final
pre-verify rerun resolved the earlier sandboxed label-read limitation.
`assertion-audit.json` records all 134 original expect-rooted calls unchanged.
Settings, restart, recall, channel-creation and original-explicit-choice assertions,
full-envelope matching, causal checkpoints, connection/device ownership, native
prerequisites, retirement/forwarding waits and final completion remain intact.
No retries, skips, repeated mutations or longer deadlines were introduced.

The supplied dispatcher unit gate 3 records 9,986 executed/passed, zero failed,
six skipped, explicitly including these passed cases:

- `relaunch rejection retains primary and pre-retirement proof`
- `secondary failures preserve primary and finish cleanup`
- `unexpected closure fails with last available proof`
- `successful handoff distinguishes process proof`

The accepted verdict separately reports 10,084 passed / zero failed / six skipped
units and 538 executed/passed / zero failed / two skipped application cases,
including the named effort scenario. These remain separate reported counts from
the supplied unit summary; no counts are inferred from exit status. The supplied
gate report has no overall pass marker; the authoritative verifier stage is accepted.

Effort input bytes remain SHA-256
`999324c7bc7fce3f8a0ce6a6eaf78139ca4cb98b8b9afe79f15bf69704b21866`.
Capture provenance remains Desktop `00ec821f9380b00cf2dfc0dd4817ee15584106a5`,
daemon `58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`, daemon binary SHA-256
`5f5b3b9ce42eda74024637f4929dd720d36c1226ce6e370eb62fbe9e6b22f7c0`,
Claude 2.1.280. Focused/full report hashes remain in the linked plan.

### Historical effort failure and unchanged pass

The original clean source was `4cac8bd7c0580e8f23684376eb2f9c099856aa2c`.
The separate original reports remain under
`/private/tmp/desktop-manual-evidence-20261020/`, with hashes in the
[historical evidence](../../specs/architecture/2196-effort-proof-finalization.md#historical-failure-and-unchanged-pass-remain-separate):

| Report | Executed / passed / failed / skipped | Configured / actual workers | Effort matched / emitted / remaining |
| --- | --- | --- | --- |
| `application.json`, original failed run | 531 / 529 / 2 / 2 | 4 / 4 | 36 / 147 / 60 |
| `application-exact-retry.json`, unchanged-tree comparison | 2 / 2 / 0 / 0 | 4 / 2 | 96 / 396 / 0 |

Both used retries zero and the same effort input checksum above. The comparison
passed the named effort scenario; it does not turn the original failure into a
pass. The controlled red regression reports a closed-snapshot error instead of
the replacement-prerequisite error and establishes masking only. The historical
relaunch trigger remains unknown; no causal claim follows from nearby native
inspection or production status-subscription repairs. These captured-client checks
supply no fresh provider/daemon proof and require no new capture or wire/schema
change. Linux is outside this macOS ticket's verification scope.
