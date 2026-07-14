# Conversation delete (transport)

The **transport data path** that lets the desktop client ask the pyry daemon to **permanently**
remove a conversation — outbound request, inbound decode of the correlated confirmation — so the
Channel Info sheet's Delete action (#377) can send a hard-delete request that an explicit re-list
(#376) will reflect as the row's absence.

Introduced in [#364](../codebase/364.md) (outbound), split from #155 (the Channel Info sheet split:
archive transport `#363` / delete transport `#364` / sheet shell `#365` / archive action `#366` /
delete action+confirm `#367` / rename action `#368`). #367 later split 3-way into
[#375](../codebase/375.md) (inbound decode, this doc, done) / #376 (list-reflect) / #377 (Delete
action + confirm UI). Outbound shipped dormant — fully wired and tested, no caller yet; inbound
decode also ships dormant — decoded and emitted, no renderer subscriber yet. Both halves are
field-for-field clones of [conversation archive](conversation-archive.md) / [conversation
unarchive](conversation-unarchive.md) (outbound) and `conversation_updated` decode (#273, inbound),
narrowed to their single required field — differing only in the envelope `type` string and, unlike
either sibling, in the reply contract.

## The wire contract

```ts
// request (client → daemon) — one REQUIRED string
export interface DeleteConversationPayload {
  conversation_id: string
}
```

The daemon added this **permanent hard-delete** verb in pyrycode/pyrycode#822 (PR #884). Unlike
archive/unarchive — which flip a durable soft-state flag on a row that survives — delete removes
the row outright. It is independent of the archive/unarchive pair, not a third state on the same
flag.

**Reply is a distinct, correlated record — not `conversation_updated`, and not a broadcast.**
Because the row no longer exists post-delete, there is no name/cwd/last_used left to project, so
the daemon replies with a **new** record type, `conversation_deleted { id }`, correlated to the
requester via `Envelope.in_reply_to`. Unlike promote/archive/unarchive, there is **no broadcast** —
so a delete does **not** get a free list-reflection from another client's re-list; the requester's
own row leaves the list only on an **explicit** re-list. This slice does not decode that reply or
correlate it. #367 (its intended caller) has since split 3-way: [#375](../codebase/375.md) decodes
the reply (below), [#376](../codebase/376.md) triggers the explicit re-list, and #377 builds the
Delete action + confirm UI.

## The inbound decode ([#375](../codebase/375.md))

`conversation_deleted` is now decoded, though still dormant (no renderer consumer yet). The inbound
mirror of the `conversation_updated` decode ([#273](../codebase/273.md)), scaled to one field:

```ts
// reply (daemon → client) — one REQUIRED string, note the field is `id`, not `conversation_id`
export interface ConversationDeletedPayload {
  id: string
}
```

- `parseConversationDeletedPayload` — fail-closed narrow (`isRecord` guard + one `requireString`),
  mirroring `parseConversationUpdatedPayload`; a missing/non-string `id` or non-object payload
  throws `WireDecodeError`, caught and dropped at the existing `daemonConnection.ts` decode
  boundary (no event, no throw past it).
- `InboundDaemonMessage` gained `{ kind: 'conversation-deleted'; conversationDeleted: ConversationDeletedPayload }`.
- The `DaemonEvent` union (`src/shared/ipc/events.ts`) gained `{ type: 'conversationDeleted'; id: string }`
  — a **flattened bare string**, not a `{ conversation: ... }` wrapper around the wire type (unlike
  `conversationUpdated`'s five-field-by-reference reuse): a delete reply has exactly one field, so
  the single-field emit idiom (`turnState` carrying `state`, `sessionSettingsUpdated` naming
  `sessionId`) applies instead.
- `daemonConnection.ts`'s `case 'conversation-deleted':` emits `conversationDeleted{id}`
  **unconditionally** on decode, same as `conversation-updated`'s broadcast emit — even though this
  reply *is* correlated by `in_reply_to`, no correlation state is threaded, since the bare `id` is
  self-sufficient for #376's by-id removal.
- All three exhaustive renderer bridges (`daemonEventBridge.ts`/`modalBridge.ts`/`timelineBridge.ts`)
  gained a `conversationDeleted` no-op case, forced by their `assertNever` guards. #376 is the real
  consumer.

## The five pieces

| Piece | File | Role |
|---|---|---|
| `DeleteConversationPayload` | `src/shared/wire/types.ts` | ported wire type, field-for-field with the daemon |
| `deleteConversation` command / `isDeleteConversationPayload` guard | `src/shared/ipc/commands.ts` | untrusted renderer→main boundary |
| `buildDeleteConversation` | `src/main/transport/deleteConversationEnvelope.ts` | pure payload-carrying outbound envelope builder |
| `deleteConversation(payload)` | `src/main/daemonConnection.ts` | connection method — the `send` twin, fresh-literal net |
| `case 'deleteConversation'` | `src/main/index.ts` | command dispatch, direct to the connection method |

The inbound decode was a distinct record shape, not an extension of the existing
`conversation_updated` decoder (#273) — see [above](#the-inbound-decode-375) for the #375 pieces
that added it (`ConversationDeletedPayload`, `parseConversationDeletedPayload`, the
`conversation-deleted` `InboundDaemonMessage` variant, the `conversationDeleted` `DaemonEvent`).

## Guard shape

`isDeleteConversationPayload` is a single present-and-string check on `conversation_id` — an exact
clone of `isUnarchiveConversationPayload`. Structural minimum: an extra, unmodeled field on the
incoming IPC payload is accepted here, not rejected — the connection method's fresh-literal
construction (naming only `conversation_id`, never spreading the caller's payload) is the layer
that actually bounds what reaches the wire. Same two-layer defense #273/#236/#346/#363 established.
The guard is deliberately identical to archive/unarchive's despite delete being permanent — the
destructive-action gate is the user-facing confirmation (#367, the #226 second-confirm pattern),
not a second factor at the transport layer.

## Data flow (wiring pending #376/#377)

```
Delete action click (Channel Info sheet, #377, not yet built, gated by a confirm step)
  → { type: 'deleteConversation', payload: { conversation_id } }  (renderer, built inline, no constructor)
  → onCommand dispatch (src/main/index.ts)
  → connection.deleteConversation(payload)                        (fresh literal, fire-and-forget)
  → buildDeleteConversation → encodeEnvelope → driver.sendMessage  (main process only)
  ⋯ daemon permanently removes the row, replies conversation_deleted{id} correlated by in_reply_to
  → parseConversationDeletedPayload → conversation-deleted → conversationDeleted{id}  (#375, done)
  → (#376, not built here) explicit re-list → row disappears
```

## Related

- [Conversation archive (transport)](conversation-archive.md) / [Conversation unarchive
  (transport)](conversation-unarchive.md) / [#363](../codebase/363.md) /
  [#346](../codebase/346.md) — the siblings this slice clones field-for-field for everything except
  the reply contract; both get a free re-list reflection off a `conversation_updated` broadcast,
  which delete deliberately does not.
- [Conversation list store](conversation-list-store.md) / [#208](../codebase/208.md) — re-lists on
  a `conversation_updated` broadcast today; #376's explicit re-list after `conversation_deleted` is
  a distinct trigger, not this same broadcast path.
- [#155 codebase notes](../codebase/155.md) — parent split ticket, once it exists.
- [#364 codebase notes](../codebase/364.md) — outbound transport implementation summary.
- [#375 codebase notes](../codebase/375.md) — inbound decode implementation summary.
