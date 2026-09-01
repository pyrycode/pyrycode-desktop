# Daemon event channel — emit and subscribe

The two ends of the channel: the helper the main process emits through, the preload subscription the renderer listens on, and the flow between them.

Part of [Daemon-event channel](daemon-event-channel.md); see that document for what the package does, its edge cases and its links.

## 2. The emit helper (`src/main/emitDaemonEvent.ts`)

```ts
export interface DaemonEventSink {
  isDestroyed(): boolean // #518 — required; the ONE member safe to call post-destruction
  webContents: { send(channel: string, event: DaemonEvent): void }
}
export function emitDaemonEvent(sink: DaemonEventSink, event: DaemonEvent): void {
  if (sink.isDestroyed()) return // #518
  sink.webContents.send(DAEMON_EVENT_CHANNEL, event)
}
```

- **The one and only path an event takes to the renderer.** Transport code (#10/#12) calls this after building a `DaemonEvent` from a validated wire envelope; nothing else sends on the channel.
- **A pure forwarder** — no transform, no clone, no logging. (A `console.log(event)` would leak `MessagePayload.text` message bodies to main-process stdout.)
- **Typed against a structural `DaemonEventSink`, not `BrowserWindow`.** A real `BrowserWindow` satisfies it structurally, and the unit tests pass fakes — so the helper needs **no `electron` import and no Electron harness**. Typing `send`'s second parameter as `DaemonEvent` also stops any non-event payload reaching the channel. Since [#519](../codebase/519.md), production no longer passes a captured `BrowserWindow` directly — the composition root's sink is `live.sink`, the [live-window](live-window.md) holder's process-lifetime forwarder, which also satisfies `DaemonEventSink` structurally and reports `isDestroyed()` as permanently `false` by design (see that doc for why).
- **`isDestroyed()` guard ([#518](../codebase/518.md)).** On macOS, closing the window destroys the `BrowserWindow` without quitting the app, and the connection keeps emitting into it; the `webContents` **accessor itself** throws once destroyed, before `send` is ever reached. The guard is checked first, above any `sink.webContents` access — nothing may hoist or alias `webContents` above it, since the property read *is* the throw. Required rather than optional, so an unguardable sink literal fails to compile. This one guard covers all 32 `daemonConnection.ts` call sites plus the debug-bundle orchestrator's injected `emit`.

## 3. The preload subscription (`src/preload/index.ts`)

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

## Data flow

```
 #10/#12 transport (later)          emitDaemonEvent            preload bridge              #19 (shipped)
 wire Envelope ──validate/parse──►  emitDaemonEvent(win, e) ──► webContents.send ──IPC──► onDaemonEvent(cb)
   hello_ack/message/error          (the ONLY send path)        DAEMON_EVENT_CHANNEL       cb(DaemonEvent)
                                                                 ipcRenderer.on(strip e)   → map → sessionStore.dispatch
```

`emitDaemonEvent` is the single choke point outbound; `onDaemonEvent` is the single subscription inbound. **Neither #18 file parses raw bytes** — validation of hostile daemon input happens upstream in #5 (codec) / #10 (hello), *before* a `DaemonEvent` is ever constructed. #18 forwards already-typed, already-validated events.
