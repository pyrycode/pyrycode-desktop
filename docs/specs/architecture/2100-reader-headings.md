# Reader heading presentation

## Files read

- `src/renderer/src/screens/conversation/MarkdownReader.tsx` → `MarkdownReaderView`: renders `AssistantMarkdown` under `.bubble__markdown`; measured chrome supplies scroll-body clearance.
- `src/renderer/src/screens/conversation/conversation.css` → `.bubble__markdown` heading selectors and `.markdown-reader__body`: shared scale and sibling spacing already reach the reader; no interference found.
- `src/renderer/src/screens/conversation/MarkdownReader.test.tsx` → `MarkdownReaderView` suite: add all six semantic heading levels beside the loaded-note assertion.
- `e2e/markdown-reader.spec.ts` → `readReply`, `buildReplyFrames`: reuse verified fake file delivery and the real reader opening path for computed styles and rectangles.
- `e2e/fixtures/capturePairedApp.ts` → `capturePairedApp`: integrated synthetic screen evidence.
- `docs/knowledge/features/assistant-markdown-renderer.md` → Heading typography / Configuration and usage: shared rules intentionally cover the reader without duplication.
- `docs/knowledge/features/conversation-shell-markdown-reader.md` → Body typography / Pane wiring: inherited body tokens and fixed-bar measurement differ from reply ancestry; browser proof is necessary.
- `docs/knowledge/features/development-verification.md` → Source and contract checks / Replay native storage prerequisite: finish pre-verify before Electron preparation.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=552-2404 (reader), https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=892-13442 (scale), https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=883-13431 (spacing). Read design contexts and screenshots. The existing fixed-bar reader shows Roboto headings in On Secondary Container (`--color-on-secondary-container`): H1 500 20/28, H2 500 18/26, H3 500 16/24, H4–H6 700 14/20; tracking 0/0/0.15/0.25 px. Heading blocks have 20 px before and 12 px after next to prose, keeping the ordinary 16 px rhythm between adjacent headings.

## Change

Confirm the reader's single heading presentation contract with tests only. The merged shared rules already implement the design, so add no reader heading CSS. Extend the static reader suite with H1–H6 markup under its existing wrapper. Allow the local fake file-response helper to accept synthetic text, then add one reader browser scenario measuring every level and its neighboring block rectangles at native window widths 1280 and 800. Compare a first heading against a separately fetched first paragraph at scroll top using their distance from the fixed chrome's bottom. Include adjacent H1–H6 to retain 16 px gaps and capture the loaded heading view at both widths. No production state, types, asynchronous jobs, failure modes or call-site migrations change.

One useful behavior slice: reader heading presentation, verified through semantic markup and mounted typography/geometry. Estimate remains XS: approximately 180–220 written lines including this plan, zero production files, zero exported symbols, zero consumer migrations, two acceptance criteria, zero new rejection branches. In-flight remote feature-branch scan found no overlaps with the candidate files.

## Testing strategy

- `npm test -- src/renderer/src/screens/conversation/MarkdownReader.test.tsx`: all six heading tags inside the loaded reader's shared Markdown wrapper.
- `e2e/markdown-reader.spec.ts`: real reader open/file delivery, literal computed family/size/line-height/weight/tracking/ink, 20/12 boundaries for every level, 16 px adjacent headings, and equal first-block clearance at scroll top at 1280 and 800 px. Existing reader scenarios remain unchanged.
- Since the requested behavior is already implemented, new assertions may pass immediately. Prove the browser detector rejects a temporary page-only style perturbation, remove that perturbation, and run the clean scenario. No production mutation is needed to manufacture a failure.
- Final merge of main, pre-verify with the affected unit file, `npm run build`, then Electron native preparation and the affected browser spec on Linux. Capture and inspect `/tmp/builder-2100/reader-headings-{1280,800}.png` against Figma. No provider/live acceptance is required for presentation.
