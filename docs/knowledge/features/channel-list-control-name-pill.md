# Channel List — the control's own name, on hover or keyboard focus (#1172, pointer-following since #1427)

Split out of [Channel List — the row's desktop geometry](channel-list-desktop-row-geometry.md), the map
page for this row's geometry history, once that page grew past the doc-guard's 50000-byte cap
(`npm run check:docs`). Read the map page first for the surrounding context. This page is the shared home
for `.channel-list__control-name`, worn by all eight sidebar controls that carry it: the row's own
Rename/Save-as-channel pair (#1172, this ticket), the Chats tree's own Edit-chat pen
(`.channel-list__chat-edit`, #1441), the workspace row's plus (#1181), the host row's pen and
plus (#1190), and the section header's plus (#1304) — see
[Channel List — the row's 8px inset and its hover-revealed control](channel-list-row-hover-control.md#1441-a-chats-row-now-carries-both-controls-not-one),
[Channel List — the host row](channel-list-host-row.md) and
[Channel List — the section header's pair-new-host control](channel-list-section-header-pair-control.md)
for those controls' own geometry.

Since [#1171](channel-list-row-hover-control.md) each trailing control is a bare 12px glyph, invisible until the row's hover reveals it. This
names it: hovering (or keyboard-focusing) **the control itself, never the row** shows a Pill (Figma
`347:6617`) reading `Rename` or `Save as channel`, restated as `.channel-list__control-name` in this file
rather than lifted from [`.composer__attachment-name`](composer-attach-name-pill.md) (#1265, shipped
first). Two reasons, not one: verbatim duplication for these two controls is already this file's shipped
idiom (`.channel-list__rename` restates `.channel-list__save` declaration for declaration), and a BEM lift
would turn `class="composer__attachment-name"` into a two-class mix that silently degrades the composer
specs asserting whole attribute runs. Both blocks read the same tokens by name and anchor to the same
node, so drift risk sits in the token layer, not in shared markup.

**The two colours are transposed in the Figma export — the same trap as #1265, #1262 and #969.**
`get_design_context` on 347:6617 prints the ground and ink swapped against `tokens.css`
(`--color-primary-container` `#134a74` / `--color-on-primary-container` `#cfe4ff`); the node's own
screenshot — dark ground, light ink — is what settles it, by name rather than by the exported hex. Only
`e2e/sidebar-control-name-pill.spec.ts`'s two computed-colour constants can detect a regression here,
since nothing in the static tier renders a colour.

**Both names are one module constant each, read by the control's own `aria-label` and by its pill, so the
two cannot drift:** `RENAME_CONTROL_LABEL`, `SAVE_AS_CHANNEL_CONTROL_LABEL` in `ChannelList.tsx`. Not
merged with `.conversation`'s own Rename entry in the thread overflow menu, despite the same six
characters — the `HOST_ROW_FALLBACK_LABEL`/`SERVER_ROW_LABEL` ruling against a cross-screen import for one
word applies here too.

**Placement, as shipped by #1172: the row's own vertical band, right-aligned to the control — not above
it.** The control was a 24px box (`top: 50%`, `translateY(-50%)`, `height: var(--space-6)`) centred on the
row; the pill was centred inside it the same way and was itself 24px tall, so its box coincided with the
row band on every row, at any scroll position — containment inside `.channel-list` (`overflow-y: auto`,
which clips both axes, per [the redrawn frame](channel-list-row-hover-control.md)) then followed from the
control being in view. `right: 0` pinned it to the control's padding-box right edge. The accepted cost: a
hovered control's pill covered roughly the trailing 104px of that row's title, for as long as the pointer
sat on the 36×24 control.

**Superseded by [#1427](https://github.com/pyrycode/pyrycode-desktop/issues/1427): the pill follows the
pointer instead, on all controls that wear it, not just these two.** It is `position: fixed`, its
top-left corner `--space-3` right of and `--space-6` below the pointer's current position and moving with
it; mirrored to a bottom-left anchor — `top` one `--space-6` *above* the pointer, `translate: 0
calc(var(--control-name-mirror, 0) * -100%)` — when the offset placement would leave the window's bottom
edge; and seeded from the control's own bottom-right corner on keyboard focus, since there is no pointer
position to read there. `--space-6` is the *tallest* control's height (`.channel-list__save`,
`.channel-list__rename` and `.channel-list__chat-edit` are `--space-6` tall, the other five `--space-5`),
which is what makes "the pill's
box never touches the control's box" true by arithmetic on every control rather than at the pointer
positions a test happens to drive. `ChannelList.tsx`'s `placeControlName` writes the pointer position into
`--control-name-pointer-x`/`-y` on the control's own inline style — a direct `style.setProperty`, never a
React `style` prop, so `ChannelList.test.tsx` stays byte-identical — and decides the mirror by
*measurement*: write unmirrored, read the pill's own `getBoundingClientRect().bottom`, compare against
`window.innerHeight`, probing from unmirrored every time so the decision self-corrects per move rather than
going sticky. No pixel value for the offsets or the pill's height enters the TypeScript at all; both stay
tokens in the stylesheet and literals in the specs. Every `var()` in the rule carries a fallback, since an
unset custom property makes the `calc()` invalid at computed-value time and falls back to `left: auto` /
`top: auto` — the old band position, i.e. the defect this placement removes — so the handler seeds on
pointer *enter* as well as *move* (a `pointermove` is not guaranteed before `:hover` first paints the pill).

The row-band containment argument is retired with it: a fixed pill escapes both `.channel-list__tree`'s
scroll clip and `.paired-shell__sidebar`'s `overflow: hidden`, so what bounds it now is the window, read
back in the specs (below) rather than trusted from the control being in view. `z-index: 1` replaces the
band's implicit stacking: `.paired-shell__sidebar`/`.paired-shell__pane` are both `position: relative;
z-index: auto`, so the pill participates in the root stacking context — above the pane (a later sibling
that would otherwise paint over it) and below this file's five `z-index: 2` overlays. The one ancestor that
would have broken it: `.channel-list__save`/`.channel-list__rename` traded `transform: translateY(-50%)` for
the transform-free `top: calc(50% - var(--space-3))` (exact at `height: var(--space-6)`), since a non-`none`
transform makes an element a containing block for a fixed-position child and would have re-anchored the
pill to the button's own box, dropping it back inside the tree's clip — see
[the redrawn frame](channel-list-row-hover-control.md) for that pair's own geometry. `.channel-list__pair`'s
own `top: 100%; transform: none` placement override (see
[the section header's pair control § The hover/focus name pill](channel-list-section-header-pair-control.md#the-hoverfocus-name-pill-channelscsschannellisttsx-added-by-1304))
is deleted outright, having nothing left to override.
See [#1427 spec](../../specs/architecture/1427-control-name-pill-follows-pointer.md) for the full design,
including why no right-edge flip is needed (the sidebar's 400px width and the 800px minimum window width
mean the offset placement cannot reach the right edge).

**Why not above the row, the composer pill's own placement — measured, not just reasoned.**
`.channel-list__actions` sits sticky at the scroller's top-right with `z-index: 1`, covering the same
corner a row's trailing control occupies, so the highest row a pointer can actually reach always carries a
live 32px of headroom above it once the actions cluster is accounted for — the in-band placement was
chosen because it needs no headroom at all, not because none exists. Proving that third geometry case took
two failed drafts: each scrolled a row flush against the scroller's own top edge and hovered its control,
and both came back with the row 700px down the viewport, because Playwright's `hover()` **relocates** its
target when the row it computed is unhittable (the sticky cluster physically covers the control) rather
than failing on it — a false "still passes" the same shape as a clipped box still reporting geometry. The
block now reads the actions cluster's own bottom edge at runtime, parks the probe row immediately under
it, and re-reads that row's position after the hover, so a relocation fails the block instead of silently
weakening the proof it was meant to be. **This probe is gone since #1427:** the pill no longer sits in a
row's band at all, so there is nothing for the actions cluster to collide with and no headroom argument
left to prove; the paragraph stays as the record of why in-band beat above-the-row when that was still the
choice being made.

**Mechanism, matching #1265 throughout:** `display: none → block`, never `opacity`/`visibility`, so a
hidden pill reports no box at all and a test tells "showing" from "hidden" by the *kind* of answer;
`pointer-events: none` — since the pill now follows the pointer (#1427) it can sit over the row's own open
button, another row, or the chat pane, and a click or hit test aimed at whatever is underneath must read
straight through it regardless; `aria-hidden="true"` plus append-after-the-`<svg>` markup order, so
`ChannelList.test.tsx`'s existing `<svg …>` opening-run and `aria-label` assertions stay byte-identical. No
`max-width`/ellipsis: both strings are client-owned compile-time constants (the longer computes to ~104px
inside a 332px row), unlike the composer pill's unbounded daemon filename.

**Testing.** `ChannelList.test.tsx` adds the closing-tag adjacency `</svg><span
class="channel-list__control-name" aria-hidden="true">…</span>` per control — not two independent
substrings, since a pill that drifted to a row-level sibling would still contain both and only adjacency
catches it — plus a drift guard counting the pill text and the `aria-label` together.
`e2e/sidebar-control-name-pill.spec.ts` drives one launch against a tall, post-launch-pushed list (the
fixture's own strict single-row click can't seed a multi-row list at launch): resting state (every pill
mounted and hidden), each control's own hover (text, every computed style including both colours, siblings
still hidden), hovering the row's title alone showing no pill (the scoping is the control's own `:hover`,
never the row's), leaving, and the keyboard path (`Tab` onto the open row, never `locator.focus()`, matching
[the redrawn frame](channel-list-row-hover-control.md)'s own `:focus-visible` reasoning). **Since #1427**,
the band and `.channel-list__tree` containment reads are replaced by three geometry checks read against the
pointer's own last position — the pill's box at the stated offset, disjoint from the hovered control's box,
and inside the window — plus a second `page.mouse.move` on the same control and a re-read proving the pill
follows; the bottom-edge mirror is driven on the last row at full scroll, with the unmirrored placement's
overflow asserted first so a taller window reddens the spec rather than passing vacuously.

**#1441 gave the Chats tree's own pen this same pill under its own label, `EDIT_CHAT_CONTROL_LABEL`
("Edit chat") — never merged with `RENAME_CONTROL_LABEL`, despite both naming a pen in the same idiom.**
The two trees edit two different things (a channel's dialog above the divider, a chat's below it), and
the split is what lets [#1430](https://github.com/pyrycode/pyrycode-desktop/issues/1430) rename the
Channels word to **Edit channel** without touching the Chats tree's word — a shared constant would have
made that a two-tree change with no way to say so. Both labels stay module-local to `ChannelList.tsx`,
read twice each (the control's `aria-label` and its pill), so the drawn and spoken names cannot drift
apart on either tree.

**Wearing this pill is two rules, not one, and the second is easy to miss — #1441's first cut missed it.**
A control's pill is revealed at two different scopes: the *glyph* by the row's own `:hover`
([the row's hover-revealed control](channel-list-row-hover-control.md)'s reveal rule), the *pill* by the
control's own `:hover`/`:focus-visible` — this file's trigger rule, which enumerates selectors rather than
inheriting from the control's own block. `.channel-list__chat-edit` shipped correctly in every other rule
this control needed — its own block, its `:focus-visible` rule, the row-hover reveal, the icon's
`display: block` — and was missing from only this one. The result was invisible in review of the diff
itself: the markup, the word and the `controlNamePlacement` spread were all correct, and the pill was
styled out of existence, reading nothing on hover or on focus. **A new pill-bearing control has to restate
an existing one's block in *both* rules — the control's own, and its pair of entries in this trigger —
"restates `.channel-list__rename`" is not finished at the control's own rule.**

**Why every gate stayed green over a dead pill.** The static tier renders a pill's markup whatever the
stylesheet says, so a drift guard counting pill text and `aria-label` together is satisfied by a pill that
can never appear. In the e2e spec the new pill was only ever *counted* and *asserted hidden* — both
vacuous on a pill hidden forever — and the two blocks that read a pill's *text* were scoped to the other
two controls (one of them deliberately re-scoped away from the new control by this same ticket). A
visibility claim about a new element needs a text read on that element while it is meant to be showing;
counting it or asserting it hidden is not coverage of "it appears," only of "it exists."

`e2e/sidebar-control-name-pill.spec.ts` now parks a probe on the chat pen itself and reads its pill's text
in both modalities (hover, then keyboard focus via two Tabs from the row's open button — the chevron
precedes the pen in DOM order since [#1441](channel-list-row-hover-control.md#1441-a-chats-row-now-carries-both-controls-not-one)).
It parks at `dx: 12` rather than the 4px its siblings use: the pen's and the chevron's boxes overlap by
8px, so a point in the pen's own left 8px would resolve to the pen only by sibling order, not by being
clear of the other control.

## Host Edit pill verification

`e2e/sidebar-host-row-control-name-pill.spec.ts` retains the complete contract in
`Edit host keeps its pointer name pill without a host Add workspace control`:
exactly one host and Edit host button, no host Add workspace control, a pill
hidden at rest (`display: none`), visible on hover (`display: block`) with text
`Edit host`, non-null pill boxes at both pointer positions, and a changed
horizontal position after ordinary `page.mouse.move` within the Edit control.
A text or visibility check alone cannot prove that the pill follows the pointer;
the two box reads must still reject a missing or stationary pill.

A hidden pill has no layout box, so a null box after a completed `hover()` does
not by itself establish a placement defect. Capture actual hover, computed pill
visibility and control/pill geometry together before teardown if it recurs; see
[Layout and input](development-verification.md#layout-and-input). Use the paired
fixture's shared native-pointer protection before considering a local correction.
Preserve ordinary Playwright input and all assertions without retries, increased
timeouts, arbitrary sleeps or suite serialization.

The spec stayed unchanged in #1823: it passed all 40 repetitions (20 with one
worker, 20 with three) and executed/passed in the three-worker full suite on the
merged #1836 protection. See
[revision, presentation, counts and retained paths](e2e-harness-desktop-isolation.md#recorded-host-pill-acceptance).
That evidence supports retaining the spec; the shared native-pointer mechanism
is confirmed, while its attribution to the historical host failures remains
inferred. The separate Welcome stall remains assigned to #1842.

## Related

- [Channel List — the row's desktop geometry](channel-list-desktop-row-geometry.md) — the map page.
- [#1172 spec](../../specs/architecture/1172-row-control-name-pill.md) — the control's own name pill.
- [#1427 spec](../../specs/architecture/1427-control-name-pill-follows-pointer.md) — the pointer-following
  placement, the mirror, and the transform-free centring of `.channel-list__save`/`.channel-list__rename`.
- [Channel List — the row's 8px inset and its hover-revealed control](channel-list-row-hover-control.md)
  (#1171) — the bare glyph this pill names, and the transform removal #1427 needed there.
- [Channel List — the row's 8px inset and its hover-revealed control § #1441](channel-list-row-hover-control.md#1441-a-chats-row-now-carries-both-controls-not-one)
  — the Chats tree's own pen, this treatment's sixth wearer (and eighth overall), and the two-rule reveal
  lesson its first cut paid for.
- [#1441 spec](../../specs/architecture/1441-chat-row-edit-chat-pen.md) — the chat pen's own token and
  label, and the rework leg's `## Revisions` entry recording this same two-rule gap.
- [Channel List — the workspace row's plus names itself in a pill](channel-list-workspace-plus-pill.md)
  (#1181) — this treatment's second wearer.
- [Channel List — the host row and its connection dots § The row's pen and plus on hover](channel-list-host-row.md#the-rows-pen-and-plus-on-hover-1185)
  (#1190) — this treatment's third and fourth wearers.
- [Channel List — the section header's pair-new-host control § The hover/focus name pill](channel-list-section-header-pair-control.md#the-hoverfocus-name-pill-channelscsschannellisttsx-added-by-1304)
  (#1304) — this treatment's fifth wearer, and the `top: 100%` deviation #1427 deleted.
- [Composer attach — the name pill](composer-attach-name-pill.md) — the treatment this restates, #1265,
  shipped first.
- [Save-as-channel dialog](save-as-channel-dialog.md), [Rename conversation dialog](rename-conversation-dialog.md)
  — the two dialogs the trailing controls open.
