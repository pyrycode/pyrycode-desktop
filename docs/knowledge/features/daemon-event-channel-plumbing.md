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
- **`isDestroyed()` guard ([#518](../codebase/518.md)).** On macOS, closing the window destroys the `BrowserWindow` without quitting the app, and the connection keeps emitting into it; the `webContents` **accessor itself** throws once destroyed, before `send` is ever reached. The guard is checked first, above any `sink.webContents` access — nothing may hoist or alias `webContents` above it, since the property read *is* the throw. Required rather than optional, so an unguardable sink literal fails to compile. This one guard covers all 39 `daemonConnection.ts` call sites (recounted against the tree by #1068; the comment used to say 32) plus the debug-bundle orchestrator's injected `emit` and the notification-click emit.

### `bindServerOrigin` — one stamping sink per producer (#1068)

```ts
export function bindServerOrigin(target: DaemonEventSink, serverId: string | null): DaemonEventSink
```

The app will hold several paired servers at once (#1084 builds the connection registry that needs
this), and a renderer with several live connections cannot tell their events apart without an origin on
every one. `bindServerOrigin` returns a sink that delegates `isDestroyed()` to `target` and, on `send`,
forwards `{ ...event, serverId }` — a `StampedDaemonEvent` — to `target.webContents.send`.
`DaemonEventSink` itself is unchanged (still typed on bare `DaemonEvent`), so the wrapper is a drop-in
for a real sink at every call site.

- **The id is a construction-time binding, not an emit-time read.** It can't be sourced inside
  `daemonConnection.ts`, because the paired record loads per dial (`loadDialConfig`) and events fire
  before it. `createDaemonConnection` binds it once, in its deps destructure — `const sink =
  bindServerOrigin(deps.sink, deps.serverId)` — so all 39 emit call sites in that module emit into the
  bound local and stay origin-free **by construction**, not by discipline. None of them names or can
  vary the id.
- **Three emitters reach the channel, each bound separately.** Besides the connection's 39 sites, the
  composition root (`index.ts`) binds two more: the debug-bundle orchestrator's injected `emit` (its
  events come from the connection's daemon) and the `notificationActivated` emit (window-local, no
  daemon origin — permanently `null`). Both are bound over the shared `live.sink`, but as **separate**
  bindings — wrapping `live.sink` itself once would stamp all three emitters with a single id, which is
  exactly the shape a per-server registry cannot use.
- **Bind exactly once per producer.** `bindServerOrigin(bindServerOrigin(sink, a), b)` compiles and
  silently produces `b` — the outer spread's `serverId` overwrites the inner one with no error. Nothing
  in this codebase double-binds today; `live.sink` is a bind *target*, never itself a producer's sink.
- **The `#518` guard survives the extra hop.** The wrapper's own `webContents.send` closure reads
  `target.webContents` only when invoked — never destructured or aliased at bind time — so a destroyed
  target is still caught one layer up before this code ever runs.
- **Non-mutating and log-free**, like the rest of this module: the stamp is a fresh object, and a
  whole-event `console.log` here would leak `MessagePayload.text` the same way it would in
  `emitDaemonEvent` itself.
- **Provenance and containment.** `serverId` is the paired record's `server` — the same value
  `ServerInfo.serverId` already crosses on (see [server-info channel](server-info-channel.md)) — never
  `hello_ack.server_id` and never the record's `token`; a `string | null` scalar crosses, never a
  record, so `token` / `server_static_pubkey` are structurally unreachable from this path.

### `StampedDaemonEvent` — the channel-carried type (`src/shared/ipc/events.ts`)

```ts
interface ServerOrigin { serverId: string | null }
type WithOrigin<E> = E extends unknown ? E & ServerOrigin : never
export type StampedDaemonEvent = WithOrigin<DaemonEvent>
```

What actually travels on `DAEMON_EVENT_CHANNEL` since #1068 is a
`StampedDaemonEvent`, not a bare `DaemonEvent` — but the **43-arm union itself is untouched**. Adding
`serverId` to each arm individually would have edited all 43 declarations and cascaded into the 33 test
files that build bare `DaemonEvent` literals for bridges; carrying it as an intersection over the union
instead means:

- a `StampedDaemonEvent` **is** a `DaemonEvent`, so every consumer typed on the bare union — all 27
  renderer bridges included — keeps compiling and simply receives the field as an extra property it may
  read or ignore;
- a `DaemonEvent` is **not** a `StampedDaemonEvent`, so a bridge test's bare literal is untouched, and a
  producer cannot claim to have stamped one without going through `bindServerOrigin`.

`WithOrigin` is written as a **distributive** conditional rather than the plainer `DaemonEvent &
ServerOrigin` so the result is a genuine 43-arm union of stamped members — `.type` narrowing and
`Extract<…>` behave for consumers exactly as they do on the bare union. `null` is a present value, never
an absent property: it means "no paired record was in hand when the emitter was bound," which is the
value on every event in production today (the one connection is constructed at launch before any record
is read, and outlives a re-pair). `serverId` is a non-secret routing id but is still subject to the
plain-text-only rule every daemon-adjacent string on this channel carries — never a raw-markup sink,
never an attribute or a URL, never a filename or a lookup path (a `Map`, not a bare object, if a
consumer ever indexes by it).

### `DaemonEventTimestamp` — the per-frame comparand (#1225)

```ts
interface DaemonEventTimestamp { daemonTs?: string }
type WithDaemonTs<E> = E extends unknown ? E & DaemonEventTimestamp : never
export type DaemonEvent = WithDaemonTs<BaseDaemonEvent>
```

`WithOrigin`'s mechanism, reused a second time for a different reason. `bindServerOrigin` stamps
`serverId` once, at BIND time, for every event a producer emits — the per-frame `ts` this ticket carries
cannot ride that value, because it differs on every event and is only known at the decode
(`parseInboundMessage`, see [Inbound message decode — public
contract](inbound-message-decode-contract.md)). So `daemonTs` is added at the ten `daemonConnection.ts`
emit sites that construct a timeline-bearing arm (`assistant-delta`, `turn-end`, `turn-state`, `stall`,
`api-retry`, `compacting`, `tool-use`, `tool-result`, `session-transition`, `unrecognized-message`), each
copying `daemonTs: inbound.ts` by name onto its existing fresh literal — never a spread. `connected` has
no envelope behind it and gains nothing; `messageReceived` stays unstamped too, since the daemon pushes
no live `message` frame on the interactive lane for the operator's own message (its duplicate is the
optimistic echo `removeUserEcho` dedups on `messageId` — see [Thread timeline §
Types](thread-timeline-internals.md#types)).

The **same two reasons** `StampedDaemonEvent` took this shape apply again: the field stays optional, so
the 33 test files building bare `DaemonEvent` literals as bridge inputs keep compiling, and it resolves
on the bare union with no per-arm switch, so a renderer consumer needs no second enumeration of the ten
stamped arms to drift from the emit's own set. The type does not say WHICH arms carry it — that set is
enforced once, at the ten emit sites, and pinned by `daemonConnection.test.ts` asserting the untouched
arms carry none. **A wrongly-stamped arm's failure direction is a key that matches no entry, never a
suppression** — the same fail-open posture the field's own security section states.

**A comparand, and nothing else.** `daemonTs` is remote-supplied text, already fail-closed to a `string`
by `decodeEnvelope` before it ever reaches an emit, and its one reader — `liveJoinKeyFor`
(`timelineBridge.ts`) — composes it with `event.type` into a join key and discards it. It is never parsed
into a date, never sorted on to decide row order, never rendered, and never a filename, a lookup path, a
cache key, a React key or a log field. It rides beside `createdAt` (#1013) without being confused with
it: `createdAt` is a LOCAL clock stamp taken from `Date.now` at the bridge and is the only thing any
display reads; `daemonTs` is the daemon's own value and reaches no render path at all. See [Conversation
timeline store — internals § The history/live
join](conversation-timeline-store-internals.md#the-historylive-join-1225) for the join this field feeds.

## 3. The preload subscription (`src/preload/index.ts`)

```ts
onDaemonEvent: (listener: (event: StampedDaemonEvent) => void): (() => void) => {
  const handler = (_event: IpcRendererEvent, event: StampedDaemonEvent): void => listener(event)
  ipcRenderer.on(DAEMON_EVENT_CHANNEL, handler)
  return () => ipcRenderer.removeListener(DAEMON_EVENT_CHANNEL, handler)
}
```

- **Added to the existing `api` object**; `PyryApi = typeof api` flows the new method's type to `window.pyry` through the untouched `index.d.ts`. The `process.contextIsolated` guard and the `exposeInMainWorld('pyry', …)` shape are preserved.
- **`ipcRenderer` never crosses the bridge** — only the typed `onDaemonEvent` callback surface does.
- **The raw `IpcRendererEvent` first arg is stripped** — the wrapper calls `listener(event)` only. The renderer never sees the ipc event object (it exposes `.sender`/`.ports`, a capability leak).
- **Returns an unsubscribe closure** that calls `removeListener` with the *exact same* `handler` reference, so the handle removes precisely the listener it added — no leak, no double-fire. Multiple subscribers are allowed; each gets its own handler and its own unsubscribe.
- **Receive-only** — no `ipcRenderer.send`/`invoke`, no `ipcMain` handler. It grants the renderer **zero** new command capability toward the background process — that direction is the [command channel](command-channel.md) (#17).
- **Listener parameter widened to `StampedDaemonEvent` (#1068).** A pure type
  claim about what the three main-side emitters now produce, not a transform added here — the field
  would otherwise be readable only through a cast. It cascades into nothing: a bridge whose listener
  still takes the bare `DaemonEvent` is accepted by contravariance, so all 27 renderer subscribers and
  their tests compile unchanged and each ignores the field until it needs it.

## Data flow

```
 #10/#12 transport (later)          bindServerOrigin              emitDaemonEvent          preload bridge         #19 (shipped)
 wire Envelope ──validate/parse──►  sink = bind(deps.sink, id) ──► emitDaemonEvent(sink,e) ──IPC──► onDaemonEvent(cb)
   hello_ack/message/error          (#1068, once per producer)     webContents.send(e+id)   DAEMON_EVENT_CHANNEL   cb(StampedDaemonEvent)
                                                                    (the ONLY send path)     ipcRenderer.on(strip) → map → sessionStore.dispatch
```

`emitDaemonEvent` is the single choke point outbound; `onDaemonEvent` is the single subscription inbound. **Neither #18 file parses raw bytes** — validation of hostile daemon input happens upstream in #5 (codec) / #10 (hello), *before* a `DaemonEvent` is ever constructed. #18 forwards already-typed, already-validated events. Since #1068, every producer's sink is a `bindServerOrigin` result rather than a bare `DaemonEventSink` — `live.sink` itself is a bind target, never a producer's sink — so the origin stamp is applied once, main-side, before the event ever reaches this choke point.

## Related

- [Server-info channel](server-info-channel.md) — the standing ruling `bindServerOrigin` follows:
  `serverId ← record.server`, never `hello_ack.server_id`.
- [Daemon connection](daemon-connection.md) — `DaemonConnectionDeps.serverId`, the construction
  dependency `createDaemonConnection` binds once; see its Public surface and Edge cases.
- [Live window](live-window.md) — `live.sink` sits *downstream* of every `bindServerOrigin` wrapper, so
  its status recorder stores an already-stamped event and `replayStatus()` re-delivers it with its
  origin intact.
- `docs/specs/architecture/1068-stamp-daemon-events-with-server-origin.md` — the full design behind
  \#1068, its two Revisions (the excess-property check on the spread, and why
  `daemonConnection.roundtrip.test.ts` needed its own edit despite the plan expecting it untouched), and
  its security review.
