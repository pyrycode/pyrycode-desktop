# Noise relay driver

The **composition adapter that drives a Noise session over the reconnect supervisor** — the last transport-layer wiring, the seam that turns "a self-healing byte-pipe" plus "a Noise handshake+AEAD unit" into "a message travels encrypted to the daemon and the structured reply streams back." It sits between two primitives that know nothing of each other: the [relay supervisor](relay-supervisor.md) heals a relay connection across transient drops and classifies fatal close codes into one `terminal` event, but its frames are **opaque bytes**; the [Noise session](noise-session.md) performs the `Noise_IK_25519_ChaChaPoly_BLAKE2s` handshake and AEAD transport, but knows nothing of the **socket**. The driver is exactly the "**future Noise-handshake layer**" the supervisor doc names as its consumer.

Introduced in [#50](../codebase/50.md). It is a **thin composition of three proven primitives, consumed unchanged** — the [#22 supervisor](relay-supervisor.md), the [#7 session](noise-session.md), and the [#5 codec](wire-codec.md) — with **no new crypto**. It lives **entirely** in `src/main/transport/` ([ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md); CLAUDE.md "Keep the transport out of the window"). Keys, sockets, the handshake, and raw bytes never reach the renderer; the sink is a plain in-process callback the background-process consumer owns — nothing here touches IPC, the preload bridge, or the renderer.

## What it does

Gives the background process **one factory** — `createNoiseRelayDriver(config): NoiseRelayDriver` — that constructs a supervisor and, on **every** `(re)connect`, drives a **fresh** Noise session over it:

- **On each `connected`**, it creates a new Noise session and `start()`s its handshake (writing message 1 as `noise_init`). **No** session state — cipher, first-frame flag, or buffered frames — carries across connections. v2 has **no session resume** ([`pyrycode` mobile wire protocol](../decisions/0002-remote-head-over-relay-shared-wire.md): "session resumption is deferred"), so every reconnect is a new ephemeral and a new handshake.
- **Each inbound `message` frame** is decoded through the #5 codec (`decodeInnerFrame` → `base64StdDecode` of `.data`) and its raw Noise bytes fed to the session; **each outbound frame** the session emits is base64-std wrapped into an `InnerFrameV2` and sent via the supervisor — the handshake message-1 frame tagged `type: "noise_init"`, every later frame `type: "noise_msg"` — **except** the fresh `msg1` of an in-session rekey, re-armed to `noise_init` so the daemon routes it to its rekey responder (see § Rekey `noise_init` re-arm, [#112](../codebase/112.md)).
- **The combined lifecycle** — the session's `handshake-complete{helloAck}` and decrypted `message{plaintext}`, the supervisor's `terminal{code}` (incl. `4426`/`4421`/`4401`), and the session's + adapter's `error{reason}` — surfaces through **one typed sink** to the consumer above.
- **`sendMessage(plaintext)`** delegates a post-handshake app message to the current session (inert before handshake-complete / after terminal); **`stop()`** tears the whole thing down idempotently.

Keys and the `hello` early-data are **injected from above** (sourced later by [#42](secure-store.md)/[#43](device-keypair.md)/#10) — this ticket wires the plumbing, not the key sourcing, so it is self-contained and unit-testable with injected fake keys/`hello`.

Since [#83](../codebase/83.md), an optional **`loadDialConfig` provider** lets every *automatic* reconnect re-source both the connection headers and the session material from storage (a re-pair mid-session takes effect on the next reconnect). When it is absent, `connection`/`session` are reused on every reconnect exactly as before. See § Reload-per-dial.

## How it works

One new file, `src/main/transport/noiseRelayDriver.ts` (main-process only — it imports `codec.ts`, which uses Node `Buffer`, so it is never re-exported through a renderer barrel).

### Public surface

```ts
/** Sink reason set: the session's own reasons, plus the three adapter-boundary failures. */
export type RelaySessionErrorReason =
  | NoiseSessionErrorReason        // 'handshake-read-failed' | 'transport-decrypt-failed' | 'unexpected-frame'
  | 'inbound-frame-decode-failed'  // decodeInnerFrame / base64StdDecode threw at the relay boundary (fail-closed)
  | 'outbound-frame-encode-failed' // encodeInnerFrame over-cap, or supervisor.send threw (not connected)
  | 'session-load-failed'          // createNoiseSession rejected (NoiseLoadError / wasm timeout); also the #83 defensive null-material guard

/** The single typed sink to the background-process consumer above. Sealed union on `type`. */
export type RelaySessionEvent =
  | { type: 'handshake-complete'; helloAck: Uint8Array } // forwarded from the session
  | { type: 'message'; plaintext: Uint8Array }           // forwarded from the session (decrypted app frame)
  | { type: 'terminal'; code: number; reason: string }   // forwarded from the supervisor (incl. 4426/4421/4401)
  | { type: 'error'; reason: RelaySessionErrorReason }    // session errors + adapter-boundary errors

/** Noise key material + hello early-data for one dial's session, sourced from the paired-server record. */
export interface SessionMaterial {          // was the inline type of NoiseRelayDriverConfig.session (#83 rename)
  staticPrivateKey: Uint8Array
  remoteStaticPublicKey: Uint8Array
  prologue: Uint8Array
  hello: Uint8Array
  loadTimeoutMs?: number
}

/** One dial's fully-derived config: the connection half (headers) + the session half (key/hello). */
export interface DialConfig {
  connection: Omit<RelayConnectionConfig, 'onEvent'>
  session: SessionMaterial
}

/** Load the current paired-server record → derive one dial's config (#83). `null` = no record (fail closed). */
export type DialConfigProvider = () => Promise<DialConfig | null>

export interface NoiseRelayDriverConfig {
  connection: Omit<RelayConnectionConfig, 'onEvent'>  // relay params for the FIRST dial; driver owns the supervisor's onEvent
  session: SessionMaterial                            // FIRST dial's key material, injected from above (#42/#43/#10)
  onEvent: (event: RelaySessionEvent) => void         // the single typed sink; must not throw
  fatalCloseCodes?: ReadonlySet<number>               // passthrough; default DEFAULT_FATAL_CLOSE_CODES
  loadDialConfig?: DialConfigProvider                 // #83: set → every AUTOMATIC reconnect re-sources both halves
  createSupervisor?: (config: RelaySupervisorConfig) => RelaySupervisor       // DI seam; real factory by default
  createSession?: (config: NoiseSessionConfig) => Promise<NoiseSession>       // DI seam; real factory by default
}

export interface NoiseRelayDriver {
  sendMessage(plaintext: Uint8Array): void  // post-handshake send; inert before handshake-complete / after terminal
  stop(): void                              // idempotent teardown: stop supervisor → one terminal, close session
}

export const MAX_PENDING_FRAMES = 8         // caps the async-create-gap inbound buffer (security)

export function createNoiseRelayDriver(config: NoiseRelayDriverConfig): NoiseRelayDriver
```

- **The driver *constructs* the supervisor (it does not receive one).** The supervisor's `onEvent` is fixed at construction and is where classification routing lives, so the driver must build the supervisor with **its own** handler. `createSupervisor` defaults to `createRelaySupervisor` and is called with **one argument** — the test-only `timing` seam is never passed, so the production wire-spec cadence stays locked. Construction **dials immediately** (supervisor idiom); the consumer constructs the driver when it wants to connect.
- **The DI seams (`createSupervisor` / `createSession`) default to the real factories** and exist only so tests inject fakes at the two I/O boundaries while exercising the **real** codec.

### The generation model (the seam this design turns on)

Supervisor events are **synchronous**, but `createNoiseSession` is **async**. A `generation` counter fences every connection so a late-resolving or stale session can never install itself or send under a superseded key.

- `generation: number` — bumped on every `connected`, and on `terminal`/`stop`. Each session and each per-connection closure captures the `gen` it was created under; a mismatch means it has been superseded and must no-op.
- `session: NoiseSession | null` — the live session for the current generation; `null` during the async-create gap, before first connect, and after terminal.
- `pending: Uint8Array[]` — raw Noise frames that arrived during the async-create gap, replayed **in order** once the session resolves. **Bounded** at `MAX_PENDING_FRAMES` (excess dropped fail-safe).

Guarantees: **exactly one live session**, ever. A stale in-flight `createSession` that resolves after a superseding `connected`/`terminal`/`stop` sees `gen !== generation`, closes itself **before** `start()` (so it never sends a spurious `noise_init`), and no-ops — it never installs, never `start()`s, never sends. The `sendFrame` gen-guard is a deterministic second layer: belt (don't start a superseded session), suspenders (drop its writes if it somehow does). Both `.then` **and** `.catch` are fenced, so a stale rejection cannot surface a spurious `session-load-failed`.

### Reload-per-dial (`resolveConnection`, [#83](../codebase/83.md))

When `config.loadDialConfig` is set, the driver re-sources the record on every *automatic* supervisor reconnect. Two module-locals plus one wrapper carry it, with **one `load()` per re-dial feeding both halves** so the connection headers and the session key can never split across a mid-dial re-pair:

- **`let firstConnect = true`** — gates the *first* connect onto the construction-time `config.session` (no reason to reload the record microseconds after the consumer already loaded it for this dial).
- **`let pendingSession: SessionMaterial | null = null`** — the session material the latest reload stashed; single-writer per dial (`resolveConnection` writes during a re-dial, `onConnected` reads after it connects; supervisor dials never overlap).
- **`resolveConnection`** (built only when `loadDialConfig` is set; else `undefined`, passed to `createSupervisor` alongside `connection`) is the **single per-dial `load()`**: `const dc = await loadDialConfig(); pendingSession = dc?.session ?? null; return dc?.connection ?? null`. The supervisor gets the fresh `connection`; `onConnected` gets `pendingSession` — from the *same* record snapshot. It **MUST catch a thrown `loadDialConfig` and return `null`** (drop the caught object — a `decodeServerKey`/keychain/`MalformedPairedServerRecordError` message could echo the key/token; null `pendingSession` so a stale prior session is never reused). This catch is **load-bearing**: without it the throw escapes as an unhandled rejection at the supervisor's `await` (AC3 violation). A malformed record on reconnect therefore fails closed *identically* to the no-record case.
- **`onConnected`** selects `material = config.loadDialConfig && !firstConnect ? pendingSession : config.session` then flips `firstConnect = false`. A `material === null` (structurally unreachable — the supervisor fail-closes on a null `resolveConnection` *before* it emits `connected`) is defended: emit `{ type: 'error', reason: 'session-load-failed' }` rather than dereference null. Otherwise the existing `createSession(...)` runs with `material`.

### Data flow

```
construct ─▶ supervisor dials
  connected ─▶ ++gen ─▶ close old ─▶ createSession (async)
                                       └▶ resolve ─▶ start() [msg1 → noise_init out] ─▶ replay pending (in order)
  message(frame) ─▶ decode(#5) ─▶ session.onFrame(raw)          [msg2 in ─▶ handshake-complete{helloAck} → sink]
  sendMessage(pt) ─▶ session.sendMessage ─▶ sendFrame [→ noise_msg out]
  message(frame) ─▶ decode ─▶ session.onFrame ─▶ message{plaintext} → sink
  drop ─▶ (supervisor absorbs, re-dials) ─▶ connected ─▶ ++gen ─▶ close old session ─▶ FRESH handshake
  fatal close / stop() ─▶ terminal{code} ─▶ close session ─▶ sink terminal
```

The **outbound tagger** is **two** closure-local latches created **inside** the `connected` handler, both `false`/`true`-reset per connection with no shared mutable state across reconnects, both **one-shot** (`type = firstFrame || rekeyInitPending ? 'noise_init' : 'noise_msg'`, both cleared after each send): `let firstFrame = true` — the connection's very first `sendFrame`, always handshake message 1 — and `let rekeyInitPending = false` — the fresh `msg1` of an in-session rekey (see § Rekey `noise_init` re-arm). The **inbound `inner.type` label is deliberately not branched on** — the session's state machine plus Noise AEAD decide interpretation, so a hostile `type` cannot misroute.

### Rekey `noise_init` re-arm ([#112](../codebase/112.md))

The daemon routes the rekey handshake by the `InnerFrameV2.type` (pyrycode #453): an open-state `noise_init` → its rekey responder; an open-state `noise_msg` → transport-decrypt, where the raw IK handshake bytes fail AEAD → **WS 4421** close. [#111](noise-session.md#rekey-re-handshake--atomic-cipher-swap-111) makes the session run a fresh in-session IK handshake as INITIATOR on a recognized `rekey_request`, but that fresh `msg1` — **not** the connection's first frame — would default to `noise_msg` and be mis-routed. So the driver re-arms `noise_init` for exactly that one frame, driven by the session's **synchronous emit-then-send ordering**: within one `onFrame` turn the session calls `config.onEvent({type:'rekey-requested'})` (→ the driver's `route`) **then** `beginRekey()` → `config.sendFrame(msg1)` (→ the driver's `sendFrame`). So `route` arms the one-shot `rekeyInitPending` latch (its sole added side-effect — the trigger is still dropped from the sink, see below) and the very next `sendFrame` consumes it. A dedicated latch — not overloading `firstFrame`'s documented "connection's first frame" meaning — keeps both signals self-documenting; both `route` and `sendFrame` capture the same connection `gen`, so the arm and the consume are always in the same generation. Threading a frame-type through the session's `sendFrame(frame: Uint8Array)` contract was the rejected alternative — it would ripple into the session, the interop `driveClient`, and `fakeDaemon`; the latch keeps the change driver-local (~5 lines). The driver unit test drives the exact emit-then-send sequence and asserts the rekey `msg1` tags `noise_init` + the latch is one-shot — the **deterministic framing oracle** (the e2e can't be, since `fakeDaemon` routes by state, not by `type`).

`stop()` calls `supervisor.stop()`, which synchronously drives one `terminal{code:1000, reason:'stopped'}` back through the driver's `terminal` handler — **one teardown path**, no duplication, idempotent via the supervisor's terminal guard.

## Error handling

Every `catch` maps to a **static reason** and **drops** the caught error object (a codec/wasm error message can echo transcript/frame bytes, so it never reaches the sink or a log — classify-don't-forward). The driver **classifies and surfaces**; it does not decide whether an `error` tears down — policy is the consumer's.

| Failure | Surfaced as | Terminal? |
|---|---|---|
| Malformed inbound frame (`decodeInnerFrame`/`base64StdDecode` throw) | `error{'inbound-frame-decode-failed'}`, frame dropped | No |
| Outbound over-cap (`encodeInnerFrame` > `MAX_FRAME_BYTES`) or `supervisor.send` throws (not connected) | `error{'outbound-frame-encode-failed'}` (caught, **not** thrown back into the session) | No |
| `createNoiseSession` rejects (`NoiseLoadError` / wasm timeout) | `error{'session-load-failed'}` (gen-guarded) | No — supervisor still live |
| Reload on reconnect throws or finds no record (`loadDialConfig` throws / `load()` → `null`, #83) | `resolveConnection` catches → returns `null` → supervisor `terminal{NO_PAIRED_RECORD_CLOSE_CODE}` (drops the caught object; nulls `pendingSession`) | **Yes** — fail closed via the supervisor, no unhandled rejection |
| Handshake read / transport decrypt / unexpected frame | `error{reason}` forwarded verbatim from the session | No — session decides |
| Fatal close `4426`/`4421`/`4401`, or clean `stop()` | `terminal{code, reason}` | **Yes** — single, close session |

## Security properties

Ticket carries `security-sensitive`; the architect's security-review verdict is **PASS** (see the spec's `## Security review`) and code review confirmed it on the diff.

- **Fresh-handshake-per-connect is a security invariant, not just correctness.** A new ephemeral and no carried cipher state per `connected` is precisely what prevents `(key, nonce)` reuse across connections. The generation model enforces it: old session `close()`d on every `connected`, `firstFrame`/cipher/pending state never carried, and the `sendFrame` gen-guard drops any stale session's writes. The re-handshake test is therefore both the AC4 check and the nonce-freshness guard.
- **One fail-closed untrusted→trusted boundary.** The supervisor `message{frame}` handler decodes through the #5 codec's fail-closed `decodeInnerFrame`→`base64StdDecode` (both throw, never return partial/truncated); the downstream `session.onFrame(raw)` bytes are then AEAD-verified by Noise — a hostile on-path relay cannot forge past the session, and a spoofed inner `type` cannot misroute (the label is never branched on).
- **Bounded pending buffer closes a memory-exhaustion vector.** The async-create gap between a synchronous `connected` and the async `createNoiseSession` would otherwise let a hostile relay flood inbound frames into an unbounded queue. `pending` is capped at `MAX_PENDING_FRAMES = 8` (the legitimate daemon sends nothing before it receives message 1, so any deep pre-session queue is anomalous); excess is dropped fail-safe.
- **Log-free by construction; static reasons only.** No `console.*`; sink `error` payloads carry only enum reason strings — never keys, tokens, plaintext, frames, or headers. Pinned by a six-method `console`-spy assertion across connect → handshake → transport → error.
- **No renderer/IPC surface.** Main-process only; no `BrowserWindow`, `contextBridge`, `ipcMain`, preload, or navigation surface. The static private key and the `hello` (which carries the device token as Noise early-data) are injected `Uint8Array`s held in main-process memory only, passed straight to `createNoiseSession`, never persisted, never logged.

## Edge cases and limitations

- **Not wired to the renderer yet.** The sink is a plain in-process callback owned by a **later** background-process consumer; the renderer-facing IPC bridge (session store via [#17](command-channel.md)/[#18](daemon-event-channel.md)/[#19](daemon-event-bridge.md)) is a later ticket. Nothing imports the driver yet — it is a leaf module.
- **Dials on construction.** The driver connects when constructed (supervisor idiom). If the consumer wiring needs an explicit `start()` to control *when* dialing begins, that is a trivial future change (construct the supervisor lazily in a `start()` method); deferred to keep the adapter thin.
- **`sendMessage` before handshake-complete is a silent no-op** — the driver is inert with no session, and the session is itself inert before transport state (matches the session contract). Frames sent during a reconnect gap are not queued; v2 re-handshakes and the layer above re-sends.
- **A throwing sink `onEvent` is a caller bug, not defended** — a trusted internal sink, per the #7/#22 `onEvent` discipline.
- **`MAX_PENDING_FRAMES` is set to `8`** — the architect's proposed value. The happy path never buffers, so the exact cap only bounds an anomalous/hostile pre-session flood.
- **The session's `rekey-requested` trigger is still dropped from the sink, but now arms the framing latch ([#108](../codebase/108.md) → [#112](../codebase/112.md)).** Recognition of the daemon's `rekey_request` control frame added a bare `rekey-requested` variant to [`NoiseSessionEvent`](noise-session.md#rekey-request-recognition-108), which broke the `NoiseSessionEvent ⊆ RelaySessionEvent` subset `route` relies on; the `if (event.type === 'rekey-requested')` branch **before** `emit` restores it. The trigger is deliberately **not** added to `RelaySessionEvent` (it stays a pure in-main signal) — so the branch still `return`s without emitting, but #112 gave it one side-effect first: `rekeyInitPending = true`, arming the `noise_init` re-arm for the fresh rekey `msg1` (§ Rekey `noise_init` re-arm). Observable sink behavior is unchanged, so #108's "trigger not propagated" test stays green.

## Related

- [#50 codebase notes](../codebase/50.md) — implementation summary, patterns, lessons.
- [#112 codebase notes](../codebase/112.md) — the `rekeyInitPending` latch that re-arms `noise_init` for the fresh rekey `msg1` (§ Rekey `noise_init` re-arm) + the assembled-stack e2e that drives this driver through a daemon-initiated rekey.
- [Relay supervisor](relay-supervisor.md) / [#22](../codebase/22.md) — the self-healing byte-pipe the driver constructs and drives; explicitly names this driver as its "future Noise-handshake layer" consumer, and owns the reconnect loop / backoff / fatal-code classification the driver does **not**. Its `resolveConnection` provider ([#83](../codebase/83.md)) is the driver's wrapper over `loadDialConfig`.
- [#83 codebase notes](../codebase/83.md) / [Daemon connection](daemon-connection.md) — reload-per-dial: the `SessionMaterial`/`DialConfig`/`DialConfigProvider` types, the `resolveConnection` wrapper, and `onConnected`'s reloaded-material selection added here; the `loadDialConfig` provider is constructed in `daemonConnection`.
- [Noise session](noise-session.md) / [#7](../codebase/7.md) — the per-connection handshake+AEAD unit the driver creates fresh on every connect; its `sendFrame`-out / `onEvent`-in contract is what makes the driver a thin adapter.
- [Wire codec](wire-codec.md) / [#5](../codebase/5.md) — the `encode/decodeInnerFrame` + `base64Std*` framing composed between the supervisor's opaque bytes and the session's Noise bytes; `MAX_FRAME_BYTES` is the outbound over-cap trigger.
- [#30 codebase notes](../codebase/30.md) — the Go↔JS interop spike whose `runLive` harness proved this exact adapter shape (`noise_init`/`noise_msg` tagging, base64-std framing) against the single-shot #21 connection; #50 productionizes it over the #22 supervisor.
- [Relay connection](relay-connection.md) / [#21](../codebase/21.md) — the single-shot socket beneath the supervisor.
- [Device static keypair](device-keypair.md) / [#43](../codebase/43.md), [Secure store](secure-store.md) / [#42](../codebase/42.md) — the eventual sources of the injected `staticPrivateKey`.
- [Hello exchange](hello-exchange.md) / [#10](../codebase/10.md) — builds the injected `session.hello` bytes and parses the `handshake-complete{helloAck}` bytes; the consumer slice (#62) wires it into this driver's injection seam.
- [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — remote head over the relay, transport isolated in the background process; the load-bearing suite pin and "a mismatch fails the handshake silently."
- Daemon peer (QMD `pyrycode-docs`): `internal/relay` V2 session manager (Noise_IK handshake + open-state dispatch) and `protocol-mobile.md` (v2; "session resumption is deferred") — the Go side this driver's fresh-per-connect handshake speaks to.
