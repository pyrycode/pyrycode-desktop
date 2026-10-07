# Sidebar row control hover

## Files read

- `src/renderer/src/screens/channels/channels.css` → row control selectors: existing hit boxes, focus outlines and fixed name pills.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `HostRow`, `WorkspaceRow`, conversation controls: centred 14px pens, 16px pluses and 12px row glyphs.
- `src/renderer/src/theme/tokens.css` → hover colour, spacing and radius tokens.
- `e2e/sidebar-control-name-pill.spec.ts` and `e2e/sidebar-host-row-control-name-pill.spec.ts` → pointer/focus regression patterns.
- `docs/knowledge/features/channel-list.md` and `development-verification.md` → host-first sidebar; browser tests prove hover/layout, static markup cannot.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=399-918 and https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=841-9533. The edgeless controls gain a rounded on-surface state layer behind their existing glyph over the row fill. Use `--color-state-hover` and `--radius-xs`; the ticket pins 4px extension on each side, overriding the contextual node's scaled 20% inset.

## Change

Add an absolute, non-interactive `::before` on each of the eight named controls' own hover, centred on its glyph and sized to glyph + twice `--space-1`. Position the existing SVG above the layer without changing its box. No button size, padding, border, margin, row reveal, focus rule or pill rule changes. No new types, state or failure modes. The host-add and workspace controls are retained CSS surfaces but absent from the current host-first sidebar; cover their styles without restoring those actions. Branch #1658 overlaps only in create-channel dialog styles, so this additive change proceeds independently. One deliverable, two observable criteria, no consumer migrations or exported surfaces; CSS, browser test and plan remain comfortably below 800 lines.

## Testing strategy

Add a focused fake-transport Playwright regression beside the existing name-pill specs: actual row/control hover, layer colour/radius and glyph-relative geometry, unchanged row/button/SVG boxes, no layer on keyboard-only focus, unchanged outline and pointer-following pill. Exercise dormant CSS classes on equivalent existing glyph controls in the test only. Capture hovered controls at 1280×800 and 800×600 and compare with Figma. First run the regression against existing CSS and require failure on the missing layer. Then run the focused spec, pre-verify and build after the final main merge. No live-Claude test changes.

## Revisions

2026-10-07: The completion run also found branch #1866 overlapping in `channels.css`. Its toolbar-control hover rules affect separate selectors and a separate block; this row-control design remains independent and unchanged.
