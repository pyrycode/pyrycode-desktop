# 1440 — the Rename dialog becomes Edit chat, with an Archive chat button

## Files read

- `src/renderer/src/screens/channels/RenameConversationDialog.tsx` → `RenameConversationDialogView`,
  `requestRenameConversation` — the module this ticket renames and extends. Its `blank || !available`
  disabled expression is the one AC3 splits in half.
- `src/renderer/src/screens/channels/RenameConversationDialog.test.tsx` — the static-markup twin that
  moves with the module; its `renderView` helper gains the new required prop.
- `src/renderer/src/screens/channels/ChannelList.tsx` → the `renameRow` / `renameName` pair, `canMutateHost`,
  the `connected(renameRow.serverId)` mount gate, and the already-present `requestArchiveConversation`
  import (`#1439` took it for the workspace fan-out) — the sidebar entry point's container.
- `src/renderer/src/screens/channels/EditWorkspaceDialog.tsx` → `EditWorkspaceDialogView`, `ArchiveSlot`,
  `ARCHIVE_WORKSPACE_COPY` — the same button one dialog over, shipped last week. The copy-constant idiom,
  the "pattern shared, markup not" rule, and the no-`aria-label` rule all come from here.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ChannelInfoSheetView` (the Actions
  slot's three pills), `ChannelInfoSheet` (the `renameOpen` / `renameName` pair, `onArchive`'s
  send-then-close sequence), `requestArchiveConversation`, `connectedConversationHostNow`,
  `useConversationActionAvailability` — the sheet entry point, and the source of the `available` prop.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → the `ChannelInfoSheetView`
  Actions-slot describe block — four assertions naming the sheet's **Rename** pill.
- `src/renderer/src/screens/channels/channels.css` → `.rename-conversation-overlay` … `__input`
  (the tokens that must not move) and `.edit-host__actions` / `.edit-host__unpair` (the recipe
  AC-1's button restates, and the only outlined-button recipe in this file carrying a `:disabled` rule).
- `docs/knowledge/features/rename-conversation-dialog.md` — records that the dialog *dispatches only*
  and never mutates the list; the archive button inherits that posture rather than inventing one.
- `docs/knowledge/features/conversation-archive.md` — the `archiveConversation` wire path and its
  broadcast-not-correlated reply; this ticket adds a second sender to an unchanged transport.
- `e2e/conversation-create-rename.spec.ts` — drives BOTH entry points against the stateful fake and
  already captures `archive_conversation` in its `mutations` array. The home for AC5's archive checks.
- `e2e/offline-conversation-actions.spec.ts` — holds this dialog open across a disconnect and asserts
  OK goes disabled; the home for AC3's interactive arm.
- `e2e/conversation-state-fake.spec.ts`, `e2e/real-daemon-rename.spec.ts` — the other two specs naming
  the dialog **Rename**. `e2e/conversation-archive-lifecycle.spec.ts` drives the sheet's own Archive
  with `exact: true`, so `Archive chat` cannot collide with it and it needs no edit.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=487-2320
(shared Modal: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=489-1942)

A dark 640px panel on a 6px radius: title-large header reading **Edit Chat** beside the round close
glyph, a 60%-opacity inverse-primary divider, then the content column — the label-large-emphasized
**Channel name:** caption over the translucent filled input, and below it an `Actions` frame at the
content slot's left edge with an 8px top inset holding one **outlined** `Button` reading **Archive
chat**: a 1px `schemes/primary` border, transparent fill, primary body-large-emphasized text, 19×7px
padding — the footer Cancel's recipe exactly. The centred footer keeps outlined Cancel and filled OK.

Rendered in **sentence case, "Edit chat"**, against the drawing's title case: every sibling in
`channels.css`'s dialog family already renders sentence case (Edit host, Edit workspace, Create
channel, Add workspace), and the ticket states this reading explicitly.

## Context

A chat's name and its put-away live in two different places today: the name in a dialog titled
**Rename**, the archive as a pill in the Channel info sheet that the sidebar has no equivalent of at
all. A host, a workspace and a channel each already have one **Edit** modal holding both. This is the
chat's. It is renderer-only: the `archiveConversation` command, its main-side dispatch and its wire
type all shipped in #363 and are untouched here — this ticket adds a second *sender*.

Channels leave this dialog through #1430/#1431; until they land a channel row's pen still opens it,
which the ticket accepts. The sidebar row's pen keeps its `Rename` accessible name and its
`.channel-list__rename` tokens — #1441 and #1430 own those, both sequenced after this.

No ADR is warranted: this ticket makes no decision the Edit host and Edit workspace dialogs have not
already made twice.

## Design

### The module rename

`RenameConversationDialog.tsx` → `EditChatDialog.tsx` via `git mv` (history preserved), exporting
`EditChatDialogView`. Its test file follows. `requestRenameConversation` **keeps its name**: it owns
the `renameConversation` wire literal, and renaming the helper would drift it from the verb it sends
while buying nothing — the module's name states what the dialog *is*, the helper's what it *sends*.

Three importers update: `ChannelList.tsx`, `ConversationScreen.tsx`, and the test file itself.

### The class tokens do NOT move

`.rename-conversation-overlay`, `__scrim`, `__field`, `__label`, `__input` stay exactly as they are —
six specs locate through them, and the CSS comment block above them is cited by three sibling
dialogs. The new pair extends the same prefix rather than opening an `edit-chat` namespace: one
dialog with two class prefixes is worse than one dialog whose prefix is older than its title.

### The view

`EditChatDialogView` gains one required prop beside `onSave` and `onCancel`:

```ts
onArchive: () => void
```

Required, not optional, and nullary — the `EditWorkspaceArchive` rule: a view that cannot act is a
bug, so a missing wire is a compile error rather than an inert button; and the dialog is open against
exactly one conversation the container already holds, so a parameter would be a value the caller
reads straight back out of its own state.

The button renders **inside the Modal's content slot, after the `<label>`**, in a
`.rename-conversation__actions` row holding a single `.rename-conversation__archive` button. Unlike
`EditWorkspaceDialogView`'s `ArchiveSlot` this needs no extracted sub-component and no status prop:
there is one arm, not two. `EditWorkspaceArchiveStatus` has no counterpart here because there is no
confirmation step — an archived chat comes back through the Archive screen's Restore, which is the
same reading the Channel info sheet's own Archive already acts on.

The button's text is its accessible name. No `aria-label`, and no conversation name in one: that
would put daemon-authored text into an attribute, which CLAUDE.md forbids outright.

Copy lives in one module constant in the `ARCHIVE_WORKSPACE_COPY` idiom — client-owned, apostrophe-free:

```ts
const EDIT_CHAT_COPY = { title: 'Edit chat', archive: 'Archive chat' } as const
```

Both strings are load-bearing e2e locators, so they sit together where a reader looking for "what can
never be reworded" finds both at once.

### The disabled arm

```
OK:           disabled = blank || !available
Archive chat: disabled = !available
```

AC3's whole content: the `available` half alone, never the blank half. An empty or unchanged name
field leaves Archive chat clickable, because putting a chat away has nothing to do with what its name
field currently holds. `available` keeps its `= true` default, so the sidebar caller — which unmounts
the dialog outright on disconnect — is unchanged.

### The two containers

| | sidebar (`ChannelList`) | sheet (`ChannelInfoSheet`) |
|---|---|---|
| gate | `canMutateHost(renameRow.serverId)` | `connectedConversationHostNow(conversation.id) !== null` |
| send | `requestArchiveConversation(window.pyry.sendCommand, renameRow.id)` | same, with `conversation.id` |
| close | `setRenameRow(null)` | `setRenameOpen(false)` then `onClose()` |

Both re-check availability **at interaction time**, as their OK handlers do, and dereference
`window.pyry` only inside the callback, never during render. The sheet closes itself as well, which
is what its own Archive pill already does.

`ChannelList` already imports `requestArchiveConversation` from the conversation screen, so the
sidebar handler binds an existing symbol and `EditChatDialog.tsx` still imports nothing from that
directory — the two stay cycle-free.

### The sheet's action word

`ChannelInfoSheetView`'s first Actions pill reads **Edit chat** instead of **Rename**. Its `onRename`
prop keeps its name (it still opens the rename-capable dialog and the sheet's Archive/Delete props sit
beside it unchanged); only the rendered word moves. #1431 owns the channel case.

### CSS (`channels.css`)

Two new rules beside the existing `.rename-conversation__input`:

- `.rename-conversation__actions` — the content slot's `Actions` frame: `display: flex`,
  `align-items: center`, `padding-top: var(--space-2)` (the drawing's 8px inset), left-aligned by
  default. Identical in effect to `.edit-host__actions` / `.edit-workspace__actions` and **restated,
  not shared** — the namespace rule on the Edit host dialog knowledge page, whose reason is that each
  dialog's slot must stay separately addressable from Playwright.
- `.rename-conversation__archive` — the footer Cancel's outlined recipe against the same tokens, the
  way `.edit-host__unpair` states it, **plus** its `:disabled` / `:enabled:hover` / `:focus-visible`
  arms, because this button really does disable. Two lines of that recipe are deliberately NOT
  carried: `max-width: 100%` and `overflow-wrap: anywhere` defend a long daemon-supplied HOST NAME,
  and this label is a client-owned constant of known length. #1439's `flex-shrink: 0` is not carried
  either, for the same evidence rule: that finding came from a wrapping prompt *sharing a flex row
  with two buttons*; this row holds one button and no prompt, so there is nothing to squeeze it. The
  rendered capture below is what confirms that rather than the reasoning.

Every value is a token. No hex literal, no magic number.

## State and concurrency model

None added. No store slice, no async task, no subscription, no cancellation path: the send is
fire-and-forget through `sendCommand` (returns `void`), and the dialog closes in the same tick, so
there is no in-flight state to represent and no second click to race — the button is unmounted before
one could land. The container state that already exists (`renameRow` / `renameOpen`) is the only
state involved, and the archive handler clears it exactly as the save handler does.

Nothing is written to any store and nothing navigates. Two existing mechanisms do the rest, both
unchanged: the row leaves the active list on the daemon's `conversation_updated` re-list, and when the
archived chat is the one on screen, `PairedShell`'s `useArchivedActiveConversationExit` leaves the
thread on the daemon's word.

## Error handling

No new failure mode and no new result type — this ticket adds no I/O boundary. The one hazard is a
send against a host that went away while the dialog sat open, and it is closed the way every sibling
closes it: a re-check at interaction time (`canMutateHost` / `connectedConversationHostNow`) that
returns before the send, backed by the `disabled` attribute so the click is not offered in the first
place. A disabled button that is nonetheless dispatched (Playwright's `dispatchEvent`) still sends
nothing, because the guard is in the handler, not in the attribute.

An archive the daemon never confirms leaves the row in place — the same answer the rename beside it
already gives. No timeout, retry or rejection surface, and no logging added: this is a renderer
interaction, and the logging obligation sits on the transport path that already carries it.

## Testing strategy

**Static (vitest, `renderToStaticMarkup` — no DOM, no clicks).**

- `EditChatDialog.test.tsx`: header reads `Edit chat` and no longer `Rename`; the shared modal chrome,
  640px width, `Channel name:` field and Cancel/OK assertions carry over unchanged; the archive button
  renders with `.rename-conversation__archive` and the exact text `Archive chat`; it is NOT disabled
  when `available` is defaulted or true **even with a blank name** (AC3's whole point, asserted at
  `name=''` so the OK-disabled and Archive-enabled arms are proved in one render); it IS disabled at
  `available={false}`; no `aria-label` is emitted on it.
- `ConversationScreen.test.tsx`: the sheet's first Actions pill reads `>Edit chat</button>`; the three
  absent-pill assertions swap their `Rename` needle for `Edit chat`.

**Interactive (Playwright, fake transport).**

- `e2e/conversation-create-rename.spec.ts` — a new `archives` capture beside `renames`, then, appended
  to the existing drive where both entry points and both identities are already on screen: open the
  dialog from the sidebar pen and **Cancel** it (nothing sent); reopen and click Archive chat →
  dialog closes, exactly one `archive_conversation` carrying `SEED.id`; then open the Channel info
  sheet on the open chat, click **Edit chat**, click Archive chat → dialog and sheet close and the
  thread exits (`.conversation` → 0, the existing archived-active bridge), with exactly one
  `archive_conversation` carrying `created-1`. `mutations` pins that nothing else went out.
- `e2e/offline-conversation-actions.spec.ts` — AC3's interactive arm, in the drive that already holds
  this dialog open across a disconnect: Archive chat goes disabled alongside OK, and a
  `dispatchEvent('click')` on it adds nothing to the spec's existing `commands: []` assertion.
- `e2e/conversation-state-fake.spec.ts` — the dialog's role name, twice.

**Live tier.** `e2e/real-daemon-rename.spec.ts` names the dialog **Rename** twice and must move. It is
a `real-*` spec, so `npm run e2e` ignores it by filename; only `npm run e2e:real:gate` executes it,
and that is the MacBook dispatcher's gate, not this run's. Handed off in the PR.

**Visual.** A rendered capture of the dialog compared against the Figma node's screenshot, per
`$AGENTS_REPO_PATH/docs/visual-review.md` — static markup cannot see a squeezed or mis-inset button,
which is exactly what #1439's capture caught one dialog over.

## Documentation handoff

Pending for the documentation stage; no file under `docs/knowledge/` is edited by this ticket.

- `docs/knowledge/features/rename-conversation-dialog.md` — record the retitle to **Edit chat**, the
  **Archive chat** button and its second sender of the archive verb, and the deliberate choice to keep
  the `rename-conversation` class prefix behind the new name. If that stage renames the page, it owns
  the matching INDEX and CATALOG entries.
- `docs/knowledge/features/conversation-archive.md` — record this second sender beside the Channel
  info sheet's.

## Open questions

1. Does `.rename-conversation__actions`' single flex child need `flex-shrink: 0`? Resolved by the
   rendered capture, not by argument.
2. Does any `getByRole('button', { name: 'Archive', exact: true })` locator in the archive specs start
   matching `Archive chat`? It should not — `exact: true` forbids it — but the fake tier is what
   proves it, since a strict-mode violation would redden `conversation-archive-lifecycle.spec.ts`.

## Revisions

### 2026-09-15 — the button takes a tab stop, and two spec chains absorb it

Not a design change; a consequence of the design that the plan's Testing strategy did not name, and
that the fake tier caught rather than the static tests. `e2e/conversation-create-rename.spec.ts` pins
the dialog's keyboard walk twice — once for the chain itself, once to prove a focused OK scrolls into
view in a 180px-tall window. Archive chat sits in the Modal's **content** slot, between the field and
the footer, so document order is now input → Archive chat → Cancel → OK and both walks gained a stop.

The walks were extended, **not** routed around: that document position is the requirement, not an
obstacle. An Archive reachable only after Cancel would sit inside the dialog's answer row, which is
the opposite of what the drawing places it outside of. The first chain now asserts the new stop
explicitly so a regression that moved the button into the footer reddens by name.

### 2026-09-15 — open questions resolved

1. **No `flex-shrink: 0`.** Confirmed by the rendered capture at 1280×800: one button in a row with no
   prompt beside it has nothing to squeeze it, and the label renders on one line at the 640px panel.
   The CSS comment states the non-carry rather than leaving the omission to be re-derived.
2. **No locator collision.** `conversation-archive-lifecycle.spec.ts` passes unedited — `exact: true`
   keeps the sheet's `Archive` pill and the dialog's `Archive chat` disjoint, as expected.

### 2026-09-15 — stale citations left in place, deliberately

Four modules cite `RenameConversationDialog` **by name in comments** as an idiom they follow
(`CreateFolderDialog.tsx` and its test, `SystemPromptSection.tsx`, `WorkspacePickerSheet.tsx`). They
are historical citations of #360's shape, not code, and none of the four is otherwise in this
ticket's blast radius; editing them would put comment-only churn in four files the ticket does not
name. Left for the documentation stage, flagged in the PR body.
