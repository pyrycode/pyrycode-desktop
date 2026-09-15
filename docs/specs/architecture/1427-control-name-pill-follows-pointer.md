# #1427 — a control's name pill follows the pointer instead of covering the control

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` → the seven pill-wearing buttons
  (`.channel-list__host-edit`, `.channel-list__host-add` in the host row; `.channel-list__workspace-create`,
  `.channel-list__workspace-edit` in the workspace head; `.channel-list__pair` in the section header;
  `.channel-list__rename`, `.channel-list__save` on conversation rows) — every one of them ends with the
  same `<span className="channel-list__control-name" aria-hidden="true">` appended after its `<svg>`, so
  one shared handler set reaches all seven and no markup moves.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__control-name` (the shared block whose
  `position: absolute; right: 0; top: 50%; translateY(-50%)` is what this ticket replaces),
  `.channel-list__pair .channel-list__control-name` (the `top: 100%` deviation that has nothing left to
  override), `.channel-list__save` and `.channel-list__rename` (the two `transform: translateY(-50%)`
  ancestors that would capture a fixed-position child), `.channel-list__tree` (`overflow-y: auto`, the
  clip every retired containment argument rests on), and the seven trigger pairs, which do not move.
- `src/renderer/src/pairedShell.css` → `.paired-shell__sidebar` / `.paired-shell__pane` — both
  `position: relative; overflow: hidden` at `z-index: auto`, so neither is a stacking context and neither
  is a containing block for a fixed box. The pane is the later sibling, which is what fixes the pill's
  `z-index` at 1: above the pane, below the five `z-index: 2` overlays. The rule's own comment is the
  standing prohibition on `transform` / `filter` / `backdrop-filter` / `will-change` / `contain` /
  `clip-path` anywhere in the shell, and it names `e2e/paired-shell-card.spec.ts` as its live detector.
- `src/renderer/src/theme/tokens.css` → `--space-3` (12px) and `--space-6` (24px), the two offsets, and
  `--color-primary-container` / `--color-on-primary-container`, the pill's unchanged pair.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → the static tier's pill assertions: closing-tag
  adjacency runs, `aria-label` counts, `createTagsIn` byte comparisons. It is unchanged by this ticket, and
  that is a constraint on the implementation rather than an observation — see Design.
- `e2e/sidebar-control-name-pill.spec.ts`, `e2e/sidebar-host-row-control-name-pill.spec.ts`,
  `e2e/sidebar-section-header-plus-name-pill.spec.ts`, `e2e/sidebar-workspace-plus-name-pill.spec.ts` →
  the four pill specs' band assertions, their `expectInsideTree` helper and their one-launch drive shape.
- `docs/knowledge/features/channel-list-desktop-row-geometry.md` § "The workspace row's plus names itself
  in a pill (#1181)" → the measured lesson this ticket must not re-break: `.channel-list__control-name`
  is worn by seven controls, and a document-wide locator for it silently re-aims `first()` / `last()` at
  the wrong control. Every pill locator in the four specs is already scoped to its own control's class and
  stays that way.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=347-6617

The Pill node renders as a single 24px-tall line of light ink on a dark navy ground with a small corner
radius, its text inset by a narrow horizontal padding and no border, icon or second line — 148 × 24 at the
instance rendered, width driven by the string. The treatment is untouched by this ticket: the ground, the
ink, the type, the padding, the radius and the one line all stay exactly as they compute today. The Figma
draws no pointer-relative placement, so the two offsets below are this ticket's own and are cited by token
name in the stylesheet rather than as pixels.

## Context

Seven sidebar controls wear `.channel-list__control-name`. The shared block anchors it to the control's own
vertical band (`right: 0; top: 50%; translateY(-50%)`), so while the pointer is on a 12px or 14px glyph the
pill paints over that glyph, and on the host row the plus's pill covers the pen beside it. Every one of
#1172, #1180, #1181, #1190 and #1304 stated that as an accepted cost. It is no longer accepted.

The pill now follows the pointer: while the pointer is on a control, the pill's top-left corner sits
`--space-3` right of and `--space-6` below the pointer, and it moves with the pointer. `--space-6` is the
tallest control's own height, which is what makes "the pill's box never touches the control's box" true by
arithmetic on every control rather than at the pointer positions a test happens to drive.

The pointer's position is not available to CSS, so this cannot be a stylesheet-only change. It is also why
the pill becomes `position: fixed`: anchored to the pointer it must escape `.channel-list__tree`'s clip on
both axes and `.paired-shell__sidebar`'s `overflow: hidden`. That is a shipped idiom in `channels.css`, not
a new one.

This design deserves no ADR: it reverses a placement ruling recorded in five comment blocks in
`channels.css`, and those comment blocks are where the reversal belongs.

## Design

### The pointer position reaches CSS as three custom properties

`ChannelList.tsx` gains one module-level handler set, spread onto all seven buttons:

- `onPointerEnter` and `onPointerMove` → the same handler, `(event) => placeControlName(event.currentTarget,
  event.clientX, event.clientY)`.
- `onFocus` → seeds the same placement from the control's own `getBoundingClientRect()` bottom-right
  corner, so the keyboard case takes one placement rule rather than a second one.

`placeControlName(control: HTMLElement, x: number, y: number): void` writes, through
`control.style.setProperty`, three custom properties the pill inherits:

| Property | Holds |
|---|---|
| `--control-name-pointer-x` | the anchor's client x, in `px` |
| `--control-name-pointer-y` | the anchor's client y, in `px` |
| `--control-name-mirror` | `0` (the offset placement) or `1` (the bottom-edge mirror) |

**Why a direct style write and not a React `style` prop.** `ChannelList.test.tsx` pins whole attribute runs
on these buttons; a `style` prop would add a `style=""` attribute to the static markup and move them. Event
handlers are not serialized by `renderToStaticMarkup`, so spreading the handler set changes no byte of the
static tier. There is no React state and no re-render per pointer move.

**Why `onPointerEnter` as well as `onPointerMove`.** A `pointermove` is not guaranteed before `:hover`
paints the pill, and an unset custom property makes the `calc()` invalid at computed-value time, which
falls back to `left: auto` / `top: auto` — the pill's static position, on top of the control, which is the
defect this ticket removes. Enter seeds before the first paint of the hovered state. Every `var()` in the
stylesheet additionally carries a fallback, so the invalid-at-computed-value-time path does not exist even
if no handler ever ran; the fallback places the pill near the window's top-left corner, which the shell's
20px inset puts clear of every control.

**The focus handler yields to a live pointer.** It returns early when `control.matches(':hover')`. Clicking
a control focuses it, and without the guard that focus would jerk the pill from the pointer to the
control's corner while the pointer is still on the control — which AC1 forbids in as many words.

### The mirror is measured, not derived

`placeControlName` writes the pointer position with `--control-name-mirror: 0`, then reads the pill's
`getBoundingClientRect().bottom` — which forces the style and layout update, so the read is of the
placement just written — and sets `--control-name-mirror: 1` when that bottom exceeds
`window.innerHeight`. Because the probe always resets to `0` first, the decision is self-correcting on
every move rather than sticky.

This reads the truth AC2 states ("where the offset placement would put the pill outside the window's bottom
edge") instead of re-deriving it from a pill height and an offset, so no pixel value for either enters
`ChannelList.tsx`. It costs one forced synchronous layout per pointer move over a control, which is
acceptable for a hover affordance in a 400px sidebar and is the only per-move cost in the design.

`querySelector` for the pill returns `HTMLElement | null`; the null path returns without writing the
mirror, which is a type narrowing rather than a reject branch.

### The stylesheet

The shared `.channel-list__control-name` block replaces `position: absolute; right: 0; top: 50%;
transform: translateY(-50%)` with:

```css
position: fixed;
left: calc(var(--control-name-pointer-x, 0px) + var(--space-3));
top: calc(var(--control-name-pointer-y, 0px) + var(--space-6)
          - var(--control-name-mirror, 0) * 2 * var(--space-6));
translate: 0 calc(var(--control-name-mirror, 0) * -100%);
z-index: 1;
```

At mirror `0` the pill's top-left corner is the offset point. At mirror `1` the same arithmetic read upward
puts `top` one `--space-6` *above* the pointer and `translate` lifts the box by its own height, so the
pill's **bottom**-left corner is the mirrored offset point. One rule, both placements, no second block.

`translate` rather than `transform` and on the pill itself: an element's own transform does not change
where its own fixed position resolves, and the pill has no descendants for the stacking context to scope.

`z-index: 1` is the whole of the layering claim: `.paired-shell__sidebar` and `.paired-shell__pane` are
both `position: relative` at `z-index: auto`, so neither is a stacking context and the pill participates in
the root one — above the pane (a later sibling painting at z-index auto) and below `channels.css`'s five
`z-index: 2` overlays.

Everything else in the block — ground, ink, type, padding, radius, `display: none`, `pointer-events: none`,
`nowrap` — is unchanged. The seven trigger pairs are unchanged.

**Two more stylesheet edits, both forced by the fix:**

- `.channel-list__pair .channel-list__control-name` is **deleted**. Its two declarations were `top: 100%`
  and `transform: none`; neither survives the shared block's rewrite, so the rule has nothing left to
  override.
- `.channel-list__save` and `.channel-list__rename` drop `transform: translateY(-50%)` in favour of
  `top: calc(50% - var(--space-3))`. A non-`none` transform makes an element a containing block for
  fixed-position descendants *and* a stacking context, so on exactly these two controls the pill would
  resolve against the button's box, fall back inside `.channel-list__tree`'s clip, and have its `z-index`
  scoped inside the button. Both controls are `height: var(--space-6)`, so half of that is `--space-3` and
  the centring has an exact transform-free equivalent. No other ancestor of any of the seven pills takes
  one of the six containing-block properties — `channels.css`, `pairedShell.css` and `index.css` all
  checked.

**Five comment blocks are rewritten, not left standing.** The shared block's own placement paragraph, and
the four written beside `.channel-list__pair`, `.channel-list__host-edit`, `.channel-list__host-add` and
`.channel-list__workspace-create`, each argue the band placement and the containment it bought. They are
the record of a ruling this ticket reverses.

## State + concurrency model

No store slice, no async work, no subscription and nothing to tear down. The handler is synchronous, writes
to one element's inline style, and holds no state between calls — the element's own custom properties are
the only state, and they are discarded with the element. The pill is hidden by `display: none` whenever no
control is hovered or focused, so a stale property value is never read.

## Error handling

No I/O and no IPC, so no result type. The one defensive path is the `querySelector` null narrowing above.
The `var()` fallbacks are the deterministic net under the handler: if no handler ever ran, the `calc()` is
still valid and the pill still lands clear of every control.

## Testing strategy

**Static tier (`vitest`): unchanged, deliberately.** `ChannelList.test.tsx` is not edited. The seven
`aria-label` values, the seven control class names and every markup assertion stay byte-identical, which is
AC4's first clause; that the tier stays green is itself the proof that the handler set added no attribute.

**Playwright fake-transport tier: the four pill specs, edited in place.** Each keeps its one-launch,
one-`test()` drive and its control-scoped pill locators. What changes in each is the geometry block: the
band assertion and the `expectInsideTree` containment reads go, and in their place go three reads —

- **the pill's box against the pointer's last position at the stated offset.** The drive parks the pointer
  with an explicit `page.mouse.move` to a point this file names inside the control (after a `hover()`, which
  is what scrolls an off-screen control in), so the expected value is a number the spec chose rather than
  Playwright's own centring.
- **the pill's box disjoint from the hovered control's box**, as an intersection of zero area on at least
  one axis.
- **the pill's box inside the window**, replacing containment inside `.channel-list__tree`. The pill is
  deliberately outside the tree whenever the pointer is near its bottom edge, so the old criterion is no
  longer true and the window is the box that now bounds it. The retired containment reads were the detector
  for a clipped-but-still-measurable pill; the replacement keeps that covered, because the sidebar's
  padding box starts 20px in from the window on both axes, so an ancestor that became a containing block
  would shift the pill off the pointer by at least that inset and redden the offset assertion itself.

**"It follows" is a second `page.mouse.move` to a different point on the same control and a re-read of the
box** against the new pointer position. AC1's "from the moment the pill first appears rather than from the
first pointer move after it" is the *first* of the two reads: it is taken after the enter alone, with no
intervening move onto a second point.

**The bottom-edge mirror (AC2) lands in `e2e/sidebar-control-name-pill.spec.ts`**, which already scrolls
the tree to its end and drives the last row's control. The pointer parks near that control's **bottom**
edge rather than its centre — the tree's bottom edge sits `--space-5` + the shell's 20px inset above the
window's, so a centre park leaves the unmirrored pill inside the window and would prove nothing. The drive
asserts the precondition (the unmirrored placement would overflow) before the mirror itself, so a window
that grew reddens the spec rather than making it vacuous. Then: bottom-left corner at the mirrored offset,
box disjoint from the control, box inside the window.

**Also kept, in the specs that carry them:** the top-bar clearance relations, the sidebar-width read, the
`display`-set absence reads, the hover-the-label-shows-nothing clause, the focus/blur pair and the
click-still-lands read. AC3 and AC4's `display` / `pointer-events` clauses are those existing reads; only
the focus case gains an offset assertion, against the control's own bottom-right corner.

**Not run here:** the full `npm test` sweep and the whole Playwright tier are the verifier's gate. The
real-daemon and real-claude tiers are untouched.

## Documentation handoff

Pending for the documentation stage; **not** done in this ticket.

- Fold the pointer-relative placement, the two offset tokens (`--space-3` horizontal, `--space-6` vertical)
  and the transform-free centring of `.channel-list__save` / `.channel-list__rename` into
  `docs/knowledge/features/channel-list-desktop-row-geometry.md`.
- Correct the band-placement and containment statements the pill sections carry there, in
  `docs/knowledge/features/channel-list-host-row.md` and in
  `docs/knowledge/features/channel-list-section-header-pair-control.md`, so no overview still describes the
  pill as sitting in its control's band or as contained by the scroller.

## Open questions

1. **Is `getBoundingClientRect()` on the pill non-zero inside the `pointerenter` handler?** The hovered
   state is set during hit testing, before the event is dispatched, and the rect read forces the style and
   layout update — so it should be. If it is not, the mirror probe reads a zero-height box and the mirror
   fires only within `--space-6` of the window's bottom instead of `--space-6` + the pill's height. AC2's
   bottom-edge drive is the detector; resolve it there.
2. **Does `calc(<number> * 2 * <length>)` with a custom property as the number compute as intended in
   Chromium?** Expected yes (left-associative, number × number × length). If not, the fallback is a second
   custom property holding the resolved offset. The offset assertions are the detector.

Each resolution lands as a `## Revisions` entry if it moves the design.
