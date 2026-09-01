# Conversation archive (transport)

The **transport data path** that lets the desktop client ask the pyry daemon to archive an active
conversation, so the Channel Info sheet's Archive action (#366) flips
`ConversationSummary.is_archived` from `false` to `true` on a row the [conversation list
store](conversation-list-store.md) already holds.

Introduced in [#363](../codebase/363.md), split from #155 (the Channel Info sheet split: archive
transport `#363` / delete transport `#364` / sheet shell `#365` / archive action `#366` / delete
action+confirm `#367` / rename action `#368`). Shipped dormant — fully wired and tested, with no
caller at the time; [#366](../codebase/366.md) is its live caller, see below. The mirror-image twin
of [conversation unarchive](conversation-unarchive.md) (#346), field-for-field, differing only in
which way the durable flag flips.

## The wire contract

```ts
// request (client → daemon) — one REQUIRED string
export interface ArchiveConversationPayload {
  conversation_id: string
}
```

The daemon (pyrycode/pyrycode#881) models `archive_conversation` and `unarchive_conversation` as
one shared Go struct, `ArchiveConversationPayload{ConversationID string}`, and one parameterized
handler. Desktop keeps the two verbs as **distinct** TypeScript types
(`ArchiveConversationPayload` / `UnarchiveConversationPayload`) even though they are structurally
identical — each verb owns its own five-site wire surface (command member, builder, connection
method, guard, dispatch arm) so the two can evolve independently if the daemon ever forks them.

**Reply is a broadcast, not correlated.** The daemon confirms by **setting** the durable archived
flag (the opposite of unarchive's clear), persisting eagerly, and replying with the same
`conversation_updated` record [conversation unarchive](conversation-unarchive.md) uses — reflecting
the now-archived state. This slice does not correlate that reply; the Channel Info sheet's Archive
action ([#366](../codebase/366.md)) reads `ConversationSummary.is_archived` off the [conversation
list store](conversation-list-store.md)'s next re-list, exactly as [#348](../codebase/348.md) did
for unarchive's flip back to active.

## The five pieces

| Piece | File | Role |
|---|---|---|
| `ArchiveConversationPayload` | `src/shared/wire/types.ts` | ported wire type, field-for-field with the daemon |
| `archiveConversation` command / `isArchiveConversationPayload` guard | `src/shared/ipc/commands.ts` | untrusted renderer→main boundary |
| `buildArchiveConversation` | `src/main/transport/archiveConversationEnvelope.ts` | pure payload-carrying outbound envelope builder |
| `archiveConversation(payload)` | `src/main/daemonConnection.ts` | connection method — the `send` twin, fresh-literal net |
| `case 'archiveConversation'` | `src/main/index.ts` | command dispatch, direct to the connection method |

No inbound decode piece: the existing `conversation_updated` decoder ([#273](../codebase/273.md))
already tolerates unknown server keys, so `is_archived` flipping to `true` on that reply needs no
decode edit — and this slice does not correlate the reply anyway.

## Guard shape

`isArchiveConversationPayload` is a single present-and-string check on `conversation_id` — cloned
from `isUnarchiveConversationPayload`, its direct twin. It is a **structural minimum**: an extra,
unmodeled field on the incoming IPC payload is accepted here, not rejected — the connection
method's fresh-literal construction (naming only `conversation_id`, never spreading the caller's
payload) is the layer that actually bounds what reaches the wire. This two-layer defense is the
same posture #273, #236, and #346 established.

## Data flow

```
Archive action click (Channel Info sheet, #366)
  → requestArchiveConversation(sendCommand, conversationId)         (renderer helper, ConversationScreen.tsx)
  → { type: 'archiveConversation', payload: { conversation_id } }  (inline literal, no constructor)
  → onCommand dispatch (src/main/index.ts)
  → connection.archiveConversation(payload)                        (fresh literal, fire-and-forget)
  → buildArchiveConversation → encodeEnvelope → driver.sendMessage  (main process only)
  ⋯ daemon sets is_archived, persists, replies conversation_updated (BROADCAST)
  → existing conversation_updated decode + conversationListStore re-list  (#273 / conversation-list-store.md)
  → archived row's is_archived flips to true on the next render
```

## Related

- [Conversation unarchive (transport)](conversation-unarchive.md) / [#346](../codebase/346.md) —
  the direct twin this slice clones field-for-field, and the sibling this verb's payload type is
  deliberately kept distinct from.
- [Archive screen](archive-screen.md) / [#348](../codebase/348.md) — the restore-side consumer
  pattern [#366](../codebase/366.md)'s Archive action follows (reads the flip off the next re-list
  rather than correlating the reply).
- [Conversation list fetch](conversation-list-fetch.md) / [#139](../codebase/139.md) — origin of
  `ConversationSummary.is_archived`, the field [#366](../codebase/366.md)'s action reads post-archive.
- [Conversation list store](conversation-list-store.md) / [#208](../codebase/208.md) — re-lists on
  any `conversation_updated` broadcast, so an archive's flip lands automatically, the same
  mechanism [#275](../codebase/275.md) relied on for promote and [#346](../codebase/346.md) for
  unarchive.
- [#363 codebase notes](../codebase/363.md) — implementation summary.
- [Conversation shell](conversation-shell-session-and-channel-info.md#channel-info-sheet-365) / [#366
  codebase notes](../codebase/366.md) — the Channel Info sheet's Archive action, this transport's
  live caller.
