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
