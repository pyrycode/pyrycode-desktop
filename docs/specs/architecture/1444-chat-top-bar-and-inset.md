# #1444 — the chat card takes its drawn top bar and inset

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ConversationScreen`'s
  `<div className="conversation">` return, `ThreadOverflowMenu` (the `wrapperRef` / `useEffect`
  outside-click shell), `ThreadOverflowMenuView` (the trigger + `role="menu"` surface) — the markup
  this ticket restructures, and the two comment blocks above them that reason about the absolute
  placement it retires.
- `src/renderer/src/screens/conversation/conversation.css` → `.conversation`, `.conversation__overflow`,
  `.conversation__overflow-trigger` (and its `:hover`), `.conversation__overflow-menu`,
  `.conversation__thread`, `.composer`, `.composer-status`, `.conversation__banner`,
  `.conversation__workspace-chip` — the rules edited, plus the file-head deletion note whose
  "the thread starts higher / the trigger floats" paragraph this ticket ends.
- `src/renderer/src/screens/channels/channels.css` → the shared `.channel-list__actions-rule` /
  `.channel-list__divider` declaration block (the 1px / `--color-primary` / 60% line, and its starred
  note that the Figma style name `inverse-primary` is NOT `--color-inverse-primary`),
  `.channel-list__actions` (the in-flow bar), `.channel-list__settings` (the drawn-at-rest 24px button),
  `.channel-list` and `.channel-list__tree` — #1443's shipped half of this change, mirrored rather than
  re-derived.
- `docs/specs/architecture/1443-sidebar-top-bar-and-inset.md` → its Design and Revisions sections — the
  sibling's reasoning, including the scrollport-move cost this ticket deliberately does not pay.
- `src/renderer/src/theme/tokens.css` → `--color-primary` (`#9dcbfc`), `--space-3/4/5/6` (12/16/20/24) —
  the tokens the drawing's numbers resolve to.
- `src/renderer/src/pairedShell.css` → `.paired-shell__pane` and its `box-sizing: border-box` note that
  `index.css` sets **no global box-sizing reset**; `.conversation` therefore needs its own.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → the
  `ThreadOverflowMenuView — the thread overflow menu` describe and the two `onBack`-gate cases — AC4's
  static half, which asserts `aria-label`, `aria-haspopup`, `aria-expanded`, the three item labels and
  the `conversation__overflow` class substring, and never the glyph's path or viewBox.
- `e2e/paired-shell-card.spec.ts` → `rectOf`, `tokenColor`, `wholePixels`, its checkpoint-2 transparency
  reads on `.conversation` / `.composer` and its checkpoint-4 equality of `.conversation`'s box with
  `.paired-shell__pane`'s — the helpers the new spec borrows and the assertions that must stay green.
- `e2e/sidebar-tree-geometry.spec.ts` → its single-launch, single-`test()` shape — the sibling the new
  chat-side spec is modelled on.
- `e2e/composer-message-box.spec.ts` → its resting/grown **delta** reads on `.conversation__thread`,
  `.composer-status` and `.composer__footer` — deltas, not literals, so the inset change cannot redden
  them.
- `docs/knowledge/features/conversation-shell.md` → the overflow-menu paragraphs.
  **Documentation phase's to update; not edited here.**

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=497-1891
(chat content https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=106-3321)

`Content` (`106:3321`) is a flex column inset `pt-[24px] px-[20px] pb-[16px]` with a `gap-[12px]` between
its three sections: the Top bar, the Message area (`132:4171`, `flex-[1_0_0] gap-[16px] overflow-clip`)
and the Input area (`347:5408`, `gap-[8px]`, whose own footer is `pt-[4px] px-[16px]`). The Top bar
(`497:1891`) is a `gap-[20px] pb-[16px]` column: a full-width `justify-end` `Buttons` row holding one
24×24 `Menu button` (`497:1896`) around a 6×24 ellipsis leaf (`498:1919`), over a full-width
`h-px opacity-60` rule in `#9dcbfc`. No hover ground is drawn at any state.

## Context

The chat pane's overflow trigger has been floating chrome since #276 and alone since #1064 deleted the
back arrow beside it: a 48px round button absolutely placed 4px from the pane's top-right, over the
thread's first row, with a hover fill the design never drew. The drawing replaces it with a bar the card
owns — a 24px button row under no ground, a rule 20 below it, 16 of the bar's own padding — and insets
the card 24/20/16. #1443 landed the identical treatment on the sidebar (PR #1449), so this is a mirror,
not a fresh derivation; landing it is what puts this pane's first message row at the drawn 97 from the
card's top edge, the same 97 the sidebar's Channels header already takes.

**The bar does not scroll**, per the ticket's ruling and endorsed here for the sibling's reason: #1058
deleted this pane's own background so the wash on `.paired-shell__pane::before` could show through, and
the drawing gives the bar no fill either, so a bar inside the scroller would need an opaque ground
invented for it before rows could pass behind it.

**`.conversation__thread` stays the scrollport.** Nothing in this change needs the scroller to move, and
#1443 measured what moving it costs: a `scrollTop` write to a non-scrolling element is a silent no-op, so
the fifteen specs that read this element — `thread-scroll-pin` among them — would fail open rather than
red. The bar becomes a sibling ABOVE the scroller, which is the whole of "the bar does not scroll".

**No ADR.** A redraw of one screen's chrome against a node already recorded as the desktop source of
truth; no new cross-cutting decision.

## Design

### Structure

`.conversation` keeps `position: relative` — it is the Run configuration sheet overlay's containing
block, as its own rule records — and gains the card's inset plus `box-sizing: border-box` (it is
`height: 100%` and this repo has no global box-sizing reset). `.conversation__overflow` stops being an
absolute box and becomes the card's first in-flow child, the drawn bar:

```
<div class="conversation">                        padded 24/20/16, position: relative, box-sizing: border-box
  <div class="conversation__overflow">            the bar: flex column, padding-bottom --space-4
    <div class="conversation__overflow-anchor">   align-self: flex-end, position: relative — the 24px box
      <button class="conversation__overflow-trigger">   24×24, and the menu's right:0/top:100% anchor
      <div class="conversation__overflow-menu">        (when open)
    <div class="conversation__overflow-rule">     1px, margin-top --space-5, full content width
  …the banner / notice / chip / thread / status / composer, unmoved in the column
```

**The bar's cross-axis default does the drawing's two alignments with no extra declaration.** The column's
default `align-items: stretch` is what spans the rule across the card's content box; the anchor overrides
it with `align-self: flex-end`, which is the node's `justify-end` on the `Buttons` row. A separate
full-width row element would buy nothing and would be a third class.

**The anchor is a new element, and it exists for two reasons that must not be separated.** The menu is
`position: absolute; top: 100%; right: 0`, so it needs a relative box that is exactly the trigger; hung
off the bar it would drop clear of the rule and the bar's 16px padding before it began. `wrapperRef` —
whose only job is `!wrapperRef.current.contains(target)` in the outside-click effect — must sit on the
SAME box: left on the bar it would read a mousedown anywhere across the pane's full width as inside the
menu and stop dismissing it. Both move onto `.conversation__overflow-anchor` together.

**The rule is a sibling, not the bar's `border-bottom`.** A border cannot carry the node's 60% without
fading the button with it, and this repo paints opacity as a de-emphasis device on its own element.
It takes `flex: 0 0 auto`: a flex item's default `flex-shrink: 1` lets a 1px box be rounded away under
pressure, which is the declaration `.channel-list__actions-rule` carries for the same reason. It is NOT
joined onto the sidebar's selector list — that block lives in `channels.css` and this one in
`conversation.css`; the two files share no selectors today and this ticket does not start.

**The 97 is derived, never written down**: `--space-6` (card top) + 24 (button row) + `--space-5` (bar
gap) + 1 (rule) + `--space-4` (bar bottom padding) + `--space-3` (the thread's own top padding) = 97.
The card's 12px column gap is carried as the THREAD's vertical padding rather than as `gap` on
`.conversation`, and that is load-bearing rather than stylistic: a `gap` there would apply between every
child of the column, and the 8px between `.composer-status` and `.composer` — the Input area's own
`gap-[8px]`, recorded in `.composer`'s comment — would become 20.

### The button

`.conversation__overflow-trigger` shrinks from 48 to a `--space-6` square: `padding: 0`, no border, no
radius, no ground, `color: var(--color-primary)`, `:focus-visible` outline kept per file convention. Its
`:hover` rule is deleted, not overridden — the drawing fills the glyph in every state it draws and gives
it no circle at all. `.channel-list__settings` is the shipped block this mirrors verbatim.

The Material `more_vert` path is replaced by the drawing's export, `viewBox="0 0 6 24"` drawn 6×24,
centred in the 24px box by the button's own flex centring, `fill="currentColor"`, `aria-hidden="true"`.
The path string is the one in the ticket's first comment; the Figma asset URLs expire after seven days,
which is why it is not fetched at build time. The export carries `fill="#9DCBFC"` — **that is
`--color-primary`, not `--color-inverse-primary`**, which `tokens.css` sets to `#32628d`, a different
colour that happens to share the node's Figma style name. `currentColor` over `color: var(--color-primary)`
reaches the drawn paint through a token.

`aria-label="More actions"`, `aria-haspopup`, `aria-expanded`, the class tokens and the three menu items
are all untouched, which is what leaves the twelve trigger-clicking specs unedited.

### Spacing

- `.conversation__thread`: `gap` `--space-3` → `--space-4` (the message area's `gap-[16px]`),
  `padding` `var(--space-2) var(--space-4)` → `var(--space-3) 0`. The rows reach the card's content box
  and the 12 above and below them are the card's own column gap.
- `.composer`: `padding` `var(--space-2) var(--space-3) var(--space-3)` → `var(--space-2) 0 0`. The card's
  20px sides and 16px bottom replace the block's own; the **top 8 stays**, and that is a deliberate
  departure from the ticket's "padding to 0". That 8 is the Input area's drawn `gap-[8px]` between the
  Status area and the message box, which `.composer`'s own comment records as the whole distance between
  them (`.composer-status` is a sibling in a column that declares no gap). Zeroing it would delete a drawn
  value the ticket's own AC3 does not ask to move.
- `.composer-status`: `padding: 0 var(--space-3)` → `padding: 0`. Not a free choice: the rule's comment
  states its 12 exists to align the status icon with the composer's left edge, and the drawing puts the
  Status area at x=0 of a full-width Input area. Leaving it would break a recorded invariant that this
  ticket's own edit to `.composer` moves.
- `.conversation__banner` and `.conversation__workspace-chip`: horizontal `--space-4` → 0. Same shape —
  both rules' comments say in so many words that their 16 exists to align them with the thread, and the
  thread's 16 is what this ticket deletes. One declaration each.

### What deliberately does not move

`.question-panel` keeps its `var(--space-2) var(--space-3) var(--space-3)`. It is the other occupant of
the composer's slot, it is drawn by its own node (`347:6018`) and not by `106:3321`, and no criterion here
names it. Converging it would be redrawing a node this ticket has not read; it is called out in the
Documentation handoff instead.

`.conversation`'s `position: relative` stays for the reason its rule already gives. The Run configuration
sheet is unaffected by the new padding: an absolutely positioned child resolves `inset: 0` against its
containing block's PADDING box, which here is the whole element, so the sheet still covers the pane edge
to edge. `.conversation`'s border box still equals `.paired-shell__pane`'s, which is what
`paired-shell-card.spec.ts` checkpoint 4 asserts.

## State + concurrency model

No store slice, no async work, no IPC, no new subscription. `ThreadOverflowMenu` keeps its
`useState(open)` and its single `useEffect` over `[open]` with its existing cleanup removing both document
listeners; only the element `wrapperRef` points at changes. `ThreadOverflowMenuView`'s props and its
purity (no state, no effects) are unchanged, so `renderToStaticMarkup` still renders both states.

## Error handling

None to add. No I/O, no parse and no daemon value on this path; the trigger's `onClick` stays the pure
local toggle it is.

## Testing strategy

**Static tier (`ConversationScreen.test.tsx`, vitest, `renderToStaticMarkup`)** — unchanged and must stay
green, which is AC4's second half: the `ThreadOverflowMenuView` describe's three cases (accessible name,
`aria-haspopup`/`aria-expanded`, the three items and their order) and the two `onBack`-gate cases. None
of them reads the glyph's path or viewBox, so replacing the export cannot redden them; the new anchor
element is inside `ThreadOverflowMenu` (the container), which those cases do not render. No edit planned.

**`e2e/chat-top-bar-geometry.spec.ts` (new, fake-transport Playwright)** owns AC1, AC3 and the structural
half of AC2, in one launch and one `test()` block — the `sidebar-tree-geometry` shape, borrowing
`paired-shell-card`'s `rectOf` / `wholePixels` / `tokenColor` helpers. A chat-side SIBLING rather than an
extension of `paired-shell-card.spec.ts`, which twelve unrelated assertions already ride on. Its blocks:

- the card's inset: the bar's top edge `--space-6` below the card's, its leading edge `--space-5` in, the
  composer's trailing edge `--space-5` from the card's and its bottom edge `--space-4` above it;
- the bar: a 24px button row with the button's box 24×24 at the content's right edge, its computed
  `background-color` transparent and its `color` equal to a live `--color-primary` read (by token, never
  by hex);
- the rule: 1px tall, its top edge `--space-5` below the button's bottom, spanning the card's content box
  exactly, its computed colour equal to the same live token read and its opacity `0.6`;
- the first message row's top at 97 below the card's top edge — asserted as that one number, since it is
  the AC's own;
- the message rows: full content width, consecutive tops 16 apart, 12 between the bar's bottom edge and
  the first row and between the last row and `.composer-status`;
- `.conversation__thread` is still the only scrolling element in the pane: a computed `overflow-y` read of
  `auto` on it and a read that is NOT `auto`/`scroll` on `.conversation` and on the bar, plus a tall-thread
  scroll that moves the rows while the bar's and the rule's `y` stay exactly where they were. That last
  block is the one assertion that would catch a scrollport left on, or moved to, the wrong element;
- AC2's dismissal region, which no shipped spec covers: open the menu, click a point inside the BAR but
  outside the button and its menu (the bar's leading edge, far from the right-anchored control), and the
  menu must close. That is the assertion that reddens if `wrapperRef` is left on the bar.

**Not run here:** the full vitest suite, the full Playwright tier and the real-claude tier. § B2 scopes
this run to the touched files plus `npm run build`; the dispatcher's gate owns the rest. AC4's
"unedited" half is proven by `git diff` over the twelve spec files, which this run reports.

**Fakes vs mocks:** unchanged. The new spec runs on the existing `launchPairedApp` fake-transport fixture;
no new fixture and no new mock.

## Documentation handoff

**Pending — documentation phase.** `docs/knowledge/features/conversation-shell.md` describes the overflow
menu as the thread's trailing affordance without recording where it sits; after this it is the chat card's
drawn top bar — a 24px ellipsis button at the card's top-right under a 1px `--color-primary` rule at 60%,
outside the scroller, with the card inset 24/20/16 and the first message row at 97. Worth recording
alongside it: the two cards' bottom insets differ **on purpose** (sidebar 24/20/20, chat 24/20/16, both as
drawn), and `.question-panel` still carries the composer's retired 12px side padding, so the
permission/question state sits 12px in from the message box until its own node is read. Not edited here.

## Open questions

1. **Does the bar's `align-self: flex-end` anchor collapse to less than 24px?** The anchor is a
   shrink-wrapped flex item around a fixed 24px button, so it should measure exactly 24. Confirm against
   the new spec's button-box read in Phase B.
2. **Does deleting `.conversation__thread`'s horizontal padding move any row's trailing edge onto a
   control?** This is the defect #1443 hit one level down (its Revisions entry). It should not reach here —
   the thread was already the scroller, its bar already rode in the pane, and the pane had no inset to
   lose — but the new spec's full-content-width row read is where it would show. Confirm in Phase B.
3. **Does any shipped fake-tier spec read `.composer-status`'s or `.conversation__banner`'s x?**
   `composer-message-box` reads heights as deltas and `banner-reports` reads text, so the answer looks like
   no. Confirm by running the touched-scope set in Phase B.

## Revisions

### 2026-09-15 — the two edits to `.conversation__thread` had three dependents, and the plan named none

Driven by the verifier's triage on PR #1453 (`npx playwright test` red on `assistant-whitespace`,
`tool-groups`, `tool-row-toggle`; install, `check:docs`, `npm test` and `npm run build` all green). Both
regressions trace to the two declarations this plan's § Spacing changed, and the design section treated
both as local retunes when each is read by a rule elsewhere in `conversation.css`.

**1. The thread's gap is a value two other rules are measured off, not a local one.** The plan moved it
`--space-3` → `--space-4` and stopped there.

- `.tool-row + .tool-row, .tool-group-row--joined-above > .tool-row` sets a negative `margin-top` whose
  whole job is to cancel the thread's gap and then overlap by one border width. Left at `--space-3` it
  drew `16 - 13 = 3px` of daylight plus the border — the `Received: 4` both specs reported. Rebound to
  `--space-4`. `e2e/tool-row-toggle.spec.ts` already asserted this against the thread's *live* gap
  ("rather than as -13px"), so the spec was written to survive the retune and the CSS was the half that
  hardcoded it.
- `.session-delimiter`'s `padding: var(--space-1) 0` topped the old 12px gap up to the 16px of clearance
  its node draws. Its own comment warned that "if that container gap ever changes, this number is what
  silently breaks", and it did: 16 + 4 = 20. The declaration is deleted rather than zeroed — a `div` has no
  UA padding, and this file's own rule is that restating a settled value is how it gets lost — with the
  comment keeping the reason there is none. **No spec reads this distance**: it is the one of the three
  that the tier could not have caught, found only by reading the comment the plan's Files-read list never
  opened.

**2. Open Question 2 asked about the wrong edge.** It asked whether deleting the thread's horizontal
padding moves a row's *trailing* edge onto a control; the new spec's full-content-width read answers that,
and the answer is no. The **leading** edge is what broke, and nothing in the new spec looks at it.

`.conversation__thread` clips on both axes — `overflow-y: auto` makes `overflow-x` compute to `auto`, and a
scroll container clips at its padding box, where left-side overflow in LTR is unreachable by scrolling. A
three-digit ordered-list marker paints out there: `.bubble__markdown`'s list rule works the budget out in
full and lands on `100.` reaching 36px left of the row's content edge, 20 of it inside `.bubble`'s own
inline padding and the remaining 16 inside the thread's. Deleting that 16 clipped the marker.

**The new contract:** the rows keep the card's content box, and the clip box is widened back under them —
`margin-left: calc(-1 * var(--space-4))` with an equal `padding-left`. This is `.channel-list__tree`'s
shipped idiom (it takes back the sidebar's `--space-5` for its scrollbar strip), mirrored on the left and
for the marker instead. The borrowed strip lands on the card's own 20px inset with 4 to spare, and
`threadPaddingLeftPx` reads 16 again, so `assistant-whitespace`'s budget arithmetic is bit-for-bit what it
was. Left side only: the scrollbar edge needs nothing, being hidden and taking no width.

Both halves of the borrow are pinned, by two specs that were already written: `assistant-whitespace`'s
budget bound fires if the padding goes away, and `chat-top-bar-geometry`'s per-row content-box read fires
if the padding returns without the margin. No new assertion was added — a third would only restate them.

**3. The plan's Testing strategy was the process cause, and it changed.** It scoped this run to the
touched files plus `npm run build` and deferred the Playwright tier to the dispatcher's gate. That is § B2
as written, but the new spec drives plain bubbles only — it never renders a tool-row run or a list, which
is exactly why it proved the new geometry while missing what the same two declarations broke. When a
change edits a *container's* spacing, the touched scope is its occupants, not its own spec. This leg ran
the full fake tier before pushing.

**Unchanged by this revision:** the bar, the anchor, the button, the glyph, the rule, and every other
§ Spacing edit. Open Questions 1 and 3 are answered green by the run and needed no design change.
