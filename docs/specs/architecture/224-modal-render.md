# #224 — Interactive modal render: show the outstanding permission/trust prompt with the fail-safe default pre-selected

Render slice of the #201 modal vertical. #223 landed the modal store (`modalStore.ts`) and the
daemon-event → `ModalEvent` bridge (`modalBridge.ts`) but left `useModalBridge` **dormant** — nothing
mounts it, so the store never populates from live events. This slice closes the store → UI path: it
mounts the bridge at App level so the outstanding prompt becomes live renderer state, then renders that
prompt as a modal — title, prompt text, ordered option buttons, with the fail-safe `defaultOptionId`
marked. **Read-only**: the buttons render but do not answer the daemon (the answer path is a downstream
slice), mirroring the render-before-enrich discipline of #203-before-#218.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=22-3

Node `22-3` is the **Dialogs** section (Rename / Save-as-Channel / Create-Folder / Paste-Code). There is
**no dedicated permission/trust modal node** — the modal content is daemon-supplied, so the design
surface is the modal **chrome**, and the Dialogs cards are the reference (verified: still a genuine gap,
see Open questions). Each Dialogs card is an M3 dialog: a `surface-container-high` (#272a2f) panel,
`radius-lg` (28px) corners, 24px padding, a column with 16px gaps — a `headline-small` title, a body
region, and a bottom **right-aligned action-button row** of pill-shaped text buttons in `primary`
(#9dcbfc), `label-large` weight. That maps directly onto **title / prompt / ordered option buttons**.
The permission modal reuses #177's `StatusSheet` overlay+scrim chrome (`role="dialog"`,
`aria-modal="true"`, a scrim, an opaque panel, absolutely positioned inside `.conversation`, no portal)
but swaps the bottom-sheet panel for a **centered M3 dialog** panel per the Dialogs cards.

## Files to read first

- `src/renderer/src/store/modalStore.ts:36-45` — the read surface: the `modalStore` singleton, the
  `useModalStore(selector)` hook, and the re-exported `selectOutstanding`. This is what the container reads.
- `src/renderer/src/store/modalPrompts.ts:11-52,105` — the `ModalPrompt` / `ModalOption` / `ModalClass` /
  `ModalState` shapes and `selectOutstanding` (returns the `readonly ModalPrompt[]` slice by reference,
  ordered oldest-first). The view's prop type is `ModalPrompt`.
- `src/renderer/src/store/modalBridge.ts:96-108` — `useModalBridge()`, the **dormant** hook to mount. Note
  it dereferences `window.pyry` only inside its `useEffect`, so mounting it preserves the App server-render
  invariant. This is the load-bearing AC1 wiring.
- `src/renderer/src/App.tsx:46-52,84-94` — the bridge mount site. `useDaemonEventBridge()` and
  `useTimelineBridge()` are the twins to sit beside; both are app-lifetime and unconditional. The
  comment on lines 48-52 is the exact pattern to copy for the modal bridge.
- `src/renderer/src/App.test.tsx:67-77` — the invariant the new mount must not break:
  `renderToStaticMarkup(<App/>)` is `''` and does not throw (effects never run under server render, so
  `window.pyry` is never touched). No new App test is required — this is the regression guard.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:61-85` — the `.conversation` container and
  the child-mount site: `<PermissionModal />` mounts as the last child, exactly like `{sheetOpen && <StatusSheet…>}`.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:267-303` — `StatusSheet`, the pure-view
  chrome to mirror: `role="dialog"` + `aria-modal="true"` + a dedicated scrim element + an opaque panel,
  overlay `inset: 0` inside `.conversation`, no portal.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:383-426` — `RepairPrompt` (pure view) +
  `RepairControl` (container): the exact **container / pure-view split with store-read isolation** to copy,
  including the "populated branch is unreachable under server render (zustand v5 reads `getInitialState`)"
  test note that governs how the container is tested.
- `src/renderer/src/screens/conversation/conversation.css:9-19,393-424` — `.conversation`'s
  `position: relative` containing block, plus `.status-sheet-overlay` / `__scrim` / `.status-sheet` — the
  chrome to adapt (reuse the overlay+scrim structure; new **centered** panel).
- `src/renderer/src/theme/tokens.css:17-89` — the tokens the CSS must reference (all verified present):
  `--color-surface-container-high` #272a2f (panel), `--color-on-surface` (title), `--color-on-surface-variant`
  (prompt/muted labels), `--color-primary` #9dcbfc (text-button labels), `--color-secondary-container` /
  `--color-on-secondary-container` (the emphasized default option), `--color-scrim`, `--radius-lg` (28px panel),
  `--radius-full` (pill buttons), `--text-headline-small-*` (24/32/400 title), `--text-body-medium-*` (prompt),
  `--text-label-large-*` (14/20/500 buttons). **No color/type/radius literal in the CSS** — the status-sheet
  block is the convention.
- `docs/knowledge/decisions/0009-modal-prompt-model.md` — ADR 0009: the modal store model; `selectCurrentModal`
  is deferred "until a render needs it". This render does **not** need it (see Design).

## Context

The modal store is one source of truth (`{ outstanding: readonly ModalPrompt[] }`, oldest-first, a
`shown` appends and a `dismissed` removes by id). #223 wired the translation but left the subscriber
unmounted. Two things are missing to make a prompt visible:

1. **Mount the bridge** so decoded daemon events actually reach the store (AC1).
2. **Render** the outstanding prompt with a container/pure-view split (AC2–AC5).

Both are additive. Nothing else reads the modal store, so a modal arrival re-renders only the new modal
container — not the thread, not the composer.

## Design

### New file: `src/renderer/src/screens/conversation/PermissionModal.tsx`

Two components, mirroring `RepairPrompt` / `RepairControl`:

- **`PermissionModalView(props: { prompt: ModalPrompt }): JSX.Element`** — pure, exported, no store, no
  effects. Always renders the dialog chrome for the given (non-null) prompt. Server-render-tested directly
  with injected `ModalPrompt` fixtures. Responsibilities:
  - The overlay + scrim + panel chrome (`role="dialog"`, `aria-modal="true"`,
    `aria-labelledby` → the title element id), mirroring `StatusSheet`.
  - `prompt.title` in a `headline-small` heading; `prompt.prompt` in a body paragraph. Both rendered as
    **React children** (auto-escaped) — never `dangerouslySetInnerHTML` (AC4).
  - `prompt.options` mapped 1:1 to `<button type="button">` in **array order** (AC2), keyed by
    `option.id`. Each is inert (no `onClick`) — the answer path is downstream. Labels are React children
    (auto-escaped, AC4).
  - The option whose `id === prompt.defaultOptionId` carries a modifier class
    `permission-modal__option--default` in addition to the base `permission-modal__option`; the others
    carry only the base class (AC3). The modifier class is the assertable signal (the codebase idiom:
    `message-row--${type}`, `conversation__unpair--confirm`, `bubble--thinking`).
  - `prompt.class` (`'permission' | 'trust'`) is **not** rendered in this slice — AC2 asks only for
    title/prompt/options. It stays available on the prop for a future class-specific treatment; keeping it
    out keeps scope minimal.

- **`PermissionModal(): JSX.Element | null`** — the container. Reads `useModalStore(selectOutstanding)`,
  takes the oldest outstanding prompt (`outstanding[0]`), returns `null` when there is none, else
  `<PermissionModalView prompt={outstanding[0]} />`. Isolates its store read exactly like `RepairControl`,
  so a modal arrival re-renders this leaf only, never `ConversationScreen`.

**One modal at a time (oldest-first).** The store is an ordered array; this slice renders `outstanding[0]`
only. A permission/trust prompt is a blocking decision, so a single-dialog FIFO presentation is the
simplest correct choice; when the oldest is answered/dismissed (downstream), the next `[0]` renders. No
stack, no `selectCurrentModal` selector — the container derives `[0]` from `selectOutstanding` locally,
honoring ADR 0009's deferral.

### Edit: `src/renderer/src/App.tsx`

Add `useModalBridge()` beside `useDaemonEventBridge()` / `useTimelineBridge()` (import + one call + a
one-line comment). App-lifetime and unconditional — the third independent subscriber on the one
daemon-event channel (#202/#203 established the pattern). It dereferences `window.pyry` only inside its
effect, so the `<App/>` server-render test stays `''` (AC1). No other App change.

### Edit: `src/renderer/src/screens/conversation/ConversationScreen.tsx`

Add the import and mount `<PermissionModal />` as the last child of the `.conversation` div (after
`{sheetOpen && <StatusSheet…>}`), so the modal overlays the conversation surface — the same
`.conversation`-relative overlay placement `StatusSheet` uses. Two lines plus the import.

### Edit: `src/renderer/src/screens/conversation/conversation.css`

Add the permission-modal chrome. **Reuse** the overlay+scrim structure from `.status-sheet-overlay` /
`.status-sheet-overlay__scrim` — but the sheet's `justify-content: flex-end` (bottom-anchor) becomes
`center` (both axes) so the panel is a **centered M3 dialog**, not a bottom sheet. Add a distinct class
set (`.permission-modal-overlay`, `.permission-modal-overlay__scrim`, `.permission-modal`, plus
`__title` / `__prompt` / `__options` / `.permission-modal__option` / `--default`) rather than overloading
the status-sheet classes — the two modals share a chrome *pattern*, not a stylesheet, and coupling them
would make the sheet's future changes leak into the dialog. Token mapping (all verified in `tokens.css`):

| Element | Tokens |
|---|---|
| overlay / scrim | `position: absolute; inset: 0`; scrim `--color-scrim` at `opacity: 0.4` (the status-sheet idiom) |
| panel | `--color-surface-container-high`, `--radius-lg` (28px), 24px (`--space-*`) padding, column + 16px gap |
| title | `--text-headline-small-*`, `--color-on-surface` |
| prompt | `--text-body-medium-*` (or `-body-large-*`), `--color-on-surface-variant` |
| option (base) | pill (`--radius-full`), `--text-label-large-*`, `--color-primary` text, transparent bg — the Dialogs text-button treatment |
| option (`--default`) | emphasized/filled: `--color-secondary-container` bg + `--color-on-secondary-container` text — a clear, assertable visual distinction (the safe deny is the prominent choice) |
| options row | `flex`, `gap`, `justify-content: flex-end`, `flex-wrap: wrap` (degrades gracefully for N > 2 or long daemon labels) |

The exact emphasis styling for `--default` is a reasonable-design call, not a pixel match — there is no
dedicated Figma node (see Open questions), so the constraint is "visually distinct + design-system tokens
only", following #215's interim-treatment precedent for its missing thinking-indicator node.

### Re-render seam

`PermissionModal` selects `selectOutstanding` and re-renders on any array-identity change (every
shown/dismissed produces a fresh array; a no-op dismissed returns the same reference and does not churn).
Because it is a dedicated leaf isolating the store read, only it re-renders — `ConversationScreen`,
`MessageThread`, `Timeline`, and `Composer` are untouched. `PermissionModalView` is pure, so it re-renders
only when `PermissionModal` passes a new `prompt`.

## State + concurrency model

- **Store slice:** `modalStore` via `useModalStore(selectOutstanding)`. Read-only here; the sole write
  path is the bridge's `dispatch` (#223). No new store, no setter, no two-way binding — unidirectional per
  CLAUDE.md.
- **Subscription lifecycle:** `useModalBridge` owns one `useEffect` subscribe/unsubscribe over
  `window.pyry.onDaemonEvent`; a StrictMode double-mount nets exactly one live listener (the
  `useTimelineBridge` idiom, already implemented in `modalBridge.ts`). No new async tasks, no
  `AbortController` — this slice adds no I/O; it subscribes to an in-process typed channel and renders.
- **Server render:** the container reads `getInitialState()` (empty `outstanding`) under
  `renderToStaticMarkup`, so it renders `null` — `ConversationScreen`'s existing server-render tests stay
  green, and `<App/>` stays `''`.

## Error handling

No new failure modes. This slice consumes already-typed renderer state; there is no network, socket,
parse, or permission surface (that decode was #201's, internet-exposed and reviewed). The daemon-supplied
strings (`title` / `prompt` / `options[].label`) are untrusted display text — the failure mode they'd
cause (HTML/script injection) is neutralized by React auto-escaping (AC4); no `dangerouslySetInnerHTML`,
no markup or path interpretation. A malformed/unknown prompt cannot reach the view: the store only holds
prompts a well-typed `shown` installed, and a `dismissed` for an unknown id is a same-reference no-op
(`reduceModal`). If `outstanding` is empty the container renders nothing — the neutral state, not an error.

## Testing strategy

`npm run typecheck` + `npm test` (vitest) + `npm run build` stay green. No DOM harness — server-render the
pure view, mirroring `ConversationScreen.test.tsx` / `App.test.tsx`.

**`PermissionModalView` (pure, `renderToStaticMarkup` with injected `ModalPrompt` fixtures):**
- Renders `title` and `prompt` text.
- Renders one `<button>` per option, in array order (assert the labels appear in the order given, e.g.
  first option's label precedes the second's in the markup).
- The option whose id equals `defaultOptionId` carries `permission-modal__option--default`; every other
  option carries only the base class and not the modifier (AC3). Cover a `defaultOptionId` that is neither
  first nor last so order and default-marking are independent.
- `title` / `prompt` / a label containing `<script>` or `<b>` renders escaped — the raw markup does not
  appear as live tags (AC4). (The #203/#218 auto-escape assertion.)
- The chrome carries `role="dialog"` and `aria-modal="true"`, and `aria-labelledby` points at the title
  element's id.
- A single-option prompt renders exactly one button; a three-option prompt renders three.

**`PermissionModal` (container):**
- Under server render with the store at initial (empty) state, renders the empty string — no dialog
  (AC2's "when outstanding is empty, no modal renders"). The **populated** branch is unreachable under
  server render (zustand v5 reads `getInitialState`, so a `setState` is not reflected) — exactly the
  `RepairControl` note; the populated rendering is proven through `PermissionModalView`, not the container.

**App / bridge:** the existing `App.test.tsx` neutral-paint test (`<App/>` → `''`, no throw) is the
regression guard for AC1's mount; the bridge's translate/subscribe behavior is already covered by
`modalBridge.test.ts`. No new App or bridge test is required.

## Open questions

- **Missing Figma node (design debt, non-blocking).** Confirmed against node 22-3: the file still has no
  dedicated permission/trust modal node, so this slice builds an interim dialog from the Dialogs chrome +
  design-system tokens (the #215 thinking-indicator precedent). Flag for Juhana: add a dedicated
  permission-modal node for a future visual-polish pass (option-emphasis treatment, `class`-specific
  styling). Not a blocker — the ticket body directs the architect to confirm chrome against Dialogs, which
  this does.
- **Modal scoped to the thread.** The modal mounts inside `.conversation` (ConversationScreen), so a prompt
  renders only when the thread is on screen — correct for an interactive session (which is thread-scoped),
  and nothing is lost (the app-lifetime store retains the prompt until the thread mounts). A global,
  route-independent modal surface (fixed/portal) would diverge from the cited `StatusSheet` chrome; revisit
  only if a prompt must interrupt the list view. Out of scope here.
- **Default-option emphasis styling** is a reasonable-design call pending the dedicated Figma node; the
  hard requirement is only "visually distinct via the `--default` modifier class, using design-system
  tokens."
- **Answer path** (wiring option buttons to answer the daemon, dismiss on resolution, `dismissed` toasts)
  is the downstream slice; the inert buttons here land it on a stable render surface.
