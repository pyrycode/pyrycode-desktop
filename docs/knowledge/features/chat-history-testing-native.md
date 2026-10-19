# Protected history testing — native runtime and evidence

Part of [protected history testing](chat-history-testing.md).

## Native runtime and packaged proof

Host-Node Vitest and Electron use different native ABIs. `npm run rebuild:node`
runs `npm rebuild better-sqlite3` for host tests; `npm run rebuild:electron` runs
`electron-builder install-app-deps` for Electron. Rebuild for the runtime being
used after switching ABIs. Production packaging sets `npmRebuild: true` and
`asarUnpack: node_modules/better-sqlite3/**`; a Node import alone cannot prove the
packaged adapter loads.

Prepare host Node before unit gates, then prepare Electron again before the ordinary
app's Playwright gate. `npm install` or a successful Node gate does not establish
Electron readiness. An isolated packaged smoke rebuilds its own adapter copy and
cannot certify the ordinary application's ABI preparation. The activation review
reproduced host Node 25.8.0 / ABI 141 loading an adapter that Electron 33.4.11 /
Node 20.18.3 / ABI 130 rejected. The unchanged full suite passed after the Electron
rebuild; local verifier runner preparation was tracked by #2038, separately from
the managed runner repair in #2018.

The [renderer-retirement PR](https://github.com/pyrycode/pyrycode-desktop/pull/2039)
records the same trap after indexed storage merged: 13 failures in the first
post-merge fake run used the host-Node adapter. Rebuilding for Electron made all
13 pass without source changes. The final counted Linux gate executed/passed
435 cases, 0 failed, 3 skipped. Treat the earlier capture as failed and the later
pass as separate evidence; the rebuild order is Node units, then Electron suite.

On Linux/macOS, `npm run check:history-native -- /tmp/history-native-proof` packages
an isolated entrypoint, launches the packaged Electron app and writes `runtime.stdout`
and `runtime.stderr` beneath the supplied scratch directory. It uses the actual
`electronSecretEncryption` through activated `createChatHistoryStore`, imports
a mixed version-1 source containing an intentionally invalid retired timeline body,
a list and 1,000 retained daemon items. It asserts no legacy scope was imported,
closes/reopens the database and compares parser-normalized retained content
structurally. An owned item revision is committed and all 1,000 retained items
are compared exactly after another fresh reopen, including unchanged peers.
Protected full replacement changes epoch/progress and must match exactly after
a fresh reopen; elapsed replacement time is recorded separately. It checks all
history-directory files for fixture plaintext and reports versions, packaged/asar/native-unpacked flags,
static stage and nonzero test counts. An 801-item authoritative fixture opens the
last 200 shown items despite 500 hidden items, retaining one hidden active item
and two evidence ranges. It records first conversion separately, closes the database,
then checks exact partial content, checkpoint and opaque continuation through a
fresh owner while measuring cold opening. A separate fresh owner then enumerates
all newest/before held windows, including opening omissions, and compares exact
content/order with 801 unique identities alongside opening and retained-item
persistence assertions. Its `saved-recovery` stage loads two held windows, commits
metadata-only invalidation, closes/reopens the database, then follows the paired
capability/continuation to exact recovery of all 801 identities. Recovery elapsed
time and recovered identity count are separate output fields; the original
opening/traversal assertions remain beside the 1,000-item retained replacement.
Plaintext scanning includes the ignored legacy, retained list/item/attachment and
owned-update sentinels. Retired receipt saturation is no longer an active fixture.
Failure or missing/all-skipped evidence is nonzero. It adds no release channel.

[`history-native.spec.ts`](../../../e2e/history-native.spec.ts) includes
`packaged protected history commits and reopens with production encryption` in the
ordinary Playwright configuration and attaches stdout/stderr. This lets a managed
`desktop-fake-suite` task exercise the native proof on the exact pushed candidate
through normal manager admission. On macOS follow the approved Electron-launch
route from the project instructions. Other platforms explicitly skip this case;
direct smoke invocation rejects them before packaging imports or scratch creation.
[`historyNativePlatform.test.ts`](../../../src/main/historyNativePlatform.test.ts)
pins Windows rejection. Run the native proof on the operating system running the
ticket; opposite-OS scheduling is outside scope. Existing NSIS x64/arm64 targets
remain unchanged.

### Bounded writer native input proof

[`history-writer-native.spec.ts`](../../../e2e/history-writer-native.spec.ts) exercises
`finite protected writer backlog preserves native keyboard and both event loops`
through the existing renderer writer, production IPC and real OS-protected storage.
`launchPairedApp` ordinarily selects reversible test encryption with
`PYRY_TEST_SECRET_BACKEND=1`. Its child-local `productionSecrets` option selects the
real adapter and installs a pre-readiness hook removing Playwright's
`password-store=basic` and `use-mock-keychain` switches. Merely unsetting the test
backend flag is insufficient: Playwright's Electron loader supplies those switches
independently. The hook preserves Electron sandbox and isolation settings. Runtime
assertions require encryption availability, both switches absent, no test-backend
selection and, on Linux, a selected backend other than `basic_text`. Evidence records
the actual backend and Electron/embedded Node/ABI/platform identity. The fixture
first durably observes its version-one initial thread; a version-zero readiness
barrier previously failed before workload admission.

The isolated mounted input admits exactly one generated 8,333-item owned change,
then stops production: 6,396 tool calls, 889 assistant messages, 556 turn endings,
345 user messages, 135 agents and 12 session dividers, with valid relationships and
non-secret strings at most 256 characters. It measures real keyboard dispatch through
React input commit while durable item counts positively advance and remain unfinished
on both sides of each observation. Storage is never paused for input. Recurring main
and renderer heartbeats cover the complete drain, including its tail. Assertions
require each input and every heartbeat gap within 1,000 ms, all work drained within
60 seconds of admission, explicit flush, exact fresh protected-owner reopen and normal
teardown. The input isolates storage without product visual changes or #2079 renderer
admission changes. This proves ordinary writer/storage liveness; renderer admission,
import, retained-format conversion and full replacement (`replaceThread`) are excluded.
Compact transport and lazy presentation remain separate work.

#### Completion clock and scheduling

The renderer records monotonic `admittedAt` immediately before the owned store update
and `completedAt` immediately after awaited `writer.flush()`. The local
[`writerWorkloadDuration`](../../../e2e/historyWriterTiming.ts) helper requires finite,
ordered timestamps and an actual duration at most **60,000 ms**, inclusive. Missing
completion fails even if a completion flag is supplied. Runner `runnerElapsed` and
renderer `observedAt` are separate diagnostics: setup before admission and delayed
polling after flush must not count as workload time. Completion polling has a bounded
65,000 ms allowance with 100 ms intervals; this observation allowance cannot make an
actual overdue workload pass. The seven
[timing regressions](../../../e2e/historyWriterTiming.test.ts) accept a 60,000 ms flush
observed later and reject overdue, missing, reversed and non-finite timestamps.

The `native-storage-input` attachment is collected in `finally` on assertion/poll
failure as well as success, before owner closure. It retains partial admitted/durable
counts, submissions, writer error codes, both timestamps, actual and runner durations,
input measurements, heartbeat counts/gaps, runtime/backend identity and worker/retry
identity. Failed renderer/main diagnostic reads receive static stage codes alongside
any successful reads. Main heartbeat timing is monotonic too, includes the final
observation gap and stops on failure. Diagnostics must survive a deadline failure;
attaching only after a successful completion poll would lose the evidence needed to
distinguish missing completion from slow work or late observation.

[`playwright.config.ts`](../../../playwright.config.ts) collects this scenario exactly
once in the one-worker `native-writer` prerequisite project and excludes it from
`parallel`. Both `clipboard` and `parallel` depend on it. Merely giving a project one
worker still lets other projects overlap its Electron workload; dependency ordering
prevents that competition. Afterward, clipboard retains its one-worker cap and runs
alongside unrelated parallel specs with the existing global worker allocation. Project
ordering addresses measured competing-test heartbeat sensitivity, not arbitrary
external host load; all workload, keyboard and heartbeat limits remain unchanged.

#### Counted timing repair validation

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

#### Earlier writer validation

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

### Counted legacy storage retirement validation

The [final verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/2048#issuecomment-6223383960)
and dispatcher gate report record Linux x64 on 2026-10-16 at
`b2ce9704efd144bc3f1d45636e734a37bc4a4d4f`. This contains implementation
`446a5171209c377ed13115ceed353228f9289ef7` and integrated main `ebea25db7928`;
the intervening change records validation only. These fresh results supersede
the earlier 9,106-unit/435-application acceptance totals:

| Run or included named case | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Full units, 402 passing files | 9,291 | 9,291 | 0 | 3 |
| Complete configured application suite, verifier gate 8 | 492 | 492 | 0 | 4 |
| `packaged protected history commits and reopens with production encryption`, included above | 1 | 1 | 0 | 0 |
| History-on-open captured replay, included above | 1 | 1 | 0 | 0 |
| Builder separate guarded history-on-open replay | 1 | 1 | 0 | 0 |

The packaged test is explicitly present and passed in gate 8. The verifier inspected
raw `/tmp/pyry-history-native-07920c/runtime.stdout` and `runtime.stderr`:
Electron 33.4.11 / embedded Node 20.18.3 / better-sqlite3 12.4.1, production
`gnome_libsecret`, packaged/ASAR/native-unpacked true. Mixed-source ignore and
retained list/item import, protected replacement/fresh reopen, owned update,
plaintext exclusion, bounded opening and exact traversal/recovery of all 801
identities pass. Raw stderr contains system-bus/GPU diagnostics without failed
storage assertions. These are recorded production-encryption results; reversible
unit encryption and captured replay alone could not establish them.

The complete suite used four actual workers, both projects, no selection/shard
filters, zero flaky results/retries, no top-level errors or fake-daemon-setup
failure attachments. All 29 recorded exchanges finished with zero remaining
requests. Application skips are three macOS-only cases and the existing
system-prompt-reset fixme; unit skips are existing opt-in checks. Pre-verify,
install, native rebuilds, build and docs guard passed. The gate manifest and
counted unit/application reports are
`/work/Projects/pyrycode-desktop-agents/logs/verifier-gate_#2026.pass.json`,
`verifier-gate_#2026_5.log` and `verifier-gate_#2026_8.log` in that logs directory.
macOS is outside this Linux ticket's verification scope.

`a real daemon lazily fills a served gap after more than 200 entries written while
Electron is closed` remains enabled in `real-daemon-history-on-open.spec.ts`. The
verifier explicitly confirms this scenario passed in the complete gate and records checkpoint 2, successful resume and zero legacy requests in the
passing scenario. The builder's separate guarded replay records zero forbidden
executable launches. These establish captured-client behavior, with no fresh
live-provider claim. The [operator handoff](https://github.com/pyrycode/pyrycode-desktop/issues/2026#issuecomment-6217676663)
closed #2046 and retired the automatic live hold; the obsolete skip was removed.
The withdrawn native repair task ran no worker and supplies no test pass.

Historical live failures remain failed. The candidate and unchanged main
`41bd0e2173d5` each recorded **1 executed, 0 passed, 1 failed, 0 skipped** at the
initial channel-post baseline, before storage assertions. The
[plan's original validation](../../specs/architecture/2026-retire-legacy-history.md#validation--linux-x64-2026-10-16)
retains `/tmp/builder-2026/live-source.json`, `/tmp/builder-2026/main-live.json`,
the baseline screenshot and daemon provenance. The later automatic live run
`2026-10-16T06-36-03-277Z` timed out with unreadable/incomplete output and has no
per-test counts. Neither that run, gate retirement nor the replay pass converts
those failures into live acceptance or creates a pending automatic gate.

### Counted saved traversal recovery validation

The [recovery verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/2067#issuecomment-6218610544)
records Linux x64 on 2026-10-16 at `5e84fc20d0ef7f175f7d3b2f1d1ce0e488b51340`:
units **9,240 executed/passed, 0 failed, 3 skipped**; complete configured gate 8
**468 executed/passed, 0 failed, 4 skipped**. The named
`packaged protected history commits and reopens with production encryption` case
is explicitly present and passed: **1 executed/passed, 0 failed, 0 skipped**, included
in that gate. See [restoration evidence](chat-history-testing-restoration.md#counted-saved-traversal-recovery-validation)
for both named mounted recovery passes and suite configuration.

The verifier inspected `/tmp/pyry-history-native-fPNChw/runtime.stdout` and raw
`runtime.stderr`: Electron 33.4.11 / embedded Node 20.18.3 / better-sqlite3 12.4.1,
production `gnome_libsecret`, packaged/ASAR/native-unpacked true, stage complete.
All **801 saved identities/content recovered after invalidation and fresh reopen**
in **507 ms**; cold opening **123 ms**, initial conversion **3,866 ms**. The retained
100,000-membership replacement assertion passed. Raw stderr keeps system-bus/GPU/
colour diagnostics beside successful counted completion; empty stderr is not the
success criterion. These are recorded production-protection results, not a fresh
live run. Other operating systems and real Claude are outside this ticket's scope.

The builder's [indexed measurements](../../specs/architecture/2064-saved-traversal-recovery.md#validation-evidence)
at implementation `823b6dd2daca7e079d0237153956fd2d09bda786` separate 20-item recovery
selection from structure, loaded depth and replacement. Depth is the number of
before-pages after the initial newest page; depth 4 uses same-epoch replacement,
and depths 1/8 use metadata mutation:

| Fixture items | Loaded depth | Replacement | Records / payloads / decrypts | Structural reads | Recovery ms |
| ---: | ---: | --- | --- | ---: | ---: |
| 262 | 1 | no | 23 / 20 / 45 | 322 | 38.4 |
| 262 | 4 | yes | 23 / 20 / 45 | 320 | 31.1 |
| 262 | 8 | no | 23 / 20 / 45 | 319 | 31.5 |
| 1,242 | 1 | no | 22 / 20 / 44 | 361 | 63.1 |
| 1,242 | 4 | yes | 22 / 20 / 44 | 365 | 59.3 |
| 1,242 | 8 | no | 22 / 20 / 44 | 365 | 74.7 |

Both fixture sizes retain opening **206 records / 202 payloads / 408 decrypts**;
structure is **1,583 / 1,992 reads**. Cold opening is **239.9 / 491.6 ms**, initial
conversion **2,591.5 / 11,768.9 ms**. Existing 200-item held-traversal assertions
remain. The verifier confirms the 20 selected payloads, 22–23 records, 44–45 decrypts
and 319–365 structural reads. Payload work must stay independent of loaded depth
and unrelated older/hidden/range history; authenticated structure may grow
logarithmically. Replacement pays index rebuild during its write transaction;
one-time retained conversion is measured separately. These are bounded-work
measurements, not latency thresholds.

The builder's separate packaged run (`/tmp/pyry-history-native-JGXDxb/runtime.stdout`
and raw `runtime.stderr`) executed/passed **1**, failed/skipped **0**, with the same
production runtime/protection flags. It recovered 801 identities in **709 ms**,
with initial conversion **7,001 ms**, cold opening **197 ms** and retained
100,000-membership replacement **10,314 ms**. It is included in the builder's
468-executed, zero-failed, four-skipped full suite; the verifier's later measurements
above are a distinct run. Historical failed migration/setup captures remain
[recorded separately](chat-history-testing-restoration.md#counted-saved-traversal-recovery-validation).

### Counted unchanged saved traversal validation

The [post-merge verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/2066#issuecomment-6217180444)
records Linux x64 on 2026-10-16 at `8fa5f23fc349c11d1564dfbb54d3ece845a74636`:
full units **9,228 executed/passed, 0 failed, 3 skipped**; complete configured
Playwright gate 8 **466 executed/passed, 0 failed, 4 skipped**. The named
`packaged protected history commits and reopens with production encryption` case
is explicitly present and passed: **1 executed, 1 passed, 0 failed, 0 skipped**.
Both mounted held-reply/offline traversal cases also passed; see
[counted restoration evidence](chat-history-testing-restoration.md#counted-unchanged-saved-traversal-validation)
for suite configuration, historical repaired failures and scope.

The verifier inspected `/tmp/pyry-history-native-n6DVpj/runtime.stdout` and
`runtime.stderr`: Electron 33.4.11 / Node 20.18.3 / better-sqlite3 12.4.1,
production `gnome_libsecret`, packaged/ASAR/native-unpacked true, stage complete.
The 801-item fresh-opening/exact-traversal fixture and 100,000-membership persistence
fixture passed. Conversion took **3,840 ms**, cold opening **110 ms**. Raw stderr
contains system-bus/GPU/network-service diagnostics without failed storage assertions.
This is recorded packaged production-protection evidence, not a fresh live run.
Other operating systems and real Claude are outside this ticket's scope.

The existing indexed opening counter fixture additionally measures a 200-item
newest held page, resetting its counters after opening. The builder's
[implementation measurements](../../specs/architecture/2063-saved-thread-traversal.md#validation-evidence)
separate selected records/payloads/decrypts, authenticated structure and conversion:

| Fixture items | Opening records / payloads / decrypts | Opening structural reads | Opening cold / conversion ms | Traversal records / payloads / decrypts | Traversal structural reads / cold ms |
| ---: | --- | ---: | --- | --- | --- |
| 262 | 206 / 202 / 408 | 1,583 | 369.2 / 2,716.8 | 203 / 200 / 403 | 282 / 255.1 |
| 1,242 | 206 / 202 / 408 | 1,992 | 408.6 / 13,706.5 | 202 / 200 / 402 | 262 / 164.4 |

The final verifier confirms the same 200 selected traversal payloads and 403/402
decrypts; current unit cold-opening times were 317/458 ms and traversal times
180/168 ms. Selected work stays bounded as unrelated history increases;
authenticated structure work may grow logarithmically. Import/conversion is paid
separately and can scale with saved history. These timings establish no latency
threshold. Counting payloads/decrypts alone would miss repeated structural work.

### Counted bounded-opening validation

The [bounded-opening verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/2062#issuecomment-6215044001)
reviews Linux x64 head `b64334baa9d5ef1885296d93bfa5f7992c756b2a` on 2026-10-16.
The inspected builder reports cover implementation
`17901342573d182351400caca03babb767af0fbf`, after main
`c369bb4728c07111d0fde6c33b02166780458e87`; only the plan's validation record changed
before the reviewed head. The dispatcher separately records all verifier gates
passed on that head, with counted fake gate 8:

| Run or included case | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Builder approved full units, 392 files | 9,138 | 9,138 | 0 | 3 |
| Builder complete configured fake suite, both projects/two workers | 436 | 436 | 0 | 3 |
| Mounted restore/live/held-reply case, included in builder suite | 1 | 1 | 0 | 0 |
| Packaged production-encryption case, included in builder suite | 1 | 1 | 0 | 0 |
| Dispatcher verifier fake gate 8 | 436 | 436 | 0 | 3 |

The verdict confirms that `restore overlapping live content retains complete progress
across an interrupted catch-up and epoch replacement` and `packaged protected history
commits and reopens with production encryption` are present and passed in the
inspected builder report. Each executed/passed once with zero failed/skipped, within
the 436-executed, zero-failed, three-skipped suite. The dispatcher report supplies
aggregate counts without named-test results; it is not the source of those named
passes. The builder suite had no flaky results or global errors. The plan records
zero retries and no fake-daemon-setup attachment.

The mounted capture `bounded-opening-held-reply.png` at 1100×773 shows saved-only
rows, newer live facts and pending loading together. The fixture proves local
visibility before server release, coordinator resume from the admitted epoch and
checkpoint, and exclusion of unrelated older shown rows while retaining the hidden
active item. See [restoration traps](chat-history-testing-restoration.md#restoration).

Instrumented protected fresh-owner measurements, inspected by the verifier, separate
selected work from structural traversal and one-time conversion:

| Fixture items | Base / active / dependency / evidence | Protected record reads / payload reads / decrypts | Structural reads | Cold opening ms | Conversion ms |
| ---: | --- | --- | ---: | ---: | ---: |
| 262 | 200 / 1 / 1 / 3 | 206 / 202 / 408 | 1,583 | 1,015.5 | 7,576.1 |
| 1,242 | 200 / 1 / 1 / 3 | 206 / 202 / 408 | 1,992 | 796.6 | 31,035.8 |

These runs shared the machine with other checks and establish bounded selected
work, not a latency threshold. The earlier focused capture recorded cold
454.9/439.0 ms and conversion 2,552.9/12,544.4 ms for the same small/large fixtures.
Replacement and one-time collection import/retirement precede the cold measurements;
fresh owners do not repeat them. Structural growth is separate from constant
selected placement/payload decoding.

The inspected `/tmp/pyry-history-native-ZdFgoe/runtime.stdout` and `runtime.stderr`
record Electron 33.4.11 / Node 20.18.3 / better-sqlite3 12.4.1, production
`gnome_libsecret`, packaged/ASAR/native-unpacked true and `stage: complete`.
The 801-item packaged fixture selects 200 shown, one hidden active item, zero
dependencies and two evidence ranges: conversion 3,873 ms, cold reopen 118 ms.
The retained 100,000-membership full replacement also passed, taking 5,931 ms.
Raw stderr retains system-bus/GPU/network-service diagnostics alongside successful
counted completion; an empty stderr is not the success criterion.

Build and docs guard passed. The dispatcher also records successful install,
pre-verify `--no-suite`, Node/Electron rebuilds, units and build; its unit exit code
supplies no new per-test count. The counted unit evidence above comes from the
verifier-inspected `/tmp/builder-2059/pre-verify-approved.log`; the builder fake report
is `/tmp/builder-2059/fake-suite.json`. The
[plan validation record](../../specs/architecture/2059-bounded-saved-opening.md#validation-evidence)
retains artifact paths and the separate focused ancestor assertion pass.

Earlier sandbox captures remain failed: initial setup lacked the SQLite binding,
and initial sandbox pre-verify failed 68 socket cases with `listen EPERM` and could
not read security labels. The approved passes above are separate runs. Unit skips
are existing opt-in relay/interoperability checks; fake skips are two macOS badge
cases and macOS window reopen. macOS is outside this Linux ticket's verification
scope; no live-Claude acceptance was introduced or claimed. These results are
recorded evidence, not documentation-stage test reruns.

### Counted stable-binding validation

The [stable-binding verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2045#issuecomment-6209414001)
records Linux x64 evidence at `61ec3eaf44cea1e16d58c2bf2bc28e3b81f28568`
(2026-10-16), superseding the earlier builder totals:

| Run or included module | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Full unit suite, 392 passing files | 9,165 | 9,165 | 0 | 30 |
| Indexed authoritative module, included above | 38 | 38 | 0 | 0 |
| Migration module, included above | 21 | 21 | 0 | 0 |
| Application history-store module, included above | 14 | 14 | 0 | 0 |
| Complete configured fake suite, original gate 8 | 435 | 434 | 1 | 3 |
| Separate visible-tail rerun | 2 | 2 | 0 | 0 |
| Packaged production-encryption case, included in gate 8 | 1 | 1 | 0 | 0 |

The supplied gate report explicitly lists
`packaged protected history commits and reopens with production encryption` as
present and passed. The verifier inspected `/tmp/pyry-history-native-XpWH6e/runtime.stdout`:
Electron 33.4.11, Node 20.18.3, SQLite adapter 12.4.1, production `gnome_libsecret`,
packaged/ASAR/unpacked flags true and `stage: complete`.

The original fake gate failed
`committed folded tails require focus, uncovered viewport and a closed reader`.
That exact test is present and passed in the separate two-executed, zero-failed,
zero-skipped rerun, according to the verifier's inspected dispatcher report.
The verifier records dispatcher acceptance as unrelated flakiness; the original
failed capture remains failed and is not a new full-suite pass. The supplied gate
report retains only the original run. Its three skips are macOS-only cases;
macOS is outside this Linux ticket's verification scope.

Install, native adapter preparation, typecheck, build and docs guard passed per
the verdict. Pre-verify recorded three passed checks and two intentional
`--no-suite` skips, with units/typecheck in subsequent gates. This storage-only
change required no live-Claude run. The verdict links dispatcher gate logs
5/6/8 and the `2026-10-16T06-16-49-715Z` rerun; these are recorded evidence,
not tests rerun by documentation.

The [activation verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2019#issuecomment-6208451299)
and dispatcher gate 8 record Linux x64 acceptance on
`2af705788086ec1339f0b271a891da19b18e956f` (2026-10-16):

| Run or included module | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Full unit suite, 420 passing files | 10,247 | 10,247 | 0 | 30 inherited |
| Migration module, included above | 21 | 21 | 0 | 0 |
| Protected store module, included above | 14 | 14 | 0 | 0 |
| Handler admission module, included above | 7 | 7 | 0 | 0 |
| Daemon-item history module, included above | 6 | 6 | 0 | 0 |
| Removal/unpair integration module, included above | 6 | 6 | 0 | 0 |
| Daemon-item cache integration module, included above | 5 | 5 | 0 | 0 |
| Update draining module, included above | 15 | 15 | 0 | 0 |
| Complete configured Linux Playwright suite | 435 | 435 | 0 | 10 existing |
| Packaged production-encryption case, included above | 1 | 1 | 0 | 0 |

The named `packaged protected history commits and reopens with production encryption`
case is present and passed. The verifier inspected both attachments and raw
`/tmp/pyry-history-native-pjNuvq/runtime.stdout` / `runtime.stderr`: Electron
33.4.11, embedded Node 20.18.3, better-sqlite3 12.4.1, `gnome_libsecret`,
packaged/asar/unpacked true and `stage: complete`. Exact two-format import/reopen,
full replacement/fresh reopen and plaintext rejection passed; saturated replacement
took 3,877 ms. The report stderr attachment is empty; raw stderr retains
system-bus/GPU diagnostics with successful counted completion.

The full fake gate ran both configured projects with four concurrent worker slots,
zero retries/flaky results, no filters and no global errors, after Electron
preparation. All 15 `thread-activation.spec.ts` cases, both [indexed quit/window cases](chat-history-testing-restoration.md#recording-and-removal) and `local list read failures stay beside the saved host` are
present and passed. The ten skips are seven retired legacy scenarios and three
macOS-only checks; skips establish no execution proof. macOS is outside this Linux
ticket's verification scope. No live-Claude spec changed or live run was required.
Verifier artifacts are retained under `/tmp/verifier-2019/current-2af70578/`;
full report SHA256 is `1c4b5faf5de7b9c65324dd9a476467fefcdc3b820cb07b058aa53bcf3f3fcabe`.

Historical activation failures retain their status. The initial Linux gate on
`54d7010a` executed 434: 421 passed, 13 failed, 10 skipped; its ABI diagnostic rerun
executed/passed 13, failed/skipped 0 and did not replace the complete gate. The
later Linux focused run on `41fbd1f4` executed 19: 18 passed, one inspection-context
failure, zero skips/retries; the unchanged case passed alone (1/1) and in the final
focused group (19/19), both with zero failures/skips. #2035 records that intermittent
inspection failure without claiming its cause repaired. Earlier Mac capture
`d89f50d5` remains 438 executed, 437 passed, one failed, one skipped; abandoned final
task `a1e15a53baa351db3fb77b5e6f613e289d8b4e878d0911e6b9c20b748afa55bf`
on `109888c4` was settled interrupted with no results and drained custody. Neither
that interrupted task nor a passing earlier revision proves final Mac acceptance.
The [activation plan](../../specs/architecture/1975-activate-indexed-history.md#revisions)
retains the full chronology, including earlier failed ABI captures.

Earlier backend-only proof from the [final verifier review](https://github.com/pyrycode/pyrycode-desktop/pull/1996#issuecomment-6189261285)
confirmed retained production-encryption artifacts from candidate
`f2ef9815571c2ce773a0d736e0ec32d0f26b776a`, whose backend/native/dependency/packaging
files matched that review's head. The named packaged case above was present and passed
on both platforms, with `packaged`, `asar` and `unpacked` all true:

| Platform/architecture | Electron | Embedded Node | better-sqlite3 | Encryption backend | Executed | Passed | Failed | Skipped |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| Linux/x64 | 33.4.11 | 20.18.3 | 12.4.1 | `gnome_libsecret` | 1 | 1 | 0 | 0 |
| macOS/arm64 | 33.4.11 | 20.18.3 | 12.4.1 | `os-keychain` | 1 | 1 | 0 | 0 |

Linux evidence is `/tmp/pyry-history-native-oIcJN0/runtime.stdout` and
`/tmp/builder-1979/rework-54c52c4c/linux-native.log`. Managed Mac task
`3e410b97e50a5471f7ce4e37030f5781e4ad1f84b12f515c8520d95a72e515e8`, run
`9297b2992b3b45cb013a6c5f392611eb5e33ca3e7526636e4eb6853acefc73cd`, returned
`/tmp/builder-1979/rework-54c52c4c/mac-results/desktop/playwright.json` with complete
native stdout/stderr attachments; its native case passed in 8.899 seconds with
empty stderr. Exact runtime JSON and artifact locations also live in the
[architecture plan](../../specs/architecture/1979-protected-indexed-legacy-history.md#revisions).

That earlier full Mac suite was not green: 408 executed, 406 passed, 2 failed,
1 skipped, 0 retries. Its pre-launch HTTP 404 remains tracked by #1983 and missing
connect-b completion by #1998; neither is native-backend evidence. The dispatcher's
later supplied verifier gate 6 reports 414 executed, 413 passed, 1 failed, 3 skipped;
`native view retires on unpair` and
`connect roster Agents appear before history and keep identity through live and historical launches`
are individually listed as passed. Its aggregate counts do not identify the native
case, so the retained per-platform artifacts above establish that proof. No live
Claude test was required for that backend-only change.

