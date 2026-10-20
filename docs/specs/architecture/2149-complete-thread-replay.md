# Explicit complete-thread replay compatibility

## Files read
- `CLAUDE.md`, `docs/knowledge/INDEX.md`: process boundaries and verification map.
- `docs/knowledge/features/development-verification.md`: native ABI sequencing and replay proof limits.
- `docs/knowledge/features/thread-runtime-compact.md`: omitted opening options retain complete delivery through reconnect.
- `docs/knowledge/features/conversation-shell.md`: authoritative thread composition.
- `src/renderer/src/PairedShell.tsx` → `PairedShell`: creation and ordinary opening select automatic delivery.
- `src/renderer/src/store/threadRuntime.ts` → `createThreadRuntime`: complete is the existing default; only automatic selections upgrade.
- `electron.vite.config.ts`, `e2e/recordings/capture.config.ts`: separate test build configuration precedent; no recorder import is needed.
- `scripts/run-offline-replay.mjs`, `scripts/offline-replay-guard.test.ts`: guarded process tree and credential removal.
- `e2e/fixtures/clientScenario.ts`, `e2e/fixtures/launchRecordedApp.ts`: unchanged shared assertions and strict exchange completion.
- `e2e/fixtures/recordedExchange.ts` → `RecordedExchange`: full-envelope matching, identity binding, causal barriers and close boundaries.
- `e2e/compact-demand.spec.ts`, `e2e/fixtures/launchPairedApp.ts`: production application and compact-capable handshake controls.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`: provenance and documentation handoff.

## Context
Automatic compact selection correctly changes requests when the authenticated host supports compact delivery. Older complete-thread recordings need an explicit current-source complete-route profile. This is one useful behavior: its build seam, invocation and strict regression controls ship together. #2141 owns the independent close-ordering repair and final combined retained-scenario pass. No ADR is needed.

Sizing: approximately 600 written lines including plan, controls and evidence; one new exported policy value, two updated production consumers, four observable criteria, no new protocol state machine. The analogue #2072 initially added 277/deleted 10 lines; these extra build/isolation controls account for the larger forecast. Recount before implementation and handoff against the 800-line ceiling. Remote feature-branch audit found no overlapping planned existing files.

## Design
- A small renderer policy module exports the opening options used by both `PairedShell` calls. Normal source exports automatic selection.
- A separate `e2e/recordings/complete-thread.config.ts` aliases only that policy module to a test-owned module exporting omitted options. No negotiation, codec, transport, wire, matcher or recording changes.
- `node scripts/run-offline-replay.mjs --profile complete-thread ...` explicitly builds this configuration before launching the original guarded replay. No profile means the existing normal-build invocation. Unknown profiles fail before launch.
- Compatibility uses the ordinary output temporarily and restores a normal build in `finally`, including build/test failure. Restoration failure fails the command. A profile is never chosen from an application environment variable, IPC or renderer state.
- Runner evidence identifies executed revision/dirty status, profile and SHA-256 of every executable bundle separately from capture provenance. Replay attachments add the raw input SHA-256 alongside unchanged capture source and exchange counts.
- A focused application control uses compact-capable authentication and strict complete-thread matching, without captured closes. It proves initial opening, created-conversation activation and accepted reconnect. Normal selection and changed payload controls must reject strictly; existing compact-demand coverage uses the normal build.

## State + concurrency model
No new application state, stream or background task. Existing thread runtime owns selection and teardown. The runner performs build, replay and restoration sequentially; native Node/Electron preparation is also sequential. The guard still covers the entire replay process tree.

## State transitions and identity reuse
| Event | Coverage |
| --- | --- |
| Initial open under compact-capable authentication | `complete-thread-profile.spec.ts`: strict complete query accepted in compatibility; normal query rejected |
| Created-conversation activation | Same application control: the second production opening site retains complete |
| Accepted reconnect with the same host/chat IDs | Same application control: no automatic upgrade in compatibility |
| Default automatic reconnect/demand | Existing `compact-demand.spec.ts`, normal build |
| Success or failure of a compatibility run | Runner controls: normal restoration always executes |
| Changed payload or wrong profile | Strict mismatch controls; matcher remains unchanged |

## Error handling
Unknown profile, build failure, replay failure and restoration failure yield nonzero exit. No mismatch fallback. The existing exchange remains sticky on mismatches and incomplete requests. Logs/attachments contain only provenance, checksums and counts, never payloads. Missing retained bytes remain an explicit acceptance blocker rather than substituted evidence.

## Testing strategy
- Test first: build-policy and runner controls fail before implementation; production app regression initially exposes the compact projection mismatch.
- Unit/configuration controls verify normal versus complete build selection, no capture imports, restoration after success/failure and strict changed payload rejection. Existing exchange/guard tests retain their original assertions.
- Focused Playwright application control exercises both real selection sites and reconnect using existing encrypted fake transport and the strict matcher, without #2141 scheduling.
- Run exact unchanged retained question input with retries zero under both profiles if available; compatibility must accept its complete query and reach close index 47. Any subsequent close failure stays a failed full scenario. Never infer #2141's required 1/1 complete exchange from prefix evidence.
- Final main merge, install, affected pre-verify checks, normal build, Electron ABI preparation, normal compact-demand and complete guarded committed-recording suite with retries zero. Preserve system-prompt-reset fixme. Record executed/passed/failed/skipped, exchange and forbidden-launch counts on Linux; macOS is outside scope. No fresh live/provider claim.

## Open Questions
- Required retained bytes are absent locally; supported provisioning is pending. SHA-256 must equal `24bbe5dff65241a77dda96cbd262c9185925d88f6168439a1679b576b984dac1` before the exact scenario runs. This does not prevent independent implementation/controls; it prevents claiming completed acceptance.

## Revisions
- 2026-10-19: Build evidence must identify the source that actually produced the bundle, rather than the checkout at replay time. `buildProvenance` emits revision/dirty/profile metadata during compilation; replay hashes the output and refuses a mismatched profile. This also detects a compatibility output left behind by an interrupted process. No runtime application override is introduced.
- 2026-10-19: The synthetic application control uses separate data and final frames, as the production parser requires. Its earlier combined-frame failures remain failed evidence; complete query matching had already succeeded. Reconnect supplies a newer item revision/version and its original checkpoint cursor.
- 2026-10-19 recovery: The retained-input Open Question is resolved. The exact bytes were already reachable in local Git history; an absent temporary pathname did not establish missing access. Extracting the immutable blob and checking its checksum requires no implementation change. The historical hold below is superseded by the counted recovery evidence.

## Documentation handoff
- Pending documentation stage: `docs/recorded-tests.md`, “Replay contract”: explicit compatibility invocation, build isolation/restoration, executed revision/profile/bundle hashes/input checksum separately from capture provenance; current-source complete route versus default automatic projection, with no fresh provider or physical transport proof.
- Pending documentation stage: `docs/client-replay-migration.md`, replay evidence description: retain the same complete-route/default-policy distinction.

## Linux validation evidence — 2026-10-19
Implementation source `29a98019b9f5fc6cc4c853d9c03d07bca673671d`; strengthened negative-control source `d1dd91c6619b5babc307b86b29444efa3f285a1d` differs only by three test lines explicitly asserting the compact projection. Final profile runs built clean source at the latter revision. Main `f2428d2ab281` was merged before pre-verify/build. All browser invocations below used the executable guard, retries zero and zero forbidden launches; there were no fresh live runs. macOS is outside scope.

| Check | Executed / passed / failed / skipped | Evidence under `/tmp/builder-2149/` |
| --- | --- | --- |
| Profile, existing guard and strict exchange units | 22 / 22 / 0 / 0 | `final-unit-controls.log` |
| Pre-verify (including seven affected units) | 5 checks passed; 7 / 7 / 0 / 0 | `pre-verify.log` |
| Normal build and docs guard | Passed | `final-normal-build.log`, `docs-check.log` |
| Normal compact-demand plus profile controls | 6 / 6 / 0 / 0 | `final-normal-controls.json`, `.log` |
| Strengthened normal profile controls | 2 / 2 / 0 / 0 | `final-normal-pinned.json`, `.log` |
| Compatibility controls plus original shared question scenario, committed input | 3 / 3 / 0 / 0 | `final-compatibility-pinned.json`, `.log` |
| Complete normal committed-recording suite | 29 / 29 / 0 / 1 | `final-committed-recordings.json`, `.log` |

The full recorded suite completed all 29 exchanges: 773 matched requests, 3,216 emitted frames, zero remaining requests. The skipped test is the unchanged `real claude picks up a saved channel system prompt at Reset session` fixme. Normal wrong-profile controls deliberately observe a sticky strict rejection: zero matched queries, one emitted seed frame, three remaining queries; that expected negative-control result is not replay acceptance.

Compatibility's synthetic query contract matched three complete queries, emitted eight frames and had zero remaining queries after initial opening, creation and same-ID reconnect. Its original shared question run matched 29 requests, emitted 136 frames and had zero remaining requests. This run used the unchanged **committed** input SHA-256 `6de35feed0dcf02764da0765a4af03234314ff691a29cc975bf82c3e8d498d6b`, capture Desktop `5788a683ab580647008eaf2b292631607c407ab8`, daemon `58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`; it does not establish the separate retained-input criterion.

Executed main bundle SHA-256 was identical in both profiles: `14964f03eb41095b9ee91af5f78d8a422a44c760386a9c8e498c33ff1865b69f`. It contains no recorder marker. Normal renderer SHA-256: `0cb34a92046d7c8137c8706a62ab9606d439e579023515615724335a78f6ea1b`; compatibility renderer: `6a805af00d6ad979a615b7fc660d69ed81bfcd2ed5b81c4650f87e66098e02a9`. Each run's `replayExecutedBuild` log includes build-time revision/dirty/profile and hashes for all JavaScript, HTML, CSS and metadata outputs. Replay attachments identify input checksums and capture provenance separately. Successful compatibility and both initial failed fixture attempts restored normal output; the final metadata names `normal` and clean `d1dd91c6`.

Report SHA-256 values:
- `final-compatibility-pinned.json`: `303c1fc593ed5cd265d8208c722be83f81ed169073ab0919678bd62e807791ac`.
- `final-normal-pinned.json`: `e666dbb81155de0cf9caf67b1b4d1c081667d3276c719c67f80b0eeb45b06f58`.
- `final-normal-controls.json`: `4136fc239fa499a29792db5d571808177170d5ea924e29d6b0bd7ccddf6b13a7`.
- `final-committed-recordings.json`: `82e96b5c23c34dbae8b0655955bb3b28329a4905ade62e798ca794fcd25f8e25`.

Earlier failures remain failures: `profile-complete.json` and `profile-complete-2.json` each report 2 executed / 1 passed / 1 failed / 0 skipped due to the invalid synthetic combined data/final fixture. The complete query itself matched. The corrected fixture first passed in `profile-complete-3.json`. The initial missing-Electron launch executed zero tests; `npm rebuild electron` installed the existing dependency before the counted successful runs. No earlier result is replaced by later success.

## Required retained-input hold — historical, resolved below
The exact bytes at `pyrybox:/tmp/builder-2137/capture-3/claude-question-answer.json`, expected SHA-256 `24bbe5dff65241a77dda96cbd262c9185925d88f6168439a1679b576b984dac1`, are unavailable in this container. Existing #2137/#2141 bundles and the newest #2141 recovery bundle `b4b86810c47a7d1b3325d77c224b7c0058ce01463788479bcec6777e28e1fbc4` contain references/logs but no retained bytes. No substitute capture was used for this criterion. Its source remains Desktop `ef097bfc29324437d067d65360558b8e77be8f40`, daemon `664305939d73e5a146457503081d8232fcca5407`.

After supported provisioning, verify the exact checksum and run the ticket's original retained selection with the additional explicit `--profile complete-thread` argument to `scripts/run-offline-replay.mjs`; use the same exact scenario title, unchanged original assertions, retries zero and the guard. Also retain its default-profile mismatch. Required evidence remains: original complete query accepted and recorded prefix through close index 47 delivered. The retained full scenario has not run here; neither prefix nor full completion is claimed. Preserve any subsequent #2141 close-ordering failure as failed. #2141 still owns its later combined 1 executed/passed, 0 failed/skipped and zero-remaining acceptance; no reverse blocker was added.

Implementation and independent Linux checks are ready for recovery. This hold prevents opening the PR and returning completed; it is missing access, not a refinement gap or a dependency on #2141. Documentation handoff above remains pending for its own later stage. Final written work remains below 400 added lines, with two production selection consumers and no new application types or state.

## Retained-input recovery and final Linux evidence — 2026-10-19
The earlier missing-input conclusion was incorrect. Ancestor `6c6a4bdb758fbd35eea1b76d3bf95136596e4327:e2e/recordings/claude-question-answer.json` names blob `a4e2394b7604f8fd3bb59cb838e9dd33a8ee746f`. Its unchanged 292,339 bytes were extracted to private directory `/tmp/builder-2149/retained-recovery-20261019/`; SHA-256 is exactly `24bbe5dff65241a77dda96cbd262c9185925d88f6168439a1679b576b984dac1`. Capture Desktop remains `ef097bfc29324437d067d65360558b8e77be8f40`, daemon `664305939d73e5a146457503081d8232fcca5407`, with the original compact-capable handshake. No capture, capability, assertion, matcher or close scheduler was changed.

The explicit retained invocation was `PYRY_CLIENT_RECORDING_DIR=/tmp/builder-2149/retained-recovery-20261019 node scripts/run-offline-replay.mjs --profile complete-thread --grep "real claude changes model during a question and resumes with the original answer" --retries 0` (plus list/JSON reporters). The default comparison omitted only the profile argument and selected the same bytes/assertions. Both executed clean current source `fc64084e9df76dfd11481b18571c7313ee7e28bc`, independently identified from capture provenance in `replayExecutedBuild` and `replay-input`. Subsequent tracked changes only update this plan.

| Recovery check | Executed / passed / failed / skipped | Evidence under `/tmp/builder-2149/` |
| --- | --- | --- |
| Pre-verify after final merge of main `f2428d2ab281` | 5 checks passed; 7 / 7 / 0 / 0 | `recovery-pre-verify.log` |
| Profile, guard and strict-exchange units | 22 / 22 / 0 / 0 | `recovery-unit-controls.log` |
| Normal build and docs guard | Passed | `recovery-normal-build.log`, `recovery-docs-check.log` |
| Normal compact-demand and profile controls | 6 / 6 / 0 / 0 | `recovery-normal-focused.json`, `.log` |
| Compatibility controls and original shared question, committed input | 3 / 3 / 0 / 0 | `recovery-complete-controls.json`, `.log` |
| Complete normal committed-recording suite | 29 / 29 / 0 / 1 | `recovery-committed-recordings.json`, `.log` |
| Exact retained input, default profile | 1 / 0 / 1 / 0 | `retained-default-recovery.json`, `.log` |
| Exact retained input, complete-thread profile | 1 / 0 / 1 / 0 | `retained-complete-recovery.json`, `.log`, `retained-complete-recovery-results/` |

Every browser invocation in this table used retries zero and reported zero forbidden launches. The complete committed suite completed all 29 exchanges: 773 matched requests, 3,216 emitted frames, zero remaining requests. Its sole skip is the unchanged system-prompt-reset fixme. Compatibility's synthetic exchange matched three complete queries, emitted eight frames and had zero remaining queries across initial opening, creation and same-ID reconnect; its separate committed-input question matched 29 requests, emitted 136 frames and completed. These passes retain the earlier distinction between committed and retained capture provenance.

The retained default run preserves `Recorded exchange request mismatch at step 4`, before the close, followed by worker exit 7. Its worker exited before an exchange attachment was produced; missing completion statistics are not zero remaining requests. Under compatibility, its original complete `thread_catch_up` at index 22 was accepted, and the exchange attachment records **9 matched requests, 38 emitted frames, 29 remaining requests**. Those nine requests and 38 daemon frames are exactly the unchanged prefix before index 47. The observed retry-close/reconnect then failed in `RecordedExchange.reconnect` with `Recorded exchange connection mismatch`; the original question visibility assertion also failed. Forwarding of this prefix follows from that observed close/reconnect and the unchanged `flushClose` invariant: close 4413 cannot execute until 39 successful server socket writes (one Noise response plus the 38 application frames). This establishes socket forwarding, not application acknowledgement, physical transport or fresh provider behavior.

The retained full scenario remains **failed**, not a successful replay. #2141 still owns its separate close scheduler repair and combined retained acceptance: 1 executed/passed, 0 failed/skipped, zero remaining requests. No reverse blocker is needed. Both successful and failed compatibility runs restored normal output; final metadata identifies clean `fc64084e`, profile `normal`. Main bundle SHA-256 remains `14964f03eb41095b9ee91af5f78d8a422a44c760386a9c8e498c33ff1865b69f`; normal renderer `0cb34a92046d7c8137c8706a62ab9606d439e579023515615724335a78f6ea1b`; compatibility renderer `6a805af00d6ad979a615b7fc660d69ed81bfcd2ed5b81c4650f87e66098e02a9`. Logs retain all executable bundle hashes separately from input/capture provenance.

An earlier incorrectly broad control invocation, `recovery-normal-controls.json/.log`, remains failed: 1 executed / 0 passed / 1 failed / 6 skipped. It selected the unrelated native-writer project dependency, whose esbuild launch the guard denied, before the six intended controls could run. Its forbidden-launch result is nonzero, not part of the zero-attempt evidence above. The corrected focused invocation selected `--project parallel --no-deps` while retaining the executable guard. Earlier synthetic-fixture failures also remain failures as recorded above.

Report SHA-256 values: retained default `6e5e22054e6c3fc9ee8959682fd32e1610a16fecdb62ccbd1e72603770344b01`; retained compatibility `30bf6d414710fccf6296d2b4a1037d908116c8c15d7161955e7b25f04fc88e12`; normal controls `e98ea91c968f5251528d33761e5b3543311141205a4023a411a20669f1954dfd`; compatibility controls `755d4ff549dc9c453329d4d4cd95227c90c6eadf376e3656ff546d5333bd8eed`; full committed suite `f9c34ee82e1d4cfecb1ebc616e2b0c4f541436ecc3fd3173c1c5c4728048f4f6`.

This resolves this slice's retained-input hold. Documentation handoff remains pending for its owning stage; macOS remains outside this Linux ticket's verification scope. Final written work stays below 400 added lines and the original single-behavior scope; no production changes were needed during recovery.
