# Spec: Save-as-channel dialog — name a discussion and promote it (#274)

The naming half of Figma 19:24. Adds a per-row "Save as channel" affordance to Recent (unpromoted)
discussions and a small dialog that collects a name and dispatches the already-shipped
`promoteConversation` command (#273), keeping the discussion in its current workspace. The location
choice (two radios + auto-slug preview) is deferred to #288. This slice collects input and dispatches —
it does not mutate the list; the row moving Recent → Channels is reflected by #275 on the daemon's
`conversation_updated` broadcast.

## Files to read first

- `src/renderer/src/screens/channels/ChannelList.tsx` (whole, 163 lines) — the container/pure-view/`Row`
  split you extend. Note `onNewConversation={() => requestNewConversation(window.pyry.sendCommand)}`
  (line 35): the "deref `window.pyry` only inside a click arrow, never during render" discipline the
  dialog dispatch must copy. `Row` (146-162) is the `<button onClick={onOpen}>` you restructure.
- `src/renderer/src/screens/channels/channelListViewModel.ts:16-19` — `titleFor(name)`. Reuse verbatim
  for the suggested-name prefill. Returns `'Untitled'` for a null/blank name.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` (whole) — the SSR test idiom: `node` env,
  `renderToStaticMarkup` of the pure view with injected props + `noop` handlers, marker-string
  assertions. You extend this file (affordance present-on-discussion / absent-on-channel).
- `src/renderer/src/screens/conversation/PermissionModal.tsx:34-130` — the pure dialog-view precedent
  (`PermissionModalView`): `role="dialog"`, `aria-modal`, `aria-labelledby` to a fixed title id, the
  `overlay → scrim → panel` structure, required injected effect props. Mirror its shape.
- `src/renderer/src/screens/conversation/PermissionModal.test.tsx:1-53` — the pure-dialog-view SSR test
  idiom (structure only, no clicks — the `node` env fires none).
- `src/renderer/src/store/conversationCreatedBridge.ts:13-23` — `requestNewConversation(sendCommand)`:
  the fire-and-forget dispatch precedent. `requestPromoteConversation` is its twin.
- `src/renderer/src/store/conversationCreatedBridge.test.ts:44-54` — the dispatch-helper spy test
  (`vi.fn()` + `toHaveBeenCalledWith(exact command)`). Copy for the promote dispatch.
- `src/shared/wire/types.ts:441-449` (`ConversationSummary`, note `cwd: string` always present) and
  `:495-512` (`PromoteConversationPayload` — three REQUIRED strings `conversation_id`/`name`/`cwd`).
- `src/shared/ipc/commands.ts:71-80` — the `RendererCommand` union; the
  `{ type: 'promoteConversation'; payload: PromoteConversationPayload }` arm already exists (#273).
- `src/renderer/src/screens/conversation/conversation.css:577-680` — the `permission-modal-overlay` /
  `__scrim` / `.permission-modal` panel / `__title` / `__options` / text-button CSS to mirror for the
  dialog chrome.
- `src/renderer/src/screens/channels/channels.css` (whole) — the row + FAB CSS and the "every color/
  type/spacing is a token; structural geometry may be a literal" convention. Affordance + dialog styles
  land here.
- `src/renderer/src/theme/tokens.css:19-95` — color/type/radius/space tokens. **There is no
  `label-medium` token**; map the field's "Name" label to the nearest `--text-label-small`
  (11px/500/0.5px vs M3's 12px/500/0.5px — a 1px delta, the `channels.css:127` ±token-mapping precedent).

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=19-24

A centered M3 dialog on a `surface-container-high` panel (28px radius, 24px padding, 16px gaps): a
`headline-small` "Save as channel" title, an M3 outlined Name field (1px `outline` border, 4px radius,
`label-small` "Name" label over a `body-large` value prefilled with the discussion's title), and a
right-aligned action row of two `label-large`/`primary` text buttons — **Cancel** and **Save**. This
slice builds exactly that. The two location radios ("Move to dedicated channel folder" with the
`~/pyry-workspace/channels/<auto-slug>/` preview, and "Keep in scratch") visible below the Name field in
the node are **out of scope — they land in #288**; render only title + Name field + Cancel/Save.

## Context

The Channel List (#141) renders two tiers partitioned by `is_promoted` (`partitionByPromotion`), but
there is no way to promote a discussion. #273 landed the transport (`promoteConversation` command +
`PromoteConversationPayload`); #275 landed the list re-request on `conversation_updated`. The only
missing piece is the UI that collects a name and fires the command — this ticket.

The daemon's `Promote` primitive flips `is_promoted` and sets `name` but does **not** move `cwd`
(pyrycode #218). So "keep in scratch" (reuse the row's existing `cwd`) needs no location UI — the split
seam that makes #274 the naming half and #288 the location layer.

## Design

### Module structure

Two production files touched; one new, one modified. Plus CSS (not a `.ts`/`.tsx` production file) and
two test files.

| File | New/Mod | Role |
|------|---------|------|
| `screens/channels/SaveAsChannelDialog.tsx` | new | pure `SaveAsChannelDialogView` + pure `requestPromoteConversation` dispatch helper |
| `screens/channels/ChannelList.tsx` | mod | `Row` restructure + affordance; container owns dialog state + wiring |
| `screens/channels/channels.css` | mod | affordance button + dialog chrome styles |
| `screens/channels/SaveAsChannelDialog.test.tsx` | new | view SSR tests + dispatch-helper spy test |
| `screens/channels/ChannelList.test.tsx` | mod | affordance present-on-discussion / absent-on-channel |

**Why `requestPromoteConversation` co-locates with the dialog view (not a `store/*Bridge.ts` twin of
`conversationCreatedBridge`).** `conversationCreatedBridge` bundles dispatch + a `conversationCreated`
subscription + a React hook because create *has* a subscription half. Promote's subscription half is the
`conversation_updated` reflect, which already shipped in #275 — so promote's "bridge" here is a single
pure dispatch function. It's a renderer-layer function that takes an injected `sendCommand` and touches
no key/socket/Noise/`window` at module scope (it constructs a typed command literal and calls the
injected function), so co-locating it with its sole caller-feature keeps the change to two new files
without crossing the main/renderer boundary. Keep it exported so it is spy-testable in isolation.

### `SaveAsChannelDialog.tsx` — contracts

Pure view (props in, markup out; SSR-safe — no `window`, no store). Mirror `PermissionModalView`'s
chrome: `overlay → aria-hidden scrim → role="dialog" aria-modal aria-labelledby` panel.

```tsx
export function SaveAsChannelDialogView(props: {
  name: string                             // controlled value (container-owned state)
  onNameChange: (next: string) => void     // required injected effect
  onCancel: () => void                     // required injected effect
  onSave: () => void                       // required injected effect
}): JSX.Element
```

- Title `<h2 id={SAVE_AS_CHANNEL_TITLE_ID}>Save as channel</h2>` (a module-const id, the
  `PERMISSION_MODAL_TITLE_ID` idiom — one dialog at a time, a fixed id is safe).
- Name field: a `<label>` wrapping a `<span>Name</span>` and a controlled
  `<input type="text" value={name} onChange={e => onNameChange(e.target.value)}>`. Wrapping label →
  accessible name without an id/`htmlFor` pair.
- Action row: leading **Cancel** (`onClick={onCancel}`) and trailing **Save**
  (`onClick={onSave}` , `disabled={name.trim() === ''}`). The blank check (empty **or** whitespace-only,
  AC3) is a one-line inline expression — under SSR, a disabled button renders `disabled=""` in the
  markup, so the disabled/enabled states are directly assertable without a DOM harness.

Pure dispatch helper (twin of `requestNewConversation`; ~6 lines):

```ts
export function requestPromoteConversation(
  sendCommand: (command: RendererCommand) => void,
  row: ConversationSummary,
  name: string
): void  // → sendCommand({ type: 'promoteConversation',
        //     payload: { conversation_id: row.id, name: name.trim(), cwd: row.cwd } })
```

- `conversation_id ← row.id`, `name ← name.trim()`, `cwd ← row.cwd` (AC4). `row.cwd` is always present
  (`ConversationSummary.cwd: string`), satisfying the REQUIRED-string contract.
- Trim normalizes the sent name (a promoted channel should not carry accidental edge whitespace); the
  view already disables Save on a blank name, so the helper is never reached with a blank one — no
  redundant guard in the helper (Evidence-Based: no observed blank-submit path to defend).
- `cwd` is opaque display/routing text; the renderer never resolves it to a filesystem path.

### `ChannelList.tsx` — changes

**`Row` restructure (AC1 — an interactive control cannot nest inside a `<button>`).** Replace the single
row `<button>` with a flex wrapper whose two children are siblings: the open action and the (optional)
save affordance.

```tsx
// Row gains an optional `onSaveAsChannel?: () => void`. Present → render the affordance; absent → don't.
<div className="channel-list__row">
  <button type="button" className="channel-list__row-open" onClick={onOpen}> …title · time… </button>
  {onSaveAsChannel && (
    <button type="button" className="channel-list__save"
            aria-label="Save as channel" onClick={onSaveAsChannel}> <svg …bookmark-add glyph…/> </button>
  )}
</div>
```

- The existing `.channel-list__row` button-reset/flex/hover/focus rules move to `.channel-list__row-open`;
  `.channel-list__row` becomes the flex wrapper. Channel (promoted) rows pass no `onSaveAsChannel`, so
  the affordance is structurally absent there (AC1); Recent rows pass it.
- The affordance glyph is not pinned by a Figma node (19:24 is the dialog). Use an icon-only `<button>`
  with `aria-label="Save as channel"` (the accessible name; the `.channel-list__fab` / `StatusRow`
  pattern) and a Material bookmark-add path — the same "map a Material glyph" choice the FAB made for
  15-106. See Open questions if a specific glyph is wanted.

**`ChannelListView`** gains one prop `onSaveAsChannel: (row: ConversationSummary) => void`, threaded to
the **discussions** `.map` only (channels rows get no affordance). Existing tests inject a `noop`.

**Container `ChannelList`** owns the dialog's transient UI state (local `useState`, not the store — this
is per-interaction dialog state, the lowest scope that survives re-render; CLAUDE.md "local UI state in
component-local `useState`"):

- `const [saveRow, setSaveRow] = useState<ConversationSummary | null>(null)` — which row's dialog is
  open, or none.
- `const [name, setName] = useState('')` — the controlled field value.
- `onSaveAsChannel={(row) => { setSaveRow(row); setName(titleFor(row.name)) }}` — open the dialog and
  seed the field from the row's displayed title in **one** handler (no effect, no key-remount).
- Render the dialog as a sibling of `ChannelListView` when `saveRow !== null`. The container returns a
  fragment: `<>{listView}{saveRow && <SaveAsChannelDialogView …/>}</>`.
  - `onNameChange={setName}`
  - `onCancel={() => setSaveRow(null)}` (dismiss dispatches nothing — AC4)
  - `onSave={() => { requestPromoteConversation(window.pyry.sendCommand, saveRow, name); setSaveRow(null) }}`
- `window.pyry` is dereferenced **only** inside the `onSave` closure (interaction time), and the dialog
  is not rendered on first paint (`saveRow` starts `null`), so the SSR smoke stays green (the
  `onNewConversation` discipline).

### Data flow

```
Recent Row  ──affordance click──▶  container: setSaveRow(row); setName(titleFor(row.name))
                                        │
                                        ▼
                          SaveAsChannelDialogView (controlled by name state)
                              │                         │
                       Cancel/dismiss              Save (enabled iff non-blank)
                              │                         │
                       setSaveRow(null)     requestPromoteConversation(window.pyry.sendCommand, saveRow, name)
                       (dispatches nothing)            → preload command bridge → main → daemon promote
                                                       then setSaveRow(null)
                                                                  ⋮
                            daemon conversation_updated broadcast ─▶ #275 re-requests the list ─▶ row moves Recent→Channels
```

The dialog collects input and dispatches only; it never mutates the list (AC5). Row movement is #275's job.

## State + concurrency model

- No store slice added. Dialog open-state and field value are component-local `useState` in the
  `ChannelList` container — transient, per-interaction, reset by re-seeding on each open.
- No async tasks, streams, subscriptions, timers, or teardown. The dispatch is fire-and-forget through
  the existing preload command bridge (`sendCommand` returns `void`), exactly like the composer send and
  the new-discussion FAB. Nothing to cancel on unmount.
- Re-render seam: opening/typing/closing the dialog re-renders the `ChannelList` container (which
  re-renders `ChannelListView`). Acceptable — this is a home screen with a short row list and no hot
  path; no memoization needed. The dialog is not a store subscriber.

## Error handling

Input-collection UI over an existing, guarded command — minimal surface:

- **Blank name:** Save is `disabled` while `name.trim() === ''` (AC3), so an empty/whitespace-only
  promote cannot be dispatched. The disabled state is the guard; no post-submit error path.
- **Untrusted display text:** `titleFor(row.name)` and the field value render as auto-escaped React
  children (never `dangerouslySetInnerHTML`). A prior desktop lesson: `renderToStaticMarkup` escapes
  `'` → `&#x27;`; keep test fixtures apostrophe-free.
- **Dispatch failure / daemon reject:** out of scope here (no correlation, no optimistic UI). The
  command is fire-and-forget; a rejected promote simply produces no `conversation_updated`, so the row
  stays in Recent. Surfacing a promote rejection is not an AC and not built.
- **`cwd` required-string contract:** satisfied structurally — `ConversationSummary.cwd` is always a
  present string; no nullable path to guard.

## Testing strategy

`npm test` (vitest, **`node` env — no jsdom/testing-library**, per `vitest.config.ts`). Interactive
behavior is proven at the pure-function level, never via DOM clicks (the #242 gotcha). `npm run
typecheck` covers the command shape at compile time (the `promoteConversation` arm type-checks the
payload).

**`SaveAsChannelDialog.test.tsx` (new)** — `renderToStaticMarkup(<SaveAsChannelDialogView … noop/>)`:
- Renders the "Save as channel" title and `role="dialog"` / `aria-modal` / `aria-labelledby` chrome.
- Renders the Name `<input>` with `value` equal to the injected `name` (prefill — AC2).
- Save is `disabled` when `name` is `''`; disabled when whitespace-only (`'   '`); **not** disabled when
  a non-blank name is passed (AC3). Assert on the Save button specifically (a class marker), not the
  whole markup.
- Renders Cancel and Save actions.
- `requestPromoteConversation` (spy test, `vi.fn()`): given a fixture `ConversationSummary` and a name,
  calls `sendCommand` **once** with exactly
  `{ type: 'promoteConversation', payload: { conversation_id: row.id, name: <trimmed>, cwd: row.cwd } }`
  (AC4). Include a case with edge whitespace to assert the trim.

**`ChannelList.test.tsx` (mod)** — extend the existing SSR `ChannelListView` render:
- A discussions-only render contains the affordance marker (`aria-label="Save as channel"`); a
  channels-only render does **not** (AC1). Add a `SAVE_MARKER` const beside `FAB_MARKER`.
- (Existing tests must still pass — thread a `noop` `onSaveAsChannel` into the shared `render` helper.)

**Not unit-tested (React glue, the established boundary):** the controlled-input `onChange` state
update, the affordance-click-opens-dialog wiring, and Save-click-dispatches wiring live in the
container and are covered by composition + the manual/e2e round-trip — the same posture as
`PermissionModal`'s click wiring (proven in `modalResolution.test.ts`, not by rendering + clicking).

## CSS notes

- **Affordance** `.channel-list__save`: icon-only button, button-reset, sized like a compact touch
  target, `color: var(--color-on-surface-variant)` (de-emphasized vs the title), `focus-visible` outline
  `var(--color-outline)` (the file convention). `.channel-list__row` becomes `display:flex; align-items:
  center`; `.channel-list__row-open` inherits the old row rules with `flex: 1 1 auto; min-width: 0`.
- **Dialog** — mirror `conversation.css:577-680`: an overlay (`position: fixed; inset: 0` — fixed so it
  escapes `.channel-list`'s `overflow-y:auto` scroll container and covers the window; no portal, the
  "overlay inside the screen" precedent), an `aria-hidden` scrim (`var(--color-scrim)`, `opacity: 0.4`),
  and a centered panel (`var(--color-surface-container-high)`, `var(--radius-lg)` 28px, `var(--space-6)`
  padding, `gap var(--space-4)`, `max-width: 360px`). Title = `headline-small` tokens. Action buttons =
  the `permission-modal__option` text-button treatment (pill, transparent, `--color-primary`,
  `label-large`); Cancel is leading (`margin-right: auto`).
- **Name field**: bordered frame (`1px solid var(--color-outline)`, `var(--radius-xs)` ≈ Figma's 4px —
  or a 4px structural literal if `--radius-xs` (6px) reads too round; developer's call, note it), padding
  `var(--space-2) var(--space-4)`, column layout. Label = `--text-label-small` (the label-medium
  gap-map, noted above), `--color-on-surface-variant`. Input = reset (`border:0; background:none;
  outline:none; color: var(--color-on-surface)`), `--text-body-large` tokens, `width:100%`.
- Every color/type/spacing is a token; only structural geometry (border widths, the fixed max-width) may
  be a literal — the file's existing carve-out rule.

## Open questions

- **Affordance glyph.** No Figma node pins the row-level "Save as channel" control (19:24 is the dialog).
  Spec assumes a Material bookmark-add icon, `aria-label="Save as channel"`. If PO/design wants a
  specific glyph or a text affordance, that's a small swap.
- **Unnamed-discussion prefill.** Per the ticket's explicit `titleFor(row.name)` reuse, an unnamed row
  prefills the `'Untitled'` fallback and Save is enabled (it's non-blank). If forcing a real name for
  unnamed rows is preferred, prefill `''` instead (Save then starts disabled). Deferred — matches the
  ticket as written.
- **Enter-to-submit / autofocus-select.** A single-field dialog conventionally submits on Enter and
  selects the prefilled text on open. Both need DOM (a `<form onSubmit>` gated on the same blank check,
  or a ref + effect) and neither is an AC nor node-env-testable. Left out of the core; a safe additive
  enhancement if desired (gate any Enter path on the same `name.trim() !== ''`).
