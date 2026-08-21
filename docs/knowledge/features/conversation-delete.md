# Conversation delete (transport)

The **transport data path** that lets the desktop client ask the pyry daemon to **permanently**
remove a conversation — outbound request, inbound decode of the correlated confirmation — so the
Channel Info sheet's Delete action ([#377](../codebase/377.md)) can send a hard-delete request that
an explicit re-list ([#376](../codebase/376.md)) reflects as the row's absence.

Introduced in [#364](../codebase/364.md) (outbound), split from #155 (the Channel Info sheet split:
archive transport `#363` / delete transport `#364` / sheet shell `#365` / archive action `#366` /
delete action+confirm `#367` / rename action `#368`). #367 later split 3-way into
[#375](../codebase/375.md) (inbound decode, done) / [#376](../codebase/376.md) (list-reflect, done)
/ [#377](../codebase/377.md) (Delete action + confirm UI, done — the split's last piece). Outbound
shipped dormant — fully wired and tested, no caller until #377; inbound decode also shipped
dormant — decoded and emitted, no renderer subscriber until #376. Both halves are
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
the reply (below), [#376](../codebase/376.md) triggers the explicit re-list (below), and
[#377](../codebase/377.md) built the Delete action + confirm UI (below).

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

## The list-reflect ([#376](../codebase/376.md))

The `conversationDeleted{id}` event is now consumed. [Conversation list store](conversation-list-store.md)'s
`conversationListBridge.ts` renames and widens its refresh-trigger predicate,
`isConversationUpdated → shouldRefreshList`, so it matches both `conversationUpdated` (the
`conversation_updated` broadcast, #275) and `conversationDeleted`:

```ts
export function shouldRefreshList(event: DaemonEvent): boolean {
  return event.type === 'conversationUpdated' || event.type === 'conversationDeleted'
}
```

`subscribeConversations` fires `refreshOnChange()` (the existing bare `requestConversations`
re-request) on either arm — id-blind by design, same as the existing `conversationUpdated` trigger:
it reacts to the event's *occurrence*, never inspects `event.id`. No new store write path exists for
a delete; `setConversations` stays the sole writer, invoked only from the `conversationsReceived`
arm. The deleted row leaves the list because the daemon's fresh `list_conversations` reply omits it,
not because of any local remove-by-id mutation — the same whole-array-replacement mechanism that
already reflects promote/archive/unarchive/rename. See [#376 codebase notes](../codebase/376.md)
for the full implementation summary.

## The Delete action + confirm ([#377](../codebase/377.md))

The Channel Info sheet's `.channel-info__actions` slot gained its third and final row, **Delete** —
the live caller of the outbound half above. A new exported dispatch helper,
`requestDeleteConversation(sendCommand, conversationId)` (a verbatim clone of
`requestArchiveConversation`), fires the bare `{ type: 'deleteConversation', payload: {
conversation_id } }` command. Because delete is permanent, the pill does not dispatch directly:
activating it opens an inline two-step confirm (a client-owned invention, no Figma node — the #226
second-confirm posture) that swaps in for the pill inside the same actions column; confirming
dispatches and closes the sheet, cancelling returns to the pill with no wire effect. The confirm
state (`deleteConfirmOpen`) is screen-local `useState` owned by the `ChannelInfoSheet` container
(the `renameOpen` twin, ADR 0006); `window.pyry` is dereferenced only inside the confirm handler, so
the pure view stays server-renderable across both sub-states. See [#377 codebase
notes](../codebase/377.md) for the full implementation summary, including the `--danger` CSS
variant.

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

## Data flow

```
Delete pill click (Channel Info sheet, #377) → opens inline confirm, no wire effect yet
  → confirm click → requestDeleteConversation(sendCommand, conversationId)  (#377)
  → { type: 'deleteConversation', payload: { conversation_id } }  (renderer, built inline, no constructor)
  → onCommand dispatch (src/main/index.ts)
  → connection.deleteConversation(payload)                        (fresh literal, fire-and-forget)
  → buildDeleteConversation → encodeEnvelope → driver.sendMessage  (main process only)
  ⋯ daemon permanently removes the row, replies conversation_deleted{id} correlated by in_reply_to
  → parseConversationDeletedPayload → conversation-deleted → conversationDeleted{id}  (#375, done)
  → shouldRefreshList(event) → true → refreshOnChange() → {type:'requestConversations'}  (#376, done)
  → daemon's fresh conversationsReceived omits the deleted row → setConversations → row disappears
```

## The thread exit ([#652](../codebase/652.md))

`conversationDeleted{id}` now has a **second**, independent subscriber. [Paired
shell](paired-shell.md#the-delete-exit-exitactiveconversationts-conversationdeletedbridgets-652)'s
`conversationDeletedBridge` reacts to the same event the list-reflect above already consumes — that
listener sends a command (re-request the list), this one sends none, so a delete still fires exactly
one re-list. If the deleted `id` names the conversation currently open in the thread, `exitActiveConversation`
clears the timeline, the active-conversation record and the daemon session id, then returns to the
Channel List — closing the second-order defect where a deleted-but-still-active conversation kept
receiving the composer send and the queued-message drop after the row had already left the list. A
`conversationDeleted` naming any *other* conversation (or arriving with no active conversation at all)
is a no-op for this subscriber, so its delivery order relative to the list-reflect above is irrelevant.
See [#652 codebase notes](../codebase/652.md) for the full design.

## Related

- [Paired shell](paired-shell.md#the-delete-exit-exitactiveconversationts-conversationdeletedbridgets-652) /
  [#652](../codebase/652.md) — the thread-side consumer of `conversationDeleted`, closing the
  wiring gap where the thread stayed open (and stayed active) after its discussion was deleted.
- [Conversation archive (transport)](conversation-archive.md) / [Conversation unarchive
  (transport)](conversation-unarchive.md) / [#363](../codebase/363.md) /
  [#346](../codebase/346.md) — the siblings this slice clones field-for-field for everything except
  the reply contract; both get a free re-list reflection off a `conversation_updated` broadcast,
  which delete deliberately does not.
- [Conversation list store](conversation-list-store.md) / [#208](../codebase/208.md) — re-lists on
  a `conversation_updated` broadcast (#275) and, since #376, on a `conversationDeleted` reply too —
  one widened `shouldRefreshList` trigger, not two separate paths.
- [Conversation shell](conversation-shell.md#channel-info-sheet-365) / [#377 codebase
  notes](../codebase/377.md) — the Channel Info sheet's Delete action, this transport's live caller.
- [#155 codebase notes](../codebase/155.md) — parent split ticket, once it exists.
- [#364 codebase notes](../codebase/364.md) — outbound transport implementation summary.
- [#375 codebase notes](../codebase/375.md) — inbound decode implementation summary.
- [#376 codebase notes](../codebase/376.md) — list-reflect implementation summary.
- [#377 codebase notes](../codebase/377.md) — Delete action + confirm UI implementation summary.
