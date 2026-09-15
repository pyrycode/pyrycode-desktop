# Edit channel dialog

The [Channels row's own pen](channel-list.md#the-rows-save-affordance-channellisttsx-added-by-274)
opens this modal on the row's name — the first half of Juhana's 2026-09-14 ruling that a channel is
edited under its own word, never through the [Edit chat dialog](rename-conversation-dialog.md) the
row used to share with a chat. Introduced in [#1476](https://github.com/pyrycode/pyrycode-desktop/issues/1476),
split from [#1430](https://github.com/pyrycode/pyrycode-desktop/issues/1430). The **Channel system
prompt:** field is [#1477](https://github.com/pyrycode/pyrycode-desktop/issues/1477)'s; the outlined
Archive/Remove-channel button drawn below it in Figma is [#1438](https://github.com/pyrycode/pyrycode-desktop/issues/1438)'s.
Both extend this page and this file rather than adding a sibling.

## What it does

- The Channels row's pen carries `aria-label="Edit channel"` and the same hover pill, both from one
  module constant (`EDIT_CHANNEL_CONTROL_LABEL`, renamed in place from `RENAME_CONTROL_LABEL` rather
  than revalued — its only two readers are its own declaration and the pen's `RowPenControl`). Its
  class tokens, `.channel-list__rename` / `__rename-icon`, are **unchanged** — twelve specs, six of
  them `real-daemon-*`, read those tokens as "this row is a promoted Channels row", and only the
  word moved. The Chats row's pen (`.channel-list__chat-edit`, **Edit chat**) and its Save-as-channel
  chevron are untouched; see [the row's hover-revealed control](channel-list-row-hover-control.md).
- Activating it opens the [shared Modal](modal-presentation.md) at 640px preferred width: an **Edit
  channel** title, header close control, divider, a **Channel name:** filled input prefilled with the
  row's displayed title (`titleFor(row.name)`, including the **Untitled** fallback), and centred
  outlined-Cancel / filled-OK actions. There is no Archive chat button — the one thing this dialog
  deliberately does not inherit from its sibling.
- OK is disabled on a blank (or whitespace-only) name. On a non-blank name it sends
  `renameConversation` **only when the trimmed field differs from the title it was seeded with** —
  so OK on an untouched unnamed row sends nothing rather than naming that channel `Untitled`, and an
  edit that only adds edge whitespace also sends nothing. Both Cancel and the header close send
  nothing. Either way the dialog dismisses; an unchanged name is a no-op, not a refusal, and the next
  open re-seeds from the row's stored title rather than the abandoned draft.
- The dialog closes if the row's host stops being connected — the render gate re-evaluates on every
  paint, and the existing `sessionStore.subscribe` effect clears the held row a beat later. The
  conversation title is daemon-authored and reaches the controlled input and nothing else: never an
  attribute, never markup, never a log.

## How it works

### `EditChannelDialog.tsx` (new module)

One pure, SSR-testable export, in [`EditChatDialogView`](rename-conversation-dialog.md)'s shape
**minus the archive arm and minus `available`**:

```ts
export function EditChannelDialogView(props: {
  name: string
  onNameChange: (next: string) => void
  onCancel: () => void
  onSave: () => void
}): JSX.Element
```

It renders `.edit-channel-overlay` + an inert `.edit-channel-overlay__scrim` around `<Modal
title="Edit channel" width={640} cancelAction={…} confirmAction={{ label: 'OK', onClick: onSave,
disabled: name.trim() === '' }} onClose={onCancel}>`, whose content slot is one
`.edit-channel__field` label wrapping `.edit-channel__label` (**Channel name:**) and a controlled
`.edit-channel__input`.

**No `available` prop**, unlike its sibling. That prop exists on `EditChatDialogView` because
[#1440](rename-conversation-dialog.md)'s Archive chat sits in the *gap* between two buttons' disabled
expressions — OK reads `blank || !available`, Archive chat reads `!available` alone. This dialog has
one button and no such gap; its host guard is the container's render gate (`connected(...)`) plus the
save callback's own interaction-time re-check (below). [#1438](https://github.com/pyrycode/pyrycode-desktop/issues/1438)
adds the prop when it adds the second button that needs it — shipping it now would be a prop with one
value and no caller.

The title lives in a module constant, `EDIT_CHANNEL_TITLE`, in `EDIT_CHAT_COPY`'s idiom: apostrophe-
free, interpolating no conversation name, because it is a load-bearing `getByRole('dialog', { name:
… })` locator in five e2e specs and must not be reworded casually. It is **not** shared with
`ChannelList`'s `EDIT_CHANNEL_CONTROL_LABEL`, which happens to carry the same two words — one names
the pen, the other the dialog's heading, and folding them together would couple a control's
accessible name to a modal's heading across a module boundary for a coincidence of wording (the
ruling `HOST_ROW_FALLBACK_LABEL` already records, one dialog over).

`requestRenameConversation` is imported and reused **verbatim** from `EditChatDialog.tsx` — no
second `renameConversation` literal, no new wire type, envelope or IPC arm. It owns the trim and
reads only `row.id`, which is what lets both dialogs share it unmodified.

### `ChannelList.tsx` — a second per-interaction cell pair and handler

Beside the existing `renameRow` / `renameName` pair, a fully independent second pair:

```ts
const [editChannelRow, setEditChannelRow] = useState<SidebarRow | null>(null)
const [editChannelName, setEditChannelName] = useState('')
```

**Two cells, not three.** The "differs from the seed" comparison reads `titleFor(editChannelRow.name)`
— derived from the row the cell already holds, the same expression the open handler seeded the field
from, over the same captured snapshot. A third cell holding a copy of that seed would be one more
thing to clear on host loss and one more thing to forget.

Independent of `renameRow` (and of the other four dialog cells in this file) for the reason they all
share: an open dialog's `position: fixed; inset: 0` overlay covers the window, so the row behind it
isn't clickable and no two dialogs can be open at once — no mutual-exclusion logic is needed.

`onEditChannel`, a second handler beside `onRename`, threaded down the existing chain
(`ChannelListView` prop → `renderBody` param → the **Channels** tree's `renderServerTrees` call, the
one level that already builds the pen's `RowPenControl` and therefore the one level that can tell the
trees apart). The Chats tree keeps `onRename` and `EditChatDialogView`; `onRename` now serves the
Chats tree alone. Both handlers seed identically — `setEditChannelRow(row);
setEditChannelName(titleFor(row.name))`, after the same `canMutateHost` re-check `onRename` already
carries — only the dialog each opens differs, which is the whole ticket.

**Host-loss clear lives inside the existing `sessionStore.subscribe` effect**, one statement beside
`renameRow`'s, with `editChannelRow` added to the effect's dependency array — not a second
subscription. A reset written anywhere else is one an edit to this branch can forget ([#1439](edit-workspace-dialog.md)'s
ruling, restated here).

**The save callback's two conditions, in order:**

1. `canMutateHost(editChannelRow.serverId)` — a **live** `sessionStore` read, taken at interaction
   time. This is the only disabled-arm this dialog's OK has: unlike `EditChatDialogView`'s
   `available` prop, nothing in the render makes OK dead when the host drops mid-dialog, so this line
   is what stands between a disconnect and a send.
2. `editChannelName.trim() !== titleFor(editChannelRow.name)` — only then does
   `requestRenameConversation(window.pyry.sendCommand, editChannelRow, editChannelName)` fire.

Dismissal (`setEditChannelRow(null)`) happens unconditionally after, on both the sent and the
not-sent path — an unchanged name closes without sending, it never refuses to close.

### `channels.css` — the `.edit-channel*` namespace

`.edit-channel-overlay`, `.edit-channel-overlay__scrim`, `.edit-channel__field`,
`.edit-channel__label`, `.edit-channel__input` and its `:focus-visible` arm restate the
`.rename-conversation*` recipe declaration for declaration, token for token — a **locator** decision,
not a styling one. Six shipped specs (three of them `real-daemon-*`) find the chat dialog through
`.rename-conversation*`; a shared selector would make every one of them match whichever modal
happened to be open. The `.channel-list` header comment naming the fixed overlays that must escape
its `position: relative` names `.edit-channel-overlay` alongside the others it already listed. This
duplication is deliberate and must not be "simplified" into a shared class — the same ruling
`.channel-list__rename` already carries for restating `.channel-list__save`, and the [Edit host
dialog](edit-host-dialog.md)'s own stated rule.

## Edge cases and limitations

- **A rename the daemon never confirms simply leaves the row's title unchanged** — the same answer
  the Edit chat dialog gives (see [its own edge cases](rename-conversation-dialog.md#edge-cases-and-limitations)).
  No timeout, retry or rejection surface exists here either.
- **No length bound on the name.** The daemon-supplied name reaches a controlled input with no
  `maxlength`, unchanged from the `.rename-conversation__input` this restates — a layout question,
  not a trust one, and out of scope for this ticket.
- **Opening the same channel through the Channel Info sheet still reaches the *other* dialog.** The
  sheet's Actions pill (`ConversationScreen.tsx`) and `requestRenameConversation`'s other production
  caller are untouched by #1476 — see [Edit chat dialog § Channels-row entry point
  retired](rename-conversation-dialog.md#channels-row-entry-point-retired-1476). A channel opened from
  its own sidebar row reaches this modal; the same channel opened from the sheet still reaches Edit
  chat, Archive chat button included, until #1477 or a later ticket unifies the two paths.
- **Static markup cannot prove event wiring.** `EditChannelDialog.test.tsx` covers accessible names,
  the header word (**Edit chat** and **Rename** both asserted *absent*, not merely unmentioned — five
  e2e specs locate this dialog by role name), the seeded field, OK's disabled state, the missing
  Archive chat button, the `.edit-channel*` namespace, and escaping. The open → type → OK → dismiss
  transition, the unchanged-name no-send, the reopen-from-stored-title and the host-loss close all
  belong to Playwright: `conversation-state-fake`, `conversation-create-rename`,
  `sidebar-offline-mutations`, `sidebar-control-name-pill`, `sidebar-row-geometry` and (behind
  `npm run e2e:real:gate`) `real-daemon-rename`.

## Lessons learned

- **A retitle can delete a sibling ticket's coverage, not just move it.** [#1440](rename-conversation-dialog.md)'s
  Archive chat button had two entry points — the Channels row's pen and the Channel Info sheet. Taking
  the pen away from the chat dialog left Archive chat with one entry point, and
  `conversation-create-rename.spec.ts`'s sidebar arm of that drive had nothing on the new dialog left
  to exercise. It was deleted rather than retitled; both halves of that acceptance criterion survive
  on the sheet's own arm. The cost is real: that deleted arm was the only place proving Archive chat
  acts on *the row the control was on* rather than on *the open conversation*, since the sheet is
  always the open conversation. **#1438 should re-establish that assertion** when it draws this
  modal's own put-away button — the drive it needs (a promoted sidebar row that is not the open chat)
  is already set up in that spec, just no longer aimed at anything.
- **Two e2e markers stayed disjoint only by their terminating quote.** `aria-label="Edit chat"` is not
  a substring of `aria-label="Edit channel"` *because* both literals carry the closing `"`. Every
  per-tree count in `ChannelList.test.tsx` and `sidebar-control-name-pill.spec.ts` rests on that;
  dropping the quote from either marker would make the Channels and Chats pens count as each other,
  silently and in the green direction.

## Related

- [Edit chat dialog (rename + archive) + per-row affordance](rename-conversation-dialog.md) — the
  sibling dialog this one was split from; owns the `renameConversation` wire literal and
  `requestRenameConversation`, reused verbatim here.
- [Channel List](channel-list.md#the-rows-save-affordance-channellisttsx-added-by-274) — the row
  affordance this pen is one of.
- [Channel List — the row's hover-revealed control § #1441](channel-list-row-hover-control.md#1441-a-chats-row-now-carries-both-controls-not-one)
  — the shared `RowPenControl` shape both trees' pens draw from, and why the two keep separate class
  tokens.
- [Edit workspace dialog](edit-workspace-dialog.md) / [Edit host dialog](edit-host-dialog.md) — the
  sibling dialogs whose restated-not-shared CSS namespace rule and required-nullary-arm idiom this
  page follows.
- [Conversation rename (transport)](conversation-rename.md) — the `renameConversation` command this
  dialog dispatches, unchanged.
- Spec: `docs/specs/architecture/1476-edit-channel-dialog.md`.
