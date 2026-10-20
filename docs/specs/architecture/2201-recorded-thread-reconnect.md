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

### Final Linux acceptance — 2026-10-20

Execution OS: Linux amd64, Node 25.8.0, Electron 33.4.11. All final replay runs compiled/executed clean implementation revision `dcc0a895d47ebe8d482399656db588949ba5ce13`, containing main `f8e4e508f0a25660f1b252fcb19fa99da4b020fc`; `sourceDirty: false`. The subsequent evidence commit changes this plan only. macOS is outside this ticket's verification scope; the historical MacBook trigger remains unknown. No fresh provider/daemon or physical transport acceptance is claimed.

The controlled failing Electron trace also traverses the exact historical 23/124/22 prefix: index 147, connection 2, at 1792533013231. Scenario dispatch follows three milliseconds later; two background queries finish before the extra handshake is rejected at index 151. This establishes progress through that prefix and an extra transition, with renderer and authenticated ordinals agreeing and no earlier exchange/observer error.

The final committed causal control runs the exact thread title with `PYRY_THREAD_RECONNECT_CONTROL=after-authentication`, the complete-thread profile, one worker, retries zero and the zero-executed reporter. It executes/passes 1, fails/skips 0, completes 45/378/0 and reports zero forbidden launches. Its annotation records baseline 1, actual delivered count 2, `dispatched: false`; only real authentication advanced the observer. Ordinary paired/full runs leave this control unset.

Five consecutive ordinary batches use this exact command with `N` replaced by 1 through 5; stdout/stderr are retained separately as `paired-N.log`:

```sh
PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/builder-2201/paired-N.json \
node scripts/run-offline-replay.mjs --profile complete-thread \
  --grep 'a real daemon lazily fills a served gap after more than 200 entries written while Electron is closed|daemon-built thread streams, places an agent, reconnects, resets and reopens saved items' \
  --fully-parallel --workers 3 --repeat-each 2 --retries 0 \
  --reporter list,json,./e2e/reporters/zeroExecutedGate.ts \
  --output /tmp/builder-2201/paired-N-results
```

| Run | Executed / passed / failed / skipped | Worker process identities | Overlapping slots | Report SHA-256 |
| --- | --- | --- | --- | --- |
| `paired-1` | 4 / 4 / 0 / 0 | 0, 1, 2 | 0, 1, 2; peak 3 | `773b9599b49d921e15954cc38d064c9fd565c86456f0f41e62ab680427d724a4` |
| `paired-2` | 4 / 4 / 0 / 0 | 0, 1, 2, 3 | 0, 1, 2; peak 3 | `f80b427a6b2eea3b2d448cd3694424f0140279199164eed582bf48a8189396e4` |
| `paired-3` | 4 / 4 / 0 / 0 | 0, 1, 2 | 0, 1, 2; peak 3 | `1b1727f2425534dad3f4351d8b4a158dfceba9d6fe8f3ddcb5d9653d5ad05175` |
| `paired-4` | 4 / 4 / 0 / 0 | 0, 1, 2, 3 | 0, 1, 2; peak 3 | `1722f77f994e1cec99ce863ceef140af312baa52c4c55d732e0cf0815288c5dc` |
| `paired-5` | 4 / 4 / 0 / 0 | 0, 1, 2, 3 | 0, 1, 2; peak 3 | `a94838990e2dbc370ccfe4e9b11701bc28fa767d1ac8424e89cd33695bda352e` |
| `final-controlled` | 1 / 1 / 0 / 0 | 0 | 0 | `490c48d6e422c97e3e233cc2bd633b878c9bb3f575e74bbfdd821a896a60e370` |
| `complete-recorded` | 29 / 29 / 0 / 1 existing fixme | 0 | 0 | `5946f501c92ef5ff1638e13c78749422d74e2c1b2f1b37aac4cefcf66c2cfce8` |

Every paired batch completes two thread exchanges at 45 matched requests / 378 emitted frames / 0 remaining and two history exchanges at 32/63/0. Totals: 20 executed/passed, 0 failed/skipped, retries zero, zero forbidden launches. `workerIndex` identifies processes; `parallelIndex` identifies slots, so the later process 3 reuses a slot rather than creating a fourth concurrent slot. Actual result start times and durations prove three overlapping slots in every batch.

After batch 5 restored normal output, the complete guarded suite ran with `node scripts/run-offline-replay.mjs --retries 0 --reporter list,json,./e2e/reporters/zeroExecutedGate.ts`, JSON report `complete-recorded.json`, log `complete-recorded.log`, output `complete-recorded-results/`. It completed all 29 exchanges: 773 requests / 3,216 frames / 0 remaining. The sole skipped fixme remains `real claude picks up a saved channel system prompt at Reset session`. Zero forbidden launches and no flaky outcomes.

`acceptance-summary.jsonl` under `/tmp/builder-2201/` retains report hashes, counts, each worker's start/duration and slot, exact exchange counts, dispatch annotations, all input/source attachments and all compiled bundle maps. SHA-256: `49be9a2e37b0116abc822c5681e3d16882f13290cbbe76658bb24e13da87d60b`. Each report retains the bounded `reconnect-boundary` trace, including on failed runs.

Compiled bundle provenance, separate from capture identity (all paths relative to `out/`):

| Bundle | Complete-thread SHA-256 | Normal SHA-256 |
| --- | --- | --- |
| `main/build-provenance.json` | `54a8d7df035231ba6990bec0d69342a9f546da21fdd4dd610a68217b9d070b23` | `4f0d184247f2f2172cfd11fa318de021ab6d2cb20b06b302a18dfa9855d798cc` |
| `main/index.js` | `4f3e287df0be619ac33d72d5497a3660e11196dc66ae03e26bcd0911a89d866a` | same |
| `preload/hosted.js` | `0edfdf2d3ed72973e0fc022b780f8c6229917542064a05d710219aece09cbf42` | same |
| `preload/index.js` | `0430e6aac5d4c276ae9e2d22447431b4c388c5e1bd68dbe3c7a7d9bada0d4df7` | same |
| renderer JavaScript | `index-77fnpiU2.js`: `e478dcb992b1ea8f8805706b89b810acd1bd7d853d8eb3b5b0bc1996cf0ac373` | `index-BJwj8DQm.js`: `11eb9031b4f71443d4e58fbff422a12b765c6a7aee52916b23fac8061874e671` |
| `renderer/assets/index-CsfLv1rn.css` | `e2228755fdff34ced77591a0f2cb7cd82892583e6f76a0667a4071434200c2a9` | same |
| `renderer/index.html` | `3dfce895265240dfe53324d0557e2d03bfb74bc98f8acf06f38d75beddde6f35` | `47147833e725c3ad782f01a0a54dd0d3ce639f101bd935c78bece431dd94bb77` |

Unchanged captured inputs: thread SHA-256 `53a3db11cfab2d5041b511d7be4d030ab5b2b8449b7fdb3ea1d7e5e3db552ae3`; history `de0b1166b6e05e0792228c07be25c20498b117914e673558222eac12cd4e6d2c`. Both retain capture Desktop `00ec821f9380b00cf2dfc0dd4817ee15584106a5`, daemon `58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`, daemon binary SHA-256 `5f5b3b9ce42eda74024637f4929dd720d36c1226ce6e370eb62fbe9e6b22f7c0`. Thread capture time is `2026-10-16T12:29:37.005Z`, Claude `2.1.280 (Claude Code)`; history time is `2026-10-16T12:30:09.805Z`, Claude `not-spawned`. No capture bytes/provenance changed.

Post-main checks: pre-verify PASS (5 checks, 5 causal tests), 51/51 affected units, client-test typecheck, documentation guard and normal build pass. Logs are `pre-verify.log`, `final-units.log`, `check-docs.log`, `build.log` and `final-build.log`; pre-verify's counted JSON/audit/JUnit evidence is copied to `pre-verify-unit-evidence/` outside the worktree. Original failure report hashes: environment batch `29a1fff4cb0d206d8f66702ec07e93e512793e6e610f910f0d60140b436ffd1c`; passive pair `d552828fbd45f85d5c15cd50d5e7ea454a45aef8d1b55e818276ca583fcd4e00`; zero-selection attempt `2ef47bee228eac54ccb9d74e5a43df0f09f161d8027e019d727c7c0ae4126737`; controlled failure `ff65f56e936238a777011530b17473aa9d6dd41775ae916bf71a14d669e67258`. The pre-fix unit failure log is `a74fd742877f20132a2922a7def96b95d7be64e97017a780c0ee5ac34593211f`.

Final scope remains one reconnect behavior with its consumed regression and attribution, below 800 written lines, one new exported helper, one scenario consumer and no new production type/state/error branch. Dispatcher-owned normal application acceptance remains for the verifier; all ticket-required builder replay checks are complete.
