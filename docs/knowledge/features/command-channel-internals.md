# Command channel — internals

Part of [Command channel](command-channel.md).

## How it works

Five pieces across three layers (three of them in one shared file):

| Piece | File | Layer |
|---|---|---|
| `RendererCommand` union + `COMMAND_CHANNEL` + `sendMessageCommand` + `isRendererCommand` | `src/shared/ipc/commands.ts` | shared |
| `onCommand(source, handler)` receiver seam | `src/main/receiveCommand.ts` | background |
| `window.pyry.sendCommand(command)` | `src/preload/index.ts` | preload bridge |

`src/shared/ipc/` is the IPC-contract module (created by #18 for `events.ts`). #18 reserved `commands.ts` as the seam for exactly this ticket, so **the two tickets never edit the same file** — conflict-free even run near-simultaneously.

### 1. The sealed union + constructor + guard (`src/shared/ipc/commands.ts`)

Imports the wire payload by **relative** path within `shared` (`../wire/types`).

```ts
export const COMMAND_CHANNEL = 'pyry:command' as const

export type RendererCommand =
  | { type: 'sendMessage'; payload: SendMessagePayload; serverId?: string }
  | { type: 'requestDebugBundle' }
  | { type: 'requestConversations' }
  | { type: 'createConversation'; payload: CreateConversationPayload }
  // … plus every later member [the command-member log](command-channel-members.md) documents

export function sendMessageCommand(fields: SendMessagePayload, serverId?: string): RendererCommand {
  return serverId === undefined ? { type: 'sendMessage', payload: fields }
    : { type: 'sendMessage', payload: fields, serverId }
}

export function isRendererCommand(value: unknown): value is RendererCommand {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false
  switch (value.type) {
    case 'sendMessage': {
      const serverId = 'serverId' in value ? value.serverId : undefined
      return (serverId === undefined || (typeof serverId === 'string' && serverId.length > 0 && serverId.length <= 1024)) &&
        'payload' in value && isSendMessagePayload(value.payload)
    }
    case 'requestDebugBundle':
      return true
    case 'requestConversations':
      return true
    default:
      return false
  }
}
```

- **`RendererCommand` is a sealed discriminated union on `type`.** `sendMessage` reuses the wire `SendMessagePayload` (`conversation_id`, `message_id`, `text` — `src/shared/wire/types.ts`) **verbatim** — no field is remapped between layers; the bare `requestDebugBundle` (#168) carries **no payload** because the debug bundle is daemon-global — there is nothing to parameterise; the bare `requestConversations` ([#139](../codebase/139.md)) likewise carries **no payload** — the daemon returns every conversation, so there is nothing to select. No member exposes a field that could hold a token, key, or raw frame (AC5) — the payload-bearing ones reuse only wire types, the bare ones carry nothing. Extend additively (connect/disconnect) when their transport tickets land — **and add a matching case to `isRendererCommand` in lockstep**, or the new member is silently dropped at the boundary; conversely, **removing** a member and forgetting its `case` is a compile error in the switch's siblings, not a silent gap (see #620 below). `requestConversations`'s bare `return true` is the boundary edit for #139.
- **A third member, `requestSnapshot{conversation_id}`, existed from [#180](../codebase/180.md) until [#620](../codebase/620.md) removed it** — the code sample and count above already reflect the removal. It reused the wire `RequestSnapshotPayload{conversation_id}` verbatim, guarded by `isRequestSnapshotPayload` (mirroring `isSendMessagePayload` — one `conversation_id` string check), and was the trigger for the [screen snapshot fetch](screen-snapshot-fetch.md) feature (now fully removed — its inbound decode was the last piece to fall, in [#622](../codebase/622.md)). #620 deleted the union member, the `case` in `isRendererCommand`, and `isRequestSnapshotPayload` itself; a structurally well-formed `{ type: 'requestSnapshot', … }` now falls through to the switch's default-deny, proven by a positive rejection assertion in `commands.test.ts`. Every comment in this file and its test that cited `requestSnapshot` as a design precedent (the "twin"/"mirrors" phrasing below) was re-anchored to a surviving member — mostly `sendMessage` (for the `index.ts` "direct to the connection method" idiom) or `isUnarchiveConversationPayload` (for the single-`conversation_id`-string boundary-guard precedent).
- **A payload-free member's guard case is a bare `return true`.** `requestDebugBundle` (and now `requestConversations`, #139) has no payload to validate, so a well-formed `type` alone is complete acceptance — the same structural-minimum posture as `sendMessage` accepting extra harmless fields.
- **`sendMessageCommand` is the pure, tested constructor** — a one-line wrap of already-assembled fields. It deliberately does **not** mint the `message_id`: randomness would break purity, so #11's composer generates it (`crypto.randomUUID()` — main-safe, security-appropriate) and passes the assembled `SendMessagePayload` in. The `RendererCommand` return type is the compile-time guarantee AC4 requires — a member with an unmodelled `type` cannot type-check.
- **`isRendererCommand` is the boundary validator.** Minimum structural checks: `value` is a non-null object with a known `type`; for `sendMessage`, `value.payload` is a non-null object whose `conversation_id`, `message_id`, and `text` are all strings. It **accepts** commands carrying extra/unknown fields (structural minimum — do not reject on excess) and **rejects** everything else. Pure; never throws. It is co-located with the union so the two evolve in lockstep — the `switch (value.type)` shape makes a missing case visible.

#### Message refusal attribution

`sendMessageCommand(payload, serverId?)` accepts an optional host ID beside the
wire payload, validated as absent/undefined or a nonempty string of at most 1024
UTF-16 units. The composer supplies its retained host. Main still routes solely
through the trusted conversation-to-host index; this renderer field cannot select
a transport or retarget a message. If routing refuses the conversation, main emits
`messageDelivery{conversationId,messageId,status:'not-sent'}` stamped with this
attribution ID (or null when absent), independently of the diagnostic drop.
The ID never enters the wire payload. See [local delivery ownership](composer-send-internals.md#2-local-delivery-status-and-receipt-settlement)
for inactive-thread updates and host-mismatch rejection.

#### Switch-agent validation

`switchAgent` carries the shared `SwitchAgentPayload`: required nonempty string
`conversation_id`, exactly `claude` or `codex`, required string `model` (including
empty), and absent/undefined/string `effort`. Its guard rejects nonobject, null
and array payloads, missing or mistyped required fields, unsupported agents, empty
IDs and non-string effort including null. Extra keys pass admission; the main-only
builder copies named fields into a fresh literal before encoding.

An empty model selects the target template default; explicit empty effort clears
effort and must remain present. Structured clone preserves an own `undefined`
property, so the guard accepts it and the builder omits it with `!== undefined`,
never a truthiness check. All strings pass unchanged. See
[Switch-agent request](switch-agent-request.md) for the exact payload, owning-host
routing, failure containment and preload-to-wire coverage. Menu/confirmation and
refusal correlation remain #1661 and #1660 respectively.

#### Modal answer validation

`AnswerModalCommandPayload = Omit<ModalAnswerPayload, 'answer_token'>` carries
`modal_id`, `option_id` and optional `always_allow?: boolean`. The command keeps
wire field names. `isAnswerModalPayload` requires both IDs to be strings and accepts
`always_allow` only when absent or Boolean; true and false pass unchanged. A
present `undefined`, null, number, string, array or object rejects the whole command,
so `onCommand` invokes no handler and sends nothing. Structured clone preserves
an own `undefined` property: test presence with `in` before checking type, rather
than treating `value.always_allow === undefined` as absence.

The guard accepts unknown extras as elsewhere in this channel. The
[main sender](daemon-connection-methods.md#modal-answers-and-cancellation) rebuilds
modeled fields and mints the token; renderer-supplied tokens, rules and destinations
never become answer authority. False or absence requests no additional grant.
The daemon validates any requested session grant against its retained offer.

`commands.test.ts` covers Boolean acceptance and invalid presence, including explicit
undefined. The receiver-to-wire tests in `daemonConnection.test.ts` additionally
prove that rejected commands never send and accepted fields survive main's rebuild;
guard tests alone cannot prove either sender filtering or wire carriage.

### 2. The receiver seam (`src/main/receiveCommand.ts`)

Imports the shared contract by **relative** path (`../shared/ipc/commands`). **No `electron` import** — the source is injected structurally, so the test runs in plain Node (mirrors `emitDaemonEvent.ts`).

```ts
export interface CommandSource {
  on(channel: string, listener: (event: unknown, command: unknown) => void): void
  removeListener(channel: string, listener: (event: unknown, command: unknown) => void): void
}

export function onCommand(
  source: CommandSource,
  handler: (command: RendererCommand) => void
): () => void {
  const listener = (_event: unknown, raw: unknown): void => {
    if (isRendererCommand(raw)) {
      handler(raw)
    } else {
      console.warn('pyry:command — dropped malformed command')
    }
  }
  source.on(COMMAND_CHANNEL, listener)
  return () => source.removeListener(COMMAND_CHANNEL, listener)
}
```

- **The single inbound seam, and the untrusted→trusted checkpoint.** Every incoming command passes through `isRendererCommand`; only shape-valid commands reach `handler`, malformed input is dropped. The composition root (#11/transport) will call `onCommand(ipcMain, handler)` with a handler that builds a `send_message` `Envelope`; nothing is wired here yet.
- **The `IpcMainEvent` first arg is stripped** — the wrapper never forwards it. It exposes `.sender` / `.reply` / `.senderFrame` / `.ports`, a capability leak downstream. Only the validated command reaches the handler.
- **Injected `CommandSource`, not an imported `ipcMain`.** Typing the parameter as the minimal `{ on, removeListener }` structural interface is what keeps this module electron-free and unit-testable with a `{ on: vi.fn(), removeListener: vi.fn() }` fake — a real `ipcMain` is structurally assignable. Same shape the event half used with `DaemonEventSink`.
- **Returns an unsubscribe closure** that calls `removeListener` with the **exact same `listener` reference** it registered — so the handle removes precisely the listener it added (no leak, no double-fire). Mirrors `onDaemonEvent`.
- **On a dropped command it logs a fixed string only** — never `raw`. A `console.warn(raw)` would leak `SendMessagePayload.text` to main-process stdout.

### 3. The preload sender (`src/preload/index.ts`)

One method added to the existing `api` object; imports the contract by **relative** path. `ping`, `onDaemonEvent`, and the `process.contextIsolated` guard are unchanged.

```ts
sendCommand: (command: RendererCommand): void => {
  if (!isRendererCommand(command)) throw new Error('Invalid command')
  ipcRenderer.send(COMMAND_CHANNEL, command)
},
```

- **Synchronous preload validation.** Every command is checked before IPC. Invalid
  input throws exactly `Invalid command`, with no raw value or error text, and emits
  no command frame. Main's receiver revalidates independently as the authoritative
  untrusted-to-trusted boundary. Callers must handle synchronous rejection: composer
  submission preserves the draft and attachments and marks its echo Not sent.
  The mounted switch-agent regression catches null-effort rejection before its valid
  processing barrier, then checks exact owner-only decoded frames; a test that lets
  the exception abort never reaches those no-malformed-frame assertions.
- **Fire-and-forget `send`, not `invoke`.** Commands need no synchronous reply — results return later as separate `DaemonEvent`s over the [event channel](daemon-event-channel.md). Using `send`/`ipcMain.on` (not `invoke`/`ipcMain.handle`) means there is no reply channel a handler could leak data back through. Mirrors the event half's `webContents.send` / `ipcRenderer.on`.
- **`COMMAND_CHANNEL` is hardcoded inside `sendCommand`** — the renderer cannot address an arbitrary IPC channel; its only outbound surface is a shape-typed command on this one channel.
- **`ipcRenderer` stays inside the preload module** — only the typed `sendCommand` is added to `api`. `PyryApi = typeof api` flows the method's type to `window.pyry` through the **untouched** `index.d.ts` (zero consumer cascade — nothing existing calls the new surface).

### Data flow

```
 #11 composer (later)      commands.ts             preload bridge            receiveCommand           #11 / transport (later)
 user text + ids ───────►  sendMessageCommand ───► window.pyry.sendCommand ─► onCommand(handler) ────► build send_message Envelope
   (message_id gen)        RendererCommand          ipcRenderer.send ──IPC──► ipcMain.on              → Noise transport → daemon
                           (pure, tested)           COMMAND_CHANNEL            strip event, GUARD ✓
                                                                              isRendererCommand(raw)
```

`sendCommand` is the single outbound choke point; `onCommand` is the single inbound seam. **The guard in `onCommand` is the untrusted→trusted checkpoint** — everything downstream of the handler receives a validated `RendererCommand`. No transport is reached in #17; the daemon `Envelope` is built by #11.

