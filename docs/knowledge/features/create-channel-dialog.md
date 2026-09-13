# Create-channel dialog

The [Channels-tree workspace plus](channel-list-desktop-row-geometry.md#the-workspace-rows-own-nest-and-its-create-chat-plus-1178)
creates a named, promoted channel on the clicked host, either in that workspace itself or
in a dedicated folder beneath it. Existing channels and files are never moved.

## What it does

Each opening starts with an empty, focused **Channel name** field and **Use shared scratch
folder** selected. The shared `Modal` supplies a 640px preferred width constrained to the
window, title, header close control, divider, and centered Cancel/OK actions. The filled input
and native labelled radios use the existing theme tokens; short windows scroll the panel.
OK requires a nonblank trimmed name.

| Choice | Destination and operation |
| --- | --- |
| **Use shared scratch folder** | The exact selected workspace folder. Sends one named, promoted channel request without creating a folder. |
| **Create a dedicated channel folder** | Creates `<workspace>/channels/<derived-name>/`, including missing parents, then creates the channel using the host-returned canonical path. |

The scratch label means the selected workspace itself in this flow. Neither a separate common
scratch folder nor the host's default base folder is an alternative destination. Both choices
retain the clicked host, even when two hosts have the same workspace path.

For workspace `/home/alex/projects/demo` and name ` Release planning `, dedicated submission
requests parent `/home/alex/projects/demo/channels` and folder name `release-planning`.
Only folder success permits channel creation. Its `cwd` is the returned canonical path verbatim,
even if different from the requested path; its display name remains `Release planning`.

While either operation is pending, name, radios and OK are disabled. Cancel and header close
remain available. Folder rejection shows “Could not create that folder” and sends no channel
command; channel rejection shows “Could not create that channel”. Both restore editing and
permit an explicit retry. Matching channel confirmation dismisses the dialog, and the existing
navigation bridge opens the confirmed channel. There is no optimistic row or immediate
close on submission.

## How it works

`ChannelList` retains `{ cwd, serverId }` as the draft target and mounts `CreateChannelDialog`
only for a connected host. The container owns transient name, location, busy and error state;
unmounting discards the draft. Its pure `CreateChannelDialogView` receives presentation state
and callbacks, with no workspace path prop or transport access. Operator input is rendered
through React's escaped input value.

The workspace plus and disclosure remain sibling controls, so creating does not toggle the
workspace fold. The shared `WorkspaceCreateControl` bundles a label and callback: two parallel
optional props would permit a handler without an accessible name. Unknown-workspace groups
withhold the plus; see [workspace row geometry](channel-list-desktop-row-geometry.md).

### Requests and replies

Direct submission calls `requestNewChannel(sendCommand, trimmedName, cwd, serverId)`.
That helper sends `createConversation` with `is_promoted: true`, the trimmed name and verbatim
`cwd`. The host routing key is a top-level IPC field, outside the wire payload.

Dedicated submission uses the existing `createWorkspaceFolder` command on the same host.
Its parent is the selected `cwd` stripped of trailing slashes plus `/channels`.
`slugForChannel`, shared with [Save as channel](save-as-channel-dialog.md), lowercases the
trimmed name, replaces runs outside ASCII letters/digits with hyphens, removes edge hyphens,
and falls back to `channel` when empty. Only the folder name is converted. Save as channel's
fixed `CHANNELS_PARENT` is not this flow's parent. Remote folder creation and canonicalization
remain authoritative; no new wire or main-process operation is introduced.

A synchronous ref records `idle`, `folder` (including the submitted display name), or `channel`
before sending. This prevents duplicate dispatch before React paints disabled controls.
The listener reads the original `DaemonEvent.serverId` before flattening any reply: the shared
folder and create-rejection helpers discard host identity. Only a nonempty matching host stamp
and the expected operation can advance the pending stage:

- `folder`: `workspaceFolderCreated` sends the channel request with `event.path`;
  `workspaceFolderRejected` clears the wait with the folder error.
- `channel`: `conversationCreated` dismisses; `conversationCreateRejected` clears the wait
  with the channel error.
- `idle`, wrong-host, unstamped, unrelated and out-of-stage replies do not progress this draft.

Local send exceptions use the same client-owned stage errors. Diagnostics contain only static
lifecycle/status codes, never names, paths, payloads or exception details. The command helper
returns `void`; the dialog's event subscription supplies the wait and rejection handling.
[Conversation create](conversation-create.md) covers the shared transport contract.

### Draft lifetime

Cancel/header close synchronously mark the draft abandoned, reset the pending ref and remove
both daemon-event and session subscriptions before notifying the parent. Effect cleanup also
covers unmount. A synchronous session subscription abandons the draft when its selected host
ceases to be connected, and submission/event handlers recheck connectivity. A later folder
reply or reconnect cannot resume an abandoned draft.

This cleanup owns only the local continuation. It does not undo an already-sent operation.
If a channel request was already sent, a later confirmation can still open that channel through
the globally mounted `useConversationCreatedNav`, even after the dialog was dismissed.

## Testing

`CreateChannelDialog.test.tsx` checks shared markup, labels, initial selection, blank validation,
busy controls, accessible errors, escaped input and the Release planning conversion.
`autoFocus` renders as `autofocus=""` in static markup, but actual focus and keyboard behavior
require the interaction tier. Escaping assertions check the complete escaped attribute value:
words such as `onerror` can remain inert inside a correctly escaped value.

`e2e/sidebar-create-channel.spec.ts` holds real fake-transport replies to cover direct and
dedicated requests, canonical paths, folder failure before channel creation, rejection/retry,
frozen controls, duplicate prevention, radio keyboard operation, dismissal, reopening and
disconnect abandonment. Two hosts sharing a workspace path prove routing in both directions;
injected original events exercise wrong-host, malformed/absent stamps and out-of-stage guards.
A renderer barrier after injection precedes absence assertions, avoiding checks made before
callbacks could run. Short-window checks scroll to and click Cancel.

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
  Retrying dedicated creation starts the folder operation again; prior remote work is not rolled back.
- Escape and scrim clicks do not dismiss. Cancel and the header close control are the dismissal
  actions, including during pending work.

## Related

- [Channel List](channel-list.md) — workspace and host grouping and the owning target state.
- [Save as channel](save-as-channel-dialog.md) — promotion flow and shared name conversion.
- [New-discussion FAB](new-discussion-fab.md) — existing confirmed-conversation navigation.
- [Workspace-relative creation spec](../../specs/architecture/1351-workspace-channel-folders.md)
  — destination, lifetime and correlation decisions.
