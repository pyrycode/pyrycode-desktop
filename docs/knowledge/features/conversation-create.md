# Conversation create (transport)

The **transport data path** that lets the desktop client ask the pyry daemon to create a fresh
conversation, so a future "new conversation" affordance (mirror mobile's create flow) can start a
discussion from scratch instead of always reusing the milestone conversation. A client sends
`create_conversation{is_promoted, name, cwd}` (all three server-defaultable — `null` means "let the
daemon choose"); the daemon answers `conversation_created` with the new conversation's summary.

Introduced in [#241](../codebase/241.md). Transport data path only — command → reply → one typed
event. The write-side twin of the [conversation list fetch](conversation-list-fetch.md) (#139). The
renderer side that fires the command and opens the new thread is
[the create → nav bridge](new-discussion-fab.md) (#242), which shipped after this ticket and consumes
both pieces unchanged; its first caller was the new-discussion FAB, later deleted (#1426).

## The wire contract

```ts
// request (client → daemon) — two kinds of key, see below
export interface CreateConversationPayload {
  is_promoted: boolean | null
  name: string | null
  cwd: string | null
  agent?: WireAgent   // 'claude' | 'codex' — pyrycode#2647
  model?: string       // pyrycode#2665
  effort?: string      // pyrycode#2665
}

// reply (daemon → client) — its OWN 5-field shape, NOT ConversationSummary
export interface ConversationCreatedPayload {
  id: string
  is_promoted: boolean
  cwd: string
  name: string | null       // null = unnamed scratch conversation, never absent
  last_used_at: string      // RFC3339
}
```

**Nullable-and-present, not optional.** The daemon's Go struct uses `*T` fields *without*
`omitempty`, so each of the original three request keys is always on the wire with an explicit
`null` — the deliberate *opposite* of the `Envelope.in_reply_to?` "never emit null" convention
elsewhere in the wire types. `is_promoted`, `name` and `cwd` are `T | null` (present, nullable),
not `T | undefined` (optional/omitted) — do not "fix" them to `?:`.

**`agent`, `model` and `effort` are the opposite: optional, not nullable.** [#1652](https://github.com/pyrycode/pyrycode-desktop/issues/1652)
added them because the daemon's own new pointers (`agent` from pyrycode#2647, `model`/`effort` from
pyrycode#2665) carry `omitempty` rather than the plain-pointer treatment the original three fields
get. An absent key keeps the daemon's own default; a request built before these fields existed, or
one that omits them, encodes byte-identically to today's three-field frame. `isCreateConversationPayload`
accepts no key or an explicit `undefined` value for each (structured clone keeps an `undefined`
property rather than dropping it) — but refuses `null`, since these keys are omitted rather than
nulled. Once present, `agent` must be exactly `'claude'` or `'codex'`, and `model`/`effort` must be
strings; the client checks only the type, and the daemon validates the values against the resolved
agent's model/effort vocabulary. `createConversation` in `daemonConnection.ts` and `requestNewChannel`'s
optional `choice` argument both copy each field in only when `!== undefined`, so a call that supplies
none of the three still sends exactly the original literal.

`ConversationCreatedPayload` is deliberately **not** a reuse of the existing 7-field
`ConversationSummary` ([conversation list fetch](conversation-list-fetch.md)): the daemon does not
send `is_archived` or `last_message_ts` on a create reply (spec #274 excludes the reuse). `name` is
`string | null` exactly like `ConversationSummary.name` — a literal `null` (never absent) is a
distinct "unnamed scratch conversation" signal.

## The ten pieces

| Piece | File | Role |
|---|---|---|
| `CreateConversationPayload` / `ConversationCreatedPayload` | `src/shared/wire/types.ts` | ported wire types, field-for-field with the daemon |
| `createConversation` command / `isCreateConversationPayload` guard | `src/shared/ipc/commands.ts` | untrusted renderer→main boundary |
| `buildCreateConversation` | `src/main/transport/createConversationEnvelope.ts` (new) | pure payload-carrying outbound envelope builder |
| `createConversation(payload)` | `src/main/daemonConnection.ts` | authenticated send, fresh-literal payload and local rejection feedback |
| `parseConversationCreatedPayload` + `conversation-created` kind | `src/main/transport/inboundMessage.ts` | fail-closed inbound decode |
| `conversationCreated` event | `src/shared/ipc/events.ts` | the `DaemonEvent` arm |
| `case 'createConversation':` | `src/main/index.ts` | `onCommand` dispatch |
| `case 'conversationCreated': return null` (×3) | `daemonEventBridge.ts` / `timelineBridge.ts` / `modalBridge.ts` | forced by `assertNever`; real consumer is #242 |

### 1. The outbound builder (`createConversationEnvelope.ts`, new)

A **payload-carrying** builder — cloned from `sendMessageEnvelope.ts`/`requestSnapshotEnvelope.ts`,
not the bare `buildListConversations`/`buildRequestDebugBundle` shape, because a create request
carries three real (if nullable) fields:

```ts
export interface CreateConversationInput { id: number; ts: string; payload: CreateConversationPayload }

export function buildCreateConversation(input: CreateConversationInput): Uint8Array
// Envelope { id, type: 'create_conversation', ts, payload: input.payload } → encodeEnvelope() bytes.
```

`JSON.stringify` preserves the payload's explicit `null` values (it drops only `undefined`), so an
all-null payload serializes to `{"is_promoted":null,"name":null,"cwd":null}` — exactly the daemon's
own "take the server default" encoding. No special null handling is needed in the builder; the fresh
literal that bounds the field set lives one layer up, in the connection method.

### 2. The connection method (`daemonConnection.ts`)

`createConversation` requires a driver, an authenticated session and a connection that has
not been stopped. A driver survives a retryable relay drop, so its existence alone is not
evidence that a send can reach the daemon. The `authenticated` flag is set only after a
validated hello acknowledgement and cleared on failure, relay loss, explicit redial and
stop. Relay-up alone never restores it. Retryable relay loss also emits `disconnected`
if the session was authenticated, keeping the renderer's per-host status accurate. Making
that emission unconditional would overwrite an existing authentication failure when its
socket subsequently drops.

The method rebuilds exactly `{is_promoted, name, cwd}` before `buildCreateConversation`,
shares `nextEnvelopeId` with other outbound methods, advances it after a successful build,
and registers the captured id in `pendingCreateConversations` only after `sendMessage`
returns. Unavailable connections and build/send exceptions emit content-free rejection
feedback without adding a pending entry; transport/build errors do not escape to callers.
See [Error handling](#error-handling).

The fresh literal bounds the outbound field set: `isCreateConversationPayload` is a
structural minimum that tolerates an extra key, so this reconstruction guarantees the
wire's three-field shape even when the boundary guard admits additional properties.

### 3. The inbound decode (`inboundMessage.ts`)

Extends `InboundDaemonMessage` with `{ kind: 'conversation-created'; conversationCreated:
ConversationCreatedPayload }` and adds:

```ts
function parseConversationCreatedPayload(payload: unknown): ConversationCreatedPayload {
  if (!isRecord(payload)) throw new WireDecodeError('malformed conversation_created payload')
  return {
    id: requireString(payload, 'id'),
    is_promoted: requireBoolean(payload, 'is_promoted'),
    cwd: requireString(payload, 'cwd'),
    name: requireStringOrNull(payload, 'name'),        // reuses #139's nullable-field checker
    last_used_at: requireString(payload, 'last_used_at')
  }
}
```

Fail-closed like `parseConversationSummary`: a missing/mistyped field throws (`WireDecodeError`,
category-only message — `name`/`cwd` could otherwise echo a title or workspace path); `name: null` is
a valid, distinct value. Narrowed **before** the content-free diagnostic log fires, so a malformed
reply leaves no record; the log reuses the existing `{event, code: 'conversation_created', bytes,
hash}` shape, deliberately no `count` (the #139 posture — a conversation is more identifying than a
message-batch size).

### 4. The emit site (`daemonConnection.ts`'s consumer arm)

```ts
case 'conversation-created':
  emitDaemonEvent(sink, { type: 'conversationCreated', conversation: inbound.conversationCreated })
  return
```

Verbatim passthrough — the `conversations` precedent, not `snapshotReceived`'s content-drop:
`parseConversationCreatedPayload` already returns only the five known fields, nothing left to strip.

### The command + event surface (`commands.ts` / `events.ts`)

```ts
// RendererCommand — payload-carrying
| { type: 'createConversation'; payload: CreateConversationPayload }

// isRendererCommand
case 'createConversation':
  return 'payload' in value && isCreateConversationPayload(value.payload)

// DaemonEvent
| { type: 'conversationCreated'; conversation: ConversationCreatedPayload }
```

`isCreateConversationPayload` checks each of the three fields is present (`'field' in value`) and
either the modeled type or `null` — the check is on **type**, so a literal `null` is accepted (the
daemon-default signal) while a missing/`undefined` key is rejected. This is the untrusted
renderer→main boundary edit that makes the ticket security-sensitive; no constructor is added
(`requestSnapshot`'s precedent — the render side, #242, builds the literal inline). `index.ts`'s
`onCommand` switch routes `createConversation` directly to `connection.createConversation(payload)` —
no orchestrator, since a create request has no consumer/reassembler.

By #241, three independent `assertNever`-guarded `DaemonEvent` switches exist
(`daemonEventBridge.ts`, [`timelineBridge.ts`](conversation-timeline-store.md),
[`modalBridge.ts`](modal-store-bridge.md)), so adding `conversationCreated` forced a one-line case in
all three — `daemonEventBridge`/`timelineBridge` return `null`, `modalBridge` folds it into its
existing null fall-through list. The real consumer at #241 time was
[the create → nav bridge](new-discussion-fab.md) (#242, then the new-discussion FAB's bridge), which
subscribes directly via `window.pyry.onDaemonEvent`, not through any of the three exhaustive bridges
above. `requestNewConversation` got a second caller in
[#1178](channel-list-workspace-row-nest.md):
each Chats-tree workspace row's hover-revealed plus. Since #1682 it opens a confirmation dialog
and sends `cwd: null` to use the clicked host's daemon default, rather than sending the group's
path. [#1179](create-channel-dialog.md)
then gave `requestNewConversation` a **sibling constructor**, `requestNewChannel`, rather than widening it
with a flag: it sends the command's *other* fixed payload shape — `is_promoted: true` plus a trimmed,
renderer-typed `name` — from the Channels-tree workspace plus's own dialog, so `requestNewConversation`
itself stays exactly the two-field literal it always was. Until #1179 a channel could only come into
being by [promoting an existing chat](save-as-channel-dialog.md); this is the first path that creates one
directly. See [Create-channel dialog](create-channel-dialog.md) for the dialog, the container state, and
the security review of the second untrusted value (`name`) this adds to the same outgoing command.
[#1308](channel-list-host-row.md#the-add-workspace-dialog-1308) then gave the command a **third sibling
constructor**, `requestNewWorkspaceChat`, one level up from #1178's: an operator-typed folder rather than
the daemon default, and a top-level `serverId` that is *required* rather than optional — the
host row's Add-workspace dialog always knows which machine's plus was clicked, and main refuses an unnamed
`createConversation` as ambiguous once more than one server is paired (#1120). It shares
`requestNewConversation`'s unpromoted, unnamed shape but requires a non-null path.
`requestNewConversation` and `requestNewChannel`
now also accept an optional explicit `serverId`; sidebar callers always supply their retained
host after a live connectivity check. Omitting it preserves main's single-host fallback.
`requestNewWorkspaceChat` still requires the host and trims operator-entered paths, while
the two workspace-row create dialogs pass null and retain only the clicked host. See
[sidebar availability](channel-list.md#the-container--pure-view-channellisttsx).
[#515](../codebase/515.md)
later added a second, independent consumer on the same event: the [conversation list
store](conversation-list-store.md)'s `subscribeConversations` now also re-requests the list on
`conversationCreated`, so the row lands in the store instead of only triggering navigation. The two
subscriptions are separate and side-effect-disjoint (nav vs. re-list), so they never cross-fire.

## Data flow

```
Chats-tree "Create chat" plus (#1178) → confirmation dialog → OK
  → requestNewConversation(window.pyry.sendCommand, null, serverId)
  → sendCommand({serverId, type:'createConversation', payload:{is_promoted:false,name:null,cwd:null}})
  → COMMAND_CHANNEL → onCommand (isCreateConversationPayload ✓) → connection.createConversation(payload)
  → authenticated connection check → buildCreateConversation({id,ts,payload:{fresh literal}}) → driver.sendMessage
    unavailable/build/send failure → host-stamped conversationCreateRejected

daemon → conversation_created frame → onDriverEvent 'message' → parseInboundMessage
  → {kind:'conversation-created', conversationCreated} → emitDaemonEvent
    {type:'conversationCreated', conversation}
  → DAEMON_EVENT_CHANNEL → all three assertNever bridges → null (no store consumer)
                          → useConversationCreatedNav's own subscription (#242) → dispatch({type:'open'})
```

The diagram traces `requestNewConversation`'s one production caller today; the Channels-tree plus and the
Add-workspace dialog feed the same `conversationCreated` event into the same subscription through their
own constructors (`requestNewChannel`, `requestNewWorkspaceChat` — see [the create → nav
bridge](new-discussion-fab.md)). The original caller, the new-discussion FAB, sent a client-settings
`defaultCwd` here instead of the daemon default; it was deleted in #1426.

## Error handling

| Failure | Layer | Behaviour |
|---|---|---|
| Renderer sends malformed command (missing/mistyped/missing-key field) | `isCreateConversationPayload` | rejected at boundary; never reaches `onCommand` |
| No driver, unauthenticated session or stopped connection when `createConversation` is called | `daemonConnection` | emits host-stamped `conversationCreateRejected` locally; sends nothing |
| Local build failure (including over-cap plaintext) or driver throw on send | connection method's try/catch | drops the caught object, emits host-stamped `conversationCreateRejected`, registers no pending request |
| Renderer smuggles an extra payload field | connection method's fresh literal | never crosses the wire — the guard tolerates it, the literal excludes it |
| `payload` not an object, or a required field missing/mistyped | `parseConversationCreatedPayload` | throws `WireDecodeError`, category-only message; frame dropped, no partial event |
| `name: null` on the wire | `requireStringOrNull` | decodes to `null` — a valid distinct value, never `''` |
| Oversized plaintext | existing `MAX_PLAINTEXT_BYTES` guard | throws before parsing begins |
| Daemon rejects the create | main-side correlation (below) | matches `in_reply_to`, emits host-stamped `conversationCreateRejected` without daemon rejection text |

Since #1367, local unavailable/build/send failures have the same bare rejection surface
as a correlated server refusal. `bindServerOrigin` supplies the paired host's identity;
the event contains no request id, path, daemon error code/message or caught-error text.
Diagnostics record only static lifecycle names and classifications (`unavailable`,
`build-or-send-failed`, `server-rejected`), never error objects or payload fields.

The [Add workspace dialog](add-workspace-dialog.md) consumes rejection only while pending
and only for its selected host. Local failure, server rejection or that host's connection
loss ends busy state immediately with client-owned feedback and preserves the folder.
With no result, its named 30-second deadline explains that completion could not be
confirmed and the chat may still appear. Retry is explicit and requires a connected host;
timeout, disconnect and reconnect never resend automatically.

Timeout and Cancel end only the local wait; neither cancels server-side creation. A
matching late confirmation still closes a submitted dialog while it remains open, and
the existing navigation and host-addressed list refresh show the chat. These behaviors
do not add per-request correlation or an exactly-once guarantee.

Focused `daemonConnection.test.ts` coverage drives actual over-cap builds and throwing
drivers, checks the host stamp and content-free diagnostics, then delivers a later error
for the attempted envelope id. That later error must not produce a second create
rejection: a failure test checking only the first event would miss a phantom pending entry.

Asserting that a byte-identical frame has exactly `{is_promoted, name, cwd}` and nothing
more ([#1652](https://github.com/pyrycode/pyrycode-desktop/issues/1652)'s coverage for the
optional `agent`/`model`/`effort` above) cannot use `Object.keys` on the decoded payload:
`decodeEnvelope(...).payload` is typed `unknown`, so that fails typecheck, and Vitest does
not typecheck — only `npm run build` catches it. Compare `JSON.stringify(payload)` against
an exact string instead; that also pins the key order.

## The success reply stays uncorrelated; the rejection, since #1307, does not

The **success** half remains uncorrelated: `in_reply_to` exists on the wire, but main does
not match `conversation_created` to a particular create request. It decodes and emits the
confirmation with the connection's main-owned host stamp. The dialog's exact-host check
narrows which confirmations it accepts without attributing one to a specific attempt.

The **rejection** half is different since
[#1307](https://github.com/pyrycode/pyrycode-desktop/issues/1307): `createConversation` now keeps its own
envelope id in a module-scope `pendingCreateConversations: Set<number>` (`daemonConnection.ts`), matches a
daemon `error` back to it by `Envelope.in_reply_to`, and on a match emits a bare `{ type:
'conversationCreateRejected' }` — never a field read off the untrusted error payload. It exists because a
create that cannot succeed was previously indistinguishable from one that simply produced no reply yet: the
FAB and the Channels-tree workspace plus (#1179) both had no failure path at all. The
[Add workspace dialog](add-workspace-dialog.md), introduced in #1308, is its first consumer.

The event has no request payload even though several callers can create concurrently.
The dialog gates rejection on `status === 'creating'` and checks the main-stamped host.
A different host cannot settle its wait, but a same-host concurrent create or earlier
retry remains indistinguishable from its current attempt. Per-request correlation is
unchanged by #1367: neither the numeric rejection correlation key nor a new create token
crosses IPC. See [Daemon connection correlation § Create-conversation rejected
correlation](daemon-connection-correlation-requests.md#create-conversation-rejected-correlation-1307)
for pending-entry lifetime and the accepted concurrent-caller limitation.

## Out of scope

- **Per-request success matching and renderer attempt attribution** — main-side rejection
  correlation remains in place; neither result identifies a renderer attempt.
- **Server-side cancellation and exactly-once creation** — timeout and Cancel end only
  the local wait; explicit retry sends another create request.
- **Resolving `cwd` into a real filesystem path** — untrusted daemon-supplied text, carried only as
  opaque display text in both directions; the daemon owns server-side `cwd` resolution (#666).

## Related

- [Daemon connection correlation § Create-conversation rejected correlation](daemon-connection-correlation-requests.md#create-conversation-rejected-correlation-1307)
  (#1307) — the `pendingCreateConversations` store, the bare `conversationCreateRejected` arm, and the
  request-attribution limit (a host stamp does not identify the calling surface or attempt).
- [Channel List — the host row § The Add workspace dialog](channel-list-host-row.md#the-add-workspace-dialog-1308)
  (#1308) — the third caller, `requestNewWorkspaceChat`, and the first consumer of the rejection arm above.
- [The create → nav bridge, formerly the new-discussion FAB](new-discussion-fab.md) / [#242 codebase
  notes](../codebase/242.md) — the renderer consumer: fires `createConversation`, navigates on
  `conversationCreated`. The FAB itself, its original caller, was deleted in #1426.
- [Channel List — the workspace row's own nest and its create-chat plus](channel-list-workspace-row-nest.md)
  (#1178) — the second caller, now confirming a daemon-default create on the clicked host.
- [Create-channel dialog](create-channel-dialog.md) (#1179) — `requestNewChannel`, the sibling
  constructor sending the command's other fixed payload shape (`is_promoted: true` plus a name); the
  first path to a channel that does not go through [Save-as-channel](save-as-channel-dialog.md)'s
  promotion.
- [Conversation list store](conversation-list-store.md) / [#515 codebase notes](../codebase/515.md) —
  the second `conversationCreated` consumer, added later: re-requests the list so the new row lands in
  the store on the same event the create → nav bridge navigates on.
- [Default-workspace store](default-workspace-store.md) / [#403 codebase notes](../codebase/403.md) —
  widened `requestNewConversation`'s `cwd` from a hardcoded `null` to the caller's saved default
  (`null` still means "take the daemon default"); no wire/payload change.
- [#241 codebase notes](../codebase/241.md) — implementation summary, patterns, lessons.
- [Conversation list fetch](conversation-list-fetch.md) / [#139 codebase notes](../codebase/139.md) —
  the read-side twin this transport slice mirrors (single-verb request/reply, both shared-file
  touches, the `requireStringOrNull` nullable-field checker reused here).
- [Daemon connection](daemon-connection.md) — hosts `createConversation(payload)`, its
  authenticated-session gate and fresh-literal security net.
- [Inbound message decode](inbound-message-decode.md) — hosts `parseConversationCreatedPayload` and
  the `conversation-created` `InboundDaemonMessage` kind.
- [Command channel](command-channel.md) — the `createConversation` `RendererCommand` member + guard.
- [Daemon-event channel](daemon-event-channel.md) — the `conversationCreated` `DaemonEvent` member.
- [Daemon-event bridge](daemon-event-bridge.md) / [Conversation timeline store](conversation-timeline-store.md)
  / [Modal-prompt model](modal-prompt-model.md) — the three exhaustive `DaemonEvent` consumers that
  tolerate `conversationCreated` by returning `null`.
- [#236 codebase notes](../codebase/236.md) — the fresh-literal-vs-spread security posture for a
  security-sensitive outbound command this ticket reaffirms.
- Daemon twin (QMD `pyrycode-docs`): `internal/protocol/conversations_write.go`
  `CreateConversationPayload`/`ConversationCreatedPayload` (spec #274); `docs/protocol-mobile.md §§
  create_conversation, conversation_created`.
