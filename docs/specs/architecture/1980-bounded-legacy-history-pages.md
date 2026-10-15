# Bounded protected legacy history pages

## Files read
- `src/main/indexedLegacyHistory.ts` → `records`, `load`, `createIndexedLegacyHistory`: independently protected records and full compatibility operations.
- `src/main/historyDatabase.ts` → `createHistoryDatabase`: atomic transactions, structural indexes and UTF-16LE ownership.
- `src/shared/chatHistory.ts` → `threadItem`, `servedHistory`, `parseChatHistorySnapshot`: reuse record checks while retaining complete-snapshot validation.
- `src/main/indexedLegacyHistory.test.ts` → `setup`, `snapshot`: reuse on-disk fixtures and reversible encryption.
- `docs/knowledge/features/chat-history.md` → Snapshot contract: held order, optional evidence, fallback keys and coverage semantics.
- `docs/knowledge/features/chat-history-api.md`, `chat-history-results.md`, `chat-history-testing.md`: protected storage, error classifications and existing proof boundaries.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `development-verification.md`: process isolation and focused verification.
- Mobile #2162: independently indexed evidence and local traversal; Desktop retains its own admitted record contract.

## Context
Full legacy reads decrypt all records. Independently callable pages must bound this work without claiming daemon completeness. Application binding remains #1975; IPC, renderer and partial writers remain #1931. No overlapping in-flight branches touch the proposed files. No ADR required.

## Design
Add `newestPage(unknown)` and `beforePage(unknown)` on the existing main-only backend. Requests contain exact server/conversation coordinates and integer limit 1–200; before also requires a structured local continuation. Return distinct `newest-page`/`before-page` results, `missing` for absent newest scopes, or existing static errors. Pages contain ordered items/keys, saved coverage separately, optional saved newest cursor, partial receipt/gap associations and a local continuation or null. They are never snapshots.

The continuation contains a legacy format tag, exact coordinates, committed UUID and exclusive held-order boundary. Validate shape, ownership, UUID and an existing boundary using structural records; identical replacement and delete/recreate invalidate it. Fetch at most the limit row payloads; use one order-only older probe. A before-boundary existence check is structural only.

Extract a narrow shared codec object: durable row, coverage, display contribution with selected held bindings, numeric/legacy gap header and receipt header checks. Full parsing continues using the same checks and complete served unions. Selected projections never invoke full snapshot parsing. Check selected indexes against canonical payload fields, including row keys, contribution ranges and membership ids/keys. Row identity absence retains ordinal minus saved prepended count.

Select display contributions by selected row keys. Select served and receipt memberships only within those contribution ids/ranges, retaining original receipt identity/order and membership order. Include numeric gaps intersecting selected contribution ranges inclusively, so shared boundary gaps both survive; include selected legacy memberships. Gap projections omit unselected memberships and refused-cursor lists and explicitly declare partial evidence. For gap cursor fallback select the nearest receipt whose first membership is at/after the newer edge, rather than all cursors in intersecting receipts. Receipt projections retain their original ordinal identity and mark partial. Never invent served membership for display-only rows.

Reuse existing structural indexes; add indexes only if query inspection demonstrates a need. No new plaintext columns, whole-proof cells, dependency, coordinator or application wiring.

## State + concurrency model
Each synchronous SQLite transaction obtains scope, rows and evidence from one committed snapshot, without awaits. No jobs, subscriptions or renderer state. Database connection lifetime and close remain owned by the existing database owner. Read failures roll back any prerequisite key migration and do not repair data.

## State transitions and identity reuse
| Event | Test scenario in `indexedLegacyHistory.test.ts` |
| --- | --- |
| Repeated backwards pages and fresh reopen | traverses held order with ties and fallback identity |
| Identical replacement | rejects invalid and stale local continuations |
| Delete/recreate and cross-owner reuse | rejects invalid and stale local continuations |
| Empty/missing scopes | distinguishes missing and saved-empty pages |
| Failed selected read, then full read | rejects corrupted selected associations without changing saved data |

## Error handling
Malformed request, limit or continuation → content-free `invalid-request`. Missing newest → `missing`; missing before scope → `invalid-request`. Selected decryption, decoding and association failures → `unreadable`. Preserve `encryption-unavailable` and `unsupported-version`. Log only static operation/result codes through the existing diagnostic events.

## Testing strategy
Extend the existing real-file fixture. Test first: focused paging scenarios fail before methods exist. Prove 200-row windows and exhaustive traversal, multiplicity/timestamp independence, optional absence, scope coverage, fragmented evidence, shared gaps, receipt projection order and anchors, exact UTF-16 ownership, stale/invalid continuations, corruption and unchanged full reads. Instrument SQLite result reads and encryption/decode processing to prove unrelated rows/members/cursors do not grow work, including a receipt spanning old history and the selected window. Run focused units, final pre-verify and build. No UI or live-test change.

## Open Questions
None. Cleaner shape considered: retain full `execute` unchanged and expose separate methods, avoiding a new shared IPC request union and consumer migration.

Sizing: one independently checkable paging behavior; approximately 780 written lines (including tests/codec extraction/plan), at most four new exported declarations, zero consumer migrations, four observable acceptance groups and fewer than ten classified rejection branches.

## Security review
**Verdict:** PASS
- [Trust boundaries] Main-only methods admit unknown input before database access; selected encrypted records cross one codec/association boundary. Full snapshots retain strict complete evidence validation.
- [Tokens/secrets] Continuations are structural positions, not credentials or daemon cursors. Scope UUIDs come from existing `randomUUID`; every replacement rotates identity. No secrets enter logs.
- [File/storage] Existing userData database, permissions, safeStorage-backed `SecretEncryption` and memory temporary storage remain. No new plaintext columns; existing UUIDs, nonnegative ordinals/ids and signed-safe row keys alone drive queries. SQL parameters contain admitted coordinates/structural values, never paths or content.
- [Electron surface] No new IPC, preload, renderer or window capability; application admission is deferred to #1975/#1931.
- [Cryptography] Reuse protected record encryption; fail closed on unavailable encryption. No new cryptographic primitive or secret comparison.
- [Network/I/O] No network operations; only bounded selected payload reads and necessary anchors. Unrelated memberships/cursors must not cause decrypt amplification.
- [Errors/logs] Static operation/result classifications only; no coordinates, continuations, plaintext, ciphertext or caught errors in diagnostics.
- [Concurrency] One transaction binds every page and its evidence to one committed UUID; no async interleaving or long-lived work.
- [Threat alignment] Hostile stored payloads and index mismatches reject as unreadable; exact UTF-16 ownership prevents cross-owner aliasing. Compromised renderer obtains no added capability. Relay/daemon protocol handling remains outside this main-only storage change (#1931/#1975).
**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-15
