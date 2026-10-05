# #1728 — Context usage as a counterclockwise circle with 70% and 85% warnings

## Files read

- `src/renderer/src/screens/conversation/contextUsage.ts` → `contextUsageStep`: the severity ladder, 50/70 today, becomes 70/85.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ContextUsageReading` (the pure view, visible text today), `ContextUsageControl` (store-bound container, wraps the reading in the popover when `contextUsageDetail` is supported), and the `composer__footer` row inside `Composer` (the reading sits after `ComposerEffortMenu`).
- `src/renderer/src/screens/conversation/ContextBreakdownPopover.tsx` → `ContextBreakdownPopover`: wraps `children` in the `composer__context-trigger` button; its docblock states the panel is right-aligned to the reading.
- `src/renderer/src/screens/conversation/conversation.css` → `.composer__footer` (padding 4/16/0/12, `column-gap: min(3.5%, var(--space-5))`), `.composer__context` + `--warning`/`--error`, `.context-breakdown-anchor`, `.composer__context-trigger`, `.context-breakdown` (`right: 0; left: auto`), and the `.composer-status__error-prefix` visually-hidden recipe.
- `src/renderer/src/theme/tokens.css` → `--color-primary` #9dcbfc, `--color-primary-container` #134a74, `--color-warning` #ffca45, `--color-error` #ffb4ab, `--space-1` 4px, `--space-3` 12px, `--space-4` 16px.
- Tests: `contextUsage.test.ts` (`contextUsageStep` describe), `ConversationScreen.test.tsx` (`ContextUsageReading` describe, footer-order and mount tests), `e2e/composer-context-severity.spec.ts`, `e2e/composer-footer-overflow.spec.ts` (geometry order, Tab order, `READING_TEXT`).
- Overlap: `feature/1726` (Send now) edits `ConversationScreen.tsx`, `conversation.css` and `ConversationScreen.test.tsx` in the timeline's queued row, a different block; a later merge may touch those files.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-5408

Input footer → Info and buttons → Context (`I347:5408;737:8599`), a 15×16 frame at x=4 of the left group holding two stacked 15×15 rings: a full `r=6.5`, 2px-stroke circle in Schemes/Primary Container (#134A74) and a used arc in Schemes/Primary (#9DCBFC) that starts at 12 o'clock and runs counterclockwise (the static example stops at 3 o'clock, i.e. 75%). Actions sits at x=35, so the circle-to-Actions gap is 16px. Built as an inline SVG (`aria-hidden`) inside the existing `.composer__context` span; colours by token, the arc derived from the reading.

## Context

The footer's visible "Context: 42%" text is replaced by the design's ring, moved to the row's first slot, and the warning ladder moves from 50/70 to 70/85. The run-configuration sheet's gauge does not use the ladder and is untouched. No ADR needed.

## Design

**Ladder** — `contextUsageStep(percent)`: `>= 85` → `error`, `>= 70` → `warning`, else `primary`. Same type, same single call site.

**View** — `ContextUsageReading({ usedTokens, windowTokens })` keeps its signature and its `null` for an unavailable reading. The present arm renders:

```
<span class="composer__context[ composer__context--<step>]">
  <svg class="composer__context-ring" width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
    <circle class="composer__context-track" cx="7.5" cy="7.5" r="6.5"/>
    <circle class="composer__context-arc" cx="7.5" cy="7.5" r="6.5" pathLength="100"
            stroke-dasharray="<pct> 100" transform="matrix(0 -1 -1 0 15 15)"/>
  </svg>
  <span class="composer__context-label"><accessible text></span>
</span>
```

- The arc is the reading itself: `pathLength="100"` makes the dash length the percentage, so 0 draws nothing (butt caps) and 100 a full ring. A circle's path starts at 3 o'clock and runs clockwise; the constant matrix reflects it across the 3-to-12 diagonal through the centre, so it starts at 12 o'clock and runs counterclockwise.
- The modifier class keeps setting `color`; the arc paints `stroke: currentColor`, the track `--color-primary-container` at every step.
- Accessible text, visually hidden, keeps the old form so the e2e specs reading `textContent` keep passing: `Context: N%` (primary), `Context high: N%` (warning), `Context nearly full: N%` (error). The word carries the warning state for non-colour readers at both raised steps.
- No visible text, no live region, no role on the span, exactly as before.

**Row** — `<ContextUsageControl>` moves to the first child of `.composer__footer`, before `ComposerActionsMenu`. The rest of the row keeps its order. With the trigger, the button's accessible name is its content, i.e. the hidden label, so it carries the percentage and stays in Tab order (now first in the row). Without breakdown support the span renders bare, as before.

**CSS**
- `.composer__footer` gets `--composer-footer-gap: min(3.5%, var(--space-5))` and `column-gap: var(--composer-footer-gap)` (same value).
- The row's first item (`.composer__footer > .composer__context`, `.composer__footer > .context-breakdown-anchor`): `margin-left: var(--space-1)` (Figma's 4px inset) and `margin-right: calc(var(--space-4) - var(--composer-footer-gap))`, so circle-to-Actions is exactly 16px at every width. The percentage resolves against the row's content box in both places.
- `.composer__context`: `display: flex; flex: 0 0 auto; color: var(--color-primary)`; the type ramp and `nowrap` go (no visible text). `.composer__context-ring` `display: block; fill: none; stroke-width: 2`. The label wears the visually-hidden recipe.
- `.context-breakdown`: right-alignment to the reading would now put the 280px panel off the pane's left edge, so it aligns left with the footer's own left edge instead: `left: calc(-1 * var(--space-3) - var(--space-1)); right: auto` (the anchor sits 12 + 4 in from it). At the 800px minimum the footer's border box is ~312px, so the panel fits.

## State + concurrency model

Unchanged. Same store reads in `ContextUsageControl`, same `contextTokenSource` fallback and live updates; no new subscriptions or effects.

## Error handling

Unchanged: `contextUsagePercent` returns `null` for an unavailable reading and the view renders nothing; a known 0% renders a fully dark ring.

## Testing strategy

- `contextUsage.test.ts`: the ladder's pairs become 69/70 and 84/85, ends 0/100, totality list retuned.
- `ConversationScreen.test.tsx` `ContextUsageReading` describe: exact markup at 69 (primary), 70 (warning), 85 (error); the dash array equals the percentage (0 → `0 100`, 100 → `100 100`, a non-round value); null on an absent window; no visible-text class other than the hidden label; no live region. Footer-order tests: the reading precedes Actions / permission / model / effort; the mount and `contextUsageDetail` trigger tests updated to the new markup and strings.
- `e2e/composer-context-severity.spec.ts`: drives 69/70/84/85, asserting the label text, the arc's computed `stroke` against the step token and the track's against `--color-primary-container` at every step.
- `e2e/composer-footer-overflow.spec.ts`: geometry order (reading · Actions · mode · model · effort · attach), the 4px inset and the 16px circle-to-Actions gap at the launch width, `READING_TEXT` → `Context nearly full: 100%`, and Tab order starting at the context trigger. Its footer screenshots double as the visual evidence.

## Open Questions

- Whether Chromium renders `pathLength` + dash array on a `<circle>` without a hairline at 0%; settled by the footer capture.
