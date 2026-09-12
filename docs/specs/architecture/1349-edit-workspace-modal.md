# Edit workspace modal

## Files read

- `src/renderer/src/screens/channels/EditWorkspaceDialog.tsx` — `EditWorkspaceDialogView` and `requestRenameWorkspace` own presentation, validation and dispatch.
- `src/renderer/src/screens/channels/ChannelList.tsx` — `ChannelList`, `renderBody` and `renderServerTrees` carry the selected workspace and displayed name; the server grouping must also supply its identity.
- `src/renderer/src/screens/channels/channels.css` — `.edit-workspace-overlay` retains placement; field styles change to the filled presentation.
- `src/renderer/src/components/Modal.tsx` and `modal.css` — `Modal` supplies the accessible heading, close control, actions and viewport-bounded scrolling.
- `electron.vite.config.ts` — the modal close asset is already emitted separately, incorporating the closed prerequisite #1361.
- `src/renderer/src/screens/channels/EditWorkspaceDialog.test.tsx` — static presentation and command checks.
- `e2e/sidebar-workspace-edit.spec.ts` — existing both-tree rename proof and pen geometry.
- `e2e/real-daemon-workspace-rename.spec.ts` — rename action locators must follow the adoption.
- `docs/knowledge/features/edit-workspace-dialog.md` — current fire-and-forget lifecycle and exact-path contract.
- `docs/knowledge/features/modal-presentation.md`, “Props and caller ownership” — callers own mounting and dismissal; the shared presentation performs no lifecycle work.
- `docs/knowledge/features/channel-list.md` — separate server/workspace grouping in both trees.
- `docs/knowledge/features/development-verification.md` — static renders cannot prove interaction or asset decoding.

Codegraph context returned an uninitialized-index error; repository search supplied the reading map and caller check.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=487-2239

**Shared Modal:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=489-1942

The instance is a 640px dark panel with a divided title/close header, one filled optional workspace-name field, and centered outlined Cancel and filled OK actions. Use `Modal` for its 24px vertical/28px horizontal padding, 20px section gaps, title-large typography and existing close asset. The field uses label-large emphasized typography, an 8px label gap, body-medium input text, 52px height and existing theme colors/radii; no host or folder content is visible.

## Context and design

Adopt the shared presentation while retaining the existing exact remote path and immediate-close lifecycle. Remove the view's path prop, old panel, path and action markup. Keep the caller-owned overlay, lack of autofocus, and current non-dismissal on Escape/backdrop. Close and Cancel share the existing dismissal callback.

OK is disabled only for a trimmed name longer than 128 UTF-16 code units. `requestRenameWorkspace` sends a trimmed label, or explicit null for blank input or the folder-name fallback. It accepts the selected server identity and adds the existing top-level `serverId` routing field without changing the wire contract or filesystem.

`renderServerTrees` closes over each server identity while constructing workspace groups, passing it through the existing edit callback chain. `ChannelList` holds the path and optional server identity together as one nullable target; the draft is seeded from the row on every open. Unattributed rows retain the existing omitted-server routing behavior.

## State, concurrency and errors

Only dialog-local target and draft state change. No new store, async task, subscription or error branch. Send once synchronously, then clear the target immediately. Existing inbound workspace updates refresh both trees for the selected host. Preserve existing content-free IPC logging; no name/path logging or new error UI.

## Testing strategy

- First run failing static tests for shared modal markup, optional blank validation, UTF-16 boundaries, explicit null resets and server-targeted exact-path command payloads.
- Adapt the existing fake-transport workspace spec and add reset, dismissal/reseed, keyboard, two-host isolation and short-window scroll coverage. Verify the built close image decodes and capture normal/minimum-width/short-window states for visual comparison.
- Update affected real-daemon rename locators; dispatcher owns live execution.
- Run touched renderer tests, `npm run build`, and the focused fake-transport workspace spec.

## Size and overlap checks

One deliverable; estimate approximately 450 written lines including this plan and tests. Two production TypeScript files plus one stylesheet; no new exported types/components/stores, four acceptance criteria, no new error branches. Signature changes affect the one view caller, one command caller, two tree edit forwards, one edit closure and two workspace-group calls (seven production consumer sites). Refreshed remote feature branches show no overlaps in the planned source or test files. All six boundaries hold.

## Documentation handoff

Pending for the documentation stage: update `docs/knowledge/features/edit-workspace-dialog.md` for the Figma design, shared modal, hidden path, optional-name reset and selected-host routing, preserving the fire-and-forget lifecycle. Apply to its overview, “What it does”, “How it works” and “Edge cases and limitations”.

## Open questions

None.
