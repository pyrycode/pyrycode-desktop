# Suggested next reply

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: process placement, static-render limits and mounted browser proof.
- `docs/knowledge/features/conversation-shell.md`, `conversation-shell-composer.md`: retained drafts and existing input treatment.
- `docs/knowledge/features/inbound-message-decode.md`, `daemon-connection.md`, `daemon-event-channel.md`: fail-closed decoding, named-field IPC and synchronous handshake ordering.
- `src/shared/wire/types.ts` → `EnvelopeType`; daemon `docs/protocol-mobile.md` → `reply_suggestion`: published payload contract.
- `src/main/transport/inboundMessage.ts` → `parseInboundMessage`; `src/main/daemonConnection.ts` → `onDriverEvent`: live-only decode and forwarding.
- `src/shared/ipc/events.ts` → `DaemonEvent`; `src/main/emitDaemonEvent.ts` → `bindServerOrigin`: client-owned host attribution.
- `src/renderer/src/store/{daemonEventBridge,timelineBridge,modalBridge,questionBridge}.ts`: exhaustive translators must explicitly ignore suggestion events.
- `src/renderer/src/store/sessionIdBridge.ts`, `composerDraftStore.ts`: open-chat session identity is insufficient; drafts are independent transient state.
- `src/renderer/src/App.tsx`, `screens/conversation/ConversationScreen.tsx` → `Composer`, `handleKeyDown`; `conversation.css` → `.composer__input::placeholder`: app-lifetime subscription and existing input sink.
- `e2e/fixtures/launchPairedApp.ts`, `e2e/banner-reports.spec.ts`, `src/main/transport/banner.test.ts`: fake transport, navigation/reconnect and diagnostic patterns.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-5408

Read design context and screenshot of Input area. Keep Input large, footer and status layout. Suggestion uses the existing body-medium input typography and grey `--color-on-surface-variant` placeholder; no CSS/assets change.

## Context

Daemon-owned suggestions currently disappear as unmodelled frames. One deliverable connects validated transient state to the existing composer. No history row, command, persistence or ADR is needed. Overlaps #1544, #1729, #1731 and #1738 are local additive edits or different functions; none supplies a required dependency.

Sizing: approximately 700 written lines (190 production, 430 tests, 80 plan); at most four new exported types/components/stores, one product consumer, five observable criteria, fewer than ten rejection branches. #1341 implementation inserted 492 lines; its full plan/test path is the nearest analogue. The finished plan remains within all ceilings.

## Design

- Add `ReplySuggestionPayload` and `reply_suggestion` to the published wire surface: required strings `conversation_id`, `session_id`, positive safe-integer `revision`, and required `suggested_reply: string | null`.
- Narrow in main: nonblank single-line text, valid Unicode scalar values, UTF-8 byte length at most 1024. Preserve text verbatim, including surrounding spaces. Explicit null alone clears. Reuse the existing fatal UTF-8 envelope decoder and frame size bound.
- Forward only named fields as `DaemonEvent { type: 'replySuggestion', conversationId, sessionId, revision, suggestedReply }`; existing bound sink stamps host identity. Four exhaustive translators explicitly return null.
- New transient Zustand store owns nested host/conversation Maps. Each conversation holds current session identity and per-session text/revision records. First suggestion establishes identity if unobserved; a transition establishes it authoritatively, including empty new-session ids. Mismatched sessions are ignored. Keep old session watermarks across transitions, preventing replay if identity cycles back.
- `ReplySuggestionData` mounts once in App and synchronously feeds typed events into the store. `connected` deletes that host's whole map; `sessionTransition` clears old text and sets identity; non-idle `turnState` clears text while retaining watermarks. Idle and unrelated events do nothing.
- Composer selects only its host/conversation's current-session text. Exact empty draft displays suggestion via native placeholder; all other drafts use “Message…”. This ticket explicitly authorizes this inert placeholder attribute sink for daemon text.
- After slash completion declines a key, unmodified non-composing Tab with empty draft and suggestion writes the normal retained draft, prevents traversal and places selection at its end. Existing textarea ref/layout effect provides caret placement after React commits. No send path is invoked.

## State + concurrency model

Store updates and the single app-lifetime event subscription are synchronous; no await or second reconciliation queue. Successful handshake clears before daemon reconciliation on the same ordered channel. Off-screen state stays held across navigation; only host reconnect clears watermarks. Subscription cleanup removes the listener. No new async work or persistence. Draft state remains separate and untouched by all invalidations.

## Error handling

Malformed payloads throw only static category `WireDecodeError` messages and are caught/dropped by the existing main boundary. Valid frames log static decode code, byte length and hash; malformed suggestion frames log a static rejection code only. No text, ids, raw payload or caught exception crosses diagnostics. Revision/session replays silently no-op in the renderer.

## Testing strategy

- Vitest: valid null/text/UTF-8 limits, all missing/mistyped fields, unsafe revisions, multiline/blank/unpaired-surrogate text, content-free diagnostics and exceptions, exact main IPC fields.
- Vitest: host/conversation/session isolation, duplicate/lower revisions, null watermarks, transition replay, non-idle invalidation, idle preservation and reconnect reset before low-revision reconciliation; four translators safely ignore content.
- Fake-transport Playwright: mounted delivery, empty/whitespace/edited drafts, Tab focus/caret/editability/no-send, modified/IME/ordinary Tab, slash completion, authoritative clears, off-screen chat/host isolation and reconnect. Capture synthetic placeholder at 1280×800 and 800×600 and compare with Figma.
- Final main merge, pre-verify and build; run the focused browser spec. No live-Claude test required.

## Open Questions

None. Implementation may reuse the existing textarea ref; any required contract change will be recorded in Revisions.

## Security review

**Verdict:** PASS

- [Trust boundaries] `parseInboundMessage` validates all required fields once; named-field IPC excludes extra daemon keys. Store uses bound `serverId`, never daemon ack identity. Native inert placeholder is explicitly requested by this ticket.
- [Tokens] No credentials added or logged; only display text and routing ids cross existing receive-only IPC.
- [File/storage] State uses memory Maps only, no disk/web storage, filenames or text-derived keys.
- [Electron attack surface] No channels, commands, navigation or window security changes. Four exhaustive translators explicitly exclude suggestions from exception-producing defaults.
- [Cryptography] Existing Noise variant, keys, counters and decrypt path are unchanged in main.
- [Network/I/O] Existing frame bound and fatal UTF-8 decoding apply; suggestion additionally has a 1024-byte contract cap. No socket or retry change.
- [Errors/logs] Static categories only on rejection; valid diagnostics contain code/length/hash, never suggestion text or payload. Main drops caught errors.
- [Concurrency] One synchronous listener orders host reset ahead of reconciliation; revisions and session identity reject delayed/replayed state; cleanup unsubscribes.
- [Threat model] Hostile daemon payloads fail closed; relay replay/delay cannot overwrite higher revisions or cross hosts/sessions. Renderer receives escaped display text only and gains no raw socket/key access; existing safeStorage credential ownership is unchanged.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-06
