# Spec #50 — Drive the Noise session from the relay supervisor

**Ticket:** [#50](https://github.com/pyrycode/pyrycode-desktop/issues/50) · **Size:** S · **Labels:** `security-sensitive`

A thin composition adapter in the Electron **main** process that drives a Noise session over the reconnect supervisor: a fresh handshake on every `(re)connect`, the #5 codec composed between the supervisor's opaque frames and the session's Noise bytes, and a single typed sink surfacing handshake/message/terminal/error to the background-process consumer above. New crypto: **none** — this composes three proven primitives (#22 supervisor, #7 session, #5 codec) unchanged.

## Files to read first

- `src/main/transport/relaySupervisor.ts:40-82` — `DEFAULT_FATAL_CLOSE_CODES`, the `RelaySupervisorEvent` union (`connected` / `message{frame:Uint8Array}` / `terminal{code,reason}`), `RelaySupervisorConfig`, `RelaySupervisor` handle (`send`/`stop`). The exact contract the driver **constructs and consumes**. Note the supervisor dials immediately on construction and re-emits `connected` on every (re)connect.
- `src/main/transport/noiseSession.ts:28-68` + factory at `:78` — `NoiseSessionConfig` (`staticPrivateKey`/`remoteStaticPublicKey`/`prologue`/`hello`/`sendFrame`/`onEvent`/`loadTimeoutMs`), `NoiseSessionEvent` (`handshake-complete{helloAck}` / `message{plaintext}` / `error{reason}`), `NoiseSessionErrorReason`, `NoiseSession` handle (`start`/`onFrame`/`sendMessage`/`close`), and `createNoiseSession(): Promise<NoiseSession>` (async — rejects `NoiseLoadError` on wasm load failure/timeout). The per-connection session wiring.
- `src/main/transport/codec.ts:32-101` — `WireDecodeError`/`WireEncodeError` (32-47), `base64StdEncode`/`base64StdDecode` (52-73), `encodeInnerFrame` (rejects >`MAX_FRAME_BYTES`) / `decodeInnerFrame` (79-101). The framing the driver composes and the throw surfaces it must catch.
- `src/shared/wire/types.ts:22,32-38` — `MAX_FRAME_BYTES` (256 KiB, the outbound over-cap trigger) and `InnerFrameV2` (`{v:2, type:string, data:string}`), the outbound wrap target.
- `src/main/transport/noiseSession.interop.test.ts:388-456` — `runLive`: the **exact adapter shape** already proven against the single-shot #21 connection (`connected`→`start()`, `message`→decode→`onFrame`, `sendFrame`→`noise_init`/`noise_msg` wrap, first-frame tagging). This ticket productionizes `runLive` over the #22 supervisor. **The single most useful reference — read it in full.**
- `src/main/transport/relaySupervisor.test.ts:19-156` — the fake-factory + fake-scheduler + `makeSink` test idiom (injected `createConnection`, an `emit` that drives events into the captured sink, event-filter helpers). The driver's tests mirror this shape: a fake **supervisor** factory with `emit`, a fake **async session** factory returning a scripted `NoiseSession`, the **real** codec, and a `makeSink`.
- `docs/knowledge/codebase/30.md` — §"The interop contract proven" (the byte-accurate invariants: `noise_init`/`noise_msg` tagging, base64-std framing, empty AD/prologue, `Split()` asymmetry) and §"Patterns established" (consume-upstream-primitives-unchanged, log-free-by-construction, bounded-waiters).
- `docs/knowledge/codebase/22.md` — the supervisor's reconnect/terminal contract, for the boundary between "reconnect loop (supervisor owns)" and "re-handshake on every connect (this ticket owns)".

## Context

**Problem.** The #22 supervisor heals a relay connection across transient drops and classifies fatal close codes (`{4401,4421,4426}`) into one `terminal` event, but its frames are opaque (`Uint8Array` in, `string` out) — it knows nothing about Noise. The #7 session performs the `Noise_IK_25519_ChaChaPoly_BLAKE2s` handshake and AEAD transport, but knows nothing about the socket. Something must sit between them: start a **fresh** handshake on every `connected` (v2 has **no session resume**), carry frames through the #5 codec, and surface the combined lifecycle to the consumer above.

**Why now.** The #30 spike already proved this adapter shape (`runLive`) against the single-shot #21 connection. This ticket lifts that shape onto the production #22 supervisor and adds the one thing single-shot didn't need: **re-handshake-per-connect with no leaked state**. It is the last transport-layer wiring before the renderer-facing session store (#17/#18/#19) can be fed.

**Boundary of ownership.** The reconnect loop, backoff, and fatal-code classification belong to #22. Key/`hello` sourcing belongs to #42/#43/#10. The renderer-facing IPC sink belongs to #17/#18/#19. This ticket owns **only** the composition between supervisor and session, and the re-handshake trigger. It reaches no IPC / preload / renderer, and sources no key.

## Design

### Module

One new file: `src/main/transport/noiseRelayDriver.ts`. Main-process only (imports `codec.ts`, which uses Node `Buffer`; never re-export through a renderer barrel). Log-free by construction.

### Public contract (interfaces + signatures only — no bodies)

```ts
/** Sink reason set: the session's own reasons, plus the three adapter-boundary failures. */
export type RelaySessionErrorReason =
  | NoiseSessionErrorReason        // 'handshake-read-failed' | 'transport-decrypt-failed' | 'unexpected-frame'
  | 'inbound-frame-decode-failed'  // decodeInnerFrame / base64StdDecode threw at the relay boundary (fail-closed)
  | 'outbound-frame-encode-failed' // encodeInnerFrame over-cap, or supervisor.send threw (not connected)
  | 'session-load-failed'          // createNoiseSession rejected (NoiseLoadError / wasm load timeout)

/** The single typed sink to the background-process consumer above. Sealed union on `type`. */
export type RelaySessionEvent =
  | { type: 'handshake-complete'; helloAck: Uint8Array } // forwarded from the session
  | { type: 'message'; plaintext: Uint8Array }           // forwarded from the session (decrypted app frame)
  | { type: 'terminal'; code: number; reason: string }   // forwarded from the supervisor (incl. 4426/4421/4401)
  | { type: 'error'; reason: RelaySessionErrorReason }    // session errors + adapter-boundary errors

export interface NoiseRelayDriverConfig {
  /** Relay params, minus onEvent — the driver owns the supervisor's onEvent to route classification. */
  connection: Omit<RelayConnectionConfig, 'onEvent'>
  /** Noise key material + hello early-data, injected from above (sourced later by #42/#43/#10). */
  session: {
    staticPrivateKey: Uint8Array
    remoteStaticPublicKey: Uint8Array
    prologue: Uint8Array
    hello: Uint8Array
    loadTimeoutMs?: number
  }
  /** The single typed sink. A trusted internal sink; must not throw (mirrors #7/#22 onEvent discipline). */
  onEvent: (event: RelaySessionEvent) => void
  /** WS close codes the supervisor treats as terminal. Passthrough; default DEFAULT_FATAL_CLOSE_CODES. */
  fatalCloseCodes?: ReadonlySet<number>
  /** DI seams — default to the real factories. Tests inject fakes. */
  createSupervisor?: (config: RelaySupervisorConfig) => RelaySupervisor
  createSession?: (config: NoiseSessionConfig) => Promise<NoiseSession>
}

export interface NoiseRelayDriver {
  /** Post-handshake app-message send. Delegates to the current session; inert before handshake-complete / after terminal. */
  sendMessage(plaintext: Uint8Array): void
  /** Idempotent teardown: stop the supervisor (→ one terminal), close the current session, drop buffered frames. */
  stop(): void
}

export function createNoiseRelayDriver(config: NoiseRelayDriverConfig): NoiseRelayDriver
```

**Why the driver constructs the supervisor (not receives one).** The supervisor's `onEvent` is fixed at construction and is where classification routing lives (`RelaySupervisorConfig` doc: "the supervisor owns onEvent to route classification"). The driver must therefore build the supervisor with **its own** handler. The `createSupervisor` DI defaults to `createRelaySupervisor` and is called with **one argument** — the production wire-spec cadence stays locked (the test-only `timing` param is never passed). Construction dials immediately (supervisor idiom); the consumer constructs the driver when it wants to connect.

### Internal state — the generation model

The seam this design turns on: **supervisor events are synchronous, but `createNoiseSession` is async.** A generation counter fences every connection so a late-resolving or stale session can never install itself or send with a superseded key.

- `generation: number` — bumped on every `connected`, and on `terminal`/`stop`. Each session and each per-connection closure captures the `gen` it was created under.
- `session: NoiseSession | null` — the live session for the current generation; `null` during the async-create gap, before first connect, and after terminal.
- `pending: Uint8Array[]` — raw Noise frames that arrived during the async-create gap, replayed in order once the session resolves. **Bounded** at `MAX_PENDING_FRAMES` (see Error handling / Security) — the legitimate daemon sends nothing before it receives msg 1, so a deep pre-session queue is anomalous and excess is dropped fail-safe.

### Data flow

**`connected` (supervisor → driver):**
1. `const gen = ++generation`.
2. Tear down the previous connection: `session?.close(); session = null; pending = []`.
3. Open a per-connection outbound tagger: a closure-local `let firstFrame = true` (the session's very first `sendFrame` is always msg 1, so this resets `noise_init`↔`noise_msg` per connection with no shared mutable state — the correct re-scoping of `runLive`'s `firstOut`).
4. Call `createSession({ ...config.session, sendFrame: <wrap(gen, firstFrame)>, onEvent: <route(gen)> })`.
   - **`sendFrame(raw)` wrap:** guard `if (gen !== generation) return` (drop a stale session's writes); compute `type = firstFrame ? 'noise_init' : 'noise_msg'`, set `firstFrame = false`; `try { supervisor.send(encodeInnerFrame({ v: 2, type, data: base64StdEncode(raw) })) } catch { emit error 'outbound-frame-encode-failed' }` — the session's `sendFrame` must not throw back into it (`NoiseSessionConfig` contract), so the codec/`send` throws are caught here.
   - **`onEvent(e)` route:** guard `if (gen !== generation) return`; forward `handshake-complete` / `message` / `error{reason}` to the sink (the session's reason set is a subset of `RelaySessionErrorReason`, so it passes through).
5. On resolve: `.then(s => { if (gen !== generation) { s.close(); return } session = s; s.start(); replay(pending); pending = [] })` — a superseded session is closed **before** `start()` (never sends a spurious `noise_init`). `start()` sends msg 1 first, then buffered frames replay as its replies (order preserved).
6. On reject: `.catch(() => { if (gen === generation) emit error 'session-load-failed' })`.

**`message{frame}` (supervisor → driver):** the untrusted→trusted boundary.
1. `try { const raw = base64StdDecode(decodeInnerFrame(frame).data) } catch { emit error 'inbound-frame-decode-failed'; return }` — fail-closed on any malformed frame; the caught error object is **dropped**, never forwarded (its message could echo transcript bytes).
2. Route: `if (session) session.onFrame(raw); else if (pending.length < MAX_PENDING_FRAMES) pending.push(raw)` (else drop — bounded).
3. The inbound `inner.type` label is **not** branched on — the session's state machine (`awaiting-handshake-reply` vs `transport`) decides interpretation, and Noise AEAD validates the bytes regardless, so a hostile `type` cannot misroute.

**`terminal{code,reason}` (supervisor → driver):**
1. `generation++` (invalidate any in-flight create); `session?.close(); session = null; pending = []`.
2. `emit({ type: 'terminal', code, reason })`. This is the authoritative end; the supervisor emits it exactly once (fatal close code, or a `stop()`).

**`sendMessage(plaintext)` (consumer → driver):** delegate to `session?.sendMessage(plaintext)` — inert if no session; the session itself is also inert before `transport` state, so a pre-handshake call is a silent no-op (matches the session contract).

**`stop()` (consumer → driver):** call `supervisor.stop()`. That synchronously drives one `terminal{code:1000, reason:'stopped'}` back through the driver's `terminal` handler, which performs the single teardown (close session, emit terminal). One teardown path, no duplication. Idempotent — the supervisor's terminal guard makes a second `stop()` a no-op.

### Lifecycle sketch

```
construct ─▶ supervisor dials
  connected ─▶ ++gen ─▶ close old ─▶ createSession (async)
                                       └▶ resolve ─▶ start() [msg1 → noise_init out] ─▶ replay pending
  message(frame) ─▶ decode(#5) ─▶ session.onFrame(raw)          [msg2 in ─▶ handshake-complete{helloAck}]
  sendMessage(pt) ─▶ session.sendMessage ─▶ sendFrame [→ noise_msg out]
  message(frame) ─▶ decode ─▶ session.onFrame ─▶ message{plaintext} ─▶ sink
  drop ─▶ (supervisor absorbs, re-dials) ─▶ connected ─▶ ++gen ─▶ close old session ─▶ FRESH handshake
  fatal close / stop() ─▶ terminal{code} ─▶ close session ─▶ sink terminal
```

## State + concurrency model

- **Single live session invariant.** The generation counter + close-old-on-`connected` guarantees exactly one live session. A stale in-flight `createSession` that resolves after a superseding `connected`/`terminal`/`stop` sees `gen !== generation`, closes itself, and no-ops — it never installs, never `start()`s, never sends. The `sendFrame` gen-guard is a deterministic second layer (belt: don't start a superseded session; suspenders: drop its writes if it somehow does).
- **Async ownership.** The only async task the driver owns is the `createSession` promise, fenced by the generation guard on both `.then` and `.catch`. All timers (backoff, stability) are the supervisor's; the driver owns none.
- **Re-handshake per connect (AC1/AC4).** No session, cipher state, `firstFrame` flag, or pending buffer survives a `connected`. This is both correctness (v2 has no resume) and a **security invariant** (fresh ephemeral → no `(key,nonce)` reuse across connections; see Security review).
- **No renderer coupling.** The sink is a plain in-process callback owned by the background-process consumer. No IPC, preload, or renderer import (AC / technical notes).

## Error handling

| Failure | Layer | Surfaced as | Terminal? |
|---|---|---|---|
| Malformed inbound frame (`decodeInnerFrame`/`base64StdDecode` throw) | codec (#5) at inbound boundary | `error{'inbound-frame-decode-failed'}`, frame dropped | No |
| Outbound over-cap (`encodeInnerFrame` >`MAX_FRAME_BYTES`) or `supervisor.send` throws (not connected) | codec / supervisor at outbound wrap | `error{'outbound-frame-encode-failed'}` (caught, not thrown into session) | No |
| `createNoiseSession` rejects (`NoiseLoadError` / wasm timeout) | session factory | `error{'session-load-failed'}` (gen-guarded) | No (supervisor still live) |
| Handshake read / transport decrypt / unexpected frame | session (#7) | `error{reason}` forwarded verbatim | No (session decides; forwarded, not policy) |
| Fatal close 4426/4421/4401, or clean stop | supervisor (#22) | `terminal{code,reason}` | **Yes** — single, close session |

- **Classify-don't-forward.** Every `catch` maps to a static reason and **drops** the caught error object. A codec or wasm error message can echo transcript/frame bytes; it never reaches the sink or a log.
- **Bounded pending buffer.** `pending` is capped at a small constant (`MAX_PENDING_FRAMES`, e.g. 8). Beyond the cap, pre-session frames are dropped. This closes a memory-exhaustion vector: a hostile on-path relay could otherwise flood frames during the async-create gap into an unbounded queue. (See Security review §6.)
- **Policy is the consumer's.** The driver classifies and surfaces; it does not decide whether an `error` should tear down. A handshake failure typically ends with the daemon closing the socket → the supervisor emits `terminal` → the driver tears down. The driver forwards both events and lets the consumer above act.

## Testing strategy

`src/main/transport/noiseRelayDriver.test.ts`, vitest, test-first. Mirror `relaySupervisor.test.ts`'s injected-fake idiom. **Use the real codec** (`encodeInnerFrame`/`decodeInnerFrame`/`base64Std*`) — assert actual wire bytes; mock only the two I/O boundaries.

**Harness (helpers, not full bodies):**
- *Fake supervisor factory* — captures `RelaySupervisorConfig`; exposes `emit(RelaySupervisorEvent)` to drive `connected`/`message`/`terminal` into the driver's handler; records `sent: string[]` (driver sends encoded inner frames as strings); a `stop()` that sets `stopped` and emits `terminal{1000,'stopped'}` (mirrors the real supervisor).
- *Fake async session factory* — returns `Promise.resolve(fakeSession)` (or a test-controlled deferred). The fake captures its `NoiseSessionConfig`, records `started`/`closed`, and lets the test drive the session by calling the captured `config.sendFrame(bytes)` (simulate msg 1 / outbound transport frame) and `config.onEvent(...)` (simulate `handshake-complete`/`message`/`error`). `start()` sets `started` and calls `config.sendFrame(FAKE_MSG1)`; `sendMessage(pt)` calls `config.sendFrame(FAKE_SEALED)`; `onFrame(f)` records `received`.
- *`makeSink()`* — collects `RelaySessionEvent[]` + filter helpers.

**Scenarios (inputs → expected):**
1. **Connect → handshake → transport happy path (AC1/AC2/AC3).** Emit `connected`; flush the async create. Expect: a session created with the injected keys/`hello`, `start()` called, and `sent[0]` decodes to `{v:2, type:'noise_init', data: base64StdEncode(FAKE_MSG1)}`. Then session emits `handshake-complete{helloAck}` → sink has `{type:'handshake-complete', helloAck}`. Then `driver.sendMessage(P)` → `sent[1]` decodes to `{v:2, type:'noise_msg', data: base64StdEncode(FAKE_SEALED)}` (tag flipped for the non-first frame). Then emit `message` wrapping FAKE_INBOUND → the session's `onFrame` received exactly `base64StdDecode(data)`; session emits `message{plaintext}` → sink has `{type:'message', plaintext}`.
2. **Re-handshake on reconnect, no leaked state (AC4).** `connected` (session A, started, handshake-complete). `connected` again → A `close()`d, a **distinct** session B created + `start()`ed, and B's first frame is tagged `noise_init` again (`firstFrame` reset). Assert A ≠ B, `A.closed === true`, and a subsequent inbound `message` routes to B (never A).
3. **Terminal surfaces + tears down (AC3), parametrized over {4426, 4421, 4401}.** After handshake, emit `terminal{code}` → sink has `{type:'terminal', code, reason}` and the session was `close()`d. Then `sendMessage` is inert (no new `sent`).
4. **Session error surfaces (AC3).** After handshake, session emits `error{'transport-decrypt-failed'}` → sink has `{type:'error', reason:'transport-decrypt-failed'}`; not terminal.
5. **Inbound decode fail-closed (boundary).** With a live session, emit `message` carrying non-inner-frame junk bytes → the session's `onFrame` was **not** called and sink has `{type:'error', reason:'inbound-frame-decode-failed'}`.
6. **Outbound failure without throwing (boundary).** Trigger either an over-`MAX_FRAME_BYTES` outbound (fake session `sendMessage` emits a too-large frame) **or** `supervisor.send` throwing `RelayNotConnectedError` → sink has `{type:'error', reason:'outbound-frame-encode-failed'}` and the call did **not** throw back into the session.
7. **Async-create-gap buffering + ordering (seam).** Use a deferred `createSession`. Emit `connected` (create pending), then emit `message` **before** resolving. Resolve. Assert: `start()` ran first (msg 1 out), **then** the buffered frame replayed to `onFrame` — order preserved.
8. **Bounded pending (security §6).** With the create still pending, emit more than `MAX_PENDING_FRAMES` inbound frames; resolve. Assert only up to the cap replay to `onFrame`; excess dropped; no unbounded growth.
9. **`stop()` teardown + idempotency (AC4-adjacent).** After handshake, `driver.stop()` → `supervisor.stop()` called, sink has `terminal{1000,'stopped'}`, session `close()`d. A second `stop()` emits no second terminal.
10. **Log-free by construction (security).** Install the six-method `console` spy (`log/info/warn/error/debug/trace`), drive connect→handshake→transport→error, assert no spy called. (Inherited #29/#30 discipline.)

**Typecheck (`npm run typecheck`):** the `RelaySessionEvent`/`RelaySessionErrorReason` unions are exhaustively narrowed on `type`/`reason`; the config's DI seams type-match `createRelaySupervisor`/`createNoiseSession`.

## Open questions

- **Deferred vs immediate connect.** The driver dials on construction (supervisor idiom). If the consumer (#17/#18/#19 wiring) needs an explicit `start()` to control *when* dialing begins, that's a trivial future change (construct the supervisor lazily in a `start()` method). Deferred here to keep the adapter thin and consistent with the supervisor; the consumer constructs the driver when it wants to connect. Flag if the consumer ticket needs otherwise.
- **`MAX_PENDING_FRAMES` value.** Proposed 8. The happy path never buffers (daemon stays silent until msg 1), so the exact cap only bounds an anomalous/hostile flood; any small constant is fine. Developer picks; note it in the module.

## Security review

**Verdict:** PASS

The adversarial re-read surfaced one exploitable hole — an unbounded `pending` buffer a hostile on-path relay could flood during the async-create gap — which is **fixed inline** (Design → bounded `pending` at `MAX_PENDING_FRAMES`; Error handling §"Bounded pending buffer"; test scenario 8) before this verdict. No MUST FIX remains outstanding.

**Findings:**

- **[1 Trust boundaries]** No finding. One explicit untrusted→trusted boundary: the supervisor `message{frame}` handler, decoded through the #5 codec's fail-closed `decodeInnerFrame`→`base64StdDecode` (both throw `WireDecodeError`, never return partial/truncated). Downstream `session.onFrame(raw)` receives bytes that Noise then AEAD-verifies — a hostile relay cannot forge past the session. The inbound `inner.type` label is deliberately **not** branched on (Design → `message` step 3): the session state machine + Noise MAC decide interpretation, so a spoofed `type` cannot misroute. Renderer boundary: none crossed — the sink is a main-process in-process callback (see §4).
- **[2 Tokens/secrets]** No finding for this ticket. The static private key and the `hello` (which carries the device token as Noise early-data) are **injected** `Uint8Array`s held in main-process memory only, passed straight to `createNoiseSession`, never persisted, never logged, never placed in an error (reasons are static enum strings). Key generation/storage/rotation/revocation is **OUT OF SCOPE** → #42 (`safeStorage`), #43 (device static keypair), #10 (hello/pairing sourcing).
- **[3 File/storage]** N/A by design — the driver performs zero filesystem I/O. Pure in-memory composition; no path construction, no TOCTOU, no at-rest secret. Nothing to traverse or swap.
- **[4 Electron attack surface]** No finding. The module lives entirely in `src/main/transport/` and reaches no `BrowserWindow`, `contextBridge`, `ipcMain`, custom protocol, or navigation surface (AC + technical notes: "do not reach IPC / preload / renderer here"). Keys, socket, and handshake stay in the main process (CLAUDE.md "keep the transport out of the window"; ADR 0002). The sink is a plain callback owned by a later background-process consumer; the renderer-facing IPC bridge is **OUT OF SCOPE** → #17/#18/#19. Process-placement is a MUST-hold property and it holds.
- **[5 Cryptographic primitives]** No finding — and one positive invariant. The driver performs **no crypto**: it composes the vetted `createNoiseSession` (noise-c.wasm, #29/#30 RECOMMEND) unchanged; nothing here touches the handshake, key schedule, AEAD, or nonce counters. **Key/nonce-reuse invariant (security-load-bearing):** the AC-mandated fresh session per `connected` (new ephemeral, no v2 resume) is precisely what prevents `(key,nonce)` reuse across connections. The generation model enforces it — old session `close()`d on every `connected`, `firstFrame`/cipher state never carried, and the `sendFrame` gen-guard drops any stale session's writes so a superseded session can never send under an old key. Test scenario 2 ("re-handshake, no leaked state") is therefore both the AC4 check and the nonce-freshness guard. RNG: none used here (jitter/backoff RNG is the supervisor's).
- **[6 Network & I/O]** One finding, **fixed inline (SHOULD→addressed):** the async-create gap between a synchronous `connected` and the async `createNoiseSession` let a hostile relay flood inbound frames into an **unbounded** `pending` queue → memory-exhaustion. Fixed: `pending` capped at `MAX_PENDING_FRAMES`, excess dropped fail-safe (the legitimate daemon sends nothing before msg 1, so any deep pre-session queue is anomalous). Per-frame size cap (`ws maxPayload`), `wss://`/TLS, connect/idle timeouts, backoff, and the reconnect-storm mitigation (fatal `{4401,4421,4426}`→`terminal` halts re-dialing) are all **inherited unchanged** from #21/#22 — not this ticket's surface. The driver adds an outbound belt: `encodeInnerFrame` rejects >`MAX_FRAME_BYTES`.
- **[7 Error messages/logs]** No finding. Log-free by construction (no `console.*`; test scenario 10 enforces it with a six-method spy). Every `catch` **classifies to a static reason and drops the caught error object** — a codec/wasm error message can echo transcript/frame bytes, so it never reaches the sink or a log (classify-don't-forward, inherited #5/#7/#30). Sink error payloads carry only enum reason strings — never keys, tokens, plaintext, frames, or headers.
- **[8 Concurrency]** No finding — the meatiest surface, addressed by the generation model. The single async task (`createSession`) is fenced on both `.then` and `.catch` by `gen !== generation`, closing the check-then-act-across-`await` gap (a stale resolve closes itself and no-ops). Single-live-session is guaranteed (close-old-on-`connected` + gen guard) — no duplicate/stacked sessions, no stale-key send. The driver owns no timers/intervals (all the supervisor's) and no socket listeners (the supervisor's), so no leak/double-fire. Shutdown: `stop()`→`supervisor.stop()`→`terminal`→`session.close()`, one path; a mid-create `stop()`/`terminal` bumps generation so the in-flight session self-closes on resolve. Rapid `connected`→`connected` before the first resolves: the first session sees the gen bump, closes, and never `start()`s (test scenario 2 covers the reconnect case; the deferred-create harness in scenario 7 exercises the gap).
- **[9 Threat model alignment]** Desktop-specific threats: **(a) Malicious/compromised on-path relay** (content-blind but can drop/delay/reorder/flood) — survived: Noise AEAD stops plaintext leak/forgery, fail-closed decode drops malformed frames, the bounded `pending` buffer stops flood-during-gap exhaustion, and the supervisor's fatal-code→terminal stops reconnect storms. **(b) Hostile daemon response inside the session** — the session's `handshake-read-failed`/`transport-decrypt-failed` classify malformed frames; the driver forwards them and does **not** itself parse the decrypted Envelope — it delivers raw `plaintext: Uint8Array`, and defensive Envelope parsing is the consumer's edge (#19, already specced fail-closed). **(c) Renderer compromise reaching transport** — N/A: main-process-only, no IPC path exists to reach keys/socket. **(d) Token theft from disk** — OUT OF SCOPE → #42/#43. Upstream wire-protocol threats live in `pyrycode` ADR 025.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-04
