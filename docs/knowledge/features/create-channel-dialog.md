# Create-channel dialog

The [Channels-tree workspace plus](channel-list-workspace-row-nest.md) opens a confirmation dialog
for a named, promoted channel on the clicked host. The create sends `cwd: null`, so the daemon
chooses that host's default folder. Existing channels and files are never moved.

Until 2026-09-14 the dialog offered a second destination, a dedicated `<workspace>/channels/<slug>/`
subfolder created through `createWorkspaceFolder`. It was withdrawn (#1436): neither this client
nor the daemon has a workspace entity — a workspace *is* a conversation's `cwd` as an exact string,
which is what `groupByWorkspace` keys on — so a channel in that subfolder rendered as a brand-new
workspace group named after the slug, under the host rather than under the workspace the operator
clicked. That withdrawal first left creation in the clicked workspace's folder; the sidebar
create now uses the daemon default. [Save as channel](save-as-channel-dialog.md) remains a
separate promotion flow for an existing chat.

## What it does

Each opening starts with an empty, focused **Channel name** field. The shared `Modal` supplies a
640px preferred width constrained to the window, title, header close control, divider, and
centered Cancel/OK actions. The filled input uses the existing theme tokens; short windows scroll
the panel. OK requires a nonblank trimmed name.

Since #1428 this dialog also renders an optional **Channel system prompt** filled text area under
the name field, restating the name input's fill, corner and type — since #1429
[Save as channel](save-as-channel-dialog.md) renders the same field too, on its own container.
Leaving it empty or holding only whitespace creates the channel exactly as before. Typed text is
bounded at `MAX_SYSTEM_PROMPT_BYTES`, counted the way the channel info sheet's system-prompt
section counts it — UTF-8 bytes, not UTF-16 code units — and going over disables OK with a
client-owned notice; nothing extra is shown under the bound. The draft lives only in the
container's `useState` and dies with the unmount, so Cancel and the header close discard it and a
reopen starts empty; it is never logged, persisted, or rendered anywhere but the controlled text
area.

Opening the dialog sends no create. Confirmation sends one named, promoted request with
`cwd: null`, without creating a folder. Cancel and close send none. The clicked host remains the
target even when another host has the same workspace path; no folder selector or override is
offered. A non-blank prompt is written in a second step described in § Requests and replies below.

While the request is pending, name and OK are disabled. Cancel and header close remain available.
Channel rejection shows “Could not create that channel”, restores editing and permits an explicit
retry. A same-host create confirmation dismisses the dialog, and the existing navigation bridge opens
the confirmed channel. There is no optimistic row or immediate close on submission.

## How it works

`ChannelList` retains only `serverId` as the draft target and mounts `CreateChannelDialog`
only for a connected host. The container owns transient name, busy and error state; unmounting
discards the draft. Its pure `CreateChannelDialogView` receives presentation state and callbacks,
with no workspace path prop or transport access. Operator input is rendered through React's
escaped input value. Both views render `ChannelForm` inside `Modal`; only the name field is
shared, while submission stays in each container.

`ChannelForm` takes the system prompt as one optional bundled `prompt` prop (`value`, `overLimit`,
`onChange`) rather than three parallel optional props — a value with no over-limit state, or a
handler with no accessible name, is what parallel optionals would permit. Omitted entirely, the
form renders name-only, exactly as it did before #1428 — the shape `ChannelForm` still has no idea
which dialog it is inside. Since #1429 [Save as channel](save-as-channel-dialog.md) passes the prop
too, so today both containers render the field; the omitted case remains reachable for any future
consumer of `ChannelForm` with no need for the prompt.

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

Submission calls `requestNewChannel(sendCommand, trimmedName, null, serverId)`. That helper sends
`createConversation` with `is_promoted: true`, the trimmed name and explicit `cwd: null`. The host
routing key is a top-level IPC field, outside the wire payload. There is no folder command in
this flow, and no client-side path or slug construction: `channelsParent` and `slugForChannel`
went with the withdrawn dedicated branch (#1436). The daemon resolves its default folder and
returns that path in the confirmation; the helper's signature also permits an explicit path.

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

### The system prompt write (#1428)

The daemon's `set_system_prompt` verb takes an *existing* `conversation_id`, and
`createConversation` carries no prompt field, so a non-blank prompt cannot ride the create — it
goes out as a second command, on the confirmation, through the already-shipped
`submitSystemPrompt` (see [System prompt write](system-prompt-write.md)). No new wire type,
envelope or IPC arm.

The pending ref (`idle` | `channel`) records what was asked for: the trimmed name and
the prompt to write — `null` when the draft trimmed to empty, otherwise
the draft's own text, verbatim and untrimmed, because it round-trips to the daemon as a stored
value and any normalisation here would silently change what the operator saved. That decision is
taken once, at send time, not re-derived later.

`conversationCreated` is **uncorrelated** — main emits it on decode without matching it to a
request — so a same-host confirmation for a create some *other* client asked for is otherwise
indistinguishable from this dialog's own. Today that only dismisses the dialog early; once a
prompt write could ride the same event, an unmatched confirmation would write the operator's text
onto a conversation they did not create. The write is therefore gated on `confirmsPending`, which
checks the payload's `is_promoted` and `name` against the trimmed name sent by this dialog. It cannot
compare `cwd`: the request sent null and the reply carries the daemon-resolved default path. The
listener first requires a nonempty matching host stamp. Wrong-host confirmations leave the wait
alone; any same-host `conversationCreated` dismisses it, even when promotion or name fails the
prompt gate. Rejection restores an editable draft, while disconnect abandons the local wait.

The write call is wrapped in a non-logging `try`/`catch`: `sendCommand` can throw locally, and an
escaping exception would abort the dismissal below it, stranding the dialog over a channel that
already exists, and would carry the failed command — prompt included — onto an error path this
file does not control. The catch is empty by design; there is nothing loggable here that is not
forbidden, and a stranded in-flight marker is swept by the write store's own reconnect handling.
The write's outcome lands in the app-level `systemPromptWriteStore`, the same store the channel
info sheet's `SystemPromptSection` already reads, so the operator sees the result there — the
dialog itself does not wait for the acknowledgement and has no second failure surface.

**Residual ambiguity, stated rather than engineered around**, the posture
[Daemon connection — correlation](daemon-connection-correlation.md) already takes for this reply:
two concurrent promoted creates on one host with the same trimmed name stay
indistinguishable, and the first confirmation to arrive takes the write. No per-request
correlation id exists on this path, and minting one is a wire change on this repo and on mobile.
`confirmsPending` is an **attribution filter against benign concurrency, not an authorization
check**: a hostile or impersonating daemon picks the `id` in its own confirmation and can already
direct the write anywhere, since no client-side comparison of fields that same party also supplies
can prevent that.

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
escaped value. It also covers the system prompt field: the label and text area render between the
name input and the actions and are disabled alongside it while busy; the over-limit notice appears
only when over the bound, with OK disabled alongside it; `systemPromptOverLimit` is checked at
empty, at the bound, one byte over, and on a multi-byte value whose UTF-8 length diverges from its
code-unit length; `confirmsPending` is checked on a match with a daemon-resolved path, a name mismatch,
`is_promoted: false`, and `idle`. Since #1429 `SaveAsChannelDialog.test.tsx` covers the same field
on its own container — see [Save as channel § Testing](save-as-channel-dialog.md#testing).

`e2e/sidebar-create-channel.spec.ts` holds real fake-transport replies to cover the request,
rejection/retry, frozen controls, duplicate prevention, dismissal, reopening and disconnect
abandonment. Two hosts sharing a workspace path prove routing in both directions; injected
original events exercise wrong-host, malformed/absent stamps and out-of-stage guards, including
that an injected `workspaceFolderCreated` is inert for this draft. A renderer barrier after
injection precedes absence assertions, avoiding checks made before callbacks could run.
Short-window checks scroll to and click Cancel. Since #1428, a second text box exists on this
form, so every capture that reached for the name field by an unnamed `getByRole('textbox')` had to
be scoped by accessible name (`{ name: 'Channel name:' }`) — an unscoped query is a strict-mode
violation once two boxes exist. The same spec covers the write: a create with a prompt sends
`create_conversation` then `set_system_prompt`, in that order, against the confirmed conversation's
own id and the typed text verbatim and untrimmed; an empty or whitespace-only box sends no
`set_system_prompt`; a foreign-host confirmation and a same-host confirmation that does not match
`confirmsPending` each send nothing (the foreign-host case also does not dismiss, the mismatched
same-host case dismisses exactly as it always did); text over the bound disables OK.

Independent `conversationStateFake` instances both generate `created-1`. Keep successful
cross-host navigation assertions in separate launches so artificial ID collisions do not hide
or imitate a routing failure. Use a resolved reply path different from the clicked workspace to
detect an accidental path comparison in the prompt gate. The fake proves client requests and
continuation behavior;
[`real-daemon-create-channel.spec.ts`](real-daemon-credential-light-e2e.md) separately exercises
the daemon's promoted-create branch and reads its stored fields back.

## Edge cases and limitations

- Replies expose no renderer request identifier. Matching is selected host plus pending
  operation, not per-request correlation. Concurrent same-host operations remain indistinguishable,
  including an older reply arriving during a newer draft's matching stage. Since #1428 this also
  bounds the system-prompt write: two concurrent promoted creates on one host with the same trimmed
  name stay indistinguishable to `confirmsPending`, and the first confirmation to arrive
  takes the write.
- Guards control this draft's progression and dismissal only. The global navigation bridge
  independently observes confirmed creations, including confirmations ignored locally.
- No timeout or automatic retry is added. A missing response leaves a dismissible pending wait.
- Escape and scrim clicks do not dismiss. Cancel and the header close control are the dismissal
  actions, including during pending work.
- Existing channels already sitting in a dedicated folder from before the #1436 withdrawal are
  not moved; only new creation and promotion changed.
- A rejected or lost system-prompt write is invisible to this dialog: by the time it could settle,
  the dialog has already dismissed on the create confirmation. The outcome still lands in
  `systemPromptWriteStore`, and the channel info sheet's `SystemPromptSection` is where it surfaces.

## Related

- [Channel List](channel-list.md) — workspace and host grouping and the owning target state.
- [Save as channel](save-as-channel-dialog.md) — promotion flow, and the same folder-choice
  withdrawal; since #1429 its modal renders the same `prompt` prop on `ChannelForm` and writes the
  prompt synchronously after its promote, with no `confirmsPending`-style attribution gate — the
  conversation already exists and its `id` is a prop, never a value a reply supplied.
- [New-discussion FAB](new-discussion-fab.md) — existing confirmed-conversation navigation.
- [System prompt write](system-prompt-write.md) — the transport leg `submitSystemPrompt` rides, the
  tri-state contract (`null` clears, `''` stores empty, text is verbatim), and the known limitation
  that two writes in flight on one conversation are indistinguishable, which this dialog's
  one-write-per-create design never reaches.
- [Daemon connection — correlation](daemon-connection-correlation.md) — the posture this dialog's
  `confirmsPending` gate inherits: state a reply's residual ambiguity rather than engineer around it.
- [Drop the folder choice spec](../../specs/architecture/1436-drop-channel-folder-choice.md)
  — the withdrawal decision and its rationale.
- [Daemon-default sidebar create spec](../../specs/architecture/1682-confirm-daemon-default-creates.md)
  — confirmation and destination design for the current workspace-row controls.
- [Create channel takes a channel system prompt spec](../../specs/architecture/1428-create-channel-system-prompt.md)
  — the full design, including the security review of the confirmation-matching gate.
