# #177 — Status sheet shell: the "Run configuration" host modal

**Size:** S · **Security-sensitive:** No (renderer-only; touches no keys, sockets, tokens, or wire bytes — cf. #166) · **Split from:** #156 · **Unblocks:** #72, #181, #182

## Design source

**Sheet (chrome to build):** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-100

A bottom-anchored rounded card (`--radius-lg` = 28px) on a `surface-container-low` fill: a centered 32×4px drag handle at the top (`on-surface-variant`, 40% opacity), then a title row holding the `Run configuration` title (title-large) on the left and a 40×40px close-control tap target wrapping a 22×22px `×` icon on the right, then the section body. **This ticket builds only the handle + title row + an empty scrollable body**; every section below it in the Figma (Model 20:109, Effort 20:128, YOLO 20:141, Context window 20:149, Log data 98:2) is a follow-up (#181/#182/#72) and is out of scope.

**Trigger (entry-point on the conversation screen):** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-57

A slim full-width row with a `border-t` (`outline-variant`) separating it from the message thread, sitting **between the thread and the composer** (not the top app bar). Left: a live `Opus 4.7 · high · 73% used` summary in Roboto Mono — **scoped OUT** of this shell (it is the collapsed mirror of the sheet's read sections, owned by #181/#182). Right: an `expand_less` (chevron-up) 18×18px icon. This shell delivers the row as **the trigger only** — the chevron affordance that opens the sheet, with the left summary region intentionally empty.

> **Figma fallback-hex quirk (do not hardcode):** the exported CSS for the status row cross-assigns the fallback hexes — it shows `outline-variant,#c2c7cf` and `on-surface-variant,#42474e`, which are swapped relative to this repo's tokens (`--color-outline-variant: #42474e`, `--color-on-surface-variant: #c2c7cf`). Trust the **variable name**, not the fallback hex: the row's top border is `--color-outline-variant`; muted text/icons are `--color-on-surface-variant`. The screenshot confirms a subtle dark line + light-grey icon.

## Files to read first

Codegraph is not initialized on this repo (`mcp__codegraph__*` errors); this list is from direct reads.

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` (whole file, ~200 lines) — the container you extend. Note the three in-file precedents: `MessageThread` (exported pure view, tested directly), `Composer` and `UnpairControl` (in-file sub-components owning ephemeral `useState`, dereferencing `window.pyry` only in click handlers). The new `StatusRow` follows Composer/UnpairControl; the new `StatusSheet` follows MessageThread (exported so its open-state chrome can be server-rendered directly).
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` (whole file) — the exact test idiom to extend: `renderToStaticMarkup`, no jsdom/Testing-Library, `bubbleCount`-style string assertions. Read the `#166`/`#31` comment blocks — they document why interactive `useState` transitions are asserted only through the pure surface, not a click harness. Your sheet tests mirror this.
- `src/renderer/src/screens/conversation/conversation.css` (whole file) — the token-only stylesheet you append to. Note `.conversation` has **no `position`** (you add `position: relative`); note the `min-height: 0` + `overflow-y: auto` flex-scroll pattern on `.conversation__thread` (reuse it for the sheet body); note the icon-button precedent (`.composer__send`) and the muted-disabled convention.
- `src/renderer/src/theme/tokens.css` (whole file) — confirm which tokens exist. **Two are missing and must be added** (see § Tokens to add). The header comment sanctions porting M3 scheme slots ahead of consumers.
- `src/renderer/src/screens/pairing/PairingScreen.tsx:36-70,161-210` — the canonical container/pure-view split (`PairingView` pure + exported, `PairingScreen` thin container). Confirms exporting the pure view for direct-render tests is the house pattern.
- `src/renderer/src/App.tsx:24-34` — how `ConversationScreen` is mounted (`onUnpaired` prop). Confirms the sheet is fully self-contained: no App-level wiring, no new prop threads through here.
- `docs/knowledge/decisions/0006-ephemeral-screen-state-usereducer-not-store.md` — the state-shape rule. A single open/closed boolean is "trivial, single-value local UI state" → `useState` (§ Consequences bullet 3), never the store; `useReducer` is reserved for structured multi-field phase machines.

## Context

The full Status sheet (#156) was decomposed after the operator committed to full `interactive` support; its data-bearing sections (#180/#181/#182/#183) are gated on the `interactive` capability (#179) and, for the context window, on a daemon wire message that does not exist yet (pyrycode/pyrycode#855). This ticket peels off the one **buildable, dependency-free** slice: the host modal — the sheet chrome plus its open/dismiss behaviour, rendering no live data and no controls. It exists now because #72 (the "Log data" Download button) is blocked solely on this host modal; its debug-bundle dependencies (#71/#118/#169) are all closed. Landing this shell unblocks #72 and provides the host for #181/#182.

## Design

Everything lives in **`ConversationScreen.tsx`** (in-file sub-components, per the ticket and the Composer/UnpairControl/MessageThread precedent) and **`conversation.css`** (appended styles). No new `.tsx`/`.ts` file. Production-source file count for the `s`-gate: **1** (`ConversationScreen.tsx`).

### Component structure

**`ConversationScreen` (existing container — modify):**
- Add ephemeral open state: a single boolean via `useState(false)` (AC5; ADR 0006). Not the store.
- Render order inside `.conversation`: `<UnpairControl/>` → `<MessageThread/>` → `<StatusRow onExpand={…}/>` → `<Composer/>`, then, appended as the last child, `{sheetOpen && <StatusSheet onClose={…}/>}` (the overlay). The `StatusRow` sits between thread and composer per Figma.
- `setSheetOpen(true)` on expand, `setSheetOpen(false)` on close. This is the whole toggle.

**`StatusRow` (new, in-file, not exported — like `Composer`):**
- Props: `{ onExpand: () => void }`.
- Renders a full-width `<button type="button" aria-label="Run configuration" aria-haspopup="dialog">` styled as the slim row: empty left region (the live summary is scoped out), an inline `expand_less` chevron SVG on the right. `aria-label` supplies the accessible name (there is no visible text — same icon-only-button + `aria-label` pattern as `.composer__send`). The button is the trigger; `onExpand` is its only behaviour.

**`StatusSheet` (new, in-file, **exported** — like `MessageThread`):**
- Props: `{ onClose: () => void }`. Signature: `export function StatusSheet({ onClose }: StatusSheetProps): JSX.Element`.
- Structure (contract, not implementation):
  - `.status-sheet-overlay` — the modal overlay: `position: absolute; inset: 0`, flex column, `justify-content: flex-end` (anchors the panel to the bottom).
    - `.status-sheet-overlay__scrim` — a dedicated `position: absolute; inset: 0` div, `background: var(--color-scrim); opacity: 0.4`, `aria-hidden`, `onClick={onClose}` (backdrop dismissal — see below). Kept a **separate element** (not the overlay's own background) so the opaque panel sibling is never dimmed and no bare `rgba()`/`color-mix` color literal is needed.
    - `.status-sheet` — the panel, `role="dialog" aria-modal="true" aria-labelledby="<title id>"`, opaque `background: var(--color-surface-container-low)`, `border-radius: var(--radius-lg)`, painted above the scrim by DOM order. Contains:
      - `.status-sheet__handle` — the 32×4px drag bar (decorative, `aria-hidden`).
      - `.status-sheet__header` — the title `<p id="…" className="status-sheet__title">Run configuration</p>` (title-large) + a `<button type="button" aria-label="Close" onClick={onClose}>` wrapping an inline `×` SVG.
      - `.status-sheet__body` — the empty, scrollable container follow-ups populate: `flex: 1 1 auto; min-height: 0; overflow-y: auto` (the `.conversation__thread` scroll pattern). Empty in this ticket. **Add no Model/Effort/YOLO/Context/Log-data content.**

### Overlay & positioning model

Render the sheet as an **absolutely-positioned overlay inside `.conversation`**, not a React portal. `.conversation` gains `position: relative` (one property) so the overlay's `inset: 0` covers the conversation surface (which fills the window when routed to `conversation`). This keeps the modal self-contained in the screen — no portal machinery, no app-level z-index coordination, no App.tsx change. The panel is bottom-anchored (mobile bottom-sheet stretched to the window, per the "mobile design stretched, desktop layout deferred" milestone note); give it a `max-height` (most of the window) so tall future section content scrolls inside `.status-sheet__body` rather than overflowing the window.

### Dismissal

- **Close control (`×`)** — the authoritative path (AC3): `onClick={onClose}`.
- **Backdrop click** — recommended and near-free with this structure: `onClick={onClose}` on `.status-sheet-overlay__scrim`. Clicks on the panel don't reach the scrim (separate element), so they don't dismiss.
- **Esc** — OPTIONAL. If added, a `useEffect` inside `StatusSheet` that registers a `document` `keydown` listener calling `onClose` on `Escape`, with a cleanup that removes it (dependency `[onClose]`). It fits a desktop modal, but it is unobservable under the repo's server-render tests (no jsdom) — leave to developer discretion; do not block on it. The `×` remains authoritative.

### Icons

Inline SVGs with `fill`/`stroke="currentColor"` and `aria-hidden="true"`, matching the `.composer__send` send-icon precedent (no remote asset fetch — CSP blocks it, and the codebase inlines its SVGs). Two paths: an `expand_less` chevron-up (StatusRow) and an `×`/close glyph (StatusSheet). Color is inherited `currentColor`; set the button/row text color to `--color-on-surface-variant` (the muted secondary-control treatment used for the unpair control and matching the design's muted icons).

### Tokens to add (`tokens.css`)

Two M3 dark-scheme slots the sheet needs are not yet ported. Add them alongside the existing `--color-surface-*` block (the file header explicitly sanctions porting scheme slots ahead of consumers). Values are the resolved M3 default-dark scheme (same source as the existing tokens; confirmed against the Figma variables on node 20:100):

- `--color-surface-container-low: #191c20;` — the sheet panel background (`data-node-id="20:100"`).
- `--color-scrim: #000000;` — the M3 `scrim` role (pure black in both schemes); applied at 40% via `opacity` on the scrim div.

Do **not** add `secondary-container` / `on-secondary-container` / `surface-container-highest` tokens now — those are only used by the scoped-out sections (Effort chip, Download button, context bar) and belong to #181/#182/#72.

### Style notes (token-only, per the stylesheet doctrine)

- Sheet radius `--radius-lg`; handle bar `--radius-full`; handle background `--color-on-surface-variant` at `opacity: 0.4` (opacity is not a color literal — faithful to Figma `opacity-40`; do not introduce `color-mix`, it is unused in this codebase).
- Title `--text-title-large-*`; muted text/icons `--color-on-surface-variant`; title `--color-on-surface`.
- Status-row top border `--color-outline-variant` (see the fallback-hex quirk note above); horizontal padding `--space-4` (16px). The Figma row's 6px vertical padding is off the 4px grid and has no token — use `--space-2` (8px, on-token; the 2px delta is imperceptible on a trigger row) rather than a bare `6px` literal.
- Sheet paddings map to existing space tokens (`--space-3` top / `--space-6` bottom on the panel; `--space-2`/`--space-3`/`--space-4` within the header) — the developer fetches the same Figma context for exact values.

## State + concurrency model

- **One boolean, `useState`, in `ConversationScreen`.** No store slice, no reducer, no discriminated union — a single open/closed toggle is exactly the "trivial single-value local UI state → `useState`" case ADR 0006 carves out. It resets to closed on remount for free (the sheet must not reopen itself across a screen remount), which is the correct behaviour.
- **No async, no subscriptions, no transport.** Pure renderer. The only optional effect is the Esc `keydown` listener (if included), which is a synchronous DOM subscription with a symmetric cleanup — no promises, no `AbortController`, nothing to tear down beyond the listener.
- **No `window.pyry` access at all** — unlike Composer/UnpairControl, this shell dispatches nothing to the bridge. The container smoke-render is trivially bridge-free.

## Error handling

N/A — pure renderer with no failure modes (no network, socket, parse, or permission surface). There is nothing to surface as a banner/dialog. This section is intentionally empty; the sheet renders deterministically from its `open` boolean.

## Testing strategy

`vitest`, server-render only (`renderToStaticMarkup`), **no jsdom/Testing-Library** — extend `ConversationScreen.test.tsx` exactly as-is. Interactive `useState` transitions (trigger-click opens, close-click/backdrop dismisses) are not reachable under server render; per the file's own documented convention (`#166`/`#31` comment blocks) they are "trivial useState glue" asserted through the pure surface, not a click harness. Do **not** introduce a DOM harness — that would be scope creep against the established pattern.

Cover, as bullet-scenarios (developer writes the assertions in the file's `bubbleCount`-style idiom):

- **`StatusSheet` (render `<StatusSheet onClose={() => {}} />` directly, the MessageThread pattern):**
  - Renders the title text `Run configuration`.
  - Renders the close control — assert its accessible name (`aria-label="Close"`) is present.
  - Renders the drag handle (assert the `status-sheet__handle` marker) and the dialog role (`role="dialog"`, `aria-modal="true"`).
  - Renders an **empty** scrollable body — assert the `status-sheet__body` marker is present AND that none of the scoped-out section labels (`Model`, `Effort`, `YOLO`, `Context window`, `Log data`, `Download`) appear. This pins "shell only, no sections."
- **`ConversationScreen` container (server-render, closed initial state):**
  - Renders the status-row trigger — assert its accessible name `aria-label="Run configuration"` is present (StatusRow always renders, so this is reachable).
  - The sheet is **absent** while closed — assert the close control (`aria-label="Close"`) is NOT in the markup. (Disambiguate from the trigger: `Run configuration` appears as both the trigger's `aria-label` and the sheet title, so key the "sheet closed" assertion on `aria-label="Close"`, which exists only inside the sheet.)
  - **No live summary** — assert the sample summary fragments (`Opus 4.7`, `% used`, `high`) are absent, pinning the scoped-out summary (AC4).

Type coverage via `npm run typecheck`; `StatusSheetProps` is a one-field interface. Confirm `npm run build` (the salvage/QA gate) is green.

## Open questions

- **Esc-to-close:** include it or not? Recommended-optional; unobservable under the current test harness. Developer's call — the `×` is authoritative regardless. (No blocker either way.)
- **Panel width on wide windows:** the shell is short (header only), so width is not load-bearing yet. Full-window-width bottom sheet is the faithful "mobile stretched" default; a `max-width`-centered card is a reasonable desktop refinement but is a layout decision deferred with the rest of the desktop-specific layout. Either is acceptable for the shell; the section follow-ups won't be affected.
