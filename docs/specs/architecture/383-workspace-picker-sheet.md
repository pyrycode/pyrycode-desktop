# #383 — Workspace Picker sheet UI

The UI slice of #157. A bottom-sheet picker that lists the recent-workspaces store, marks the
active conversation's current workspace, and dispatches `change_workspace` on selection. Everything
it consumes — the store (#382), the data-path bridge (#382), the `changeWorkspace` command (#379),
the relative-time formatter (#141), and the `.status-sheet__*` chrome (#177/#365) — is already
merged. This ticket adds **one new pure view + its thin container + a one-line dispatch helper**,
plus a small mount/wiring delta in `ConversationScreen`. No new command, no new transport plumbing,
no store change.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-2

A 28px-radius bottom sheet: a drag handle, a header row (title **"Choose workspace"** left, a
close × right), then a scrollable body. The body holds a muted **"Recent"** section header (node
20:12) above one row per recent workspace — a folder glyph, the monospace `path`, and a muted
"Last used …" line (node 20:13/20:20); the row matching the current workspace also carries a small
**"default"** pill (secondary-container fill `#3a4857` / on-secondary-container text `#d6e4f7`,
label-small, node 20:36). Below is an **"Other"** section header (node 20:40) with a single
create-new-folder entry (folder-plus glyph + body-large text, node 20:41). Reuse the Channel Info
sheet's chrome-clone approach — the same `.status-sheet__*` overlay/scrim/panel/handle/header/close/body
plus `.status-sheet__section-header` — with a static title (`StatusSheet` hardcodes "Run configuration",
so it cannot be reused verbatim).

## Files to read first

- `src/renderer/src/screens/conversation/ConversationScreen.tsx:859-1115` — **`ChannelInfoSheetView`
  + its `ChannelInfoSheet` container**: the exact chrome-clone + callback-gating + dispatch-then-close
  + Escape-listener pattern the picker mirrors. `requestArchiveConversation` (`:1006`) /
  `requestDeleteConversation` (`:1019`) are the shape for the new dispatch helper.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:97-176` — the container: how `sheetOpen`
  / `channelInfoOpen` `useState` toggles, the `now = Date.now()` render clock, and the
  `{channelInfoOpen && <ChannelInfoSheet …/>}` mount pattern work. **This is the edit site.**
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:379-426` — `WorkspaceChip`: the
  `onChange?` seam (already an optional prop; wiring it un-disables the "Change" button — no signature
  change).
- `src/renderer/src/store/recentWorkspacesStore.ts` — `useRecentWorkspacesStore(selectRecentWorkspaces)`
  → `readonly RecentWorkspace[] | null`; `null` = not-loaded, `[]` = loaded-empty (AC1's distinction).
- `src/renderer/src/store/recentWorkspacesBridge.ts` — `RecentWorkspacesData`, the **dormant** headless
  leaf; mount it inside the picker (fires the one-shot `requestRecentWorkspaces` + subscribes on open).
- `src/renderer/src/store/activeConversationStore.ts` — `selectActiveConversation` →
  `ConversationCreatedPayload | null`; supplies `cwd` (the default mark) + `id` (the dispatch). Written
  ONLY on `conversation_created`, never `conversation_updated` (drives the AC3 reflect note below).
- `src/renderer/src/screens/channels/channelListViewModel.ts:65-76` — `formatLastActivity(iso, now)`;
  reuse verbatim, do not add a second formatter.
- `src/shared/wire/types.ts:546-549` — `RecentWorkspace { path, last_used_at }` (snake_case, held
  verbatim). `:588-594` — `ConversationCreatedPayload`. `:712-717` — `ChangeWorkspacePayload
  { conversation_id, cwd }` (the wire field is `cwd`, **not** `path`).
- `src/shared/ipc/commands.ts:116` + `:370-386` — the existing `changeWorkspace` union member and its
  boundary guard; the helper dispatches this, adds nothing.
- `src/renderer/src/screens/conversation/conversation.css:839-942` (`.status-sheet__*` chrome),
  `:1129-1140` (`.status-sheet__section-header`), `:1571-1684` (`.channel-info__*` — token set for the
  new mono/pill/empty classes) — the CSS to reuse and the token idioms to follow.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:915-972` (`WorkspaceChip` tests) +
  `:1019-…` (`ChannelInfoSheetView` tests) — the server-render test idiom the picker's tests clone.
- `src/renderer/src/theme/tokens.css:27-28,82-85,97-101` — confirmed tokens:
  `--color-secondary-container`/`--color-on-secondary-container` (the pill), `--text-label-small-*`,
  `--radius-*`.

## Context

The workspace of a new discussion is chosen before its first message. `WorkspaceChip` (#278) shows
that workspace pre-first-message and exposes a disabled "Change" button behind the named "#157
Workspace Picker seam" (`onChange?`). This ticket wires that seam to a picker sheet: it lists the
recent workspaces the daemon reported (#380 → #382), marks the current one, and lets the user switch
the conversation to another. The daemon's `conversation_updated` reply reflects the change into the
conversation **list** for free — the same re-list path rename/archive/promote already use — so there
is no optimistic update and no extra client request. The "Other" section's create-folder dialog is
the separate #384; here that entry is present but inert.

## Design

### New file: `src/renderer/src/screens/conversation/WorkspacePickerSheet.tsx`

A new file rather than more growth in the already-1576-line `ConversationScreen.tsx` — the
`RenameConversationDialog` / `PermissionModal` / `RunConfigSections` precedent (sub-surfaces are their
own files, `ConversationScreen` composes them). Holds three exports plus one in-file container,
mirroring `RenameConversationDialog.tsx` and the `ChannelInfoSheetView` + `ChannelInfoSheet` split.

**1. `requestChangeWorkspace` — the dispatch helper (exported).**

```
requestChangeWorkspace(
  sendCommand: (command: RendererCommand) => void,
  conversationId: string,
  cwd: string
): void
```

A clone of `requestArchiveConversation` (`ConversationScreen.tsx:1006`): an inline
`RendererCommand` literal `{ type: 'changeWorkspace', payload: { conversation_id: conversationId,
cwd } }`, fire-and-forget (`sendCommand` returns void, no try/catch), no constructor added. **The
`cwd` parameter is the chosen row's `path`** — the container does the `path → cwd` map at the call
site (the wire field is `cwd`). Exported so the dispatch is directly unit-testable (the view renders
server-side only, so a click cannot be fired via a DOM event).

**2. `WorkspacePickerSheetView` — the pure view (exported).**

Pure props-in / markup-out, server-renderable, no store / no effects / no `window.pyry` — the
`ChannelInfoSheetView` posture. Contract:

```
WorkspacePickerSheetView({
  workspaces: readonly RecentWorkspace[] | null,   // the store slice; null=not-loaded, []=loaded-empty
  activeCwd: string | null,                        // conversation?.cwd ?? null — the row to mark "default"
  now?: number,                                    // defaulted to Date.now(); injected in tests
  onClose: () => void,
  onChoose?: (path: string) => void,               // callback-gated: supplied ONLY for an active conversation
  onCreateFolder?: () => void                      // OMITTED this ticket → the entry renders disabled (inert)
}): JSX.Element
```

Structure (reusing the `.status-sheet__*` chrome verbatim, the `ChannelInfoSheetView` clone):

- `.status-sheet-overlay` → `.status-sheet-overlay__scrim` (onClick=onClose) → `.status-sheet`
  (`role="dialog"`, `aria-modal="true"`, `aria-labelledby` a **new** id `workspace-picker-sheet-title`,
  distinct from the two existing sheet title ids so all can coexist).
- `.status-sheet__handle`, then `.status-sheet__header` with the static title **"Choose workspace"**
  (client-owned constant) and the icon-only close button (`aria-label="Close"`, the shared × glyph).
- `.status-sheet__body` holding:
  - **Recent section** — `.status-sheet__section-header` "Recent", then a null-vs-empty-vs-populated
    branch (AC1):
    - `workspaces === null` → the header alone, **no rows, no empty copy** (the one-shot request is
      in flight — a bare section, not a spinner; no Figma node for one).
    - `workspaces.length === 0` → the header plus one muted client-owned empty line (a new
      `.workspace-picker__empty`, the `.channel-info__empty` token set) — **structurally distinct**
      from the null case (the #324 / #141 null-vs-empty precedent).
    - otherwise → one row per workspace (see below).
  - **Other section** — `.status-sheet__section-header` "Other", then the create-folder entry (see
    below).

**Recent-workspace row** — a `<button type="button" className="workspace-picker__row">`, gated
`disabled={!onChoose}` and `onClick={() => onChoose?.(row.path)}` (the `WorkspaceChip` Change-button
disabled-until-wired idiom — no active conversation ⇒ inert rows, AC3). Contents:

- a decorative folder glyph (inline M3 SVG, `aria-hidden`, the `EmptyThread` / `InterruptButton`
  inline-glyph idiom — do not fetch an asset);
- a body column: a top line with the **`path`** rendered as auto-escaped React children in
  `.workspace-picker__path` (mono, on-surface; **never resolved as a filesystem path** — the
  `WorkspaceChip.cwd` / `RecentWorkspace.path` opaque-display-text posture), and — **iff
  `row.path === activeCwd`** — a `.workspace-picker__default-pill` carrying the client-owned "default"
  label (AC2; exact string equality, so `activeCwd === null` marks no row);
- a muted meta line `.workspace-picker__meta`: `'Last used ' + (formatLastActivity(row.last_used_at,
  now) || '—')` (AC1; the `ChannelInfoSheetView` last-activity `|| '—'` fallback for an unparseable
  timestamp). Reuse `formatLastActivity` — no second formatter.

React `key` = `row.path` (the daemon sends distinct paths, most-recent-first — a real unique key,
better than an array index).

**Create-folder entry ("Other")** — a `<button type="button" className="workspace-picker__other">`,
gated `disabled={!onCreateFolder}` and `onClick={onCreateFolder}`. This ticket **omits
`onCreateFolder`**, so it renders disabled → present but inert, activating it cannot crash (AC4) — the
`WorkspaceChip.onChange` disabled-until-wired seam, ready for #384 to supply the handler as a pure
additive. Contents: a decorative folder-plus glyph (`aria-hidden`) + a client-owned label constant
(body-large). Use `'Create new folder…'` (apostrophe-free, U+2026 ellipsis — the standing desktop
`renderToStaticMarkup` lesson). The Figma's parent-specific "under <name>" suffix is **deferred to
#384**: the renderer has no clean data source for the workspace-root basename here, and #384 owns the
real dialog that resolves it — see Open questions.

**3. `WorkspacePickerSheet` — the in-file interaction container (not exported).**

The `ChannelInfoSheet` container idiom. Props: `{ conversation: ConversationCreatedPayload | null;
now: number; onClose: () => void }`. It:

- mounts `<RecentWorkspacesData />` (the dormant #382 bridge) as a child — mounting it only while the
  picker is open gives exactly the bridge's documented behaviour: a fresh one-shot
  `requestRecentWorkspaces` per open (fresh instance → fresh `useRef` → one request), re-fetching on
  each reopen;
- reads the store via `useRecentWorkspacesStore(selectRecentWorkspaces)` → re-renders when rows
  arrive (unidirectional: the bridge writes the singleton store, this reads the slice);
- derives `activeCwd = conversation?.cwd ?? null` and passes it down (AC2);
- supplies `onChoose` **only when `conversation !== null`** — a closure over `conversation.id` that
  calls `requestChangeWorkspace(window.pyry.sendCommand, conversation.id, path)` then `onClose()`
  (AC3). The container owns the `conversation_id` (the QueuedBacklog "conversation-id wall" —
  `onChoose` takes only the row `path`, never the id). `window.pyry` is dereferenced **only inside
  this callback** (interaction time, never render — the `Composer.handleSubmit` / `ChannelInfoSheet`
  discipline), so a server-rendered container smoke never touches the bridge;
- attaches an Escape document-listener that calls `onClose` (the `ChannelInfoSheet` `useEffect`
  verbatim: the sheet only mounts while open, so the listener attaches on mount / detaches on cleanup —
  no `open` flag, no leak);
- renders `WorkspacePickerSheetView` with `{ workspaces, activeCwd, now, onClose, onChoose }` and
  **no `onCreateFolder`** (the entry stays inert, AC4).

### Edit: `src/renderer/src/screens/conversation/ConversationScreen.tsx`

A small wiring delta (the `channelInfoOpen` twin — ~8 lines):

1. Import `WorkspacePickerSheet` from `./WorkspacePickerSheet`.
2. Add `const [pickerOpen, setPickerOpen] = useState(false)` beside `channelInfoOpen` (`:102`) — a
   single-value screen-local boolean (ADR 0006), resets to closed on remount for free.
3. Pass `onChange={() => setPickerOpen(true)}` to the existing `<WorkspaceChip …/>` (`:124`) — this
   un-disables the chip's "Change" button (the seam the view already supports).
4. Mount `{pickerOpen && <WorkspacePickerSheet conversation={activeConversation} now={now}
   onClose={() => setPickerOpen(false)} />}` beside the `{channelInfoOpen && …}` block (`:163`),
   reusing the `activeConversation` slice and the `now` render clock already held.

### CSS: `src/renderer/src/screens/conversation/conversation.css`

New `.workspace-picker__*` classes (append after the `.channel-info__*` block), all token-based (no
color/type/spacing literals; opacity is the only de-emphasis device — the file convention). Chrome
(`.status-sheet-overlay`, `__scrim`, `.status-sheet`, `__handle`, `__header`, `__title`, `__close`,
`__close-icon`, `__body`) and `.status-sheet__section-header` are reused unchanged. New classes:

- `.workspace-picker__row` — the row button: reset appearance, full-width, flex row `align-items:
  center`, `gap: var(--space-4)`, `padding: var(--space-3) var(--space-4)` (Figma 20:13 px16/py12),
  left-aligned; `:hover { background: var(--color-surface-container) }` and `:focus-visible { outline:
  1px solid var(--color-outline) }` (the `.channel-list__row-open` treatment); `:disabled` drops the
  cursor/hover (the composer/send disabled convention — no opacity literal).
- `.workspace-picker__row-icon` — the 24px folder-glyph wrapper (`flex: 0 0 auto`, on-surface-variant).
- `.workspace-picker__row-body` — the text column: `flex: 1 1 auto; min-width: 0` (lets the path
  ellipsize), `display: flex; flex-direction: column; gap: 2px`.
- `.workspace-picker__row-line` — the top line: flex row, `gap: var(--space-2)`, `align-items: center`
  (path + optional pill).
- `.workspace-picker__path` — mono on-surface, ~14px (`--font-mono` + the body-medium size tokens),
  ellipsizing (`overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0`) — the
  `.channel-info__row-value--mono` idiom at the row's larger size.
- `.workspace-picker__default-pill` — the "default" chip (Figma 20:36): `background:
  var(--color-secondary-container); color: var(--color-on-secondary-container)`, `--text-label-small-*`,
  `padding: 0 var(--space-2)` (px8/py-px), `border-radius: 4px` (structural geometry, the 32×4 handle
  carve-out precedent — smaller than `--radius-xs`), `flex: 0 0 auto`, `white-space: nowrap`.
- `.workspace-picker__meta` — the "Last used …" line: muted on-surface-variant, `--text-body-small-*`
  (Figma 20:20).
- `.workspace-picker__empty` — the loaded-empty line: the `.channel-info__empty` token set (margin 0,
  row padding, muted body-medium).
- `.workspace-picker__other` — the create-folder entry button: same reset + flex + padding + hover +
  focus + disabled treatment as `.workspace-picker__row`, with a body-large on-surface label
  (`--text-body-large-*`).
- `.workspace-picker__other-icon` — the 24px folder-plus-glyph wrapper (mirrors `__row-icon`).

## State + concurrency model

- **Open state** — `pickerOpen`, a screen-local `useState` boolean in `ConversationScreen` (ADR 0006,
  the `sheetOpen` / `channelInfoOpen` idiom), never the store. Resets to closed on remount for free.
- **Data** — the app-singleton `recentWorkspacesStore` (#382) is the single source of truth. The
  container reads it (`useRecentWorkspacesStore(selectRecentWorkspaces)`) and mounts
  `RecentWorkspacesData`, which fires one `requestRecentWorkspaces` per open and writes arriving rows
  via the store's single setter. Unidirectional: the view reads props and calls `onChoose`; it never
  writes a store. The only write path is the daemon → bridge → `setRecentWorkspaces`; the only outbound
  effect is the `changeWorkspace` command.
- **Current-workspace source** — `activeConversationStore` supplies `cwd` (the default mark) and `id`
  (the dispatch). It is written **only on `conversation_created`**, so a list-opened thread has
  `conversation === null` (single-active-conversation limit) → `activeCwd === null` (no mark) and no
  `onChoose` (inert rows). In practice the only wired entry, `WorkspaceChip`, renders only when the
  conversation is a non-null unpromoted discussion, so opening from it always has an active
  conversation — but the view is defensive per AC2/AC3 and is tested with `null`.
- **Teardown** — the Escape listener attaches on the container's mount and detaches on its cleanup
  (the sheet only mounts while `pickerOpen`); closing unmounts `RecentWorkspacesData` too. No timers,
  no `AbortController`, no fire-and-forget promise.

### Entry-point scope decision

**Only the `WorkspaceChip.onChange` seam is wired this ticket** (the ticket's named "#157 Workspace
Picker seam"). It surfaces the picker only in the pre-first-message window of an unpromoted discussion
— which is exactly where changing a not-yet-run workspace is meaningful, and where the active
conversation (hence the `conversation_id` the dispatch needs) is guaranteed present. An additional
entry point (e.g. from the overflow menu / Channel Info sheet, which cover promoted/active
conversations) is **deferred**: it would need the deferred select-and-load transport to populate
`activeConversationStore` for a list-opened thread, and adding it now is scope creep beyond this S
ticket. Flagged in Open questions.

## Error handling

Pure renderer UI over already-merged plumbing — no new failure surface.

- **Untrusted daemon strings** — `path` (per row) and `activeCwd` reach the DOM only as auto-escaped
  React children; never `dangerouslySetInnerHTML`, never split/basenamed/resolved as a filesystem path
  (extracting a segment would itself be "interpreting it as a path"). The `WorkspaceChip.cwd` /
  `RecentWorkspace.path` / `ChannelInfoSheetView` posture already in this codebase. `last_used_at` is
  fed only to `formatLastActivity`, which degrades an unparseable value to `''` (→ the `|| '—'`
  fallback) and never throws.
- **Command failure** — `sendCommand` is fire-and-forget (returns void); a rejected/failed change
  surfaces through the normal connection status, not here. No optimistic update means nothing to roll
  back — the row list is unchanged locally; the conversation **list** reflects the new workspace only
  when the daemon's `conversation_updated` re-list arrives (AC3). Note the active-conversation chip
  itself does **not** live-update (it is written only on `conversation_created`) — a pre-existing #278
  store limitation, deferred, not fixed here (Evidence-Based Fix Selection; no observed failure).
- **Null / empty store** — both branch explicitly and render valid markup; neither crashes (AC1).

## Testing strategy

`npm test` (vitest, `renderToStaticMarkup`) + `npm run typecheck`. Put the picker's tests in a new
`WorkspacePickerSheet.test.tsx` co-located with the new file, cloning the `ChannelInfoSheetView` /
`WorkspaceChip` describe blocks. The pure view is server-rendered with injected props (no store); the
container (`RecentWorkspacesData` mount, Escape effect, `window.pyry` dispatch) is untested reviewed
glue — the `node` env fires no clicks and runs no effects, the standing `ChannelInfoSheet` /
`Composer` discipline.

`WorkspacePickerSheetView` scenarios (inject `now`, a fixed `activeCwd`, seeded `workspaces`):

- **Chrome** — renders `role="dialog"`, `aria-modal="true"`, `aria-labelledby="workspace-picker-sheet-title"`,
  the matching title id, the drag handle, the "Choose workspace" title, and the `aria-label="Close"`
  control.
- **Populated Recent** — a two-row `workspaces` renders both `path`s and, with `now = a row's
  last_used_at + 2h`, its deterministic `Last used 2h ago` meta.
- **Default pill (AC2)** — with `activeCwd` equal to one row's `path`, exactly that row carries the
  "default" pill and the others do not.
- **No mark when no active conversation (AC2)** — `activeCwd={null}` → no "default" pill anywhere.
- **Not-loaded vs loaded-empty (AC1)** — `workspaces={null}` renders the "Recent" header, no row
  markup, and no empty-copy; `workspaces={[]}` renders the header **plus** the empty line — assert the
  two outputs differ and neither throws.
- **Choose gating (AC3)** — with `onChoose` omitted, a rendered row `<button>` carries `disabled`;
  with `onChoose` supplied, it does not. (The click dispatch itself is proven by the helper test, not a
  DOM click.)
- **Other entry inert (AC4)** — the "Create new folder…" entry renders and, with `onCreateFolder`
  omitted, its `<button>` carries `disabled`.
- **Untrusted escaping (AC5)** — a `path` of `'<b>x</b>'` renders as `&lt;b&gt;x&lt;/b&gt;`, never live
  markup (apostrophe-free fixture — `renderToStaticMarkup` escapes `'`).

`requestChangeWorkspace` scenarios (plain function test, a spy `sendCommand`):

- dispatches exactly `{ type: 'changeWorkspace', payload: { conversation_id, cwd } }` with the
  **row `path` mapped into `cwd`** (assert the payload key is `cwd`, carrying the path value — the
  #379 wire-field contract) and the given `conversation_id`.

## Open questions

- **Create-folder label specificity.** Figma shows "Create new folder under <parent>". The renderer
  has no clean source for the workspace-root basename here, so this ticket ships the generic inert
  `'Create new folder…'`. #384 (the create-folder dialog) resolves the parent and owns the final
  label + the `onCreateFolder` handler — confirm during #384 whether the parent comes from
  `serverInfoStore` (#340) or a new field, and update the label then.
- **Second entry point.** Deferred (see Entry-point scope decision) — revisit when the select-and-load
  transport lands and a list-opened thread can populate `activeConversationStore`.
- **Reopen freshness after a change.** Reopening the picker after a successful change still marks the
  **old** `cwd` until the next `conversation_created`, because `activeConversationStore` does not
  observe `conversation_updated` — a pre-existing #278 limitation, out of scope here.
