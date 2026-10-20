# Host-scoped sidebar conversation selection

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` → `renderBody`, `channelRow`, `chatRow`: host-tree selection omits the existing `openServerId` check used by Pinned.
- `src/renderer/src/screens/channels/pinnedChannels.test.tsx` → `markup`: injectable active identity supports static shared-ID regressions.
- `src/renderer/src/screens/channels/channels.css` → selected-row selector: `aria-current` already controls the `--color-on-primary` fill.
- `e2e/sidebar-pinned.spec.ts` → shared-ID click loop: existing two-host fixture and page-wide current-row assertion.
- `docs/knowledge/features/channel-list.md` → hosted panes suppress conversation selection; static rendering cannot prove clicks.
- `docs/knowledge/features/development-verification.md`, `docs/recorded-tests.md` → validation boundaries and native preparation.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4

Read design context and screenshot. The fixed sidebar groups compact rows under hosts, with rounded on-primary selected fill and existing body-small typography. Reuse `Row` and all current tokens and assets; only which row receives selection changes.

## Change

Require `row.serverId === openServerId` alongside the conversation-ID match and closed-pane guard in both host-tree row renderers. Pinned already follows this contract. No new state, types, failure modes or subscriptions. One behaviour slice: only the opened host/conversation is selected. Estimated total written work is about 150 lines (including tests and this plan), zero new exports or consumer migrations, two acceptance criteria and no new reject branches; within every ceiling. The analogue `968d761f` wrote 48 lines for pinned-only selection. No overlapping remote feature branches touch the planned files.

## Testing strategy

- Extend `pinnedChannels.test.tsx` with channel/channel, chat/chat and pinned-B/tree-A shared-ID layouts, selecting each host; assert exactly one current row and its title. Assert missing/wrong identities and an open hosted pane select none, and an explicitly closed pane restores selection.
- Add `e2e/sidebar-selection.spec.ts` using encrypted fake hosts and production IPC. Click A, B, A, B in each layout and require exactly the clicked row current page-wide. Check selected fill through the existing CSS token and capture 1280×800 and 800×600 evidence outside the worktree.
- Observe both regression tiers fail before implementation, then pass after. Run affected existing renderer tests, pre-verify and build after the final main merge. Linux is this ticket's OS. The dispatcher owns the complete application/unit gate; no provider live behaviour changes.
