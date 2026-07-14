# Conversation delete (transport)

The **transport data path** that lets the desktop client ask the pyry daemon to **permanently**
remove a conversation, so the Channel Info sheet's Delete action (#367) can send a hard-delete
request that a re-list will later reflect as the row's absence.

Introduced in [#364](../codebase/364.md), split from #155 (the Channel Info sheet split: archive
transport `#363` / delete transport `#364` / sheet shell `#365` / archive action `#366` / delete
action+confirm `#367` / rename action `#368`). Shipped dormant — fully wired and tested, with no
caller at the time; #367 is its designated first caller. Field-for-field clone of [conversation
archive](conversation-archive.md) / [conversation unarchive](conversation-unarchive.md) across the
same five mirror sites, narrowed to the same single required `conversation_id` string — differing
only in the envelope `type` string and, unlike either sibling, in the reply contract.

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
correlate it; decoding `conversation_deleted` and triggering the explicit re-list are the #367
caller's job, not this ticket's.

## The five pieces

| Piece | File | Role |
|---|---|---|
| `DeleteConversationPayload` | `src/shared/wire/types.ts` | ported wire type, field-for-field with the daemon |
| `deleteConversation` command / `isDeleteConversationPayload` guard | `src/shared/ipc/commands.ts` | untrusted renderer→main boundary |
| `buildDeleteConversation` | `src/main/transport/deleteConversationEnvelope.ts` | pure payload-carrying outbound envelope builder |
| `deleteConversation(payload)` | `src/main/daemonConnection.ts` | connection method — the `send` twin, fresh-literal net |
| `case 'deleteConversation'` | `src/main/index.ts` | command dispatch, direct to the connection method |

No inbound decode piece here: `conversation_deleted` is a brand-new record type the desktop does
not yet decode at all — not an extension of the existing `conversation_updated` decoder (#273),
which tolerates unknown keys but decodes a different record shape entirely. Adding the
`conversation_deleted` decode arm is #367's.

## Guard shape

`isDeleteConversationPayload` is a single present-and-string check on `conversation_id` — an exact
clone of `isUnarchiveConversationPayload`. Structural minimum: an extra, unmodeled field on the
incoming IPC payload is accepted here, not rejected — the connection method's fresh-literal
construction (naming only `conversation_id`, never spreading the caller's payload) is the layer
that actually bounds what reaches the wire. Same two-layer defense #273/#236/#346/#363 established.
The guard is deliberately identical to archive/unarchive's despite delete being permanent — the
destructive-action gate is the user-facing confirmation (#367, the #226 second-confirm pattern),
not a second factor at the transport layer.

## Data flow (wiring pending #367)

```
Delete action click (Channel Info sheet, #367, not yet built, gated by a confirm step)
  → { type: 'deleteConversation', payload: { conversation_id } }  (renderer, built inline, no constructor)
  → onCommand dispatch (src/main/index.ts)
  → connection.deleteConversation(payload)                        (fresh literal, fire-and-forget)
  → buildDeleteConversation → encodeEnvelope → driver.sendMessage  (main process only)
  ⋯ daemon permanently removes the row, replies conversation_deleted{id} correlated by in_reply_to
  → (#367, not built here) decode conversation_deleted → explicit re-list → row disappears
```

## Related

- [Conversation archive (transport)](conversation-archive.md) / [Conversation unarchive
  (transport)](conversation-unarchive.md) / [#363](../codebase/363.md) /
  [#346](../codebase/346.md) — the siblings this slice clones field-for-field for everything except
  the reply contract; both get a free re-list reflection off a `conversation_updated` broadcast,
  which delete deliberately does not.
- [Conversation list store](conversation-list-store.md) / [#208](../codebase/208.md) — re-lists on
  a `conversation_updated` broadcast today; #367's explicit re-list after `conversation_deleted` is
  a distinct trigger, not this same broadcast path.
- [#155 codebase notes](../codebase/155.md) — parent split ticket, once it exists.
- [#364 codebase notes](../codebase/364.md) — implementation summary.
