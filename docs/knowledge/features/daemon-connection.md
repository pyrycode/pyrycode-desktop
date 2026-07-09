# Daemon connection

The **background-process transport consumer** — the wiring slice that finally ties the whole transport chain to the renderer. The [Noise relay driver](noise-relay-driver.md) heals a relay connection and runs a fresh `Noise_IK` handshake on every connect, but it takes the device keys and the `hello` early-data **injected from above** and emits its lifecycle through a plain in-process callback; its own doc names the missing piece: *"the sink is a plain in-process callback owned by a **later** background-process consumer."* **This is that consumer.** It sources the inputs, constructs and drives the driver, and maps the driver's four lifecycle events onto the typed [daemon-event channel](daemon-event-channel.md), so a completed handshake becomes a `connected{ack}` event the [renderer bridge/store](daemon-event-bridge.md) turns into a live-session status the window reads.

Introduced in [#62](../codebase/62.md). This is **composition, not new crypto** — everything it drives is already loadable: the [device-keypair store](device-keypair.md) `ensure()`, the [paired-server store](paired-server-store.md) `load()`, the [hello exchange](hello-exchange.md) `buildClientHello`/`parseHelloAck`, the relay driver, and `emitDaemonEvent`. It is the first end-to-end path in the app: pair → open the encrypted session → surface a completed handshake.

## Where it lives (and why not under `transport/`)

`src/main/daemonConnection.ts` — top-level `src/main/`, **not** `src/main/transport/`. This is the composition/wiring layer *above* transport: it imports the driver (`src/main/transport/`) **and** `emitDaemonEvent` + `DaemonEvent` (the IPC layer). The `transport/` directory is deliberately **IPC-free** — no transport module references `emitDaemonEvent` or `DaemonEvent` ([ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md); CLAUDE.md "Keep the transport out of the window"). So the consumer that bridges the two must live one level up to preserve that boundary. It is main-process only — it transitively imports `codec.ts` (Node `Buffer`) and holds the token/keys, none of which may reach the renderer bundle.

## What it does

Gives the composition root **one factory** — `createDaemonConnection(deps): DaemonConnection` — with an idempotent `start()` / `stop()`:

- **`start()`** emits `connecting` **synchronously** (before any `await`), then kicks off an async bootstrap that sources the paired-server record, the device static key, and the server key, builds the `hello`, and constructs the driver (which dials on construction). The boot-time connect, fired once on `did-finish-load`.
- **`reconnect()`** ([#82](../codebase/82.md)) re-arms the once-only lifecycle: it tears down any live driver and dials fresh, re-sourcing the paired-server record at dial time — the **connect-on-pair** trigger, so a pairing made mid-session dials with no restart. See § Connect-on-pair below.
- **The per-dial provider `loadDialConfig`** ([#83](../codebase/83.md)) is *constructed here* (this module owns the store) and **injected into the driver**, so the supervisor's own **automatic** transient-drop reconnect also re-sources the record — for both the connection headers and the Noise session material. See § Reload-per-dial below.
- **On the driver's `handshake-complete{helloAck}`**, it parses the ack via `parseHelloAck` and emits a typed `connected{ack: HelloAckPayload}` on the daemon-event channel — the load-bearing "live, authenticated link" signal.
- **On the driver's `message{plaintext}`**, it decodes the app-envelope via [`parseInboundMessage`](inbound-message-decode.md) and emits `messageReceived{message}` (a `message` envelope) or `messagesReceived{messages}` (a `message_chunk` batch) — the streamed assistant replies. Malformed/oversized/mistyped bytes are dropped without an event; an unmodeled envelope type is ignored. **Added in [#68](../codebase/68.md).**
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
  diagnosticLog?: DiagnosticLog       // #126 content-free logger, injected at the root; the daemon-leg log sites consume it (#128), and a second downward path routes it into the driver's framing catch + session builds (#133)
}

export interface DaemonConnection {
  start(): void      // idempotent; emits `connecting`, then sources inputs + constructs the driver
  stop(): void       // idempotent teardown: stop the driver; suppress the resulting terminal
  reconnect(): void  // #82: tear down any driver + dial fresh, re-sourcing the record; no-op once stopped
  send(payload: SendMessagePayload): void  // #65: encrypt a send_message onto the live session
  requestDebugBundle(): void  // #115: encrypt a bare request_debug_bundle control frame onto the live session
  requestSnapshot(payload: RequestSnapshotPayload): void  // #180: encrypt a request_snapshot onto the live session
}

export function createDaemonConnection(deps: DaemonConnectionDeps): DaemonConnection
```

**`send(payload)` was added in [#65](../codebase/65.md)** — the outbound send entry point. It builds a `send_message` envelope (via `buildSendMessage`, id counter continuing from 2 after the hello's id 1) and hands the bytes to `driver.sendMessage`. It is an **idempotent no-op** when not connected (no driver, pre-handshake, or post-terminal) and **never throws out of the module** (a single `driver === null` guard plus a full-body `try/catch`; parity mobile #490). See the [outbound send path](outbound-send-path.md) feature doc for the full contract — the id-counter model, the "why a single guard suffices" case analysis, and the composition-root `onCommand` registration that drives it.

**`requestDebugBundle()` was added in [#115](../codebase/115.md)** — a **structural twin of `send`** for the debug-bundle download's outbound "ask". It builds a **bare `request_debug_bundle` control envelope** (no payload struct, no `conversation_id`, no session selector — the bundle is daemon-global) via `buildRequestDebugBundle` and hands the bytes to `driver.sendMessage`. It **shares the same `nextEnvelopeId` counter** as `send` (no second counter — ids stay monotonic across interleaved calls), is an idempotent no-op when not connected, and never throws (parity #490). The renderer command that calls it is wired by the [debug-bundle orchestrator](debug-bundle-orchestrator.md) ([#169](../codebase/169.md), landed — the orchestrator half of #118's split; the IPC contract itself shipped in [#168](debug-bundle-request.md)). See the [debug-bundle request](debug-bundle-request.md) feature doc for the full contract, including why "no payload" is a present-but-empty `payload: {}` rather than an omission.

**`requestSnapshot(payload)` was added in [#180](../codebase/180.md)** — the outbound half of an
on-demand fetch of the session's current model/effort/YOLO via the daemon's always-available
`screen_snapshot` reply (ADR-025, not gated on `interactive`). Unlike `requestDebugBundle`, it is the
**`send` twin, not a consumer-failing twin**: a snapshot has no consumer, so it stays an inert no-op
(`driver === null` → return) rather than failing a `BundleConsumer`. It builds a **payload-carrying**
`request_snapshot` envelope (a real `conversation_id`, unlike the bare debug-bundle frame) via
`buildRequestSnapshot`, shares the one `nextEnvelopeId` counter, and never throws (parity #490). The
reply is routed through the same `case 'message'` → `parseInboundMessage` seam as everything else
(see below) — no new driver event, no reassembler, no consumer. See the [screen snapshot
fetch](screen-snapshot-fetch.md) feature doc for the full round trip, including the content-minimisation
seam that drops the reply's `text` field before it reaches `emitDaemonEvent`.

## Connect-on-pair (`reconnect()`, [#82](../codebase/82.md))

`reconnect()` was added so a pairing made **during a running session** dials with no manual step (mirrors mobile #489). Before it, `start()` was once-only (`if (started || stopped) return`); a client that paired mid-session persisted the record but never connected until the next launch. The [pairing handler](pairing-ipc-channel.md) fires its `onPaired` callback after a confirm persists, and the composition root wires `onPaired: () => connection.reconnect()`.

**`start()` and `reconnect()` both funnel through a private `dial()`** — the single fresh-connect path. `dial()`:

1. `++generation` — bump the connection fence (see below), superseding any prior dial.
2. `driver?.stop()` then `driver = null` — tear down any live driver before dialing the next, so two sockets never stack and only the fresh server is dialed (**AC3**). The old driver's stop-terminal carries the *old* gen, so the per-dial `onEvent` wrapper drops it — no spurious `failed`. Null before the first dial (or after a not-paired boot), where this is a no-op.
3. `nextEnvelopeId = 2` — fresh session, fresh app-envelope numbering (each dial rebuilds `hello` at id 1). Correctness-neutral (the daemon correlates by `id`, not sequence) but keeps a re-dialed session self-consistent.
4. `emitDaemonEvent(sink, { type: 'connecting' })` — synchronous, before any `await` (**AC2**).
5. `void bootstrap(gen)` — fire-and-forget; `bootstrap` catches everything and never rejects.

`start()` keeps its `if (started || stopped) return` guard, sets `started = true`, then calls `dial()` — **behaviour-preserving** on first start (driver is null, `nextEnvelopeId` already 2). `reconnect()` is `if (stopped) return`, sets `started = true` (idempotent — keeps a later `did-finish-load` start a no-op in the unreachable race), then `dial()`. **`reconnect()` re-sources the record fresh** because `bootstrap` runs `await pairedServer.load()` when the connect *begins*, not at construction — so the just-persisted pairing's relay/server/token/key are the ones dialed (**AC3**), with **no record-reload plumbing** added here.

### The generation fence

`reconnect()` copies the [Noise relay driver](noise-relay-driver.md)'s own `generation`-counter idiom (`noiseRelayDriver.ts:100-118`) **one layer up**. A module-local `let generation = 0`, bumped in `dial()`, plus a per-dial wrapper around the `onEvent` passed to `createDriver` — a closure capturing the dial's `gen` that early-returns when `gen !== generation`, else forwards to the unchanged `onDriverEvent`. `bootstrap(gen)` threads the same `gen` and fences at each suspension point:

- after `await pairedServer.load()`: `if (gen !== generation) return` — a reconnect superseded this in-flight bootstrap; do not emit or build a stale driver.
- before `createDriver`: `if (stopped || gen !== generation) return` — covers app-quit (**`stopped`**, which `generation` does NOT subsume) **and** supersession. `stopped` is checked explicitly because `stop()` does not bump `generation`.
- `catch`: `if (gen === generation) emitFailed('connect-failed')` — a superseded bootstrap's throw is silent (its `failed` would clobber the successor's `connecting`).

**`stopped` and `generation` are two orthogonal fences.** `stopped` fences **permanent** teardown (`stop()` on app quit); `generation` fences **reconnect supersession**. `stop()` is unchanged and deliberately does not bump `generation`, so the app-quit terminal is still suppressed by `onDriverEvent`'s `if (stopped) return` (the wrapper passes it through — gen unchanged on stop). One fence resolves all three reconnect races: (1) the old driver's stop-terminal after a reconnect → wrapper drops it (old gen); (2) a reconnect superseding an in-flight `bootstrap` mid-`await` → guards abort the stale bootstrap; (3) rapid double reconnect → each `++generation` supersedes; last dial wins.

### Data flow (connect-on-pair)

```
renderer confirm invoke ─▶ pairingHandler.listener
                             await confirm()  ─▶ store.save(snapshot)   (record persisted)
                             onPaired()       ─▶ connection.reconnect()
                                                   dial(): ++gen, driver?.stop() (old terminal fenced),
                                                           emit {connecting}, bootstrap(gen)
                                                   bootstrap: load() (fresh record) ─▶ createDriver
                                                   handshake ─▶ {connected} | {failed}
                             return { ok: true }   (independent reply channel — carries no secret)
```

The confirm reply (fingerprint/ok channel) and the daemon `connecting`/`connected` events are independent — the renderer already renders the latter (the [daemon-event bridge](daemon-event-bridge.md), [#19](../codebase/19.md)), so **no renderer change** (AC2). A failed persist takes the handler's `catch` → `persist-failed` reply, `onPaired` is never reached, no dial (**AC4**). `onPaired` carries no arguments, so no record field crosses (**AC5** by construction).

## Reload-per-dial (`loadDialConfig`, [#82]/[#83])

`reconnect()` re-sources the record on an **explicit** re-arm ([#82](../codebase/82.md)), but it deliberately left the [supervisor](relay-supervisor.md)'s *own* **automatic** transient-drop reconnect reusing the config snapshotted at construction — in **two** layers: the supervisor's captured `connection` (url + headers) and the driver's captured `session` (`server_static_pubkey` + `hello`). [#83](../codebase/83.md) closes that gap by extracting `bootstrap`'s inline record-load + derive (see § How it works) into a **provider** this module constructs and injects.

- **`loadDialConfig(): Promise<DialConfig | null>`** is the extracted record-load + derive — `await pairedServer.load()` → `null` (no record) or the assembled `{ connection, session }`. It is store-owning code (`pairedServer` lives here, above transport), so constructing it here and passing a plain async function down keeps the driver/supervisor **store-agnostic and IPC-free**.
- It is threaded to the driver (`createDriver({ …, loadDialConfig })`), which wraps it in a `resolveConnection` the supervisor calls before each automatic re-dial: **one `load()` feeds both halves** — the supervisor gets the fresh `connection`, the driver's next `onConnected` gets the fresh `session` — so a re-pair mid-session dials the new relay/server/token/key with no split between headers and key.
- The **first** dial keeps using the config `bootstrap` already loaded (no reason to reload microseconds later, and #82's first-dial not-paired/connect-failed messaging stays put); the provider drives only the automatic re-dials.
- **Fail-closed:** a reconnect that finds no record (`load()` → `null`), or a throw from a malformed record / bad key / keychain failure, ends supervision via the synthetic `NO_PAIRED_RECORD_CLOSE_CODE` → the driver's `terminal` → this module's `failed('connection-closed')` — a non-connected event, never a crash (AC3). The record never leaves the background process (AC5). The full mechanics are in the [relay supervisor](relay-supervisor.md) and [noise relay driver](noise-relay-driver.md) docs; the [#83 codebase note](../codebase/83.md) has the design.

## How it works

### The bootstrap (what `start()` drives)

`start()` returns synchronously but fires a fire-and-forget async bootstrap that never rejects — one `try/catch` wraps the whole thing. Since [#83](../codebase/83.md), the record-load + derive (steps 3–6) is factored into the private `loadDialConfig()` — which `bootstrap` calls as a unit **and** which is threaded to the driver for its automatic reconnects (see § Reload-per-dial):

1. Guard: if already `started` or already `stopped`, no-op (single explicit connect).
2. Emit `{ type: 'connecting' }` **synchronously** via `emitDaemonEvent`, before any `await` (AC3).
3. `const dc = await loadDialConfig()` — which does: `await pairedServer.load()` (`null` → the provider returns `null`); `await deviceKeypair.ensure()` (device static keypair; the private key stays here); `decodeServerKey(record.server_static_pubkey)` (`base64StdDecode` then require exactly **32 bytes** — the length check the codec deliberately omits; both throws caught by `bootstrap`); `buildClientHello({ id: 1, ts: now(), deviceName, clientVersion, token: record.token })` (`capabilities`/`lastSeenTs` omitted — never hardcode `interactive`, see [hello exchange](hello-exchange.md)); returns the assembled `{ connection, session }` `DialConfig`.
4. Gen check FIRST (`if (gen !== generation) return`), then `dc === null` → `failed('not-paired')`, return — the order preserved from #82 so a superseded bootstrap never emits a spurious `not-paired`.
5. If `stopped` or superseded since step 2, return without constructing the driver (`if (stopped || gen !== generation) return` — closes the start/stop and reconnect-supersede races).
6. `createDriver({ connection: dc.connection, session: dc.session, loadDialConfig, onEvent: fenced })` and retain the handle. The driver dials on construction; `loadDialConfig` is threaded so the driver's *automatic* reconnects re-source the record.

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
| `message{plaintext}` | [`parseInboundMessage`](inbound-message-decode.md) → `messageReceived{message}` / `messagesReceived{messages}` / `snapshotReceived{model,effort,yolo}` (#180, `text`/`ts`/`conversation_id` dropped here); a throw (oversized/malformed/mistyped) → **drop** (no event, the caught `WireDecodeError` is dropped — its message could echo plaintext); an unmodeled envelope type (`null`) → **ignore**. The transport helper owns the wire boundary; this arm does only the IPC map. **Filled in [#68](../codebase/68.md)**, extended with the `snapshot` kind in [#180](../codebase/180.md) |
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
- **`stopped` does double duty** — it is both the start/stop race guard *and* the "suppress the clean-stop terminal" flag, so no separate `stopping` boolean is needed.
- **`generation` is a second, orthogonal fence for `reconnect()`** ([#82](../codebase/82.md)) — it supersedes an in-flight dial when a fresh one begins, dropping the old driver's stop-terminal and aborting a stale `bootstrap`. `stop()` deliberately does not bump it (permanent teardown stays `stopped`'s job), so the pre-`createDriver` guard checks both. Full model in § Connect-on-pair.
- **Transient reconnects are invisible here.** The supervisor absorbs transient drops and re-dials the *same* driver without surfacing `terminal`; on reconnect the driver **re-sources the record via `loadDialConfig`** ([#83](../codebase/83.md)) then runs a fresh handshake and fires another `handshake-complete` → this re-emits `connected`. During the gap the UI stays on its last status. (This is distinct from `reconnect()`, which **replaces** the driver entirely — see § Connect-on-pair.)

## Security properties

Ticket carries `security-sensitive`; the architect's security-review verdict is **PASS**.

- **No secret ever crosses to the renderer.** Only three payload shapes leave: `connecting` (empty), `connected{ack}` (the four public handshake fields), and `failed{error}` (static category codes). The token, the private key, the decoded server pubkey, the `hello` bytes, and raw frames stay in the main process.
- **Content-free-log by construction; classify-don't-forward.** No `console.*` (a stray log could echo the token, keys, or handshake bytes). Every caught error object is **dropped** — only a static category `code` is surfaced — because a codec/keychain error message can echo the token or transcript bytes. Pinned by a six-method `console`-spy across the happy path and every reject branch (inherited [#5](wire-codec.md)/[#7](noise-session.md)/[#22](relay-supervisor.md)/[#50](noise-relay-driver.md)). Since [#128](../codebase/128.md) the module also *shadows* its lifecycle onto the injected [#126 diagnostic log](diagnostic-log.md) — but still content-free: only the static classification `code` and the event name reach the sink, never the caught object, the banner text, the ack bytes, or the numeric close code. See § Diagnostic logging.
- **Fail-closed inputs.** A wrong-length/bad-base64 server key, a missing record (`load()` → `null`), or a malformed one (`MalformedPairedServerRecordError`) each surfaces as a non-connected event, never a crash.
- **The token-in-header exposure is the bounded, documented caveat.** The real device token rides in the relay-readable `X-Pyrycode-Token` upgrade header — mirroring the mobile contract (deviating would drift from mobile). It is **not** a standalone impersonation credential: the daemon authenticates the device via the Noise_IK static-key handshake (the device static private key never leaves the machine), so a relay that harvests the header token cannot impersonate the device. The standing mitigation is log-freedom.
- **No new IPC surface.** It emits on the existing `DAEMON_EVENT_CHANNEL` via `emitDaemonEvent`; no new channel, `contextBridge` API, or `ipcMain` handler. Window `webPreferences` (`sandbox`, `contextIsolation`) are unchanged.

## Diagnostic logging ([#128](../codebase/128.md))

The classification the module *already computes* now also lands in the [#126 content-free log](diagnostic-log.md). The logger is injected as `deps.diagnosticLog?` (added accepted-unused by [#126](../codebase/126.md), constructed once at the composition root); this module consumes it at **three pre-existing seams** with three one-line calls — no new choke point, no new type, no root wiring. Each record is a static event name plus, for the failure record, the static classification `code`:

| Record | Site | Carries | Signal |
|---|---|---|---|
| `daemon-dial` | `dial()`'s `connecting` emit | event name only (coordinate-free) | the daemon-side dial window opening |
| `daemon-connected` | `onDriverEvent` `handshake-complete` success | event name only | the Noise handshake **finished** (never the ack bytes) |
| `daemon-failed { code }` | `emitFailed` (the single failure choke point) | static classification `code` only | which of the five classifications a failure carried |

- **The leg division vs [#127](../codebase/127.md) (relay leg).** The same socket close flows through both layers. #127 logs the **socket facts** — the connection coordinates (`host`/`path`) and the numeric WS close code (`relay-closed { status: terminal.code }`); this module logs the **classification** (`daemon-failed { code }`) and nothing else. `emitFailed` logs only its `code` argument, never its `message` argument (which interpolates the numeric close code `…(code ${event.code}).`) — so the socket code stays out of the daemon record by construction. The daemon leg carries **no** `host`/`path`/`status`.
- **`daemon-dial` is coordinate-free and fires before `bootstrap`.** At the dial seam the paired record isn't loaded yet (host/path aren't even available, and they're #127's regardless). Logging unconditionally at the `connecting` transition means the **not-paired** case still anchors — `daemon-dial → daemon-failed { code: 'not-paired' }` — a complete daemon-side window even when the relay socket never opens and #127 is silent.
- **`daemon-failed` covers all five classifications** through the one call at `emitFailed`: `not-paired`, `malformed-hello-ack`, `connect-failed`, `connection-closed`, and the driver's own `error` reason (`emitFailed(event.reason)`, typed `RelaySessionErrorReason` — a closed enum documented "never carries key/token/frame/plaintext bytes", so it's safe as the `code`). The peer-supplied `terminal.reason` string is dropped by the existing `terminal` case and never reaches the log.
- **A faithful shadow of the gen-fenced event stream.** All three sites log *after* their `emitDaemonEvent`, inside the existing generation fence — so no stray record leaks from a superseded dial, and a clean `stop()` suppresses both the `failed` event and the `daemon-failed` record for free (the `terminal` case returns on `if (stopped)` before reaching `emitFailed`). Behaviour is otherwise unchanged: the module still never throws, still drops every caught object, and emits the same `DaemonEvent`s in the same order (the sink swallows its own errors, so a full-disk log can't crash the connection it observes).

## Edge cases and limitations

- **Two explicit connects + the automatic reconnect all re-source the record.** The boot-time connect fires once on `did-finish-load`; `reconnect()` ([#82](../codebase/82.md)) re-arms on a fresh mid-session pairing (see § Connect-on-pair); and the supervisor's own **automatic** transient-drop reconnect now re-reads the record too via the injected `loadDialConfig` provider ([#83](../codebase/83.md), see § Reload-per-dial). No stale pre-pairing view survives in memory across any dial.
- **The inbound `message` arm decodes and emits ([#68](../codebase/68.md)).** `message{plaintext}` is narrowed by [`parseInboundMessage`](inbound-message-decode.md) into `messageReceived` / `messagesReceived`, failing closed on hostile bytes. The renderer *render* of those events (thread render-binding) is [#69](https://github.com/pyrycode/pyrycode-desktop/issues/69); this module only produces them.
- **A missed early `connecting` is benign.** The store's initial state is already `disconnected`, so if the synchronous `connecting` marginally precedes the renderer's bridge subscription, only a brief "Connecting…" flash is skipped; the load-bearing `connected` arrives after a network round-trip and is safe. Full status-sync-on-mount is [#34](https://github.com/pyrycode/pyrycode-desktop/issues/34)/[#35](https://github.com/pyrycode/pyrycode-desktop/issues/35).
- **macOS re-activation.** `app.on('activate')` re-creates a window without re-wiring the connection (the sink still points at the destroyed `webContents`). Single-window is the milestone assumption; multi-window / re-activation lifecycle is deferred (pre-existing in `createWindow`'s `activate` handler, not introduced here).
- **Reusing the same `hello` across reconnects is safe.** This consumer injects a fixed key/`hello` set once; the driver's fresh-handshake-per-connect invariant means no `(key, nonce)` is ever reused. Noise provides per-handshake freshness and v2 does not replay-check the hello `ts`.

## Related

- [#62 codebase notes](../codebase/62.md) — implementation summary, patterns, lessons.
- [#82 codebase notes](../codebase/82.md) / [Pairing IPC channel](pairing-ipc-channel.md) / [#54](../codebase/54.md) — connect-on-pair: the `reconnect()` re-arm + generation fence added here, fired by the pairing handler's `onPaired` trigger a confirm-success wires to `connection.reconnect()`.
- [#83 codebase notes](../codebase/83.md) — reload-per-dial: the `loadDialConfig` provider constructed here and threaded to the driver so the supervisor's *automatic* reconnect re-sources the record too (see § Reload-per-dial).
- [Content-free diagnostic log](diagnostic-log.md) / [#126](../codebase/126.md) + [#128 codebase notes](../codebase/128.md) — the injected logger this module is the daemon-leg consumer of; the three log sites (`daemon-dial`/`daemon-connected`/`daemon-failed`) added at pre-existing seams (see § Diagnostic logging). Complementary to [#127](../codebase/127.md)'s relay leg — this leg logs the classification, that leg logs the socket coordinates + close code.
- [Outbound send path](outbound-send-path.md) / [#65](../codebase/65.md) — the `send(payload)` entry point added to this factory, the `buildSendMessage` envelope builder it drives, and the composition-root `onCommand` registration that routes a `sendMessage` command to it.
- [Debug-bundle request](debug-bundle-request.md) / [#115](../codebase/115.md) — the `requestDebugBundle()` method added to this factory (a structural twin of `send` sharing the same `nextEnvelopeId` counter), and the bare `request_debug_bundle` control-frame builder it drives.
- [Debug-bundle orchestrator](debug-bundle-orchestrator.md) / [#169](../codebase/169.md) — the composition-root consumer that calls `requestDebugBundle(consumer)` from the `onCommand` switch.
- [Screen snapshot fetch](screen-snapshot-fetch.md) / [#180](../codebase/180.md) — the `requestSnapshot(payload)` method added to this factory (the `send` twin, not `requestDebugBundle`'s consumer-failing twin), the payload-carrying `buildRequestSnapshot` builder it drives, and the `snapshot` inbound kind + content-minimisation seam in the `case 'message'` consumer arm.
- [Inbound message decode](inbound-message-decode.md) / [#68](../codebase/68.md) — `parseInboundMessage`, the transport-layer decoder the `case 'message'` arm calls; it owns the wire boundary (size guard, `decodeEnvelope`, per-field narrowing) so this arm stays a thin IPC map.
- [Noise relay driver](noise-relay-driver.md) / [#50](../codebase/50.md) — the driver this constructs and drives; it named this consumer as its missing piece. Owns the reconnect loop / fresh-handshake-per-connect / fatal-code classification this module does **not**.
- [Hello exchange](hello-exchange.md) / [#10](../codebase/10.md) — `buildClientHello` builds the injected `session.hello`; `parseHelloAck` narrows the `handshake-complete{helloAck}` bytes into the `HelloAckPayload` this emits.
- [Device static keypair](device-keypair.md) / [#43](../codebase/43.md) — `ensure()` sources the static private key.
- [Paired-server store](paired-server-store.md) / [#44](../codebase/44.md) — `load()` sources the `{server, relay, token, server_static_pubkey}` record.
- [Daemon-event channel](daemon-event-channel.md) / [#18](../codebase/18.md) — `emitDaemonEvent` + the `DaemonEvent` union this emits onto.
- [Daemon-event bridge](daemon-event-bridge.md) / [#19](../codebase/19.md) + [Session store](session-store.md) / [#2](../codebase/2.md) — the renderer half that turns `connected{ack}` into a completed-handshake state; this module produces the event that feeds them.
- [Secure store](secure-store.md) / [#42](../codebase/42.md) — the secret-at-rest chain the reused stores sit on.
- [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — remote head over the relay, transport isolated in the background process; the wire types match mobile field-for-field.
