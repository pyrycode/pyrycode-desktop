# Held prompt response availability

## Files read

- `src/renderer/src/screens/conversation/PermissionModal.tsx` — `PermissionModal` and `PermissionModalView` own selection, confirmation and response gestures.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` — `QuestionPanelSlot` owns answer assembly and picks; `useOpenConnectionStatus` demonstrates host-specific subscriptions.
- `src/renderer/src/screens/conversation/QuestionPanel.tsx` — `QuestionPanelView` shares Next/Continue while Cancel always refuses.
- `src/renderer/src/screens/conversation/unpairAction.ts` — `serverIdForOpenConversation` rejects missing and duplicate ownership.
- `src/renderer/src/screens/conversation/modalResolution.ts` and `questionResolution.ts` — response helpers immediately resolve local state after sending.
- `src/renderer/src/store/sessionStore.ts` — `SessionState.statuses` is the connection authority.
- `src/renderer/src/store/modalBridge.ts` and `questionBridge.ts` — reconnect clears prompts for daemon re-delivery; retain that existing contract.
- `docs/knowledge/features/conversation-shell.md`, `conversation-shell-permission-modal.md`, `conversation-shell-question-panel.md`, `modal-store-bridge.md` — local selections and prompt precedence remain independent of availability.
- `docs/knowledge/features/development-verification.md` and `e2e/offline-session-settings.spec.ts` — renderer command observation avoids a false pass from main rejecting an outbound command.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6913

The reference is a column with a mark/title row, bordered rounded input box, choice rows, divider and right-aligned Cancel/Continue. Keep the existing shared question-panel tokens, typography and native disabled-button treatment. The surrounding desktop layout remains https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4.

## Context and design

Held prompts currently call optimistic response helpers while offline. Add a shared renderer helper beside the panels that resolves a supplied prompt conversation through stamped conversation rows and accepts only that host's `connected` status. Its hook subscribes to rows and the selected status; its submission function rereads both stores synchronously and records only static allowed/blocked diagnostics.

`PermissionModal` passes availability to its view and checks current availability before Continue, Confirm and Cancel. The view disables those response buttons while Back and radios remain local. `QuestionPanelSlot` supplies response availability separately from answer completeness, checks it before answer/refusal helpers, and `QuestionPanelView` disables Cancel and final Continue only. Next, Previous, tabs and picks remain usable. No command or optimistic resolution occurs on blocked submission.

## State + concurrency model

No new state, effects, async jobs or cancellation handles. Existing Zustand subscriptions clean up through their hooks. Submission checks and existing synchronous response helpers have no intervening await. Disconnect never clears local state here; reconnect keeps existing bridge reset and daemon re-delivery semantics, requiring a new explicit valid response.

## Error handling

Unknown/ambiguous conversation owner or absent/non-connected host status returns false. Never consult the aggregate status or another host. No new error UI or network error handling; blocked attempts emit a static diagnostic with no IDs, prompt text or picks.

## Testing strategy

Add focused fake-transport Playwright coverage first and observe it fail on enabled offline response controls. Capture renderer answer/refusal calls with CDP, and assert held prompts and picks after keyboard attempts. Cover permission, trust, pre-opened confirmation, local Back, question navigation/editing, drafts, missing/ambiguous ownership, missing status, connecting/error/disconnected, and a second connected host. Reconnect re-delivery must not send anything until explicit selection/response. Add a focused unit test for the shared current-state guard. Run touched unit tests, build and the new focused Playwright spec; capture offline panels at 1280×800 for comparison.

## Scope check

One deliverable: held-response availability. Estimate approximately 480 written lines including plan/tests, four production files, no new exported types/components/stores, three changed production consumer sites, three AC and one collapsed reject result. Within all six limits. Refiner estimated 400 lines/three production files; the shared guard adds a fourth file to avoid repeating ownership logic. No remote feature branch overlaps the three existing panel files after fetching origin. Codegraph was uninitialized, so source reads supplied the map.

## Documentation handoff

No documentation-only requirement is present in the ticket. Documentation stage should record response availability in the existing permission/question panel topics; shared knowledge files remain owned by that stage.

## Open questions

None.

## Revisions

- 2026-09-13: `conversation.css` has disabled styling only for Continue. Extend its muted token treatment to Cancel while preserving its outlined shape. The source-file ceiling remains four TypeScript production files, plus this stylesheet; total work stays below 800 lines.

## Security review

**Verdict:** PASS

- Trust boundaries: `serverIdForOpenConversation` requires one stamped matching row. Both checks use prompt conversation identity; no aggregate status fallback. Renderer availability does not replace main/daemon authorization.
- Tokens and cryptography: no credentials, token minting, Noise changes or secret comparisons; existing main-process response path retains those responsibilities.
- File/storage operations: no persistence, filesystem paths or renderer web storage added.
- Electron attack surface: no IPC/window/navigation changes or remote content. Existing typed response commands remain unchanged; daemon text stays in React text children.
- Network/I/O: no socket, URL, timeout or reconnect policy change. Existing bridge re-delivery remains authoritative.
- Logs: only static availability event/code; never log conversation IDs, option IDs, question answers or error objects.
- Concurrency: a fresh store read immediately precedes each response helper; no await or automatic submission effect. Disabled native buttons cover mouse and keyboard.
- Threat model: relay-induced disconnect blocks client actions without altering transport security. Main/daemon validation remains the boundary against renderer compromise; this slice claims availability only.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-13
