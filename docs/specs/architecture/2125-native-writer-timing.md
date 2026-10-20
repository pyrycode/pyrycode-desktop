# Native writer timing reliability

## Files read

- `e2e/history-writer-native.spec.ts` → `source`, native scenario: finite workload, keyboard, heartbeat and protected reopen contract.
- `src/renderer/src/store/chatHistoryWriter.ts` → `createChatHistoryWriter`, `drain`, `flush`: bounded production writes and task yields; no production change planned.
- `e2e/fixtures/launchPairedApp.ts` → `LaunchControl`, `launchPairedApp`: productionSecrets selection and normal launch teardown.
- `e2e/fixtures/productionSecrets.cjs` → pre-readiness hook: removes mock protection switches without changing isolation.
- `src/main/secretBackend.ts` → `selectSecretEncryption`: exact test opt-in; native proof must reject it.
- `playwright.config.ts` → projects, `workerCount`: native proof currently competes with other Electron tests.
- `vitest.config.ts` → include: local e2e timing regressions run under host Node.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: native ABI preparation and counted evidence.
- `docs/knowledge/features/chat-history-testing-native.md` → Bounded writer native input proof: preserve all original liveness and encryption assertions.
- Agents `docs/working-practice.md`, `docs/ticket-scope-policy.md`, `builder/security-review.md`: publishing, scope and audit requirements.

## Context

One behaviour: reliably verify the existing finite native writer liveness contract.
The retained #2119 failed report records 60,347 ms runner elapsed, all 8,333 writes,
271 submissions, no errors, keyboard 160/153/131 ms and small heartbeat gaps.
It cannot establish actual workload duration. #2120 times out before attaching final
diagnostics. Its unchanged selected reruns do not prove a cause.
No product UI change or ADR is needed. No overlapping remote feature branch touches
the planned files (inspection at initial main `0848c1fb`).

## Design

Record nullable monotonic `admittedAt` immediately before the owned store update
and `completedAt` immediately after awaited `writer.flush()` in the renderer.
A single-consumer helper `writerWorkloadDuration(timing): number` rejects missing,
non-finite, reversed or overdue completion; inclusive limit stays 60,000 ms.
Runner observation duration is separate evidence and never the acceptance clock.
Bound completion observation to 65 seconds with short polling intervals; this is
observation headroom only, never a larger workload limit.

Capture renderer counters, errors, timing, inputs and main heartbeat in `finally`,
including failed assertions, without hiding the original failure. Use monotonic
main heartbeat timing too. Preserve one finite 8,333-item admission, real keyboard,
advancing unfinished durable counts, both 1,000 ms heartbeat limits, explicit flush,
exact fresh protected-owner reopen, production backend checks and normal teardown.

Compare the instrumented scenario at three configured workers alone and alongside
the actual overlapping history/hosted specs from the failed gate. Ask whether the
smallest correction is just the clock fix before adding scheduling. If comparison
proves actual contention exceeds the contract, isolate only this scenario in a
prerequisite project; ordinary clipboard/parallel projects depend on it, preserving
their existing parallelism. Record the measured decision in Revisions before handoff.

## State + concurrency model

No product state or IPC changes. Renderer probe owns the writer and heartbeat;
the app owns them until normal close. Main heartbeat is stopped after the observation,
also on failure. Diagnostics run before owner closure; fixture retains normal cleanup.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| Admission followed by flush completion, observed late | local timing regression accepts actual 60,000 ms completion |
| Overdue or absent completion | local timing regression rejects both, including done without timestamps |
| Normal close and fresh same-profile owner | exact native scenario compares all protected contents |
| Assertion/poll failure | finally attachment retains partial counters, timing/errors and heartbeat |

## Error handling

Timing validation throws a static test diagnostic; missing completion cannot pass.
Writer error codes remain in the evidence. Failed diagnostic reads are attached as
static stage failures alongside any successful reads without masking the test error.
No new production failure mode or retry is introduced.

## Testing strategy

- Test first: local timing regressions for late observation, inclusive boundary,
  actual overdue completion, missing completion and invalid timestamps.
- Host Node install/rebuild, affected Vitest and pre-verify, then build and Electron rebuild.
- Controlled three-worker comparison retains failed and passing reports separately.
- Five consecutive exact Linux native runs, retries zero; record revision, runtime,
  backend, worker counts, counted outcomes, workload/input/heartbeat metrics and paths.
- Dispatcher owns complete configured application gate; verifier must inspect this
  scenario's no-retry counted result. macOS is outside this ticket's scope.

## Open Questions

- Does measured actual contention require localized scheduling? Resolve by controlled comparison.

## Security review

**Verdict:** PASS

- Trust boundaries: synthetic probe requests use existing `window.pyry.chatHistory`;
  no IPC channel or validator is changed. No raw socket/key enters the renderer.
- Tokens/secrets: `productionSecrets` and all runtime safeStorage assertions stay;
  reject `basic_text`, mock switches and test backend. No credentials are collected.
- Files/storage: existing private profile owner and exact protected fresh reopen stay;
  reports contain synthetic counters/timestamps, never stored bodies or keys.
- Electron attack surface: alternate renderer is loopback-built test code; existing
  context isolation, sandbox, navigation and bridge allowlists remain unchanged.
- Cryptography: production safeStorage adapter is exercised unchanged; no new crypto.
- Network/I/O: existing bounded fake relay fixture and production IPC remain; the
  completion observation is bounded and cannot authorize an overdue workload.
- Errors/logs: attach static writer codes and timing/counts only, no payloads/secrets.
- Concurrency: finally stops the main timer and preserves fixture owner teardown;
  optional project ordering isolates only the measured native workload.
- Threat alignment: no relay/protocol or daemon parsing changes; existing production
  isolation and encrypted profile checks remain the proof against plaintext fallback.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-19

## Revisions

2026-10-19: instrumented A/B/A comparison at `c7e6db3a` retained in
`/tmp/builder-2125/{alone,contended,alone-after}.json` (each retries zero).
Configured workers three throughout; actual workers 1/3/1. All use Linux x64,
Electron 33.4.11 / Node 20.18.3 / ABI 130 and real `gnome_libsecret`.
The first isolated run failed actual drain at 66,817 ms (runner 66,958 ms),
with 8,333 durable items, 271 submissions, no errors, main gap 668 ms.
The contended run executed 25: 24 passed, native failed main heartbeat at
1,005 ms; actual drain 58,773 ms, renderer gap 44.5 ms, inputs 150/250/307 ms.
The final isolated run passed actual drain at 54,057 ms, main gap 149 ms,
renderer gap 44.3 ms, inputs 123/20/23 ms; exact reopen and both clean exits passed.
Unrelated compilation was observed during both isolated runs; the first failure
remains a genuine failure, not attributed to polling or internal suite contention.

The comparison demonstrates the native proof can fail heartbeat under concurrent
packaged-history/hosted-view execution while its workload deadline passes. Choose
the planned localized prerequisite project to remove this competition, retaining
all thresholds. The initial isolated overrun remains a reliability concern to check
in the five consecutive final runs; scheduling is not claimed to cure external load.
No shared fixture or product changes. Open scheduling question resolved by this
measured correction; final repeated native evidence and complete dispatcher gate
remain required before acceptance.

## Validation evidence

The identical three-spec selection after ordering, at `adc274e938cbe810ab3ed0431a2544557eed99bf`,
is retained in `/tmp/builder-2125/ordered.json` and `.stderr`: 25 executed/passed,
zero failed/skipped/retries. Three configured workers, two actual (only two other
spec files remain after the native prerequisite). Native actual drain 46,404.8 ms,
runner 46,486.0 ms, keyboard 153.4/18.0/96.9 ms, renderer gap 33.9 ms,
main gap 146.8 ms. The first competitor starts 886 ms after the native test finishes.
This contrasts with `contended.json`'s three simultaneous actual workers and failed
main heartbeat; ordering removes that overlap without changing production storage.

`/tmp/builder-2125/collection.json` records all 519 ordinary configured cases,
with the native scenario collected exactly once in `native-writer`. Clipboard keeps
one worker; ordinary parallel specs retain the global worker allocation afterward.

Five consecutive exact native Linux executions on `adc274e938cbe810ab3ed0431a2544557eed99bf`,
each with three configured / one actual worker and retries zero, each executed/passed
1, failed/skipped 0. Runtime: Linux x64, Electron 33.4.11, embedded Node 20.18.3,
ABI 130, real `gnome_libsecret`; all production-backend assertions passed.
Each admits/persists exactly 8,333 items in 271 submissions, reports no writer or
diagnostic errors, brackets all three inputs with advancing unfinished durable counts,
explicitly flushes, compares the entire fresh protected-owner reopen exactly, and
records both app exits 0 with no signals/teardown failures.

All artifacts below are under `/tmp/builder-2125/`; each JSON has a corresponding
`.stderr` and `-results` directory. Heartbeat entries give sample count / max gap.

| Report | Actual drain ms | Runner ms | Keyboard x/y/z ms | Renderer beats/gap ms | Main beats/gap ms |
| --- | ---: | ---: | --- | --- | --- |
| `final-1.json` | 44443.7 | 44488.5 | 131.2 / 129.4 / 33.5 | 2223 / 31.9 | 960 / 166.4 |
| `final-2.json` | 49975.8 | 50063.4 | 135.1 / 117.4 / 21.1 | 2499 / 38.7 | 1065 / 168.0 |
| `final-3.json` | 55347.6 | 55437.0 | 172.2 / 203.1 / 189.6 | 2766 / 51.3 | 1106 / 175.1 |
| `final-4.json` | 54828.4 | 54907.8 | 163.1 / 188.1 / 220.7 | 2739 / 49.9 | 1111 / 278.8 |
| `final-5.json` | 48970.3 | 49031.0 | 22.3 / 144.2 / 77.5 | 2449 / 26.8 | 1064 / 377.2 |

Timing regressions: seven executed/passed, zero failed/skipped. The initial red
run could not import the not-yet-written helper; the completed helper then passes
the on-time/late-observed, overdue and missing/invalid completion cases. The native
`alone.json` failure independently proves actual overdue completion is rejected and
diagnostics survive the failing assertion. That failure remains failed.

Dispatcher handoff: the complete configured application gate is pending, not replaced
by the 25-case comparison or focused runs. Verifier must review its counted native
scenario passing without retry. macOS is outside this ticket's verification scope.
Final scope remains one reliability behaviour, no production files, one exported
test helper, no consumer migrations, four acceptance criteria and two timing rejects;
total written work remains below 350 lines and every sizing ceiling.

Final checks after the last merge of `origin/main` (`0848c1fb`) passed: pre-verify
five checks including seven timing regressions (`pre-verify-final.log`), application
build (`build-final.log`) and docs guard. Electron ABI preparation was restored only
after the Node gate finished (`electron-preparation-final.log`); all paths share the
`/tmp/builder-2125/` evidence directory. No native check is left running.

## Revisions — reopened slow drain, 2026-10-20

### Files read

- `e2e/history-writer-native.spec.ts` → `source`: retain the complete native contract.
- `e2e/historyWriterTiming.ts` → `writerWorkloadDuration`: existing observation repair stays.
- `src/renderer/src/store/chatHistoryWriter.ts` → `drain`: bounded sequential IPC submissions.
- `src/main/chatHistoryStore.ts` → `execute`: serialized storage ownership across yields.
- `src/main/historyDatabase.ts` → `transactionSteps`: transactional native storage and task yields.
- `src/main/indexedThreadHistory.ts` → `tree`, `sequence`, `mutateThread`: authenticated index updates.
- `src/main/electronSecretEncryption.ts` → `electronSecretEncryption`: production protected backend.
- `playwright.config.ts` → `native-writer`: preserve prerequisite ordering and global parallelism.
- `docs/knowledge/features/chat-history-testing-native.md` and `development-verification.md`:
  runtime ABI ordering, historical failed evidence and native acceptance boundaries.

### Context and design

This is the same native liveness invariant. The recurrence at `eb35b16f` is genuine
unfinished work (8,277 durable items after 67,850.6 ms); the unchanged 51,556.7 ms
rerun and 65,077.8 ms baseline do not establish cause. Keep all historical evidence.
No product visuals, schema, encryption format, shared harness migration or ADR.
Remote feature branches inspected against current main: no overlapping planned files.

Add single-consumer, bounded content-free measurements to the exact native proof:
renderer IPC totals/maxima, main CPU profile aggregates, real safeStorage call counts
and time, process CPU usage, host load and cgroup throttling counters. Observation
timestamps remain separate from renderer admission-to-flush and IPC duration.
Wrappers must delegate unchanged to real safeStorage and restore on failure/success.
Run instrumented baseline/candidate at two configured workers, retries zero, retaining
the prerequisite ordering. Use measured hot paths to select a local correction in
the existing indexed writer, with deterministic operation-count/correctness regression
before the correction. Consider existing transaction-local authenticated-node caches
before introducing another abstraction. If measurement instead requires a broader
storage/host repair, stop implementation and link its native blocker.

### State + concurrency and repeated events

No product lifecycle state or public API changes. Any index cache optimization stays
inside its existing transaction-scoped tree instance; never share verified values
across commits, reopened owners or protected roots. Existing transaction yields,
atomic rollback and queue ownership stay. Native probe profiling/wrappers are owned
by its app and stopped/restored in the failure attachment path before normal close.

| Repeated event | Required coverage |
| --- | --- |
| Repeated index updates within one submission | deterministic causal regression and exact native reopen |
| Later submission / fresh owner with same identity | existing indexed-storage tests and exact native reopen |
| Assertion failure / slow or missing completion | existing timing regressions; finally retains partial evidence |

### Error handling and testing strategy

No new product error branch. Existing typed storage errors and fail-closed backend
selection remain. Diagnostics retain bounded static counts/times only, never item
bodies, SQL parameters, keys or credentials. Diagnostic failure cannot mask assertion
failure. Prepare host Node units before rebuilding Electron ABI. Run causal regression
red/green, seven existing timing regressions, affected indexed-storage units, pre-verify
and build after final main merge; then five consecutive exact Linux native executions
at two configured workers and retries zero. Record runtime/backend, counts, workload,
input/heartbeat metrics and paths. Dispatcher owns the complete subsequent gate;
macOS is outside scope.

Open question: which measured writer/IPC/storage phase accounts for the slow drain?
Resolve in a dated revision with baseline/candidate evidence before handoff.
One behaviour, estimated 450 written lines, at most two production files, two new
exports, no consumer migration, four acceptance criteria, no new product rejects.

## Documentation handoff

Pending documentation stage: update `docs/knowledge/features/chat-history-testing-native.md`
under “Bounded writer native input proof” with the remaining cause, correction and
new counted Linux evidence. Preserve the first repair's historical successes and
failures; describe the reopened slow drain separately from its resolved
observation-clock defect.

## Security review — reopened repair, 2026-10-20

**Verdict:** PASS

- Trust boundaries: existing `parseChatHistoryRequest` validates production IPC;
  test wrappers delegate without replacing the backend or bypassing validation.
- Tokens/secrets: real safeStorage and rejection of `basic_text`/test switches stay;
  instrumentation counts calls without retaining arguments, results or keys.
- Files/storage: private profile and transactional protected rows unchanged;
  fresh protected owner compares exact contents. Scratch evidence stays outside tree.
- Electron surface: no new IPC or navigation surface; existing sandbox and isolation stay.
- Cryptography: no algorithm/key/nonce change; any verified-node reuse must be bound
  to the exact existing transaction-local reference, never unchecked disk data.
- Network/I/O: fake relay and production IPC unchanged; all observations bounded.
- Errors/logs: bounded timing/counts and static profile function names only;
  never serialize raw inspector profiles, SQL parameters, payloads or environment.
- Concurrency: profiling timers/wrappers stop in finally, normal owner teardown stays;
  cache lifetime cannot extend beyond the existing tree instance.
- Threat alignment: relay and hostile daemon validation unchanged; compromised-renderer
  storage requests still cross validated IPC; protected storage stays fail-closed.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-20

### Measured correction decision — 2026-10-20

Instrumented production baseline `8074fabe`, `baseline.json` under
`/tmp/builder-2125-reopen/`, executes/passes 1, failed/skipped 0 at two configured /
one actual worker, retries zero. Real `gnome_libsecret`, Electron 33.4.11 / Node
20.18.3 / ABI 130, Linux x64. Actual drain 49,945 ms, IPC 49,840.7 ms, runner
50,213.7 ms. Main CPU user/system 50,131.9/3,796.6 ms; native encryption/decryption
278.6 ms total; SQLite prepare/run/get 7,494.5/5,112.8/497.2 ms. No cgroup
throttling; host load before 4.85/5.82/7.82 and after 4.47/5.59/7.64. CPU samples
include `read` 6,238, `same` 3,345, `Hash` 4,813 and GC 4,067 of 45,719 samples.
Thus IPC transports predominantly CPU-heavy actual index work, rather than a
renderer observation or keychain delay. Host load remains measured context, not
an attribution for the historical failure. Retained recurrence bundle checksums
verified: `/tmp/builder-2125-reopen/recurrence/7b3ee7f480d0f4a38fe77101fbbd1269ad52305931b97dd0daca2c7841afd00b/`.

The existing verified caches are filled only by reads; newly constructed nodes
are serialized, then repeatedly parsed, hashed and revalidated on subsequent
updates in that same submission. Select reuse of those already-owned constructed
nodes via the existing exact-proof cache in `tree` and `sequence`, preserving
copy-on-read containers. Cache only inside the existing per-operation instance;
disk nodes still require full verification. Sequence construction temporarily
permits an unbalanced node during rotation: cache that only for `balanced=false`,
and cache its strict proof only when the balance invariant holds. No SQL/schema,
yield, batch-size, protected backend or scheduling changes.
The new causal regression counts reparses of locally constructed authenticated
nodes in one 31-item submission, then checks exact fresh reopen and rejection of
corrupted disk nodes by a later transaction. Native baseline/candidate comparison
must establish the reduction before claiming this correction resolves slow drain.

## Revisions — causal regression and final Linux evidence, 2026-10-20

The open cause question is resolved as redundant verification of locally constructed
authenticated index nodes in the ordinary writer's main-process CPU path. The test
`reuses constructed authenticated nodes within one owned submission without reparsing them`
fails on unchanged production code with **3,349 reparses** of freshly constructed
nodes in one 31-item submission (`causal-red.log`: 1 executed/failed, 78 filtered).
After the correction it passes with zero reparses, exact protected-disk fresh-owner
contents and rejection of corrupted disk nodes in a later transaction
(`causal-green.log`: 1 executed/passed, 78 filtered). All 79 indexed-storage tests
then execute/pass, including rollback, rotations, replay rejection and identity reuse.

Controlled comparison: baseline `8074fabe` and candidate
`18d4fae2aea128844c3a55a841ca55ae4e24f906` use identical probe instrumentation,
runtime, production backend, two configured workers, retries zero and unchanged
prerequisite ordering. The baseline production writer/storage files are byte-identical
to the recurrence's `eb35b16f`. Only the candidate's constructed-node reuse changes
production behavior. Compare `baseline.json` with `candidate-1.json`: actual drain
49,945 → 32,289.7 ms, IPC 49,840.7 → 32,180.3 ms and main CPU user+system
53,928.5 → 35,564.8 ms. SQLite prepare/run/get counts remain
356,637 / 305,121 / 57,322, and real safeStorage encrypt/decrypt counts remain
17,210 / 813. CPU self samples for `read` fall 6,238 → 2,450, `same`
3,345 → 165 and `Hash` 4,813 → 2,358. This is removal of demonstrated CPU work,
with identical durable storage operations, rather than a faster observation alone.
The retained overdue recurrence remains failed; its external scheduler state is unknown.

Five **consecutive** Linux x64 executions on the candidate each executed/passed 1,
failed/skipped 0, retries zero, two configured / one actual worker. Command:
`PW_WORKERS=2 npx playwright test e2e/history-writer-native.spec.ts --retries=0 --reporter=json`;
each invocation has a separate `--output` directory and report. Runtime is Electron
33.4.11 / embedded Node 20.18.3 / ABI 130, real `gnome_libsecret` throughout.
All retain one admission, exactly 8,333 durable items / 271 submissions, no writer
or diagnostic errors, advancing unfinished durable counts around all three real
inputs, explicit flush, exact fresh protected-owner equality, both app exits 0,
no signals and no teardown failures. Thresholds and backend assertions are unchanged.

All artifact paths below are under `/tmp/builder-2125-reopen/`. Reports are
`candidate-N.json`, with `candidate-N.stderr` and `candidate-N-results/` siblings.
Heartbeat entries show sample count / maximum gap in ms; other times are ms.

| N | Actual drain | IPC | Runner observation | Keyboard x / y / z | Renderer beats / gap | Main beats / gap |
| --- | ---: | ---: | ---: | --- | --- | --- |
| 1 | 32289.7 | 32180.3 | 32517.0 | 89.0 / 126.6 / 143.9 | 1615 / 24.9 | 1048 / 88.6 |
| 2 | 29960.1 | 29863.9 | 30109.5 | 76.6 / 14.2 / 82.1 | 1498 / 24.2 | 998 / 76.0 |
| 3 | 33554.0 | 33447.2 | 33738.9 | 94.7 / 74.4 / 78.5 | 1678 / 24.6 | 1066 / 98.5 |
| 4 | 35218.5 | 35107.8 | 35489.9 | 55.7 / 71.3 / 17.1 | 1761 / 26.5 | 1117 / 100.2 |
| 5 | 53777.1 | 53642.0 | 54063.6 | 131.1 / 102.6 / 108.2 | 2684 / 58.1 | 1443 / 118.6 |

Main CPU totals for runs 1–5: 35,564.8 / 32,774.1 / 36,364.8 / 38,264.6 /
54,463.4 ms. One-minute host load before→after: 3.82→4.40, 3.46→3.14,
3.68→3.94, 4.05→4.84, 6.25→8.29. Cgroup throttling remains zero throughout.
The slower fifth run is retained as measured; higher observed load is context,
not a controlled attribution of its slowdown. IPC continues to track actual work,
independently of the renderer/runner observation clocks.

Collection (`collection.json`) contains **523** ordinary cases: native-writer 1,
clipboard 31, parallel 491. The exact scenario occurs only in native-writer;
clipboard and parallel retain their existing dependencies and parallelism. No
global worker reduction, added retry, skip, storage pause or synthetic input.

Post-final-main-merge checks on candidate `18d4fae2` / main `1c001e0e` passed:
`pre-verify-final.log` (five checks, all 79 indexed-storage tests passed),
`related-units.log` (seven timing + 36 migration tests, 43 executed/passed),
`build-candidate.log` and `docs-guard.log`. Host Node 25.8.0 / ABI 141 checks
finished before `electron-candidate.log` restored Electron ABI 130; no rebuild
overlapped native executions. All native executions and collection have finished.

Dispatcher handoff: the complete configured application gate remains pending. It
must pass this prerequisite without retry **and run the dependent projects**
(522 collected cases, with existing skip reasons retained);
a prerequisite-only rerun cannot establish that acceptance. Verifier must review
the counted complete result. Documentation handoff above remains pending for its
own stage. macOS is outside this ticket's verification scope. Final repair remains
one behavior, one production file, one new test-helper export, no API migration or
new product reject branch, and under 450 written lines including plan and tests.
