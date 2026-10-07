# History contributions across pages and protected restoration

## Files read

- `src/shared/chatHistory.ts` → `parseChatHistorySnapshot`: version-1 projection, collection/string bounds and row identity validation.
- `src/main/transport/inboundMessage.ts` → `parseHistoryEntry`, `decodeHistoryEvent`: safe durable IDs, skipped-envelope coverage and typed IPC input.
- `src/renderer/src/store/historyPageBridge.ts` → `subscribeHistoryPage`, `withoutLiveEntries`, `reduceHistoryPage`: conservative suffix suppression and original-page lifecycle collection.
- `src/renderer/src/store/conversationTimelineStore.ts` → `prependHistoryFor`, `dispatchFor`, `beginLocalTimelineRead`: owning-host admission, surviving identities and transient-state isolation.
- `src/renderer/src/store/threadTimeline.ts` → `appendDelta`, `fillResult`, `reduceTimeline`: text adjacency, orphan loss and message-ID settlement from merged #1853.
- `src/renderer/src/store/chatHistoryWriter.ts` → `createChatHistoryWriter`: metadata-only capture, durable exclusions and protected storage.
- `src/renderer/src/store/finishedAgentHistory.test.ts` → history harness: immutable qualification and reserved chronological boundaries.
- `e2e/history-walk.spec.ts`, `e2e/thread-scroll-pin.spec.ts`, `e2e/chat-history-recording.spec.ts`: correlated paging, mounted identity and protected relaunch fixtures.
- `docs/knowledge/features/chat-history.md`, `conversation-timeline-store-internals.md`, `development-verification.md`: receipts are not display evidence; test the actual protected round trip and content anchor.

## Context

Pages currently fold independently, so partial overlaps duplicate deltas and an orphan result disappears. Served receipts establish envelope coverage only. The merged #1850 and #1853 contracts must survive. No overlapping remote feature branch touches the proposed files.
This is one joining deliverable. Estimate after reading: approximately 400 production, 430 tests/helpers and 80 plan lines (910 total); <=4 new exports, <=5 production consumers, four observable acceptance criteria. The 800-line ceiling is exceeded. Parent #1814 has parent #1736, so the split-depth rule requires building in place with `needs-human:sizing`. Without that gate, partial-overlap admission with protected contribution provenance and unfinished text/tool assembly would be independently verifiable slices; a schema-only helper would not be a slice.

## Design

Add optional `display` contribution metadata to version-1 timelines. A contribution has a nonnegative safe durable `id`, optional bounded timestamp join key, optional surviving client `rowKey`, and an allowlisted display operation: a durable row, a tool result/denial patch, or an explicitly suppressed contribution. Store fragment text rather than whole envelopes. No permission, question, attachment body, turn metrics or live-state operation can be retained.
A pure renderer reconciler normalizes validated entries, admits unseen contributions independently of served receipts, folds contributions in durable-ID order, joins adjacent matching turn/parent text, and attaches retained patches when their call arrives. Existing unknown-provenance rows remain intact. A text join selects an already-held key before allocating; a tool update retains its call key. Reconciliation replaces only represented rows and inserts new rows through chronological held boundaries, preserving unrepresented live/legacy rows and adjacency barriers.
Use the existing newest-suffix `withoutLiveEntries` before contribution admission, preserving ambiguous-key fail-open behavior. Message-ID suppression binds history contributions to the surviving held operator row. Retained unique display timestamp evidence also suppresses the reverse history-before-live order without guessing from timestamps or receipt-only metadata.
Extend `prependHistoryFor` with an optional typed-entry input; its legacy row-only contract remains valid. The production bridge enables contribution admission and maps original-page lifecycle entries through chronological entry boundaries returned by reconciliation. Neither receipt coverage nor numeric allocation order determines these placements. Existing roster qualification and immutable first-finish rules remain authoritative.

## State + concurrency model

Contribution metadata belongs to `ConversationSlice` and shares its host replacement, pairing removal, deletion and holder-eviction lifetime. Reconciliation is synchronous and returns items/keys/evidence only; held live state is spread unchanged. Saved reads retain their existing request-owner check. Writer ownership, serial drain, flush and unsubscribe behavior remain unchanged; changed display metadata participates in capture even when rows are unchanged.
Bound contributions before capture using the existing collection ceiling. At capacity, retire complete represented groups into unknown-provenance retained rows; receipt expiry alone never retires a group. Keep unresolved patches while capacity permits and avoid producing an invalid snapshot that disables subsequent saves. New rows and later saves remain available at saturation. Declared metadata uses existing string/map/array bounds and must reference retained durable keys consistently. Legacy absence stays unknown; there is no timestamp/row-count reconstruction.

## Error handling

Main continues rejecting invalid envelopes before coverage advances and skipping unsupported payloads while retaining served IDs. Snapshot parsing rejects malformed declared contribution data with the existing static validation sentinel; unknown fields are projected away. Existing typed history I/O results, generic failures and content-free lifecycle logging remain unchanged. The reconciler adds no I/O, exception-bearing rendered state or retry policy.

## Testing strategy

- Vitest admission: partial/repeat overlap, durable order, split text with turn/parent separation, intervening rows, orphan result/denial attachment, stable surviving keys, live suffix/ambiguous keys and both echo arrival orders.
- Vitest persistence: metadata-only saves, protected round trips into fresh stores, receipt-only legacy data, bounded retention, malformed IDs/references/operations and durable exclusions.
- Existing lifecycle/host fixtures: original-page qualification through suppression, chronological mapping, reservations, immutable finish and equal-ID host replacement/removal/eviction.
- Fake-transport browser fixtures: correlated partial overlap and a protected same-host relaunch followed by a mounted text/tool join; expand the surviving tool and identify the reader anchor by content before admission, then verify both survive. No persisted expansion/scroll requirement.
- Run pre-verify and build after final main merge; run each changed browser spec. No real-Claude requirement and no new visual design.

## Open Questions

None. Keep existing presentation, reader-driven requests, opaque cursor settlement and durable-display exclusions. Newest-page policy, gap markers and automatic gap filling remain with #1815/#1816.

## Security review

**Verdict:** PASS

- [Trust boundaries] Main `parseHistoryEntry`/`decodeHistoryEvent` remain the page boundary; `parseChatHistorySnapshot` validates and projects every declared display operation, safe ID and retained-row reference on IPC writes and protected reads. Malformed metadata rejects the snapshot.
- [Tokens] No token/credential fields in display operations; existing safeStorage service remains the only persistence path.
- [File/storage] Existing protected, atomic store writes and host membership checks remain authoritative. Contribution data never becomes a path or renderer web storage.
- [Electron] No new channel, Node primitive, navigation or remote content. Typed display input stays in the renderer; transport and keys stay in main.
- [Cryptography] No cryptographic changes; existing Noise_IK_25519_ChaChaPoly_BLAKE2s and safeStorage remain unchanged.
- [Network/I/O] No additional request, timer, retry or gap-filling path; frame limits and original envelope validation remain intact. Bound metadata before capture as well as on disk admission.
- [Errors/logs] Never log contribution content, durable/message/tool IDs, timestamp keys or cursors. Existing static classification codes only.
- [Concurrency] Synchronous owning-host reconciliation; existing local-read owner checks, writer serial drain and unsubscribe paths prevent stale restoration or post-removal writes.
- [Threat model] Hostile daemon/disk input is allowlisted and bounded; compromised renderer cannot reach keys or raw sockets. Relay dropping/reordering cannot create display provenance from receipt coverage; envelope IDs are never confused with replay event IDs.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-07
