# Daemon-event channel

The typed **event pipe** from the background process to the renderer window: a sealed `DaemonEvent` union, a single background emit helper, and a receive-only preload subscription on `window.pyry`. It is how the Noise transport (which lives in the background process — see [ADR 0001](../decisions/0001-stack-electron-react-typescript.md)) will hand **already-typed, already-validated** events to the React window without the renderer ever holding a socket, key, or raw frame.

Introduced in [#18](../codebase/18.md). It is the **event-pipe half** of the background↔window bridge; the mirror-image **command half** (renderer→main) is the [command channel](command-channel.md) (#17, now shipped). No transport is wired yet — this ticket builds the emit *seam* that #10 (hello/hello-ack) and #12 (render reply) will call. The receive end is now consumed: [#19](../codebase/19.md) maps each `DaemonEvent` onto the [session store](session-store.md)'s `SessionAction` — see the [daemon-event bridge](daemon-event-bridge.md) feature doc.

[#168](../codebase/168.md) added the union's first members with **no** `SessionAction` counterpart: `debugBundleProgress` / `debugBundleSaved` / `debugBundleFailed`, consumed by the download UI ([#72](https://github.com/pyrycode/pyrycode-desktop/issues/72)) rather than the session store. The 1:1 `DaemonEvent`↔`SessionAction` correspondence #19 relied on was a convenience, not a guarantee — see below.

[#180](../codebase/180.md) added a fourth no-`SessionAction` member, `snapshotReceived` — the [screen
snapshot fetch](screen-snapshot-fetch.md) feature's reply, consumed by the [Run configuration
store](run-config-store.md)'s data path ([#187](../codebase/187.md)) instead of the session store.
[#191](../codebase/191.md) extended that member with two more always-present fields,
`used_tokens`/`window_tokens` (pyrycode/pyrycode#857) — the context-window usage figures the render
sibling [#192](https://github.com/pyrycode/pyrycode-desktop/issues/192) will consume.

[#199](../codebase/199.md) added a fifth and sixth no-`SessionAction` member, `assistantDelta` /
`turnEnd` — the transport slice (L1) of the structured-stream render vertical, consumed by the
renderer timeline bridge [#202](../codebase/202.md) will build over the [thread
timeline](thread-timeline.md) model, not the session store. Unlike every member above,
`assistantDelta.text` deliberately **carries content across the bridge rather than minimising it** —
see below.

[#139](../codebase/139.md) added a seventh no-`SessionAction` member, `conversationsReceived` — the
[conversation list fetch](conversation-list-fetch.md) feature's reply, reusing the wire
`ConversationSummary[]` row type verbatim (snake_case, order preserved from the wire). Like
`assistantDelta`/`turnEnd`, nothing is dropped (no field is a secret) — but like `snapshotReceived`,
it's a fire-and-forget request/reply, not a streamed delta. Consumed by the conversation-list store
[#208](https://github.com/pyrycode/pyrycode-desktop/issues/208) (blocked on this), not the session
store.

[#214](../codebase/214.md) added an eighth no-`SessionAction` member, `turnState` — the coarse
turn-lifecycle scalar of the same v2 interactive stream `assistantDelta`/`turnEnd` belong to. Carries
only `state` (a closed 3-value `WireTurnState`); `conversation_id` is dropped at the emit. Consumed by
the [conversation timeline store](conversation-timeline-store.md)'s bridge — the third arm that bridge
owns — driving `phase`, not `items`; the session bridge still maps it to `null`.

[#217](../codebase/217.md) added a ninth no-`SessionAction` member, `toolUse` — the tool-call
enrichment of the same v2 interactive stream. Carries four camelCase fields (`turnId`, `toolUseId`,
`name`, `inputSummary`, all plain strings, no enum); `conversation_id` is dropped at the emit. Consumed
by the [conversation timeline store](conversation-timeline-store.md)'s bridge — the fourth arm that
bridge owns, and the first whose mapping produces a durable `ThreadItem` (a `toolCall`) rather than text
or a scalar. `name`/`inputSummary` are opaque daemon display text the render slice
([#218](https://github.com/pyrycode/pyrycode-desktop/issues/218)) must render as plain text.

[#201](../codebase/201.md) added a tenth and eleventh no-`SessionAction` member, `modalShown` /
`modalDismissed` — the transport slice of the modal vertical ([ADR
0009](../decisions/0009-modal-prompt-model.md)), consumed by **neither** existing bridge; the real
consumer is the third, independent [modal store + bridge](modal-store-bridge.md), shipped in
[#223](../codebase/223.md). `modalShown` carries `class` (a closed
`WireModalClass`), `title`/`prompt` (untrusted `claude`-surfaced free text), an ordered
`options: readonly WireModalOption[]`, and `defaultOptionId`; `modalDismissed` carries `outcome`
(opaque) and `source` (a closed `WireModalSource`). **Neither arm drops a `conversation_id`** — unlike
every member above, the wire payload never carries one; `modalId` is the sole correlation key (a
one-time nonce, ADR 0009).

[#229](../codebase/229.md) added a twelfth no-`SessionAction` member, `toolResult` — the outcome half of
`toolUse` (#217), the vertical's last transport slice. Carries four camelCase fields (`turnId`,
`toolUseId`, `isError`, `resultSummary`); `conversation_id` is dropped at the emit, like `toolUse`.
Consumed by the [conversation timeline store](conversation-timeline-store.md)'s bridge — the fifth arm
that bridge owns, and the first whose mapping **resolves** an existing `ThreadItem` (a `toolCall`'s
`result`, via `fillResult`, #121) rather than appending one or setting a scalar. `isError` is a boolean,
not attacker text; `resultSummary` is opaque daemon display text the render slice
([#230](https://github.com/pyrycode/pyrycode-desktop/issues/230)) must render as plain text.

[#241](../codebase/241.md) added a thirteenth no-`SessionAction` member, `conversationCreated` — the
[conversation create](conversation-create.md) feature's reply, the write-side twin of
`conversationsReceived` (#139). Reuses the wire `ConversationCreatedPayload` verbatim (its own 5-field
shape, **not** `ConversationSummary`) — nothing to drop, no secret field. Consumed by neither existing
bridge; the real consumer is the render sibling [#242](https://github.com/pyrycode/pyrycode-desktop/issues/242)
(blocked on this ticket), which must render `name`/`cwd` as plain text, never HTML — the doc-comment
on this arm carries that warning forward since this ticket has no DOM sink of its own.

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
  | { type: 'snapshotReceived'; model: string; effort: string; yolo: boolean
      ; used_tokens: number; window_tokens: number }
  | { type: 'assistantDelta'; turnId: string; seq: number; text: string }
  | { type: 'turnEnd'; turnId: string; stopReason: string }
  | { type: 'conversationsReceived'; conversations: readonly ConversationSummary[] }
  | { type: 'turnState'; state: WireTurnState }
  | { type: 'toolUse'; turnId: string; toolUseId: string; name: string; inputSummary: string }
  | { type: 'modalShown'; modalId: string; class: WireModalClass; title: string; prompt: string
      ; options: readonly WireModalOption[]; defaultOptionId: string }
  | { type: 'modalDismissed'; modalId: string; outcome: string; source: WireModalSource }
  | { type: 'toolResult'; turnId: string; toolUseId: string; isError: boolean; resultSummary: string }
  | { type: 'conversationCreated'; conversation: ConversationCreatedPayload }
  | { type: 'sessionTransition'; newSessionId: string }
  | { type: 'sessionSettingsUpdated'; sessionId: string; changeId: string }
  | { type: 'sessionSettingsRejected'; changeId: string }
```

- **The six session-lifecycle members map 1:1 onto [session-store](session-store.md) `SessionAction` arms** — the four connection-lifecycle events plus a single-message event and a message-**batch** event. Member and field names mirror `SessionAction`'s (`ack`, `error`, `message`, `messages`) so #19's mapping is nearly an identity.
- **The three debug-bundle members ([#168](../codebase/168.md)) map to *no* `SessionAction`.** `debugBundleProgress{chunksReceived}` / `debugBundleSaved{path}` / `debugBundleFailed{reason}` are consumed by the download UI ([#72](https://github.com/pyrycode/pyrycode-desktop/issues/72)), not the session store — the [daemon-event bridge](daemon-event-bridge.md)'s `translateDaemonEvent` maps all three to `null` and the bridge skips the dispatch. `DebugBundleFailure` is a **coarse, closed** three-value category enum by design: the [debug-bundle orchestrator](debug-bundle-orchestrator.md) ([#169](../codebase/169.md), landed) collapses the transport's finer 5-value `BundleFailReason` ([debug-bundle reassembly](debug-bundle-reassembly.md)) plus any save errno onto these three, so the renderer never learns transport internals. None of the three carries a token, key, raw frame, or bundle bytes — only a count, a local filesystem path, and a category.
- **`snapshotReceived{model,effort,yolo,used_tokens,window_tokens}`** ([#180](../codebase/180.md);
  extended with the two usage ints by [#191](../codebase/191.md)) **also maps to *no*
  `SessionAction`**, consumed instead by the [Run configuration store](run-config-store.md)'s data
  path ([#187](../codebase/187.md)) — which as of #191 still copies out only `model`/`effort`/`yolo`,
  ignoring the two ints until [#192](https://github.com/pyrycode/pyrycode-desktop/issues/192). It is
  a **dedicated minimal shape**, deliberately **not** a reuse of the wire `ScreenSnapshotPayload` it
  is derived from — that wire type also carries `text` (the rendered screen) and `ts`/
  `conversation_id`, none of which this member has a field for. See [screen snapshot
  fetch](screen-snapshot-fetch.md) for why that's the load-bearing content-minimisation control, not
  an incidental narrowing.
- **`assistantDelta{turnId,seq,text}` / `turnEnd{turnId,stopReason}`** ([#199](../codebase/199.md))
  also map to *no* `SessionAction`, consumed instead by the renderer timeline bridge
  [#202](../codebase/202.md) will build. Field names are renamed from the wire's `snake_case`
  (`AssistantDeltaPayload`/`TurnEndPayload`) to camelCase here — the snake→camel rename happens at
  this consumer boundary, same as every other member. **Unlike `snapshotReceived`, these are
  deliberately *not* content-minimised**: `assistantDelta.text` is the assistant reply text the
  thread renders, carried across IPC on purpose (it is the product, not a leak), so it has a field to
  occupy rather than being dropped. Both members do drop `conversation_id` — the single field neither
  arm carries — since [#202](../codebase/202.md)'s bridge scopes identity for a single active
  conversation, the same assumption [session store](session-store.md) makes for `messageReceived`.
- **`conversationsReceived{conversations}`** ([#139](../codebase/139.md)) also maps to *no*
  `SessionAction`, consumed instead by the conversation-list store
  [#208](https://github.com/pyrycode/pyrycode-desktop/issues/208) (blocked on this ticket). Unlike
  `snapshotReceived`, it reuses the wire row type **verbatim** (snake_case, `ConversationSummary[]`)
  rather than a hand-built minimal shape — there is no sensitive field to strip, so
  `parseConversationSummary`'s own decode-only-known-fields narrowing is the sole minimisation
  control. See [conversation list fetch](conversation-list-fetch.md).
- **`turnState{state}`** ([#214](../codebase/214.md)) also maps to *no* `SessionAction`, consumed
  instead by the [conversation timeline store](conversation-timeline-store.md)'s bridge — the
  `timelineBridge`'s third owned arm, alongside `assistantDelta`/`turnEnd`. `state` reuses
  `WireTurnState` verbatim (the wire's own closed enum, no re-declaration); `conversation_id` is the
  one field dropped, same reasoning as `assistantDelta`/`turnEnd`. Unlike those two, this member
  drives the timeline's scalar `phase`, not an appended `ThreadItem` — see [ADR
  0008](../decisions/0008-thread-timeline-model.md).
- **`toolUse{turnId,toolUseId,name,inputSummary}`** ([#217](../codebase/217.md)) also maps to *no*
  `SessionAction`, consumed instead by the [conversation timeline store](conversation-timeline-store.md)'s
  bridge — the `timelineBridge`'s fourth owned arm. Unlike `turnState`, this is the first arm to drive a
  real, durable `ThreadItem` (an appended `toolCall`, `result: null`) rather than a scalar or text delta —
  see [ADR 0008](../decisions/0008-thread-timeline-model.md). `name`/`inputSummary` are opaque
  daemon-supplied strings (the `stop_reason` #199 / `cwd` #139 posture); `conversation_id` is the one
  field dropped.
- **`modalShown{modalId,class,title,prompt,options,defaultOptionId}` / `modalDismissed{modalId,outcome,
  source}`** ([#201](../codebase/201.md)) also map to *no* `SessionAction`, consumed instead by the
  **third**, independent [modal store + bridge](modal-store-bridge.md), shipped in
  [#223](../codebase/223.md) — the existing session bridge and
  [conversation timeline store](conversation-timeline-store.md) bridge both map these to `null`. Field
  names/types mirror `ModalEvent` ([#122](../codebase/122.md)) field-for-field (the snake→camel decode
  already happened here, at the transport) — so the #223 bridge is a filter + fresh-literal copy, not
  a rename, except for the discriminant tag itself (`modalShown`→`type: 'shown'`,
  `modalDismissed`→`type: 'dismissed'`), which does change. Unlike every arm above, **neither carries a
  `conversation_id`** to drop — the wire payload never has one; `modalId` is the sole correlation key.
  `title`/`prompt`/`options[].label` are untrusted `claude`-surfaced free text the render slice
  ([#224](https://github.com/pyrycode/pyrycode-desktop/issues/224)) must render as plain text, never
  HTML.
- **`toolResult{turnId,toolUseId,isError,resultSummary}`** ([#229](../codebase/229.md)) also maps to *no*
  `SessionAction`, consumed instead by the [conversation timeline store](conversation-timeline-store.md)'s
  bridge — the `timelineBridge`'s fifth owned arm, and the vertical's last transport slice. Unlike
  `toolUse` (appends a `toolCall`), this is the first arm whose mapping **resolves** an existing
  `ThreadItem` in place — see [ADR 0008](../decisions/0008-thread-timeline-model.md). `isError` is a
  required boolean whose `false` is a value, decoded via `requireBoolean` (the `yolo` #180 idiom);
  `resultSummary` is opaque daemon-supplied display text (the `input_summary` #217 / `stop_reason` #199
  posture); `conversation_id` is the one field dropped.
- **`sessionTransition{newSessionId}`** ([#254](../codebase/254.md)) also maps to *no* `SessionAction`,
  consumed by **none of the three** existing bridges — its consumer is a not-yet-built renderer holder,
  [#259](https://github.com/pyrycode/pyrycode-desktop/issues/259) (blocked on this ticket). Unlike
  every prior member, this is a **content-minimised** shape over a **five**-field wire payload
  (`SessionTransitionPayload`): `previous_session_id` / `reason` / `occurred_at` / `workspace_cwd` are
  decoded and fail-closed validated at the transport boundary but dropped at the emit — only
  `new_session_id` (the addressing key #259 retains) crosses IPC, the `snapshotReceived`
  dedicated-minimal-shape precedent applied to a second field family. No `conversation_id` to drop — a
  session boundary is attributed by the connection it arrives on, not a wire field.
- **`sessionSettingsUpdated{sessionId, changeId}`** — introduced with only `sessionId` in
  [#264](../codebase/264.md), widened with `changeId` in [#261](../codebase/261.md). Maps to *no*
  `SessionAction`, consumed by **none** of the three existing bridges — its consumer is the
  [Run configuration write store](run-settings-write-store.md) ([#256](../codebase/256.md), shipped).
  Unlike `sessionTransition` (five decoded fields, four
  dropped), `sessionId` is minimal because its wire payload (`SessionSettingsUpdatedPayload`) has only the
  one field to begin with — the `set_session_settings` (#263) confirmation echoes no applied settings,
  only the addressing id. `changeId` is **not** a wire field: it's the renderer-minted correlation key
  #261's `pendingSettings` map echoes back after matching the reply's `Envelope.in_reply_to`. The event
  deliberately still carries **no `inReplyTo`** — that numeric routing id stays main-internal; widening an
  existing arm's fields is transparent to all three exhaustive bridges (they switch on `type`, not
  fields), so none needed a code change, only a test-literal update for the now-required `changeId`.
- **`sessionSettingsRejected{changeId}`** ([#269](../codebase/269.md)) is the rejected twin of
  `sessionSettingsUpdated`, a **new** arm (not a field-widen, so it *does* force a compiler case in all
  three exhaustive bridges — each a one-line no-op, same as every other atomic-`DaemonEvent`-arm ticket).
  Maps to *no* `SessionAction`, consumed by **none** of the three existing bridges — its consumer is
  the [Run configuration write store](run-settings-write-store.md) ([#256](../codebase/256.md), shipped),
  same as `sessionSettingsUpdated`. Emitted by [daemon connection](daemon-connection.md)'s
  correlation gate when a content-free `daemon-error` (#116) arrives whose `Envelope.in_reply_to` matches
  a pending `set_session_settings` request. Carries **only** `changeId` — deliberately no `sessionId`
  (the wire `error` frame carries none, and `changeId` alone disambiguates two outstanding changes to the
  same session), no `inReplyTo`, and no error code/message.
- **The two unions stay separately declared, per layer.** `DaemonEvent` lives in `shared/ipc`, `SessionAction` in the renderer store. The 1:1 correspondence is a convenience for #19, **not a coupling** — the IPC contract can evolve independently of the store's action vocabulary.
- **Members reuse the wire payload types verbatim** from `../wire/types` (imported by relative path — see below): `connected.ack` is `HelloAckPayload`, `messageReceived.message` is `MessagePayload`, `messagesReceived.messages` is a `MessagePayload[]`, `conversationsReceived.conversations` is a `readonly ConversationSummary[]`. No redefinition, no drift.
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
- **The three debug-bundle members now have a real producer.** [#168](../codebase/168.md) declared them inert; the [debug-bundle orchestrator](debug-bundle-orchestrator.md) ([#169](../codebase/169.md)) now calls `emitDaemonEvent` with `debugBundleProgress`/`debugBundleSaved`/`debugBundleFailed` from the composition root.
- **`snapshotReceived` has a real producer from the start.** [#180](../codebase/180.md) wires `emitDaemonEvent` for it directly from `daemonConnection.ts`'s inbound `case 'message'` arm, the same choke point as `messageReceived`/`messagesReceived` — no separate orchestrator, unlike the debug-bundle members (a snapshot has no multi-step progress to coordinate).
- **`assistantDelta`/`turnEnd` had a real producer but no traffic through #178.** [#199](../codebase/199.md) wired `emitDaemonEvent` for both from the same `case 'message'` choke point; the daemon sent neither until [#179](../codebase/179.md) advertised the `interactive` capability — a Strangler-Fig decode path with a real emitter and zero live callers until then, proven only by unit tests driving `daemonConnection` directly. Now live.
- **`conversationsReceived` has a real producer, but no request trigger yet in this ticket.** [#139](../codebase/139.md) wires `emitDaemonEvent` for it from the same `case 'message'` choke point, and also adds the outbound `requestConversations` [command](command-channel.md) — but nothing calls `sendCommand({type:'requestConversations'})` until [#208](https://github.com/pyrycode/pyrycode-desktop/issues/208)'s store fires it on connect. Unlike `assistantDelta`/`turnEnd` (blocked on a daemon capability flip), this is blocked only on the sibling ticket landing.
- **`turnState` had a real producer but no traffic through #178 — same capability gate as `assistantDelta`/`turnEnd`.** [#214](../codebase/214.md) wired `emitDaemonEvent` for it from the same `case 'message'` choke point, giving `selectPhase` a real source for the first time; no `turn_state` frame reached it until [#179](../codebase/179.md) flipped `interactive`. Proven only by unit tests driving `daemonConnection` and `timelineBridge` directly, and by the timeline store's own no-churn round-trip test, until then. Now live.
- **`toolUse` had a real producer but no traffic through #178 — same capability gate.** [#217](../codebase/217.md) wired `emitDaemonEvent` for it from the same `case 'message'` choke point, giving `selectItems` a real `toolCall` source for the first time; no `tool_use` frame reached it until [#179](../codebase/179.md) flipped `interactive`. Proven only by unit tests driving `daemonConnection` and `timelineBridge` directly, and by the reducer's existing text/tool/text split test, until then. Now live.
- **`modalShown`/`modalDismissed` had real producers but no traffic through #178 — same capability gate.** [#201](../codebase/201.md) wired `emitDaemonEvent` for both from the same `case 'message'` choke point; no `modal_shown`/`modal_dismissed` frame reached it until [#179](../codebase/179.md) flipped `interactive`. Both `daemonEventBridge`/`timelineBridge` still discard the arms as `null`; the third, independent [modal store + bridge](modal-store-bridge.md) ([#223](../codebase/223.md), shipped) is the real consumer, mounted since [#224](../codebase/224.md). Proven only by unit tests driving `daemonConnection` and all three bridges directly, until #179. Now live and answerable end to end.
- **`toolResult` had a real producer but no traffic through #178 — same capability gate.** [#229](../codebase/229.md) wired `emitDaemonEvent` for it from the same `case 'message'` choke point, giving `selectItems` its first real *resolved* `toolCall`; no `tool_result` frame reached it until [#179](../codebase/179.md) flipped `interactive`. Proven only by unit tests driving `daemonConnection` and `timelineBridge` directly (the latter through a real `createTimelineStore()`), and by the reducer's existing `fillResult` correlation tests (#121), until then. Now live.
- **`modalAnswerRejected` is correlated, not decoded.** [#248](../codebase/248.md) added a fifteenth member, `modalAnswerRejected{modalId}` — the only member built entirely from main-side memory rather than a wire field: the daemon `error` (#116) that follows a rejected `modal_answer` carries no `modal_id`, so `daemonConnection.ts` attributes it via a FIFO queue of its own outstanding answered ids (push-on-send, dequeue-on-error, drain-on-accept, reset-on-dial). Consumed by neither `daemonEventBridge` nor `timelineBridge` (both null it); the real, still-dormant owner is the [modal store + bridge](modal-store-bridge.md) — render lands in #249.
- **`sessionSettingsRejected` is correlated by lookup, not by FIFO memory.** [#269](../codebase/269.md) added a seventeenth member, sharing the *same* `daemon-error` wire trigger as `modalAnswerRejected` above but a different attribution mechanism: unlike the FIFO (which cannot disambiguate two outstanding answers of the same kind and picks oldest-first), `daemon-error` here is looked up in `pendingSettings` by its own `Envelope.in_reply_to` — a precise per-request match, not a queue position. On a match this precedence gate **consumes the frame entirely**, skipping both the bundle reassembler and the `modalAnswerRejected` FIFO shift; on no match, both fire exactly as before #269. Consumed by none of the three existing bridges; the real consumer is the [Run configuration write store](run-settings-write-store.md) ([#256](../codebase/256.md), shipped), same as `sessionSettingsUpdated`.

## Security posture

AC4 ("no key material, raw frames, or bytes cross the bridge") is **enforced by the type, not by convention.** The union references only `HelloAckPayload` / `ErrorPayload` / `MessagePayload` for its session-lifecycle members, none of which has a token, key, or raw-byte field. `QrPayload` (token, `server_static_pubkey`), `HelloClientPayload` (token), and `InnerFrameV2` (base64 `data`) are **not** members and must never become members — a developer cannot serialize a secret here because no member has a field to hold one. `MessagePayload.text` does cross (messages are displayed — that is the product, not a leak) and must not be logged. The channel is **receive-only** and exposes no `ipcRenderer`, so a compromised renderer gains no command capability toward the transport, keys, or socket through #18. The [#168](../codebase/168.md) debug-bundle members hold the same invariant with different carriers: `debugBundleProgress.chunksReceived` is a count, `debugBundleSaved.path` is a local filesystem path, `debugBundleFailed.reason` is the closed `DebugBundleFailure` enum — never a token, key, raw frame, or bundle bytes. The closed enum is a deliberate information-minimisation boundary: a hostile daemon's raw error string cannot be assigned to `reason` (a `string` isn't a `DebugBundleFailure`), so the [orchestrator](debug-bundle-orchestrator.md) ([#169](../codebase/169.md)) is structurally forced to map transport internals down to one of the three categories before they can reach the renderer. [#199](../codebase/199.md)'s `assistantDelta`/`turnEnd` are the one deliberate exception to "minimise what crosses": `assistantDelta.text` carries real assistant-reply content (the render payload, same category as `messageReceived.text`) — the AC5 invariant it still satisfies is narrower ("never a token/key/raw frame"), not "never any content."

> Pre-existing hardening note (out of scope for #18): `src/main/index.ts` sets `sandbox: false`. The whole bridge surface is `sandbox: true`-compatible; route the flip to a dedicated hardening ticket. (#17, the command half, also left it untouched — still open.)

## Related

- [Daemon-event bridge (renderer)](daemon-event-bridge.md) — the #19 consumer that maps this union onto `SessionAction` and dispatches into the store; also the [#168](../codebase/168.md) consumer that tolerates the three debug-bundle members by returning `null`
- [Session store](session-store.md) — the `SessionAction` mapping target #19 dispatches into
- [Debug-bundle reassembly (inbound)](debug-bundle-reassembly.md) / [#116](../codebase/116.md) — source of the finer `BundleFailReason` (5 values) the [orchestrator](debug-bundle-orchestrator.md) (#169) maps onto this channel's coarse `DebugBundleFailure` (3 values)
- [Command channel](command-channel.md) / [#168](../codebase/168.md) — the mirror-image `requestDebugBundle` command that triggers the download this channel's three new members report on
- [Debug-bundle orchestrator](debug-bundle-orchestrator.md) / [#169](../codebase/169.md) — the real producer of the three debug-bundle members, wired at the composition root
- [Screen snapshot fetch](screen-snapshot-fetch.md) / [#180](../codebase/180.md) — the `snapshotReceived` member, its `requestSnapshot` [command channel](command-channel.md) mirror, and the content-minimisation reasoning behind its dedicated (non-wire-type-reusing) shape
- [Thread timeline (conversation model)](thread-timeline.md) / [#199](../codebase/199.md) — the `assistantDelta`/`turnEnd` members, the transport slice of the structured-stream render vertical, and the deliberate content-carrying divergence from `snapshotReceived`'s minimisation pattern
- [Inbound message decode](inbound-message-decode.md) / [#199](../codebase/199.md) — the `assistant_delta`/`turn_end` decode this channel's two new members are constructed from
- [Conversation list fetch](conversation-list-fetch.md) / [#139](../codebase/139.md) — the `conversationsReceived` member, its `requestConversations` [command channel](command-channel.md) mirror, and why it reuses the wire row type verbatim instead of a hand-built minimal shape
- [Conversation timeline store](conversation-timeline-store.md) / [#214](../codebase/214.md) — the `turnState` member, the third arm the `timelineBridge` owns, and the closed-enum decode idiom cloned from `role`
- [Conversation timeline store](conversation-timeline-store.md) / [#217](../codebase/217.md) — the `toolUse` member, the fourth arm the `timelineBridge` owns, and the first to drive a durable `toolCall` item rather than text or a scalar
- [Modal-prompt model](modal-prompt-model.md) / [#201](../codebase/201.md) — the `modalShown`/`modalDismissed` members, the tenth and eleventh no-`SessionAction` arms, consumed by neither existing bridge; the real consumer is the third, independent [modal store + bridge](modal-store-bridge.md), shipped in [#223](../codebase/223.md)
- [Conversation timeline store](conversation-timeline-store.md) / [#229](../codebase/229.md) — the `toolResult` member, the twelfth no-`SessionAction` arm and the vertical's last transport slice; the fifth arm the `timelineBridge` owns and the first to resolve an existing `ThreadItem` in place rather than append one or set a scalar
- [Conversation create](conversation-create.md) / [#241](../codebase/241.md) — the `conversationCreated` member, the thirteenth no-`SessionAction` arm and the write-side twin of `conversationsReceived` (#139); consumed by neither existing bridge, real consumer is the render sibling #242
- [#254 codebase notes](../codebase/254.md) — the `sessionTransition` member, the fourteenth no-`SessionAction` arm and the second (after `snapshotReceived`) to content-minimise its emit relative to its decoded wire payload; consumed by none of the three existing bridges, real consumer is the renderer holder #259, blocked on this ticket
- [#248 codebase notes](../codebase/248.md) — the `modalAnswerRejected` member, the fifteenth no-`SessionAction` arm and the first built entirely from main-side correlation memory rather than a decoded wire field (the daemon `error` it reports on carries no `modal_id`); owned by the [modal store + bridge](modal-store-bridge.md), dormant until the render slice #249
- [#264 codebase notes](../codebase/264.md) — introduced the `sessionSettingsUpdated` member, the sixteenth no-`SessionAction` arm and, unlike every prior member, minimal not because a field was dropped at the emit but because the decoded wire payload itself has only one field
- [#261 codebase notes](../codebase/261.md) — widened `sessionSettingsUpdated` with `changeId`, the renderer-minted correlation key matched against `Envelope.in_reply_to`; consumed by none of the three existing bridges, real consumer is [#256](../codebase/256.md) (shipped)
- [#269 codebase notes](../codebase/269.md) — the `sessionSettingsRejected` member, the seventeenth no-`SessionAction` arm and the rejected twin of `sessionSettingsUpdated`; emitted by [daemon connection](daemon-connection.md)'s `pendingSettings`-lookup precedence gate on a correlated `daemon-error`, which on a match also suppresses that ticket's own `modalAnswerRejected` FIFO and the #116 bundle reassembler; consumed by none of the three existing bridges, real consumer is [#256](../codebase/256.md) (shipped)
- [Run configuration write store](run-settings-write-store.md) / [#256 codebase notes](../codebase/256.md) — the pending→confirm/reject store consuming both `sessionSettingsUpdated` and `sessionSettingsRejected`; a fourth, independent App-level subscriber on this channel, alongside the three exhaustive bridges above
- [ADR 0009 — Modal-prompt model](../decisions/0009-modal-prompt-model.md) — the normative contract these two arms are shaped to feed
- [ADR 0004 — Renderer session store: reducer + sealed actions + wire types](../decisions/0004-renderer-session-store-reducer-wire-types.md) — the `failed → ErrorPayload → ConnectionError` seam
- [ADR 0001 — Stack: transport in the background process](../decisions/0001-stack-electron-react-typescript.md) · [ADR 0002 — Remote head over relay, shared wire](../decisions/0002-remote-head-over-relay-shared-wire.md)
- [#18 codebase notes](../codebase/18.md) · Spec: `docs/specs/architecture/18-typed-daemon-event-channel.md` · [#168 codebase notes](../codebase/168.md) · Spec: `docs/specs/architecture/168-debug-bundle-ipc-contract.md`
