# Message actions do not size text rows

## Files read

- `src/renderer/src/screens/conversation/conversation.css` → `.message-actions`, `.message-row--text`, `.bubble__copy`: stretch the action column without letting its stack establish row height; preserve width, gap, targets and hover paint.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `MessageActions`, `TimelineRow`: delivered user and assistant actions are bubble siblings; queued actions use a separate modifier.
- `e2e/message-side-actions.spec.ts` → `frames`, `geometry`: reuse the fake transport and actual browser layout assertions.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/conversation-shell.md`, `docs/knowledge/features/conversation-shell-message-bubble.md`, `docs/knowledge/features/development-verification.md`: preserve the desktop row contract and use browser geometry rather than static markup to prove sizing.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=132-4225; message actions `808:12242`. Read design context and screenshots for both nodes. Copy sits above reply beside the bubble, with a 12px glyph gap, vertically centered and tinted with `--color-inverse-primary`. Reuse the existing matching glyphs and theme tokens.

## Change

Give delivered `.message-actions` size containment so its contents cannot contribute to the flex row's intrinsic height, while keeping its existing fixed width and stretch alignment. The bubble determines row height; the actions remain vertically centered beside it. Queued actions keep their separate sizing. No new markup, types, state, failure modes or dependencies. The overlapping `feature/suggestion-quieter-tab-sends` branch changes an unrelated composer placeholder block in the stylesheet; edits here stay local. Estimated total written work under 160 lines, zero new exports or updated consumers, two observable acceptance criteria and zero error branches, within all sizing limits.

## Testing strategy

- Add browser geometry coverage beside the existing side-action tests: compare actual short and wrapped user/assistant bubble and row heights and neighbour gaps with and without action buttons, at minimum and wide window sizes.
- Preserve existing centering, glyph gap, target separation, hover and focus checks; capture the delivered short and multi-line rows for Figma comparison.
- Run the focused fake-transport spec, final pre-verify check (typecheck and full unit suite), and production build after merging current main. No live tests change.

## Revisions

2026-10-08: Normal delivered rows on current main already satisfy the geometry comparison because their 80px minimum bubble height exceeds the current action stack. The regression test additionally gives the existing buttons a test-only 60px minimum height to exercise the ticket's taller-than-bubble condition: before containment, short bubbles and rows grow from 80px to 116px. Compare that state, normal controls and hidden controls; restore normal sizing before captures. Wrapped rows must remain unchanged. No production dimensions or design contract change.
