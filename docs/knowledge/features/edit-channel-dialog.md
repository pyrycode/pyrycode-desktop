# Edit channel dialog

The [Channels row's own pen](channel-list.md#the-rows-save-affordance-channellisttsx-added-by-274)
opens this modal on the row's name — the first half of Juhana's 2026-09-14 ruling that a channel is
edited under its own word, never through the [Edit chat dialog](rename-conversation-dialog.md) the
row used to share with a chat. Introduced in [#1476](https://github.com/pyrycode/pyrycode-desktop/issues/1476),
split from [#1430](https://github.com/pyrycode/pyrycode-desktop/issues/1430). [#1477](https://github.com/pyrycode/pyrycode-desktop/issues/1477)
added the **Channel system prompt:** field under the name, which is what makes this modal the one
place Juhana's ruling asks for — see [§ The system prompt field](#the-system-prompt-field-1477)
below. [#1438](https://github.com/pyrycode/pyrycode-desktop/issues/1438) added the outlined
**Archive channel** button drawn below the field in Figma — see
[§ The archive button](#the-archive-button-1438) below. (Filed as *Remove channel*; lettered
**Archive channel** on the drawing and settled that way by the refiner on 2026-09-15, matching the
sibling chat dialog's **Archive chat** and the fact that the channel lands in the Archive screen's
Channels tab and Restore brings it back.) Every one of these extends this page and this file rather
than adding a sibling.

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
  row's displayed title (`titleFor(row.name)`, including the **Untitled** fallback), a **Channel
  system prompt:** label over a filled, borderless text area (below), an outlined **Archive channel**
  button in the content area itself — left-aligned below the text area, above the footer — and
  centred outlined-Cancel / filled-OK actions. That button is not the chat dialog's **Archive chat**:
  different word, different namespace (`.edit-channel__archive`, never `.rename-conversation__archive`),
  and this dialog still inherits nothing from its sibling — see
  [§ The archive button](#the-archive-button-1438).
- OK is disabled on a blank (or whitespace-only) name, and additionally on a system prompt over
  `MAX_SYSTEM_PROMPT_BYTES` in UTF-8 bytes. **It is never disabled by an outstanding system-prompt
  read** — see [§ The system prompt field](#the-system-prompt-field-1477). On a non-blank,
  under-bound state it sends `renameConversation` **only when the trimmed field differs from the
  title it was seeded with** — so OK on an untouched unnamed row sends nothing rather than naming
  that channel `Untitled`, and an edit that only adds edge whitespace also sends nothing — and
  separately sends the prompt write only on its own difference rule, below. Both Cancel and the
  header close send nothing at all. Either way the dialog dismisses; an unchanged field is a no-op,
  not a refusal, and the next open re-seeds both fields fresh rather than the abandoned draft.
- The dialog closes if the row's host stops being connected — the render gate re-evaluates on every
  paint, and the existing `sessionStore.subscribe` effect clears the held row a beat later. The
  conversation title and the system prompt are both daemon-authored and reach a controlled input or
  textarea and nothing else: never an attribute, never markup, never a log.

## How it works

### `EditChannelDialog.tsx` (new module)

One pure, SSR-testable export, in [`EditChatDialogView`](rename-conversation-dialog.md)'s shape
**minus the archive arm and minus `available`**, and since [#1477](https://github.com/pyrycode/pyrycode-desktop/issues/1477)
carrying a `prompt` prop that mirrors the read's own sealed union so a "reading" arm cannot show a
draft it does not have:

```ts
export type EditChannelPrompt =
  | { state: 'reading' }
  | { state: 'read'; value: string; overLimit: boolean; onChange: (next: string) => void }

export function EditChannelDialogView(props: {
  name: string
  prompt: EditChannelPrompt
  onNameChange: (next: string) => void
  onCancel: () => void
  onSave: () => void
}): JSX.Element
```

It renders `.edit-channel-overlay` + an inert `.edit-channel-overlay__scrim` around `<Modal
title="Edit channel" width={640} cancelAction={…} confirmAction={{ label: 'OK', onClick: onSave,
disabled: name.trim() === '' || (prompt.state === 'read' && prompt.overLimit) }}
onClose={onCancel}>`, whose content slot holds two `.edit-channel__field` labels: the name field
(`.edit-channel__label` **Channel name:** over `.edit-channel__input`), and the prompt field below
it (**Channel system prompt:** over a `.edit-channel__textarea`, 4 rows). Both reading and
over-limit lines render *outside* their wrapping label, so neither joins the field's accessible
name — `ChannelForm`'s stated rule, restated here rather than imported (see below).

**No `available` prop** — and [#1438](https://github.com/pyrycode/pyrycode-desktop/issues/1438)
answered that forecast "no" rather than adding one when it shipped the second button. That prop exists
on `EditChatDialogView` because [#1440](rename-conversation-dialog.md)'s Archive chat sits in the
*gap* between two buttons' disabled expressions — OK reads `blank || !available`, Archive chat reads
`!available` alone. #1438's Archive channel button removes the gap outright by carrying no disabled
arm of its own: it stays live on a blank name and while the prompt read is still outstanding, because
those are OK's conditions and not its. With no disabled expression there is nothing for `available` to
feed, and a second render-time host authority could only disagree with the interaction-time re-check
that already guards the send — see [§ The archive button](#the-archive-button-1438). The host guard
stays the container's pair: the render gate on `connected(...)`, plus each caller's own live re-check
at interaction time.

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

### The system prompt field (#1477)

The modal opens from **any** row, not only the open conversation, so it cannot read
[`systemPromptStore`](system-prompt-store.md): that store holds only the open chat's reading, and
`subscribeSystemPrompt` beside it drops every reply whose `conversationId` isn't the open one — the
whole reason this modal asks and subscribes for itself rather than reusing that helper.
[`translateSystemPrompt`](system-prompt-store.md) **is** reused, being React-free and arm-scoped.

`EditChannelDialog` (new, exported beside the view) is a container in the `CreateChannelDialog`
shape, mounted by `ChannelList` only while `editChannelRow` is non-null — so **its subscription's
lifetime is the dialog's open lifetime**, and a reopen mints a fresh instance with no reset code to
write. On mount it subscribes to `window.pyry.onDaemonEvent` *before* calling
`requestSystemPrompt(window.pyry.sendCommand, conversationId)` — one shot per open, never a retry,
no `connected`-edge refresh. Each event is gated, on the raw event before the translator: first
`event.serverId !== serverId` (the row's host, the `CreateChannelDialog` idiom of checking main's own
stamp before flattening), then, for a `systemPromptReceived`, `event.conversationId !== conversationId`
(the row's id, `subscribeSystemPrompt`'s own gate with the open-conversation compare swapped for this
row). Both sides of the second gate are client-owned — the row's id came from this app's own list,
the reply's is resolved in main from the request this app sent — never parsed off the network.

The read and the draft live in one state cell, a sealed union with no shared "value" field:

```ts
type PromptState =
  | { type: 'reading' }
  | { type: 'read'; seed: string; draft: string }
```

The `reading` arm carries **no draft field at all**, which is what makes "a modal whose reading
never arrived sends nothing whatever it shows" a type-level fact rather than a guard someone has to
remember. `seed`/`draft` are both seeded through `seedFrom`, `SystemPromptSection`'s `seedFor`
spelling restated: an explicit `systemPrompt === undefined ? '' : systemPrompt`, never `?? ''` and
never a truthiness read, so an **absent** prompt and an explicitly **empty** one both seed an empty
box (they're indistinguishable to the operator) while the tri-state itself survives to the write
rule below. Seeding happens **only while the cell is still `reading`** — first matching reply wins,
so a duplicate or late second reply can never clobber a draft the operator has already started.
`sessionPromptStatus`, which rides along on the same reply, is read and dropped: the "differs from
session" notice belongs to `SystemPromptSection`, which has a New-session control to point at, and
this modal has nothing to do with it.

**OK is never withheld on the read.** The filed shape asked for OK disabled until the reading
arrived; the shipped shape refuses that, on three counts recorded in
[§ Lessons learned](#lessons-learned) — see there before changing this. The box itself is
`disabled` (not `readOnly`, also recorded there) and shows a client-owned reading line
(`SYSTEM_PROMPT_READING`) until the reply lands, then becomes an editable, seeded textarea. Both the
reading line and the over-limit notice (`SYSTEM_PROMPT_OVER_LIMIT`, gated on `MAX_SYSTEM_PROMPT_BYTES`)
are module constants that **restate** `SystemPromptSection`'s and `ChannelForm`'s wording rather
than import it — that module is sheet-scoped and drags two stores and the write bridge into the
graph; only the numeric bound (`MAX_SYSTEM_PROMPT_BYTES`, checked through `CreateChannelDialog`'s
exported `systemPromptOverLimit`) is shared, so the two byte gates cannot disagree.

**The write**, `promptWriteFor(state: PromptState): { prompt: string | null } | null` — pure and
exported so the whole rule is provable without a DOM, since no renderer spec in this repo can click:
a cell still `reading` sends nothing (there's no draft); a draft equal to the seed sends nothing
(covers both an untouched box and a box empty before and after); an **emptied** box sends `null` to
clear; anything else sends its text verbatim and untrimmed, because the value round-trips to the
daemon as a write and normalising it here would silently change what the operator stored. This
diverges from [`SystemPromptSection`](conversation-shell-session-and-channel-info.md#system-prompt-section-1078),
whose docblock rules that a clear is a control the operator presses and never inferred from an empty
box — deliberate, since that section has a Save and a Clear and this modal has one OK, so an emptied
box is the only spelling a clear has here. The one consequence is accepted: this modal cannot store
an explicitly empty `''`, only `null`, and the two are indistinguishable in the box anyway.

The write goes through [`submitSystemPrompt`](system-prompt-write-store.md) with a deliberately
empty `catch` around the `sendCommand` call — `CreateChannelDialog`'s `writePrompt` ruling verbatim:
an exception escaping would abort the caller's dismissal and carry the prompt onto an error path
this file doesn't control, and the in-flight marker is swept by the write store's `reconnected` arm
regardless. The container writes nothing into `systemPromptStore`, but when the edited row *is* the
open conversation, the app-level subscriber matches the same reply independently and stores it —
harmless and expected, not something to guard against.

**Nothing on this path logs, on any branch.** Both drop arms return silently — a diagnostic on
either would have to carry a conversation id to be useful, and would imply a prompt's existence —
and the container adds no `sendDiagnostic` of its own, unlike `CreateChannelDialog`: the id, the
prompt and its length are all forbidden here. For the same reason this file must never switch
exhaustively over `DaemonEvent`: an `assertNever` guard would `JSON.stringify` the whole event into
an `Error` message, which for this arm is the operator's prompt text on a path that can reach a
console or a crash reporter. Reusing `translateSystemPrompt`'s `default: null` is how that bound is
inherited rather than re-derived.

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

The render gate that mounts the dialog widened, [#1477], from `connected(editChannelRow.serverId)`
to `typeof editChannelRow.serverId === 'string' && connected(editChannelRow.serverId)` —
behaviour-identical, since `connected` already answers `false` for a non-string, and present only so
`serverId` narrows to `string` for the container's props without a `!` or an `as`. The view prop
underneath it changed from `EditChannelDialogView` to the new container, `EditChannelDialog`, which
takes `conversationId`/`serverId` alongside the same `name`/`onNameChange`/`onCancel` and an `onSave`
whose shape changed (below).

**The save callback's conditions, in order (`onSave: (writePrompt: () => void) => void`, [#1477]):**

1. `canMutateHost(editChannelRow.serverId)` — a **live** `sessionStore` read, taken at interaction
   time. This is the only disabled-arm this dialog's OK has: unlike `EditChatDialogView`'s
   `available` prop, nothing in the render makes OK dead when the host drops mid-dialog, so this line
   is what stands between a disconnect and a send.
2. `writePrompt()` — the container's own prompt-write decision (`promptWriteFor`, above), run only
   from inside this guard. The container hands its write in as a parameter rather than calling
   `canMutateHost` itself, because exporting that check out of `ChannelList` for the container to
   import would have closed an import cycle (`ChannelList` already imports this module). The
   parameter shape is strictly stronger than an export would have been: the write is unreachable
   except from inside the guarded body, and the refusal path still emits exactly one
   `sidebar-mutation` diagnostic rather than two.
3. `editChannelName.trim() !== titleFor(editChannelRow.name)` — only then does
   `requestRenameConversation(window.pyry.sendCommand, editChannelRow, editChannelName)` fire, on its
   own comparison, independent of whatever the prompt write just decided — including while the
   prompt's own read is still outstanding.

Dismissal (`setEditChannelRow(null)`) happens unconditionally after, on every path — an unchanged
field sends nothing for that field alone, it never refuses to close.

[#1477]: https://github.com/pyrycode/pyrycode-desktop/issues/1477

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

[#1477] added `.edit-channel__textarea` with its `:focus-visible` and `:disabled` arms, plus
`.edit-channel__notice` and `.edit-channel__reading`, restating `.create-channel__textarea` /
`__notice` declaration for declaration under this namespace — the same locator reasoning applied to
the newer sibling. `.edit-channel__reading` takes `--color-on-surface-variant` (`SystemPromptSection`'s
own empty-state colour) rather than the notice's `--color-error`: it reports progress, not a
failure.

### The archive button (#1438)

`ARCHIVE_CHANNEL_LABEL`, a module constant reading **Archive channel** — client-owned, apostrophe-free,
interpolating neither the channel's name nor its id, and the button's accessible name (no `aria-label`,
which would put a string into an attribute). It is disjoint from `EDIT_CHAT_COPY.archive` (**Archive
chat**) only from its fifth-from-last character on, the same razor-thin margin `Edit chat` / `Edit
channel` already keep on the two rows' pens; both dialogs' specs assert the two literals apart on
exactly that.

`EditChannelDialogView` renders it last in the Modal's content slot, under `.edit-channel__actions` /
`.edit-channel__archive` — the drawing's `Actions` frame, below the text area and its two notice lines,
above the centred footer. **It carries no `disabled` arm on any branch.** OK's two conditions (a blank
name, a prompt past the byte bound) are OK's alone: putting a channel away has nothing to do with what
either field currently holds, so the button stays live on a blank name and while the prompt read is
still outstanding. This is what let the `available` forecast above be answered "no" — see there.

The prop carrying its effect, `onArchive: () => void`, is **required** on both `EditChannelDialogView`
and the `EditChannelDialog` container (the `EditWorkspaceArchive` rule the chat dialog already
restates: a view that cannot act is a bug), and **nullary** (the dialog is open against exactly one
conversation, whose id every caller already holds). The container forwards it verbatim, taking no
guard, no send and no log of its own — those stay with each caller, because the two mount sites
re-check different halves of the same question and the container is in no position to choose between
them.

**The container has two mount sites, and both wire `onArchive` — a required prop makes a mis-wire a
compile error at both rather than an inert button on one:**

- **`ChannelList.tsx`** (the sidebar pen) — `canMutateHost(editChannelRow.serverId)`, then
  `requestArchiveConversation(window.pyry.sendCommand, editChannelRow.id)`, then
  `setEditChannelRow(null)`. `editChannelRow` is the same captured cell the rename arm above it reads,
  which is what makes "the row the modal was opened on, never whichever conversation the chat pane
  holds" true by construction rather than by a check — the modal opens from *any* row, so the two are
  routinely different conversations. `requestArchiveConversation` was already imported for the chat
  dialog's own Archive chat and [#1439](edit-workspace-dialog.md)'s workspace fan-out, so this adds no
  command literal and no wire type.
- **`ConversationScreen.tsx`**'s `ChannelInfoSheet` (the Channel info sheet's edit pill for a promoted
  channel, the second mount site [#1431](https://github.com/pyrycode/pyrycode-desktop/issues/1431) gave
  this container — see below) —
  `connectedConversationHostNow(conversation.id)`, the same send, then `setRenameOpen(false)` **and**
  `onClose()`, dismissing the sheet as well as the dialog — a sheet left standing describes a row on its
  way out. This mount site was not in the ticket's own file estimate; it exists because the container
  already had two callers as of #1431, and a required prop makes both compile-time callers rather than
  one by choice.

Neither caller calls `writePrompt()` on this path — a deliberate omission, not an oversight: the
system-prompt draft is operator-authored text that #1477's own docblock treats as possibly holding a
pasted credential, and it must not ride out on a click that promised to send nothing else. It simply
dies with the container's unmount. AC2's `set_system_prompt`-absent assertion, and the equivalent
`rename_conversation`-absent assertion, both pin this at the e2e tier — see
[§ Edge cases](#edge-cases-and-limitations) below.

`channels.css`'s `.edit-channel__actions` / `.edit-channel__archive` restate
`.rename-conversation__actions` / `__archive` declaration for declaration under this namespace — the
same locator ruling the block header states twice. One rule is deliberately **not** carried: the
sibling's `:disabled` arm, since this button has no disabled state to select.

## Edge cases and limitations

- **A rename the daemon never confirms simply leaves the row's title unchanged** — the same answer
  the Edit chat dialog gives (see [its own edge cases](rename-conversation-dialog.md#edge-cases-and-limitations)).
  No timeout, retry or rejection surface exists here either.
- **No length bound on the name.** The daemon-supplied name reaches a controlled input with no
  `maxlength`, unchanged from the `.rename-conversation__input` this restates — a layout question,
  not a trust one, and out of scope for this ticket.
- **Opening the same channel through the Channel Info sheet now reaches this same dialog too**, as of
  [#1431](conversation-shell-session-and-channel-info.md#channel-info-sheet-365). The sheet's Actions
  pill (`ChannelInfoSheet` in `ConversationScreen.tsx`) splits on `conversation.is_promoted`, the same
  field this page's own row split reads: a promoted channel reads **Edit channel** and mounts this
  container for the conversation's id, displayed name and resolved server; anything else keeps
  **Edit chat** and `EditChatDialogView`, Archive chat button included. The sheet supplies the host
  condition itself (`serverId !== null && available`, resolved at render time) rather than this
  dialog gaining an `available` prop — see the `available` discussion above, unchanged by this second
  mount site. The sheet's save order restates this file's own (`ChannelList.tsx`'s) order — a live
  `connectedConversationHostNow` re-check, the prompt write, then the rename — but the sheet's rename
  has always sent unconditionally, so its arm has no unchanged-name no-send; that comparison stays a
  `ChannelList`-only refinement. Two entry points now reach one dialog: the Channels row's own pen
  (`ChannelList.tsx`) and, for a promoted channel only, the Channel Info sheet's edit pill. A chat
  (non-promoted) opened from the sheet still reaches Edit chat, not this dialog — #1431 did not touch
  that arm. See [Conversation shell — session boundaries and channel info § Rename
  action](conversation-shell-session-and-channel-info.md#channel-info-sheet-365) for the sheet-side
  half of this split. [#1438](https://github.com/pyrycode/pyrycode-desktop/issues/1438)'s Archive
  channel button reaches both entry points the same way — see
  [§ The archive button](#the-archive-button-1438) — because the prop carrying it is required, so both
  mount sites had to wire it at compile time rather than one growing a button the other lacks.
- **An archive the daemon never confirms simply leaves the row in place** — the same answer the Channel
  info sheet's own Archive and the Edit chat dialog's Archive chat give. There is no busy state and no
  failure line: the archive is a one-way command with no invoke result, so there is nothing to await and
  no arm to wait in.
- **A reply that never comes leaves the box unreadable indefinitely.** There is no timeout, retry or
  error frame on the read — `SystemPromptSection`'s own accepted posture for this reply-only frame,
  inherited rather than re-decided. A malicious or slow relay that withholds `system_prompt` leaves
  OK live (name-only edits still work) and the box disabled with the reading line up; no hang, no
  spin, no plaintext leak.
- **The row's id is daemon-asserted**, same as every rename in this file: a hostile or impersonating
  daemon that picks its own conversation id could in principle direct a prompt write at a conversation
  of its choosing. No client-side compare of a field that same party supplies can prevent that; it is
  the shipped exposure of the rename path too, not something #1477 widened.
- **Static markup cannot prove event wiring, and cannot click at all.** `EditChannelDialog.test.tsx`
  covers accessible names, the header word (**Edit chat** and **Rename** both asserted *absent*, not
  merely unmentioned — five e2e specs locate this dialog by role name), the seeded field, OK's disabled
  state (including that it is **not** disabled by a `reading` prompt — a pinned regression assertion),
  the Archive channel button's copy, placement, namespace and the *absence* of any `disabled` arm on
  any branch (AC1), that it stays disjoint from **Archive chat** and the `.rename-conversation*`
  namespace (AC2), an over-limit prompt disabling OK independently of the name, an `undefined`- and an
  `''`-sourced seed both rendering an empty box, and escaping (a prompt containing `&`/`<` renders as
  text, never markup, never an `aria-label`). Since `renderToStaticMarkup` discards every handler and
  nothing in this repo can click, a small element-tree walk (`archiveButtonProps`, recursing through
  `props.children` — including through `Modal`'s unrendered `children` prop) is what proves `onArchive`
  is *bound* rather than merely drawn, invoking it and asserting `onSave`/`onCancel` stay silent. The
  open → type → OK → dismiss transition, the unchanged-field no-send, the reopen-from-fresh-ask, the
  host-loss close and the click itself all belong to Playwright: `edit-channel-system-prompt` (the ask
  on open, the seed, prompt-only, clear, both together, no-change-sends-nothing, a wrong-conversation
  reply seeding nothing, and — a second `test()` — the sidebar's Archive channel click naming the row it
  opened on while a separate conversation stays open, `mutations` empty, the row gone from the sidebar),
  `conversation-create-rename` (the pinned Tab walk, now three stops: input → Archive channel → Cancel
  → OK), plus the unchanged `conversation-state-fake`, `sidebar-offline-mutations`,
  `sidebar-control-name-pill`, `sidebar-row-geometry` and (behind `npm run e2e:real:gate`)
  `real-daemon-rename`. **Not driven anywhere:** the Channel Info sheet's own Archive channel send —
  see [§ Lessons learned](#lessons-learned).

## Lessons learned

- **A retitle can delete a sibling ticket's coverage, not just move it.** [#1440](rename-conversation-dialog.md)'s
  Archive chat button had two entry points — the Channels row's pen and the Channel Info sheet. Taking
  the pen away from the chat dialog left Archive chat with one entry point, and
  `conversation-create-rename.spec.ts`'s sidebar arm of that drive had nothing on the new dialog left
  to exercise. It was deleted rather than retitled; both halves of that acceptance criterion survive
  on the sheet's own arm. The cost is real: that deleted arm was the only place proving Archive chat
  acts on *the row the control was on* rather than on *the open conversation*, since the sheet is
  always the open conversation. **#1438 re-established that assertion** when it drew this modal's own
  put-away button: `edit-channel-system-prompt.spec.ts` gained a second `test()` that seeds a promoted
  `seed-conversation` row carrying the pen beside a separately minted, *open* `created-1` chat, edits
  both fields, clicks Archive channel, and asserts the single `archive_conversation` names
  `seed-conversation`, `mutations` stays empty, and the open thread survives — the positive half of "the
  row the control was on, not the open conversation."
- **A required prop forces every mount site to compile against it, not to be driven by a test.** #1438's
  `onArchive` reached `ConversationScreen`'s `ChannelInfoSheet` as a fourth production file because the
  prop is required — correct, and exactly the point of making it required (§ above) — but the ticket's
  own testing strategy still drove only the sidebar arm. `channel-info-edit-channel.spec.ts`, the only
  spec touching that mount site, asserts which dialog the sheet opens and nothing past it; nothing at
  either tier proves the sheet's Archive channel button sends `archive_conversation`, dismisses both the
  dialog and the sheet, or withholds the rename. The verifier flagged this as a SHOULD FIX rather than a
  MUST FIX — the confused-deputy hazard the sidebar arm's dedicated test exists to catch does not apply
  here, since only `conversation.id` is ever in scope on the sheet's path — but the send itself remains
  unproven. A future change to that arm should add the drive to `conversation-create-rename.spec.ts`,
  which already opens the sheet on Edit channel for its Tab-order walk, rather than assume the sidebar
  spec's coverage reaches this mount site too.
- **Two e2e markers stayed disjoint only by their terminating quote.** `aria-label="Edit chat"` is not
  a substring of `aria-label="Edit channel"` *because* both literals carry the closing `"`. Every
  per-tree count in `ChannelList.test.tsx` and `sidebar-control-name-pill.spec.ts` rests on that;
  dropping the quote from either marker would make the Channels and Chats pens count as each other,
  silently and in the green direction.
- **A reply-only frame cannot be blocked on, however tempting the hazard looks.** #1477's filed shape
  asked for OK disabled until the system-prompt reading arrived, to stop an unanswered channel being
  saved blank over a stored value. That was refused on three independent counts:
  [`system-prompt-store.md`](system-prompt-store.md)'s own header states the invariant outright (a
  relay that withholds the frame leaves a blocked consumer blocked forever); a dialog whose only exit
  goes dead the moment it opens reads as broken; and, measurably, `conversationStateFake` answers
  `request_system_prompt` never, so a withheld OK would never enable at the default e2e tier and
  would have taken `conversation-state-fake`, `sidebar-offline-mutations` and
  `conversation-create-rename` down with it. The hazard is closed structurally instead, at zero
  runtime cost: a box disabled until the reading arrives has no draft to send, and a write rule that
  fires only on a *difference from what was read* cannot fire when nothing has been read. Read the
  read as a sealed union with a draft-less `reading` arm, not as a flag plus a nullable value, and
  this stops being a hazard to guard against and becomes a case the type system rules out.
- **`disabled` keeps a control out of the tab order; `readOnly` does not.** The system prompt field
  landed inside `conversation-create-rename.spec.ts`'s pinned two-Tab walk from the name field to OK.
  Spelling the reading gate `disabled` left that walk untouched at the fake tier, where the reply
  never arrives; a `readOnly` spelling of the same gate would have added a third stop and reddened
  it. `disabled` also suppresses React's controlled-field-without-`onChange` warning, so the arm needs
  no dead handler. Any future field added to this modal's reading-gated slot should default to
  `disabled`, not `readOnly`, unless a reason forces otherwise.
- **A wrong-conversation reply cannot be forged by editing a fake daemon's payload.** Main resolves
  each `systemPromptReceived`'s conversation from its own `in_reply_to` correlation map, never from a
  field the daemon supplies, so a spec cannot prove the attribution gate by mutating one reply's
  `conversation_id`. It needs two conversations with genuinely outstanding asks: the fake withholds
  every `request_system_prompt` answer and records each envelope id, and the spec delivers replies
  one named ask at a time. `mintChatInWorkspace` supplies the second, unpromoted conversation so it
  draws no second Channels-tree pen to collide with the strict `.channel-list__rename` locator.
- **A helper cannot be exported "upward" out of a module that imports the file exporting it.** The
  architecture plan for #1477 called for promoting `ChannelList`'s module-local `canMutateHost` to an
  export the new container could import — but `ChannelList` already imports `EditChannelDialog`, so
  the reverse import would have closed a cycle. The shipped fix passes the write **into** the guard
  instead (`onSave: (writePrompt: () => void) => void`), which is cycle-free and stronger: the write
  becomes reachable only from inside the guarded body, rather than resting on every future caller
  remembering to check first. Recorded in the ticket's `## Revisions`; the general shape — hand the
  privileged action *into* the guard as a callback rather than exporting the guard outward — is
  worth reaching for whenever a plan's fix would create a back-edge between two modules already
  connected the other way.

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
- [System prompt send](system-prompt-send.md) / [System-prompt store](system-prompt-store.md) — the
  `request_system_prompt` ask and `system_prompt` reply this modal's container asks and subscribes
  for itself, and `translateSystemPrompt`, reused verbatim.
- [System prompt write](system-prompt-write.md) / [System-prompt write store](system-prompt-write-store.md)
  — the `set_system_prompt` verb and `submitSystemPrompt`, which this modal's OK goes through on its
  own difference rule.
- [Conversation shell — session boundaries and channel info § System prompt section](conversation-shell-session-and-channel-info.md#system-prompt-section-1078)
  — the sheet-scoped sibling this modal's write rule deliberately diverges from (an emptied box is a
  clear here; there a clear is its own control), and whose `seedFor` spelling and loading posture
  this modal's `seedFrom` and reading arm restate.
- [Create-channel dialog](create-channel-dialog.md) — `systemPromptOverLimit` and
  `MAX_SYSTEM_PROMPT_BYTES`, imported rather than re-derived so the two byte gates cannot disagree;
  the precedent for a dialog owning its own `onDaemonEvent` subscription behind a `serverId` gate.
- Spec: `docs/specs/architecture/1476-edit-channel-dialog.md`,
  `docs/specs/architecture/1477-edit-channel-system-prompt.md`.
