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

## Revisions

2026-10-05 — PR #1762 verifier rework concerns the intermittent `local list read failures stay beside the saved host` test in `e2e/chat-history-recording.spec.ts`, rather than a footer mismatch. The original gate failed during main-process `app.evaluate` when installing the storage-error handler; its launch-fate report recorded a running app, clean exit and no teardown failures. The named spec, main composition root and pairing fixture are unchanged against `origin/main`. Playwright's `ElectronApplicationDispatcher.evaluateExpression` uses the Node Electron handle, and its Chromium `rewriteError` maps non-JavaScript, non-closed-session evaluation errors to the generic navigation message. That message alone cannot establish renderer navigation or a product crash. Keep the footer contract unchanged, repeat the named check without retries on a private Xvfb display, and request a fresh dispatcher gate. Do not add speculative timing guards or weaken storage assertions.

Rework validation on `a7a59ef4`: 30 selected, 30 executed and passed, zero skips/retries, using a private Xvfb display. Evidence: `/tmp/builder-1727/rework-storage-repeat.json` and `rework-storage-repeat.log`. No reproduction or causal defect established; the original failure remains undiagnosed. The verifier's earlier unchanged-PR full reproduction passed 263 tests with four skips; its baseline passed this named test and 20 isolated repeats. These passes do not prove a pre-existing main failure or resolve the intermittent cause. The dispatcher owns the fresh full gate after this rework push. Remote feature branches refreshed and checked: no overlap with the footer stylesheet or focused footer spec.

## Documentation handoff

- Pending documentation stage: `docs/knowledge/features/conversation-shell-composer-message-box.md`, `Composer footer row (#811)` and `Footer row shrink policy (#1107)` — record the revised Figma source, 4/16/0/12 px padding, top alignment and 20 px border-box height, retaining inline controls and narrow-width shrink policy.
- Pending documentation stage: `docs/knowledge/features/composer-attach.md`, `CSS` and `Testing` — record the 24 × 16 px visual box and top-right 11 × 12 px paperclip, plus expanded geometry, keyboard/picker coverage and reviewed captures.
