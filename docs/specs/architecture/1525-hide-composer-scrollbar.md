# Hide the overflowing composer scrollbar

## Files read

- `src/renderer/src/screens/conversation/conversation.css` → `.composer__input`, `.conversation__thread` — five-line cap and existing hidden-scrollbar treatment.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `Composer` — native textarea owns editing and scrolling.
- `e2e/composer-message-box.spec.ts` → `expectBoxHeight`, `draftOfLines` — existing growth, overflow and caret coverage.
- `e2e/thread-scrollbar.spec.ts` → `scrollbarWidthOf` — computed-style detector and superseded composer expectation.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp` — integrated fake-transport fixture.
- `docs/knowledge/features/conversation-shell-composer-message-box.md` § “The box grows with the draft, to a five-line ceiling (#1056)” — caret visibility allows less than one line below the fold; previous visible-scrollbar decision is superseded.
- `docs/knowledge/features/development-verification.md` § “What each test tier proves” — static renders cannot prove CSS or interaction.

CodeGraph context was unavailable (index not initialized); repository search supplied this map.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=347-5408

The input area stacks status, attachments, a rounded translucent message box with an inset send icon, and a compact footer. `Composer` already expresses its body-medium typography and theme-token colors; the screenshot has no scrollbar, and the ticket defines overflow behavior beyond this one-line reference.

## Change

Apply the thread's `scrollbar-width: none` and separate `::-webkit-scrollbar { display: none; }` treatment to `.composer__input`. Preserve native overflow, field sizing and the five-line maximum. Update only superseded scrollbar comments and test expectations. There are no new types, state, async tasks, error branches or lifecycle logging events.

Size check: one deliverable, one stylesheet, fewer than 10 production CSS lines, approximately 130 total written lines including tests and this plan, zero exports or consumer changes, two acceptance criteria, zero error branches. The remote feature-branch overlap check found no conflicts for the three planned source/test files.

## Testing strategy

Extend the existing composer overflow test first and observe RED on the computed scrollbar width. Check `none` both at rest and during overflow; retain growth/caret assertions, and drive wheel scrolling in both directions, small pixel deltas and keyboard editing at both ends. Update the thread test's composer expectation to `none`, retaining the sidebar's `auto` control. Run both focused Playwright specs against the built app and `npm run build`; static Vitest markup cannot observe this CSS-only change. Capture the overflowing composer in the fake app and compare with Figma. Read the host scrollbar preference to record whether the run exercises always-visible system scrollbars; physical trackpad momentum remains a manual input check.

## Documentation handoff

Pending documentation stage: update `docs/knowledge/features/conversation-shell-composer-message-box.md` § “The box grows with the draft, to a five-line ceiling (#1056)” to replace the visible-scrollbar decision with hidden scrollbar paint while retaining native scrolling and the five-line height cap. The ticket names no additional documentation requirement.
