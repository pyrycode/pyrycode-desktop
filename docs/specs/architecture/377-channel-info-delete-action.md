# #377 — Channel Info sheet: Delete action + destructive confirm

Size: **S** (renderer-only). Not security-sensitive (the wire verb + its renderer→main
boundary guard shipped in #364; this slice only dispatches an already-guarded command).
Blocked-by #376 (list reflection) — merged.

## Files to read first

- `src/renderer/src/screens/conversation/ConversationScreen.tsx:932-970` — the Actions
  slot (`.channel-info__actions`), the Rename (#368) and Archive (#366) pills, the in-file
  destructive-last-order comment (`:933`), and the `requestArchiveConversation` helper
  (`:965`). **This is the block you clone from.** Delete is the third action.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:977-1042` — the
  `ChannelInfoSheet` container: `renameOpen` useState (`:991`), how `onRename`/`onArchive`
  are gated on `conversation !== null` (`:1008-1027`), how `RenameConversationDialogView`
  is rendered as a sibling (`:1029-1039`). `deleteConfirmOpen` is the `renameOpen` twin.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1018-1197` — the
  `ChannelInfoSheetView` and `requestArchiveConversation` test blocks. **The exact test
  idiom to clone.** SSR-only (`renderToStaticMarkup`), no DOM clicks. Note `:1086-1090`
  already asserts `not.toContain('Delete')` for the no-callbacks case — do not regress it.
- `src/renderer/src/screens/channels/RenameConversationDialog.tsx:20-110` — the pure
  dialog view + dispatch-helper split, and `requestRenameConversation`'s inline-literal
  `RendererCommand` idiom. Reference only — Delete's helper clones `requestArchiveConversation`
  (nearer sibling: single `conversation_id`, fire-and-forget, no dialog).
- `src/shared/ipc/commands.ts:100-106,198-199,324-333` — the `deleteConversation` command
  arm and its `isDeleteConversationPayload` boundary guard (both shipped dormant by #364).
- `src/shared/wire/types.ts:646` — `DeleteConversationPayload { conversation_id: string }`.
- `src/renderer/src/screens/conversation/conversation.css:1621-1660` — `.channel-info__actions`
  (flex column) and the base `.channel-info__action` pill; the `:1632` comment already
  anticipates *"#367's destructive Delete layers an error-tinted variant on top"*.
- `src/renderer/src/theme/tokens.css:33` — `--color-error: #ffb4ab` (M3 error tone-80, the
  **only** error-role token on desktop; no `--color-error-container` exists).

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-96

Node 20:96 is the **Delete** action button in the sheet's Actions row (beside Archive 20:94):
a full-width pill, `px 16 / py 10`, fully-rounded, label-large centred text — i.e. the base
`.channel-info__action` shape, identical geometry to Archive/Rename. **The Figma node renders
Delete as the standard `secondary-container` tonal pill (no red).** The destructive
`--color-error` treatment and the confirmation step are **client-owned inventions** per the AC
(no Figma node for either) — the same posture as #226's second-confirm and #360's rename
affordance. So: reproduce the base pill geometry from Figma, then layer the invented
error-tinted destructive variant on top.

## Context

The Channel Info sheet (#365) exposes an Actions section. #368 added Rename, #366 added
Archive — each a `.channel-info__action` tonal pill gated on a callback the container
(`ChannelInfoSheet`) supplies only when there is an active conversation. This slice adds the
third action, **Delete**, which (a) is visually destructive and (b) is guarded by an explicit
client-side confirmation before it dispatches, because delete is permanent and irreversible.

No transport, IPC, or wire code here: #364 shipped the `deleteConversation` command and its
boundary guard (dormant); #376 shipped the list reflection (on the `conversationDeleted`
daemon event, `shouldRefreshList` in `conversationListBridge.ts` re-lists so the deleted row
leaves the list). This ticket is purely the renderer affordance that dispatches the verb.

## Design

Everything lands in **one production file** (`ConversationScreen.tsx`) plus CSS. Three parts:
the dispatch helper, the pure-view surface, the container wiring.

### 1. Dispatch helper (exported, co-located)

Add directly after `requestArchiveConversation` (`:970`), cloning its shape — a single
REQUIRED `conversation_id`, fire-and-forget, an inline literal typed `RendererCommand` (the
`RendererCommand` type is already imported at `:42`; no constructor, no try/catch):

```ts
export function requestDeleteConversation(
  sendCommand: (command: RendererCommand) => void,
  conversationId: string
): void
// → sendCommand({ type: 'deleteConversation', payload: { conversation_id: conversationId } })
```

Exported so the dispatch is directly unit-testable — the sheet renders server-side only, so
the click handler can never fire via a DOM event (the `requestArchiveConversation` rationale).

### 2. Pure view — `ChannelInfoSheetView`

The confirm is rendered **inline inside the Actions slot** (not a modal overlay). This is the
`#226` client-side-confirm posture and keeps the change to CSS + one file with no new dialog
chrome. The confirm state is owned by the container and threaded in as props, so both states
are server-renderable and directly assertable.

Add four cohesive optional props (all supplied together by the container, or all absent):

| Prop | Meaning |
|------|---------|
| `onDelete?: () => void` | the Delete pill's onClick — **opens** the confirm; never dispatches |
| `deleteConfirmPending?: boolean` | which sub-state to render (default falsy → the pill) |
| `onDeleteConfirm?: () => void` | the confirm button's onClick — dispatch + close |
| `onDeleteCancel?: () => void` | the Cancel button's onClick — dismiss, no wire effect |

Render, in `.channel-info__actions`, **after** the Archive pill (destructive-last order —
extend the existing `:933` comment to cover Delete). Gated on `onDelete` presence:

- `onDelete && !deleteConfirmPending` → the Delete pill:
  `<button class="channel-info__action channel-info__action--danger" onClick={onDelete}>Delete</button>`
- `onDelete && deleteConfirmPending` → the confirm block **in place of** the pill:
  - a prompt line (`.channel-info__confirm-text`) — client-owned, apostrophe-free copy, e.g.
    **"Delete this conversation permanently? This cannot be undone."**
  - a Cancel button — base `.channel-info__action`, `onClick={onDeleteCancel}`, label `Cancel`
  - a confirm button — `.channel-info__action .channel-info__action--danger`,
    `onClick={onDeleteConfirm}`, label `Delete`

Both Cancel and confirm are full-width pills stacked in the existing flex-column, so no new
layout class is needed. When `onDelete` is absent (null conversation), nothing renders — the
existing `not.toContain('Delete')` assertion at `:1089` stays green.

### 3. Container wiring — `ChannelInfoSheet`

Add `const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)` (the `renameOpen`
twin, `:991`). Pass to `ChannelInfoSheetView`, mirroring the `onArchive` gating (`:1020`):

- `onDelete` = `conversation === null ? undefined : () => setDeleteConfirmOpen(true)`
- `deleteConfirmPending` = `deleteConfirmOpen`
- `onDeleteConfirm` = `conversation === null ? undefined : () => { requestDeleteConversation(window.pyry.sendCommand, conversation.id); onClose() }`
- `onDeleteCancel` = `() => setDeleteConfirmOpen(false)`

`window.pyry` is dereferenced **only** inside `onDeleteConfirm` (AC5) — never in render, never
in the pure view. `deleteConfirmOpen` resets for free on the sheet's unmount (it only mounts
while open). This is transient screen-local UI state → `useState`, never the store (ADR 0006).

**Data flow:** click Delete → `setDeleteConfirmOpen(true)` (no wire traffic) → the pill is
replaced by the confirm block → Cancel `setDeleteConfirmOpen(false)` (back to the pill, no
wire) **or** confirm → `requestDeleteConversation` dispatches `{ conversation_id }` +
`onClose()` closes the sheet. The deleted row leaving the list is #376's job (the daemon
replies `conversation_deleted`, the list bridge re-lists) — no reflection code here.

### 4. CSS (two token-based rules, no new theme tokens)

- `.channel-info__action--danger` — layered on the base pill (applied alongside
  `.channel-info__action`, which supplies the 40px geometry, radius, label-large text). Since
  desktop has only `--color-error` (no error-container fill token), the destructive treatment
  is an **error-tinted outlined** pill, not a filled-red one: override the base
  `secondary-container` fill to a neutral/transparent background, set `color: var(--color-error)`,
  and draw a 1px error outline via **`box-shadow: inset 0 0 0 1px var(--color-error)`** (not
  `border` — the base is `border: none` and `.channel-info__action` has no `box-sizing:
  border-box`, so an inset shadow adds the outline with zero layout shift). Reuse only
  `--color-error`.
- `.channel-info__confirm-text` — the prompt line: muted/error-tinted body-medium, the row
  padding of the actions column. Follow the `.channel-info__empty` (`conversation.css:1665`)
  token set for sizing.

Extend the existing `:1632` CSS comment from "#367's destructive Delete layers…" to note it
now exists.

## State + concurrency model

No store, no async, no streams. `deleteConfirmOpen` is a single screen-local boolean in the
`ChannelInfoSheet` container. Unidirectional: the container holds state and passes
`(deleteConfirmPending, on*)` down; the pure view reads props and calls callbacks up. No
two-way binding, no store slice, no effect, no cancellation surface. The command dispatch is
fire-and-forget (`sendCommand` returns void), identical to Archive.

## Error handling

None added at this layer. `sendCommand` is fire-and-forget through the preload bridge; the
daemon's own reply path (the `conversation_deleted` decode #375 + list re-list #376) handles
the outcome. A daemon-side rejection or a delete of an already-gone conversation is the
daemon's authority and surfaces (if at all) through the existing rejection/list machinery, not
here. The renderer→main boundary guard (`isDeleteConversationPayload`, #364) already rejects a
malformed payload before it reaches the wire — nothing to re-guard in the renderer.

## Testing strategy

`vitest` + `renderToStaticMarkup`, cloning the `ChannelInfoSheetView` / `requestArchiveConversation`
blocks (`ConversationScreen.test.tsx:1018-1197`). **Anchor Delete assertions on the button
(`>Delete</button>` and/or `channel-info__action--danger`), never on the shared
`.channel-info__action` class** (Rename + Archive also carry it), and never on the bare word
"Delete" (the confirm prompt copy contains it as text). Scenarios:

- **Delete pill present (AC1):** `onDelete` supplied, `deleteConfirmPending` falsy → markup
  contains `>Delete</button>` carrying `channel-info__action--danger`.
- **Absent for null conversation (AC1):** `conversation={null}` (container omits `onDelete`)
  → no `>Delete</button>`; the Actions header still renders.
- **Callback-gated (AC1):** conversation supplied but `onDelete` omitted → no `>Delete</button>`
  (proves the view honours the container's null-guard, not `conversation` itself).
- **Activating shows confirm, no dispatch (AC2):** render with `onDelete` +
  `deleteConfirmPending={true}` → markup contains the prompt copy and `>Cancel</button>`
  (both appear only in confirm mode). No `sendCommand` is reachable from a pure render, so
  "no dispatch on activate" holds by construction (the pill's onClick is `onDelete`, which
  only sets state).
- **Cancel is a no-op (AC3):** covered structurally — `onDeleteCancel` only calls
  `setDeleteConfirmOpen(false)`; assert the Cancel control renders in confirm mode.
- **requestDeleteConversation (AC4):** call the exported helper with a `vi.fn()` and an id →
  called once with exactly `{ type: 'deleteConversation', payload: { conversation_id: '<id>' } }`.

The dispatch-on-confirm and close-on-confirm wiring lives in the container's `onDeleteConfirm`
and is not click-testable under SSR — same as Archive's dispatch-on-click. It is covered by
(a) the helper test (command shape) and (b) the pure-view tests (the confirm controls render);
the wiring itself is inspected, per the established SSR-only pattern. No new test file, no
change to the render approach.

Gate: `npm test` + `npm run typecheck` + `npm run build`.

## Open questions

- **Inline confirm vs. modal dialog.** Chosen: inline two-step in the Actions slot (the #226
  posture) — minimal CSS (two token rules, no dialog chrome), the least total code, and it
  keeps the confirm fully SSR-testable via prop-states. A modal confirm dialog (a separate
  pure view reusing the rename-dialog chrome, #360) was considered and rejected: it adds a
  whole dialog component + ~6 chrome CSS rules for no testability or UX gain over the inline
  swap, which already requires two deliberate clicks with Cancel adjacent. If a reviewer
  prefers a modal for destructive weight, it is a clean drop-in later — the helper and gating
  are unchanged.
- **Confirm copy** is the architect's to set; the strings above are apostrophe-free
  (`renderToStaticMarkup` escapes `'` → `&#x27;`, the standing desktop lesson). Adjust wording
  freely as long as it stays apostrophe-free and conveys permanence.
