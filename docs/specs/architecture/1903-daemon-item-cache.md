# Protected daemon item cache

## Files read

- `src/shared/chatHistory.ts` → snapshot/request parsers: bounded validation and additive legacy contracts.
- `src/main/chatHistoryStore.ts` → `createChatHistoryStore`: serial encrypted collection and scoped atomic removal.
- `src/main/chatHistoryHandler.ts` → `createChatHistoryHandler`: saved-host authorization and unpair generation queue.
- `src/main/secureStore.ts` → `createSecureStore`: fail-closed protected bytes; existing file adapter owns atomic replacement.
- `src/renderer/src/store/chatHistoryWriter.ts` → `createChatHistoryWriter`: coalescing, deletion confirmations and removal pauses.
- `src/renderer/src/store/savedTimelineRestorer.ts` → `readSavedTimeline`: cancellable local-only read.
- `src/renderer/src/store/threadItemStore.ts` → `createThreadItemStore`: retained facts, generations and unfinished batch fences.
- `docs/knowledge/features/thread-item-store.md`: held items permit patch nulls; applied progress does not certify completion.
- `docs/knowledge/features/chat-history.md`, `chat-history-api.md`, `chat-history-testing.md`: receipt ownership, queue ordering and offline saved-host access.
- `docs/knowledge/features/development-verification.md`: fresh instances and held operations prove persistence.
- Daemon ADR 042 and `docs/protocol-mobile.md` → supplied daemon thread delivery contract: live prompts/state are separate from items.

## Context

Persist #1901's authoritative retained facts alongside the one-release legacy cache. This is one persistence deliverable; sync completion belongs to #1902 and production activation/offline screen proof to #1908. No UI changes or new ADR. No overlapping in-flight feature branches found after fetch.

## Design

Move the existing `ThreadSnapshot` interface to the shared chat-history contract and re-export it from the store. Add optional `uncommittedVersion` to its read surface, emitted by the store and retained by disk. A legacy supplied snapshot lacking it conservatively fences its applied version when ahead of checkpoint.

Add version-1 `kind: 'daemon-items'` records carrying conversation coordinates and a `thread` snapshot, with `readThread`/`replaceThread` operations on the existing IPC channel. Legacy timeline reads remain distinct. Main removes both conversation kinds and list entries atomically. No renderer imports in the shared contract.

The shared parser validates coordinates, safe numeric bounds, unique item ids, ordered nonoverlapping ranges, checkpoint/applied consistency, unfinished progress and repair bounds. Held items validate id/kind/revision while preserving other JSON fields, including explicit nulls and prototype-like own keys. JSON cloning rejects non-JSON, cycles/depth above 64 and aggregate nodes above 100,000; existing string/array bounds apply. It does not reuse full-add wire optional-field validation.

The writer accepts an optional thread store and captures changed owned snapshots through its existing coalescing queue. Local hydration is marked in the private slice and is not a received save. Confirmation tombstones prevent later saves, clear the held conversation and queue one removal after admitted writes. Successful unpair discards pending snapshots and all held host slices, including off-screen entries. No production subscription is activated here.

`beginLocalRead(host, conversation)` returns a one-shot complete/fail/cancel handle for an absent scope. A private read token owns it. Any admitted state, replacement read or scoped cleanup invalidates it, even when text ids are reused. Completion validates/detaches the saved snapshot and publishes it directly, retaining checkpoint, ranges, repair and unfinished progress without events or network requests. `readSavedTimeline` accepts an optional thread source; existing callers keep the legacy path.

## State + concurrency model

Reuse the main handler/storage serial queues, writer pending/latest maps, scheduling cancellation and host-removal pauses. Reads use process-local tokens, not epoch strings. Publishing facts invalidates pending reads. Hydration builds the id Map in supplied held order; later updates use existing ordering and revision rules. Writer stop detaches both subscriptions and awaits removal/flush work.

## State transitions and identity reuse

| Event | Test in `daemonItemCache.test.ts` or `daemonItemHistory.test.ts` |
| --- | --- |
| Fresh protected restart, equal ids on two hosts | `round-trips held facts beside legacy rows through protected fresh instances` |
| Unfinished/repair progress then live success, partial/full certification | `retains exact unfinished and repair fences after offline hydration` |
| Complete checkpoint then live success | `restores completed progress without adding coverage` |
| Held write then newer snapshot/epoch | `flushes the newest snapshot through a held write and epoch replacement` |
| Delayed stored/missing/error result after admission | `ignores delayed read outcomes after live admission` |
| Cancel/repeat read, epoch reuse, conversation/host/all cleanup | `invalidates local reads across cancellation and reused scope identities` |
| Confirmation during pending writes, stale content, equal-id peer | `deletion orders both formats and list removal behind held saves` |
| Successful/failed unpair, off-screen state, same-host reuse | `unpair invalidates old work and preserves another host` |
| Invalid saved/IPC metadata | `rejects malformed daemon metadata without replacing valid storage` |

## Error handling

Use existing classified invalid-request/unreadable/unsupported-version/encryption-unavailable/write/remove failures. Local read failure leaves admitted state intact. Diagnostics contain static event/code values only. No new user error surface.

## Testing strategy

Write failing supplied-state Vitest cases first. Main tests use existing protected persistence seams and fresh service instances; renderer tests inject reads/writes, held promises and scheduling. Prove owned coalescing, cancellation and cleanup across await boundaries, unknown inert JSON, null clears, legacy coexistence and fencing. Run focused tests, then pre-verify and build after final main merge. No UI, Playwright or live daemon proof required in this slice.

## Open Questions

None. Cleaner-shape review: extending the existing queue and shared parser avoids a second cache service or new IPC channel. Estimate: ~290 production + 350 test/helper + 80 plan lines, <=800; one moved exported interface, no required consumer migrations, five acceptance behaviours, fewer than ten classified rejection paths. Recounted before commit.

## Security review

**Verdict:** PASS

- [Trust boundaries] Shared snapshot/request parsers validate untrusted IPC/disk input before publishing or queueing. Hydration revalidates returned data and exact coordinates. Unknown fields remain inert item JSON.
- [Tokens] Existing main-only SecureStore uses safeStorage; no credentials enter this cache or renderer storage. Unavailable encryption fails closed.
- [File/storage] Fixed `chat-history` blob under existing userData persistence; ids are record values, never paths. Reuse atomic encrypted replacement and scoped collection removal.
- [Electron] Existing isolated bridge/channel and saved-host authorization are reused. New operations expose only validated snapshots, no filesystem or transport primitives.
- [Crypto] No new cryptography, keys, nonce use or comparisons; existing safeStorage adapters remain responsible.
- [Network/I/O] No network work is added; bounded JSON/arrays/depth limit hostile saved inputs. Relay framing and TLS remain with existing transport and #1902.
- [Errors/logs] Static classifications only; never log item content, metadata, ids, caught errors, keys or bytes.
- [Concurrency] Read tokens and existing write/removal queues fence await races, cleanup and string identity reuse; stop awaits its owned work.
- [Threat alignment] Disk theft is addressed by protected storage; hostile saved/daemon JSON by validation and inert cloning; compromised renderer by saved-host authorization and process isolation. Relay delivery/recovery and production lifecycle are owned by #1902/#1908.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-10

## Revisions

2026-10-10: Added `e2e/daemon-item-cache.test.ts`, a Node Vitest integration proof using the existing protected filesystem seam. Keeping cross-process test imports outside either TypeScript production project proves writer-to-fresh-service-to-offline-store restoration without a shared harness or Electron launch. No production design change.

2026-10-10 (verifier finding 1): Accept `uncommittedVersion` at or below checkpoint, retaining the store's legitimate already-covered unfinished progress. Continue validating nonnegative safe integers no greater than applied version; progress above checkpoint remains a fence. `saves live success after abandoning a batch already covered through %s` proves protected writer/fresh-instance restoration for batches below and equal to checkpoint, followed by live success; existing incomplete/repair tests prove fences remain intact.

2026-10-10 (verifier finding 2): Add optional `ThreadSnapshot.arrivalOrder`, an immutable complete permutation of held item ids in first-arrival order. Store snapshots emit it separately from display-sorted `items`; local hydration reconstructs the Map from that metadata. Older snapshots lacking it use supplied item order because their original arrival order is unavailable, covered by `restores snapshots without arrival metadata using their supplied held order`. `restart preserves first-arrival ties after order changes and clears` compares uninterrupted and restored stores after equal numeric orders and null clears. Metadata validation rejects missing, duplicate, unknown and invalid ids without replacing valid storage.

Security re-review: PASS. The arrival-id array uses existing bounded array/safe-id parsing and must match the held-id set exactly; it is inert data and changes no storage paths, authorization or I/O. Accepting already-covered unfinished versions matches the existing `success` fence condition and grants no additional checkpoint or range certification. No new types, dependencies, failure classifications or production consumers. Rework keeps total written work below 800 lines.

## Documentation handoff

- Pending documentation stage: `docs/knowledge/features/chat-history.md` § Snapshot contract / Storage and concurrency and `docs/knowledge/features/chat-history-api.md` § API: distinguish daemon/legacy records, additive operations, shared snapshots, cleanup and read ownership.
- Pending documentation stage: `docs/knowledge/features/thread-item-store.md` § Identity, placement and full items / Snapshots and completed batches / Repair and unfinished-batch checkpoint fences: exact hydration, optional arrival metadata and backwards fallback, already-covered unfinished versions, and no new certification.
- Pending documentation stage: `docs/knowledge/features/chat-history-testing.md` § Restoration / Recording and removal: protected fresh-instance and rework regressions; retain #1908's production offline/reconnect proof boundary.
