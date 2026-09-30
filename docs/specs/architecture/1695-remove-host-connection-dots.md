# Remove host-row connection dots

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` — `HostRow`, `HostRowControl`, `HostConnectionDots`, `HostConnectionDotsControl`, `CollapsibleHostGroup`: dot consumers and retained host behavior.
- `src/renderer/src/screens/channels/channels.css` — host row, disclosure, label, edit and repair selectors: absolute control positions and reserved label space; shared `conn-dot--*` bindings.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` — host-row and conversation-dot scenarios: replace retired dot assertions while retaining host and activity coverage.
- `e2e/host-row-hover-controls.spec.ts` — hover reveal and Edit host dialog drive.
- `e2e/host-label-sidebar.spec.ts` — long-label truncation and sidebar geometry.
- `e2e/host-row-per-server.spec.ts` — independent two-host connection-loss drive.
- `e2e/sidebar-offline-mutations.spec.ts` — failed-host Edit and Repair clicks.
- `e2e/connection-dot-colours.spec.ts` — computed shared color probes.
- `src/renderer/src/store/sessionStore.ts` — `ConnectionStatus`: connected, connecting, disconnected and classified error states.
- `docs/knowledge/features/channel-list-host-row.md` and `channel-list.md` — host identity, control isolation and shrinkable label chain.
- `docs/knowledge/features/development-verification.md` — positive observation before absence checks; renderer markup cannot prove interaction or geometry.
- Root `CLAUDE.md`, knowledge index and shared working practice/visual-review recipe — scope and verification contracts.

Codegraph context was attempted but the worktree index is not initialized. Source search confirms that the two retired dot components have no other production callers.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=405-7839

The inspected 360 × 28 host row contains a server glyph, a title-small label and a disclosure chevron, with no connection dots. Keep the app's existing glyph and chevron, token-based typography and spacing, and the retained hover/focus Edit and failed-host Repair controls; this slice changes only the dot presentation.

## Change

Delete the dot subtree from `HostRow`, the unused `HostConnectionDots` and `HostConnectionDotsControl` components, and their imports. Remove host-only dot geometry, wrapper styling and hover/focus swap rules. Keep the shared four `conn-dot--*` color classes. Preserve the row's padding, label truncation, glyph, disclosure, failed styling, Edit pen/name pill, Repair control and saved-chats read-error line. Keep the existing `HostRow` prop contract to avoid an unrelated caller cascade; its server identity remains handled by the container. Update nearby comments that describe deleted presentation.

No store, transport, mapping helper, concurrency, error handling or lifecycle changes are needed. Existing interaction diagnostics remain; deleting passive presentation adds no new event to log.

## Scope and dependencies

One deliverable, three acceptance criteria. Expected written work is about 350 lines across two production files, the renderer test and five browser specs plus this plan. No new exports, consumer signature changes or reject branches. This is smaller than the cited desktop-row analogue, whose implementation added 372 lines and removed 84 across four files before its plan. All six ticket boundaries hold.

Fetched remote branches and checked planned file overlaps: none found.

## Testing strategy

- First add failing `ChannelList.test.tsx` absence assertions for connected, connecting, disconnected, unreported, failed and update-required hosts, then remove retired host-dot view tests and helpers. Existing assertions retain host content, disclosures, escaping, read errors and conversation activity dots.
- Browser: prove dot/wrapper absence at rest and hover, Edit reveal by hover and keyboard focus, dialog opening and fixed control/label/disclosure boxes. Check long-label truncation and independent Edit/Repair targets on failed rows; retain both real clicks.
- Two-host browser drive: establish both hosts' healthy disclosures/creation controls, drop B's leg, positively wait for B's failed row/Repair control, then assert A's label, disclosure, creation controls and composer remain usable.
- Keep four color probes and compare each computed background against its named theme token without requiring host dots.
- Run touched renderer tests, `npm run build`, and the five focused fake-transport specs. Capture resting, hover and failed-host renders with the existing fixture in scratch space, then compare the requested row against Figma.

## Documentation handoff

Pending for documentation stage: update `docs/knowledge/features/channel-list-host-row.md` § The host row and § Connection dots, and the host-row descriptions in `docs/knowledge/features/channel-list.md` (host-row, CSS and edge-case sections), to describe rows without connection dots and the retained edit/repair controls. Remove claims that these rows display daemon/relay legs or swap dots on hover.

## Open questions

None.
