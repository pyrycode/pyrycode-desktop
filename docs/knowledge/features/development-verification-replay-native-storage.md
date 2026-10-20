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

Only explicit `true` permits startup. Explicit `false` fails immediately, without
another poll, with `Replay requires working Electron SQLite; run npm run
rebuild:electron before replay.` Native load, open, query and close errors all
produce that false probe without exposing their details. An absent value or any
non-boolean value is inconclusive, including truthy strings, numbers and objects.
These observations and transient inspector loss retain the five-second deadline
and 100 ms polling interval; persistent unavailability ends with the distinct
`Replay main-process inspection unavailable` diagnostic. Fatal inspector errors
propagate immediately. Neither truthiness nor generic empty-value handling can
classify native readiness.

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
and objects. It rejects promise-returning callbacks; the boolean-only decision
belongs to `assertReplayNativeStorage`, not to history's `mainRead`. Missing
inspector values must therefore remain valid generic observations while the
prerequisite waits for a conclusive boolean. Fresh session selection and the
original native load/open/query/close checks remain required after relaunch.

Assertions on raw inspector fields can leak exception descriptions, stacks,
paths or unexpected values before the shared reader sanitizes them. The
actual-Electron control uses static failure categories and asserts derived
booleans for content-free message/stack checks. It forwards genuine SQLite probes,
omitting only the first successful result per process; a test-supplied success
would conceal the very prerequisite being checked.

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
