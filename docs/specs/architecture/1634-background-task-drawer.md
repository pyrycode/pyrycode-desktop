# #1634 — the background-task panel opens as a non-modal drawer beside the thread

## Files read

- `src/renderer/src/screens/conversation/BackgroundTaskPanel.tsx` → `BackgroundTaskPanelView`, `BackgroundTaskPanel` — the view's header already says only the outermost wrapper is chrome; the container owns the Escape listener.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ConversationScreen` (`panelOpen` state, the `ThreadOverflowMenu` item, the `.conversation__message-area` block), `ComposerTaskCount`, `ComposerErrorSlotControl`, `Composer`'s `handleKeyDown` (#1072 Escape), `ComposerSendButton` (second Escape binding).
- `src/renderer/src/screens/conversation/composerSend.ts` → `shouldInterruptOnKeyDown` — the one decision both composer Escape bindings consult; the drawer consults it too.
- `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx` → `ComposerOptionsMenu`'s `handleKeyDown` — the options overlay dismisses on Escape through a React handler on its anchor.
- `src/renderer/src/PairedShell.tsx` → `PairedShellView` (`paneKey` keys `ConversationScreen`), `PairedShell` (`paneKey` state).
- `src/renderer/src/screens/conversation/conversation.css` → `.conversation__message-area` (position: relative, the drawer's containing block), `.status-sheet*` (chrome being dropped), `.composer-status__tasks` (the pill), `.markdown-reader__title` (precedent: Figma Primary Fixed text maps to `--color-on-primary-container`, same #cfe4ff).
- `src/renderer/src/components/Modal.tsx` + `assets/modal-close.svg` — the Figma `circle-xmark-solid` close glyph already exists as an asset.
- `e2e/escape-interrupt.spec.ts`, `e2e/background-task-finished-count.spec.ts`, `e2e/chat-top-bar-geometry.spec.ts` — running-turn drive, roster frames, and the existing `getByRole('dialog', { name: 'Background tasks' })` locators the drawer must keep satisfying.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=565-2519 (drawer node 565:2966), pill states https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=566-2638, notes https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=566-2659

A 360-wide column pinned to the right edge of the message area, exactly its height (top under the header rule, bottom 12px above the status row), floating over the thread: `--color-on-primary-fixed` fill, 1px `--color-primary-container` border, `--radius-xs`, the Default shadow (`--shadow-thread`, 0 4 5 black 20%), 20px padding, 16px gap. Header row: "Background tasks" in title-medium, `--color-on-primary-container` (Figma Primary Fixed, same value), and a 20×20 circle-xmark close; under it a 1px `--color-inverse-primary` rule at 60%; then the body, which scrolls. The pill gains a 1px `--color-primary` outline while open. The list redraw inside the body (groups, status tags) is the follow-up ticket and is out of scope.

## Context

`BackgroundTaskPanelView` borrowed the modal `.status-sheet-overlay` chrome as an interim look. #580's drawing is a non-modal drawer, so the chrome swaps, the pill becomes the toggle, the open state moves above the per-conversation remount, and Escape is arbitrated so one key press does one thing. No ADR needed.

## Design

1. **Drawer chrome (`BackgroundTaskPanelView`).** The outer wrapper becomes `<section className="background-task-drawer" role="dialog" aria-labelledby=…>` — a *non-modal* dialog: no `aria-modal`, no scrim, no handle, no `.status-sheet*` class. `role="dialog"` stays so the existing e2e locators by role and name keep working. Children: `.background-task-drawer__header` (title `<h2>` with the existing id, close `<button aria-label="Close">` wrapping the `modal-close.svg` `<img alt="">`), `.background-task-drawer__rule` (aria-hidden), `.background-task-drawer__body` (the unchanged list and branch markup). Props unchanged.
2. **Escape arbitration.** A new exported pure predicate in `BackgroundTaskPanel.tsx`:
   `drawerClosesOnKeyDown(keystroke: { key; shiftKey; isComposing }, target: { inComposerStop: boolean; turnRunning: boolean }): boolean`
   — true for Escape, except while composing (IME), and except when the focus is one of the two #1072 bindings (`.composer__input`, `.composer__send`) and `shouldInterruptOnKeyDown(keystroke, turnRunning)` says the composer will stop the turn.
   The container `BackgroundTaskPanel` registers a **capture-phase** `document` keydown listener. When the predicate is true it calls `onClose()` and `event.stopPropagation()`. A capture listener on `document` runs before React's root listener, so no React handler (options overlay, type-ahead, composer) and no bubble-phase document listener sees that key press. When the predicate is false the event goes on untouched, so the composer stops the turn and the drawer stays open. The container gains a `turnRunning: boolean` prop.
3. **Open state lifted.** `PairedShell` holds `backgroundTasksOpen` in `useState(false)` beside `paneKey`. `PairedShellView` gains two optional props, `backgroundTasksOpen?: boolean` and `onBackgroundTasksOpenChange?: (open: boolean) => void`, and forwards them to `ConversationScreen`, which gains the same two optional props. When the props are absent, as in a bare `<ConversationScreen />` in tests, the screen falls back to its own `useState`. That keeps every existing render site unchanged. Unpairing unmounts the shell and resets the state. Going back to the list keeps it, which is the same rule as a switch.
4. **Placement.** The drawer renders as the last child of `.conversation__message-area`, after `TopOverlayControl`, instead of after the sheets. It is covered by the markdown reader, like the rest of `.conversation__covered`.
5. **Pill toggle.** `ComposerTaskCount({ count, onToggle, open = false })`: the class becomes `composer-status__tasks composer-status__tasks--open` only while `open`, and `aria-expanded` renders only while open, so the closed markup is byte-identical to today. `ComposerErrorSlotControl` gains `backgroundTasksOpen` and replaces `onOpenBackgroundTasks` with `onToggleBackgroundTasks`. The More actions item still sets the state to open, and close sets it to closed. I rename `onOpen` to `onToggle` because it now flips the state. The five existing `ComposerTaskCount` test sites pass `onOpen`, so I update them.
6. **Composer comment.** The #1072 paragraph in `handleKeyDown` that says every other claimant takes focus now names the drawer's exception: the drawer defers to this handler.

## State + concurrency model

One boolean in `PairedShell` (ADR 0006, screen-local, never a store). The listener attaches when the drawer mounts and detaches in the effect cleanup. Its dependencies are `onClose` and `turnRunning`, so each re-render re-registers it. That is cheap, and no stale `turnRunning` can survive. No async work.

## Error handling

No new failure modes. The drawer sends nothing and logs nothing, and daemon text stays in the unchanged list markup under the view's security rules.

## Testing strategy

- **Unit (`BackgroundTaskPanel.test.tsx`):** The first test is revised to pin the drawer markup: `role="dialog"`, no `aria-modal`, no `status-sheet`, `background-task-drawer` header, body and rule, and the Close button. Every other existing test stays and passes against the new wrapper. It is one line out (`status-sheet__body">0` → `background-task-drawer__body">0`). A `drawerClosesOnKeyDown` matrix covers: Escape closes; a non-Escape key does not; composing does not; composer focus plus a running turn does not; composer focus at idle closes; a running turn with focus elsewhere closes.
- **Unit (`ConversationScreen.test.tsx`):** `ComposerTaskCount` closed has no `--open` and no `aria-expanded`; open has `composer-status__tasks--open` and `aria-expanded="true"`.
- **E2E (`e2e/background-task-drawer.spec.ts`, new):** one launch, with two same-host rows and rosters for both:
  1. The pill opens the drawer. The pill has the `--open` class, and there is no `.status-sheet`.
  2. With the drawer open, type into the composer and Send, and capture a `send_message`.
  3. The pill closes the drawer. Reopen it from More actions, then close it with the Close button.
  4. Reopen, open the Actions options overlay, and press Escape. The drawer closes and the overlay is still open.
  5. Reopen, focus the box, push `thinking`, and press Escape. The interrupt is captured and the drawer is still open. Press Escape again at idle to close it.
  6. Reopen, click the second row. The drawer is still open and lists the second conversation's task.
  I then run the existing `background-task-*` specs and `chat-top-bar-geometry` to confirm the role locators still hold.

## Open questions

- Whether `stopPropagation` in capture blocks anything that must still see Escape. By design it blocks every other Escape claimant for that one press. The modal sheets (Run configuration, Channel info) cover the drawer, and a press closes the drawer behind them first. That is acceptable under "one Escape does one thing", and I check it during implementation.

## Documentation handoff

Pending for the documentation stage: the ticket names no documentation requirement. The `conversation-shell` overview's background-task-panel description, which calls it an interim status-sheet overlay, will need the drawer form, the lifted open state and the Escape arbitration.
