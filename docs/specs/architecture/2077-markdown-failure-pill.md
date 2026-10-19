# Markdown link failure pill

## Files read

- `CLAUDE.md` and `docs/knowledge/INDEX.md`: renderer boundaries and owning feature map.
- `docs/knowledge/features/conversation-shell.md` and `conversation-shell-markdown-reader.md`: reader state remains screen-local; every open clears the failure and conversation remount drops it.
- `docs/knowledge/features/development-verification.md`: static rendering proves presentation; Playwright proves interaction and geometry.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ConversationScreen`, `TopOverlayControl`: existing closed-reader notice and overlay wiring.
- `src/renderer/src/screens/conversation/TopOverlay.tsx` → `TopOverlay`: existing Error treatment and empty-overlay guard.
- `src/renderer/src/screens/conversation/MarkdownReader.tsx` → `useMarkdownReader`, `markdownReaderReducer`, `MARKDOWN_OPEN_FAILED_NOTICE`: unchanged notice ownership, lifetime and client copy.
- `src/renderer/src/screens/conversation/conversation.css` → `.conversation__top-overlay`, `.top-overlay-pill--error`: existing floating stack and theme tokens, reused unchanged.
- `src/renderer/src/screens/conversation/TopOverlay.test.tsx` → `render`: static presentation coverage to extend.
- `e2e/markdown-reader.spec.ts` → existing reader round-trip scenario: failure assertions to move to the pill and extend for coexistence, geometry and conversation departure.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4171 and https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6617 (design context and screenshots read).

The top overlay is an absolute, right-aligned column of compact rounded pills. Reuse the existing Error pill's error-container/error colors, body-small typography, spacing and shadow; the Markdown failure has no X or other asset.

## Change

Remove the closed-reader failure band from the conversation's top chrome. Pass `reader.state.type === 'closed' && reader.state.notice` through `TopOverlayControl` to an optional boolean `markdownOpenFailed` prop on `TopOverlay`; include it in the empty-overlay guard and render the existing `MARKDOWN_OPEN_FAILED_NOTICE` in one Error pill with `role="status"` (implicit polite announcement), without a dismiss control. The existing reader reducer, request identity, subscriptions and conversation-remount behavior stay unchanged. Refresh failures inside an open reader remain outside this change. Remote branch overlap check found none. One deliverable, two acceptance behaviors, approximately 25 production lines plus fewer than 180 test/plan lines, no new exported types/components/state/error branches, and one production call chain: all sizing limits hold.

## Testing strategy

- First extend `TopOverlay.test.tsx` and observe failure before implementation: exact client copy, Error treatment, polite status, no X, empty state and coexistence with usage/repair pills.
- Extend `e2e/markdown-reader.spec.ts`'s existing failure assertion to locate the Error pill, check exactly one notice and no band/path/reason, and measure unchanged thread/composer boxes. Push a usage warning and check both notices coexist. Capture the integrated state at 1100×800 and 800×600 for comparison with Figma.
- The same Playwright scenario covers repeated failed opens, next-open clearing and leaving/reopening the conversation without stale feedback. Existing reducer tests continue to cover stale outcomes; no lifecycle implementation changes are planned.
- After the final merge of main: pre-verify check, build and the focused reader Playwright spec on Linux. No live provider behavior changes; no recorded-client scenario is modified.
