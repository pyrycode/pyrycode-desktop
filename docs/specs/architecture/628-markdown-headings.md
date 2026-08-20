# #628 — Size an assistant reply's markdown headings from the type scale

**Size:** S · **Not `security-sensitive`** (CSS-only; does not touch `AssistantMarkdown.tsx`, #608's markdown
security boundary — and that is *enforced*, see § CSS-only is enforced).

---

## Files to read first

Line numbers are as of `ec0a291` (current `main`, #623's PR #627). `conversation.css` churns fast — this
file's own anchors have moved `:369 → :410 → :486` across two tickets — so **the selector is the anchor and
the line is a hint**. If a number misses, search the selector.

| Path | What to extract |
|---|---|
| `src/renderer/src/screens/conversation/conversation.css` — `.bubble__markdown` + `.bubble__markdown > *` (`:355`, `:361`) | The container you hang under, and the direct-child margin reset. Read the comment above `:355`: it explains why the reset is `margin-block` and why nested content is out of scope. |
| same file — `.bubble__markdown pre` (`:378`) | **The precedent for your selector shape.** A descendant selector inside this same container, with a comment stating why it is not `>`. |
| same file — `.bubble` (`:295`) | The body-medium quartet your headings must read as headings *against*, and `word-break: break-word` (`:298`) — inherited, deliberately never restated. |
| same file — `.code-block__header` / `.code-block__body` (`:408`, `:434`) | #623's house style for a four-token type quartet plus its no-`font-family` reasoning. Closest sibling; match its comment density. |
| same file — `.api-retry__counter` (`:537`) | The one rule in the renderer that takes a weight token without its step's size. Read the comment — it is an emphasis override on inherited body-medium, not a type-step assignment. Do not cite it as a counter-precedent to AC1. |
| `src/renderer/src/theme/tokens.css:46-85` | The type scale. Every value you write is one of these. |
| `src/renderer/src/screens/settings/settings.css:95-103` | `.settings__section-header` — the app's own small-heading-over-a-group rule, at label-large. This is the precedent for h5/h6. |
| `src/renderer/src/screens/archive/archive.css:67-74` + `:161-171` | `.archive__title` (title-large) and `.archive__row-title` (title-medium) — two of the eight typed heading rules, and one of title-medium's only two consumers. |
| `src/renderer/src/screens/conversation/AssistantMarkdown.tsx:90-123` | Element overrides. **You are not editing this file.** Read it to see that no heading override exists and why one must not be added. |
| `src/renderer/src/screens/conversation/AssistantMarkdown.test.tsx:44-45` | Two attribute-free exact-string assertions. Your guard that CSS-only held. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:466` | The third such assertion. |
| `e2e/assistant-whitespace.spec.ts:75-90`, `:224-239`, `:320-358` | `RHYTHM_TEXT` (the `<h2>` fixture), `readRhythmMetrics`, and the two live tests. This is where your new test goes and the idiom it copies. |

`codegraph_context` was run and returned only `AssistantMarkdown.tsx:137` plus unrelated test fixtures —
expected, since it parses TS symbols and this ticket's surface is CSS selectors. The list above is from
direct reads.

---

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-8

**N/A for heading treatment specifically — verified against the file, not assumed.** Node `16:43` (the
settled assistant bubble, the binding node) renders as: a paragraph, a `typescript` fenced block with its
header bar, a second paragraph. No heading anywhere in it, and the other four bubbles in `16:21` are a
single text node each. So the design contract here is the **type scale**, not a node to match: headings sit
inside `16:43`'s existing `surface-container-high` fill, its measure and its body-medium type — all three of
which already shipped via #609 and #623 and are untouched here. Code-review's visual-fidelity check is
intentionally skipped for the heading treatment itself. A specific heading design would be a Figma-side
addition to `16:43` first.

---

## Context

A settled assistant reply renders through `.bubble__markdown`. Every block construct in it now carries an
explicit treatment except headings, which still fall through to the UA stylesheet — `2em`/`bold` down to
`0.67em`/`bold`. Nothing is broken; the sizes simply come from the browser instead of the theme, and a
markdown heading is the **only** heading left in this app the browser types.

Verified, not assumed: no `<section>` / `<article>` / `<aside>` / `<nav>` appears anywhere between
`.conversation__thread` and `.bubble__markdown` — every wrapper is a `<div>` (`ConversationScreen.tsx:395`,
`:444`, `:522`). So Chrome's sectioning-scoped `h1` rule never applies and the UA baseline really is `2em`,
as the ticket states.

Two questions the ticket leaves open are closed below by **census over the renderer's own CSS**, in the same
way the weight question was closed: which four steps are heading steps (§ Step selection), and where the six
levels group onto them (§ Level grouping).

---

## Design

### The mapping

| Level | Step | size / line-height / tracking / weight |
|---|---|---|
| `h1` | `headline-small` | 24 / 32 / 0 / 400 |
| `h2` | `title-large` | 22 / 28 / 0 / 400 |
| `h3`, `h4` | `title-medium` | 16 / 24 / 0.15 / 500 |
| `h5`, `h6` | `label-large` | 14 / 20 / 0.1 / 500 |

Sizes: 24, 22, 16, 16, 14, 14 — non-increasing (AC2). None below the bubble's 14px body-medium (AC2).
Weights: 400, 400, 500, 500, 500, 500 — non-decreasing as size falls, which is what keeps the small levels
reading as headings. Tracking: 0, 0, 0.15, 0.15, 0.1, 0.1. All four properties of every level come from one
step (AC1).

### Step selection — why these four, and why not `body-large`

The scale offers five steps at or above 14px. The ticket names `body-large` (16/24/0.5/400) as a candidate.
**Exclude it**, on a census of how the renderer already uses each step:

- **Title/heading roles:** `headline-small` → five screen and dialog titles (`.pairing__title`,
  `.permission-modal__title`, `.create-folder__title`, `.save-as-channel__title`,
  `.rename-conversation__title`). `title-large` → two screen titles (`.archive__title`, `.settings__title`).
  `title-medium` → its **only two** consumers, both titles (`.channel-list__title`, `.archive__row-title`).
  `label-large` → `.settings__section-header`, a small heading over a group.
- **`body-large` → fourteen consumers, not one of them a heading.** Every one is row-body text:
  `.settings__server-row-label`, `.settings__storage-row-label`, `.settings__pair-another-label`,
  `.settings__about-version`, `.settings__default-workspace-label`, `.settings__notifications-row-label`,
  `.save-as-channel__option-label`, `.run-config__model-name`, `.run-config__context-usage`,
  `.run-config__context-unavailable`, `.run-config__running-value`, `.channel-info__row-label`,
  `.workspace-picker__other-label`, and `.run-config__yolo-title`. The last is named "title" and is not one —
  it is a `<p>` carrying the primary label of a toggle row with a caption beneath it
  (`RunConfigSections.tsx:351`).

So the four chosen steps are **exactly the renderer's existing title vocabulary, in order**, and the excluded
one is its row-body step. The mapping is not invented; it is the app's own heading ladder.

A second, independent argument reaches the same conclusion. `body-large` is weight **400** — the same weight
as `.bubble`'s body-medium — at the loosest tracking in the scale (0.5). An `h4` there would differ from the
surrounding body text by 2px of size and nothing else, while the `h5` beneath it at `label-large` would carry
a weight step. The ladder would produce an `h4` that reads *less* like a heading than the `h5` under it.
Dropping `body-large` also stops tracking from spiking to 0.5 in the middle of the ladder.

### Level grouping — why (h1)(h2)(h3,h4)(h5,h6)

Four steps, six levels: two collapses are forced. Following the precedent the ticket names — the same `<h2>`
element is `headline-small` in four dialogs and `label-large` in settings, so **the step follows role, not
tag** — the levels group into three role tiers with the top one split:

- **h1, h2 — document-level headings.** The reply's title and its major sections; the levels assistant
  replies actually use. Each earns its own step.
- **h3, h4 — subsection headings.** `title-medium`, the renderer's row/section-title step.
- **h5, h6 — minor run-in headings.** `label-large`, precisely what `.settings__section-header` uses for a
  small heading over a group.

Rejected: `(h3)(h4,h5,h6)` drops `h4` straight to body size and spends the remaining distinction on levels
that essentially never occur in an assistant reply. `(h3,h4,h5)(h6)` spends it on the rarest level of all.

**How a 14px level still reads as a heading.** `h5`/`h6` match the bubble's body size exactly, which AC2
permits ("no level renders *smaller*"). They separate on weight and tracking: `label-large` is 500/0.1
against body-medium's 400/0.25. That is the same discriminator `.settings__section-header` already relies on.

### Selector shape

Four rules under the container, **descendant selectors, not `>`** — so a heading nested in a blockquote or a
list item is sized too (AC-adjacent; the ticket asks for this), and matching `.bubble__markdown pre`, the
existing precedent in this same container.

```css
.bubble__markdown h1 { /* headline-small quartet */ }
.bubble__markdown h2 { /* title-large quartet */ }
.bubble__markdown h3,
.bubble__markdown h4 { /* title-medium quartet */ }
.bubble__markdown h5,
.bubble__markdown h6 { /* label-large quartet */ }
```

Each body is the four type declarations in the file's established order — `font-size`, `line-height`,
`letter-spacing`, `font-weight` — as `.code-block__header` and `.code-block__body` write them. Place the
block after `.bubble__markdown pre` and before `.code-block`, so the container's own rules stay contiguous.

### What these rules must NOT declare

Each omission below is load-bearing; state the reason in the comment block rather than leaving a reader to
wonder whether it was forgotten.

- **No `margin` or `margin-block`.** `.bubble__markdown > *` already zeroes it for direct children, and the
  nested-content reset belongs to **#629**. This ticket adds and removes no margin anywhere. Enforced — see
  § Testing.
- **No `color`.** Headings inherit `--color-on-surface` from `.bubble--daemon`. AC5 forbids new colour.
- **No `font-family`.** `--font-sans` inherits from `.conversation`, and the UA heading rules set size,
  weight and margin only — the same reasoning `.code-block__header` already records.
- **No `word-break`.** Inherited from `.bubble` (`:298`); #607 set that precedent and #623 followed it.
- **No `display`.** Headings are block-level, and as flex items of `.bubble__markdown` they are blockified
  and stretched regardless.

### CSS-only is enforced, not preferred

`AssistantMarkdown.test.tsx:44-45` asserts `'<h1>Heading one</h1>'` and `'<h2>Heading two</h2>'`;
`ConversationScreen.test.tsx:466` asserts the first again. **Attribute-free markup, matched as exact
substrings.** Adding a `className` to a heading through an `AssistantMarkdown` `components` override fails
three assertions across two specs. That is the mechanical reason this ticket stays out of #608's security
boundary and off the `security-sensitive` label — a stronger reason than the #607 precedent alone.

### Reach

`.bubble__markdown` is rendered at exactly one call site — `ConversationScreen.tsx:522`, the settled
assistant reply. It appears nowhere else in the renderer. So these rules cannot reach `.bubble--user`
(`:587`, no markdown container) nor the four chrome affordances `.bubble--thinking` / `.bubble--stall` /
`.bubble--api-retry` / `.bubble--compacting` (`:788`, `:817`, `:883`, `:923` — each a bare text child). Nor a
fenced code block: a fence's content is text, so no heading element can occur inside `.code-block`
(AC5).

Specificity is uncontested. `.bubble__markdown h1` is (0,1,1) in author origin; the UA rule it replaces is
(0,0,1) in UA origin, and author beats UA whatever the specificity. `.bubble__markdown > *` sets only
`margin-block`, a property none of these rules touch.

---

## State and concurrency model

None. Static CSS, no store slice, no async work, no lifecycle.

## Error handling

None. There is no failure mode: a level for which no rule matched would fall back to the UA stylesheet, and
all six are covered.

---

## Testing strategy

### No new unit test

Renderer unit tests are server-render only (`renderToStaticMarkup`, vitest `node` environment, no DOM), so
computed size is invisible to that tier. A unit test asserting that `h3`–`h6` render as heading elements
would assert react-markdown's behaviour, not this ticket's change. The three existing attribute-free
assertions are already the right guard, and they guard the thing that can actually regress here — the CSS-only
constraint. **Leave `AssistantMarkdown.test.tsx` and `ConversationScreen.test.tsx` untouched.**

### One new e2e test in `e2e/assistant-whitespace.spec.ts`

#623 shipped on unit assertions plus review with no new e2e, and the ticket allows that shape. It is not the
right call here: AC1's "all four properties from a single step" and AC5's "no literal" are exactly the claims
a computed-style read can settle deterministically, the spec already owns that idiom, and — decisively — the
fixture already renders a heading, so the test costs no fixture change.

Add one test that reads the **existing** `RHYTHM` bubble's `<h2>`:

- A helper alongside `readRhythmMetrics`, same `locator.evaluate()` shape, resolving
  `.bubble__markdown h2` inside `assistantBubble(page, RHYTHM)`. In one evaluate it returns the element's
  computed `fontSize`, `lineHeight`, `letterSpacing` and `fontWeight`, **and** the four
  `--text-title-large-*` custom properties read off that same element at runtime.
- The test asserts the four computed values equal the four token values. Reading the expected values from the
  tokens rather than writing `22px` keeps this spec literal-free, exactly as `readRhythmMetrics` reads
  `--space-2` instead of writing `8`.
- Comment the *why*: this proves the rule reaches a heading inside the container at all, that its values come
  from the scale rather than from literals, and that all four come from one step — three things review can
  only confirm by eye.

**Hard constraints on this edit.** Do not touch `RHYTHM_TEXT`, `RHYTHM_BLOCK_COUNT` or `SETTLED_TEXTS`. The
reply stream is indexed positionally (`CONTROL / SPACE_RUN / CODE / RHYTHM / TAIL`), and the rhythm test
asserts `blockCount === RHYTHM_BLOCK_COUNT`, so adding a turn shifts every index and adding a block to
`RHYTHM_TEXT` breaks that assertion. The existing `<h2>` is all you need; one level of six proves the class of
failure that matters.

### What is already covered — do not re-guard

- **AC3 (no horizontal scrollbar)** is live today at `assistant-whitespace.spec.ts:328-329`. That assertion
  runs after `streamTheFiveReplies`, which streams the RHYTHM turn and its `<h2>`, so a larger heading passes
  through the existing guard for free. No new work, and no `word-break` on headings.
- **AC4 (the 8px rhythm)** is live at `:343-357`, and it **cannot fire on a larger heading**.
  `readRhythmMetrics` reads `getBoundingClientRect()` — border boxes — and computes each gap as
  `rect.top - blocks[i].bottom`. A bigger `font-size` or `line-height` grows the heading's box inside its own
  borders and moves no gap; only a margin does. The fixture's `<h2>` also sits at index 1, so
  `firstOffsetPx` (index 0) and `lastOffsetPx` (the `<ul>`) are untouched either way. **Do not write the spec
  or the CSS defensively around this test** — but note it does fire, correctly, if you add a margin.

### Gates

`npm run typecheck` does not see `e2e/*.spec.ts` (it is outside both tsconfigs), so type errors in the new
test surface only when Playwright runs it. `npm run build` and `npm test` are unaffected by a CSS-only
production change; the three heading assertions are the ones to watch.

---

## Open questions

None blocking. One note for whoever picks up **#629**: nested headings (a heading inside a blockquote or a
list item) are matched by these descendant selectors and therefore sized correctly, but they are not direct
children of `.bubble__markdown`, so they keep their UA `margin-block`. That leftover reset is #629's, shared
with nested paragraphs and lists — do not fix it here.
