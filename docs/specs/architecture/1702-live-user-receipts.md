# Live user message receipts

## Files read

- `src/main/transport/inboundMessage.ts` → `parseInboundMessage`, `FrameTimestamp` — message narrowing and content-free decode diagnostics.
- `src/main/daemonConnection.ts` → `createDaemonConnection` — forwards admitted messages through the existing IPC channel.
- `src/shared/ipc/events.ts` → `DaemonEventTimestamp`, `HistoryTimelineEvent` — live envelope time and history's conversation-free shape.
- `src/renderer/src/store/timelineBridge.ts` → `translateTimelineEvent`, `timelineTargetFor`, `subscribeTimeline`, `liveJoinKeyFor` — translation, attribution and history joins.
- `src/renderer/src/store/threadTimeline.ts` → `ThreadEvent`, `reduceTimeline`, `reduceTimelineContent` — local echo, chrome sidecars and ordered rows.
- `src/renderer/src/store/conversationTimelineStore.ts` → `dispatchFor`, `withoutHeldEchoes` — retained slices and held-row precedence on history prepend.
- `src/renderer/src/store/conversationUnread.ts` → `isConversationUnread` — new content increases the retained item count.
- `src/renderer/src/screens/conversation/foldQueuedRows.ts` → `foldQueuedRows` — matches queued snapshots to existing rows by identity.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`, `seedConversationsFrame` — actual encrypted envelope delivery into the built app.
- `docs/knowledge/features/thread-timeline.md`, `conversation-timeline-holder.md`, `conversation-timeline-store-history.md`, `inbound-message-decode.md`, `daemon-connection.md`, `conversation-unread.md` — existing history, retention, transport and unread contracts.
- `docs/knowledge/features/development-verification.md` — hold a fake reply until the optimistic echo is observed; require positive receipt delivery evidence before checking duplicates.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4171

Read design context and screenshot for Message area. User messages use the existing right-aligned rounded blue Message row, body-medium text in on-primary-container, and a right-aligned body-small time/copy meta row in inverse-primary. Reuse `Timeline` and its existing theme-token styling without a new component or visual asset.

## Context

The daemon now pushes confirmed user messages to all clients. Desktop decodes the payload but fails to route it to the retained thread and treats translated receipts as local sends. This ticket makes one behavior complete: receive another device's message immediately, while preserving the sender's held echo once.

Sizing: five production files, about 550–650 total added lines including tests and this plan, zero new exported declarations, no consumer signature migration, four acceptance criteria and no new error state machine. Within the ticket's ~600-line estimate and all six limits. Codegraph is unavailable (index not initialized); repository search supplies the symbol map. Overlaps with #1544, #1657, #1694 and #1699 affect independent connection/decode blocks; no dependency on those changes.

## Design

- Mix `FrameTimestamp` into the decoded message arm; forward its `ts` as `daemonTs` through `createDaemonConnection`. Correct timestamp source contracts in these files and the IPC comment.
- Route only role-user live messages with a non-empty conversation id. Empty ids and other roles reach no retained timeline; do not infer the open conversation.
- Add optional `received?: true` to `ThreadEvent`'s existing `userText` arm. The bridge sets it for both live and history receipts. Existing composer events remain unchanged and still open `localSendPending`.
- Live receipt translation converts a bounded, finite parse of `daemonTs` to epoch milliseconds. Missing, empty, overlong or invalid times yield absent `createdAt`; never read the arrival clock for a receipt. History translation has no `daemonTs`, so it remains unstamped.
- Before any content or sidecar fold in `reduceTimeline`, return the exact held state for a received user event whose non-empty message id matches a held user row. This preserves position, text, time, attachments and every chrome scalar. Empty/absent ids never deduplicate; equal text has no significance.
- A fresh receipt appends using the existing user-row reducer but carries `localSendPending` unchanged. Existing queued folding and `withoutHeldEchoes` retain the held row. Messages remain excluded from timestamp-based live/history suppression because history joins them by message id.

## State + concurrency model

No new store or async task. `subscribeTimeline` retains its unsubscribe lifecycle. The fan-out writes synchronously to the flat and retained stores; attribution uses the receipt's named id. A new retained slice uses the existing seed and retention bound. Background receipt growth feeds `isConversationUnread` without changing read marks. Identity detection and append occur in one pure synchronous fold, including when history arrives before a receipt.

## Error handling

Keep existing decode size/shape guards and connection catch/drop behavior. Unusable date text removes only the time, never the message. Existing `inbound-decoded` message diagnostics already record static event code, byte length and payload hash; no new content logging. No received attachment parsing or wire-schema change.

## Testing strategy

- Unit tests prove envelope timestamp decoding and IPC forwarding, including malformed display timestamps remaining receipts.
- Bridge/store tests prove named routing, held/new slices, unchanged other slices, unread count, no empty-id or other-role routing, no arrival/replay clock and missing/invalid timestamp fallbacks.
- Reducer tests prove exact-reference duplicate no-ops with full chrome and attachments, repeated receipts, held history, equal text/distinct ids and empty/absent ids; fresh receipts preserve both pending states and local submission retains its Thinking behavior.
- Join tests exercise receipt → history and history → receipt, plus queued folding retaining a single held row.
- A focused fake-transport Playwright spec pushes an actual message envelope, checks its visible daemon time, observes a local optimistic echo before its correlated receipt, and uses a later positive stream marker before asserting the echo still draws once. Capture the received and echo states at 1280×800 for Figma comparison.
- Run touched Vitest files, `npm run build`, and the focused Playwright spec through the approved Electron helper. Full suites belong to the verifier; no live Claude check is required.

## Open questions

None. The optional receipt marker avoids a new event discriminant and consumer cascade while making local-vs-received semantics explicit.

## Documentation handoff

No documentation requirement was named in the ticket. Documentation-stage package updates, if needed, are pending in `docs/knowledge/features/thread-timeline-internals.md` (user events), `conversation-timeline-store.md` (bridge routing), and `inbound-message-decode-contract.md` (message timestamps).

## Security review

**Verdict:** PASS

- [Trust boundaries] `parseInboundMessage` remains the single plaintext admission boundary with `decodeEnvelope` and `parseMessagePayload` validation. Daemon text remains untrusted display content; conversation ids enter only the existing retained `Map`.
- [Tokens, secrets] No credential changes or exposure. Message ids are non-secret identity comparands, never logged or rendered; strict equality is appropriate.
- [File/storage] No new paths or web storage. Existing protected chat-history observation records received state; storage ownership and encryption remain unchanged.
- [Electron attack surface] Existing typed IPC receives only admitted payloads and timestamp strings. No new bridge API, window, navigation, raw markup, attribute or URL sink; existing `Timeline` escapes message text.
- [Cryptography] No crypto, nonce or key changes; Noise and raw bytes stay in main.
- [Network/I/O] Existing plaintext/frame caps and relay lifecycle remain in force. Bound date parsing to 64 characters and accept only finite epoch values; unusable values draw without time.
- [Logs] Existing static-code, bytes and hash diagnostics cover receipt admission. Never log message text, ids, timestamps, attachments or secrets.
- [Concurrency] Pure synchronous held-row comparison and fold; no await or new subscription. Duplicate rejection precedes every sidecar mutation.
- [Threat model] A hostile daemon can choose message identity and hide a later conflicting receipt with the same id; accepted because it already controls conversation content. Suppression requires a non-empty id and applies only within one thread. A compromised relay still cannot forge Noise plaintext; renderer compromise gains no new transport capability.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-01
