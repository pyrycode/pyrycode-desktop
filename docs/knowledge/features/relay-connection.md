# Relay connection

The **connection primitive** at the base of the Phase 1 connect–send–stream round-trip: one secure WebSocket (`wss://`) to the relay, living entirely in the Electron **background process**. It opens the socket, keeps it alive with a heartbeat, caps inbound frame size, carries **raw frames in both directions as opaque bytes**, and closes — for the lifetime of exactly **one** connection.

Introduced in [#21](../codebase/21.md). It is a **semantics-blind byte pipe**: the Noise_IK handshake, the frame codec, and event parsing land *on top* of it later and consume it as opaque bytes. Automatic reconnection with backoff wraps it in the [relay supervisor](relay-supervisor.md) (#22), which recreates this connection after transient drops. This is the desktop equivalent of the mobile relay connection and the client leg of the pyrycode Go binary's `internal/transport` (WSS client with auto-reconnect backoff — the `internal/relay`/`transport` packages) — this module is that shape's **single-connection half**, minus the reconnect loop and jittered backoff.

## What it does

Gives the background process **one function** — `createRelayConnection(config)` — that dials a caller-supplied relay URL with caller-supplied headers and returns a handle with `send` and `close`. Lifecycle transitions and inbound frames leave through an injected `onEvent` callback the caller owns. Nothing here touches keys, IPC, the preload bridge, or the renderer — a compromised renderer has **no path** to this socket, its timers, or its raw bytes ([ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md); CLAUDE.md "Keep the transport out of the window").

The module is **identity- and semantics-blind**: it does not construct or interpret the `x-pyrycode-server` / `x-pyrycode-device-name` / `user-agent` header semantics, nor validate the URL — the caller supplies both verbatim. It never parses a frame; a `RelayEvent.message` is the received bytes, unaltered.

## How it works

One file, five exported symbols: `src/main/transport/relayConnection.ts` (a new `src/main/transport/` directory — the home CLAUDE.md names for the transport, where the supervisor #22, the Noise session, and the codec will join it).

### Public surface

```ts
export interface RelayConnectionConfig {
  url: string                        // caller-supplied, e.g. wss://<relay>/v2/client — used verbatim
  headers: Record<string, string>    // caller-supplied verbatim (server-id, device-name, user-agent) — never logged
  connectTimeoutMs?: number          // WS-upgrade deadline; default 10_000. Caller-tunable.
  maxFrameBytes?: number             // inbound WS cap; default 1 << 20 (1 MiB, the relay's cap).
  onEvent: (event: RelayEvent) => void  // the background-process consumer sink (DI at composition root)
}

export type RelayEvent =
  | { type: 'connected' }                             // WS upgrade completed; leg is live
  | { type: 'message'; frame: Uint8Array }            // one OPAQUE inbound frame
  | { type: 'closed'; code: number; reason: string }  // terminal; emitted EXACTLY once

export interface RelayConnection {
  send(frame: string | Uint8Array): void  // string → text frame, bytes → binary frame; throws if not OPEN
  close(): void                            // idempotent local close (WS 1000)
}

export class RelayNotConnectedError extends Error {}

export function createRelayConnection(
  config: RelayConnectionConfig,
  timing?: { idlePingIntervalMs?: number; pongTimeoutMs?: number }  // TEST-ONLY cadence override
): RelayConnection
```

- **Factory + injected `onEvent`, not a class with an `.on()` emitter.** Matches the codebase's functional/DI main-side idiom (`emitDaemonEvent(sink, …)`, `onCommand(source, handler)`): the composition root constructs config and owns the sink, testable with a `vi.fn()`. Data flow is unidirectional — events out via `onEvent`, imperatives in via `send`/`close`.
- **Three-member event union, one terminal `closed`.** Every failure cause — connect-timeout, pong-timeout, oversize, remote close, socket error, local `close()` — funnels into **one** terminal `{ type: 'closed'; code; reason }`, emitted exactly once. The consumer distinguishes "never connected" from "was connected, then dropped" by whether it saw `connected` first; `code`/`reason` carry the diagnostic. A separate `error`/`failed` member would duplicate the terminal signal (deferred until #22 proves it needs the distinction).
- **Heartbeat cadence is NOT in the public config.** The wire-spec 30 s idle-ping / 30 s pong-timeout cadence is pinned as module constants (`WIRE_IDLE_PING_INTERVAL_MS`, `WIRE_PONG_TIMEOUT_MS`) and only overridable through the **test-only** second `timing` parameter. A production caller literally cannot pass it through the typed public API — deterministic enforcement of "not tunable", not a comment. `connectTimeoutMs` **is** public (an architect default of 10 s, not wire-spec-pinned); `maxFrameBytes` is public per AC4's "the *configured* max frame size".
- **`send` throws, not returns a Result.** The codebase has no Result-type pattern; throwing a named `RelayNotConnectedError` on `readyState !== OPEN` is idiomatic and deterministic (AC5's "surfaces an error rather than being silently dropped"). Mirrors the Go side's `ErrNotConnected`.

### Internal state machine

One connection walks `connecting → connected → closed`, or `connecting → closed` (never established). A single module-private `closed` guard makes the terminal emit fire **exactly once** and forbids a `connected` emit after `closed`. The single teardown routine (`teardownAndEmitClosed`) clears every timer, `removeAllListeners()` on the socket so no late `ws` event can re-enter `onEvent`, and emits `closed` once. This "a torn-down connection never fires again" guarantee is load-bearing for the [supervisor](relay-supervisor.md) (its shared `onConnEvent` has no per-connection fence) and is pinned by a named regression fixture ([#35](../codebase/35.md), mobile #496 parity) — the two redundant guards (`removeAllListeners()` and the per-handler `closed` short-circuit) are each pinned by the assertion that targets it specifically.

| `ws` event / timer | Action |
|---|---|
| `'open'` | emit `{ type: 'connected' }`; clear the connect timer; start the idle-ping `setInterval`. |
| `'message'` | normalize to one `Uint8Array` (`toFrame`); emit `{ type: 'message', frame }`. Oversized frames never reach here — `ws` drops + closes them at `maxPayload`. |
| `'pong'` | clear the outstanding pong-deadline (the connection is alive). |
| `'error'` | classify into a **short static reason** — `max-frame-exceeded` (1009) / `connect-error` (1006) — never copy `err.message` into the event; never re-throw. |
| `'close'` | terminal: forward the `pending` module-authored `{code, reason}` if set, else the peer's `code`/`reason.toString()`. |
| idle-ping tick | if OPEN, `ws.ping()` and arm the pong-deadline (once). |
| pong-deadline fires | dead peer: set `pending = {1006, 'pong-timeout'}`, `ws.terminate()`. |
| connect timer fires | still connecting: set `pending = {1006, 'connect-timeout'}`, `ws.terminate()`. |
| `close()` | idempotent: OPEN → `ws.close(1000, 'client closing')`; else `ws.terminate()`. |

**Self-initiated vs peer-initiated reason.** For peer/library closes (remote close, oversize), forward the `'close'` event's `code` + `reason` as-is. For module-initiated closes (connect-timeout, pong-timeout, oversize normalization, local `close()`), the `'close'` reason is empty; a `pending` field set *before* self-terminating substitutes a short static reason.

### Heartbeat detail

On `'open'`: a `setInterval(idlePingIntervalMs)` fires `ws.ping()` each tick and arms an at-most-one `setTimeout(pongTimeoutMs)` pong-deadline; each `'pong'` clears it. With the wire-spec 30 s/30 s: a ping at T=30 s arms a deadline at T=60 s → a connection that stops ponging is closed by **T=60 s worst-case**. Pinging *unconditionally* every 30 s (rather than resetting on data activity) matches the proven Go `pingLoop` and guarantees ≤ 30 s between keepalives — the invariant the relay's symmetric side expects. Reset-on-activity is a deferred nicety.

### Data flow

```
 caller (#22 supervisor, later)      createRelayConnection            ws socket ── relay
   config{url,headers,onEvent} ─────► new WebSocket(url,{headers,      upgrade /v2/client
                                        maxPayload})
   handle.send(frame) ──────────────► ws.send(frame)  [OPEN only]  ──► outbound frame
                                       ws 'message' ─► onEvent({message,frame})  ◄── inbound frame
                                       ws 'open'/'close' ─► onEvent({connected}/{closed})
                                       ping timer ─► ws.ping(); 'pong' ─► clear deadline
```

Nothing in this flow reaches IPC, the preload, or the renderer. Both directions are opaque: no member of `RelayEvent` and no argument of `send` is parsed, decoded, or validated as a Noise/wire structure here. The typed-event path to the window ([daemon-event channel](daemon-event-channel.md) / #18) sits *downstream* of the handshake+codec layers, not of this raw socket.

## Dependency: `ws` (the project's first network dependency)

#21 adds `ws` (`^8.18.0`, runtime `dependencies`) + `@types/ws` (`devDependencies`) — the project's **first network dependency**, justified per CLAUDE.md "Don't add dependencies without justification". The built-in browser/`undici` `WebSocket` in the Electron main process **cannot** set request headers, enforce a max inbound payload, or give handshake-timeout / native ping-pong control. All AC mechanics map directly onto `ws`:

| Need | `ws` primitive |
|---|---|
| caller-supplied headers | `new WebSocket(url, { headers })` |
| oversize protection | `{ maxPayload }` → `ws` closes and does **not** deliver the oversized message |
| heartbeat | `ws.ping()` + the native `'pong'` event |
| raw frames both ways | `'message'` (inbound `Buffer`) / `ws.send()`; `'open'`/`'close'` lifecycle |

`ws` is the de-facto Node WS client, MIT-licensed, with no runtime transitive deps. This mirrors the Go side's call (it added `coder/websocket` as *its* first network dep and set `SetReadLimit(1<<20)` — the same 1 MiB cap). Note the connect deadline is an **owned timer**, not `ws`'s `handshakeTimeout` (see Edge cases).

## Configuration and usage

- **Import by relative path** from `src/main`: this module is main-process-only. It imports `ws` and node builtins — **no** shared/renderer imports, so the missing `@shared` alias in `tsconfig.node.json` is moot here (but do not reach for `@shared/*` if you add a shared import later — see [#18 notes](../codebase/18.md)).
- **Caller (the supervisor #22)** builds `config` — including the relay URL and the three headers, which *it* constructs from the pairing/QR payload — and owns the `onEvent` sink (deciding whether/how to log, and it MUST NOT log `frame` contents or `config.headers`).
- **Endpoint shape (reference; the module is blind to it):** the client leg is `wss://<relay>/v2/client` with headers `x-pyrycode-server` (target server-id, required), `x-pyrycode-device-name` (human label, recommended), `user-agent` (`pyrycode-desktop/<version>`). There is **no** `x-pyrycode-token` header in v2 — the device-token rides inside the Noise_IK handshake early-data, which is out of scope for this layer.

## Edge cases and limitations

- **Oversize is observed as "terminal close + no message", not by a raw `ws` code.** `ws`'s client-side `'close'` code for an oversized inbound frame is **1006**, not 1009 (verified on ws 8.21 — the 1009 is only sent to the *peer*). The `'error'` carries a stable `err.code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'` and, crucially, **no `'message'` is emitted**. The module detects that error code and normalizes the terminal event to `{ code: 1009, reason: 'max-frame-exceeded' }` so the observable code matches the wire-spec `message.too_long`. Assert oversize by "terminal close + no `message` emitted", never by the raw ws close code.
- **The connect timeout is an owned timer, not `ws`'s `handshakeTimeout`.** Owning it yields a deterministic `connect-timeout` reason (`terminate()` during CONNECTING reliably emits `'close'` 1006) without string-matching `ws`'s internal error text, and avoids two abort paths racing on an equal deadline. A deliberate, documented deviation from the spec's `handshakeTimeout` suggestion — an improvement, accepted by review.
- **No reconnect, no backoff.** #21 delivers exactly one connection's lifetime, then a terminal `closed`; it never itself reconnects, so it introduces **no** reconnect-storm vector. The supervisor #22 owns "replace, don't stack" when it recreates connections.
- **`isBinary` is not surfaced on inbound frames.** Frames are carried as opaque `Uint8Array`; the v2 wire is UTF-8 JSON the downstream codec decodes regardless of opcode. Add the text/binary distinction to the `message` member only if a future frame type needs it.
- **Mid-flight `send` drop.** `send` throws only on `readyState !== OPEN`; a frame handed to `ws.send` on a socket that dies microseconds later is dropped (the async `ws.send` error is not separately surfaced). Acceptable for a single connection with no reissue here; the supervisor/handshake layer owns reissue-after-reconnect.
- **A throwing `onEvent` is a caller bug, not defended.** `onEvent` is a trusted internal sink; per evidence-based-fix no try/catch wraps it. Documented as a caller obligation.

## Security posture

The ticket carries the `security-sensitive` label; the architect's security review verdict is **PASS**.

- **Log-free by construction.** The module emits **no** logs at all. The caller-supplied headers carry device/server identity and frame bytes carry payload — a stray `console.log` would leak either to main-process stdout. All diagnostics travel as `RelayEvent` data. This is the deterministic belt-and-suspenders alternative to a "don't log the headers" rule. Restated obligation for the consumer (#22): do **not** log `frame` contents or `config.headers`.
- **No secret data in event fields.** `closed.reason` is a short **static, module-authored** string for self-initiated closes or the peer's WS reason for remote closes — the raw `err.message` (which can embed the URL on a TLS/hostname mismatch) is **never** copied verbatim into the event.
- **Memory + liveness envelope is bounded.** `maxPayload` (1 MiB) drops + closes an oversized frame from a hostile relay without unbounded buffering; the owned connect timeout bounds a hung upgrade; the 30 s/30 s heartbeat tears down a dead connection within 60 s.
- **TLS inherits `ws`'s secure defaults** — `rejectUnauthorized` stays `true`, hostname verified against the `wss://` host. **No TLS pinning** — deliberate: the future Noise_IK layer provides end-to-end authentication and detects relay impersonation, so pinning here would add rotation pain for no marginal security ([ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md)). Tests use `ws://` loopback only; the module is scheme-blind by design and production callers always pass `wss://`.
- **Zero IPC/renderer surface.** No `contextBridge`, no `ipcMain`, no preload change, no `BrowserWindow`. A renderer compromise gains no path to this socket. Malformed-*content* defense (a hostile daemon inside the session) is the codec/Noise layer downstream — this layer is semantics-blind and caps only the outer WS frame. Relay-URL/scheme validation (allowlist `wss://`, no embedded credentials) is the **pairing/config layer**'s job, deferred there.

## Related

- [ADR 0002 — Remote head over relay, shared wire](../decisions/0002-remote-head-over-relay-shared-wire.md) — *why* this layer is a blind byte pipe: authentication is end-to-end via Noise_IK on top of this socket, so it needs no auth and no TLS pinning.
- [ADR 0001 — Stack: transport in the background process](../decisions/0001-stack-electron-react-typescript.md) — the background-process transport home.
- [Daemon-event channel](daemon-event-channel.md) (#18) — the typed background→window pipe that sits *downstream* of the handshake+codec layers this socket feeds.
- [#21 codebase notes](../codebase/21.md) · Spec: `docs/specs/architecture/21-single-shot-relay-connection.md`
- [#35 codebase notes](../codebase/35.md) — the regression fixture pinning the teardown "never re-enters `onEvent`" guarantee (mobile #496 parity, test-only).
- Go mirror (in the `pyrycode` repo, via QMD `pyrycode-docs`): `knowledge/features/transport-package.md` (`internal/transport` — WSS client with auto-reconnect backoff) and `knowledge/features/relay-package.md` — the full-lifecycle shape this ticket takes the single-connection half of.
