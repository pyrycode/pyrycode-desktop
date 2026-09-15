# Save-as-channel dialog

The unpromoted chat row's **Save as channel** action in [Channel List](channel-list.md)
collects a name, then [promotes the existing conversation](conversation-promote.md) in its own
workspace — the chat's exact current `row.cwd`. It preserves the conversation identifier and
history, without creating a replacement conversation, copying files or changing the existing
daemon file/session semantics.

[Create channel](create-channel-dialog.md) shares the same name-only form. Its container
creates a new channel and waits for confirmation; Save as channel promotes an existing chat and
closes on dispatch.

Until 2026-09-14 the dialog also offered a dedicated `<workspace>/channels/<slug>/` subfolder
destination, created through `createWorkspaceFolder` before promoting into the returned path. It
was withdrawn (#1436) for the same reason as [Create channel](create-channel-dialog.md): neither
this client nor the daemon has a workspace entity beyond a conversation's `cwd` as an exact string,
so a channel in that subfolder rendered as a brand-new workspace group rather than living under the
chat's own workspace. Both dialogs now always promote or create into the workspace folder itself,
which was already the default branch. Existing channels already sitting in a dedicated folder are
not moved.

## What it does

Each opening prefills and focuses **Channel name:** with `titleFor(row.name)`, including
`Untitled` for a null or blank title. The shared `Modal` supplies the **Save as channel** header,
close control, divider and centered **Cancel**/**OK** buttons. Its preferred width is 640px,
constrained to the window; short windows scroll the panel. `ChannelForm` supplies the filled
input, and nothing else — no location choice remains.

OK requires a nonblank trimmed name. The `Untitled` fallback is nonblank, so it is immediately
valid. Cancel and header close remain available. Dismissal, unmount and host disconnection abandon
the local continuation; reconnect cannot resume it. Already-sent remote operations are not undone.

OK sends the original conversation identifier and trimmed display name to promotion with the row's
`cwd` verbatim, then closes on dispatch — there is no round trip to wait on and no busy state.
The dialog never optimistically edits the list. The existing `conversation_updated` broadcast
triggers the [conversation-list refresh](conversation-list-store.md), which moves the same row
from Chats to Channels without duplication.

## How it works

`ChannelList` retains the selected row, including `cwd` and `serverId`, and mounts the dialog
only for a connected owning host. The save affordance is a sibling of the row-open button,
not a nested interactive control; promoted rows have no save affordance. Each opening mounts
a fresh container, discarding previous name edits.

### Presentation and CSS

`SaveAsChannelDialogView` receives name and callbacks only — no location, no folder round-trip
state, no busy flag; it passes `busy={false}` and `error={null}` into `ChannelForm`. It renders
`Modal` and the shared `ChannelForm`; neither presentation component accesses transport. The form
renders operator input through React's escaped input value and requests autofocus. Submission
remains in the dialog container.

Both dialogs use `.create-channel-overlay` and `.create-channel__*` form styles in
`channels.css`, with shared modal chrome in `components/modal.css`. The overlay is fixed with
`z-index: 2` so it escapes the sidebar scroll column. Its scrim does not dismiss on click.
The `.create-channel__option` radio rules the withdrawn location choice used are gone, but the
`:focus-visible`/`:disabled` rules for `.create-channel__input` were shared selector lists with
those radio rules, not a clean block — see [Create channel](create-channel-dialog.md) for the
trap that trimming rather than deleting them avoided.

### Requests and replies

`requestPromoteConversation(sendCommand, conversationId, name, cwd)` sends
`promoteConversation` with `{ conversation_id: conversationId, name: name.trim(), cwd }`.
Promotion routes by conversation identifier. It passes `row.cwd` verbatim, including any
trailing slash — the only surviving branch, now the whole flow (#1436 withdrew the folder branch
that once passed a daemon-returned canonical path instead). Diagnostics carry only static
lifecycle codes (`sidebar-promotion`: `sent`, `abandoned`), never names, paths or daemon error
text.

There is no busy state and no wait: `onSave` dispatches the command and calls `onPromoted`
synchronously, closing the dialog. There is no correlated rejection to listen for, and no
`newFolderStore` read, subscription or reset — that store's remaining owner is the workspace
picker's `CreateFolderDialog`; see [the store's own doc](new-folder-store.md).

### Draft lifetime

Cancel/header close synchronously mark the draft abandoned before calling `onDismiss`. Unmount
removes the session subscription.

A synchronous session subscription abandons the draft on any non-connected transition, and
`onSave` re-checks connectivity through `isHostConnected` before dispatching. This is necessary
even with render-time gating: a disconnect and reconnect batched before React paints could
otherwise let a keyboard-focused Save fire after the host is gone. There is no async
continuation left to abandon past that point — promotion is fire-and-forget, so the ref's only
job is guarding the synchronous window between disconnect and an already-focused Save.

## Testing

`SaveAsChannelDialog.test.tsx` covers presentation, blank validation, accessible errors, escaping
and the `requestPromoteConversation` payload, including a trailing-workspace-separator case, plus
an assertion that the rendered form carries no `type="radio"`. Static rendering can assert the
autofocus attribute, but cannot prove actual focus, callbacks or cancellation; those require the
interaction tier.

`e2e/save-as-channel-promote.spec.ts` captures requests to prove the promotion payload (original
conversation ID, verbatim `cwd`, trimmed name), list refresh without duplicates, and idle
dismissal followed by reopening with the `Untitled` default restored. A canonical reply different
from the requested path is no longer relevant to this flow — there is no folder round trip left to
prove — but the spec still injects a `workspaceFolderCreated` after dismissal to confirm it stays
inert: since #1436 this dialog neither requests a folder nor waits on one. The main promotion test
also promotes a second host's row in its tail, so cross-host routing-by-conversation-id — inherited
from the deleted dedicated-folder test — still has coverage; the first row's save affordance is
gone once promoted, which is what shifts the second row to index 0 for that tail cheaply.

`e2e/sidebar-offline-mutations.spec.ts` keeps its keyboard-after-disconnect coverage: a pre-opened
save dialog cannot promote by keyboard once the host has disconnected. The batched
disconnect/reconnect test that previously covered a pending dedicated promotion was deleted with
that branch — nothing async is left to race. It observes renderer `sendCommand` calls through a
conditional CDP function-call breakpoint, before IPC/transport filtering; counting only daemon
receipts could pass with a broken UI gate.

The shared-form change also affects Create channel interaction coverage. Modal integration checks
should identify Save as channel by dialog role and accessible name; the paired-shell hit test
separately checks that `.create-channel-overlay` receives hits outside the sidebar. The promotion
spec captures normal, minimum-width and short-window states, and checks that scrolling leaves
Cancel reachable. `real-daemon-promote.spec.ts` covers the same scratch promotion branch, now the
only branch, separately in the real tier.

## Edge cases and limitations

- Promotion closes on dispatch, without a new acknowledgement or correlated rejection protocol.
  If the daemon never confirms, the row remains in Chats. `conversation_updated` is an unsolicited
  broadcast; see [promotion correlation](conversation-promote.md#correlation-is-deliberately-absent-the-reply-is-a-broadcast-not-a-response).
- There is no busy state and no error line in this dialog: promotion is fire-and-forget, so there
  is nothing to be pending on and nothing a rejection could clear. `ChannelForm`'s error paragraph
  is unused here; only Create channel drives it.
- Escape and scrim clicks do not dismiss. The input has autofocus but no select-all or
  Enter-to-submit handler; keyboard activation of the focused OK button submits.
- Existing channels already sitting in a dedicated folder from before the #1436 withdrawal are
  not moved.

## Related

- [Create channel](create-channel-dialog.md) — shared form, separate creation lifecycle, the same
  folder-choice withdrawal.
- [Conversation promote](conversation-promote.md) — command and broadcast contract.
- [Conversation list store](conversation-list-store.md) — refresh after promotion.
- [New-folder store](new-folder-store.md) — folder round-trip state and bridge, now used only by
  the workspace picker's `CreateFolderDialog`.
- [Channel row geometry](channel-list-desktop-row-geometry.md) — save affordance placement.
- [Drop the folder choice spec](../../specs/architecture/1436-drop-channel-folder-choice.md)
  — the withdrawal decision and its rationale.
