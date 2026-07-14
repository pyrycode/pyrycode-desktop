# #360 — Rename dialog (prefilled name, confirm) + list reflection

Size: **S**. Renderer-only. A near-clone of the Save-as-channel dialog (#274). No transport, IPC, or wire code — #359 (merged, PR #362) owns the `renameConversation` command, its `RenameConversationPayload`, and the `isRenameConversationPayload` boundary guard. This ticket only dispatches it.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=19-14

Node 19:14 "Rename Dialog" is a byte-for-byte twin of the Save-as-channel dialog (19:24): a centered M3 dialog panel (surface-container-high fill, 28px radius, 24px padding, 16px-gap column) with a headline-small **"Rename"** title, an outlined **Name** field (label-medium "Name" label over a body-large value, prefilled with the current name — the mock shows "kitchenclaw refactor"), and a right-aligned action row of **Cancel** + **Save** as M3 text-buttons (primary color, label-large). It reuses exactly the tokens the existing `.save-as-channel__*` CSS already maps — the only visual differences from 19:24 are the title text and that the Name field is prefilled. The row-level affordance that *opens* the dialog has no Figma node (like the Save-as-channel per-row button); the architect picks the glyph and placement (see Design below).

## Files to read first

- `src/renderer/src/screens/channels/SaveAsChannelDialog.tsx:1-105` — **the clone source.** A pure `SaveAsChannelDialogView` (props → markup, blank-Save disable computed inline) + a co-located `requestPromoteConversation` dispatch helper. Copy the structure; change the title, the class prefix, the command type, and **drop the `cwd` field**.
- `src/renderer/src/screens/channels/SaveAsChannelDialog.test.tsx:1-104` — the test clone source. Mirror every case; add one assertion that the dispatched payload has **no `cwd`** key.
- `src/renderer/src/screens/channels/ChannelList.tsx:29-76` — the container's dialog wiring (`saveRow`/`name` local state, the `onSaveAsChannel` open handler, the conditional dialog render). Add the rename twin alongside it.
- `src/renderer/src/screens/channels/ChannelList.tsx:207-312` — `renderBody` (which passes `onSaveAsChannel` only to `discussions.map(...)`) and `Row` (the `.channel-list__save` sibling-button pattern). Add the symmetric `onRename` prop, threaded to `channels.map(...)` only, and the row affordance.
- `src/renderer/src/screens/channels/ChannelList.test.tsx:50-52,120-128` — the `SAVE_MARKER` present-on-discussion / absent-on-channel test pair. Mirror it for a `RENAME_MARKER` with the sections swapped.
- `src/renderer/src/screens/channels/channels.css:43-100` — `.channel-list__row` (flex wrapper) and `.channel-list__save` (icon-button treatment + `:hover`/`:focus-visible`/`-icon`). Clone the `__save` block to `__rename`.
- `src/renderer/src/screens/channels/channels.css:296-418` — the `.save-as-channel*` dialog chrome (overlay, scrim, panel, title, field, label, input, actions, cancel, save, save:disabled). Clone to `.rename-conversation*`.
- `src/renderer/src/screens/channels/channelListViewModel.ts` — `titleFor(name)`: seed the field from the row's *displayed* title, so a null-name row prefills with its placeholder ("Untitled"), not an empty field.
- `src/shared/ipc/commands.ts:91,290-305` — the shipped `renameConversation` command variant + `isRenameConversationPayload` guard (#359). **No change** — this confirms the dispatch target and payload contract.
- `src/shared/wire/types.ts:607-626` — `RenameConversationPayload { conversation_id, name }`: two REQUIRED strings, **no `cwd`**. The doc comment spells out the deliberate non-reuse of the promote payload.

## Context

Desktop cannot rename a conversation today. #154 was split into the outbound transport (#359, merged) and this UI half. The `renameConversation` command is live; this ticket adds the dialog that dispatches it and the per-row affordance that opens it. List reflection is free (AC4): `rename_conversation` replies with `conversation_updated`, which already re-requests the list (#275), so the renamed row's title lands with no new reflection code. The conversation thread has no title surface, so there is nothing to reflect there (out of scope).

## Design

Two changes, both under `src/renderer/src/screens/channels/`.

### 1. New module — `RenameConversationDialog.tsx` (clone of `SaveAsChannelDialog.tsx`)

Two exports, both pure and SSR-testable, mirroring the clone source exactly:

**`RenameConversationDialogView`** — the pure dialog chrome. Same prop contract as the save-as view:

```
export function RenameConversationDialogView(props: {
  name: string
  onNameChange: (next: string) => void
  onCancel: () => void
  onSave: () => void
}): JSX.Element
```

Deltas from `SaveAsChannelDialogView`:
- Title text **"Rename"** (was "Save as channel").
- `aria-labelledby` / title `id` = a new fixed constant `rename-conversation-title` (a single fixed id is safe — only one rename dialog is open at a time, the save-as idiom).
- Class prefix `rename-conversation` / `rename-conversation__*` (was `save-as-channel*`).
- Everything else identical: dedicated scrim sibling, `role="dialog"` + `aria-modal="true"`, the wrapping-`<label>` Name field, `blank = name.trim() === ''` computed inline to drive `disabled` on Save, the input value rendered as an auto-escaped React attribute (never `dangerouslySetInnerHTML`), Cancel + Save both right-aligned.

**`requestRenameConversation`** — the dispatch helper. The `requestPromoteConversation` twin **minus `cwd`**:

```
export function requestRenameConversation(
  sendCommand: (command: RendererCommand) => void,
  row: ConversationSummary,
  name: string
): void
// → sendCommand({ type: 'renameConversation',
//                 payload: { conversation_id: row.id, name: name.trim() } })
```

An inline literal typed as `RendererCommand` (no constructor). Trim edge whitespace off `name` (the view already disables Save on blank, so no re-guard — trimming is the only job). Fire-and-forget; `sendCommand` is `void`. **Do not carry `cwd`** — rename is a deliberate non-reuse of the promote payload (`RenameConversationPayload` has no `cwd`; adding one would fail `isRenameConversationPayload`'s exact-shape check at the main boundary and drift the wire from the daemon contract).

### 2. Modify `ChannelList.tsx`

**Container state (add alongside the existing save-as pair, do not touch it):**
- `const [renameRow, setRenameRow] = useState<ConversationSummary | null>(null)`
- `const [renameName, setRenameName] = useState('')`

Keep the rename state fully independent of the save-as `saveRow`/`name` pair — a separate local state, not a shared one. No mutual-exclusion logic is needed: an open dialog's `position: fixed; inset: 0` overlay covers the whole window, so the row affordance behind it is not clickable, and the two dialogs cannot both be opened. This is the minimal-touch clone the ticket calls for.

**Open handler** (passed to `ChannelListView` as a new `onRename` prop, mirroring `onSaveAsChannel`):
`onRename={(row) => { setRenameRow(row); setRenameName(titleFor(row.name)) }}` — seed the field from the displayed title in one handler, no effect, no key-remount. `window.pyry` is dereferenced only inside the Save closure (never during render), preserving server-renderability.

**Dialog render** (a second conditional block beside the save-as one):
`{renameRow && <RenameConversationDialogView name={renameName} onNameChange={setRenameName} onCancel={() => setRenameRow(null)} onSave={() => { requestRenameConversation(window.pyry.sendCommand, renameRow, renameName); setRenameRow(null) }} />}`

**Prop threading** — the symmetric counterpart to `onSaveAsChannel`:
- `ChannelListView`: add a required prop `onRename: (row: ConversationSummary) => void`.
- `renderBody`: add an `onRename` parameter; pass it to the **`channels.map(...)`** rows (`onRename={() => onRename(c)}`), exactly as `onSaveAsChannel` is passed to the `discussions.map(...)` rows. Rename lives on **promoted (saved Channel) rows** — the symmetric counterpart to Save-as-channel, which lives on Recent (unpromoted) rows. The two affordance sets are disjoint: a Channel row shows Rename (not Save-as), a discussion row shows Save-as (not Rename), so no row carries two trailing buttons. (Figma 19:14 confirms the dialog; the entry surface is invented, and the ticket fixes it on Channel rows — extending to discussions is a later follow-up.)
- `Row`: add an optional prop `onRename?: () => void`. When present, render a `.channel-list__rename` icon-only button as a **sibling** of `.channel-list__row-open` (an interactive control cannot nest in the row's open `<button>` — the same constraint the `.channel-list__save` sibling already solves). `aria-label="Rename"` supplies the accessible name; the SVG is `aria-hidden`.

**Row glyph:** the 24px Material `edit` (pencil) glyph — no Figma node pins this row control, so a specific glyph is a small architect choice (the save affordance's bookmark-glyph precedent). Path: `M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z`.

### 3. Modify `channels.css`

- Clone the `.save-as-channel*` dialog block (lines 296-418) to `.rename-conversation*` — identical rules (overlay/scrim/panel/title/field/label/input/actions/cancel/save/`save:disabled`), only the selector prefix changes. The Figma confirms the visual design is identical, so every token mapping carries over verbatim.
- Clone the `.channel-list__save` row-button block (lines 76-100) to `.channel-list__rename` (+`:hover`, `:focus-visible`, `-icon`) — same icon-button treatment (de-emphasized `on-surface-variant`, round hover target, focus-visible outline, compact padding). Leave `.channel-list__save` untouched.

## State + concurrency model

Component-local `useState` in the `ChannelList` container — the lowest scope that survives re-render (the `PermissionModal` `pendingOptionId` posture), not the Zustand store. Transient per-interaction dialog state does not belong in the store. Unidirectional: the view reads `(name, handlers)` and the container owns the state; no two-way binding. The dispatch is fire-and-forget through the preload `window.pyry.sendCommand` bridge — no promise to await, no cancellation. The main side (#359) serializes the envelope; the renderer never touches keys, sockets, or raw bytes.

## Error handling

None added here. The view disables Save on a blank name (the only client-side gate). The daemon's own trim-guard governs a blank rename server-side (per the `RenameConversationPayload` doc comment) — no client emptiness check beyond the disabled button. A failed send is dropped in the main-side connection method (#359), not surfaced here. `renameConversation` is fire-and-forget with no correlated reply to this dialog; the only visible outcome is the `conversation_updated` broadcast re-listing the row (AC4).

## AC4 — no code

`conversation_updated` is already decoded (`inboundMessage.ts`) and drives `conversationListBridge.refreshOnChange()` (#275), which re-requests the list. The renamed row's new title lands automatically. Nothing to write for this AC.

## Testing strategy

`npm test` (vitest) + `npm run typecheck`. Server-render the pure view with injected props (the #218/#224 idiom — no DOM harness, no store, no clicks); the container's click→dispatch wiring is proven by composition + the helper spy test.

**`RenameConversationDialog.test.tsx`** (clone `SaveAsChannelDialog.test.tsx`):
- View renders an accessible modal: `role="dialog"`, `aria-modal="true"`, `aria-labelledby="rename-conversation-title"`, a matching title `id`, and the title text "Rename".
- Name field prefilled with the injected name (`value="<injected>"`).
- Cancel and Save actions both present.
- Save disabled when the name is empty; disabled when whitespace-only; enabled once non-blank (assert on the Save button's class marker followed by `disabled` before its `>`).
- The prefilled name renders as escaped attribute text, never live markup (`Tom & Jerry` → `Tom &amp; Jerry`, and the raw `value="Tom & Jerry"` is absent).
- `requestRenameConversation` fires exactly one `renameConversation` command with `{ conversation_id: row.id, name }` — and **asserts the payload has no `cwd` key** (`expect(payload).not.toHaveProperty('cwd')`, guarding against a stray `cwd` copied from the promote clone).
- `requestRenameConversation` trims edge whitespace from the name before dispatching.

**`ChannelList.test.tsx`** (add to the existing file):
- Add `onRename={noop}` to the `render` helper's `ChannelListView` props (a new required prop).
- Add a `RENAME_MARKER = 'aria-label="Rename"'` and two cases mirroring the save markers with the sections **swapped**: the Rename affordance is present on a saved (promoted) Channel row, and absent on a Recent (unpromoted) discussion row.

The save-as view, helper, and their tests are untouched (only the container's plumbing gains a parallel prop and a second dialog block), so the existing suite stays green.

## Open questions

None. The dispatch shape is verified live against merged #359; the Figma confirms the dialog is a token-identical twin of the existing save-as dialog; the entry-point surface (Channel rows) is fixed by the ticket.
