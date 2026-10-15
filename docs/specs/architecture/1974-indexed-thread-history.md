# Protected authoritative history and bounded pages

## Files read
- `src/main/historyDatabase.ts` → `createHistoryDatabase`: sole connection owner and transactional migrations.
- `src/main/indexedLegacyHistory.ts` → `createIndexedLegacyHistory`: independent family, static results, protected records and rollback conventions.
- `src/main/indexedLegacyHistory.test.ts` → on-disk fixtures: restart, corruption, scoped ownership and ciphertext evidence patterns.
- `src/shared/chatHistory.ts` → `retainedThread`, `parseChatHistoryRequest`: exact retained JSON admission and conservative progress defaults.
- `docs/knowledge/features/chat-history-api.md` and `chat-history-results.md`: independent callable storage, preservation on failure and reviewed columns.
- `docs/knowledge/features/thread-item-store.md` → Snapshots and completed batches; Repair and unfinished-batch checkpoint fences: arrival permutation and covered unfinished progress must survive restart.
- `docs/knowledge/features/development-verification.md`: selected storage tests prove this callable seam; application activation belongs elsewhere.

## Context
Provide an independently callable authoritative backend on the existing protected database. Collection import/application binding remains #1975; activation and partial writes remain #1931. Legacy evidence cannot certify daemon facts. No UI changes or documentation requirements.
One independently usable deliverable: protected authoritative replacement, reads and bounded local pages. Estimated written work: 380 production/schema/codec lines, 320 test lines, 80 plan/security lines; 780 total, two exported types, no consumer migrations, five observable criteria, fewer than ten classified failure branches.
Overlap: #1980 adds an independent legacy index migration in `historyDatabase.ts` and legacy codecs adjacent to `retainedThread`; build additively without relying on it. Migration version numbers may need resequencing on merge.

## Design
`createIndexedThreadHistory({ database, encryption, log }).execute(unknown)` accepts existing readThread/replaceThread/removeConversation/removeServer requests and distinct newestThreadPage/beforeThreadPage requests with integer limits 1–200. Before requests require an opaque local continuation. Export a page type and result union extending the existing static result vocabulary.
Schema 3 adds authoritative scopes (fresh UUID identity and UTF-16LE owner BLOBs) and independently encrypted header/item/range records. Structural columns are scope, fixed record kind, held/range ordinal, nullable first-arrival position, nullable nonnegative safe-integer item order and range start/end. No daemon text, epoch, item kind, opaque cursor or unknown JSON becomes an index. Unique arrival positions and contiguous held/range ordinals are checked against protected counts.
Every encrypted record envelope binds its scope identity and structural indexes to its payload. Header holds scalar metadata, counts and arrival-presence flag, never items, ranges or the arrival permutation. Full reads reconstruct all records, validate through the unchanged full-snapshot contract and compare canonical records/index associations. Existing addressed snapshots are validated before replacement/removal; server removal validates all exact authoritative scopes.
Expose `threadHistoryCodec` with narrow items/ranges/scalar-metadata validators shared with `retainedThread`. Preserve the full validator's aggregate inert-JSON node budget, own prototype-like keys and existing callers. Selected validation never claims a shortened snapshot is complete.
Pages use held ordinals, selecting the last window or the immediately preceding exclusive window. Protected counts determine contiguous expected positions and local exhaustion without an extra probe. Return scalar metadata separately, with explicitly partial items, arrival positions and ranges. Select intact ranges containing selected indexable orders, plus the last saved range as anchor, deduplicated in saved order. Nonindexable orders remain inert payload content. Decode only selected evidence and header.
Continuations are protected, bounded local tokens containing format, exact owner, epoch, committed identity and exclusive held boundary. Admission validates shape and compares all bindings within the read transaction; replacement always changes UUID, including identical and empty replacements. Local exhaustion has no effect on daemon completeness or repair.

## State + concurrency model
No stores, streams, subscriptions or long-lived tasks. Parsing detaches input synchronously before database access. All database work is synchronous inside the supplied owner's transaction, so selected records/header share one committed view. Encryption availability is checked before opening/migrating. Migration and operations roll back together. Close remains owned by `createHistoryDatabase`.

## State transitions and identity reuse
| Event | Regression test |
| --- | --- |
| Save, close and fresh-instance reopen | exact round trip and first-arrival restart |
| Repeated newest/before requests | 200-item windows traverse held order exactly once |
| Identical replacement or epoch change | continuations reject replaced snapshots |
| Delete/recreate same owner | continuations reject recreated snapshots |
| Same ids on another host or malformed token | cross-owner and malformed continuations |
| Failed replacement/removal/migration, retry | transaction failures preserve committed data |
| Covered unfinished progress and older missing metadata | optional defaults and covered unfinished progress |

## Error handling
Invalid requests/limits/continuations use `invalid-request`; malformed saved metadata/associations or decryption failures use `unreadable`. Unsupported schema uses `unsupported-version`; unavailable encryption uses `encryption-unavailable`; mutation failures use `write-failed`/`remove-failed`. No caught error, request content or coordinate reaches diagnostics. Emit existing static storage operation/result events.

## Testing strategy
- Write on-disk Vitest regressions before implementation, observe the missing backend failure, then implement. Use the pinned real adapter and a local reversible encryption fake; no shared harness.
- Exact normalized full round trips including hidden/unordered/null/unknown fields, sparse ranges, arrival ties, empty/missing, optional defaults, unfinished progress and equal ids across lossless owners.
- Instrument decrypt calls and selected SQL reads/JSON decoding to prove page work stays bounded as unrelated history grows; page traversal returns each held item once.
- Corrupt protected headers/index associations, inject SQL/encryption failures, test unavailable encryption and unsupported versions, and prove atomic preservation/migration and family-scoped cleanup.
- Inspect database, sidecar/temporary bytes and static diagnostics for unique text/attachment/unknown/cursor sentinels after successful and failed writes.
- Final main merge, pre-verify (full unit suite/typechecks) and build. No renderer, Playwright or live-daemon change is needed.

## Open Questions
None. Protected per-record envelopes are the smallest way to verify index associations without decoding unrelated records; header counts eliminate the continuation probe.

## Documentation handoff
- Pending documentation stage: `docs/knowledge/features/chat-history-api.md`, API — callable authoritative operations, additive schema-4 migration, partial page contracts and compact continuation binding/invalidation/bounds.
- Pending documentation stage: `docs/knowledge/features/chat-history-results.md`, Results and failure preservation and Bounded page results — authoritative protected structural columns, static failures, atomic preservation and authoritative-only scoped removal.
- Pending documentation stage: `docs/knowledge/features/thread-item-store.md`, Snapshots and completed batches and Repair and unfinished-batch checkpoint fences — selected arrival/range facts remain partial while saved checkpoint, repair and availability metadata remain unchanged.

## Revisions
2026-10-15: Verifier finding 1 reproduced on disk: maximum-length lone-surrogate owners/epoch produce a continuation rejected by its own admission limit. Replace redundant owner/epoch token fields with `{ format: 'daemon-items', identity, before }`. The encrypted UUID is checked against the exact UTF-16LE scope lookup and validated header in one transaction; that immutable committed identity binds the owner and epoch, including after reopen. Replacement and deletion/recreation still rotate the identity. Fixed format, 36-character UUID and safe-integer boundary serialize to at most 101 ASCII bytes, independent of admitted strings; the production protection bridge expands that plaintext to at most 136 base64 bytes before OS protection. Generation and admission share the 65,536-character encoded limit; excessive injected protection overhead fails closed before returning a token. On-disk regressions use 8,192 lone surrogates per coordinate/epoch and base64-expanding protection with 0/4,096 extra bytes, follow the returned token after fresh reopen, and reject it after epoch replacement.

2026-10-15: Merge of main resequences authoritative tables to schema 4 after main's schema-3 legacy receipt-start index. Both migrations remain additive and transactional; existing schema-3 databases from either branch retain their records. Historical-schema tests now expect version 4 after successful migration.

2026-10-15: Adversarial implementation review found that selecting ranges only by mutable numeric indexes could silently omit damaged evidence. Each item now also binds its nullable containing-range ordinal inside its protected envelope and reviewed structural columns. Pages select those exact memberships plus the newest anchor and verify containment; missing evidence is unreadable. This simplifies the query and preserves bounded work. Security re-review: PASS; range membership reveals only the already reviewed numeric coverage association. Legacy historical-schema fixtures remove the new tables before down-versioning and use an actually unsupported future version. Existing #1903 store regressions remain in the full suite; main-process tests do not import the renderer.

2026-10-15: A failing schema-2 regression demonstrated that returning a stale-continuation result inside the transaction committed migration despite rejection. Stale admission now throws a private static sentinel through the transaction, then maps it to `invalid-request` outside, preserving database bytes and schema on failure. No caller-visible contract changed.

## Security review
**Verdict:** PASS

- [Continuation size re-review, finding 1] PASS after the revised compact contract: exact scoped lookup plus protected header and per-commit UUID retain owner/epoch/format binding without copying attacker-controlled strings into tokens. Token plaintext is at most 101 ASCII bytes (136 through the production base64 protection bridge); the shared encoded-size guard prevents any backend from emitting an over-limit token. Admission still rejects malformed, wrong-format, wrong-scope and stale tokens with static errors. Boundary-string traversal/reopen tests include additional protection expansion; no new structural columns, cryptography, IPC, network or lifecycle surface is added. The nine-category review below remains applicable.
- [Trust boundaries] Requests pass existing detached parsing; page limits/token shapes are separately admitted. Disk payloads pass shared selected validators and protected index-envelope comparison; full reads additionally validate complete membership.
- [Tokens, secrets, credentials] Continuations are encrypted through `SecretEncryption`, bound to exact owner/epoch/format/fresh durable UUID. No credentials or new key lifecycle. Unavailable protection fails before database access.
- [File and storage operations] Sole existing database owner uses fixed userData paths, restrictive permissions and memory temporary storage. All content is encrypted before SQLite binding. Reviewed plaintext columns are only owner BLOBs, UUID, fixed kind, positions, safe numeric order/range bounds. Atomic migration/replacement/removal never recreates unsupported/unreadable data.
- [Electron attack surface] Callable main-only seam introduces no IPC, renderer, navigation or protocol surface; #1975 owns application binding and its authorization.
- [Cryptographic primitives] Existing OS-backed encryption is injected unchanged; randomUUID supplies fresh committed identity. No new cryptography or secret comparisons.
- [Network and I/O] No network operations or new external paths. Bounded limits and existing JSON/identifier limits constrain selected admission; full replacement retains existing limits.
- [Errors, logs, telemetry] Only fixed operation/result codes enter diagnostics; payloads, tokens, coordinates, exception text and decrypted bytes are excluded. Sentinel assertions cover rollback paths too.
- [Concurrency] Synchronous owner transactions avoid await races; no background work. Every replacement rotates identity; reopen never revives stale tokens.
- [Threat model alignment] Hostile saved JSON is validated and retained inertly. Disk readers see protected content, with explicitly reviewed structural leakage. Relay and compromised-renderer transport isolation remain unchanged; application authorization remains #1975.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-15
