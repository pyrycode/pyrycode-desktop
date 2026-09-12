# Offline held conversation availability

## Files read

- `src/renderer/src/PairedShell.tsx` — `activateDeps` requests configuration and history after local activation.
- `src/renderer/src/activateConversation.ts` — `activateConversation` retains held timelines and records viewing before requesting data.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` — `Composer`, `ChannelInfoSheet`, `BubbleAttachmentRow`, `useThreadScrollPin` own dispatch and rendering seams.
- `src/renderer/src/screens/conversation/WorkspacePickerSheet.tsx` — `WorkspacePickerSheet` opens folder creation and changes workspace.
- `src/renderer/src/screens/conversation/CreateFolderDialog.tsx` — `CreateFolderDialog` chains creation into a workspace change.
- `src/renderer/src/screens/conversation/ComposerActionsMenu.tsx` — `composerActionRows` supplies existing unavailable rows.
- `src/renderer/src/screens/conversation/BubbleAttachmentImage.tsx` — `BubbleAttachmentImage` retrieves on mount and releases its share on unmount.
- `src/renderer/src/screens/channels/RenameConversationDialog.tsx` — `RenameConversationDialogView` owns the submit disabled state.
- `src/renderer/src/screens/conversation/unpairAction.ts` — `serverIdForOpenConversation` rejects missing and ambiguous stamps.
- `src/renderer/src/screens/conversation/promptResponseAvailability.ts` — current-status read pattern; prompt gates remain separately owned.
- `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx` — `ComposerOptionsMenu` blocks unavailable mouse and keyboard selections.
- `src/renderer/src/screens/conversation/attachmentImageSource.ts` — image requests retrieve before reading local bytes.
- `docs/knowledge/features/conversation-shell.md` and `development-verification.md` — static rendering cannot prove effects or interactions; observe renderer commands.
- `e2e/offline-held-responses.spec.ts` and `offline-session-settings.spec.ts` — per-host event injection and CDP command observation.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4

Read design context and screenshot: a 400px tree sidebar sits beside a scrollable conversation and bottom composer with compact footer controls. Blue theme roles and rounded message surfaces remain intact; the failed host is red and the composer offers explicit pairing repair. Reuse existing disabled and hidden control treatments with no new styling or assets.

## Context and sizing

Held reading must not issue server requests or allow optimistic changes while its owning host is unavailable. No disk restoration or transport changes belong here.

Estimate: 750 written lines, eight production files, two new exported helpers, four acceptance criteria, no exported signature replacement or consumer migration, and one availability rejection condition. This exceeds the five-file boundary. Parentage is #1339 → #1377 → #1382; the depth-cap rule requires building. `needs-human:sizing` and the issue comment record the overage. The additional files cover automatic thumbnail retrieval and the rename submit presentation as well as the five named seams.

## Design

Add `conversationActionAvailability.ts` with a reactive availability hook and a synchronous current-owner helper. Resolve ownership only through `serverIdForOpenConversation`; require that exact host's status to be connected. The helper emits content-free availability diagnostics and returns the connected owner or null.

Gate `activateDeps.requestConversationConfig` before all configuration/model/system-prompt/history helpers. Local activation and history eligibility remain untouched when blocked. Gate older-history requests before calling their helper.

Use reactive availability for queue-drop, workspace, send/interrupt, action-menu, rename/archive/delete and file-download controls. Immediately re-read availability inside their dispatch callbacks before any optimistic mutation or draft clearing. Reuse the existing recovery visibility and send callback. Give the rename view an optional availability prop so a pre-opened dialog retains its name and cancellation while its submit becomes disabled.

The workspace picker and folder dialog use the conversation's owner, including an explicit existing `serverId` on folder creation. A created reply observed offline must not trigger a later workspace change on reconnect. Keep local dismissal available. Gate the recent-workspace data mount by availability.

For image thumbnails, check current availability before starting the mount's retrieval. Keep already-rendered images and their release lifetime when disconnect occurs. An offline mount shows the existing unavailable-image treatment, without a request or automatic reconnect replay. File-download buttons gate before their download helper.

## State and concurrency model

No store schema, wire or IPC changes. Availability derives from stamped conversation rows and `SessionState.statuses`. Synchronous guards run immediately before effects, with no await between guard and dispatch. No blocked action is queued for reconnect. Local drafts, held timelines, copy, scrolling and repair cancellation retain their existing lifetimes. Existing image release handles and effect subscriptions still clean up on unmount.

## Error handling

Unavailable, absent and ambiguous owners all block without optimistic state or a new error dialog. Existing transport errors, red host indication and pairing repair remain unchanged. Diagnostics contain only client-owned event and outcome codes.

## Testing strategy

- RED first: helper unit tests for connected, missing, connecting, disconnected, error and ambiguous ownership, plus static disabled interrupt and rename assertions.
- Focused fake-transport Playwright observes renderer commands and attachment requests, receives held content before disconnect, verifies offline opening/scroll/copy, retained draft and queue, pre-opened rename and action menu, missing/connecting states, a second connected host and an explicit reconnect action.
- Run touched unit tests, build, the focused Playwright spec and existing pairing recovery coverage. Capture the integrated offline screen at 1280×800 and compare with Figma.
- Full regression gates belong to the verifier/dispatcher. No live Claude acceptance is required.

## Documentation handoff

No explicit documentation requirement appears in the ticket. Pending documentation stage: record offline action availability and held-reading request behavior in `docs/knowledge/features/conversation-shell.md`, under the related conversation/action topics as appropriate.

## Open questions

None. Thumbnail retrieval is included because offline opening must not issue attachment requests.

## Security review

**Verdict:** PASS

- Trust boundaries: `serverIdForOpenConversation` requires exactly one main-stamped owner; never fall back to global status or another connected host. Renderer gates are availability controls, not replacements for main IPC validation.
- Tokens and crypto: no credentials, storage, keys, RNG or Noise changes; transport remains in main.
- Files/storage: no new persistence or path construction. Existing attachment helpers retain their validated main-process boundaries; disk restoration belongs to #1378.
- Electron: no new bridge commands, privileged content, navigation or window settings. Folder creation uses the existing optional server target.
- Network/I/O: prevent retrieval and configuration/history requests before entering helpers; leave transport deadlines and reconnection ownership unchanged.
- Logs: only static availability outcomes; no identifiers, names, paths, message text or attachment values.
- Concurrency: current status is read synchronously before dispatch and optimistic changes. A delayed folder reply cannot replay a workspace mutation after reconnect. Thumbnail release and event cleanup remain defined.
- Threat model: duplicate daemon conversation identifiers fail closed. Hostile relay transport, disk theft and renderer compromise retain existing main-process defenses; this ticket adds no authority to the renderer.

**Reviewer:** builder self-review using `builder/security-review.md`
**Date:** 2026-09-13
