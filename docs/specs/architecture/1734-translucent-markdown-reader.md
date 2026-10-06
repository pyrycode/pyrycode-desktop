# Translucent Markdown reader header

## Files read

- `src/renderer/src/screens/conversation/MarkdownReader.tsx` → `MarkdownReaderView`, `useMarkdownReader`: existing menu, notices, fetch ownership and cancellation stay intact.
- `src/renderer/src/screens/conversation/conversation.css` → `.markdown-reader`, `.conversation__blur`, `.conversation__covered`: reader geometry and shared masked backdrop samples.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `measureThreadChrome`, covered conversation: precedent for measured CSS clearance; keep the thread and Composer mounted.
- `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx` → `ComposerOptionsMenu`: preserve keyboard focus, dismissal and six existing actions.
- `e2e/markdown-reader.spec.ts`, `e2e/markdown-reader-menu.spec.ts` → fake workspace-file replies, attachment round trip and menu scenarios.
- `e2e/fixtures/capturePairedApp.ts` → `capturePairedApp`: native synthetic captures with retained paths.
- `docs/knowledge/features/conversation-shell-markdown-reader.md` → Pane wiring: hiding rather than unmounting preserves pending uploads.
- `docs/knowledge/features/development-verification.md` → Layout and input: native window size/zoom, positive overlap before real clicks, native capture rather than screenshot protocol.
- Root `CLAUDE.md`, `docs/knowledge/INDEX.md`, shared working practice and visual-review recipe: scope, static renderer tests and evidence requirements.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=756-10358

Read design context and screenshot for `756:10358`. The chat pane has a full-width downward dark-to-transparent header over scrolled Markdown, with sharp Back/title/ellipsis and a divider. Reuse Desktop's shared #09141D gradient, masked 10/8/5/2px backdrop blur tapering to zero and text/glyph shadows, existing tokens and exact existing header glyphs. The frame is scrolled, so retain Desktop's resting first-block position (85px from pane top), 20px horizontal alignment and 16px bottom clearance.

## Context

The reader currently reserves an in-flow band above its scroller. Give it the shared thread treatment without changing Markdown rendering, file security or conversation lifetime. No ADR or documentation requirement is added by this ticket.

In-flight #1726, #1729 and #1778 also edit `conversation.css`; their queued/question/message rules are separate blocks, with no dependency on this layout.

## Design

- Extend the reader overlay to the whole pane. Keep its body as the only scrollport, with horizontal/bottom padding equal to the existing insets.
- Place a fixed `.markdown-reader__chrome` above the body at local level 1; body stays at level 0. Include the current bar and every notice/confirmation in chrome, with the unchanged menu.
- Render the existing decorative `.conversation__blur` layers behind chrome's sharp children. Decorative layers and the chrome wrapper ignore pointers; controls/notices accept them.
- Move only shared treatment variables to `.conversation`, the common ancestor of covered thread and reader. Keep thread height variables on the covered thread.
- Measure chrome's occupied border-box height into `--markdown-reader-header-height` on the reader. Use it as body top padding, with an 85px initial CSS fallback. Preserve the existing bar spacing before notices.
- Constrain this reader's menu to available reader width, allowing its static labels to wrap if needed at minimum width/125% zoom; preserve shared menu logic.

## State + concurrency model

No new store, wire event or async I/O. Two view-local DOM refs support a mount effect that measures immediately, observes chrome resizing, and disconnects on unmount. The observer handles notice appearance/removal, line wrapping, native resize and zoom without React state or Markdown re-renders. Existing reader request correlation, copy timer and pending attachment subscription remain unchanged.

## Error handling

No new failure mode. Existing initial-open, refresh, external-open and save outcomes retain their current handling and client-owned text; copy confirmation stays transient. All visible notices are included in measured clearance. External-open/save proof uses injected renderer bridge failures, never real apps or Downloads.

## Testing strategy

- Add focused fake-transport cases alongside the reader spec: first prove the current layout fails full-pane overlap; assert resting geometry, positive text/header overlap and shared computed gradient/blur/shadow, then actual Back/menu pointer and keyboard input.
- Exercise notices and copy confirmation appearing/disappearing, with measured resting clearance; stub only external-open/save bridge outcomes to safely drive those existing failure paths.
- Use native 1280×800 and 800×600 sizes and Electron 100%/125% zoom; prove first content clears all chrome, menu bounds/labels fit, and final content is reachable. Check conversation scroll/draft/attachments survive Back.
- Run both existing reader/menu browser scenarios and existing MarkdownReader/open/save unit coverage; run pre-verify and build after final main merge.
- Retain resting/scrolled synthetic native captures at both sizes under `/tmp/builder-1734/`, compare with Figma and shared thread treatment, and record revision/results in the PR.

## Open Questions

None. Size recheck: one deliverable, four observable criteria, approximately 400 written lines including plan/tests, zero new exported types/components/stores, zero consumer signature updates and zero new rejection branches; within all limits.
