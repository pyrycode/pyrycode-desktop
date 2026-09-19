# Composer status spacing

## Files read

- `src/renderer/src/screens/conversation/conversation.css` — `.conversation__thread`, `.composer-status`, `.composer`: the current 12px lower inset scrolls; the status row reserves 24px and the composer supplies 8px below it.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` — `ConversationScreen`, `ComposerStatusArea`, `ComposerSlot`, `useThreadScrollPin`: the status row is outside the timeline scrollport; scroll anchoring may temporarily set bottom padding.
- `src/renderer/src/theme/tokens.css` — `--space-3`: existing 12px spacing token.
- `e2e/composer-usage-limit.spec.ts` — `rateLimitedFrame`: real fake-transport warning delivery and the 800px window check.
- `e2e/thread-scrollbar.spec.ts` — `buildReplyFrames`: seed enough distinct turns to exercise scrolling.
- `e2e/chat-top-bar-geometry.spec.ts` — bottom-row geometry assertion: preserve the existing 12px separation at the bottom.
- `e2e/fixtures/launchPairedApp.ts` — `launchPairedApp`: isolated Electron fixture and fake daemon.
- `docs/knowledge/features/conversation-shell-composer-status-row.md` — “Composer status row”: keep the row's reserved height and DOM order.
- `docs/knowledge/features/development-verification.md` — “Layout and input”: measure actual scrollport boxes; static renders cannot prove layout.

Codegraph was unavailable (index not initialized); source reads supplied the code map.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=102-4

Read design context and screenshot: the chat column places the clipped Message area above the Input area's status row with a 12px section gap. The Input area keeps its own 8px vertical gap, with the small snowflake on the left and warning/error content on the right. Reuse `--space-3`; existing colours, typography and icons remain appropriate.

## Change

Move the thread's 12px bottom padding to `margin-top: var(--space-3)` on `.composer-status`. This places the gap outside the scrollport while retaining the same last-message separation at the bottom, the status row's height and the composer's existing lower spacing. Update the directly affected CSS comments. No state, interfaces, async work, failure modes or lifecycle logging changes.

Size check: one deliverable, one production stylesheet (zero TypeScript production files), approximately 170 total written lines including this plan and browser proof, zero new exports, zero changed consumer call sites, two acceptance criteria, zero reject branches. This agrees with the refiner's under-ten-line production estimate. Refreshed remote feature branches: no overlap in the stylesheet or new spec.

## Testing strategy

Add `e2e/composer-status-spacing.spec.ts` before changing CSS and observe the zero-gap failure. Seed an overflowing timeline through the fake daemon, measure the 12px viewport-to-status gap at the bottom and after a wheel scroll, and preserve the 8px status-to-input gap. Repeat with a usage warning and five-line draft at 1280px and the 800px minimum width. Capture both scroll states for visual comparison with Figma. Run the focused spec after `npm run build`; run the existing conversation renderer unit coverage. The dispatcher owns full-suite verification.

## Documentation handoff

No documentation-only acceptance criteria or explicit documentation changes were requested. Shared reference documentation remains owned by the documentation stage.
