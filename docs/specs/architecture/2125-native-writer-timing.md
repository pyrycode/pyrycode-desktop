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
