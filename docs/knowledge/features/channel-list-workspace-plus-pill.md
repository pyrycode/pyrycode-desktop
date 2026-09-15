# Channel List — the workspace row's plus names itself in a pill (#1181)

Split out of [Channel List — the row's desktop geometry](channel-list-desktop-row-geometry.md), the map
page for this row's geometry history, once that page grew past the doc-guard's 50000-byte cap
(`npm run check:docs`). Read the map page first for the surrounding context.

The plus #1178 and #1179 put on every workspace row was a bare glyph with an `aria-label` and nothing a
pointer could read. #1181 gives it
[#1172's own name pill](channel-list-control-name-pill.md): `.channel-list__control-name`, a plain
`aria-hidden` text-node `<span>` **appended after the `<svg>`** — never before it, since
`ChannelList.test.tsx` pins the glyph's opening run whole — reading `create.label`, the same
`WorkspaceCreateControl` field that already supplies the `aria-label`
(see [the workspace row's own nest](channel-list-workspace-row-nest.md)), so the drawn name and the
spoken one come off one definition per tree. `aria-hidden` is belt-and-braces (the button's `aria-label`
already overrides child text for the accessible name), kept because nothing else in either tier would
redden if it were dropped.

**The trigger is the control's own `:hover`/`:focus-visible`**, written beside
`.channel-list__workspace-create` rather than joined onto #1172's four-selector list, since each rule
names the elements that can carry a pill. Deliberately a *different* scope from the plus's own opacity
reveal (`.channel-list__workspace-head:hover`, which fires from the row so the glyph is visible before the
pointer reaches a 20px target): the name answers only the thing being pointed at, so hovering the row's
label shows nothing.

**Geometry, as shipped by #1181: no new number needed.** The pill was `right: 0; top: 50%;
translateY(-50%)` inside the plus itself (`position: absolute`, so it was the containing block); the plus
is 20px tall at `top: var(--space-1)` in the 28px head row, so its centre is the row's own centre, and the
24px pill spanned 2…26 of that 28 — inside the row's own band on every row, at any scroll position, which
made containment inside `.channel-list`'s clipping scroller hold without a per-row proof. `right: 0`
chained to the scroller's content right edge, so the pill grew leftward and added no horizontal overflow.
The accepted cost: a hovered plus's pill covered the trailing ~90px of that row's label for as long as the
pointer sat on the 20px control.

**Superseded by [#1427](channel-list-control-name-pill.md): this plus is one of the seven controls whose
pill now follows the pointer instead of sitting in this band.** The placement, the mirror, the
pointer-position custom properties and the row-band containment argument this section stated are all
retired — see [the control's own name pill](channel-list-control-name-pill.md) for the shared mechanism
that now applies here identically. `pointer-events: none` (already on the shared class) is unchanged and,
since #1427, more load-bearing than before: the pill can now sit over content well outside this row.

**Reusing the shared class reached one shipped spec, and the break was worse than its count.**
`e2e/sidebar-control-name-pill.spec.ts` located `.channel-list__control-name` document-wide: two workspace
pills would have pushed its count from 41 to 43, and — since the workspace head precedes its group's rows
in document order — silently re-aimed `pills.first()` from the first row's Rename pill to the Channels
tree's own workspace pill, a count-only check would not have caught that. Fixed by scoping the locator to
`.channel-list__row .channel-list__control-name`, restoring every count and `first()`/`last()` to the
element it was written for, with no expected value moved.

**Testing.** `ChannelList.test.tsx` asserts each tree's pill as the closing-tag adjacency
`</svg><span class="channel-list__control-name" aria-hidden="true">…</span>`, a per-tree drift-guard
pairing the pill text with its `aria-label` count, and a byte-for-byte `createTagsIn` assertion catching
the one shape adjacency alone cannot — a child landing as an attribute instead of an element.
`e2e/sidebar-workspace-plus-name-pill.spec.ts`: resting (both pills mounted and hidden), each plus's own
hover/focus showing its own text with the other still hidden, hovering the workspace label showing
nothing, and the click still landing with no prior hover. **Since #1427**, the band-and-containment read
at scroll top on the Channels row is replaced by the same three geometry checks
[the control's own name pill](channel-list-control-name-pill.md) describes — the pill's box at the stated
offset, disjoint from the plus's own box, and inside the window — plus the second-park re-read proving it
follows the pointer.

## Related

- [Channel List — the row's desktop geometry](channel-list-desktop-row-geometry.md) — the map page.
- [Channel List — the control's own name pill](channel-list-control-name-pill.md) (#1172, pointer-following
  since #1427) — the shipped treatment this pill restates, and the shared mechanism that replaced this
  page's own band placement.
- [Channel List — the workspace row's own nest and its create-chat plus](channel-list-workspace-row-nest.md)
  (#1178/#1179) — the plus this pill names.
