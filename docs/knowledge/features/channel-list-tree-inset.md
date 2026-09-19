# Channel List — the tree's inset (`channels.css`, the 2026-09-05 inset fix)

Split out of [Channel List — the row's desktop geometry](channel-list-desktop-row-geometry.md), the map
page for this row's geometry history, once that page grew past the doc-guard's 50000-byte cap
(`npm run check:docs`). Read the map page first for the surrounding context.

The row was converged on its node, but the tree around it was still laid out as the mobile screen had
been: every level took its x from its own padding against a 400px column that had no inset at all, so the
section header sat at 16 where the design draws it at 20, the host and workspace glyphs 20px too far
left, the channel rows 40px too far left with the open row's fill spanning the full sidebar, and the two
sections separated by 25px where the design puts 57. Reported from the running client against Figma
Sidebar 132:3902 and fixed directly, five declarations in one stylesheet:

- **`.channel-list` gains the card's 20px horizontal padding** ("Channels and chats" 103:2959, p-[20px]).
  Horizontal only: the top 4 and bottom 24 belong to the sticky actions cluster and the FAB, interim
  chrome the design places elsewhere, and become 20 when those move. With this one inset the content box
  is the design's own 360px, so every node's x coordinate transfers literally — which is also what let
  the host dots' rule stop arguing with the design (below). The actions cluster and the FAB move 20px
  inward with it, an accepted side effect on two controls that are not on the node at all.
  **Superseded by [#1443](https://github.com/pyrycode/pyrycode-desktop/issues/1443):** the guess only
  half-landed — the cluster became the card's own Top bar and the already-deleted FAB (#1426) left
  nothing else sticky, but the inset that arrived is 24 top / 20 sides / 20 bottom, not the uniform 20
  predicted here. Only the bottom pair matches.
- **The section header drops its horizontal and top padding and keeps 12 below** (103:2984, 103:2966
  gap-[12px]). Its box is the bare 20px line, so the host row lands 32px under the header's top.
- **The host row's right padding goes to 0**, so the two connection dots sit flush with the content edge.
  #718 had kept them 16px in, reading the design's absolute dot coordinates as artefacts of a 360-wide
  design row against a 400-wide shipped one; with the row now 360 wide they read literally, 1px from the
  edge, and 1px has no slot on the scale. The dots now end where the channel rows' fill ends.
  **Superseded by [#1185](channel-list-host-row.md#the-rows-pen-and-plus-on-hover-1185):** the padding is
  52px in both states, reserving the trailing slot its own hover-revealed pen and plus occupy, and the
  dots left the flex flow for `position: absolute; right: 0`, which keeps this same flush edge without
  riding the padding at all.
- **`.channel-list__row` gains `margin-left: var(--space-5)`** ("Channel list" 103:2985, pl-[20px]): a
  row is 340 wide in the 360 box, the dot at 56 and the title at 72 from the card's edge, and the open
  row's fill starts 40 in. A margin per row rather than padding on a wrapper because there is no
  wrapper (#703/#704); the adjacent-row rule sets `margin-top` alone, so the two longhands coexist.
  **Superseded by #1171:** `margin-left` is `--space-7` (28) now, so the row is 332 wide in the same 360
  box and its (and the open fill's) left edge starts 48 from the card's edge, not 40. The dot's
  row-relative inset shrank from 16 to 8 in the same ticket, so its card-edge position holds at 56 by
  coincidence (20 list padding + 28 row margin + 8 dot, against the old 20 + 20 + 16); the title's
  row-relative inset shrank from 32 to 22, so its card-edge position drops from 72 to 70 (20 + 28 + 22).
  **Superseded by [#1506](https://github.com/pyrycode/pyrycode-desktop/issues/1506):** `margin-left` is
  `--space-3` (12) now, so the row is 348 wide in the same 360 box and starts 32 from the card's edge, not
  48. The dot's card-edge position drops to 40 (32 + 8, was 56) and the title's to 54 (32 + 22, was 70) —
  the same edge the workspace label now shares (see below).
- **The divider spans the full content box with 28px on both sides** (103:3009 in a gap-[28px] column).
  Its colour stays `--color-outline-variant`; the node draws `--color-inverse-primary`, a colour change
  this fix did not take.

The workspace row's own inset held through this fix (106:3098 pl-[24px] already matched, and its
icon→label gap kept the documented 2px deviation) — both retired by
[#1178](channel-list-workspace-row-nest.md), which nests the row 20px in behind
a new wrapper and closes the 2px gap deviation outright.

**#1506 moved the host and workspace glyphs onto the same frame this page's five declarations only
half-read.** `Channels` 103:2966 places `Host container` 106:3104's children by their own x, not by a
padding guess, and the 2026-09-05 fix above landed every level 16px right of that: the host glyph 16
right of the content edge instead of on it, and the workspace nest at 20 instead of 4. Two more blocks
in `channels.css` move: `.channel-list__host`'s left padding goes `--space-4` → `--space-6` (16 → 24),
and `.channel-list__host-icon` leaves the flex flow (`position: absolute; left: 0; top: 50%;
transform: translateY(-50%)`, `.channel-list__workspace-icon`'s own shape) so the row's padding alone
carries the label to 24 in, and the glyph itself sits at the card's content edge (`HOST_ICON_X` is now
bare `CARD_INSET_PX`, not `HOST_ICON_X + 12 + 12`). The host row's 12px `gap` goes inert with the glyph
out of the flow — it is the chevron's gap, reserved here for
[#1507](channel-list-host-row.md#the-rows-fold-and-its-chevron-1507) to spend. **Superseded by #1507:**
the reservation was not spent in place — the 12 is deleted from `.channel-list__host` outright and the
drawn 6 lands on the new `.channel-list__host-disclosure` button instead, since that button becomes the
row's one remaining in-flow child and the row itself never regains a second one.
`.channel-list__workspace-head`'s nest goes `--space-5` → `--space-1` (20 → 4),
landing the workspace glyph at 12 from the content edge and its label — sharing the channel titles' edge
above — at 34, not 50; see [Channel List — the workspace row's own nest](channel-list-workspace-row-nest.md)
for that file's own numbers. `e2e/sidebar-tree-geometry.spec.ts` is the sole gate that can see any of
this: renderer specs are static server renders with no layout engine.

**Testing.** `e2e/sidebar-tree-geometry.spec.ts` complements `sidebar-row-geometry.spec.ts`, which
owns the row's own box. It seeds one promoted row, creates an unpromoted row through Add workspace,
and reads the offsets from the card's edge. The trailing-edge calculation accounts for the actual
scrollport, `.channel-list__tree`, whose negative right margin and matching padding preserve the
content inset. Since [#1527](https://github.com/pyrycode/pyrycode-desktop/issues/1527), the tree's
scrollbar is hidden. Its zero gutter is a geometry input, not evidence that the bar is hidden:
overlay bars also have zero width. [Sidebar scrollbar coverage](channel-list.md#css-channelscss)
checks computed paint policy and overflowing wheel/focus behavior separately.

## Related

- [Channel List — the row's desktop geometry](channel-list-desktop-row-geometry.md) — the map page.
- [Channel List — the row's 8px inset and its hover-revealed control](channel-list-row-hover-control.md)
  (#1171) — superseded the row margin-left value this page originally set.
- [Channel List — the workspace row's own nest and its create-chat plus](channel-list-workspace-row-nest.md)
  (#1178) — retired the workspace row's own inset this page left standing.
- [Channel List — the host row and its connection dots § The row's pen and plus on hover](channel-list-host-row.md#the-rows-pen-and-plus-on-hover-1185)
  (#1185) — superseded the host row's right-padding-to-0 bullet above.
- [Channel List — the workspace row's own nest and its create-chat plus](channel-list-workspace-row-nest.md)
  (#1178, re-derived by #1506) — the workspace label/glyph numbers #1506 lands here.
