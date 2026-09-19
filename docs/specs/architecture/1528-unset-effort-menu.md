# Unset composer effort menu

## Files read
- `src/renderer/src/screens/conversation/ComposerEffortMenu.tsx` — `composerEffortMenuModel` hides unset effort before resolving levels; the container already subscribes to model-list changes and delegates writes.
- `src/renderer/src/screens/conversation/ComposerEffortMenu.test.tsx` — pure decision and static view coverage, including inherited models.
- `src/renderer/src/screens/conversation/RunConfigSections.tsx` — `effortRowFor` resolves inherited defaults; existing connected-setting helpers gate writes.
- `e2e/composer-effort-menu.spec.ts` — captured setting requests and delayed rejection pattern.
- `e2e/composer-effort-default.spec.ts` — remembered choices remain a separate existing flow.
- `docs/knowledge/features/conversation-shell-composer-options.md` and `development-verification.md` — shared menu surface; static renders cannot prove interactions and delayed replies expose optimistic state.

## Design source
Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-5408 and https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=121-3879

The footer places small primary-colour labels with upward chevrons in a horizontal row. The options panel is a rounded vertical list with body-small typography. Reuse the existing trigger, panel, glyph and theme tokens; the unset trigger reads **Effort**, and no row is marked current.

## Change
Resolve published levels through `effortRowFor` before deciding visibility. Hide only when both effort and levels are empty; otherwise use the known effort or the client-owned Effort label. Preserve the empty current identifier and exact published option order. Existing store subscriptions handle late lists, and existing setting writes, optimistic overlays, rejection rollback, connection gates and remembered defaults remain unchanged. No new state, async tasks, failure branches or logging events are introduced.

Sizing: one deliverable, one production file, approximately 200 written lines including tests and this plan; zero new exported symbols, zero changed consumer contracts, two acceptance criteria and zero new rejection branches. Remote feature-branch overlap check found none. Codegraph was unavailable, so source reads supplied the symbol map.

## Testing strategy
- Update pure-model and view assertions for explicit and inherited models with unset effort; no levels stays hidden, known effort stays read-only, and no option is selected for unset effort.
- Extend the fake-transport effort spec with late list delivery, no automatic write, rejection back to unset, successful selection, and disconnection blocking interaction.
- Run touched unit tests, build, the focused effort-menu interaction spec and the existing remembered-default interaction spec. Capture the unset open menu for comparison with Figma.

## Documentation handoff
No explicit documentation requirement is present in the ticket. Pending documentation stage: update `docs/knowledge/features/composer-effort-menu.md`, section “composerEffortMenuModel, one pure function deciding all three renderings”, to describe the Effort trigger for an unset value with published levels.
