# Spec #1 — App shell and theme tokens

**Ticket:** https://github.com/pyrycode/pyrycode-desktop/issues/1
**Size:** S · **Scope:** renderer-only (`src/renderer/`) · **No transport, no store, no network, no new dependencies.**

First ticket toward Phase 0. Build the visual shell — a scrollable message thread above a pinned composer — plus the M3 theme tokens the whole renderer will consume, using static placeholder data. #2 wires connection/conversation state; #12 renders real streamed replies. Both bind to the seams this ticket establishes.

---

## Files to read first

Codegraph is **not** initialized for this repo (`codegraph init` never run); the renderer surface is two files, both listed below. Read these before writing:

- `src/renderer/src/App.tsx:1-13` — current skeleton root. Replace its body with `<ConversationScreen />`. Note: **no `import React`** — the project uses the automatic JSX runtime (`jsx: react-jsx`).
- `src/renderer/src/main.tsx:1-11` — entry point; imports `./index.css` under `<React.StrictMode>`. CSS import order lives here.
- `src/renderer/src/index.css:1-27` — skeleton styles to replace. Keep `body { margin: 0 }`; add the full-height chain and the tokens import.
- `src/renderer/index.html:1-16` — **CSP is `default-src 'self'`** (self-only): no remote fonts, no CDN, no runtime fetch of Figma assets. `#root` is the mount.
- `electron.vite.config.ts:12-20` — renderer aliases `@renderer` → `src/renderer/src`, `@shared` → `src/shared`. The new `vitest.config.ts` must mirror these or TSX tests won't resolve imports.
- `tsconfig.web.json:1-21` — `jsx: react-jsx` (automatic runtime → components need no React import), `strict`, DOM libs on.
- `src/shared/wire/types.test.ts:1-16` — the existing test idiom: **explicit** `import { describe, it, expect } from 'vitest'` (no globals). Follow it; do not enable vitest globals.
- `package.json:9-31` — `test` = `vitest run --passWithNoTests`; `build` = `typecheck && electron-vite build` (the salvage/QA gate). `react-dom` and `@vitejs/plugin-react` are already present — **no dependency additions needed** (see Testing strategy).
- `docs/knowledge/decisions/0001-stack-electron-react-typescript.md` — stack rationale. This ticket is renderer-only and touches none of the transport concerns it describes.
- **Figma node `16-8`** (Design source, below) — the developer should fetch `get_design_context` for the exact bubble/composer styling before writing CSS.

---

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-8

The mobile **Conversation Thread** screen: a dark-scheme vertical column — a scrollable message list of chat bubbles (right-aligned user bubbles in `primary-container` blue with a clipped bottom-right corner; left-aligned daemon bubbles in `surface-container-high` grey with a clipped bottom-left corner) above a bottom composer (a rounded `surface-container-high` input pill + a circular send button). Type is M3 Roboto; all color/type values are Material 3 `Schemes/*` and `Static/*` variables.

**Scope note — what this ticket builds from that node:** the **message thread** and the **composer** only. The Figma node also shows a **Top App Bar** (back/title/overflow) and a **Status row** (model · context-used), plus richer message kinds (tool-call chips, session delimiters, inline code blocks). Those are **out of scope here** — the app bar and status row surface conversation/connection/model state that lands in #2 and #12, and the richer message kinds are #12's streamed-reply rendering. The developer should reproduce bubble + composer styling faithfully and **not** build the app bar, status row, tool chips, code blocks, or the mic icon. This is intentional; the code-review visual-fidelity check should treat those omissions as spec'd, not gaps.

Two deliberate divergences from the mock (desktop stretches mobile to the window; the ticket forbids fixed pixel widths):
- The mock's bubbles are a **fixed `330px`**. On desktop, use a **max-width**, not a fixed width (see CSS contract).
- The mock's outer **`44px` screen radius** is a phone-frame artifact — the desktop window has no rounded frame; drop it.
- The mock renders upper messages at `opacity: 0.5` (a presentation fade). Render all bubbles at **full opacity**.

---

## Context

The renderer is a bare skeleton (`App.tsx` shows a placeholder heading). This ticket replaces it with the real conversation shell and, critically, establishes the **single source of theme values** — CSS custom properties mirrored from the mobile M3 default (dark) scheme — that every future renderer component references. Getting the token layer right now means #2/#12 add screens without re-deriving colors or type.

---

## Design

### Module structure (renderer only)

```
src/renderer/src/
├── App.tsx                                  (modified) renders <ConversationScreen/>
├── index.css                                (modified) full-height chain + imports tokens.css
├── theme/
│   └── tokens.css                           (new) :root custom properties — the theme foundation
└── screens/conversation/
    ├── ConversationScreen.tsx               (new) the shell; in-file MessageThread, MessageBubble, Composer
    ├── conversation.css                     (new) component styles, all referencing tokens
    ├── placeholderMessages.ts               (new) Message type + static data
    ├── ConversationScreen.test.tsx          (new) structural render test
    └── placeholderMessages.test.ts          (new) data-invariant test
```

Plus `vitest.config.ts` (new, repo root — enables TSX/alias resolution for tests).

**File-count transparency:** 2 new production `.ts/.tsx` (`ConversationScreen.tsx`, `placeholderMessages.ts`) + 1 modified (`App.tsx`); the remainder are CSS (2), tests (2), and one test-config file. Under the §4 production-source-file gate (excludes CSS/tests/config). Total written ≈ 380 LOC, no edit fan-out, no new deps → S.

The composer and message-list renderers are **in-file** functions inside `ConversationScreen.tsx` for now — they are tiny and static. #2 extracts `Composer` when it gains input state + a send dispatch; #12 extracts `MessageThread` when it binds to a store selector. The load-bearing seams are the **props/types below**, not the file boundaries.

### Placeholder data (`placeholderMessages.ts`)

A discriminated union on `type` (the project's sealed-event convention), forward-compatible with the richer kinds #12 adds:

```ts
export type Message =
  | { id: string; type: 'user'; text: string }
  | { id: string; type: 'daemon'; text: string }

export const placeholderMessages: Message[]   // ≥6 items, alternating, ≥1 user + ≥1 daemon
```

Seed enough text (borrow the mock's copy) that the thread overflows a normal window height, so the independent-scroll AC is observable. #12 replaces the static import with store-fed data; keep the array the sole data source so that swap is one line.

### Component contracts (`ConversationScreen.tsx`)

```tsx
export function ConversationScreen(): JSX.Element
// <div class="conversation"> <MessageThread messages={placeholderMessages}/> <Composer/> </div>

function MessageThread({ messages }: { messages: Message[] }): JSX.Element
// scroll container; maps messages → <MessageBubble> with a stable key={m.id}

function MessageBubble({ message }: { message: Message }): JSX.Element
// <div class="message-row message-row--{type}"> <div class="bubble bubble--{type}"
//   data-message-role={message.type}>{message.text}</div> </div>
// the data-message-role attribute is the test hook (see Testing strategy)

function Composer(): JSX.Element
// <div class="composer">
//   <textarea class="composer__input" placeholder="Message…" rows={1}/>
//   <button type="button" class="composer__send" aria-label="Send"><svg .../></button>
// </div>
// INERT this ticket: uncontrolled textarea, no onChange; button has no onClick.
```

- Composer input is a **`<textarea rows={1}>`** (chat-idiomatic; #2 adds controlled state + auto-grow) — not an `<input>`. No auto-grow this ticket; it renders at the design's 48px pill height.
- Send button holds an **inline SVG up-arrow** (author it in-component). No mic icon, no downloaded/remote assets → stays inside the self-only CSP.

### Layout & re-render seams

Static tree, no store, no async, no subscriptions, no teardown. Re-render correctness is trivial this ticket; the only forward-looking seam is `MessageThread`'s `messages` prop (#12 feeds it a narrow store selector) and the inert `Composer` (#2 wires input state + a send action). No global mutable state; no Zustand yet (arrives #2).

---

## Theme tokens (`theme/tokens.css`)

Declared once under `:root`; **every component style references these — no color/type/spacing literals in `conversation.css` or `index.css`.** Values are the resolved M3 default (dark) scheme, read authoritatively from the Figma variables of node `16-8` and inlined here so the developer never needs MCP access to reproduce them.

### Colors — `--color-*`

| Token | Value | M3 variable |
|---|---|---|
| `--color-surface` | `#101418` | Schemes/Surface |
| `--color-surface-container` | `#1d2024` | Schemes/Surface Container |
| `--color-surface-container-high` | `#272a2f` | Schemes/Surface Container High |
| `--color-on-surface` | `#e0e2e8` | Schemes/On Surface |
| `--color-on-surface-variant` | `#c2c7cf` | Schemes/On Surface Variant |
| `--color-primary-container` | `#134a74` | Schemes/Primary Container |
| `--color-on-primary-container` | `#cfe4ff` | Schemes/On Primary Container |
| `--color-outline` | `#8c9199` | Schemes/Outline |
| `--color-outline-variant` | `#42474e` | Schemes/Outline Variant |
| `--color-tertiary` | `#ffb59f` | Schemes/Tertiary |
| `--color-success` | `#2fc038` | Schemes/Success |

`tertiary`, `success`, `outline*`, and the container/variant colors not used by a bubble or the composer are **theme foundation** — port them (they're the Conversation Thread scheme; #12 consumes them for chips/code/status). Bubbles + composer this ticket use: `surface`, `surface-container-high`, `on-surface`, `on-surface-variant`, `primary-container`, `on-primary-container`.

### Typography — `--text-*` + `--font-*`

`--font-sans: 'Roboto', system-ui, -apple-system, sans-serif;` and `--font-mono: 'Roboto Mono', ui-monospace, SFMono-Regular, monospace;` (mono is foundation, unused this ticket). Roboto is **not bundled** — the CSP is self-only and the type scale (size/line-height/tracking/weight) carries M3 fidelity; the family falls back to `system-ui`. Bundling a self-hosted Roboto webfont is an Open Question, deferred.

Each M3 text style → four tokens (`-size`, `-line`, `-tracking`, `-weight`):

| Style | size | line | tracking | weight |
|---|---|---|---|---|
| `--text-title-large-*` | 22px | 28px | 0px | 400 |
| `--text-body-large-*` | 16px | 24px | 0.5px | 400 |
| `--text-body-medium-*` | 14px | 20px | 0.25px | 400 |
| `--text-body-small-*` | 12px | 16px | 0.4px | 400 |
| `--text-label-small-*` | 11px | 16px | 0.5px | 500 |

This ticket references **body-medium** (bubble text) and **body-large** (composer input); the rest are foundation. `title-large`/`body-small`/`label-small` belong to the out-of-scope app bar/chips/code — port them, don't build consumers.

### Spacing — `--space-*` (4px scale)

`--space-1: 4px` · `--space-2: 8px` · `--space-3: 12px` · `--space-4: 16px` · `--space-5: 20px` · `--space-6: 24px`. Off-grid design values get their own named token so **no literal leaks** — notably bubble horizontal padding `14px` (e.g. `--space-bubble-x: 14px`). Bubble padding is `12px 14px` (`--space-3` vertical, `--space-bubble-x` horizontal).

### Radii — `--radius-*`

`--radius-xs: 6px` (bubble tail corner) · `--radius-sm: 12px` (cards — foundation) · `--radius-md: 20px` (bubble main corners) · `--radius-lg: 28px` (composer input pill) · `--radius-full: 9999px` (send button). The mock's `44px` outer screen radius is dropped (phone-frame artifact).

---

## Layout contract (`conversation.css` + `index.css`)

The independent-scroll behaviour rests on **three load-bearing rules**; get these right and the AC follows.

- `index.css`: `html, body, #root { height: 100% }` and keep `body { margin: 0 }`. `@import './theme/tokens.css';` at the top (or import in `main.tsx` before `index.css`). Remove the skeleton `.app` styles.
- `.conversation` — `display: flex; flex-direction: column; height: 100%; background: var(--color-surface); color: var(--color-on-surface);`
- `.conversation__thread` — **`flex: 1 1 auto; min-height: 0; overflow-y: auto;`** — the `min-height: 0` is the flexbox footgun: without it the thread refuses to shrink and the whole window scrolls instead of the region. Gap `var(--space-3)`, padding from tokens.
- `.composer` — **`flex: 0 0 auto;`** — pinned; never grows/shrinks. `display: flex; align-items: flex-end; gap: var(--space-2); background: var(--color-surface);`
- `.message-row` — `display: flex;`; `--user` → `justify-content: flex-end`, `--daemon` → `flex-start`.
- `.bubble` — **`max-width: min(680px, 75%);`** (not a fixed width); `word-break: break-word`. `--user`: `background: var(--color-primary-container); color: var(--color-on-primary-container); border-radius: var(--radius-md) var(--radius-md) var(--radius-xs) var(--radius-md);` (clipped bottom-right). `--daemon`: `background: var(--color-surface-container-high); color: var(--color-on-surface); border-radius: var(--radius-md) var(--radius-md) var(--radius-md) var(--radius-xs);` (clipped bottom-left). Text uses the `body-medium` tokens.
- `.composer__input` — `flex: 1 1 auto; min-width: 0;` (the `min-width: 0` lets it shrink below content width), `background: var(--color-surface-container-high); border-radius: var(--radius-lg);` `body-large` tokens, placeholder color `var(--color-on-surface-variant)`, `resize: none`, no border/outline chrome beyond the pill.
- `.composer__send` — `flex: 0 0 auto; width: 48px; height: 48px; border-radius: var(--radius-full); background: var(--color-surface-container-high);` centered icon, `color: var(--color-on-surface)`.

Border-radius shorthand is TL TR BR BL — verify the two bubble variants against that order.

---

## State + concurrency model

None this ticket. No Zustand, no async, no streams, no `AbortController`, no effects/subscriptions, no teardown. Pure static presentation. Documented seams for later: `MessageThread({ messages })` (→ #12 store selector) and the inert `Composer` (→ #2 input state + send). When the store lands, select narrow slices per the renderer conventions; do not introduce parallel mutable state.

---

## Error handling

Nothing can fail — no I/O, no parsing, no user-triggered state change. The only edge is an **empty `messages` array**, which must render a valid empty scroll region (no crash, no placeholder-of-placeholder). No banners, dialogs, or error surfaces this ticket.

---

## Testing strategy

Two files, **no new dependencies** — this deliberately avoids pulling in `jsdom` + Testing Library before there's any interactivity to exercise (evidence-based: defer the DOM harness to #2, which is the first ticket with real input/click behaviour).

**`vitest.config.ts`** (new, root) — required so TSX tests get the automatic JSX runtime and the `@renderer`/`@shared` aliases:
- `plugins: [react()]` (already a devDep), `resolve.alias` mirroring `electron.vite.config.ts`, `test: { environment: 'node' }` (default; the render test needs no DOM — see below).
- Keep explicit vitest imports (no `globals: true`), matching the existing test.

**`placeholderMessages.test.ts`** (pure data, node) — scenarios:
- the array is non-empty and long enough to overflow (assert `length >= 6`);
- at least one `type: 'user'` and at least one `type: 'daemon'` message exist;
- all `id`s are unique.

**`ConversationScreen.test.tsx`** — render to a static HTML string via `renderToStaticMarkup` from `react-dom/server` (already available; no jsdom). Scenarios:
- renders without throwing;
- the count of `data-message-role="…"` occurrences equals `placeholderMessages.length` (one bubble per message);
- markup contains both `data-message-role="user"` and `data-message-role="daemon"` (both roles present, AC2);
- markup contains a `<textarea` and a send `<button` with `aria-label="Send"` (composer shape, AC3);
- (optional) each placeholder message's text appears in the output.

**Not unit-testable, verified by `npm run build` (typecheck) + manual/review:** AC4 (no hardcoded literals — a review grep for hex/px in `conversation.css`), AC5 (flex resize — static markup and node-env vitest don't do layout), and exact color/type fidelity. Call these out in the PR description as review-gated.

---

## Acceptance criteria → design mapping

1. Vertical shell, scrollable thread above pinned composer → `.conversation` flex column; `.conversation__thread` `flex:1 1 auto; min-height:0; overflow-y:auto`; `.composer` `flex:0 0 auto`.
2. Static placeholder messages, both roles, independent scroll → `placeholderMessages` (≥6, both roles) mapped to role-styled bubbles inside the overflow region.
3. Composer with text input + inert send → in-file `Composer`: uncontrolled `<textarea>` + `<button aria-label="Send">` with no handler.
4. Colors/spacing/type declared once as custom properties, referenced everywhere → `theme/tokens.css`; component CSS uses only `var(--…)`.
5. Resizes cleanly, no fixed pixel widths → flex column with `min-height:0`; bubbles `max-width: min(680px, 75%)`; no fixed `width`.

---

## Open questions

- **Roboto webfont:** ship a self-hosted Roboto (CSP forbids Google Fonts CDN) for exact glyph fidelity, or accept the `system-ui` fallback for the scaffold? Recommend fallback now; revisit if fidelity review flags it.
- **App bar / status row:** confirmed out of scope here — land with connection/conversation state (#2) and model/context state (#12+). Flagging so PO/review agree the Figma node is intentionally only partially realized.
- **DOM test harness (jsdom + Testing Library):** deferred to #2 (first ticket with interactivity). This ticket tests via `renderToStaticMarkup` to stay dependency-free — confirm that trade-off is acceptable.
