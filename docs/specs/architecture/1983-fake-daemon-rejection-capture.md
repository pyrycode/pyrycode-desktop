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
