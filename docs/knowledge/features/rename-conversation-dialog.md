# Edit chat dialog (rename + archive) + per-row affordance

The shared presentation serves saved (promoted) rows in [Channel List](channel-list.md) and the
conversation-info action for chats and channels. Both open a dialog prefilled with the current
displayed title, dispatching the [`renameConversation` command](conversation-rename.md) on OK and
the [`archiveConversation` command](conversation-archive.md) on its own Archive chat button. The
dialog collects input and dispatches only; it never mutates the list — the renamed row's new title
appearing is [#275](conversation-list-store.md)'s job, reacting to the daemon's
`conversation_updated` broadcast, exactly as [Save-as-channel](save-as-channel-dialog.md)'s
promoted-row reflection already works, and an archived row leaving the active list rides the same
mechanism.

Introduced in [#360](../codebase/360.md), split from #154 (transport [#359](../codebase/359.md) /
dialog #360). Renderer-only — no new transport, IPC, store, or wire code; consumes the
`renameConversation` command #359 already shipped.

**Retitled to Edit chat, gained an Archive chat button (#1440).** The module moved from
`RenameConversationDialog.tsx` to `EditChatDialog.tsx` (`git mv`, history preserved), exporting
`EditChatDialogView`; `requestRenameConversation` **kept its name** — it owns the
`renameConversation` wire literal, and renaming the helper would drift it from the verb it sends,
where the module's own name states what the dialog *is*. The dialog's header reads **Edit chat**
(sentence case, matching every sibling dialog in this directory — Edit host, Edit workspace,
Create channel, Add workspace — against the Figma drawing's title case), and the content area
gained a left-aligned, outlined **Archive chat** button below the name field and above the footer.
The class prefix deliberately **stayed** `rename-conversation`: six specs already locate this
dialog through those tokens, and one dialog carrying two class namespaces would be worse than one
whose prefix has outlived its title. See § The archive button below, and [Conversation
archive](conversation-archive.md) for this dialog's second sender of that verb.

**Second entry point ([#368](../codebase/368.md)):** the [Channel Info sheet](conversation-shell-session-and-channel-info.md#channel-info-sheet-365)'s
Actions slot gained a pill (Figma 20:89, reading **Edit chat** since #1440 — see below; **Rename**
at the time #368 shipped it) that opens this same dialog (`EditChatDialogView`, `RenameConversationDialogView`
before #1440) and dispatches through this same `requestRenameConversation`,
imported verbatim from this module — no clone, no second dialog. The sheet's active conversation
is a `ConversationCreatedPayload` (5 fields), not a `ConversationSummary` (7 fields — adds
`is_archived`/`last_message_ts`), so it wasn't structurally assignable to the row-side caller
below without a cast. Since `requestRenameConversation` reads only `row.id`, its param was
narrowed from `ConversationSummary` to `Pick<ConversationSummary, 'id'>` (see the signature below)
— a one-line, behavior-preserving type change (the helper now states its real input) that keeps
the `ChannelList` call site valid (a full `ConversationSummary` still satisfies the narrower
`Pick`) and lets the sheet pass its payload directly, with no adapter. `requestPromoteConversation`
keeps its richer `row` type unchanged — it genuinely reads `cwd` too, so only rename widens.

## What it does

- **Channels-row entry point retired ([#1476](edit-channel-dialog.md)).** A saved (promoted) Channel
  row's own pen no longer opens this dialog. See § Channels-row entry point retired (#1476) below.
- Since [#1441](channel-list-row-hover-control.md#1441-a-chats-row-now-carries-both-controls-not-one),
  a Recent (unpromoted) discussion row carries this same pen (`aria-label="Edit chat"`, under its own
  `.channel-list__chat-edit` class token — no Figma node pins this row-level control; 19:14 is the
  dialog only) alongside its existing Save-as-channel chevron, so the two trailing controls are no
  longer disjoint by section. See that page for the geometry and the reason for the second token.
- Both entry points open the [shared Modal](modal-presentation.md) at a preferred width of
  640px, with the title **Edit chat** (**Rename** before #1440), header close button and divider,
  a filled **Channel name:** field (including for chats), and centred outlined **Cancel** / filled
  **OK** buttons. The field is prefilled from `titleFor(name)`, including the **Untitled** fallback
  for a null or blank name.
- Below the field, left-aligned above the footer, an outlined **Archive chat** button (#1440,
  Figma 487:2320) fires `archiveConversation{conversation_id}` and closes the dialog — no
  confirmation step, because an archived chat comes back through the Archive screen's Restore,
  the same reading the Channel Info sheet's own Archive already acts on.
- OK is disabled while the name is empty or whitespace-only, **or** the host is unavailable
  (`blank || !available`). Archive chat is disabled on the host-unavailable half **alone**
  (`!available`) — an empty or unchanged name field leaves it clickable, because putting a chat
  away has nothing to do with what its name field currently holds.
- Confirming OK dispatches `renameConversation{conversation_id: row.id, name: name.trim()}`
  and closes the dialog. The payload has no `cwd`, unlike `promoteConversation`.
  Cancel and the header close button dismiss without dispatching. Identity, history, folder
  and chat/channel status are preserved.
- The renamed row's new title appears later, if at all, when the daemon's `conversation_updated`
  reply triggers [#275](conversation-list-store.md)'s list re-request — there is no optimistic UI
  change here, mirroring [Save-as-channel](save-as-channel-dialog.md)'s and the
  [new-discussion FAB](new-discussion-fab.md)'s fire-and-forget posture. An archived chat's row
  leaves the active list on the same re-list, and if it was the open thread, [Paired
  shell](paired-shell.md)'s existing archived-active exit bridge leaves it — nothing new in this
  dialog navigates or writes to a store.

## How it works

The view and helper live under `src/renderer/src/screens/channels/`; `ChannelList` and
`ConversationScreen` each call both.

### `EditChatDialog.tsx` (`RenameConversationDialog.tsx` before #1440)

Two pure, SSR-testable exports:

```ts
export function EditChatDialogView(props: {
  name: string
  available?: boolean               // default true — #1440
  onNameChange: (next: string) => void
  onCancel: () => void
  onSave: () => void
  onArchive: () => void             // required, nullary — #1440, see below
}): JSX.Element

export function requestRenameConversation(
  sendCommand: (command: RendererCommand) => void,
  row: Pick<ConversationSummary, 'id'>,   // narrowed from ConversationSummary — #368
  name: string
): void
```

`EditChatDialogView` retains its fixed overlay and inert scrim, and composes
`components/Modal.tsx` with `width={640}`. Modal owns the panel, divider, close asset and
centred actions. Its React `useId()` ties `aria-labelledby` to the title; the old fixed
`RENAME_CONVERSATION_TITLE_ID` is gone. The wrapping label gives the input its accessible
name, **Channel name:**. React escapes the controlled input value.

Cancel and close both call `onCancel`; OK calls the existing `onSave` prop and is disabled
by `blank || !available`. Presentation reuse does not transfer draft, focus or dismissal
ownership to Modal. Each caller seeds the draft on every open, so reopening after Cancel
or close restores the current displayed name instead of the discarded draft.

`requestRenameConversation` is the `requestPromoteConversation` twin **minus the `cwd` field**: an
inline literal typed as `RendererCommand`, `name` trimmed before send, no redundant blank guard
(the view already gates it). Dropping `cwd` is deliberate, not an oversight —
`RenameConversationPayload` has no `cwd` field, and a stray one would fail
`isRenameConversationPayload`'s exact-shape check at the main boundary (see
[Conversation rename](conversation-rename.md)).

### The archive button (#1440)

`onArchive` is **required, not optional** — the `EditWorkspaceDialogView`/`ArchiveSlot` rule from
[Edit-workspace dialog](edit-workspace-dialog.md): a view that cannot act is a bug, so a missing
wire is a compile error rather than an inert button. It is **nullary**: the dialog is always open
against exactly one conversation whose id the container already holds, so a parameter would be a
value the caller reads straight back out of its own state. Both copy strings — the title and the
button label — live together in one module constant, `EDIT_CHAT_COPY`, in the
`ARCHIVE_WORKSPACE_COPY` idiom: both are load-bearing e2e locators, so a reader looking for "what
must never be reworded" finds both at once. No `aria-label` — the button's text is its accessible
name, and an attribute would put a client-owned string where CLAUDE.md's rule against daemon-text
attributes lives, needlessly.

Unlike [Edit-workspace dialog](edit-workspace-dialog.md)'s two-armed `ArchiveSlot`, this button has
one arm and takes no `status` prop: there is no confirmation step, since an archived chat comes
back through the Archive screen's Restore. The two callers (`ChannelList.tsx`'s sidebar dialog,
`ConversationScreen.tsx`'s `ChannelInfoSheet`) each re-check host availability at interaction time
— `canMutateHost`/`connectedConversationHostNow`, the same guard their own OK handlers use — before
sending, so a disabled attribute that lagged a disconnect can never let a click through. Both send
exactly one `archiveConversation{conversation_id}` via `requestArchiveConversation` (imported from
`ConversationScreen.tsx`, per [Conversation archive](conversation-archive.md)) and close the dialog;
the sheet's handler also closes the sheet itself, the same sequence its own pre-#1440 Archive pill
already used. `EditChatDialog.tsx` still imports nothing from `conversation/`, keeping the two
directories cycle-free (`ChannelList.tsx` already imported `requestArchiveConversation` for
[#1439](edit-workspace-dialog.md)'s workspace fan-out).

### Channels-row entry point retired (#1476)

A saved (promoted) Channel row's own pen no longer opens this dialog. [#1476](edit-channel-dialog.md)
gave it the sibling [Edit channel dialog](edit-channel-dialog.md) instead — reading **Edit channel**
rather than **Edit chat**, under its own `.edit-channel*` namespace, with no Archive chat button. The
pen's own class tokens, `.channel-list__rename` / `__rename-icon`, did **not** move — twelve specs
read them as "this row is a promoted Channels row" — only the word and the modal it opens did.

This dialog's row-level entry point is now the Chats row's pen alone
(`.channel-list__chat-edit`, since
[#1441](channel-list-row-hover-control.md#1441-a-chats-row-now-carries-both-controls-not-one)). Its
second entry point, the [Channel Info sheet](conversation-shell-session-and-channel-info.md#channel-info-sheet-365)'s
Actions pill, is **unchanged** — it still opens this dialog for the currently open conversation
whether that conversation is a chat or a channel. #1476 only retired the sidebar-row path for
Channels rows, so — until a later ticket folds the sheet's channel path over too — opening a channel
from its own sidebar row and opening the same channel from the sheet reach two different modals.

In `ChannelList.tsx`, `onRename` / `renameRow` / `renameName` below now serve the Chats tree alone;
the Channels tree's pen has its own `onEditChannel` handler and its own `editChannelRow` /
`editChannelName` pair, documented on [Edit channel dialog](edit-channel-dialog.md) rather than here.

### `ChannelList.tsx` — `Row` extension

`Row` already restructured into a flex wrapper with sibling children when
[Save-as-channel](save-as-channel-dialog.md) shipped (#274). This ticket added a second optional
sibling, `onRename?: () => void`, rendered as `.channel-list__rename` alongside (not replacing)
`.channel-list__save`, passed only to `channels.map(...)` (saved Channel rows) — at the time the
two affordance sets were disjoint by section, so a row structurally carried at most one trailing
button. [#1441](channel-list-row-hover-control.md#1441-a-chats-row-now-carries-both-controls-not-one)
ended that: the bare `onRename` became a `pen?: RowPenControl` object carrying its own label and
class tokens, and `discussions.map(...)` (Recent rows) now receives one too
(`.channel-list__chat-edit`, **Edit chat**) alongside its `onSaveAsChannel` chevron — see that page
for the current shape and why the two trees keep separate class tokens and label constants.
[#1476](edit-channel-dialog.md) split the Channels `.map`'s pen off this handler entirely — it now
carries its own `onEditChannel`, opening [Edit channel dialog](edit-channel-dialog.md) — see §
Channels-row entry point retired (#1476) above.

### `ChannelList.tsx` — container state

A second, fully independent `useState` pair alongside the existing save-as one (not shared, not
unioned into one "which dialog" state):

```ts
const [renameRow, setRenameRow] = useState<ConversationSummary | null>(null)
const [renameName, setRenameName] = useState('')
```

- `onRename={(row) => { setRenameRow(row); setRenameName(titleFor(row.name)) }}` opens the dialog
  and seeds the field from the row's displayed title in one handler — the save-as seed idiom
  repeated verbatim.
- No mutual-exclusion logic exists between the two dialogs, and none is needed: an open dialog's
  `position: fixed; inset: 0` overlay covers the whole window, so the row affordance behind it
  isn't clickable while a dialog is open — the overlay argument holds by itself, independent of
  whether a row's two trailing controls are disjoint (since
  [#1441](channel-list-row-hover-control.md#1441-a-chats-row-now-carries-both-controls-not-one)
  they no longer are, on a Chats row).
- The container returns a fragment: the list view, then both dialogs as conditional siblings —
  `saveRow && <SaveAsChannelDialog …/>` and `renameRow && connected(renameRow.serverId) &&
  <EditChatDialogView …/>`. `onCancel` clears `renameRow` (dispatches nothing). `onSave` calls
  `requestRenameConversation(window.pyry.sendCommand, renameRow, renameName)` then clears
  `renameRow`. `onArchive` (#1440) re-checks `canMutateHost(renameRow.serverId)`, calls
  `requestArchiveConversation(window.pyry.sendCommand, renameRow.id)`, then clears `renameRow` —
  no rename is sent, nothing is written to a store, and the container does not navigate.
- `window.pyry` is dereferenced only inside the `onSave`/`onArchive` closures, and the dialog is
  absent on first paint (`renameRow` starts `null`), preserving the SSR smoke test — the same
  discipline as `onSaveAsChannel`/`onNewConversation`.

### Data flow

```
Saved Channel row's Rename affordance click → container: setRenameRow(row); setRenameName(titleFor(row.name))
                                                     │
                                                     ▼
                                EditChatDialogView (controlled by renameName state)
                                   │                              │
                            Cancel/close                    OK (enabled iff non-blank)
                                   │                              │
                            setRenameRow(null)      requestRenameConversation(window.pyry.sendCommand, renameRow, renameName)
                            (dispatches nothing)          → [#359] COMMAND_CHANNEL → daemon
                                                           then setRenameRow(null)
                                                                     ⋮
                               daemon conversation_updated reply → [#275] re-requests the list
                                                                  → row's title updates in place
```

### CSS (`channels.css`)

- `.channel-list__rename`: cloned from `.channel-list__save`, including that control's
  [#1171](channel-list-desktop-row-geometry.md) redraw — icon-only, absolutely positioned at the row's
  trailing edge, invisible at rest and revealed by the row's hover or its own `:focus-visible`,
  `--color-primary` with no hover circle and no background behind the glyph.
- `.rename-conversation-overlay` keeps the fixed, full-window overlay at `z-index: 2`,
  above the sidebar's sticky controls. Its separate scrim dims the background without dimming
  the panel and has no dismissal handler.
- `channels.css` owns only the rename field and overlay. The field uses label-large emphasized,
  body-medium input text, a translucent on-primary fill and a primary focus outline.
  `components/modal.css` owns panel width, header, divider, actions and scrolling.
- `.rename-conversation__actions` (#1440): the content slot's own `Actions` frame — `display: flex`,
  left-aligned, `padding-top: var(--space-2)` (the drawing's 8px inset). `.rename-conversation__archive`
  restates the footer Cancel's outlined recipe (`.edit-host__unpair`'s, the only outlined recipe in
  this file carrying a `:disabled` arm) against the same tokens, **not shared** with it — the
  namespace rule on the [Edit-host dialog](edit-host-dialog.md) knowledge page: each dialog's slot
  must stay separately addressable from Playwright. Two of that recipe's lines are deliberately not
  carried, `max-width: 100%` and `overflow-wrap: anywhere` — they defend a long daemon-supplied host
  name, and this label is a client-owned constant of known length. Unlike
  [Edit-workspace dialog](edit-workspace-dialog.md)'s `flex-shrink: 0` (answering a wrapping prompt
  sharing a flex row with two buttons), this row holds one button and no prompt, so nothing needed
  squeezing — confirmed by a rendered capture, not derived.
- Modal constrains width to the container and viewport, and caps height with `100dvh` and
  `overflow: auto`. Header, content and footer keep their natural height so the whole panel
  scrolls in short windows; actions are not clipped by a shrinking content region.

## Edge cases and limitations

- **A rename the daemon never confirms simply leaves the row's title unchanged.** No correlation
  is surfaced to this dialog between the dispatched command and the reply (the daemon's
  `conversation_updated` reply is technically correlated by envelope, unlike promote/unarchive's
  broadcast, but desktop decodes it the same way regardless — see
  [Conversation rename](conversation-rename.md)). There is no timeout, retry, or rejection surface
  in this ticket.
- **An empty/whitespace-only name is disabled client-side only; the daemon's own trim-guard is the
  server-side backstop.** No redundant emptiness check exists beyond the OK button's `disabled`
  state (Evidence-Based Fix Selection — no observed blank-submit path to defend).
- **The Channel name field has no Enter-to-submit or autofocus-select.** Neither Rename nor
  shared Modal adds a focus trap or focus restoration. Native Tab navigation and activation
  of a focused button remain available.
- **Escape remains parent-owned.** The sidebar dialog has no Escape handler; its inert backdrop
  does not dismiss it. In conversation info, the enclosing `ChannelInfoSheet` document listener
  closes the sheet on Escape, unmounting its Rename dialog too.
- **An archive the daemon never confirms leaves the row in place** — the same answer the rename
  beside it already gives. No timeout, retry or rejection surface is added for the archive path
  either (#1440).
- **The sidebar row's own pen names itself differently per tree, from two separate constants.**
  #1440 retitled the dialog and the sheet's action word to **Edit chat**; the Channels row's own
  pen kept `Rename`/`.channel-list__rename` at that point. #1441 then gave the Chats row this same
  pen directly (no longer routed only through the conversation-info sheet's own Rename action),
  named **Edit chat** and under its own `.channel-list__chat-edit` token, so the two sidebar words
  can diverge without a shared constant. [#1476](edit-channel-dialog.md) (split from #1430) then
  retitled the Channels row's pen to **Edit channel** and pointed it at the sibling [Edit channel
  dialog](edit-channel-dialog.md) instead of this one — see § Channels-row entry point retired
  (#1476) above.
- **Static markup cannot prove event wiring or scrolling.** Static tests cover accessible
  names, shared chrome, blank validation and escaping; helper tests assert the exact trimmed
  command and target id. `e2e/conversation-create-rename.spec.ts` exercises both entry points
  with distinct conversation ids, including renaming a sidebar channel while a different chat
  stays open. It checks prefill, cancelled-draft reset, close without extra commands, keyboard
  confirmation, unchanged row metadata and retained histories. This catches a wrong-target
  rename that a single-row fixture could miss.
- **Viewport proof belongs in the browser.** The same fake spec checks a 640px panel without
  horizontal overflow at an 800px window width and scrolls focused OK into view in a short
  window. `conversation-state-fake.spec.ts` covers list reflection. These checks do not prove
  live daemon persistence; `real-daemon-rename.spec.ts` is the separate live tier.

## Related

- [Edit channel dialog](edit-channel-dialog.md) — the sibling this dialog was split from
  ([#1476](edit-channel-dialog.md)); the Channels row's own pen now opens it instead of this dialog,
  reusing `requestRenameConversation` verbatim. See § Channels-row entry point retired (#1476) above.
- [Conversation rename (transport)](conversation-rename.md) / [#359 codebase notes](../codebase/359.md)
  — the `renameConversation` command and `RenameConversationPayload` this dialog dispatches
  unchanged; this ticket is its first live caller.
- [Save-as-channel dialog](save-as-channel-dialog.md) / [#274 codebase notes](../codebase/274.md)
  — the original precedent for the `Row` sibling-affordance shape and the
  `position: fixed`/`z-index` overlay precedent this ticket reused without re-deriving.
- [Channel List — the row's 8px inset and its hover-revealed control § #1441](channel-list-row-hover-control.md#1441-a-chats-row-now-carries-both-controls-not-one)
  — the Chats row's own pen into this same dialog, its geometry, and the `.channel-list__chat-edit`
  token.
- [Conversation list store](conversation-list-store.md) / [#275 codebase notes](../codebase/275.md)
  — the `conversation_updated` re-request that reflects the renamed title; this dialog never
  mutates the list itself.
- [Channel List home screen](channel-list.md) / [#141 codebase notes](../codebase/141.md) — the
  screen this affordance is added to.
- [#360 codebase notes](../codebase/360.md) — implementation summary, patterns, lessons.
- [Conversation shell](conversation-shell-session-and-channel-info.md#channel-info-sheet-365) / [#368 codebase notes](../codebase/368.md)
  — the Channel Info sheet's Rename action, this dialog's second entry point and the source of the
  `Pick<ConversationSummary, 'id'>` param widening.
- [Shared Rename modal spec](../../specs/architecture/1352-rename-modal.md) — current presentation.
- [Conversation archive (transport)](conversation-archive.md) — the `archiveConversation` command
  the Archive chat button dispatches; this dialog is its second sender, beside the Channel Info
  sheet's own Archive pill.
- [Edit-workspace dialog](edit-workspace-dialog.md) — the archive-button idiom
  (`ARCHIVE_WORKSPACE_COPY`, the required-nullary-prop rule, the restated-not-shared CSS namespace)
  this dialog's own Archive chat button follows one dialog over (#1439).
- Spec: `docs/specs/architecture/360-rename-dialog.md` (dialog); `docs/specs/architecture/368-channel-info-rename-action.md` (second entry point); `docs/specs/architecture/1440-edit-chat-dialog.md` (Edit chat retitle + Archive chat button).
