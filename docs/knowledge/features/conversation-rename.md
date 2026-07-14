# Conversation rename (transport)

The **transport data path** that lets the desktop client ask the pyry daemon to change a
conversation's stored name, so a future Rename dialog can update `ConversationSummary.name` on a row
the [conversation list store](conversation-list-store.md) already holds.

Introduced in [#359](../codebase/359.md), split from #154 (transport `#359` / Rename dialog `#360`).
Shipped dormant — fully wired and tested, with no caller at the time. #360's Rename dialog is its
first caller. The closest structural twin of [conversation unarchive](conversation-unarchive.md)
(#346) for plumbing (builder / method / dispatch), and of
[conversation promote](conversation-promote.md) (#273) for the boundary guard (two required strings).

## The wire contract

```ts
// request (client → daemon) — two REQUIRED strings, no cwd
export interface RenameConversationPayload {
  conversation_id: string
  name: string
}
```

The daemon (pyrycode/pyrycode#820) models `RenameConversationPayload{ConversationID, Name string}` as
its own struct — an explicit **non-reuse** of `PromoteConversationPayload`, which carries a third
required `cwd` that a rename neither has nor means. Desktop mirrors that: two fields, no `cwd`. Do
**not** fold rename into the promote payload.

An empty/whitespace `name` is a **valid wire string**, not a client-side error: the daemon's own
trim-guard leaves a blank rename's stored name untouched, and the Rename dialog (#360) disables Save
on blank instead. No redundant client-side emptiness check exists (Evidence-Based Fix Selection — no
observed blank-submit path to defend).

**Reply is correlated, not broadcast** (unlike promote/unarchive's unsolicited broadcast) — but this
distinction is irrelevant to desktop, which decodes `conversation_updated` the same way regardless of
correlation and does not correlate it here. The existing decode path (#273) and the existing re-list
reaction to it (#275) pick up the new name on the conversation list store's next re-request; that
reflection is #360's AC, not this transport slice's.

## The five pieces

| Piece | File | Role |
|---|---|---|
| `RenameConversationPayload` | `src/shared/wire/types.ts` | ported wire type, field-for-field with the daemon |
| `renameConversation` command / `isRenameConversationPayload` guard | `src/shared/ipc/commands.ts` | untrusted renderer→main boundary |
| `buildRenameConversation` | `src/main/transport/renameConversationEnvelope.ts` | pure payload-carrying outbound envelope builder |
| `renameConversation(payload)` | `src/main/daemonConnection.ts` | connection method — the `send` twin, fresh-literal net |
| `case 'renameConversation'` | `src/main/index.ts` | command dispatch, direct to the connection method |

No inbound decode piece: the existing `conversation_updated` decoder (#273) needs no change — this
verb's confirmation reply carries the same shape that decoder already handles.

## Guard shape

`isRenameConversationPayload` clones `isPromoteConversationPayload`'s present-and-string checks on
both fields, **dropping the `cwd` check** (the deliberate non-reuse the daemon spec calls out). It
checks **type, not emptiness** — an empty-string `name` passes; only a missing key, `null`, or a
non-string value is rejected. Structural minimum: an extra, unmodeled field on the incoming IPC
payload is accepted here, not rejected — the connection method's fresh-literal construction (naming
only `conversation_id`/`name`, never spreading the caller's payload) is the layer that actually
bounds what reaches the wire. Same two-layer posture as #273/#346/#236.

## Data flow (wired by #360)

```
Rename dialog Save (not yet built)
  → { type: 'renameConversation', payload: { conversation_id, name } }  (renderer, built inline)
  → onCommand dispatch (src/main/index.ts)
  → connection.renameConversation(payload)                              (fresh literal, fire-and-forget)
  → buildRenameConversation → encodeEnvelope → driver.sendMessage        (main process only)
  ⋯ daemon updates the stored name, persists, replies conversation_updated (correlated, not that it matters here)
  → existing conversation_updated decode + conversationListStore re-list  (#273 / conversation-list-store.md)
  → renamed row's `name` updates on the next render
```

## Related

- [#360](../codebase/360.md) — the Rename dialog, this verb's intended first caller (once shipped).
- [Conversation promote (transport)](conversation-promote.md) / [#273](../codebase/273.md) — the
  guard twin this slice clones (three required strings minus `cwd` → two).
- [Conversation unarchive (transport)](conversation-unarchive.md) / [#346](../codebase/346.md) — the
  plumbing twin (builder / connection method / dispatch shape).
- [Conversation list fetch](conversation-list-fetch.md) / [#139](../codebase/139.md) — origin of
  `ConversationSummary.name`, the field a future rename consumer will read post-rename.
- [Conversation list store](conversation-list-store.md) / [#208](../codebase/208.md) — re-lists on
  any `conversation_updated`, so a rename's new name lands automatically once #360 wires the caller.
- [#359 codebase notes](../codebase/359.md) — implementation summary.
