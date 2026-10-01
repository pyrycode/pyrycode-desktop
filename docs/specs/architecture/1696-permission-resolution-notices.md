# Permission resolution notices

## Files read

- `src/renderer/src/store/modalPrompts.ts` → `reduceModal`: held prompt supplies ownership; `resolved` is reconnect-scoped suppression.
- `src/renderer/src/store/modalStore.ts` → `modalStore`: pure reducer wrapper and narrow subscriptions.
- `src/renderer/src/store/modalBridge.ts` → `translateModalEvent`: already delivers dismissal source; no bridge change.
- `src/renderer/src/screens/conversation/TopOverlay.tsx` → `TopOverlay`: existing Default pill and exact Figma X.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `TopOverlayControl`: open-chat selection and overlay composition.
- `src/renderer/src/screens/conversation/conversation.css` → `.top-overlay-pill`: existing theme tokens and stack layout.
- `src/renderer/src/store/modalPrompts.test.ts`, `src/renderer/src/screens/conversation/TopOverlay.test.tsx`: reducer and static-render assertions.
- `e2e/permission-modal-answer-paths.spec.ts`, `e2e/composer-usage-limit.spec.ts`, `e2e/banner-reports.spec.ts` → fake frame injection, chat navigation and captures.
- `docs/knowledge/features/modal-prompt-model.md`, `modal-store-bridge.md`, `conversation-shell.md`, `development-verification.md`: reconnect ownership, array scans, static versus interactive proofs, seed only one initial chat.

No overlapping remote in-flight feature branch touches the three production files (checked 2026-10-01).

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4171 and https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6617.

Reuse the right-aligned Top overlay column, its spacing and shadow, and the Default pill's primary-container/on-primary-container tokens, body-small text, padding, radius and existing exact 8px X. Insert the resolution pill between usage and Re-pair. Only the client copy changes; no CSS or asset changes.

## Context

Held permission prompts currently disappear without explanation on remote resolution or timeout. This ticket adds transient chat-owned feedback, separate from history and from duplicate suppression. No ADR is needed.

## Design

Add `ModalResolution` with conversation ownership, a client-selected `remote | timeout` kind and `pending | displayed` phase. `ModalState.resolutions` is an in-memory array with at most one entry per chat. Only a dismissal matching an outstanding prompt can add feedback, and only the two recognized sources do so. Copy the conversation from the held prompt; never retain outcome, prompt text or raw source in the notice. A newer entry replaces the same chat's old entry.

Add local-only `resolutionDisplayed` and `resolutionDismissed` events carrying the held resolution object. The reducer matches object identity, making stale display/expiry/cleanup events no-ops even when a modal nonce is reused after reconnect. Display replaces the pending object with a displayed object. Dismiss removes only that object. Existing `reconnected` leaves feedback intact; `reset` returns the empty initial state.

`TopOverlayControl` selects only its open chat's resolution and dispatches the display event for pending feedback. `TopOverlay` receives only a recognized kind or null and a dismiss callback, with exact client copies “Resolved on another device” and “Request timed out”, and accessible name “Dismiss permission resolution notice”.

## State + concurrency model

The displayed object owns one 4-second timer in a React effect. Cleanup clears the timer and dismisses that same object when the chat changes or the screen unmounts, so returning cannot replay it. Replacement changes identity, cancels the previous timer and begins a fresh timer only after display. Other chats' pending entries remain untouched. Reset removes displayed feedback through the same subscription and cleanup. There are no new async I/O tasks or persistence.

## Error handling

No new I/O or failure modes. Unknown IDs and stale local events are same-reference no-ops. Local answer/cancel remains optimistic and silent, including later daemon dismissal. Reconnect clearing never manufactures a resolution. Follow the existing modal/overlay no-logging policy: prompt content, outcome, IDs and raw sources have no diagnostic sink.

## Testing strategy

- Reducer: both sources, held ownership, unknown and already-removed IDs, local answer/cancel followed by daemon dismissal, other sources, replacement per chat, identity guards, reconnect preservation and reset of pending/displayed notices.
- Static `TopOverlay`: exact two copies, Default treatment, accessible X and usage/resolution/Re-pair order; no daemon outcome or source content in markup.
- New focused fake-transport Playwright spec: injected shown/dismissed frames prove both sources, local silence, chat isolation/deferred display past four seconds, X, navigation without replay, expiry and replacement surviving the old deadline. Capture both copies at normal and minimum window size, comparing to Figma.
- Run touched unit tests, `npm run build`, and only the new Playwright spec. Full suites belong to the dispatcher.

## Open Questions

None. The cleaner shape is reducer-owned pending/displayed feedback with identity-guarded local events, avoiding a second store or component-local feedback that could survive pairing reset.

Sizing: one deliverable, 3 production files, approximately 460 total written lines including plan/tests, 1 new exported interface, 1 view caller, 3 observable acceptance groups, no new error/reject branches. All limits hold.

## Security review

**Verdict:** PASS

- Trust boundaries: `reduceModal` requires a matching held prompt and derives ownership from it; only explicit remote/timeout branches create a client-selected kind. Array value comparisons avoid prototype indexing.
- Tokens: no credentials or keys enter feedback; no persistence or token lifecycle changes.
- File/storage operations: no new disk or web-storage operations; pairing reset clears every feedback entry.
- Electron attack surface: no new IPC, navigation, remote assets or process privileges. `TopOverlay` renders only literal client copy and existing SVG.
- Cryptography: no cryptographic changes; Noise and secrets remain in main.
- Network/I/O: existing parsed modal events are the sole input; no sockets, frame limits, relay policy or timeouts change.
- Errors/logs/telemetry: no daemon text, outcome, source or identifiers enter logs, attributes, URLs or error copy; feedback has no log sink.
- Concurrency: identity-guarded events prevent stale timers clearing replacements; each displayed timer has effect cleanup on replacement, exit and reset.
- Threat model: relay drop/reorder produces no notice without a held matching prompt. Hostile daemon text is never displayed by this notice. Disk theft and compromised-renderer isolation remain covered by existing main-process transport/storage boundaries, which this ticket does not extend.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-01
