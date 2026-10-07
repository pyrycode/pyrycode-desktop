## Files read

- `src/main/transport/inboundMessage.ts` → `parseHistoryEntry`, `decodeHistoryPage`: envelope admission precedes payload skipping.
- `src/main/daemonConnection.ts` → correlated history-page arm: only outstanding client requests may supply history.
- `src/shared/ipc/events.ts` → `historyPageReceived`: optional complete served evidence crosses IPC, never raw payloads.
- `src/shared/chatHistory.ts` → `parseChatHistorySnapshot`: detached allowlist and existing 100,000-element/string bounds.
- `src/renderer/src/store/historyPageBridge.ts` → `reduceHistoryPage`, `subscribeHistoryPage`: original-page lifecycle collection and conservative live join.
- `src/renderer/src/store/conversationTimelineStore.ts` → `receivedSlice`, `prependHistoryFor`, `recordHistoryPage`, `beginLocalTimelineRead`: host ownership, reservation and restoration.
- `src/renderer/src/store/chatHistoryWriter.ts` → `createChatHistoryWriter`: received-host qualification and durable-row filter.
- `src/renderer/src/store/finishedAgentHistory.test.ts` → immutable terminal placement and historical qualification scenarios.
- `e2e/history-walk.spec.ts` → correlated fake pages and explicit reader input.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/chat-history.md`, `conversation-timeline-store-internals.md`, `development-verification.md`: protected storage, legacy admission, static unit renderer tests, original-page lifecycle collection.

## Context

Repeated backwards pages currently redraw assistant/tool rows, and restart loses both served provenance and client allocation evidence. This is one repeat-page admission deliverable with protected persistence. Partial overlap and split-reply assembly remain with #1851. No new requests or visual elements; no ADR required.

Sizing: approximately 250 production + 320 tests/helpers + 75 plan lines, one exported metadata type, six consumer updates, four observable criteria and fewer than ten metadata rejection categories. The #1388 analogue added 490 lines and removed 16. Both sketch and written plan remain within the five boundaries.

In-flight overlap: #1544 edits other daemonConnection configuration/reset arms; no dependency on its additions. Our history arm edit stays local.

## Design

Use optional `servedIds` on decoded/IPC pages: exact envelope IDs including unsupported or malformed payloads. Validate IDs as nonnegative safe integers before any payload decode. Do not infer missing IDs, allocate by magnitude or expose skipped payloads.

A slice optionally holds `served` metadata: sorted unique `ids`, optional `highestId`, and `receipts` with exact sorted unique page `ids`, opaque `cursor`, and `atStart`. Empty pages have an empty receipt; identical receipts can be retained once. Union receipt IDs must equal coverage and its maximum must equal highestId. This records coverage, not entry-to-row contributions.

`subscribeHistoryPage` gains an optional coverage getter. A nonempty page suppresses ordinary rows only if every supplied served ID is already admitted for the supplying host. Legacy events without evidence stay on the current reducer path. An optional reducer flag suppresses ordinary events while still collecting lifecycle from the original page. Existing retained lifecycle qualification and immutable first finish remain owned by the roster store.

`recordHistoryPage` optionally accepts served IDs, merges exact coverage and records cursor/start even without drawable rows; it creates a host-owned empty slice when necessary. Metadata lives with the slice, so replacement, deletion, unpair and eviction remove it structurally.

Timeline snapshots optionally carry served metadata and row identity `{ rowKeys, nextRowKey }`. Row keys are client-owned signed safe integers, unique and aligned one-to-one with durable rows. Allocator must be safe, greater than every retained key, and preserve reservations through its value. Writer filters keys using the same durable-row predicate as rows. Restoration uses supplied identities rather than positions; legacy snapshots retain the existing fallback.

Validate declared metadata in `parseChatHistorySnapshot`: collection bounds, safe IDs, sorted uniqueness, exact receipt union/high-water agreement, last receipt agreement with received coverage, row count/key uniqueness and safe allocator. Unknown fields are projected away. Metadata-only receipt changes participate in writer observation and comparison.

## State + concurrency model

Admission is synchronous within the existing received-event callback; read coverage before recording the page, with explicit supplying-host equality. No new async jobs. Existing protected writer queue, generation guards, cancellation and local-read ownership remain intact. Receipt metadata cannot mutate live phase, sends, permission or recovery state.

## Error handling

Malformed envelopes/IDs throw the existing static wire error before any page is emitted. Bad payloads remain skipped but their valid envelopes count. Invalid snapshot metadata throws the existing static history sentinel; existing protected handlers return typed failures. No content, IDs or cursors enter diagnostics. Metadata uses existing snapshot admission bounds; no speculative history requests or gap UI.

## Testing strategy

- Parser: unsupported/malformed payload IDs survive; invalid envelope IDs reject the whole page; empty page evidence survives.
- Admission: repeated assistant/tool pages, any-unseen-ID pages, legacy events, skipped/empty receipts and original lifecycle collection.
- Persistence: metadata-only writes, durable filtering/key alignment, malformed declared metadata, fresh-instance protected read/restore, unique later append/prepend allocation, unknown legacy provenance and host/removal/eviction lifetimes.
- Repeated lifecycle evidence preserves established finish and live state using existing finished-Agent fixtures.
- Extend the mounted history walk with a correlated repeated assistant/tool page and exact unchanged row counts.
- Final main merge, pre-verify check, build and focused fake-transport Playwright spec; no changed live specs.

## Open Questions

None. Exact sets are simpler than interval compression and never invent coverage across holes.

## Security review

**Verdict:** PASS

- [Trust boundaries] Envelope validation in `parseHistoryEntry` rejects unsafe IDs before payload skipping; `parseChatHistorySnapshot` detaches and allowlists all declared metadata with consistency checks.
- [Tokens] No new credentials or token access; served IDs/cursors are provenance only and never logged.
- [File/storage] Existing protected chat-history store uses safeStorage and atomic secure-store writes, rejecting unavailable encryption. No new paths or renderer web storage.
- [Electron] No new IPC command or privileges; correlated history event carries only validated IDs and typed drawable events. Existing window isolation remains unchanged.
- [Crypto] No crypto changes; existing Noise variant and main-only keys remain unchanged.
- [Network/I/O] Existing bounded plaintext frame admission applies; metadata arrays obey existing snapshot bounds, allocation depends on element counts rather than ID magnitude.
- [Errors/logs] Existing static errors and content-free diagnostic codes only; IDs, cursors, skipped payloads and content excluded.
- [Concurrency] Synchronous host-qualified admission; metadata belongs to the slice. Existing queued writes and generation/read guards contain replacement/removal races.
- [Threat model] Malformed daemon/disk metadata cannot establish invented coverage or unsafe row allocations. Relay correlation, Noise encryption and renderer isolation are inherited; no additional protocol capability or secret surface.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-07

## Revisions

2026-10-07: Snapshot pager coverage may advance on a narrow legacy event without served metadata. Therefore cursor/start coverage remains independent of the receipt list's latest member; require received coverage when served evidence exists, but compare complete ID coverage against the receipt union/high-water, not the legacy pager cursor. This preserves known receipts without inventing an empty served page for an unknown legacy event.

2026-10-07: Adversarial allocator regression exposed that a safe integer near the maximum cannot allocate even one lifecycle-bearing prepend. Snapshot rowIdentity now requires headroom for the existing 100,000-row collection bound plus one placement reservation. This closes the unsafe restored-allocation finding without changing live reducers.
