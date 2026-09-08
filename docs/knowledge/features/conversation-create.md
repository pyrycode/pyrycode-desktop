# Conversation create (transport)

The **transport data path** that lets the desktop client ask the pyry daemon to create a fresh
conversation, so a future "new conversation" affordance (mirror mobile's create flow) can start a
discussion from scratch instead of always reusing the milestone conversation. A client sends
`create_conversation{is_promoted, name, cwd}` (all three server-defaultable — `null` means "let the
daemon choose"); the daemon answers `conversation_created` with the new conversation's summary.

Introduced in [#241](../codebase/241.md). Transport data path only — command → reply → one typed
event. The write-side twin of the [conversation list fetch](conversation-list-fetch.md) (#139). The
renderer FAB that fires the command and opens the new thread is
[the new-discussion FAB](new-discussion-fab.md) (#242), which shipped after this ticket and
consumes both pieces unchanged.

## The wire contract

```ts
// request (client → daemon) — all three fields server-defaultable, null = daemon default
export interface CreateConversationPayload {
  is_promoted: boolean | null
  name: string | null
  cwd: string | null
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
`omitempty`, so each request key is always on the wire with an explicit `null` — the deliberate
*opposite* of the `Envelope.in_reply_to?` "never emit null" convention elsewhere in the wire types.
`CreateConversationPayload`'s three fields are `T | null` (present, nullable), not `T | undefined`
(optional/omitted) — do not "fix" them to `?:`.

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
| `createConversation(payload)` | `src/main/daemonConnection.ts` | connection method — the `send` twin, fresh-literal net |
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

```ts
function createConversation(payload: CreateConversationPayload): void {
  if (driver === null) return              // inert no-op — a create request has no consumer to fail
  try {
    // FRESH literal naming exactly the three modeled fields — never a spread of `payload`.
    const bytes = buildCreateConversation({
      id: nextEnvelopeId,
      ts: now(),
      payload: { is_promoted: payload.is_promoted, name: payload.name, cwd: payload.cwd }
    })
    nextEnvelopeId += 1                     // shares the one counter with send/requestSnapshot/…
    driver.sendMessage(bytes)
  } catch {
    // Never throw out of the module (parity #490). Dropped, no log, no event.
  }
}
```

The **`send` twin, not `requestDebugBundle`'s consumer-failing twin** — same rationale as
`requestSnapshot`/`requestConversations`: a create request has no download-progress state to
coordinate, so a request sent while disconnected simply produces no reply. The **fresh literal is the
deterministic security net** (the #236 posture): `isCreateConversationPayload` is a structural
minimum that tolerates a smuggled extra key, so the outbound wire's three-field shape is guaranteed
here, not at the boundary guard.

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
[the new-discussion FAB's bridge](new-discussion-fab.md) (#242), which subscribes directly via
`window.pyry.onDaemonEvent`, not through any of the three exhaustive bridges above. `requestNewConversation`
got a second caller in [#1178](channel-list-desktop-row-geometry.md#the-workspace-rows-own-nest-and-its-create-chat-plus-1178):
each sidebar workspace row's hover-revealed plus, sending that group's own `cwd` rather than the client's
saved default — the first caller to pass this constructor a `cwd` that is daemon-asserted text rather than
a client-side setting, verbatim and unnormalised, relying on `isCreateConversationPayload` and the
fresh-literal rebuild in `daemonConnection.createConversation` at the boundary below. [#1179](create-channel-dialog.md)
then gave `requestNewConversation` a **sibling constructor**, `requestNewChannel`, rather than widening it
with a flag: it sends the command's *other* fixed payload shape — `is_promoted: true` plus a trimmed,
renderer-typed `name` — from the Channels-tree workspace plus's own dialog, so `requestNewConversation`
itself stays exactly the two-field literal it always was. Until #1179 a channel could only come into
being by [promoting an existing chat](save-as-channel-dialog.md); this is the first path that creates one
directly. See [Create-channel dialog](create-channel-dialog.md) for the dialog, the container state, and
the security review of the second untrusted value (`name`) this adds to the same outgoing command.
[#1308](channel-list-host-row.md#the-add-workspace-dialog-1308) then gave the command a **third sibling
constructor**, `requestNewWorkspaceChat`, one level up from #1178's: an operator-typed folder rather than
an existing group's own `cwd`, and a top-level `serverId` that is *required* rather than optional — the
host row's Add-workspace dialog always knows which machine's plus was clicked, and main refuses an unnamed
`createConversation` as ambiguous once more than one server is paired (#1120). Its payload is
`requestNewConversation`'s byte for byte; only the routing key differs, which is why it is a third sibling
rather than a widened parameter on either existing helper.
[#515](../codebase/515.md)
later added a second, independent consumer on the same event: the [conversation list
store](conversation-list-store.md)'s `subscribeConversations` now also re-requests the list on
`conversationCreated`, so the row lands in the store instead of only triggering navigation. The two
subscriptions are separate and side-effect-disjoint (nav vs. re-list), so they never cross-fire.

## Data flow

```
new-discussion FAB (#242) → requestNewConversation(window.pyry.sendCommand, defaultCwd)
  → sendCommand({type:'createConversation', payload:{is_promoted,name,cwd:defaultCwd}})
  → COMMAND_CHANNEL → onCommand (isCreateConversationPayload ✓) → connection.createConversation(payload)
  → buildCreateConversation({id,ts,payload:{fresh literal}}) → driver.sendMessage  [inert no-op if not connected]

daemon → conversation_created frame → onDriverEvent 'message' → parseInboundMessage
  → {kind:'conversation-created', conversationCreated} → emitDaemonEvent
    {type:'conversationCreated', conversation}
  → DAEMON_EVENT_CHANNEL → all three assertNever bridges → null (no store consumer)
                          → useConversationCreatedNav's own subscription (#242) → dispatch({type:'open'})
```

## Error handling

| Failure | Layer | Behaviour |
|---|---|---|
| Renderer sends malformed command (missing/mistyped/missing-key field) | `isCreateConversationPayload` | rejected at boundary; never reaches `onCommand` |
| Not connected when `createConversation` called | `daemonConnection` | inert no-op; no throw, no event |
| Over-cap / driver throw on send | try/catch | caught, dropped |
| Renderer smuggles an extra payload field | connection method's fresh literal | never crosses the wire — the guard tolerates it, the literal excludes it |
| `payload` not an object, or a required field missing/mistyped | `parseConversationCreatedPayload` | throws `WireDecodeError`, category-only message; frame dropped, no partial event |
| `name: null` on the wire | `requireStringOrNull` | decodes to `null` — a valid distinct value, never `''` |
| Oversized plaintext | existing `MAX_PLAINTEXT_BYTES` guard | throws before parsing begins |
| Daemon rejects the create (a `cwd` that does not exist, or escapes the daemon's home) | main-side correlation (below) | bare `conversationCreateRejected`; consumed by [#1308](channel-list-host-row.md#the-add-workspace-dialog-1308)'s Add-workspace dialog while its own create is outstanding, ignored otherwise |

## The success reply stays uncorrelated; the rejection, since #1307, does not

Same posture as [conversation list fetch](conversation-list-fetch.md#correlation-is-deliberately-absent)
for the **success** half only: `in_reply_to` exists on the wire but matching a `conversation_created` reply
to a specific request is still out of scope — the app hosts one active conversation, so any
`conversation_created` is decoded and emitted unconditionally, safe because only the authenticated daemon
(inside the Noise session) can produce one.

The **rejection** half is different since
[#1307](https://github.com/pyrycode/pyrycode-desktop/issues/1307): `createConversation` now keeps its own
envelope id in a module-scope `pendingCreateConversations: Set<number>` (`daemonConnection.ts`), matches a
daemon `error` back to it by `Envelope.in_reply_to`, and on a match emits a bare `{ type:
'conversationCreateRejected' }` — never a field read off the untrusted error payload. It exists because a
create that cannot succeed was previously indistinguishable from one that simply produced no reply yet: the
FAB and the Channels-tree workspace plus (#1179) both had no failure path at all. Shipped with no consumer;
[#1308](channel-list-host-row.md#the-add-workspace-dialog-1308)'s Add-workspace dialog is the first — and,
as of #1308, the only — caller that can actually receive a daemon rejection (a folder path that does not
exist or escapes `$HOME`).

Bare by construction, not because only one caller exists — `create_conversation` has three live callers
now that #1308 shipped, so the arm **cannot** say whose rejection it is reporting. #1308's dialog gates on
its own in-flight state (`status === 'creating'`) and accepts that a concurrent caller's rejection is
indistinguishable from its own while its create is outstanding — the residue fails toward a false failure
report on a create that will still land, never a false success. See [Daemon connection correlation §
Create-conversation rejected correlation](daemon-connection-correlation.md#create-conversation-rejected-correlation-1307)
for the full store design, the accepted unbounded-growth argument, and the corrected bareness rationale (a
code-review finding during #1307 caught the shipped code comment overstating the single-caller case).

## Out of scope

- **Reply correlation** (`in_reply_to`) — see § Correlation above; an additive read if a future
  multi-request world needs it, not a reshape of this slice.
- **Resolving `cwd` into a real filesystem path** — untrusted daemon-supplied text, carried only as
  opaque display text in both directions; the daemon owns server-side `cwd` resolution (#666).

## Related

- [Daemon connection correlation § Create-conversation rejected correlation](daemon-connection-correlation.md#create-conversation-rejected-correlation-1307)
  (#1307) — the `pendingCreateConversations` store, the bare `conversationCreateRejected` arm, and the
  corrected bareness rationale (a rejection cannot be attributed to a caller — three live today).
- [Channel List — the host row § The Add workspace dialog](channel-list-host-row.md#the-add-workspace-dialog-1308)
  (#1308) — the third caller, `requestNewWorkspaceChat`, and the first consumer of the rejection arm above.
- [New-discussion FAB](new-discussion-fab.md) / [#242 codebase notes](../codebase/242.md) — the
  renderer consumer: fires `createConversation`, navigates on `conversationCreated`.
- [Channel List — the row's desktop geometry § The workspace row's own nest and its create-chat plus](channel-list-desktop-row-geometry.md#the-workspace-rows-own-nest-and-its-create-chat-plus-1178)
  (#1178) — the second caller, sending a workspace group's own `cwd` instead of the saved default.
- [Create-channel dialog](create-channel-dialog.md) (#1179) — `requestNewChannel`, the sibling
  constructor sending the command's other fixed payload shape (`is_promoted: true` plus a name); the
  first path to a channel that does not go through [Save-as-channel](save-as-channel-dialog.md)'s
  promotion.
- [Conversation list store](conversation-list-store.md) / [#515 codebase notes](../codebase/515.md) —
  the second `conversationCreated` consumer, added later: re-requests the list so the new row lands in
  the store on the same event the FAB navigates on.
- [Default-workspace store](default-workspace-store.md) / [#403 codebase notes](../codebase/403.md) —
  widened `requestNewConversation`'s `cwd` from a hardcoded `null` to the caller's saved default
  (`null` still means "take the daemon default"); no wire/payload change.
- [#241 codebase notes](../codebase/241.md) — implementation summary, patterns, lessons.
- [Conversation list fetch](conversation-list-fetch.md) / [#139 codebase notes](../codebase/139.md) —
  the read-side twin this transport slice mirrors (single-verb request/reply, both shared-file
  touches, the `requireStringOrNull` nullable-field checker reused here).
- [Daemon connection](daemon-connection.md) — hosts `createConversation(payload)`, the `send` twin
  with the fresh-literal security net.
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
