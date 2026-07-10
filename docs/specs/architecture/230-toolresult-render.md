# 230 — Render resolved tool-call rows on the conversation thread

The render slice of desktop's Phase-2 structured-streaming vertical (`#206` split;
transport sibling `#229` merged, PR #232). Extends `#218`'s **pending** tool-row chip to
resolve in place when its `result` fills — success or error — driven by `item.result`.
Pure renderer: no store, no transport, no IPC, no wire types. Everything it consumes
(`ToolResult`, the `result: ToolResult | null` field, `fillResult` correlation) already
shipped in `#121`.

## Files to read first

- `src/renderer/src/screens/conversation/ConversationScreen.tsx:149-197` — `TimelineRow`,
  the `switch (item.kind)`. **Extend only the `case 'toolCall'` arm (176-191)** — do NOT add
  a component (ticket constraint). Note the deliberate no-`default`/no-`assertNever` exhaustive
  switch (comment at 145-148): keep it; the arm still `return`s a single element.
- `src/renderer/src/store/threadTimeline.ts:13-34` — `ToolResult { isError, resultSummary }`
  and the `toolCall` member's `result: ToolResult | null`. **Read-only** — the shape and the
  `fillResult`-fills-in-place correlation (89-105) already exist; this slice renders from them.
- `src/renderer/src/screens/conversation/conversation.css:209-266` — the `#218` `.tool-row*`
  block. `.tool-row { opacity: 0.5 }` (217-221) **is** the pending dimming this slice lifts;
  `.tool-row__chip` (226-237) carries the `--color-outline-variant` border to override on error.
- `src/renderer/src/theme/tokens.css:12-32` — the color tokens. `--color-success: #2fc038` is
  **live** (line 32; used pairing.css:123, conversation.css:894). There is **no** error family
  — introduce `--color-error` here (see Design). Note the header: "Resolved Material 3 default
  (dark) scheme"; the neutrals match M3 baseline exactly, so the error token mirrors the same scheme.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:118-201` — the `#218`
  pending-tool-row cases inside `describe('Timeline …')`, plus the `threadBubbleCount` /
  `CURSOR` helpers (64-68) and the server-render idiom (`renderToStaticMarkup`, injected
  `ThreadItem[]`, no store). Keep the pending case; add resolved-success and resolved-error.

## Context

Today a `toolCall` row renders as a compact chip (tool name + input summary) at 50% opacity —
the pending/unresolved dimming (`#218`, PR #222). When the correlated `tool_result` arrives,
`#121`'s reducer fills that item's `result` in place (matched by `toolUseId`, replacing the
`toolCall` at its own array index, so the row stays put). Nothing draws the filled state yet, so
a resolved call looks perpetually pending. This slice reads `item.result` and draws the resolved
state: the dimming lifts, and `result.isError` selects a visually distinct success vs error
treatment. Since `fillResult` mutates the existing item at its index, the Timeline's array-index
`key` is untouched — the row resolves in place, no remount, no re-key.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-28

A single left-aligned tool chip (frame `16:29`): `--color-surface-container` fill, a 1px
`--color-outline-variant` border, 12px radius, holding a monospace `--color-tertiary` tool name
(`16:30`) and a muted `--color-on-surface-variant` input summary (`16:31`), the whole row at 50%
opacity. **The mock has no success/error variant and no result-text slot** — it shows only
name + input summary. Per the ticket, the resolved **success** state IS this chip with the
pending dimming lifted (nothing added); the resolved **error** state has no mock, so the architect
introduces the treatment from an M3-dark error token (below). Confirmed via `get_design_context`
+ `get_screenshot` (the chip is 1:1 with the shipped `#218` markup) and `get_variable_defs`
(no node in this file references the M3 error scheme — nothing to mirror from a design node; see
Design).

## Design

### Where the change lives

One arm — `case 'toolCall'` in `TimelineRow`. It already reads `item.name` and
`item.inputSummary`; it now also reads `item.result` (`ToolResult | null`, narrowed by the
`kind === 'toolCall'` case). The chip's inner markup (`.tool-row__chip`, the two spans) is
**unchanged**. Only the **wrapper `className`** varies with `result`, and the CSS keys the
resolved treatment off that.

### className contract (the load-bearing seam)

The `.tool-row` wrapper's class list, by `result`:

| `item.result`            | wrapper `className`                        | meaning                    |
| ------------------------ | ------------------------------------------ | -------------------------- |
| `null`                   | `tool-row`                                 | pending — **unchanged**    |
| filled, `isError: false` | `tool-row tool-row--resolved`              | resolved success           |
| filled, `isError: true`  | `tool-row tool-row--resolved tool-row--error` | resolved error          |

- `tool-row--resolved` is present iff `result !== null` (lifts the pending dimming; both outcomes).
- `tool-row--error` is added on top iff `result.isError` (the error accent; error only).

Build the string in the arm from `item.result` (a small ternary / conditional join). Do not
introduce a modifier component or a shared helper — it's a two-boolean derivation inline in the arm.

### Result text is NOT surfaced (architect call)

The resolved chip continues to show **only** `name` + `inputSummary` — `result.resultSummary`
is **not** rendered. Rationale: (1) the Figma mock has no result-text slot; (2) the user story
("see how each tool invocation turned out rather than a row that stays perpetually pending") is
satisfied by the not-pending signal (opacity lift) plus the success/error distinction (`isError`);
(3) it keeps the untrusted-text surface at exactly today's two fields. This discharges AC4 by
adding no new untrusted surface. (If a later ticket adds a result-text slot, it renders
`resultSummary` as inert React children exactly like `name`/`inputSummary` — never
`dangerouslySetInnerHTML`.)

### New token — `--color-error`

`tokens.css` has `--color-success` but no error family (two `conversation.css` comments at
lines 68, 652 record "there is no --color-error token on desktop"). Introduce **one** token
in `tokens.css`, in the color block beside `--color-success` (line 32):

```
--color-error: #ffb4ab;   /* M3 default (dark) error role — error tone 80 */
```

**Provenance (why this value, not an invented literal):** the file header declares the palette
the "Resolved Material 3 default (dark) scheme"; its neutrals match the M3 baseline exactly
(`--color-surface: #101418`, `--color-surface-container: #1d2024`, `--color-on-surface: #e0e2e8`).
M3's error tonal palette is fixed unless a designer sets a custom error hue — and **no node in
this Figma file references the error scheme** (`get_variable_defs` on the tool row and the Dialogs
section surfaces only surface/tertiary/outline/on-surface-variant; the Dialogs have no error
element to customize against). So the faithful mirror is the M3 default dark `error` role, tone
80 = `#ffb4ab`. This is the value inlined above — the developer does not need to re-fetch it.

Introduce only this one token: the chosen error treatment (border tint, below) consumes exactly
`--color-error`. Do not port `on-error` / `error-container` / `on-error-container` — no consumer,
and AC3 asks for the one token the treatment derives from. (The two stale "no --color-error
token" comments in `conversation.css` concern the composer hint / re-pair control, not the tool
row — leave them untouched; updating them is out of scope.)

### CSS treatment (append to the `.tool-row*` block, `conversation.css`)

Two rules, placed **immediately after** the existing `.tool-row { … opacity: 0.5 }` block so
source order gives the modifier precedence over the base opacity (both are single-class,
equal-specificity selectors):

```
.tool-row--resolved { opacity: 1; }                 /* lift the pending dimming */
.tool-row--error .tool-row__chip {                  /* error accent — the only outcome that recolors */
  border-color: var(--color-error);
}
```

- **Pending → success** distinction: `opacity: 0.5` → `opacity: 1`.
- **Success → error** distinction: neutral `--color-outline-variant` chip border →
  `--color-error` border. Success adds no accent (faithful to the mock: "the existing chip with
  the pending dimming lifted"). Zero color literals; `--color-error` is the only new token consumed.

## State + concurrency model

None. `TimelineRow` is a pure, synchronous function of its `item` prop. The container
(`ConversationScreen`) already selects `selectItems` from the timeline store and passes the
`readonly ThreadItem[]` to the pure `Timeline` view; this slice touches neither the store, a
selector, nor an effect. Tests inject a `ThreadItem[]` with `result` pre-filled and server-render
— no store, no async. Production remains inert until `#179` flips `interactive` (the timeline
store stays empty), unchanged by this slice.

## Error handling

- `result.isError === true` is a rendered **state**, not an application error — no throw, no
  fallback. The reducer already treats an orphan/duplicate `tool_result` as a same-reference
  no-op (`fillResult`), so this view only ever sees a coherently-filled `result`.
- Untrusted daemon text: `name` and `inputSummary` remain inert React children (auto-escaped),
  as `#218`/`#203` established. `resultSummary` is **not surfaced** (above), so this slice adds no
  new untrusted surface. No `dangerouslySetInnerHTML`, no markup/path interpretation.
- Exhaustiveness: the arm stays inside the existing no-`default` switch; a future fourth
  `ThreadItem.kind` still trips the compile-time "not all paths return" guard.

## Testing strategy

`vitest` + `renderToStaticMarkup`, extending `describe('Timeline …')` in
`ConversationScreen.test.tsx`. Keep every `#218` pending case unchanged (AC1 regression guard).
Add, as injected `ThreadItem[]` with a filled `result`:

- **Resolved success** — a `toolCall` with `result: { isError: false, resultSummary: '…' }`.
  Assert the wrapper carries `tool-row--resolved` and **not** `tool-row--error`; the chip still
  carries `tool-row__chip` + `data-thread-role="tool"`; `name` and `inputSummary` still render
  verbatim; still 0 assistant bubbles and no `CURSOR`.
- **Resolved error** — same item with `result: { isError: true, … }`. Assert the wrapper carries
  **both** `tool-row--resolved` and `tool-row--error`.
- **Pending unchanged** — the existing `result: null` case: assert `tool-row` present and
  `tool-row--resolved` **absent** (pins that the pending path is untouched — the AC1 guard).
- **resultSummary not leaked** — give the error case a distinctive `resultSummary` sentinel and
  assert the markup does **not** contain it (pins the "result text not surfaced" architect call,
  and by construction there's no unescaped-untrusted-text path to regress).

Bullet scenarios only — the developer writes them in the file's existing idiom (string-substring
assertions on `renderToStaticMarkup` output, the `threadBubbleCount` / `CURSOR` helpers). No new
key-churn test: the array-index key is untouched (`fillResult` replaces in place), same as `#218`.

`npm run typecheck` covers the `result`-narrowing (the `kind === 'toolCall'` case narrows
`item.result` to `ToolResult | null`; reading `.isError` after a `!== null` check needs no cast).
`npm run build` + `npm test` are the regression gate (AC6).

## Open questions

- **Color-only error signal.** The error state is distinguished from success by border color
  alone (a WCAG color-only concern). The mobile design has no error mock and there is no a11y AC,
  so this slice matches the codebase's existing decorative-thread posture (opacity/color as
  de-emphasis, no ARIA on thread rows). If a later desktop-design pass wants a non-color signal
  (a "failed" label / icon / `aria-label`), that's a follow-up — not built here (no observed need).
- **Error border vs tertiary name proximity.** `--color-error` (#ffb4ab) and `--color-tertiary`
  (#ffb59f, the tool-name color) are both coral; the error signal is the border shifting from
  neutral gray (`--color-outline-variant`) to coral, which reads distinctly against the gray
  success border. If visual review finds it too subtle, the fallback is an error-container fill
  (needs `--color-error-container` + `--color-on-error-container`) — deferred unless observed.

## Acceptance criteria mapping

- AC1 (pending unchanged) — `result: null` → `className="tool-row"`, arm inner markup untouched.
- AC2 (resolved success distinct from pending) — `tool-row--resolved` lifts opacity 0.5 → 1.
- AC3 (resolved error, driven by `isError`, from an introduced token) — `tool-row--error` tints
  the chip border with the new `--color-error` (M3 dark error, `#ffb4ab`); no bare literal.
- AC4 (untrusted text inert) — `resultSummary` not surfaced; `name`/`inputSummary` stay
  auto-escaped children.
- AC5 (injected `ThreadItem[]`, container/pure-view split) — pure `Timeline`/`TimelineRow`,
  server-rendered in tests, no store.
- AC6 (nothing regresses) — `npm run build` + `npm test` green; pending cases retained.
