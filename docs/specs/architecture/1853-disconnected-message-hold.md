# Disconnected message delivery

## Files read

- `src/main/daemonConnection.ts` → `send`, `loadDialConfig`, `onDriverEvent`, `emitFailed`, `dial`: authenticated delivery and pairing lifetime.
- `src/main/transport/noiseRelayDriver.ts`, `noiseSession.ts`, `relayConnection.ts`, `sendObservation.ts` → `sendMessage`, `notifySend`: refusal versus socket write, including authoritative rekey buffering.
- `src/main/index.ts`, `receiveCommand.ts`, `conversationRouter.ts`, `connectionRegistry.ts` → send command routing, validation, host ownership and removal.
- `src/shared/ipc/events.ts`, `commands.ts`, `src/preload/index.ts` → typed commands, stamped events and receipt host context.
- `src/renderer/src/screens/conversation/composerSend.ts`, `ConversationScreen.tsx`, `foldQueuedRows.ts` → echo creation, attachment rollback, fixed-copy metadata and pending projection.
- `src/renderer/src/store/threadTimeline.ts`, `timelineBridge.ts`, `conversationTimelineStore.ts` → stable echo identities, receipt placement, active and retained timeline writes.
- `src/main/daemonConnection.test.ts`, `src/renderer/src/store/queuedEchoSettlement.test.ts`, `e2e/queued-own-settlement.spec.ts`, `e2e/fixtures/launchPairedApp.ts` → deterministic drivers, real stores and mounted fake-daemon proof.
- `docs/knowledge/features/daemon-connection-lifecycle.md`, `composer-send-internals.md`, `conversation-shell-composer-error-chip.md`, `development-verification.md` → generation fencing, destructive attachment take, fixed error copy and mounted verification requirements.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4 and https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-5408. Read both contexts and the composer screenshot. Keep the desktop sidebar/thread/footer layout; delivery labels use existing message metadata and `composer-status__error` treatment, with existing theme typography/colour/spacing. Existing Reconnect and Re-pair controls remain the recovery affordances.

## Context

An optimistic echo currently outlives a refused transport send without telling its owner. Hold only accepted composer payloads known never written to the socket, during this app run. The incident is motivation, not a confirmed transport diagnosis. No wire, durable outbox, dependencies or general request retries are introduced.

## Design

`createDaemonConnection.send(payload): void` validates/encodes before admission. A per-connection FIFO owns copied payloads and delivery observers, capped at 128 messages and 1 MiB of encoded payloads, with the existing per-frame cap. Overflow rejects the incoming payload; older entries remain. Build envelopes again for the current dial when flushing, preserving the original payload identity and attachment ids.

Flush after a validated `hello_ack`, with a synchronous draining guard. Remove an entry before handing it to the driver so reentrant submissions append behind the remainder. A `send-refused` outcome preserves that entry at the front and stops draining; other failure outcomes fail visibly and are never automatically retried. An accepted rekey-buffered send belongs to `noiseSession`, and is removed from the main FIFO even before its eventual observation. Written messages leave the FIFO permanently.

Add a client-owned `messageDelivery` IPC arm carrying conversation/message ids and a closed status (`waiting`, `not-sent`, `written`), with the existing host stamp. Diagnostics observe the same operation independently; an absent lifecycle observer cannot disable delivery reporting. Routing refusal emits `not-sent`; preload validates commands before sending and throws only fixed copy for invalid commands.

Local `userText` echoes retain delivery state and receive `messageDelivery` events by their existing identity. Publish the echo to both timeline stores before calling the synchronous bridge, closing status-before-echo races. A bridge exception changes that echo to `not-sent`, rolls back attachments, returns false and preserves the draft; it never leaves an ordinary echo. Held echoes show “Waiting for connection”; failed echoes show “Not sent”. Written clears the transport label but does not claim daemon acknowledgement.

The timeline bridge targets local status events by their conversation and host, including inactive retained slices. A host mismatch cannot replace a retained timeline. Queue snapshots and user receipts clear local status and reuse existing queued-id correlation and stable-row settlement, preserving timestamp and attachments. Local holds do not manufacture daemon queue ids. Pending projection includes local holds; settled duplicate receipts remain no-ops.

## State + concurrency model

The FIFO is main-memory state owned by one connection. Existing generation fences cancel superseded dials. Transient drop retains the never-written remainder. Terminal failure marks held echoes failed but retains payloads for explicit Reconnect. A missing or changed pairing fails and releases the FIFO; compare the existing four-field pairing snapshot on every dial reload. Disposal releases holds and emits failed status before teardown. Initial bootstrap adopts the connection's first pairing; the registry owns replacement/removal. No new timer, listener or asynchronous job is needed.

## Error handling

Admission/encoding failure, overflow, routing refusal, bridge exception and non-refusal send failure become fixed “Not sent” copy. Terminal connection failure retains retryable local payloads only until unchanged-pairing reconnect. Pairing loss/replacement and disposal permanently release them. No raw error or payload enters IPC delivery status or logs.

## Testing strategy

- Driver tests decode sent envelopes: pre-bootstrap/pre-handshake hold, automatic/explicit reconnect, ordered multiple sends and reentrant submission, second drop and repeated authentication notifications.
- Driver tests cover count/byte/frame caps, terminal failure/recovery, pairing removal/replacement/disposal, asynchronous rekey observation and diagnostics-independent reporting.
- Store/composer tests cover status-before-send, throwing bridge rollback/draft return, active/inactive host isolation, queue correlation, preserved row content/time/attachments and duplicate ordered settlement.
- Mounted Playwright regression uses the existing paired fixture and observes fake-daemon decoded frames plus visible waiting/failed/settled rows through reconnect. Run the focused spec and capture status treatments. No new live-Claude acceptance is required.
- Final main merge, pre-verify check and build; run every changed focused unit test and the required fake spec.

## Open Questions

None. The cleaner shape is to reuse the existing send observer and echo/receipt reducer rather than introduce a second outbox store. Sketch and plan sizing: approximately 270 production, 410 test/helper and 75 plan lines (755 total); no new exported declaration required, at most 9 production consumer updates, 5 observable criteria, 8 rejection classes. Additive overlaps: #1544 and #1850.

## Security review

**Verdict:** PASS

- [Trust boundaries] Existing `isRendererCommand` admission and `parseHelloAck` remain authoritative; preload additionally refuses invalid commands. Hold payloads only after encoding checks, and keep host ownership explicit at status fan-out.
- [Tokens] Pairing snapshots remain main-only; tokens and keys never enter status events or diagnostic output. Existing safeStorage remains unchanged.
- [File/storage] Hold is bounded RAM, released on stop; no new disk/cache/path operation or renderer web storage.
- [Electron] Existing isolation, sandbox and navigation guards remain; one closed IPC event arm exposes ids/status only, with no new callable capability.
- [Cryptography] Existing Noise implementation and variant remain; retain payloads and rebuild envelopes, never reuse ciphertext or reset nonce state.
- [Network/I/O] Authenticate before drain; inherit relay frame limits, TLS validation, heartbeat/backoff and teardown. No socket-write acknowledgement claim and no retry after an uncertain write.
- [Errors/logs] Fixed delivery copy and closed categories only; lifecycle observers remain content-free and independent of delivery. Never log payloads, keys, tokens, bytes or caught objects.
- [Concurrency] Single synchronous FIFO writer/drain guard, generation-fenced dials, pairing comparison on reload and release before disposal; rekey retains sole ownership once accepted.
- [Threat model] Relay delay/drop cannot trigger unbounded holding or cross-pairing replay. Hostile daemon receipts use existing validated correlation. Renderer cannot access held payloads, secrets or raw transport; its command flooding meets admission caps. Existing safeStorage protects disk credentials.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-07

## Revisions

2026-10-07: Reserve the draining head's count/bytes until the driver accepts it, rather than removing it before handoff. The draining guard still appends reentrant submissions behind all existing entries, and a refusal leaves the head in place. This closes a reentrant overflow window while keeping the FIFO bounded. Delivery presentation lives in the existing `localEchoes` sidecar; it never changes message content or the durable row contract. Existing exhaustive session/modal/question bridges explicitly ignore the new delivery event.

2026-10-07: Composer commands carry an optional validated host id outside the wire payload, used only to attribute routing refusals when no connection can stamp them. Transport routing still uses the trusted main index. Shared fixed-copy constants and `bubble__meta` typography supply the delivery labels, with the existing error chip inside the metadata row. Final scope remains below 800 written lines, with one new exported constant and optional consumer additions only.
