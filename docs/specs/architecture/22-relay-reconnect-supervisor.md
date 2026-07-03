# Spec — Reconnect supervisor for the relay connection (#22)

**Size:** S. Two new files (`src/main/transport/relaySupervisor.ts`, `src/main/transport/relaySupervisor.test.ts`), **no new dependency** (`ws` already landed in #21; the supervisor never touches `ws` directly — it injects the #21 connection factory). 5 new exported symbols. ~180 production + ~340 test ≈ ~520 LOC total. **Zero consumer cascade** — greenfield module, no existing call sites (nothing imports `createRelaySupervisor` yet; the composition-root wiring in `src/main/index.ts` is a later ticket, exactly as #21 left `index.ts` untouched). No edit fan-out. Does **not** modify `relayConnection.ts` — it consumes it by import only.

> Scope lock: this ticket wraps the single-shot `createRelayConnection` (#21) in a **supervisor** that recreates the connection after **transient** failures with **capped exponential backoff + jitter**, **resets** the backoff after a stable connection, treats a **fatal** close code as **terminal** (reconnect-storm DoS mitigation), tears down cleanly, and **forwards inbound frames byte-for-byte**. It adds **no** Noise decode, **no** framing interpretation, **no** renderer/IPC/preload surface. The Go mirror is `pyrycode` `docs/knowledge/features/transport-package.md` (`internal/transport`) — this ticket is the **supervision half** (its reconnect loop + jittered backoff + stability reset + `FatalCloseCodes`), sitting on top of #21 which delivered the single-connection half.

## Files to read first

Codegraph is not initialized for this repo (`mcp__codegraph__*` errors here; see auto-memory). This list was built by hand from the #21 transport code, its feature doc, and the Go mirror.

- `src/main/transport/relayConnection.ts:34-116` — **the injected API this supervisor consumes.** `RelayConnectionConfig` (`url` / `headers` / `connectTimeoutMs?` / `maxFrameBytes?` / `onEvent`), the three-member `RelayEvent` union (`connected` / `message` / `closed{code,reason}`), the `RelayConnection` handle (`send` / `close`), and `createRelayConnection(config, timing?)`. **Note lines 198-201:** peer-initiated closes forward the peer's raw `code` — that code is what AC #3 classifies. **Lines 74-80:** `RelayNotConnectedError` — the supervisor **re-uses** this (imports it), it does not define a new error.
- `src/main/transport/relayConnection.test.ts:104-148` — the **`makeSink()` + `waitFor()` + `afterEach` cleanup** helper shape. Mirror this for the supervisor's consumer sink. **Do NOT copy `startRelay`/`startBlackHole`** (lines 25-101): the supervisor tests use an **injected fake connection factory**, never a real `ws` server — there is no socket in this suite.
- `docs/knowledge/features/relay-connection.md` (whole) — the #21 contract and vocabulary. Read § "Internal state machine" and § "Security posture" (the log-free-by-construction rule the supervisor inherits; the "consumer must not log `frame`/`headers`" obligation now lands on **this** module).
- `docs/knowledge/codebase/21.md` — § "Patterns established": **factory + injected `onEvent` DI**, **test-only second `timing` parameter** for non-tunable wire-spec cadence, **terminal-emitted-once guard + single teardown**, **log-free by construction**. The supervisor re-uses all four verbatim.
- `CLAUDE.md` (repo root) — *Keep the transport out of the window*; *No crypto/sockets/tokens in the renderer*; *Sealed event shapes on a `type` discriminant*; *Test-first*; *No new deps without justification* (none needed here).
- `package.json` — confirm `ws` is **already** present (from #21) and that **no new dependency** is required. Gates: `npm test` (vitest, node env), `npm run build` / `npm run typecheck` (the salvage/QA gate).
- `tsconfig.node.json` — confirms `src/main` has **no `@shared` alias** (auto-memory pins this). The supervisor imports only from `./relayConnection` and node/`ws` types via #21 — no shared import, so the point is moot; do not reach for `@shared/*`.
- **Reference (Go mirror, `pyrycode` repo — read via QMD `pyrycode-docs`, not on disk here):** `docs/knowledge/features/transport-package.md`. The proven shape: `FatalCloseCodes` injected config, `Connected()` re-firing on **every** fresh conn, backoff sequence `1s/2s/4s/8s/16s/30s` cap with ±20% jitter, "reset attempt counter after a serve loop lasting ≥60s", and **`math/rand` (non-crypto) jitter**. The wire-spec facts are inlined below so you need not fetch it to implement.
- **Reference (wire spec, `pyrycode` repo — via QMD):** `docs/protocol-mobile.md` § Reconnect and § Error codes. The source of truth for the cadence and the close-code table. **The concrete values are inlined below** (§ Wire-spec facts) — implement against the inlined values; the doc is cited for provenance only.

## Design source

N/A — background-process transport module; no visual surface. The ticket body has no `## Figma` section and the work is not UI-visible (no renderer, preload, or IPC code in this ticket). The visual-fidelity check is intentionally skipped.

## Context

#21 shipped `createRelayConnection` — **one** connection's lifecycle (open, heartbeat, oversize cap, opaque raw frames both ways, one terminal `closed`) — and explicitly **no reconnect**. This ticket is the resilience layer: a supervisor that wraps that primitive so the handshake and message layers above it see a connection that **heals itself** after transient drops instead of dying on the first blip.

The supervisor lives **entirely in `src/main/`** (the Electron background process). Keys, sockets, timers, and raw bytes must not reach the renderer (CLAUDE.md; ADR 0002). It emits a **supervised lifecycle** plus opaque inbound frames through an injected callback the background-process consumer (the future Noise-handshake layer) owns; **nothing here touches IPC, the preload bridge, or the renderer.**

**Why `security-sensitive`:** the fatal-vs-retryable close-code distinction (AC #3) is a **reconnect-storm DoS mitigation**. The Go transport learned this the hard way (`pyrycode` #248/#301): reconnecting on a *permanently-rejected* close (bad token, protocol mismatch, failed handshake) makes a doomed client hammer the relay forever. The mitigation is an injected `FatalCloseCodes` set the reconnect loop consults to decide terminal-vs-retry.

### Wire-spec facts (inlined — do not re-derive)

Source of truth: `pyrycode` `docs/protocol-mobile.md`. The relay implements the symmetric side of each; **do not deviate**.

- **Reconnect cadence** (§ Reconnect): exponential backoff `1s → 2s → 4s → 8s → 16s → 30s` **capped**, with **±20% jitter** on each step; **reset to the first step (1s) after any connection stayed continuously up ≥ 60 s**. Not architect-tunable in production.
- **Jitter is non-cryptographic** (§ per the ticket + Go mirror): `Math.random()` is acceptable; a CSPRNG is **not** required. A hostile relay already controls drop timing, so predictable jitter enables no attack. Jitter is anti-thundering-herd load-spreading only.
- **Close-code table** (§ Error codes) — the desktop connects to the **client leg** (`/v2/client`). Codes it can receive at the WS-close layer, and this supervisor's classification:

  | Code | Meaning | Sent by | Classification (default) | Rationale |
  |---|---|---|---|---|
  | `1000` | Normal closure | peer | **retryable** | relay graceful restart → re-dial when it returns |
  | `1006` | Abnormal closure | (local, from #21) | **retryable** | network drop / connect-error / pong-timeout — the whole point of the supervisor |
  | `1011` | Server error | peer | **retryable** | transient relay error |
  | `4401` | Unauthorized (bad device token) | binary via relay | **FATAL** | retrying the same token is a permanent-reject storm; needs re-pair |
  | `4404` | No server with that server-id | relay | **retryable** | binary temporarily offline; it reconnects within its grace window (§ Security model: "denies service to that one server-id **until the legitimate binary reconnects**") |
  | `4409` | Server-id already claimed | relay **to a binary** | N/A (never on client leg) | **do NOT hardcode** — this is the binary-leg code; the desktop never receives it |
  | `4421` | Protocol mismatch (bad `v`, unknown `type`, malformed) | either | **FATAL** | version incompatibility; the same client fails identically on retry — needs app update |
  | `4426` | Noise handshake failure | either; v2-new | **FATAL** | wrong static key / stale pair record / relay impersonation; retrying fails identically — needs re-pair |

  **Default fatal set: `{ 4401, 4421, 4426 }`.** `4404` is deliberately **retryable** (transient binary-offline is the common case, and the capped 30 s backoff already bounds a permanently-wrong server-id to ~2 dials/min — not a storm). `4409` is deliberately **absent** (binary-leg only). The set is **injected config** with this wire-spec default, mirroring the Go `FatalCloseCodes`.

- **The supervisor is URL/header-blind, like #21.** It does not construct or validate the relay URL or the `x-pyrycode-*` headers — the caller supplies the `connection` params verbatim. (Endpoint-path cosmetics — `/v1/client` vs `/v2/client` in the two doc copies — are content-blind routing and immaterial here.)

## Design

### Dependency

**None new.** `ws` already landed with #21 and lives inside `createRelayConnection`; the supervisor never imports `ws`. Its only imports are from `./relayConnection` (`createRelayConnection`, `RelayConnectionConfig`, `RelayConnection`, `RelayEvent`, `RelayNotConnectedError`).

### Module layout

| File | Status | Purpose |
|---|---|---|
| `src/main/transport/relaySupervisor.ts` | **new** | `createRelaySupervisor` + its config / handle / event types + `DEFAULT_FATAL_CLOSE_CODES`. No `ws`, no `electron`, no renderer import. |
| `src/main/transport/relaySupervisor.test.ts` | **new** | unit tests against an **injected fake connection factory** + an **injected fake scheduler** (no real `ws`, no real timers). Helpers live in-file (keeps the count at 2). |

Joins the `src/main/transport/` directory established by #21. `relayConnection.ts` is **read-only** for this ticket.

### Public surface (contracts, not implementations)

Five exported symbols. Test-only cadence/scheduling/random overrides ride a second `timing` parameter (an inline, non-exported type — the #21 precedent), so a production caller passing one argument gets the wire-spec cadence locked by construction.

```ts
/** A supervised lifecycle event. Sealed discriminated union on `type`. Distinct from #21's
 *  RelayEvent: here `closed` transient drops are ABSORBED (re-dialled), and the only terminal
 *  member is `terminal` — a fatal close code (AC #3) or a clean stop (AC #4). */
export type RelaySupervisorEvent =
  | { type: 'connected' }                              // a fresh underlying connection is live —
                                                       //   re-emitted on EVERY (re)connect; the
                                                       //   consumer re-handshakes here (no v2 session resume)
  | { type: 'message'; frame: Uint8Array }             // one OPAQUE inbound frame, forwarded byte-for-byte
  | { type: 'terminal'; code: number; reason: string } // supervision ended, once: fatal code OR stop()

/** Caller-supplied configuration. */
export interface RelaySupervisorConfig {
  /** The #21 connection params, minus onEvent (the supervisor owns onEvent to route classification). */
  connection: Omit<RelayConnectionConfig, 'onEvent'>
  /** The supervised consumer sink (DI at the composition root; testable with a vi.fn()). */
  onEvent: (event: RelaySupervisorEvent) => void
  /** WS close codes that halt supervision as terminal. Default DEFAULT_FATAL_CLOSE_CODES. */
  fatalCloseCodes?: ReadonlySet<number>
  /** Injected connection factory. Default createRelayConnection. Tests pass a fake. */
  createConnection?: (config: RelayConnectionConfig) => RelayConnection
}

/** Handle for the supervised connection. */
export interface RelaySupervisor {
  /** Delegate to the current live connection. Throws RelayNotConnectedError when none is live
   *  (before first connect, during a backoff gap, or after terminal). No buffering. */
  send(frame: string | Uint8Array): void
  /** Idempotent teardown (AC #4): stop reconnecting, cancel the pending backoff timer, release
   *  the underlying connection, emit one terminal { code: 1000, reason: 'stopped' }. No dangling timers. */
  stop(): void
}

/** Wire-spec default fatal close codes for the /v2/client leg: bad-token, protocol-mismatch,
 *  handshake-failure. Excludes 4409 (binary-leg) and 4404 (transient binary-offline). */
export const DEFAULT_FATAL_CLOSE_CODES: ReadonlySet<number> // = new Set([4401, 4421, 4426])

export function createRelaySupervisor(
  config: RelaySupervisorConfig,
  timing?: {                       // TEST-ONLY — production callers pass one arg, locking wire-spec cadence
    baseDelayMs?: number           // default 1_000
    maxDelayMs?: number            // default 30_000
    stableUptimeMs?: number        // default 60_000
    jitterRatio?: number           // default 0.2
    setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
    clearTimer?: (handle: ReturnType<typeof setTimeout>) => void
    random?: () => number          // default Math.random — non-crypto jitter source
  }
): RelaySupervisor
```

Design rationale (the calls the ticket delegates):

- **`RelaySupervisorEvent` is a distinct type, not a re-used `RelayEvent`, and its terminal member is named `terminal`, not `closed`.** The semantic shift is load-bearing and exactly the bug class this ticket guards against: mistaking a transient drop for terminal death (false death) or vice-versa (reconnect storm). Distinct names make the contract self-documenting — `connected` re-fires per reconnect (consumer re-handshakes), `message` forwards opaque bytes, `terminal` fires **once** at the end. A transient drop emits **nothing** (absorbed + re-dialled) — precisely AC #5's "never surfaced as terminal death."
- **`connection: Omit<RelayConnectionConfig, 'onEvent'>` + supervisor-owned `onEvent`.** The supervisor must route each connection's events through classification, so it owns the sink and takes only the connection *params* (url/headers/timeouts) from the caller. This is the clean DI seam and keeps the wire-spec heartbeat locked: the supervisor calls `createConnection(connConfig)` with **one** argument, never passing #21's test-only `timing` in production.
- **Injected `createConnection` factory (default `createRelayConnection`).** The supervisor is tested against a fake connection, never the socket-level fake relay — matching the ticket's "fake connection factory." The default is the real factory.
- **Injected scheduler (`setTimer`/`clearTimer`) + `random`, on the test-only param.** Backoff and the stability reset are the whole behaviour under test; injecting the scheduler lets tests **capture the exact scheduled delay** (assert the `1s/2s/4s…` sequence and the ±20% bounds precisely) and **fire timers deterministically** — no real wall-clock waits (the ticket's explicit requirement). `random` injection pins jitter (`0.5`→no jitter→exact steps; `0`→−20%; `~1`→+~20%). This is the #21 test-only-`timing` precedent, extended.
- **`send` delegates and throws `RelayNotConnectedError` (re-used from #21), no buffering.** A supervised connection you cannot send through is not a transport; the future handshake layer sends `noise_init` on each `connected`. Delegation is ~4 lines; when no connection is live (backoff gap) it throws, and the consumer waits for the next `connected`. Buffering-across-reconnect is deferred (Open questions) — evidence-based.
- **`stop()` emits a terminal `{1000,'stopped'}` once.** Uniform "supervision is over" invariant, whether the end is a fatal code or a clean stop; distinguishable by `code` (`1000` vs `44xx`). Mirrors #21's `close()`-emits-`closed` shape.

### Reconnect state machine (internal)

Module-private state: `attempt` (backoff step, 0-based, index of the **next** retry), `stopped`, `terminalEmitted` (once-guard), `current: RelayConnection | null`, `backoffTimer`, `stabilityTimer`. At most **one** supervisor-owned timer exists at any instant — `stabilityTimer` only while connected, `backoffTimer` only while in a backoff gap; they are mutually exclusive in time (the connection owns its own connect/heartbeat timers during CONNECTING).

| Trigger | Action |
|---|---|
| create | dial immediately (no initial backoff — first attempt is instant). |
| dial | if `stopped` return; else `current = createConnection({ ...connection, onEvent: onConnEvent })`. |
| conn `connected` | forward `{ type: 'connected' }`; arm `stabilityTimer = setTimer(stableUptimeMs, onStable)`. |
| conn `message` | forward `{ type: 'message', frame }` — same `Uint8Array` reference, no copy. |
| conn `closed{code,reason}` | clear `stabilityTimer`; `current = null`. If `fatalCloseCodes.has(code)` → **terminal**: `emitTerminal(code, reason)`. Else → **retryable**: `backoffTimer = setTimer(jitteredDelay(attempt), dial)`; then `attempt++`. |
| `onStable` (≥60 s up) | `attempt = 0`; `stabilityTimer = null`. (Reset only — no emit, no dial.) |
| `stop()` | `emitTerminal(1000, 'stopped')`. |
| `send(frame)` | `if (!current) throw RelayNotConnectedError`; else `current.send(frame)` (which itself throws if the socket is not OPEN — e.g. still CONNECTING). |

`emitTerminal(code, reason)`: guarded by `terminalEmitted` (once); sets `stopped = true`; clears `backoffTimer` + `stabilityTimer`; if `current` is non-null, capture it, null the field, and call `.close()` to release the underlying connection (its later `closed` callback sees `stopped` → ignored, and the once-guard blocks a second terminal); forward `{ type: 'terminal', code, reason }` once. On the fatal path `current` was already nulled in the `closed` handler, so no double-close. On `stop()` during a backoff gap `current` is already null — only the pending `backoffTimer` is cleared. **After terminal, no timers remain and no further events are forwarded** (AC #4).

`jitteredDelay(n)`: `base = min(baseDelayMs * 2**n, maxDelayMs)`; `factor = 1 + (random()*2 - 1) * jitterRatio` (⇒ `factor ∈ [1-jitterRatio, 1+jitterRatio)` = `[0.8, 1.2)`); return `base * factor`. Sequence of the un-jittered `base` for `n = 0…6`: `1000, 2000, 4000, 8000, 16000, 30000, 30000` (the `min` caps `32000`→`30000` from `n = 5`), matching AC #1.

The single classification check (`fatalCloseCodes.has(code)`) is **strictly less code, not more** — the whole terminal-vs-retry decision is one set-membership test on the code #21 already emits, at this layer (per the Go #301 lesson: "reconnect storms come from layer confusion; the fix is less code"). No per-code branch, no state duplication.

### Data flow

```
 consumer (future Noise layer)     createRelaySupervisor            createRelayConnection (#21)
   config{connection,onEvent} ───►  dial() ── createConnection ────► new #21 connection (its own ws)
   handle.send(frame) ────────────► current.send(frame) [live only]
                                     conn onEvent{connected} ─► forward {connected}; arm stability
                                     conn onEvent{message}  ─► forward {message, frame}   (opaque)
                                     conn onEvent{closed,code} ─► fatal? {terminal} : backoff→dial
   handle.stop() ─────────────────► emitTerminal(1000,'stopped'); clear timers; current.close()
```

Nothing in this flow reaches IPC, the preload, or the renderer. Frames are opaque both ways: no member of `RelaySupervisorEvent` and no argument of `send` is parsed, decoded, or validated as a Noise/wire structure here.

## State + concurrency model

- **No Zustand store, no async iterables.** Main-process transport, not renderer state. Lifecycle is `onEvent` callbacks + two imperative methods (`send`/`stop`). No React.
- **Timer ownership + teardown.** Exactly one supervisor timer at a time (`stabilityTimer` XOR `backoffTimer`), each cleared on the transition out of its phase and unconditionally in `emitTerminal`. The underlying connection owns its own connect/heartbeat timers and clears them in its own teardown (#21) when the supervisor calls `.close()` or when it self-terminates. **After terminal (stop or fatal): every supervisor timer is cleared and the underlying connection is released — no dangling timers keep the process alive** (AC #4; a test asserts the suite exits without a hang / `--forceExit`).
- **Single live connection — "replace, don't stack."** One `current` at a time. A reconnect only fires from a `backoffTimer` after the previous connection emitted its terminal `closed` and `current` was nulled — the supervisor never holds two connections. This is the invariant #21 deferred to #22.
- **Re-entrancy / late events.** `onConnEvent` early-returns when `stopped`, and `terminalEmitted` guards the terminal emit, so a late `closed` from a connection the supervisor asked to `.close()` during `stop()` cannot produce a second terminal or a reconnect. `#21`'s `close()` emits its `closed` asynchronously, so by the time it fires the supervisor is already `stopped`.
- **No `AbortController`.** Teardown is `stop()` → clear timers + `current.close()`; #21's `close()` cancels an in-flight upgrade. Consistent with #21's decision.

## Error handling

Every failure surfaces through the supervised lifecycle — the supervisor **absorbs** transient failure (re-dial) and **surfaces** only the terminal end.

| Failure of the underlying connection | Supervisor response |
|---|---|
| Connect failure (never `connected`; #21 `closed` 1006, no prior `connected`) | retryable → schedule `backoffTimer(jitteredDelay(attempt))`, `attempt++`. `attempt` is not reset (never stable). |
| Mid-session drop (`closed` 1006/1011/peer-1000, was `connected`) | retryable → backoff as above; `attempt` reset to 0 **iff** the connection had been up ≥ `stableUptimeMs` (its `stabilityTimer` fired). |
| `closed` with `code ∈ fatalCloseCodes` (default 4401/4421/4426) | **terminal** → `emitTerminal(code, reason)`; **no reconnect**, no backoff scheduled (AC #3). |
| Oversize (#21 normalises to `closed` 1009) | retryable (1009 ∉ fatal set) → backoff. A hostile relay flooding oversize frames is re-dialled, still capped by #21's `maxFrameBytes`. |
| `send` while no connection is live (backoff gap, pre-connect, post-terminal) | throws `RelayNotConnectedError` synchronously (AC-observable; consumer waits for next `connected`). |
| `stop()` / abort | `emitTerminal(1000,'stopped')`; timers cleared; underlying connection released (AC #4). |

- **The module does not log** (log-free by construction, inherited from #21). Frames carry payload and `connection.headers` carry identity — a stray `console.*` would leak either to main-process stdout. All diagnostics ride `RelaySupervisorEvent` data; the consumer decides logging and MUST NOT log `frame` contents or `connection.headers`.
- **`terminal.reason` carries only safe strings**: the peer's WS reason for a fatal peer close (already static per #21's `pending` discipline — #21 never copies `err.message` verbatim) or the module-authored `'stopped'`. No `err.message`, no header, no URL is placed in an event field.
- **A throwing consumer `onEvent` is a caller bug, not defended** — trusted internal sink, per evidence-based-fix (matches #21).

## Testing strategy

`npm test` (vitest, node env). **Test-first**: write these RED before the module exists. **No real `ws`, no real timers** — drive an **injected fake connection factory** and an **injected fake scheduler**. Mirror the `makeSink`/`waitFor` helper shape from `relayConnection.test.ts:104-148` for the consumer sink; assertions in the `emitDaemonEvent.test.ts` / `relayConnection.test.ts` style.

**In-file helpers:**
- `fakeConnectionFactory()` → a `createConnection` fn that, per call, records the passed `RelayConnectionConfig` and returns a fake `RelayConnection` exposing `emit(event)` (drive `connected`/`message`/`closed` into the captured `onEvent`), `sent: unknown[]` (records `send`), and `closed: boolean` (records `close`). Also exposes the list of connections created (for reconnect-count / no-stacking assertions).
- `fakeScheduler()` → `{ setTimer, clearTimer, pending(), fireNext(), fireAll() }` recording `{ fn, ms, cancelled }` entries so a test can assert the exact `ms` scheduled and fire it synchronously.
- A `random` stub (`() => 0.5` for no-jitter exact steps; `() => 0` / `() => 0.999` for the bounds).

Scenarios (developer writes the bodies):

- **AC #1 — backoff sequence.** `random: () => 0.5`; drive repeated connect-failures (`emit closed 1006`, no prior `connected`) firing each scheduled timer; assert the captured `ms` sequence over 7 failures is `[1000, 2000, 4000, 8000, 16000, 30000, 30000]`, and a **new** fake connection is created after each `fireNext()`.
- **AC #1 — jitter bounds.** With `random: () => 0` assert the scheduled delay = `0.8 × base`; with `random: () => 0.999` assert ≈ `1.2 × base`; across the sequence assert every scheduled `ms ∈ [0.8 × base, 1.2 × base)`.
- **AC #2 — reset after ≥60 s up.** Fail a few times (attempt climbs), then dial succeeds (`emit connected`), `fireNext()` the stability timer, then `emit closed 1006`; assert the next scheduled backoff delay is `~1000` (attempt reset to first step).
- **AC #2 — no reset under 60 s.** `emit connected` then `emit closed 1006` **without** firing the stability timer; assert the next backoff delay **continues** the sequence (not reset to `1000`), and assert the stability timer entry is marked `cancelled`.
- **AC #3 — fatal code ⇒ terminal, no reconnect.** For each of `4401`, `4421`, `4426`: `emit closed <code>`; assert the consumer received `{ type: 'terminal', code: <code>, reason }`, **no** new connection was created, **no** backoff timer was scheduled, and a subsequent `emit` on the dead connection is ignored (no second terminal).
- **AC #3 — non-fatal ⇒ reconnect.** For `4404`, `1011`, `1006`, peer-`1000`: assert a backoff timer **is** scheduled (retryable), no `terminal`.
- **AC #3 — configurable set.** Pass `fatalCloseCodes: new Set([4404])`; assert `4404` is now terminal and `4401` is now retryable — proves the set is injected, not hardcoded. Also assert `DEFAULT_FATAL_CLOSE_CODES` equals `{4401,4421,4426}` and excludes `4409`/`4404`.
- **AC #4 — stop during backoff gap.** After a drop schedules a backoff timer, call `stop()`; assert the pending timer is `cancelled`, no further connection is created on `fireAll()`, exactly one `{ type: 'terminal', code: 1000, reason: 'stopped' }` is emitted, and no timers remain pending.
- **AC #4 — stop while connected.** After `connected`, `stop()`; assert the current fake connection's `close()` was called, the stability timer is `cancelled`, one terminal emitted, and the connection's subsequent `closed` produces **neither** a second terminal **nor** a reconnect.
- **AC #4 — stop idempotent.** Two `stop()` calls ⇒ exactly one terminal.
- **AC #5 — frames byte-for-byte.** After `connected`, `emit message` with arbitrary bytes (JSON bytes, then `[0x00,0x01,0xff,0x7f,0x80]`); assert the consumer's `message.frame` is byte-equal and in order (`Array.from` equality, same reference).
- **AC #5 — transient drop absorbed then re-connects.** `connected` → `closed 1006` → `fireNext()` (backoff) → new connection → `connected`; assert the consumer saw `connected` **twice** and **no** `terminal` for the transient drop (absorb-and-redial), and that only one connection is live at a time (no stacking).
- **send delegation + guard.** After `connected`, `handle.send(bytes)` lands in the current fake's `sent`; before first connect and during a backoff gap, `handle.send(...)` throws `RelayNotConnectedError`.
- **immediate first dial.** On `createRelaySupervisor`, a connection is created **without** any timer first firing (no initial backoff).

Type-level (`npm run build` / `npm run typecheck`): the 5 exports resolve; `RelaySupervisorEvent` is exhaustive on `type`; `fatalCloseCodes` is `ReadonlySet<number>`; `createConnection` is assignable from `createRelayConnection` (extra optional `timing` arg is structurally compatible).

## Open questions

1. **Non-terminal `disconnected` / `reconnecting` edge.** This spec absorbs transient drops silently (surfacing only `connected` on re-dial and `terminal` at the end) — sufficient for the ACs and the Noise consumer (re-handshake on each `connected`; discover a gap via `send` throwing). When the desktop UI needs a visible "reconnecting…" state, add a `{ type: 'disconnected' }` member then — deferred, evidence-based, mirroring #21's deferred `error` member.
2. **`4404` classification.** Kept **retryable** (transient binary-offline is the common case; capped backoff bounds a wrong-server-id to ~2 dials/min). If field data shows a bad-pair-record `4404` storm, promote it to the fatal set — it is already injectable config, no code change to the supervisor.
3. **Send buffering across reconnect.** `send` throws during a backoff gap; frames are not queued for the next connection. Acceptable — the v2 protocol has **no session resumption** (each reconnect is a fresh Noise handshake from `noise_init`), so the handshake layer re-establishes and re-sends. Revisit only if an observed loss motivates a bounded outbound queue.
4. **Stability reset: timer vs. duration.** This spec resets via a `stabilityTimer` armed on `connected` (fires at ≥60 s while up). The Go mirror measures serve-loop duration at drop time; the two are observably equivalent for the ACs. The timer approach reuses the single injected-scheduler seam (no separate clock injection) and directly models "stayed continuously up ≥ threshold." Either is acceptable if the developer finds the duration form cleaner.
5. **`jitteredDelay` rounding.** `setTimeout` accepts fractional ms; rounding is cosmetic. `Math.round` is fine if preferred — assert bounds, not exact floats.

## Security review

**Verdict:** PASS

This ticket carries the `security-sensitive` label. The pass below walks the standard categories (as applied and passed in the #21 spec) against this module's scope: a **reconnect supervisor** over an outbound WSS connection, no auth/crypto state, no file I/O, no renderer surface, whose defining security property is the **fatal-vs-retryable close classification** (reconnect-storm DoS mitigation).

**Findings:**

- **[Trust boundaries]** No MUST FIX. The single inbound boundary is the injected connection's `onEvent`: `connected` / `message` / `closed{code}`. The supervisor performs **no** parsing of `message.frame` (forwarded byte-for-byte as an opaque `Uint8Array`) and interprets the `closed` **code only** as an opaque integer for set-membership — it does not act on `reason` beyond forwarding it. The Noise decode / codec gate is the layer above (out of scope). Boundary is single and explicit (one `onConnEvent`), not scattered.
- **[Tokens, secrets, credentials]** No findings at this layer — the module handles **no tokens**. `connection.headers` (server-id, device-name, user-agent — device/server identity, intentionally over-the-wire per protocol-mobile.md § client leg) pass through into the injected connection **verbatim and unlogged**; there is no v2 token header (the device-token rides inside Noise early-data, out of scope). The module is **log-free by construction** (inherited from #21) — no `console.*` anywhere; restated obligation for the consumer: do **not** log `frame` contents or `connection.headers`. No RNG for secrets; the only RNG is `Math.random()` for jitter — **explicitly non-security** per the ticket and the Go mirror ("a hostile relay already controls drop timing; predictable jitter enables no attack"). Using a CSPRNG here would be cargo-cult.
- **[File / storage operations]** N/A — no filesystem or storage I/O. No `fs`, no path construction, no `safeStorage`. Token/key at-rest storage is a separate downstream (pairing) concern.
- **[Inter-process / Electron attack surface]** No MUST FIX. **Zero** IPC surface: no `contextBridge`, no `ipcMain`, no preload change, no `BrowserWindow`. Runs entirely in the main process; the socket, timers, and raw bytes are never exposed to the renderer (CLAUDE.md / ADR 0002). A renderer compromise gains no path to this supervisor. The pre-existing `sandbox: false` in `src/main/index.ts` is **not touched** (out of scope; route to the standing hardening ticket).
- **[Cryptographic primitives]** N/A for hand-rolled crypto — none here. No Noise handshake (the layer above; MUST use a vetted Noise_IK library per ADR 0002). TLS is inherited from the injected #21 connection (`ws` secure defaults, `rejectUnauthorized: true`, no pinning — deliberate, Noise provides E2E auth). The supervisor adds no TLS surface of its own.
- **[Network & I/O]** **This is the module's core, and the DoS knobs are the point of AC #3:**
  - **Reconnect-storm mitigation (the reason for the label).** A `closed` code in `fatalCloseCodes` (default `4401`/`4421`/`4426`) is **terminal** — the supervisor stops, does **not** reconnect, and surfaces `{ type: 'terminal' }`. This prevents a permanently-rejected client (bad token, protocol mismatch, failed handshake) from hammering the relay in a tight loop — the exact `pyrycode` #248/#301 failure mode, ported. The set is injected config with a wire-spec default and is **not** blindly-reconnect-on-every-close.
  - **`4409` is deliberately excluded** from the default (binary-leg code; the client never receives it) — hardcoding it, as the ticket warns against, would misclassify.
  - **Backoff is capped (30 s) with jitter**, so even the retryable path (including a permanently-`4404` wrong server-id) is bounded to ~2 dials/min per client, not a spin loop. Jitter spreads reconnect load across many clients (anti-thundering-herd) after a relay restart.
  - **Frame-size / connect / liveness caps** are enforced by the injected #21 connection (`maxFrameBytes` 1 MiB, `connectTimeoutMs`, 30 s/30 s heartbeat) — the supervisor re-dials on their terminal `closed` but does not weaken them (it passes `connection` params through and never overrides the wire-spec heartbeat).
  - **No unbounded resource growth.** Single live connection at a time ("replace, don't stack"); at most one supervisor timer at a time; both released on terminal. No connection stacking, no timer leak (AC #4 pins this).
- **[Error messages, logs, telemetry]** No findings, one guardrail. Log-free by construction (above). `terminal.reason` is a module-authored static string (`'stopped'`) or the peer's already-static WS reason (#21 never copies `err.message`); no caller-controlled or secret data enters an event field.
- **[Concurrency]** No MUST FIX. Every long-lived resource has a named owner and teardown: `stabilityTimer` / `backoffTimer` (mutually exclusive, cleared on phase-exit and unconditionally in `emitTerminal`), and the `current` connection (released via `.close()` on terminal). A `terminalEmitted` once-guard + a `stopped` early-return in `onConnEvent` make the terminal event fire exactly once and forbid a late connection event (from a `.close()` during `stop()`) from re-entering as a reconnect or a second terminal. Single live connection — no stacking, no duplicate sockets. Shutdown mid-connect / mid-backoff / mid-send is handled (stop is idempotent, safe before first connect, safe during a backoff gap).
- **[Threat model alignment]** Walked against ADR 0002 / protocol-mobile.md § Security model, desktop-client scope:
  - **Malicious / compromised relay (on-path, content-blind).** Cannot pin the client open or provoke a storm: transient drop/close → bounded jittered re-dial; a **terminal** close code (`4401`/`4421`/`4426`) halts supervision (no storm); oversize/flood is capped and re-dialled by #21's `maxFrameBytes`; go-silent is torn down by #21's heartbeat within 60 s. A relay that spoofs a fatal code only causes the desktop to **stop** (fail-closed, safe) — not to leak or loop.
  - **Reconnect-storm DoS (the labelled surface).** Closed by AC #3's fatal set + capped backoff, as above.
  - **Renderer compromise reaching the transport.** Stopped by construction — main-process-only, zero IPC/preload/`BrowserWindow` surface.
  - **Hostile daemon response** (malformed/oversized content inside the session). Malformed-content defense is the codec/Noise layer downstream (this layer forwards opaque bytes); oversize is capped by #21. Named as out of scope, owned by the codec ticket.
  - **Out of scope, named:** Noise_IK handshake + AEAD + nonce discipline → the handshake ticket; relay-URL/QR validation → the pairing/config layer; renderer window hardening (`sandbox: true`) → the standing hardening ticket.

**Reviewer:** architect (self-review)
**Date:** 2026-07-03
