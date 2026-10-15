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
