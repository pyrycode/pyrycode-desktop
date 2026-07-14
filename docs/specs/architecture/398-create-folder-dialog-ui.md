# #398 — Create-folder dialog UI for the Workspace Picker

**Size:** S (confirmed — 2 production files, 3 new exports, ~370 LOC total incl. tests + CSS, 0 consumer fan-out, no branch overlap).
**Security:** Not security-sensitive. Renderer UI only; no keys, sockets, or raw bytes. It dispatches the already-guarded `createWorkspaceFolder` (boundary crossed on #381; the daemon polices `parent`/`name`) and reuses `changeWorkspace` (boundary crossed on #379). No `security-review` step.

This is split-child **C** of #384. Its two upstream dependencies are merged: the round-trip store + dormant bridge (#397, `dcaec74`) and the transport command (#381). This slice supplies the handler the picker's inert "Other" entry has been waiting for (#383).

---

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=19-44

A centred M3 dialog (surface-container-high fill, 28px radius, 24px padding, a column with 16px gaps) titled **"Create workspace"** (headline-small), an outlined field frame whose label reads **"What should this workspace be called?"** (label-medium) over an empty body-large input value, and a right-aligned action row of two primary-colored text buttons, **Cancel** then **Create** (label-large). It is visually the same dialog chrome as the Rename dialog (Figma 19-14, `.rename-conversation__*`) — reuse that shape; only the title, field label, and the added in-flight/rejected states differ. Figma shows no error line (the rejected state is a spec-added behavior, AC5).

---

## Files to read first

- `src/renderer/src/screens/channels/RenameConversationDialog.tsx` (whole, 111 lines) — **the clone source.** The pure `…DialogView` (props-in / markup-out, blank-name disables the confirm) + the exported `request…` dispatch helper (inline `RendererCommand` literal, trims the name). Reproduce this exact two-export shape.
- `src/renderer/src/screens/channels/RenameConversationDialog.test.tsx` (whole, 132 lines) — **the test shape to clone.** Server-render the view with injected props; assert on markup substrings (`role="dialog"`, `value="…"`, `/__save"[^>]*disabled/`); a spy-based helper test. Your `CreateFolderDialog.test.tsx` mirrors this file structure.
- `src/renderer/src/screens/conversation/WorkspacePickerSheet.tsx` (whole, 251 lines) — the file you modify. Note `WorkspacePickerSheetView` (the `onCreateFolder?` seam at lines 92–99, 175–185, currently `disabled={!onCreateFolder}`), `WORKSPACE_PICKER_CREATE_LABEL` (line 31, the placeholder to replace), `requestChangeWorkspace` (lines 45–51, reused verbatim for AC4), and the `WorkspacePickerSheet` container (lines 196–250, where `RecentWorkspacesData` is mounted picker-scoped — mount `CreateFolderDialog` the same way).
- `src/renderer/src/store/newFolderStore.ts` (whole, 113 lines) — the round-trip store you read. `NewFolderRoundTrip` union (`idle | in-flight | created{path} | rejected`), `useNewFolderStore(selectNewFolderRoundTrip)`, the singleton `newFolderStore` (dispatch `createRequested` / `reset`), the in-flight gate lives in the reducer (AC3).
- `src/renderer/src/store/newFolderBridge.ts` (whole, 71 lines) — the **DORMANT** `NewFolderData` headless leaf you must mount (it is the only path folding `workspaceFolderCreated`/`workspaceFolderRejected` into the store; nothing mounts it yet).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:1052–1136` — the `ChannelInfoSheet` container + its mounted `RenameConversationDialogView` (lines 1123–1133). **The exact wiring precedent**: a sheet container owns a dialog's open-state + controlled `name` useState, dereferences `window.pyry` only inside interaction callbacks, and mounts the pure dialog view as a sibling. Clone this posture into `WorkspacePickerSheet`.
- `src/renderer/src/screens/channels/channels.css:454–575` — the `.rename-conversation*` CSS block (overlay, scrim, panel, title, field, label, input, actions, buttons, disabled). Clone it as `.create-folder*` into `conversation.css`.
- `src/renderer/src/screens/conversation/conversation.css:1700–1827` — the `.workspace-picker__other*` block (the create entry's existing styling) + the end of the file (append the new `.create-folder*` block here).
- `src/renderer/src/theme/tokens.css:33` (`--color-error: #ffb4ab`) and `:67–70` (`--text-body-medium-*`) — the tokens the rejected line uses (the `.bubble--stall` error-text precedent at `conversation.css:372`). `--color-error` is the only error-role token on desktop.
- `docs/specs/architecture/397-*.md` (if present) — the round-trip store's own spec, for the store contract this dialog drives.

---

## Context

The Workspace Picker sheet (#383) renders a "Create new folder" entry in its "Other" section that is inert: the container omits `onCreateFolder`, so the entry renders `disabled`, and the label is a generic placeholder. This slice supplies the handler. Activating the entry opens a validated text dialog that:

1. sends `createWorkspaceFolder` under the active conversation's current workspace,
2. reflects the daemon round-trip (in-flight → created / rejected) via the #397 store, and
3. on success switches the conversation to the **returned** folder path and closes both surfaces.

Everything downstream already exists — the command (#381), the store + dormant bridge (#397), the `requestChangeWorkspace` reflect helper (#383). This ticket is the last mile: a new dialog file plus the picker-side wiring that mounts it.

---

## Design

### Module structure

Two files change; no interface renames, no consumer fan-out (the `onCreateFolder?` prop already exists on the view — we supply it, not add it).

**NEW — `src/renderer/src/screens/conversation/CreateFolderDialog.tsx`** (co-located with its sole consumer, the picker). Three exports, mirroring the Rename dialog's two-export shape plus one container (the ChannelInfoSheet precedent):

1. `CreateFolderDialogView` — pure, props-in / markup-out, server-renderable, **no store read / no effects / no `window.pyry`**. This is the tested surface. Takes the round-trip state as an injected prop (the RepairPrompt / ConnectionBanner discipline — a pure view takes derived store state as a prop so all four union states are server-renderable), never reading the store itself.

   ```ts
   export function CreateFolderDialogView(props: {
     name: string
     roundTrip: NewFolderRoundTrip        // injected; drives disabled/error display
     onNameChange: (next: string) => void
     onCancel: () => void
     onCreate: () => void
   }): JSX.Element
   ```

   Behavior (assert each in tests, don't inline the body):
   - Renders `role="dialog"`, `aria-modal="true"`, `aria-labelledby` → a fixed title id (the `RENAME_CONVERSATION_TITLE_ID` idiom; one dialog open at a time). Title text **"Create workspace"**.
   - Renders the outlined field: label **"What should this workspace be called?"** over a controlled `<input value={name}>` (auto-escaped — never `dangerouslySetInnerHTML`).
   - Action row: **Cancel** (→ `onCancel`) then **Create** (→ `onCreate`), right-aligned.
   - `const blank = name.trim() === ''`; `const busy = roundTrip.status === 'in-flight'`. **Create** is `disabled={blank || busy}` (AC2 blank + AC3 in-flight); the **input** is `disabled={busy}` (AC3). Compute inline so `disabled` presence is directly assertable in server-rendered markup.
   - When `roundTrip.status === 'rejected'`: render a single failure line with the client-owned constant `CREATE_FOLDER_ERROR_COPY = 'Could not create that folder'` (apostrophe-free — `renderToStaticMarkup` escapes `'`; AC5). It reads **no daemon error text** (`workspaceFolderRejected` is bare; #396). Any other status renders no error line.

2. `requestCreateWorkspaceFolder` — the exported, unit-tested dispatch helper (the `requestRenameConversation` / `requestChangeWorkspace` twin: an inline `RendererCommand` literal, no constructor, send-only, `void`).

   ```ts
   export function requestCreateWorkspaceFolder(
     sendCommand: (command: RendererCommand) => void,
     parent: string,   // the active conversation's cwd, verbatim
     name: string      // trimmed inside the helper
   ): void
   // → sendCommand({ type: 'createWorkspaceFolder', payload: { parent, name: name.trim() } })
   ```

   Both fields are renderer strings the daemon polices server-side (#381/#887). The blank-name disable in the view is the **only** client-side gate — do **not** add a separator / `..` / absolute-path check (per ticket, a UX mirror of the rename clone).

3. `CreateFolderDialog` — the in-file **container** (exported so the picker imports it; the ChannelInfoSheet-mounted-in-ConversationScreen idiom). Owns the controlled `name` state, reads the store, mounts the dormant bridge, and owns the created-outcome side effect. See **State + concurrency** below.

   ```ts
   export function CreateFolderDialog(props: {
     conversation: ConversationCreatedPayload   // non-null — the caller gates the mount
     onDismiss: () => void   // Cancel: close the dialog only, picker stays open (AC2)
     onCreated: () => void   // created: close the picker (and the dialog with it) (AC4)
   }): JSX.Element
   ```

**MODIFY — `src/renderer/src/screens/conversation/WorkspacePickerSheet.tsx`:**

- In `WorkspacePickerSheetView`: replace the `WORKSPACE_PICKER_CREATE_LABEL` placeholder render with a parent-specific label derived from `activeCwd`. When `activeCwd !== null` → `` `Create new folder under ${activeCwd}` `` (a new `WORKSPACE_PICKER_CREATE_PREFIX = 'Create new folder under '` constant; `activeCwd` is an untrusted daemon string rendered as auto-escaped React children, never resolved as a path — the existing `row.path` posture). When `activeCwd === null` (no active conversation, the disabled state) → keep the generic `WORKSPACE_PICKER_CREATE_LABEL` (`'Create new folder…'`, U+2026). The gate stays `disabled={!onCreateFolder}`; `onCreateFolder` presence and `activeCwd !== null` both track "active conversation", so enabled ⟺ named-workspace label (AC1). No signature change — `activeCwd` and `onCreateFolder?` are already view props.
- In the `WorkspacePickerSheet` container: add `const [createFolderOpen, setCreateFolderOpen] = useState(false)`; supply `onCreateFolder={conversation === null ? undefined : () => setCreateFolderOpen(true)}` (gated exactly like `onChoose`, AC1); and mount the dialog as a sibling of the view:
  ```tsx
  {createFolderOpen && conversation !== null && (
    <CreateFolderDialog
      conversation={conversation}
      onDismiss={() => setCreateFolderOpen(false)}
      onCreated={onClose}   // the picker's own onClose (from ConversationScreen) → tears down the whole picker
    />
  )}
  ```
  `onCreated` is the picker's existing `onClose` prop — closing the picker unmounts `WorkspacePickerSheet`, and the dialog with it, so "both the dialog and the picker close" (AC4) is one call. **ConversationScreen is untouched** — `onClose={() => setPickerOpen(false)}` already flows in.

### Data flow (the round-trip)

```
user clicks "Create new folder under <cwd>"   → setCreateFolderOpen(true)
CreateFolderDialog mounts: <NewFolderData/> subscribes; store = idle
user types name, clicks Create
  → newFolderStore.dispatch({type:'createRequested'})   (→ in-flight; disables Create+input, AC3)
  → requestCreateWorkspaceFolder(sendCommand, conversation.cwd, name)   (sends the command)
daemon replies over the internal channel:
  workspaceFolderCreated{path}  → NewFolderData → store.dispatch(folderCreated) → status='created'{path}
  workspaceFolderRejected       → NewFolderData → store.dispatch(folderRejected) → status='rejected'
created effect fires:
  → requestChangeWorkspace(sendCommand, conversation.id, roundTrip.path)   (switch, VERBATIM path, AC4)
  → onCreated()   (close picker → unmount → cleanup dispatches reset → store=idle)
rejected: view shows the failure line, stays open; a fresh Create re-dispatches createRequested (rejected→in-flight, AC5)
```

**The switch uses the returned `roundTrip.path` VERBATIM** — never `parent + '/' + name` or a `~/`-templated reconstruction. A client-built path is `EvalSymlinks`-rejected daemon-side (the #288 / promote lesson); the daemon's own `path` is the only value `changeWorkspace.cwd` will accept.

---

## State + concurrency model

- **Store:** the app-singleton `newFolderStore` (#397), read via `useNewFolderStore(selectNewFolderRoundTrip)` in the container. Single source of truth; unidirectional (dispatch only, no two-way binding). The reducer's in-flight gate (AC3) is the sole guard against a stale/unsolicited bare `workspaceFolderRejected` flipping state — the dialog relies on it, adds none of its own.
- **Dialog open-state:** `createFolderOpen` is screen-local `useState` in the picker container (ADR 0006 — transient UI state, never the store). The controlled `name` is `useState('')` in the `CreateFolderDialog` container (the `renameName` precedent). Both reset for free on unmount.
- **Bridge lifecycle (mount it or the store never resolves):** `CreateFolderDialog` mounts `<NewFolderData />` (a headless leaf, renders null) so the daemon-reply listener lives exactly while the dialog is open — the `RecentWorkspacesData` picker-scoped shape. Without this the store never leaves `in-flight` and the dialog hangs forever. `window.pyry` is dereferenced only inside `NewFolderData`'s effect, never during render, so the container still server-renders bridge-free.
- **Created side effect:** a `useEffect` in the container watching the round-trip:
  ```ts
  useEffect(() => {
    if (roundTrip.status !== 'created') return
    requestChangeWorkspace(window.pyry.sendCommand, conversation.id, roundTrip.path)
    onCreated()
  }, [roundTrip, conversation.id, onCreated])
  ```
  Reacting to a store transition with a side effect is the idiomatic seam (the container is the only place holding `window.pyry` + `conversation.id` + `onCreated`). The command is idempotent (same `cwd`), so a stray re-fire on a dep-identity change before unmount is harmless; in practice `onCreated()` unmounts the dialog immediately.
- **Reset (→ idle) via unmount cleanup — the single, deterministic mechanism covering every close path:**
  ```ts
  useEffect(() => () => newFolderStore.getState().dispatch({ type: 'reset' }), [])
  ```
  Because the store is an app singleton, any close that left it non-idle (a `rejected` the user cancelled out of, an `in-flight` the user abandoned by closing the picker) would show stale state on the next open. Resetting on unmount guarantees every open starts from `idle` — and satisfies AC4's "reset to idle" on the created path (created → `onCreated()` closes the picker → dialog unmounts → cleanup resets). One mechanism, all paths (Cancel, created, Escape/scrim-closing-the-picker). The `created` effect reads `roundTrip.path` and sends the switch **before** `onCreated()` triggers the unmount, so the reset never races the path read.
- **Abandon-mid-flight is correct:** closing the picker while `in-flight` unmounts both the dialog and `NewFolderData`; a later daemon reply has no listener and is dropped, and cleanup has reset the store. The folder may still be created daemon-side (it surfaces in Recent next open) but no switch fires — the intended "close = abandon" semantics.
- **No new store, no new IPC verb, no bridge changes.** This is renderer glue over existing surfaces.

---

## Error handling

| Failure mode | Where surfaced | How |
|---|---|---|
| Daemon rejects the create (`workspaceFolderRejected`, bare) | dialog, in place | Store → `rejected`; view renders `CREATE_FOLDER_ERROR_COPY` (generic, apostrophe-free, **no daemon text** — the reply carries none). Dialog stays open; a fresh Create re-dispatches `createRequested` (rejected → in-flight) for retry (AC5). |
| Blank / whitespace-only name | dialog, pre-send | `Create` is `disabled` (`name.trim() === ''`); no command sent (AC2). The only client-side gate. |
| Stale / unsolicited daemon reply | store reducer | The in-flight gate (#397) ignores `folderCreated`/`folderRejected` unless `in-flight`; ignored events return the same state object (no re-render). |
| User abandons mid-flight (closes picker) | — | Dialog + bridge unmount; reply dropped; store reset to idle. No orphaned switch. |
| No active conversation | picker entry | `onCreateFolder` omitted → the "Other" entry renders `disabled` with the generic label; the dialog cannot open without the `conversation_id` the switch needs (AC1). |

`createWorkspaceFolder` and `changeWorkspace` are fire-and-forget (`sendCommand` returns `void`); no try/catch — the daemon polices both payloads and any failure returns over the round-trip, not as a thrown error.

---

## Testing strategy (`npm test`, vitest; `npm run typecheck`)

Mirror `RenameConversationDialog.test.tsx`: server-render the pure view with `renderToStaticMarkup` and injected props (the `node` env fires no clicks / runs no effects), and spy-test the dispatch helper. The container (bridge mount, created effect, `window.pyry` dispatch) is untested reviewed glue — exactly like the ChannelInfoSheet container.

**NEW `CreateFolderDialog.test.tsx` — `CreateFolderDialogView`:**
- Renders an accessible modal dialog labelled by its title, titled "Create workspace" (AC1).
- Renders the field label "What should this workspace be called?" and a Cancel + Create action row (AC1).
- Create disabled when `name` is empty; disabled when whitespace-only; enabled with a non-blank name at `idle` (AC2). Assert on the Create button's tag specifically (`/create-folder__create"[^>]*disabled/`).
- Create **and** input disabled when `roundTrip.status === 'in-flight'` (AC3).
- `rejected` renders the generic failure line (`Could not create that folder`) — assert the copy is present and apostrophe-free; `idle` / `created` / `in-flight` render **no** failure line (AC5).
- The `name` renders as an escaped attribute value, never live markup (`Tom & Jerry` → `Tom &amp; Jerry`) — the untrusted-input posture (AC5).

**NEW `CreateFolderDialog.test.tsx` — `requestCreateWorkspaceFolder`:**
- Fires exactly one `createWorkspaceFolder` with `{ parent, name }`, `parent` verbatim, `name` trimmed (AC3).
- Trims edge whitespace before dispatching (AC3).

**MODIFY `WorkspacePickerSheet.test.tsx`:**
- The existing "Other entry present but inert when `onCreateFolder` omitted" test stays green (still `disabled`).
- Add: with `onCreateFolder` supplied and `activeCwd='~/alpha'`, the create entry is **enabled** and its label contains `Create new folder under ~/alpha` (AC1). (The view derives the label from `activeCwd`; supply both props.)
- Add: with `activeCwd={null}`, the create entry shows the generic `Create new folder…` label (the disabled state).

AC4's switch dispatch is already covered by `requestChangeWorkspace`'s existing test (#383); the created-effect wiring that calls it is glue.

---

## Scope self-check (pre-commit)

Production `.ts`/`.tsx` files (new or modified, excluding tests / `.md` / spec): **2** — `CreateFolderDialog.tsx` (new), `WorkspacePickerSheet.tsx` (modified). Under the ≥5 split threshold. `conversation.css` (clone the `.rename-conversation*` block as `.create-folder*` + one `.create-folder__error` line using `--color-error` / `--text-body-medium-*`) and the two `.test.tsx` files are not production `.ts`/`.tsx`. New exports: 3 (`CreateFolderDialogView`, `requestCreateWorkspaceFolder`, `CreateFolderDialog`). No interface/type renames, no consumer fan-out. Confirmed **S**.

---

## Open questions

1. **CSS namespace.** Spec assumes a fresh `.create-folder*` block in `conversation.css` (co-located with the dialog), cloned from `.rename-conversation*`. Reusing `.rename-conversation*` directly would avoid new CSS but couples a `conversation/` component to `channels.css`. The clone is the recommended, self-contained choice — it also gives a home for the new `.create-folder__error` line. Developer may reuse if they judge the coupling acceptable; the tests assert on `create-folder__*` class markers either way, so pick the namespace before writing the view.
2. **In-flight affordance beyond disabling.** AC3 requires only that Create + input are disabled while in-flight. A visible busy label ("Creating…") is optional polish, not an AC — omit unless trivially free.
3. **Dialog Escape.** The dialog adds no own Escape handler (matching the Rename clone). The picker container's existing Escape listener closes the whole picker (and the dialog with it) — consistent with the ChannelInfoSheet + Rename-dialog precedent. No change needed.
