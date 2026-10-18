## Files read

- `src/renderer/src/screens/conversation/conversation.css` → `.bubble__markdown`: shared block gap and direct-child margin reset; metadata and attachments have separate margins.
- `src/renderer/src/screens/conversation/StreamingAssistantMarkdown.tsx` → `StreamingAssistantMarkdown`: fragments keep frozen and pending blocks direct children.
- `src/renderer/src/screens/conversation/MarkdownReader.tsx` → `MarkdownReaderView`: reuses the markdown container.
- `e2e/assistant-whitespace.spec.ts` → `readRhythmMetrics`: measures adjacent blocks and container edges; separate nested measurements retain the 8 px contract.
- `e2e/markdown-reader-menu.spec.ts` → reader menu scenario: loaded note provides real reader layout coverage.
- `docs/knowledge/features/assistant-markdown-renderer.md` → rendering boundary: CSS owns block rhythm; static tests cannot measure layout.
- `docs/knowledge/features/development-verification.md` and root `CLAUDE.md` → focused Linux checks and existing fake Electron fixture.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4443 (Assistant), https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4441 (User). Assistant design context and screenshot show a column with 16 px between content blocks. Map the markdown gap to `--space-4`; the refined ticket explicitly preserves the separate metadata/attachment margins.

## Change

Change the shared markdown column gap from `--space-2` (8 px) to `--space-4` (16 px), and update the nearby spacing comments. Keep zero direct-child block margins, nested list/quote rhythm and metadata/attachment margins. This one independently useful behavior reaches settled replies, streaming fragments and the reader without new types, state, failure modes or consumer changes. No overlapping in-flight branches were found. Estimated total written work: approximately 100 lines, one production file, two acceptance behaviors; all sizing limits hold.

## Testing strategy

- Update the existing settled block-gap measurement to require 16 px and flush edges; retain nested list/quote measurements at 8 px.
- Add a real streaming multi-block measurement and repeat after settlement; measure the loaded reader's blocks and edges.
- Watch focused spacing checks fail at the old 8 px gap before changing CSS.
- Run focused conversation, markdown, streaming and reader renderer tests, pre-verify and build after the final main merge; run only affected spacing/reader e2e scenarios on Linux.
- Capture streaming/settled messages and the reader at 1280×800 and 800×800, then compare with Figma. Screenshots stay under `/tmp/builder-2097/`.
