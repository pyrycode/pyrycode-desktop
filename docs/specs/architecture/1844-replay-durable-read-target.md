# Replay durable read-target confirmation (#1844)

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md` → repository conventions and knowledge map.
- `docs/knowledge/features/development-verification.md` → mounted delivery and executed-count evidence requirements.
- `docs/knowledge/features/inbound-message-decode-payloads.md` → defensive inbound admission.
- `docs/knowledge/features/conversation-last-read-store.md` → durable display targets, legacy persistence and clears.
- `src/main/transport/codec.ts` → `decodeEnvelope` validates durable IDs independently of connection/replay IDs.
- `src/main/transport/inboundMessage.ts` → `parseInboundMessage` carries direct envelope identity.
- `src/main/daemonConnection.ts` → typed event forwarding and `markConversationRead` allowlisted outbound payload.
- `src/shared/ipc/commands.ts`, `src/main/index.ts` → `isRendererCommand` and host-bound read routing.
- `src/renderer/src/store/timelineBridge.ts` → `subscribeTimeline` forwards optional durable metadata without lookup.
- `src/renderer/src/store/conversationTimelineStore.ts` → `dispatchFor` and `retainLiveDisplay` retain admitted contributions.
- `src/renderer/src/store/conversationReadPublisher.ts` → `readTargetFor`, `createReadPublisher` and committed viewport observation.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → mounted `useReadObservation`.
- `src/renderer/src/store/conversationLastReadBridge.ts` → `stampLastReadFor` suppresses local authority for daemon-backed rows.
- `src/renderer/src/store/historyPageBridge.ts` → ordinary timeline demand remains separate from read publication.
- `src/main/transport/readMarkAdmission.test.ts`, `src/main/daemonConnection.test.ts` → distinct-ID admission and forwarding proof.
- `src/renderer/src/store/conversationReadPublisher.test.ts`, `conversationLastReadBridge.test.ts`, `conversationLastReadStore.test.ts` → targets, legacy guard, persistence and clears.
- `src/renderer/src/store/historyDemand.test.ts`, `newestHistoryDemand.test.ts` → independent timeline demand.
- `e2e/visible-tail-read.spec.ts`, `e2e/history-on-open.spec.ts` → mounted outbound targets and newest-page behavior.

## Change

Confirm the implementation shipped by #1826 at `16422881`; no production or test edits are planned. Replay uses the frame's validated non-negative safe `history_entry_id`, including zero, rather than connection `id`, replay `event_id`, timestamps or lookup. ID-less replay supplies no new durable contribution and starts no identity recovery. Independently admitted history can establish its own retained display target; preserve #1815's newest-page demand. Rows lacking the daemon read contract retain local-count persistence and clears and publish no read command. No visual change or new state, type, interface or failure mode is introduced.

Size: one confirmation deliverable, two observable acceptance criteria, approximately 70 written plan/evidence lines, zero new exports or updated consumers. The scoped #1826 analogue has 62 insertions and 20 deletions across codec, inbound metadata, admission tests, timeline bridge and shared metadata. Checked 30 remote feature branches after fetching: no overlap with the audited replay path or existing proof files. Codegraph was uninitialized; source search supplied the symbol trace.

## Testing strategy

- Reuse `readMarkAdmission.test.ts`: connection 90, replay 700, durable 0/12/MAX_SAFE_INTEGER; reject malformed durable IDs and IPC targets.
- Reuse `daemonConnection.test.ts` direct replay forwarding case: connection 900, replay 700, durable 12.
- Reuse `conversationReadPublisher.test.ts`: retained/folded contributions, zero, orphan/ID-less changes, host ownership and reconnect deduplication.
- Reuse last-read bridge/store tests for daemon-backed stamp suppression and legacy count persistence/clears; newest-demand tests preserve timeline fetching.
- Run `visible-tail-read.spec.ts`: connection 900 and replay 700 remain distinct from actual outbound durable targets; ID-less replay sends no mark and adds no history request before an independently admitted page.
- Run `history-on-open.spec.ts` for #1815's mounted timeline-demand behavior.
- After the final merge of main, run pre-verify (full unit suite/typecheck) and `npm run build`. No new or changed live tests; full fake/live tiers belong to the dispatcher.
- Record executed/pass/skip counts in a subsequent confirmation entry and the PR. Existing assertions suffice; no duplicate test or production implementation is needed.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — `decodeEnvelope` rejects non-safe, negative and mistyped durable IDs; `parseInboundMessage` forwards only admitted metadata. `subscribeTimeline` uses that metadata, never replay/connection identity.
- [Tokens, secrets, credentials] No findings — confirmation introduces no credentials, key generation, storage or credential access; synthetic frames carry no secrets.
- [File and storage operations] No findings — only this plan is written; existing last-read tests verify numeric legacy persistence/clears. No daemon content becomes a path or new storage key.
- [Electron attack surface] No findings — no bridge/window surface changes; `isRendererCommand` validates host and exact read payload, and main routes through the observed host. Transport remains in main.
- [Cryptographic primitives] No findings — no handshake, key, nonce or primitive changes; tests exercise the existing transport boundary.
- [Network and I/O] No findings — no new network job; ID-less replay cannot start recovery I/O. Ordinary history demand remains independently owned by the existing bridge.
- [Errors, logs, telemetry] No findings — malformed durable identity throws a static decode error and main drops malformed frames; outbound read logging is content-free. Confirmation adds no telemetry or content logging.
- [Concurrency] No findings — no new task or listener; existing publisher tests cover coalescing, failed attempts, reconnect generations and ownership removal. Missing identity cannot promote a local count into a durable mark.
- [Threat model alignment] No findings — malformed daemon identity fails admission; relay replay/connection identity cannot substitute for durable history identity. Renderer commands remain validated and host-bound. Confirmation leaves disk credential protection and Noise process isolation unchanged.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-08

## Confirmation evidence

2026-10-08, after the final merge of `origin/main` (`16422881aead`), with the plan committed at `1db97328`:

- Source trace confirmed direct validated identity throughout decode, typed IPC forwarding, timeline dispatch and retained display target derivation. No replay read-identity recovery requester exists.
- Pre-verify: PASS, all five checks; 378 unit files, 9,587 executed/passed, 0 failed, 3 existing skips. This includes durable admission, daemon forwarding, publisher, legacy persistence/clears and newest-demand tests.
- `npm run build` and `npm run check:docs`: passed.
- Existing fake-transport `visible-tail-read.spec.ts`: 6 executed, 6 passed, 0 failed/skipped. Distinct connection/replay/durable IDs, actual outbound targets, ID-less no-command/no-extra-request and independently admitted history all passed.
- Existing fake-transport `history-on-open.spec.ts`: 5 executed, 5 passed, 0 failed/skipped. Opening/reopening, owned-request exclusion, trusted backwards input, reconnect cursor retention and newest content without arrival cascade passed.
- No production or test edits were needed. No live tests were added or changed; dispatcher owns later full-tier validation.
