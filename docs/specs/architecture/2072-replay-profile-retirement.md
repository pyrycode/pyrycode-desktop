## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: verification boundaries and native ABI prerequisite.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`, `docs/knowledge/features/e2e-harness-context-recovery.md`: strict replay, synchronous inspection and observer protections remain unchanged; QMD search confirmed these owning topics.
- `e2e/fixtures/realDaemon.ts` → `withIsolatedElectronApp`: explicit retirement and process-exit guarantee, best-effort failure cleanup.
- `e2e/fixtures/clientAppLifecycle.ts`, `clientScenario.ts` → lifecycle hooks and replay fixture ownership.
- `e2e/fixtures/recordedExchange.ts` → `reply`, `drain`, `reconnect`, `checkpointWhenReady`, `assertComplete`: strict prefix and sticky failure semantics.
- `src/main/transport/fakeDaemon.ts` → `handleTransport`: returns from `reply`, then synchronously seals and sends every returned frame before yielding. No production change.
- `e2e/real-daemon-history-on-open.spec.ts` → resumed `fresh.close`: all original history assertions precede independent-profile launch.
- `e2e/fixtures/recordedLifecycle.test.ts`, `realDaemon.test.ts`: existing connection and process-boundary fakes.

## Context

The reopened failure reaches independent-profile pairing with connection 2's final list request and two replies outstanding. The inspector repair is already merged and stays intact. One behaviour ships here: a successful profile retirement settles its own recorded connection before exit. Its regression belongs to the same slice. Historical timing remains unobserved; controlled ordering will establish the premature-close mechanism, not claim its upstream trigger.

## Design

Add `RecordedExchange.settleConnection(): Promise<void>`: snapshot the current connection's end, observe natural replay progress without advancing or matching anything, reject sticky failures and unreleased checkpoints within that prefix, and bound missing-prefix waiting to five seconds. It resolves only after the entire prefix has drained. Promise continuations run after the synchronous fake-daemon reply/send loop, so the outgoing batch is sent before the app is closed, rather than closing on the request matcher counter. It never waits for the next connection or releases a test-side action.

Give the existing closing hook a completion flag. Explicit close/relaunch and successful callback completion pass true; failure cleanup passes false. Replay installs a closing hook that awaits settlement only for successful retirement, and removes both hooks in finally. Clear the current handle even when retirement fails after process cleanup. Preserve the retirement error if cleanup also fails. No application changes, captures, request matching, scenario assertions, deadlines, concurrency or retries change.

Cleaner-shape check: use existing progress subscriptions and lifecycle hooks. A new relay harness or application delivery API would widen this repair unnecessarily. Outgoing send ordering follows the existing synchronous daemon loop; no receiver acknowledgement is invented.

Overlap: `feature/1364` changes profile encryption/relaunch in `realDaemon.ts`; current main already has relaunch. Preserve its independent encryption work. `feature/1544` changes child spawn options in another block. Neither is a required dependency.

Size re-count: one useful behaviour, approximately 450–550 written lines including evidence/tests/plan, no new exported types, three consuming seams, four acceptance behaviours and fewer than ten reject branches. Within all ceilings.

## State + concurrency model

Each settlement snapshots one connection ordinal/end. Progress subscriptions and its deadline are removed on success/failure. No cached app handle crosses relaunch. Existing strict reconnect rejects crossing an incomplete prefix. Failed scenario cleanup never waits for new application work.

## State transitions and identity reuse

| Event | Regression |
| --- | --- |
| Delayed final resumed list after visible assertions | controlled profile retirement test: request, outgoing replies, process exit, independent connection ordering |
| Completed prefix followed by future connection | settlement scopes to retiring connection |
| Missing request | fake-timer bounded rejection and listener cleanup |
| Unreleased action barrier | immediate rejection without releasing it |
| Request/connection mismatch | sticky causal error propagation |
| Retirement/setup/scenario failure | process cleanup preserves primary error and bypasses settlement |
| Next case/relaunch | lifecycle hooks removed; current handle cleared after close failure |

## Error handling

Use static prefix-incomplete/checkpoint diagnostics and existing sticky errors. Never log payloads, native loader details or credentials. Cleanup remains mandatory after retirement failure, without replacing the causal error. Final exchange completion still fails missing work.

## Testing strategy

- Test first through actual isolated-profile lifecycle and replay closing hook with fake Electron process boundaries and real exchange matching; delay the final resumed list through a microtask after assertions, without sleeps or synthetic application requests.
- Test missing-prefix bounds, barriers, sticky errors, future-connection scope, outgoing-batch-before-close ordering, failure cleanup and hook disposal with fake timers.
- Linux: five guarded focused batches, both original cases repeated twice, fully parallel, three workers, zero retries (20 expected executions), then complete guarded recorded suite. Preserve system-prompt-reset fixme and capture provenance.
- Run lifecycle/exchange/inspection/observer regressions, final main merge, affected-file pre-verify, build and client-test typecheck. Dispatcher owns configured application gate; no live-provider or macOS acceptance is claimed.

## Open Questions

None. Append measured red/green ordering and counted Linux results before handoff.

## Validation evidence

Linux x64, 2026-10-19. Plan committed as `614d4ff7` before implementation; fixture implementation `8268353a`, test-isolation cleanup `984b8e6f`, main `fa9e20e7fe3fd050298ef265d6fe9c9a5afb4182`. The subsequent change only logs the controlled unit ordering and records this evidence. All retained paths below are under `/tmp/builder-2072/retirement/`.

- Controlled original-path red: `red.log`, 3 executed, 1 passed, 2 failed, 0 skipped. The delayed resumed-list case reaches `Recorded exchange connection mismatch`; the sticky-retirement-error case incorrectly resolves. A fresh archive of `614d4ff7` with the same regression additionally records `red-ordering.log`: 1 selected/executed/failed, 5 deselected. Its content-free order is `exit-1, visible-history-assertions, exit-2, independent-connection`, with 2 matched / 2 emitted / 2 remaining. The already scheduled resumed request cannot run after its fake process exits.
- Repaired controlled order in `targeted-after-replay.log`: `exit-1, visible-history-assertions, resumed-list, outbound-reply, outbound-reply, exit-2, independent-connection`, then `exit-3`; before the independent reconnect it has 3 matched / 4 emitted / 1 remaining. The future request is deliberately still outstanding. This executes the actual replay hook, isolated-profile helper and exchange matcher with fake process/send boundaries; the real fake-daemon synchronous reply/send loop establishes the same ordering. It demonstrates premature retirement under a delayed natural request, without claiming the unrecorded historical scheduling trigger or a receiver acknowledgement.
- Final focused regressions, after complete replay: `npm test -- e2e/fixtures/replayProfileRetirement.test.ts e2e/fixtures/recordedLifecycle.test.ts e2e/fixtures/recordedExchange.test.ts e2e/fixtures/replayNativeStorage.test.ts e2e/fixtures/historyQueryEvidence.test.ts e2e/fixtures/realDaemon.test.ts`: 80 executed/passed, 0 failed/skipped (`targeted-after-replay.log`). Includes all six process/hook cases, all ten exchange-lifecycle cases, all nineteen synchronous/native-inspection cases and all four observer-registration cases.
- Required focused command: `node scripts/run-offline-replay.mjs --grep "a real daemon lazily fills a served gap|daemon-built thread streams" --fully-parallel --workers=3 --repeat-each=2 --retries=0 --reporter=list,json`, with `PLAYWRIGHT_JSON_OUTPUT_NAME` selecting each fresh report. `focused-1` and `focused-2` each pass 4 executed / 4 passed / 0 failed/skipped. Both have three configured/actual parallel slots (0, 1, 2); Playwright may replace a process between repeat groups. Every thread exchange is 45 matched / 378 emitted / 0 remaining; every history exchange is 32 / 63 / 0. Zero retries, report errors or forbidden launches.
- `focused-3` is retained red: 4 executed / 2 passed / 2 failed / 0 skipped, the same three slots/retry-zero configuration. Both history cases pass 32 / 63 / 0. Both thread cases fail the original saved-title assertion before the first profile retirement, 38 / 342 / 7. The consecutive run stops here: aggregate 12 executed / 10 passed / 2 failed, not the required 20-pass acceptance. No further unchanged run is claimed to repair this separate failure.
- Unchanged-main comparison: `baseline-paired.json` / `.log`, archive `614d4ff7` (only this plan added to main, original application/fixtures/scenarios), normal build in `baseline-build.log`, identical focused command/configuration: 4 executed / 3 passed / 1 failed / 0 skipped. Thread reproduces exactly the saved-title assertion with 38 / 342 / 7 before any retirement hook; its other execution and both history cases pass completely. Three actual parallel slots, retry 0, zero forbidden launches. This inherited failure is now [#2129](https://github.com/pyrycode/pyrycode-desktop/issues/2129), on Backlog with priority:low and linked as an open blocker for #2072. It is distinct from #2122's held-terminal checkpoint failure.
- Complete guarded `PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/builder-2072/retirement/recorded-full.json npm run e2e:recorded -- --reporter=list,json`: 29 executed/passed, 0 failed, 1 existing fixme, configured/actual workers 1/1, retries 0 (`recorded-full.json` / `.log`). Both protected cases pass with the full exchange counts above; all 29 exchanges have zero remaining requests. Zero forbidden launches/report errors. The explicit excluded case remains `real claude picks up a saved channel system prompt at Reset session`; it is not live acceptance.
- Final main fetch/merge was already up to date at `fa9e20e7`. `pre-verify.log` passes all five checks including typecheck and all 10 affected lifecycle tests. `build-final.log`, the complete recorded command's rebuild, `client-typecheck-final.log` and `docs-check.log` pass. Complete unit acceptance and configured application acceptance remain dispatcher-owned.
- Native preparation failures remain failed evidence. `abi-overlap.json` / `.log`: 4 executed / 2 passed / 2 failed while pre-verify's automatic Node-ABI rebuild overlapped replay; the same saved-title assertion failed, so that overlap alone establishes no cause. `abi-stale-rebuild.json` / `.log`: 4 executed / 0 passed / 4 failed at the preserved SQLite prerequisite after `install-app-deps` reported success but reused the Node binary. Forced `electron-rebuild --version 33.4.11 --force --which-module better-sqlite3` then succeeded (`rebuild-electron-force.log`); a direct Electron in-memory load/query/close printed only `electron-sqlite: ready`. All later evidence ran without concurrent native rebuilds. Both failed batches report zero forbidden launches and remain separate from the accepted full replay.
- Recording bytes/provenance and every original scenario assertion are unchanged. Thread SHA256 `53a3db11cfab2d5041b511d7be4d030ab5b2b8449b7fdb3ea1d7e5e3db552ae3`; history SHA256 `de0b1166b6e05e0792228c07be25c20498b117914e673558222eac12cd4e6d2c`. Both retain Desktop `00ec821f9380b00cf2dfc0dd4817ee15584106a5`, daemon `58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf` and binary SHA256 `5f5b3b9ce42eda74024637f4929dd720d36c1226ce6e370eb62fbe9e6b22f7c0`. Offline checks establish no current provider or physical effects; macOS is outside this ticket's verification scope.

## Remaining acceptance

Waiting on #2129, not ready for acceptance: after that independent repair lands, merge main and run five consecutive paired batches (20 executed/passed) at three workers/retry zero, the complete guarded recorded suite and focused regressions, plus required post-merge pre-verify/build. Preserve every original assertion and capture. The dispatcher-owned configured application gate must independently pass both protected cases without retry. No test was skipped or assertion forgiven to obtain a green result here.

## Revisions

### 2026-10-19 — merged retirement contract and verifier rework

Findings 1 and 2 at `88d80ac2` exposed a stale design record and duplicate settlement code after merging #2129. This entry supersedes the original Design, State + concurrency model and Remaining acceptance where they differ; the earlier evidence remains historical, including every failed run.

**Contract.** The replay closing hook in `clientScenario.ts` awaits `RecordedExchange.whenConnectionComplete()` and then `relay.whenServerFramesForwarded(exchange.serverFrameCount())`. Preserve that merged runtime. Remove the unused `settleConnection()` method and move its five boundary regressions onto `whenConnectionComplete`, rather than maintaining two contracts. No caller migration or application change is needed.

`whenConnectionComplete(timeoutMs = 5_000)` snapshots the retiring connection ordinal and observes natural `drain` progress. Completion means the cursor reaches the next connection or recording end, with all current-prefix replies emitted. An encountered unreleased checkpoint rejects immediately without releasing it; it does not poison the exchange. A checkpoint later in the current prefix is rejected when natural progress reaches it, not before preceding requests arrive. Checkpoints belonging to the next connection are outside this wait. Missing-prefix timeout and request/connection mismatches remain sticky and preserve their original errors. Every outcome removes the progress subscription and timer.

**Delivery and concurrency.** Exchange progress proves matching/emission, not outbound delivery. The hook then snapshots the cumulative server-frame count (one Noise response per connection plus emitted application frames) and awaits the relay's successful client-leg WebSocket send callbacks. The relay separately bounds this wait at five seconds and rejects delivery errors or premature relay closure. Synchronous daemon sends alone do not establish this boundary; receiver/application acknowledgement is not claimed. Failure cleanup bypasses both waits, exits the process and preserves the primary error. Both lifecycle hooks are removed in fixture `finally`; handles are cleared after failed retirement.

**Coverage.** `recordedLifecycle.test.ts` will run all five former settlement regressions against the active method: current/future connection scope, sticky missing-prefix timeout, unreleased checkpoint without frame release, concurrent sticky mismatch and next-connection checkpoint exclusion. Add the before-checkpoint-arrival case to make the merged checkpoint semantics explicit. Keep the existing active-method regressions. `replayProfileRetirement.test.ts` retains the delayed resumed-list ordering through the actual closing hook and isolated-app helper; add held relay confirmation success/failure cases proving the process stays alive after prefix completion and exits only after confirmation, or closes while preserving a delivery error. `src/main/transport/fakeRelayForwarder.test.ts` already covers actual socket forwarding, a pending frame count and closure rejection; run it unchanged. Inspection/native/observer regressions remain required and unchanged.

**Accepted evidence and current acceptance.** #2129 is CLOSED (merged by `3897f0dd`). Its authoritative verifier PASS at `62845cfd114fe43c973743e88f288d7fe934b88c`, run `ff7b11ca92e05b46a66542f70bca10da8978b3194d1db5eb25bc9d60e91bb1cd`, inspected five consecutive guarded paired batches at implementation `aa4938b653cf0b2f9b6f98b238699c2287a17191`: 20 executed/passed, 0 failed/skipped, both cases twice per batch, fully parallel, three actual worker slots, retries zero. Subsequent guarded replay: 29 executed/passed, 0 failed, 1 existing system-prompt-reset fixme, one worker, retries zero. All exchanges had zero remaining requests and all guards zero forbidden launches. Its configured application gate passed both cases without retry (515 executed/passed, 0 failed, 5 existing skips). This is accepted retained evidence, not a rerun in this rework.

The #2072 verifier at `88d80ac2` confirmed those runtime paths and original scenarios survived the merge unchanged. Its own configured application gate recorded 515 executed / 513 passed / 2 failed / 5 skipped at three actual slots/retry zero: history's independent-profile paging-progress assertion failed after 32 matched / 63 emitted / 0 remaining; thread passed at 45 / 378 / 0. The selected dispatcher rerun passed all 3 selected executions without retry, including history. Those original failures remain failed evidence, explicitly accepted by the dispatcher's flake policy, and are not blockers for this rework. The old open-#2129 hold above is superseded.

**Rework validation.** Install dependencies; run the active boundary and relay-confirmation tests before deleting the duplicate. After the final main merge run affected-file pre-verify, build and client-test typecheck, then prepare Electron SQLite sequentially and run guarded paired batches and the complete recorded suite. Record fresh counted results below. The dispatcher owns the new candidate's configured application gate. No live provider, physical-effect or macOS acceptance is claimed.

Cleaner-shape check: one active completion method plus the existing relay boundary is sufficient; a second exchange settlement method adds no independently useful behavior. No in-flight feature branch overlaps the three fixture/test files selected for rework. Rework size: one behavior, under 200 added/changed lines including this record and evidence, zero new exported types, zero runtime consumer migrations, four acceptance behaviors and no new runtime reject branches; the final ticket remains within 800 written lines.

## Documentation handoff

- Pending documentation stage: `docs/recorded-tests.md` § Replay contract and `docs/knowledge/features/e2e-harness-context-recovery.md` § Persistent awaited-inspector loss: retain the final successful-retirement contract, request-completion versus relay-forwarding boundary, content-free controlled ordering, historical-trigger uncertainty, counted Linux evidence, capture provenance and explicit system-prompt-reset fixme. Correct stale acceptance references; preserve offline/live proof boundaries.

## Rework validation evidence

Linux x64, 2026-10-19, tested implementation `fbba3bdd7700d69cbfd7fcc9e563a96c58b8a632`, main `3897f0dd5637f16f5f82a337b33ccaed3274389b`. Rework plan `3478dba7` preceded code changes. This final commit adds evidence only. Fresh reports/logs below are under `/tmp/builder-2072/`; accepted prior verifier bundles are retained in `rework-evidence/` and `2129-accepted/` there.

- Coverage before duplicate removal: `rework-active-before-removal.log`, 33 executed/passed, 0 failed/skipped. The active method already satisfies the migrated assertions; removing the unused method preserves runtime behavior. After removal, both `rework-regressions.log` and `rework-regressions-after-replay.log` record 97 executed/passed, 0 failed/skipped across all seven lifecycle/exchange/inspection/observer/isolated-app/relay files. The latter ran after complete guarded replay.
- Controlled delayed-list trace at this revision remains `exit-1, visible-history-assertions, resumed-list, outbound-reply, outbound-reply, exit-2, independent-connection`, then `exit-3`. Before the independent reconnect: 3 matched / 4 emitted / 1 future request remaining. The original-path red above remains historical evidence; no new historical scheduling trigger or receiver acknowledgement is claimed. Both new relay-confirmation cases assert `prefix-complete, relay-wait, relay-forwarded|relay-failed, exit-1`: the process remains alive with three future requests outstanding until forwarding resolves/rejects, uses boundary count 2 (Noise response plus one emitted frame), and preserves the exact delivery error on failure. Existing actual-socket relay tests also pass.
- Five consecutive commands used `PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/builder-2072/rework-focused-N.json node scripts/run-offline-replay.mjs --grep 'a real daemon lazily fills a served gap|daemon-built thread streams' --fully-parallel --workers=3 --repeat-each=2 --retries=0 --reporter=list,json --output=/tmp/builder-2072/rework-focused-N-results`, for N = 1 through 5, stopping on any failure. Every batch executed/passed 4, failed/skipped 0, configured workers 3, actual parallel slots 0/1/2, retries 0. Aggregate: **20 executed/passed, 0 failed/skipped**. Each thread exchange is 45 matched / 378 emitted / 0 remaining; each history exchange is 32 / 63 / 0. All five guards record zero forbidden launches and every report has zero top-level errors. Content-free summaries are in `rework-focused-summary.jsonl`.
- Followed with `PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/builder-2072/rework-recorded-full.json npm run e2e:recorded -- --reporter=list,json --output=/tmp/builder-2072/rework-recorded-full-results`: **29 executed/passed, 0 failed, 1 existing fixme**, configured/actual workers 1/1, retries 0. All 29 exchanges have zero remaining requests, both protected cases have the counts above, and the guard records zero forbidden launches. The excluded assertion remains `real claude picks up a saved channel system prompt at Reset session`; it is not counted as executed or passed.

| Fresh JSON report | SHA-256 |
| --- | --- |
| `rework-focused-1.json` | `4cac385b98535153528965d9499e0af0874384d8c4de1b7b69b094a9bb51da12` |
| `rework-focused-2.json` | `f01cf663d06ce36c643fb6bbdfa52f2e7edd115cfb02f94d3cdb0aa08d6dce3e` |
| `rework-focused-3.json` | `c937dbeab2c83bff26a33502e6e3f4a9d8299fab90419f03404131e3a07adca6` |
| `rework-focused-4.json` | `83e2732cd1ee47e32f911452b3ee7e47d357810c8388785190af493654bb09f3` |
| `rework-focused-5.json` | `e2b103c2ab601bc3bcc78a3ffda4f936ce1c8d67ab1563d62a976fbf80ad69a1` |
| `rework-recorded-full.json` | `ade56db868a307eb39dce8a0cbab844e59a48d671128a88c4d15f19f79f2ed5e` |

- Final fetch/merge was already up to date. `rework-pre-verify.log` passes all five checks, including all 14 affected lifecycle tests. `rework-build.log`, `rework-client-typecheck.log` and `rework-docs-check.log` pass. Build SHA-256: main `14964f03eb41095b9ee91af5f78d8a422a44c760386a9c8e498c33ff1865b69f`, preload `89811584d1c0da25e8a8bb4f1ef7295f36a9aa6c2fb666ea8b320b971b196c20`; the complete recorded command rebuilt the same bytes.
- Node preparation finished before Electron preparation and replay. `rework-electron-native.log` records forced rebuild for installed Electron 33.4.11; `rework-electron-probe.log` confirms load/query/close with only `electron-sqlite: ready`. No native rebuild overlapped replay. The initial sandboxed dependency install failed while spawning esbuild; the approved install and final post-merge install passed. It was not a test execution.
- Both recordings retain the SHA-256 values and complete source provenance above. Original scenario assertions, strict request/payload matching, causal barriers, device/connection boundaries, native prerequisite, synchronous inspection and history observers are unchanged. After duplicate removal, `recordedExchange.ts` is identical to merged main; the closing hook still awaits both connection completion and relay forwarding.

**Current remaining acceptance:** builder checks are complete; #2129 is closed and is no longer a hold. The dispatcher owns the new candidate's configured application gate and complete unit acceptance; documentation owns the pending handoff above. The prior failed application runs remain failed evidence under their accepted-flake record. These fresh results establish offline Linux behavior, not current provider/daemon or physical effects. macOS is outside this ticket's verification scope.
