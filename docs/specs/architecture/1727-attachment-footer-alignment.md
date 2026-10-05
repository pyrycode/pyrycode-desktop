# Attachment footer alignment (#1727)

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: repository conventions and rendered-layout verification boundaries.
- `docs/knowledge/features/conversation-shell.md`, `conversation-shell-composer.md`, `conversation-shell-composer-message-box.md`: footer ownership, snapshot prerequisites, and the existing narrow-width shrink policy.
- `src/renderer/src/screens/conversation/conversation.css` → `.composer__footer`, `.composer__footer-button`, `.composer__attach`: current spacing, shared reset, and fixed trailing alignment.
- `src/renderer/src/theme/tokens.css` → spacing tokens: existing 4, 12, 16, and 24 px values.
- `src/renderer/src/screens/conversation/ComposerAttach.tsx` → `ComposerAttachButton`: existing 11 × 12 px paperclip, accessible name, and attach callback.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `Composer`: inline settings, context reading, and sole trailing Attach control.
- `e2e/composer-footer-overflow.spec.ts`, `e2e/composer-attach.spec.ts`, `e2e/fixtures/launchPairedApp.ts`: worst-case minimum-width layout and existing native-picker cancellation drive.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=347-5408 (design context and screenshot read 2026-10-05). The footer is a 20 px row with 4/16/0/12 px top/right/bottom/left padding; Attach is a 24 × 16 px box with the existing primary-colour 11 × 12 px paperclip at its top right. Existing body-small inline settings stay; the context circle is outside this ticket.

## Change

Use border-box sizing on `.composer__footer` so its declared 20 px height includes the new top padding, align its children at the top, and apply the asymmetric padding through existing spacing tokens. Give `.composer__attach` token-based 24 × 16 px dimensions and top-right flex alignment, retaining its auto left margin, fixed flex size, shared reset, glyph, and callback. Update only comments describing the replaced geometry. There is no new state, type, failure mode, or asynchronous work. Remote feature branches checked after fetching: no overlap with the stylesheet or focused footer spec. One deliverable; estimated total written work under 200 lines, zero exported surfaces or consumer updates, two acceptance behaviours, and zero error branches.

## Testing strategy

- Extend `e2e/composer-footer-overflow.spec.ts` before changing CSS: assert footer padding/20 px outer height, Attach 24 × 16 px box, paperclip 11 × 12 px size, top/right offsets, and 16 px trailing inset at default and minimum widths.
- Wait for the window's actual resized width before reading the minimum-width geometry; retain worst-case labels and existing overflow/order checks. Verify keyboard reachability and Attach opening a cancelled native picker at minimum width.
- Capture the integrated footer at Figma's 785 px logical width and at the 800 px minimum window; compare only the footer padding and Attach geometry against the inspected screenshot. Keep evidence under `/tmp/builder-1727/`.
- Run `ComposerAttach.test.tsx`, the focused footer Playwright spec, and `npm run build`. The dispatcher owns the full suites.
