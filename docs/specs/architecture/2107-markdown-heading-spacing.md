# Markdown heading spacing (#2107)

## Files read

- `src/renderer/src/screens/conversation/conversation.css` → `.bubble__markdown`: direct blocks use a 16 px flex gap and zero margins; nested list/quote children use 8 px margins.
- `src/renderer/src/screens/conversation/AssistantMarkdown.tsx` → `AssistantMarkdown`: emits direct block elements without a wrapper.
- `src/renderer/src/screens/conversation/StreamingAssistantMarkdown.tsx` → `StreamingAssistantMarkdown`: shares the block container across frozen and pending content.
- `src/renderer/src/theme/tokens.css` → spacing tokens: `--space-3/4/5` supply 12/16/20 px.
- `e2e/assistant-whitespace.spec.ts` → `readRhythmMetrics`: measures rectangles, edges and computed gap in settled/streaming replies.
- `e2e/markdown-reader-menu.spec.ts` → reader menu scenario: existing shared-style heading gap expectation changes to 12 px.
- `docs/knowledge/features/assistant-markdown-renderer.md` and `development-verification.md`: static markup cannot prove layout; use measured rectangles with nonempty element counts.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, shared scope/working/visual/UI guidance: repository boundaries and Linux verification requirements.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=883-13431

The inspected screenshot shows prose followed by a heading and body copy in one reply column. The frame's 16 px rhythm plus 4 px heading-block inset gives 20 px before; its inner gap gives 12 px after. Reuse spacing tokens and existing components; typography belongs to #2106.

## Change

Keep the 16 px flex gap and zero direct-child margins. At a non-heading → H1–H6 boundary, add `--space-5 - --space-4` to the heading's start margin. At an H1–H6 → non-heading boundary, add `--space-3 - --space-4` to the following block's start margin. Direct-child adjacent-sibling selectors leave heading pairs, outer edges, heading-only messages and nested rhythm unchanged. The shared reader inherits the rule. No state, types, failure paths, typography or other spacing changes. In-flight #2106 overlaps the CSS and whitespace spec in separate typography blocks; keep edits local. One independently verifiable behavior, estimated ≤220 written lines, zero new exports/call-site migrations, two acceptance criteria, zero error branches.

## Testing strategy

- Update existing settled/streaming whitespace and reader-menu measured gap expectations.
- Add a measured fake-transport case beside the whitespace cases: all six levels between non-heading blocks, adjacent headings, first/last and heading-only edges, nested list/quote headings; check active streaming, appended content and settlement at 1280×800 and 800×800 windows.
- Observe the new measured test fail against the old CSS before implementation. Build before Electron checks; run the affected whitespace and reader-menu scenarios plus existing AssistantMarkdown/StreamingAssistantMarkdown renderer checks through pre-verify after the final merge of main.
- Capture synthetic streaming/settled replies to `/tmp/builder-2107/`, inspect against Figma, and report paths and viewport sizes in the PR. Linux only; no provider/live behavior changes.

## Revisions

2026-10-18: The combined browser run passed 17 cases but the new case lost its Electron main evaluation context during one of 42 window resize calls (`/tmp/builder-2107/final/`). Parameterize the new regression by viewport and resize once per launch, retaining every level, nested case and streaming/append/settlement assertion at both widths. Production design is unchanged.
