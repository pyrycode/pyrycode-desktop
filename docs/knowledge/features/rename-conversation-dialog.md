# Rename dialog + per-row affordance

The naming half of Figma 19:14: a per-row "Rename" affordance on [Channel List](channel-list.md)
saved (promoted) Channel rows, opening a dialog prefilled with the row's current title that
dispatches the already-shipped [`renameConversation` command](conversation-rename.md). The dialog
collects input and dispatches only; it never mutates the list — the renamed row's new title
appearing is [#275](conversation-list-store.md)'s job, reacting to the daemon's
`conversation_updated` broadcast, exactly as [Save-as-channel](save-as-channel-dialog.md)'s
promoted-row reflection already works.

Introduced in [#360](../codebase/360.md), split from #154 (transport [#359](../codebase/359.md) /
dialog #360). Renderer-only — no new transport, IPC, store, or wire code; consumes the
`renameConversation` command #359 already shipped.

**Second entry point ([#368](../codebase/368.md)):** the [Channel Info sheet](conversation-shell.md#channel-info-sheet-365)'s
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
- Clicking it opens a centered modal dialog (`role="dialog"`, `aria-modal`, `aria-labelledby`): the
  title "Rename", a single outlined Name field **prefilled** with the row's displayed title
  (`titleFor(row.name)` — the same `'Untitled'` fallback for a null/blank name as save-as), and a
  trailing Cancel / Save action pair.
- Save is disabled while the name is blank (empty or whitespace-only) and enabled once non-blank.
- Confirming Save dispatches `renameConversation{conversation_id: row.id, name: name.trim()}` —
  note **no `cwd`**, unlike `promoteConversation` — and closes the dialog. Cancel or dismiss closes
  the dialog and dispatches nothing.
- The renamed row's new title appears later, if at all, when the daemon's `conversation_updated`
  reply triggers [#275](conversation-list-store.md)'s list re-request — there is no optimistic UI
  change here, mirroring [Save-as-channel](save-as-channel-dialog.md)'s and the
  [new-discussion FAB](new-discussion-fab.md)'s fire-and-forget posture.

## How it works

One new module plus a `ChannelList.tsx` extension, both under
`src/renderer/src/screens/channels/`:

### `RenameConversationDialog.tsx` (new)

Two pure, SSR-testable exports, mirroring `SaveAsChannelDialog.tsx` field-for-field:

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

`RenameConversationDialogView` is the `SaveAsChannelDialogView` clone — same overlay → scrim →
`role="dialog"` panel chrome, same wrapping-`<label>` Name field, same inline `blank = name.trim()
=== ''` computed for the Save `disabled` state, same auto-escaped input value (never
`dangerouslySetInnerHTML`) so the daemon-derived prefill is inert. The class prefix is
`rename-conversation`/`rename-conversation__*` instead of `save-as-channel`, the title is "Rename",
and `RENAME_CONVERSATION_TITLE_ID` is a second fixed id (safe — only one dialog is ever open).

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
  `saveRow && <SaveAsChannelDialogView …/>` and `renameRow && <RenameConversationDialogView …/>`.
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
                            Cancel/dismiss                  Save (enabled iff non-blank)
                                   │                              │
                            setRenameRow(null)      requestRenameConversation(window.pyry.sendCommand, renameRow, renameName)
                            (dispatches nothing)          → [#359] COMMAND_CHANNEL → daemon
                                                           then setRenameRow(null)
                                                                     ⋮
                               daemon conversation_updated reply → [#275] re-requests the list
                                                                  → row's title updates in place
```

### CSS (`channels.css`)

- `.channel-list__rename`: cloned from `.channel-list__save` — icon-only, `flex: 0 0 auto`, round
  hover/focus target, de-emphasized (`--color-on-surface-variant`).
- `.rename-conversation-overlay`/`.rename-conversation*`: cloned from `.save-as-channel*` — same
  `position: fixed; inset: 0; z-index: 2` overlay (needed because `.channel-list` is itself the
  `overflow-y: auto` scroll column, and `z-index: 2` must clear the FAB's sticky `z-index: 1`; see
  [Save-as-channel's Lessons learned](../codebase/274.md#lessons-learned)), same panel/scrim/
  title/field/action-row token mapping. Code review verified every rule resolves to a theme
  variable — zero hardcoded color/typography literals.

## Edge cases and limitations

- **A rename the daemon never confirms simply leaves the row's title unchanged.** No correlation
  is surfaced to this dialog between the dispatched command and the reply (the daemon's
  `conversation_updated` reply is technically correlated by envelope, unlike promote/unarchive's
  broadcast, but desktop decodes it the same way regardless — see
  [Conversation rename](conversation-rename.md)). There is no timeout, retry, or rejection surface
  in this ticket.
- **An empty/whitespace-only name is disabled client-side only; the daemon's own trim-guard is the
  server-side backstop.** No redundant emptiness check exists beyond the Save button's `disabled`
  state (Evidence-Based Fix Selection — no observed blank-submit path to defend).
- **The Name field has no Enter-to-submit or autofocus-select**, matching Save-as-channel's
  documented, safe additive-enhancement gap.
- **The affordance is fixed to saved Channel rows only.** Extending Rename to Recent (unpromoted)
  discussion rows was explicitly out of scope for this ticket (a rename is meaningful on any row,
  but the ticket scoped the entry surface to the symmetric Channel-row counterpart of Save-as-
  channel) — a trivial follow-up if desired.
- **The click→open, typed→controlled-input, and Save-click→dispatch wiring live in the container
  and are not DOM-tested** — same boundary as Save-as-channel and `PermissionModal`'s click wiring;
  covered by pure-function specs plus the `ChannelList.test.tsx` affordance-presence assertions.

## Related

- [Conversation rename (transport)](conversation-rename.md) / [#359 codebase notes](../codebase/359.md)
  — the `renameConversation` command and `RenameConversationPayload` this dialog dispatches
  unchanged; this ticket is its first live caller.
- [Save-as-channel dialog](save-as-channel-dialog.md) / [#274 codebase notes](../codebase/274.md)
  — the clone source for the dialog chrome, the `Row` sibling-affordance shape, and the
  `position: fixed`/`z-index` overlay precedent this ticket reused without re-deriving.
- [Conversation list store](conversation-list-store.md) / [#275 codebase notes](../codebase/275.md)
  — the `conversation_updated` re-request that reflects the renamed title; this dialog never
  mutates the list itself.
- [Channel List home screen](channel-list.md) / [#141 codebase notes](../codebase/141.md) — the
  screen this affordance is added to.
- [#360 codebase notes](../codebase/360.md) — implementation summary, patterns, lessons.
- [Conversation shell](conversation-shell.md#channel-info-sheet-365) / [#368 codebase notes](../codebase/368.md)
  — the Channel Info sheet's Rename action, this dialog's second entry point and the source of the
  `Pick<ConversationSummary, 'id'>` param widening.
- Spec: `docs/specs/architecture/360-rename-dialog.md` (dialog); `docs/specs/architecture/368-channel-info-rename-action.md` (second entry point).
