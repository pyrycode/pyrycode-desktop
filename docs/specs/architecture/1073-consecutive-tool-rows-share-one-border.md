# #1073 — consecutive tool rows share one border instead of standing apart

## Files read

- `src/renderer/src/screens/conversation/conversation.css` → `.conversation__thread` — the flex column whose
  `gap: var(--space-3)` is the 12px this ticket has to cancel; it cannot be varied per pair, which is why the
  join is a negative margin rather than a gap change.
- `src/renderer/src/screens/conversation/conversation.css` → `.tool-row` — the box since #1102: the fill, the
  1px `--color-primary-container` border, the `--radius-xs` corner, `overflow: hidden`, `flex: 0 0 auto`, the
  pending `opacity: 0.5` and `box-shadow: var(--shadow-thread)`. Every declaration this ticket overrides at a
  join lives here, and the rule's own comment names #1073 twice.
- `src/renderer/src/screens/conversation/conversation.css` → `.tool-row--resolved`, `.tool-row--error` — the
  state modifiers. `--error` retints the whole border at (0,1,0) and its placement after the base rule is
  already load-bearing; the join rules sit at (0,2,0) and must beat both.
- `src/renderer/src/screens/conversation/conversation.css` → `.tool-row--expanded` — carries only the
  header-to-body gap since #1102, so an expanded row is the same box and joins the same way.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `Timeline`, `TimelineRow`, `ToolRow` —
  `Timeline` maps items straight into `.conversation__thread` and `TimelineRow`'s `toolCall` arm returns
  `<ToolRow>` with no wrapper, so every `.tool-row` is a *direct* child of the thread column and
  `.tool-row + .tool-row` selects exactly the internal joins of a run. Confirmed rather than assumed: this is
  the premise the whole design rests on.
- `src/renderer/src/theme/tokens.css` → `--space-3` (12px), `--radius-xs` (6px), `--shadow-thread`,
  `--color-primary-container`, `--color-error` — every value the join rules name.
- `e2e/tool-row-toggle.spec.ts` → its six sibling tests and the module-scope `boxOf`, `boxesOf`,
  `routedToolUseFrame`, `routedToolResultFrame`, `failedToolResultFrame` helpers — the spec's own idiom (one
  `launchPairedApp` per test, every locator scoped by index) and the frame builders the new test reuses rather
  than reinventing.
- `e2e/thread-shadow.spec.ts` → its single-row `boxShadowsOf(page, '.tool-row')` reading — the lone-row case
  AC3 requires to stay green; it drives exactly one `tool_use`, so no run forms and no rule here reaches it.
- `e2e/thread-scroll-pin.spec.ts` → three `toHaveCount(1)` sites and the collapsed-height read on a single
  row — likewise untouched. A margin is outside the border box, so it cannot move a height.
- `docs/knowledge/features/conversation-shell-tool-row-box.md` § The shadow — records that per-row shadows are
  safe only because "the thread's 12px gap is wider than the shadow's 9px reach", and names #1073 as the change
  that falsifies it. That is the lesson that makes the shadow a required part of this slice rather than a
  follow-up.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=384-7103

`Consequent tool uses` is a fill-less column holding two `Tool use` instances with no gap, the first carrying
`mb-[-1px]` — the design's own 1px overlap, stated as a margin exactly as this ticket draws it. The wrapper
frame carries `drop-shadow-[0px_4px_2.5px_rgba(0,0,0,0.2)]` **once** for the whole stack, where a lone row
(`134-4939`) carries `shadow-[0px_4px_5px_0px_rgba(0,0,0,0.2)]` itself; those are the same effect, since a
filter blur is a standard deviation and a box-shadow blur is twice it. The second instance is the expanded
state, so the node covers a row opened inside a run. What the node is **not** is the answer for the internal
corners: it is two instances overlapped, so both keep their 6px on all four and the render shows the resulting
notch of background at either side of the join. Juhana ruled 2026-09-04 that a run's internal corners go square
and only its outer corners keep the 6px; this plan builds the ruling.

## Context

Every tool row is a direct child of `.conversation__thread`'s flex column, which sets `gap: var(--space-3)`
between every child, and `.tool-row` declares no margin. A run of five tool calls therefore draws five bordered
boxes separated by 12px of thread background and reads as five unrelated things rather than one sequence of
steps.

#1102 is what makes this small. The box treatment — fill, 1px border, `--radius-xs`, clip — moved from
`.tool-row__chip` out to `.tool-row` itself, and the expanded body moved inside that border. Joining two rows
is therefore a rule on the row, not a rule on the row plus a correction on the chip with an expanded body
hanging between two borders.

The markup does not change. Nothing is grouped, wrapped or re-parented, so a run interrupted by a message
bubble stops being a run for free, and no unit-tier assertion in `ConversationScreen.test.tsx` can move.

No ADR is warranted: this is one design node built as stated, with no cross-cutting decision to record.

## Design

Five rules, all in `conversation.css`, placed immediately after `.tool-row--error` and before
`.tool-row--expanded`. Two selectors carry all of it, and each names one half of a join:

| Selector | The half it names | What it declares |
|---|---|---|
| `.tool-row + .tool-row` | the **lower** row of a join | the negative margin; square top corners; the error tint inherited from a failed row above |
| `.tool-row:has(+ .tool-row)` | the **upper** row of a join | square bottom corners; no shadow; the error tint inherited from a failed row below |

A row that is neither — a lone row, or a row beside a bubble — matches neither selector and is byte-identical
to what ships today. This is what makes "a row standing alone is unchanged" true by reading rather than by
argument.

**The margin.** `margin-top: calc(-1 * var(--space-3) - 1px)` on `.tool-row + .tool-row`. The column's gap and
the item's margin both apply in flex layout, so the pair's effective separation is `12 + (-13) = -1px`: the
lower row's 1px top border lands on exactly the pixel band the upper row's 1px bottom border occupies, and one
line is drawn. Tokenised rather than `-13px`, so the gap follows `--space-3` if it moves; the `1px` stays a
literal because it is the border width, not a spacing step.

`margin-top` on the lower row rather than Figma's `mb-[-1px]` on the upper one: both are equivalent under a
flex gap, and `.tool-row + .tool-row` is the primitive selector. `:has()` is spent only on the properties that
genuinely live on the *upper* element and have no `+` form.

**The corners.** The upper half zeroes `border-bottom-left-radius` / `border-bottom-right-radius`, the lower
half zeroes the two top ones. Composed over a run of three that gives: first row round on top and square below,
middle row square on all four, last row square on top and round below — the run's outer corners keep the 6px
and its internal ones go square, which is the ruling. Written as the *absence* of the row's own `--radius-xs`
on two corners, `0` inline; no `--radius-none` token, because a square corner is not a radius value in the
scale.

**The shadow.** `box-shadow: none` on `.tool-row:has(+ .tool-row)`, so exactly one row of a run — the last —
casts, and a lone row still casts its own. Left alone, `--shadow-thread` (0 4px 5px) reaches 9px down and 2.5px
sideways, so every interior row would drop a shadow across the join onto the row below and smear past the
stack's sides at each join; where a pending row precedes a resolved one the pending row's `opacity: 0.5` makes
it an atomic paint group above its successor, putting that shadow fully on top. Suppressing the interior rows
rather than moving the shadow to a wrapper is what keeps the markup unchanged; the last row is the survivor
rather than the first because the effect's 4px downward offset means its visible mass falls below the stack,
which is where the design's group shadow puts it. The reach is why the interior rows must go and the last one
can stay: the shadow is clipped to outside its own border box and its top edge starts `4 - 2.5 = 1.5px` below
that box, so the surviving shadow cannot paint back up across the join it sits under.

**The join's colour, stated rather than left to paint order.** Two facts pull opposite ways. A later sibling
paints over an earlier one, so by default the row below a failed row would erase that row's red bottom edge;
and a pending row's `opacity: 0.5` makes it an atomic paint group above every non-dimmed sibling regardless of
DOM order, which reverses the direction the moment a pending row is one of the pair. So both coincident borders
are made to carry the same colour and the join's appearance stops depending on which row paints last:

- `.tool-row--error + .tool-row { border-top-color: var(--color-error) }`
- `.tool-row:has(+ .tool-row--error) { border-bottom-color: var(--color-error) }`

Both at (0,2,0), so they beat `.tool-row--error`'s own (0,1,0) `border-color` and the base rule alike;
unlike `.tool-row--error`'s placement, theirs is not load-bearing. Neither leaks past the join edge: a failed
row's own four sides stay red through the base `--error` rule, and the two rows flanking it are retinted on
exactly one edge each.

A pending/resolved join needs no rule. A 50% border painted over a 100% border of the same colour at the same
pixels composites back to full strength, and a failed row is always `--resolved` as well (`ToolRow`'s
`rowClass` adds `tool-row--error` only on top of `tool-row--resolved`), so a dimmed row and a red border are
never the same element — only ever the two sides of a join.

**Chromium only, and available.** `:has()` shipped in Chromium 105; this app runs Electron 33 (Chromium 130)
and has no other renderer.

## State + concurrency model

None. CSS only: no store slice, no async work, no subscription, no teardown. Which rows exist and in what
order is `threadTimeline`'s, unchanged.

## Error handling

None to add. The one failure-shaped thing here is the *rendering* of a failed tool call, and it is a styling
rule, not a code path: `.tool-row--error` keeps closing the failed row's outline on all four sides, and the two
join rules above carry that colour onto the one edge of each neighbour that coincides with it.

## Testing strategy

Adjacency, the absence of a gap, the corner radii, the computed shadow and the border colour at a join are
rendered geometry and computed style. `vitest.config.ts` runs the `node` environment: every renderer spec is a
`renderToStaticMarkup` string with no stylesheet, so the unit tier structurally cannot observe any of it. This
slice adds no element, class or attribute, so there is nothing new for that tier to pin and `ConversationScreen.test.tsx` is unedited.

**A seventh sibling test in `e2e/tool-row-toggle.spec.ts`**, launching its own `launchPairedApp` — the idiom the
six tests above record, since more rows on any of their pages would make their bare `.tool-row` locators
strict-mode-ambiguous. It reuses that file's module-scope `boxOf`, `routedToolUseFrame`,
`routedToolResultFrame` and `failedToolResultFrame` rather than adding fixture machinery.

The drive: one composer send for a user bubble, then four `tool_use` pushes making a run of four directly under
it, resolved so the run reads **pending / resolved / failed / resolved**. That single arrangement reaches every
join case the ACs name — a pending/resolved join, a join with the failed row *below* it, and a join with the
failed row *above* it — and puts a non-tool row against the run's leading edge.

Scenarios asserted:

- **AC1, adjacency.** For each of the three joins, the lower row's box top equals the upper row's box bottom
  less one border width, read off the row rather than hardcoded. Plus each row's computed `margin-top`: `0px`
  on the first row of the run, and on the others the negative of the thread's own computed `row-gap` plus the
  border width — derived from the two live values, so a retune of `--space-3` moves the expectation with the
  rule.
- **AC1, the non-tool neighbour.** The distance from the user bubble's bottom to the first tool row's top is
  the thread's `row-gap`, unchanged.
- **AC2, the corners.** All four computed radii per row: the first keeps `--radius-xs` on top and reads `0px`
  below, the two middle rows read `0px` on all four, the last reads `0px` on top and the token below. The
  expected value is read from the row's own `--radius-xs`, not written as `6px`.
- **AC3, the shadow.** The first three rows compute `none`; the last computes something other than `none`. The
  exact value stays `thread-shadow.spec.ts`'s, on the lone row where it belongs.
- **AC4, the states and the join colour.** Opacity `0.5` on the pending row and `1` on the other three. Then,
  for each join, the upper row's `border-bottom-color` equals the lower row's `border-top-color` — the
  single-line invariant — with the pending/resolved join reading the plain colour and both joins flanking the
  failed row reading a different one. Two controls prove the tint is scoped to the join edge and not smeared
  down the run: the row below the failed one keeps the plain colour on its *bottom*, and the row above it keeps
  the plain colour on its *top*. Compositing itself is not asserted — computed style is pre-composite — and it
  does not need to be: equal colours on coincident pixels is what makes the drawn line independent of paint
  order, and it is the property a regression would break.
- **AC5, expanding inside a run.** The second row is opened, then the joins above and below it are re-measured
  for adjacency and for their border colours. The three width equalities AC5 names live in this file's first
  test, still run, and are deliberately not duplicated here.

Controls to run before committing the code, so each assertion is known to be a detector rather than slack: with
the margin rule alone in place and the corner, shadow and colour rules absent, the corner, shadow and
join-colour assertions must be red.

## Open questions

1. Does a send in the fake tier put anything between the user bubble and the pushed tool rows (a thinking
   indicator, a session delimiter) that would break the bubble-adjacency read? `conversation__thinking` now
   lives on the composer status rather than in the thread, so the expectation is no — to be confirmed by
   running the drive.
2. Does the last row of a run need `overflow` reconsidered so its surviving shadow is not clipped? Expected no:
   an element's `overflow` clips its descendants, never its own outer shadow (the #1102 comment's own finding).
   Confirmed by the assertion that the last row computes a shadow at all.

## Revisions

**2026-09-07, in Phase B. Both open questions resolved; neither changed the design, and no rule in the plan
moved.**

1. *Nothing draws between the bubble and the run.* The drive pushes an `assistant_delta` and its `turn_end`
   rather than driving the composer — fewer imports, and `thread-scroll-pin.spec.ts`'s precedent for an
   unsolicited delta. That closes the turn, so a `turnBoundary` item does sit between the bubble and the
   calls; `TimelineRow` renders that arm as `null` and emits no element, so the bubble and the first tool row
   stay DOM-adjacent and the 12px read is sound. The finding is worth more than the question: **a run is DOM
   adjacency, not item adjacency**, so two tool calls either side of a closed turn still join. That is the
   right behaviour and it is now stated in the CSS comment and exercised by the drive.
2. *The surviving shadow is not clipped.* `overflow: hidden` clips descendants, never the element's own outer
   shadow, as #1102's comment already found. The last row of the run computes a shadow; asserted.

**One shipped comment was falsified and is corrected in the same commit.** `.tool-row`'s own shadow paragraph
argued that per-row shadows are safe because "the thread's 12px gap is wider than the shadow's 9px reach, so
no row's shadow lands on the next" — closing that gap is precisely what this ticket does. The paragraph now
says it is the lone row's half only and points at the join rules. `docs/knowledge/features/conversation-shell-tool-row-box.md` § The shadow carries the same stale claim and
is the documentation phase's to correct; it is flagged in the PR body rather than edited here.
