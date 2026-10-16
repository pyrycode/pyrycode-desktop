# Retire legacy history storage

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `features/development-verification.md`: repository boundaries and counted Linux verification.
- `docs/knowledge/features/chat-history{,-storage,-api,-testing}.md`: protected import, exact UTF-16 ownership, native encryption proof and ordered cleanup contracts.
- `docs/knowledge/features/thread-runtime.md` → Restore, recovery and cleanup: authoritative-only restore.
- `src/shared/chatHistory.ts` → `parseChatHistorySnapshot`, `parseChatHistoryRequest`, `legacyHistoryCodec`: retained admission versus retired reconstruction.
- `src/main/chatHistoryStore.ts` → `decode`, `importSource`, `retireSource`, `run`: atomic source import and durable replay fence.
- `src/main/historyDatabase.ts` → `createHistoryDatabase`: schema versions and ownership migration.
- `src/main/indexedLegacyHistory.ts` → `createIndexedLegacyHistory`: retired full and bounded reads, writes and cleanup.
- `src/main/indexedThreadHistory.ts` → `createIndexedThreadHistory`: retained authoritative backend.
- `src/main/chatHistoryHandler.ts` → `createChatHistoryHandler`: membership and generation ordering remain unchanged.
- `src/main/historyNativeSmoke.ts`, `e2e/history-native.spec.ts`: packaged production encryption proof.
- `src/main/{chatHistoryStore,chatHistoryMigration,daemonItemHistory,indexedThreadHistory,chatHistoryHandler,appUpdate}.test.ts`, `src/shared/chatHistory.test.ts`: adapt shared regressions; delete legacy-exclusive assertions.
- `e2e/real-daemon-history-on-open.spec.ts`: remove obsolete legacy fallback, retain authoritative live acceptance.

## Context

Renderer legacy producers are gone. Saved legacy content must remain inert rather than become daemon facts. Main already includes #1975's schema-5 indexed backend. No new ADR is needed: this implements the existing ignore policy. Remote numeric feature branches were checked after fetch: no overlapping changes to the planned storage files (including no visible #2043 branch).

## Design

Remove timeline variants from shared snapshots/requests and delete the legacy codec, indexed reader/writer/page APIs and exclusive tests. Keep `DurableThreadItem`, which still describes renderer presentation, without its obsolete persistence equality test. Retain authoritative full/page APIs and list storage.

At the storage-only collection boundary, recognize a version-1 `timeline` envelope and validate bounded server/conversation ownership using retained request admission; skip its payload entirely. Unknown versions/kinds, invalid ownership and malformed retained snapshots still reject the source. Duplicate retained identities still reject. The shared parser has no ignore path: retired IPC requests fail before membership or disk access.

Import only lists and daemon items, preserving the existing indexed-wins rule, transaction, completion marker and source retirement. Scoped removal directly deletes matching `legacy_scopes` with UTF-16LE keys and cascading records inside the existing transaction, without decrypting retired content. Keep the old schema tables/migrations so existing databases open safely; use retained ownership admission in the schema-1 migration. No table dropping, background job or new dependencies.

Retarget shared lifecycle tests to authoritative snapshots. Seed old indexed records directly in existing fixtures instead of calling the deleted writer; assert retained bytes survive independent authoritative operations and disappear only for addressed cleanup. Retarget the packaged smoke to mixed-source ignore, list/item import, protected authoritative replacement and fresh reopen, preserving native packaging/encryption and plaintext checks.

Size recheck: one storage contract, four observable acceptance criteria; approximately 650 written lines including plan/tests, zero new exported types, six production consumer seams, fewer than ten classified failure branches. Legacy code/test deletions reported separately. No signature migration of retained consumers.

## State + concurrency model

No new state or asynchronous tasks. Store and handler queues, generation fences, synchronous nested transactions, source completion/retirement and close draining retain their existing ownership. Legacy cleanup participates in the same removal transaction as thread/list cleanup.

## State transitions and identity reuse

| Event | Regression |
| --- | --- |
| Mixed source import and reopen; newer indexed facts win | `chatHistoryMigration.test.ts`: imports retained formats once |
| Legacy-only source/indexed scope | focused ignore-policy tests in `chatHistoryMigration.test.ts` |
| Interrupted import and retry | existing import rollback and queued retry cases |
| Removal/unpair then identical reuse; retirement retry | existing held import, generation and replay-fence cases |
| Repeated saves/removals, detached input | `chatHistoryStore.test.ts` existing ordering cases retargeted to items |
| Close with admitted work and later requests | existing drain case and indexed-history lifecycle Playwright specs |
| Equal host/chat IDs, case/NUL/lone surrogate IDs | indexed isolation tests and focused scoped legacy cleanup |

## Error handling

Keep static typed result codes and content-free operation/result logs. Unsupported retained formats fail closed without source retirement or overwrite. Ignored timeline payloads are never interpreted. Corrupt retired payload bytes cannot block scoped cleanup; SQL failures still roll back cleanup and produce `remove-failed`.

## Testing strategy

- Write focused mixed-source ignore and retired-request rejection tests first; observe failures before implementation.
- Retain migration rollback, replay fences, protected bytes, isolation, lifecycle and malformed retained-data tests; remove only retired-format assertions/fixtures.
- Run install, final main merge, pre-verify, build and complete configured fake Playwright on Linux, including packaged production-encryption smoke. Record counts and revision in PR. macOS is outside this ticket's scope.
- Run the changed real-daemon history-on-open test through the configured live launcher; no broader live sweep.

## Open Questions

None. Storage-only recognition validates the envelope, never retired rows. Scoped cleanup uses existing foreign-key cascades.

## Security review

**Verdict:** PASS

- [Trust boundaries] Saved JSON crosses `decode`; only recognized version-1 timeline envelopes skip payload admission. MUST FIX addressed in design: validate ownership before skipping, while retained records still use `parseChatHistorySnapshot`. IPC uses the strict retained allowlist and rejects legacy operations before storage.
- [Tokens/secrets] No credential changes. Production `SecretEncryption` remains OS-backed safeStorage and unavailable/basic-text protection fails closed. No payload or ownership values enter new logs.
- [File/storage] Fixed userData paths, restrictive modes, encrypted payloads, SQLite transactions and protected source retirement remain. MUST FIX addressed: cleanup binds exact UTF-16LE keys rather than reconstructing attacker-controlled legacy payloads.
- [Electron] Removes IPC capabilities without adding channels or changing isolation/security settings; membership and generation guards remain.
- [Cryptography] No primitive/key/nonce changes; existing production adapter remains the encryption boundary.
- [Network/I/O] No new network or I/O paths; bounded retained parsing remains and ignored bodies cannot reach network/rendering.
- [Errors/logs] Static classified errors only; no caught exception, text, keys or decrypted bytes logged.
- [Concurrency] Existing single-owner queues, atomic import marker, retryable retirement and close drain preserved; held-import/removal/reuse regressions verify ordering.
- [Threat model] Hostile saved content receives envelope-only recognition or strict retained validation. Compromised renderer loses legacy admission; relay/Noise behavior is unchanged. Disk theft protection remains safeStorage, proved by packaged smoke; hostile retained daemon facts remain bounded inert JSON.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-16
