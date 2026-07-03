# Spec — Single-shot relay connection in the background process (#21)

**Size:** S. Two new files (`src/main/transport/relayConnection.ts`, `src/main/transport/relayConnection.test.ts`), one dependency added (`ws` + `@types/ws`). 5 new exported symbols. ~170 production + ~330 test ≈ ~500 LOC. **Zero consumer cascade** — greenfield module, no existing call sites; the supervisor (#22), the Noise handshake, the frame codec, and renderer wiring land in later tickets. No edit fan-out.

> Scope lock: this ticket delivers **one connection's lifecycle** — open, keep-alive, detect failure, carry raw frames both ways, close. **No reconnect, no backoff** (that's #22, the supervisor that recreates this connection). **No Noise decode, no framing interpretation, no envelope parsing** — this layer is a semantics-blind byte pipe; the handshake and codec land on top later. The Go binary's mirror is `pyrycode` `docs/specs/architecture/247-wssclient-with-auto-reconnect-backoff.md` — this ticket is its **single-connection half** (its `Send`/`Receive`/heartbeat/`SetReadLimit`, **minus** the reconnect loop and jittered backoff).

## Files to read first

Codegraph is not initialized for this repo (`mcp__codegraph__*` errors here; see auto-memory); this reading list was built by hand from the existing `src/main` transport-adjacent code, the shared event-union idiom, and the Go mirror spec.

- `src/main/emitDaemonEvent.ts` (whole, 25 lines) — the **main-side helper idiom** this module follows: a small structural interface, **relative** imports (no `@shared` alias in `src/main`), and the **no-logging** discipline (its header comment: a `console.log` would leak payload to main-process stdout). The new module is log-free for the same reason.
- `src/main/receiveCommand.ts` (whole, 42 lines) — the **unsubscribe-handle** return idiom and the trust-boundary comment style; note its `console.warn('pyry:command — dropped malformed command')` — a **fixed string, never data**. That's the logging bar; this module clears it by not logging at all.
- `src/main/emitDaemonEvent.test.ts` (whole, 54 lines) — the **vitest idiom** to mirror: `describe`/`it`/`expect`, structural fakes with `vi.fn()`, no Electron harness. This module's tests instead stand up a real in-process `ws` server (below), but keep this file's assertion style.
- `src/shared/ipc/events.ts:31-38` — the **discriminated-union-on-`type`** idiom (`DaemonEvent`). `RelayEvent` follows the same shape. Note: `RelayEvent` is **not** `DaemonEvent` and does **not** live in `src/shared` — it carries raw bytes and stays entirely in `src/main` (never crosses to the renderer). Do not import or extend `DaemonEvent` here.
- `src/main/index.ts:1-6` — the background-process entry point and its header comment ("the relay socket … lives in this background process … the renderer never sees raw bytes or keys"). This module is that relay socket. **#21 does not modify `index.ts`** — there is no composition-root wiring yet (that's #22).
- `docs/knowledge/decisions/0002-remote-head-over-relay-shared-wire.md` — the "remote head over the content-blind relay" contract and the load-bearing Noise variant. Read for *why* this layer is a blind byte pipe: authentication is end-to-end via Noise_IK on top of this socket, so this layer needs no auth and no TLS pinning.
- `package.json` — confirm `ws` is **not** yet a dependency (it must be added — justification below) and confirm the test/build gates: `npm test` (vitest, node env), `npm run build` (typecheck + build, the salvage/QA gate).
- `tsconfig.node.json` — confirms `src/main` has **no `@shared` path alias** (auto-memory pins this). This module imports no shared code, so the point is moot here, but do not reach for `@shared/*` if you add a shared import.
- **Reference (Go mirror, in the `pyrycode` repo — read via QMD, not on disk here):** `docs/specs/architecture/247-wssclient-with-auto-reconnect-backoff.md`. The proven shape for the socket + heartbeat + `SetReadLimit` + teardown discipline. **Ignore its reconnect loop, backoff function, and `Connect(ctx)` blocking lifecycle** — all out of scope for #21. The relevant, wire-spec-pinned facts from it and from `pyrycode` `docs/protocol-mobile.md` are inlined below so you need not fetch them.
- `CLAUDE.md` (repo root) — *Keep the transport out of the window*; *No crypto/sockets/tokens in the renderer*; *Sealed event shapes on a `type` discriminant*; *Test-first*; *Don't add dependencies without justification*.

## Design source

N/A — background-process transport module; no visual surface. The ticket body has no `## Figma` section and the work is not UI-visible (no renderer or preload code in this ticket). The visual-fidelity check is intentionally skipped.

## Context

This is the connection primitive at the base of the Phase 1 connect–send–stream round-trip. It opens **one** secure WebSocket to the relay, keeps it alive with a heartbeat, caps inbound frame size, carries **raw frames** in both directions, and closes — for the lifetime of exactly one connection. Everything above it (Noise handshake, frame codec, event parsing) lands in later tickets and consumes this as an opaque byte pipe. Everything around it (automatic reconnection with backoff — the supervisor #22) wraps this, recreating it on drop.

The connection lives **entirely in `src/main/`** (the Electron background process). Keys, sockets, and raw bytes must not reach the renderer (CLAUDE.md; ADR 0002). This module emits its lifecycle and inbound frames through an injected callback that the background-process consumer (#22) owns; **nothing here touches IPC, the preload bridge, or the renderer.** The typed-event path to the window (`emitDaemonEvent` / #18) is downstream of the handshake+codec layers, not of this raw socket.

### Wire-spec facts (inlined — do not re-derive)

Source of truth: `pyrycode` `docs/protocol-mobile.md`. The relay implements the symmetric side of each; **do not deviate**.

- **Heartbeat** (§ Heartbeat): WS-native ping/pong every **30 s** idle, **30 s** pong timeout → **60 s worst-case** dead-connection detection. Not architect-tunable in production.
- **Client leg endpoint** (§ client leg): `wss://<relay>/v2/client` with request headers `x-pyrycode-server` (target server-id, required), `x-pyrycode-device-name` (human label, recommended), `user-agent` (`pyrycode-desktop/<version>`, required). **There is no `x-pyrycode-token` header in v2** — the device-token rides inside the Noise_IK handshake early-data, which is out of scope here. **This module constructs and interprets none of these headers** — the caller supplies them verbatim via config; the module stays identity-blind.
- **Max frame size:** the relay's per-message WS cap is **1 MiB** (`message.too_long`, § Error codes). Match it so the desktop does not reject a frame the relay/mobile would accept. This sits well above the largest expected frame (a v2 Noise transport message ≤ 65535 bytes, base64-expanded ~87 KB, plus JSON envelope). Each WS message is one frame; there is **no** manual length-prefix framing. The Go mirror sets exactly this via `SetReadLimit(1<<20)`. (The stricter 65519-byte *application-envelope* cap in protocol-mobile.md § Application envelope size cap is enforced by the **codec/Noise layer downstream**, not by this WS-transport layer — this layer caps the outer WS frame only.)
- **TLS:** standard TLS verification, **no pinning** (the future Noise_IK layer provides end-to-end authentication and detects relay impersonation). Use `ws`'s default TLS (`rejectUnauthorized` stays at its secure default `true`).

## Design

### Dependency: add `ws` (Node WebSocket client)

**Justification (per CLAUDE.md "Don't add dependencies without justification"):** the built-in browser/`undici` `WebSocket` available in the Electron main process **cannot set request headers, cannot enforce a max inbound payload, and gives no handshake-timeout / native ping-pong control.** All four AC mechanics map directly onto `ws` ClientOptions and events:

| AC | `ws` primitive |
|---|---|
| AC1 caller-supplied headers | `new WebSocket(url, { headers })` |
| AC2 connect timeout | `{ handshakeTimeout }` → emits `'error'` then `'close'` on timeout |
| AC3 heartbeat | `ws.ping()` + the `'pong'` event (native control frames) |
| AC4 oversize protection | `{ maxPayload }` → `ws` closes with **1009** and does **not** deliver the oversized message |
| AC5 raw frames both ways | `'message'` event (inbound `Buffer`) / `ws.send()` (outbound); `'open'`/`'close'` lifecycle |

`ws` offloads the framing and keep-alive machinery, leaving the socket + heartbeat timers + teardown as the only bespoke work. This mirrors the Go side's call (it added `coder/websocket` as its first network dep). `ws` is the de-facto Node WS client, MIT-licensed, no runtime transitive deps.

- Add `"ws": "^8.18.0"` to `dependencies` (runs in the Node main process — a runtime dep, not dev).
- Add `"@types/ws": "^8.5.13"` to `devDependencies`.
- Run `npm install` so `package-lock.json` updates; `npm run build` must pass with the new dep resolved.
- Document `ws` as the project's first network dependency in a post-merge knowledge note (documentation phase owns that — do **not** add it as a developer AC).

### Module layout

| File | Status | Purpose |
|---|---|---|
| `src/main/transport/relayConnection.ts` | **new** | `createRelayConnection` + its config/handle/event/error types. The one connection primitive. No `electron` import, no `src/renderer` import. |
| `src/main/transport/relayConnection.test.ts` | **new** | unit tests against an in-process `ws` server (fake relay). Helpers live in this file (keeps the file count at 2). |

`src/main/transport/` is a new directory — the home the ticket names, matching CLAUDE.md's "the transport belongs under `src/main/`". Later transport pieces (supervisor #22, Noise session, codec) join it.

### Public surface (contracts, not implementations)

Five exported symbols. Imports: `import { WebSocket } from 'ws'` and `import type { RawData } from 'ws'`. No shared/renderer imports.

```ts
/** Caller-supplied configuration for one relay connection. The module is identity-
 *  and semantics-blind: it does not construct or interpret the header semantics. */
export interface RelayConnectionConfig {
  url: string                        // caller-supplied, e.g. wss://<relay>/v2/client
  headers: Record<string, string>    // caller-supplied verbatim (server-id, device-name, user-agent)
  connectTimeoutMs?: number          // WS-upgrade deadline; default 10_000. Caller-tunable.
  maxFrameBytes?: number             // inbound WS cap; default 1 << 20 (1 MiB, relay's cap).
  onEvent: (event: RelayEvent) => void  // the background-process consumer sink (DI at composition root)
}

/** A single event from one relay connection. Sealed discriminated union on `type`.
 *  Raw frames are OPAQUE bytes — no Noise decode, no framing interpretation. */
export type RelayEvent =
  | { type: 'connected' }                                  // WS upgrade completed; leg is live
  | { type: 'message'; frame: Uint8Array }                 // one opaque inbound frame
  | { type: 'closed'; code: number; reason: string }       // terminal; emitted exactly once

/** Handle for one live (or connecting) relay connection. */
export interface RelayConnection {
  /** Write one opaque outbound frame as-is. string → text frame, bytes → binary frame
   *  (the module forces no opcode — semantics-blind). Throws RelayNotConnectedError if
   *  the socket is not OPEN (an attempted send with no live connection surfaces an error,
   *  never a silent drop). */
  send(frame: string | Uint8Array): void
  /** Idempotent local close (WS 1000). Tears down timers + listeners; the terminal
   *  `closed` event fires once via onEvent. Safe to call before `connected`. */
  close(): void
}

/** Thrown by RelayConnection.send when no connection is live (readyState !== OPEN). */
export class RelayNotConnectedError extends Error {}

/** Open one relay connection. Dialing starts immediately; lifecycle + inbound frames
 *  arrive via config.onEvent. The optional second parameter overrides the wire-spec
 *  heartbeat cadence and is TEST-ONLY — production callers pass one argument, locking
 *  the non-tunable 30 s/30 s cadence by construction. */
export function createRelayConnection(
  config: RelayConnectionConfig,
  timing?: { idlePingIntervalMs?: number; pongTimeoutMs?: number }
): RelayConnection
```

Design rationale (the architect calls the ticket delegates):

- **Factory + injected `onEvent`, not a class with an `.on()` emitter.** Matches the codebase's functional/DI idiom (`emitDaemonEvent(sink, …)`, `onCommand(source, handler)`): the composition root constructs config and owns the sink. One callback keeps the surface minimal and the data-flow unidirectional (events out, `send`/`close` in) — no two-way binding, no EventEmitter ceremony. The consumer (#22) is a plain function, testable with a `vi.fn()` sink.
- **Three-member event union, one terminal `closed`.** AC5 names exactly "connected / closed-with-reason" as lifecycle events plus opaque inbound messages. Every failure cause — connect-timeout (AC2), pong-timeout (AC3), oversize (AC4, `ws`'s 1009), remote close, socket error, local `close()` — funnels into **one** terminal `{ type: 'closed'; code; reason }`. The consumer distinguishes "never connected" from "was connected then dropped" by whether it saw `connected` first; `code`/`reason` carry the diagnostic. This is the minimal shape; a separate `error`/`failed` member would duplicate the terminal signal (see Open questions).
- **Heartbeat cadence is not in the public config.** `idlePingIntervalMs`/`pongTimeoutMs` are wire-spec-pinned (30 s/30 s) and "not tunable" per the ticket. Keeping them out of `RelayConnectionConfig` and only in the **test-only second parameter** is the deterministic enforcement (a production caller literally cannot pass them through the typed public API — belt-and-suspenders, not a comment). This mirrors the Go mirror's test-only constructor (`newClientForTest`). `connectTimeoutMs` **is** in the public config — it is an architect default (10 s), not a wire-spec constant, and a caller may legitimately tune it. `maxFrameBytes` is in the public config per AC4's wording ("the *configured* max frame size"), defaulting to the relay's 1 MiB.
- **`send` throws, not returns a Result.** The codebase has no established Result-type pattern; throwing a named `RelayNotConnectedError` on `readyState !== OPEN` is idiomatic, deterministic, and testable (AC5's "surfaces an error rather than silently dropped"). The Go mirror's equivalent is `ErrNotConnected`.
- **`RawFrame` is inlined as `Uint8Array`, not a 6th export.** Keeps the surface at 5. `Buffer` (what `ws` delivers) is a `Uint8Array` subclass, so the inbound `frame` is the received bytes with no copy; if `ws` ever delivers a fragmented `Buffer[]`, concatenate to one `Uint8Array` (the ticket guarantees one WS message = one frame).

### Connection state machine (internal)

One connection walks: `connecting → connected → closed`, or `connecting → closed` (never established). A single module-private `closed` guard makes the terminal emit **exactly once** and forbids a `connected` emit after `closed`.

| `ws` event / timer | Action |
|---|---|
| `'open'` | emit `{ type: 'connected' }` (unless already closed); start the idle-ping interval (see heartbeat). |
| `'message'` (data, isBinary) | normalize `data` to one `Uint8Array`; emit `{ type: 'message', frame }`. (Oversized frames never reach here — `ws` drops + closes them at `maxPayload`.) |
| `'pong'` | clear the outstanding pong-deadline timer (the connection is alive). |
| `'close'` (code, reason) | terminal: tear down timers + listeners; emit `{ type: 'closed', code, reason }` (use the module-authored reason if the close was self-initiated — see below). |
| `'error'` (err) | pre-`open`: a connection failure (connect-timeout via `handshakeTimeout`, DNS, refused, TLS). Record a static reason (`'connect-timeout'` when `handshakeTimeout` fired, else `'connect-error'`); the following `'close'` emits the terminal event. Do **not** put `err.message` verbatim into the event (see Security §7). Never re-throw out of the handler. |
| idle-ping tick | `ws.ping()`; if no pong-deadline is armed, arm one (`pongTimeoutMs`). |
| pong-deadline fires | dead connection: set module reason `'pong-timeout'`, `ws.terminate()` (peer is dead; skip the close handshake). The `'close'` handler emits terminal `closed` (code 1006, reason `'pong-timeout'`). |
| `close()` called | idempotent: if OPEN, `ws.close(1000, 'client closing')`; else `ws.terminate()`. Terminal `closed` fires via the `'close'` handler. |

**Self-initiated vs peer-initiated reason.** For peer/library closes (remote close, oversize→1009), forward the `'close'` event's `code` + `reason` as-is. For module-initiated closes (connect-timeout, pong-timeout, local `close()`), the `'close'` event's reason is empty; substitute a module-authored short static reason (`'connect-timeout'` / `'pong-timeout'` / `'client closing'`). Track this with one internal `pendingReason` field set before self-terminating.

### Heartbeat detail

On `'open'`: `setInterval(idlePingIntervalMs)` → each tick calls `ws.ping()` and arms the pong-deadline (`setTimeout(pongTimeoutMs)`) if not already armed. Each `'pong'` clears the deadline. With the wire-spec 30 s/30 s: a ping at T=30 s arms a deadline at T=60 s → a connection that stops ponging is closed by T=60 s (the spec's 60 s worst-case). Pinging unconditionally every 30 s (rather than resetting the timer on data activity) matches the proven Go `pingLoop` and is strictly safe: it guarantees ≤ 30 s between keepalives, which is the invariant the relay's symmetric side expects. Reset-on-activity is a deferred nicety (Open questions).

### Data flow

```
 caller (#22 supervisor, later)         createRelayConnection            ws socket ── relay
   config{url,headers,onEvent} ───────► new WebSocket(url,{headers,       upgrade /v2/client
                                          handshakeTimeout, maxPayload})
   handle.send(frame) ────────────────► ws.send(frame)  [OPEN only]  ───► outbound frame
                                         ws 'message' ──► onEvent({message, frame})  ◄── inbound frame
                                         ws 'open'/'close' ──► onEvent({connected}/{closed})
                                         ping timer ──► ws.ping(); 'pong' ──► clear deadline
```

Nothing in this flow reaches IPC, the preload, or the renderer. The raw frames are opaque both ways: no member of `RelayEvent` and no argument of `send` is parsed, decoded, or validated as a Noise/wire structure here.

## State + concurrency model

- **No Zustand store, no async iterables.** This is main-process transport, not renderer state. Lifecycle is expressed as `onEvent` callbacks and two imperative methods (`send`/`close`). No React, no store slice.
- **Timers are owned by the connection and cleared on every terminal path.** Exactly two timers exist while connected: the idle-ping `setInterval` and the (at-most-one) pong-deadline `setTimeout`. Both are cleared in the single teardown routine that runs on `'close'` (whatever the cause). The `handshakeTimeout` is `ws`-owned and needs no manual clear.
- **All `ws` listeners are removed on teardown** (`removeAllListeners()` on the socket, or track and remove each) so a late event after terminal `closed` cannot re-fire `onEvent`. Combined with the `closed` guard, the terminal event is emitted once and only once.
- **Single live socket per handle.** One `createRelayConnection` call = one `ws` instance = one connection. There is no reconnect here, so no risk of stacking sockets; the supervisor (#22) owns "replace, don't stack" when it recreates connections.
- **Teardown determinism.** After `close()` or any terminal cause: timers cleared, listeners removed, `closed` emitted once, subsequent `send()` throws `RelayNotConnectedError`, subsequent `close()` is a no-op. This is the AC-observable contract the tests pin.
- **`AbortController`.** Not needed: `close()`/`terminate()` cancels the in-flight upgrade, and `handshakeTimeout` bounds a hung connect. The Electron `net`-style AbortController threading is a renderer/fetch concern, not a `ws` one.

## Error handling

Failure modes and how each surfaces (all terminal, all via one `closed` event):

| Failure | Surfaces as |
|---|---|
| Upgrade does not complete within `connectTimeoutMs` (AC2) | `ws` `handshakeTimeout` → `'error'` → `'close'` → `{ closed, code: 1006, reason: 'connect-timeout' }`. Never left hanging. |
| Connection refused / DNS / TLS failure | `'error'` → `'close'` → `{ closed, code: 1006, reason: 'connect-error' }`. |
| No pong within `pongTimeoutMs` after a ping (AC3) | pong-deadline → `terminate()` → `{ closed, code: 1006, reason: 'pong-timeout' }`. |
| Inbound frame > `maxFrameBytes` (AC4) | `ws` closes with **1009** and drops the frame → `{ closed, code: 1009, reason: <ws> }`. **No `message` event is emitted for the oversized frame** — no partial oversized payload reaches the consumer. |
| Remote/relay closes the socket | `'close'` → `{ closed, code: <peer>, reason: <peer> }`. |
| `send()` with `readyState !== OPEN` (AC5) | throws `RelayNotConnectedError` synchronously to the caller. |
| Local `close()` | `{ closed, code: 1000, reason: 'client closing' }`. |

- **The module does not catch application errors — it has none to catch.** It forwards opaque bytes; it never parses a frame, so there is no parse-failure path here (that belongs to the codec downstream).
- **The module does not log.** All diagnostics travel as `RelayEvent` data; the consumer (#22) decides whether/how to log (and must not log frame contents or headers — Security §7). Log-free-by-construction is the belt-and-suspenders alternative to a "don't log the headers" rule.
- **A throwing `onEvent` is a caller bug, not defended here.** `onEvent` is a trusted internal sink; per evidence-based-fix, no try/catch is wrapped around it until a real need is observed. Documented as a caller obligation.

## Testing strategy

`npm test` (vitest, node env). **Test-first**: write these RED before the module exists. Tests stand up a real in-process `ws` server on an ephemeral port (`new WebSocketServer({ port: 0 })`, read `.address().port`) — the "content-blind test forwarder" equivalent the Go side used with `httptest`. Assertions in the `emitDaemonEvent.test.ts` style; scenarios as bullets (developer writes the bodies).

**Fake-relay helpers (in the test file):** a `startFakeRelay(behavior)` that returns `{ url, port, close, sockets }`, parameterizable per scenario: **accept+echo**, **refuse** (`verifyClient: () => false`), **never-upgrade** (a bare `http.Server` that holds the socket without responding — for connect-timeout), **oversize** (send a frame larger than the client's `maxFrameBytes`), **go-silent-on-ping** (`new WebSocketServer({ autoPong: false })` and never call `.pong()` — so the client's pong-deadline fires), **drop** (`serverSocket.terminate()` after the client connects). Use short injected intervals via the test-only `timing` parameter and a small `maxFrameBytes`/`connectTimeoutMs` so the suite runs in well under a second.

Scenarios:

- **AC1 — connect + headers.** Client connects to the fake relay with headers `{ 'x-pyrycode-server': 's1', 'x-pyrycode-device-name': 'desk', 'user-agent': 'pyrycode-desktop/0' }`; `onEvent` receives `{ type: 'connected' }`; the fake relay's upgrade handler observes the exact headers passed through unmodified (module added/interpreted none).
- **AC2 — connect timeout.** Point the client at the **never-upgrade** relay with `connectTimeoutMs: 150`; assert `onEvent` receives `{ type: 'closed', code: 1006, reason: 'connect-timeout' }` within ~300 ms and that no `connected` was emitted. (Also: **refuse** relay → a terminal `closed`, never hangs.)
- **AC3 — heartbeat ping fires.** `timing: { idlePingIntervalMs: 40 }`; the accept+echo relay counts received pings (server `'ping'` event); assert ≥ 1 ping within ~150 ms while the connection stays `connected` (default `autoPong` keeps it alive).
- **AC3 — pong timeout closes.** **go-silent-on-ping** relay (`autoPong: false`, no manual pong); `timing: { idlePingIntervalMs: 40, pongTimeoutMs: 60 }`; assert `onEvent` receives `{ type: 'closed', reason: 'pong-timeout' }` within ~200 ms.
- **AC4 — oversize closes, no partial emit.** `maxFrameBytes: 1024`; oversize relay sends a ~2 KB frame; assert `onEvent` receives `{ type: 'closed', code: 1009 }` and that **no `message` event** was delivered (the oversized frame is never emitted — capture all events and assert none is `{ type: 'message' }`).
- **AC5 — inbound raw frame is opaque.** Accept relay sends bytes (e.g. `Uint8Array` of a JSON string and a non-JSON byte blob); assert `onEvent` receives `{ type: 'message', frame }` with `frame` byte-equal to what was sent — no decode, no transform, arbitrary bytes pass through.
- **AC5 — outbound raw frame written as-is.** After `connected`, `handle.send(bytes)` and `handle.send('text')`; the relay asserts it received the exact bytes / text unchanged.
- **AC5 — send with no live connection errors.** Call `handle.send(...)` **before** `connected` (immediately after `createRelayConnection`) and again **after** a terminal `closed`; both throw `RelayNotConnectedError` (not a silent drop, not a hang).
- **Lifecycle — remote drop + teardown.** Accept relay, then `terminate()` the server socket; assert `onEvent` receives exactly one `{ type: 'closed' }`, and a follow-up `close()` emits nothing further (terminal-once) and `send()` throws. Optionally assert no dangling timers keep the process alive (the test completes without a hang / `--forceExit` is not needed).
- **`close()` before connect.** Call `close()` while still `connecting`; assert a single terminal `closed` and no `connected`.

Type-level (`npm run build` / `npm run typecheck`): the five exports resolve; `RelayEvent` is exhaustive on `type`; `send` accepts `string | Uint8Array` only.

## Open questions

1. **Separate `error`/`failed` event vs folding into `closed`.** This spec folds every failure into the terminal `closed { code, reason }`. If #22's supervisor proves it needs to distinguish "never connected" from "dropped after connect" beyond "did I see `connected` first," add a discriminated `code`/`reason` convention or a fourth member then — deferred until a consumer needs it (evidence-based).
2. **Reset-ping-on-activity.** The heartbeat pings unconditionally every 30 s. A refinement that resets the interval on outbound/inbound activity (true "idle" ping) is safe to add later; the relay tolerates either. Deferred as a nicety.
3. **`isBinary` on inbound frames.** Not surfaced — inbound frames are carried as opaque `Uint8Array`, and the v2 wire is UTF-8 JSON which the downstream codec decodes regardless of opcode. If a future frame type needs the text/binary distinction preserved, add it to the `message` member then.
4. **Mid-flight `send` drop.** `send` throws only on `readyState !== OPEN`; a frame handed to `ws.send` on a socket that dies microseconds later is dropped (the async `ws.send` error is not separately surfaced). Acceptable for a single connection with no reissue here; the supervisor/handshake layer (#22 and up) owns reissue-after-reconnect. Revisit if an observed loss motivates surfacing the async send error.
5. **`connectTimeoutMs` default (10 s).** Chosen as a reasonable WS-upgrade deadline; not wire-spec-pinned. Tune if field experience shows the relay's real upgrade latency differs.

## Security review

**Verdict:** PASS

This ticket carries the `security-sensitive` label. The pass below walks `architect/security-review.md` against this module's scope (outbound WSS, semantics-blind byte pipe, no auth/crypto state, no file I/O, no renderer surface).

**Findings:**

- **[Trust boundaries]** No MUST FIX. The single boundary is `ws`'s inbound `'message'` event: bytes leave the library and enter `onEvent` as an **opaque `Uint8Array`**. This module performs **no** parsing, length-prefix assumptions, or Noise/wire interpretation beyond `ws`'s own frame boundaries — it documents (package/JSDoc comment) that it is "generic over frame payload," so a future contributor does not add a "convenience" parser here. The *next* gate (Noise decode → codec → validated wire envelope) is the handshake+codec layer downstream; this spec names it as the enforcer of hostile-daemon defense (out of scope here — see Threat model). The boundary is explicit and single (one `'message'` handler), not scattered.
- **[Tokens, secrets, credentials]** No findings at this layer — the module handles **no tokens**. Caller-supplied `config.headers` may carry the server-id and device-name (device/server identity, intentionally over-the-wire per protocol-mobile.md § client leg); there is **no v2 token header** (the device-token rides inside Noise early-data, out of scope). The module **does not log `config.headers`** — in fact it does not log at all (log-free by construction). Restated as a downstream obligation: the consumer (#22) MUST NOT log the header map either. No RNG, no secret generation, no storage here.
- **[File / storage operations]** N/A — this module performs no filesystem or storage I/O. No `fs`, no path construction, no temp files, no `safeStorage`. Token/key at-rest storage (`safeStorage`, OS keychain) is a separate downstream concern (pairing/#8-class ticket), not this socket's.
- **[Inter-process / Electron attack surface]** No MUST FIX. This module adds **zero** IPC surface: no `contextBridge` API, no `ipcMain` handler, no preload change, no `BrowserWindow`. It runs entirely in the main process and never exposes the socket, timers, or raw bytes to the renderer — satisfying CLAUDE.md/ADR 0002's "keep the transport out of the window" (a finding here would be a MUST FIX; there is none because the renderer cannot reach this module). The pre-existing `sandbox: false` in `src/main/index.ts:17` is **not touched** by #21 and is out of scope (flagged already in #18's review; route to a dedicated hardening ticket — do not expand #21).
- **[Cryptographic primitives]** N/A for hand-rolled crypto — this module contains **none**. No Noise handshake (that lands on top later, and MUST use a vetted Noise_IK library per ADR 0002 — named here only to reserve the boundary). No RNG is used (no jitter here, since there is no backoff — that's #22). **TLS** inherits `ws`'s secure defaults: `rejectUnauthorized` stays `true` (no `InsecureSkipVerify`, no custom verifier), hostname verified against the `wss://` URL host. **No TLS pinning** — deliberate and justified: the future Noise_IK layer provides end-to-end authentication and detects relay impersonation, so pinning here would add rotation pain for no marginal security (protocol-mobile.md § TLS is explicit). Documented in the Context.
- **[Network & I/O]** No MUST FIX — this is the module's core and every knob is set:
  - **Frame size cap.** `maxPayload = maxFrameBytes` (default `1 << 20`, 1 MiB — the relay's per-message cap) is set on the `ws` client. An oversized inbound frame from a hostile relay trips `ws`'s 1009 close and is **never buffered unbounded nor delivered** (AC4). This is the memory-exhaustion mitigation; pinning it explicitly is mandatory and done.
  - **Connect timeout.** `handshakeTimeout = connectTimeoutMs` (default 10 s) bounds a hung upgrade — a slow/hostile relay cannot leave a connect hanging (AC2).
  - **Idle/liveness timeout.** The 30 s ping / 30 s pong heartbeat tears down a dead connection within 60 s (AC3) — a relay that goes silent mid-session does not pin the connection open forever.
  - **TLS.** `wss://` in production (caller-supplied); default verification, no `rejectUnauthorized: false` anywhere. Tests use `ws://` loopback only — the module is scheme-blind by design (it connects to the caller's URL), and production callers always pass `wss://`. **SHOULD FIX (downstream, not this ticket):** relay-URL validation (scheme allowlist `wss://` only, host check, no embedded credentials) belongs at the **pairing/config layer** that produces the URL from the QR payload — this module is deliberately semantics-blind about the URL and trusts its caller. Named so it is not lost; not gated here because #21 has no access to the pairing payload.
  - **Reconnect discipline / backoff.** Out of scope — **#22** owns the reconnect loop with backoff (so a rejected token or dead relay cannot spin into a reconnect/token-exhaustion loop). #21 delivers exactly one connection and then a terminal `closed`; it never itself reconnects, so it introduces no reconnect-storm vector.
  - **Slow-server / dribble resistance.** The heartbeat is the inactivity contract (a relay dribbling below the ping cadence still trips pong-timeout within 60 s). A separate per-message read deadline is intentionally **not** added — it would shadow the heartbeat and produce confusing failure modes when set below `pongTimeoutMs` (same call the Go mirror made when it dropped its unused `ReadTimeout`).
- **[Error messages, logs, telemetry]** No findings, one guardrail. The module **emits no logs** and puts **no caller-controlled or secret data** into event fields: `closed.reason` is a short **static, module-authored** string for self-initiated closes (`'connect-timeout'`/`'pong-timeout'`/`'connect-error'`/`'client closing'`) or the peer's WS reason for remote closes — the raw `err.message` from a `ws` `'error'` (which can embed the URL on a TLS/hostname mismatch) is **not** copied verbatim into the event (spec §Design pins this). Frame bytes (`message.frame`) are the product, carried to the consumer, never logged. Restated obligation for #22: do not log `frame` contents or `config.headers`.
- **[Concurrency]** No MUST FIX. Every long-lived resource has a named owner and a teardown: the idle-ping `setInterval`, the at-most-one pong-deadline `setTimeout`, and the `ws` socket listeners are **all cleared/removed in the single terminal teardown** that runs on `'close'` (any cause), guarded by a `closed`-once flag so the terminal `closed` event fires exactly once and no late `ws` event re-enters `onEvent`. No `AbortController` is needed (`terminate()`/`close()` cancels an in-flight upgrade; `handshakeTimeout` bounds it). **Single live socket** per handle — no stacking, no duplicate connections (reconnect that could stack sockets is #22's concern, and #22 owns "replace, don't stack"). Shutdown mid-connect / mid-send is handled: `close()` is idempotent and safe before `open`; a `send` racing a dying socket either writes or throws/drops but never tears a frame (WS writes a frame atomically). The tests pin terminal-once, timer teardown (no process hang), and post-close `send` throwing.
- **[Threat model alignment]** Walked against ADR 0002 / protocol-mobile.md § Security model, desktop-client scope:
  - **Malicious / compromised relay (on-path, content-blind).** Survived without leaking plaintext or hanging: this layer carries only opaque (soon-to-be-Noise-sealed) bytes, so a relay reading them learns nothing it doesn't already route; drop/close → terminal `closed` (clean teardown); flood/oversize → 1009 close via `maxPayload`; go-silent → pong-timeout within 60 s; slow-upgrade → `handshakeTimeout`. Reorder/delay of *application* frames is a downstream (Noise counter / codec) concern.
  - **Renderer compromise reaching the transport.** Stopped by construction — this module is main-process-only with no IPC/preload/`BrowserWindow` surface; a script-injection or supply-chain bug in the renderer gains **no** path to this socket, its timers, or its raw bytes.
  - **Hostile daemon response** (malformed/oversized data inside the session). Oversize is capped here (`maxPayload`); malformed-content defense is the **codec/Noise layer downstream** (this layer is semantics-blind and forwards opaque bytes) — named as out of scope for #21, owned by the frame-codec ticket.
  - **Token theft from disk.** N/A — this module touches no disk and no token; owned by the pairing/storage (`safeStorage`) ticket.
  - **Out of scope, named:** reconnect/backoff + token-exhaustion-loop resistance → **#22**; Noise_IK handshake + AEAD + nonce discipline → the handshake ticket; relay-URL/QR validation → the pairing/config layer; renderer window hardening (`sandbox: true`) → the #18-flagged hardening ticket.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-03
