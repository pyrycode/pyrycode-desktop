# 1123 — oversize close-code determinism: move the 1009 pin off the real socket

Ticket: [#1123](https://github.com/pyrycode/pyrycode-desktop/issues/1123) · size `s` · `security-sensitive`

## Files read

`mcp__codegraph__*` is not initialised in this repo (every call returns "CodeGraph not
initialized"), so this reading list was built with Grep + Read rather than `codegraph_context`.

- `src/main/transport/relayConnection.ts` → the `'error'` handler (the `isMaxFrameError` branch
  that sets `pending = {1009, 'max-frame-exceeded'}`), the `'close'` handler (`terminal =
  pending ?? {code, reason}` plus the `relay-closed` diagnostic record), and
  `teardownAndEmitClosed` — the module under test. No production change lands here.
- `src/main/transport/relayConnection.test.ts` → the AC4 case *"closes on an oversized inbound
  frame without emitting a partial frame"* — the flaky assertion — and the diagnostic-log case
  *"logs relay-closed with the numeric code and static classification on a module close"*, whose
  `{status, code}` record shape the new spec mirrors.
- `src/main/transport/relayConnection.teardown.test.ts` → the `vi.mock('ws')` / `FakeWebSocket`
  seam this plan reuses in a new file, and the header comment recording the EventEmitter
  `'error'`-without-listener trap. Not edited (ticket AC4).
- `docs/knowledge/features/relay-connection.md` § "Edge cases and limitations" → the recorded
  rule the flaky assertion violates: *"Assert oversize by 'terminal close + no `message`
  emitted', never by the raw ws close code"* (ws 8.21: the client-side code is 1006; the 1009
  goes only to the peer). Also § "Security posture" — the module is content-free-log by
  construction (ADR 0007), which constrains what the new spec may assert over.
- `src/main/diagnosticLog.ts` → `DiagnosticEvent`'s allowlisted fields (`status` is the numeric
  WS/HTTP code, `code` the module-static classification) — the contract the new log assertion
  pins.
- Grep sweep for the 1009 normalisation across `src/` **and** `e2e/` with no `--include` filter:
  the only assertion site in the repo is `relayConnection.test.ts`'s AC4 case. The e2e tiers and
  the `daemonCapabilityGate` fixture reference `maxFrameBytes` but assert nothing about the
  close code. Confirms the ticket's coverage note — the pin must be replaced, never dropped.

## Context

The AC4 spec asserts the terminal close code is `1009` against a **real in-process `ws`
server**. It failed once under full-suite parallel load on the verification gate for PR #1122,
observing `1006`; 30 subsequent reproduction attempts on two trees were all green.

The normalisation itself is correct and is not in question. What is wrong is *where* it is
pinned: `ws` sets the client-side close code to 1006 and the module rewrites it to 1009 only if
its `'error'` handler runs **before** the `'close'` handler. That ordering is a `ws` internal
(`receiverOnError` calls `websocket.close(1009)` then emits `'error'` synchronously), not a
contract this repo owns — and once `'close'` has landed, `teardownAndEmitClosed` has already run
`ws.removeAllListeners()`, so a late `'error'` can never reach the module at all. A real-socket
spec therefore has a load-dependent verdict by construction, which is exactly what the package
overview's recorded rule warns against.

**No production change.** The ticket traced the blast radius end to end on `main`: both 1006 and
1009 are retryable in `relaySupervisor`'s `DEFAULT_FATAL_CLOSE_CODES`, `noiseRelayDriver`
forwards either verbatim, and `daemonConnection`'s classification maps everything except 4404 to
`'offline'`. The single reachable difference is one content-free diagnostic record. Deferring
the terminal emit to make the ordering irrelevant would collide head-on with the
`removeAllListeners()` / `if (closed) return` teardown guarantees pinned for mobile #496 parity
(`docs/specs/architecture/35-superseded-connection-teardown-regression.md`) — a high bar for a
diagnostic-only gain, and not worth paying. This is a **test-placement fix**.

No ADR is warranted; the recorded rule already exists in the package overview and this ticket
brings the tests into line with it.

## Design

Two moves, both test-side.

**1. The real-socket AC4 case stops asserting the raw close code.** It keeps the two
order-independent halves of the oversize contract — exactly one terminal `closed`, and no
`message` event escaping — which is the assertion shape the overview mandates. A comment records
why the code is not asserted here and points at the file that does pin it, so a future reader
does not "restore" the flake. The assertion is *narrowed*, not relaxed to accept 1006: no
verdict here depends on the ordering.

**2. A new deterministic spec, `src/main/transport/relayConnection.oversize.test.ts`,** pins the
1009 / `max-frame-exceeded` normalisation with no socket and no timers.

It carries its own `vi.mock('ws')` factory returning a synchronous `EventEmitter`-based
`FakeWebSocket`, modelled on the one in `relayConnection.teardown.test.ts`. `vi.mock` is
file-scoped, so a mocked spec cannot live in `relayConnection.test.ts` (real `ws` server) and
the seam cannot be imported *from* the teardown file without editing it. **A new file rather
than a third case appended to the teardown spec:** ticket AC4 requires the two teardown pins to
pass unmodified, that file's header is scoped to the mobile #496 parity argument, and its
comments turn on deliberately *not* emitting a raw `'error'` — an oversize case belongs beside
them, not inside them. The cost is ~18 duplicated lines of fake; the benefit is that the
teardown file stays byte-identical and each file keeps one subject.

Driving the module: emit `'open'` (arms the module's ping interval, cleared by the terminal),
then `'error'` with an object whose only meaningful field is `code:
'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'` — all `isMaxFrameError` reads — then `'close'` with the
library's real 1006. The module's `'error'` listener is still attached at that point, so Node's
"`'error'` with no listener throws" trap does not fire; every case emits `'close'`, so no timer
outlives a test.

Three cases, chosen so that each defeats a different mutation of the `'error'` handler:

| Case | Drives | Asserts | Reddens when |
|---|---|---|---|
| normalises oversize | `open` → `error(WS_ERR_…)` → `close(1006,'')` | exactly one `closed` `{code: 1009, reason: 'max-frame-exceeded'}`; no `message` | the `pending = {1009, …}` assignment is deleted (ticket AC2's detector) |
| logs the classification | same, with a captured `DiagnosticLog` | one `relay-closed` record `{status: 1009, code: 'max-frame-exceeded', host, path}` | the assignment is deleted, or the record stops carrying the provenance |
| does not over-classify | `open` → `error({code:'ECONNRESET'})` → `close(1011,'boom')` | terminal forwards the peer's `{1011,'boom'}`; the record carries `status: 1011` and no `code` | the `isMaxFrameError` guard is widened (e.g. to `true`), which the first two cases would not catch |

The third case is the one that makes the set a real detector rather than a single-mutation
tripwire, and it also re-pins the peer-close provenance rule (`code` omitted unless the module
authored the close) on the deterministic seam.

## State + concurrency model

No store, no IPC, no async task. The fake emits synchronously, so every assertion runs on the
same tick as the emit — no `waitFor`, no fake timers, no polling. `instances` is reset in
`beforeEach` and each case emits its own terminal `'close'`, so the module clears its connect
timer and ping interval before the test ends; nothing survives a case.

## Error handling

Nothing new is thrown or caught. The specs exercise the module's existing `'error'`
classification: the max-frame branch (normalised to a module-authored terminal) and the
fall-through post-open branch (peer code forwarded as-is). The `!opened` pre-open branch is
already covered by the real-socket connect-error cases and is out of scope here.

## Testing strategy

Vitest, node environment, main-process only — no renderer, no DOM, no Playwright. The
verification is the ticket's own AC2 detector: with `pending = {code: 1009, reason:
'max-frame-exceeded'}` deleted from the `'error'` handler's max-frame branch, the new spec must
redden on every run. That mutation is run by hand in Phase B and the result recorded in the PR
body; the spec is then restored to a green tree. Touched-scope gate: `npm test --
src/main/transport/relayConnection.test.ts src/main/transport/relayConnection.oversize.test.ts
src/main/transport/relayConnection.teardown.test.ts` plus `npm run build`. The teardown spec is
included in the run precisely because ticket AC4 requires it to pass unmodified.

## Open questions

1. **Does the narrowed real-socket case still earn its place?** Provisionally yes — it is the
   only test that proves a *real* `ws` client with `maxPayload` drops the oversized frame instead
   of delivering a truncated one; the mocked spec asserts the module's classification, not the
   library's behaviour. Confirm in Phase B that the two are not redundant, and record the answer
   in `## Revisions` if it changes the design.

## Revisions

**2026-09-05 — open question 1 resolved, design unchanged.** The narrowed real-socket case does
earn its place, and the two specs are not redundant. Confirmed by running both mutations against
the deterministic spec: deleting the `pending = {1009, 'max-frame-exceeded'}` assignment reddens
it 5 times out of 5 (ticket AC2's detector), and widening `isMaxFrameError` to a bare truthy
check reddens only the third case — so the mocked spec is a complete detector for the module's
*classification*. Neither mutation touches `maxPayload`, whose drop-the-frame behaviour belongs
to `ws` itself and is witnessed only by the real-socket case's "no `message` escapes" assertion.
Deleting that case would have left the memory-exhaustion defence untested, which is the finding
recorded under [Network & I/O] below. No design change follows.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings. The change adds no boundary. The one untrusted input in play —
  the peer's WS close `reason`, which is attacker-controlled by a hostile relay — is asserted in
  the third case *only* as the value forwarded into `RelayEvent.closed.reason` (an existing,
  documented contract), and the same case pins that it does **not** reach the diagnostic log
  (`code` undefined on a peer close). The spec therefore strengthens, not loosens, the existing
  boundary.
- [Tokens, secrets, credentials] Not applicable by construction: the fake socket is constructed
  with `headers: {}` and a credential-free `wss://relay.example/v1/client` URL, so no test value
  is secret-shaped and no assertion can accidentally become a leak detector's blind spot. The
  real-socket file's dedicated *"never logs the token, the URL query, or a header value"* case is
  untouched and still covers that ground.
- [File / storage operations] Not applicable — no filesystem access is added or exercised.
- [Inter-process / Electron attack surface] Not applicable — no `BrowserWindow`, no
  `contextBridge`, no `ipcMain` channel, no protocol handler. Both files are main-process unit
  specs importing `./relayConnection` only, and the module keeps its zero-IPC surface.
- [Cryptographic primitives] Not applicable — this layer is semantics-blind; the Noise handshake
  sits above it and is not touched. No RNG, no comparison of a secret.
- [Network & I/O] **The finding worth naming.** Narrowing the real-socket assertion must not
  weaken the `maxPayload` memory-exhaustion defence, which is the security-relevant half of the
  oversize path (a hostile relay flooding an uncapped frame). The mitigation is explicit in the
  design: the case keeps *"no `message` event"* and *"exactly one terminal `closed`"*, which
  together are what proves the oversized frame was dropped rather than buffered or delivered
  truncated. Only the cosmetic close *number* moves to the deterministic spec. Had the fix
  instead deleted the AC4 case and relied on the mocked spec, the `maxPayload` behaviour would
  have lost its only real-socket witness — that variant was rejected for this reason.
- [Error messages, logs, telemetry] No findings. The new log assertions pin the content-free
  contract in the safe direction: the second case asserts the record equals exactly
  `{event, status, code, host, path}` with a module-**static** classification string, and the
  third asserts `code` is absent on a peer close so the attacker-controlled wire `reason` cannot
  appear. Neither spec asserts over `err.message`, which is the field that can embed the URL.
- [Concurrency] No findings, and the ticket's own AC4 is the guard: the fix deliberately does not
  defer the terminal emit, so `teardownAndEmitClosed`'s `removeAllListeners()` and `if (closed)
  return` — the mobile #496 parity pins that stop a superseded connection from clobbering the
  live one in `relaySupervisor` — keep their current semantics and their current tests, word for
  word. Every new case reaches a terminal `'close'`, so no interval or timeout leaks between
  cases.
- [Threat model alignment] Malicious/on-path relay is the applicable threat and is addressed
  above (frame cap witnessed by the real-socket case; wire `reason` kept out of the log by the
  third case). Hostile-daemon *content* defence remains the codec/Noise layer's job downstream,
  as recorded in the package overview — unchanged and out of scope here.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-05
