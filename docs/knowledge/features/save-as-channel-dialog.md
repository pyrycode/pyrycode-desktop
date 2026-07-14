# Save-as-channel dialog

Figma 19:24: a per-row "Save as channel" affordance on [Channel List](channel-list.md) Recent
(unpromoted) rows, opening a dialog that collects a name **and a location choice**, then dispatches
the already-shipped [`promoteConversation` command](conversation-promote.md) with a `cwd` that
depends on that choice. The dialog collects input and dispatches only; it never mutates the list —
the row moving Recent → Channels is [#275](../codebase/275.md)'s job, reacting to the daemon's
`conversation_updated` broadcast.

Built across two tickets against the same Figma node: [#274](../codebase/274.md) (split from #143)
shipped the naming half — title, Name field, Cancel/Save, dispatching `promoteConversation` with
the row's existing `cwd` ("keep in scratch"). [#288](../codebase/288.md) added the **location
choice** — the two radios and the `~/pyry-workspace/channels/<auto-slug>/` preview — plus the
dedicated-folder branch. Renderer-only both times — no new wire verb; #288 reuses
`createWorkspaceFolder`/`workspaceFolderCreated`/`workspaceFolderRejected` (#381/#396) and
[#397](../codebase/397.md)'s `newFolderStore` round-trip, cloning the create→observe→act container
shape [#398](../codebase/398.md) proved first.

## What it does

- Each Recent (unpromoted) row in the Channel List renders a trailing icon-only "Save as channel"
  affordance (`aria-label="Save as channel"`, a Material bookmark glyph — no Figma node pins this
  row-level control; 19:24 is the dialog only). Saved Channel rows render no affordance (AC1).
- Clicking it opens a centered modal dialog (`role="dialog"`, `aria-modal`, `aria-labelledby`): the
  title "Save as channel", a single outlined Name field prefilled with the row's displayed title
  (`titleFor(row.name)` — the `'Untitled'` fallback for a null/blank name), a **location radio
  group**, and a trailing Cancel / Save action pair.
- The location radio group offers exactly two options, one always checked: **"Move to dedicated
  channel folder"** (selected by default) shows a live, illustrative monospace preview line
  (`~/pyry-workspace/channels/<slug>/`, derived from the entered name) beneath it; **"Keep in
  scratch"** has no preview. Both radios (and the Name input) disable while a dedicated-folder
  create is in flight.
- Save is disabled while the name is blank (empty or whitespace-only) or a create is in flight.
- Confirming Save with **"Keep in scratch"** dispatches `promoteConversation{conversation_id:
  row.id, name: name.trim(), cwd: row.cwd}` immediately and closes the dialog — the #274 behavior,
  unchanged.
- Confirming Save with **"Move to dedicated channel folder"** dispatches `createWorkspaceFolder{
  parent: '~/pyry-workspace/channels', name: slugForChannel(name)}`, then — only once the daemon
  replies `workspaceFolderCreated{path}` — dispatches `promoteConversation` with `cwd` set to that
  **returned `path`, verbatim**, never the previewed string (the daemon's `EvalSymlinks` resolution
  of promote's `cwd` rejects a non-existent client-templated path). If the daemon instead replies
  `workspaceFolderRejected`, no promote fires; the dialog stays open with a generic,
  apostrophe-free failure line, and Save re-enables.
- Cancel or dismiss closes the dialog and dispatches nothing, at any point (including mid-create).
- The promoted row's move from Recent to Channels happens later, if at all, when the daemon's
  `conversation_updated` broadcast triggers [#275](conversation-list-store.md)'s list re-request —
  there is no optimistic UI change here, mirroring the [new-discussion FAB](new-discussion-fab.md)'s
  fire-and-forget posture.

## How it works

One module plus a `ChannelList.tsx` container swap, both under
`src/renderer/src/screens/channels/`:

### `SaveAsChannelDialog.tsx`

Three exports — a pure view, two dispatch helpers, and an interaction container (the #398
`CreateFolderDialog` shape):

```ts
export type ChannelLocation = 'dedicated' | 'scratch'

export function SaveAsChannelDialogView(props: {
  name: string
  location: ChannelLocation
  roundTrip: NewFolderRoundTrip          // #397 — injected, never store-read inside the view
  onNameChange: (next: string) => void
  onLocationChange: (next: ChannelLocation) => void
  onCancel: () => void
  onSave: () => void
}): JSX.Element

export function slugForChannel(name: string): string

export function requestPromoteConversation(
  sendCommand: (command: RendererCommand) => void,
  conversationId: string,
  name: string,
  cwd: string                            // externalized by #288 — was `row.cwd` read internally
): void

export function requestCreateChannelFolder(
  sendCommand: (command: RendererCommand) => void,
  channelName: string
): void

export function SaveAsChannelDialog(props: {
  row: ConversationSummary
  onDismiss: () => void                  // Cancel: close only
  onPromoted: () => void                 // scratch-save OR created→promote: close
}): JSX.Element
```

`SaveAsChannelDialogView` mirrors `PermissionModalView`'s overlay → scrim → `role="dialog"` panel
chrome (a fixed `SAVE_AS_CHANNEL_TITLE_ID` ties `aria-labelledby` to the title — safe since only
one instance is ever open). The Name field is a `<label>` wrapping a `<span>` and a controlled
`<input>`. Two native radios share one `name` attribute (`save-as-channel-location`) so the browser
enforces single-select; `location` is the single source of which is `checked` (AC1). The preview
line renders only while `location === 'dedicated'`, as plain auto-escaped text (never
`dangerouslySetInnerHTML`) — illustrative only, never what gets sent to the daemon. `blank =
name.trim() === ''` and `busy = roundTrip.status === 'in-flight'` are both computed inline so
Save/input/radio disabled state is directly assertable in server-rendered markup. A `rejected`
status renders one generic `.save-as-channel__error` line (AC5); no daemon error text ever reaches
it, since `workspaceFolderRejected` is bare (#396) and the copy is a client-owned, apostrophe-free
constant (`renderToStaticMarkup` escapes `'` → `&#x27;`, so an apostrophe would corrupt the
snapshot-testable string).

`slugForChannel` kebab-cases the entered name: any run of non-alphanumerics collapses to one
hyphen (killing `/`, `..`, and whitespace in a single pass), edge hyphens trim, and an empty result
(e.g. a punctuation-only name) falls back to `'channel'` — guaranteed to satisfy the daemon's
single-clean-element name-shape guard (#887) for any input, since the daemon validates but does not
normalize. The preview line and the sent `name` payload both call this function, so they're always
the same string.

`requestPromoteConversation` is the `requestNewConversation` twin: an inline literal typed as
`RendererCommand`, no constructor. `#288` externalized `cwd` into an explicit parameter (it used to
read `row.cwd` internally) so the scratch caller can pass `row.cwd` and the dedicated caller can
pass the daemon-returned path — the same helper, two different sources, no branching inside it.
`requestCreateChannelFolder` is its `createWorkspaceFolder` twin, distinct from #398's version of
the same command because this one pins `parent: '~/pyry-workspace/channels'` and slugs the name.

**`SaveAsChannelDialog` (the container)** owns `name` (seeded once via
`useState(() => titleFor(row.name))` on mount) and `location` (`'dedicated'` default per AC1),
reads `useNewFolderStore(selectNewFolderRoundTrip)`, and mounts `<NewFolderData />` (#397's bridge)
dialog-scoped so the daemon reply actually resolves — without it the store never leaves
`in-flight` and Save hangs. Two effects: a reset-to-idle unmount cleanup (`useEffect(() => () =>
newFolderStore.getState().dispatch({type:'reset'}), [])`) is the single mechanism covering every
close path (Cancel, scratch-save, created→promoted, Escape); a created-effect
(`roundTrip.status === 'created'`) fires `requestPromoteConversation` with `roundTrip.path`
verbatim then calls `onPromoted`. `onSave` branches on `location`: scratch promotes immediately
with `row.cwd` and calls `onPromoted` directly; dedicated dispatches `createRequested` (→
`in-flight`, freezing the Name input and both radios) then `requestCreateChannelFolder` — the
promote itself happens only in the created-effect, never inline in `onSave`.

### `ChannelList.tsx` — `Row` restructure (unchanged from #274)

An interactive control cannot nest inside a `<button>`, so `Row`'s single `<button
className="channel-list__row">` became a flex wrapper (`.channel-list__row` — now `display: flex`)
holding two sibling children: the open action (`.channel-list__row-open`, carrying the old
button-reset/hover/focus rules, `flex: 1 1 auto; min-width: 0` so the title still ellipsizes) and
an optional trailing save affordance. `Row` gained `onSaveAsChannel?: () => void` — Recent rows'
`.map` passes it, the Channels `.map` does not, so the affordance is structurally absent on
promoted rows (AC1), not hidden by CSS.

### `ChannelList.tsx` — container state (#288 moved the dialog's fields into its own container)

`ChannelList` still owns only which row's dialog is open — the transient dialog fields (`name`,
`location`, the round-trip) now live inside `SaveAsChannelDialog` itself:

```ts
const [saveRow, setSaveRow] = useState<ConversationSummary | null>(null)
```

- `onSaveAsChannel={(row) => setSaveRow(row)}` opens the dialog; seeding is now the container's own
  job (`useState(() => titleFor(row.name))` on mount), not `ChannelList`'s.
- The list returns a fragment: the list view, then `saveRow && <SaveAsChannelDialog row={saveRow}
  onDismiss={() => setSaveRow(null)} onPromoted={() => setSaveRow(null)} />` as a sibling.
- `window.pyry` is dereferenced only inside `SaveAsChannelDialog`'s callbacks/effects, and the
  dialog is absent on first paint (`saveRow` starts `null`), so the `renderToStaticMarkup`
  server-render smoke stays green.

### Data flow (scratch branch)

```
Recent row's affordance click → ChannelList: setSaveRow(row)
                                       │
                                       ▼
                     SaveAsChannelDialog container (seeds name, location='dedicated')
                            │                              │
                     Cancel/dismiss           Save with location='scratch'
                            │                              │
                     onDismiss()          requestPromoteConversation(sendCommand, row.id, name, row.cwd)
                     (dispatches nothing)        → [#273] COMMAND_CHANNEL → daemon
                                                  then onPromoted()
                                                            ⋮
                        daemon conversation_updated broadcast → [#275] re-requests the list
                                                                → row moves Recent → Channels
```

### Data flow (dedicated branch — the two-verb dance)

```
Save with location='dedicated'
        │
        ▼
newFolderStore.dispatch({type:'createRequested'})  →  roundTrip: in-flight (Save/input/radios disable)
        │
        ▼
requestCreateChannelFolder(sendCommand, name)
        → createWorkspaceFolder{parent:'~/pyry-workspace/channels', name: slugForChannel(name)}
        → [#381] daemon: expandTilde(parent) + $HOME-confine + MkdirAll + EvalSymlinks
        │
        ├─ workspaceFolderCreated{path} ──▶ roundTrip: created{path}
        │                                        │
        │                                        ▼ (created-effect)
        │                            requestPromoteConversation(sendCommand, row.id, name, path)
        │                                  (path VERBATIM — never the previewed string)
        │                                        │
        │                                        ▼
        │                                    onPromoted()
        │
        └─ workspaceFolderRejected ──▶ roundTrip: rejected
                                             │
                                             ▼
                            .save-as-channel__error line renders; Save re-enables; NO promote
```

### CSS (`channels.css`)

- `.channel-list__save`: icon-only, `flex: 0 0 auto`, round hover/focus target, de-emphasized
  (`--color-on-surface-variant`) vs. the row title.
- `.save-as-channel-overlay`: `position: fixed; inset: 0; z-index: 2` — **fixed, not absolute**,
  because `.channel-list` is itself the `overflow-y: auto` scroll column; an absolute overlay would
  scroll with the rows. `z-index: 2` lifts it above the FAB's own `z-index: 1` sticky stacking
  context (see Lessons learned in [#274 codebase notes](../codebase/274.md)).
- Panel, scrim, title, field, and action-row styles mirror `conversation.css`'s permission-modal
  chrome token-for-token (`--color-surface-container-high`, `--radius-lg`, `--space-*`, `label-large`
  text buttons). Every color/type/spacing is a token; only structural geometry (border widths, the
  panel's fixed `max-width`) is a literal — the file's existing carve-out rule.
- The action row is `justify-end` — Cancel **and** Save both trail, per Figma node 19:39 (the
  `permission-modal`'s leading-dismissive-Cancel layout does not apply here; see Lessons learned in
  [#274 codebase notes](../codebase/274.md)).
- `.save-as-channel__location` / `__option` / `__radio` / `__option-body` / `__option-label` (#288)
  — the radio-group column, option rows, and the codebase's first `accent-color: var(--color-primary)`
  radio input.
- `.save-as-channel__preview` (#288) — monospace, `--color-on-surface-variant`, and deliberately
  `overflow-wrap: anywhere` (a documented deviation from the Figma's `nowrap`) so an arbitrarily
  long slug wraps inside the panel instead of blowing out its width.
- `.save-as-channel__error` (#288) — cloned from `conversation.css`'s `.create-folder__error`.

## Edge cases and limitations

- **A promote the daemon never confirms simply leaves the row in Recent.** No correlation exists
  between the dispatched command and any reply — `conversation_updated` is an unsolicited broadcast,
  per [Conversation promote's correlation-is-absent section](conversation-promote.md#correlation-is-deliberately-absent-the-reply-is-a-broadcast-not-a-response).
  There is no timeout on the promote itself, in either branch.
- **A `createWorkspaceFolder` the daemon never replies to leaves the dialog stuck `in-flight`
  forever** — no timeout exists on this round-trip either (mirrors [#397](new-folder-store.md)'s
  documented limitation). Cancel remains clickable throughout and unmounts the dialog regardless,
  resetting the store to `idle` via the unmount effect — the only way out of a stuck in-flight
  state today.
- **The Name field has no Enter-to-submit or autofocus-select.** Both need DOM (`<form onSubmit>` or
  a ref + effect) and are neither an AC nor node-env-testable; left as a documented, safe additive
  enhancement (spec's Open questions).
- **An unnamed Recent row prefills the `'Untitled'` fallback and Save starts enabled** (it's
  non-blank), per the ticket's explicit reuse of `titleFor`. Forcing a real name for unnamed rows
  (prefilling `''` instead) was flagged as a design choice, not built — matches the ticket as
  written.
- **The rejection line has no `role="alert"`/`aria-live`** — a screen-reader user isn't notified
  when a dedicated-folder create is rejected while focus stays on the re-enabled Save button. Code
  review flagged this as a non-blocking NIT: it mirrors the same pre-existing gap in #398's
  `.create-folder__error`, so cloning it was the consistent choice. A candidate fix if this
  recurs elsewhere and gets addressed as its own follow-up (see #398's own lessons learned).
- **The slug algorithm is client-owned and may not match a future mobile slug spec** — no canonical
  mobile algorithm exists in the vault as of #288; divergence is cosmetic since the promote always
  uses the daemon-returned path regardless of what the slug looked like in the preview.
- **The click→open, typed→controlled-input, and Save-click→dispatch wiring live in the container
  and are not DOM-tested** — the codebase has no jsdom interaction harness for this dialog. Covered
  by pure-function specs (`SaveAsChannelDialogView`'s render/disabled-state assertions,
  `slugForChannel`'s pure-unit cases, `requestPromoteConversation`/`requestCreateChannelFolder`'s
  spy tests) plus composition-level assertions, the same boundary as `PermissionModal`'s click
  wiring and #398's `CreateFolderDialog`.

## Related

- [Conversation promote (transport)](conversation-promote.md) / [#273 codebase notes](../codebase/273.md)
  — the `promoteConversation` command and `PromoteConversationPayload` this dialog dispatches from
  both branches.
- [Conversation list store](conversation-list-store.md) / [#275 codebase notes](../codebase/275.md)
  — the `conversation_updated` re-request that reflects the promoted row into the Channels tier;
  this dialog never mutates the list itself.
- [Channel List home screen](channel-list.md) / [#141 codebase notes](../codebase/141.md) — the
  screen this affordance is added to; documents the `Row` restructure #274 performed.
- [New-discussion FAB](new-discussion-fab.md) / [#242 codebase notes](../codebase/242.md) — the
  sibling fire-and-forget, no-optimistic-UI dispatch precedent the scratch-save branch follows.
- [Create-folder round-trip store](new-folder-store.md) / [#397 codebase notes](../codebase/397.md)
  — the `newFolderStore` + `NewFolderData` bridge this dialog mounts and reads; its second real
  consumer after [#398](../codebase/398.md)'s `CreateFolderDialog`.
- [#398 codebase notes](../codebase/398.md) — the create→observe→act container shape this dialog
  clones, swapping the tail from `requestChangeWorkspace` to `requestPromoteConversation`.
- [#396 codebase notes](../codebase/396.md) — the bare `workspaceFolderRejected` correlation this
  dialog's rejected state ultimately rests on.
- [#381 codebase notes](../codebase/381.md) — the `createWorkspaceFolder` command and
  `workspaceFolderCreated{path}` decode this dialog dispatches and reads in the dedicated branch.
- [#274 codebase notes](../codebase/274.md) — the naming-half implementation summary, patterns,
  lessons.
- [#288 codebase notes](../codebase/288.md) — the location-choice implementation summary, patterns,
  lessons.
- Spec: `docs/specs/architecture/274-save-as-channel-dialog.md` (naming half) and
  `docs/specs/architecture/288-save-as-channel-dialog-location-choice.md` (location choice).
