# Mid-session slash-command list replacement

## Files read

- `e2e/slash-command-type-ahead.spec.ts` — `slashCommandListFrame`, `captureOutbound`, and `panelOf` provide the frame, outbound capture, and mounted-menu harness.
- `e2e/fixtures/launchPairedApp.ts` — `launchPairedApp` opens one seeded conversation through real pairing and owns teardown.
- `src/renderer/src/store/slashCommandListStore.ts` — `setSlashCommandList` replaces the conversation snapshot wholesale.
- `src/renderer/src/screens/conversation/ComposerSlashCommandTypeAhead.tsx` — `useSlashCommandTypeAhead` derives rows from the current snapshot and draft; completion consumes Enter.
- `docs/knowledge/features/conversation-shell-composer-options-slash-type-ahead.md` — filtering preserves prefix-first order and the mounted interaction requires Playwright.
- `docs/knowledge/features/development-verification.md` — wait for a positive effect of the new frame before checking absence.

## Design source

N/A — test-only coverage of existing behavior; no production or visual change.

## Change

Add one independent test in the existing spec. Allow `slashCommandListFrame` to accept commands, keeping its existing default. Publish list A, type `/c`, and assert its matching rows. Publish list B while the menu is open; wait for a B-only row with no input or navigation, then assert the unchanged draft, exact filtered B rows, and absence of A-only rows. Include a nonmatching B entry so the test also proves filtering remains active. Complete a B-only row with Enter, assert the completed draft and closed panel, then check the existing outbound capture remains empty. All state arrives through fake-daemon frames.

Sizing: one regression deliverable, two acceptance criteria, approximately 100–120 written lines including this plan, zero production files, zero new exports, zero production consumer updates, zero new error branches. The existing frame helper has one caller. The #940 analogue added 211 e2e lines to establish the harness; this ticket reuses it. The refreshed remote feature-branch check found no overlap with the spec. Codegraph reported an uninitialized index, so source reads supplied the code map.

## Testing strategy

Use a temporary test-only negative control that omits the second frame: the B-only visibility assertion must fail. Then deliver B and run the complete focused Playwright spec against `npm run build`. No production mutation is needed because the behavior already exists. No unit-test file changes are planned; Vitest cannot prove mounted interactions. The dispatcher owns full-suite regression checks.

## Documentation handoff

No documentation requirement was specified by the ticket. Shared knowledge documentation remains owned by the documentation stage.
