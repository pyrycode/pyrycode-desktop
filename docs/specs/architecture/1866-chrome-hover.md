# Chrome button and pill hover

## Files read

- `src/renderer/src/screens/channels/channels.css` → `.channel-list__menu`, `.channel-list__pair`: fixed 24px controls and existing focus outlines.
- `src/renderer/src/screens/conversation/conversation.css` → `.conversation__overflow-trigger`, `.top-overlay-pill`: bare menu, filled pill variants and unsuppressed native pill focus.
- `src/renderer/src/screens/conversation/TopOverlay.tsx` → `TopOverlay`: actionable repair button, dismissible notices and inert notices.
- `src/renderer/src/theme/tokens.css` → `--color-state-hover`, `--space-1`, `--radius-xs`: existing 8% on-surface paint, 4px inset and 6px corners.
- `e2e/fixtures/launchPairedApp.ts`, `e2e/fixtures/capturePairedApp.ts` → paired fake transport and native captures; `unpair-repair.spec.ts`, `composer-usage-limit.spec.ts`: real mounted pill states.
- `docs/knowledge/features/channel-list.md`, `channel-list-section-header-pair-control.md`, `conversation-shell.md`, `development-verification.md`: preserve toolbar naming/focus and observe confirmed `:hover` together with paint.
- Root `CLAUDE.md`, `docs/knowledge/INDEX.md` and shared working/visual-review practices: scope, test tiers and evidence. QMD search timed out; repository documents supplied the context.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=840-16218, https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=840-9403, https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6618. Design context and screenshots show an 8% on-surface layer with 6px corners: 4px beyond the bare control frame, within the filled pill. Reuse existing glyphs and theme tokens.

## Change

Add a pointer-transparent absolute pseudo-element on hover to the existing chat menu, sidebar menu and add-host buttons. Use their current 24px frame as the reference, matching the menu node's 32px layer, without changing padding, borders, margins or dimensions. Isolate each layer behind the glyph. Add a hover background image over the existing fill of button pills and pills containing a dismiss button; inert notices retain their resting paint. Existing keyboard focus rules and native outlines remain untouched. No new types, state, async work or failure modes. Overlaps with #1658, #1863 and #1864 are in separate blocks and will be kept local. Size: one deliverable, two observable criteria, two production files, approximately 160 written lines including browser coverage and this plan; zero exports or consumer migrations, within all limits.

## Testing strategy

- Add `e2e/chrome-hover.spec.ts` first and observe its missing hover paint failure before changing CSS.
- At 1280px and the 800px minimum, drive hover for each bare control; assert confirmed hover, token paint, 4px extension, 6px corners, pointer transparency and unchanged control/glyph/toolbar geometry.
- Deliver a dismissible usage warning and pairing rejection through fake transport. Assert both pill fills survive beneath the hover image, inert notices have no hover layer, and pill geometry remains fixed.
- Drive keyboard modality and confirm bare controls retain their 1px outline and pills retain their native focus outline. Capture integrated hovered states for comparison with Figma.
- After the final merge of main, run pre-verify, build and the focused fake-transport spec. No live tests change.

## Revisions

2026-10-07: Visual comparison showed that isolating Pair new host trapped its existing fixed name pill beneath the conversation chrome. Sidebar layers now paint before relatively positioned glyphs in source order, without creating a stacking context; the chat menu retains isolation because it has no fixed name pill. This preserves the tooltip's existing stacking contract.
