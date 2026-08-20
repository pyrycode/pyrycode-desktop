# #629 — Indent an assistant reply's lists and blockquotes within the bubble measure

**Size:** S · **Not `security-sensitive`** (CSS-only; does not touch `AssistantMarkdown.tsx`, #608's markdown
security boundary — and that is *enforced*, see § CSS-only is enforced).

**Every number in this spec was measured**, not reasoned about: the shipping Chromium
(`chromium_headless_shell-1208`) driving the real `tokens.css` + `conversation.css` in the production DOM
shape, plus a pixel scan for the marker overhang, which has no geometry API. The measurements are reported
in § What the browser does today and § The marker budget. Two of them contradict what a careful reader
would otherwise assume, so read those two sections before writing any CSS.

---

## Files to read first

Line numbers are as of `a590d55` (current `main`, #628's PR #631). `conversation.css` churns fast — the
four status-bar anchors have moved twice in two tickets — so **the selector is the anchor and the line is a
hint**. If a number misses, search the selector.

| Path | What to extract |
|---|---|
| `src/renderer/src/screens/conversation/conversation.css` — `.bubble__markdown` + `.bubble__markdown > *` (`:355`, `:361`) | The container you hang under, and the direct-child margin reset. Its comment (`:343-354`) states why the reset is `margin-block` and **names this ticket** as the owner of the nested leftover and of the blockquote's 40px. |
| same file — `.bubble__markdown pre` (`:378`) and the `#628` heading block (`:382-451`) | The two precedents for your selector shape: descendant selectors inside this container, not `>`. #628's comment block is also the density and the reasoning style to match. |
| same file — `.bubble` (`:295`) | `padding: var(--space-3) var(--space-bubble-x)` — the 14px inline padding that half the marker arithmetic runs on. Also `word-break: break-word` (`:298`), inherited, deliberately never restated. |
| same file — `.conversation__thread` (`:233`) | `overflow-y: auto` + `padding: var(--space-2) var(--space-4)` — the other half of the arithmetic. The `overflow-y` is why the other axis computes to `auto` and clips at the **padding** box. |
| same file — `.conversation__banner` (`:134`), `.bubble--stall` (`:578`), `.bubble--compacting` (`:633`), `.modal-rejection` (`:1270`) | The four existing `border-left: 4px solid var(--color-<role>)` bars. Read `.bubble--compacting`'s comment: it spells out the four-way status matrix your bar must not join. Note the width is a raw `4px` in all four. |
| same file — `.code-block` (`:458`) / `.code-block__body` (`:505`) | The fenced block, which AC5 protects. Also `margin-block: 0` restated on the body because `:361` is direct-child only — the same mechanism your nested rules exist for. |
| `src/renderer/src/theme/tokens.css:87-94` | The spacing scale (`--space-1`…`--space-6`, `--space-bubble-x`). `:29-30` for `--color-outline` / `--color-outline-variant`. |
| `src/renderer/src/screens/conversation/AssistantMarkdown.tsx:89-123` | The `components` overrides. **You are not editing this file.** Read it to see there is no `ul`/`ol`/`li`/`blockquote` override and why one must not be added. |
| `src/renderer/src/screens/conversation/AssistantMarkdown.test.tsx:53-56` | Four attribute-free exact-string assertions (`<ol>`, `<ul>`, `<li>alpha</li>`, `<blockquote>`). Your guard that CSS-only held. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:472-473` | Two more (`<li>first item</li>`, `<blockquote>`). Six across the two specs. |
| `e2e/assistant-whitespace.spec.ts:53-96`, `:206-239`, `:263-295`, `:382-431` | The fixture constants, `readRhythmMetrics`, #628's `readHeadingTypeMetrics` (the closest sibling to what you are adding), and the two tests that read the RHYTHM bubble. All your test work lands in this file. |

`codegraph_context` was run against the canonical index and returned `AssistantMarkdown.tsx:137` plus two
unrelated `conversation` test fixtures — the same near-empty result #628 recorded, and expected: it parses
TypeScript symbols and this ticket's surface is CSS selectors. The list above is from direct reads.

---

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-8

**N/A for list and blockquote treatment specifically — verified visually, not assumed.** Node `16:21` (the
message list) was rendered and read: it holds two user bubbles, four daemon bubbles, one `read_file` tool
chip, the workspace-change delimiter and the memory-plugin notice. The assistant replies are paragraphs and
one `typescript` fenced block with its header bar. **No list and no blockquote is drawn anywhere in the
mock.** So the design contract here is the existing spacing tokens and `16:43`'s measure — the bubble's
`surface-container-high` fill, its `min(680px, 75%)` cap and its 14px inline padding, all of which already
shipped and are untouched. Code-review's visual-fidelity check is intentionally skipped for these two
constructs. A specific blockquote or list treatment would be a Figma-side addition to `16:43` first.

---

## Context

A settled assistant reply renders through `.bubble__markdown`. #609 gave that container an 8px flex rhythm
and zeroed the UA `margin-block` on its **direct children**; #623 and #628 typed the fenced block and the
headings. Two constructs are still laid out by the UA stylesheet:

- `ul` / `ol` carry `padding-inline-start: 40px`.
- `blockquote` carries `margin-inline: 40px` — indentation is its **only** visual signal, on both sides.

Inside a bubble capped at `min(680px, 75%)` and already padded 14px each side, 40px per side is a large bite
out of the measure. And because `:361` is a direct-child selector, every block one level down — a `<p>` in a
blockquote, a `<p>` in a loose `<li>`, a list in a blockquote, a blockquote in a blockquote — still carries
its UA `margin-block`. That leftover is one rule covering both containers, which is why lists and
blockquotes are one ticket.

---

## What the browser does today, and what the fix does to it

Measured in `chromium_headless_shell-1208` with the production stylesheet, in the production DOM shape
(`.conversation` → `.conversation__thread` → `.message-row--daemon` → `.bubble.bubble--daemon` →
`.bubble__markdown`), at the bubble's body-medium where 1em = 14px.

| Construct | Today | After the four rules |
|---|---|---|
| `ul` / `ol` `padding-inline-start` | **40px** | 16px |
| `blockquote` `margin-inline` | **40px** each side | 0 |
| `<p>` + `<p>` inside a loose `<li>` | **14px** | 8px |
| `<li>` + `<li>` in a **loose** list | **14px** | 8px |
| `<li>` + `<li>` in a **tight** list | 0px | **8px** (a deliberate change — see § The `li + li` call) |
| the three gaps inside a blockquote (`p`→`p`→`ul`→`blockquote`) | **14 / 14 / 14** | 8 / 8 / 8 |
| top-level block gaps | 8px | 8px (unchanged) |
| `.code-block` left edge / width / border colour | — | unchanged |

**Two facts that a careful reader would otherwise get wrong**, both of which the ticket already records and
both of which this probe re-confirmed:

1. **A list nested in a list item is not one of the leftover cases.** Chromium's UA already zeroes it
   (`:is(ul, ol, menu, dir) :is(ul, ol, menu, dir)`), measured at 0px. That rule does **not** include a
   `div` ancestor, which is why a top-level `<ul>` in `.bubble__markdown` does keep its 14px and `:361`
   stays load-bearing. A test written against a bare nested list would be vacuous — it passes before the fix.
2. **Zeroing the leftover margin gives 0px, not the 8px rhythm.** Flex `gap` applies strictly between flex
   **items**; a blockquote and an `<li>` are block boxes whose children stack in normal flow with no gap at
   all. So the containers have to *establish* the rhythm, not merely clear the UA's. "Reset the leftover
   margin" and "the rhythm holds inside these containers" are different outcomes and AC4 asks for the second.

---

## Design

### The four rules

Contract only — the developer writes the comment block, which is the bulk of the diff in this file's style.

```css
.bubble__markdown ul,
.bubble__markdown ol { padding-inline-start: var(--space-4); }        /* AC1 */

.bubble__markdown blockquote {                                        /* AC1 + AC3 */
  margin-inline: 0;
  padding-inline-start: var(--space-3);
  border-left: 4px solid var(--color-outline);
}

.bubble__markdown li > *,
.bubble__markdown blockquote > * { margin-block: 0; }                 /* AC4, half one */

.bubble__markdown li > * + *,
.bubble__markdown blockquote > * + *,
.bubble__markdown li + li { margin-block-start: var(--space-2); }     /* AC4, half two */
```

Place the block after `.bubble__markdown h5, h6` (`:445`) and before `.code-block` (`:458`), so the
container's own rules stay contiguous — where #628 placed its own.

**Descendant selectors, never `>`, for the first two rules** — a list inside a blockquote and a blockquote
inside a list item must be reached at every depth. This is `.bubble__markdown pre`'s precedent (`:374-377`)
and #628's. The last two rules use `>` deliberately: they scope the rhythm to a container's *own* children,
so it is applied once per level rather than compounding down the tree.

**Mixed logical and physical properties, on purpose.** `margin-inline` and `padding-inline-start` name
exactly the properties the Chromium UA declares on these elements, so each override is one-for-one with the
thing it replaces — the same reasoning `.bubble__markdown > *` uses for `margin-block`. `border-left` is
physical because AC3 asks for the idiom this file already carries four times, and all four write
`border-left: 4px solid var(--color-<role>)`. Say this in the comment; a reviewer will otherwise read the
mix as an oversight.

### AC1 — the list indent: why `--space-4`

The ticket floors it at `--space-4` (16px) and leaves wider as a spec call. **Take the floor.**

- 16px is the smallest step at which a bullet and a single-digit ordered marker sit fully inside the list's
  own box (both measure exactly 16px — § The marker budget). Anything narrower puts the commonest marker of
  all outside it.
- The arithmetic below shows every AC2 clause holds at 16px with room to spare, so a wider token buys marker
  headroom that is not needed.
- Indent **compounds with depth** and lists are where depth actually lives: measured content-box lefts at
  16px are 46 / 62 / 78 for depths 1 / 2 / 3 against a bubble content edge of 30. At `--space-6` the same
  three-deep list would sit 72px in.
- It makes both containers indent their content by exactly one `--space-4`: the blockquote's 4px bar plus
  `--space-3` of padding is also 16px (measured content-box left 46, same as the depth-1 list). One indent
  step for the whole reply, and the same step `.conversation__thread` insets its bubbles by.

### AC2 — the marker budget and the arithmetic

`list-style-position` defaults to `outside`, so a marker paints to the **left** of the list's content box.
There is no geometry API for `::marker`, so the widths below come from a pixel scan: render each marker on a
white ground with the list's `padding-inline-start` zeroed, screenshot, and find the leftmost ink pixel in
the item's row band. Measured from the list's content edge, at body-medium:

| marker | measured ink | AC budget (the ticket's figure) |
|---|---|---|
| bullet | 16px | 16px |
| `1.` … `9.` | 16–17px | 16px |
| `10.` … `99.` | 25–26px | 28px |
| `100.` … `999.` | 34px | 40px |
| `1000.` | 43px | (past the AC's scope) |

The ticket's figures run ~3px wider than the ink for the multi-digit cases, and its overhang columns match
this scan exactly (28−16 = 12 against a measured 25−16 = 9; 40−24 = 16 against 34−24 = 10). **Use the
ticket's figures as the budget**: they are the conservative side, they are what the AC is written against,
and the extra headroom absorbs the font question — `--font-sans` falls back to `system-ui` because Roboto is
not bundled, so digit advance widths are platform-dependent.

At an indent of 16px, with `.bubble`'s 14px inline padding and `.conversation__thread`'s 16px:

| marker | overhang past the list box | budget it must fit in | result |
|---|---|---|---|
| bullet, `1.`–`9.` | 0px | — | sits inside the list's own box |
| `10.`–`99.` | 12px | bubble padding-left, 14px | paints on the bubble's fill (the background paints the padding box) |
| `100.`–`999.` | 24px | 14 + 16 = **30px** | paints inside the thread's padding box, so not clipped |

The 30px figure is what makes this arithmetic rather than taste: `.conversation__thread` declares
`overflow-y: auto`, so the other axis computes to `auto` (verified: computed `overflow-x` is `auto`) and a
scroll container clips at its **padding** box. Left-side overflow in LTR is unreachable by scrolling, so
30px is a hard edge, and every marker the AC names lands inside it.

**"At every nesting depth" is discharged by the depth-1 bound.** Each level adds one indent, so a marker at
depth *n* sits (*n*−1)×16px further right than the same marker at depth 1 — nesting only ever *adds* slack.
Depth 1 is the worst case. The test asserts the monotonicity rather than enumerating depths.

### AC3 — the blockquote accent: why `--color-outline`

The bar must take a neutral role: `--color-error` and `--color-primary` are the status vocabulary the four
chrome affordances own (`.conversation__banner` error, `.bubble--stall` error, `.bubble--compacting`
primary, `.modal-rejection` error), and a blockquote wearing one would read as a stall or a compaction to
someone scanning the same thread. That leaves `--color-outline` (#8c9199) and `--color-outline-variant`
(#42474e), both already border roles in this file.

**`--color-outline`, and the choice is not a taste call.** Against the daemon bubble's own
`--color-surface-container-high` (#272a2f) fill, `--color-outline` is a **4.6:1** luminance contrast and
`--color-outline-variant` is **1.5:1**. The bar is the blockquote's only signal besides indentation, so it
is a meaningful non-text graphical object and 3:1 is the floor it has to clear; the variant fails it by a
wide margin. (The variant reads fine where it is already used — `.code-block`'s border sits on
`--color-surface` #101418, a darker fill.)

**Bar only; do not also mute the text.** `--color-on-surface-variant` on a daemon bubble is this file's
"transient working state" signal — it is exactly what `.bubble--thinking` and `.bubble--compacting` use. A
blockquote is settled content, so muting it would put it in the same visual class as a status affordance.
The same argument that rules out the error and primary bars rules out the muted text. State this in the
comment; it is the natural next reach for whoever reads the rule later.

### AC4 — the nested rhythm: why margins, not a flex column

The obvious move is to clone `.bubble__markdown` — `display: flex; flex-direction: column; gap` — onto both
containers. **It cannot be done for `<li>`:** `list-item` combines only with `flow` / `flow-root` in
`display`, so `display: flex` on a list item computes away its `list-item` outer display and the marker
disappears. Rather than run two mechanisms for two containers, both use the same adjacent-sibling margin
pair: zero the UA's leftover, then re-establish the container's own step between consecutive children.

Margin collapsing does not disturb it — the only margin in play on any adjacent pair is the later sibling's
top, so the collapsed value is that margin. Measured: all four AC4 cases land on exactly 8px, and the
top-level rhythm is untouched at 8px.

### The `li + li` call — the regression that zeroing creates

Today a **loose** list's items are separated by the 14px `margin-block` on the `<p>` inside each item. Zeroing
that for AC4 takes the separation to **0px** (measured, both numbers). A loose item would then show 8px
between its own two paragraphs and 0px at the item boundary — intra-item spacing wider than inter-item
spacing, which reads as broken. So the same step is restored between items.

The consequence, stated plainly because review will see it: a **tight** list's items go from 0px to 8px.
That is a visible change to the commonest markdown construct in a reply, and it is a deliberate call, not a
side effect. One rhythm number for everything inside the container is the principle `.bubble__markdown`'s
single `gap` already embodies, and AC4's own wording is "the same one spacing token apart as top-level
blocks do".

Rejected: `li:has(> p) + li`, which would restore loose lists only and leave tight ones at 0px. It preserves
CommonMark's loose/tight distinction, but `:has()` appears nowhere in this codebase and would be introduced
to protect a distinction the container's design flattens by intent. Not worth the new selector feature.

### What these rules must NOT declare

Each omission is load-bearing; put the reason in the comment rather than leaving a reader to wonder.

- **No `color` anywhere.** AC3's accent is the border; AC5 forbids new colour. See § AC3 for why the muted
  text specifically must not be reached for.
- **No `padding-block` on the blockquote.** It would add internal space the rhythm does not ask for, and the
  8px above and below it already comes from the container's `gap`.
- **No `list-style` / `list-style-position`.** Switching to `inside` would dodge the marker question by
  reflowing the marker into the text column — a different visual construct, and not what the AC asks for.
- **No `word-break`.** Inherited from `.bubble` (`:298`); #607 set that precedent and #623 and #628 followed it.
- **No `overflow` or `max-width` on the list.** The marker arithmetic depends on the thread's clip, not on a
  new one; `.unrecognized-row__raw` is the anti-precedent `:369-371` already records.
- **No size, colour or radius literal**, per AC5 — with the one carve-out AC5 itself grants: the bar's `4px`
  **width** is a raw literal, exactly as the four existing bars write it. Border widths in this file are
  never tokens.

### Reach and specificity

`.bubble__markdown` is rendered at exactly one call site — `ConversationScreen.tsx:522`, the settled
assistant reply — and appears nowhere else in the renderer. That single fact is the whole reach argument:
these rules cannot touch `.bubble--user` (no markdown container) nor the four chrome affordances (each a
bare text child of `.bubble--daemon`).

A fenced code block is untouched: a top-level fence is a **direct** child of the container, so neither `li >`
nor `blockquote >` reaches it, and nothing here declares a property `.code-block` sets. Verified — its left
edge, width and border colour are identical before and after. A fence *nested* inside a list item or a
blockquote does gain the 8px rhythm from its neighbour, which is the intended AC4 behaviour and changes none
of the block's own chrome.

Specificity is uncontested. `.bubble__markdown blockquote` is (0,1,1) against a (0,0,1) UA rule, and author
origin beats UA regardless. `.bubble__markdown > *` sets only `margin-block`; the blockquote rule sets
`margin-inline`, a different property, so the two coexist rather than compete.

### CSS-only is enforced, not preferred

`AssistantMarkdown.test.tsx:53-56` asserts `'<ol>'`, `'<ul>'`, `'<li>alpha</li>'` and `'<blockquote>'`;
`ConversationScreen.test.tsx:472-473` asserts `'<li>first item</li>'` and `'<blockquote>'`. **Attribute-free
markup, matched as exact substrings.** Adding a `className` through an `AssistantMarkdown` `components`
override fails **six assertions across two specs**. That is the mechanical reason this ticket stays out of
#608's security boundary and off the `security-sensitive` label — stronger than the #607 precedent alone.

---

## State and concurrency model

None. Static CSS: no store slice, no async work, no lifecycle, no IPC.

## Error handling

None. There is no failure mode — an unmatched construct falls back to the UA stylesheet, and the four rules
cover every block container CommonMark emits without `remark-gfm` (no tables, no definition lists).

---

## Testing strategy

### No new unit test

Renderer unit tests are server-render only (`renderToStaticMarkup`, vitest `node` environment, no DOM), so
computed indent, border and margin are invisible to that tier. A unit test asserting that a list renders as
a list would assert react-markdown's behaviour, not this ticket's change. The six existing attribute-free
assertions already guard the thing that can actually regress here — the CSS-only constraint. **Leave
`AssistantMarkdown.test.tsx` and `ConversationScreen.test.tsx` untouched.**

### Fixture change in `e2e/assistant-whitespace.spec.ts`

The nested half has no coverage today: `readRhythmMetrics` reads `el.children`, direct children only. It
needs a fixture. **Do not add a turn** — the reply stream is indexed positionally
(`CONTROL / SPACE_RUN / CODE / RHYTHM / TAIL`) and an extra turn shifts every index. Extend `RHYTHM_TEXT`
instead, which the ticket sanctions ("inside an existing turn's text") and which costs no new harness.

Extend it to five top-level blocks — the existing paragraph, `<h2>` and one-item `<ul>`, plus:

- **a blockquote holding four children in order: a paragraph, a paragraph, a list, a nested blockquote.**
  That is three consecutive gaps and it covers three of AC4's four named cases in one construct.
- **a loose ordered list of two items** — the first holding two paragraphs, the second a paragraph followed
  by a nested list. That covers AC4's fourth case (a paragraph in a loose list item), exercises `li + li`,
  and puts a depth-2 list in the DOM for the monotonicity assertion.

A loose item is what makes react-markdown emit a `<p>` inside the `<li>`; a tight item is bare inline
content, which is why the existing `- alpha` yields `<li>alpha</li>`. Blank lines between items and a
continuation line indented to the item's content column are what produce it. Assemble with `join('\n')`, not
an indented template literal — the existing constants explain why (leading spaces read as an indented code
block).

Then **bump `RHYTHM_BLOCK_COUNT` to 5** and update `RHYTHM_TEXT`'s comment, which currently says three
blocks of three element types.

Hard constraints: do not touch `CONTROL_TEXT`, `SPACE_RUN_TEXT`, `CODE_TEXT`, `TAIL_TEXT` or `SETTLED_TEXTS`
— three tests compare against those. Add no second `<h2>`: #628's `readHeadingTypeMetrics` resolves
`.bubble__markdown h2` and would go strict-mode ambiguous.

The existing rhythm test passes both before and after the fixture change: gaps are measured between border
boxes, and a nested margin stays inside its list because a flex item is an independent formatting context.
The two new tests below are what carry the RED.

### Two new e2e tests, same file

Both follow #628's `readHeadingTypeMetrics` shape: one `locator.evaluate()` returning both the measured
values and the token values read off the same element, so no spacing literal enters the spec.

**Test A — blocks nested one level keep the reply's rhythm (AC4).** A helper resolving the RHYTHM bubble's
container returns, in one evaluate: the `--space-2` token; the gaps between the blockquote's children; the
gaps inside each loose `<li>`; the gaps between the loose list's items; and each container's child count.
Scenarios:

- The blockquote reports the expected number of children, and every gap between them equals the token
  within `SUBPIXEL_TOLERANCE_PX`. Child count is the vacuity guard — a fixture that failed to parse would
  otherwise pass with an empty gap array.
- Each loose `<li>` reports its expected child count, and every gap inside it equals the token.
- The gap between the two loose items equals the token.
- RED before the fix at 14px on every one of them; **0px is as much a failure as 14px** — say so in the
  comment, since a reader who only zeroed the margin would expect this to pass.

**Test B — a list indents from the scale and leaves room for its marker (AC1 + AC2).** A helper returns, in
one evaluate off the same bubble: the `--space-4` token; the computed `padding-inline-start` of every
`ul`/`ol` in the container; the content-box left of each of them; the bubble's content-box left and computed
`padding-left`; and the thread's computed `padding-left`, reached with `el.closest('.conversation__thread')`.
Scenarios:

- Every list's `padding-inline-start` equals the `--space-4` token. This is the assertion that is RED before
  the fix (40px), and asserting it on *every* list is the depth-independence proof — one value, all depths.
- The outermost list's content-box left is at or right of the bubble's content-box left, and each nested
  list's is strictly right of its ancestor's. This is the "at every nesting depth" clause: nesting only adds
  slack, so the depth-1 bound below is the worst case.
- `indent >= SINGLE_DIGIT_MARKER_PX` — a bullet and a one-digit marker sit inside the list's own box.
- `TWO_DIGIT_MARKER_PX - indent <= bubblePaddingLeft` — a two-digit marker paints on the bubble's fill.
- `THREE_DIGIT_MARKER_PX - indent <= bubblePaddingLeft + threadPaddingLeft` — a three-digit marker paints
  inside the thread's padding box, which is where its `overflow-y: auto` clips.

The three marker constants (16 / 28 / 40) are the **only** literals either test introduces, and they are
unavoidable: they are font metrics, not theme values, and `::marker` has no geometry API. Give them a comment
recording where they came from (the ticket's measured scan, corroborated at 16 / 25 / 34 of ink here) and
note that they are the conservative side of that measurement. Be honest in the comment about what this half
does and does not catch: the three arithmetic assertions are a **bound**, not a regression detector — they
hold at the UA's 40px too, and they fire only if someone later narrows the indent, widens the bubble padding
or narrows the thread's. The RED comes from the token assertion above them.

A pixel assertion on the marker itself is out of scope: `e2e/` has no screenshot or visual-regression
tooling, and `::marker` exposes no geometry. Box arithmetic is the honest tier.

### What is already covered — do not re-guard

- **Right-side widening** is live at `assistant-whitespace.spec.ts:378-379`: `readThreadWidths` asserts the
  thread shows no horizontal scrollbar, and it runs after `streamTheFiveReplies`, so the extended RHYTHM turn
  passes through it for free. **But note what it does not cover:** `scrollWidth` is blind to overflow on the
  **left**, which is the side a marker overhangs. #628's "AC3 is already guarded" inheritance does *not*
  extend to markers — that is exactly why Test B exists.
- **The top-level 8px rhythm** is live at `:389-407` and stays green through this change (measured). Do not
  write the CSS defensively around it — but it does fire, correctly, if a rule leaks a margin onto a direct
  child of the container.

### Gates

`npm run typecheck` does not see `e2e/*.spec.ts` — the directory is outside both tsconfigs — so a type error
in the new helpers surfaces only when Playwright runs them. `npm run build` and `npm test` are unaffected by
a CSS-only production change; the six list/blockquote assertions are the ones to watch.

---

## Open questions

None blocking.

One note for whoever picks up **#630** (inline code): a `<code>` inside a list item or a blockquote is
reached by whatever descendant selector that ticket hangs under the container, and its block-level neighbours
are already spaced by the rules here. Nothing in this ticket constrains its choice, and it should not
restate any margin — the rhythm one level down is now owned here.
