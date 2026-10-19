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
