# Save-as-channel dialog

The unpromoted chat row's **Save as channel** action in [Channel List](channel-list.md)
collects a name, then [promotes the existing conversation](conversation-promote.md) in its own
workspace — the chat's exact current `row.cwd`. It preserves the conversation identifier and
history, without creating a replacement conversation, copying files or changing the existing
daemon file/session semantics.

[Create channel](create-channel-dialog.md) shares the same form, including the system prompt
field since #1429. Its container creates a new channel and waits for confirmation, writing a
non-blank prompt on that confirmation; Save as channel promotes an existing chat and writes a
non-blank prompt synchronously in the same `onSave`, with no confirmation to wait on.

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
constrained to the window; short windows scroll the panel. `ChannelForm` supplies the filled name
input plus, since #1429, an optional **Channel system prompt:** text area under it — no location
choice remains, but the prompt field does. Leaving it empty or holding only whitespace promotes
exactly as before. Typed text is bounded at `MAX_SYSTEM_PROMPT_BYTES`, counted in UTF-8 bytes by
the same `systemPromptOverLimit` helper [Create channel](create-channel-dialog.md) exports; going
over disables OK with the same client-owned notice. The draft lives only in the container's
`useState` and dies with the unmount: it opens empty on every mount and is never seeded from
[`systemPromptStore`](system-prompt-write.md) — that store holds a value only for a chat the
operator has actually opened, while a chat can be saved from any row, so there is usually no
stored prompt to seed from. An empty box therefore sends no write, keeping a prompt the chat
already holds rather than clearing it.

OK requires a nonblank trimmed name and a prompt within the byte bound. The `Untitled` fallback is
nonblank, so it is immediately valid. Cancel and header close remain available. Dismissal, unmount
and host disconnection abandon the local continuation; reconnect cannot resume it. Already-sent
remote operations are not undone.

OK sends the original conversation identifier and trimmed display name to promotion with the row's
`cwd` verbatim, then — since #1429 — writes a non-blank prompt for that same identifier, then
closes on dispatch: there is no round trip to wait on and no busy state for either command. The
dialog never optimistically edits the list. The existing `conversation_updated` broadcast triggers
the [conversation-list refresh](conversation-list-store.md), which moves the same row from Chats
to Channels without duplication.

## How it works

`ChannelList` retains the selected row, including `cwd` and `serverId`, and mounts the dialog
only for a connected owning host. The save affordance is a sibling of the row-open button,
not a nested interactive control; promoted rows have no save affordance. Each opening mounts
a fresh container, discarding previous name edits.

### Presentation and CSS

`SaveAsChannelDialogView` receives name, the prompt draft and callbacks — no location, no folder
round-trip state, no busy flag; it passes `busy={false}` and `error={null}` into `ChannelForm`,
alongside the bundled `prompt` prop since #1429. It renders
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

There is no busy state and no wait: `onSave` dispatches the promote, then — since #1429 — a
non-blank prompt's write, then calls `onPromoted` synchronously, closing the dialog. Both commands
leave in the same synchronous call, with no `await` between the connectivity guard and either
send, so the guard cannot go stale in a gap. There is no correlated rejection to listen for, and no
`newFolderStore` read, subscription or reset — that store's remaining owner is the workspace
picker's `CreateFolderDialog`; see [the store's own doc](new-folder-store.md).

### The system prompt write (#1429)

A non-blank draft goes out as one `set_system_prompt`, through the shipped `submitSystemPrompt`,
for the row's own `id` — a prop this container already holds, never a value a reply supplied. A
blank or whitespace-only box sends nothing (`writePrompt` returns early on `draft.trim() === ''`),
and a non-blank one crosses **verbatim and untrimmed**: it round-trips to the daemon as a stored
value, and normalising it here would silently change what the operator saved.

Unlike [Create channel's](create-channel-dialog.md#the-system-prompt-write-1428) `confirmsPending`
gate, this write needs no attribution check. That dialog's write could only ride an uncorrelated
`conversationCreated`, so a same-host confirmation for someone else's create would otherwise have
carried the operator's text onto a conversation they did not create. Here the conversation already
exists and its `id` is `row.id`, so there is nothing for a foreign confirmation to redirect — a
hostile or impersonating daemon can refuse the write, but it cannot retarget it.

The `submitSystemPrompt` call is wrapped in a `try`/`catch` whose body is empty by design, the same
precedent and the same two reasons as `writePrompt` in `CreateChannelDialog.tsx`: an escaping
exception would abort the `onPromoted()` below it, stranding the dialog over an already-promoted
chat, and it would carry the failed command — prompt included — onto an error path this file does
not control. The outcome lands in the app-level `systemPromptWriteStore`, the same store the
channel info sheet's `SystemPromptSection` reads; this dialog closes on dispatch and never waits
for the acknowledgement, so it has no second failure surface. One write per promote, so
[System prompt write](system-prompt-write.md)'s known limitation — two writes in flight on one
conversation being indistinguishable — is never reached from this dialog.

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
an assertion that the rendered form carries no `type="radio"`. Since #1429 it also covers the
system prompt field the shared form now renders here too: the label and text area between the name
input and the modal actions, the injected value escaped rather than live markup, the over-limit
notice appearing only past the bound with OK disabled alongside it, and a non-blank prompt paired
with a blank name still leaving OK disabled. `systemPromptOverLimit` itself stays covered only by
\#1428's own suite in `CreateChannelDialog.test.tsx`; it is not re-tested here. Static rendering can
assert the autofocus attribute, but cannot prove actual focus, callbacks or cancellation; those
require the interaction tier.

`e2e/save-as-channel-promote.spec.ts` captures requests to prove the promotion payload (original
conversation ID, verbatim `cwd`, trimmed name), list refresh without duplicates, and idle
dismissal followed by reopening with the `Untitled` default restored. A canonical reply different
from the requested path is no longer relevant to this flow — there is no folder round trip left to
prove — but the spec still injects a `workspaceFolderCreated` after dismissal to confirm it stays
inert: since #1436 this dialog neither requests a folder nor waits on one. The main promotion test
also promotes a second host's row in its tail, so cross-host routing-by-conversation-id — inherited
from the deleted dedicated-folder test — still has coverage; the first row's save affordance is
gone once promoted, which is what shifts the second row to index 0 for that tail cheaply. Since
\#1429 the form carries a second text box, so every reach for one is scoped by accessible name
(`nameField` / `promptField`, the `sidebar-create-channel.spec.ts` precedent) rather than a bare
`getByRole('textbox')`, which would be a strict-mode violation.

Two further #1429 tests cover the write, split rather than combined into one three-row launch:
`launchPairedApp` bootstraps through an unfiltered `.channel-list__row-open` click under
Playwright strict mode, so more than one promotable row at launch breaks the fixture before the
spec's first line runs, and teaching the shared fixture to seed more was rejected as too wide a
change for the 29 specs that pass through it. *A typed prompt rides the promotion, addressed to
the promoted row* covers the byte gate (at the bound, one multi-byte character over at fewer code
units, notice and disabled OK), the Figma captures at 1280px and at the 800px minimum, and asserts
the captured request types equal exactly `['promote_conversation', 'set_system_prompt']` with the
write's payload carrying the text verbatim and untrimmed. *An empty or whitespace-only box
promotes exactly as before and sends no write* covers both blank arms across two hosts (one
promotable row each) and the discard-on-dismiss check, asserting exactly `['promote_conversation']`
with no captured write. The fake's `set_system_prompt` capture is left unanswered, since this
dialog never waits for the acknowledgement.

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
- A rejected or lost system-prompt write is invisible to this dialog: it has already closed by the
  time either could settle. The outcome still lands in `systemPromptWriteStore`, surfaced by the
  channel info sheet's `SystemPromptSection`.

## Related

- [Create channel](create-channel-dialog.md) — shared form including the system prompt field,
  separate creation lifecycle, the same folder-choice withdrawal.
- [System prompt write](system-prompt-write.md) — the transport leg `submitSystemPrompt` rides and
  the tri-state contract (`null` clears, `''` stores empty, text is verbatim).
- [Conversation promote](conversation-promote.md) — command and broadcast contract.
- [Conversation list store](conversation-list-store.md) — refresh after promotion.
- [New-folder store](new-folder-store.md) — folder round-trip state and bridge, now used only by
  the workspace picker's `CreateFolderDialog`.
- [Channel row geometry](channel-list-desktop-row-geometry.md) — save affordance placement.
- [Drop the folder choice spec](../../specs/architecture/1436-drop-channel-folder-choice.md)
  — the withdrawal decision and its rationale.
- [Save as channel takes a channel system prompt spec](../../specs/architecture/1429-save-as-channel-system-prompt.md)
  — the full design, including why no attribution gate is needed here.
