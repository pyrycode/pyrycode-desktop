# Stable protected thread bindings

## Files read

- `src/main/indexedThreadHistory.ts` → `records`, `decode`, `load`, `readPage`, `executeSync`: current protected indexes, full admission and bounded pages.
- `src/main/historyDatabase.ts` → `createHistoryDatabase`: one synchronous SQLite owner and transactional schema chain.
- `src/main/chatHistoryStore.ts` → `importSource`: nested backend errors must abort the enclosing import transaction.
- `src/shared/chatHistory.ts` → `threadHistoryCodec`, `parseChatHistorySnapshot`: retained complete and partial admission contracts.
- `src/main/indexedThreadHistory.test.ts` → disk fixtures: ordering, bounded selection, tampering, rollback and covered unfinished progress.
- `src/main/chatHistoryMigration.test.ts` → import/reopen and deferred commit failures: retain production integration unchanged.
- `src/main/historyNativeSmoke.ts`, `e2e/history-native.spec.ts` → packaged safeStorage/import/reopen proof.
- `docs/knowledge/features/chat-history-api.md` → Main-only bounded authoritative pages: pages never admit shortened full snapshots or scan complete history after migration.
- `docs/knowledge/features/development-verification.md`, root `CLAUDE.md`: verification and process boundaries.

## Context

The replacement UUID currently owns ciphertext and continuation mutation identity. Separating those responsibilities enables later owned writes without moving payload ownership with held positions or evidence. This ticket activates the new format through existing replacement/import/full/page operations; #2044 owns incremental writes and #2041/#2042 own restoration/navigation. No new public update API or dependency. No in-flight feature branch overlaps the planned files; #2026 is coordination only and is not present remotely.

## Design

Keep the existing protected `thread_records` as placement/evidence records. Add `thread_payloads(scope, item_id, revision, payload)` with primary lookup `(scope, item_id)` and cascading scope ownership. Its encrypted envelope binds the stable scope owner, epoch, item id, revision and exact admitted item. It contains no held ordinal, range position or continuation generation.

Item placement records retain their existing protected numeric indexes, but their protected value becomes an item id/revision and SHA-256 digest of the exact protected payload. Decoding a placement validates its indexes, looks up the payload, verifies its digest and protected ownership/epoch/id/revision, then returns the admitted item. This prevents an unprotected lookup edit, payload substitution or evidence-index edit from silently changing content or hiding evidence. Header metadata still binds the exact host/conversation; item order still agrees with placement and selected range containment.

Add a protected generation UUID to the header. Tokens keep their compact existing format, using generation as `identity`. Replacements preserve the scope owner, rotate generation even for identical/empty content, and reuse exact ciphertext for unchanged items in the same epoch. Changed items receive new protected payloads; placement/evidence records are rewritten. Removal/recreation receives a new owner and generation. Deleting/reinserting the scope inside the same transaction retains existing insertion/commit failure semantics.

Schema 6 is admitted by the database owner. On the first authoritative operation against schema 5, validate every existing authoritative scope with the old protected decoder and full snapshot admission, then create/populate the new payload table, rewrite placement/header records and set schema 6 in that same transaction. Retain each old owner as its initial generation, preserving old continuation tokens. Earlier schema migrations remain chained. Conversion scans once only; schema 6 pages select only their header, held window, referenced payloads and relevant ranges. The shared codec and application import require no signature changes.

Cleaner-shape check: reusing protected placement records avoids a second placement hierarchy and keeps existing bounded evidence selection intact. A single giant protected manifest would require whole-history page work and was rejected.

## State + concurrency model

One existing database owner and synchronous transaction per operation; the application store retains its serialization queue. Migration, replacement and enclosing multi-family imports commit or roll back together. No new async task, store slice, subscription or renderer capability. Database close retains its existing owner.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| Schema-5 upgrade, close and fresh reopen | `upgrades committed schema-5 history transactionally and preserves old continuations` |
| Interrupted/corrupt/unavailable upgrade, retry | `preserves schema-5 commits across failed migration and retries` |
| Same-epoch reorder/evidence/progress change | `retains stable payloads while replacement rotates generation and changes placement` |
| Identical/empty replacement, deletion/recreation | Existing continuation regression plus stable-payload replacement test |
| Equal host/conversation/item identifiers, epoch change | Existing scoped cleanup and continuation tests plus protected payload tampering tests |
| Import completion, rollback and restart | Existing `chatHistoryMigration.test.ts` fixtures |

## Error handling

Retain existing typed result classifications and static operation/result diagnostics. Invalid requests precede storage. Protected association/schema/decode failures are unreadable, unavailable encryption fails closed, and write/removal failures retain the last commit. Migration failure rolls back schema and records and retries on the next operation; no completion marker commits ahead of protected validation. No daemon text, ciphertext, keys, coordinates or tokens enter diagnostics.

## Testing strategy

- Write disk regressions first; observe new layout assertions fail against schema 5.
- Reuse the existing disk helpers to seed genuine old encrypted envelopes, prove upgrade/reopen and token preservation, and inject encryption/SQL/corruption failures with retry.
- Assert retained ciphertext across reordered held items, revised evidence/progress and identical replacements; verify lookup/revision/owner/epoch/digest and placement/range tampering fail closed.
- Retain complete round-trip, first-arrival ties, null/inert JSON, optional defaults, hidden/unordered items, empty/missing and covered unfinished-progress tests.
- Update the bounded-work assertion to account for separate placement/payload decrypts, retaining a constant bound as unrelated history grows.
- Run applicable units, final-main pre-verify, build, and the ticket-required complete configured fake suite including admitted packaged protected-storage/reopen on Linux. Record revision and executed/passed/failed/skipped counts. Other OS outside scope; no live specs change.

## Open Questions

None. Estimated written work: 270 production + 270 tests/helpers + 90 plan/security = 630 lines; no new exported type, no consumer signature update, five acceptance behaviours and eight classified reject paths. Within all size limits.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — `executeSync` detaches/admit requests, `decode` validates protected placement facts and payload digest/owner/epoch/identity, and `load` retains full snapshot admission. Migration never trusts plaintext indexes alone.
- [Tokens, secrets, credentials] No findings — UUIDs use Node `randomUUID`; generation is protected in header and tokens. Existing main-only `SecretEncryption` uses safeStorage and fails closed. Replacement rotates generation, deletion/recreation rotates ownership.
- [File and storage operations] No findings — fixed owner-controlled userData path, existing restrictive permissions, protected payloads, atomic SQLite migration/replacement/import; no untrusted string becomes a path.
- [Electron attack surface] No findings — no IPC, preload, renderer, navigation or window-preference changes; only existing typed full operations remain exposed.
- [Cryptographic primitives] No findings — safeStorage remains the confidentiality boundary; Node SHA-256 binds exact ciphertext to protected placement facts. Digests and UUIDs are public associations, not secret comparisons. No custom cipher, Noise or key change.
- [Network and I/O] No findings — no network work; synchronous database operations retain the existing owner and transaction boundaries.
- [Errors, logs, telemetry] No findings — only existing static event/code classifications; no payload, daemon text, token, key, ciphertext or exception text is logged or rendered.
- [Concurrency] No findings — no await inside SQLite transactions; schema version is committed only with validated conversion; nested failures abort import through the existing caller contract.
- [Threat model alignment] No findings — hostile saved content remains bounded inert JSON; disk theft remains protected by safeStorage, unavailable keychain refuses work, and compromised renderer gains no key/SQL/raw-data capability. Relay/Noise behaviour is untouched. Full malicious rollback of all protected disk state is outside existing storage guarantees.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-16

## Revisions

2026-10-16: adversarial implementation review identified replay of an older protected placement under a retained owner. Bind every item placement and range envelope to the header's current generation; only the header binds directly to the stable owner. Payload envelopes continue binding the stable owner and epoch. This rejects old placement/evidence replay after replacement without re-encrypting unchanged payloads. `rejects protected payload association tampering: replayed-placement` covers the invariant. Security verdict remains PASS with this binding required.
