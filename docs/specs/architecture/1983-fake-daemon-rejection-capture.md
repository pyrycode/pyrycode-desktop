# Fake-daemon setup rejection capture (#1983)

## Files read

- `e2e/fixtures/fakeDaemonSetup.ts` → `startFakeDaemonForTest`, `classifySetupFailure`: exact reset-only retry and redacted error contract.
- `e2e/fixtures/fakeDaemonSetup.test.ts` → setup diagnostics cases: real reset, HTTP rejection and Noise-free assertions.
- `e2e/fixtures/launchPairedApp.ts` → `startFakeServer`: per-launch ownership and teardown before Electron exists.
- `src/main/transport/fakeDaemon.ts` → `onDialError`, `close`, `freeAll`: failed attempts already terminate their socket and free Noise state.
- `src/main/transport/fakeRelayForwarder.ts` → `startFakeRelayForwarder`, `close`: HTTP listener and accepted-leg ownership.
- `src/main/transport/fakeRelayForwarder.test.ts` → forwarder lifecycle tests: existing response and re-splice contracts.
- `e2e/conversation-mute-command.spec.ts` → named mute command scenario: retain every assertion unchanged.
- `docs/knowledge/INDEX.md`, root `CLAUDE.md`, `docs/knowledge/features/e2e-harness.md` § Pre-Electron fake-daemon setup failures and `development-verification.md`: capture scope and counted validation.
- Installed `ws` → `handleUpgrade`, `abortHandshakeOrEmitwsClientError`: adding a rejection listener replaces the default response; observe without one.

## Context

The historical macOS full-suite HTTP 400 has no surviving occurrence artifacts. Prior serial Linux probes and focused passes establish no cause. Recovery explicitly requests a behavior-preserving diagnostic candidate first, followed by native configured-suite capture and an evidence-selected repair. This plan does not attribute the historical failure to a product command or claim capture alone repairs it. No ADR is needed.

## Design

- Give the existing forwarder a fresh `setupDiagnostics()` snapshot: bounded counters for HTTP parser errors, upgrade requests, upgrade rejections and accepted connections; fixed parser classifications and upgrade-check booleans. Retain no requests, sockets, errors, URLs or headers in snapshots.
- Supply the WebSocket server an explicitly owned HTTP server. Preserve the stock `ws` HTTP 426 response. A private HTTP-server subclass observes `clientError` in `emit` and returns `super.emit` unchanged, preserving Node's default parser rejection and cleanup. Attach no `clientError` or `wsClientError` listener.
- Observe upgrades after the existing synchronous `ws` handler. A socket ended by that handler records rejection; GET/Upgrade/key/version booleans distinguish common preconditions without replacing validation or responses. Accepted connections retain existing leg routing.
- Add optional capture context to `startFakeDaemonForTest`: snapshot the owning forwarder before each dial; emit one content-free attempt record after success or rejection, with counter-delta booleans, fixed failure classification and responder classification (`http-parser`, `websocket-upgrade`, `opened`, `unobserved`). Preserve options, returned handles, sanitized thrown errors and exactly one pre-open ECONNRESET retry.
- `startFakeServer` attaches each record to its Playwright test before Electron launch, using only client-owned teardown-step names and numeric launch/attempt indices for attachment names.
- After native occurrence evidence, select the smallest demonstrated setup repair and append a revision before departing from this diagnostic contract. No HTTP-400 retry, delay, assertion weakening or new harness.
- In-flight overlap: #1986 adds a later Welcome readiness operation in `launchPairedApp`; these setup edits are local to `startFakeServer` and independent.

## State + concurrency model

Counters belong to one forwarder; snapshots are copies. Attempt baselines are local to one serial setup invocation. No global diagnostic registry, retained event list, timer or subscription is added. The forwarder closes its WebSocket server and explicitly owned HTTP listener; the fake daemon continues to own Noise cleanup. Capture is awaited before retry/rethrow/return.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| HTTP parser rejection then a fresh valid dial | forwarder controlled malformed-request/success regression |
| WebSocket upgrade rejection then a fresh valid dial | forwarder invalid-key/default-response/success regression |
| Failed daemon attempt then successful setup | setup HTTP-400 Noise-free/socket-close/subsequent-usable-fake regression |
| First reset followed by second attempt | existing real pre-open reset test plus per-attempt capture assertions |
| Multiple forwarders / repeated snapshot reads | independent counters and immutable snapshot assertions |
| Close twice before/after acceptance | existing close-idempotence tests, including listener release |

## Error handling

Errors remain the existing replacement Error with no cause. Parser codes are allowlisted, all other values become a fixed `other`; upgrade input becomes booleans only. An HTTP rejection still fails immediately. An unobserved responder stays explicitly unknown. No raw caught errors, causes, URLs, headers, keys, frames or daemon content enter diagnostics.

## Testing strategy

- Test first: controlled real HTTP-parser and WebSocket-upgrade rejection capture fails before implementation; compare rejection response bytes with an uninstrumented server and prove a subsequent connection succeeds.
- Extend existing setup tests to prove per-attempt records, redaction, no extra HTTP retry, failed socket/Noise cleanup and successful encrypted exchange using existing transport helpers.
- Run focused unit tests, final-main pre-verify check and build. Target total written work approximately 450 lines, two exported diagnostic types, one updated caller, three acceptance behaviors and no new error/retry branches; within all sizing boundaries.
- Push the candidate for native capture through ordinary admission. Native proof must use the complete configured fake suite at original concurrency and portable fresh reports/logs; inspect every remaining failure and skip. The dispatcher owns that full-suite gate. The listed fleet recipes currently expose no Desktop suite execution; resolve that route without treating a platform probe as test evidence.
- After evidence selects a repair, obtain ten consecutive named-test executions with retries disabled, record exact revision/command/counts/retries/paths, and hand the complete-suite gate to the dispatcher. Preserve all existing mute-command assertions. No live-Claude specs are changed.

## Open Questions

- Which native Desktop capture admission route supplies the complete configured suite? The provided `platform-probe` recipe executes no candidate tests; the other two public recipes target different repositories.
- What boundary causes the historical HTTP 400? Pending actual native capture; success-only reruns do not answer it.

## Revisions

2026-10-15: Capture callbacks synchronously collect at most two records per forwarder; `startFakeServer` awaits attachments in `finally`, after registering a successful daemon's teardown. This keeps attachment I/O failures from stranding a returned daemon or being misclassified as dial failures. A fixture-owned setup ordinal exists before Electron launch and advances even when setup fails; the existing Electron launch ordinal starts too late for these attachments. Successful dials with no accepted connection observed on the owning forwarder remain `unobserved`.

2026-10-15 validation of candidate `62284b638aed8d81b185c12280a182c82d9d62e6`, including main `8621ca3adb16`:

- Controlled forwarder capture tests first failed for the missing snapshot API (2 failed, 8 passed); setup capture tests first failed for missing records (3 failed, 14 passed). Final focused setup/forwarder/daemon run: 53 executed, 53 passed, zero failed/skipped. Parser/upgrade responses match the uninstrumented baseline; unknown parser codes become `other`. HTTP 400 fails once, frees Noise/socket state, and subsequent setup succeeds; a captured successful fake completes an encrypted exchange.
- `python3 "$AGENTS_REPO_PATH/bin/pre-verify-check"`: all 5 checks pass, 403 unit files, 10,201 passed, 3 existing skipped. `npm run build`: pass. Fresh logs: `/tmp/builder-1983/capture-20261015-0158/pre-verify.log` and `build.log`.
- Linux focused command: `PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/builder-1983/capture-20261015-0158/mute10-02/report.json xvfb-run -a node node_modules/@playwright/test/cli.js test e2e/conversation-mute-command.spec.ts --config=playwright.config.ts --grep 'a setConversationMuted command reaches only the owning host and settles once' --repeat-each=10 --workers=1 --retries=0 --reporter=list,json --output=/tmp/builder-1983/capture-20261015-0158/mute10-02/test-results`. Result: 10 executed/passed, 0 failed/skipped/retried, 20 per-forwarder setup attachments, all `opened`; fresh log `mute10-02/run.log`. Every mute-command assertion is unchanged. An earlier anchored full-title grep selected zero tests; its separate `mute-repeat.json`/`mute-repeat.log` is not passing evidence.
- Retrieved managed task `143d2a4234fba53d5bd58899efd1420ebbd9f6346e0904cb86e8d6a64c533d26` to fresh `prior-native-route/`: `platform.json` reports Darwin/arm64 and `candidate_tests_executed: false`. The exposed fleet recipes are platform-probe, daemon memory smoke and Android capture; none executes Desktop Playwright. Native complete-suite admission remains unresolved, and no native candidate result or historical cause is claimed. The dispatcher-owned complete configured fake-suite run at original concurrency, its totals/skips/retries/failures and portable reports/logs remain pending. Capture from that run must select the actual reliability repair before this ticket can be accepted.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] Parser errors and HTTP upgrade input cross only into allowlisted classes, booleans and counters in `startFakeRelayForwarder`; capture never retains the input objects.
- [Tokens, secrets, credentials] Synthetic Noise keys remain in the main-process fake; diagnostics exclude keys, tokens, headers, URLs, causes and content. No credential access is added.
- [File and storage operations] Only Playwright attachments use the existing test-owned output destination, with static/numeric names; no untrusted path construction or production storage changes.
- [Electron attack surface] Setup runs before Electron. No renderer, IPC, navigation or window configuration changes.
- [Cryptographic primitives] Existing Noise library, variant, fresh-attempt keys and cipher lifecycle remain unchanged. Tests observe freeing without serializing key material.
- [Network and I/O] Default Node parser and ws upgrade rejection responses must be preserved by passive observation, verified against uninstrumented servers. No blanket retry, relaxed validation, increased payload limit or timeout.
- [Errors, logs, telemetry] SHOULD FIX — prove unknown parser/error inputs and private sentinels cannot enter attempt records or replacement errors. Emit one bounded record per attempt, no event histories or raw error objects.
- [Concurrency] HTTP listener ownership becomes explicit alongside existing WebSocket ownership. Verify rejected sockets close, repeated teardown settles, snapshots cannot mutate internal state and subsequent attempts use fresh Noise state.
- [Threat model alignment] Controlled hostile malformed setup input is rejected by existing validators and redacted in capture; frame parsing, renderer isolation and credential-at-rest behavior remain owned by existing product transports and are unchanged by this ticket.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-15

## Revisions

2026-10-19 — listener ownership investigation after recovery:

- Finished the pending merge in `89a1db2f`, retaining main's explicit IPv4 bind from `fdee12cc` and newer thread fixtures/frame-delivery behavior. Merge build passed; 40 focused setup, forwarder and desktop-isolation tests passed on macOS outside the sandbox.
- Retrieved native task `cb4e12de9f75482bab04c31cddd0670312bf55c014c22b554b7015cbb4bf76f2` under `/tmp/builder-1983/native-prior-20261019/`. Candidate `e8281ae4` executed 398, passed 397, failed 1, skipped 1, retried 0. The mute test passed; all 456 setup records opened. The sole failure was ArrowUp in `thread-scroll-pin.spec.ts`; this is not rejection evidence. The Desktop native route is now available through `desktop-fake-suite`.
- A bounded local macOS probe (`/tmp/builder-1983/listener-probe.cjs`) establishes a causal trigger: after `http.listen(0)` binds wildcard, a second server can bind the advertised IPv4 port and receive the dial instead. An explicit `127.0.0.1` owner makes that second bind fail with `EADDRINUSE`, and receives its own dial. This proves an ownership defect and the merged explicit-bind repair, but does not identify the historical responder or equate the historical 400/404/501 occurrences.
- Keep the merged explicit bind. Add `listenerMatchesDial` to existing snapshots/attempt records, computed from the actual bound address/family, retaining only a boolean. No new export, retry, timeout, response or transport API.
- Test the real bound address and refusal of a competing exact IPv4 listener. Exercise concurrent forwarders with distinct opaque frame exchanges and independent counters. Use a test-only interception of `Server.listen` to reproduce the prior wildcard binding, then a competing IPv4 responder for each observed status (400, 404, 501). Assert one terminal attempt, an unobserved owning listener, socket close and Noise free; remove the contender and prove a subsequent encrypted exchange through the original owner. Existing parser/upgrade tests continue to prove default rejection responses.
- Lifecycle coverage: wildcard shadow then contender close/reuse is covered by the setup occurrence cases; exact bind ownership and concurrent forwarder isolation by forwarder tests; failed attempt then fresh Noise/encrypted exchange by setup occurrence cases; repeated close and snapshot independence retain their existing tests. All mute-command assertions remain unchanged.
- Scope remains one behavior: reliable ownership of the fake setup dial, with its regression and bounded diagnostics. Existing branch work plus this revision targets fewer than 800 written lines, two exported diagnostic types total, one capture caller, three acceptance behaviors, unchanged error branches. No independently useful sibling behavior is added.
- Run affected tests first, final-main pre-verify and build, then ten retry-disabled macOS mute-test executions. Request the dispatcher-owned configured complete suite only at the pushed candidate revision; record every failure/skip. No live-provider acceptance changes.

## Security review

**Verdict:** PASS (2026-10-19 revision)

- [Trust boundaries] `listenerMatchesDial` compares the actual server address/family to client-owned constants; records contain the boolean only. Request parser/upgrade inputs remain allowlisted classes and booleans.
- [Tokens, secrets, credentials] No credentials or keys enter capture. Noise state stays in the fake; tests spy on free calls without recording key material.
- [File and storage operations] Existing Playwright attachment destinations/numeric names remain unchanged; probe artifacts stay outside the tree. No product storage changes.
- [Electron attack surface] No renderer, IPC, navigation or window changes. Setup failures still precede Electron.
- [Cryptographic primitives] Same Noise variant/library; a failed dial frees its handshake before the next fresh attempt, which must complete an encrypted exchange.
- [Network and I/O] MUST FIX addressed by retaining main's exact IPv4 bind on the diagnostic HTTP listener. A competing IPv4 responder must fail to bind. HTTP 400/404/501 remain terminal; parser/ws default responses remain unchanged.
- [Errors, logs, telemetry] No raw addresses, errors, headers, causes, URLs, keys or content in capture. Controlled responder status is classified through the existing exact fixed HTTP pattern. No diagnostic event histories.
- [Concurrency] Each listener/counter belongs to one forwarder; tests prove concurrent exchanges cannot cross. Failed sockets, contender listeners and Noise states close in finally paths, with existing idempotent forwarder teardown preserved.
- [Threat model alignment] A conflicting local test listener is the demonstrated threat. Product relay/daemon/renderer security and at-rest credential controls are unchanged; no new product surface is introduced.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-19

2026-10-19 implementation clarification: the occurrence regressions retire the wildcard negative-control owner after closing its competing responder, then construct a fresh explicit IPv4 owner for the encrypted exchange. This checks fresh successful setup on the repaired path on every OS; Darwin recreates its actual wildcard shadowing, while other platforms use an IPv6-only negative control without adding skipped cases. All three cases assert failed socket close and Noise free before the fresh setup. The new ownership regression was observed failing against the restored legacy `http.listen(0)` (`legacy-bind-red.log`: 1 executed/failed; the other 15 cases were deselected), and the restored exact bind passed all affected tests (`ownership-green.log`: 60 executed/passed, 0 failed/skipped).

## Validation evidence

2026-10-19, macOS arm64, implementation revision `fdd49d04635408dbd8a6cbe69d53089ace54377b`, containing final main `fbb0b4ab3f8c`:

- Both sequential pre-verify runs pass all five checks: `--test-file e2e/fixtures/fakeDaemonSetup.test.ts` (21 executed/passed) and `--test-file src/main/transport/fakeRelayForwarder.test.ts` (16 executed/passed), zero failures/skips. Logs: `/tmp/builder-1983/pre-verify-setup-sequential.log`, `pre-verify-forwarder-sequential.log`; counted JSON/XML under `/tmp/builder-1983/unit-evidence/`. The combined affected setup/forwarder/daemon run passed 60/60 in `ownership-green.log`.
- Final `npm run build` and `npm run check:docs` pass; logs `/tmp/builder-1983/final-after-preverify-build.log` and `check-docs.log`. Electron native preparation completed after both Node gate runs (`electron-native-preparation.log`). Initial concurrent pre-verify runs collided while rebuilding SQLite; those failed logs remain `pre-verify-setup.log` and `pre-verify-forwarder.log`, and are not passing evidence. The initial sandboxed merge unit run could not bind sockets; its approved rerun passed 40/40 (`/tmp/builder-1983-merge-tests-approved.log`).
- Command: `PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/builder-1983/mute-ten-20261019/report.json node node_modules/@playwright/test/cli.js test e2e/conversation-mute-command.spec.ts --config=playwright.config.ts --project=parallel --no-deps --grep 'a setConversationMuted command reaches only the owning host and settles once' --repeat-each=10 --workers=1 --retries=0 --reporter=list,json --output=/tmp/builder-1983/mute-ten-20261019/results`. Result: 10 executed, 10 passed, 0 failed/skipped, 0 retries; 20 setup attachments, all opened with `listenerMatchesDial: true`. Fresh report/log: `/tmp/builder-1983/mute-ten-20261019/report.json` and `run.log`. Every original mute assertion is unchanged.
- Content-free native ownership probe: `/tmp/builder-1983/listener-probe.log`; wildcard permits the competing IPv4 bind and loses the dial, exact bind rejects the competitor and receives the dial. Controlled setup regressions reproduce all three HTTP statuses and verify cleanup and encrypted exchange. This establishes the repairable ownership defect, not the historical responder's identity.
- Dispatcher-owned complete configured fake suite requested at the pushed implementation revision above: task `1c09b4ac6e58ce7f6f97d670ce41180fa19050515e17d5c3edc9e642c3d0c91d`, recipe/capability `desktop-fake-suite`; request receipt `/tmp/builder-1983/full-suite-request-receipt.json`. Pending execution and counted-result review; focused passes do not replace it.
- Prior native capture retained under `/tmp/builder-1983/native-prior-20261019/desktop/`: 398 executed, 397 passed, 1 failed, 1 skipped, 0 retries, mute passed. Failure: `thread-focused ArrowUp releases following during streaming`; skip: `an independent input-enabled cover preserves isolated hover` because a never-shown window receives no pointer from the display. All 456 setup records opened. These are historical results at `e8281ae4`, not acceptance of this repair revision.

Only macOS is verified by this ticket; other operating systems are outside its verification scope. Subsequent evidence-only plan commits do not change the tested implementation tree.

## Returned full-suite evidence

2026-10-19: read completed task `1c09b4ac6e58ce7f6f97d670ce41180fa19050515e17d5c3edc9e642c3d0c91d` into fresh `/tmp/builder-1983/native-final-20261019-review/desktop/` and inspected all six returned artifacts. This supersedes the pending-result statement above.

- Reviewed implementation: `fdd49d04635408dbd8a6cbe69d53089ace54377b`, macOS arm64. Managed invocation: `node node_modules/@playwright/test/cli.js test --config=playwright.config.ts`, with no file, grep, shard or project filter. All three configured projects (`native-writer`, `clipboard`, `parallel`) ran with four configured/actual workers, repeatEach 1 and retries 0. Returned configuration SHA256 `0d1fb967aa3b3d66275b736ec63bc55142dff69708eb297cce6ff3d4898d2643` matches that revision's file.
- Complete result: **517 executed, 510 passed, 7 failed, 3 skipped, 0 retries/flaky**, accounting for all 520 configured cases; no top-level report errors. Installation and build succeeded in `execution.log`. The gate remains **failed**, not accepted as green.
- The unchanged named mute-command scenario was present and passed once at retry index 0. Its earlier ten consecutive retry-disabled passes remain recorded above; neither the scenario nor its owning-host, settlement, unclaimed-ID or list-refresh assertions changed.
- All **566** setup records contain attempt 1, outcome/responder `opened`, `listenerMatchesDial: true`, upgrade/connection observed, no parser observation/rejection and no failure class. No setup failure or retry occurred. This corroborates the controlled ownership repair; it does not identify the historical HTTP responder.
- Fresh artifacts: `capture.json`, `playwright.json`, `playwright.list.log`, `execution.log`, `playwright.config.ts`, `fake-daemon-setup.json` in the directory above. Playwright report SHA256: `df8e5423094a38eb1fa1bd7b8dd61423d5e62c3ee4b63883b2999e00c8626636`; setup attachment SHA256: `4eaa0143896ef14fff584310af55da5acc8b69e4f96ca2131729b1e250c8e8a5`. The managed task retains the portable originals.

Every remaining failure is in `visible-tail-read.spec.ts`, at `focusVisibleTailWindow`'s acknowledged native-state mismatch (`Visible-tail window is not visible and focused`), before the read-publication assertions:

| Failed scenario | Result |
| --- | --- |
| `read setup is reused across committed same-row deltas on short and long threads` | failed, retry 0 |
| `stable callbacks exclude hidden, queued and received but uncommitted tails` | failed, retry 0 |
| `committed folded tails require focus, uncovered viewport and a closed reader` | failed, retry 0 |
| `late read contract rechecks the committed tail while visible` | failed, retry 0 |
| `late read contract rechecks the committed tail while blurred` | failed, retry 0 |
| `late read contract rechecks the committed tail while reader-covered` | failed, retry 0 |
| `late read contract rechecks the committed tail while above-tail` | failed, retry 0 |

All seven launch-fate attachments report running at outcome, exit 0, no signal and no teardown failure. The focus helper/spec are unchanged by this branch. No open matching tracker existed; filed [#2150](https://github.com/pyrycode/pyrycode-desktop/issues/2150) in Backlog at priority:low for this separate macOS boundary. Closed #2074 covered transient acknowledgement loss on Linux; it does not establish a cause for these acknowledged native-state mismatches. No focus assertion, retry setting or skip was changed here, and no accepted-inherited-failure verdict is claimed. Verifier owns full-gate triage.

All three existing skips are retained:

- `desktop-isolation.spec.ts` → `an independent input-enabled cover preserves isolated hover`: explicit reason, `a never-shown window receives no pointer from the display`.
- Recorded `claude-system-prompt` → `real claude picks up a saved channel system prompt at Reset session`: existing `test.fixme`; report supplies no description. Source documents the upstream daemon's frozen session argv not refreshing a saved prompt on reset.
- `sidebar-pinned.spec.ts` → `blocked on #2089 — unpair an unreachable saved host after relaunch`: existing `test.skip`; report supplies no description. Source links #2089's unpair hang reproduced without pins on main.

Current main was merged in `20008086` before this evidence review. Relative to the tested implementation, that merge changes the independent thread-scroll-work scenario and knowledge/spec documentation; setup/forwarder and mute/focus scenarios are unchanged. No duplicate native capture was requested for this evidence-only follow-up.

After that merge, fresh install, both sequential pre-verify checks and `npm run build` pass: setup **21 executed/passed**, forwarder **16 executed/passed**, zero failures/skips, all five pre-verify checks green in each run. `npm run check:docs` and `git diff --check` also pass. Fresh logs are `/tmp/builder-1983/result-review-install.log`, `result-review-preverify-setup.log`, `result-review-preverify-forwarder.log`, `result-review-build.log` and `result-review-docs.log`; counted unit JSON/XML and invocation records are copied to `/tmp/builder-1983/result-review-unit-evidence/`. This follow-up changes only plan evidence; no further Electron launch or provider/live test was required. macOS remains the only verified operating system.

## Interactive recovery evidence, 2026-10-20

The operator reports no system alert awaiting a response. No inspection or dismissal of UserNotificationCenter was attempted. This observation does not identify the historical alert or establish its causal role. Preserve #2150's unresolved investigation and all earlier failures.

Fresh artifacts are retained under `/Users/juhanailmoniemi/Documents/Codex/2026-10-20/what-s-the-issue-with-ticket-4/work/focus-2150-20261020/`:

- Focused observation on the unchanged diagnostic branch at `e3d75a6e3cd360b737eb555da93d8a89c5d74ab6`: all seven existing `visible-tail-read.spec.ts` scenarios executed and passed, zero failed/skipped/flaky/retries, four configured workers and one actual worker. Command: `node node_modules/@playwright/test/cli.js test --config=playwright.config.ts e2e/visible-tail-read.spec.ts --no-deps --retries=0 --reporter=list,json`, with fresh JSON/output paths. `playwright.json`, `execution.log`, and `results/` retain evidence. Report SHA256 `b6922e56fd791bbda3479265c568b21dbd5ff7fbc1834ced28ad92957919a3cb`. This proves current focused behavior only; it is neither a causal repair nor full-composition acceptance.
- Complete configured gate on the previously reviewed #1983 candidate `5e462e71afcef1680f64f443b3764a208f8c628e`, after a fresh successful build and Electron-native preparation: `node node_modules/@playwright/test/cli.js test --config=playwright.config.ts --retries=0 --reporter=list,json`, no filters or project exclusions, normal four workers. Of 520 collected cases, **1 executed/failed, 0 passed, 519 not executed, 0 retries/flaky**. Two unexecuted cases already carry skip/fixme annotations; the other 517 were blocked by the prerequisite failure. The dependent mute and focus scenarios did not execute. Reports: `pr1988-full.json`, `pr1988-full.log`, `pr1988-full-results/`; build/preparation logs use the `pr1988-` prefix. Report SHA256 `5bcc9cb3a541e5ae1ad0a8c6688b412adcc04d73d5e796807ca05d3512dc8035`.
- The sole failure is `history-writer-native.spec.ts` → `finite protected writer backlog preserves native keyboard and both event loops`: the existing 65-second completion observation expired with **7,719/8,333 items persisted**, 250 submitted writes, no writer errors and no completion timestamp. All three genuine input commits passed (approximately 652/261/373 ms); renderer/main maximum heartbeat gaps were approximately 23/222 ms. The OS-keychain backend was active. The fake setup opened on its owning IPv4 listener; teardown was clean. This matches the slow-drain invariant already repaired by #2125, whose authenticated-node reuse implementation was absent from the reviewed candidate. No blanket retry or deadline increase was introduced.

Merged local main in `9f886875`, then fetched and merged the latest `origin/main` (`5655d79feae1`) in **`47b92b3185639884f40686c0e8068c59164c16aa`**. Both merges were conflict-free. The ticket's six-file delta relative to main retains the explicit IPv4 bind, listener/dial ownership diagnostic, terminal HTTP rejection, socket/Noise cleanup and controlled encrypted-exchange regressions. No new implementation was added in this recovery.

Validation of the integrated code:

- The first merged revision passed all five pre-verify checks, including typecheck and 21 setup tests (`merged-preverify-setup.log`). On the final merged code, `npm test -- e2e/fixtures/fakeDaemonSetup.test.ts src/main/transport/fakeRelayForwarder.test.ts` recorded **37 executed/passed, 0 failed/skipped**, in `merged-affected-unit.log`.
- `npm run build` passed on `47b92b31` (`merged-build.log`). Final `pre-verify-check --no-suite` passed main-inclusion, required Security review and removed-string checks (`merged-preverify-final.log`); its two suite checks were explicitly omitted because the fresh build/typecheck and affected tests are separately recorded above.
- `AGENTS_REPO_PATH=/Users/juhanailmoniemi/Workspace/Projects/pyrycode-desktop-agents npm run check:docs` passed. The initial invocation without that environment variable exited before validation because this nested worktree has no sibling agents checkout; it was not a documentation defect. `git diff --check` passed.

The integrated candidate requires a **fresh normal dispatcher/verifier cycle and complete configured macOS gate**. No green full gate, accepted inherited failure, verifier approval or historical HTTP-responder diagnosis is claimed. Keep #2150 open and preserve its inspection-refusal boundary; today’s operator observation and focused passes do not justify closing that investigation. Documentation-only evidence changes after the tested code revision do not add a new implementation.
