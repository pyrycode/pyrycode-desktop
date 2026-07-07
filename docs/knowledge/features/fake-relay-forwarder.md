# Fake relay forwarder (test harness plumbing)

`src/main/transport/fakeRelayForwarder.ts` is a reusable, **test-only**, in-process, content-blind `ws` relay forwarder: it stands up one `ws` server on an ephemeral loopback port and splices raw frames **byte-for-byte** between two legs — the real client under test on `…/v1/client` and a fake daemon on `…/v1/server`. Neither leg's frames are decoded, inspected, or altered; the relay is content-blind, exactly like the production v2 relay.

It is the **plumbing half** of the round-trip harness. The [fake daemon](fake-daemon.md) that answers on the server leg ([#91](../codebase/91.md), the Noise responder, `security-sensitive`, now landed — it dials the `/v1/server` leg) and the round-trip test that drives both ([#89](https://github.com/pyrycode/pyrycode-desktop/issues/89), the consumer) build on it. #90 shipped **in isolation, with no production consumer** — the same phasing the Go sibling used (`fakerelay` shipped alone in pyrycode #295 before its fake-phone peer and the consuming round-trip test). Introduced in [#90](../codebase/90.md).

It generalises the records-only `startRelay` inlined in `relayConnection.test.ts` (a single-endpoint content-blind server that only *recorded* one leg's frames via `received()`) into an importable **two-leg splice**, and lives as a plain `.ts` (not a `.test.ts`) so #91/#89 can import it.

## What it does

A round-trip test needs a relay that carries opaque frames **bidirectionally** between two legs without inspecting either. This module is that relay, in-process:

- **No Go toolchain, no external network** — an ephemeral `port: 0` loopback bind, so it runs unconditionally under `npm test`.
- **Content-blind** — enforced by the import list: the module imports only `ws` and Node built-ins. It must **not** import `./codec`, the Noise modules, or any `@shared` wire type. The only bytes it touches are `Buffer.concat` of a fragmented delivery — loss-less re-assembly, never inspection.
- **Opcode-preserving** — a Noise binary frame stays binary, a text frame stays text; the `isBinary` flag from the inbound `'message'` event is forwarded verbatim.

## How it works

### Public surface (two exports)

```ts
export function startFakeRelayForwarder(): Promise<FakeRelayForwarder>

export interface FakeRelayForwarder {
  url: string                                   // ws://127.0.0.1:<port> — NO trailing path
  whenReady(timeoutMs?: number): Promise<void>  // resolves once BOTH legs are registered
  close(): Promise<void>                         // terminates both legs + server; idempotent
}
```

`startFakeRelayForwarder()` resolves once the server is **listening** (so the returned `url` is dial-ready). The `start*` prefix matches the codebase's existing `startRelay`/`startBlackHole` test-helper naming.

The consumer appends the leg path itself: `${url}/v1/client` for the real client (its `url` is caller-supplied — `relayConnection.ts` dials it verbatim), `${url}/v1/server` for the fake daemon.

### Leg identification — by upgrade path, not frame bytes

The forwarder distinguishes the two legs by the HTTP **upgrade request path** (`request.url`, query string stripped): `…/v1/client` → the client leg, `…/v1/server` → the daemon leg. Content-blindness is a property of *frames*, not of the upgrade line — the Go `fakerelay` routes `/v1/server` vs `/v1/client` the same way and is still content-blind. Path-based routing is **deterministic under concurrent dial** (unlike arrival order) and mirrors both production and the client's existing URL shape. An upgrade on any other path, or a second upgrade on an already-filled leg, is terminated immediately (defensive; test infra never does this — first-per-leg wins).

### Forwarding

On a `'message'` from one leg, the forwarder sends to the *other* leg: `dest.send(toBytes(data), { binary: isBinary })`. `toBytes(data: RawData)` normalises the payload (handles fragmented `Buffer[]` via `Buffer.concat` and `ArrayBuffer`-mode delivery) — reused verbatim from `relayConnection`'s `toFrame`/`toBytes`. If the peer leg is not yet connected (only possible if a consumer sends before awaiting `whenReady`) the frame is dropped silently — the readiness gate is the consumer's contract for avoiding this.

### Readiness gate — `whenReady`, the `WaitBinary` analog

The `ws` upgrade's 101 response unblocks the dialer's `connect` **before** the server's `'connection'` handler runs and registers the socket. A consumer that dials both legs and immediately sends races that registration. `whenReady()` exposes a **positive** signal: a deferred promise resolved the instant the second leg's slot fills, so the consumer `await`s it instead of sleeping.

- **Cached** — all `whenReady()` calls share one underlying promise; the first call's `timeoutMs` governs (a later `whenReady(50)` after an earlier `whenReady()` silently inherits the 1000ms default — pass the intended timeout on the *first* call). Default timeout 1000ms.
- **Timeout guard** — rejects with a static message (`fake relay: both legs did not connect within <n>ms`) so a mis-wired test fails fast instead of hanging to vitest's global timeout.
- **`close()` before both legs connect** — rejects any pending readiness promise (`fake relay: closed before both legs connected`), so an awaiting consumer unblocks at teardown rather than hanging.

This is the JS analog of the Go harness's `WaitBinary` gate (which polls a map every 2ms because Go lacks a cheap awaitable) — the deferred resolves directly from the `'connection'` handler, no ticker.

### Teardown — idempotent

`close()` is guarded by a cached `closePromise`. First call: reject a still-pending readiness deferred, clear the readiness timer, `terminate()` both leg sockets (no-op if null/already closed), `wss.close(cb)`, resolve when the server callback fires. Second and later calls return the **same** promise — no throw, no double `wss.close`. Deterministic idempotency (a cached promise, not best-effort), mirroring `startRelay`'s close contract.

## Edge cases and limitations

| Situation | Behaviour |
|---|---|
| Upgrade on an unknown path | Socket terminated immediately; never fills a leg slot. |
| Second upgrade on an already-filled leg | Duplicate terminated; the first is kept (first-per-leg wins). |
| Frame before the peer leg is connected | Dropped silently (the readiness gate is the consumer's contract). |
| Only one leg ever connects | `whenReady` rejects at `timeoutMs` with the static message. |
| `close()` before both legs up | Pending `whenReady` rejects; teardown proceeds; idempotent. |
| Double `close()` | Second call resolves the same promise; no throw, no double close. |

- **Deliberately far simpler than the Go `fakerelay`.** No routing envelope, no `server-id`/token headers, no first-claim-wins grace, no `close_code` honouring, no token injection. It is a raw two-leg byte pipe — none of the Go surface is ported.
- **Log-free** — mirrors `relayConnection.ts`'s log-free construction; a stray `console.log` in shared test infra pollutes every consumer's output. All observable behaviour is via the returned handle and the spliced frames.
- **No production consumer yet** — zero blast radius. The `security-sensitive` frame-inspecting responder is #91; this is opaque-byte plumbing only.

## Related

- [#90 codebase notes](../codebase/90.md) · Spec: `docs/specs/architecture/90-fake-relay-forwarder-test-helper.md` · PR [#92](https://github.com/pyrycode/pyrycode-desktop/pull/92). Split from [#88](https://github.com/pyrycode/pyrycode-desktop/issues/88).
- [Relay connection](relay-connection.md) / [#21](../codebase/21.md) — the real client under test that dials the `/v1/client` leg; its `send` writes a `Uint8Array` (binary opcode) for Noise frames and a `string` (text opcode) otherwise, which is exactly the opcode fidelity the forwarder preserves. The records-only `startRelay` that this generalises is inlined in its `relayConnection.test.ts`.
- [E2E test harness](e2e-harness.md) / [#40](../codebase/40.md) — the *other* test harness: Playwright over the built app (UI-level, real Electron DOM). This forwarder is the transport-level round-trip harness (real client ↔ fake daemon), a strictly different layer.
- Consumer roadmap: [fake daemon](fake-daemon.md) / [#91](../codebase/91.md) (the Noise responder that answers on `/v1/server`, **landed**) → [#89](https://github.com/pyrycode/pyrycode-desktop/issues/89) (the round-trip test that drives both — still to come).
- Cross-project prior art: pyrycode `fakerelay-harness.md` (Go, `internal/e2e/internal/fakerelay`, #295) — the same ship-the-forwarder-alone phasing and the `WaitBinary` readiness rationale `whenReady` mirrors. The desktop forwarder deliberately drops the Go harness's routing/header/close-code surface.
</content>
</invoke>
