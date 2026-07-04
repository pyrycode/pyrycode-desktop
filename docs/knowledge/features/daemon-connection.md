# Daemon connection

The **background-process transport consumer** — the wiring slice that finally ties the whole transport chain to the renderer. The [Noise relay driver](noise-relay-driver.md) heals a relay connection and runs a fresh `Noise_IK` handshake on every connect, but it takes the device keys and the `hello` early-data **injected from above** and emits its lifecycle through a plain in-process callback; its own doc names the missing piece: *"the sink is a plain in-process callback owned by a **later** background-process consumer."* **This is that consumer.** It sources the inputs, constructs and drives the driver, and maps the driver's four lifecycle events onto the typed [daemon-event channel](daemon-event-channel.md), so a completed handshake becomes a `connected{ack}` event the [renderer bridge/store](daemon-event-bridge.md) turns into a live-session status the window reads.

Introduced in [#62](../codebase/62.md). This is **composition, not new crypto** — everything it drives is already loadable: the [device-keypair store](device-keypair.md) `ensure()`, the [paired-server store](paired-server-store.md) `load()`, the [hello exchange](hello-exchange.md) `buildClientHello`/`parseHelloAck`, the relay driver, and `emitDaemonEvent`. It is the first end-to-end path in the app: pair → open the encrypted session → surface a completed handshake.

## Where it lives (and why not under `transport/`)

`src/main/daemonConnection.ts` — top-level `src/main/`, **not** `src/main/transport/`. This is the composition/wiring layer *above* transport: it imports the driver (`src/main/transport/`) **and** `emitDaemonEvent` + `DaemonEvent` (the IPC layer). The `transport/` directory is deliberately **IPC-free** — no transport module references `emitDaemonEvent` or `DaemonEvent` ([ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md); CLAUDE.md "Keep the transport out of the window"). So the consumer that bridges the two must live one level up to preserve that boundary. It is main-process only — it transitively imports `codec.ts` (Node `Buffer`) and holds the token/keys, none of which may reach the renderer bundle.

## What it does

Gives the composition root **one factory** — `createDaemonConnection(deps): DaemonConnection` — with an idempotent `start()` / `stop()`:

- **`start()`** emits `connecting` **synchronously** (before any `await`), then kicks off an async bootstrap that sources the paired-server record, the device static key, and the server key, builds the `hello`, and constructs the driver (which dials on construction). A single explicit connect — auto-connect-on-pairing + per-dial record reload is the later mobile-parity refinement [#34](https://github.com/pyrycode/pyrycode-desktop/issues/34).
- **On the driver's `handshake-complete{helloAck}`**, it parses the ack via `parseHelloAck` and emits a typed `connected{ack: HelloAckPayload}` on the daemon-event channel — the load-bearing "live, authenticated link" signal.
- **Every non-clean outcome** — no paired record, a malformed record, a bad/wrong-length server key, a rejected keychain read, a malformed `hello_ack`, a driver `error`, or a fatal `terminal` — surfaces as a `failed{error}` event with a **static category code**, never a crash or an unhandled rejection.
- **`stop()`** tears the driver down idempotently and **suppresses** the clean-stop `terminal` (the window is going away on quit, so there is nothing to report).

### Public surface

```ts
export interface DaemonConnectionDeps {
  deviceKeypair: DeviceKeypairStore   // .ensure() → device static private key (the initiator `s`)
  pairedServer: PairedServerStore     // .load()   → record | null
  sink: DaemonEventSink               // the emitDaemonEvent target — a BrowserWindow satisfies it structurally
  deviceName: string                  // sourced at the root (os.hostname()); rides in the hello for display/audit
  clientVersion: string               // sourced at the root (app.getVersion()); hello + relay User-Agent
  now?: () => string                  // RFC3339 clock for the hello ts; default () => new Date().toISOString()
  createDriver?: (config: NoiseRelayDriverConfig) => NoiseRelayDriver  // DI seam; default createNoiseRelayDriver
}

export interface DaemonConnection {
  start(): void   // idempotent; emits `connecting`, then sources inputs + constructs the driver
  stop(): void    // idempotent teardown: stop the driver; suppress the resulting terminal
  send(payload: SendMessagePayload): void  // #65: encrypt a send_message onto the live session
}

export function createDaemonConnection(deps: DaemonConnectionDeps): DaemonConnection
```

**`send(payload)` was added in [#65](../codebase/65.md)** — the outbound send entry point. It builds a `send_message` envelope (via `buildSendMessage`, id counter continuing from 2 after the hello's id 1) and hands the bytes to `driver.sendMessage`. It is an **idempotent no-op** when not connected (no driver, pre-handshake, or post-terminal) and **never throws out of the module** (a single `driver === null` guard plus a full-body `try/catch`; parity mobile #490). See the [outbound send path](outbound-send-path.md) feature doc for the full contract — the id-counter model, the "why a single guard suffices" case analysis, and the composition-root `onCommand` registration that drives it.

## How it works

### The bootstrap (what `start()` drives)

`start()` returns synchronously but fires a fire-and-forget async bootstrap that never rejects — one `try/catch` wraps the whole thing:

1. Guard: if already `started` or already `stopped`, no-op (single explicit connect).
2. Emit `{ type: 'connecting' }` **synchronously** via `emitDaemonEvent`, before any `await` (AC3).
3. `await pairedServer.load()`. `null` → `failed('not-paired')`, return.
4. `await deviceKeypair.ensure()` → the device static keypair (the private key stays here).
5. `decodeServerKey(record.server_static_pubkey)` — `base64StdDecode` then require exactly **32 bytes** (the length check the codec deliberately omits). Both throws are caught.
6. `buildClientHello({ id: 1, ts: now(), deviceName, clientVersion, token: record.token })`. `capabilities`/`lastSeenTs` omitted (never hardcode `interactive` — see [hello exchange](hello-exchange.md)).
7. If `stopped` since step 2, return without constructing the driver (closes the start/stop race).
8. `createDriver(config)` and retain the handle. The driver dials on construction.

### Driver config assembled at step 8

| Config field | Value | Note |
|---|---|---|
| `connection.url` | `record.relay` | verbatim (the relay was scheme/allowlist-validated at pairing, [#52](pairing-payload-gate.md)) |
| `connection.headers` | `X-Pyrycode-Server: record.server`, `X-Pyrycode-Token: record.token`, `User-Agent: pyrycode-desktop/${clientVersion}`, `X-Pyrycode-Device-Name: deviceName` | **mirrors the live-validated mobile contract** (`OkHttpRelayTransport.kt`) field-for-field. The relay requires a non-empty `X-Pyrycode-Token` but **ignores its value under v2** — the Noise static-key handshake is the real gate. Do not deviate to a placeholder without a matching mobile/relay change (CLAUDE.md no-drift). |
| `connection.maxFrameBytes` | `MAX_FRAME_BYTES` (256 KiB) | tightens to the exact v2 cap (the supervisor's 1 MiB default already bounds; this is fidelity) |
| `session.staticPrivateKey` | `pair.privateKey` | raw 32B device static |
| `session.remoteStaticPublicKey` | `decodeServerKey(...)` | raw 32B |
| `session.prologue` | `new Uint8Array(0)` | zero-length matches the daemon |
| `session.hello` | `buildClientHello(...)` output | token + identity early-data |
| `onEvent` | `onDriverEvent` | the single event-mapping choke point |

### The driver-event → DaemonEvent mapping (`onDriverEvent`)

The single choke point. Nothing else emits.

| `RelaySessionEvent` | Action |
|---|---|
| `handshake-complete{helloAck}` | `parseHelloAck` → `connected{ack}`; a `parseHelloAck` throw → `failed('malformed-hello-ack')` (the caught `WireDecodeError` is dropped — its message could echo the ack bytes) |
| `message{plaintext}` | **No-op / TODO([#12](https://github.com/pyrycode/pyrycode-desktop/issues/12)).** Streamed-message decode/route is out of scope here |
| `terminal{code, reason}` | if `stopped` → **suppress** (clean local teardown); else `failed('connection-closed', "…code ${code}")`. The supervisor `reason` string is **not** forwarded (conservative) |
| `error{reason}` | `failed(reason)` — the driver's reason is a static enum string, safe as the category `code` |

### `failed`, not `disconnected`

The store's `disconnected` means "we deliberately stopped." Every other non-`connected` outcome here is a failure-to-establish or an authoritative drop the user should see, so it maps to `failed{error: {code, message, retryable: false}}` — a static category `code` plus a fixed generic `message`. `disconnected` is **not** produced by this ticket: the clean `stop()` path emits **nothing** (the window is tearing down on quit). Richer failed-vs-disconnected + per-drop status choreography is deferred to [#34](https://github.com/pyrycode/pyrycode-desktop/issues/34)/[#35](https://github.com/pyrycode/pyrycode-desktop/issues/35). Category codes: `not-paired`, `connect-failed` (the bootstrap catch-all), `malformed-hello-ack`, `connection-closed`, plus the driver's own error-reason enums verbatim.

### Composition-root wiring (`src/main/index.ts`)

Small, additive changes inside the existing `app.whenReady().then(...)`:

- `createWindow()` now **returns** the `BrowserWindow` (to capture the sink handle); its body is otherwise unchanged.
- A `deviceKeypairStore` is built over the **already-constructed** `secureStore` (`createDeviceKeypairStore({ secureStore, generator: noiseKeyPairGenerator() })`); the `pairedServerStore` is **reused** (no second store).
- `createDaemonConnection({ deviceKeypair, pairedServer, sink: mainWindow, deviceName: hostname(), clientVersion: app.getVersion() })`.
- Started once on first load: `mainWindow.webContents.once('did-finish-load', () => connection.start())` — defers the connect until the renderer's `useDaemonEventBridge` subscription is in place before the load-bearing `connected` (which arrives only after a network round-trip). `.once`, not `.on`, so a dev HMR reload does not re-fire it.
- Torn down on quit: `app.on('will-quit', () => connection.stop())` (a second `will-quit` listener alongside the existing pairing one — both fire).

## State + concurrency model

- **No store.** Three locals: `started`, `stopped`, `driver`. The single source of session state is the renderer's [session store](session-store.md) ([#2](../codebase/2.md)); this module only *emits* into it via IPC.
- **The `start()`/`stop()` race** is closed by checking `stopped` **immediately before** the synchronous `createDriver` call (step 7). JS yields only at `await`, so `stop()` can only interleave at an await point: if it ran during an earlier `await`, `stopped` is `true` at step 7 → the driver is never constructed; if it runs after step 8, `driver` is set → it is torn down. No orphaned driver.
- **`stopped` does double duty** — it is both the race guard *and* the "suppress the clean-stop terminal" flag, so no separate `stopping` boolean is needed.
- **Transient reconnects are invisible here.** The supervisor absorbs transient drops and re-dials without surfacing `terminal`; on reconnect the driver runs a fresh handshake and fires another `handshake-complete` → this re-emits `connected`. During the gap the UI stays on its last status.

## Security properties

Ticket carries `security-sensitive`; the architect's security-review verdict is **PASS**.

- **No secret ever crosses to the renderer.** Only three payload shapes leave: `connecting` (empty), `connected{ack}` (the four public handshake fields), and `failed{error}` (static category codes). The token, the private key, the decoded server pubkey, the `hello` bytes, and raw frames stay in the main process.
- **Log-free by construction; classify-don't-forward.** No `console.*` (a stray log could echo the token, keys, or handshake bytes). Every caught error object is **dropped** — only a static category `code` is surfaced — because a codec/keychain error message can echo the token or transcript bytes. Pinned by a six-method `console`-spy across the happy path and every reject branch (inherited [#5](wire-codec.md)/[#7](noise-session.md)/[#22](relay-supervisor.md)/[#50](noise-relay-driver.md)).
- **Fail-closed inputs.** A wrong-length/bad-base64 server key, a missing record (`load()` → `null`), or a malformed one (`MalformedPairedServerRecordError`) each surfaces as a non-connected event, never a crash.
- **The token-in-header exposure is the bounded, documented caveat.** The real device token rides in the relay-readable `X-Pyrycode-Token` upgrade header — mirroring the mobile contract (deviating would drift from mobile). It is **not** a standalone impersonation credential: the daemon authenticates the device via the Noise_IK static-key handshake (the device static private key never leaves the machine), so a relay that harvests the header token cannot impersonate the device. The standing mitigation is log-freedom.
- **No new IPC surface.** It emits on the existing `DAEMON_EVENT_CHANNEL` via `emitDaemonEvent`; no new channel, `contextBridge` API, or `ipcMain` handler. Window `webPreferences` (`sandbox`, `contextIsolation`) are unchanged.

## Edge cases and limitations

- **Single explicit connect.** One connect at composition time; auto-connect-on-pairing and per-dial record reload are [#34](https://github.com/pyrycode/pyrycode-desktop/issues/34).
- **The inbound `message` arm is a stub.** Streamed daemon-message decode/route is [#12](https://github.com/pyrycode/pyrycode-desktop/issues/12); `message{plaintext}` is a no-op here.
- **A missed early `connecting` is benign.** The store's initial state is already `disconnected`, so if the synchronous `connecting` marginally precedes the renderer's bridge subscription, only a brief "Connecting…" flash is skipped; the load-bearing `connected` arrives after a network round-trip and is safe. Full status-sync-on-mount is [#34](https://github.com/pyrycode/pyrycode-desktop/issues/34)/[#35](https://github.com/pyrycode/pyrycode-desktop/issues/35).
- **macOS re-activation.** `app.on('activate')` re-creates a window without re-wiring the connection (the sink still points at the destroyed `webContents`). Single-window is the milestone assumption; multi-window / re-activation lifecycle is deferred (pre-existing in `createWindow`'s `activate` handler, not introduced here).
- **Reusing the same `hello` across reconnects is safe.** This consumer injects a fixed key/`hello` set once; the driver's fresh-handshake-per-connect invariant means no `(key, nonce)` is ever reused. Noise provides per-handshake freshness and v2 does not replay-check the hello `ts`.

## Related

- [#62 codebase notes](../codebase/62.md) — implementation summary, patterns, lessons.
- [Outbound send path](outbound-send-path.md) / [#65](../codebase/65.md) — the `send(payload)` entry point added to this factory, the `buildSendMessage` envelope builder it drives, and the composition-root `onCommand` registration that routes a `sendMessage` command to it.
- [Noise relay driver](noise-relay-driver.md) / [#50](../codebase/50.md) — the driver this constructs and drives; it named this consumer as its missing piece. Owns the reconnect loop / fresh-handshake-per-connect / fatal-code classification this module does **not**.
- [Hello exchange](hello-exchange.md) / [#10](../codebase/10.md) — `buildClientHello` builds the injected `session.hello`; `parseHelloAck` narrows the `handshake-complete{helloAck}` bytes into the `HelloAckPayload` this emits.
- [Device static keypair](device-keypair.md) / [#43](../codebase/43.md) — `ensure()` sources the static private key.
- [Paired-server store](paired-server-store.md) / [#44](../codebase/44.md) — `load()` sources the `{server, relay, token, server_static_pubkey}` record.
- [Daemon-event channel](daemon-event-channel.md) / [#18](../codebase/18.md) — `emitDaemonEvent` + the `DaemonEvent` union this emits onto.
- [Daemon-event bridge](daemon-event-bridge.md) / [#19](../codebase/19.md) + [Session store](session-store.md) / [#2](../codebase/2.md) — the renderer half that turns `connected{ack}` into a completed-handshake state; this module produces the event that feeds them.
- [Secure store](secure-store.md) / [#42](../codebase/42.md) — the secret-at-rest chain the reused stores sit on.
- [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — remote head over the relay, transport isolated in the background process; the wire types match mobile field-for-field.
