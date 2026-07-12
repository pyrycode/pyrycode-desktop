# #328 — Relay-link status transport: surface the relay-socket leg to the renderer

**Size:** S · **Security-sensitive:** yes · Split from #149 (transport slice 1 of 3: this → #329 store+bridge → #330 two-dot render).

## Context

The renderer today sees only the **combined** daemon session status — `sessionStore`'s `ConnectionStatus` (`connecting` / `connected` / `error`), where `connecting` conflates two hops: dialing the relay socket and completing the end-to-end Noise handshake. The relay-socket lifecycle (`RelayEvent` `connected` / `closed`) is consumed inside the transport to trigger the handshake and **never surfaced** to the renderer as its own signal. Mobile learned in live testing (2026-06-08) that one combined signal shows a "false green" while the encrypted session is not yet live, and split its status into a socket-level relay leg (`RelayLinkStatus`, mobile #391) and a session-readiness leg (`PyrycodeLinkStatus`, mobile #392).

This ticket ports the **relay leg** to desktop. Desktop needs only the relay leg here because the daemon leg is already honest — `sessionStore.connected` fires only after `handshake-complete` (`daemonConnection.onDriverEvent case 'handshake-complete'`), so the daemon dot derives from the existing `ConnectionStatus`. This slice ships **dormant**: it adds a new `DaemonEvent` arm and the producer chain that feeds it, but nothing consumes it yet (the store is #329, the render is #330).

**The producer seam (corrected in #149 rework-pass-2).** The relay-socket close is currently surfaced upward **only for the fatal code set** `{4401, 4421, 4426}`: `relaySupervisor.onConnEvent case 'closed'` calls `emitTerminal` for a fatal code, but a **retryable** close (`4404`, `1006`, `1000`, `1011`, …) hits the `else` branch that schedules a backoff re-dial and **emits nothing**. So "offline" and "daemon-absent" are **not** derivable from the existing `terminal` path — honestly surfacing them means teaching the supervisor to expose the retryable socket-close (with its code) on its `else` branch, then mapping it up through the driver and `daemonConnection` to the new arm. Socket-**up** is already free: the supervisor's `connected` reaches the driver today (it triggers the handshake), so AC2's "in addition to" is a second consumer of the same signal.

## Files to read first

- `src/main/transport/relaySupervisor.ts:40-49` — `DEFAULT_FATAL_CLOSE_CODES` + the doc note that `4404` is deliberately excluded (retryable "binary offline"). Confirms the fatal/retryable split you are extending.
- `src/main/transport/relaySupervisor.ts:56-63` — `RelaySupervisorEvent` union (`connected` / `message` / `terminal`). You add one member here.
- `src/main/transport/relaySupervisor.ts:190-213` — `onConnEvent`, specifically `case 'closed'`. The `else` branch (`:206-208`) is the producer seam: emit the new event there, unchanged fatal/backoff behaviour.
- `src/main/transport/noiseRelayDriver.ts:60-64` — `RelaySessionEvent` union. You add two members.
- `src/main/transport/noiseRelayDriver.ts:296-308` — `onSupervisorEvent` switch. `case 'connected'` (`:298`) gains a second emit; you add a `case` for the new supervisor member. (No `assertNever` here — void switch, so a missing case silently drops; the driver test is the net.)
- `src/main/daemonConnection.ts:66-67` — `SERVER_KEY_LENGTH` const style; add the `4404` constant nearby.
- `src/main/daemonConnection.ts:330-645` — `onDriverEvent`, the single `RelaySessionEvent → DaemonEvent` choke point. Add two cases; note the fresh-literal emit discipline used by every existing arm (e.g. `:483`).
- `src/shared/ipc/events.ts:38-40` — `DebugBundleFailure`: the precedent for a closed category enum declared alongside `DaemonEvent`. `RelayLinkStatus` follows this exactly.
- `src/shared/ipc/events.ts:104-110` — the `stallDetected` arm: the dormant-arm doc precedent (arm + three bridge no-ops, consumer not yet built).
- `src/renderer/src/store/daemonEventBridge.ts:103-114` — the `stallDetected` / `screenSnapshotReceived` no-op group + `assertNever`. Your new arm joins this group.
- `src/renderer/src/store/timelineBridge.ts:92-125` — the `null`-returning fall-through group + `assertNever`.
- `src/renderer/src/store/modalBridge.ts:61-92` — the `null`-returning fall-through group + `assertNever`.
- `src/main/transport/relaySupervisor.test.ts:114-116,164,261-304` — `makeSink` (captures `RelaySupervisorEvent[]`), `dropClosed` helper (`{ closed, code: 1006 }`), and the existing fatal-vs-retryable code tests (`:261`, `:277`) to extend.
- `src/main/transport/noiseRelayDriver.test.ts:132-170,223-260` — `fakeSupervisorFactory` (`supervisor().emit(...)` drives events in), `makeSink`, and the happy-path `connected → handshake` test to assert alongside.
- `src/main/daemonConnection.test.ts:70-112,360-385` — the fake driver factory (`drivers[0].emit(RelaySessionEvent)`), `emitted(sink)` (returns `DaemonEvent[]`), and the `handshake-complete → connected` mapping test to mirror.
- `src/renderer/src/store/daemonEventBridge.test.ts:88-119` — the dormant-arm test pattern (`expect(translate…({ type: … })).toBeNull()`).
- `docs/knowledge/decisions/0007-content-free-diagnostics-by-construction.md` — ADR 0007. The new arm must carry no token/key/frame/payload byte — only the closed category.

## Design

A four-layer vertical, each layer dead without the next (why this is one atomic slice — see Scope). Data flows: supervisor → driver → `daemonConnection` (choke point) → `DaemonEvent` → three dormant bridge no-ops.

### 1. `relaySupervisor.ts` — surface the retryable close

Add one member to `RelaySupervisorEvent`:

```ts
// The current relay connection dropped with a RETRYABLE close code; supervision continues
// (a re-dial is scheduled). Distinct from `terminal`, which ENDS supervision. The `connected`
// member above is the paired "relay up" signal. Carries the raw WS close code (not a secret —
// `terminal` already carries one) so a higher layer can classify it (4404 vs an ordinary drop).
| { type: 'relay-closed'; code: number }
```

In `onConnEvent` `case 'closed'`, the `else` branch (retryable) surfaces this. **Ordering: arm the backoff first, then emit** — i.e. `backoffTimer = setTimer(dial, jitteredDelay(attempt)); attempt++;` then `config.onEvent({ type: 'relay-closed', code: event.code })`. The re-dial is the load-bearing recovery; scheduling it before the emit guarantees it is armed even in the (contract-forbidden but defended) case of a misbehaving sink, so a transient drop can never strand the connection. The fatal branch (`emitTerminal`) is unchanged; `connected` / `message` / `terminal` are unchanged. Behaviour delta: retryable drops, previously absorbed silently, now also surface `relay-closed{code}` while still being re-dialled. Update the `RelaySupervisorEvent` doc comment (`:51-54`) — it currently says a transient `closed` is "never surfaced"; it is now surfaced (but still absorbed).

### 2. `noiseRelayDriver.ts` — forward up + down as the session sink's relay-leg members

Add two members to `RelaySessionEvent`:

```ts
| { type: 'relay-link-up' }              // the relay socket is up — forwarded from the supervisor's `connected`
| { type: 'relay-link-down'; code: number } // the relay socket dropped (retryable) — forwarded from `relay-closed`
```

In `onSupervisorEvent`:
- `case 'connected'`: keep `onConnected()` (starts the fresh handshake) **and** additionally `emit({ type: 'relay-link-up' })`. Emit `relay-link-up` first (socket came up), then `onConnected()`. This is AC2's "in addition to" — one signal, two consumers.
- Add `case 'relay-closed'`: `emit({ type: 'relay-link-down', code: event.code })`. No generation fencing needed — driven directly by a supervisor event, exactly like `terminal`; `daemonConnection`'s per-dial `onEvent` wrapper drops a superseded driver's events.
- `message` / `terminal` cases unchanged.

The driver stays a thin forwarder: it does **not** classify the code. Classification is wire semantics and lives one layer up, consistent with how `terminal{code}` is forwarded raw and interpreted by `daemonConnection`.

### 3. `daemonConnection.ts` — classify at the choke point, emit the arm

Add a local constant near `SERVER_KEY_LENGTH`:

```ts
// The relay's "reachable, but no daemon registered behind it" close (wire spec: retryable,
// which is why relaySupervisor's DEFAULT_FATAL_CLOSE_CODES excludes it). Mapped to the
// 'daemon-absent' relay-leg category — mobile shows this GREEN ("relay reachable"); the daemon
// leg's absence is the daemon dot's story, not a relay failure. Every other retryable close is
// an ordinary socket drop → 'offline'.
const RELAY_NO_DAEMON_CLOSE_CODE = 4404
```

In `onDriverEvent`, add two cases (fresh-literal emits, the established discipline):
- `case 'relay-link-up'`: `emitDaemonEvent(sink, { type: 'relayLinkChanged', status: 'connected' })`.
- `case 'relay-link-down'`: `const status = event.code === RELAY_NO_DAEMON_CLOSE_CODE ? 'daemon-absent' : 'offline'`, then `emitDaemonEvent(sink, { type: 'relayLinkChanged', status })`.

Only the classified category crosses IPC — the raw `code` stops here (AC3). No new diagnostic-log call: the close code is already logged content-free by #127 at `relayConnection.ts:243` (`relay-closed`, `status: <code>`), and the arm carries no loggable secret.

### 4. `src/shared/ipc/events.ts` — the category enum + the arm

Add the closed category (the `DebugBundleFailure` precedent) and the arm:

```ts
// The relay-socket leg's state category (#328), mirroring mobile's RelayLinkStatus where it maps
// cleanly. 'connected' = socket up; 'offline' = socket dropped (ordinary retryable close); 'daemon-absent'
// = relay reachable but no daemon registered (the relay's 4404). No Reconnecting-countdown — the
// supervisor exposes no remaining-backoff, so desktop cannot honestly emit it (out of scope).
export type RelayLinkStatus = 'connected' | 'offline' | 'daemon-absent'

// The relay-link status arm (#328). Content-free by construction (ADR 0007): carries ONLY the closed
// RelayLinkStatus category — no token, key, raw frame, close code, or payload byte. Surfaces the relay
// SOCKET leg as a signal distinct from the session `connecting`/`connected`/`failed` arms. Consumed by
// the renderer relay-link store + bridge (#329, not yet built) → the two-dot indicator (#330); ships
// DORMANT — all three exhaustive bridges no-op it (the stallDetected-was-a-no-op-until-#317 precedent).
| { type: 'relayLinkChanged'; status: RelayLinkStatus }
```

### 5. The three exhaustive bridges — dormant no-ops

Each of `daemonEventBridge` / `timelineBridge` / `modalBridge` adds `case 'relayLinkChanged':` to its existing `null`-returning fall-through group (the `assertNever` guard makes this a compile error until each has the case). One line + a short comment each, matching the `stallDetected` / `screenSnapshotReceived` precedent: consumer is #329 (relay-link store), not any of these three stores.

**No other consumer needs a case.** The other six store bridges (`conversationCreatedBridge`, `conversationListBridge`, `queueBridge`, `screenSnapshotBridge`, `sessionIdBridge`, `runSettingsWriteBridge`) use `default: null` catch-alls (verified: each carries the "`not an assertNever` — ignoring the rest is the intended, permanent behavior" comment), so a new arm does not touch them.

### Category mapping (single source of truth)

| Layer | Value |
|---|---|
| supervisor `connected` | → driver `relay-link-up` → `relayLinkChanged{ status: 'connected' }` |
| supervisor `relay-closed{ code: 4404 }` | → driver `relay-link-down{ 4404 }` → `relayLinkChanged{ status: 'daemon-absent' }` |
| supervisor `relay-closed{ code: 1006/1000/1011/… }` | → driver `relay-link-down{ code }` → `relayLinkChanged{ status: 'offline' }` |
| supervisor `terminal{ fatal code }` | unchanged → `failed` (daemon leg); **no** relay-leg event (see State model) |

## State + concurrency model

- **No new store, no new mutable state.** This slice is pure event plumbing; state lands in #329's Zustand store. Each layer's emit is a fresh literal (no spread, no `return event`), so a later field on any union member cannot smuggle across.
- **Idempotency / repetition:** `relay-link-up` fires on **every** (re)connect and `relay-link-down` on **every** retryable drop, so the relay leg toggles down→up across transient reconnects — the live signal #330 wants. #329 will hold "latest wins."
- **Generation fencing:** unchanged. The relay-leg emits ride the supervisor's own callback path; `daemonConnection`'s per-dial `onEvent` wrapper (`daemonConnection.ts:738-741`) already drops a superseded driver's events by generation. No new fence.
- **Teardown:** unchanged. `stop()` → supervisor `emitTerminal(1000,'stopped')`; `onConnEvent` guards `if (stopped) return`, so no relay-leg event fires after stop.

## Error handling / failure modes

- **Fatal closes are deliberately NOT a relay-leg event.** A fatal close (`4401` unauthorized, `4421` protocol mismatch, `4426` Noise handshake failure) is a session-level **rejection**, not a relay-reachability failure — the relay socket connected and the rejection was delivered *through* it. Mapping these to `offline` would be dishonest (the relay was reachable). They stay on the `terminal` → `failed` path (the daemon leg). Consequence: after a fatal close the relay leg is left at its last value (`connected`) rather than flipping. This is acceptable because a fatal close is a terminal state dominated by the daemon-leg `failed` signal (#279's `ConnectionBanner`); how the relay dot presents in that terminal state is **#330's** concern (it holds both legs). See Open questions.
- **Content-free (AC3):** the arm carries only `RelayLinkStatus`. The raw close code is classified and dropped at `daemonConnection`; it never crosses IPC. No new logging.
- **Malformed / hostile input:** none introduced. The close code is a WS-library integer already validated upstream; the classifier is a total 2-way branch (`4404` vs everything else), no parse, no throw.

## Testing strategy

Unit tests (`npm test`, vitest), extending the existing fakes in each layer's test file. No new test files. Assertions are scenarios; write them in the project idiom.

**`relaySupervisor.test.ts`** — using `makeSink` + the fake connection factory:
- A retryable close (`code: 4404`) → `sink.events` contains `{ type: 'relay-closed', code: 4404 }`, **and** a re-dial is still scheduled (existing backoff assertion unchanged).
- An ordinary retryable drop (`code: 1006`, `dropClosed`) → `sink.events` contains `{ type: 'relay-closed', code: 1006 }`.
- A fatal close (`4401`) → `sink.events` contains `terminal` and **no** `relay-closed` (extend the existing `:261` fatal test).

**`noiseRelayDriver.test.ts`** — using `fakeSupervisorFactory` + `makeSink`:
- `supervisor().emit({ type: 'connected' })` → `sink.events` contains `{ type: 'relay-link-up' }` **and** the handshake still starts (a `createSession` still runs / message-1 still sends — assert alongside the existing happy-path).
- `supervisor().emit({ type: 'relay-closed', code: 4404 })` → `sink.events` contains `{ type: 'relay-link-down', code: 4404 }`.
- A retryable drop code (`1006`) forwards `relay-link-down{ code: 1006 }`, and existing `terminal`/`error`/`message` forwarding is unchanged.

**`daemonConnection.test.ts`** — using the fake driver (`drivers[0].emit`) + `emitted(sink)` (AC5 core):
- `emit({ type: 'relay-link-up' })` → `emitted(sink)` contains `{ type: 'relayLinkChanged', status: 'connected' }`.
- `emit({ type: 'relay-link-down', code: 4404 })` → `{ type: 'relayLinkChanged', status: 'daemon-absent' }`.
- `emit({ type: 'relay-link-down', code: 1006 })` → `{ type: 'relayLinkChanged', status: 'offline' }` (assert `1000`/`1011` land on `offline` too if cheap).
- The arm carries **no** `code` field (content-free assertion — the emitted object is exactly `{ type, status }`).

**Bridge tests** (`daemonEventBridge.test.ts`, `timelineBridge.test.ts`, `modalBridge.test.ts`) — the dormant-arm pattern:
- `translateDaemonEvent({ type: 'relayLinkChanged', status: 'connected' })` → `toBeNull()` (and likewise for the timeline / modal translators). One case per bridge test; mirrors the existing `stallDetected → null` / `snapshotReceived → null` tests.

**Type-level (`npm run typecheck`):** adding the arm makes it a compile error in all three exhaustive bridges until each has a case — the build (`npm run build`, the QA/salvage gate) is green only once all three no-ops exist (AC4).

## Open questions

- **Terminal-state relay-dot presentation (defer to #330).** After a fatal close the relay leg stays `connected` (see Error handling). #330's render slice holds both the relay leg and the daemon leg's `failed`; it decides whether to suppress/override the relay dot in a terminal state. No transport change needed — flag it in #330's spec so the render slice owns it.
- **`4404`-constant home.** Defined locally in `daemonConnection.ts` (its only consumer). If a second consumer appears, promote it next to `DEFAULT_FATAL_CLOSE_CODES` in `relaySupervisor.ts` (the relay-wire-codes home). Not worth the cross-module export for one use today.

## Scope — why this is one `s` (not a split)

7 production files: `relaySupervisor.ts`, `noiseRelayDriver.ts`, `daemonConnection.ts`, `events.ts`, and the three bridges. This trips the ≥5-file self-check, but it is the **documented DaemonEvent-arm exception** (#241: "the ≥5-file gate is unsatisfiable for a `DaemonEvent` arm"). Any split ships dead code: the arm without its producer is a dead `emitDaemonEvent` with no emitter; the producer without the arm is a supervisor event the driver drops on the floor; the three bridge no-ops are compile-forced one-liners, not decomposable work. The genuinely-substantial edits are three (supervisor, driver, `daemonConnection`) and each is ~5–15 production LOC. Total ≈ 50 production LOC + ~200 test LOC across 6 existing test files ≈ 250 LOC. No state machine (a single 2-way classifier, zero reject branches), 1 new exported type (`RelayLinkStatus`), edit fan-out is exactly the 3 compile-forced bridge no-ops (< 10). Ships as one slice.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST-FIX. The relay is content-blind but on-path and untrusted; it fully controls the WS close code. That code crosses untrusted→trusted at exactly one point — `daemonConnection.onDriverEvent`'s new `relay-link-down` case — where it is classified into a closed `RelayLinkStatus` category and the raw integer is dropped. The category never gates anything security-relevant (no auth, no file path, no control flow) — it is a display signal only. The renderer receives only the 3-value enum and cannot hold a secret. Boundary is explicit (single choke point), not scattered.
- **[Tokens/secrets]** N/A — this slice generates, stores, and compares no token or key. The one new data element (the close code) never reaches disk, log, or the renderer.
- **[File/storage]** N/A — no filesystem or storage operation; no path is constructed from any input.
- **[Electron attack surface]** No findings. No new IPC channel, `ipcMain` handler, or `contextBridge` API — the arm is data on the existing typed `DAEMON_EVENT_CHANNEL` (main→renderer). It hands the renderer no new capability (a closed enum, not a socket/fs/exec handle). No window, `webPreferences`, protocol-handler, or navigation change. Sockets, close codes, and classification stay in main (process-placement MUST-FIX category clean).
- **[Cryptographic primitives]** N/A — no crypto touched. The Noise handshake path is unchanged: `onConnected()` runs identically; the new `relay-link-up` emit is a sibling sink call before it, introducing no key/nonce reuse and no handshake reordering.
- **[Network & I/O]** No MUST-FIX; one hardening **addressed by design**: the supervisor's retryable `else` branch arms the backoff timer *before* emitting `relay-closed` (see Design §1), so a misbehaving sink cannot strand the re-dial — a transient drop always recovers. Frame caps, TLS/`wss://`, connect/idle timeouts, and reconnect backoff are all inherited unchanged; this slice adds no new network read path and no unbounded buffer.
- **[Error messages / logs / telemetry]** No findings. Zero new log calls — the close code is already logged content-free by #127 (`relayConnection.ts:243`), and the arm carries no message, stack, code, or secret (ADR 0007). Nothing secret reaches the renderer console.
- **[Concurrency]** No findings. No new async task, timer, or listener; the classifier reads a local param with no `await` and no shared-state read-modify-write, so no check-then-act race. Teardown/`stopped` guards are unchanged. The only ordering concern (backoff vs emit) is handled above.
- **[Threat model]** Addressed. **Malicious relay:** it can spoof `4404` (→ `daemon-absent`) or force `offline`, or never close (relay leg stays `connected`) — all display-only outcomes with no plaintext leak, no hang (re-dial armed regardless), and no state corruption; it adds no leverage beyond the drop/delay/reorder/flood it already has. **Hostile daemon:** N/A to this leg — the relay-leg signal derives from the transport-layer WS close code, which a daemon *inside* the Noise session cannot influence. **Renderer compromise:** unchanged — a compromised renderer receives the enum like any DaemonEvent and cannot reach the socket/keys (process isolation intact). Out of scope: a `Reconnecting`-countdown category (the supervisor exposes no remaining-backoff — named in `events.ts`), and terminal-state relay-dot presentation (deferred to #330, see Open questions).

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-13
