# #721 — the fenced code block, redrawn to the desktop design

A restyle of a shipped component. `.code-block` keeps its element structure, its language pick and its
fail-closed no-header behaviour; only chrome and type change. Two CSS files and one e2e spec.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=134-4809

The Assistant message container holds a full-width bordered box: a header row at 8/16 padding carrying the
fence language in label-medium **emphasized** (12/16/0.5/600) in `Schemes/On Background` ink, a 1px
`Schemes/On Primary Container` rule beneath it, and the code body at 12/16 padding in Roboto Mono at 12px
on a 20px line. The box itself is a 6px-radius `Schemes/Background` fill inside a 1px
`Schemes/Primary Container` border — note the divider is the **brighter** of the two lines and the block's
own outline the darker one, which is what the design draws and is not a transposition to be "fixed".

Read the variable NAMES, never the generated hex fallbacks: `get_design_context` on this node prints
`--schemes/primary-container,#cfe4ff` and `--schemes/on-primary-container,#134a74`, which are the LIGHT
scheme's resolutions and are transposed relative to the dark scheme this app ships (ADR 0003). The
`get_variable_defs` reading, taken 2026-08-27, is authoritative and is inlined into the table below.

## Files to read first

- `src/renderer/src/screens/conversation/conversation.css:548-617` — the three rules this ticket edits
  (`.code-block`, `.code-block__header`, `.code-block__body`) plus the `--font-mono` pair. Every
  declaration and every comment claim in this range is in scope; see § Stale comments.
- `src/renderer/src/screens/conversation/conversation.css:619-681` — #630's inline-code rule. **Read it to
  confirm you are not touching it.** Its `:not(.code-block__body code)` boundary is unmoved by this ticket,
  and it already uses `--radius-xs`, which the block now converges on.
- `src/renderer/src/theme/tokens.css:81-148` — the type scale (four tokens per step, label-large then
  label-small with the gap this ticket fills), the spacing scale, and the radii. Note the file header's
  standing rule: no colour/type/spacing literal lives in a component stylesheet.
- `src/renderer/src/theme/tokens.css:16-74` — the four colour tokens this ticket consumes, and the
  `--color-inverse-primary` / `--color-error-container` comments recording the light/dark transposition
  trap the Design source section above re-states.
- `src/renderer/src/screens/conversation/AssistantMarkdown.tsx:176-196` — the `pre` override. Confirms the
  element structure (`div.code-block` > optional `div.code-block__header` + `pre.code-block__body`) and the
  `language !== null` guard. **No TSX edit in this ticket.**
- `e2e/assistant-whitespace.spec.ts:44-158` — the fixture: the five reply texts, `SETTLED_TEXTS`, the
  positional bubble indices, and `LONG_TOKEN_TEXT`. This is where the sixth turn lands.
- `e2e/assistant-whitespace.spec.ts:333-369` — `readHeadingTypeMetrics`, the canonical
  computed-value-beside-the-token-read-off-the-same-element reader, including the `tracking()` normaliser.
  The new reader clones this shape.
- `e2e/assistant-whitespace.spec.ts:496-599` — `readInlineCodeMetrics` and `readFenceCodeMetrics`. The
  first reads `.code-block`'s `backgroundColor` thread-wide; the second is scoped to the CODE bubble's
  languageless fence. Both must keep passing untouched.
- `e2e/assistant-whitespace.spec.ts:671-690` — the existing wrap test, AC5's current coverage.
- `src/renderer/src/screens/conversation/AssistantMarkdown.test.tsx:220-260` — the unit assertions on the
  header's presence, absence and escaping. These must pass **unedited**; a failure here means the change
  went past the ticket.

## Context

#623 built `.code-block` from the mobile Figma (node 16:45) and #630 added inline code beside it. The
desktop layout (board #7) redraws the block: tighter corner, a blue-family border, wider gutters, a heavier
and lighter-inked header label, and a taller code line. Nothing about the language pick, the element tree
or the no-language fail-closed path changes.

## Design

### 1. `theme/tokens.css` — six additions

**The label-medium step, between label-large and label-small** (scale order, as the file already runs
large → small):

```css
--text-label-medium-size: 12px;
--text-label-medium-line: 16px;
--text-label-medium-tracking: 0.5px;
--text-label-medium-weight: 500;
--text-label-medium-weight-emphasized: 600;
```

The first four are the quartet every step in this file carries, read off the Figma variables
`Static/Label Medium/{Size,Line Height,Tracking}` (12 / 16 / 0.5) plus M3's base weight for the step (500,
which the design system does not expose as a variable — only the emphasized one). `--text-label-medium-weight`
has no consumer today; that is explicitly blessed by the file header, and shipping three-quarters of a
quartet would surprise the next step's consumer.

The fifth is the **first `*-emphasized` weight token in the file**. It exists rather than a `font-weight: 600`
at the call site because a bare 600 in `conversation.css` is a type literal in a component stylesheet — the
one thing this token file's header forbids — and because the e2e tier compares each computed value against
a token read off the same live element, so a literal weight would force a literal into the spec too. The
name mirrors the Figma variable `Static/Label Medium/Weight-emphasized` (step, then property) rather than
being invented; more M3 emphasized styles are coming (the same node uses `title-small-emphasized`), so the
shape is worth getting right once.

**The code body's leading**, at the end of the type-scale block:

```css
--text-code-body-line: 20px;
```

This is the one value in the ticket with no scale step behind it. The scale has no 12/20 pairing: body-small
is 12/16, and the only 20px lines belong to body-medium and label-large, both at 14px. Three candidates were
weighed:

- **A bare `line-height: 20px` in `conversation.css`.** Rejected. It puts a type literal in a component
  stylesheet, and — decisively — it forces the e2e assertion to be `expect(lineHeight).toBe('20px')`, a
  literal in the file whose every reader exists to avoid exactly that.
- **Borrowing `--text-body-medium-line`.** Rejected for the ticket's own reason: it reads 20 by
  coincidence and would couple the code body to a 14px step it shares nothing else with.
- **A named off-scale token.** Taken. `--space-bubble-x: 14px` is the standing precedent for a
  component-named off-grid value living in the block it belongs to, and `--color-warning` for a value with
  no design-system variable behind it. The comment must say what it is: a one-off leading for the fenced
  code body, deliberately **not** a fifth member of any quartet — there is no `--text-code-body-size`,
  because the size still comes from body-small.

### 2. `screens/conversation/conversation.css` — six changed declarations

| Rule | Declaration | From | To |
| --- | --- | --- | --- |
| `.code-block` | `border` colour | `--color-outline-variant` | `--color-primary-container` (`#134a74`) |
| `.code-block` | `border-radius` | `--radius-sm` | `--radius-xs` |
| `.code-block` | `background` | `--color-surface` | **unchanged** |
| `.code-block__header` | `padding` | `var(--space-2) var(--space-3)` | `var(--space-2) var(--space-4)` |
| `.code-block__header` | `border-bottom` colour | `--color-outline-variant` | `--color-on-primary-container` (`#cfe4ff`) |
| `.code-block__header` | `color` | `--color-on-surface-variant` | `--color-on-surface` |
| `.code-block__header` | the type quartet | `--text-label-small-*` | `--text-label-medium-{size,line,tracking}` + `--text-label-medium-weight-emphasized` |
| `.code-block__body` | `padding` | `var(--space-3)` | `var(--space-3) var(--space-4)` |
| `.code-block__body` | `line-height` | `--text-body-small-line` | `--text-code-body-line` |

Everything else in all three rules stands verbatim: the `background`, `white-space: nowrap` /
`overflow: hidden` / `text-overflow: ellipsis` triple, `margin-block: 0`, the body's remaining three
body-small tokens, and the `--font-mono` pair on `.code-block__body` and its `code` child.

**The `background` declaration is load-bearing and must not be touched.** `Schemes/Background` resolves to
`#101418`, which is exactly `--color-surface` — the design changes nothing here.
`e2e/assistant-whitespace.spec.ts:531` reads `.code-block`'s computed `backgroundColor` and asserts the
inline chip shares it; editing the fill turns that assertion red for no design reason.

**The divider keeps its owner.** The design draws it as a `border-top` on the body; it stays a
`border-bottom` on the header, and takes only the new colour. #623's reasoning (`conversation.css:565-568`)
still holds and must be preserved in the comment: on the body, a languageless fence — where the body is the
block's only child — would draw a 1px line a hair below the block's own top border, a doubled edge. On the
header it appears and disappears with the thing it divides. Test 2 in § Testing is the deterministic guard
on this.

**The border's contrast is not a regression.** `#134a74` against the bubble's
`--color-surface-container-high` is low-contrast, but so is the outgoing `--color-outline-variant`
(`#42474e`) against the same ground. The block outline is decorative chrome, not a state-bearing graphic,
so the 3:1 floor `conversation.css:484` invokes for meaningful non-text graphics does not reach it.

### 3. Stale comments — the bulk of the diff

This file's comments are load-bearing and several are falsified by the change above. Each must be rewritten,
not merely left:

- `:548-552` — "1px outline-variant border, 12px radius", and the Figma reference `16:45`. Now
  primary-container, 6px, node `134:4809`.
- `:559-563` — the whole "Figma's py 6 is an exact MIDPOINT between `--space-1` and `--space-2`, so
  'nearest' decides nothing" argument, and the `.run-config__effort-segment` precedent it leans on. **Dead.**
  The design's header padding is 8/16 — two exact scale steps, no rounding question at all.
- `:565-568` — the divider paragraph. **True and kept**; extend it with the colour change and with the note
  that the design draws the line on the body and we deliberately do not follow it there.
- `:570-573` — the nowrap/ellipsis paragraph. Unchanged.
- `:587-592` — the "py 10 is the other exact midpoint … rounds UP … lands on the same 12 as the px — hence
  the single value" argument and its `.log-data__download` / `.channel-info__action` precedents. **Dead.**
  The design says 12/16, two exact steps and therefore two values.
- `:594-596` — the `margin-block` argument. Still true (the block axis is still 12px). Keep.
- `:597-598` — "The four type tokens complete the quartet the way `.tool-row__name:596` does". Now three
  from body-small plus one bespoke leading; restate with the § 1 reasoning for `--text-code-body-line`.

## State + concurrency model

None. No store slice, no async task, no subscription, no teardown. This ticket touches presentation only.

## Error handling

No runtime failure modes: no parse, no network, no permission path. The branch that behaves like one is the
**languageless fence** — `fenceLanguage` returns `null`, `AssistantMarkdown` renders no header, and the
block must degrade to a bordered box with no bar and no stray rule. That is the fail-closed behaviour #623
shipped, it is unchanged by this ticket, and Test 2 below is its guard.

## Testing strategy

**Unit tier: no edits, and no new tests.** `vitest.config.ts` sets `environment: 'node'` and every renderer
spec is a `renderToStaticMarkup` string, so there is no computed style to read — CSS is structurally
unreachable from this tier. `AssistantMarkdown.test.tsx` and `ConversationScreen.test.tsx` must pass
**untouched**; if one goes red, the change reached past CSS and the fix is to the change, not to the test.
`npm run typecheck` covers the e2e file's new types.

**E2E tier: `e2e/assistant-whitespace.spec.ts`, extended in place.** The idiom is the file's own — every
measured value is asserted against the token read off the *same live element*, never against a hex, px or
weight written down (`readHeadingTypeMetrics:343-369` is the model).

### The fixture problem, and its fix

The spec's only fenced block today is the **languageless** one (`CODE_TEXT`, `:70`), so
`.code-block__header` does not exist anywhere in this spec's DOM. Half the ACs are unassertable without a
language-carrying fence on screen.

**Append a sixth turn**, carrying a labelled fence, between `RHYTHM` and the open `TAIL`:

- `LANG_CODE_TEXT`, built the same way `CODE_TEXT` (`:70`) is — a three-element array joined on newlines,
  the opening fence line concatenating the fence marker with `FENCE_LANGUAGE`, the middle line
  `LONG_TOKEN_TEXT`, the last the bare closing fence. `FENCE_LANGUAGE` is a named constant
  (`'typescript'`) so the header's text assertion and the fixture share one source. Reusing
  `LONG_TOKEN_TEXT` is deliberate: it makes the AC5 wrap check on this block
  non-vacuous under the *new*, 4px-wider inline padding, which is the one geometric regression this ticket
  could introduce.
- Append it to `SETTLED_TEXTS`; `buildReplyFrames` and the `toHaveCount(REPLY_TEXTS.length)` gate both
  derive from that array and need no edit.
- Add `const LANG_CODE = 4` and bump `const TAIL = 5`.

**Amend the "no sixth turn" comment at `:80-83`.** Its prohibition was about *inserting* a turn, which
shifts every index above it. Appending after `RHYTHM` shifts exactly one constant — `TAIL`, which is last
by construction because the open, `turn_end`-less delta must remain the final frame. Say that in the
comment rather than leaving a rule the diff visibly breaks.

**Nothing existing moves.** `readCodeMetrics` and `readFenceCodeMetrics` are scoped to
`assistantBubble(page, CODE)`, so the new bubble is out of their reach.
`readInlineCodeMetrics`'s thread-wide `querySelector('.code-block')` returns document order — still the
CODE bubble's block, whose `background` is unchanged. `streamTheFiveReplies`' text gate is on `nth(CODE)`.
The RHYTHM counts are scoped to the RHYTHM bubble.

### The new reader

`readCodeBlockChromeMetrics(page, index)`, scoped to `assistantBubble(page, index).locator('.code-block')`,
returning in one `evaluate` — off one layout — the computed values of the block, its header and its body
beside the tokens read off that same element. Signature and shape mirror `readInlineCodeMetrics`.

It needs one normaliser the file does not yet have: **hex → `rgb()`**, because computed colours serialise as
`rgb(19, 74, 116)` while the tokens read `#134a74`. It is the colour analogue of the existing `tracking()`
and `family()` normalisers — the comparison is over values, not spellings. It must **throw** on a value it
cannot parse as 6-digit hex rather than returning it unchanged, so a future token expressed as `rgb()` or
`oklch()` fails loudly instead of comparing two different spellings and passing.

### Test 1 — `a fenced code block wears the desktop chrome, every value read from the token beside it`

Against the `LANG_CODE` bubble. Scenarios:

- The header element exists and its text is `FENCE_LANGUAGE` — the vacuity guard, without which every
  header assertion below is asserted against nothing.
- Block: `borderTopLeftRadius` equals `--radius-xs`; all four border widths are 1px; `borderTopColor`
  equals `--color-primary-container` through the hex normaliser.
- Block: `backgroundColor` equals `--color-surface` — AC1's "the `background` declaration is unchanged",
  asserted positively rather than by omission.
- Header: block padding equals `--space-2`, inline padding equals `--space-4` (both edges each way).
- Header: `color` equals `--color-on-surface`.
- Header: `fontSize`, `lineHeight`, `letterSpacing` (through `tracking()`) and `fontWeight` equal
  `--text-label-medium-size` / `-line` / `-tracking` / `-weight-emphasized`. **Note in the comment which
  half of this quartet discriminates:** label-medium and label-small share both a 16px line and 0.5px
  tracking, so those two assertions would pass unchanged against the outgoing declaration. The size
  (12 vs 11) and the weight (600 vs 500) are what actually fail if the header is still typed from
  label-small — the quartet is asserted whole, but the claim rests on those two.
- Header: `borderBottomColor` equals `--color-on-primary-container`, `borderBottomWidth` is 1px.
- Body: block padding equals `--space-3`, inline padding equals `--space-4`.
- Body: `lineHeight` equals `--text-code-body-line`, `fontSize` equals `--text-body-small-size`.
- Body: `whiteSpace` is `pre-wrap` and `scrollWidth <= clientWidth + SUBPIXEL_TOLERANCE_PX` — AC5 under
  the new, narrower measure.

### Test 2 — `a fence with no language draws no bar and no line where the bar would be`

Against the `CODE` bubble (the languageless fence). Scenarios:

- `.code-block__header` count under that bubble is 0.
- `.code-block__body`'s computed `borderTopWidth` is `NO_LENGTH` — the deterministic proof the divider did
  **not** migrate to the body. This is the assertion that turns red if a later ticket "corrects" the CSS to
  match how the design draws the line, and the comment should say so.
- That bubble's `.code-block` still carries its own 1px top border: "no line" is about the doubled edge, not
  about the block losing its outline.

### Test 3 — none

AC5 is already covered for the languageless fence by the existing test at `:671`, which stays unedited, and
for the labelled one by Test 1's last scenario.

### Commands

`npm test` (must be green and unedited), `npm run typecheck`, `npm run build`, `npm run e2e`.

## Open questions

- **The design's code text carries no letter-spacing** (`text-[12px]` with no `tracking-` class), while the
  shipped body keeps body-small's `0.4px`. The ticket's delta table is the contract and does not list
  tracking, so **do not change it** — the block keeps `--text-body-small-tracking`. Flagged here so
  code-review reads the omission as deliberate rather than missed; a mono-tracking decision is its own
  ticket.
- **`--text-label-medium-weight: 500` ships with no consumer.** Deliberate, per the token file's header,
  and preferable to a three-quarter quartet. If the reviewer would rather ship only what is used, that is a
  one-line deletion, but it breaks the four-tokens-per-step shape the file has held since #2.
- **The design's `Code` node sets `overflow-clip`; `.code-block` declares no `overflow`.** Not listed as a
  delta and nothing inside the block paints into a corner (neither child has a fill), so no change. If a
  future ticket gives the header a background, the clip becomes necessary at the two top corners.
