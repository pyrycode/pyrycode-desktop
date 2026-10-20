# macOS protected writer deadline

## Files read

- `e2e/history-writer-native.spec.ts` → `source`: finite admission, renderer timing, native input and protected reopen contract.
- `e2e/historyWriterDiagnostics.ts` → `startWriterDiagnostics`: delegated storage timings, CPU aggregates and host observations.
- `e2e/historyWriterTiming.ts` → `writerWorkloadDuration`: inclusive actual-work deadline, independent of runner observation.
- `src/renderer/src/store/chatHistoryWriter.ts` → `drain`: sequential bounded IPC and task yields.
- `src/main/historyDatabase.ts` → `transactionSteps`: exclusive connection ownership and bounded yielding transaction.
- `src/main/indexedThreadHistory.ts` → `tree`, `sequence`: operation-local authenticated caches and protected roots.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: runtime and evidence boundaries.
- `docs/knowledge/features/chat-history-testing-native.md` → Bounded writer native input proof: previous causal repair does not attribute this recurrence.
- `docs/specs/architecture/2125-native-writer-timing.md`: constructed-node regression and prior Linux measurements.
- `playwright.config.ts`: prerequisite ordering with ordinary downstream parallelism.

## Context

The retained #2176 macOS failure completed in 62413.2 ms, beyond 60000 ms.
Its list report has no storage attachment body; preserve that evidence without
reconstructing missing measurements. One useful behaviour is the finite protected
writer meeting its existing native liveness contract. Attribution and regression
are necessary proof of that repair. No UI change or ADR is proposed.

No other remote feature branch overlaps the anticipated writer/storage paths at
planning time. Main is merged before measurement. Forecast: approximately 450
written lines including this plan, at most two production files, at most two new
exports, no API migration, three observable acceptance criteria and no expected
new product error branches. The plan remains within all five sizing ceilings.

## Design

First run the existing instrumented native scenario with JSON reporting under
ordinary admission on macOS. Compare actual renderer admission-to-flush and IPC
time against delegated safeStorage/SQLite timings, CPU self samples, event-loop
gaps and host load. Add only missing bounded observations needed by that evidence.
Never collect payloads, SQL parameters, credentials, keys or raw CPU profiles.

Select the smallest local writer-drain correction demonstrated by those results;
record its exact contract in a dated revision before implementing it. Consider
whether an existing operation-local abstraction suffices before adding one.
Write an operation-count or correctness regression against unchanged production
code and observe its failure before correcting the demonstrated mechanism.
Passing unchanged reruns and injected delays cannot establish causality.

Preserve all current deadlines, 8333-item admission, bounded submissions/yields,
three real inputs with advancing unfinished durable counts, both heartbeat limits,
real OS backend checks, explicit flush, exact fresh-owner reopen and normal close.
No configuration, retry, sleep, dependency or worker reduction is a repair.

## State + concurrency model

No new application state or IPC surface. Connection ownership remains with the
serialized store queue through transaction yields. Any optimization must stay
inside the existing operation/connection owner and preserve rollback and disk
authentication. Diagnostics delegate unchanged and restore wrappers on completion
or failure; failure attachment collection preserves the original assertion.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| Repeated writes within admission | New causal regression; exact native scenario |
| Later transaction or fresh protected owner | Existing indexed-storage authentication/rollback tests; exact native reopen |
| Deadline or assertion failure | Existing timing units; JSON `native-storage-input` attachment in finally |
| Normal owner shutdown | Native fixture teardown and fresh-owner equality |

## Error handling

Keep typed production storage errors, backend fail-closed checks and existing
transaction rollback. No new failure mode planned. Retain separate failed reports
and result directories. Diagnostic failures are static categories and cannot
replace the scenario's original assertion failure.

## Testing strategy

- Host Node: causal regression red/green, affected storage units and timing units.
- After final main merge: pre-verify on affected units, client-test typecheck and build.
- Finish host checks before Electron native preparation; never overlap ABI rebuilds and execution.
- Instrumented baseline/candidate use unchanged ordinary configuration and retries zero.
- Five consecutive exact macOS prerequisite runs, each 1 passed, 0 failed/skipped,
  then visible-tail selection including dependency, expected 8 passed, 0 failed/skipped.
- Separate JSON reports, logs and result directories retain runtime/backend,
  executed revision, worker/retry identity, timings, input and heartbeat measurements.
- Verifier reviews these artifacts and subsequent complete configured application gate.
  Linux is outside verification scope; no provider credentials are required.

## Open Questions

Which measured writer/storage phase explains the macOS overrun? Resolve with a
controlled regression and baseline/candidate comparison before claiming a repair.

## Security review

**Verdict:** PASS

- Trust boundaries: existing parsed chat-history IPC remains the only renderer-to-storage boundary; no added channel or validation bypass.
- Tokens/secrets: real safeStorage remains required; wrappers retain only counts/times, never arguments or return values.
- Files/storage: existing private profile, transactional writes and protected reopen remain; diagnostic scratch stays outside the worktree.
- Electron surface: no window, navigation, sandbox or bridge change; approved native execution preserves isolation settings.
- Cryptography: no format, key, nonce or algorithm changes; disk-node authentication and operation-local cache proofs remain mandatory.
- Network/I/O: fake relay and bounded production IPC unchanged; no new network endpoint.
- Errors/logs: only bounded timing/count aggregates and static function names; no payload, SQL argument, credential, key or raw profile retention.
- Concurrency: existing single connection owner and yields remain; instrumentation restoration and normal teardown are required on success/failure.
- Threat alignment: relay and hostile-daemon parsing unchanged; compromised renderer still crosses validated IPC; disk theft protection remains fail-closed.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-21

## Revisions — measured correction, 2026-10-21

Baselines at `7e673487` and `ee41da2a` pass, retaining the earlier #2176 failure
separately. Under ordinary four configured / one actual native worker, retries zero,
actual work is 10178.9 / 11615.4 ms; IPC is 10131.3 ms in the first run.
Second-run main CPU is 12098.7 ms, SQL preparation 1561.9 ms for 356637 calls,
SQL execution 1539.1 ms, COMMIT 736.7 ms for 271 commits, protection 42.7 ms.
Main heartbeat max is 46.0 ms. This identifies avoidable CPU in the actual drain,
rather than renderer observation or OS protection latency in these observations.
Reports and complete native attachments: `/tmp/builder-2198/baseline.json` and
`baseline-phases.json`; the latter includes all eight visible-tail selected cases.
The historical overrun's scheduler/host state remains unknown, not reconstructed.

Correction contract: `sequence` and `tree` flush generators lazily prepare their
fixed INSERT and DELETE at most once each per invocation, rebinding every row's
arguments on each execution. Keep every row execution, yielded unit, transaction,
authentication check and operation-local constructed-node proof unchanged.
The simpler existing generator scope owns statements; no global cache, new type,
connection lifetime or read cache is needed. Statements never outlive that flush.

The causal regression measures compilations separately from actual executions
for insertion and deletion, checks real task yields, exact fresh-owner data,
rollback/retry after an interrupted flush, and subsequent fresh-owner use.
It must fail on unchanged storage before the correction. Compare the same native
probe afterward: statement preparations must fall while writes, reads, encryption,
admission and durability stay unchanged. Five consecutive exact native runs plus
the full visible-tail selection remain required. Final scope is one production
file, no new exports/call-site migrations/error branches and under 450 written lines.

Security re-review: PASS. Reusing only compiled SQL retains no authenticated node
or protected payload cache across operations. SQL remains fixed, parameters are
rebound, and any execution error still rolls back the owning transaction.

## Revisions — causal regression and macOS evidence, 2026-10-21

The controlled regression `bounds index SQL compilation per flush while preserving
writes, yields, rollback and fresh owners` fails on unchanged production code:
3592 compilations in one 31-item submission, against a bound of 10
(`/tmp/builder-2198/causal-red.log`, 1 executed/failed, 79 filtered).
It passes with the correction (`causal-green.log`, 1 executed/passed, 79 filtered).
The final pre-verify executes all 80 indexed-storage tests with no failures/skips,
including constructed-node reuse, disk corruption rejection, rotations and rollback.
The related storage/migration/timing run executes/passes 123, no failures/skips.

Native candidate source/build revision is
`3b103f3902ab0fee09761762a31da7253a538ee4`, clean when built and executed,
with final main `f8e4e508f0a25660f1b252fcb19fa99da4b020fc` merged. The only
production difference from instrumented baseline `ee41da2a` is the two local
flush statement caches. Writer/storage production files at that baseline also
match historical #2176 revision `7aa73aa6`. Reports are separate JSON files under
`/tmp/builder-2198/`, each with matching `.log` and `-results/` paths. Every native
attachment is retained inline, with decoded `-native.json` and `-summary.json`
siblings for review. No raw profiler, item body, SQL argument or secret is retained.

Runtime throughout: macOS arm64, Electron 33.4.11, embedded Node 20.18.3 / ABI 130,
real `os-keychain`. Four configured workers; native attachment reports one actual
worker, worker index 0, parallel index 0 and retry 0. Project ordering and downstream
parallelism are unchanged. Commands, with each invocation's unique output path:

`npx playwright test e2e/history-writer-native.spec.ts --retries=0 --reporter=json --output=/tmp/builder-2198/candidate-N-results`

All five consecutive invocations execute/pass 1, fail/skip 0. They preserve exactly
8333 admitted/durable items, 271 submissions, explicit flush and exact fresh-owner
equality. Every input has advancing unfinished durable counts. There are no writer
or diagnostic errors; both launched owners exit 0 without signals/teardown failures.
Heartbeat entries below are sample count / maximum gap in milliseconds.

| Report | Workload ms | IPC ms | Main CPU ms | Keyboard x / y / z ms | Renderer beats/gap | Main beats/gap |
| --- | ---: | ---: | ---: | --- | --- | --- |
| `candidate-1.json` | 6363.4 | 6332.3 | 6398.6 | 21.2 / 20.2 / 19.8 | 300 / 40.0 | 303 / 30.9 |
| `candidate-2.json` | 7873.7 | 7835.3 | 8091.7 | 26.8 / 17.1 / 25.4 | 355 / 50.4 | 330 / 90.1 |
| `candidate-3.json` | 12326.8 | 12265.9 | 13063.5 | 46.7 / 29.3 / 47.4 | 479 / 64.7 | 521 / 39.7 |
| `candidate-4.json` | 8729.5 | 8685.5 | 8993.7 | 35.9 / 36.7 / 32.6 | 377 / 55.3 | 352 / 96.6 |
| `candidate-5.json` | 9343.2 | 9301.1 | 9626.9 | 27.6 / 26.5 / 25.3 | 404 / 65.2 | 385 / 81.2 |
| `visible-tail.json` | 7418.1 | 7381.1 | 7583.7 | 24.5 / 26.9 / 24.8 | 340 / 47.5 | 322 / 37.2 |

The subsequent command selects `e2e/visible-tail-read.spec.ts` with the same flags
and `--output=/tmp/builder-2198/visible-tail-results`: **8 executed/passed,
0 failed/skipped**, retries zero, including native prerequisite and all seven
dependents. No automatic retries, sleeps, skips or bounds changes were introduced.

The measured mechanism is repeated compilation/allocation in the CPU-heavy native
writer drain. Baseline → candidate counts: preparations 356637 → 71221 (285416
removed), while SQL executions 305121, reads 57322, encryptions 17210, decryptions
813 and commits 271 stay identical. Baseline preparation takes 1561.9 ms versus
209.4–460.6 ms across the five candidates. COMMIT remains 729.6–854.8 ms and
protection 26.2–54.8 ms. Baseline self samples include 197 `Statement` samples;
the five candidates record 28 / 31 / 54 / 31 / 44 samples for that function.
Baseline/complete-selection workload is 11615.4 → 7418.1 ms and main CPU
12098.7 → 7583.7 ms; five-candidate median workload is 8729.5 ms. This is actual
removed work with unchanged durable output, not a passing retry or delayed clock.

Host conditions vary: one-minute load before/after the baseline is 5.93/5.20;
candidates are 5.06/5.53, 5.29/5.10, 5.22/5.56, 5.25/5.44 and 4.92/5.61;
the complete selection is 4.73/4.62. Host CPU/memory and main resource counters
remain in each attachment. The third candidate is slower than the baseline and
is retained without exclusion. No historical host-contention or keychain cause is
asserted: the original 62413.2-ms failure has no storage attachment, so its exact
external trigger cannot be reconstructed. Its original failed log/result directory
and separate passing retry remain at `/tmp/builder-2176/visible-tail-merge-20261020/`.
The supported causal claim is removal of measured per-node compilation overhead;
these native observations do not prove that overhead was the sole historical trigger.

Report SHA-256 values (all under `/tmp/builder-2198/`):

| Report | SHA-256 |
| --- | --- |
| `baseline-phases.json` | `2959fd3833b5daa857bbb8932e77ef4230e86f7514612ba9c95ed6dd03d6993f` |
| `candidate-1.json` | `2a11b339d44354c8b2ad818887a92f3f4750cffa7e863f0fa4316a0d81358fbb` |
| `candidate-2.json` | `6484b2e506ef8d9ef0e0bc42468045f00e849ee12a228f30036e411b89429145` |
| `candidate-3.json` | `66c948995673b7372502f0ba005afd6ee9e439a4a3cd8720b3fd5ca6332a5b49` |
| `candidate-4.json` | `870244d1dea3f2cfb37006363a7e20c3f3ac2141e67dde0f83590132d9522971` |
| `candidate-5.json` | `32bc2edea8eef6f20d5445266529cf15edceb04b070a63a68791c7b9afde630e` |
| `visible-tail.json` | `5491487b540afe4ff8065891f1e754efd7c91e3efab3203f63d262f8fa526e2c` |

Final checks: `pre-verify-approved.log` passes all five checks including label/security
review and all 80 affected units; `build-checked.log`, `client-typecheck-fixed.log`
and `docs-guard.log` pass. Node checks finished before `electron-candidate.log`
prepared native execution; no ABI rebuild overlapped any native scenario.
The earlier type-narrowing failure and sandbox label-read logs remain separately.
No native job is left running. Final scope is one production file, no exports,
consumer migrations or product reject branches, three criteria, below 450 written
lines including this evidence. No documentation-only ticket requirement was given.

Verifier handoff: review retained native artifacts and the subsequent complete
configured application gate with prerequisite and dependent projects actually run.
That gate remains pending, not replaced by these focused checks. Linux is outside
this macOS ticket's verification scope.
