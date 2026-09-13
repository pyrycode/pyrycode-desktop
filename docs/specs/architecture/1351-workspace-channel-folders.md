# Workspace-relative Create channel

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` — `ChannelList` retains the clicked workspace and host and abandons disconnected drafts.
- `src/renderer/src/screens/channels/CreateChannelDialog.tsx` — `CreateChannelDialogView` is the existing presentation seam.
- `src/renderer/src/screens/channels/AddWorkspaceDialog.tsx` — `AddWorkspaceDialog` demonstrates local host-scoped subscriptions and synchronous cleanup.
- `src/renderer/src/screens/channels/SaveAsChannelDialog.tsx` — `slugForChannel` supplies the safe single-element conversion; its fixed parent is inappropriate here.
- `src/renderer/src/components/Modal.tsx` and `modal.css` — `Modal` supplies the shared header, close asset, divider, constrained width and actions.
- `src/renderer/src/screens/channels/channels.css` and `src/renderer/src/theme/tokens.css` — existing filled input and typography tokens.
- `src/renderer/src/store/conversationCreatedBridge.ts` — `requestNewChannel` preserves host routing and `useConversationCreatedNav` opens confirmed channels.
- `src/renderer/src/store/newFolderBridge.ts` — `translateNewFolderEvent` drops host identity, so inspect original events locally instead.
- `src/shared/ipc/commands.ts` and `src/main/daemonConnection.ts` — `isCreateWorkspaceFolderPayload` and `createWorkspaceFolder` preserve the existing validated IPC command and fresh wire payload.
- `e2e/sidebar-create-channel.spec.ts` and `e2e/sidebar-add-workspace.spec.ts` — stateful fake, held replies and main-process event injection patterns.
- `docs/knowledge/features/create-channel-dialog.md` — historical fire-and-forget behavior to replace; `development-verification.md` — positive barriers before absence assertions, Electron execution and capture requirements.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=487-2435

Shared Modal: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=489-1942

The reference is a 640px dark column with a title/close row and divider, a filled Channel name field, two vertically stacked tertiary radio controls, and centered outlined Cancel / filled OK actions. Reuse `Modal` and its exported close asset; map the input and radio typography to existing body-medium, label-large and label-medium tokens. The screenshot and design context were read before this plan.

## Context and scope

One deliverable: create a named promoted channel within the selected workspace, directly or beneath its channels subfolder. Existing files are never moved. Estimated written work: 650–700 lines including this plan, tests and CSS; two production TypeScript files plus stylesheet, at most three new exports, one production consumer, five acceptance criteria and fewer than ten failure/ignore branches. No signature cascade outside the view's existing tests and single consumer. Refreshed remote feature branches show no overlap with the intended files. Codegraph reported an uninitialized index; source reads provided the map.

## Design

`CreateChannelDialogView` uses `Modal`, width 640, keeping its own overlay. Props supply name, scratch/dedicated choice, pending/error status and callbacks. Native labelled radios share a group name; the name input autofocuses and blank trimmed names disable OK. Busy disables name, radios and OK, while both dismissal controls remain available.

An exported `CreateChannelDialog` container replaces the name state and send handler in `ChannelList`. Mounting seeds an empty name and scratch selection. It accepts only `{ cwd, serverId, onDismiss }`. Direct submission calls `requestNewChannel` with the workspace verbatim. Dedicated submission sends `createWorkspaceFolder` with parent `cwd` stripped of trailing slashes plus `/channels`, and name `slugForChannel(trimmedName)`. That existing operation creates missing parents remotely. Only its successful response triggers `requestNewChannel`, with the returned canonical path verbatim and original trimmed display name.

## State + concurrency model

UI-local state holds name/location/status; a synchronous ref holds the pending operation (`idle`, `folder` with submitted name, or `channel`) and an abandonment flag. Set the ref before sending to prevent rapid duplicate dispatch. A single original `DaemonEvent` listener first requires a nonempty matching host stamp, then an expected operation for the current stage. Folder success advances to channel; matching rejection clears the wait and permits retry. Channel confirmation closes; the existing global navigation bridge opens the confirmed channel.

No shared folder store is needed. Register a synchronous session subscription to abandon the draft on selected-host disconnect before a late folder callback can act. Dismissal immediately marks abandonment and removes both subscriptions; effect cleanup covers unmount/window teardown. Reconnect never revives this continuation. Already-sent operations are not undone. No renderer request identifier exists: concurrent same-host operations remain indistinguishable, including an older same-host reply during a newer matching stage. No new correlation guarantee is introduced.

## Error handling

Folder failure reads “Could not create that folder”; channel failure reads “Could not create that channel”. Local bridge throws use the same stage-specific client-owned failure, never exception text. Log only static lifecycle/status codes through `sendDiagnostic`. Pending waits remain dismissible if a reply never arrives; no new timeout behavior is requested.

## Testing strategy

- RED first: update the static presentation tests for shared Modal, labels, selection, blank validation, busy controls, escaped input and error text.
- Reuse existing `slugForChannel` unit cases; include the Release planning conversion assertion if needed.
- Focused fake-transport interactions exercise default navigation, dedicated request and canonical path, folder and channel rejection/retry, frozen controls, duplicate prevention, cancellation/header dismissal, wrong-host/unstamped/out-of-stage events, and disconnect abandonment with two hosts sharing one workspace path.
- Run scoped Vitest, build, then the changed fake-transport spec through the approved Electron helper. Capture the actual modal at 1280×800 and 800×600 (plus short-window scrolling) and compare with the Figma screenshot. Full suites belong to the verifier.

## Open questions

None. Existing global navigation continues to observe all confirmed creations; local correlation controls only this draft's progression and dismissal.

## Documentation handoff

Pending for the documentation stage: update `docs/knowledge/features/create-channel-dialog.md` to describe both workspace-relative choices, the scratch-label meaning, selected-host routing, pending/retry/dismissal behavior and the existing same-host correlation limit; replace the obsolete no-location-choice/fire-and-forget description (especially “What it does”, “How it works”, and “Edge cases and limitations”).

## Security review

**Verdict:** PASS

- Trust boundaries: `isCreateWorkspaceFolderPayload` and existing main dispatch validate IPC shape; `createWorkspaceFolder` rebuilds the wire payload. The local listener requires original main-stamped host identity before processing a result.
- Tokens: no credentials, persistence or new secret access. Existing main safeStorage ownership is untouched.
- File/storage: `slugForChannel` removes traversal separators and supplies a nonempty single element. Parent is the selected remote workspace plus a fixed suffix; daemon confinement/canonicalization remains authoritative. No local filesystem operation or check-then-open is introduced. The canonical reply goes only into the existing outbound cwd field, never an attribute or local path.
- Electron: no new IPC channel, window, navigation policy or remote content. React escapes operator input; the existing Modal asset is local. Transport remains in main.
- Cryptography: no changes to Noise, randomness, key material or nonce lifecycle.
- Network/I/O: existing commands only; lost responses leave a dismissible wait, and disconnect destroys continuation. No new sockets, URLs or retries.
- Errors/logs: only client-owned error copy and static diagnostic event/code pairs; never names, paths, payloads or exception details.
- Concurrency: synchronous pending ref prevents duplicates; host and stage guard callbacks; immediate dismissal and session cleanup prevent post-abandonment folder-to-channel sends. Same-host correlation limitation is explicit.
- Threat model: delayed or wrong-host replies cannot progress an abandoned or mismatched stage. Malformed replies remain subject to existing main parsing. Relay cryptography, disk credential protection and renderer isolation stay with their existing owners and are not changed by this ticket.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-13
