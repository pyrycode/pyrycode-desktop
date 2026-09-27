# Host-first sidebar (#1683)

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` → `ChannelListView`, `renderBody`, `HostRow`, `CollapsibleHostGroup`, `Row`: current two-tree render, host fold, row actions and existing create-dialog callbacks.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__host`, `.channel-list__workspace-head`, `.channel-list__row`: current row geometry and folder art.
- `src/renderer/src/screens/channels/channelListViewModel.ts` → `partitionActive`, `groupByServer`: active partition and host attribution retain daemon order without changing paths.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → `ChannelListView` static render coverage and component seams for folds.
- `e2e/host-collapse.spec.ts`, `e2e/sidebar-tree-geometry.spec.ts` → browser fold and measured layout coverage.
- `docs/knowledge/features/channel-list.md`, `channel-list-host-row.md`, `channel-list-host-fold.md`, `channel-list-workspace-grouping.md`, `channel-list-tree-inset.md` → prior behavior and geometry; documentation phase will update them.
- `docs/knowledge/features/development-verification.md` → static render and browser evidence boundaries.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=132-3902

The sidebar is a 400px card with one vertical host list; each host owns indented Channels and Chats rows, with open and closed folder icons and a section plus at the trailing edge. The frame uses 28px host and section rows, 16px between hosts, and the existing 24px conversation rows on a 28px pitch. Its first host shows a right chevron despite an expanded subtree; actual fold state governs the implemented chevron.

## Context

The current `renderBody` draws two global trees, repeats hosts in each and inserts workspace rows by `cwd`. One paired daemon workspace already has its own host identity, so the extra level makes navigation and creation depend on the wrong visual grouping. Existing creation dialogs already target a host and send `cwd: null`; this change relocates their entry controls without altering the wire contract.

## Design

- `partitionActive` still removes archived rows and preserves each partition's order. `groupByServer` still joins only against saved host ids, leaving unmatched rows in an unattributed fallback after all hosts. The render iterates saved hosts once and draws each host's Channels and Chats sections directly. Unattributed rows get fixed Channels and Chats headings without host controls.
- `CollapsibleHostGroup` keeps its local host fold. A small local section component owns one independent fold for Channels or Chats. All three default open, including an empty host. Failed hosts reveal sections even if the host's saved fold is closed, while repair and existing status dots stay on the host row.
- `HostRow` retains Edit host, status and repair, and drops Add workspace. Every host has a disclosure chevron, including an empty host. A section row uses the existing folder glyph family, a fixed client-owned label, a chevron driven by `aria-expanded`, and a plus only when that host is connected. The plus invokes the existing host-scoped dialog callback. Conversation `Row` remains unchanged.
- The sidebar stylesheet supplies the new section inset and host spacing while retaining conversation row styling. Workspace rows, global section trees and divider disappear from the rendered sidebar. The Apps heading may stay as noninteractive decoration.

## State + concurrency model

Folds live in keyed React component state and have no IPC or persistence. Host identity is the saved server id; section identity is its fixed kind. Creation reuses `ChannelList`'s dialog cells and its connected-host guard. Dialog confirmation continues to use the daemon default folder; Cancel has no command. No new async task or stream is introduced.

## Error handling

Missing or unpaired row stamps remain unattributed and never gain a host action. A disconnected or reconnecting host keeps its visible rows and status but has no section create plus. A failed host keeps repair and exposes its sections. Existing dialog errors and host-loss cleanup remain authoritative.

## Testing strategy

- Red first in `ChannelList.test.tsx`: host order and empty hosts; partitioned rows and unattributed fallback; no workspace/global rows; fixed section controls and open/closed render seams.
- Focused fake-transport Playwright: independent host and section folds, selected conversation draft, promotion, empty-host section creation and reconnect; `sidebar-tree-geometry.spec.ts` measures the new offsets, row heights and host gap.
- Migrate or remove assertions whose subject is a retired sidebar workspace action or two-copy host structure. Run touched Vitest paths, one focused Playwright spec after build, then `npm run build`.

## Documentation handoff

Pending for documentation stage: update `docs/knowledge/features/channel-list.md`, `docs/knowledge/features/channel-list-host-row.md`, `docs/knowledge/features/channel-list-host-fold.md`, `docs/knowledge/features/channel-list-workspace-grouping.md`, and `docs/knowledge/features/channel-list-tree-inset.md` to describe the host-first hierarchy, section creation using the daemon default, removed sidebar workspace actions, and the new geometry.

## Open questions

- Existing browser specs for workspace editing and Add workspace assert behavior this ticket removes. During implementation, distinguish retired sidebar entry behavior from still-supported daemon commands and other screens; keep meaningful latter coverage.

## Revisions

- The workspace-only browser specs were retired with their sidebar controls. Conversation creation, host repair, channel promotion, status, and edit coverage remain in focused browser specs. The `mintChatInWorkspace` fixture now confirms creation through the host's Chats section; its callers use the paired daemon workspace default.
- Verifier rework (2026-09-27): `CollapsibleHostGroup` must retain mounted `HostSection` children while visually hiding a closed host. Conditional removal reset each section's local fold state on reopen. The browser fold spec now closes a section, closes and reopens its host, and asserts that the section remains closed. Restore the fixed toolbar and tall-list scroll checks in the host-first geometry spec; those behaviors remain part of the sidebar.
