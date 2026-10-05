# Host system prompt in Edit host

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: process isolation, static-render test limits and positive completion barriers.
- `docs/knowledge/features/channel-list.md`, `docs/knowledge/features/edit-host-dialog.md`, `docs/knowledge/features/edit-channel-dialog.md`: selected-host identity, modal lifetime and prompt presentation.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `ChannelList`: host label persistence and unpair effects.
- `src/renderer/src/screens/channels/EditHostDialog.tsx` → `EditHostDialogView`, `requestSetHostLabel`: controlled view and typed name failure.
- `src/renderer/src/screens/channels/EditChannelDialog.tsx` → `EditChannelDialogView`: escaped prompt, UTF-8 bound and dialog-scoped draft.
- `src/renderer/src/components/Modal.tsx`, `modal.css`, `screens/channels/channels.css`: constrained whole-panel scrolling and theme tokens.
- `src/main/serverRouter.ts` → `createServerRouter`: explicit selected-host resolution without arbitrary fallback.
- `src/main/daemonConnection.ts` → `createDaemonConnection`: monotonic request IDs, generation guard, authenticated state and pending correlation.
- `src/main/transport/inboundMessage.ts` → `parseInboundMessage`: defensive named-field parsing.
- `src/shared/wire/types.ts`, `src/shared/ipc/commands.ts`, `events.ts`: fixed wire verbs and IPC allowlist.
- `src/main/index.ts`, `src/renderer/src/store/daemonEventBridge.ts`: command wiring and exhaustive event consumer.
- `src/main/daemonConnection.test.ts`, `e2e/fixtures/launchPairedApp.ts`, `conversationStateFake.ts`: fake driver and encrypted multi-host integration seams.
- Upstream `internal/protocol/host_system_prompt.go`, `docs/protocol-mobile.md` → Daemon-wide host system prompt: required strings, empty clearing and durable correlated reply.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=778-10211 (empty), node 778-10265 (filled), node 780-10336 (default).

Viewed design contexts and screenshots. A 640px dark Modal contains identity rows, name, prompt and actions in one column. Prompt uses the channel's filled borderless textarea (112px minimum, grows for the longer default), body-medium text, then body-small on-surface-variant helper beside an outlined Reset to default. The reset disappears at verbatim default equality. Existing tokens supply 28px horizontal/24px vertical padding, 12px content gaps, 6px radius and primary outlined buttons. Whole-panel scrolling keeps controls reachable in short windows.

## Context

The daemon now exposes durable host instructions independently of conversations. This modal is the sole product consumer. Keep the transport and consumer together under the ticket's sizing-floor exception: estimated 1200–1400 written lines, exceeding 800; no independently verifiable split without a one-consumer prerequisite. Four new exported types/components, fewer than ten consumer updates, five observable criteria and at most ten failure branches. No ADR required.

In-flight overlaps: #1544, #1658, #1721, #1724 and #1726 touch shared files. Their diff blocks concern config refresh, channel controls, send-message, session errors and queue actions; this feature adds local host-prompt cases and does not depend on or restructure their blocks.

## Design

Wire adds `request_host_system_prompt`, `set_host_system_prompt`, `host_system_prompt`. Read payload is `{}`; write is a fresh `{ system_prompt: string }`; reply contains exactly the named required current/default strings. No session or conversation fields. Reuse `MAX_SYSTEM_PROMPT_BYTES`.

IPC commands require selected `serverId` and a bounded nonempty client `requestId`; writes carry the wire payload. Main resolves that host through `createServerRouter`, refuses unknown hosts with a fixed failure event, and never forwards routing or correlation metadata in payloads. Events carry requestId, read/write operation and named text fields, stamped with main-owned server origin. Other exhaustive consumers explicitly ignore them.

A dialog-scoped Zustand controller owns read/draft/save transitions. A new `EditHostDialog` container wraps the existing view, keeping the parent name persistence and unpair effects. The view receives a sealed prompt state and callbacks, uses inert controlled textarea text and computes its byte notice. Name persistence returns a success boolean; it updates the name store even when a subsequent prompt write fails. Only a matching durable prompt reply closes after a changed draft. Unchanged or unread prompt sends no write.

## State + concurrency model

Prompt states: reading, read-failed, ready (original/default/draft), saving-name and saving-prompt; save failure retains the ready draft plus fixed failure copy. Every opening constructs a fresh controller and request identifier, subscribes before its single read, and releases event/session subscriptions on dismissal. Duplicate and wrong-host/request replies do nothing. Reset changes only draft. A synchronous save lock blocks a second OK, edits, reset and unpair across both name and prompt waits. Cancel and Close remain available. Late label/unpair continuations may update durable stores, but a captured interaction identity prevents them changing a newer dialog.

Main holds separate read/write correlation maps keyed by envelope ID, carrying only client request IDs, operation and deadline handles. Each result consumes one pending entry. A 15-second deadline reports fixed failure and removes the entry without retry. Disconnect, stop and connection replacement fail outstanding waits and clear timers/maps; driver generation rejects stale socket callbacks. Renderer connection loss cancels its save continuation and preserves unsaved draft with failure, preventing a name result after reconnect from launching an old write. Controller teardown cancels subscriptions and rejects all late state mutation.

## Error handling

Runtime IPC checks required strings, identifier bounds and write shape. Main refuses over-limit UTF-8 text before sending; parser bounds both reply strings, rejects missing/null/non-string fields and returns only named fields. Correlated errors of any code settle failure without exposing daemon messages; protocol.malformed and host_system_prompt.unavailable require no invented session verdict. Route, disconnected, send, timeout and malformed-read outcomes use fixed copy. No automatic retry: reopening reads; OK retries writes explicitly. Prompt read failure leaves name editing and dismissal usable.

## Testing strategy

- Test first: decoder/IPC invalid shapes, named-field stripping, explicit empty and multibyte byte boundaries.
- Fake driver tests exercise separate read/write correlation, duplicates, uncorrelated errors, deadlines, local refusal, send failure and connection replacement.
- Controller tests exercise wrong host, duplicate read, reset/dismiss/reopen, save lock, retained failed draft and late name outcomes after disconnect.
- Static view tests cover field/helper, reset equality, reading gate, notice and busy controls.
- One ticket-owned fake-transport Playwright spec proves selected-host read/write through the mounted encrypted app, whitespace/empty clearing, reset/cancel, failure/reopen and short-window control reachability. Capture empty, filled and long-default states at regular and constrained widths, then compare to Figma.
- After final main merge: pre-verify (typecheck/full units), build, focused fake tier. No live Claude test needed or changed.

## Open Questions

None. The cleaner shape is a dialog-local controller with injected name persistence, avoiding a global prompt cache or a second application-wide bridge.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] IPC validates required host/request strings and write string shape; `parseInboundMessage` validates/bounds required reply strings. Fresh literals strip extra fields. Correlation, never daemon-supplied host text, determines attribution.
- [Tokens] No new credentials or token lifecycle. Existing safeStorage and main-owned Noise session remain the credential boundary; renderer receives text and typed outcomes only.
- [File/storage] No new paths, files or renderer persistence. Durable prompt storage remains daemon-owned. Draft/default text is ephemeral memory with no persist/devtools middleware.
- [Electron] Existing isolated sandboxed window and fixed IPC pipe stay intact. New commands expose only host prompt read/write, no raw socket, filesystem, navigation or executable capability.
- [Cryptography] No cryptographic change. Existing Noise_IK_25519_ChaChaPoly_BLAKE2s handles authenticated encrypted frames. Request IDs are correlation metadata, not secrets.
- [Network/I/O] Existing frame cap, TLS/relay validation and handshake apply. Both reply fields are UTF-8 bounded; pending requests have 15-second deadlines and no automatic retries.
- [Errors/logs] Only static event names/codes and operation are logged. Prompt/default, daemon error messages, caught exceptions, keys and tokens never enter logs or exception messages. Exhaustive consumers ignore these events before their assertNever fallback.
- [Concurrency] Separate bounded-lifetime read/write maps consume once and cancel on replacement/stop. Driver generation and dialog interaction identity prevent stale outcomes. Save locks span name persistence and durable prompt reply while dismissal remains enabled.
- [Threat model] A malicious relay can delay/drop but cannot inspect Noise text or hold pending requests indefinitely. Hostile replies are parsed and bounded. Compromised renderer can request this narrow authorized setting but cannot access keys/socket. Disk token protections are inherited unchanged; no new disk copy of prompts exists.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-05


## Revisions

2026-10-05: Implementation also reads `connectionRegistry.ts` → `viewOf` and its fake, and `modalBridge.ts`, `questionBridge.ts`, `timelineBridge.ts` → their exhaustive translators. Add the two host methods to the lifecycle-free facade and explicitly ignore host events in every translator; the contracts are unchanged. A read arriving during local name persistence now seeds the saved previous prompt state, so a failed name write restores that reading instead of losing it. A regression test proves this race. CSS `field-sizing: content` grows the textarea from four lines to the fourteen-line cap for the long default; scrolling remains native. The Linux hidden Electron fixture requires `capturePage` plus a paint barrier to capture its current frame. Written work is approximately 800 lines including plan/tests, with five new exported types/components/store surfaces and fewer than ten consumer updates.
