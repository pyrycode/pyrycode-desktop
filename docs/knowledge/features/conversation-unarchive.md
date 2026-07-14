# Conversation unarchive (transport)

The **transport data path** that lets the desktop client ask the pyry daemon to restore an
archived conversation back to active, so the [Archive screen](archive-screen.md)'s restore row can
flip `ConversationSummary.is_archived` back to `false` on a row the [conversation list
store](conversation-list-store.md) already holds.

Introduced in [#346](../codebase/346.md), split from [#153](../codebase/153.md) (the Archive
screen split: transport `#346` / scaffold+nav `#347` / counts+restore `#348`). Shipped dormant —
fully wired and tested, with no caller at the time. [#348](../codebase/348.md)'s Archive screen
restore row is now its first (and so far only) caller. The direct twin of
[conversation promote](conversation-promote.md) (#273), field-for-field, with the payload narrowed
to a single id.

## The wire contract

```ts
// request (client → daemon) — one REQUIRED string
export interface UnarchiveConversationPayload {
  conversation_id: string
}
```

The daemon (pyrycode/pyrycode#881) models `archive_conversation` and `unarchive_conversation` as
one shared Go struct, `ArchiveConversationPayload{ConversationID string}`, and one parameterized
handler. The symmetric `archive_conversation` verb is now also wired, as of
[#363](../codebase/363.md) — see [conversation archive](conversation-archive.md) — shipped dormant
until the Channel Info sheet's Archive action (#366) calls it.

**Reply is a broadcast, not correlated.** The daemon confirms by clearing the durable archived
flag, persisting eagerly, and replying with the same `conversation_updated` record `promote_conversation`
uses (see [conversation promote](conversation-promote.md) for its shape) — reflecting the restored,
active state. This slice does not correlate that reply; the [Archive screen](archive-screen.md)'s
restore row instead reads `ConversationSummary.is_archived` off the
[conversation list store](conversation-list-store.md)'s next re-list, exactly as
[#275](../codebase/275.md) did for promote's `is_promoted` flip.

## The five pieces

| Piece | File | Role |
|---|---|---|
| `UnarchiveConversationPayload` | `src/shared/wire/types.ts` | ported wire type, field-for-field with the daemon |
| `unarchiveConversation` command / `isUnarchiveConversationPayload` guard | `src/shared/ipc/commands.ts` | untrusted renderer→main boundary |
| `buildUnarchiveConversation` | `src/main/transport/unarchiveConversationEnvelope.ts` | pure payload-carrying outbound envelope builder |
| `unarchiveConversation(payload)` | `src/main/daemonConnection.ts` | connection method — the `send` twin, fresh-literal net |
| `case 'unarchiveConversation'` | `src/main/index.ts` | command dispatch, direct to the connection method |

No inbound decode piece: the existing `conversation_updated` decoder ([#273](../codebase/273.md))
already tolerates unknown server keys, so #881's new `is_archived` field on that reply needs no
decode edit — and this slice does not correlate the reply anyway.

## Guard shape

`isUnarchiveConversationPayload` is a single present-and-string check on `conversation_id` — cloned
from `isRequestSnapshotPayload` (the other single-id-field precedent), not from
`isPromoteConversationPayload`'s three-field trio. It is a **structural minimum**: an extra,
unmodeled field on the incoming IPC payload is accepted here, not rejected — the connection
method's fresh-literal construction (naming only `conversation_id`, never spreading the caller's
payload) is the layer that actually bounds what reaches the wire. This two-layer defense is the
same posture #273 and #236 established.

## Data flow (wired by #348)

```
restore row click (ArchiveScreen, archive-screen.md)
  → { type: 'unarchiveConversation', payload: { conversation_id } }  (renderer, built inline, no constructor)
  → onCommand dispatch (src/main/index.ts)
  → connection.unarchiveConversation(payload)                        (fresh literal, fire-and-forget)
  → buildUnarchiveConversation → encodeEnvelope → driver.sendMessage  (main process only)
  ⋯ daemon clears is_archived, persists, replies conversation_updated (BROADCAST)
  → existing conversation_updated decode + conversationListStore re-list  (#273 / conversation-list-store.md)
  → restored row's is_archived flips to false on the next render
```

## Related

- [Conversation archive (transport)](conversation-archive.md) / [#363](../codebase/363.md) — the
  now-wired mirror-image twin (sets the flag instead of clearing it), kept as a distinct payload
  type on purpose.
- [Archive screen](archive-screen.md) / [#348](../codebase/348.md) — the first (and so far only)
  caller: its restore row dispatches this command via `requestUnarchiveConversation`.
- [Conversation promote (transport)](conversation-promote.md) / [#273](../codebase/273.md) — the
  direct twin this slice clones field-for-field (three required strings + broadcast reply vs. one
  required string + broadcast reply).
- [Conversation list fetch](conversation-list-fetch.md) / [#139](../codebase/139.md) — origin of
  `ConversationSummary.is_archived`, the field the restore consumer reads instead of correlating
  this verb's reply.
- [Conversation list store](conversation-list-store.md) / [#208](../codebase/208.md) — re-lists on
  any `conversation_updated` broadcast, so a restore's flip lands automatically, the same
  mechanism [#275](../codebase/275.md) relied on for promote.
- [#346 codebase notes](../codebase/346.md) — implementation summary.
