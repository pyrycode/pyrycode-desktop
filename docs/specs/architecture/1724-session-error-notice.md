# Session error notice (#1724)

## Files read

- `docs/knowledge/INDEX.md`, `CLAUDE.md`: repository contracts and reading map.
- `docs/knowledge/features/conversation-shell.md`: overlay ownership and independent pill occupants.
- `docs/knowledge/features/development-verification.md`: static tests cannot prove navigation cleanup; positive barriers for absence checks.
- `docs/knowledge/features/conversation-timeline-store.md`, `daemon-connection.md`, `conversation-shell-working-indicator.md`: keyed retention, typed dispatch and local send stages.
- `src/main/transport/inboundMessage.ts` → `parseInboundMessage`, `parseStallPayload`: strict object/string narrowing and content-free diagnostics.
- `src/main/daemonConnection.ts` → `createDaemonConnection`: fresh named-field IPC emission and classified decode failures.
- `src/shared/wire/types.ts` → `EnvelopeType`; `src/shared/ipc/events.ts` → `DaemonEvent`: inbound contract.
- `src/renderer/src/store/threadTimeline.ts` → `reduceTimeline`: transient sidecars survive content reconstruction.
- `src/renderer/src/store/timelineBridge.ts` → `subscribeTimeline`, `timelineTargetFor`: explicit conversation routing; reconnect lacks conversation attribution.
- `src/renderer/src/store/conversationTimelineStore.ts` → `dispatchFor`: host-owned retained slices.
- `src/renderer/src/store/daemonEventBridge.ts` → `translateDaemonEvent`: exhaustive non-owning bridge.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `TopOverlayControl`; `TopOverlay.tsx` → `TopOverlay`: store container and pure view.
- Corresponding parser, connection, bridge, reducer and overlay tests; `e2e/status-icon-local-send.spec.ts` and `e2e/fixtures/launchPairedApp.ts`: controlled real sends and encrypted fake frames.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=132-4171

Read design context and screenshot using Figma design-to-code guidance. Reuse the right-aligned Top overlay's existing Error pill: error-container/error colour tokens, body-small text, 8/4 token padding, 6px token radius, shadow and 12px stack gap. No icon or dismiss control; order is usage, resolution, session error, Re-pair. No new styling or assets.

## Context

Startup failure frames currently disappear while local waiting feedback persists. Display one transient conversation-specific explanation without modifying history, messages or the daemon queue. No ADR needed.

Sizing: one independently verifiable behaviour; five criteria; approximately 650 written lines including tests and this plan; zero new exported types/components/stores; fewer than ten simultaneous consumers and reject branches. Re-count before commit remains within all limits.
Overlapping branches #1544, #1721, #1723, #1726 and #1729 were inspected: separate arms/functions or comments; no dependency. Keep edits additive and local.

## Design

Add `session_error` to `EnvelopeType`. The inbound union has `kind: 'session-error'` and a narrowed two-string payload; no daemon message or extras. Emit `DaemonEvent { type: 'sessionError', conversationId, code }` with named fields only. Other exhaustive bridges explicitly ignore it.
`timelineBridge` translates to `ThreadEvent { type: 'sessionError', code }` and routes by the frame's conversation id like stall. No history join identity is minted.
`TimelineState.sessionError?: { code: string }` is a transient sidecar. A session error replaces it and reconciles stale turn chrome to idle, closing `localSendPending` and clearing stalled/retry/compacting/thinking-token feedback. Rows and queue remain untouched. Preserve the sidecar through content reconstruction and received echoes, including idle states. Clear on accepted local `userText`, non-idle `turnState`, reset, or `sessionErrorCleared`.
`TopOverlay` receives an optional session-error code and compares it to the two known literals; every branch returns fixed client copy. No code enters DOM attributes, classes or logs. `TopOverlayControl` reads only the active timeline's sidecar.

## State + concurrency model

All writes are synchronous Zustand reductions. The overlay's effect is keyed only by conversation id; cleanup dispatches `sessionErrorCleared` for the conversation being left, avoiding consumption on replacement. Off-screen notices remain pending until their conversation is displayed.
Add `clearSessionErrorsForHost(serverId)` to the keyed store: iterate retained slices, clearing only matching host notices, preserving rows and unrelated slice references. Extend `subscribeTimeline` with an optional reconnect callback, called with the client-stamped origin; its production caller wires the host clear before existing open-timeline reconciliation. The generic `reconnected` reduction preserves this sidecar, because it lacks host attribution. No new async task, timer or listener lifetime; the existing subscription retains its cleanup.

## Error handling

Reject non-object payloads and missing/non-string required fields with category-only `WireDecodeError`, using existing helpers. Unknown and empty string codes are accepted. Parse before logging; successful decode logs only static frame type, byte length and digest. Existing main failure classification remains content-free. Renderer copy has no wire text. No outbound command, retry, resend or drop action is added.

## Testing strategy

- Parser tables: valid known/unknown/empty strings; ignored hostile message/extras; malformed object, array, primitive and required fields; exact content-free logs.
- Connection: exact two-field session-error IPC data and content-free malformed-frame diagnostics; no emission on rejects.
- Bridge/store: explicit conversation routing, replacement and all preserve/clear edges, stale chrome closure, retained rows, host-specific off-screen clearing and unrelated reference preservation.
- Static overlay: three copies, Error variant without X, coexistence and order.
- Fake-transport Playwright: actual sends, held queue stage, session error, replacement, isolation and next-send/navigation/non-idle clearing; captures at normal and minimum widths. Review all post-send assertions and keep #1725's send-stage coverage.
- Final merged tree: pre-verify check, build and targeted fake specs. No live specs changed; full browser/live tiers remain dispatcher-owned.

## Open Questions

None. A cleaner shape was considered: a separate error store would duplicate conversation and host ownership; the existing timeline sidecar is smaller and preserves established routing.

## Security review

**Verdict:** PASS

- [Trust boundaries] `parseInboundMessage` validates one object and two strings; fresh decode/IPC/ThreadEvent literals strip daemon message and extras. Host origin comes from main's client stamp.
- [Tokens] No new credential access or propagation. Only conversation id and code cross IPC.
- [File/storage operations] No new persistence, path construction or web storage; notices are transient and absent from history serialization.
- [Electron attack surface] No new IPC API or privilege. Existing isolated preload delivers typed events; no remote markup or raw bytes reach the renderer.
- [Cryptographic primitives] Existing Noise session and codec are reused unchanged; no key/nonce operation is added.
- [Network/I/O] Existing plaintext size bound applies before parsing; no new connection, request or timeout. Malformed frames fail closed.
- [Errors/logs/telemetry] Static diagnostic codes, size and digest only. Raw conversation id, session code, message, extra fields and caught errors stay out of diagnostics. UI uses literal comparison and client-owned copy/classes.
- [Concurrency] No awaits between mutations. Navigation cleanup is keyed by conversation rather than notice identity; host reconnect clears held notices without consuming another host's errors.
- [Protocol threat model] Hostile daemon fields cannot reach markup, attributes or logs; Map-based conversation routing prevents prototype-key writes. Malicious relay delay/drop/flood inherits existing Noise/frame bounds; credential storage and renderer process isolation are unchanged. No new out-of-scope finding.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-05
