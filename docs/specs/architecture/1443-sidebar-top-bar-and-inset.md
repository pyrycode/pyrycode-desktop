# #1443 — the sidebar card takes its drawn top bar and inset

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` → `ChannelList`, `SettingsButton`, `ArchiveButton`,
  `renderBody` — the `<section>` whose first child is the actions cluster, the two icon buttons that
  shrink from 48 to 24, and the body the new tree wrapper takes.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list`, `.channel-list__actions`,
  `.channel-list__settings`, `.channel-list__archive`, `.channel-list__divider` — the rules this ticket
  rewrites, plus the four comment blocks below whose reasoning rests on the sticky cluster or on
  `.channel-list` clipping: the file head's painting-order paragraph, `.channel-list`'s own head, the
  section-header pill's placement block (`.channel-list__pair .channel-list__control-name`) and the host
  pen's trigger block (`.channel-list__host-edit:hover .channel-list__control-name`).
- `src/renderer/src/theme/tokens.css` → `--color-primary` (`#9dcbfc`), `--space-5/6/7` (20/24/28) — the
  tokens the drawing's numbers resolve to. `--color-inverse-primary` is `#32628d` here and is NOT the
  node's colour despite sharing its Figma style name.
- `src/renderer/src/pairedShell.css` → `.paired-shell__sidebar` — `min-width: 0` is what actually holds
  the column at 400px; its comment's parenthetical about `.channel-list`'s computed `overflow-x` goes
  stale with this change and is repointed.
- `e2e/sidebar-tree-geometry.spec.ts` → its `right` derivation off `.channel-list`'s `clientWidth`, and
  the blocks it feeds — the reads this ticket extends and repoints.
- `e2e/sidebar-control-name-pill.spec.ts` → `scrollListTo`, `expectInsideList`, `rowPosition` — the
  scroll driver, the containment criterion, and the block that parks a row under the sticky cluster.
- `e2e/sidebar-host-row-control-name-pill.spec.ts`, `e2e/sidebar-section-header-plus-name-pill.spec.ts`,
  `e2e/sidebar-workspace-plus-name-pill.spec.ts` → each file's own `scrollListTo` / `expectInsideList`
  pair, plus the two `clear of the sticky actions` relations.
- `e2e/thread-scrollbar.spec.ts` → its `scrollbarWidthOf(page, '.channel-list')` `auto` control.
- `e2e/paired-shell-card.spec.ts` → `rectOf(list)` (unaffected: `.channel-list` still fills the card) and
  the checkpoint-6 comment that calls `.channel-list` the `overflow-y: auto` scroll column.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → `SETTINGS_ENTRY_MARKER`,
  `ARCHIVE_ENTRY_MARKER` — the three-state accessible-name reads AC3 keeps green.
- `docs/knowledge/features/channel-list.md` § actions cluster, § archive route — states the two entries
  as one sticky top-right cluster. **Documentation phase's to replace; not edited here.**

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=115-3693
(sidebar card https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=103-2959)

The card (`103:2959`) is a flex column inset `pt-[24px] px-[20px] pb-[20px]` with a `gap-[28px]` between
its sections. Its first child is the Top bar (`115:3693`), itself a `gap-[20px]` column: a 76px-wide
`justify-between` row of two 24×24 boxes — the gear leaf 22×24, the archive leaf 24×21, both filled
`#9dcbfc` with no hover ground drawn — over a full-width `h-px opacity-60` rule in the same colour. The
section divider (`103:3009`) is the identical rectangle, so the two lines are one line drawn twice.

## Context

The sidebar's two entries have been interim desktop chrome since #333/#347: a sticky top-**right**
cluster of 48px round buttons riding the scroll column, archive-then-gear, with a hover fill the design
never drew. The drawing puts them at the card's **top-left** under a rule, gear first, and puts the whole
bar outside the scroller. Landing that is what makes the Channels header start at the drawn 97 from the
card's top edge — the same 97 the chat pane's first message row takes in #1444, so the two cards read as
one design. #1426 having deleted the FAB, the cluster is the list's last sticky child, so this also ends
stickiness in the sidebar entirely.

**The bar does not scroll**, per the ticket's ruling and endorsed here: the card paints no ground of its
own (#1058 deleted it so the wash on `.paired-shell__sidebar::before` could show through), so a bar
inside the scroller would need an opaque fill invented for it before rows could pass behind it.

**No ADR.** This is a redraw of one screen's chrome against a node already recorded as the desktop
source of truth; it introduces no new cross-cutting decision.

## Design

`.channel-list` stops being both the padded card column and the scrollport, and becomes the padded
column only. The `<section>` gains a third structural child so the split has somewhere to live:

```
<section class="channel-list">              padded 24/20/20, flex column, position: relative, NO overflow
  <div class="channel-list__actions">       24px row: SettingsButton then ArchiveButton, gap --space-7
  <div class="channel-list__actions-rule">  1px, margin-top --space-5
  <div class="channel-list__tree">          flex 1 1 auto, min-height 0, overflow-y auto, padding-top --space-7
    {renderBody(…)}
```

**The class token stays `.channel-list__actions`** for the button row, per the ticket's ruling — three
specs park the pointer on it, and nothing about the redraw needs a new name. Its box changes meaning from
"sticky cluster" to "the bar's row", and it keeps stretching to the card's 360px content width in the
column, so a `hover()` aimed at its centre still lands on inert bar rather than on a control.

**The rule is a sibling, not the bar's border.** A `border-bottom` cannot carry the node's 60% without
fading the glyphs with it, and this repo paints opacity as a de-emphasis device on its own element (the
`.channel-list__divider` precedent). Since the divider is the identical rectangle, the two share one
declaration block and then take their own placement rules — the AC's "same colour and opacity" becomes
structural rather than a coincidence two rules have to keep agreeing on.

**The 97 is derived, never written down**: `--space-6` (card top) + 24 (bar row) + `--space-5` (bar gap)
+ 1 (rule) + `--space-7` (tree top padding) = 97. The 28 is carried as the TREE's top padding rather than
the bar's bottom margin so the Channels header scrolls away with its rows, as the ticket's Structure note
asks.

**The 52 is derived too**: `gap: var(--space-7)` between two `--space-6` boxes lands the archive box's
left edge 52 in, which is the file's no-spacing-literal convention. The buttons shrink to `--space-6`
squares with `padding: 0`, `color: var(--color-primary)`, no hover ground, and their `:focus-visible`
outline kept per file convention. Their Material paths are replaced by the drawing's exports at their own
leaf sizes (gear `viewBox="0 0 22 24"` drawn 22×24, archive `viewBox="0 0 24 21"` drawn 24×21), centred
in the 24px box by the button's own flex centring, `fill="currentColor"`, `aria-hidden="true"`. The path
strings are the ones in the ticket's first comment; the Figma asset URLs expire in seven days, which is
why they are not fetched at build time.

**Render order flips to gear-then-archive.** Both keep their class tokens and their `aria-label`s, so
every spec that clicks or hovers them passes unedited, and tab order within the tree is untouched
(the bar precedes the tree in document order either way).

### What deliberately does not move

`.channel-list` keeps `position: relative` — it is the declaration that lifts the whole subtree over the
card wash (#1058, measured), and every level of the tree is positioned beneath it. It keeps no `z-index`,
so it is still not a stacking context and the four fixed overlays still escape the column. The card wash
on `.paired-shell__sidebar::before` is untouched. The section header's pill keeps `top: 100%` exactly as
shipped; re-centring it is a separate ticket (the ticket's ruling), so this plan only retires the
*reason* the deviation was taken, not the deviation.

## State + concurrency model

None. No store slice, no async work, no subscription, no IPC. The change is one element of structure and
a set of CSS declarations; `ChannelList`'s props, its callbacks and `renderBody`'s signature are all
unchanged.

## Error handling

None to add. No new failure mode: there is no I/O, no parse, and no daemon value on this path. The two
buttons' `onClick`s stay the pure injected nav effects they already are.

## Testing strategy

**Static tier (`ChannelList.test.tsx`, vitest, `renderToStaticMarkup`)** — unchanged and must stay green:
the Settings and Archive accessible names in all three list states (AC3). No edit is planned; if the
render-order flip trips an ordering assertion, that assertion is repointed, not deleted.

**`e2e/sidebar-tree-geometry.spec.ts` (fake-transport Playwright)** owns AC1 and the structural half of
AC2, in its single existing launch:

- the card's top inset (the bar's top edge 24 below the card's) and its bottom inset (the tree's bottom
  edge 20 above the card's);
- the bar as a 24px row, the gear box at the content left edge and the archive box's left edge 52 in,
  both 24×24, drawn in `--color-primary` with a transparent ground;
- the rule: 1px, its top edge 20 below the bar's bottom, spanning the card's 360 content box, and its
  computed colour and opacity;
- the Channels header's top 97 below the card's top edge;
- the divider's computed colour and opacity read back as EQUAL to the rule's — asserted as an equality
  between two live reads, not as two literals that happen to agree — with its 28px margins unchanged;
- the trailing-edge derivation moves off `.channel-list`'s `clientWidth`. Its replacement keeps the same
  shape one level down: the card's own width less whatever a classic (non-overlay) scrollbar took from
  the element that now scrolls (`offsetWidth - clientWidth` on the tree). The expected x values in every
  block it feeds are unchanged. The rule is NOT read against that derivation — it sits outside the
  scroller and spans the full content box — so its span is asserted against the card's box directly;
- a closing block pushes a tall list into the same launch, scrolls the tree, and reads back that the tree
  moved while the bar's and the rule's y are exactly where they were: AC2's first clause, and the one
  assertion that would catch a scrollport left on `.channel-list`.

**The four scroll-driving pill specs** — `sidebar-control-name-pill`, `sidebar-host-row-control-name-pill`,
`sidebar-section-header-plus-name-pill`, `sidebar-workspace-plus-name-pill` — each repoints its own
`scrollListTo`, its `expectInsideList` argument, its `scrollHeight > clientHeight` precondition and its
`scrollWidth - clientWidth` horizontal read at `.channel-list__tree`. Every one of the four measures the
clipper; leaving them on `.channel-list` would not redden, it would fail open — a `scrollTop` write to a
non-scrolling element is a silent no-op, so "scrolled to bottom" would quietly become "at top".

`sidebar-control-name-pill`'s high-row block additionally re-parks its row: with nothing overlapping the
scroller's top edge any more, the row is parked flush with the tree's own top edge instead of under the
cluster's bottom, and both `rowPosition` reads move with it. `sidebar-section-header-plus-name-pill` and
`sidebar-host-row-control-name-pill` keep their `clear of the sticky actions` relations — after this the
bar is the tree's out-of-flow-free predecessor, so those hold by construction and would still catch a bar
that grew down into the tree — and their comments are rewritten to say exactly that rather than to claim
a live overlap.

**`e2e/thread-scrollbar.spec.ts`** repoints its `auto` control at `.channel-list__tree`.

**Fakes vs mocks:** unchanged throughout — every spec above runs on the existing fake-transport fixture,
and the static tier renders the component directly. No new fixture and no new mock.

**Not run here:** the full vitest suite, the full Playwright tier and the real-claude tier. § B2 scopes
this run to the touched files plus `npm run build`; the dispatcher's gate owns the rest.

## Documentation handoff

**Pending — documentation phase.** `docs/knowledge/features/channel-list.md` states the two entries as
one sticky top-right cluster in two places: its actions-cluster paragraph and its archive-route
paragraph. Both readings are replaced by the drawn top bar — the gear at the card's top-left, the archive
28 to its right, under a rule, outside the scroller. The file sits within ~70 bytes of the 50000-byte cap
`npm run check:docs` enforces, so this is a **replacement, not an addition**. Not edited in this ticket.

## Open questions

1. **Does `ChannelList.test.tsx` assert the two entries' relative order?** If the render-order flip
   reddens a static assertion, repoint it at the drawn order rather than deleting it. Resolved in Phase B.
2. **Does any shipped spec pin `.channel-list__divider`'s colour to `--color-outline-variant`?** The AC
   changes it to `--color-primary`; a spec holding the old token must move with it. Resolved in Phase B.
3. **Does `.channel-list` losing `overflow` reach the sidebar's 400px floor?** `.paired-shell__sidebar`'s
   `min-width: 0` is what holds it, and that rule's own comment already records that `.channel-list`'s
   computed `overflow-x` "does not save it" — so the answer looks like no, and the parenthetical is
   repointed at the tree. Confirm against `sidebar-tree-geometry`'s width reads in Phase B.
