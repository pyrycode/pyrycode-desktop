# Thread overflow menu above Top overlay pills

## Files read

- `src/renderer/src/screens/conversation/conversation.css` → `.composer-options-anchor--bottom-end` and `.conversation__top-overlay`: both currently use level 1; dialogs use level 2.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ThreadOverflowMenu` and `TopOverlayControl`: the menu precedes the overlay in the shared stacking context.
- `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx` → `ComposerOptionsMenu`: shared bottom-end anchor and existing menu actions.
- `src/renderer/src/screens/conversation/TopOverlay.tsx` → `TopOverlay`: usage and connection pills share one overlay.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`: real pairing/navigation with fake transport and isolated cleanup.
- `e2e/composer-usage-limit.spec.ts` and `e2e/chat-top-bar-geometry.spec.ts`: wire-driven usage notices and existing menu geometry/interaction assertions.
- `docs/knowledge/features/conversation-shell.md` and `docs/knowledge/features/development-verification.md`: overlay ownership and browser hit-testing needed to prove stacking.
- `CLAUDE.md`, agents `docs/working-practice.md`, `builder/ui-work.md` and `docs/visual-review.md`: test, publishing and visual-evidence workflow.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=756-9991. The inspected context and screenshot show the top-right menu icon beside a right-aligned usage/connection pill stack over the thread. Retain the existing menu, pill tokens and geometry; this ticket only corrects their paint order.

## Change

Raise `.composer-options-anchor--bottom-end` from z-index 1 to the existing dialogs level 2 and update its stacking comment, so its popup beats `.conversation__top-overlay` at level 1. No new types, state, failure modes or consumer updates. Remote feature branches checked: no overlap with the planned CSS/spec files. One independently verifiable stacking fix, two acceptance criteria; estimated total written work below 160 lines including plan and regression.

## Testing strategy

- Add `e2e/thread-overflow-overlay.spec.ts` before changing CSS. Inject a usage warning and terminal connection failure through the existing fake transport, open the overflow menu and prove non-empty overlap with each pill. Browser hit-testing at each overlap must target the menu; computed anchor z-index must exceed the overlay. Exercise an overlapping menu item with a real click.
- Run the focused spec against the unchanged CSS to observe the reported failure, then repeat after the fix at 1280×800 and 800×600 window sizes.
- Run `npm run build`; static-render unit tests cannot observe CSS stacking. Capture the integrated menu/pill state under `/tmp/builder-1745/` and compare its relevant geometry and layering with the Figma screenshot.
