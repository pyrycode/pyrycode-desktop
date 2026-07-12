# #336 — fakeDaemon.test.ts: bounded transient re-dial for the full-suite WS 404 dial race

**Ticket:** [#336](https://github.com/pyrycode/pyrycode-desktop/issues/336) · size **XS** · labels `bug`, `size:xs`, `security-sensitive`
**Scope:** one file — `src/main/transport/fakeDaemon.test.ts`. **No production behaviour change.**

## Files to read first

- `src/main/transport/fakeDaemon.test.ts` — the whole file; the file you edit. Two client dial sites hide inside it (see Design): `driveClient` at :106-158 (via `createRelayConnection`) and the raw `new WebSocket` at :381-386 (the `fail-closes a non-InnerFrameV2` test). Every `expect(...)` in the file must survive byte-identical.
- `src/main/transport/fakeRelayForwarder.test.ts:18-52` — **the pattern to lift.** `isTransientDialError(err)` + the `connect(url, attemptsLeft=5)` bounded-re-dial ladder. Copy this idiom (20 ms backoff, terminate-before-re-dial, swap the reject handler for a benign swallow on open). Note its comment already frames re-dial as "deterministic convergence on a recoverable reset, NOT a blind whole-test retry (no assertion re-runs)".
- `src/main/transport/fakeRoutingRelay.test.ts:22-55` — the sibling twin of that ladder, already extended with a `/Parse Error/i` clause (#311). Your `404` clause is the next member of the same family; mirror the comment style precisely.
- `src/main/transport/relayConnection.ts:203-235` — the production dial's `unexpected-response` (204-219) and `error` (221-235) handlers. **Load-bearing for the root-cause analysis:** they convert a 404 upgrade into a *silent* `closed{code:1006, reason:'connect-error'}` RelayEvent — never a raw throw. This is why Site B (below) manifests as a hang, not a `404` message, and why the re-dial trigger for Site B is a RelayEvent, not a string match. **This file is untouched by this ticket** (AC4).
- `src/main/transport/fakeRelayForwarder.ts:84-200` — `startFakeRelayForwarder`. Confirms the forwarder resolves its URL on `wss.once('listening')` (:188) and the `'connection'`/upgrade routing is wired in the constructor *before* `'listening'` fires (:122-156). This is the evidence that rules out the "stronger readiness contract" seam (see Design § Rejected seam). **Any change here would be confined to startup/readiness only (AC4) — but this design changes nothing here.**
- Memory / precedent: #311 (PR #312, sibling `fakeRoutingRelay` dial-race, `Parse Error` variant) and #303 (flaky-test teeth-retention discipline — "widen the tolerance ≠ fix the race").

## Context

`src/main/transport/fakeDaemon.test.ts` — the in-process Noise_IK fake-daemon round-trip suite — flakes **only** under full-suite (`npm test`) worker-pool concurrency with `Error: Unexpected server response: 404` surfacing from `ws/lib/websocket.js`. It passes 5/5 single-file. The flake is pre-existing and independent of #329/PR #335 (a renderer-only diff): it reproduces on merge-base `ccd7bfd9` under the same conditions, landing on a different sub-test each run.

This is the same **family** as #311/PR #312 (a `fakeRoutingRelay` dial-race under parallel-worker contention) — a **distinct symptom** (`404` upgrade response vs. #311's `Parse Error`) at a **distinct location** (`fakeDaemon.test.ts`, not `fakeRoutingRelay.test.ts`).

**Two corrections the ticket body bakes in (do not re-derive the wrong premise):**
1. The suite does **not** drive `fakeRoutingRelay`. It stands up `startFakeRelayForwarder` and dials the client leg through the **production** `createRelayConnection`.
2. There is **no** existing test-local `connect()`/`isTransientDialError` ladder in this file to "extend" — #311's helper lives in *other* files. The seam is introduced here, lifted from the sibling.

## Root cause

**The failure class is the #311/#104 transient pre-open dial-race, with `404` as a newly-observed variant.** Under vitest's forks-pool CPU starvation, a raw WS dial to the *already-listening* forwarder can complete its HTTP upgrade abnormally: a reset (`socket hang up`/`ECONNRESET`), an accept-backlog overflow (`ECONNREFUSED`), a malformed upgrade parse (`Parse Error`, #311), or — here — a non-101 upgrade status (`404`). An immediate re-dial to the same server clears it. The sibling ladders already prove re-dial converges for the other members; `404` joins them.

**Why the fix belongs on the client dial side, not the forwarder (the "stronger readiness contract" seam is rejected).** `startFakeRelayForwarder` wires its `'connection'`/upgrade routing in the `WebSocketServer` constructor (`fakeRelayForwarder.ts:122-156`), which is synchronous and completes *before* `'listening'` fires (:188) — the URL is only handed out after `'listening'`. So the server is genuinely upgrade-ready the instant a consumer receives the URL; there is no server-side readiness gap for a stronger contract to close. The race is on the *client's* TCP/HTTP dial under CPU starvation, which a server-side gate cannot prevent (a one-time accept-readiness probe passing does not stop the next dial from stalling). Per #311's "confirm cause before defaulting to the cheaper retry" discipline: here the cheaper retry **is** the correct fix, because (a) re-dial demonstrably clears the sibling variants and (b) the server has no gap to fix.

**Why a raw `404` throw appears at all, given `createRelayConnection` suppresses it.** The production dial installs an `unexpected-response` listener (`relayConnection.ts:204-219`) — with it present, `ws` emits `unexpected-response` (not `error`) and does not auto-destroy, so a 404 is captured and converted to a silent `closed{1006,'connect-error'}` RelayEvent. A raw `Error: Unexpected server response: 404` can therefore only escape from a dial with **no** such listener — the raw `new WebSocket` at `fakeDaemon.test.ts:381`. This split defines the two dial-site shapes below.

## Design

The fix lives entirely in `fakeDaemon.test.ts`, at its two client dial sites. Both are pre-`connected` establishment paths; neither touches an assertion.

### Shared predicate — `isTransientDialError(err): boolean`

Lift from `fakeRelayForwarder.test.ts:23-27`, extended with the `404` member. Recognises: `err.code === 'ECONNRESET' || 'ECONNREFUSED'`, `/socket hang up/i`, `/Parse Error/i`, and the new `/Unexpected server response: 404/i` (the ws client's raw message for a non-101 404 upgrade). Keep the pattern **narrow to the observed status** (`404`, not `4\d\d`) — mirroring #311 adding only `Parse Error`; widen only if verification surfaces another code. A short comment must name `404` as the #336 variant of the #104/#311 family.

### Site A — the raw `new WebSocket` dial (`fail-closes a non-InnerFrameV2 frame`, :375-395)

This is the site that emits the reported raw-`404` throw (no `unexpected-response` listener → the inline open/error promise rejects). Fix:

- Add a `connect(url, attemptsLeft = 5): Promise<WebSocket>` helper, lifted verbatim from `fakeRelayForwarder.test.ts:34-53` (bounded, 20 ms backoff, `ws.terminate()` before each re-dial, transient-only via `isTransientDialError`, and on `open` swap the reject handler for a benign `ws.on('error', () => {})` swallow).
- Replace the inline `new WebSocket(...)` + `await new Promise(resolve/reject on open/error)` (:381-386) with `const raw = await connect(\`${forwarder.url}/v1/client\`)`.
- **Preserve everything downstream byte-identical:** still `cleanups.push(() => raw.terminate())`, still `await forwarder.whenReady()`, still `raw.send('{not json')`, still assert `daemon.whenSettled()` equals `{ ok: false, reason: 'frame-decode-failed' }` and zero console output. The benign-swallow handler is load-bearing here — after open, the intentional malformed-frame path may reset the socket, and the swallow keeps that from surfacing as an unhandled error (mirrors `fakeDaemon.ts`'s own dial lifecycle).

### Site B — `createRelayConnection` inside `driveClient` (:106-158)

The 5 handshake/round-trip/rekey tests dial through here. A transient 404 becomes a silent `closed{1006,'connect-error'}` before any `connected`; `driveClient` currently ignores `closed`, so the client leg never registers → `forwarder.whenReady()` (needs both legs) rejects, or the handshake never starts and a `waiter.wait(...)` times out. The trigger is a **RelayEvent**, not a string — no message matching needed, because `createRelayConnection` has already classified it.

**Contract — bounded transient re-dial, invariant-gated:**

- Introduce a `let connectedOnce = false` and an attempt budget (5, matching the sibling). Route the initiator's outbound frames through a mutable current relay: `sendFrame: (raw) => activeRelay.send(...)`, where `activeRelay` is reassigned on re-dial.
- A relay factory `makeRelay()` builds one `createRelayConnection` whose `onEvent`:
  - `connected` → set `connectedOnce = true`, then `initiator.start()` (unchanged behaviour).
  - `message` → decode + `initiator.onFrame(...)` (unchanged, including the existing fail-closed `catch`).
  - `closed` → **if `!connectedOnce` and budget remains**, `setTimeout(20ms)` then `activeRelay = makeRelay()` (bounded re-dial). Otherwise no-op (terminal `closed` after connect, or budget exhausted — the existing timeout/assert path takes over, so a genuinely dead dial still fails fast once attempts run out).
- **Invariant that keeps this transient-only and assertion-safe:** re-dial fires *only before the first `connected`*. The Noise initiator is created once and only `start()`s after a successful `connected`, so at every re-dial the initiator is pristine (msg1 never sent) — no half-advanced handshake is ever re-driven. After the first `connected`, `closed` is never re-dialed. Every `expect(...)` runs exactly once, on the single connected transport; a genuine logic failure (e.g. a crossed Split → MAC failure) surfaces on the first assertion evaluation, never masked.
- `cleanups.push(() => activeRelay.close())` closes the final relay; each re-dialed predecessor already emitted its own `closed` (that is what triggered the re-dial), so no socket leaks.
- `driveClient`'s signature and return shape (`{ initiator, events, waiter }`) and all six call sites stay unchanged.

### Rejected seam

A "stronger accept-readiness contract on `startFakeRelayForwarder`" — rejected. The server is already upgrade-ready at `'listening'` (routing wired in the constructor); the race is a client-side per-dial stall a server gate cannot prevent, and a change there would also risk the byte-for-byte forwarding path AC4 protects. No forwarder change is made.

## State + concurrency model

- No store, no async iterables — this is test infra. The only concurrency concern is the re-dial timers.
- **Timer ownership:** each re-dial `setTimeout` is short-lived (20 ms) and self-consuming; the bounded budget caps total re-dials at 5. On teardown, `afterEach` runs the registered cleanups — `activeRelay.close()` (Site B) and `raw.terminate()` (Site A) tear down the live socket. A re-dial timer that fires *after* teardown would call `makeRelay()` on a closed forwarder; to avoid a late dangling dial, gate the re-dial body on the same `connectedOnce === false` check plus the budget (a closed forwarder simply yields another `closed` that exhausts the budget quietly). If a stray-timer race shows up in verification, clear the pending timer in the cleanup — but do not add that pre-emptively (evidence-based).
- **No production concurrency touched:** `createRelayConnection` and `startFakeRelayForwarder` keep their existing teardown contracts.

## Error handling

- **Transient dial errors** (Site A raw throw / Site B `closed`-before-`connected`): bounded re-dial, then the existing failure path (reject / timeout+assert) once the budget is spent. No blanket `try/catch`; no assertion wrapped in retry.
- **The intentional error paths stay intact:** the `fail-closes` test's `raw.send('{not json')` → `frame-decode-failed`, and the security test's `initiator.onFrame(garbage)` → `error` event, are unchanged. The `driveClient` `message`-decode `catch` (:131-134) that fail-closes a malformed frame is unchanged.
- **A genuine logic bug still fails fast:** the crossed-Split MAC-failure oracle (AC4 in the file's own doc-comment) surfaces on the first assertion after a single successful connect — re-dial never re-runs it.

## Testing strategy

- **No new tests.** This is a reliability fix; the existing suite is the oracle.
- **Assertion preservation (hard AC3):** every `expect(...)` in all 8 `it` blocks stays byte-identical — handshake-complete + `hello_ack` field checks, sealed round-trip plaintext equality, the multi-frame streaming order check, both rekey resume checks, the `no error / daemon settled ok` checks, the zero-console-output security assertion (both security tests), and the fail-closed non-InnerFrameV2 `frame-decode-failed` assertion.
- **Verification (hard AC1) — the arbiter of completeness:** run the **full suite** `npm test` at least **10 consecutive times**; all must be clean. A passing single-file `vitest run src/main/transport/fakeDaemon.test.ts` is **not** sufficient evidence (the flake never reproduces single-file). Anchor pass/fail on the vitest `Test Files N passed (N)` summary line — **not** on `grep failed`: a `wasm streaming compile failed` line on stderr is benign noise-c.wasm fallback output.
- **Build gate (AC5):** `npm run build` passes (typecheck + build).

## Open questions

- **Which site(s) actually flake in practice.** Site A is the confirmed raw-`404` reproducer; Site B is exposed to the identical root race and the ticket names Site-B tests (handshake, rekey) as the failing sub-tests, but its 404 is suppressed into a hang/`whenReady`-reject rather than a `404` string. Both fixes are cheap deterministic code and both sites are observed-exposed, so ship both; the ≥10-run gate confirms convergence. If verification proves one site never flakes, that half can be dropped — but do not drop it on reasoning alone.
- **`whenReady()` headroom (Site B).** The default `whenReady()` timeout is 1000 ms; a 20 ms×5 re-dial budget resolves well inside it under normal load. If ≥10-run verification shows a residual `both legs did not connect within 1000ms` reject *after* the re-dial fix (i.e. sustained starvation exceeding 1 s), the minimal follow-up is to widen the timeout at the single `standUp` seam (`whenReady: (ms) => forwarder.whenReady(ms)`), not at each call site. Do not widen pre-emptively — evidence-based.
- **Daemon leg (`/v1/server`).** `startFakeDaemon` dials the forwarder's server leg and is out of this ticket's scope (AC4 confines forwarder changes to startup/readiness; `fakeDaemon.ts` is not named). If the daemon leg proves to be a co-conspirator in the flake during verification, file a follow-up rather than widening this ticket.

## Security review

**Verdict:** PASS

This is a test-only change (`src/main/transport/fakeDaemon.test.ts`) that adds a bounded re-dial to two client dial sites. No production code, no wire path, no key/token/socket handling changes. The `security-sensitive` label is inherited because the suite *guards* content-blindness and no-leak invariants — so the adversarial pass focuses on whether the re-dial could weaken those guards.

**Findings:**

- **[Trust boundaries]** No findings. No new boundary is introduced. The forwarder's leg-routing (`legFor`, path-based) and the daemon's frame decode are unchanged. Re-dial only re-establishes a transport that then feeds the *same* `decodeInnerFrame` / initiator path as before.
- **[Tokens, secrets, credentials]** No findings. The re-dial reuses the identical dummy headers already in the file (`X-Pyrycode-Token: 'dummy-...-not-a-real-credential'`, :122); no real credential is introduced, and re-dialing the same URL adds no new secret handling. `buildTestHello` still carries the dummy token.
- **[File / storage operations]** N/A — no filesystem or storage operation in scope.
- **[Inter-process / Electron attack surface]** N/A — no `BrowserWindow`, IPC, `contextBridge`, or custom-protocol surface touched. Pure Node/vitest test code.
- **[Cryptographic primitives]** No findings — and a specific check that matters: the Site-B re-dial invariant (**re-dial only before the first `connected`**, initiator pristine at each attempt) guarantees the real Noise initiator's `start()` runs exactly once, on exactly one transport. This means **no Noise session is ever partially advanced and re-driven**, so there is no key/nonce reuse or nonce-counter-reset risk introduced by the retry. A naive "retry the whole handshake" would have been a `(key, nonce)`-reuse hazard; this design avoids it by construction.
- **[Network & I/O]** No findings. Re-dial is bounded (5 attempts, 20 ms backoff) — no unbounded reconnect / spin loop. `ws.terminate()` before each re-dial drops the half-open socket so none leaks. The production `maxPayload`/timeout posture in `relayConnection.ts` is untouched.
- **[Error messages, logs, telemetry]** No findings — and the **zero-console-output security assertions are preserved byte-identical** (both security tests). The re-dial path logs nothing (the sibling `connect()` ladder is log-free; the Site-B `closed`-handler re-dial adds no `console.*`). The AC4 requirement that `fakeRelayForwarder.ts` stays log-free and content-blind is untouched because that file is not modified.
- **[Concurrency]** No findings. Re-dial timers are short-lived and budget-capped; teardown closes the live socket via existing cleanups. The one identified edge — a re-dial timer firing after teardown — is addressed by gating the re-dial body on `!connectedOnce` + remaining budget (a closed forwarder yields a quiet budget-exhausting `closed`), with a note to clear the pending timer in cleanup only if verification shows a stray-timer race. This is a SHOULD-FIX-if-observed, not a MUST FIX.
- **[Threat model alignment]** No findings. The suite's two security oracles — the **content-blind forwarder** (never decodes frames; enforced by its import list, unmodified) and the **fail-closed non-InnerFrameV2 decode** (`frame-decode-failed`, asserted byte-identical) — are both preserved. The re-dial cannot weaken content-blindness (it changes *when* a socket opens, not *what* the forwarder does with bytes) and cannot weaken fail-closed decode (that assertion and the daemon's decode path are untouched).

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-13
