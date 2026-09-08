# Conversation workspace change (transport)

The **transport data path** that lets the desktop client ask the pyry daemon to move a
conversation's recorded workspace (`cwd`) to a different folder. Its caller is the [Workspace
Picker sheet](conversation-shell-workspace-and-run-config.md#workspace-picker-sheet-383) (#157's remaining split-child).

This document also covers the sibling outbound verb, [`renameWorkspace` (#1289)](#workspace-rename-label-change-1289)
below, which renames the WORKSPACE itself rather than moving a conversation between workspaces —
read that section's opening note before assuming the two are interchangeable; `src/main/index.ts`
routes them differently for exactly that reason.

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
    does not — activeConversationStore is written only on conversation_created and, since #448, on a
    channel-list row-open; a change_workspace's conversation_updated reply is still not one of its
    writers, so the chip's snapshotted cwd stays stale post-change — see #456's realizability note)
```

## Workspace rename (label change, #1289)

The outbound half of the desktop's side of the daemon's workspace-**rename** contract
(pyrycode/pyrycode#2209) — a sibling verb to the workspace-*move* above, easily confused with it
because both files sit beside each other and both payloads are two-required-ish strings, but they
change different things. `changeWorkspace` above moves ONE CONVERSATION's `cwd` to point at a
different folder; `renameWorkspace` changes the LABEL a whole workspace (every conversation sharing
a `cwd`) displays, and never touches any conversation's `cwd`. `src/main/index.ts` routes them on
opposite axes: `changeWorkspace` by conversation (`router.route(payload.conversation_id)`),
`renameWorkspace` by server (`servers.route(command.serverId)`), because a workspace label belongs
to the host, not to any one chat.

Introduced in [#1289](https://github.com/pyrycode/pyrycode-desktop/issues/1289), split from #1182.
Its live caller is the [Edit workspace dialog](edit-workspace-dialog.md)
([#1180](https://github.com/pyrycode/pyrycode-desktop/issues/1180)) — the workspace row's hover pen,
which shipped after this ticket and after the reply's inbound half. The inbound decode and the
sidebar's read of the label are the sibling
[#1288](https://github.com/pyrycode/pyrycode-desktop/issues/1288), shipped first, so the reply this
verb draws was already decoded, with its effect visible on the sidebar, before #1180 gave the app a
sender.

### The wire contract

```ts
// request (client → daemon) — a REQUIRED path beside a NULLABLE label, wire order path, label
export interface RenameWorkspacePayload {
  path: string
  label: string | null
}
```

`path` must equal a stored conversation's `cwd` byte for byte — an exact-equality lookup, never a
path join, so a `../`-laden value draws `workspace.not_found` rather than traversing anything.
`label` is `string | null` with **no `omitempty`**: a literal `null` is the daemon's *clear this
label* value, and an absent key is a malformed frame, so the sender must name the key
unconditionally. The daemon requires a non-`null` label to be non-empty after trimming and at most
128 characters, and rejects with the static errors `workspace.not_found` / `protocol.malformed` —
**all of that is policed server-side**; this client checks type only, never emptiness or length,
the `CreateWorkspaceFolderPayload` posture verbatim. Both fields are renderer-supplied strings
serialized to wire bytes only — never resolved into a local path, never a `Map` key or a filename,
never logged.

**Its own type, not an alias of `WorkspaceUpdatedPayload`** (#1288's inbound record), despite the
identical field set — the standing rule in this neighbourhood is that the verb owns its wire
surface, and an alias would couple an outbound request to an inbound record free to drift.

**Reply is `workspace_updated`, correlated to the requester** (`in_reply_to` echoing this request's
envelope id) rather than the unsolicited broadcast #1288 also produces from that same frame shape.
This client neither awaits nor correlates it — #1288's inbound path decodes it unconditionally and
the re-list it triggers is what actually lands the new label, the `renameConversation` posture
toward `conversation_updated`.

### The six pieces

One file over `conversation-workspace-change.md`'s five-piece table, deliberately — see
`docs/specs/architecture/1289-rename-workspace-command.md` § Size for why the split floor wins over
the ceiling here.

| Piece | File | Role |
|---|---|---|
| `RenameWorkspacePayload` + `rename_workspace` `EnvelopeType` member | `src/shared/wire/types.ts` | ported wire type, field-for-field with the daemon |
| `renameWorkspace` command / `isRenameWorkspacePayload` guard | `src/shared/ipc/commands.ts` | untrusted renderer→main boundary |
| `buildRenameWorkspace` | `src/main/transport/renameWorkspaceEnvelope.ts` | pure payload-carrying outbound envelope builder |
| `renameWorkspace(payload)` | `src/main/daemonConnection.ts` | connection method — the `send` twin, fresh-literal net |
| `renameWorkspace` delegate | `src/main/connectionRegistry.ts` | compile-forced `ActiveConnection`/`viewOf` entry |
| `case 'renameWorkspace'` | `src/main/index.ts` | command dispatch, routed BY SERVER — the one place this verb differs from every other piece's `changeWorkspace` twin |

### Guard shape — the file's first hybrid

`isRenameWorkspacePayload` is `isChangeWorkspacePayload`'s present-and-string arm on `path`, joined
with `isCreateConversationPayload`'s present-but-nullable arm on `label` — the first guard in
`commands.ts` assembled from two different neighbours rather than cloned from one, because no
rename-shaped guard there previously had a nullable field beside a required one. The `'label' in
value` presence check is load-bearing, not decoration: structured clone preserves an
explicitly-`undefined` own property across the IPC bridge, so a truthiness check would let
`label: undefined` ride through as if it were the daemon's `null` clear-signal. Structural minimum
throughout — a smuggled extra field is accepted by the guard and bounded instead by the connection
method's fresh literal, which names `label` **unconditionally** so a literal `null` survives onto
the wire rather than being dropped to an absent key.

`renameWorkspace` is one of six `RendererCommand` members carrying an optional top-level `serverId`
(#1120) — see [Server-scoped command routing](daemon-connection-server-scoped-routing.md) for why a
workspace-scoped command carries no id to route by.

### The e2e stateful fake

`e2e/fixtures/conversationStateFake.ts`'s `rename_workspace` case reuses the same closure-scoped
mutation the pre-existing `renameWorkspace(cwd, label)` mid-test seam calls (#1288) — one
implementation of what moves, so the correlated request-driven path and the unsolicited push cannot
drift apart — and adds the one thing the seam has no id to supply: `workspace_updated`'s
`in_reply_to`, echoing the request's envelope id. `workspaceUpdatedFrame` gained an optional third
`inReplyTo?` argument for this; `JSON.stringify` omits it when absent, so the pre-existing
unsolicited-broadcast drive (`workspace-updated-relist.spec.ts`) produces byte-identical frames and
needed no change. Driven end to end by
[`e2e/rename-workspace-command.spec.ts`](https://github.com/pyrycode/pyrycode-desktop/issues/1289),
which dispatches the command through the preload bridge (`window.pyry.sendCommand`) with no UI
affordance — the only gate covering `src/main/index.ts`'s `case 'renameWorkspace':` line, which has
no unit test of its own.

## Related

- [Edit workspace dialog](edit-workspace-dialog.md) (#1180) — this verb's live caller: the workspace
  row's hover pen, the dialog it opens, and the `label: null`-on-folder-segment send rule.
- [Conversation rename (transport)](conversation-rename.md) / [#359](../codebase/359.md) — the
  structural and guard twin this slice clones (two required strings, second field renamed).
- [Conversation promote (transport)](conversation-promote.md) / [#273](../codebase/273.md) — origin
  of the `cwd`-is-server-resolved-only security posture this slice reuses, and of the
  `conversation_updated` decode/re-list this slice rides for free.
- [Conversation list store](conversation-list-store.md) / [#208](../codebase/208.md) — re-lists on
  any `conversation_updated`, so a workspace change lands automatically now that a caller exists.
- [Workspace Picker sheet](conversation-shell-workspace-and-run-config.md#workspace-picker-sheet-383) / [#383
  codebase notes](../codebase/383.md) — the real caller, `requestChangeWorkspace`.
- [#157 codebase notes](../codebase/157.md) — parent split ticket (this transport slice / the
  Workspace Picker UI, #383).
- [#379 codebase notes](../codebase/379.md) — implementation summary.
- [Channel list § Workspace grouping](channel-list.md#workspace-grouping) — the sidebar's read of
  the workspace label this rename verb changes, and the daemon-side blank-label refusal this
  ticket's guard deliberately does not re-implement.
- [Server-scoped command routing](daemon-connection-server-scoped-routing.md) — `renameWorkspace`
  joined the optional-`serverId` set as its sixth member in #1289.
- Spec: `docs/specs/architecture/1289-rename-workspace-command.md` — the full design, size-overage
  rationale, and security review (PASS) for § Workspace rename above.
