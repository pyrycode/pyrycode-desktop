# Spec #90 — Reusable in-process content-blind `ws` relay forwarder test helper

**Size:** S (confirmed; single production file `fakeRelayForwarder.ts` + its test, ~120 prod / ~180 test LOC, 2 exports, zero consumer call sites, no state-machine fan-out). Could be argued XS; left at S.

**Security-sensitive:** no (label absent). #90 is the opaque-byte plumbing; the Noise responder that inspects frames is #91 and carries the `security-sensitive` label. No security-review pass required here.

## Files to read first

- `src/main/transport/relayConnection.test.ts:33-78` — the existing single-endpoint `startRelay` forwarder to **generalise**. Extract: `WebSocketServer({ port: 0 })`, the `once('listening')` await, `(wss.address() as AddressInfo).port`, the socket-tracking + `wss.close()` teardown shape. This is records-only (one leg, `received()`); #90 turns it into a two-leg splice.
- `src/main/transport/relayConnection.test.ts:18-23` — `toBytes(data: RawData): Uint8Array` server-side normaliser (`Buffer.concat` for fragmented arrays, `ArrayBuffer`→`Uint8Array`, else pass-through). Reuse this exact shape for the splice; do not re-invent it.
- `src/main/transport/relayConnection.ts:207-224` — the real client's `send`/`close`. Confirms the client writes a **`Uint8Array` (binary opcode)** for Noise frames and a **`string` (text opcode)** otherwise. The forwarder must preserve the opcode, not just the bytes.
- `src/main/transport/relayConnection.ts:227-237` — `toFrame` normaliser; same `RawData`→bytes shape as `toBytes`, confirms the guarantee "one WS message = one frame".
- `vitest.config.ts` — unit glob is `include: ['src/**/*.{test,spec}.{ts,tsx}']`. The test must live under `src/` (it will: `src/main/transport/`). No config change.
- `package.json` — `ws@^8.21.0` is already a runtime dependency and `@types/ws` a dev dependency. **No new dependency.** Do not add one (technical note: test-only infra).
- `docs/knowledge/features/fakerelay-harness.md` (QMD collection `pyrycode-docs`) — the Go sibling precedent. **Read only for the `WaitBinary` readiness rationale.** The desktop forwarder is deliberately *far* simpler: no routing envelope, no `server-id`/token headers, no close-code honouring, no first-claim-wins. It is a raw two-leg byte pipe. Do not port the Go surface.

## Context

The transport is unit-tested per layer. There is no reusable in-process relay that carries frames between the real client under test and a fake responder. `relayConnection.test.ts` already stands up a content-blind in-process `ws` server (`startRelay`), but it (a) only *records* one leg's frames — it never forwards them to a second peer — and (b) is inlined in a single `.test.ts`, so nothing else can import it.

This ticket delivers the reusable **two-leg** forwarder: a shared test module that stands up an in-process `ws` relay and splices raw frames byte-for-byte between the two connected legs. It is the plumbing half of the round-trip harness. The fake daemon that answers on the other leg (#91) and the round-trip test that drives both (#89) build on this and land later; #90 ships in isolation with **no production consumer** — exactly the phasing the Go sibling used (`fakerelay` shipped alone in #295 before its fake-phone peer and the consuming test).

Content-blind means: the relay never decodes, inspects, or alters a frame. It does not import `codec` or the Noise types. Forwarding is opaque-byte plumbing, identical in spirit to the production v2 relay.

## Design

### Placement & module shape

New test-only module: **`src/main/transport/fakeRelayForwarder.ts`** (a plain `.ts`, *not* a `.test.ts`, so #91 and #89 can import it — this is the load-bearing AC). Its only imports are `ws` and Node built-ins (`node:net` for `AddressInfo`). It **must not** import `./codec`, the Noise modules, or any `@shared` wire type — content-blindness is enforced by the import list. (Note: `src/main` cannot use the `@shared` alias regardless; not relevant here since nothing shared is imported.)

Co-located test: **`src/main/transport/fakeRelayForwarder.test.ts`**.

### Public surface (contract, not implementation)

```ts
export interface FakeRelayForwarder {
  /** Base dial URL, e.g. ws://127.0.0.1:54123 — NO trailing path. The consumer
   *  appends the leg path itself (see leg identification below). */
  url: string
  /** Resolves once BOTH legs are registered server-side — the readiness gate that
   *  closes the 101-before-handler-registration race. Rejects on timeout, or if
   *  close() is called before both legs connect. Cached: repeated calls share one
   *  promise. Default timeout 1000ms. */
  whenReady(timeoutMs?: number): Promise<void>
  /** Terminates both legs, closes the server. Idempotent: a second call is a no-op
   *  that resolves the same. Mirrors startRelay's close contract. */
  close(): Promise<void>
}

/** Stands up the forwarder on an ephemeral loopback port; resolves once the server
 *  is listening (URL is dial-ready). */
export function startFakeRelayForwarder(): Promise<FakeRelayForwarder>
```

Two exports total: the factory `startFakeRelayForwarder` and the `FakeRelayForwarder` return type. The `start*` prefix matches the codebase's existing `startRelay`/`startBlackHole` test-helper naming.

### Leg identification — by upgrade path (content-blind)

The forwarder distinguishes the two legs by **upgrade request path**, read from `request.url` in the `'connection'` handler — never from frame bytes, so content-blindness holds (content-blindness is a property of *frames*, not of the HTTP upgrade line; the Go `fakerelay` routes `/v1/server` vs `/v1/client` the same way and is still content-blind).

- `…/v1/client` → the **client leg** (the real `relayConnection` under test dials this; its `url` is caller-supplied, so the consumer passes `${forwarder.url}/v1/client`).
- `…/v1/server` → the **daemon leg** (the #91 fake peer dials this).

Match on the pathname prefix of `request.url` (strip any query string). An upgrade on any other path, or a second upgrade on an already-filled leg, is terminated immediately (defensive; test infra never does this). Path-based (vs first-connection-order) is chosen because it is **deterministic regardless of dial order** — the two legs may dial concurrently — and it mirrors both production and the client's existing URL shape. See Open Questions for the rejected order-based alternative.

### Forwarding — byte-for-byte, opcode-preserving

Single `WebSocketServer({ port: 0 })`. Internal state: two socket slots (`clientLeg`, `serverLeg`), a readiness deferred, a `closed` flag. On `'connection'`, route by path into the matching slot, register a `'message'` handler, and settle readiness if both slots are now filled.

On a `'message'` from one leg, forward to the *other* leg:
- Normalise the payload with the reused `toBytes(data: RawData)` helper (handles fragmented `Buffer[]` and `ArrayBuffer` delivery).
- Send with the opcode preserved: `dest.send(bytes, { binary: isBinary })`. The `isBinary` flag from the `'message'` event is forwarded verbatim so a Noise binary frame stays binary and a text frame stays text.
- If the peer leg is not yet connected (only possible if a consumer sends before awaiting `whenReady`), drop silently — the readiness gate is the consumer's contract for avoiding this.

The relay never reads, parses, or branches on frame content. The only bytes it touches are `Buffer.concat` of a fragmented delivery, which is loss-less re-assembly, not inspection.

### Readiness gate (`whenReady`) — the `WaitBinary` analog

The `ws` upgrade's 101 response unblocks the dialer's connect **before** the server's `'connection'` handler runs and registers the socket. A consumer that dials both legs and immediately sends races that registration. `whenReady()` exposes a *positive* readiness signal: a deferred promise resolved the instant the second leg's slot fills. The consumer `await`s it before sending; no arbitrary sleeps.

- Cached: all `whenReady()` calls return the same underlying promise (resolved once both legs are up).
- Timeout guard: rejects with a static message (`fake relay: both legs did not connect within <n>ms`) after `timeoutMs` (default 1000). This makes a mis-wired test fail fast instead of hanging to vitest's global timeout. The timeout timer is cleared on resolve and on `close()`.
- `close()` before both legs connect rejects any pending readiness promise, so an awaiting consumer unblocks at teardown rather than hanging.

## State + concurrency model

- **No React, no store, no IPC.** Pure Node/`ws` test infrastructure living in `src/main`.
- **State:** `{ clientLeg: WebSocket | null, serverLeg: WebSocket | null }`, one readiness deferred (`{ promise, resolve, reject }`), one `closed: boolean`, one optional readiness-timeout handle.
- **Concurrency:** event-driven via `ws` (`'listening'`, `'connection'`, `'message'`). The only timer is the optional readiness timeout. No polling loop (the Go `WaitBinary` polls a map every 2ms because Go lacks a cheap awaitable; the JS deferred resolves directly from the `'connection'` handler — strictly better, no ticker).
- **Teardown:** `close()` guarded by `closed`. First call: reject a still-pending readiness deferred, clear the timeout, `terminate()` both leg sockets (no-op if null/already closed), `wss.close(cb)`, resolve when the server callback fires. Second and later calls return the same resolved promise. This is the deterministic idempotency guard (a boolean, not a best-effort) the AC requires.

## Error handling

| Failure mode | Behaviour |
|---|---|
| Upgrade on an unknown path | Terminate the socket immediately; never fills a leg slot. |
| Second upgrade on an already-filled leg | Terminate the duplicate; keep the first (first-per-leg wins). |
| Frame arrives before the peer leg is connected | Dropped silently (readiness gate is the consumer's contract). |
| Only one leg ever connects | `whenReady` rejects at `timeoutMs`; the suite fails fast with the static message. |
| `close()` before both legs up | Pending `whenReady` rejects; teardown proceeds; idempotent. |
| Double `close()` | Second call resolves the same promise; no throw, no double `wss.close`. |

The module is log-free (mirrors `relayConnection.ts`'s log-free construction — a stray `console.log` in shared test infra pollutes every consumer's output). All observable behaviour is via the returned handle and the spliced frames.

## Testing strategy

`fakeRelayForwarder.test.ts`, vitest, real timers (the suite runs sub-second on loopback), a `cleanups`/`afterEach` teardown array mirroring `relayConnection.test.ts`. Drive the forwarder with **two raw `ws` clients** (not `createRelayConnection` — keep the test at the byte level; the round-trip integration through the real client is #89's job). Scenarios as bullets — developer writes them in the project idiom:

- **Bidirectional, byte-identical (AC3, core).** Start forwarder; dial a raw `ws` to `${url}/v1/client` and another to `${url}/v1/server`; `await whenReady()`. Client leg sends a frame containing boundary bytes (`[0x00, 0x01, 0xff, 0x7f, 0x80]`) → assert the server leg receives the exact bytes. Server leg sends a *different* frame → assert the client leg receives it exactly. Arbitrary non-JSON/non-Noise bytes double as the content-blindness assertion.
- **Opcode preserved — binary and text.** From one leg send a binary frame then a text frame; assert the peer observes the same `isBinary` flag for each *and* identical bytes. Guards the `{ binary: isBinary }` fidelity.
- **Readiness gate closes the race (AC4 + technical note).** Dial both legs and, with no sleep, `await whenReady()` then send from the client → assert the server receives (proves the gate held until both registered). Additionally: dial only the client leg, assert `whenReady()` is still pending after a macrotask tick; dial the server leg, assert it then resolves.
- **`whenReady` timeout.** Dial only one leg; assert `whenReady(50)` rejects with the static message.
- **Teardown idempotent (AC5).** After a connected pair, call `close()` twice → both resolve, no throw; assert both leg sockets end up closed (readyState CLOSED) and a fresh dial to `url` fails.
- **In-process, no network/Go (AC4).** Implicit across the suite: ephemeral loopback, `url` matches `ws://127.0.0.1:<port>`. Optionally assert the URL shape.

Type coverage rides `npm run typecheck` (the `FakeRelayForwarder` interface is exercised by the test's usage). `npm run build` is the salvage/QA gate.

## Open questions

- **Leg identification: path vs connection-order.** Recommended: path (`/v1/client` vs `/v1/server`) — deterministic under concurrent dial, mirrors production. Rejected alternative: pair the first two connections in arrival order and splice symmetrically. Order-based is marginally less code but introduces a dial-order ambiguity and gives no named legs for teardown assertions; not worth it. If the developer finds the real client cannot be pointed at a `/v1/client` sub-path in the #89 integration, revisit — but `relayConnection`'s `url` is caller-supplied verbatim (`relayConnection.ts:34-47`), so it can.
- **Duplicate-leg handling depth.** Spec terminates a duplicate upgrade on a filled leg. This is defensive; a test never triggers it. The developer may omit a dedicated test for it (document the behaviour in a code comment instead of an assertion) — it is not an AC.
