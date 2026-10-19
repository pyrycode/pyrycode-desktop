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
