# Save-as-channel dialog

The naming half of Figma 19:24: a per-row "Save as channel" affordance on [Channel List](channel-list.md)
Recent (unpromoted) rows, opening a dialog that collects a name and dispatches the already-shipped
[`promoteConversation` command](conversation-promote.md) — keeping the discussion in its current
`cwd` (the "keep in scratch" seam). The dialog collects input and dispatches only; it never mutates
the list — the row moving Recent → Channels is [#275](../codebase/275.md)'s job, reacting to the
daemon's `conversation_updated` broadcast.

Introduced in [#274](../codebase/274.md), split from #143. Renderer-only — no
new transport, IPC, store, or wire code; consumes the `promoteConversation` command #273 already
shipped. The two-option location choice ("Move to dedicated channel folder" vs "Keep in scratch")
and the `~/pyry-workspace/channels/<auto-slug>/` preview visible in the same Figma node are deferred
to #288 (not yet shipped) — a deliberate phasing of one dialog across two tickets.

## What it does

- Each Recent (unpromoted) row in the Channel List renders a trailing icon-only "Save as channel"
  affordance (`aria-label="Save as channel"`, a Material bookmark glyph — no Figma node pins this
  row-level control; 19:24 is the dialog only). Saved Channel rows render no affordance (AC1).
- Clicking it opens a centered modal dialog (`role="dialog"`, `aria-modal`, `aria-labelledby`): the
  title "Save as channel", a single outlined Name field prefilled with the row's displayed title
  (`titleFor(row.name)` — the `'Untitled'` fallback for a null/blank name), and a trailing Cancel /
  Save action pair.
- Save is disabled while the name is blank (empty or whitespace-only) and enabled once non-blank.
- Confirming Save dispatches `promoteConversation{conversation_id: row.id, name: name.trim(), cwd:
  row.cwd}` and closes the dialog. Cancel or dismiss closes the dialog and dispatches nothing.
- The promoted row's move from Recent to Channels happens later, if at all, when the daemon's
  `conversation_updated` broadcast triggers [#275](conversation-list-store.md)'s list re-request —
  there is no optimistic UI change here, mirroring the [new-discussion FAB](new-discussion-fab.md)'s
  fire-and-forget posture.

## How it works

One new module plus a `ChannelList.tsx` restructure, both under `src/renderer/src/screens/channels/`:

### `SaveAsChannelDialog.tsx` (new)

Two pure, SSR-testable exports:

```ts
export function SaveAsChannelDialogView(props: {
  name: string
  onNameChange: (next: string) => void
  onCancel: () => void
  onSave: () => void
}): JSX.Element

export function requestPromoteConversation(
  sendCommand: (command: RendererCommand) => void,
  row: ConversationSummary,
  name: string
): void
```

`SaveAsChannelDialogView` mirrors `PermissionModalView`'s overlay → scrim → `role="dialog"` panel
chrome (a fixed `SAVE_AS_CHANNEL_TITLE_ID` ties `aria-labelledby` to the title — safe since only
one instance is ever open). The Name field is a `<label>` wrapping a `<span>` and a controlled
`<input>` — the wrapping label supplies the accessible name with no id/`htmlFor` pair. `blank =
name.trim() === ''` is computed inline so the disabled/enabled Save state is directly assertable in
server-rendered markup (`disabled=""` present or absent).

`requestPromoteConversation` is the `requestNewConversation` twin: an inline literal typed as
`RendererCommand`, no constructor, so the change stays renderer-contained. `name` is trimmed before
send (a promoted channel should not carry accidental edge whitespace); the view already disables
Save on blank, so the helper carries no redundant guard.

**Why `requestPromoteConversation` co-locates with the view, not a `store/*Bridge.ts` module.**
`conversationCreatedBridge.ts` bundles dispatch + a `conversationCreated` subscription + a React
hook because create has a subscription half it owns. Promote's subscription half is the
`conversation_updated` reflect, which already shipped in #275 as part of `conversationListBridge.ts`
— so promote's renderer-side "bridge" here is a single pure dispatch function with no subscription
of its own, kept exported for spy-testing but co-located with its sole caller.

### `ChannelList.tsx` — `Row` restructure

An interactive control cannot nest inside a `<button>`, so `Row`'s single `<button
className="channel-list__row">` became a flex wrapper (`.channel-list__row` — now `display: flex`)
holding two sibling children: the open action (`.channel-list__row-open`, carrying the old
button-reset/hover/focus rules, `flex: 1 1 auto; min-width: 0` so the title still ellipsizes) and
an optional trailing save affordance. `Row` gained `onSaveAsChannel?: () => void` — Recent rows'
`.map` passes it, the Channels `.map` does not, so the affordance is structurally absent on
promoted rows (AC1), not hidden by CSS.

### `ChannelList.tsx` — container state

The `ChannelList` container owns the dialog's transient per-interaction state as plain `useState`
(not the store — the lowest scope that survives re-render, the `PermissionModal`
`pendingOptionId` posture):

```ts
const [saveRow, setSaveRow] = useState<ConversationSummary | null>(null)
const [name, setName] = useState('')
```

- `onSaveAsChannel={(row) => { setSaveRow(row); setName(titleFor(row.name)) }}` opens the dialog
  and seeds the field from the row's displayed title in one handler — no effect, no key-remount;
  re-seeding on each open replaces any prior value.
- The container returns a fragment: the list view, then `saveRow && <SaveAsChannelDialogView …/>}`
  as a sibling. `onCancel` clears `saveRow` (dispatches nothing — AC4). `onSave` calls
  `requestPromoteConversation(window.pyry.sendCommand, saveRow, name)` then clears `saveRow`.
- `window.pyry` is dereferenced only inside the `onSave` closure, and the dialog is absent on first
  paint (`saveRow` starts `null`), so the `renderToStaticMarkup` server-render smoke stays green —
  the `onNewConversation` discipline.

### Data flow

```
Recent row's affordance click → container: setSaveRow(row); setName(titleFor(row.name))
                                       │
                                       ▼
                         SaveAsChannelDialogView (controlled by name state)
                            │                              │
                     Cancel/dismiss                  Save (enabled iff non-blank)
                            │                              │
                     setSaveRow(null)      requestPromoteConversation(window.pyry.sendCommand, saveRow, name)
                     (dispatches nothing)        → [#273] COMMAND_CHANNEL → daemon
                                                  then setSaveRow(null)
                                                            ⋮
                        daemon conversation_updated broadcast → [#275] re-requests the list
                                                                → row moves Recent → Channels
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

## Edge cases and limitations

- **A promote the daemon never confirms simply leaves the row in Recent.** No correlation exists
  between the dispatched command and any reply — `conversation_updated` is an unsolicited broadcast,
  per [Conversation promote's correlation-is-absent section](conversation-promote.md#correlation-is-deliberately-absent-the-reply-is-a-broadcast-not-a-response).
  There is no timeout, retry, or rejection surface in this ticket.
- **The Name field has no Enter-to-submit or autofocus-select.** Both need DOM (`<form onSubmit>` or
  a ref + effect) and are neither an AC nor node-env-testable; left as a documented, safe additive
  enhancement (spec's Open questions).
- **An unnamed Recent row prefills the `'Untitled'` fallback and Save starts enabled** (it's
  non-blank), per the ticket's explicit reuse of `titleFor`. Forcing a real name for unnamed rows
  (prefilling `''` instead) was flagged as a design choice, not built — matches the ticket as
  written.
- **The click→open, typed→controlled-input, and Save-click→dispatch wiring live in the container
  and are not DOM-tested** — the codebase has no jsdom harness. Covered by pure-function specs
  (`SaveAsChannelDialogView`'s render/disabled-state assertions, `requestPromoteConversation`'s spy
  test) plus the `ChannelList.test.tsx` affordance-presence assertions, the same boundary as
  `PermissionModal`'s click wiring.

## Related

- [Conversation promote (transport)](conversation-promote.md) / [#273 codebase notes](../codebase/273.md)
  — the `promoteConversation` command and `PromoteConversationPayload` this dialog dispatches
  unchanged.
- [Conversation list store](conversation-list-store.md) / [#275 codebase notes](../codebase/275.md)
  — the `conversation_updated` re-request that reflects the promoted row into the Channels tier;
  this dialog never mutates the list itself.
- [Channel List home screen](channel-list.md) / [#141 codebase notes](../codebase/141.md) — the
  screen this affordance is added to; documents the `Row` restructure this ticket performed.
- [New-discussion FAB](new-discussion-fab.md) / [#242 codebase notes](../codebase/242.md) — the
  sibling fire-and-forget, no-optimistic-UI dispatch precedent this dialog's Save action follows.
- [#274 codebase notes](../codebase/274.md) — implementation summary, patterns, lessons.
- Spec: `docs/specs/architecture/274-save-as-channel-dialog.md`.
- Follow-up: #288 (not yet shipped) — the two-option location choice + auto-slug preview, landing
  in the same dialog.
