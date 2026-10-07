# Queued message action restyle

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/conversation-shell.md` and `conversation-shell-conversation-and-modals.md` → renderer conventions and the two separate queue/echo removal clocks; preserve those behaviours.
- `docs/knowledge/features/development-verification.md` → static markup cannot prove layout or interaction; use the existing fake Electron fixture.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `TimelineRow`, `QueuedRowSendNow`, `QueuedRowDrop`, `MessageActions` and `ComposerSendControl`: existing action gates, callbacks and glyph idioms.
- `src/renderer/src/screens/conversation/conversation.css` → `.message-actions`, `.bubble__copy` and `.message-row--queued`: shared column, hover paint and current row-level dimming.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → merged queued-row suite: static availability, order, disabled state and delivered-row exclusion.
- `e2e/queued-send-now.spec.ts`, `e2e/queued-backlog-interrupt.spec.ts`, `e2e/message-side-actions.spec.ts` → frame/echo semantics and geometry regressions.
- `src/renderer/src/theme/tokens.css`, `package.json` → existing spacing, tint, hover and radius tokens; no new dependency.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=847-14138; integrated row `847:14149`, hover variants `847:14124` and `847:14133` read through Figma MCP with screenshots.

Send now sits above Cancel in a centred column left of the bubble, 12px from it. Both 12×12 glyphs use `--color-inverse-primary`; their top edges are 25px apart. Each hovered control alone paints `--color-state-hover` with `--radius-xs` and 4px outward glyph coverage. Preserve the ticket's 50% bubble opacity over Figma's 60% sample.

## Change

Wrap the existing queued controls in a queued variant of `.message-actions`, keeping their callbacks, accessible names, disabled conditions and `midTurnInput` gate. Use exact local Figma glyph assets with current-colour masks, matching the normal composer circular send-chevron and the uncircled modal X. Share the existing `.bubble__copy` button/hover/focus treatment through CSS selectors, retaining the controls' existing class names. Make the row gap apply to queued text rows too, size the queued column to 12px, and give it a token-derived 13px glyph gap (25px top-edge spacing) without changing sent actions. Move opacity from `.message-row--queued` onto its direct bubble child so controls and hover layers remain fully opaque. No state, async task, wire contract, failure mode or logging changes.

Prerequisites #1862 and #1864 / PR #1870 are merged. In-flight #1866 edits different CSS blocks; the suggestion branch edits composer-only blocks. Keep shared-file edits local.

Sizing: one presentation deliverable, about 350–400 written lines including tests/assets/plan, zero new exports, two control render sites, five observable acceptance criteria, zero new reject branches. Within all builder boundaries.

## Testing strategy

- First add static assertions that both queued controls share a column and carry 12px glyph elements; watch them fail before implementation. Retain availability, disabled state and delivered exclusion coverage.
- Add focused fake-transport geometry/hover/focus coverage beside the existing Send now test at 800 and 1280 widths, with short and wrapping messages. Assert column/glyph dimensions, centring, 25px spacing, 12px bubble gap, containment, bubble-only opacity, unchanged tint and geometry, per-control hover paint and keyboard outlines. Capture synthetic rest/hover/focus states for visual comparison.
- Update the obsolete queued expectations in `message-side-actions.spec.ts` and run it, `queued-send-now.spec.ts` and `queued-backlog-interrupt.spec.ts`.
- After the final main merge run pre-verify and `npm run build`. No live test is written or changed; the dispatcher owns its broader gate.
