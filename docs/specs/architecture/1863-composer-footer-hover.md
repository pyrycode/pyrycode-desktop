# Composer footer button hover

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: repository conventions and geometry verification.
- `docs/knowledge/features/conversation-shell-composer.md` and `conversation-shell-composer-message-box.md`: preserve footer shrink policy and focus outlines.
- `src/renderer/src/screens/conversation/conversation.css` → `.composer__footer-button`, `.composer-options-anchor`, `.composer__attach`: shared reset, label clipping and icon geometry.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `Composer`: four text controls and Attach; Run configuration exists only in the thread menu.
- `src/renderer/src/theme/tokens.css`: existing hover colour, 4px spacing and 6px radius tokens.
- `e2e/composer-footer-overflow.spec.ts`, `e2e/fixtures/composerWindowSetup.ts`: synthetic session setup and native window geometry checks.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=840-16115 and https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=840-16155. Read both design contexts and screenshots: the existing text and icons sit above an 8% on-surface hover layer with 6px corners, extending 4px vertically and 6px horizontally for text, 4px on every side for icons. Use `--color-state-hover`, `--radius-xs` and `--space-1`; derive the 6px horizontal inset as 1.5 times the spacing token.

## Change

Add hover-only, absolutely positioned pseudo-elements. Text controls keep their overflow clip: their existing, same-sized `.composer-options-anchor` owns the layer when its direct button is hovered, excluding inert model/effort spans. Attach owns its layer and gains positioning, isolation and visible overflow because its fixed-size icon box never shrinks. Isolate these paint containers and give the layer negative stacking order and no pointer events, keeping it behind the existing content. No padding, borders, margins, sizes or focus selectors change. No new types, state, async work, failure modes or assets. No overlapping in-flight numeric feature branches found. Expected written work including plan and browser proof is under 200 lines, one production file, zero consumer updates and two acceptance behaviours.

## Testing strategy

- First run a new fake-transport `e2e/composer-footer-hover.spec.ts` against the unchanged stylesheet and observe the missing layer fail.
- At native 1280×800 and 800×600, hover Actions, permission, model, effort and Attach; assert layer colour/radius/insets, footer and descendant geometry unchanged, pointer-independent keyboard focus and visible outline unchanged, and the layer disappears on pointer exit. Preserve text-button clipping and exclude inert labels.
- Capture each hover plus keyboard focus in `/tmp/builder-1863/` and compare against both Figma references. Run the existing footer overflow spec to check worst-case shrinking remains intact.
- After final main merge, run pre-verify and build. No live specs changed; full browser/live gates belong to the dispatcher.
