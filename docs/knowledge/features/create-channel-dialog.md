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

When the target host has a nonempty cached model list, **Model** sits between Channel name and
Channel system prompt. It offers every published row in daemon order as one flat list, including
Default, with `composerModelRowLabel` supplying the same agent-aware labels as the footer. Each
opening resets to the inherited Claude `default` row; this draft is never remembered. Mouse clicks
and the shared menu's wrapping Up/Down, Enter/Space and Escape interaction select a row and return
focus to the trigger. Home/End have no custom handling. A missing or empty target-host cache omits
the field and all optional `agent`, `model` and `effort` create fields. Another host's cache is never
used, and opening this dialog requests no model list. [Save as channel](save-as-channel-dialog.md)
keeps its name and prompt fields without a model choice.

Since #1428 this dialog also renders an optional **Channel system prompt** filled text area under
the model field when present, otherwise under the name, restating the name input's fill, corner
and type — since #1429 [Save as channel](save-as-channel-dialog.md) renders the same field too,
on its own container.
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

The selected model implies the agent: Codex sends `agent: codex` and the row's exact `value` as
`model`; an explicit Claude model sends only `model`; inherited Claude Default sends neither.
An absent row agent tag means Claude. At submission the dialog reads the profile-wide
[remembered effort](last-effort-store.md#what-it-does) and includes it only when it exactly matches
one of the selected row's `effort_levels`, including Default. An absent or unsupported remembered
value means no effort field. These choices travel in the create request, so the channel starts with
them without a later model/effort settings write.

While the request is pending, name, prompt, Model and OK are disabled, and any model menu is
unmounted. Cancel and header close remain available. Channel rejection shows “Could not create
that channel”, restores editing and retains the chosen model for an explicit retry. A same-host
create confirmation dismisses the dialog, and the existing navigation bridge opens
the confirmed channel. There is no optimistic row or immediate close on submission.

## How it works

`ChannelList` retains only `serverId` as the draft target and mounts `CreateChannelDialog`
only for a connected host. The container owns transient name, prompt, model, busy and error state;
unmounting discards the draft. Its pure `CreateChannelDialogView` receives presentation state and callbacks,
with no workspace path prop or transport access. Operator input is rendered through React's
escaped input value. Both create and Save-as-channel views render `ChannelForm` inside `Modal`;
name and prompt fields are shared, while submission stays in each container.

`ChannelForm` takes the system prompt as one optional bundled `prompt` prop (`value`, `overLimit`,
`onChange`) rather than three parallel optional props — a value with no over-limit state, or a
handler with no accessible name, is what parallel optionals would permit. Omitted entirely, the
form without a model prop renders name-only, exactly as it did before #1428 — `ChannelForm` has
no idea which dialog it is inside. Since #1429 [Save as channel](save-as-channel-dialog.md) passes the prop
too, so today both containers render the field; the omitted case remains reachable for any future
consumer of `ChannelForm` with no need for the prompt.

Only Create supplies the optional bundled `model` prop (`rows`, `selected`, `onChange`).
`cachedChannelModels` scans `selectConversationsFor(serverId)` in order, skips uncached conversations
and returns the first cached model array by reference. A cached empty
array stops the search; it does not fall through to a later list. The selectors subscribe to
target-host membership and cache changes without inspecting the currently open conversation.
The draft is a row or `null`: null resolves to the published Claude `default` row; a pick resolves
by exact value and normalized agent. Equal values on different agents remain distinct. The shared
`ComposerOptionsMenu` receives client-generated index identities, with daemon labels reaching only
escaped visible text. Busy state replaces that menu with a disabled trigger, cleaning up its menu
listeners and focus state.

The exported chevron SVG is imported as raw local asset text and given a lifecycle-owned blob URL
only while the model field exists; cleanup revokes it. Vite's usual small-SVG data URL would be
rejected by the renderer CSP. CSS uses the SVG as an alpha mask and `--color-primary` as the visible
colour, so the asset's embedded fill does not freeze the theme colour. No CSP exception is needed.

At ordinary window heights only the model list is fixed-positioned beyond the modal scrollport.
`ChannelForm` measures the trigger's viewport bounds and updates its CSS anchor on modal/field
resize, window resize and modal scroll; cleanup disconnects the observer and listeners. At heights
at or below 550px the list stays in flow. The modal keeps `overflow: auto` in both cases: native
prompt resizing can make even a tall window need scrolling. Changing the whole modal to visible
overflow when Model opens would strand Cancel/OK below the viewport. See
[layout verification](development-verification.md#layout-and-input).

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

Submission calls `requestNewChannel(sendCommand, trimmedName, null, serverId, choice)`, with
`choice` from `channelCreateChoice(selectedModel, selectLastEffort(lastEffortStore.getState()))`.
The preference is read at submission, not captured when the modal opens. With no selected row
the helper returns no choice; with a row it constructs only the compatible agent/model/effort
fields described above. `requestNewChannel` sends `createConversation` with `is_promoted: true`,
the trimmed name and explicit `cwd: null`. The host
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

`channelCreateChoice.test.ts` covers inherited/explicit/untagged Claude and Codex, including a
Codex row whose value is `default`, exact effort membership on every agent and Default, unsupported
or absent preferences and no selected row. Host-cache cases cover a later cached conversation,
cross-host isolation and an empty first cached list that must not fall through.

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
Model assertions check field order, shared Codex labels, omitted model props and the disabled
pending trigger with no menu. Static rendering does not execute the blob URL or observer effects.

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

The same spec drives Codex selection by keyboard, Default reset on reopening, equal-value
cross-agent mouse picks, target-host cache isolation, missing/empty-cache omission and a preference
confirmed after the dialog opened. It inspects the Codex create frame and correlates a settings
refusal through main's real reply path, then retries with the retained selection. Confirmed model
and effort footers plus settings-write counts check that creation needs no follow-up write; a
separate Default scenario checks the effort-only create payload. Theme assertions change
`--color-primary` and load the blob mask image. The resize regression drags the native prompt
handle, opens Model, wheels the modal, reaches both footer controls and cancels without creating.

The [final verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1720#issuecomment-6023110097)
records all ten create-channel scenarios as executed and passed across the 2026-10-06 full gate
and its focused rerun at revision `6e1910ff3c2df90abf132b2c67567863c5e25e9c`. The full browser run
had 294 executed, 293 passed, 1 failed and 4 skipped. The named resize case, **“a resized prompt
stays scrollable with Model open and footer controls remain reachable”**, executed and passed in
the focused rerun: 1 executed, 1 passed, 0 failed, 0 skipped. The verdict confirms the Codex,
Default, host-isolation and missing/empty-cache scenarios passed in the full run. This is
fake-transport evidence.

Independent `conversationStateFake` instances both generate `created-1`. Keep successful
cross-host navigation assertions in separate launches so artificial ID collisions do not hide
or imitate a routing failure. Use a resolved reply path different from the clicked workspace to
detect an accidental path comparison in the prompt gate. The fake proves client requests and
continuation behavior;
[`real-daemon-create-channel.spec.ts`](real-daemon-credential-light-e2e.md) separately exercises
the daemon's promoted-create branch and reads its stored fields back.

`real-claude-effort-default.spec.ts` keeps chat recall separate from channel creation: chats open
with empty saved effort and require one recall acknowledgement; Default channels must already
have compatible remembered effort in their first settings reply and receive zero subsequent
settings acknowledgements before or after the first turn. Reusing the old empty-effort opening
assertion for both flows would reject the intended creation behaviour.

The [2026-10-06 dispatcher live gate](https://github.com/pyrycode/pyrycode-desktop/issues/1658#issuecomment-6023208690)
records 25 executed, 25 passed, 0 failed and 1 skipped at branch `6e1910ff3c`, integrated with
main `2168a4b739`, using `npx playwright test --config playwright.real-claude.config.ts --reporter=json`.
Its one skip is the Reset session system-prompt case. The supplied report has no per-test result
for the revised effort-default case and no daemon revision; it does not establish that named
test's pass. The earlier revision `36acd04c79f1279c5c5dfb14a4c35e4dc6b6aff0` belongs to the failed
2026-10-01 effort-default run, not this successful suite.

**Operator acceptance remains unrecorded:** confirm Low on an existing conversation, create on
the published GPT-6 Luna row, and send the first message without changing the new channel's
settings. Record the executed daemon's revision from `pyry version`, real Codex reply, and Luna display name before
sending and after the reply, never Default. The configured `real-*` suite has no scenario that
selects a Codex model or performs this Luna sequence; the fake scenario cannot supply its live
proof. A further run of that same configured gate cannot satisfy this separate operator check.

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
- [Last-effort store](last-effort-store.md) — profile-wide confirmed preference read at submission.
- [Create channel model choice spec](../../specs/architecture/1658-create-channel-model-choice.md)
  — target-host cache selection, create choices and visual revisions.
- [Daemon connection — correlation](daemon-connection-correlation.md) — the posture this dialog's
  `confirmsPending` gate inherits: state a reply's residual ambiguity rather than engineer around it.
- [Drop the folder choice spec](../../specs/architecture/1436-drop-channel-folder-choice.md)
  — the withdrawal decision and its rationale.
- [Daemon-default sidebar create spec](../../specs/architecture/1682-confirm-daemon-default-creates.md)
  — confirmation and destination design for the current workspace-row controls.
- [Create channel takes a channel system prompt spec](../../specs/architecture/1428-create-channel-system-prompt.md)
  — the full design, including the security review of the confirmation-matching gate.
