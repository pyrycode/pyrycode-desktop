# Rename dialog + per-row affordance

The shared Rename presentation serves saved (promoted) rows in [Channel List](channel-list.md)
and the conversation-info action for chats and channels. Both open a dialog prefilled with the
current displayed title and dispatch the [`renameConversation` command](conversation-rename.md). The dialog
collects input and dispatches only; it never mutates the list — the renamed row's new title
appearing is [#275](conversation-list-store.md)'s job, reacting to the daemon's
`conversation_updated` broadcast, exactly as [Save-as-channel](save-as-channel-dialog.md)'s
promoted-row reflection already works.

Introduced in [#360](../codebase/360.md), split from #154 (transport [#359](../codebase/359.md) /
dialog #360). Renderer-only — no new transport, IPC, store, or wire code; consumes the
`renameConversation` command #359 already shipped.

**Second entry point ([#368](../codebase/368.md)):** the [Channel Info sheet](conversation-shell-session-and-channel-info.md#channel-info-sheet-365)'s
Actions slot gained a Rename tonal pill (Figma 20:89) that opens this same
`RenameConversationDialogView` and dispatches through this same `requestRenameConversation`,
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

- Each saved (promoted) Channel row in the Channel List renders a trailing icon-only "Rename"
  affordance (`aria-label="Rename"`, a Material pencil glyph — no Figma node pins this row-level
  control; 19:14 is the dialog only). Recent (unpromoted) discussion rows render no Rename
  affordance — the exact symmetric counterpart of [Save-as-channel](save-as-channel-dialog.md),
  which lives only on Recent rows, so no row ever carries two trailing buttons.
- Both entry points open the [shared Modal](modal-presentation.md) at a preferred width of
  640px, with the title **Rename**, header close button and divider, a filled **Channel name:**
  field (including for chats), and centred outlined **Cancel** / filled **OK** buttons.
  The field is prefilled from `titleFor(name)`, including the **Untitled** fallback for a
  null or blank name.
- OK is disabled while the name is empty or whitespace-only and enabled once non-blank.
- Confirming OK dispatches `renameConversation{conversation_id: row.id, name: name.trim()}`
  and closes the dialog. The payload has no `cwd`, unlike `promoteConversation`.
  Cancel and the header close button dismiss without dispatching. Identity, history, folder
  and chat/channel status are preserved.
- The renamed row's new title appears later, if at all, when the daemon's `conversation_updated`
  reply triggers [#275](conversation-list-store.md)'s list re-request — there is no optimistic UI
  change here, mirroring [Save-as-channel](save-as-channel-dialog.md)'s and the
  [new-discussion FAB](new-discussion-fab.md)'s fire-and-forget posture.

## How it works

The view and helper live under `src/renderer/src/screens/channels/`; `ChannelList` and
`ConversationScreen` each call both.

### `RenameConversationDialog.tsx`

Two pure, SSR-testable exports:

```ts
export function RenameConversationDialogView(props: {
  name: string
  onNameChange: (next: string) => void
  onCancel: () => void
  onSave: () => void
}): JSX.Element

export function requestRenameConversation(
  sendCommand: (command: RendererCommand) => void,
  row: Pick<ConversationSummary, 'id'>,   // narrowed from ConversationSummary — #368
  name: string
): void
```

`RenameConversationDialogView` retains its fixed overlay and inert scrim, and composes
`components/Modal.tsx` with `width={640}`. Modal owns the panel, divider, close asset and
centred actions. Its React `useId()` ties `aria-labelledby` to the title; the old fixed
`RENAME_CONVERSATION_TITLE_ID` is gone. The wrapping label gives the input its accessible
name, **Channel name:**. React escapes the controlled input value.

Cancel and close both call `onCancel`; OK calls the existing `onSave` prop and is disabled
by `name.trim() === ''`. Presentation reuse does not transfer draft, focus or dismissal
ownership to Modal. Each caller seeds the draft on every open, so reopening after Cancel
or close restores the current displayed name instead of the discarded draft.

`requestRenameConversation` is the `requestPromoteConversation` twin **minus the `cwd` field**: an
inline literal typed as `RendererCommand`, `name` trimmed before send, no redundant blank guard
(the view already gates it). Dropping `cwd` is deliberate, not an oversight —
`RenameConversationPayload` has no `cwd` field, and a stray one would fail
`isRenameConversationPayload`'s exact-shape check at the main boundary (see
[Conversation rename](conversation-rename.md)).

### `ChannelList.tsx` — `Row` extension

`Row` already restructured into a flex wrapper with sibling children when
[Save-as-channel](save-as-channel-dialog.md) shipped (#274). This ticket adds a second optional
sibling, `onRename?: () => void`, rendered as `.channel-list__rename` alongside (not replacing)
`.channel-list__save`. `renderBody` passes `onSaveAsChannel` only to `discussions.map(...)` (Recent
rows) and `onRename` only to `channels.map(...)` (saved Channel rows) — the two affordance sets are
disjoint by section, so a row structurally carries at most one trailing button, never both.

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
  isn't clickable while a dialog is open, and the two affordance sets are disjoint by row anyway.
- The container returns a fragment: the list view, then both dialogs as conditional siblings —
  `saveRow && <SaveAsChannelDialog …/>` and `renameRow && <RenameConversationDialogView …/>`.
  `onCancel` clears `renameRow` (dispatches nothing). `onSave` calls `requestRenameConversation
  (window.pyry.sendCommand, renameRow, renameName)` then clears `renameRow`.
- `window.pyry` is dereferenced only inside the `onSave` closure, and the dialog is absent on first
  paint (`renameRow` starts `null`), preserving the SSR smoke test — the same discipline as
  `onSaveAsChannel`/`onNewConversation`.

### Data flow

```
Saved Channel row's Rename affordance click → container: setRenameRow(row); setRenameName(titleFor(row.name))
                                                     │
                                                     ▼
                                RenameConversationDialogView (controlled by renameName state)
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
- **The sidebar affordance is fixed to saved Channel rows.** Chats use the existing
  conversation-info Rename action.
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

- [Conversation rename (transport)](conversation-rename.md) / [#359 codebase notes](../codebase/359.md)
  — the `renameConversation` command and `RenameConversationPayload` this dialog dispatches
  unchanged; this ticket is its first live caller.
- [Save-as-channel dialog](save-as-channel-dialog.md) / [#274 codebase notes](../codebase/274.md)
  — the original precedent for the `Row` sibling-affordance shape and the
  `position: fixed`/`z-index` overlay precedent this ticket reused without re-deriving.
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
- Spec: `docs/specs/architecture/360-rename-dialog.md` (dialog); `docs/specs/architecture/368-channel-info-rename-action.md` (second entry point).
