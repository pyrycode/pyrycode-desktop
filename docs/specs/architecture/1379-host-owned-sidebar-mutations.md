# Host-owned sidebar mutations

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx`: `ChannelList`, `renderServerTrees`, `HostRowControl` — row ownership, retained dialog targets and existing host gate.
- `src/renderer/src/screens/channels/SaveAsChannelDialog.tsx`: `SaveAsChannelDialog` — folder completion currently promotes from an effect.
- `src/renderer/src/screens/channels/AddWorkspaceDialog.tsx`: `AddWorkspaceDialog` — current-status submission guard and subscription cleanup precedent.
- `src/renderer/src/store/conversationCreatedBridge.ts`: `requestNewConversation`, `requestNewChannel`, `requestNewWorkspaceChat` — existing creation payloads and explicit host routing.
- `src/renderer/src/store/newFolderBridge.ts`: `subscribeNewFolder` — injected event subscription allows dialog-local host filtering.
- `src/renderer/src/store/newFolderStore.ts`: `reduceNewFolder` — reset abandons an outstanding continuation.
- `src/shared/ipc/commands.ts`: `RendererCommand` — host-scoped commands carry top-level serverId; conversation mutations route by conversation_id.
- `src/renderer/src/screens/channels/ChannelList.test.tsx`: `render` — injectable static view proof.
- `e2e/sidebar-add-workspace.spec.ts`: `mainEvent`, connection gating tests — reuse existing Add-workspace coverage.
- `e2e/fixtures/launchPairedApp.ts`: `launchPairedApp` — two-host fixture and held row selection.
- `docs/knowledge/features/channel-list.md`, `save-as-channel-dialog.md`, `create-channel-dialog.md`, `conversation-list-store.md`, `development-verification.md` — host grouping, folder lifecycle and static-render limitations.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4

Read design context and screenshot: a fixed-width sidebar has Channels and Chats trees, each grouped under hosts and workspaces. Compact rows retain existing status dots, body-small text and hover controls; unavailable mutations use existing hidden controls or disabled submission without changing tokens or geometry.

## Context

Sidebar mutations currently lose workspace ownership or remain actionable while offline. One deliverable: host-owned availability from entry through submission, independent of the open conversation. No wire or IPC contract change.

## Design

`ChannelList` subscribes to the held statuses map and supplies it to the view. Creation and editing controls require the target host's connected entry; unattributed rows have no mutation controls. The global create requires exactly one paired host. Held rows and workspace disclosures remain usable. Host labeling and pairing repair remain local actions.

Workspace creation callbacks carry cwd and serverId. The create-channel dialog retains both. Creation helpers accept an optional explicit serverId, preserving other callers and existing payloads. Conversation rename and promotion retain the clicked row's conversation_id, which is their existing routing contract.

Dialog submission checks the live session store immediately before a synchronous send. Offline mutation dialogs are removed from rendering. Save-as-channel additionally invalidates its continuation synchronously on every non-connected status transition, so a disconnect/reconnect batched before React paints still abandons it. It filters folder events to the retained host and checks live connectivity before folder creation and promotion. A subsequent explicit opening starts fresh.

## State + concurrency model

Keep dialog state local; no new store. Session subscriptions return cleanup handles. Save-as-channel owns a cancellation ref and resets its folder round trip on disconnect and unmount. No await separates availability checks from outbound sends. Reconnection alone cannot restore an abandoned continuation.

## Error handling

Missing, connecting, disconnected and error entries all fail closed. Preserve existing generic folder rejection UI. Emit static, content-free diagnostics for blocked mutation attempts and abandoned promotion; names, paths, identifiers and daemon content never enter logs.

## Testing strategy

- RED first: static view assertions for every non-connected status, ownership, retained navigation and ambiguous global creation.
- Focused fake-transport Playwright observes renderer outbound calls before transport filtering; drive pre-opened dialogs with keyboard after disconnect, delayed folder completion offline and after reconnect, fresh retry, and both open-chat/target-host directions.
- Reuse and run `e2e/sidebar-add-workspace.spec.ts`; scoped vitest and build are the builder gate. Capture the sidebar in the focused drive for visual comparison.

## Scope check

Estimated 550–650 written lines including this plan and tests; three production files, no new exported types/components/stores, fewer than ten consumers requiring simultaneous update, four acceptance criteria, fewer than ten rejection branches. Codegraph reported an uninitialized index; file reads and text search supply the fallback. Remote feature branches checked after fetch: no overlaps in planned production files.

## Documentation handoff

No explicit documentation requirement in the ticket. Pending documentation stage: record host-owned gating in `docs/knowledge/features/channel-list.md` section `The container + pure view`, and disconnect abandonment in `docs/knowledge/features/save-as-channel-dialog.md` section `What it does`.

## Open questions

None.

## Security review

**Verdict:** PASS

- Trust boundaries: `RendererCommand` remains validated by existing main IPC; UI availability is not authorization. Host ids originate from paired hosts or main-stamped rows; conversation mutations retain their existing id routing.
- Tokens and cryptography: no token, key, storage or Noise changes; all remain in main.
- File/storage operations: folder paths remain opaque command data for existing daemon validation; no local filesystem access is introduced.
- Electron attack surface: no new IPC, window, navigation or remote-content surface.
- Network/I/O: existing transport owns framing, timeouts and encryption; this change adds no network jobs.
- Errors/logs: static diagnostic codes only; retain generic rejection copy and escaped text rendering.
- Concurrency: synchronous status subscription invalidates pending promotion even across batched reconnect; live-store checks precede each send and subscriptions clean up on unmount.
- Threat alignment: delayed completion cannot replay an abandoned promotion. Existing main and daemon validation remain responsible for compromised renderer/daemon inputs; no protocol security behavior changes.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-13
