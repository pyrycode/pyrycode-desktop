# Command channel

The typed **command pipe** from the renderer window to the background process: a sealed `RendererCommand` union, a pure command constructor, a runtime boundary guard, a single preload sender on `window.pyry`, and a single background receiver seam. It is how the React window hands **user actions** to the background process — where the Noise transport will live — without the renderer ever holding a socket, transport handle, or key material.

Introduced in [#17](../codebase/17.md). It is the **command half** (renderer→main) of the background↔window bridge; the mirror-image **event half** (background→renderer) is the [daemon-event channel](daemon-event-channel.md) (#18). No transport is wired yet — this ticket builds the outbound *seam* that #11 (composer submit → send-message envelope) and the transport (#4/#7) will consume. The command union is shaped so later transport commands (connect, disconnect) extend it **additively** without reshaping the bridge.

The union grew its second member in [#168](../codebase/168.md): a **bare** `requestDebugBundle` command (no payload — the debug bundle is daemon-global, nothing to parameterise). It rides this same `sendCommand`/`onCommand` seam unchanged — no new channel, no new preload method — and is the first proof the "extend additively" design above actually holds under a payload-free member.

The union grew a third member in [#180](../codebase/180.md): a **payload-carrying** `requestSnapshot`
command (`RequestSnapshotPayload{conversation_id}`, reused verbatim from the wire types) — the
renderer-invokable trigger for the [screen snapshot fetch](screen-snapshot-fetch.md) feature. Same
seam, same guard-in-lockstep discipline; see below.

The union grew a fourth member in [#139](../codebase/139.md): a second **bare** command,
`requestConversations` (no payload — the daemon returns every conversation, nothing to
parameterise) — the renderer-invokable trigger for the [conversation list
fetch](conversation-list-fetch.md) feature. Its guard case is a bare `return true`, the same
structural-minimum posture `requestDebugBundle` established.

The union grew a fifth member in [#241](../codebase/241.md): a **payload-carrying**
`createConversation` command (`CreateConversationPayload{is_promoted, name, cwd}`, reused verbatim
from the wire types — the write-side twin of `requestSnapshot`) — the renderer-invokable trigger for
the [conversation create](conversation-create.md) feature. Its guard, `isCreateConversationPayload`,
is the first to check each field's *presence* (`'field' in value`) as well as type, since all three
fields are nullable-and-present (`T | null`, never `undefined`) rather than optional.

The union grew an eighth member in [#263](../codebase/263.md): a **payload-carrying**
`setSessionSettings` command (`SetSessionSettingsPayload{session_id, model?, effort?, yolo?}`, reused
verbatim from the wire types — the write-side twin of `requestSnapshot`, mirroring `createConversation`
in shape) — the renderer-invokable trigger for the [session settings send](session-settings-send.md)
feature. Its guard, `isSetSessionSettingsPayload`, is the **first optional-absent** (rather than
nullable-present) presence check: each of `model`/`effort`/`yolo`, *when present* (`'field' in value`),
must be correctly typed; an *absent* optional is accepted outright — the mirror image of
`isCreateConversationPayload`'s nullable-present checks. Ships dormant — #257 is the not-yet-built
consumer.

[#261](../codebase/261.md) widened this member with a **top-level sibling field**, `changeId: string` —
a renderer-minted, client-internal correlation key riding **alongside** `payload`, never nested inside
it (the wire builder consumes only `payload`, so this keeps `changeId` structurally off the wire; the
same top-level-sibling shape as `message_id` on `sendMessage`). `isRendererCommand`'s `setSessionSettings`
case gained `'changeId' in value && typeof value.changeId === 'string'` — the untrusted-boundary check
for the second command to carry a client-minted correlation string. No other member changed shape.

The union grew an eleventh member in [#306](../codebase/306.md): a second **bare** command, `interrupt`
(no payload — the frame was nullary; the daemon mapped it to a single claude Esc, no field to
parameterise) — the renderer-invokable trigger for the [interrupt envelope](interrupt-envelope.md)
feature's now-complete command pathway. Its guard case was the same bare `return true` posture
`requestDebugBundle`/`requestConversations` established; unlike every other command added since
`requestConversations`, it has no daemon reply to correlate — `daemonConnection.interrupt()` records no
outstanding-request state, mirroring `dequeueMessage`'s (#300) fire-and-forget posture rather than any
payload shape. [#1120](https://github.com/pyrycode/pyrycode-desktop/issues/1120) then gave it an
optional top-level `serverId?: string`, one of six server-scoped members — see [Daemon connection —
routing § Server-scoped command routing (#1120)](daemon-connection-server-scoped-routing.md) for that shape, which
this file never restated. [#1092](https://github.com/pyrycode/pyrycode-desktop/issues/1092) replaced
both: `interrupt` stopped being bare, gained a **required** `InterruptCommandPayload{conversation_id}`,
and dropped `serverId` entirely. See the growth-log entry further down for the current shape.

The union grew a twelfth member in [#391](../codebase/391.md): a **payload-carrying** `notify`
command (`NotifyPayload{kind}`, `kind: 'turn-complete' | 'prompt'`) — the renderer-invokable trigger
for the [push notifications](push-notifications.md) delivery primitive. Unlike every prior member,
`NotifyPayload` is **defined in this file**, not imported from `../wire/types` — it is a **main-local
side-effect command that never reaches the transport** (the `AnswerModalCommandPayload` precedent).
Its guard, `isNotifyPayload`, is also the first to depart from the sibling `is*Payload` shape: every
other guard checks `typeof value.field === 'string'` (accepting any string); this one tests
**closed-set membership** (`kind === 'turn-complete' || kind === 'prompt'`) — the by-construction
guarantee that no daemon-relayed text can ride into an OS notification. Ships dormant — #392 is the
not-yet-built consumer. [#1597](../codebase/1597.md) added a second, independent optional field,
`token?: string`, admitted by a new sibling guard `isNotificationToken` (`^[A-Za-z0-9-]{1,64}$`) rather
than `isNotifyPayload`'s closed-set check — opaque and renderer-minted, so main only ever echoes it
back on click; see [Push notifications § Resolving the click to its own
conversation](push-notifications.md#resolving-the-click-to-its-own-conversation-1597).

The union grew a thirteenth and fourteenth member in
[#920](https://github.com/pyrycode/pyrycode-desktop/issues/920): `answerQuestions`
(`AnswerQuestionsCommandPayload{question_batch_id, answers}`) and `refuseQuestions`
(`RefuseQuestionsCommandPayload{question_batch_id}`) — the question vertical's resolution pair,
`Omit`-derived from the wire `QuestionAnswerPayload`/`QuestionRefusedPayload` with `answer_token`
excluded, mirroring `AnswerModalCommandPayload`. Unlike the modal pair, **both** question frames carry
`answer_token` on the wire, so both are `Omit`-derivatives and both mints are main-side. `answerQuestions`
carries the union's **first structured payload** — `answers` is an array of `{ question_index, values }`
objects, not a flat scalar row — so its guard, `isAnswerQuestionsPayload`, is the file's first to
*recurse*: every sibling guard checks one level, this one validates each entry's fields too. **It
iterates with `for…of`, never `Array.prototype.every`, and that is load-bearing, not style**: `every`
skips holes, so a sparse `values` array would pass it while `JSON.stringify` still emits `null` for the
hole — a `null` inside a declared `string[]`. `for…of` goes through the iterator, which yields
`undefined` for a hole, and the `typeof` check then rejects it. Sparse arrays survive structured clone,
so this is reachable over IPC, not theoretical. Both guards stay structural-minimum otherwise — a
smuggled `answer_token`, at either the top level or on an entry, is not rejected here; the main-side
sender's fresh-literal rebuild (deep, for `answerQuestions`) is what makes it lose. `refuseQuestions`'s
guard, `isRefuseQuestionsPayload`, is an exact clone of `isCancelModalPayload` with the key renamed.
Neither has a correlation window on the daemon-connection side: the daemon emits no reply for a
rejected question answer, so there is nothing to correlate, unlike `answerModal`'s #248 push. See
[question resolution envelope](question-resolution-envelope.md) for the wire contract and builders both
drive.

The union's `requestSessionSettings` member (#491, bare from the start and not previously called out
in this growth log) reuses the wire `RequestSessionSettingsPayload{conversation_id}` type and carries
a **required** payload: `{ type: 'requestSessionSettings'; payload: RequestSessionSettingsPayload }`.
The daemon made the frame conversation-keyed on 2026-08-20 (pyrycode#1586/#1610), answering an unnamed
request with a silent zero-valued reply rather than an error; [#945](https://github.com/pyrycode/pyrycode-desktop/issues/945)
threaded the capability through `src/main/`/`src/shared/` with the payload **optional**, because the
sole renderer sender still sent no id; [#946](https://github.com/pyrycode/pyrycode-desktop/issues/946)
supplied a real one — [Run configuration store](run-config-store.md)'s `requestRunConfigSnapshot` now
resolves the active conversation at both call sites — and tightened the payload back to required. Its
guard collapsed to the neighbours' idiom, `'payload' in value && isRequestSessionSettingsPayload(value.payload)`:
an absent or explicitly-`undefined` `payload` is now refused **by value**, inside
`isRequestSessionSettingsPayload`, rather than accepted as a second shape — structured clone still
preserves an explicitly-`undefined` property crossing `ipcRenderer.send`, so the `'payload' in value`
half alone would let one through; `isRequestSessionSettingsPayload` is what closes it. The payload
guard itself is unchanged: type checked, not emptiness, since `''` is a real value the daemon itself
polices. See [Run configuration store § Conversation-keyed since
2026-08-20](run-config-store.md#conversation-keyed-since-2026-08-20-945946) for the daemon-side
degradation contract this closes.

[#1055](https://github.com/pyrycode/pyrycode-desktop/issues/1055) widened the existing `sendMessage`
member's payload rather than adding a new one: `SendMessagePayload` gained an optional
`attachment_ids?: string[]`, naming the uploads the message references so the daemon can point claude at
them (upstream `pyrycode#2036`/`#2038`). `isSendMessagePayload`'s new arm, `isAttachmentIdList`, is the
file's **third** array-field guard after `answers` (#920) and inherits both of that guard's lessons
rather than re-deriving them: it iterates with `for…of`, never `Array.prototype.every` (`every` skips
holes, and a sparse array survives structured clone as a `null`-bearing `string[]`), and it must accept a
**present key holding `undefined`** — structured clone preserves that own property, and the sender
(`composerSend.ts`) assigns the field unconditionally so `JSON.stringify` drops it on the frames that
carry none. Unlike `answerQuestions`'s entries, elements here are checked for non-emptiness only, not full
shape: the canonical lowercase-UUIDv4 check is a deliberate omission, left to the daemon (the
`RequestAttachmentPayload` precedent — *documented, not validated* on this side), since the only producer
is the window echoing back ids this process itself minted with `randomUUID()`. See [Composer send §
10](composer-send.md#10-attachments-named-on-the-outbound-frame---takeattachments-1039-reworked-by-1055)
for the sender side.

The union gained a `requestModelList` member in [#1165](https://github.com/pyrycode/pyrycode-desktop/issues/1165):
a **payload-carrying** command (`RequestModelListPayload{conversation_id}`, reused verbatim from the wire
types) that asks the daemon for one conversation's model/effort vocabulary on demand — closing a gap
neither existing `model_list` push covers, a conversation created after this app connected. Sited beside
`requestSessionSettings` and superficially its clone, but the payload is **required from the start**, for
a stronger reason than that neighbour's own required-since-#946 history: `requestSessionSettings` answers
an unnamed request with a silent zero-valued reply, so a bare send there was merely useless; here an
unnamed request has nothing to ask about at all, so `payload` is non-optional in the union member itself
and a bare send is a compile error. `isRequestModelListPayload` is `isRequestSessionSettingsPayload` with
the key unchanged and the name changed — one present-and-string `conversation_id` check, type not
emptiness (`''` passes the guard and is refused by the daemon as `conversation.not_found`) — and its
`isRendererCommand` case is the same `'payload' in value && isRequestModelListPayload(value.payload)`
idiom: the explicitly-`undefined` case is refused **by the payload guard**, not by the `in` check, since
structured clone preserves an own property holding `undefined` across the bridge (`hasValidServerId`'s
documented fact, restated here for a second required-payload command). Ships with **no renderer sender**
in the slice that declares it — [#1166](https://github.com/pyrycode/pyrycode-desktop/issues/1166) adds
the trigger, on conversation open. See [Model-list wire types § Outbound
ask](model-list-wire-types.md#outbound-ask-1165) for the frame this command asks for and the no-retry
rule that governs it, and [Daemon connection — methods](daemon-connection-methods.md) for the connection
method + registry delegate it drives.

The union gained a `requestSystemPrompt` member in [#1230](https://github.com/pyrycode/pyrycode-desktop/issues/1230):
a **payload-carrying** command (`RequestSystemPromptPayload{conversation_id}`, reused verbatim from the
wire types) that asks the daemon what system prompt a conversation holds and whether the running
session was started with a different one. Sited beside `requestModelList` and its structural clone —
`isRequestSystemPromptPayload` is `isRequestModelListPayload` with the key unchanged and the name
changed, one present-and-string `conversation_id` check, type not emptiness — but the reasoning for
checking type only diverges sharply from that neighbour's, and is worth reading before "hardening" it.
`requestModelList` tolerates `''` because an unresolvable id there draws the daemon's visible
`conversation.not_found`. **This verb has no error frame at all**, so an empty id reaching the wire
would draw an ordinary-looking `no_session` reply with an absent prompt, and the correlation map would
file that false "no prompt, no session" reading against a real conversation — a reading nothing
downstream can tell from a true one. The refusal that keeps such a frame off the wire is nonetheless
**not** this guard: it is the routing lookup at `src/main/index.ts`'s dispatch case
(`router.route(id)?.…`), which already refuses and logs an id no server has claimed and refuses far
more than emptiness alone. Ships with **no renderer sender** in the slice that declares it —
[#1231](https://github.com/pyrycode/pyrycode-desktop/issues/1231) adds the trigger, on conversation
open. See [System prompt send](system-prompt-send.md) for the frame this command asks for and the
no-retry rule that governs it, and [Daemon connection — methods](daemon-connection-methods.md) for the
connection method + registry delegate it drives.

The union gained a `newSession` member in [#1217](https://github.com/pyrycode/pyrycode-desktop/issues/1217):
asks the daemon to **kill** claude and spawn a fresh one in the conversation it names — not a typed
`/clear`, which clears context in place and keeps the process. The Actions menu's Reset session row
dispatches this member directly as of [#1496](https://github.com/pyrycode/pyrycode-desktop/issues/1496)
(folded from a separate row that sent `/clear` as ordinary message text). It is the **only** member whose
payload type *tightens* its wire type rather than
reusing it verbatim or `Omit`-ing a field from it: `NewSessionCommandPayload = Required<NewSessionPayload>`.
The wire `NewSessionPayload.conversation_id` is optional because the daemon publishes it so (pyrycode#2099)
— the absent/`{}`/empty forms are one wire meaning, the daemon's process-wide follow-active cursor — and
a client that can name a conversation must always name one, so the command payload makes the bare form a
compile error instead. `isNewSessionPayload` is `isRequestModelListPayload` with one clause added: it
also rejects `''`, the **one guard in this file that checks emptiness** rather than type alone, because
on this verb an empty id is not an unresolvable id — it is the bare-form restart, which would hand the
daemon's shared cursor to a renderer that read a not-yet-loaded conversation id. See [New session
envelope](new-session-envelope.md) for the full frame, the builder, and why the wire type stays optional
regardless (CLAUDE.md no-drift). Ships with **no renderer sender** in the slice that declares it, like
`requestModelList` before it — the sibling ticket adds the trigger.

**The `interrupt` member (#306, eleventh) was widened twice more, most recently in
[#1092](https://github.com/pyrycode/pyrycode-desktop/issues/1092), which mirrors `newSession`'s tightening
shape exactly.** `interrupt` was bare from #306 through [#1120](https://github.com/pyrycode/pyrycode-desktop/issues/1120)
(which gave it, like five siblings, an optional top-level `serverId?: string` — see [Daemon connection —
routing § Server-scoped command routing (#1120)](daemon-connection-server-scoped-routing.md)). #1092 replaced both:
`serverId` is gone, and the member is now `{ type: 'interrupt'; payload: InterruptCommandPayload }` with
`InterruptCommandPayload = Required<InterruptPayload>` — the same tightens-the-wire-type idiom
`NewSessionCommandPayload` established, so the bare (or server-addressed) form is a compile error
instead of a runtime possibility. `interruptCommand(fields: InterruptCommandPayload)` replaced the
zero-arg constructor, and the guard's `case 'interrupt':` arm is now `'payload' in value &&
isInterruptPayload(value.payload)` — `isInterruptPayload` repeats `isNewSessionPayload`'s `''`-refusal
rationale word for word, since on this verb an empty id is the same cross-conversation misfire an absent
one is. Once `interrupt` left it, [#1120](https://github.com/pyrycode/pyrycode-desktop/issues/1120)'s
server-scoped set is down to five members, and `hasValidServerId`'s docblock (and every comment counting
"the six") was corrected to match. See [Interrupt envelope § Naming the conversation
(#1092)](interrupt-envelope.md#naming-the-conversation-1092) for the full frame, the connection method,
and the re-route from #1120's server-scoped dispatch onto #1118's conversation-to-server index.

**Tightening a payload from optional back to required needs a compile-time proof, not just a runtime
guard test (#946).** `isRendererCommand` rejecting a bare literal at runtime proves the guard; it does
not prove the *type* forbids one. `src/shared/**/*` is inside `tsconfig.node.json`'s include, so
`commands.test.ts` carries a `@ts-expect-error` assertion beside the runtime one — the
`src/shared/wire/types.test.ts` idiom — and `TS2578: Unused '@ts-expect-error' directive` makes the
proof self-invalidating if the field is ever relaxed back to optional. One trap in writing that
assertion: **a comment line whose first token is `@ts-expect-error` is a directive wherever it sits in
the block**, so a prose sentence *about* the directive placed on the line above it (e.g. explaining
why the assertion exists) is itself parsed as a second directive — and because it precedes the real
one, it is the one that suppresses nothing, surfacing as `TS2578` pointing at the prose line while the
working directive one line below reads clean. Never open an explanatory comment line with the literal
string `@ts-expect-error`.

The union gained a `setBadgeCount` member in [#1592](https://github.com/pyrycode/pyrycode-desktop/issues/1592):
a **payload-carrying** `BadgeCountPayload{count}` — the renderer-invokable trigger for the [app icon
attention badge](app-badge.md). Main-local like `notify`: never reaches `../wire/types`, because it
never reaches the daemon. `isBadgeCountPayload` requires `Number.isSafeInteger(count) && count >= 0`,
the first guard on this channel to bound a *number* rather than check a string's shape or a set's
membership — `Number.isInteger` alone would admit `1e300`, an integer but not a meaningful count.

## What it does

Gives the renderer **one typed function** (`window.pyry.sendCommand`) to ship a sealed command to the background process, and gives the background process **one typed seam** (`onCommand`) to receive those commands — after validating each at the untrusted→trusted boundary. Every command travels on a single IPC channel; the union carries only wire payload types, so no token, key, or raw byte can cross the bridge. `ipcRenderer` itself never crosses to the window.

## The one way it diverges from the event half

The daemon-event channel flows main → renderer, where the **producer is our own trusted main process**, so it adds **no runtime validation**. The command channel flows renderer → main, and **the renderer is UNTRUSTED relative to the main process** — every IPC message crossing `ipcMain` is untrusted-to-trusted, even though both sides are our code. So this channel ships one thing its mirror does not: **`isRendererCommand`, a runtime guard the receiver applies at the boundary.** The guard is what makes the `RendererCommand` type on the handler **honest** — without it, the handler would claim `RendererCommand` while the runtime value is attacker-controllable `unknown`. Everything downstream of the guard receives a shape-validated command. Do **not** copy the event half's "trusted producer, no validator" reasoning here — there is no transitive trust across this boundary.

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
  | { type: 'sendMessage'; payload: SendMessagePayload }
  | { type: 'requestDebugBundle' }
  | { type: 'requestConversations' }
  | { type: 'createConversation'; payload: CreateConversationPayload }
  // … plus every later member the growth log below documents

export function sendMessageCommand(fields: SendMessagePayload): RendererCommand {
  return { type: 'sendMessage', payload: fields }
}

export function isRendererCommand(value: unknown): value is RendererCommand {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false
  switch (value.type) {
    case 'sendMessage':
      return 'payload' in value && isSendMessagePayload(value.payload)
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
  ipcRenderer.send(COMMAND_CHANNEL, command)
},
```

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

## Configuration and usage

- **Import from `src/main` / `src/preload`** by **relative** path: `import { COMMAND_CHANNEL, type RendererCommand } from '../shared/ipc/commands'`. These sides have **no `@shared` alias** (it exists only in `tsconfig.web.json` / the renderer vite block); `@shared/ipc/commands` fails the node typecheck and the main/preload build there. This is the load-bearing gotcha — see [#18 codebase notes](../codebase/18.md) and project memory `shared-alias-not-available-in-main-preload`.
- **Import from `src/renderer` (#11)** by alias: `import { sendMessageCommand } from '@shared/ipc/commands'`, which resolves. Test files (vitest) may also use `@shared/...` regardless of side.
- **Producer (#11):** the composer mints a `message_id`, assembles a `SendMessagePayload`, calls `sendMessageCommand(fields)`, and passes the result to `window.pyry.sendCommand(command)`.
- **Consumer (#11/transport):** the composition root calls `onCommand(ipcMain, handler)` **once** for the app lifetime and invokes the returned unsubscribe on teardown; the handler builds a `send_message` `Envelope` and hands it to the Noise transport.

## Edge cases and limitations

- **Single registration is the composition root's contract.** `onCommand` returns an unsubscribe (exact-listener `removeListener`), but registering it **once** and tearing it down is the caller's job. Registering twice would double-dispatch every command. In #17 the seam is unwired, so returning the handle is hygiene + testability; flag when #11 wires the first handler.
- **The guard must grow with the union — a correctness trap.** When connect/disconnect commands land, extend **both** `RendererCommand` **and** `isRendererCommand` in lockstep. A union member the guard doesn't validate is silently dropped at the boundary. Consider a type-only exhaustiveness tripwire (`Record<RendererCommand['type'], true>`) when the second member arrives, mirroring the renderer bridge's `assertNever` discipline.
- **Shape validation ≠ authorization.** `isRendererCommand` validates structure, not permission. Content authorization (may this user post to this conversation?) is the **daemon's** job over the authenticated Noise session — the guard is not an authz control.
- **Send is stateless.** `sendCommand` issues one IPC message and returns; no queue, no backpressure, no delivery guarantee in #17 — the transport owns those later.
- **Handler robustness is the consumer's job.** The receiver is a thin forwarder; it does not wrap `handler` in try/catch. If #11's handler throws, that propagates out of the `ipcMain` listener (Electron logs it; it does not crash main).

## Security posture

**Verdict: PASS** (architect self-review in the spec).

- **The trust boundary is explicit and single:** `onCommand`, gated by `isRendererCommand`. This is the one place the command half must **not** copy the event half — the renderer is untrusted, so the boundary gets a real runtime guard. The guard is what makes the handler's `RendererCommand` type honest.
- **The guard-then-rebuild pattern (validate at `isRendererCommand`, rebuild a fresh literal main-side before it touches a builder) depends on a property that is invisible in the code, not in either half by itself: structured clone.** A getter on a payload field that returned a benign value to the guard and a hostile one to the sender would defeat both halves of the net — but by the time `isRendererCommand` runs, the value has already crossed `ipcRenderer.send`/`ipcMain.on`, and structured clone materialises every accessor into a plain data property before it does. No accessor can survive that crossing to observe *which* read it is answering. Noted at [#920](https://github.com/pyrycode/pyrycode-desktop/issues/920), the first command whose fresh-literal rebuild had to go two levels deep (an array of objects, not a flat row) to hold; worth restating wherever a payload-bearing command's security review leans on the pattern, since nothing in this file demonstrates the mechanism.
- **AC5 (no secret crosses the bridge) is enforced by the type, not by convention.** `RendererCommand` references only `SendMessagePayload` (`conversation_id`, `message_id`, `text`, and since [#1055](https://github.com/pyrycode/pyrycode-desktop/issues/1055) the optional `attachment_ids`) — no token/key/byte field. An `attachment_id` is explicitly not a capability on this wire (routing metadata, not a secret — see the growth-log entry below), so its addition does not weaken this claim. `HelloClientPayload` (`token`), `QrPayload` (`token`, `server_static_pubkey`), and `InnerFrameV2` (base64 `data`) are **not** members and must never become members — a developer cannot serialize a secret here because no member has a field to hold one.
- **Narrow renderer capability.** The added surface is `sendCommand(RendererCommand)` on one channel; `COMMAND_CHANNEL` is hardcoded, `ipcRenderer` is never exposed, and the renderer cannot reach Node, the socket, or keys (none live there). Worst case for a compromised renderer: it sends well-formed messages **as the already-authenticated user** — inherent to being the client, bounded by the daemon's session auth (Noise + token), not a new hole #17 opens.
- **No logging of payloads.** The receiver logs at most a fixed string on a dropped command; the preload sender logs nothing. `SendMessagePayload.text` crossing to main is the product (the message to send), not a leak — but must not be logged.
- **`sandbox: false` in `src/main/index.ts:17`** is a pre-existing scaffold value, out of scope for #17 (which does not touch that file). With `contextIsolation: true` + `nodeIntegration: false` and a shape-validated inbound channel, it is not exploitable as designed via this setting. Route the flip to a dedicated hardening ticket.

## Related

- [Daemon-event channel](daemon-event-channel.md) — the mirror-image event half (background→renderer) this reverses; read for the shared conventions and the trust-boundary contrast
- [Daemon-event bridge (renderer)](daemon-event-bridge.md) — the renderer-side pure-choke-point + exhaustiveness pattern `isRendererCommand` mirrors on the inbound boundary
- [Session store](session-store.md) — where the daemon's later reply lands, closing the loop this channel opens
- [Debug-bundle request (outbound)](debug-bundle-request.md) / [#168](../codebase/168.md) — the bare `requestDebugBundle` member this channel's union gained, and the sibling [daemon-event channel](daemon-event-channel.md) members that report its result
- [Screen snapshot fetch](screen-snapshot-fetch.md) / [#180](../codebase/180.md) — the payload-carrying `requestSnapshot` member + `isRequestSnapshotPayload` guard this channel's union gained, removed by [#620](../codebase/620.md); the `snapshotReceived` [daemon-event channel](daemon-event-channel.md) member that reported the reply was later removed too, by [#621](../codebase/621.md)
- [Conversation list fetch](conversation-list-fetch.md) / [#139](../codebase/139.md) — the bare `requestConversations` member this channel's union gained, and the `conversationsReceived` [daemon-event channel](daemon-event-channel.md) member that reports the reply
- [Conversation create](conversation-create.md) / [#241](../codebase/241.md) — the payload-carrying `createConversation` member + `isCreateConversationPayload` guard this channel's union gained, and the `conversationCreated` [daemon-event channel](daemon-event-channel.md) member that reports the reply
- [Session settings send](session-settings-send.md) / [#263](../codebase/263.md) — the payload-carrying `setSessionSettings` member + `isSetSessionSettingsPayload` guard (the first optional-absent, rather than nullable-present, presence check) this channel's union gained; ships dormant, consumer is #257
- [#261 codebase notes](../codebase/261.md) — widened `setSessionSettings` with the top-level-sibling `changeId: string` field + its untrusted-boundary guard clause, the renderer-minted correlation key the [daemon connection](daemon-connection.md) matches replies against
- [Interrupt envelope](interrupt-envelope.md) / [#306 codebase notes](../codebase/306.md) — the `interrupt` member this channel's union gained, bare from #306 through #1120 and tightened to a required `InterruptCommandPayload{conversation_id}` by [#1092](https://github.com/pyrycode/pyrycode-desktop/issues/1092); unlike its daemon-reply-bearing siblings, the daemon sends no correlated reply at all — the turn-stopped signal rides the pre-existing `turn_state`/`turn_end` stream instead
- [Push notifications](push-notifications.md) / [#391 codebase notes](../codebase/391.md) — the payload-carrying `notify` member + `isNotifyPayload` guard this channel's union gained; the first member whose payload type is main-local (not wire-derived) and whose guard checks closed-set membership rather than `typeof`
- [Question resolution envelope](question-resolution-envelope.md) / [#920](https://github.com/pyrycode/pyrycode-desktop/issues/920) — the `answerQuestions`/`refuseQuestions` members + their guards this channel's union gained, `Omit`-derived like `answerModal`'s but both token-excluded (unlike the modal pair); `isAnswerQuestionsPayload` is this file's first guard to recurse into a structured payload, and the first place the `for…of`-over-`every` hole distinction mattered. [Daemon connection](daemon-connection.md) is the consumer that mints `answer_token` for both.
- [Run configuration store](run-config-store.md) / [#491](https://github.com/pyrycode/pyrycode-desktop/issues/491), widened [#945](https://github.com/pyrycode/pyrycode-desktop/issues/945) — the `requestSessionSettings` member's sole consumer, and the conversation-keying correction that gave it this file's only optional payload.
- [App icon attention badge](app-badge.md) / [#1592](https://github.com/pyrycode/pyrycode-desktop/issues/1592) — the payload-carrying `setBadgeCount` member + `isBadgeCountPayload` guard this channel's union gained; main-local like `notify`, and the first guard here to bound a number rather than a string or a set.
- [Model-list wire types § Outbound ask](model-list-wire-types.md#outbound-ask-1165) / [#1165](https://github.com/pyrycode/pyrycode-desktop/issues/1165) — the payload-carrying `requestModelList` member + `isRequestModelListPayload` guard this channel's union gained, required from the start; ships with no renderer sender, consumer is #1166.
- [New session envelope](new-session-envelope.md) / [#1217](https://github.com/pyrycode/pyrycode-desktop/issues/1217) — the payload-carrying `newSession` member + `isNewSessionPayload` guard this channel's union gained, the only member whose payload type *tightens* its wire type (`Required<NewSessionPayload>`) and the only guard in this file that rejects an empty string; ships with no renderer sender, consumer is the sibling ticket.
- [Request history send](request-history-send.md) / [#1222](https://github.com/pyrycode/pyrycode-desktop/issues/1222) — the payload-carrying `requestHistory` member + `isRequestHistoryPayload` guard this channel's union gained, checking type only on all three fields (an empty `cursor` is the normal opening value of a walk, not a rejectable one); the first member carrying a value this app did not mint — the daemon-minted `cursor` — which stays opaque end to end; ships with no renderer sender, consumer is #1224.
- [System prompt send](system-prompt-send.md) / [#1230](https://github.com/pyrycode/pyrycode-desktop/issues/1230) — the payload-carrying `requestSystemPrompt` member + `isRequestSystemPromptPayload` guard this channel's union gained, `isRequestModelListPayload`'s clone checking type not emptiness; the only member whose verb has no error frame at all, so the id's refusal rides the routing lookup one layer up rather than this guard; ships with no renderer sender, consumer is #1231.
- [System prompt write](system-prompt-write.md) / [#1249](https://github.com/pyrycode/pyrycode-desktop/issues/1249) — the payload-carrying `setSystemPrompt` member + `isSetSystemPromptPayload` guard this channel's union gained; the guard checks **three** things where its siblings check one (`conversation_id` present, `system_prompt` present, `system_prompt` a string or exactly `null`) because the tri-state has four naive inhabitants and only three are meaningful; checks type and presence, deliberately never length — the 8192-byte bound must produce an outcome, and a guard rejection produces none; ships with no renderer sender, consumer is #1250.
- [ADR 0001 — Stack: transport in the background process](../decisions/0001-stack-electron-react-typescript.md) · [ADR 0004 — Renderer session store: reducer + sealed actions + wire types](../decisions/0004-renderer-session-store-reducer-wire-types.md)
- [#17 codebase notes](../codebase/17.md) · Spec: `docs/specs/architecture/17-typed-command-channel.md` · [#168 codebase notes](../codebase/168.md) · Spec: `docs/specs/architecture/168-debug-bundle-ipc-contract.md`
