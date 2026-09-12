# Permission requests in the bottom panel

## Files read

- `src/renderer/src/screens/conversation/PermissionModal.tsx` — `PermissionModal`, `PermissionModalView`, `RejectionSurfaceView`: existing answer and rejection presentation.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` — `ComposerSlot`, `Composer`, `QuestionPanelSlot`: placement, draft lifetime and local active question.
- `src/renderer/src/screens/conversation/QuestionPanel.tsx` — `QuestionPanelView`: existing title, native choice inputs and action styles.
- `src/renderer/src/screens/conversation/conversation.css` — questionnaire and permission rules: shared tokens and scroll geometry.
- `src/renderer/src/screens/conversation/modalResolution.ts` — `selectOption`, `resolvePendingOption`, `answerPrompt`, `cancelPrompt`: unchanged command and confirmation contracts.
- `src/renderer/src/store/modalPrompts.ts` and `modalStore.ts` — `reduceModal`, `ModalState`: FIFO, suppression, rejection and reconnect lifetimes.
- `PermissionModal.test.tsx`, `composerSlot.test.tsx`, `interactiveRoundtrip.test.tsx` beside the views; `src/renderer/src/store/modalPrompts.test.ts` — existing structural and reducer proofs.
- `e2e/permission-modal-answer-paths.spec.ts`, `e2e/question-picks.spec.ts`, `e2e/fixtures/launchPairedApp.ts` — wire capture, questionnaire retention and seeded chat identity.
- `e2e/real-claude-permission-modal.spec.ts`, `e2e/real-claude-question-cancel.spec.ts` — `answerAllow`: live consent drives.
- `docs/knowledge/features/conversation-shell-permission-modal.md`, `conversation-shell-question-panel.md`, `modal-store-bridge.md`, `development-verification.md` — rejection lifetime, native hidden, static-render limitations and focused Electron gate.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6913

Surrounding component: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6015

The inspected node has a small tertiary uppercase title beside the existing Pyry mark, a rounded bordered content box, vertically stacked radio rows, a separator and trailing outlined Cancel / filled Continue buttons. Reuse the questionnaire's existing components' CSS vocabulary and theme tokens; permission adaptation omits Other, tabs and navigation. Unlike the sample's single-line question, permission explanations wrap fully inside a scrollable body with actions outside the scrollport.

## Context and size

One deliverable: relocate existing permission/trust interaction to the open chat's input area. No wire, bridge or consent-policy changes. The refiner estimated 750 lines; comparison with the panel portions of `cee366d` and plan `7e11fb1` supports approximately 740 written lines here: 230 production/styles, 410 tests and 100 plan. Three production TypeScript files plus the existing stylesheet; zero new exported types/components/stores; four direct view/container call sites to adapt; five acceptance criteria; no new state-machine reject branches. No feature-branch file overlap after fetching origin. Codegraph returned uninitialized, so source reads establish consumers. No ADR needed.

## Design

`ComposerSlot` selects the first outstanding permission matching its non-null conversation ID. It mounts `PermissionModal` in `beforeComposer` and removes the old screen-level overlay mount. The normal composer is covered whenever that prompt or a questionnaire exists. A native hidden wrapper preserves the questionnaire slot and its model footer while permission is present; no wrapper changes the visible questionnaire geometry.

`PermissionModalView` remains a pure view. It receives a selected option and an explicit Continue handler in addition to the existing confirmation effects. Native same-name radio inputs choose one supplied option without sending. Continue calls the existing `selectOption` gate; a supplied default answers immediately, every other supplied option opens Back/Confirm within the same panel. Default indication uses visible client-owned “Default” copy. Explanation and option labels remain escaped React children.

The container holds request-scoped selection and confirmation markers. `resolvePendingOption` validates both against the current prompt and current options on every render. Invalid markers are cleared so removing and restoring an option cannot resurrect selection or confirmation. Chat switches retain their existing remount behavior. No request matches a null conversation.

Keep the existing rejection ID read contract. Add `rejectionOwners` records using the existing `ResolvedModal` shape; `reduceModal` copies ownership from outstanding/resolved prompts at rejection time. Reconnect keeps these records with their feedback, while Dismiss and pairing reset collect them. Unknown rejection IDs have no visible chat attribution. The container filters feedback by these owners. Feedback is in normal flow above the input panel, and never causes composer coverage.

## State and concurrency

Existing modal, question-batch and picks stores remain separate. The composer draft and questionnaire active index stay in mounted component state. Native hidden removes covered controls from layout, keyboard focus and the accessibility tree; the hidden wrapper has no author display override. No new async task or subscription lifecycle is introduced; `useModalBridge` and existing transport cancellation remain unchanged. Answer/cancel continue their synchronous guarded send and optimistic dismissal, advancing current-chat FIFO.

## Error handling

Existing command validation, main-process structured modal lifecycle/error logging and content-free rejection copy remain in force. No text, option label, prompt ID or draft is added to logs. Rejection feedback is independent from actionable prompts and retained through reconnect. No new network or IPC failure mode is introduced.

## Testing strategy

- RED then GREEN: update pure-view assertions for nonmodal region, native single choice, disabled Continue, confirmation and escaped text; add reducer ownership/reconnect/dismissal tests and slot precedence/null-chat assertions.
- Focused fake permission spec: default and non-default Continue, Back/Confirm, both request classes, cancellation, remote dismissal, FIFO/chat attention, removed selection, delayed rejection and chat-scoped Dismiss. Add coexistence coverage for draft, picks, Other text, active index and hidden keyboard/accessibility isolation.
- Run touched vitest files, `npm run build`, focused permission Playwright and existing question-picks Playwright. Capture normal and long content at 1280×800 and 800×600; inspect against Figma.
- Adapt both live `answerAllow` helpers to select then Continue then optional Confirm. Execution of `npm run e2e:real:gate` is pending dispatcher/operator; require an executed permission round-trip with the existing tool effect, never an all-skipped pass.

## Open questions

None. Preserve existing chat-switch remount behavior; only temporary permission coverage retains active questionnaire position and draft.

## Documentation handoff

Pending documentation stage: update `docs/knowledge/features/conversation-shell-permission-modal.md` (presentation and Rejection surface) and `docs/knowledge/features/conversation-shell-question-panel.md` (composer placement) to describe the current-chat bottom panel, explicit Continue step and permission precedence with state retention.

## Security review

**Verdict:** PASS

- Trust boundaries: `PermissionModalView` only renders parsed daemon text as React children. Supplied IDs are used only for correlation; current prompt membership is checked by `resolvePendingOption` before Continue/Confirm. The daemon retains authority over supplied answers.
- Tokens/secrets: no token generation or storage changes; answer tokens remain main-owned. No credential reaches this view.
- File/storage operations: all added state is in-memory; no filesystem or browser storage sink.
- Electron surface: no new IPC channel, window or navigation; the existing command bridge and main-side validation remain. Native inputs use client-owned names, never daemon text attributes.
- Cryptography: no crypto changes; existing Noise transport remains entirely in main.
- Network/I/O: no new I/O, retry or frame parser; existing transport limits remain outside this placement change.
- Errors/logs: content-free rejection copy only, existing main structured lifecycle/error logs retained. No additional untrusted value logging.
- Concurrency: markers validate both request identity and current option membership; removed markers clear before they can be revived. Independent hidden questionnaire state cannot become a permission payload. No awaits occur between choice validation and command dispatch.
- Threat alignment: delayed or reordered remote dismissal cannot arm another request; reconnect can resurface outstanding consent without transferring an old selection. Hostile display text stays escaped. Broader consent additions remain in #1253.

**Reviewer:** builder, self-review using `builder/security-review.md`.
**Date:** 2026-09-12.

## Revisions

2026-09-12 — The logging audit found generic transport diagnostics but no permission lifecycle diagnostics. Add static, content-free events at `createDaemonConnection`'s existing modal shown/dismissed/rejected and answer/cancel boundaries, including unavailable/send-failed classifications. This satisfies the builder's required feature logging without introducing renderer logging or changing transport behavior. Read `src/main/daemonConnection.ts` (`answerModal`, `cancelModal`, `onDriverEvent`) and its existing `daemonConnection.test.ts` capture helpers; no remote branch overlaps these files. The scope is now four production TypeScript files plus the stylesheet, about 650 written lines, and no new exported contract. Security re-review: PASS; logs accept no IDs, tokens, labels, plaintext or caught error objects.
