# #404 — Settings: Default workspace row

**Size:** S (leans XS — one new component file + a section insert; reuses three already-merged surfaces, no new types, no fan-out).
**Security-sensitive:** no. Renderer-only, no wire types, no daemon commands, no untrusted-string sink beyond the opaque path already handled by `WorkspacePickerSheetView` / the row's auto-escaped children.

## Context

The Settings screen needs the **Default workspace** row of a new "Defaults for new conversations" section (Figma 17:37 header / 17:56 row). It shows the user's current default and, on activation, opens the recent-workspaces picker to change it — controlling where new discussions open.

The persisted value and its read/write seam already landed in **#403** (merged, PR #407): the renderer store `defaultWorkspaceStore`. This ticket is the **UI consumer only** — render the current default, open the picker on click, write the choice back through the store's setter. No IPC, no transport, no daemon command (a workspace path is not a secret; the choose action fires nothing over the wire).

This follows the established Settings two-part row idiom (pure view + store-bound `Control`), but the row is *interactive* — a native `<button>` with a trailing chevron — so it is the `PairAnotherServerRow` variant of the idiom, not the static `ServerRow`/`ArchivedCountRow` variant. The picker is the pure `WorkspacePickerSheetView` from #383; #404 supplies its own thin Settings container (the conversation-coupled `WorkspacePickerSheet` container is wrong here — it dispatches a daemon `change_workspace` command and disables every row when `conversation === null`).

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=17-56

A single-row interactive `<button>`: a left flex text column (2px gap) with a primary body-large label "Default workspace" (17:58, on-surface) over a secondary body-small line (17:59, on-surface-variant) reading the current default — "scratch" when none is set — and a trailing decorative 20×20 chevron_right glyph (17:60) at the row's right edge. Geometry is `gap-16 px-16 py-10`, matching the existing `.settings__pair-another-row` button shell fused with the `.settings__server-row-text` two-line column. The section header (17:37) is "Defaults for new conversations" in the same `.settings__section-header` treatment as Connection/Storage.

## Files to read first

- `src/renderer/src/screens/settings/SettingsScreen.tsx` (full, 139 lines) — the composition point. Extract: the `SETTINGS_COPY` constant (add a `defaults` entry), the `PairAnotherServerRow` inline `<button>` + inline-chevron idiom (lines 122-138) to clone for the interactive row, and the exact insert point — a new `<section className="settings__section">` **between** the Connection section's closing `</section>` (line 68) and the Storage `<section>` (line 73).
- `src/renderer/src/screens/settings/ArchivedCountRow.tsx` (full, 51 lines) — the closest structural template for the pure-view + `Control` two-part split (a dumb view proven by server-render + a store-bound container that reads one slice). Copy this shape.
- `src/renderer/src/screens/settings/ServerRow.tsx:28-45` — the two-line text-column view (label + secondary line); the row's markup mirrors this column inside a `<button>`.
- `src/renderer/src/screens/conversation/WorkspacePickerSheet.tsx:92-106` — `WorkspacePickerSheetView` signature + prop contract (`workspaces`, `activeCwd`, `now?`, `onClose`, `onChoose?`, `onCreateFolder?`). Lines 206-275 — the container idiom to clone for the Settings picker sheet: `useState` open-state, mount `RecentWorkspacesData` while open, the Escape `useEffect` (lines 224-233 verbatim). **Do not** clone its `onChoose` (that dispatches `requestChangeWorkspace` to the daemon) — #404's `onChoose` writes the store instead.
- `src/renderer/src/store/defaultWorkspaceStore.ts:92-98` — the read seam `useDefaultWorkspaceStore(selectDefaultWorkspace)` → `string | null`, and the setter reached via `defaultWorkspaceStore.getState().setDefaultWorkspace(value)`. Note (lines 47-57): under node/`renderToStaticMarkup` the port `read()` returns `null`, so the store hydrates to `null` and the row server-renders the "scratch" placeholder.
- `src/renderer/src/store/recentWorkspacesStore.ts:56-64` — `useRecentWorkspacesStore(selectRecentWorkspaces)` → `readonly RecentWorkspace[] | null` (`null` = not-loaded, `[]` = loaded-empty).
- `src/renderer/src/store/recentWorkspacesBridge.ts:75-99` — `RecentWorkspacesData`, the dormant headless leaf; mounting it fires one fresh `requestRecentWorkspaces` per mount. Mount it inside the open picker so each open re-fetches.
- `src/renderer/src/screens/settings/settings.css:210-257` — the `.settings__pair-another-*` interactive-button-row rules (button reset + hover/focus + `width:100%`/`text-align:left` + trailing chevron) to clone. Lines 111-154 — the `.settings__server-row-text`/`-label`/`-id` two-line text column (min-width:0 + overflow-wrap) to clone for the row's column.
- `src/renderer/src/screens/settings/SettingsScreen.test.tsx` (full, 76 lines) — the `renderToStaticMarkup` test idiom + how each section is asserted; extend it for the new section.

## Design

### New file: `src/renderer/src/screens/settings/DefaultWorkspaceRow.tsx`

Two exported symbols + one in-file glue component. Module-level, apostrophe-free copy constants (the `SETTINGS_COPY`/`SERVER_ROW_LABEL` idiom — `renderToStaticMarkup` escapes `'`):

- `DEFAULT_WORKSPACE_ROW_LABEL = 'Default workspace'`
- `DEFAULT_WORKSPACE_PLACEHOLDER = 'scratch'` — the null-placeholder (Figma 17:59), a **client-owned copy constant** standing for the server's scratch default, not a daemon string.

**1. `DefaultWorkspaceRowView` (exported, pure, server-renderable — the tested seam)**

```
DefaultWorkspaceRowView(props: {
  defaultWorkspace: string | null
  onActivate: () => void
}): JSX.Element
```

Renders a native `<button type="button" className="settings__default-workspace-row" onClick={onActivate}>` containing:
- a text column (`.settings__default-workspace-text`) with the primary label (`.settings__default-workspace-label` = `DEFAULT_WORKSPACE_ROW_LABEL`) over a secondary line (`.settings__default-workspace-value` = `defaultWorkspace ?? DEFAULT_WORKSPACE_PLACEHOLDER`);
- a trailing chevron_right SVG (`.settings__default-workspace-chevron`, `aria-hidden="true"`, the exact 20×20 inline path from `PairAnotherServerRow`).

The `<button>` carries **no `aria-label`** — its text content ("Default workspace" + the value line) is its accessible name (AC4, the `PairAnotherServerRow` posture). `defaultWorkspace` is rendered **whole and opaque** as auto-escaped React children — never split, basenamed, or resolved as a filesystem path (the `WorkspacePickerSheet` `row.path` posture); CSS `overflow-wrap: anywhere` handles a long path.

**2. `DefaultWorkspaceRowControl` (exported, store-bound container — untested glue)**

Reads `const defaultWorkspace = useDefaultWorkspaceStore(selectDefaultWorkspace)` and owns the picker open-state via `useState(false)` (the transient-UI-state → local `useState` rule, ADR 0006). Renders:
- `<DefaultWorkspaceRowView defaultWorkspace={defaultWorkspace} onActivate={() => setOpen(true)} />`
- `{open && <DefaultWorkspacePickerSheet activeCwd={defaultWorkspace} onClose={() => setOpen(false)} />}`

No `window` deref at render; no setter call at render. Server-renders the row alone (open defaults false → no picker).

**3. `DefaultWorkspacePickerSheet` (in-file, not exported — untested glue, the #383 `WorkspacePickerSheet` analog)**

```
DefaultWorkspacePickerSheet(props: {
  activeCwd: string | null
  onClose: () => void
}): JSX.Element
```

Mounts only while the picker is open, so it is the direct analog of #383's container:
- `const workspaces = useRecentWorkspacesStore(selectRecentWorkspaces)`
- an Escape `useEffect` (the #383 lines 224-233 verbatim — unconditional, attach on mount / detach on cleanup, since this component only exists while open)
- renders `<RecentWorkspacesData />` (mount → one fresh `requestRecentWorkspaces` per open) as a sibling of `<WorkspacePickerSheetView … />` passing:
  - `workspaces` ← the store slice
  - `activeCwd` ← `activeCwd` (the current default — so the row matching the current default carries the picker's built-in "default" pill; `null` marks no row)
  - `onClose` ← `onClose`
  - `onChoose` ← `(path) => { defaultWorkspaceStore.getState().setDefaultWorkspace(path); onClose() }` — the sole write path; dereferences the store setter **inside the callback** (never at render), the `RecentWorkspacesData` idiom
  - **no `onCreateFolder`** — out of scope; the "Other → Create new folder" entry then renders `disabled` (AC / out-of-scope note 1)
  - `now` omitted — the view defaults `now = Date.now()` (this subtree only renders client-side)

**Why the nested in-file component (not a flat `{open && <>…</>}`):** it makes "fresh fetch per open" fall out of mount/unmount (each open is a fresh `RecentWorkspacesData` → fresh `useRef` → one request) and keeps the Escape effect unconditional — exactly mirroring #383's `WorkspacePickerSheet`. It is not exported, so it does not count against the export budget.

### Modified: `src/renderer/src/screens/settings/SettingsScreen.tsx`

- `import { DefaultWorkspaceRowControl } from './DefaultWorkspaceRow'`.
- Add `defaults: 'Defaults for new conversations'` to `SETTINGS_COPY` (17:37; apostrophe-free — leave as-is).
- Insert **between** the Connection `</section>` (line 68) and the Storage `<section>` (line 73):

```
<section className="settings__section">
  <h2 className="settings__section-header">{SETTINGS_COPY.defaults}</h2>
  <div className="settings__section-body">
    <DefaultWorkspaceRowControl />
  </div>
</section>
```

This mirrors #351's Storage-between-Connection-and-About placement and preserves the mobile vertical order (Defaults y=322 above Storage y=910). AC1.

### Modified: `src/renderer/src/screens/settings/settings.css`

Append five dedicated, token-only rules (the "dedicated class per row, reuse tokens" idiom — no new token, no literal beyond the structural 2px column gap):
- `.settings__default-workspace-row` — clone `.settings__pair-another-row` (button reset, `gap: --space-4`, `padding: --space-3 --space-4`, `width: 100%`, `text-align: left`, `cursor: pointer`, on-surface, `--font-sans`) + its `:hover` / `:focus-visible`.
- `.settings__default-workspace-text` — clone `.settings__server-row-text` (`flex: 1 1 auto; min-width: 0; flex-direction: column; gap: 2px`).
- `.settings__default-workspace-label` — clone `.settings__server-row-label` (body-large, on-surface).
- `.settings__default-workspace-value` — clone `.settings__server-row-id` (body-small, on-surface-variant, `overflow-wrap: anywhere` — the long-path guard).
- `.settings__default-workspace-chevron` — clone `.settings__pair-another-chevron` (`flex: 0 0 auto; display: block; color: --color-on-surface-variant`).

## State + concurrency model

- **Single source of state** per surface, unchanged: `defaultWorkspaceStore` (the pref, `string | null`) and `recentWorkspacesStore` (the list) are the only state; the row and picker are pure reads. The only write is `setDefaultWorkspace(path)` in the picker's `onChoose` — one mutation path, never two-way-bound (AC / technical notes).
- **Picker open-state** is transient UI state in the `Control`'s `useState`, not the store (ADR 0006, the `ChannelInfoSheet`/`CreateFolderDialog` idiom).
- **Fetch lifecycle:** `RecentWorkspacesData` mounts with the open picker and unmounts on close, so each open fires exactly one `requestRecentWorkspaces` (existing #380 command) and each close tears the subscription down. No app-level mount, no leak past close.
- **Teardown:** the Escape listener detaches on the picker sheet's unmount (the #383 effect cleanup). Choosing or closing flips `open` false, unmounting the whole sheet subtree.
- **No wire traffic on choose.** The choose action writes the store only — no daemon command (AC3). The sole wire call in the flow is the existing recent-workspaces fetch on open.

## Error handling

No new failure surface. `defaultWorkspace` and each `row.path` are opaque daemon/user strings rendered as auto-escaped children — no parse, no path resolution, no injection sink. `recentWorkspaces === null` (fetch in flight) renders the picker's built-in loading branch; `[]` renders its empty-state — both already handled inside `WorkspacePickerSheetView`. `localStorage` failure modes are owned by #403's store and deliberately undefended there (Evidence-Based Fix Selection); nothing new here.

## Testing strategy

`npm test` (vitest, node env, `renderToStaticMarkup` — no jsdom). The pure view is the tested seam; the `Control` + `DefaultWorkspacePickerSheet` are untested reviewed glue (interaction — click-to-open, choose — is not exercisable under `renderToStaticMarkup`, closed by composition; the #383 `WorkspacePickerSheet` container is untested for the same reason).

**New `DefaultWorkspaceRow.test.tsx`** — server-render `DefaultWorkspaceRowView` with injected props (the `ServerRow`/`ArchivedCountRow` idiom):
- with `defaultWorkspace={null}` → markup contains "Default workspace" and the "scratch" placeholder (AC2).
- with `defaultWorkspace='/home/juhana/projects/pyrycode'` → markup contains that path verbatim and **not** "scratch" (AC1 render; AC3 post-choose reflection is the same render path with a non-null value).
- the row is a `<button>` (AC4): markup contains `settings__default-workspace-row` on a `<button` with `type="button"`, and carries no `aria-label=`.
- the trailing chevron is decorative (AC4): the chevron SVG carries `aria-hidden="true"`.

**Extend `SettingsScreen.test.tsx`:**
- renders the "Defaults for new conversations" section heading — `>Defaults for new conversations</h2>`.
- mounts the Default workspace row (placeholder branch) in the Defaults section: under server render the store hydrates to `null`, so markup contains "Default workspace", the "scratch" placeholder, and `settings__default-workspace-row` (button mounted, not static text).
- the picker is closed by default: markup does **not** contain the picker's "Choose workspace" title (open defaults false).
- placement (AC1): `indexOf('Connection') < indexOf('Defaults for new conversations') < indexOf('Storage')` in the rendered markup.

Type coverage via `npm run typecheck`; build gate `npm run build`.

## Open questions

None. All three consumed surfaces (`defaultWorkspaceStore` #403, `recentWorkspacesStore` + `RecentWorkspacesData` #382, `WorkspacePickerSheetView` #383) are merged with stable contracts, and the Figma row maps cleanly onto the existing `.settings__pair-another-*` + `.settings__server-row-text` idioms.
