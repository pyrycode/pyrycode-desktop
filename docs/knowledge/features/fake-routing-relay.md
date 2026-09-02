# Fake routing relay (test harness plumbing)

`src/main/transport/fakeRoutingRelay.ts` + `src/main/transport/routingEnvelope.ts` are a **test-only**,
in-process `ws` relay that presents the **unchanged raw** `/v1/client` leg to the real app while
speaking the daemon's **routing-envelope** protocol on `/v1/server` — so a real `pyry` daemon can be
driven end-to-end through the built UI. It is the routing-aware counterpart to the
[fake relay forwarder](fake-relay-forwarder.md), which only works against a *fake* daemon because
that fake also speaks raw frames; a real daemon speaks routing envelopes on its relay leg, which the
raw forwarder cannot bridge.

Introduced in [#251](../codebase/251.md), split from [#178](../codebase/178.md). It shipped alone,
with no consumer at the time — the consumer, [#252](../codebase/252.md)'s
[real-claude liveness e2e](real-claude-liveness-e2e.md), landed afterward, the same "module before
its first consumer" phasing the forwarder used at #90/#91/#89.

## What it does

The daemon's relay leg speaks JSON `RoutingEnvelope` values (ported from the sibling Go repo,
`internal/protocol/envelope.go:42-77`):

- `conn_id` — the relay-assigned per-connection id.
- `frame` — the opaque application frame (`InnerFrameV2` JSON on the wire); never parsed by the relay.
- `token` (omitempty) — the client's pairing token, carried on the client's **first** frame per
  `conn_id` only, sourced from its `x-pyrycode-token` upgrade header. Never echoed back to a client.
- `close_code` (omitempty) — on a server→client envelope, asks the relay to forward `frame` (if
  present) then close that client's WS with this code.

The relay wraps/unwraps this on `/v1/server` while `/v1/client` stays byte-identical to what the app
already dials for the raw forwarder — nothing in the production dial path changes.

## How it works

### Two modules, the `*Envelope.ts` convention

- **`routingEnvelope.ts`** — the pure codec. No `ws`, no I/O, no `./codec`, no Noise, no `@shared`
  wire types; directly unit-testable. Wire keys are snake_case (`conn_id`/`close_code`); the TS-facing
  functions map to/from camelCase at the boundary, same split as the codebase's other `*Envelope.ts`
  builders (`sendMessageEnvelope.ts`, `modalResolutionEnvelope.ts`).
  - `encodeRoutingEnvelope(connId, frameText, token?)` — builds `{"conn_id":…,"frame":<frameText
    verbatim>[,"token":…]}` by string assembly. `frameText` is spliced in raw (the direct port of
    Go's `json.RawMessage`); `conn_id`/`token` go through `JSON.stringify` for escaping. `token`
    emitted only when non-empty; `close_code` never emitted (always zero client→server).
  - `decodeRoutingEnvelope(text)` — parses the wrapper (`conn_id`/`frame`/`close_code`); re-serializes
    `frame` back to text without ever reading its `v`/`type`/`data` fields. **Fail-closed**: returns
    `null`, never throws, on malformed JSON / non-object / missing-or-mistyped `conn_id`. Does not
    read `token` at all — a hostile server-leg envelope cannot smuggle one back to a client.
- **`fakeRoutingRelay.ts`** — the relay. Imports only `ws` + Node built-ins + `./routingEnvelope`
  (content-blindness enforced by the import list, same argument as the forwarder). Public surface:

```ts
export function startFakeRoutingRelay(): Promise<FakeRoutingRelay>

export interface FakeRoutingRelay {
  url: string                                   // ws://127.0.0.1:<port> — NO trailing path
  whenReady(timeoutMs?: number): Promise<void>  // server leg + at least one client leg up
  close(): Promise<void>                         // terminates all legs + server; idempotent
}
```

The lifecycle scaffolding (`deferred<T>()`, `legFor()` path router, `toBytes()`/`toText()`
normalisers, the cached `whenReady` gate, the idempotent `close()`) is adapted verbatim from
`fakeRelayForwarder.ts`.

### Leg identity and routing

Legs are identified by the HTTP upgrade **path** (deterministic under concurrent dial, unlike arrival
order): `/v1/client` → a new multiplexed client leg (assigned `c-${n}`, its `x-pyrycode-token` header
captured); `/v1/server` → the single server leg (first-claim-wins — a second `/v1/server` upgrade is
terminated). Any other path is terminated defensively.

- **Client → server**: each client frame is wrapped via `encodeRoutingEnvelope(connId, frameText,
  firstFrameSent ? undefined : token)` and written to the server leg as text; `firstFrameSent` is
  single-writer per-client state (no cross-handler race — a socket's messages are serialised by the
  event loop). Dropped silently if the server leg isn't `OPEN` (the `whenReady` gate is the consumer's
  contract for avoiding this).
- **Server → client**: `decodeRoutingEnvelope` unwraps the frame; `null` → drop and keep serving.
  Otherwise route by `conn_id` to the matching client (unknown id → drop silently — the client already
  went away). A present `frameText` is sent raw; a non-zero `closeCode` closes that client **after**
  the frame write (send-then-close preserves order on one socket, matching the Go daemon's
  `phoneSendPump`). The close call is `try`/swallow-guarded — see Edge cases.
- **Client disconnect** removes its `conn_id` from the map so a stale id never routes to a dead
  socket.

### Readiness gate

`whenReady()` resolves once the server leg **and at least one client leg** are registered — the
routing analog of the forwarder's two-leg gate (server + first client is the minimum for a
round-trip). Additional clients after the first don't re-arm it. Same cached-promise / timeout /
close-before-ready-rejects contract as the forwarder.

### Test-file dial harness (`connect()`, #904)

`fakeRoutingRelay.test.ts`'s own `connect()` — the WS dial helper its 12 tests share, not part of the
relay itself — bounds its retry ladder by a single wall-clock deadline armed once per `connect()` call
(`DIAL_BUDGET_MS = 3000`, well under vitest's 5000ms per-test default) and delegates the retry
recursion to a private `dial()`, so no re-dial can extend the deadline the original caller armed. A
prior attempt-count-only ladder (`attemptsLeft = 5` × `DIAL_STALL_MS = 1500` = 7500ms) could out-run
the test timeout regardless of how the descriptive `stalled` rejection was worded, since vitest killed
the test first — the same shape [#550](../codebase/550.md) fixed on the sibling
[fake daemon](fake-daemon.md#test-file-wall-clock-deadline-harness-bounded-550-931)'s
`fakeDaemon.test.ts`, later rolled out to that file's other 11 tests by #931 via an ambient per-test
deadline rather than this file's per-call one.

The stall path also swaps its `'error'` listener for a benign swallow before `terminate()`, rather than
dropping it: under ws@8, `terminate()` on a still-`CONNECTING` socket takes the `abortHandshake`
branch, which emits `'error'` on `nextTick` — with zero listeners that surfaces as an out-of-band
`Unhandled 'error' event` that kills the very re-dial the stall path exists to run. Detaching the
listener is still needed (it stops `terminate()`'s teardown events from spawning a duplicate re-dial);
the fix is to attach a swallow in its place, not to leave the socket unlistened.

## Edge cases and limitations

| Situation | Behaviour |
|---|---|
| Malformed JSON / non-object / missing `conn_id` on the server leg | `decodeRoutingEnvelope` returns `null`; relay drops the frame, keeps serving. |
| Server references an unknown `conn_id` | Dropped silently. |
| Client frame before the server leg is up | Dropped silently (readiness gate is the consumer's contract). |
| `close_code` outside the valid WS range | `ws.close(code)` throws synchronously; **guarded** with `try`/swallow so one bad envelope can't crash the relay. **Gotcha**: `ws` sets that socket's `readyState = CLOSING` *before* it validates and throws — the guard keeps the *relay* alive, but that one client socket is left poisoned. A robustness test must prove liveness via a second, healthy client, not by expecting the poisoned socket to recover. |
| Non-JSON frame from the client leg | Spliced verbatim into the envelope (content-blind, not validated); the daemon rejects the resulting malformed envelope — a test-author error, out of this relay's scope. Deliberate deviation from Go's `json.Valid` peek, to keep the client leg truly opaque. |
| Unknown upgrade path / duplicate `/v1/server` | Terminated; never fills a slot. |
| `close()` before both legs connect | Pending `whenReady` rejects; teardown proceeds; idempotent. |
| `WebSocketServer` has no `maxPayload` | Inherited from `fakeRelayForwarder.ts`; deferred (loopback-only, test-controlled peers — no observed need, flagged in the security review as a SHOULD-FIX to revisit only if a less-trusted peer drives it). |

- **Log-free**, mirroring the forwarder — verified by a `console.*` spy test across a full
  wrap→unwrap→close cycle. The token is never logged and never read back off the wire.
- **`frame` fidelity**: server→client re-serializes via `JSON.stringify` rather than byte-preserving
  the original slice. Value-identical for `InnerFrameV2` (the client's tolerant `decodeInnerFrame`
  accepts key reorder) — a raw-slice fallback is deferred unless a future frame needs byte-exact
  preservation.
- **`x-pyrycode-server` header** is captured but unvalidated (the fake is single-server; leg identity
  is by path, not header content). [#252](../codebase/252.md)'s single real daemon didn't need
  multi-server routing; tighten only if a future consumer does.

## Related

- [Fake daemon](fake-daemon.md) / [#550 codebase notes](../codebase/550.md) — the sibling
  `fakeDaemon.test.ts` dial harness this file's `connect()` retry-ladder shape was ported from; #550's
  own follow-up flagged this file as carrying the identical latent drop-the-listener defect "confirmed
  by reproduction rather than suspected by analogy," closed by
  [#904](https://github.com/pyrycode/pyrycode-desktop/pull/905) — see § Test-file dial harness above.
- [Fake relay forwarder](fake-relay-forwarder.md) — the raw two-leg sibling this reuses lifecycle
  scaffolding from; its "deliberately far simpler" section names exactly the Go surface this module
  ports back in (routing envelope, server-id/token headers, first-claim-wins grace, close_code
  honouring, token injection).
- [#251 codebase notes](../codebase/251.md) · Spec: `docs/specs/architecture/251-routing-aware-fake-relay.md`
  · PR [#253](https://github.com/pyrycode/pyrycode-desktop/pull/253). Split from
  [#178](../codebase/178.md).
- [Real-claude liveness e2e](real-claude-liveness-e2e.md) / [#252](../codebase/252.md) — the
  consumer: a UI-level Playwright scenario one level up from this transport-level round-trip
  plumbing, with a real `pyry` daemon on the `/v1/server` leg.
- [E2E test harness](e2e-harness.md) — the Playwright layer #252's scenario runs under.
- Cross-project prior art: pyrycode's `internal/e2e/internal/fakerelay/fakerelay.go` (Go) — the
  reference implementation this module ports; `internal/protocol/envelope.go:42-77` for the wire
  shape.
