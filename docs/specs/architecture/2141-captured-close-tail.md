# Captured close client-tail replay

## Files read
- `e2e/fixtures/exchangeCapture.ts` → `createExchangeCapture`: raw close position and per-call connection identity.
- `e2e/fixtures/captureNoiseSession.ts` → `createNoiseSession`: observes calls before delegating; observation does not prove a successful socket write.
- `e2e/fixtures/captureNoiseRelayDriver.ts` → `createNoiseRelayDriver`: records link-down before forwarding it.
- `e2e/fixtures/recordedExchange.ts` → `drain`, `reply`, `reconnect`, `assertComplete`: strict matcher, causal barriers and completion.
- `e2e/fixtures/recordedLifecycle.test.ts` → `fixture`: connection/close/checkpoint and retirement controls.
- `e2e/fixtures/exchangeCapture.test.ts` → capture controls: unchanged chronology.
- `e2e/fixtures/clientScenario.ts` → replay daemon fixture: actual close-observer wiring and successful-profile retirement.
- `src/main/transport/fakeRelayForwarder.ts` → `closeClientAfterServerFrames`: socket-write boundary.
- `docs/knowledge/features/development-verification.md`: Node/Electron ABI preparation must be sequential.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`: guard, original assertions, provenance and offline proof boundaries.

## Context
A recorded transport close may precede observed client calls still assigned to that
session. Immediate replay closure strands those calls and makes reconnect fatal.
This is one behaviour plus its regression/rejection proof; no independent slice or
ADR is needed. Estimated total written work: 450 lines, no exported surfaces or
consumer migrations, four acceptance behaviours, fewer than ten reject branches.
In-flight #2072 adds settlement beside these methods; preserve main's existing
retirement and socket-write handling. It is not a dependency.

## Design
Derive the replay close position from the raw close: scan only the contiguous
client entries belonging to its connection. Keep the recording unchanged. Match
these requests through the existing exact matcher, then notify the existing
transport-close observer once, with the original code and daemon-frame prefix.
Bound request eligibility by that derived position. A same-connection daemon
entry beyond the close is invalid and fails rather than crossing the boundary.
No-tail closes keep their position. Considered a pending-close state object;
deriving the finite boundary avoids another lifecycle state to reset.

## State + concurrency model
Existing index, consumed requests and closure ordinal remain authoritative.
No new async job, timer, production transport change or capture rewrite. Existing
connection-completion deadlines bound missing requests; observer forwarding waits
for actual successful server-frame socket writes as before. Teardown is unchanged.

## State transitions and identity reuse
| Event | Control in `recordedLifecycle.test.ts` |
| --- | --- |
| Close, old-session calls, reconnect; request IDs reused on next connection; repeated draining | `replays a captured close only after its exact old-connection client-only suffix` |
| Close without tail | `requires the actual captured transport close after all preceding daemon frames` |
| Missing tail | `bounds a missing captured-close tail with the existing connection deadline` |
| Changed/duplicate/extra/future-connection request | `keeps %s fatal while draining the captured client tail` |
| Extra call after closure, including end of recording | `rejects extra calls after closing the drained tail (final connection: %s)` |
| Checkpoint within tail | `cannot drain across an unreleased checkpoint in the captured tail` |
| Daemon frame beyond close | `never forwards same-connection daemon data beyond a captured close` |
| Actual relay socket close | `delivers the prefix then observes the actual relay close and reconnect after tail matching` |

## Error handling
Reuse sticky matcher and transport-boundary failures. Missing calls use the
existing five-second connection-prefix deadline. Do not relax payload, identity,
device, connection, checkpoint or final-completion checks.

## Testing strategy
Write the capture-to-replay regression first and record its failure. Capture
controls retain close position/code and actual session ownership. Lifecycle
controls cover strict tail rejection, bounded absence, checkpoints, invalid
post-close daemon data and actual relay close observation. Run focused capture,
exchange and lifecycle tests, pre-verify, client-test typecheck and build after
merging main. Prepare Electron SQLite only after Node checks. Run unchanged
retained question-answer capture with retries zero, then the complete guarded
committed-recording suite. Record counted Linux results and guard/exchange
counters here; preserve historical failure evidence. No new live capture required.

## Open Questions
None. Test fixtures only; no UI or documentation-stage requirements.

## Revisions
2026-10-19: Validation found an independent current-main request-contract change,
tracked in [#2149](https://github.com/pyrycode/pyrycode-desktop/issues/2149) and linked
as an open blocker. `PairedShell` now chooses automatic compact projection when
the retained capture's capabilities advertise support. At recorded index 12,
request 4 is `thread_catch_up` with the additional `projection: 'compact-v1'` field;
the complete-thread request recorded at index 22 lacks it. Both unchanged main
and this candidate fail strictly before the close at 47. No application change,
capture rewrite, capability removal or matcher relaxation belongs in this repair.
The current-app retained-capture acceptance remains pending #2149. A separate
source-matched experiment isolates the fixture repair; it does not turn the
current-main failure into a pass.

## Validation evidence
Linux x64; implementation `3ff2d9a1439e829001c49ba13cc08083a291c75c`, main
`3897f0dd5637f16f5f82a337b33ccaed3274389b`. Reports are under
`/tmp/builder-2141/`. Counts below are executed / passed / failed / skipped.

- Original deterministic regression: **9 / 8 / 1 / 0**, failure is the premature
  close assertion (`regression-red.log`).
- `npm test -- e2e/fixtures/recordedLifecycle.test.ts e2e/fixtures/recordedExchange.test.ts e2e/fixtures/exchangeCapture.test.ts --maxWorkers=4 --minWorkers=1`:
  **42 / 42 / 0 / 0** (`controls-final.log`), including encrypted real-relay close
  observation, no-tail compatibility, exact suffix matching, bounded absence,
  sticky failures, extra/future-connection requests and unreleased checkpoints.
- `python3 "$AGENTS_REPO_PATH/bin/pre-verify-check" --test-file e2e/fixtures/recordedLifecycle.test.ts`:
  all five checks passed; affected tests **20 / 20 / 0 / 0** (`pre-verify.log`).
  `npm run typecheck:client-tests` and `npm run build` passed
  (`client-typecheck.log`, `build.log`). Normal main bundle excludes the recorder.
- `npm run rebuild:electron` passed after Node preparation completed
  (`electron-native.log`).
- `PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/builder-2141/committed-recordings.json npm run e2e:recorded -- --retries 0 --reporter=list,json,./e2e/reporters/zeroExecutedGate.ts`:
  **29 / 29 / 0 / 1**, no retries/flaky outcomes, **zero forbidden launches**.
  All 29 exchange attachments have zero remaining requests: totals **773 matched
  requests / 3216 emitted frames / 0 remaining** (`committed-recordings.log/.json`).
  The committed question recording passed at **29 / 136 / 0** exchange counters.
  The explicit existing fixme is `real claude picks up a saved channel system
  prompt at Reset session`.
- `PYRY_CLIENT_RECORDING_DIR=/tmp/builder-2137/capture-3 PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/builder-2141/retained-question.json npm run e2e:recorded -- --grep "real claude changes model during a question and resumes with the original answer" --retries 0 --reporter=list,json,./e2e/reporters/zeroExecutedGate.ts`:
  **1 / 0 / 1 / 0**, retry 0, zero forbidden launches; strict step-4 mismatch
  (`retained-question.log/.json`). Worker exit 7 prevents exchange attachments;
  exchange counters are unavailable for this run. This remains failed evidence.
- The identical scenario with unchanged main fixtures and the identical main
  application build also failed **1 / 0 / 1 / 0**, retry 0, zero forbidden launches
  (`main-retained.log/.json`). Scratch-only diagnostics confirm the extra projection
  field (`main-diagnostic.log/.json`). The diagnostic was removed from the branch.

The retained capture remains byte-identical, SHA-256
`24bbe5dff65241a77dda96cbd262c9185925d88f6168439a1679b576b984dac1`.
Source Desktop `ef097bfc29324437d067d65360558b8e77be8f40`, daemon
`664305939d73e5a146457503081d8232fcca5407`, daemon binary SHA-256
`ba2831b24dd8f880c0a707fb694bab8b99cfe2535d76eaa6129dbf11e4d0b869`,
Claude 2.1.280. Historical `/tmp/builder-2137/replay.json` and `replay.log` remain
failed: **1 / 0 / 1 / 0**, 9 matched / 38 emitted / 29 remaining, zero forbidden
launches. Their SHA-256 hashes are respectively
`439cc84382e8930bd7184b65df0342f3ac19b85f6a9c6bddc1e17ce1c56cd8ee` and
`7f7cb7bfc228ee85c31698e40900012700461a520d6deed1098a3a23034dd549`.
An initial anchored grep selected zero tests (`retained-replay.log/.json`); that
discovery failure is not acceptance evidence. Earlier incomplete-install and
unsupported-assertion development failures remain in their original logs.

### Source-matched isolation of the fixture repair
To separate close scheduling from #2149, archived the capture's exact Desktop
source `ef097bfc29324437d067d65360558b8e77be8f40` under
`/tmp/builder-2141/capture-source-client/`, built its normal application, and
copied the current scenario, guard and fixture sources into that scratch tree.
No production source was changed. The old and repaired fixture runs share the
same built application, current original scenario assertions and unchanged
retained capture. Only `recordedExchange.ts` changes between them: main's old
fixture versus implementation `3ff2d9a1439e829001c49ba13cc08083a291c75c`.

Both use, from that scratch directory:
`PYRY_CLIENT_RECORDING_DIR=/tmp/builder-2137/capture-3 PLAYWRIGHT_JSON_OUTPUT_NAME=<report> node scripts/run-offline-replay.mjs --grep "real claude changes model during a question and resumes with the original answer" --retries 0 --reporter=list,json,./e2e/reporters/zeroExecutedGate.ts`.

- Old fixture: **1 / 0 / 1 / 0**, **9 matched / 38 emitted / 29 remaining**,
  zero forbidden launches (`source-client-old-fixture.log/.json`). It reproduces
  the original close/reconnect failure and remains failed evidence.
- Repaired fixture: **1 / 1 / 0 / 0**, **38 matched / 201 emitted / 0 remaining**,
  zero forbidden launches, retry 0, no skips (`source-client-fixed-fixture.log/.json`).
  Every captured request and all four captured closes are consumed; the final
  `assertComplete` passes. This establishes the fixture repair against the exact
  retained capture, not compatibility with current main's compact requests.

The shared application artifact SHA-256 hashes are
`14964f03eb41095b9ee91af5f78d8a422a44c760386a9c8e498c33ff1865b69f`
for `out/main/index.js`, and
`4ab6e5f713c5c3d9c86b58c3d9cccf90a392f69cd5adcfcd6d63c877beb5d608`
for `out/renderer/assets/index-BDKZVj7-.js`. They are unchanged across both runs.
The actual ticket worktree keeps the current-main normal build. No capture was
replaced, no matcher was relaxed and no source-matched result is substituted for
the explicitly pending current-main retained-capture acceptance.

These checks establish offline correctness only. No fresh provider or physical
transport acceptance is claimed. macOS is outside this Linux ticket's scope.
