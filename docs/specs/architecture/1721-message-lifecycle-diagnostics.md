# Message lifecycle diagnostics

## Files read
- `src/renderer/src/screens/conversation/composerSend.ts` → `submitMessage`: accepted submission and bridge failure.
- `src/renderer/src/screens/conversation/dropQueuedMessage.ts` → `dropQueuedMessage`: local cancellation request.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → composer and queued-row closures: diagnostic wiring below availability gates.
- `src/shared/ipc/diagnostics.ts`, `src/preload/index.ts`, `src/main/receiveDiagnostic.ts` → diagnostic projection and IPC: fresh-object trust boundary.
- `src/main/index.ts` → command registration: route refusal and singleton tracker injection.
- `src/main/daemonConnection.ts` → `send`, queue-state arm: originating host binding and decoded acknowledgments.
- `src/main/transport/noiseSession.ts` → `sendMessage`, `flushBufferedSends`, `close`: preserve per-message observation through rekey buffering.
- `src/main/transport/noiseRelayDriver.ts` → `sendFrame`: encoding/write outcomes.
- `src/main/transport/relaySupervisor.ts`, `relayConnection.ts` → `send`: actual open-socket write boundary and connection lifecycle.
- `src/main/diagnosticLog.ts`, `receiveDiagnostic.test.ts` → serializer and main-only allowlist pin.
- `docs/knowledge/features/outbound-send-path.md`, `diagnostic-log.md`, `diagnostics-channel.md`, `development-verification.md`, ADR 0007: never equate a nonthrowing dispatch with delivery; project rather than forward renderer objects.

## Context
Missing outbound messages currently leave no local trail. This adds diagnostics only, preserving delivery and UI behavior. One deliverable is a correlated lifecycle trail. No ADR is needed. Overlaps with #1544, #1726 and #1728 affect separate logic; shared-file edits stay additive/local.

## Design
A main-owned bounded tracker stores validated UUIDv4 composer ids, their conversation, originating host and transition flags. Renderer lifecycle requests use the existing diagnostic channel with a separate restricted shape. The receiver validates and constructs named values, never forwards these raw records to the logger. Generic projection continues excluding message and connection ids. Queued is recorded before command dispatch; bridge and routing failures become classified drops. Main binds a tracked submission to its actual connection's host before sending.

An optional per-send observer carries a sealed sent/dropped outcome through daemon connection, driver, session, supervisor and relay connection. Existing unrelated senders need no migration. Relay connections mint their own UUID and put it on open/close diagnostics and the observer notification only after `ws.send` succeeds on an open socket. Session buffer entries retain the observer beside their owned plaintext. Successful flushing observes each own write; overflow, abandonment, teardown, refusal and failures observe drops. Observer invocation is guarded against exceptions.

Queue snapshots match held ids by strict equality within originating host and conversation. The tracker emits its held local UUID once, never copies a daemon string into a log. Cancellation records a client-owned local-request reason, including after acknowledgment, with no claim of daemon removal. Snapshots disappearing and sent connections closing do nothing.

## State + concurrency model
Synchronous single-writer Map, capped at 1024 submissions. Oldest retirement silently forgets diagnostic state, never emits a drop. Acknowledged and dropped flags suppress duplicate records. No timers, retries, delivery queues or long-lived tasks are added. Rekey ownership and generation fencing stay unchanged.

## Error handling
Closed reasons: bridge-failed, route-refused, send-refused, send-failed, write-failed, rekey-buffer-full, rekey-abandoned, rekey-teardown, user-cancel-request. Caught objects never reach diagnostics. Diagnostic and observer throws are swallowed; transport behavior stays governed by existing errors. A successful socket handoff remains delivery-unknown until a matching snapshot.

## Testing strategy
- Test composer acceptance/refusal/order and bridge failure through injected effects.
- Controlled snapshots and the real serializer prove local UUID correlation, host/conversation isolation, missing acknowledgments, duplicate suppression, cancellation, bounded retirement and hostile-field exclusion.
- Controlled relay writes prove write-only sent, distinct reconnect/host connection ids and refusal/failure.
- Existing Noise tests gain observations proving rekey wait/flush/overflow/abandonment/teardown without changing cipher behavior.
- Run touched-scope Vitest and `npm run build`. No user-driven behavior changes; existing drop interaction remains unchanged.

## Open Questions
None. Cleaner-shape review: retain one tracker and optional observers rather than expanding every command sender or introducing another queue.

## Sizing
Estimated total written work: 760 lines including plan/tests; 4 new exported types/interfaces, 8 simultaneous production consumers, 5 observable acceptance criteria, 9 classified discard reasons. Fits all five boundaries.

## Security review
**Verdict:** PASS
- Trust boundaries: restricted lifecycle projection validates UUIDv4, conversation type/length and fixed event values; only held ids reach serializer. Daemon queue ids are comparison-only. Main-only connection ids stay outside renderer projection.
- Tokens/secrets: no text, attachments, token, keys, bytes or caught strings enter lifecycle records; no credential changes.
- File/storage: existing capped rotating diagnostic sink under userData is reused; no new paths or persistence.
- Electron: existing isolated bridge/channel only, no new capabilities; restricted lifecycle records are intercepted before generic forwarding.
- Crypto: existing Noise variant, cipher operations and nonce ordering remain unchanged; connection ids use Node randomUUID.
- Network/I/O: existing socket OPEN guard, frame limits and supervisor teardown retained; successful handoff is observed only after socket send returns.
- Errors/logs: fresh literals contain static events/reasons, validated held UUID and main-generated connection UUID; observers/logger calls cannot throw into sending.
- Concurrency: observers move with buffered plaintext; splice-before-flush and generation fencing preserved; bounded tracker retirement emits nothing.
- Threat alignment: compromised renderer strings fail UUID/event validation; hostile daemon ids cannot create records or bypass host/conversation correlation; relay drop/delay leaves delivery unknown and does not trigger invented retries.
**Reviewer:** builder, self-review per builder/security-review.md
**Date:** 2026-10-05
