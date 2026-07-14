# Spec #368 — Channel Info sheet: Rename action (reuse the rename dialog)

**Size:** S · **Security-sensitive:** no (renderer-contained; no transport/IPC/wire — the
`renameConversation` command it dispatches was already wired end-to-end by #359, and the dialog it opens
already ships from #360). **Split from #155.** Adds a **second entry point** to rename — a Rename action
in the Channel Info sheet's Actions slot — reusing #360's dialog and dispatch helper verbatim. Sibling
downstream tickets #366 (Archive) / #367 (Delete) fill the same slot with their own actions.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-89

Node 20:89 "Rename" is a full-width Material 3 **tonal pill button** inside the sheet's Actions section
(20:85): `--color-secondary-container` fill, `--color-on-secondary-container` label, fully-rounded
(`--radius-full`), label-large text, centered, ~16px horizontal / ~10px vertical padding. Activating it
opens the existing Rename dialog (Figma 19-14, #360) — the outlined Name field prefilled with the current
title, Cancel + Save.

## Files to read first

- `src/renderer/src/screens/conversation/ConversationScreen.tsx:854-954` — `ChannelInfoSheetView` (pure,
  exported) + `ChannelInfoSheet` (thin in-file container, currently owns only an Escape effect). **The two
  symbols this ticket extends:** the view gains an `onRename?` callback + the Actions button; the container
  grows the dialog's open→seed→dispatch→close state and renders the dialog.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:918-920` — the empty `.channel-info__actions`
  slot (`<div className="channel-info__actions" />`) #365 left as the mount point. The Rename button lands here.
- `src/renderer/src/screens/channels/ChannelList.tsx:48-96` — **the pattern to mirror exactly:** `renameRow`
  + `renameName` local state (`:53-54`), the `onRename` handler seeding the field via `titleFor(row.name)`
  (`:70-74`), and the `{renameRow && <RenameConversationDialogView …>}` render with
  `onCancel`/`onSave` (`:88-96`) that calls `requestRenameConversation(window.pyry.sendCommand, …)` and
  closes. The sheet's container grows a screen-local copy of this same shape.
- `src/renderer/src/screens/channels/RenameConversationDialog.tsx:28-105` — the two reused exports:
  `RenameConversationDialogView` (`:28-82`, pure — imported and rendered as-is; do **not** clone) and
  `requestRenameConversation` (`:96-105`). **Line 96-100 is the one production line to change** (see
  "Typing" below).
- `src/renderer/src/screens/channels/channelListViewModel.ts:16-19` — `titleFor(name: string | null): string`
  → the daemon name when present/non-blank, else `'Untitled'`. Seed the dialog field with this (AC2).
- `src/shared/wire/types.ts:518-526,564-570` — `ConversationSummary` (7 fields) **vs**
  `ConversationCreatedPayload` (5 fields, no `is_archived` / `last_message_ts`). This shape gap is why the
  active-conversation payload is **not** assignable to `requestRenameConversation`'s current `row` param —
  drives the "Typing" decision.
- `src/renderer/src/screens/conversation/conversation.css:1621-1628` — `.channel-info__actions` (the flex
  column container). Add the `.channel-info__action` button class after it.
- `src/renderer/src/theme/tokens.css:27-28,77-80` — `--color-secondary-container` / `--color-on-secondary-container`
  (already the correct dark-theme values, no hex inlining) and `--text-label-large-*`; plus `--radius-full`
  and `--space-2`/`--space-4` used elsewhere in this file. Button styling is 100% token-based (no literals).
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` — the **server-render-only**
  `ChannelInfoSheetView` test block (#365, no jsdom / Testing Library) to extend with the button-present /
  button-absent scenarios.
- `src/renderer/src/screens/channels/RenameConversationDialog.test.tsx` — the `requestRenameConversation`
  test to extend with a `ConversationCreatedPayload`-shaped-arg scenario (documents the widened param).

## Context

Desktop already has both halves of rename: the `rename_conversation` outbound transport (#359, wired
through the preload bridge as the `renameConversation` command) and the Rename dialog (#360,
`RenameConversationDialog.tsx`, exposed on the channel list as a per-row affordance). This ticket adds a
**second trigger** for the same machinery — a Rename action in the Channel Info sheet — reusing the same
dialog and the same dispatch helper. No new transport, dialog, IPC channel, or wire type is built.

The active conversation is `activeConversationStore.activeConversation` — a `ConversationCreatedPayload`
held verbatim, or `null` for a list-opened thread (the single-active-conversation limit #365 documents).
The sheet already reads this slice and passes it into `ChannelInfoSheetView` as `conversation`. When it is
`null` there is nothing to rename, so no Rename control is offered — consistent with #365's empty-About
treatment for the same case (AC1).

Reflection is free: `rename_conversation` replies with `conversation_updated`, which desktop already
re-requests the conversation list on (#275). No reflection code is added (AC4). The thread has no title
surface, so there is nothing to reflect in the thread (out of scope, as in #360).

## Design

All behavioral work lands in **`ConversationScreen.tsx`** (extending the two existing sheet symbols) plus a
one-line type widening in **`RenameConversationDialog.tsx`** and one CSS class in `conversation.css`. Zero
new exported types or components — `onRename` is a new optional prop on the already-exported
`ChannelInfoSheetView`.

### Typing: widen `requestRenameConversation`'s `row` param (the "architect confirms the exact typing" ask)

`requestRenameConversation(sendCommand, row: ConversationSummary, name)` reads **only `row.id`**
(`RenameConversationDialog.tsx:103`). But the sheet's active conversation is a `ConversationCreatedPayload`,
which is **not** structurally assignable to `ConversationSummary` (it lacks `is_archived` and
`last_message_ts`). So the payload cannot be passed directly today, and the codebase bans unchecked `as`,
and fabricating the two missing wire fields would be dishonest.

**Resolution — widen the param to what the function actually reads:** change `row: ConversationSummary` to
`row: Pick<ConversationSummary, 'id'>` (equivalently `{ id: string }`). This is a one-line, behavior-preserving
type change that:
- makes the helper's signature say exactly what it consumes (`.id` only) — a strict honesty improvement;
- keeps the **existing** `ChannelList.tsx:94` call valid (a full `ConversationSummary` still satisfies
  `Pick<…, 'id'>`) — **zero call-site fan-out**;
- lets the sheet pass `activeConversation` (`ConversationCreatedPayload`) directly — no adapter object, no `as`.

This is what "no adapter over the payload is needed" means in practice: the reuse works by narrowing the
helper's stated input to its real input, not by wrapping the payload. `requestPromoteConversation` keeps its
richer `row` type (it genuinely reads `cwd` too) — only rename is widened, and the two helpers legitimately
differ.

### `ChannelInfoSheetView` (pure view) — add the Rename action

Add one optional prop and render the button in the existing Actions slot. The container supplies `onRename`
**only when there is a conversation to rename**, so the guard is the prop's presence (the `ChannelList`
`onRename?`-optional-affordance idiom):

```
export function ChannelInfoSheetView({
  conversation, now = Date.now(), onClose,
  onRename,                       // NEW: () => void | undefined; absent ⇒ no Rename control (AC1)
}: { …existing…; onRename?: () => void }): JSX.Element
```

In the `.channel-info__actions` slot (currently self-closing), render the button only when `onRename` is
supplied:
- `onRename` present → `<button type="button" className="channel-info__action" onClick={onRename}>Rename</button>`
- `onRename` absent → the slot stays empty (unchanged from #365).

`'Rename'` is a static client string (apostrophe-free — no `renderToStaticMarkup` escaping concern). The
view stays pure: no store, no effects, no `window.pyry`.

### `ChannelInfoSheet` (in-file container) — own the dialog state + render the dialog

The container currently owns only the Escape effect. It grows a screen-local copy of #360's dialog state —
`renameOpen` + `renameName` `useState` — and renders `RenameConversationDialogView` as a sibling of the
view (the `ChannelList` shape). `window.pyry` is dereferenced only inside interaction callbacks, never
during render, so the container stays consistent with the sheet's server-render discipline (only the pure
view is server-render-tested).

Behavior (mirroring `ChannelList.tsx:70-96`):
- **`onRename` handler** (passed to the view): seed `renameName = titleFor(conversation.name)` then
  `setRenameOpen(true)`. Supplied to the view **only when `conversation !== null`** (inline in the branch
  where `conversation` narrows non-null), so a null active conversation yields `onRename = undefined` → no
  button (AC1). Seeding via `titleFor` means a null-name conversation prefills with its `'Untitled'`
  placeholder (AC2).
- **Dialog render:** `{renameOpen && conversation !== null && <RenameConversationDialogView … />}` — the
  `conversation !== null` guard narrows the payload non-null for the `onSave` dispatch (and defends against
  the active conversation clearing while the dialog is open).
  - `name={renameName}`, `onNameChange={setRenameName}` (controlled field; blank-disables-Save is the
    dialog's own inherited behavior — AC3).
  - `onCancel` → `setRenameOpen(false)` (no wire effect — AC3).
  - `onSave` → `requestRenameConversation(window.pyry.sendCommand, conversation, renameName)` then
    `setRenameOpen(false)` (dispatch `{ conversation_id, name: trimmed }` for the active conversation, then
    close — AC3; trimming is the helper's job).

The container's return becomes a fragment: `<ChannelInfoSheetView … onRename={…} />` + the conditional
dialog. The existing Escape effect is unchanged. (Note: because the dialog renders inside the sheet's
container, an Escape keypress while the dialog is open fires the sheet's document listener and closes the
whole sheet — which unmounts the dialog too. That is acceptable "Escape = cancel" behavior and matches the
#360 dialog's lack of an independent Escape handler — see Open questions.)

### Imports (into `ConversationScreen.tsx`)

- Add `titleFor` to the existing `../channels/channelListViewModel` import (the file already imports
  `formatLastActivity` from there for the sheet's Last-activity row).
- Add `import { RenameConversationDialogView, requestRenameConversation } from '../channels/RenameConversationDialog'`.

No import cycle: `RenameConversationDialog` / `channelListViewModel` import only from `@shared/*`, never back
into `ConversationScreen`.

### CSS — `.channel-info__action` (new tonal pill button)

Add after `.channel-info__actions` (conversation.css:1628). All token-based, no color/size literals — the
#365 discipline:

- `display:flex; align-items:center; justify-content:center;` (centered label, full column width)
- `border:none; cursor:pointer;`
- `border-radius: var(--radius-full);` (Figma 100px pill)
- `background: var(--color-secondary-container);` / `color: var(--color-on-secondary-container);` (the M3
  tonal pairing — the tokens already resolve to the dark-theme values in the screenshot)
- `padding:` horizontal `var(--space-4)` (16px, exact); vertical the nearest space token to Figma's ~10px
  (`--space-2` = 8px if the scale has no 10/12 step). Optionally `min-height: 40px` to hit Figma's button
  height exactly — developer's call against the actual token scale.
- label-large type block: `font-size: var(--text-label-large-size); line-height: var(--text-label-large-line);
  letter-spacing: var(--text-label-large-tracking); font-weight: var(--text-label-large-weight);`

`.channel-info__action` is a generic base #366/#367 can reuse (#367's destructive Delete would layer an
error-tinted variant on top) — but this ticket defines only the one button it needs.

## State + concurrency model

- Two new screen-local `useState` (`renameOpen: boolean`, `renameName: string`) in the `ChannelInfoSheet`
  container — ephemeral per-interaction UI state, `useState` not the store (ADR 0006). They reset on the
  sheet's unmount for free (the sheet only mounts while open). No store is written; `activeConversationStore`
  is read (existing selector) only. Unidirectional flow preserved.
- No new effects, timers, async, or `AbortController`. The only effect remains the existing Escape listener.
  Dispatch is fire-and-forget through `window.pyry.sendCommand` (the composer-send idiom) — `void`, no reply
  awaited (reflection rides #275's list re-request).

## Error handling

- **`conversation === null`** (list-opened thread): `onRename` is not supplied → no Rename button; nothing
  dispatchable. The extra `conversation !== null` guard on the dialog render is belt-and-suspenders for the
  active conversation clearing mid-dialog.
- **`name === null`** (unnamed scratch): the dialog prefills with `'Untitled'` via `titleFor` (not empty, not
  a crash).
- **Blank / whitespace-only field:** Save is disabled by `RenameConversationDialogView`'s own inherited logic
  (`name.trim() === ''`); `requestRenameConversation` additionally trims before dispatch, so no accidental
  edge whitespace reaches the wire.
- **Untrusted daemon strings:** the prefilled `name` renders as an auto-escaped controlled `<input value>` in
  the reused dialog (never `dangerouslySetInnerHTML`) — the existing #360 posture, unchanged. No new sink.
- No new failure surface (network / socket / parse): the `renameConversation` command's transport handling
  was established by #359; this ticket only adds a UI trigger.

## Testing strategy

Suite constraint (standing): **`renderToStaticMarkup` only, no jsdom / Testing Library.** So pure views are
server-render-tested with injected props; the container's open→seed→dispatch→close interaction, the dialog's
Save/Cancel wiring, and the `window.pyry` deref are **not** unit-testable here — exactly as `ChannelList`'s
rename interaction and `StatusSheet`'s open-wiring are untested. Do **not** add interaction tests the suite
cannot run, and do not overstate coverage: that wiring is guarded by `npm run typecheck` + `npm run build`.

Extend `ConversationScreen.test.tsx` (the `ChannelInfoSheetView` block), bullet scenarios — developer writes
the assertions in the suite idiom:
- **Rename button present:** given a populated `conversation` **and** `onRename` supplied → the Actions slot
  renders a `.channel-info__action` button whose text is `Rename`.
- **Rename button absent (null conversation guard, AC1):** render the view with `conversation === null` and
  `onRename` omitted → the Actions header is present but **no** `.channel-info__action` / no `Rename` text.
- **Rename button absent when no callback:** populated `conversation` but `onRename` omitted → still no button
  (proves the button is gated on the callback, matching the container's null-guard contract).

Extend `RenameConversationDialog.test.tsx` (the `requestRenameConversation` block):
- **Widened-param acceptance:** call `requestRenameConversation(fakeSend, conv, '  Renamed  ')` where `conv`
  is a `ConversationCreatedPayload`-shaped object (or a minimal `{ id }`) → the captured command is
  `{ type: 'renameConversation', payload: { conversation_id: conv.id, name: 'Renamed' } }` (trimmed).
  Documents that the widened `Pick<…, 'id'>` param accepts the sheet's payload. Existing
  `ConversationSummary`-shaped tests remain valid (widening only accepts *more*).

**Do not re-test the reused dialog view.** `RenameConversationDialogView`'s chrome, blank-disables-Save, and
name-escaping are already covered by #360's `RenameConversationDialog.test.tsx`; #368 imports it verbatim.

## Acceptance criteria → design mapping

- **AC1** (Rename control present with an active conversation; absent when null) → container supplies
  `onRename` only in the `conversation !== null` branch; view renders `{onRename && <button>}`. Both branches
  server-render-tested.
- **AC2** (opens the #360 dialog prefilled via `titleFor`) → `onRename` seeds `renameName = titleFor(conversation.name)`,
  `setRenameOpen(true)`; the reused `RenameConversationDialogView` renders with that value. (Interaction
  untested; contract specified.)
- **AC3** (Save dispatches `renameConversation {conversation_id, trimmed name}` + closes; Cancel closes,
  no wire; Save disabled while blank) → `onSave` = `requestRenameConversation(…) + setRenameOpen(false)`;
  `onCancel` = `setRenameOpen(false)`; blank-disable inherited from the dialog view.
- **AC4** (new name reflected via `conversation_updated` list re-request #275; nothing to reflect in the
  thread) → no code added.
- **AC5** (renderer-contained: no transport / IPC / wire) → touches only `ConversationScreen.tsx`,
  `RenameConversationDialog.tsx` (a type widening), `conversation.css`, and tests. The `renameConversation`
  command + its main-side handling + the IPC allowlisting already exist (#359).

## Open questions

- **Escape while the rename dialog is open** closes the whole sheet (the sheet's document Escape listener
  fires; the reused #360 dialog has no independent Escape handler, matching `ChannelList`). Unmounting the
  sheet tears down the dialog — a clean "Escape = cancel, no dispatch". No AC requires the dialog to swallow
  Escape independently; left as-is (evidence-based deferral). If a future ticket wants Escape to close only
  the dialog first, that is a shared-dialog concern, out of scope here.
- **Two overlays stacked** (sheet + dialog) is expected: `.rename-conversation-overlay` is a full-window
  overlay with its own scrim, rendering above the sheet regardless of DOM nesting — the same way it renders
  above the channel list today.
