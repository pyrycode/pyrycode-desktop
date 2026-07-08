# Daemon-event channel

The typed **event pipe** from the background process to the renderer window: a sealed `DaemonEvent` union, a single background emit helper, and a receive-only preload subscription on `window.pyry`. It is how the Noise transport (which lives in the background process — see [ADR 0001](../decisions/0001-stack-electron-react-typescript.md)) will hand **already-typed, already-validated** events to the React window without the renderer ever holding a socket, key, or raw frame.

Introduced in [#18](../codebase/18.md). It is the **event-pipe half** of the background↔window bridge; the mirror-image **command half** (renderer→main) is the [command channel](command-channel.md) (#17, now shipped). No transport is wired yet — this ticket builds the emit *seam* that #10 (hello/hello-ack) and #12 (render reply) will call. The receive end is now consumed: [#19](../codebase/19.md) maps each `DaemonEvent` onto the [session store](session-store.md)'s `SessionAction` — see the [daemon-event bridge](daemon-event-bridge.md) feature doc.

[#168](../codebase/168.md) added the union's first members with **no** `SessionAction` counterpart: `debugBundleProgress` / `debugBundleSaved` / `debugBundleFailed`, consumed by the download UI ([#72](https://github.com/pyrycode/pyrycode-desktop/issues/72)) rather than the session store. The 1:1 `DaemonEvent`↔`SessionAction` correspondence #19 relied on was a convenience, not a guarantee — see below.

## What it does

Gives the background process **one typed function** to emit a sealed daemon-event to the window, and gives the renderer **one typed function** to subscribe to those events. Every event travels on a single IPC channel; the union carries only wire payload types, so no token, key, or raw byte can cross the bridge.

## How it works

Three pieces, three layers:

| Piece | File | Layer |
|---|---|---|
| `DaemonEvent` union + `DAEMON_EVENT_CHANNEL` | `src/shared/ipc/events.ts` | shared |
| `emitDaemonEvent(sink, event)` | `src/main/emitDaemonEvent.ts` | background |
| `window.pyry.onDaemonEvent(listener)` | `src/preload/index.ts` | preload bridge |

`src/shared/ipc/` is the new IPC-contract module, mirroring how `src/shared/wire/` is the wire module. #18 creates one file in it; #17 later adds its command file (recommended: a sibling `commands.ts` with its own `COMMAND_CHANNEL`, so the two tickets never edit the same file).

### 1. The sealed union (`src/shared/ipc/events.ts`)

```ts
export type DebugBundleFailure = 'unavailable' | 'stream-corrupt' | 'write-failed'

export const DAEMON_EVENT_CHANNEL = 'pyry:daemon-event' as const

export type DaemonEvent =
  | { type: 'connecting' }
  | { type: 'connected'; ack: HelloAckPayload }
  | { type: 'disconnected' }
  | { type: 'failed'; error: ErrorPayload }
  | { type: 'messageReceived'; message: MessagePayload }
  | { type: 'messagesReceived'; messages: readonly MessagePayload[] }
  | { type: 'debugBundleProgress'; chunksReceived: number }
  | { type: 'debugBundleSaved'; path: string }
  | { type: 'debugBundleFailed'; reason: DebugBundleFailure }
```

- **The six session-lifecycle members map 1:1 onto [session-store](session-store.md) `SessionAction` arms** — the four connection-lifecycle events plus a single-message event and a message-**batch** event. Member and field names mirror `SessionAction`'s (`ack`, `error`, `message`, `messages`) so #19's mapping is nearly an identity.
- **The three debug-bundle members ([#168](../codebase/168.md)) map to *no* `SessionAction`.** `debugBundleProgress{chunksReceived}` / `debugBundleSaved{path}` / `debugBundleFailed{reason}` are consumed by the download UI ([#72](https://github.com/pyrycode/pyrycode-desktop/issues/72)), not the session store — the [daemon-event bridge](daemon-event-bridge.md)'s `translateDaemonEvent` maps all three to `null` and the bridge skips the dispatch. `DebugBundleFailure` is a **coarse, closed** three-value category enum by design: [#169](https://github.com/pyrycode/pyrycode-desktop/issues/169) (the orchestrator, blocked-by #168) collapses the transport's finer 5-value `BundleFailReason` ([debug-bundle reassembly](debug-bundle-reassembly.md)) plus any save errno onto these three, so the renderer never learns transport internals. None of the three carries a token, key, raw frame, or bundle bytes — only a count, a local filesystem path, and a category.
- **The two unions stay separately declared, per layer.** `DaemonEvent` lives in `shared/ipc`, `SessionAction` in the renderer store. The 1:1 correspondence is a convenience for #19, **not a coupling** — the IPC contract can evolve independently of the store's action vocabulary.
- **Members reuse the wire payload types verbatim** from `../wire/types` (imported by relative path — see below): `connected.ack` is `HelloAckPayload`, `messageReceived.message` is `MessagePayload`, `messagesReceived.messages` is a `MessagePayload[]`. No redefinition, no drift.
- **`failed.error` is the wire `ErrorPayload`**, not the store's `ConnectionError`. The union stays wire-typed; #19 maps `ErrorPayload → ConnectionError` (a trivial field copy) at the store boundary. Transport-level failures with **no** wire envelope — silent Noise-handshake failure, dropped socket (detected in #4/#7) — are emitted by *synthesizing* a valid `ErrorPayload` (`{ code: 'transport' | 'handshake', message, retryable }`). See [ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md), which defined `ConnectionError` for exactly this.
- **`messagesReceived` carries complete messages, not partial tokens** — it mirrors the wire `message_chunk` (`MessageChunkPayload.messages`), a backfill batch. It flattens to the `messages` array directly, so `MessageChunkPayload` itself is *not* a member (its only field is the array the member already carries). `readonly` is a compile-time no-mutate signal; it is erased harmlessly across the IPC structured-clone boundary.

### 2. The emit helper (`src/main/emitDaemonEvent.ts`)

```ts
export interface DaemonEventSink {
  webContents: { send(channel: string, event: DaemonEvent): void }
}
export function emitDaemonEvent(sink: DaemonEventSink, event: DaemonEvent): void {
  sink.webContents.send(DAEMON_EVENT_CHANNEL, event)
}
```

- **The one and only path an event takes to the renderer.** Transport code (#10/#12) calls this after building a `DaemonEvent` from a validated wire envelope; nothing else sends on the channel.
- **A pure forwarder** — no transform, no clone, no logging. (A `console.log(event)` would leak `MessagePayload.text` message bodies to main-process stdout.)
- **Typed against a structural `DaemonEventSink`, not `BrowserWindow`.** A real `mainWindow` satisfies it structurally, and the unit test passes `{ webContents: { send: vi.fn() } }` — so the helper needs **no `electron` import and no Electron harness**. Typing `send`'s second parameter as `DaemonEvent` also stops any non-event payload reaching the channel.

### 3. The preload subscription (`src/preload/index.ts`)

```ts
onDaemonEvent: (listener: (event: DaemonEvent) => void): (() => void) => {
  const handler = (_event: IpcRendererEvent, event: DaemonEvent): void => listener(event)
  ipcRenderer.on(DAEMON_EVENT_CHANNEL, handler)
  return () => ipcRenderer.removeListener(DAEMON_EVENT_CHANNEL, handler)
}
```

- **Added to the existing `api` object**; `PyryApi = typeof api` flows the new method's type to `window.pyry` through the untouched `index.d.ts`. The `process.contextIsolated` guard and the `exposeInMainWorld('pyry', …)` shape are preserved.
- **`ipcRenderer` never crosses the bridge** — only the typed `onDaemonEvent` callback surface does.
- **The raw `IpcRendererEvent` first arg is stripped** — the wrapper calls `listener(event)` only. The renderer never sees the ipc event object (it exposes `.sender`/`.ports`, a capability leak).
- **Returns an unsubscribe closure** that calls `removeListener` with the *exact same* `handler` reference, so the handle removes precisely the listener it added — no leak, no double-fire. Multiple subscribers are allowed; each gets its own handler and its own unsubscribe.
- **Receive-only** — no `ipcRenderer.send`/`invoke`, no `ipcMain` handler. It grants the renderer **zero** new command capability toward the background process — that direction is the [command channel](command-channel.md) (#17).

### Data flow

```
 #10/#12 transport (later)          emitDaemonEvent            preload bridge              #19 (shipped)
 wire Envelope ──validate/parse──►  emitDaemonEvent(win, e) ──► webContents.send ──IPC──► onDaemonEvent(cb)
   hello_ack/message/error          (the ONLY send path)        DAEMON_EVENT_CHANNEL       cb(DaemonEvent)
                                                                 ipcRenderer.on(strip e)   → map → sessionStore.dispatch
```

`emitDaemonEvent` is the single choke point outbound; `onDaemonEvent` is the single subscription inbound. **Neither #18 file parses raw bytes** — validation of hostile daemon input happens upstream in #5 (codec) / #10 (hello), *before* a `DaemonEvent` is ever constructed. #18 forwards already-typed, already-validated events.

## Configuration and usage

- **Import from `src/main` / `src/preload`** by **relative path**: `import { DAEMON_EVENT_CHANNEL, type DaemonEvent } from '../shared/ipc/events'`. These sides have **no `@shared` alias** (it exists only in `tsconfig.web.json` / the renderer vite block); `@shared/ipc/events` fails the node typecheck and the main/preload build there.
- **Import from `src/renderer` (#19)** by alias: `import { type DaemonEvent } from '@shared/ipc/events'`, which resolves. Test files (vitest) may also use `@shared/...` regardless of side — vitest aliases it in `vitest.config.ts`.
- **Emitter (#10/#12):** `emitDaemonEvent(mainWindow, event)` per event built from a validated envelope.
- **Subscriber (#19/#12):** `const off = window.pyry.onDaemonEvent(cb)`; call `off()` in a `useEffect` cleanup so listeners don't accumulate across remounts.

## Edge cases and limitations

- **No destroyed-window guard.** Once a real `mainWindow` exists (#10/#12), `webContents.send` on a torn-down window throws. #18 has no live emitter to observe this, so per evidence-based-fix no `isDestroyed()` guard is added — the helper stays a pure forwarder that lets the throw propagate to its caller, which owns window lifecycle. Flag when #10 wires the first emitter.
- **Renderer-side cleanup is the subscriber's job.** `onDaemonEvent` returns the unsubscribe; #18 does not build the `useEffect` teardown that calls it. [#19](../codebase/19.md)'s `useDaemonEventBridge` now owns that teardown (returns the handle as effect cleanup — StrictMode-safe).
- **No runtime shape validation at the preload.** The producer is our own trusted main process; a `zod`-style validator would add a dependency to defend against a bug, not an attacker (a compromised main process is already game-over). Revisit only if a less-trusted producer ever sends on this channel.
- **`connected.ack` carries the whole `HelloAckPayload`.** Narrow to `{ server_id, conn_id }` later only if #19/#12 prove the UI needs less — mirrors [ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md)'s deferral.
- **The three debug-bundle members have no producer yet.** [#168](../codebase/168.md) declares them inert; nothing calls `emitDaemonEvent` with a `debugBundleProgress`/`debugBundleSaved`/`debugBundleFailed` event until [#169](https://github.com/pyrycode/pyrycode-desktop/issues/169) wires the orchestrator. Until then they are reachable only from tests.

## Security posture

AC4 ("no key material, raw frames, or bytes cross the bridge") is **enforced by the type, not by convention.** The union references only `HelloAckPayload` / `ErrorPayload` / `MessagePayload` for its session-lifecycle members, none of which has a token, key, or raw-byte field. `QrPayload` (token, `server_static_pubkey`), `HelloClientPayload` (token), and `InnerFrameV2` (base64 `data`) are **not** members and must never become members — a developer cannot serialize a secret here because no member has a field to hold one. `MessagePayload.text` does cross (messages are displayed — that is the product, not a leak) and must not be logged. The channel is **receive-only** and exposes no `ipcRenderer`, so a compromised renderer gains no command capability toward the transport, keys, or socket through #18. The [#168](../codebase/168.md) debug-bundle members hold the same invariant with different carriers: `debugBundleProgress.chunksReceived` is a count, `debugBundleSaved.path` is a local filesystem path, `debugBundleFailed.reason` is the closed `DebugBundleFailure` enum — never a token, key, raw frame, or bundle bytes. The closed enum is a deliberate information-minimisation boundary: a hostile daemon's raw error string cannot be assigned to `reason` (a `string` isn't a `DebugBundleFailure`), so [#169](https://github.com/pyrycode/pyrycode-desktop/issues/169) is structurally forced to map transport internals down to one of the three categories before they can reach the renderer.

> Pre-existing hardening note (out of scope for #18): `src/main/index.ts` sets `sandbox: false`. The whole bridge surface is `sandbox: true`-compatible; route the flip to a dedicated hardening ticket. (#17, the command half, also left it untouched — still open.)

## Related

- [Daemon-event bridge (renderer)](daemon-event-bridge.md) — the #19 consumer that maps this union onto `SessionAction` and dispatches into the store; also the [#168](../codebase/168.md) consumer that tolerates the three debug-bundle members by returning `null`
- [Session store](session-store.md) — the `SessionAction` mapping target #19 dispatches into
- [Debug-bundle reassembly (inbound)](debug-bundle-reassembly.md) / [#116](../codebase/116.md) — source of the finer `BundleFailReason` (5 values) that #169 maps onto this channel's coarse `DebugBundleFailure` (3 values)
- [Command channel](command-channel.md) / [#168](../codebase/168.md) — the mirror-image `requestDebugBundle` command that triggers the download this channel's three new members report on
- [ADR 0004 — Renderer session store: reducer + sealed actions + wire types](../decisions/0004-renderer-session-store-reducer-wire-types.md) — the `failed → ErrorPayload → ConnectionError` seam
- [ADR 0001 — Stack: transport in the background process](../decisions/0001-stack-electron-react-typescript.md) · [ADR 0002 — Remote head over relay, shared wire](../decisions/0002-remote-head-over-relay-shared-wire.md)
- [#18 codebase notes](../codebase/18.md) · Spec: `docs/specs/architecture/18-typed-daemon-event-channel.md` · [#168 codebase notes](../codebase/168.md) · Spec: `docs/specs/architecture/168-debug-bundle-ipc-contract.md`
