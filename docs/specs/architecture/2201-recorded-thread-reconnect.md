# Recorded thread reconnect ordering

## Files read

- `e2e/fixtures/recordedExchange.ts` → `RecordedExchange`: strict request, close and connection ownership.
- `e2e/fixtures/clientScenario.ts` → `replay`: authenticated fake-daemon callbacks and profile retirement.
- `e2e/fixtures/phaseReconnectEvidence.ts` → `watchPhaseReconnect`: renderer-delivered connection observations.
- `e2e/real-claude-thread.spec.ts` → daemon-built thread scenario: reconnect dispatch and original assertions.
- `src/main/transport/fakeDaemon.ts` → `handleReconnect`: authenticated hello recovery before replay advancement.
- `src/main/transport/fakeRelayForwarder.ts` → `closeClientAfterServerFrames`: actual prefix forwarding before close.
- `docs/recorded-tests.md` → Replay contract: immutable inputs, strict matching and guarded build profiles.
- `docs/client-replay-migration.md` → shared scenario assertions and physical-proof exclusions.
- `docs/knowledge/features/development-verification.md` → captured-close tails and build provenance.

## Context

One behavior ships here: the complete-thread scenario crosses its original reconnect boundary without an extra transition or lost replay progress. Attribution, the controlled regression and correction are inseparable. The historical macOS failure remains separate from this Linux execution. No UI changes or documentation-stage requirements apply.

The supplied failure stops at the exact connection-2 prefix of 23 requests and 124 frames. Its next request is `list_conversations`; reset and the second submitted turn still belong to connection 2. A third authenticated handshake at this position must remain an error. Current source replays captured closes independently of the scenario's explicit reconnect dispatch. Execution must establish their ordering before selecting the correction.

No overlapping remote feature branches touch the proposed files at initial admission. Scope forecast: approximately 650 written lines, at most two new exported contracts, no signature migration, three observable acceptance behaviors and fewer than ten rejection branches. The nearest shipped analogue is #2072 / PR #2130 (393 added lines). Reassess against the demonstrated mechanism before expanding scope.

## Design

Add bounded, payload-free replay diagnostics at the existing adapter boundaries: initial/reconnect authenticated hello callbacks, request progress, scheduled recorded close, scenario dispatch, renderer connection observation and the first exchange error. Retain numeric ordinals, prefix positions/counts and static event/error categories only. Diagnostics never dispatch, release a checkpoint, alter scheduling or fabricate a connection.

Use Electron execution of the exact paired cases to distinguish an extra dispatch from lost prefix progress and an observer discrepancy. Correct only the demonstrated ordering mechanism, with its directly consumed adapter/lifecycle regression. Record the final interface and evidence in Revisions before handoff. A simpler shape must be considered once the mechanism is known: prefer a local ordering/ownership change over general transport redesign.

Full-envelope matching, connection/device binding, recorded close positions, forwarding acknowledgement, completed-profile retirement and `assertComplete()` remain authoritative. No input bytes, timeouts, retries, skips, production projection policy or original stream/reset/saved-reopen assertions change.

## State + concurrency model

Replay stays a single writer in the Playwright worker. Each fake daemon authenticates each new Noise handshake before invoking replay callbacks. The existing exchange owns prefix position; the relay owns successful socket forwarding; the page observer owns delivered connection count. Diagnostics retain bounded snapshots and are attached on failure as well as success. Existing fixture teardown owns sockets, observer cleanup and profile retirement.

## State transitions and identity reuse

| Event | Required coverage |
| --- | --- |
| Captured close and scenario reconnect race | Controlled adapter/lifecycle regression selected from the Electron trace; exact paired thread scenario |
| New authenticated handshake before old prefix completes | Existing strict reconnect tests plus the causal regression's negative control |
| Repeated drain/request or earlier error | Existing sticky-error, duplicate-request and close-once controls |
| Saved-profile exit/relaunch with reused chat identity | Original thread saved-reopen assertions and completed-profile retirement controls |

## Error handling

The first strict exchange failure remains sticky and attributable. Diagnostic observers must not replace it. Incomplete prefix, wrong connection/device, unreleased checkpoint and wrong envelope remain failures. No captured payload, daemon text, credentials, keys or handshake bytes enter diagnostic output.

## Testing strategy

- Install dependencies before validation; prepare Electron SQLite after Node checks.
- Write the controlled regression first and retain its failing output before implementing the correction. Exercise the actual adapter/lifecycle path, with strict negative controls.
- Run affected unit files and client-test typecheck.
- Run five consecutive guarded complete-thread paired batches with the exact supplied case names, `--fully-parallel --workers 3 --repeat-each 2 --retries 0`. Require 4/4 each, overlapping worker identities, thread 45/378/0, history 32/63/0 and zero forbidden launches.
- Run the complete guarded recorded suite; preserve the existing system-prompt-reset fixme.
- After the final main merge, run pre-verify on the affected unit file and `npm run build`. Keep failed evidence under `/tmp/builder-2201/` separately from passing batches. Record compilation provenance and bundle hashes separately from input checksums/capture source.

## Open Questions

- Does actual Electron execution establish an extra/early scenario dispatch, a lost replay prefix or an observer error? Resolve through bounded trace before correction.
- Which local ownership boundary prevents that demonstrated race? Resolve with a failing controlled regression, then document the final contract in Revisions.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] `parseRecording` validates input; `handleReconnect` authenticates and parses hello before invoking the replay callback. Preserve both boundaries and full identity/envelope checks.
- [Tokens/secrets] Diagnostics use only static categories and numeric counters, never hello fields, device IDs, payloads, Noise bytes or credentials. Existing safeStorage ownership is unchanged.
- [Files/storage] Evidence uses task-owned temporary paths; no daemon text becomes a path. Captured files and protected profile storage are unchanged.
- [Electron attack surface] No IPC channel or renderer privilege is added. Existing reconnect IPC validation and isolated renderer configuration remain unchanged.
- [Cryptography] Existing Noise implementation and fresh handshake cipher swap remain authoritative; no key/nonce or framing change is planned.
- [Network/I/O] Existing bounded local relay and socket deadlines remain. No production TLS, URL validation, frame bound or reconnect policy changes.
- [Errors/logs] First exchange errors remain sticky; observers cannot replace them. Trace storage is bounded and content-free.
- [Concurrency] SHOULD FIX within this ticket: establish and regress ownership between replayed close, authenticated reconnect and scenario dispatch before changing it. Dispose all diagnostic subscriptions with fixture/page ownership.
- [Threat model] A malicious relay/daemon still cannot bypass authenticated parsing or strict replay ownership; compromised renderer privileges and disk token protection are unchanged. No new threat is deferred.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-20

## Revisions

### 2026-10-20 — demonstrated duplicate phase dispatch

Both Open Questions are resolved. The first passive paired run passed 4/4: recorded close 4413 was scheduled before scenario dispatch, but the scenario's explicit request beat automatic authentication. A controlled Electron run then let that already scheduled automatic reconnect authenticate before the scenario sampled its old baseline. It reproduced the original 45-second assertion failure (observed 2, expected greater than 2). The first exchange error was an extra authenticated handshake while the next recorded work still belonged to connection 2, rather than lost prefix progress or an observer exception.

The controlled failing trace records close at index 107, connection-2 authentication at 1792533013050, renderer delivery at 1792533013063, scenario dispatch at 1792533013234, and an extra authenticated handshake at 1792533013249. The first strict error follows at 1792533013250, index 151, 25 matched / 126 emitted / 20 remaining. This has two more background requests than the supplied historical 23/124/22 prefix, but both positions precede `new_session` on connection 2. The controlled execution establishes the duplicate-dispatch mechanism; it does not establish the historical MacBook's scheduling trigger.

The simpler local shape is to give the scenario one reconnect phase, rather than change replay's strict connection rules or introduce a transport queue. Sample its baseline before submitting the first turn. At the existing post-reply dispatch point, `reconnectPhase({ host, connections })` reads the actual observer count and dispatches only when that baseline connection remains current. Its read and decision execute in one page task. An already delivered authenticated replacement satisfies this phase; another phase takes a fresh baseline and may dispatch again. The original 45-second count-advance assertion, agent/reply preservation checks, reset, saved-profile retirement, relay forwarding and final completion remain intact. No replay position or connected event is manufactured. Production code is unchanged.

`phaseReconnectOrdering.test.ts` executes the actual page observer callback and consumed dispatch helper, with a real strict `RecordedExchange`. Before correction, the completed-reconnect case fails with `Recorded exchange connection mismatch`; after correction it leaves connection-2 reset work intact and completes. Controls retain explicit dispatch, actual-event-only count advancement, sticky incomplete/wrong-connection rejection, original dispatch-error identity and a fresh baseline on a later phase. All 51 affected observer/exchange/lifecycle unit cases passed after correction.

The same controlled Electron ordering passed after correction: 1 executed / 1 passed / 0 failed / 0 skipped, 45/378/0, zero forbidden launches. The persistent control is `PYRY_THREAD_RECONNECT_CONTROL=after-authentication` on the exact thread case; it explicitly waits for the captured automatic replacement before the normal phase dispatch decision. It is a causal test control, not passive diagnostics, and is disabled for ordinary paired/full acceptance. No bound is enlarged.

Passive diagnostics are capped at 256 adapter entries and 64 renderer connection timestamps; the error slot is retained even at capacity. They contain numeric positions/counts/times, close codes and static exchange errors only. `RecordedExchange.boundary()` is read-only. The plan's security concurrency finding is addressed by phase ownership, with no new IPC/transport/cryptographic surface.

Retained pre-correction evidence under `/tmp/builder-2201/`:

- `diagnostic-paired.json` / `.log` / `diagnostic-paired-results/`: 4 executed / 0 passed / 4 failed / 0 skipped before pairing due to Node ABI 141 instead of Electron ABI 130. Forced standard Electron rebuild and an actual Electron SQLite query resolved the environment prerequisite.
- `boundary-paired.json` / `.log` / `boundary-paired-results/`: passive diagnostic pair, 4 executed/passed, 0 failed/skipped; all three worker slots overlap.
- `controlled-before.json` / `.log`: overly narrow grep selected zero tests; excluded from proof.
- `controlled-before-executed.json` / `.log` / matching results directory: causal failure, 1 executed / 0 passed / 1 failed / 0 skipped; original 45-second assertion and first-error trace retained.
- `regression-before.log`: 3 executed / 2 passed / 1 failed; the failing case is the completed automatic reconnect followed by unconditional dispatch.
- `regression-after.log`: 51 executed/passed, 0 failed/skipped.
- `controlled-after.json` / `.log` / matching results directory: causal success, 1 executed/passed, 0 failed/skipped, exact complete exchange.

Earlier #2191 bundles were retrieved with `fleet-task.py evidence` into `prior-evidence/`. Their pointers are empty; redacted logs remain historical supplied evidence, not rehashed raw paired reports. All failing runs above remain separate from later passes.
