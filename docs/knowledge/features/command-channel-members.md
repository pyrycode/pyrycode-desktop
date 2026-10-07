# Command channel — command members

Part of [Command channel](command-channel.md). This growth log records the payload
and validation choices behind the current union; see [internals](command-channel-internals.md)
for the bridge and current send-message attribution contract.

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

The `notify` member introduced in [#391](../codebase/391.md) drives
[push notifications](push-notifications.md) as a **main-local side effect**, with no transport call.
`NotifyPayload` is defined in `commands.ts`, not the wire types. It carries the closed
`kind: 'turn-complete' | 'prompt'`, optional conversation `name` for the title, optional opaque
`token` for click correlation, and optional body `preview` since
[#1737](https://github.com/pyrycode/pyrycode-desktop/issues/1737).

`isNotifyPayload`'s closed-set kind check guarantees exhaustive fixed **fallback** copy, replacing
the original restriction that no daemon text could reach the body. Defined `name` and `preview`
values must be strings; `preview.length` must also be at most 4000 UTF-16 units. Absent or
`undefined` text fields are accepted; wrong types or an oversized preview reject the whole command
before dispatch. Main independently cleans and caps the title/body, constructing plain-text options
without logging content. Renderer preview truncation keeps legitimate long replies below the IPC
bound, but never substitutes for main's cleaner. See
[ADR 0011](../decisions/0011-notification-preview-boundary.md) for this display-boundary decision.

The independent `token` field passes `isNotificationToken` (`^[A-Za-z0-9-]{1,64}$`) when defined.
Main echoes it unread on click; the renderer revalidates and resolves it to the notification's own
conversation. See [Push notifications § Resolving the click to its own
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
10](composer-send-internals.md#10-attachments-named-on-the-outbound-frame--takeattachments-1039-reworked-by-1055)
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
also rejects `''`, checking emptiness rather than type alone, because
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

