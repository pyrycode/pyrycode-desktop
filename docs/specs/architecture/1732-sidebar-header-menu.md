# Sidebar header menu

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` — `ChannelListView`, `SettingsButton`, `ArchiveButton`, `PairNewHostButton`: toolbar and unchanged navigation callbacks.
- `src/renderer/src/screens/channels/channels.css` — toolbar, divider and tree: separate scrollport and stacking geometry.
- `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx` — `ComposerOptionsMenu`, `ComposerOptionsPanel`: local opening, roving focus, activation and listener teardown.
- `src/renderer/src/screens/conversation/conversation.css` — shared panel surface and placement modifiers.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` — `ThreadOverflowMenu`: exact existing Figma ellipsis glyph to reuse.
- `src/renderer/src/screens/conversation/composerOptionsKeyboard.ts` — `resolveComposerOptionsKey`: wrapped arrows, Enter, native Space and Escape.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` — `render`: static collapsed toolbar assertions in loading, empty and populated states.
- `e2e/paired-shell-navigation.spec.ts`, `e2e/sidebar-pair-new-host.spec.ts`, `e2e/fixtures/pairingArrival.ts` — navigation and pairing assertions needing the extra menu step; source search found remaining direct entry selectors.
- `docs/knowledge/features/channel-list.md`, `conversation-shell-composer-options-panel.md`, `development-verification.md` — preserve tree scrolling, shared default behavior and prove overlay hit-testing through actual overlap.
- `docs/specs/architecture/1542-shared-messaging-menu.md` — analogue for additive placement and shared menu reuse.

Codegraph is uninitialized; source searches supply the consumer inventory. QMD found the shared menu precedents.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=756-9674

Read the frame context and screenshot, including popup `756:9837`. The left control is a 24px square with a centered 6×24px vertical ellipsis, in Primary. The 160×60px popup starts 4px left of the trigger and 32px below its bottom. Reuse the composer Actions surface, body-small Primary text, 6px radius, 28px rows and 2px outer vertical padding. Settings precedes Archive; `currentId={null}` means no selected row. Figma shows the Settings hover fill; it is not a current-value mark.

## Context

Replace the two standalone sidebar navigation icons with the October header menu decision while retaining Pair new host and existing destinations. No ADR is needed.

## Design

Mount `ComposerOptionsMenu` directly in the toolbar with two client-owned options and the existing callbacks. Add optional `placement: 'bottom-start'` alongside the existing default/footer and bottom-end modes. Its modifier owns left/down offsets and stacking; the sidebar supplies its fixed popup width and token-based ellipsis appearance. Remove obsolete Settings/Archive button markup and styles.

Add optional `consumeOutsideClick` (default false). For this consumer, a transparent fixed dismissal layer stays mounted through mousedown and consumes the following click before closing. Place the popup above that layer. Existing consumers retain their outside-mousedown listener and pass-through behavior. Reuse existing keyboard and selection paths without callback contract changes.

## State + concurrency model

Only the shared menu's component-local open/focused-index state changes. No store slice, stream, IPC, async work or cancellation contract changes. Escape returns focus to the trigger; selecting closes then invokes the existing callback once. Dismissal layer unmounts on close/navigation; the default document listener retains its cleanup.

## Error handling

No new I/O or failure modes. No new lifecycle logging is required for local presentation; destination behavior and diagnostics remain unchanged.

## Testing strategy

- RED first: static tests require one collapsed Sidebar menu trigger and Pair new host in loading, empty and populated states, with neither standalone entry nor popup.
- Add focused fake-transport Playwright coverage at 1280×800 and 800×600: exact trigger/popup/row geometry, no current row, tree overlap and hit-tests, both destinations, keyboard focus/arrows/Enter/Space/Escape, and dismissal without first-click tree navigation or folding followed by a working second click.
- Update all direct sidebar Settings/Archive selectors and the pairing-arrival helper mechanically, preserving destination and pairing assertions. Gated navigation changes are selector-only; fake transport establishes this ticket's acceptance.
- Capture closed/open screenshots to `/tmp/builder-1732/`, inspect against Figma and record viewport paths/results in the PR.
- Run focused menu/navigation/pairing specs plus shared footer/thread/reader regressions. After merging main, run pre-verify and build. Full fake/live tiers belong to the dispatcher; run any changed live test if introduced.

## Open Questions

None. Shared component plus opt-in placement/dismissal is the smallest shape; a second sidebar menu would duplicate the tested keyboard contract.

## Scope check

One deliverable, three observable acceptance criteria, approximately 520–650 written lines including plan, tests and mechanical navigation updates; zero new exported types/components/stores and zero error branches. Production callbacks stay intact. The direct e2e entry updates exceed ten sites and stay with the menu under the sizing floor: a selector-only sibling cannot pass independently. No new dependencies.

Remote branch overlaps: #1658 (create model), #1726 (queued controls), #1729 (question styles), #1738 (host prompt). Read their diffs: none changes this toolbar/shared menu block or supplies a dependency; keep edits local and additive.

## Revisions

2026-10-05: Match the sidebar popup's Figma surface locally: on-primary background and on-primary-fixed hover, keeping the shared footer/thread/reader surface unchanged. Reuse the exact existing thread 6×24px ellipsis SVG. Capture under the documented Linux Xvfb show-window harness option; hidden Linux windows do not produce screenshot frames. Gated selector updates affect three existing real-daemon specs, so run all three through the targeted launcher and report counts.

Final main merge brought #1765’s Settings navigation scenarios; update their three entry selectors too, preserving all preference assertions.

Final written scope: approximately 360 added lines including the initial plan and focused spec, zero new exports and unchanged production navigation callback contracts.
