# Bounded protected mutations

## Files read

- `src/main/chatHistoryStore.ts` → `run`, `execute`, `close`: detached admission and serialized application ownership.
- `src/main/indexedThreadHistory.ts` → `mutateThread`, `tree`, `sequence`: authenticated mutation, range traversal and pending index writes.
- `src/main/historyDatabase.ts` → `createHistoryDatabase`: synchronous transaction and native connection lifecycle.
- `src/main/chatHistoryStore.test.ts` → `setup`: protected disk and fresh-owner fixture.
- `src/main/indexedThreadHistory.test.ts` → `owned`, `setup`: mutation identity/progress and authenticated index regressions.
- `src/shared/chatHistory.ts` → `parseChatHistoryRequest`: detached admission, item-node and observation limits.
- `docs/knowledge/features/chat-history-api.md` → Owned authoritative mutations: completion certificates and aggregate admission remain authoritative.
- `docs/knowledge/decisions/0014-authenticated-owned-thread-mutations.md`: stable owner and protected roots must commit atomically.
- `docs/knowledge/features/chat-history-testing-native.md`, `docs/recorded-tests.md`, `docs/client-replay-migration.md`: native ABI preparation, packaged production encryption and guarded replay requirements.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: repository and evidence boundaries.

## Context

Ordinary owned saves block the main event loop while processing items, progress,
range merges and pending authenticated indexes. Preserve a single atomic commit
while allowing native callbacks between bounded pieces. Import, retained conversion
and full replacement keep their synchronous contracts. No UI changes or new ADR.
Remote feature branch overlap check found none.

## Design

Turn `mutateThread` into a resumable generator shared by synchronous and bounded
execution. Its work unit is one admitted item/removal, one preparation entry, one
range candidate/start, one progress observation, or one authenticated index row
flush. Fixed-width radix paths (at most 256 bits), AVL paths (bounded by admitted
100,000 items), and an individual admitted JSON item are indivisible within a unit.
Admission still synchronously validates and detaches the caller's bounded request
before queuing; execution must not repeat whole-request parsing or copy arrays.

Drain at most 16 units per event-loop turn, yielding through `setImmediate`.
Replace eager range-window materialization with lazy authenticated traversal and
replace bulk pending-index flush with resumable row flushing. Prepare pending items
incrementally; iterate progress without spreading the observation backlog.
Keep the existing synchronous API by immediately draining the same iterator.

Add a database-owned generator transaction driver: initialize migrations before
BEGIN, hold one transaction across yields, COMMIT only after generator completion,
ROLLBACK on any exception. The application store invokes bounded execution outside
its synchronous transaction wrapper; its queue remains held for the entire promise.
A main-only optional turn callback permits deterministic held/failure tests; the
default always admits real event-loop callbacks. No IPC/wire changes or dependencies.

Sizing: one deliverable, approximately 650 written lines including tests/plan,
zero new exported types, two added consumer calls, four observable acceptance
criteria and existing error classifications. Three production files are necessary
because transaction ownership belongs to the database adapter.

## State + concurrency model

The store queue owns the admitted request and transaction until completion or
rollback. No other queued read/write/removal/reset runs during a yield. Close seals
admission immediately and awaits the queue before closing the native connection.
Process interruption rolls back SQLite's uncommitted transaction on reopen; no
partial header/checkpoint becomes durable. No independent task or retry loop exists.

## State transitions and identity reuse

| Event | Regression |
| --- | --- |
| Many items/removals, progress, one range merging saved ranges | bounded store turns admit timers and respect unit ceiling |
| Failure after bounded progress and explicit retry | bounded mutation rollback and fresh-owner retry |
| Lost acknowledgement / repeated save | bounded and synchronous mutation equivalence and replay |
| Queued read, later write, same-epoch reset / new epoch | bounded queue preserves admission order |
| Conversation/host removal, equal conversation IDs across hosts | bounded queue preserves admission order |
| Close during held execution and new admission | bounded close drains and rejects admission |

## Error handling

Propagate generator/SQL/protection failures to rollback and existing static result
classification. No retry on failure. Encryption unavailable and malformed protected
roots remain fail-closed; successful acknowledgement follows COMMIT only.

## Testing strategy

Write regressions first in the existing two storage suites. Compare bounded and
synchronous saved application including full items, arrival ordering, ranges and
progress; reopen protected disk through a fresh owner. Hold turn execution to queue
lifecycle operations, inject failure after progress, and prove no completed partial
checkpoint. Count every turn and observe a real timer before completion for items,
removals, independent progress backlog and range merging. Existing tamper/aggregate
and reset tests remain in the full unit gate. Run Linux pre-verify and build after
the final main merge, affected guarded history-on-open replay and the packaged
production-encryption Playwright case; retain raw runtime output outside the tree.

## Open Questions

None. One transaction held across turns is required to preserve existing atomicity.

## Security review

**Verdict:** PASS

- Trust boundaries: `execute` retains synchronous `parseChatHistoryRequest` detachment; the bounded internal entry accepts that parsed request only. Disk proofs continue through `tree`, `sequence`, `selectedRow` and protected headers.
- Tokens/secrets: no new credentials; existing `SecretEncryption` remains main-only and unavailable protection fails closed.
- Storage: database-owned BEGIN/COMMIT/ROLLBACK protects items, roots and checkpoint together, including turn failure. Paths remain application-owned; no daemon text becomes a path.
- Electron: no new bridge, window, navigation or renderer privilege; parsed requests use the existing handler.
- Cryptography: existing production protection and SHA-256 proof envelopes stay unchanged; no key/nonce or primitive changes.
- Network/I/O: no network changes; mutation scheduling has a finite admitted workload and no retry spin.
- Errors/logs: existing static operation/error codes only; never log items, roots, keys, ciphertext or caught exception details.
- Concurrency: the application queue spans every await; close drains it; no partial commit, replacement-owner access or deletion resurrection across turns.
- Threat alignment: hostile daemon inputs retain aggregate node/coordinate limits; compromised renderer gains no SQL/keys/plaintext storage access. Relay transport and token revocation remain existing contracts outside this storage change; writer/native heartbeat work belongs to #2088.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-17
