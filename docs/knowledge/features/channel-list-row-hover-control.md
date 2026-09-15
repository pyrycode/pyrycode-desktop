# Channel List — the row's 8px inset and its hover-revealed control (`channels.css`/`ChannelList.tsx`, #1171)

Split out of [Channel List — the row's desktop geometry](channel-list-desktop-row-geometry.md), the map
page for this row's geometry history, once that page grew past the doc-guard's 50000-byte cap
(`npm run check:docs`). Read the map page first for the surrounding context.

The redrawn Figma frame (Hover row 398:7266) moved the row's own 8px inset, moved the hover fill off
the button, and replaced the trailing affordances' always-visible Material glyphs with a control that
is invisible at rest and appears on hover or keyboard focus. One `Row` and one block of `channels.css`
still serve both the Channels and Chats trees, so all of it changed for both sections at once.

**Geometry.** `.channel-list__row`'s `margin-left` went `--space-5` → `--space-7`. The status dot's
`left` went `--space-4` → `--space-2`, landing its 6×11 frame at row-relative x=8. The title's left
padding, formerly the single token `--space-8` (32), became `calc(--space-2 + 6px + --space-2)` (22) —
there is no single token for 22, so the sum of the drawing's 8px inset, the 6px dot, and the 8px gap
after it is written out rather than hidden behind a new token. The row still declares no `gap`. The
dot stays out of flow for a reason that changed underneath it: the old comment cited the notch a
button-only fill would leave around it, which stopped applying once the fill left the button, but the
click-through reason survived and hardened — the dot is a *sibling* of the button, so an in-flow dot
would carve its 22px out of the button's own hit area, and a click there would open nothing.
`pointer-events: none` on the dot is what keeps that from happening.

**The hover fill moved from the button to the row wrapper**, `--color-primary-container`
(`#134a74`) behind the same `--radius-xs` corner, replacing `.channel-list__row-open:hover`'s
`--color-surface-container` (`#1d2024`). It had to move because the trailing control, a sibling of the
button rather than its child (an interactive control cannot nest inside a `<button>`, #274), now sits
directly over the button's trailing padding — a fill living on the button would drop the instant the
pointer crossed onto the glyph, flickering the row. `.channel-list__row:hover` keeps the fill under the
pointer across the whole row the way the `:has()` open-fill rule already did. The open fill still wins
on hover (`:has()`'s (0,3,0) over the plain hover rule's (0,2,0)), and — since both fills now paint the
same element — the win is for the first time directly assertable by reading the row's own computed
background; see the correction folded into
[the open row's fill § Lessons learned](channel-list-row-open-fill.md#lessons-learned-folded-in-at-their-sites-above).

**The trailing control leaves the flex flow.** `.channel-list__save` / `.channel-list__rename` became
`position: absolute; right: 0; top: 50%; transform: translateY(-50%)`, a 28×24 (`--space-7` ×
`--space-6`) box with `padding: 0 var(--space-2) 0 0` and `justify-content: flex-end`, landing the 12px
glyph's right edge 8px in from the row's right edge, its box centred on the row.

**Superseded by [#1427](channel-list-control-name-pill.md):** `transform: translateY(-50%)` is gone from
both controls, replaced by the transform-free `top: calc(50% - var(--space-3))`, because a non-`none`
transform on either would have made it a containing block for its own `.channel-list__control-name`
child once that pill became `position: fixed`. The two are still absolutely positioned, still 28×24, and
still centred on the row — only the centring mechanism changed. See that page for why.

Two consequences followed directly from taking the trailing control out of the centred flex line that
used to size the row:

- **The row-height e2e assertion stops detecting the control's size.** It was #1097's proof that an
  oversized trailing affordance would push the row past its derived 24px — a real detector only because
  the flex line's tallest child decided the row's height. An absolutely positioned control can no longer
  do that, so the assertion now detects only the button's own padding and the label's line box (still
  the source of the 24), and the control's own rectangle needs a direct assertion instead (its glyph's
  8px right inset, its centre on the row).
- **`row.width > open.width` becomes an equality.** The button now spans the whole row rather than
  yielding its trailing share to an in-flow control, which is the intended new invariant: the open
  button's focus rectangle no longer shrinks on rows that carry a control.

**Visibility is `opacity` alone, on every row including the open one.** `opacity: 0` at rest, `opacity:
1` under `.channel-list__row:hover` and on the control's own `:focus-visible`. Juhana's ruling,
2026-09-06: the Active variant as drawn still carries the pen, but that is a leftover of building Active
from Hover in the design tool, not an intended "open rows show their control at rest" — so it is not
ported, and the open row behaves like any other row here. The mechanism matters as much as the ruling:
`display: none` or `visibility: hidden` would have taken the control out of the tab order and stopped
nine already-shipped specs that click or await `.channel-list__save` / `.channel-list__rename` without
hovering first, five of them `real-daemon-*` specs holding a `toBeVisible()` readiness gate under a
handshake timeout — the tier `playwright.config.ts` reserves for `npm run e2e:real:gate` alone.
Playwright counts an `opacity: 0` element as visible and moves the pointer onto it before clicking,
which hovers the row on the way, so all nine pass unedited.

**`:focus-visible` is a keyboard-modality heuristic, not a plain focus check.** Reaching the control's
`opacity: 1` state in a test means focusing the open button and pressing Tab, so the focus arrives via
the keyboard; a bare `element.focus()` call after a mouse interaction does not satisfy Chromium's
heuristic and would test the heuristic's mood rather than the rule.

**The glyphs are the drawing's own exports**, not the previous Material stand-ins: `viewBox="0 0 12
12"` at `width="12" height="12"`, `fill="currentColor"`, coloured `--color-primary` in place of
on-surface-variant. The Channels row (Rename) takes Font Awesome `pen-solid`. The Chats row
(Save-as-channel) takes a bold chevron-up whose art is 12.12×7.2 — its `viewBox` starts at `y=-2.46`
rather than the origin so the exported path centres in the 12px box without being re-based by hand; the
Figma layer is named `circle-chevron-up-solid` but only the chevron is drawn, there is no circle. No
hover circle and no background sit behind either glyph — the drawing draws neither.

**A comment that names another module's class as its treatment precedent goes stale when that class is
redrawn, and no identifier grep finds it.** `archive.css`'s `.archive__restore` comment and
`conversation.css`'s drop/cancel-affordance comment each cited `.channel-list__save` as the shared
de-emphasized-icon-button idiom; #1171 redrew that control as a hover-revealed `--color-primary` glyph,
so both citations were corrected in place (the first to describe its own now-standalone treatment, the
second to point at `.archive__restore` instead). The prose lives in a comment body, invisible to a grep
for the class token itself.

**Testing.** `e2e/sidebar-tree-geometry.spec.ts`: `LIST_INSET_PX` 20 → 28, `DOT_X` = `ROW_X + 8`,
`TITLE_X` = `ROW_X + 22`. `e2e/sidebar-row-geometry.spec.ts`: `HOVER_FILL_RGB` → `rgb(19, 74, 116)` read
off the row wrapper rather than the button, plus the opacity-at-rest / opacity-on-hover /
opacity-on-focus set (asserted over both rows at once, per this file's no-`nth()` posture), the glyph's
8px right inset and row-centred box, the fill surviving with the pointer moved onto the glyph itself,
and a click at the dot's own centre still moving `aria-current`. Rounded deltas are normalised against
`-0` before any `toBe(0)` (the #868 rule).

## Related

- [Channel List — the row's desktop geometry](channel-list-desktop-row-geometry.md) — the map page.
- [#1171 spec](../../specs/architecture/1171-sidebar-row-inset-and-hover-control.md) — the redrawn 8px
  inset and the hover-revealed trailing control.
- [Channel List — the control's own name pill](channel-list-control-name-pill.md) (#1172, pointer-following
  since #1427) — the pill this control's trailing box carries, and the transform removal #1427 forced here.
- [Channel List — the open row's fill](channel-list-row-open-fill.md) (#1098) — the hover-fill workaround
  this page's move resolved.
