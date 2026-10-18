# Shared Markdown heading scale

## Files read

- `CLAUDE.md` and `docs/knowledge/INDEX.md`: renderer conventions and owning topic.
- `docs/knowledge/features/assistant-markdown-renderer.md`: shared renderer, descendant styling and static-test limits.
- `docs/knowledge/features/development-verification.md` and `docs/recorded-tests.md`: computed browser evidence and guarded replay.
- `src/renderer/src/theme/tokens.css` → text token families: preserve the general-purpose scale and Roboto-first fallback.
- `src/renderer/src/screens/conversation/conversation.css` → `.bubble__markdown h1` through `h6`: replace only heading typography.
- `src/renderer/src/screens/conversation/StreamingAssistantMarkdown.tsx` → `StreamingAssistantMarkdown`: streaming delegates to the shared renderer.
- `src/renderer/src/screens/conversation/MarkdownReader.tsx` → `MarkdownReaderView`: reader uses the same `.bubble__markdown` container.
- `e2e/assistant-whitespace.spec.ts` → `readHeadingTypeMetrics`, heading and inline-code cases: extend the existing measured regression.
- `e2e/fixtures/capturePairedApp.ts` → `capturePairedApp`: integrated visual evidence.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=892-13442

Read design context and screenshot: a vertical Markdown hierarchy in Roboto, On Secondary Container. H1 is medium 20/28 with zero tracking; H2 medium 18/26 with zero tracking; H3 medium 16/24 with 0.15 tracking; H4–H6 bold 14/20 with 0.25 tracking. The existing renderer and container supply the layout; this slice applies the type scale only.

## Change

Add `--text-markdown-h1-*`, `--text-markdown-h2-*` and `--text-markdown-h4-h6-*` size/line/tracking/weight quartets beside the existing type tokens. Map the shared descendant heading rules to those families and H3 to `--text-title-medium-*`; explicitly use `--font-sans` and `--color-on-secondary-container` for every heading. Preserve general-purpose tokens, heading margins, block gaps, body typography and inline code's monospace family and inherited size. The reader receives the same rules through its existing container without duplicate definitions; reader-specific verification stays with #2100 and margin work with #2107.

One independently useful deliverable: the shared heading scale. Estimate approximately 260 written lines including plan and browser regression, two production files, no new exported types/components/stores, no consumer migration, two acceptance behaviours and no reject branches. Both sketch and written-plan sizing fit the ceilings. Remote feature-branch overlap scan found none.

No lifecycle or identity state changes. Existing stream rendering and settlement remain unchanged; the browser regression measures the same reply before and after settlement and after another delta.

## Testing strategy

- Extend `readHeadingTypeMetrics` and replace the one-level heading case with all six top-level headings and headings nested in a quote and list. Pin literal size/line/weight/tracking values alongside the designated tokens, Roboto-first font stack and On Secondary Container. Measure while streaming, after another delta, and after settlement.
- Update the existing inline-code-in-H2 expectation to the Markdown H2 token and 18px while retaining all monospace/background/wrapping assertions.
- Run the focused Electron whitespace spec after building; capture streaming/settled examples at 1280 and 800 widths under `/tmp/builder-2106/` and compare against Figma.
- Run applicable static renderer units with the pre-verify gate, typecheck/build, docs guard and an affected captured Markdown client scenario through guarded replay. No provider/live test is required; Linux is the verification platform.
