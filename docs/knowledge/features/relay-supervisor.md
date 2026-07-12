# Relay supervisor

The **resilience layer** over the single-shot [relay connection](relay-connection.md): a supervisor that wraps `createRelayConnection` so the handshake and message layers above see a connection that **heals itself** after transient network drops instead of dying on the first blip. Lives entirely in the Electron **background process**.

Introduced in [#22](../codebase/22.md). It re-dials after a **retryable** disconnect with **capped exponential backoff + ±20% jitter**, **resets** the backoff once a connection has stayed continuously up beyond a stable-uptime threshold, treats a **fatal** close code as **terminal** (the reconnect-storm DoS mitigation), tears down cleanly with no dangling timers, and **forwards inbound frames byte-for-byte**. It is the **supervision half** of the pyrycode Go binary's `internal/transport` shape (its reconnect loop + jittered backoff + stability reset + `FatalCloseCodes`); [#21](../codebase/21.md) delivered the single-connection half. See the Go mirror `pyrycode` `docs/knowledge/features/transport-package.md`.

## What it does

Gives the background process **one function** — `createRelaySupervisor(config)` — that supervises a relay connection for its whole lifetime, spanning any number of underlying `createRelayConnection` instances. It returns a handle with `send` and `stop`; the supervised lifecycle and inbound frames leave through an injected `onEvent` callback the consumer (the future Noise-handshake layer) owns.

- **A transient drop is absorbed, and — since [#328](../codebase/328.md) — also surfaced.** After a retryable close the supervisor re-dials silently (the consumer sees a fresh `connected` when the new leg is live, never a terminal death for the blip, [AC #5](https://github.com/pyrycode/pyrycode-desktop/issues/22)) **and** emits `{ type: 'relay-closed', code }` so a higher layer can drive a relay-leg status indicator — the drop stays absorbed either way; `relay-closed` is not a terminal member.
- **A fatal close is terminal.** A close code in the injected fatal set stops supervision for good and surfaces one `terminal` event — no reconnect.
- **Nothing reaches the renderer.** Keys, sockets, timers, and raw bytes stay in the background process; a compromised renderer has **no path** to the supervisor ([ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md); CLAUDE.md "Keep the transport out of the window"). Zero IPC / preload / `BrowserWindow` surface.
- **It is semantics-blind and log-free**, inheriting both from #21. It never parses a frame (forwarded as opaque `Uint8Array`), interprets a close `code` only as an opaque integer for set-membership, and has no `console.*` anywhere — a stray log would leak `frame` payload or `connection.headers` identity to main-process stdout.

## How it works

One file, five exported symbols: `src/main/transport/relaySupervisor.ts`, sibling to `relayConnection.ts` in the `src/main/transport/` directory #21 established. It imports only from `./relayConnection` (`createRelayConnection`, its config/handle/event types, and `RelayNotConnectedError` — **re-used**, not redefined). No `ws`, no `electron`, no renderer import.

### Public surface

```ts
export const DEFAULT_FATAL_CLOSE_CODES: ReadonlySet<number>  // = new Set([4401, 4421, 4426])
export const NO_PAIRED_RECORD_CLOSE_CODE = 4000  // #83: synthetic, client-side, NEVER sent on the wire

export type RelaySupervisorEvent =
  | { type: 'connected' }                              // a fresh underlying connection is live —
                                                       //   re-emitted on EVERY (re)connect
  | { type: 'message'; frame: Uint8Array }             // one OPAQUE inbound frame, byte-for-byte
  | { type: 'relay-closed'; code: number }             // RETRYABLE close, supervision CONTINUES (#328)
  | { type: 'terminal'; code: number; reason: string } // supervision ended, once: fatal code OR stop() OR no-record (#83)

export interface RelaySupervisorConfig {
  connection: Omit<RelayConnectionConfig, 'onEvent'>   // #21 params minus onEvent; the FIRST dial + no-provider fallback
  onEvent: (event: RelaySupervisorEvent) => void       // the background-process consumer sink
  fatalCloseCodes?: ReadonlySet<number>                // default DEFAULT_FATAL_CLOSE_CODES
  resolveConnection?: () => Promise<Omit<RelayConnectionConfig, 'onEvent'> | null>  // #83: re-source per AUTOMATIC re-dial
  createConnection?: (config: RelayConnectionConfig) => RelayConnection  // default createRelayConnection
}

export interface RelaySupervisor {
  send(frame: string | Uint8Array): void  // delegate to the live connection; throws if none is live
  stop(): void                            // idempotent teardown; emits one terminal { 1000, 'stopped' }
}

export function createRelaySupervisor(
  config: RelaySupervisorConfig,
  timing?: { baseDelayMs?; maxDelayMs?; stableUptimeMs?; jitterRatio?; setTimer?; clearTimer?; random? }  // TEST-ONLY
): RelaySupervisor
```

- **`RelaySupervisorEvent` is a distinct type, not a re-used `RelayEvent`, and its terminal member is named `terminal`, not `closed`.** The semantic shift is the whole point of this layer and exactly the bug class it guards against: mistaking a transient drop for terminal death (false death) or a fatal close for a retryable one (reconnect storm). `connected` re-fires per reconnect (the consumer **re-handshakes** — v2 has no session resume), `message` forwards opaque bytes, `terminal` fires **once** at the end. A transient drop is absorbed (re-dialled) and — since [#328](../codebase/328.md) — also emits `relay-closed{code}`, a non-terminal signal distinct from `terminal`.
- **`connection: Omit<RelayConnectionConfig, 'onEvent'>` + supervisor-owned `onEvent`.** The supervisor must route each connection's events through classification, so it owns the sink and takes only the connection *params* (url/headers/timeouts) from the caller. It calls `createConnection(connConfig)` with **one** argument — never passing #21's test-only `timing` in production, keeping the wire-spec heartbeat locked.
- **`resolveConnection?` + `NO_PAIRED_RECORD_CLOSE_CODE` ([#83](../codebase/83.md)).** An optional per-dial connection **provider**. When set, every *automatic* re-dial re-sources the connection through it instead of reusing the construction-time `connection` snapshot, so a re-pair mid-session dials the fresh relay/server/token; the **first** dial always uses `connection` (no reason to reload microseconds after the consumer already loaded it). A resolved `null` means no stored record → supervision ends with the synthetic `NO_PAIRED_RECORD_CLOSE_CODE = 4000` (a **client-side** sentinel in the WebSocket private-use range, **never sent on the wire**), so the consumer surfaces a non-connected event instead of spinning re-dials at a phantom server. Absent → the snapshot is reused on every dial (unchanged pre-#83 behaviour). It is a **store-agnostic async function, never the store** — the supervisor stays IPC-free; the [driver](noise-relay-driver.md) supplies it as a wrapper over `daemonConnection`'s `loadDialConfig`.
- **`send` delegates and throws `RelayNotConnectedError` (re-used from #21), no buffering.** When no connection is live (before first connect, during a backoff gap, after terminal) it throws; the consumer waits for the next `connected`. v2 re-handshakes and re-sends from the layer above, so buffering-across-reconnect is deferred.
- **`stop()` emits a terminal `{1000, 'stopped'}` once.** A uniform "supervision is over" invariant whether the end is a fatal code or a clean stop, distinguishable by `code` (`1000` vs `44xx`). Mirrors #21's `close()`-emits-`closed` shape.
- **Test-only `timing` second parameter.** The wire-spec cadence/scheduler/jitter overrides ride a second parameter (the #21 belt-and-suspenders precedent), so a production caller passing one argument cannot reach the non-tunable cadence through the typed public config.

### Reconnect state machine

Module-private state: `attempt` (0-based index of the **next** backoff step), `stopped`, `terminalEmitted` (once-guard), `current: RelayConnection | null`, `backoffTimer`, `stabilityTimer`, and — since [#83](../codebase/83.md) — `firstDial` (a single-writer gate, flipped false once, that keeps the first dial on the construction-time `connection`). At most **one** supervisor-owned timer exists at any instant — `stabilityTimer` only while connected, `backoffTimer` only in a backoff gap; they are **mutually exclusive in time**. (The underlying connection owns its own connect/heartbeat timers while CONNECTING.)

**`dial()` is `async` since #83** — but only the provider-driven automatic re-dial actually `await`s (`resolveConnection()`); the first dial and the whole no-provider path stay synchronous (no `await` reached), so the construction-time `void dial()` still creates the connection before returning. The one added race — a `stop()` racing an in-flight reload during the (connection-less) backoff gap — is fenced by the single post-`await` `stopped` re-check: `stop()`'s `emitTerminal` sets `stopped` and clears timers, so the check aborts the dial. No new timers, listeners, or sockets.

| Trigger | Action |
|---|---|
| create | dial immediately — **no initial backoff**, the first attempt is instant (the first dial takes the synchronous `connection` path, so `current` exists before the constructor returns; the promise is `void`ed). |
| dial | `backoffTimer = null`; if `stopped` return. **First dial or no provider** → `conn = config.connection`; flip `firstDial = false` (synchronous, no `await` reached — preserves "dials immediately" + every existing re-dial test). **Automatic re-dial with a provider** ([#83](../codebase/83.md)) → `const resolved = await resolveConnection()`; then **re-check `stopped`** (a `stop()` raced the reload during the connection-less backoff gap — abort); if `resolved === null` → `emitTerminal(NO_PAIRED_RECORD_CLOSE_CODE, 'no-paired-record')`, return; else `conn = resolved`. Finally `current = createConnection({ ...conn, onEvent: onConnEvent })`. |
| conn `connected` | forward `{ type: 'connected' }`; arm `stabilityTimer = setTimer(onStable, stableUptimeMs)`. |
| conn `message` | forward `{ type: 'message', frame }` — **same `Uint8Array` reference, no copy**. |
| conn `closed{code,reason}` | clear `stabilityTimer`; `current = null`. If `fatalCloseCodes.has(code)` → `emitTerminal(code, reason)` (no `relay-closed` — see below). Else → `backoffTimer = setTimer(dial, jitteredDelay(attempt))`; `attempt++`; **then** `config.onEvent({ type: 'relay-closed', code })` ([#328](../codebase/328.md) — re-dial armed *before* the emit, so a misbehaving sink can never strand recovery). |
| `onStable` (≥ threshold up) | `attempt = 0`; `stabilityTimer = null`. **Reset only** — no emit, no dial. |
| `stop()` | `emitTerminal(1000, 'stopped')`. |
| `send(frame)` | `if (!current) throw RelayNotConnectedError`; else `current.send(frame)` (which itself throws if the socket is not OPEN — e.g. still CONNECTING). |

- **`jitteredDelay(n)`:** `base = min(baseDelayMs · 2ⁿ, maxDelayMs)`; `factor = 1 + (random()·2 − 1)·jitterRatio` (⇒ `factor ∈ [0.8, 1.2)`); return `base · factor`. The un-jittered `base` for `n = 0…6` is `1000, 2000, 4000, 8000, 16000, 30000, 30000` — the `min` caps `32000`→`30000` from `n = 5`. `2 ** attempt` saturating to `Infinity` for a permanently-failing connection is clamped by the `min`, so there is no overflow path.
- **`emitTerminal(code, reason)`** is guarded by `terminalEmitted` (once): sets `stopped = true`, clears **both** timers, and — if `current` is non-null — captures it, nulls the field, and calls `.close()` to release the underlying connection. On the fatal path `current` was already nulled in the `closed` handler, so no double-close; on `stop()` during a backoff gap `current` is already null and only the pending `backoffTimer` is cleared. After terminal, **no timers remain and no further events are forwarded**.
- **Re-entrancy / late events:** `onConnEvent` early-returns when `stopped` and `terminalEmitted` guards the terminal emit, so a late `closed` from a connection the supervisor asked to `.close()` during `stop()` cannot produce a second terminal or a reconnect. (#21's `close()` emits its `closed` asynchronously, so by the time it fires the supervisor is already `stopped`.)
- **No per-connection generation fence — the connection layer is load-bearing.** `onConnEvent` is a *single shared handler* passed to every dialled connection; on any `closed` (while not `stopped`) it nulls the live `current` and re-dials, with **no** check that the `closed` came from the *current* connection rather than a superseded one. Desktop is safe from mobile #496's "a superseded connection clobbers the live one" race **only** because [#21](relay-connection.md)'s teardown guarantees a torn-down connection never fires again — the supervisor relies on that entirely. That connection-layer guarantee is pinned by [#35](../codebase/35.md) (mobile #496 parity, test-only). A supervisor-side fence was deliberately *not* added: it defends a race the connection layer already makes impossible, and has no observed failure (*Evidence-Based Fix Selection*).
- **Single live connection — "replace, don't stack".** A reconnect only fires from `backoffTimer` **after** the previous connection emitted its terminal `closed` and `current` was nulled — the supervisor never holds two connections. This is the invariant #21 deferred to #22.

### Data flow

```
 consumer (future Noise layer)     createRelaySupervisor            createRelayConnection (#21)
   config{connection,onEvent} ───►  dial() ── createConnection ────► new #21 connection (its own ws)
   handle.send(frame) ────────────► current.send(frame) [live only]
                                     conn {connected} ─► forward {connected}; arm stability
                                     conn {message}   ─► forward {message, frame}   (opaque)
                                     conn {closed,code} ─► fatal? {terminal} : backoff→dial
   handle.stop() ─────────────────► emitTerminal(1000,'stopped'); clear timers; current.close()
```

Nothing in this flow reaches IPC, the preload, or the renderer. Frames are opaque both ways: no member of `RelaySupervisorEvent` and no argument of `send` is parsed, decoded, or validated as a Noise/wire structure here.

## Wire-spec cadence and the fatal-close-code set

Source of truth: `pyrycode` `docs/protocol-mobile.md` § Reconnect and § Error codes. The relay implements the symmetric side, so these are **not architect-tunable in production** (only overridable through the test-only `timing` parameter).

- **Backoff** `1s → 2s → 4s → 8s → 16s → 30s` **capped**, with **±20% jitter** on each step. Jitter is **non-cryptographic** (`Math.random()`): a load-spreading anti-thundering-herd nicety after a relay restart, not a security primitive — a hostile relay already controls drop timing, so predictable jitter enables no attack.
- **Reset** to the first step (1s) only after a connection has stayed continuously up ≥ **60s**. A connection that drops in under 60s does **not** reset the backoff — the stability timer is cancelled on the early drop.
- **Fatal set** (the desktop connects to the **client leg**, `/v2/client`):

  | Code | Meaning | Classification | Rationale |
  |---|---|---|---|
  | `1000` normal / `1006` abnormal / `1011` server error | graceful restart / network drop / transient relay error | **retryable** | the whole point of the supervisor — re-dial |
  | `4401` unauthorized (bad device token) | **FATAL** | retrying the same token is a permanent-reject storm; needs re-pair |
  | `4404` no server with that server-id | **retryable** | binary temporarily offline; it reconnects within its grace window |
  | `4409` server-id already claimed | **N/A** | binary-leg code — the client never receives it; **do NOT hardcode** |
  | `4421` protocol mismatch | **FATAL** | version incompatibility; fails identically on retry; needs app update |
  | `4426` Noise handshake failure | **FATAL** | wrong static key / stale pair record / impersonation; needs re-pair |

  **Default: `{4401, 4421, 4426}`.** `4404` is deliberately retryable (transient binary-offline is the common case; the capped 30s backoff already bounds a permanently-wrong server-id to ~2 dials/min — not a storm). `4409` is deliberately absent (binary-leg only). The set is **injected config** with this wire-spec default, mirroring the Go `FatalCloseCodes`.

## Why security-sensitive

The fatal-vs-retryable close-code classification (AC #3) is a **reconnect-storm DoS mitigation**. The Go transport learned this the hard way (`pyrycode` #248 / #301): reconnecting on a *permanently-rejected* close (bad token, protocol mismatch, failed handshake) makes a doomed client hammer the relay forever. The mitigation is the injected fatal set the reconnect loop consults — a **single set-membership check** on the code #21 already emits, at this layer (per the Go #301 lesson: "reconnect storms come from layer confusion; the fix is strictly less code, not more"). A relay that spoofs a fatal code only causes the desktop to **stop** (fail-closed, safe) — not to leak or loop. Capped backoff bounds even the retryable path to ~2 dials/min per client.

## Edge cases and limitations

- **No visible "reconnecting…" state, and no `Reconnecting`-countdown category.** [#328](../codebase/328.md) surfaces the retryable drop itself (`relay-closed{code}`) so a higher layer can show "offline"/"daemon-absent", but the supervisor exposes no remaining-backoff — a countdown-style category is out of scope until it does (deferred, evidence-based).
- **No send buffering across a reconnect.** `send` throws during a backoff gap; frames are not queued for the next connection. Acceptable because v2 has **no session resumption** — each reconnect is a fresh Noise handshake from `noise_init`, so the handshake layer re-establishes and re-sends. Revisit only if an observed loss motivates a bounded outbound queue.
- **`4404` classification.** Kept retryable; promote it to the fatal set (already injectable config, no code change) only if field data shows a bad-pair-record `4404` storm.
- **A throwing consumer `onEvent` is not defended** — a trusted internal sink, per evidence-based-fix (matches #21).
- **No composition-root wiring yet.** Greenfield module; nothing imports `createRelaySupervisor`. `src/main/index.ts` is untouched — wiring the supervisor into app startup is a later ticket (as #21 left `index.ts` for #22).

## Related

- [Relay connection](relay-connection.md) (#21) — the single-shot primitive this supervises.
- [#22 codebase notes](../codebase/22.md) — implementation summary, patterns, and lessons.
- [#35 codebase notes](../codebase/35.md) — pins the [#21](relay-connection.md) teardown guarantee that `onConnEvent`'s fence-free re-dial depends on (mobile #496 parity, test-only).
- [#83 codebase notes](../codebase/83.md) / [Noise relay driver](noise-relay-driver.md) / [Daemon connection](daemon-connection.md) — reload-per-dial: the optional `resolveConnection` provider + async `dial()` + `NO_PAIRED_RECORD_CLOSE_CODE` added here so the automatic re-dial re-sources the paired-server record; the driver wraps `daemonConnection`'s `loadDialConfig` into it.
- [#328 codebase notes](../codebase/328.md) / [Noise relay driver](noise-relay-driver.md) / [Daemon connection](daemon-connection.md) — the `relay-closed{code}` member added here (retryable close, surfaced but still absorbed), forwarded by the driver as `relay-link-down` and classified into the renderer-facing `relayLinkChanged` `DaemonEvent` at `daemonConnection`'s choke point. First of three slices toward a two-dot connection-status indicator.
- [#21 codebase notes](../codebase/21.md) — the four patterns this module re-uses verbatim (factory + injected `onEvent`, test-only `timing`, terminal-emitted-once + single teardown, log-free by construction).
- [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — remote head over the relay; transport out of the window.
- Go mirror: `pyrycode` `docs/knowledge/features/transport-package.md` (`internal/transport` — WSS client with auto-reconnect backoff), and its `#247` (backoff) / `#301` (reconnect-storm / `FatalCloseCodes`) codebase notes.
