# Permission modes named by behaviour

## Files read

- `src/renderer/src/screens/conversation/ComposerPermissionModeMenu.tsx` — `PERMISSION_MODE_LABELS`, `composerPermissionModeMenuModel`, and `ComposerPermissionModeMenuView` separate display copy from selection IDs and availability.
- `src/renderer/src/screens/conversation/ComposerPermissionModeMenu.test.tsx` — `view` and `panel` cover both renderings; existing cases protect auto filtering and bypass exclusion.
- `e2e/composer-permission-mode-menu.spec.ts` — `capturingFake` and `settingsFramesMatching` prove selection sends machine values and rejected writes roll back.
- `e2e/composer-footer-overflow.spec.ts` — `WORST_CASE_RUN_CONFIG` and `footerOverflowPx` exercise the complete footer at its 800px minimum.
- `src/renderer/src/screens/conversation/conversation.css` — `.composer__permission-label` and `.composer__footer` provide the existing ellipsis and shrink policy.
- `docs/knowledge/features/composer-permission-mode-menu.md` — the asymmetric read/write contract and auto-hiding join must remain intact.
- `docs/knowledge/features/conversation-shell-composer-message-box.md`, “Footer row shrink policy” — footer ellipsis at minimum width is intentional; full accessible names and dropdown copy remain available.
- `docs/knowledge/features/development-verification.md` — static renders cannot prove layout; expected label strings must be independent of the production mapping.

Codegraph context was unavailable (index not initialized); source search and file reads supplied this map.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=115-3678 and https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=121-3879

The trigger is primary-coloured body-small text followed by an upward chevron. The dropdown is a compact rounded column with padded body-small rows and a highlighted row. Retain `ComposerOptionsMenu`, the existing theme tokens, spacing and glyph; the ticket's new copy replaces the reference's sample text.

## Change

Change only the display mapping: `default` → Manual approval, `acceptEdits` → Auto-approve edits, `auto` → Auto approval, `dontAsk` → Approved actions only, and `bypassPermissions` → Bypass approvals. Keep `plan` → Plan. Refresh adjacent comments that describe this copy. Selection IDs, allow rules, the auto-mode availability filter and bypass exclusion are unchanged. There is no new state, async work, failure mode or lifecycle event to log. Preserve the current footer truncation policy and verify complete dropdown labels at 800px.

Sizing: one deliverable, one production file, approximately 150 total written lines including this plan and focused tests, zero new exports or consumer signature changes, two acceptance criteria, zero new error branches. The refiner's under-20-production-line estimate holds. Remote feature-branch overlap check found no conflicts for the four intended code/test files.

## Testing strategy

- First add literal expectations for all six trigger labels and the five selectable ID/label pairs; run the focused Vitest file and observe the old labels fail.
- Keep existing availability, unknown-mode and bypass assertions. Run the touched unit file after the mapping update, then `npm run build`.
- Update the existing permission-menu Playwright drive to pin visible copy independently, retain its machine-value/rollback checks, and capture its trigger and open dropdown at 800×600 and the default window size.
- Update the footer-overflow fixture to use `dontAsk`, now the longest label, retaining whole-row geometry checks at 800×600. Run both touched fake-transport specs. Inspect screenshots against the Figma references; capture artifacts stay in `/tmp/builder-1546/` through review.

## Documentation handoff

Pending documentation stage: no explicit documentation requirement appears in the ticket. Refresh obsolete label examples in `docs/knowledge/features/composer-permission-mode-menu.md`, especially “The wire contract is asymmetric, and that asymmetry is the whole design” and “The auto-hiding join”; preserve the documented availability and permission semantics, including existing allow rules for Manual approval.

## Revisions

- 2026-09-19: Final literal search found three old-copy expectations in `e2e/offline-session-settings.spec.ts` (held mode during disconnect and auto-mode exclusion). Update those expectations and run that focused spec as well. Its branch-overlap check is clear; production scope and behaviour are unchanged.
- Visual capture records Electron content viewports of 1100×772 and 800×572 for 1100×800 and 800×600 native windows. Dropdown rows fit in full at both sizes. The footer retains the documented ellipsis policy, with full accessible names; no layout or style revision is needed.
