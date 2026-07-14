# Conversation workspace change (transport)

The **transport data path** that lets the desktop client ask the pyry daemon to move a
conversation's recorded workspace (`cwd`) to a different folder. Its caller is the [Workspace
Picker sheet](conversation-shell.md#workspace-picker-sheet-383) (#157's remaining split-child).

Introduced in [#379](../codebase/379.md), split from #157 (the transport half; the Workspace Picker
UI was the other half, then not yet built). Shipped dormant — fully wired and tested, with no caller
at ship time; [#383](../codebase/383.md) later wired the real caller. The closest structural and guard
twin is [conversation rename](conversation-rename.md) (#359) — both carry `conversation_id` plus
exactly one other required string, so this slice clones rename's builder / method / dispatch / guard
shape verbatim with the second field renamed `name` → `cwd`.

## The wire contract

```ts
// request (client → daemon) — two REQUIRED strings, wire order conversation_id, cwd
export interface ChangeWorkspacePayload {
  conversation_id: string
  cwd: string
}
```

The daemon (pyrycode/pyrycode#823) models `ChangeWorkspacePayload{ConversationID, Cwd string}` as
its own struct. The field tag is **`cwd`, not `workspace`** — the daemon spec flagged this as the
single reconcile point, and the merged daemon uses `cwd`, matching
`PromoteConversationPayload`/`ConversationCreatedPayload`. Desktop mirrors that exactly; do **not**
drift the field name (CLAUDE.md no-drift).

`cwd` is a renderer-supplied string that becomes a working directory **server-side** — the desktop
never resolves it into a local filesystem path (the `PromoteConversationPayload.cwd` posture,
reused verbatim). An empty `cwd` is a valid wire string, not a client-side error: the guard checks
type, not emptiness; the daemon polices the path server-side (#823).

**Reply is the existing `conversation_updated`, not a new type.** Because the daemon confirms with
the same record `rename`/`promote`/`archive`/`unarchive` already produce, this ticket adds **no new
inbound decode, no correlation, and no store change** — the conversation list reflects the new
workspace for free on the existing decode path (#273) and existing re-list reaction (#275), exactly
as rename's new name does.

## The five pieces

| Piece | File | Role |
|---|---|---|
| `ChangeWorkspacePayload` | `src/shared/wire/types.ts` | ported wire type, field-for-field with the daemon |
| `changeWorkspace` command / `isChangeWorkspacePayload` guard | `src/shared/ipc/commands.ts` | untrusted renderer→main boundary |
| `buildChangeWorkspace` | `src/main/transport/changeWorkspaceEnvelope.ts` | pure payload-carrying outbound envelope builder |
| `changeWorkspace(payload)` | `src/main/daemonConnection.ts` | connection method — the `send` twin, fresh-literal net |
| `case 'changeWorkspace'` | `src/main/index.ts` | command dispatch, direct to the connection method |

No inbound decode piece: the existing `conversation_updated` decoder (#273) needs no change — this
verb's confirmation reply carries the same shape that decoder already handles.

## Guard shape

`isChangeWorkspacePayload` clones `isRenameConversationPayload`'s present-and-string checks on both
fields, with the second field's key `name` → `cwd`. It checks **type, not emptiness** — a missing
key, `null`, or a non-string value on either field is rejected; an empty-string `cwd` passes.
Structural minimum: an extra, unmodeled field on the incoming IPC payload is accepted here, not
rejected — the connection method's fresh-literal construction (naming only
`conversation_id`/`cwd`, never spreading the caller's payload) is the layer that actually bounds
what reaches the wire. Same two-layer posture as #236/#273/#346/#359.

## Data flow

```
Workspace Picker sheet — choosing a recent-workspace row (#383)
  → requestChangeWorkspace(sendCommand, conversationId, path)
  → { type: 'changeWorkspace', payload: { conversation_id: conversationId, cwd: path } }
  → onCommand dispatch (src/main/index.ts)
  → connection.changeWorkspace(payload)                             (fresh literal, fire-and-forget)
  → buildChangeWorkspace → encodeEnvelope → driver.sendMessage       (main process only)
  ⋯ daemon updates the recorded workspace, replies conversation_updated
  → existing conversation_updated decode + conversationListStore re-list  (#273 / conversation-list-store.md)
  → the conversation's cwd updates on the next render (the list's; the picker's own "default" mark
    does not — activeConversationStore is written only on conversation_created, a pre-existing #278
    limitation the picker inherits, not fixed by this slice)
```

## Related

- [Conversation rename (transport)](conversation-rename.md) / [#359](../codebase/359.md) — the
  structural and guard twin this slice clones (two required strings, second field renamed).
- [Conversation promote (transport)](conversation-promote.md) / [#273](../codebase/273.md) — origin
  of the `cwd`-is-server-resolved-only security posture this slice reuses, and of the
  `conversation_updated` decode/re-list this slice rides for free.
- [Conversation list store](conversation-list-store.md) / [#208](../codebase/208.md) — re-lists on
  any `conversation_updated`, so a workspace change lands automatically now that a caller exists.
- [Workspace Picker sheet](conversation-shell.md#workspace-picker-sheet-383) / [#383
  codebase notes](../codebase/383.md) — the real caller, `requestChangeWorkspace`.
- [#157 codebase notes](../codebase/157.md) — parent split ticket (this transport slice / the
  Workspace Picker UI, #383).
- [#379 codebase notes](../codebase/379.md) — implementation summary.
