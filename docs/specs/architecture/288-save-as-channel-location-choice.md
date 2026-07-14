# Spec #288 — Save-as-channel dialog: choose the channel location

**Ticket:** [#288](https://github.com/pyrycode/pyrycode-desktop/issues/288) — Save-as-channel dialog: choose the channel location (keep in scratch vs dedicated folder)
**Size:** S · **Label:** `enhancement` (NOT `security-sensitive`) · **UI:** Figma 19-24
**Split from:** #274 (the naming half). **Blocked-on (now merged):** #397 (round-trip store, PR#401), #398 (create-folder dialog, PR#402).

---

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=19-24

A centered M3 dialog (`surface-container-high`, 28px radius): title "Save as channel", the outlined Name field (already shipped by #274), then a **radio group** with two options — **"Move to dedicated channel folder"** (selected by default, with a monospace `~/pyry-workspace/channels/<auto-slug>/` preview line beneath it in `--font-mono` / `on-surface-variant`) and **"Keep in scratch"** (unselected) — and the trailing Cancel / Save text-button row. The `<auto-slug>` token in the preview is a **placeholder**; the developer renders a live slug derived from the entered name. Load-bearing components: reuse `SaveAsChannelDialogView` (extend it), the existing `.save-as-channel*` chrome, and the `#397` `newFolderStore` round-trip. New tokens: `--font-mono` (preview), `--color-primary` (radio `accent-color`).

---

## Files to read first

The developer's turn-1 reading list. Read these before writing code.

- `src/renderer/src/screens/channels/SaveAsChannelDialog.tsx` (whole, 104 lines) — **the file you extend.** `SaveAsChannelDialogView` (pure view to grow: + radios, preview, `roundTrip`) and `requestPromoteConversation` (dispatch helper to widen: + explicit `cwd`). Keep the two-export + SSR-testable posture; add the container as a third export.
- `src/renderer/src/screens/channels/SaveAsChannelDialog.test.tsx` (whole, 104 lines) — the test posture to extend: `renderToStaticMarkup(<View …/>)` for the view (AC1/AC2), a `vi.fn()` spy for the dispatch helper (AC3/AC4). New tests append here.
- `src/renderer/src/screens/conversation/CreateFolderDialog.tsx` (whole, 188 lines) — **the create→observe→act template (#398).** Clone its container shape almost verbatim: owns controlled `name` + reads `useNewFolderStore(selectNewFolderRoundTrip)`, mounts `<NewFolderData />` dialog-scoped, a reset-to-idle unmount effect, and a `roundTrip.status === 'created'` effect that fires the tail action + closes. **The one divergence:** #398's tail is `requestChangeWorkspace(…, created.path)`; #288's tail is `requestPromoteConversation(…, created.path)`, and #288 has a second, no-round-trip **scratch** branch.
- `src/renderer/src/store/newFolderStore.ts` (whole, 112 lines) — the round-trip store you consume. `NewFolderRoundTrip` union (`idle`/`in-flight`/`created{path}`/`rejected`), `useNewFolderStore(selectNewFolderRoundTrip)` read, `newFolderStore.getState().dispatch({type:'createRequested'|'reset'})` write. The reducer gates `folderCreated`/`folderRejected` to honor only while `in-flight` — your stale-reply guard, already built.
- `src/renderer/src/store/newFolderBridge.ts:63-71` — `NewFolderData` headless leaf. Mount it dialog-scoped so the daemon reply (`workspaceFolderCreated`/`workspaceFolderRejected`) folds into the store while this dialog is open. Without it the store never leaves `in-flight` and Save hangs.
- `src/renderer/src/screens/channels/ChannelList.tsx:39-99` — the container region that mounts the dialog. Swap the bare `SaveAsChannelDialogView` mount (lines 77-87) for the new `SaveAsChannelDialog` container; `name` state moves into the container (ChannelList keeps only `saveRow`).
- `src/renderer/src/screens/channels/channelListViewModel.ts` — `titleFor(name: string | null): string`, the initial-name seed (a null-name row → "Untitled" placeholder). The container imports it to seed `name` from the row on mount.
- `src/renderer/src/screens/conversation/conversation.css:185-192` — the monospace muted **path** rule (`--font-mono`, `--color-on-surface-variant`, wrap-safe) — clone for `.save-as-channel__preview`.
- `src/renderer/src/screens/conversation/conversation.css:1925-…` — `.create-folder__error` rule — clone for `.save-as-channel__error`.
- `src/renderer/src/screens/channels/channels.css:326-447` — the existing `.save-as-channel*` block; add the new `__location` / `__option` / `__radio` / `__preview` / `__error` rules alongside it.
- `docs/specs/architecture/887-create-workspace-folder-wire-message.md` (QMD `pyrycode-docs`) — **the daemon contract.** Confirms: the daemon name-shape guard only *validates* `name` is a single clean path element (no `/`, no `..`, not absolute, non-empty) and **does not slug/normalize** — the client owns the slug. `parent` is tilde-expanded server-side; the reply `path` is the canonical realpath. `promote`'s `cwd` runs through `EvalSymlinks` (does **not** expand `~`, rejects non-existent) — the reason the promote must use the returned `path`, never a client-templated string.

---

## Context

The Save-as-channel dialog (#274) collects a name and dispatches `promoteConversation`, keeping the discussion in its current `cwd`. This slice adds the **location choice** from Figma 19:24 so a user can instead move the promoted channel into a dedicated, daemon-created folder under `~/pyry-workspace/channels`.

This is a **pure consumer** of already-shipped transport — no new wire verb, no new command:
- `createWorkspaceFolder{parent, name}` → `workspaceFolderCreated{path}` / `workspaceFolderRejected` (#381, #396).
- `promoteConversation{conversation_id, name, cwd}` (#273).
- The `newFolderStore` round-trip (#397) + its `NewFolderData` bridge, which #398 already proved as the create→observe pattern.

The dedicated branch is a **two-verb dance** (the corrected mechanism, replacing the dead pre-split "client templates the path" premise):

```
createWorkspaceFolder{ parent: ~/pyry-workspace/channels, name: <slug> }
        │  daemon expandTilde(parent) + $HOME-confine + MkdirAll + EvalSymlinks
        ▼
workspaceFolderCreated{ path: <canonical absolute realpath> }
        │
        ▼
promoteConversation{ conversation_id, name, cwd: <that returned path VERBATIM> }
```

The promote `cwd` **must** be the daemon-returned `path`, never the previewed `~/…` string: `promote`'s `cwd` is `EvalSymlinks`-resolved daemon-side, which does not expand `~` and rejects a non-existent path — a client-templated path for a not-yet-created folder would bounce. (`create_workspace_folder.parent` takes a different code path that *does* tilde-expand — which is why the dance works.)

**Architect confirmations resolved** (the two flagged in the ticket):

1. **Parent dir + slug normalization.** Parent = the constant tilde-string `~/pyry-workspace/channels` (matches the Figma preview and #887's `expandTilde(parent)`). The daemon does **not** slug — it only validates single-clean-element (#887 name-shape guard) — so **the client derives the slug and sends it as `name`; the slug is the real on-disk folder name.** No canonical mobile slug algorithm exists in the vault, and the ticket states slug divergence is cosmetic (the promote always uses the daemon-returned path). So we specify a deterministic kebab slug (below) chosen to (a) always satisfy the daemon's single-clean-element guard and (b) match the Figma `<auto-slug>` aesthetic. The channel's *display name* is unchanged (the full typed name); only the *folder* is slugged — mirroring mobile ("names the on-disk folder by an immutable auto-slug, not the display name").
2. **Store observability.** This dialog **observes the round-trip locally** — it mounts `NewFolderData` dialog-scoped and reads `newFolderStore` directly (the #398 posture). The store does **not** need to be made observable from anywhere else. The two consumers (#398 in the conversation Workspace Picker, #288 in the Channel List) can't be open at once, and each resets to `idle` on unmount, so the shared app-singleton never carries stale state between them.

---

## Design

### Module structure — extend the existing dialog file

All new code lands in `SaveAsChannelDialog.tsx` (no new production file). Three exports after this slice mirror #398's CreateFolderDialog shape (pure view + dispatch helper(s) + container):

**1. `SaveAsChannelDialogView` — pure view, extended.** New props on the existing signature:

```ts
type ChannelLocation = 'dedicated' | 'scratch'

SaveAsChannelDialogView({
  name, location, roundTrip,
  onNameChange, onLocationChange, onCancel, onSave
}: {
  name: string
  location: ChannelLocation
  roundTrip: NewFolderRoundTrip        // from #397; drives busy/error display
  onNameChange: (next: string) => void
  onLocationChange: (next: ChannelLocation) => void
  onCancel: () => void
  onSave: () => void
}): JSX.Element
```

Behaviour (all computed inline so it is directly assertable in server-rendered markup):
- **Radio group** (`role`-native `<input type="radio">` sharing one `name`): "Move to dedicated channel folder" (`value="dedicated"`, `checked` when `location==='dedicated'`) and "Keep in scratch" (`value="scratch"`). Exactly one checked — `location` is the single source (AC1). `onChange` → `onLocationChange`.
- **Preview line** — rendered **only when `location==='dedicated'`**: the string `` `${CHANNELS_PARENT}/${slugForChannel(name)}/` `` in `.save-as-channel__preview` (monospace), updating live as `name` changes (AC2). Plain text (auto-escaped), never `dangerouslySetInnerHTML`.
- **`busy = roundTrip.status === 'in-flight'`**: disables the Name input **and** both radios (freezes the choice mid-create).
- **Save disabled** when `name.trim() === '' || busy` (blank-name gate from #274, plus the in-flight gate).
- **Error line** — rendered when `roundTrip.status === 'rejected'`: a single generic `.save-as-channel__error` line (AC5).

The view is dumb: it calls `onSave()` and lets the container branch on `location`.

**2. `requestPromoteConversation` — widen to take an explicit `cwd`.** Today it reads `row.cwd` internally; the dedicated branch must pass the daemon-returned path instead. Externalize `cwd`:

```ts
requestPromoteConversation(
  sendCommand: (c: RendererCommand) => void,
  conversationId: string,
  name: string,
  cwd: string
): void   // dispatches promoteConversation{ conversation_id: conversationId, name: name.trim(), cwd }
```

(Developer's call whether the first arg stays `row: ConversationSummary` and reads `row.id`, or becomes `conversationId` — the id + explicit `cwd` shape is preferred for 1:1 payload mapping. Either way, `cwd` becomes a parameter.) The scratch caller passes `row.cwd`; the dedicated caller passes `created.path`.

**3. `SaveAsChannelDialog` — new container** (clone `CreateFolderDialog`, swap the tail). Owns the interaction; `window.pyry` dereferenced only in callbacks/effects, never render:

```ts
SaveAsChannelDialog({
  row, onDismiss, onPromoted
}: {
  row: ConversationSummary
  onDismiss: () => void      // Cancel: close the dialog only
  onPromoted: () => void     // scratch-save OR created→promote: close the dialog
}): JSX.Element
```

- `const [name, setName] = useState(() => titleFor(row.name))` — seeded from the row on mount (the container mounts fresh each open, so no re-seed effect needed).
- `const [location, setLocation] = useState<ChannelLocation>('dedicated')` — default per AC1/Figma.
- `const roundTrip = useNewFolderStore(selectNewFolderRoundTrip)`.
- Reset-to-idle unmount effect: `useEffect(() => () => newFolderStore.getState().dispatch({ type: 'reset' }), [])` — covers every close path (Cancel / scratch-save / created / Escape).
- **`onSave` branch:**
  - `location === 'scratch'` → `requestPromoteConversation(sendCommand, row.id, name, row.cwd)` then `onPromoted()` (AC3 — the #274 behaviour, unchanged).
  - `location === 'dedicated'` → `newFolderStore.getState().dispatch({ type: 'createRequested' })` (→ `in-flight`) then `requestCreateChannelFolder(sendCommand, name)` (AC4 first half). Do **not** promote here — the created-effect does.
- **Created-effect** (AC4 second half): `useEffect(() => { if (roundTrip.status !== 'created') return; requestPromoteConversation(sendCommand, row.id, name, roundTrip.path); onPromoted() }, [roundTrip, row.id, name, onPromoted])`. Reads `roundTrip.path` (never the previewed string); `name` is frozen because the input is disabled while `in-flight`, so it holds the value typed before Save.
- Renders `<NewFolderData />` + `<SaveAsChannelDialogView …/>`.

### New helpers (exported for tests)

```ts
// Tilde-string; the daemon expands it server-side (#887). Not resolved in the renderer.
const CHANNELS_PARENT = '~/pyry-workspace/channels'

// Kebab slug, guaranteed single-clean-element + non-empty → always passes the daemon
// name-shape guard (#887). Divergence from mobile's slug is cosmetic (ticket).
slugForChannel(name: string): string
//   name.trim().toLowerCase()
//     .replace(/[^a-z0-9]+/g, '-')   // any run of non-alnum → one hyphen (kills '/', '..', spaces)
//     .replace(/^-+|-+$/g, '')       // trim edge hyphens
//   → '' ? 'channel' : slug          // non-empty fallback (e.g. a punctuation-only name)

// Inline command literal (the codebase's no-constructor idiom); folds the fixed parent
// + slug transform. Distinct from #398's requestCreateWorkspaceFolder (which passes name
// raw) because this one slugs and pins the channels parent.
requestCreateChannelFolder(
  sendCommand: (c: RendererCommand) => void,
  channelName: string
): void   // sendCommand({ type: 'createWorkspaceFolder', payload: { parent: CHANNELS_PARENT, name: slugForChannel(channelName) } })
```

The preview line uses `slugForChannel` too, so the previewed folder name and the sent `name` are the same string.

### ChannelList wiring (`ChannelList.tsx`)

- Drop the `const [name, setName] = useState('')` pair and the inline `setName(titleFor(row.name))` seed in `onSaveAsChannel` (name moves into the container).
- Keep `const [saveRow, setSaveRow] = useState<ConversationSummary | null>(null)`; `onSaveAsChannel={(row) => setSaveRow(row)}`.
- Replace the `{saveRow && <SaveAsChannelDialogView …/>}` block with:
  `{saveRow && <SaveAsChannelDialog row={saveRow} onDismiss={() => setSaveRow(null)} onPromoted={() => setSaveRow(null)} />}`.
- Update the import to bring in `SaveAsChannelDialog` (drop the direct `SaveAsChannelDialogView` + `requestPromoteConversation` imports if ChannelList no longer references them directly).

### CSS (`channels.css`, alongside the existing `.save-as-channel*` block)

- `.save-as-channel__location` — the radio-group column (Figma 19:29): `display:flex; flex-direction:column; gap: var(--space-2)`.
- `.save-as-channel__option` — a radio row (Figma 19:30/19:36): `display:flex; gap: var(--space-3); align-items:flex-start; padding: var(--space-1) var(--space-2)`.
- `.save-as-channel__radio` — the native input: `accent-color: var(--color-primary)` (the codebase's first radio — token-based, no color literal), `margin:0`.
- `.save-as-channel__option-label` — body-large `--color-on-surface` (mirror `.save-as-channel__input` typography tokens).
- `.save-as-channel__preview` — clone `conversation.css:185-192` (monospace, `--font-mono`, `--color-on-surface-variant`, wrap-safe so a long slug can't blow out the panel).
- `.save-as-channel__error` — clone `conversation.css:1925` (`.create-folder__error`).

---

## State + concurrency model

- **Single source of state per store.** The round-trip lives entirely in the `#397` `newFolderStore` (app singleton) — this dialog dispatches (`createRequested`, `reset`) and reads (`selectNewFolderRoundTrip`); it never mirrors the status in local state. `name` and `location` are transient controlled-UI state → component-local `useState` (ADR 0006), the lowest scope that survives re-render.
- **Dialog-scoped bridge.** `NewFolderData` mounts inside the container, so the `onDaemonEvent` listener lives exactly while the dialog is open (the `RecentWorkspacesData` picker-scoped shape). Its effect cleanup unsubscribes on close — no leaked listener.
- **Stale-reply safety.** The store reducer honors `folderCreated`/`folderRejected` only while `in-flight` (built in #397). Because `workspaceFolderRejected` is bare (no correlation key), this in-flight gate is the sole guard; the scratch branch never dispatches `createRequested`, so the store stays `idle` and the created-effect never fires in scratch mode.
- **Teardown.** The reset-to-idle unmount effect guarantees every open starts from `idle`, so a prior rejected/created state never bleeds into the next open. The created-effect reads `roundTrip.path` *before* `onPromoted()` unmounts the dialog, so the promote never races the reset. Fire-and-forget commands (`sendCommand` returns `void`); no promises outlive the dialog.
- **Re-render seam.** `useNewFolderStore(selectNewFolderRoundTrip)` selects the single `roundTrip` slice, so only this dialog re-renders on a transition (never the channel list).

---

## Error handling

| Failure | Surfaced as | Promote? |
|---------|-------------|----------|
| `workspaceFolderRejected` (bad slug / fs error) | store → `rejected`; view shows the generic `.save-as-channel__error` line; Save re-enabled (no longer `busy`); dialog stays open (AC5) | **No** — store never reaches `created`, so the created-effect never fires |
| No reply (daemon silent) | store stays `in-flight`; Save + input + radios stay disabled | No |
| Cancel while in-flight | Cancel is always enabled; `onDismiss` closes; unmount effect resets store to `idle`; any late reply after unmount is dropped (listener gone) | No |
| Scratch save (no round-trip) | promote fires immediately with `row.cwd`; no store involvement | Yes (AC3) |

The error copy is **client-owned, generic, and apostrophe-free** (e.g. "Could not create that folder") — `renderToStaticMarkup` escapes `'` → `&#x27;`, and `workspaceFolderRejected` is bare, so **no daemon error text is ever read or rendered** (the #398 precedent). Never `console.log` the returned path or the preview.

---

## Testing strategy

`npm test` (vitest) + `npm run typecheck`. Extend `SaveAsChannelDialog.test.tsx`; keep the SSR-view + spy-helper posture. Scenarios (bulleted inputs → expected; developer writes them in the project idiom):

**View (`renderToStaticMarkup`, injected props):**
- Renders both radios; `location='dedicated'` → the dedicated radio is `checked`, scratch is not; `location='scratch'` → the inverse (AC1). Exactly one `checked` in each case.
- `location='dedicated'` → the preview line renders and contains `~/pyry-workspace/channels/<slug>/` for a given name (e.g. `'Investment Strategy Review'` → `investment-strategy-review`), updating with `name` (AC2). `location='scratch'` → no preview line.
- `roundTrip.status='in-flight'` → Save disabled, Name input disabled, both radios disabled. `roundTrip.status='idle'` with a non-blank name → Save enabled.
- `roundTrip.status='rejected'` → the `.save-as-channel__error` line renders; other statuses → absent.
- Blank / whitespace name → Save disabled (AC preserved from #274). Prefilled name renders as escaped attribute text (the `Tom & Jerry` → `Tom &amp; Jerry` assertion carries over).

**`slugForChannel` (pure unit):**
- `'Investment Strategy Review'` → `'investment-strategy-review'`; leading/trailing spaces trimmed; `'UI/UX Notes'` → `'ui-ux-notes'` (no `/`); `'a..b'` → `'a-b'` (no `..`); `'!!!'` → `'channel'` (non-empty fallback); result matches `/^[a-z0-9]+(-[a-z0-9]+)*$/` for any non-blank input (single-clean-element invariant, #887).

**Dispatch helpers (`vi.fn()` spy):**
- `requestPromoteConversation(spy, 'conv-42', 'My Channel', '/daemon/returned/path')` → exactly one `promoteConversation` with `{conversation_id:'conv-42', name:'My Channel', cwd:'/daemon/returned/path'}`; trims edge whitespace on `name`.
- `requestCreateChannelFolder(spy, 'Investment Strategy Review')` → exactly one `createWorkspaceFolder` with `{parent:'~/pyry-workspace/channels', name:'investment-strategy-review'}`.

**Container (jsdom render, if the existing suite runs container interaction — else prove by composition per the #274/#398 posture):**
- Scratch + Save → fires `promoteConversation` with `row.cwd`, no `createWorkspaceFolder`, calls `onPromoted` (AC3).
- Dedicated + Save → dispatches `createRequested` (store → `in-flight`) and fires `createWorkspaceFolder`; no promote yet. Then feeding a `folderCreated{path}` into the store → the created-effect fires `promoteConversation` with the returned `path` (not the previewed string) and calls `onPromoted` (AC4).
- Dedicated + Save, then `folderRejected` → store `rejected`, **no** `promoteConversation`, `onPromoted` not called, dialog still mounted (AC5).

---

## Open questions

- **Slug ↔ mobile parity.** No canonical mobile slug algorithm is recorded in the vault; the kebab rule above is chosen for daemon-safety + Figma aesthetic, and the ticket declares slug divergence cosmetic (the promote uses the daemon-returned path). If a mobile slug spec surfaces later, aligning is a one-function change with no wire impact.
- **Container interaction tests.** Whether the existing channels suite exercises container interaction in jsdom or proves the wiring by composition (the #274 posture) — the developer follows whichever the neighbouring `RenameConversationDialog`/`CreateFolderDialog` tests use.
</content>
</invoke>
