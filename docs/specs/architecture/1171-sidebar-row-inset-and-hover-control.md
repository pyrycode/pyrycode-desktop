# #1171 — the sidebar row's redrawn 8px inset, and its trailing control revealed on hover

A styling pass over the one `Row` both sidebar trees place. No new type, no new state, no new failure
mode: four values move, one control leaves the flex flow, two glyphs are replaced, and the row's hover
fill moves from the button to the wrapper.

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` → `Row` — the single component both trees place;
  holds the two `<svg>` glyphs and the wrapper/button/control sibling structure.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__row`, `.channel-list__row-open`,
  `.channel-list__row > .conversation-status-dot`, `.channel-list__save`, `.channel-list__rename` —
  every rule that moves.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → `ROW_MARKER`, `SAVE_MARKER`,
  `RENAME_MARKER`, `rowChunksIn`, `withoutGlyphs` — the attribute-run markers AC5 pins byte-identical,
  and the id-leak scan that strips inline `<svg>`s before scanning.
- `e2e/sidebar-row-geometry.spec.ts` → the two `test()` blocks — owns the row's own box.
- `e2e/sidebar-tree-geometry.spec.ts` → `LIST_INSET_PX`, `DOT_X`, `TITLE_X` — owns the row's position
  in the card.
- `src/renderer/src/theme/tokens.css` → `--space-2` (8), `--space-6` (24), `--space-7` (28),
  `--color-primary` (#9dcbfc), `--color-primary-container` (#134a74), `--radius-xs` (6).
- `docs/knowledge/features/channel-list-desktop-row-geometry.md` — three lessons that bind here: the
  24px height is DERIVED and that is what made the e2e height assertion a detector; a wrapper's
  computed `background-color` cannot see a child painting over it; the fixture reaches the thread by
  clicking the seeded row, so that row is the OPEN row in every fixture-riding spec.
- `src/renderer/src/screens/archive/archive.css`, `src/renderer/src/screens/conversation/conversation.css`
  → the two comments that cite `.channel-list__save` as the precedent for "de-emphasized
  on-surface-variant, a round hover target" — a treatment this ticket removes from that class.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=103-2985 —
hovered Channels row `398:7266`, its Hover component state `398:7258`, Idle `132:3901`, Active
`103:2972`.

The hovered row is a filled rounded bar: `--color-primary-container` behind a 6px corner, a small
status dot near the left edge, the title in the row's ordinary body-small, and a pale-blue
(`--color-primary`) pen at the trailing edge with no circle and no background behind it. The Chats
tree swaps the pen for a bold chevron-up in the same 12px box. `get_metadata` on `398:7266` reads the
row at 348×24 with the dot frame at x=8 (6×11, top-aligned, its circle at cy=8 → the row's own
centre), the title at x=22, and the 12×12 "Icon Edgeless" at x=328 — right edge 8px in from the row's
348, box centre at y=12.01, the row's centre. Every number in the acceptance is confirmed structurally
against that read, and the fill and glyph colour visually against the screenshot.

The Chats hovered row (`106:3275`) and its list frame (`106:3272`) no longer resolve in the file — the
frame was restructured after the ticket was filed. Its only difference is the swapped glyph instance,
and the ticket carries that export verbatim, so nothing about it is being guessed.

## Change

**`channels.css`, four values and three rules.**

- `.channel-list__row`'s `margin-left` goes `--space-5` → `--space-7`: the list indents 28 rather than
  20, so a row is 332 wide in the 360 content box and still ends flush with it.
- The dot rule's `left` goes `--space-4` → `--space-2`: the 6px box sits at x=8..14. It stays out of
  flow. The notch reason its comment gives expires (the fill is about to leave the button), but the
  click-through reason does not: the dot is a SIBLING of the button, so in flow the leading 22px would
  stop being part of the button and AC4's "a click on the dot opens the conversation" would fail.
- `.channel-list__row-open`'s padding goes `var(--space-1) var(--space-4) var(--space-1) var(--space-8)`
  → `var(--space-1) var(--space-7) var(--space-1) calc(var(--space-2) + 6px + var(--space-2))` — 4 / 28
  / 4 / 22. There is no single token for 22; it is the inset, the dot, and the drawn gap, written as
  that sum so the arithmetic stays legible.
- `.channel-list__row-open:hover` becomes `.channel-list__row:hover { background:
  var(--color-primary-container); border-radius: var(--radius-xs) }`.
- `.channel-list__row-open[aria-current='true']:hover { background: none }` is DELETED. It existed to
  stop the button's opaque hover painting over the wrapper's open fill; with no fill on the button
  there is nothing to suppress. The open fill still wins: `.channel-list__row:has(> .channel-list__row-open[aria-current='true'])`
  is (0,3,0) against the new hover rule's (0,2,0), so it wins on specificity rather than source order.
- `.channel-list__save` / `.channel-list__rename` leave the flex flow: `position: absolute; right: 0;
  top: 50%; transform: translateY(-50%)`, a `--space-7` × `--space-6` (28×24) box with `padding: 0
  var(--space-2) 0 0` and `justify-content: flex-end`, so the 12px glyph's right edge lands 8px in from
  the row's right edge and its box is centred on the row. `color` goes `--color-on-surface-variant` →
  `--color-primary`. `margin-right`, the `--radius-full` circle and both `:hover` background rules go
  with the move — the drawing draws no circle and no background behind the glyph. `:focus-visible`
  keeps its outline, per the file convention.
- Visibility is `opacity` alone, never `display: none` or `visibility: hidden`: `opacity: 0` on the
  base rules, `opacity: 1` under `.channel-list__row:hover` (0,3,0) and on each control's own
  `:focus-visible` (0,2,0), both over the base (0,1,0). A display-none control cannot take focus, and
  nine shipped specs click or await these controls without hovering first — five of them
  `real-daemon-*` readiness gates under a handshake timeout, which only the real tier can prove.

**`ChannelList.tsx`, two glyphs.** The Material 24-viewBox paths are replaced by the design's exports
at `width="12" height="12"`, `fill="currentColor"`, `aria-hidden="true"`. Rename (a Channels row) takes
the pen at `viewBox="0 0 12 12"`. Save-as-channel (a Chats row) takes the chevron, whose art is
12.12×7.2: it is centred in the 12px box by the viewBox's own origin, `viewBox="0 -2.46 12.12 12.12"`,
which leaves 2.46 of the 12.12-unit space above and below and keeps the exported path byte-identical.
No markup change otherwise — no class token moves, no attribute is inserted between `className` and
`aria-current`, so AC5's five attribute runs stay byte-identical by construction.

**Two comments in neighbouring stylesheets.** `archive.css`'s `.archive__delete` comment and
`conversation.css`'s `.status-sheet__close` comment both cite `.channel-list__save` as the precedent
for a treatment this ticket removes from it. Each keeps its own treatment; only the false attribution
goes. Comment-only, and the alternative is shipping a claim the reader can check and find wrong.

## What this costs the existing detectors, and what replaces it

Two shipped assertions stop detecting what their comments say they detect. Both are stated here rather
than quietly retargeted:

- **`row.width > open.width`** (both blocks) was #1098's proof that the fill spans the trailing
  control. With the control out of flow the button spans the row and the two widths are EQUAL, so the
  assertion would fail rather than weaken. It becomes an equality — which is the new invariant the
  technical note asks for: the open button spans the whole row, so its focus rectangle does not shrink
  on rows that carry a control. `computed(open, 'background-color') === NO_FILL_RGBA` beside it is
  untouched and remains the detector for the fill living on the wrapper.
- **The row-height assertion** was a detector for a trailing control stuck at its old 40px box.
  Absolute positioning takes the control out of the flex line, so it can no longer size the row at all.
  The assertion still detects the button's padding and the label's line box, which is where the 24
  comes from; the control's own box gets its own direct assertions instead (its glyph's 8px right inset
  and its centre on the row).

Conversely one assertion gets STRONGER. "Hovering the open row leaves its fill" was previously
undetecting on the wrapper — a parent's computed background cannot see a child's paint — so only the
button's own background could tell. Both candidate fills now sit on the SAME element, so the row's own
computed background genuinely separates `--color-on-primary` from `--color-primary-container`.

## Testing strategy

**Renderer (`ChannelList.test.tsx`)** — static server renders, so only the markup contract: each
control's `<svg>` renders at 12×12 on the design's viewBox, and the two icon class tokens survive.
`withoutGlyphs`'s comment says "seven Material `<path d>` runs"; two of them stop being Material and
the sentence is corrected where it sits. The AC5 byte-stability test needs no edit and is the guard
that it stayed true.

**`e2e/sidebar-tree-geometry.spec.ts`** — `LIST_INSET_PX` 20 → 28, `DOT_X` = `ROW_X + 8`, `TITLE_X` =
`ROW_X + 22`, and the comments that derive them. The trailing-edge assertion is unchanged and is what
proves the row still ends flush with the content edge at the wider indent.

**`e2e/sidebar-row-geometry.spec.ts`** — the interaction tier, since nothing in the repo can hover.
`padding-right` 16 → 28, `padding-left` 32 → 22, `HOVER_FILL_RGB` → `rgb(19, 74, 116)` read off the row
wrapper, and the two width comparisons per the section above. Added:

- Both controls compute `opacity: 0` with the pointer away from the list — asserted as a SET over both
  rows, so the open row's control is covered by the same read (this file's no-`nth()`, no-seed-text
  posture).
- Hovering a row takes THAT row's control to `1` and leaves the other at `0`.
- The glyph's right edge sits 8px in from the row's right edge and its centre on the row's centre.
- With the pointer moved onto the glyph itself, the row still computes the hover fill — the
  flicker AC3 rules out, and the reason the fill had to leave the button.
- On the Channels block: keyboard focus alone reveals the control. Reached by focusing the open button
  and pressing Tab, so the focus arrives through the keyboard and `:focus-visible` matches; a bare
  `element.focus()` after a mouse interaction would not, and the assertion would pass or fail on
  Chromium's modality heuristic rather than on the rule.
- A click at the dot's own centre opens that row's conversation — `aria-current` moves to it. This is
  the assertion that would redden if the dot were ever put back in flow or lost `pointer-events: none`.

Rounded deltas are normalised against `-0` before any `toBe(0)` (the #868 rule).

Nine shipped specs click or await `.channel-list__save` / `.channel-list__rename` without hovering
first and are edited in no way; AC4 is that they stay green. Playwright counts an opacity-0 element as
visible and moves the pointer onto it before clicking, which hovers the row on the way. The fake tier
covers four of them; the five `real-daemon-*` readiness gates run only under `npm run e2e:real:gate`,
which is why this ticket carries `needs-real-claude`.

## Open questions

None. Every measurement is pinned by the ticket and re-read against the node; every behavioural
question was ruled on 2026-09-06 and is quoted at the rule it binds.
