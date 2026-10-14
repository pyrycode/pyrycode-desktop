# Message action hover

## Files read
- `src/renderer/src/screens/conversation/conversation.css` → `.bubble__copy`: shared button hit target and keyboard outline.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `MessageActions`: reply also uses `.bubble__copy`; existing glyphs match the design.
- `src/renderer/src/theme/tokens.css` → `--color-state-hover`, `--space-1`, `--radius-xs`: existing hover fill, 4px spacing and 6px radius.
- `e2e/message-side-actions.spec.ts` → `geometry`, `frames`: fake-transport layout and focus coverage to extend.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/conversation-shell.md`, `docs/knowledge/features/conversation-shell-message-bubble.md`, `docs/knowledge/features/development-verification.md` → static tests cannot establish hover or geometry; hit targets exceed glyph widths.

## Design source
Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=840-16132 — copy and reply retain their existing glyphs and ink; only the hovered button gains a `--color-state-hover` rectangle with `--radius-xs` corners extending 4px past its glyph.

## Change
Make `.bubble__copy` a positioned, isolated paint container and add a hover-only background pseudo-element behind its glyph. Existing targets have 4px vertical and 8px horizontal padding: inset the layer 0 vertically and `--space-1` horizontally to paint exactly 4px around the glyph without changing padding, margins, borders, sizing or keyboard outlines. Reply inherits this rule. No state, types, async work or failure modes change. Feature #1863 also touches `conversation.css`, but only composer footer rules; keep this edit local and build through the overlap. One observable hover behavior plus focus preservation; under 150 written lines, zero exports, zero consumer migrations and zero error branches, within all sizing ceilings.

## Testing strategy
Add a focused scenario beside existing side-action geometry coverage; first run it against unchanged CSS and require the hover-layer assertion to fail. For user and assistant rows, hover each button, assert token fill and 4px glyph-relative layer bounds, ensure the sibling stays transparent and row/button/glyph boxes do not move, then leave and verify the layer disappears. Reach both buttons with Tab and verify the existing outline style, width, color and radius remain unchanged without a hover layer. Capture both hover states and focus at 800px and 1280px widths and compare with Figma. Run the focused spec, pre-verify check and build after merging main.
