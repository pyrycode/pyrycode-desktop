# 62 — Connect the transport: drive the Noise relay driver and surface a completed handshake

**Size:** S (confirmed — PO sized S). One new production module + one composition-root edit; no consumer cascade.

**No UI surface.** This is background-process transport wiring that produces a typed `DaemonEvent`. The renderer reflection (connection status in the window) is owned by the already-merged bridge/store (#19/#2) and verified downstream / in the e2e harness, not here. The ticket body carries no `## Figma` section and the work is not UI-visible, so there is no Design source section.

## Context

The Noise relay driver (#50, `createNoiseRelayDriver`) is a leaf module: nothing imports it yet. It takes device keys + the `hello` early-data **injected from above**, runs a fresh `Noise_IK` handshake on every connect, and surfaces `handshake-complete{helloAck}` / `message{plaintext}` / `terminal` / `error` through one typed sink. Its own doc names the missing piece: *"the sink is a plain in-process callback owned by a **later** background-process consumer."* **This ticket is that consumer.**

It sources the device static key (#43 `ensure()`), the paired-server record (#44 `load()`), builds the `hello` via #10's `buildClientHello`, constructs and drives the driver, and on `handshake-complete` parses the ack via #10's `parseHelloAck` and emits a typed `connected{ack}` on the daemon-event channel (#18 `emitDaemonEvent`). The renderer bridge/store (#19) already translate `connected{ack}` into a completed-handshake state the window reads — this ticket produces the event that feeds them; **it does not touch the renderer.**

This is one atomic composition: `createNoiseRelayDriver({connection, session, onEvent})` takes the sink as a *required constructor argument*, so sourcing the inputs, constructing the driver, and mapping its events are a single construction site with no Strangler-Fig seam. Splitting would leave a non-deployable intermediate (a driver whose events route nowhere). Confirmed atomic; no split.

## Files to read first

- `src/main/transport/noiseRelayDriver.ts:44-96` — `NoiseRelayDriverConfig` (the `connection` / `session` / `onEvent` shape we construct), `RelaySessionEvent` union (the four events we map), and `createNoiseRelayDriver` (dials on construction).
- `src/main/transport/noiseSession.interop.test.ts:388-456` — **the canonical reference composition.** `runLive` builds exactly this wiring by hand: relay headers (`X-Pyrycode-Server`, `X-Pyrycode-Token`, `User-Agent`), `base64StdDecode(serverStaticPub)`, `EMPTY` prologue, `buildClientHello`-shaped hello, and the driver-event → observation loop. Mirror its header/key/prologue choices; productionize the sourcing.
- `src/main/transport/helloExchange.ts:23-113` — `ClientHelloInput`, `buildClientHello` (what inputs we source), `parseHelloAck` (fail-closed, throws `WireDecodeError`).
- `src/main/deviceKeypair.ts:29-51,100-137` — `DeviceKeyPair` / `DeviceKeypairStore.ensure()`; the private key is `pair.privateKey` (raw 32B).
- `src/main/pairedServerStore.ts:31-64,120-138` — `PairedServerRecord` (= `QrPayload`: `{server, relay, token, server_static_pubkey}`), `load()` (→ record | `null`), `MalformedPairedServerRecordError`.
- `src/main/emitDaemonEvent.ts` (whole file, 26 lines) — `emitDaemonEvent(sink, event)` + `DaemonEventSink` (`{ webContents: { send(channel, event) } }`); a `BrowserWindow` satisfies it structurally.
- `src/shared/ipc/events.ts:31-37` — `DaemonEvent` union; the arms we emit are `connecting`, `connected{ack: HelloAckPayload}`, `failed{error: ErrorPayload}`.
- `src/shared/wire/types.ts:80-125` — `HelloAckPayload`, `ErrorPayload` (`{code, message, retryable, retry_after_s?}`), `QrPayload`.
- `src/main/transport/codec.ts:51-71` — `base64StdDecode` (strict; throws `WireDecodeError` on bad base64; **does not check length** — we add the 32-byte check).
- `src/main/index.ts:85-116` — the composition root. It already builds `secureStore` + `pairedServerStore`; we **reuse** `pairedServerStore`, add a `deviceKeypairStore`, capture the window, start on `did-finish-load`, stop on `will-quit`.
- `src/main/noiseKeyPairGenerator.ts:18` — `noiseKeyPairGenerator(): KeyPairGenerator`, the production keygen for the device store.
- `src/renderer/src/store/sessionStore.ts:15-17,93-100,110-111` — store initial state is `disconnected`; `failed` → `{type:'error'}`, `connecting`/`connected`/`disconnected` map 1:1. Confirms the mapping and that a missed early `connecting` is benign.
- `docs/knowledge/features/noise-relay-driver.md` — the driver's generation model, fresh-handshake-per-connect security invariant, and error-classification table (the reasons we receive on `error`).

## Design

### New module: `src/main/daemonConnection.ts`

**Placement rationale.** This is the composition/wiring layer *above* transport. It imports the driver (`src/main/transport/`) **and** `emitDaemonEvent` + `DaemonEvent` (the IPC layer). The `src/main/transport/` directory is deliberately IPC-free — no transport module references `emitDaemonEvent` or `DaemonEvent`. So this consumer must live at top-level `src/main/` (alongside the stores, `emitDaemonEvent.ts`, and `index.ts`), not under `transport/`, to preserve that boundary. It is main-process only; it transitively imports `codec.ts` (Node `Buffer`), so it can never reach the renderer bundle.

**Public surface (contract sketch — the developer writes the bodies):**

```ts
export interface DaemonConnectionDeps {
  deviceKeypair: DeviceKeypairStore          // .ensure() → device static private key
  pairedServer: PairedServerStore             // .load() → record | null
  sink: DaemonEventSink                       // emitDaemonEvent target (the BrowserWindow)
  deviceName: string                          // sourced at the root (os.hostname())
  clientVersion: string                       // sourced at the root (app.getVersion())
  now?: () => string                          // RFC3339 clock for the hello ts; default () => new Date().toISOString()
  createDriver?: (config: NoiseRelayDriverConfig) => NoiseRelayDriver  // DI seam; default createNoiseRelayDriver
}

export interface DaemonConnection {
  start(): void   // idempotent; emits `connecting`, then sources inputs + constructs the driver
  stop(): void    // idempotent teardown: stop the driver; suppress the resulting terminal
}

export function createDaemonConnection(deps: DaemonConnectionDeps): DaemonConnection
```

`start()` is synchronous-returning but kicks off an internal `async` bootstrap. `connecting` is emitted **synchronously** at the top of `start()` (before any `await`), satisfying AC3 "connecting is emitted when the connect begins."

### The bootstrap (what `start()` drives)

Behaviour, in order — no code body, the steps are the contract:

1. Guard: if already started or already stopped, no-op (single explicit connect; reconnect-on-reload is #34).
2. Emit `{ type: 'connecting' }` synchronously via `emitDaemonEvent`.
3. `const record = await pairedServer.load()`. If `null` → emit `failed('not-paired')`, return. (AC4)
4. `const pair = await deviceKeypair.ensure()`.
5. `const remoteStaticPublicKey = decodeServerKey(record.server_static_pubkey)` — `base64StdDecode` then require `.length === 32` (throws on bad base64 or wrong length). (AC1, AC4)
6. `const hello = buildClientHello({ id: 1, ts: now(), deviceName, clientVersion, token: record.token })`. `capabilities`/`lastSeenTs` omitted (per #10 — never hardcode `interactive`; backfill anchor is #34). (AC1)
7. If `stopped` since step 2, return without constructing the driver (stop() raced the bootstrap; see § State + concurrency).
8. Construct the driver via `createDriver(config)` and retain the handle. The driver dials on construction. (AC1)
9. Any throw across steps 3–8 (a rejected `load()`/`ensure()`, `MalformedPairedServerRecordError`, bad base64, wrong-length key, driver construction) is caught by a **single** `try/catch` around the bootstrap and mapped to a `failed{...}` event — never an unhandled rejection or crash. (AC4)

**Driver config assembled in step 8:**

| Config field | Value | Source / note |
|---|---|---|
| `connection.url` | `record.relay` | verbatim (pairing already validated wss + allowlisted host in #52) |
| `connection.headers` | `{ 'X-Pyrycode-Server': record.server, 'X-Pyrycode-Token': record.token, 'User-Agent': `pyrycode-desktop/${clientVersion}`, 'X-Pyrycode-Device-Name': deviceName }` | **matches the live-validated mobile contract** (`pyrycode-mobile` `OkHttpRelayTransport.kt:102-107`) field-for-field. The relay requires a non-empty `X-Pyrycode-Token` but *ignores its value under v2* — the real auth token also rides inside the encrypted `hello`, and the Noise static-key handshake is the real gate. The token-in-header exposure to the on-path relay is mitigated by log-freedom (mobile omits `HttpLoggingInterceptor` for exactly this reason). **Do not deviate to a placeholder** without a matching mobile/relay change (CLAUDE.md no-drift; risks a silent handshake break). `X-Pyrycode-Device-Name` is non-secret and included for parity |
| `session.staticPrivateKey` | `pair.privateKey` | raw 32B device static (AC1) |
| `session.remoteStaticPublicKey` | `decodeServerKey(...)` | raw 32B (AC1) |
| `session.prologue` | `new Uint8Array(0)` | zero-length matches the daemon (AC1) |
| `session.hello` | `buildClientHello(...)` output | token + identity early-data (AC1) |
| `onEvent` | `onDriverEvent` | the mapping below |

Optional fidelity note: the developer MAY pass `connection.maxFrameBytes: MAX_FRAME_BYTES` (256 KiB, from `shared/wire/types`) to tighten to the v2 cap. The `relayConnection` default (1 MiB) already bounds inbound frames, so this is fidelity, not a security gate.

### Driver-event → DaemonEvent mapping (`onDriverEvent`)

The single choke point. `RelaySessionEvent` → `DaemonEvent`:

| `RelaySessionEvent` | Action | AC |
|---|---|---|
| `handshake-complete{helloAck}` | `try { ack = parseHelloAck(helloAck) } catch { emit failed('malformed-hello-ack'); return }` → `emit { type: 'connected', ack }` | AC2 |
| `message{plaintext}` | **No-op / TODO(#12).** The streamed-message decode/route is out of scope; leave a comment naming #12. | Notes |
| `terminal{code, reason}` | if `stopping` → **suppress** (clean local teardown, window is going away); else `emit failed('connection-closed', code)` | AC3 |
| `error{reason}` | `emit failed(reason)` — `reason` is a static enum string, safe to surface as the error `code` | AC3 |

**Why `failed` for every non-clean end (not `disconnected`).** The store's `disconnected` means "we deliberately stopped"; every other non-`connected` outcome here is a failure-to-establish or an authoritative drop the user should see. `DaemonEvent.failed` carries an `ErrorPayload{code, message, retryable}`, letting the UI distinguish *why* even at milestone-1. `disconnected` is intentionally **not** produced by this ticket — the clean `stop()` path emits nothing (the window is tearing down on quit). Richer failed-vs-disconnected + per-drop status choreography is deferred to #34/#35. This is the minimal mapping AC3 blesses ("disconnected (or failed)").

**ErrorPayload construction — secret-free by construction.** Every `failed` carries a static category `code` + a fixed generic `message` + `retryable: false` (no auto-retry is wired; #34 owns retry). The categories:

- `not-paired` — no record (`load()` → `null`)
- `connect-failed` — malformed record / bad base64 key / wrong-length key / keychain unavailable / driver construction threw (the single catch-all from the bootstrap `try/catch`)
- `malformed-hello-ack` — `parseHelloAck` threw
- `connection-closed` — driver `terminal` (fatal close); the numeric close `code` (a protocol constant, e.g. 4426) MAY appear in `message` — it is not a secret. The supervisor's `reason` **string is not forwarded** (conservative: avoids reasoning about whether a relay-controlled close reason could echo anything).
- the driver `error` reason enum verbatim (`session-load-failed` | `inbound-frame-decode-failed` | `outbound-frame-encode-failed` | `handshake-read-failed` | `transport-decrypt-failed` | `unexpected-frame`) — all static, all safe

No emitted `DaemonEvent` ever carries the token, a key, the pubkey, the hello bytes, or a raw frame. The only payloads that cross are `connecting` (empty), `connected{ack}` (the four public handshake fields), and `failed{error}` (static codes). (AC5)

### Composition-root wiring (`src/main/index.ts`)

Small, additive changes inside the existing `app.whenReady().then(...)`:

- **`createWindow()` returns the `BrowserWindow`** instead of `void` (capture the handle for the sink). No other change to `createWindow`'s body; the `app.on('activate')` re-create path stays as-is (see Open questions for the re-activation limitation).
- Build a `deviceKeypairStore` reusing the **already-constructed** `secureStore`:
  `createDeviceKeypairStore({ secureStore, generator: noiseKeyPairGenerator() })`.
- Reuse the **already-constructed** `pairedServerStore` (no second store).
- Construct the connection after the window: `createDaemonConnection({ deviceKeypair, pairedServer, sink: mainWindow, deviceName: os.hostname(), clientVersion: app.getVersion() })`.
- Start on first load, once: `mainWindow.webContents.once('did-finish-load', () => connection.start())`. This defers the connect until the renderer document + scripts have loaded (so the renderer's `useDaemonEventBridge` subscription is in place before the load-bearing `connected` event, which arrives only after a network round-trip). `.once` (not `.on`) avoids re-firing on a dev HMR reload.
- Tear down on quit: `app.on('will-quit', () => connection.stop())` (a second `will-quit` listener alongside the existing `unregisterPairing()` one — both fire).

## State + concurrency model

- **No store.** This module holds three locals: `started: boolean`, `stopped: boolean`, `driver: NoiseRelayDriver | null`. The single source of session state lives in the renderer's `sessionStore` (#2); this module only *emits* events into it via IPC. No parallel mutable state.
- **The `start()`/`stop()` race** is the one concurrency concern, and it is the same class the driver solves (sync event vs async create), simplified to a single connect. `stop()` sets `stopped = true` then calls `driver?.stop()`. The async bootstrap checks `stopped` **immediately before** the synchronous `createDriver(...)` call (step 7). Because JS is single-threaded and only yields at `await`, `stop()` can only interleave at the bootstrap's await points: if it ran during an earlier `await`, `stopped` is `true` at step 7 → the driver is never constructed; if it runs after step 8, `driver` is set → it is torn down. No gap, no orphaned driver.
- **Driver teardown** is the driver's own idempotent `stop()` (stops the supervisor → one `terminal{1000,'stopped'}` → our `terminal` handler, suppressed because `stopping`). Nothing else to cancel here — the supervisor owns the socket, timers, and listeners.
- **Transient reconnects are invisible here.** The supervisor absorbs transient drops and re-dials without surfacing `terminal`; on reconnect the driver runs a fresh handshake and fires another `handshake-complete` → we re-emit `connected`. During the gap the UI stays on its last status. Per-drop `connecting`/`disconnected` choreography is #34/#35.
- **Fresh-handshake-per-connect is preserved unchanged** — it is the driver's invariant (new ephemeral, no carried cipher/nonce state per `connected`). This consumer injects a **fixed** `hello`/key set once at connect; the driver re-runs the handshake with fresh ephemerals each time. Reusing the same `hello` bytes across reconnects is safe: Noise provides handshake freshness; the daemon does not replay-check the hello `ts` at v2 milestone; per-dial record reload + fresh hello is #34.

## Error handling

Every failure surfaces as a non-connected `DaemonEvent`; nothing throws out of the module.

| Failure mode | Layer | Surfaced as |
|---|---|---|
| No paired record (`load()` → `null`) | bootstrap step 3 | `failed('not-paired')` |
| Malformed record (`MalformedPairedServerRecordError`) | bootstrap `try/catch` | `failed('connect-failed')` |
| Bad base64 / wrong-length `server_static_pubkey` | `decodeServerKey` throw → `try/catch` | `failed('connect-failed')` |
| Keychain unavailable (`ensure()`/`load()` reject) | bootstrap `try/catch` | `failed('connect-failed')` |
| Malformed `hello_ack` (`parseHelloAck` throws `WireDecodeError`) | `onDriverEvent` handshake-complete arm | `failed('malformed-hello-ack')` |
| Driver `error{reason}` (session load, frame decode, decrypt, …) | `onDriverEvent` error arm | `failed(reason)` |
| Fatal close (`terminal{code}`, e.g. 4426/4421/4401) | `onDriverEvent` terminal arm, not stopping | `failed('connection-closed', code)` |
| Clean `stop()` (app quit) → `terminal{1000}` | `onDriverEvent` terminal arm, stopping | suppressed (no emit) |

**Log-free by construction.** No `console.*` anywhere (a stray log could echo the token, keys, or handshake bytes). All diagnostics travel as the typed `failed` event with static-only payloads. Pinned by a six-method `console`-spy assertion across the happy path and every reject branch (the standing guardrail inherited from #5/#7/#10/#50).

## Testing strategy

`src/main/daemonConnection.test.ts` — unit tests with injected fakes (`npm test`, vitest). No Electron, no wasm, no keychain: fake `deviceKeypair.ensure()` → fixed 32B pair; fake `pairedServer.load()` → configurable; `createDriver` → a fake that captures the config and exposes a handle to fire `RelaySessionEvent`s + records `stop()`; `sink` → `{ webContents: { send: vi.fn() } }`; fixed `now`. Assert against the second arg of each `send` call (the `DaemonEvent`), mirroring `emitDaemonEvent.test.ts`.

Scenarios (bullet form — developer writes the test code in the project idiom):

- **Happy path.** `start()` emits `connecting` **synchronously** (assert before awaiting). After the bootstrap microtask, the driver is constructed with the expected config: `url === record.relay`; headers carry `X-Pyrycode-Server === record.server`, `X-Pyrycode-Token === record.token`, a `User-Agent`; `session.staticPrivateKey === pair.privateKey`; `session.prologue.length === 0`. Then fire `handshake-complete{helloAck}` (a valid encoded `hello_ack`) → emits `connected{ack}` with the parsed `HelloAckPayload`.
- **hello sourced from record + #10.** The `session.hello` passed to the driver decodes (via `decodeEnvelope`) to a `type:'hello'` envelope whose payload carries `record.token` — proves the token is sourced from the record and `buildClientHello` is used (not hand-rolled).
- **server key decode.** `session.remoteStaticPublicKey` equals `base64StdDecode(record.server_static_pubkey)` and is exactly 32 bytes.
- **not-paired.** `load()` → `null` → emits `connecting` then `failed` (code `not-paired`); `createDriver` never called.
- **malformed record.** `load()` rejects `MalformedPairedServerRecordError` → `failed('connect-failed')`; no throw escapes; driver not constructed.
- **wrong-length pubkey.** `server_static_pubkey` decodes to ≠ 32 bytes → `failed('connect-failed')`; driver not constructed.
- **bad base64 pubkey.** `base64StdDecode` throws → `failed('connect-failed')`; no crash.
- **ensure() rejects** (keychain unavailable) → `failed('connect-failed')`; no crash.
- **malformed hello_ack.** fire `handshake-complete` with bytes `parseHelloAck` rejects → `failed('malformed-hello-ack')`, **not** `connected`, no crash.
- **driver error.** fire `error{reason:'session-load-failed'}` → `failed` with that reason as the code; assert no bytes in the payload.
- **fatal terminal.** fire `terminal{code:4426, reason:'…'}` (not stopping) → `failed('connection-closed')`; assert status is not `connected`; assert the supervisor `reason` string is **not** present in the emitted payload.
- **message arm is a no-op.** fire `message{plaintext}` → **no** `DaemonEvent` emitted (out of scope, #12).
- **stop() suppresses terminal.** after `connected`, call `stop()` → driver `stop()` invoked; fire the driver's `terminal{1000,'stopped'}` → **no** event emitted.
- **stop() before bootstrap resolves.** `start()` then `stop()` before `load()` resolves → after resolution, `createDriver` is **never** called.
- **isolation / secret-safety.** Across happy + every error path, spy all six `console` methods → zero calls; and walk every emitted `DaemonEvent` → none contains the token, private-key bytes, the pubkey, or the hello bytes (only `connecting`, `connected{ack:4 public fields}`, `failed{static code}` appear).

Type-level coverage: `npm run typecheck` (both sides) — the `onDriverEvent` `switch` over `RelaySessionEvent` and the `DaemonEvent` construction are total by construction.

The composition-root edit in `index.ts` is covered by the existing e2e smoke boot (the app must still launch); the live handshake path is exercised by the operator-gated `noiseSession.interop.test.ts` live suite and the e2e harness, not by this ticket's unit surface (per the ticket body — assert only the emitted event here).

## Open questions

- **`deviceName` source.** Recommend `os.hostname()` (the desktop analog of mobile's device model). `app.getName()` is an alternative. Milestone choice; not load-bearing (it rides in the hello for display/audit, not auth).
- **Early-`connecting` vs renderer subscription.** Gating `start()` on `did-finish-load` places the connect after the renderer loads, but the synchronous `connecting` could still marginally precede the `useDaemonEventBridge` effect. The store's initial state is already `disconnected`, so a missed `connecting` only skips a brief "Connecting…" flash; the load-bearing `connected` arrives after a network round-trip and is safe. Full status-sync-on-mount (renderer requests current status) is #34/#35.
- **macOS re-activation.** `app.on('activate')` re-creates a window without re-wiring the connection; the connection's `sink` still points at the prior (destroyed) `webContents`, so `send` would no-op/throw there. Single-window is the milestone assumption; multi-window / re-activation lifecycle is deferred (name it in #34/#35). Not introduced by this ticket — pre-existing in `createWindow`'s `activate` handler.
- **`maxFrameBytes`.** Whether to pass `MAX_FRAME_BYTES` (256 KiB) for exact v2 fidelity vs rely on `relayConnection`'s 1 MiB default. Either is safe; recommend passing it. Developer's call.

## Security review

**Verdict:** PASS

Adversarial self-review per `architect/security-review.md` — ticket carries `security-sensitive`. Every applicable category walked; no MUST FIX.

**Findings:**

- **[Trust boundaries]** No findings. The design has three explicit, single-function untrusted→trusted boundaries: `decodeServerKey` (record base64 → validated 32-byte key), `parseHelloAck` (#10, daemon `hello_ack` bytes → typed `HelloAckPayload`, fail-closed), and `onDriverEvent` (the single driver-event → `DaemonEvent` choke point). Downstream holds typed `HelloAckPayload`, never `unknown`. The record itself is structurally re-validated on `load()` (#44) and integrity-protected at rest (#42).

- **[Tokens, secrets, credentials]** SHOULD FIX (documented; matches contract — not a gate). The real device token rides in the relay-readable `X-Pyrycode-Token` upgrade header. This **mirrors the live-validated mobile contract** (`OkHttpRelayTransport.kt:103`, identical "ignored under v2" comment) — deviating to a placeholder would drift from mobile (CLAUDE.md-forbidden) and risk a silent handshake break. The residual exposure is bounded: the token is **not** a standalone impersonation credential — the daemon authenticates the device via the Noise_IK static-key handshake (the device static private key never leaves the machine), so a relay that harvests the header token cannot impersonate the device. The standing mitigation is **log-freedom** (mobile omits `HttpLoggingInterceptor` for exactly this reason; this module is `console`-free, pinned by the six-method console-spy test). **Load-bearing developer rule:** the bootstrap's caught error object is *dropped* (classify-don't-forward, inherited from #50) — never place `err.message` / `err` into the `failed` `ErrorPayload`; the `code` and `message` are static category strings only.

- **[File / storage operations]** No findings. This ticket performs no new filesystem or path operations — it reads through `deviceKeypair.ensure()` (#43) and `pairedServer.load()` (#44), both `safeStorage`-backed and already reviewed. No untrusted input is concatenated into a path; no TOCTOU; no new writes. **Adjacent — header injection:** the record's `server`/`token` become header values. CR/LF header-injection is defended at the pairing **input gate** (#52, owns untrusted-paste validation) with Node's `ws`/`http` header validation as the transport backstop (mirrors mobile's reliance on OkHttp — `OkHttpRelayTransport.kt:68-69`); a synchronous `new WebSocket` construction throw on a bad header is caught by the bootstrap `try/catch` → `failed('connect-failed')`. OUT OF SCOPE to add a control-char strip here (owned by #52); recommend confirming #52 rejects control chars in `server`/`token`.

- **[Inter-process / Electron attack surface]** No findings. This ticket adds **no** new IPC channel, `contextBridge` API, or `ipcMain` handler — it emits on the existing `DAEMON_EVENT_CHANNEL` via `emitDaemonEvent` (#18, main→renderer only). Window `webPreferences` are unchanged (`sandbox: true`, `contextIsolation: true`, `nodeIntegration` default false); `createWindow` only additionally *returns* the handle. `will-navigate`/`setWindowOpenHandler` guards stand. No remote content. Keys, token, socket, and handshake stay in the main process — only typed public events (`connecting`, `connected{ack}`, `failed{code}`) cross to the renderer. Process-placement MUST-verify passes.

- **[Cryptographic primitives]** No findings. No new crypto — the Noise_IK handshake/AEAD is #7's vetted `noise-c.wasm`. The device static private key is *read* (not generated) and passed as a main-process `Uint8Array` into the driver→session, never serialized to the renderer or a plaintext file. **Key/nonce reuse:** although this consumer injects a *fixed* key set and a *fixed* `hello` reused across reconnects, the driver's fresh-handshake-per-connect invariant (#50 — new ephemeral, no carried cipher/nonce state per `connected`) means no `(key, nonce)` pair is ever reused; reusing the `hello` bytes is safe because Noise provides per-handshake freshness and v2 does not replay-check the hello `ts`.

- **[Network & I/O]** No findings for this slice. The relay URL is scheme/allowlist/no-credentials validated at pairing (#52) and integrity-protected at rest (#42), then used verbatim — connect-time re-validation of the relay allowlist is defense-in-depth **deliberately not added** (evidence-based: forging a valid encrypted record requires keychain compromise = game-over; no observed failure). Frame-size cap (`maxPayload`), connect/idle timeouts, heartbeat, and backoff are owned by #21/#22. A single explicit connect with fail-closed handling of fatal closes (4401/4421/4426 → `failed`, then stop) means **no reconnect/token-exhaustion storm** on a rejected token.

- **[Error messages, logs, telemetry]** No findings. Log-free by construction (no `console.*`, pinned). Every `failed` payload carries a static category `code`, a fixed generic `message`, and `retryable: false` — never a token, key, pubkey, frame, or caught-error text. `connected{ack}` carries only the four public daemon handshake fields. The supervisor `terminal` `reason` string is **deliberately not forwarded** into the payload (conservative). No telemetry/metrics added.

- **[Concurrency]** No findings. One fire-and-forget async bootstrap owned by `start()`; the long-lived socket/timers are owned by the supervisor and torn down by the driver's idempotent `stop()`. The `start()`/`stop()` race is closed by checking the `stopped` flag immediately before the *synchronous* `createDriver` call (JS yields only at `await`), so no orphaned driver. `.once('did-finish-load')` + the `started` guard prevent duplicate drivers; the supervisor guarantees a single live socket. Shutdown mid-handshake tears the session down cleanly and suppresses the resulting `terminal`.

- **[Threat model alignment]** Addressed. *Malicious/compromised relay* — survives (content-blind, on-path drop/delay/reorder/flood handled by #50's bounded pending buffer + fail-closed decode + Noise AEAD; no plaintext leak; no hang); the token-header exposure is the bounded caveat above. *Token theft from disk* — `safeStorage`/OS keychain (#42), read-only here. *Hostile daemon response* — the `hello_ack` is parsed defensively (`parseHelloAck` fail-closed → `failed('malformed-hello-ack')`, never a crash), AEAD-authenticated upstream. *Renderer compromise reaching the transport* — the renderer gets only typed public events and no new IPC surface; keys/token/socket unreachable. **Explicitly deferred:** per-drop `connecting`/`disconnected` status choreography and per-dial record reload → #34/#35; streamed `message` decode/route → #12; multi-window/macOS re-activation lifecycle → #34/#35.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-04
