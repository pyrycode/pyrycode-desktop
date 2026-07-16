# Fake relay forwarder (test harness plumbing)

`src/main/transport/fakeRelayForwarder.ts` is a reusable, **test-only**, in-process, content-blind `ws` relay forwarder: it stands up one `ws` server on an ephemeral loopback port and splices raw frames **byte-for-byte** between two legs — the real client under test on `…/v1/client` and a fake daemon on `…/v1/server`. Neither leg's frames are decoded, inspected, or altered; the relay is content-blind, exactly like the production v2 relay.

It is the **plumbing half** of the round-trip harness. The [fake daemon](fake-daemon.md) that answers on the server leg ([#91](../codebase/91.md), the Noise responder, `security-sensitive`, landed — it dials the `/v1/server` leg) and the round-trip test that drives both ([#89](../codebase/89.md), the consumer, landed) build on it. #90 shipped **in isolation, with no production consumer** — the same phasing the Go sibling used (`fakerelay` shipped alone in pyrycode #295 before its fake-phone peer and the consuming round-trip test). Introduced in [#90](../codebase/90.md).

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
  dropClientLeg(): void                          // terminate the current client leg; a re-dial re-splices (#416)
  closeClientLeg(code: number): void             // CLEAN close of the current client leg with a caller-chosen WS code (#464)
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

### Reconnect capability — `dropClientLeg` + leg-null-on-close ([#416](../codebase/416.md))

The forwarder gained a mid-session drop + re-splice, both **content-blind** (no codec/Noise import — the
capability terminates and re-registers sockets, never inspects a frame) and **modal-agnostic** (the
forwarder has zero knowledge of what rides the leg):

- **`dropClientLeg(): void`** — `clientLeg.terminate()`, forcing an abnormal 1006 close that a supervised
  client (`noiseRelayDriver`, [#149](../codebase/149.md)) treats as retryable and auto-reconnects from.
  No-op when no client leg is connected. The server leg (the fake daemon) is never touched.
- **Leg-null-on-`close`, identity-guarded.** Each leg socket's `close` handler nulls its slot **only if
  that socket is still the current occupant** (`clientLeg === socket` / `serverLeg === socket`). The
  guard is load-bearing: without it, a *late* close of an already-superseded old socket (e.g. a slow
  `terminate()` callback firing after a fresh re-dial already filled the slot) would null the freshly
  re-spliced new leg instead of the stale one it actually belongs to. With the leg nulled, the next
  `/v1/client` upgrade re-fills the slot exactly as the first dial did, re-splicing to the still-connected
  server leg — `settleReady()` on that path is a no-op (already settled). The `dest` the message handler
  forwards to is resolved **dynamically per frame** (`leg === 'client' ? serverLeg : clientLeg`), so a
  re-spliced leg receives forwarded frames with no stale-capture risk.

This is the plumbing half of a reconnect; the [fake daemon](fake-daemon.md) gained the matching
content-aware half (a fresh responder handshake on the reconnect `noise_init`) so a re-dial through this
re-splice actually completes instead of MAC-failing. The consuming genuine-reconnect e2e is
[#416](../codebase/416.md); it is the drop/re-dial trigger a future queue-reconnect e2e (the store-level
twin already built in [#197](../codebase/197.md)) can reuse unchanged, since neither this capability nor
the fake daemon's reconnect handshake carries any modal-specific coupling.

### Terminal-close capability — `closeClientLeg` ([#464](../codebase/464.md))

A second, **clean**-close client-leg control, added alongside `dropClientLeg` rather than replacing it —
the two drive opposite classifications on the client side:

- **`closeClientLeg(code: number): void`** — `clientLeg.close(code)` (a graceful WS close, not
  `terminate()`). No-op when no client leg is connected; the server leg is untouched. Still content-blind
  (no codec/Noise import) and content-agnostic about the code itself — the forwarder never interprets it,
  just passes it to `ws`'s `close`.
- **The caller picks the code to pick the client's classification.** A code in the client's
  `DEFAULT_FATAL_CLOSE_CODES` (`4401`/`4421`/`4426`, `relaySupervisor.ts:40`) drives the supervised client
  to a **terminal, non-retryable** failure (no re-dial armed) — the opposite of `dropClientLeg`'s abnormal
  1006, which the client treats as retryable and auto-reconnects from. This is what #464 needed: driving
  the client to the terminal `error` status that surfaces the `Re-pair` affordance ([#167](../codebase/167.md))
  without accidentally triggering a reconnect.
- **Reuses the existing identity-guarded leg-null-on-`close` handler unchanged** — a clean close fires the
  same socket `close` event `dropClientLeg`'s `terminate()` does, so no new nulling logic was needed.

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
| `dropClientLeg()` with no client leg connected | Silent no-op ([#416](../codebase/416.md)). |
| A dropped client leg's late `close` fires after a fresh re-dial already re-spliced | Identity-guarded — the late close cannot null the new leg ([#416](../codebase/416.md)). |
| `closeClientLeg(code)` with no client leg connected | Silent no-op, same guard as `dropClientLeg` ([#464](../codebase/464.md)). |
| `closeClientLeg(code)` with a code in `DEFAULT_FATAL_CLOSE_CODES` | Client classifies terminal, non-retryable — no re-dial armed, contrast `dropClientLeg`'s retryable 1006 ([#464](../codebase/464.md)). |

- **Deliberately far simpler than the Go `fakerelay`.** No routing envelope, no `server-id`/token headers, no first-claim-wins grace, no `close_code` honouring, no token injection. It is a raw two-leg byte pipe — none of the Go surface is ported. That dropped surface now lives in the sibling [fake routing relay](fake-routing-relay.md) (#251), which bridges a *real* daemon's routing-envelope leg instead of a fake raw one.
- **Log-free** — mirrors `relayConnection.ts`'s log-free construction; a stray `console.log` in shared test infra pollutes every consumer's output. All observable behaviour is via the returned handle and the spliced frames.
- **No production consumer yet** — zero blast radius. The `security-sensitive` frame-inspecting responder is #91; this is opaque-byte plumbing only.

## Related

- [#90 codebase notes](../codebase/90.md) · Spec: `docs/specs/architecture/90-fake-relay-forwarder-test-helper.md` · PR [#92](https://github.com/pyrycode/pyrycode-desktop/pull/92). Split from [#88](https://github.com/pyrycode/pyrycode-desktop/issues/88).
- [Relay connection](relay-connection.md) / [#21](../codebase/21.md) — the real client under test that dials the `/v1/client` leg; its `send` writes a `Uint8Array` (binary opcode) for Noise frames and a `string` (text opcode) otherwise, which is exactly the opcode fidelity the forwarder preserves. The records-only `startRelay` that this generalises is inlined in its `relayConnection.test.ts`.
- [E2E test harness](e2e-harness.md) / [#40](../codebase/40.md) — the *other* test harness: Playwright over the built app (UI-level, real Electron DOM). This forwarder is the transport-level round-trip harness (real client ↔ fake daemon), a strictly different layer.
- Consumers: [fake daemon](fake-daemon.md) / [#91](../codebase/91.md) (the Noise responder that answers on `/v1/server`, **landed**) → [#89](../codebase/89.md) (the round-trip test that drives both, **landed**).
- Cross-project prior art: pyrycode `fakerelay-harness.md` (Go, `internal/e2e/internal/fakerelay`, #295) — the same ship-the-forwarder-alone phasing and the `WaitBinary` readiness rationale `whenReady` mirrors. The desktop forwarder deliberately drops the Go harness's routing/header/close-code surface.
- [Fake routing relay](fake-routing-relay.md) / [#251](../codebase/251.md) — the routing-aware sibling that ports the dropped Go surface back in, for bridging a *real* daemon instead of the fake one this module bridges.
- [#416 codebase notes](../codebase/416.md) — adds `dropClientLeg` + identity-guarded leg-null-on-close (the reconnect capability, § above) and the genuine-reconnect e2e that drives it; blocked-on [#415](../codebase/415.md)'s renderer reconcile.
- [#464 codebase notes](../codebase/464.md) — adds `closeClientLeg` (the terminal-close capability, § above), the clean-close counterpart that drives a *terminal* failure instead of a retryable one; first consumer to expose the forwarder through [`launchPairedApp`](e2e-harness.md), surfacing the [`Re-pair`](../codebase/167.md) affordance on the fake stack.
</content>
</invoke>
