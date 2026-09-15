# Create-channel dialog

The [Channels-tree workspace plus](channel-list-workspace-row-nest.md)
creates a named, promoted channel on the clicked host, in that workspace's own folder — the
selected `cwd` verbatim. Existing channels and files are never moved.

Until 2026-09-14 the dialog offered a second destination, a dedicated `<workspace>/channels/<slug>/`
subfolder created through `createWorkspaceFolder`. It was withdrawn (#1436): neither this client
nor the daemon has a workspace entity — a workspace *is* a conversation's `cwd` as an exact string,
which is what `groupByWorkspace` keys on — so a channel in that subfolder rendered as a brand-new
workspace group named after the slug, under the host rather than under the workspace the operator
clicked. Both dialogs now always use the workspace folder itself, which was already the default
branch. See [Save as channel](save-as-channel-dialog.md) for the same withdrawal on that dialog.

## What it does

Each opening starts with an empty, focused **Channel name** field. The shared `Modal` supplies a
640px preferred width constrained to the window, title, header close control, divider, and
centered Cancel/OK actions. The filled input uses the existing theme tokens; short windows scroll
the panel. OK requires a nonblank trimmed name.

Submission sends one named, promoted channel request for the clicked workspace's exact `cwd`,
without creating a folder. Both dialogs retain the clicked host, even when two hosts have the
same workspace path.

While the request is pending, name and OK are disabled. Cancel and header close remain available.
Channel rejection shows “Could not create that channel”, restores editing and permits an explicit
retry. Matching channel confirmation dismisses the dialog, and the existing navigation bridge opens
the confirmed channel. There is no optimistic row or immediate close on submission.

## How it works

`ChannelList` retains `{ cwd, serverId }` as the draft target and mounts `CreateChannelDialog`
only for a connected host. The container owns transient name, busy and error state; unmounting
discards the draft. Its pure `CreateChannelDialogView` receives presentation state and callbacks,
with no workspace path prop or transport access. Operator input is rendered through React's
escaped input value. Both views render `ChannelForm` inside `Modal`; only the name field is
shared, while submission stays in each container.

The workspace plus and disclosure remain sibling controls, so creating does not toggle the
workspace fold. The shared `WorkspaceCreateControl` bundles a label and callback: two parallel
optional props would permit a handler without an accessible name. Unknown-workspace groups
withhold the plus; see [workspace row geometry](channel-list-desktop-row-geometry.md).

`channels.css`'s `:focus-visible` and `:disabled` rules for `.create-channel__input` were shared
selector lists with the withdrawn radio rules (`.create-channel__option input`), not a clean block.
Deleting the radio half and trimming rather than dropping those two lists is what keeps the name
field's focus ring and disabled dimming; a wholesale delete would have silently stripped both with
no test catching it, since no static test reads computed style.

### Requests and replies

Submission calls `requestNewChannel(sendCommand, trimmedName, cwd, serverId)`. That helper sends
`createConversation` with `is_promoted: true`, the trimmed name and verbatim `cwd`. The host
routing key is a top-level IPC field, outside the wire payload. There is no folder command in
this flow, and no client-side path or slug construction: `channelsParent` and `slugForChannel`
went with the withdrawn dedicated branch (#1436).

A synchronous ref records `idle` or `channel` before sending. This prevents duplicate dispatch
before React paints the disabled OK. The listener reads the original `DaemonEvent.serverId`
before flattening any reply: the create-rejection helper discards host identity. Only a nonempty
matching host stamp and `pending.type === 'channel'` can advance the draft:
`conversationCreated` dismisses; `conversationCreateRejected` clears the wait with the channel
error. `idle`, wrong-host, unstamped and unrelated replies do not progress this draft.

Local send exceptions use the same client-owned stage error. Diagnostics contain only static
lifecycle/status codes, never names, paths, payloads or exception details. The command helper
returns `void`; the dialog's event subscription supplies the wait and rejection handling.
[Conversation create](conversation-create.md) covers the shared transport contract.

### Draft lifetime

Cancel/header close synchronously mark the draft abandoned, reset the pending ref and remove
both daemon-event and session subscriptions before notifying the parent. Effect cleanup also
covers unmount. A synchronous session subscription abandons the draft when its selected host
ceases to be connected, and submission/event handlers recheck connectivity. A later reconnect
cannot resume an abandoned draft.

This cleanup owns only the local continuation. It does not undo an already-sent operation.
If a channel request was already sent, a later confirmation can still open that channel through
the globally mounted `useConversationCreatedNav`, even after the dialog was dismissed.

## Testing

`CreateChannelDialog.test.tsx` checks shared markup, labels, blank validation, busy controls and
accessible errors, plus escaped input. `autoFocus` renders as `autofocus=""` in static markup,
but actual focus and keyboard behavior require the interaction tier. Escaping assertions check
the complete escaped attribute value: words such as `onerror` can remain inert inside a correctly
escaped value.

`e2e/sidebar-create-channel.spec.ts` holds real fake-transport replies to cover the request,
rejection/retry, frozen controls, duplicate prevention, dismissal, reopening and disconnect
abandonment. Two hosts sharing a workspace path prove routing in both directions; injected
original events exercise wrong-host, malformed/absent stamps and out-of-stage guards, including
that an injected `workspaceFolderCreated` is inert for this draft. A renderer barrier after
injection precedes absence assertions, avoiding checks made before callbacks could run.
Short-window checks scroll to and click Cancel.

Independent `conversationStateFake` instances both generate `created-1`. Keep successful
cross-host navigation assertions in separate launches so artificial ID collisions do not hide
or imitate a routing failure. Use a canonical reply different from the requested path to detect
accidental reconstruction. The fake proves client requests and continuation behavior;
[`real-daemon-create-channel.spec.ts`](real-daemon-credential-light-e2e.md) separately exercises
the daemon's promoted-create branch and reads its stored fields back.

## Edge cases and limitations

- Replies expose no renderer request identifier. Matching is selected host plus pending
  operation, not per-request correlation. Concurrent same-host operations remain indistinguishable,
  including an older reply arriving during a newer draft's matching stage.
- Guards control this draft's progression and dismissal only. The global navigation bridge
  independently observes confirmed creations, including confirmations ignored locally.
- No timeout or automatic retry is added. A missing response leaves a dismissible pending wait.
- Escape and scrim clicks do not dismiss. Cancel and the header close control are the dismissal
  actions, including during pending work.
- Existing channels already sitting in a dedicated folder from before the #1436 withdrawal are
  not moved; only new creation and promotion changed.

## Related

- [Channel List](channel-list.md) — workspace and host grouping and the owning target state.
- [Save as channel](save-as-channel-dialog.md) — promotion flow, and the same folder-choice withdrawal.
- [New-discussion FAB](new-discussion-fab.md) — existing confirmed-conversation navigation.
- [Drop the folder choice spec](../../specs/architecture/1436-drop-channel-folder-choice.md)
  — the withdrawal decision and its rationale.
