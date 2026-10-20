# Protected history testing — native writer evidence

Part of [native runtime and evidence](chat-history-testing-native.md). The
[bounded writer contract and completion clock](chat-history-testing-native.md#bounded-writer-native-input-proof)
apply to the comparisons below. See [indexed-storage regressions](chat-history-testing-storage.md#owned-mutation-regressions-and-counted-validation)
for compilation, constructed-node authentication and rollback coverage.

## macOS flush compilation comparison

The [macOS plan](../../specs/architecture/2198-macos-writer-deadline.md#revisions--causal-regression-and-macos-evidence-2026-10-21)
and [accepted verifier review](https://github.com/pyrycode/pyrycode-desktop/pull/2202#issuecomment-6303118330)
retain the comparison for native candidate
`3b103f3902ab0fee09761762a31da7253a538ee4`, reviewed at
`3468ee400e7ab16f06354692129cda6c9c95382a` (only plan evidence changed afterward).
All native runs use macOS arm64, Electron **33.4.11**, embedded Node **20.18.3** /
ABI **130**, real **`os-keychain`**, four configured/one actual native worker,
worker index **0**, parallel index **0**, retry **0**. These are retained native
executions; documentation ran no native tests. Linux is outside this ticket's
verification scope.

The measured correction removes repeated compilation/allocation of fixed index
INSERT/DELETE statements inside the CPU-heavy drain. Each sequence/radix flush
now owns its lazily prepared statements, with fresh parameters for every execution.
Row executions, yielded units, protection, disk authentication, rollback and
fresh-owner behavior remain unchanged. The controlled
[compilation regression](chat-history-testing-storage.md#owned-mutation-regressions-and-counted-validation)
failed before correction and passed afterward; passing unchanged native reruns
alone would not demonstrate this mechanism.

Instrumented `baseline.json` at `7e673487` executed/passed **1**, failed/skipped
**0**; `baseline-phases.json` at `ee41da2a` executed/passed **8**, failed/skipped
**0**, including the named native scenario and seven visible-tail dependents.
Both have its passing result at retry zero and inline `native-storage-input`.
Baseline writer/storage production files match historical `7aa73aa6`; the candidate's
only production change is flush-local statement reuse. Workload durations were
**10,178.9 / 11,615.4 ms**; first-baseline IPC was **10,131.3 ms**. The second
baseline records main CPU **12,098.7 ms**, preparation **1,561.9 ms**, SQL execution
**1,539.1 ms**, COMMIT **736.7 ms**, protection **42.7 ms**, main heartbeat gap
**46.0 ms** and host one-minute load **5.93 → 5.20**.

Five consecutive exact `history-writer-native.spec.ts` invocations each
executed/passed **1**, failed/skipped **0**, retries **zero**. The subsequent
`visible-tail-read.spec.ts` selection executed/passed **8**, failed/skipped **0**,
retries **zero**, including the native prerequisite and all seven dependents.
The exact `finite protected writer backlog preserves native keyboard and both event loops`
test is present and passed in every report below. Each preserves one **8,333-item**
admission, **271 submissions**, advancing unfinished durable counts around all
three real inputs, explicit flush, exact fresh protected-owner equality and two
normal exits with no writer/diagnostic errors. The inclusive **60,000 ms** workload
and **1,000 ms** input/heartbeat limits, prerequisite ordering and downstream
parallelism remain unchanged. Times below are ms; heartbeats give samples/max gap.

| Report | Workload | IPC | Main CPU | Keyboard x/y/z | Renderer beats/gap | Main beats/gap |
| --- | ---: | ---: | ---: | --- | --- | --- |
| `candidate-1.json` | 6,363.4 | 6,332.3 | 6,398.6 | 21.2 / 20.2 / 19.8 | 300 / 40.0 | 303 / 30.9 |
| `candidate-2.json` | 7,873.7 | 7,835.3 | 8,091.7 | 26.8 / 17.1 / 25.4 | 355 / 50.4 | 330 / 90.1 |
| `candidate-3.json` | 12,326.8 | 12,265.9 | 13,063.5 | 46.7 / 29.3 / 47.4 | 479 / 64.7 | 521 / 39.7 |
| `candidate-4.json` | 8,729.5 | 8,685.5 | 8,993.7 | 35.9 / 36.7 / 32.6 | 377 / 55.3 | 352 / 96.6 |
| `candidate-5.json` | 9,343.2 | 9,301.1 | 9,626.9 | 27.6 / 26.5 / 25.3 | 404 / 65.2 | 385 / 81.2 |
| `visible-tail.json` | 7,418.1 | 7,381.1 | 7,583.7 | 24.5 / 26.9 / 24.8 | 340 / 47.5 | 322 / 37.2 |

Preparations fell **356,637 → 71,221**, removing **285,416** compilations, while
SQL executions **305,121**, reads **57,322**, encryptions **17,210**, decryptions
**813** and commits **271** stayed identical. Candidate preparation time was
**209.4–460.6 ms**, COMMIT **729.6–854.8 ms** and protection **26.2–54.8 ms**.
Baseline/complete-selection workload fell **11,615.4 → 7,418.1 ms** and main CPU
**12,098.7 → 7,583.7 ms**. Candidate median workload was **8,729.5 ms**; the slower
third candidate remains included. Candidate before/after one-minute loads were
**5.06/5.53, 5.29/5.10, 5.22/5.56, 5.25/5.44, 4.92/5.61**; complete selection
**4.73/4.62**. These host observations do not establish a contention cause.

Artifacts are `/tmp/builder-2198/{baseline,baseline-phases,candidate-N,visible-tail}.json`,
matching `.log` files and `-results/` directories. Reports retain inline
`native-storage-input` and shutdown attachments, with decoded `-native.json` and
`-summary.json` siblings. The plan records SHA-256 values; the verifier checked
them against the reports and decoded every native attachment. Host-Node checks
and build preceded Electron preparation; no ABI rebuild overlapped execution.

The accepted verifier record confirms the subsequent complete configured macOS
application gate at the reviewed head: **538 executed/passed, 0 failed, 2 skipped**,
with the named native prerequisite and all seven visible-tail dependents present
and passed. The independent-cover hover and saved-system-prompt reset skips are
not passes. This gate used list reporting without native attachment bodies; its
counted results supplement the separate machine-readable native acceptance above.

The historical macOS failure remains separate under
`/tmp/builder-2176/visible-tail-merge-20261020/`: `visible-tail.log` and
`first-failed-results/` retain **1 executed/failed, 0 passed**, seven dependents
not run, with actual completion **62,413.2 ms**. `visible-tail-retry.log` separately
records the unchanged selection passing **8**, failed/skipped **0**, retries zero.
The failed list report lacks the `native-storage-input` body. Its exact external
trigger, scheduler state and host conditions cannot be reconstructed. The supported
claim is removal of measured compilation overhead contributing to deadline risk;
neither this comparison nor the earlier Linux repair proves it was the sole
historical trigger.

## Counted timing repair validation

The [timing repair plan](../../specs/architecture/2125-native-writer-timing.md#validation-evidence),
[cause record](https://github.com/pyrycode/pyrycode-desktop/issues/2125#issuecomment-6270913277)
and [accepted verifier review](https://github.com/pyrycode/pyrycode-desktop/pull/2147#issuecomment-6271861915)
retain Linux x64 evidence for implementation
`adc274e938cbe810ab3ed0431a2544557eed99bf`, reviewed at `c0af1abac12017d702a87f79551d990687c86116`.
All native runs below report Electron 33.4.11 / embedded Node 20.18.3 / ABI 130 and
real `gnome_libsecret`, with production-backend assertions preserved. These are
retained native encryption/input executions, not fresh runs by documentation or
captured-client replay. macOS is outside this Linux ticket's verification scope.

The controlled comparison used three configured workers and retries zero throughout.
On instrumented revision `c7e6db3a`, `/tmp/builder-2125/contended.json` ran the native,
packaged-history and hosted-view specs with three actual workers: **25 executed,
24 passed, 1 failed, 0 skipped**. The native drain met the deadline at 58,773 ms,
but its main heartbeat failed at 1,005 ms (renderer 44.5 ms, keyboard 150/250/307 ms).
The identical selection after ordering, `/tmp/builder-2125/ordered.json`, used two
actual workers after the prerequisite: **25 executed/passed, 0 failed/skipped**.
Native actual/runner durations were 46,404.8/46,486.0 ms, keyboard
153.4/18.0/96.9 ms and renderer/main gaps 33.9/146.8 ms. Competitors began 886 ms
after native completion. `collection.json` collected 519 ordinary cases, including
this scenario exactly once. Reports have matching `.stderr` files.

Failed comparisons remain failed. The initial isolated `alone.json` at `c7e6db3a`
executed/failed **1**, passed/skipped **0**, with one actual worker: actual drain
66,817 ms, runner observation 66,958 ms, 8,333 durable items, 271 submissions and no
writer errors. Its retained failure diagnostics prove actual overdue completion is
rejected. `alone-after.json` separately executed/passed **1**, failed/skipped **0**,
at 54,057 ms with main/renderer gaps 149/44.3 ms. Unrelated compilation was observed
during both isolated runs. No cause is claimed for that isolated overrun, and
ordering cannot eliminate external host load. Historical runner-only failures at 60,347/60,458 ms cannot
retrospectively establish actual admission-to-flush duration.

Five consecutive exact native runs on the implementation revision above each used
three configured/one actual worker, retries zero, and **1 executed/passed,
0 failed/skipped**. Each retained one 8,333-item admission, 271 submissions, no
writer/diagnostic errors, advancing unfinished durable counts around all three
inputs, explicit flush, exact fresh protected-owner equality and two clean exits
with no signals or teardown failures. Artifacts are `/tmp/builder-2125/final-N.json`,
matching `.stderr` files and `final-N-results/` directories. Heartbeats below give
sample count / maximum gap; all times are milliseconds.

| Report | Actual drain | Runner observation | Keyboard x/y/z | Renderer beats/gap | Main beats/gap |
| --- | ---: | ---: | --- | --- | --- |
| `final-1.json` | 44,443.7 | 44,488.5 | 131.2 / 129.4 / 33.5 | 2,223 / 31.9 | 960 / 166.4 |
| `final-2.json` | 49,975.8 | 50,063.4 | 135.1 / 117.4 / 21.1 | 2,499 / 38.7 | 1,065 / 168.0 |
| `final-3.json` | 55,347.6 | 55,437.0 | 172.2 / 203.1 / 189.6 | 2,766 / 51.3 | 1,106 / 175.1 |
| `final-4.json` | 54,828.4 | 54,907.8 | 163.1 / 188.1 / 220.7 | 2,739 / 49.9 | 1,111 / 278.8 |
| `final-5.json` | 48,970.3 | 49,031.0 | 22.3 / 144.2 / 77.5 | 2,449 / 26.8 | 1,064 / 377.2 |

The seven timing regressions executed/passed **7**, failed/skipped **0**. The
dispatcher-owned complete configured application gate 7 executed **514**:
**513 passed, 1 failed, 5 skipped**, three configured/actual workers and zero retries.
The exact `finite protected writer backlog preserves native keyboard and both event loops`
scenario was collected once and passed its first attempt: **1 executed/passed,
0 failed/skipped**. Actual drain was **42,937.9 ms**, runner observation **43,060.0 ms**;
keyboard 146.2/133.7/14.8 ms with durable counts 62→124, 124→186, 186→248;
renderer 2,147 samples / 25.5 ms maximum gap, main 987 / 115.3 ms. All 8,333 items
persisted in 271 submissions, with no errors, exact fresh reopen and two clean exits.
Other cases began 813 ms after native completion. The verifier inspected
`verifier-gate_#2125_7.log` and accepted this native result without retry. The complete
run's unrelated scroll failure remains failed on #2140; its selected dispatcher
rerun `2026-10-19T16-15-00-239Z_verifier-gate-rerun_#2125.log` executed/passed **3**,
failed/skipped **0**, retries zero, including the native prerequisite. That later
result does not turn the original full run into a failure-free run.

## Reopened slow drain cause and correction

The [reopened evidence](https://github.com/pyrycode/pyrycode-desktop/issues/2125#issuecomment-6285238165)
is separate from the resolved observation-clock defect. On `eb35b16f45`, the Linux
prerequisite executed/failed **1**, passed **0**, skipped **522**, retries zero,
two configured/actual workers: **8,277/8,333** persisted, 268 submissions, no flush
completion **67,850.6 ms** after admission (runner 67,896.2 ms). Keyboard
52.5/253.0/250.0 ms and renderer/main gaps 59.5/172.3 ms passed; no writer/diagnostic
errors occurred. Fresh reopen was not reached. No dependent case executed, so two
actual workers in metadata do not establish sibling contention. The unchanged
prerequisite-only rerun separately executed/passed **1**, failed/skipped **0**, two
configured/one actual worker: drain **51,556.7 ms**, 8,333 items/271 submissions,
exact reopen passed. It did not execute the 522 dependents. Unchanged main
`845cf9a251` separately executed/failed **1**, passed **0**, skipped **2**, workers
2/1: completed drain **65,077.8 ms** correctly failed despite passing input/heartbeat
checks. Both failures remain failed; an unchanged rerun establishes no cause.

The checksummed recurrence reports are retained under
`/tmp/builder-2125-reopen/recurrence/`; the linked refinement evidence identifies
both bundle IDs, failed/rerun filenames and original source paths.

The cause was redundant verification of locally constructed authenticated index
nodes in the main-process CPU path. Populating caches only during reads left updates
parsing, hashing and validating newly serialized nodes again.
[`indexedThreadHistory.ts`](../../../src/main/indexedThreadHistory.ts) now caches
constructed radix/sequence nodes under their exact proofs within the operation,
returning detached containers. Unbalanced rotation nodes get only relaxed proofs
until balanced. Later operations/owners authenticate disk again. SQL/schema,
encryption, batching, yields and scheduling remain unchanged.

The [causal regression](chat-history-testing-storage.md#owned-mutation-regressions-and-counted-validation)
failed before correction with **3,349 reparses**, then passed with **zero**, exact
fresh reopen and later corrupted-disk rejection. Under `/tmp/builder-2125-reopen/`,
`causal-red.log` records **1 executed/failed, 0 passed/skipped**, 78 filtered;
`causal-green.log` records **1 executed/passed, 0 failed/skipped**, 78 filtered.

Content-free diagnostics separate IPC totals/maxima/samples from workload and
observation clocks, recording main CPU/profiler aggregates, real safeStorage/SQLite
counts/times, host load and throttling. Wrappers delegate unchanged, retaining no
arguments, results, keys or raw profiles. The finish path restores instrumentation
before normal close. The accepted review notes a nonblocking startup gap:
SQLite/profiler setup precedes cleanup registration and the failure boundary;
setup failure can lose diagnostics and leave wrappers until teardown. Measured
runs initialized and cleaned up successfully.

## Counted reopened Linux validation

The [reopened plan](../../specs/architecture/2125-native-writer-timing.md#revisions--causal-regression-and-final-linux-evidence-2026-10-20)
and [repair PR](https://github.com/pyrycode/pyrycode-desktop/pull/2159) retain the
comparison. Accepted verifier run
`55afa7335001014f2b8b89a282a4635347e5598af427d63db8813d424be43973` reviewed
`b505bf011812970b2b8048afebb735381b8e4691`. All native evidence here uses Linux x64,
Electron **33.4.11**, embedded Node **20.18.3**, ABI **130**, real
**`gnome_libsecret`**, production-backend assertions and retries **zero**.
These are retained native executions, not documentation reruns or replay.
macOS is outside this ticket's verification scope.

`baseline.json` at `8074fabe` and `candidate-1.json` at `18d4fae2` each
executed/passed **1**, failed/skipped **0**, with identical instrumentation,
two configured/one actual worker and preserved prerequisite ordering. Baseline
production writer/storage files match the recurrence. Actual drain fell
**49,945 → 32,289.7 ms**, IPC **49,840.7 → 32,180.3 ms**, main CPU user+system
**53,928.5 → 35,564.8 ms**. SQLite prepare/run/get counts stayed
**356,637 / 305,121 / 57,322**; real safeStorage encrypt/decrypt counts stayed
**17,210 / 813**. CPU self samples fell: `read` **6,238 → 2,450**, `same`
**3,345 → 165**, `Hash` **4,813 → 2,358**. This removes measured index CPU work
with identical durable operations. Baseline native encryption/decryption totaled
278.6 ms; cgroup throttling was zero. Neither host-load observations nor the earlier
three-worker isolation experiment explain the historical external scheduler state.

Five consecutive exact native runs on `18d4fae2` each executed/passed **1**,
failed/skipped **0**, two configured/one actual worker, retries zero. Each preserved
one 8,333-item admission, 271 submissions, no writer/diagnostic errors, advancing
unfinished counts around three real inputs, explicit flush, exact fresh protected-owner
equality and both exits 0 without signals/teardown failures. Artifacts are
`/tmp/builder-2125-reopen/candidate-N.json`, matching `.stderr` files and
`candidate-N-results/` directories. Times are ms; heartbeats give samples/max gap.

| N | Actual drain | IPC | Runner observation | Keyboard x/y/z | Renderer beats/gap | Main beats/gap |
| --- | ---: | ---: | ---: | --- | --- | --- |
| 1 | 32,289.7 | 32,180.3 | 32,517.0 | 89.0 / 126.6 / 143.9 | 1,615 / 24.9 | 1,048 / 88.6 |
| 2 | 29,960.1 | 29,863.9 | 30,109.5 | 76.6 / 14.2 / 82.1 | 1,498 / 24.2 | 998 / 76.0 |
| 3 | 33,554.0 | 33,447.2 | 33,738.9 | 94.7 / 74.4 / 78.5 | 1,678 / 24.6 | 1,066 / 98.5 |
| 4 | 35,218.5 | 35,107.8 | 35,489.9 | 55.7 / 71.3 / 17.1 | 1,761 / 26.5 | 1,117 / 100.2 |
| 5 | 53,777.1 | 53,642.0 | 54,063.6 | 131.1 / 102.6 / 108.2 | 2,684 / 58.1 | 1,443 / 118.6 |

Throttling stayed zero. Run five's CPU total was 54,463.4 ms and one-minute host
load rose 6.25→8.29; this measured context does not establish its slowdown's cause.
The linked plan retains every run's CPU/load measurements.

Builder units executed/passed **79** indexed-storage and **43** related tests
(seven timing + 36 migration), each with **0 failed/skipped**. Supplied dispatcher
unit gate 4 records **9,870 executed/passed, 0 failed, 3 skipped**, explicitly
including the passed constructed-node regression. Host Node 25.8.0 / ABI 141
checks preceded Electron ABI 130 restoration; no rebuild overlapped native execution.
Build/pre-verify passed per the plan.

`collection.json` contains **523** cases: native-writer **1**, clipboard **31**,
parallel **491**, preserving dependencies/global parallelism. Complete application
gate 7 executed **518: 516 passed, 2 failed, 5 skipped**, two configured/actual
workers, retries zero. The named native scenario passed once, first attempt:
**1 executed/passed, 0 failed/skipped**, drain **28,947.4 ms**, keyboard
**74.7/15.9/87.6 ms**, renderer **1,448 samples / 21.2 ms**, main
**1,020 samples / 70.1 ms**, 8,333 items/271 submissions and no errors. Clipboard
then executed **31**, parallel **486** with **5 skipped**. The verifier accepted
this complete result, including execution of both dependent projects.

The message-reply and recorded daemon-history failures remain failed. Selected report
`2026-10-20T08-43-21-405Z_verifier-gate-rerun_#2125.log` separately executed/passed
**3**, failed/skipped **0**, retries zero, including native and both failed cases.
Dispatcher acceptance used its unrelated-flake rerun policy; daemon-history remains
tracked by #2153. The accepted bundle retains `handoff/verifier-2125.md` and `logs/`.

## Earlier writer validation

Recorded Linux x64 evidence for final writer source `ce3a6be7`, reviewed at
`3a9e7a9a`, is retained in the
[plan](../../specs/architecture/2088-bounded-history-writer.md) and
[accepted verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2117#issuecomment-6259224620).
These are retained executions, not new runs by documentation. macOS is outside this
Linux ticket's verification scope; no provider credential or fresh live daemon run
was required. The durations below are the earlier runner-measured intervals, not
renderer admission-to-flush timestamps.

| Recorded execution | Executed / passed / failed / skipped | Native observations |
| --- | --- | --- |
| Builder `/tmp/builder-2088-clock/native-final.json` and `.log` | 1 / 1 / 0 / 0; retries 0 | One admission, 8,333 durable items, 271 submissions, 42,547 ms. Keyboard 73/17/119 ms with durable counts 93→155, 155→217, 217→279, all unfinished. Main 993 heartbeat samples, maximum gap 111 ms; renderer 2,114, maximum 30.9 ms. |
| Accepted dispatcher rerun `2026-10-19T03-44-28-509Z_verifier-gate-rerun_#2088.log` | 3 / 3 / 0 / 0; exact native test present and passed | One admission, 8,333 durable items, 271 submissions, 48,609 ms. Keyboard 130/191/139 ms with durable counts 93→155, 155→248, 248→310, all unfinished. Main 1,059 samples, maximum gap 113 ms; renderer 2,412, maximum 24.9 ms. |

Both native passes report Electron 33.4.11 / embedded Node 20.18.3 / ABI 130 and
real `gnome_libsecret`, both mock-protection switches absent. Exact flush and fresh
protected-owner reopen passed, and both launches exited 0 without signals or teardown
failures. The configured application run remains **506 executed, 505 passed, 1 failed,
5 skipped**; its sole failure was this native test's 60-second drain predicate.
The exact native test passed in the counted rerun above, accepted under dispatcher
rerun policy. All four earlier buffered-close/permission-notice regressions passed
in that configured run; the five skipped tests are not passes.

Packaged proof is separate: `/tmp/builder-2088-clock/packaged.log` and
`packaged/runtime.stdout` / `runtime.stderr` record `check:history-native`, **1 executed,
1 passed, 0 failed, 0 skipped**, stage complete. The same runtime/backend and adapter
12.4.1 report packaged/ASAR/native-unpacked true. Protected replacement/owned update,
plaintext exclusion and exact reopen/traversal assertions passed. Replacement is
validated for correctness here, not included in the input-liveness timing claim.

The supplied configured unit report records **9,479 executed/passed, 0 failed,
3 skipped**. It explicitly includes passing
`protects ordered save parts and exact acknowledgements independently of daemon fences`,
`rolls back a failed data part and its obligation atomically before exact fresh-owner retry`
and `stop leaves repeatedly failed admitted work protected without spinning or manufacturing completion`.
The final builder's five affected files separately executed/passed **232**, failed/skipped
0: admission 56, indexed storage 78, protected cache 34, writer 27 and lifecycle 37.
These cover covered-checkpoint interruption, rollback, exact acknowledgement retries,
owner supersession and frozen-clock flush/stop; a neutral prefix alone missed the
already-covered checkpoint case. Posted-task assertions check every bounded write,
including retry, without depending on incidental elapsed timer ticks.

Captured-client proof has distinct provenance. `/tmp/builder-2088-clock/replay.json`
and `.log` record original `claude-thread` and `daemon-history-on-open`, **2 executed,
2 passed, 0 failed/skipped/retried**, no runner errors and zero forbidden executable
launches. Exact exchanges matched 45/32 requests, emitted 378/63 frames and left zero
requests. Unchanged captures came from Desktop
`00ec821f9380b00cf2dfc0dd4817ee15584106a5`, daemon
`58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`, binary SHA256
`5f5b3b9ce42eda74024637f4929dd720d36c1226ce6e370eb62fbe9e6b22f7c0`.
This is offline captured-client behavior, not fresh provider or native protection proof.

Historical failures stay failed: #2079's original Linux fixture recorded keyboard
commit at 17,187 ms and heartbeat gaps of 12–27 seconds; earlier #2088 collection,
mock-protection and version-zero-barrier failures never established successful
workload execution. `/tmp/builder-2088/replay.json` (1 passed/1 failed) and
`replay-history-rerun.json` (1 failed) preserve coverage-deadline failures that drove
bounded tail coalescing. The protected checkpoint-100 diagnostic
`/tmp/builder-2088-rework/partial-run2.log` records 2 executed/failed, 0 passed/skipped,
each exposing only 31 of 100 admitted items before the independent obligation repair.
Final-source `/tmp/builder-2088-clock/native.json` and `native-retry.json` each record
1 executed/failed, 0 skipped/retried, on the 60-second drain deadline; neither proves
complete heartbeat/drain/reopen acceptance despite responsive input. The configured
native deadline failure also remains separate from its accepted rerun. Later passes
do not rewrite these outcomes or the earlier paused-clock shutdown failures.
