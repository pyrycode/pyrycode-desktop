# Shared messaging menu

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` — `ThreadOverflowMenu`, `ThreadOverflowMenuView`, `ConversationScreen`: existing title, trigger and three sheet callbacks.
- `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx` — `ComposerOptionsMenu`, `ComposerOptionsPanel`, `useComposerOptionsClamp`: shared surface, local focus/dismissal state and footer placement measurement.
- `src/renderer/src/screens/conversation/conversation.css` — `.conversation__overflow-rule`, `.composer-options`, `.status-sheet-overlay`: opacity creates the divider's stacking context; sheets currently rely on DOM order.
- `src/renderer/src/screens/conversation/ComposerActionsMenu.tsx`, `ComposerPermissionModeMenu.tsx`, `ComposerModelMenu.tsx`, `ComposerEffortMenu.tsx` — the four existing `ComposerOptionsMenu` consumers retain defaults.
- `src/renderer/src/screens/conversation/composerOptionsKeyboard.ts` — `resolveComposerOptionsKey`: arrows wrap, Enter selects, Space uses native activation, Escape dismisses.
- `src/renderer/src/screens/conversation/ComposerOptionsPanel.test.tsx`, `ConversationScreen.test.tsx` — static surface and collapsed-trigger assertions.
- `e2e/chat-top-bar-geometry.spec.ts` — `primeOverflowingThread`, `wheelThreadToTop`: real scrolling and top-bar geometry; existing checks cannot detect occlusion.
- `e2e/composer-options-clamp.spec.ts`, `e2e/composer-actions.spec.ts` — existing footer clamp and dismissal regression coverage.
- `docs/knowledge/features/conversation-shell-chrome.md` § Structure, `conversation-shell-composer-options-panel.md` — preserve the title's clipping boundary and shared menu interaction.
- `docs/knowledge/features/development-verification.md` § Layout and input — inspect the full stacking arrangement and prove paint order, not visibility alone.

Codegraph context reported an uninitialized index; source searches and reads supplied the consumer inventory.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=121-3879

The Options overlay is a compact dark column with 6px corners, 28px rows, 12px horizontal text insets and body-small Roboto text in Primary. Reuse the shipped panel's tokens, hover and focus treatment with no current-value row.

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=497-1891

The top bar pairs a single title-large line with the existing 24px icon button, followed by a 60% opacity divider and 16px bottom padding. Preserve that layout and glyph; the menu starts at the button's bottom and aligns to its right edge.

## Change

Replace `ThreadOverflowMenuView` and its separate interaction container with a `ComposerOptionsMenu` consumer inside the existing title/divider layout. Keep Channel info, Run configuration and Background tasks in order, dispatching their existing callbacks. Remove the retired view export and duplicate surface CSS; the interaction proof moves to the integrated spec.

Add optional `placement: 'footer' | 'bottom-end'` and `triggerAriaLabel` props to `ComposerOptionsMenu`. Footer remains the default with unchanged upward placement and clamp. A bottom-end anchor does not shrink, and its panel overrides only the placement offsets: top 100%, right 0, left/bottom auto. Its fixed three labels fit within the chat pane at the 800px floor; the footer's shift variable does not affect this right alignment.

Give only the bottom-end anchor stacking level 1 so its complete panel paints above the opacity divider and positioned message descendants. Give `.status-sheet-overlay` level 2, matching existing dialog overlays, so overlay precedence remains explicit. Do not establish a stacking context on the whole header or clip its content row.

State, focus, keyboard handling and listener cleanup stay in the shared menu. No new store, async task, transport/IPC behavior or error mode is introduced. No new diagnostic lifecycle is needed for this presentation fix; existing destination diagnostics remain in place.

## Scope check

One deliverable; four acceptance criteria. Estimate about 400 written lines including plan and tests, two production TypeScript files plus CSS, zero new exported types/components/stores, one production consumer migration and two static view mounts removed, zero new reject branches. This fits the refiner's roughly 450-line estimate. The analogue's implementation at `7532b1a` added 207 lines and deleted 47; its separate plan commit accounts for the remaining estimate. Remote feature branches were refreshed and checked: no overlapping files.

## Testing strategy

- RED first: extend the top-bar spec with `elementFromPoint` checks at the divider intersection, all three rows and panel padding over an overflowing thread, before and after wheel scrolling. The original menu must fail at the divider.
- At 800px and 1280px, prove downward right alignment, window containment, first-row focus, both arrow-wrap directions, Enter/Space activation for the three destinations, Escape focus return and outside/title dismissal.
- Probe sheet and dialog hit order while a menu is open underneath, so raising the menu alone cannot pass.
- Replace obsolete view-only assertions with shared icon-trigger/placement assertions; retain the shared panel's row/current-value tests.
- Run touched Vitest files, `npm run build`, the focused top-bar spec and existing footer Actions/clamp specs. Capture both widths and compare against the Figma images in `/tmp/builder-1542-figma-options.png` and `/tmp/builder-1542-figma-top-bar.png`.

## Open questions

None.

## Documentation handoff

Pending for the documentation stage: update `docs/knowledge/features/conversation-shell-chrome.md` § Structure and `docs/knowledge/features/conversation-shell-composer-options-panel.md` to describe the shared top-bar consumer, its downward placement and corrected stacking; retire the note that the divider defect is pending.
