# Thread query coordinator

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md` and `docs/knowledge/features/development-verification.md`: process boundaries and supplied-input proof.
- `docs/knowledge/features/thread-item-store.md`: completed batches, repair and unfinished-progress fences; preserve cache ownership.
- `src/renderer/src/store/threadItemStore.ts` → `createThreadItemStore`, `ThreadBatchCertificate`: retained facts, generation identity and one-shot certification.
- `src/renderer/src/store/newestHistoryDemand.ts` → `createNewestHistoryDemand`: navigation/connection edges create demand, settlement does not.
- `src/renderer/src/store/historyPageBridge.ts` → `requestOlderHistory`, `HistoryAskDeps`: explicit older demand and presentation seams.
- `src/shared/ipc/commands.ts`, `src/shared/ipc/events.ts`, `src/shared/wire/thread.ts`: host-addressed queries and decoded stamped replies/updates/failures.
- `src/main/transport/threadUpdates.ts` → `createThreadUpdateReceiver`: main validates/assembles logical parts and query correlation.
- Sibling `pyrycode/docs/protocol-mobile.md` § Thread query messages and ADR 042: captured version, separate marker, exclusive order and shared connection slot.

## Context

Supply synchronization over the landed retained-item and query transport contracts. Production selection/subscriptions/presentation wiring belongs to #1908; local paging to #1931. No singleton, cache replacement, wire change, raw history, replay, resync or new UI. No ADR required. Remote feature-branch overlap check found no overlap with the two new coordinator files.

## Design

`createThreadQueryCoordinator(deps)` owns a Map per host with connection state, one open scope, coalesced catch-up/older demand and one pending query. Dependencies inject the vanilla item store, `queryThread` sender, request-id factory, scoped presentation callback and optional content-free diagnostics. Inputs are a discriminated union: navigation/connection/local-restore readiness, decoded daemon event, older demand and retry. Public lifecycle methods cancel a host or dispose the coordinator.

Presentation is `idle | loading {purpose} | failed {purpose, reason, retryable:true}`; #1908 maps it into existing loading/failure presentation. Failed demand remains blocked until explicit retry or a fresh navigation/reconnect edge. Restore readiness is supplied by its existing owner; coordinator never starts/cancels local reads or writes cache records.

Dispatch catch-up from current `checkpoint` and epoch (absent: empty epoch/zero). Only an initial correlated catch-up reply may admit its epoch, after checking the generation captured at dispatch. Capture reply version once and begin the batch after admission. All complete items, including active/parent extras, apply to that handle. Live updates use the same store; repair results create scoped catch-up demand.

Only a separate empty success marker commits `ThreadBatchCertificate`: nonzero catch-up uses exact requested `from_version`; newest/page uses supplied order bounds/availability. Page upper bound must equal requested exclusive boundary, continuation must equal lower bound. Page never certifies a repair. Use the newest continuous certified range's lower boundary, not item orders or a disjoint earlier range; authoritative exhaustion suppresses demand. Pending older demand coalesces and runs after catch-up completes.

Correlated reset abandons the batch, deletes just its conversation and accepts the reported epoch even when unchanged, then creates zero-version recovery demand. One automatic recovery attempt is allowed; reset/application failure during recovery exposes retry. Reset version never certifies progress.

## State + concurrency model

All operations are synchronous supplied-input reductions. Requests/timers are owned by their host pending slot; no subscriptions or promises are created. Mark pending before invoking sender/callbacks to tolerate synchronous event delivery. Different hosts dispatch independently. Leaving cancels application and unsent demand but retains a pending tombstone until terminal reply/failure or idle deadline releases the shared slot. Disconnect cancels and fails pending work; reconnect creates demand only for that host's open scope. Every logical reply part renews a 30-second idle timer. Cleanup clears timers, abandons handles and prevents reuse; dispose ignores subsequent inputs.

Generation symbols, host/conversation and caller request id bind replies. Epoch replacement or cleanup invalidates a request before any further item/marker application. Tombstone replies can release a slot but cannot publish facts or completion. Received facts survive abandonment; complete checkpoint stays fenced by the store.

## State transitions and identity reuse

| Event | Focused test scenario |
| --- | --- |
| Open/offline/reconnect/duplicate sync | `defers restore and uses the saved checkpoint on reopening` |
| Leave/reopen while pending | `serializes navigation on one host and isolates other hosts` |
| Multipart disconnect/late marker | `retains incomplete facts on disconnect and rejects late completion` |
| Live overlap and failed application | `repairs from the checkpoint despite newer live facts` |
| Reset/same epoch/repeated reset | `resets only the affected scope and bounds automatic recovery` |
| Epoch replacement/deletion/reused epoch | `rejects generation replacement and disposed replies` |
| Explicit older/repeated demand/exhaustion | `pages certified continuity without parent or disjoint-range inference` |
| Idle/renewal/failure/retry | `renews the idle deadline and retries transport failure` |
| Empty successful marker | `certifies an empty reply only at its success marker` |

## Error handling

Static retryable failure codes cover transport, disconnect, timeout, generation/metadata rejection and failed certification/repeated recovery. No daemon text is exposed as errors or diagnostics. Failure abandons the batch, clears timer/loading and releases scheduling; explicit retry chooses catch-up when repair/recovery is outstanding. Sender exceptions settle as send failure. No automatic failure loop.

## Testing strategy

Vitest supplied-event tests use a real isolated item store, recording sender/presentation callbacks and fake timers. Assert exact query coordinates, immutable snapshots, complete checkpoint/ranges and host slot ordering. Test empty replies, late/cancelled identity, recovery bounds and all table events. No browser/live proof: production remains dormant. Run focused tests, final pre-verify gate and build after merging main.

## Open Questions

None. Cleaner-shape check: a single host-owned reducer avoids a second queue/store or changes to the retained-store contract. Budget sketch and plan: about 320 production + 370 test/helper + 80 plan lines, three exported types, zero migrated consumers, five observable criteria and at most ten classified failure branches.

## Security review

**Verdict:** PASS

- [Trust boundaries] Decoded `StampedDaemonEvent` is the only event boundary; host/conversation/request/generation checks precede store application. Main keeps validation and assembly ownership.
- [Tokens] No tokens or credentials enter dependencies or state; request ids are correlation only, supplied by the existing caller factory.
- [Files/storage] No file access or persistence; #1903 owns protected writer/restore. Restore readiness never confers reply ownership.
- [Electron surface] No new IPC channels, window preferences, navigation or remote content. Fixed `queryThread` command inherits main validation; #1908 owns mounting.
- [Cryptography] No bytes, keys, Noise or crypto implementation in renderer.
- [Network/I/O] Host slots serialize queries; idle deadline settles dropped/stalled replies. Main retains socket/assembly budgets and transport security.
- [Errors/logs] Only static lifecycle and failure codes; never item content, epoch, daemon strings, tokens or keys.
- [Concurrency] Request identity and generation bind every reply; teardown clears timers and handles; pending navigation tombstones prevent competing dispatch.
- [Threat alignment] Delayed/reordered relay delivery cannot revive cancelled scopes. Hostile replies are decoded/bounded in main, with scoped certification here. Disk-token theft and compromised-renderer transport isolation remain with existing safeStorage/main boundaries; no new access is introduced.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-13

## Revisions

2026-10-13: The synchronous-presentation cancellation test exposed a timer left behind before send. Pending state now records whether dispatch occurred: navigation immediately releases an unsent request, while a sent request keeps its cancelled host slot. `requestId` must supply fresh ids across attempts/lifetimes; `cancelHost` means connection teardown. Null host stamps are ignored. These clarify the original ownership contract without production wiring or store changes.
