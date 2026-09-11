# Refusal fallback reporting

## Context and size

Implement #1242 as one refusal-reporting feature, including the operator's recovery action.
The daemon frames explain a refusal; they neither identify a partial message to retract nor change turn or model-label authority.
The refiner estimated 950 written lines and 12 production files plus CSS. The comparable #1238 commits contain 539 additions and 41 deletions, excluding documentation-stage work.
This design expects roughly 950–1100 written lines, 12 production TypeScript files plus CSS, four new exported types/components, no required consumer signature migrations, four acceptance criteria, and fewer than ten recovery transitions.
The line/file ceilings are exceeded under the one-consumer floor: decoding, retained rows and recovery have no independent consumer or independently useful sibling slice. Keep them together.
The remote feature-branch overlap check found no overlapping files after fetching origin.
Codegraph was queried but reported an uninitialized index; source reads supplied the map below.

## Files read

- `src/shared/wire/types.ts` → `EnvelopeType`, `ToolDeniedPayload`: closed framing and required report conventions.
- `src/main/transport/inboundMessage.ts` → `parseInboundMessage`, `decodeHistoryEvent`, `parseToolDeniedPayload`, `requireStringArrayOrNull`: shared live/history validation and content-free diagnostics.
- `src/main/daemonConnection.ts` → the inbound forwarding switch: typed emissions and correlated settings replies.
- `src/shared/ipc/events.ts` → `DaemonEvent`, `HistoryTimelineEvent`, `WithDaemonTs`: conversation attribution and existing history/live join timestamps.
- `src/renderer/src/store/timelineBridge.ts` → `translateTimelineEvent`, `timelineTargetFor`, `subscribeTimeline`: live routing and history translation.
- `src/renderer/src/store/threadTimeline.ts` → `ThreadItem`, `ThreadEvent`, `reduceTimeline`: retained rows and independent status lifetime.
- `src/renderer/src/store/conversationTimelineStore.ts` → `dispatchFor`, `prependHistoryFor`: bounded conversation ownership and history prepending without replacing live scalars.
- `src/renderer/src/store/runSettingsWriteBridge.ts` → `submitSettingsChange`, `RunSettingsWriteData`: correlated writes and app-lifetime subscription ownership.
- `src/renderer/src/store/runSettingsWriteStore.ts` → `pending`, `selectEffectiveSettings`: model selection and rejection behavior.
- `src/renderer/src/store/announcedModelBridge.ts` → `subscribeAnnouncedModel`: announcements arrive independently of held model readings.
- `src/renderer/src/store/sessionIdBridge.ts` → `subscribeSessionId`: session replacement and conversation attribution.
- `src/renderer/src/store/daemonEventBridge.ts`, `modalBridge.ts`, `questionBridge.ts` → exhaustive daemon-event switches: explicit ignore arms required.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `TimelineRow`, `ComposerErrorSlot`, `ComposerErrorSlotControl`: disclosure, row and recovery placement.
- `src/renderer/src/screens/conversation/ComposerModelMenu.tsx`, `runSettingsControls.ts` → `ComposerModelMenu`, `changeSetting`: existing model-setting path and addressability guard.
- `src/renderer/src/screens/conversation/conversation.css` → session-delimiter, disclosure and button-small styles: reuse theme-backed visual vocabulary.
- `e2e/composer-model-menu.spec.ts`, `e2e/stopped-turn.spec.ts`, `e2e/tool-denied.spec.ts`: correlated fake replies, slot priority and real IPC delivery.
- `docs/knowledge/features/conversation-shell.md`, `conversation-timeline-store.md`, `conversation-timeline-store-internals.md`, `run-settings-write-store.md`, `development-verification.md`: reading map, join contract, write authority and static-render limitations.
- Upstream `docs/protocol-mobile.md` → `model_refusal_fallback` and `model_refusal_no_fallback`: shipped required fields and absence of turn identity.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=119-3843

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-5408

Read both design contexts and screenshots. The separator is a compact horizontal label in body-small primary text; the composer places its small filled action at the trailing edge above the input. Reuse that label typography, existing keyboard-accessible timeline disclosure, and `button-small` status-action styling, as approved; these references describe reused treatments rather than new refusal states.

## Design

Add the two wire payload interfaces and envelope names. Both require strings and nullable string-array reports; fallback additionally requires opaque `fallback_model` and open-string `scope`. Reuse identical payload parsers for live and history, preserve empty values and report order, and construct fresh typed IPC values. Drop invalid payloads at the existing exception boundary without emitting events or payload diagnostics.

Represent the two refusal variants as a discriminated IPC event with common camelCase metadata. History omits conversation identity and remains attributed by the requested page. Forward `daemonTs` on both live arms so existing duplicate suppression applies. Add explicit ignores in the three non-owning exhaustive bridges.

Translate both into a retained refusal item. The shared reducer appends it without touching phase, pending sends, stopped-turn recovery, or authoritative model readings. History produces identical items but never an offer. No partial retraction is possible.

Render a one-line, shrinkable, ellipsized title: “Refused on <original>, continued on <fallback>” or “Refused by <original>”, with “unknown model” for an empty identifier. Bound display model identifiers to 256 characters and banners to 8192 characters. Nonempty banners get the existing native button disclosure semantics and a body prefixed “Claude:”; an empty banner has no button. Content is escaped React text, with no dynamic attributes or markup parser.

## State and concurrency model

Keep an optional refusal offer in each existing timeline state, separate from retained items. A live fallback replaces it; only exact session scope with two nonempty identifiers produces an offer. A no-fallback row does not create one. Ordinary turns preserve it. History prepends items only and cannot revive it.

The offer holds the original/fallback identifiers and an optional write correlation. Its reducer handles write start, correlated confirmation/rejection, manual model selection, a new model announcement and session replacement. Confirmation retires only the matching offer; rejection clears its pending marker while retaining it. A different later model announcement, later manual selection, superseding fallback or attributed session transition retires it. Held snapshots/announcements are not consulted, so older readings cannot cancel a fresh offer.

Extend the existing app-lifetime settings bridge with an unsubscribed-on-cleanup observer of new model write intents and live daemon lifetime events. A Switch back handler marks its correlation before dispatching through `changeSetting`; the model-intent observer recognizes that same correlation and preserves the offer. Replies search retained conversation slices by correlation, so switching conversations or a later swap cannot misattribute an old reply. Reconnect abandons pending correlations without creating offers. No new store or command protocol is needed.

The composer reads only the active conversation's offer and current settings/session slices. At click time recheck active identity, offer identity, connected status, session addressability and pending-write guard. Send the original identifier unchanged through `changeSetting`; leave the draft untouched. Keep the action visible but disabled while its write is pending. Existing model-settings rejection copy appears beside the retry action. Connection/re-pair errors and stopped-turn recovery outrank refusal recovery; refusal recovery outranks usage notices.

## Error handling

Malformed fields throw only the existing static `WireDecodeError`; main drops them. Valid frames use existing hashed, length-only decode diagnostics. Recovery dispatch and classified rejection use content-free renderer diagnostics through the shared logger. No daemon prose, model identifier, scope/category value or report token is logged. Settings rejection follows the existing correlated error treatment, not a connection error.

## Testing strategy

- Decoder RED tests cover both narrowed variants, required-field failures, empty/unknown strings, nullable/ordered reports, live/history parity and content-free diagnostics.
- Bridge/reducer tests cover attribution, live/history deduplication, untouched lifecycle/model authority, eligible scopes, ordinary turns, stale readings/replies, manual selection, session replacement and conversation isolation.
- Static renders cover title variants, unknown model, escaped/bounded banner content, empty-banner disclosure absence and slot priority.
- One focused fake-transport Playwright spec exercises real decode/IPC, keyboard disclosure, retained rows, successful and rejected correlated writes, draft preservation, local/no fallback, conversation isolation, retirement and priority at an 800px window.
- Run touched Vitest files, `npm run build`, then the focused approved Electron test helper. Dispatcher owns full regression gates. No live-Claude refusal capture or new live acceptance is required.

## Open questions

None. The operator-approved session-scope recovery is an explicit user action; category remains inert. No model change is initiated automatically from daemon prose.

## Documentation handoff

No documentation-only acceptance criterion or named documentation edit is present in #1242. Pending for the documentation stage: fold the retained refusal and recovery behavior into `docs/knowledge/features/conversation-shell-turn-status.md` and `docs/knowledge/features/conversation-shell-composer-status.md`, and describe its state lifetime in `docs/knowledge/features/conversation-timeline-store.md`.

## Security review

**Verdict:** PASS

- Trust boundaries: payload parsers require every field before main constructs typed events; history attribution comes from request correlation. Validated shape does not make Claude text trusted.
- Tokens: no new credentials or storage. Existing settings correlation uses client-minted IDs, never model text as keys.
- File/storage operations: refusal content stays in existing memory state; no files, web storage, paths or cache keys are derived from it.
- Electron: reuse the validated settings IPC command; no new capabilities, navigation, window preferences or raw transport exposure.
- Cryptography: no Noise, key, nonce or credential changes.
- Network/I/O: inherit `parseInboundMessage`'s plaintext cap and existing transport lifecycle. Render bounds constrain adversarial display text as well.
- Errors/logs: static event codes and lengths/hashes only; category/banner/model/report contents never enter logs or attributes. Unknown category and scope remain accepted strings; scope only gates the explicitly approved user action.
- Concurrency: record-before-send and exact correlation prevent an old reply retiring a superseding swap. All observers return cleanup handles. History and held model readings cannot create or cancel live offers.
- Threat alignment: hostile daemon strings remain escaped text; relay delay cannot confer command authority. Existing main-process transport isolation and safeStorage ownership remain unchanged.

**Reviewer:** builder, self-review using `builder/security-review.md`.
**Date:** 2026-09-11
