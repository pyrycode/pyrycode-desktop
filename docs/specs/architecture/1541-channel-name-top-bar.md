# Channel name in the messaging top bar

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` — `ConversationScreen`, `ThreadOverflowMenu`, `ThreadOverflowMenuView`, `UNNAMED_CONVERSATION_LABEL`: existing active snapshot, menu mount, dismissal boundary and fallback copy.
- `src/renderer/src/screens/conversation/conversation.css` — `.conversation__overflow`, `.conversation__overflow-anchor`, `.conversation__overflow-rule`: in-flow bar, menu positioning and divider.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` — `stageOpenConnection` and shell-mounted screen assertions: initial-store injection for static rendering.
- `e2e/chat-top-bar-geometry.spec.ts` — `primeOverflowingThread`, `rectOf`, `tokenColor`: existing layout, scroll and outside-click proof.
- `e2e/fixtures/launchPairedApp.ts` — `launchPairedApp`, `seedConversationsFrame`, `SEEDED_ROW`: one-row launch followed by fake daemon pushes.
- `src/renderer/src/store/activeConversationStore.ts` — `selectActiveConversation`: current name source already subscribed by the screen.
- `src/renderer/src/store/activeConversationReseedBridge.ts` and its tests — `reseededActiveConversation`, `useActiveConversationReseed`: list replies update names without reactivation.
- `src/renderer/src/PairedShell.tsx` — `PairedShell`: the reseed hook is mounted.
- `src/renderer/src/theme/tokens.css` — title-large, spacing, radius and scheme tokens already supply every design value.
- `docs/knowledge/features/conversation-shell.md` and `conversation-shell-chrome.md` — layout contract: the bar remains outside the message scroller and the anchor owns outside-click containment.
- `docs/knowledge/features/development-verification.md` — static renders cannot prove updates or layout; seed a second conversation only after the fixture's initial row click.
- Root `CLAUDE.md`, `docs/knowledge/INDEX.md`, and shared working-practice/visual-review guidance — scope, verification and capture requirements.

Codegraph context reported an uninitialized index; repository searches supplied the symbol and caller checks. `ThreadOverflowMenu` has one production caller. Refreshed remote feature branches have no overlaps with the four implementation/test files.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=497-1891

The screenshot shows a left-aligned conversation name beside the existing top-aligned vertical ellipsis. The 28px row uses Roboto Regular title-large (22px/28px, zero tracking), On Primary Container `#cfe4ff`; the 24px button remains Primary `#9dcbfc`. A full-width 1px Inverse Primary `#32628d` divider at 60% opacity follows after 16px, then 16px bottom padding; the 61px frame has 6px corners. Values come from resolved Figma variables, whose generated-code fallback colors differ from this dark scheme. Reference image: `/tmp/builder-1541-figma.png`.

## Change

Pass the already-subscribed active name from `ConversationScreen` to its sole `ThreadOverflowMenu` mount, using `UNNAMED_CONVERSATION_LABEL` for a null name. Render it as escaped paragraph text in a new shared content row, beside the existing anchor. Keep the ref and positioning on the 24px anchor so title clicks dismiss the menu and its popup stays directly beneath the button. Use a shrinkable title with single-line ellipsis and a non-shrinking anchor; apply existing title-large/color tokens, `--space-4` divider gap and `--radius-xs` bar radius. The bar stays outside the scroller. No new state, effects, error paths, exports, transport work or logging is introduced: this is a display consumer of the existing name-refresh lifecycle, and names never enter attributes or logs.

One deliverable, four ACs; estimated ~300–350 written lines including this plan, ~1 production TypeScript file plus CSS, two test files, zero new exported types/components/stores, one consumer update, zero new reject branches. The prior top-bar analogue included wider inset work; this change reuses its geometry harness and stays within all six sizing limits.

## Testing strategy

- RED first: static screen assertions for named, null and escaped name text; updated focused Playwright geometry/name assertions fail against the old bar.
- Extend `chat-top-bar-geometry.spec.ts` to measure the row, title typography, 16px divider gap/color, radius and unchanged 61px height. Retain its actual overflowing-thread scroll proof.
- Drive fake daemon list replies for null-to-named and renamed names, add a second conversation after launch and switch both ways; no reopening for refreshes.
- At 800px and a wider viewport, prove a long title has actual overflow, ellipsis, one line and no overlap or pane overflow with the menu open. Check popup anchoring, title-click dismissal, keyboard opening/selection, Escape/focus return and retained actions.
- Run the touched renderer unit file, `npm run build`, and only the focused fake-transport spec through the approved Electron helper. Capture the integrated screen at both widths to `/tmp/builder-1541-*.png` and compare with Figma before PR creation.

## Documentation handoff

Pending for the documentation stage: the ticket specifies no documentation requirement or path. Update `docs/knowledge/features/conversation-shell-chrome.md` sections “Structure” and “Back control” to describe the current-name row and revised divider geometry/color when documenting this feature; builder does not edit shared knowledge docs.

## Open questions

None. Existing reseed behavior and resolved design tokens cover the contract.

## Revisions

- Visual review found the pre-existing divider painting across the first menu item, already tracked by #1542. That ticket explicitly owns menu layering and the shared-dropdown migration; this implementation retains the existing menu and documents the visible limitation. No design or scope change. Captures at 800×772 and 1280×772 show the updated title/row and the long-name menu state; all focused interaction checks pass.
