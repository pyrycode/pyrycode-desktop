# Save-as-channel dialog

The unpromoted chat row's **Save as channel** action in [Channel List](channel-list.md)
collects a name and workspace folder choice, then [promotes the existing conversation](conversation-promote.md).
It preserves the conversation identifier and history, without creating a replacement conversation,
copying files or changing the existing daemon file/session semantics.

[Create channel](create-channel-dialog.md) offers the same location choices and shares the form
and workspace-parent helper. Its container creates a new channel and waits for confirmation;
Save as channel promotes an existing chat and closes on dispatch.

## What it does

Each opening prefills and focuses **Channel name:** with `titleFor(row.name)`, including
`Untitled` for a null or blank title. The shared `Modal` supplies the **Save as channel** header,
close control, divider and centered **Cancel**/**OK** buttons. Its preferred width is 640px,
constrained to the window; short windows scroll the panel. `ChannelForm` supplies the filled
input and labelled native radios in this order, with the first selected:

| Choice | Request destination |
| --- | --- |
| **Use shared scratch folder** | The chat's exact current `row.cwd`, passed directly to promotion. No folder is created. |
| **Create a dedicated channel folder** | Requests a folder beneath the chat workspace's `channels` subfolder, then passes the returned canonical path to promotion. |

“Shared scratch folder” means this chat's workspace itself, not a separate host scratch
folder. There is no fixed-path preview. OK requires a nonblank trimmed name. The `Untitled`
fallback is nonblank, so it is immediately valid.

Dedicated creation disables the input, radios and OK while pending. Folder rejection sends
no promotion, displays the client-owned “Could not create that folder” with `role="alert"`,
and restores editing and retry. Cancel and header close remain available while pending.
Dismissal, unmount and host disconnection abandon the local continuation; reconnect cannot
resume it. Already-sent remote operations are not undone.

Both choices send the original conversation identifier and trimmed display name, then close
on promotion dispatch. The dialog never optimistically edits the list. The existing
`conversation_updated` broadcast triggers the [conversation-list refresh](conversation-list-store.md),
which moves the same row from Chats to Channels without duplication.

## How it works

`ChannelList` retains the selected row, including `cwd` and `serverId`, and mounts the dialog
only for a connected owning host. The save affordance is a sibling of the row-open button,
not a nested interactive control; promoted rows have no save affordance. Each opening mounts
a fresh container, discarding previous name and location edits.

### Presentation and CSS

`SaveAsChannelDialogView` receives name, location, folder round-trip state and callbacks.
It renders `Modal` and the shared `ChannelForm`; neither presentation component accesses
transport. The form renders operator input through React's escaped input value, uses native
radio keyboard behavior and requests autofocus. Submission remains in the dialog container.

Both dialogs use `.create-channel-overlay` and `.create-channel__*` form styles in
`channels.css`, with shared modal chrome in `components/modal.css`. The overlay is fixed with
`z-index: 2` so it escapes the sidebar scroll column. Its scrim does not dismiss on click.
The old `.save-as-channel*` panel, action and preview styles are removed.

### Requests and replies

`requestPromoteConversation(sendCommand, conversationId, name, cwd)` sends
`promoteConversation` with `{ conversation_id: conversationId, name: name.trim(), cwd }`.
Promotion routes by conversation identifier. The scratch branch passes `row.cwd` verbatim,
including any trailing slash.

`requestCreateChannelFolder(sendCommand, channelName, cwd, serverId)` sends
`createWorkspaceFolder` with the retained row's host as a top-level IPC field. Its payload uses
`channelsParent(cwd)` from `ChannelForm.tsx`: remove trailing slashes and append `/channels`.
`slugForChannel` trims and lowercases the name, converts runs outside ASCII letters/digits
to hyphens, removes edge hyphens, and falls back to `channel` if empty. Both dialogs use these
same helpers; only the folder element is converted, not the display name.

For workspace `/home/alex/projects/demo` and name ` Release planning `, the folder request is
`{ parent: '/home/alex/projects/demo/channels', name: 'release-planning' }`. The existing
remote operation owns missing-parent creation, existing-directory reuse and canonicalization.
Only a successful reply from the retained host permits promotion, with display name
`Release planning` and the returned `path` verbatim, even when it differs from the requested
parent and slug. These are client request guarantees, not a file-copy or session-migration
operation; see the [real-daemon coverage boundary](real-daemon-credential-light-e2e.md).

The container sets a synchronous pending ref before dispatching `createRequested` to
`newFolderStore` and sending the folder command. This prevents duplicate submissions before
React paints disabled controls. Its listener filters original main-stamped events by the
retained `serverId`, pending state and abandonment before `subscribeNewFolder` discards host
identity. The bridge ignores unrelated event types. Wrong-host, unstamped and non-pending
replies cannot continue the draft, even when two hosts share identical paths.

A created-state effect rechecks pending, abandonment and current host connectivity, clears
pending, then promotes with `roundTrip.path` and calls `onPromoted`. Rejection clears pending
and permits an explicit retry. The active conversation's host is irrelevant to either branch.
Diagnostics carry only static lifecycle codes, never names, paths or daemon error text.

### Draft lifetime

Cancel/header close synchronously mark the draft abandoned, clear pending and reset the
folder round trip before calling `onDismiss`. Unmount removes the daemon-event and session
subscriptions and resets the singleton store so the next opening starts idle.

A synchronous session subscription abandons pending work on any non-connected transition.
This is necessary even with render-time gating: disconnect and reconnect before React paints
could otherwise hide host loss from the promotion effect. A late completion while offline
or after reconnect cannot promote the abandoned draft. A fresh explicit opening is required.

## Testing

`SaveAsChannelDialog.test.tsx` covers presentation, blank validation, busy controls, accessible
errors, escaping and helper payloads, including trailing workspace separators and slug conversion.
Static rendering can assert the autofocus attribute, but cannot prove actual focus, callbacks
or cancellation; those require the interaction tier.

`e2e/save-as-channel-promote.spec.ts` controls folder replies and captures requests to prove
both destinations, the original conversation ID, list refresh without duplicates, rejection/retry,
frozen controls, keyboard radios, ignored events and idle/pending dismissal followed by reopening.
Two hosts with identical workspace paths expose wrong-host routing. A renderer barrier follows
injected events before command-absence assertions.

A promoted row alone does not prove canonical-path use: a fake can accept the wrong path and
still update the row. Assert the promotion payload directly using a canonical reply that differs
from the requested path, alongside the original ID and trimmed name. The fake proves client
requests and continuation behavior, not daemon filesystem/session behavior.

`e2e/sidebar-offline-mutations.spec.ts` retains delayed completion and batched reconnect checks.
It observes renderer `sendCommand` calls through a conditional CDP function-call breakpoint,
before IPC/transport filtering. Counting only daemon receipts could pass with a broken UI gate.

The shared-form change also affects Create channel interaction coverage. Modal integration
checks should identify Save as channel by dialog role and accessible name; the paired-shell
hit test separately checks that `.create-channel-overlay` receives hits outside the sidebar.
The promotion spec captures normal, minimum-width, short-window and rejected states, and
checks that scrolling leaves Cancel reachable. `real-daemon-promote.spec.ts` covers the scratch
promotion branch separately; its DOM assertions do not prove the dedicated request payload.

## Edge cases and limitations

- Promotion closes on dispatch, without a new acknowledgement or correlated rejection protocol.
  If the daemon never confirms, the row remains in Chats. `conversation_updated` is an unsolicited
  broadcast; see [promotion correlation](conversation-promote.md#correlation-is-deliberately-absent-the-reply-is-a-broadcast-not-a-response).
- Folder replies expose no renderer request identifier. Matching is host plus pending operation;
  concurrent same-host operations remain indistinguishable. An older reply arriving during a
  newer draft's pending folder operation can satisfy that newer wait.
- Neither folder creation nor promotion has a timeout or automatic retry. A missing folder reply
  leaves a dismissible pending dialog. Retrying does not roll back earlier remote work.
- Escape and scrim clicks do not dismiss. The input has autofocus but no select-all or
  Enter-to-submit handler; keyboard activation of the focused OK button submits.
- Slug conversion is client-owned, not a shared mobile normalization contract. The daemon-returned
  path remains authoritative for the subsequent request.

## Related

- [Create channel](create-channel-dialog.md) — shared fields and folder construction, separate creation lifecycle.
- [Conversation promote](conversation-promote.md) — command and broadcast contract.
- [Conversation list store](conversation-list-store.md) — refresh after promotion.
- [New-folder store](new-folder-store.md) — folder round-trip state and bridge.
- [Channel row geometry](channel-list-desktop-row-geometry.md) — save affordance placement.
- [Modal and workspace choices spec](../../specs/architecture/1353-save-as-channel-modal.md).
