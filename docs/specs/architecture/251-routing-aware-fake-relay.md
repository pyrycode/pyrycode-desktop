# Spec: Routing-aware fake relay (#251)

Test-only, in-process `ws` relay that speaks the daemon's **routing-envelope** protocol on its
`/v1/server` leg while presenting the **unchanged raw** `/v1/client` leg to the real app — so a
real `pyry` daemon can be driven end-to-end through the built UI. It is the routing-aware
counterpart to `fakeRelayForwarder.ts`, which is a raw two-leg byte pipe and cannot bridge a real
daemon. Consumer: #252 (the real-daemon UI round-trip). This ticket ships the relay alone.

Size: **S**. Security-sensitive (the client's pairing `token` is plaintext credential material) —
a security-review pass is at the end of this spec (verdict: PASS).

---

## Files to read first

- `src/main/transport/fakeRelayForwarder.ts` (whole, ~200 lines) — **the sibling to mirror.** The
  new relay adapts its lifecycle scaffolding verbatim: the `deferred<T>()` helper, the `legFor()`
  path router, the `toBytes()` normaliser, the cached `whenReady()` readiness gate (deferred +
  timeout + close-before-ready rejection), and the idempotent `close()` (cached `closePromise`).
  Reuse these patterns; the only new behaviour is the routing-envelope translation on the server
  leg and conn-id multiplexing on the client legs.
- `src/main/transport/fakeRelayForwarder.test.ts` (whole, ~197 lines) — **the test shape to
  mirror.** Reuse its `connect()` (raw `ws` dial with transient-reset retry, #104), `nextFrame()`,
  and `cleanups`/`afterEach` teardown. The new relay's WS-integration tests follow this exact form,
  driving two raw `ws` clients (a fake raw app on `/v1/client`, a fake routing peer on
  `/v1/server`).
- `src/main/transport/codec.ts:75-101` — `encodeInnerFrame` returns a **string** (`JSON.stringify`)
  and `decodeInnerFrame` **tolerates key order + extra keys**. Two load-bearing facts: (1) the app's
  `/v1/client` frames are JSON **text** frames (`{"v":2,"type":...,"data":"<base64>"}`), so the
  routing `frame` field embeds them as raw JSON; (2) the tolerant decoder is what makes the
  server→client re-serialization (below) safe. **This module MUST NOT be imported by the new code.**
- `src/main/daemonConnection.ts:488-493` — the exact client dial headers the app sends
  (`X-Pyrycode-Server`, `X-Pyrycode-Token`, `X-Pyrycode-Device-Name`). The relay reads the token as
  `request.headers['x-pyrycode-token']` (Node lowercases header keys). Confirms a real, non-empty
  token is always present to inject.
- `src/main/transport/sendMessageEnvelope.ts` + `sendMessageEnvelope.test.ts` (small) — the
  codebase's `*Envelope.ts` convention (a tiny pure wire builder co-located with its own test) that
  the new `routingEnvelope.ts` follows.
- `docs/knowledge/features/fake-relay-forwarder.md:68` — explicitly lists the Go surface
  `fakeRelayForwarder` **dropped**: "No routing envelope, no server-id/token headers, no
  first-claim-wins grace, no close_code honouring, no token injection." This ticket ports **exactly
  that dropped surface** onto a sibling module.
- **Go reference** (sibling repo, read-only): `../../pyrycode/internal/e2e/internal/fakerelay/fakerelay.go`
  and `../../pyrycode/internal/protocol/envelope.go:42-77`. The `RoutingEnvelope` shape and the
  wrap/unwrap/first-frame-token/null-frame/close-code semantics are ported from here. The essential
  contract is inlined below, so the sibling repo is confirmatory, not required.

---

## Context

`fakeRelayForwarder.ts` splices raw `InnerFrameV2` bytes byte-for-byte between `/v1/client` (the
real app) and `/v1/server` (a **fake** daemon). It works only because `fakeDaemon.ts` also speaks
raw frames. A **real** `pyry` daemon does not: on its relay leg it speaks the routing-envelope
protocol (JSON `RoutingEnvelope` values), so the raw forwarder cannot bridge it.

The routing protocol (source of truth: `../../pyrycode/internal/protocol/envelope.go:42-77` and
`internal/relay/connection.go`):

- The server (daemon) registers on `/v1/server` by sending an `x-pyrycode-server: <serverId>`
  upgrade header.
- Frames on the server leg are **JSON-serialized** `RoutingEnvelope` values. Wire shape (snake_case
  keys):
  - `conn_id: string` — the relay-assigned per-connection id.
  - `frame: <raw application-frame JSON>` — opaque (`json.RawMessage`; the relay never parses the
    payload).
  - `token: string` (omitempty) — the client's pairing token, carried on the **first** client→server
    frame per `conn_id` **only**, sourced from the client's `x-pyrycode-token` upgrade header. Never
    echoed back to the client.
  - `close_code: uint16` (omitempty) — set on a server→relay envelope; asks the relay to forward
    `frame` (if present) then close that client's WS with this code. Zero on every client→server
    frame.

The client leg stays **byte-identical** to what the app already dials for `fakeRelayForwarder`
(same path `/v1/client`, same headers) — so nothing in the production app or its dial path changes.
The app already sends its token in `X-Pyrycode-Token` (`daemonConnection.ts:490`;
`relayConnection.ts` forwards caller headers verbatim), so there is a real token to inject.

This relay leg is the reusable piece the real-daemon UI e2e (#252) needs, and is independently
unit-testable: routing-envelope wrap/unwrap, conn-id multiplexing, and first-frame token injection
are all verifiable against a fake routing peer + fake raw client with no daemon, no claude, no UI,
and no network beyond loopback.

---

## Design

### Module structure — two production files (the `*Envelope.ts` convention)

The codebase co-locates each wire type in its own tiny `*Envelope.ts` + `*Envelope.test.ts`
(`sendMessageEnvelope.ts`, `createConversationEnvelope.ts`, `modalResolutionEnvelope.ts`, …). The
routing-envelope codec is a distinct, independently-testable concern, so it gets its own module; the
relay wires it into `ws`.

1. **`src/main/transport/routingEnvelope.ts`** — the pure JSON routing-envelope codec. No `ws`, no
   I/O, no `./codec`, no Noise, no `@shared` wire types. Directly unit-testable.
2. **`src/main/transport/fakeRoutingRelay.ts`** — the in-process relay. Imports: **`ws` + Node
   built-ins + `./routingEnvelope` only** (the tight import surface AC5 requires — content-blindness
   is enforced by the import list, exactly as in `fakeRelayForwarder.ts`).

Test files: `routingEnvelope.test.ts` (pure codec) and `fakeRoutingRelay.test.ts` (WS-integration).

### `routingEnvelope.ts` — the codec contract

The wire is snake_case (`conn_id`, `frame`, `token`, `close_code`); the TS-facing signatures use
camelCase, mapping at the boundary (the same wire-vs-TS split the other `*Envelope.ts` builders use).

**Encode (client → server).** `frame` is spliced **verbatim** as a raw JSON value — the direct port
of Go's `json.RawMessage(data)`. The relay never parses the client frame, so this is truly opaque.

```ts
// Build one server-leg wire frame. `frameText` is the client's opaque frame (already-valid JSON —
// the app sends InnerFrameV2 text), spliced VERBATIM as the JSON `frame` value; never parsed.
// `token` is emitted only when provided AND non-empty. `close_code` is never emitted here
// (always zero on client→server). Returns the JSON text to write on the server leg.
export function encodeRoutingEnvelope(connId: string, frameText: string, token?: string): string
```

Behaviour: returns `{"conn_id":<jsonString>,"frame":<frameText verbatim>[,"token":<jsonString>]}`.
Build the wrapper via string assembly (splice `frameText` in) so the frame is never round-tripped —
`conn_id`/`token` go through `JSON.stringify` for correct escaping; `frameText` is inserted raw.

**Decode (server → client).** Parsing the wrapper is unavoidable (we must read `conn_id` and
`close_code`), but the InnerFrameV2 payload is never inspected — `frame`'s `v`/`type`/`data` are
never read. `frame` is re-serialized back to text; the value round-trips identically and the
client's tolerant `decodeInnerFrame` accepts it (see `codec.ts:94-101`).

```ts
export interface DecodedRoutingEnvelope {
  connId: string
  frameText: string | null   // null = close-only envelope: `frame` absent or JSON `null`
  closeCode: number          // 0 when `close_code` absent
}
// Parse one server-leg wire frame. FAIL-CLOSED: returns null on malformed JSON, a non-object,
// or a missing/mistyped `conn_id` — the relay drops the frame and keeps serving; NEVER throws.
export function decodeRoutingEnvelope(text: string): DecodedRoutingEnvelope | null
```

Behaviour notes:
- `frame === null` or `frame` absent → `frameText = null` (Go's `if string(frame)=="null"` case: a
  close-only envelope). Otherwise `frameText = JSON.stringify(frame)`.
- `close_code` absent or non-numeric → `closeCode = 0`; else the numeric value.
- Extra keys tolerated (forward-compat). A malformed input returns `null`, not a throw.

### `fakeRoutingRelay.ts` — the relay

Public surface mirrors `FakeRelayForwarder` field-for-field:

```ts
export interface FakeRoutingRelay {
  url: string                                   // ws://127.0.0.1:<port> — NO trailing path
  whenReady(timeoutMs?: number): Promise<void>  // resolves once server leg + first client leg up
  close(): Promise<void>                         // terminates all legs + server; idempotent
}
export function startFakeRoutingRelay(): Promise<FakeRoutingRelay>
```

Reused verbatim from `fakeRelayForwarder.ts`: `deferred<T>()`, `legFor()`, `toBytes()`, the
listening→`url` resolution, the `whenReady` timer/settle machinery, and the idempotent `close()`.

**Leg identity by PATH** (deterministic under concurrent dial, unlike arrival order):
- `/v1/client` → a **client leg**. On upgrade: capture `token = request.headers['x-pyrycode-token']`
  (or `''` if absent), assign a fresh conn-id `c-${++connSeq}`, store
  `{ socket, token, firstFrameSent: false }` in `clients: Map<string, ClientLeg>`.
- `/v1/server` → **the single server leg**. First-claim-wins: a second `/v1/server` upgrade is
  terminated (mirrors `fakeRelayForwarder`'s already-filled-leg guard). The `x-pyrycode-server`
  header is the real daemon's registration signal; the fake is single-server, so it is **not
  validated** (see Open questions).
- Any other path → terminate (defensive; test infra never does this).

**Client → server** (on a client leg's `'message'`): normalise to bytes → decode UTF-8 → text; then
`serverLeg.send(encodeRoutingEnvelope(connId, frameText, firstFrameSent ? undefined : token))` as a
**text** frame; set `firstFrameSent = true`. If the server leg is not `OPEN`, drop silently (the
`whenReady` gate is the consumer's contract for avoiding this — same as `fakeRelayForwarder`).

**Server → client** (on the server leg's `'message'`): normalise to bytes → text →
`const env = decodeRoutingEnvelope(text)`. If `env === null`, drop silently (log-free; Go logs at
Debug). Else look up `clients.get(env.connId)`:
- unknown conn-id → drop silently (the client already went away, or a malformed reference).
- `env.frameText !== null` and the client socket is `OPEN` → `client.socket.send(env.frameText,
  { binary: false })`.
- `env.closeCode !== 0` → **after** the frame write, `client.socket.close(env.closeCode)` — the
  client observes the (error) frame before the close, matching Go's `phoneSendPump` ordering. `ws`
  flushes queued sends before the close frame, so send-then-close preserves order on one socket.

**Client leg disconnect**: on the client socket's `'close'`, `clients.delete(connId)` so a stale
conn-id is never routed to a dead socket (mirrors Go's `delete(s.phones, connID)`).

### Data flow

```
 real app  ──text {v:2,type,data}──►  /v1/client leg  ─┐
 (InnerFrameV2 JSON, opaque)                            │ wrap: {"conn_id","frame":<verbatim>,"token"?}
                                                        ▼
                                            /v1/server leg  ──text JSON RoutingEnvelope──►  real daemon
 real app  ◄──text <frame> [then WS close(code)]── /v1/client leg  ◄─┐
                                                                     │ unwrap: read conn_id + close_code,
                                            /v1/server leg  ◄────────┘ re-emit frame (opaque payload)
```

`token` rides only the first client→server envelope per conn-id and is **never** placed on a
server→client frame (the decoder does not read or forward it).

---

## State + concurrency model

- **Single source of relay state** lives in the `startFakeRoutingRelay` closure: `serverLeg:
  WebSocket | null`, `clients: Map<string, ClientLeg>`, `connSeq: number`, plus the reused readiness
  (`ready` deferred, `readySettled`, `readyTimer`) and `close` (`closed`, `closePromise`) flags. No
  module-level mutable state — a second `startFakeRoutingRelay()` call is fully independent.
- **`whenReady` gate** resolves once the server leg **and at least one client leg** are both
  registered (the routing analog of `fakeRelayForwarder`'s two-leg gate: server + first client = the
  minimum for a round-trip). Additional clients after the first do not re-arm or re-settle the
  already-resolved gate. Timeout + close-before-ready rejection are identical to `fakeRelayForwarder`
  (static messages, cached promise, first call's timeout governs).
- **Per-client first-frame token** is single-writer state (`firstFrameSent`) mutated only in that
  client's `'message'` handler — no cross-handler races (Node's single-threaded event loop; each
  socket's messages are serialized).
- **Streams** are the `ws` `'message'` event emitters; the relay subscribes on `'connection'` and
  tears down on `close()`. No async iterables, no fire-and-forget promises. `ws.send` is the only
  outbound; ordering on a single socket is guaranteed by `ws`.
- **Teardown**: `close()` terminates the server leg and every client socket in `clients`, then
  `wss.close(cb)`; cached `closePromise` makes it idempotent (no throw, no double `wss.close`).

---

## Error handling

The relay is **test infrastructure**: a malformed frame from either leg must never crash it, and it
is **log-free** (AC5) — every failure is a silent drop or a socket teardown, never a `console.*`.

| Failure mode | Layer | Handling |
|---|---|---|
| Malformed JSON / non-object / missing `conn_id` on server leg | `decodeRoutingEnvelope` | Returns `null`; relay drops the frame, keeps serving. Fail-closed, no throw. |
| Server references an unknown `conn_id` | relay routing | Drop silently (client gone or bad ref). |
| Client frame arrives before the server leg is up | relay routing | Drop silently (readiness gate is the contract). |
| `close_code` from server is not a valid WS close code | `ws.close(code)` | `ws` throws `RangeError` synchronously — **guard the close call** (`try`/swallow) so one bad envelope cannot crash the relay. Valid app codes (4401/4404/4409) pass through. |
| Non-JSON frame from the client leg | `encodeRoutingEnvelope` | Spliced verbatim (content-blind; not validated). Produces a malformed envelope the daemon rejects — a test-author error, out of this relay's scope. Deviates from Go's `json.Valid` peek, deliberately (keeps the client leg truly opaque). |
| Unknown upgrade path / duplicate `/v1/server` | `'connection'` handler | Terminate the socket; never fill a slot. |
| `close()` before both legs connect | `close()` | Reject the pending `whenReady`; teardown proceeds; idempotent. |

The codec's decode names no failure detail and echoes no bytes (it just returns `null`) — consistent
with the codebase's fail-closed, category-only decode-error discipline (`codec.ts:32-47`), and with
the secret-safety rule that decoded values (which carry the token and message plaintext) are never
surfaced.

---

## Testing strategy

`npm test` (vitest) + `npm run typecheck`. Two suites, both hermetic (loopback, `port: 0`, real
timers, sub-second). Factor a shared `connect()`/`nextFrame()`/`nextText()` harness (lift
`connect()` and its transient-reset retry from `fakeRelayForwarder.test.ts`) so per-test line count
stays low.

**`routingEnvelope.test.ts` — pure codec (no `ws`):**
- `encodeRoutingEnvelope` splices `frameText` verbatim — pass a frame with distinctive key order /
  whitespace and assert it appears byte-identical inside the output's `frame` position.
- `token` present when provided non-empty; **absent** when `undefined` or `''`; `conn_id` always
  present; `close_code` never emitted.
- Output parses back to `{conn_id, frame, token?}` with the expected values (round-trip sanity).
- `decodeRoutingEnvelope`: unwraps `{conn_id, frame, close_code}`; `frame` re-serializes to text;
  `frame: null` and absent `frame` → `frameText = null`; absent `close_code` → `0`; a present
  non-zero `close_code` → its value.
- `decodeRoutingEnvelope` fail-closed: malformed JSON, a JSON array/string top-level, and a missing
  `conn_id` each return `null` (never throw).

**`fakeRoutingRelay.test.ts` — WS-integration against a fake raw client + fake routing peer:**
- **Lifecycle parity (AC1):** `url` matches `ws://127.0.0.1:<port>`; `whenReady()` holds pending
  with only the server leg up, resolves once a client leg joins; rejects on timeout with a static
  message; rejects a pending `whenReady()` on `close()` before both legs; `close()` tears down both
  legs + server, idempotent (double-call, no throw).
- **Client → server wrap + first-frame token (AC2):** a raw client dials `/v1/client` with an
  `x-pyrycode-token` header and sends two JSON frames; the routing peer receives two envelopes — the
  first carrying `token`, the second **omitting** it — each with the same `conn_id` and the client's
  frame verbatim in `frame`.
- **Server → client unwrap (AC3):** the routing peer sends `{conn_id, frame}`; the raw client
  receives `frame`'s bytes raw (text). A `{conn_id, frame, close_code: 4401}` envelope delivers the
  frame **then** closes the client WS with code 4401 (assert both the received frame and the close
  code). A close-only `{conn_id, close_code: 4408}` (no `frame`) closes with no prior frame.
- **Conn-id multiplexing (AC4):** two raw clients dial `/v1/client`; assert they get **distinct**
  `conn_id`s (both envelopes observed on the single server leg); a server→client frame addressed to
  each `conn_id` routes back to the **correct** client only.
- **Content-blindness + opaqueness (AC5):** a client frame that is arbitrary JSON the relay has no
  types for (e.g. `{"v":2,"type":"noise_msg","data":"AAECf4A="}` and an unrelated `{"x":[1,2,3]}`)
  is wrapped/unwrapped without interpretation; the module imports only `ws` + Node built-ins +
  `./routingEnvelope` (assert by inspection / the tight import list, mirroring the forwarder's
  content-blindness argument).
- **Log-free (AC5):** spy on `console.log`/`console.error`/`console.warn` (and the token specifically
  never appears) across a full wrap → unwrap → close cycle; assert zero calls. Mirrors the intent of
  `fakeRelayForwarder`'s log-free construction.
- **Robustness:** a malformed frame on the server leg (bad JSON) is dropped and the relay keeps
  routing a subsequent valid frame; an out-of-range `close_code` does not crash the relay.

Type-level: `npm run typecheck` covers both `src/main` and the renderer tsconfigs. Note
`@shared` alias is unavailable in `src/main` (use relative paths) — but this module imports no shared
types anyway.

---

## Open questions

1. **`x-pyrycode-server` validation.** The fake is single-server, so the header is captured-but-
   -unvalidated (leg identity is by path). If a real daemon refuses to register without some ack, or
   #252 needs multi-server routing, tighten then — not now (no observed need; evidence-based). The
   relay sends the daemon no registration response, matching Go's `handleBinary` (which just starts
   pumping). Recommend: accept `/v1/server` on path alone.
2. **Non-empty token under `PYRY_ALLOW_INSECURE_RELAY=1`.** Whether the real daemon requires a
   non-empty token is the daemon's concern; the relay forwards the header faithfully regardless
   (the app always supplies a real token). No gating in the relay. Settle empirically in #252 if the
   daemon rejects.
3. **`frame` decode fidelity.** Server→client re-serializes `frame` via `JSON.stringify` (value-
   identical; the client's tolerant `decodeInnerFrame` accepts it). If a future daemon frame needed
   byte-exact `frame` preservation, swap to a raw-slice extraction — deferred (the tolerant decoder
   makes it unnecessary today, and raw-slicing is ~40 lines of fragile scanning).

---

## Security review

**Verdict:** PASS

Adversarial self-review per `architect/security-review.md`. The security surface is the client's
pairing **token** (plaintext credential material) and opaque, Noise-encrypted application frames the
relay must never interpret.

**Findings:**

- **[Trust boundaries]** No MUST FIX — single explicit boundary at `routingEnvelope.ts`'s
  `decodeRoutingEnvelope`, which **fails closed** (returns `null`, never throws) on any malformed
  server-leg input, so a hostile/garbage envelope cannot crash the relay or desync routing. The
  client-leg frame is spliced verbatim and never interpreted; `conn_id`/`token` are written via
  `JSON.stringify` (proper escaping), so a value containing quotes/backslashes cannot break out of
  the JSON string (no JSON-injection into the wrapper). `close_code` → `ws.close(code)` is guarded
  against an out-of-range value so a malicious envelope cannot throw out of the handler.
- **[Tokens, secrets, credentials]** No MUST FIX — the token is the load-bearing concern and all
  three invariants hold: (1) **never logged** — the module is log-free (AC5); the token is read from
  the upgrade header, passed as an argument to `encodeRoutingEnvelope`, and written only into the
  first envelope's `token`; no `console.*`, no diagnostic sink, no error message carries it (mirrors
  the Go source's explicit MUST-NOT-log at `envelope.go:66-67`). (2) **never echoed to the client** —
  `token` rides client→server first-frame-only; `decodeRoutingEnvelope` reads `conn_id`/`frame`/
  `close_code` and does **not** read or forward `token`, so even a hostile server leg's injected
  `token` is dropped, never written to a client socket. (3) **forwarded opaquely** — not validated,
  synthesized, or transformed. Generation/storage/rotation of the token are out of this module's
  scope (owned by the app's pairing/`safeStorage` path); the relay holds it only in transient
  connection memory.
- **[File / storage operations]** No findings — N/A by design: the module does zero filesystem I/O,
  constructs no paths, writes no temp files.
- **[Inter-process / Electron attack surface]** No findings — N/A by design: adds no IPC channel, no
  `BrowserWindow`, no `contextBridge`, no custom protocol. It is a standalone `src/main/transport`
  test module imported only by tests; the token and sockets never reach the renderer.
- **[Cryptographic primitives]** No findings — N/A by design: the relay is crypto-blind (AC5). The
  Noise handshake/AEAD happens end-to-end between the app and the real daemon inside the opaque
  `frame`; the relay touches no keys, no nonces, no plaintext. `conn_id` is a monotonic routing
  identifier (`c-${n}`), not a secret — predictability is acceptable (it is not a capability token).
- **[Network & I/O]** SHOULD FIX (inherited test posture) — the `WebSocketServer` sets no
  `maxPayload`, so an oversized frame from a leg is uncapped. This matches `fakeRelayForwarder.ts`'s
  existing choice and is bounded by the ticket's explicit "no network beyond loopback" scope (peers
  are test-controlled). Add a `maxPayload` for parity with production only if a future consumer
  drives it from a less-trusted peer. `wss://`/TLS and relay-URL validation are N/A — this fake is
  `ws://` loopback and consumes no relay URL (it *is* the relay).
- **[Error messages, logs, telemetry]** No findings — log-free (AC5); the fail-closed decoder emits
  no message and echoes no bytes (returns `null`), so neither the token nor frame bytes can reach any
  sink. No log files, no telemetry.
- **[Concurrency]** No findings — the only long-lived work is the `ws` event subscriptions and the
  `whenReady` timer; `close()` terminates every socket and clears the timer (reused from
  `fakeRelayForwarder`), client-leg `'close'` removes the `Map` entry (bounded growth), and the
  per-client `firstFrameSent` flag is single-writer per socket (a socket's messages are serialized by
  the event loop — no cross-`await` race). A duplicate `/v1/server` upgrade is terminated
  (first-claim-wins). No disk state to leave partial on shutdown.
- **[Threat model alignment]** No findings — **hostile daemon response**: parsed defensively and
  fail-closed (addressed). **Malicious/compromised relay**: this module *is* a content-blind fake
  relay for tests; it cannot leak plaintext (the payload is Noise-encrypted inside the opaque `frame`)
  and cannot hang the app (the app owns its own ping/pong + timeouts in `relayConnection`). **Token
  theft from disk** and **renderer compromise reaching transport**: N/A — no persistence, no renderer
  surface. Production wire-protocol threats are upstream (`pyrycode` ADR 025) and out of scope for a
  test fixture.

**Blast radius:** test-only infrastructure — loopback bind (`port: 0`), no production consumer
(the consumer is the #252 test), not wired into any composition root, cannot run in the shipped app.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-10
