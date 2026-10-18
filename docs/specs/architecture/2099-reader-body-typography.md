# Reader body typography

## Files read

- `src/renderer/src/screens/conversation/conversation.css` → `.markdown-reader__body`, `.bubble__markdown`, `.code-block`: inherited reader typography and shared formatting.
- `src/renderer/src/screens/conversation/MarkdownReader.tsx` → `MarkdownReaderView`: reader reuses `AssistantMarkdown` under the shared Markdown class.
- `src/renderer/src/screens/conversation/MarkdownReader.test.tsx` → `MarkdownReaderView` cases: static markup and reader state coverage.
- `e2e/markdown-reader.spec.ts` → `noteText`, reader round-trip scenario: fake file response and integrated regression location.
- `e2e/markdown-reader-menu.spec.ts` → reader layout cases: existing chrome, scrolling and 16 px rhythm checks.
- `docs/knowledge/features/conversation-shell-markdown-reader.md` and `assistant-markdown-renderer.md`: shared rendering, inherited formatting and measured block spacing.
- `docs/knowledge/features/development-verification.md`: computed geometry requires browser evidence.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=552-2851 and code reference https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=134-4890. The body is a column of Markdown blocks at 16 px spacing, with Roboto body-medium (14/20 px, 0.25 px tracking), On Secondary Container ink, shared outlined code blocks and existing quote/link treatments. Headings belong to the separate heading ticket.

## Change

Change only the reader body's color and four typography tokens from on-surface/body-large to on-secondary-container/body-medium, and update its comment. This is one useful behavior: reader prose matches thread message typography. Shared code, block spacing, chrome and scrolling retain their existing rules. No new state, type, failure mode or consumer update. The sketch and plan estimate about 110 written lines including browser coverage and this plan, within all size ceilings (two observable acceptance criteria). In-flight #2106 changes headings elsewhere in the same stylesheet; the reader body edit is independent and local.

## Testing strategy

Extend the existing reader round-trip scenario with synthetic paragraphs, lists, a table, quote, external link and fence. Before implementation, prove the computed body typography assertion fails on 16/24 px. Afterward, assert 14/20 px and 0.25 px tracking on prose, quote and link, the body color role, code's 12/20 monospace type/outline/radius/copy icon, and measured ordinary-block gaps at 1280 and 800 px widths. Capture the loaded reader at both widths for comparison with Figma. Run `MarkdownReader.test.tsx`, both reader browser specs, pre-verify and the production build on Linux after merging main. No provider behavior changes or live checks are required.
