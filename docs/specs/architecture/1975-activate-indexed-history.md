# Activate protected indexed history

## Files read

- `src/main/chatHistoryStore.ts` → `decode`, `createChatHistoryStore`: collection validation, queue and public results.
- `src/main/historyDatabase.ts` → `transaction`: synchronous rollback and schema admission.
- `src/main/indexedLegacyHistory.ts`, `src/main/indexedThreadHistory.ts` → `execute`: protected reconstruction and full replacement.
- `src/main/chatHistoryHandler.ts` → `createChatHistoryHandler`, `clearServer`: saved-host admission and generation fencing.
- `src/main/index.ts` → `flushHistory`, `drainQuit`: application lifetime and shutdown ownership.
- `src/main/historyNativeSmoke.ts`: existing packaged production-adapter proof.
- `src/main/chatHistoryStore.test.ts`, `src/main/daemonItemHistory.test.ts`, `src/main/appUpdate.test.ts`, `e2e/daemon-item-cache.test.ts`, `e2e/chat-history-removal.test.ts`: persistence factories and held-operation barriers.
- `docs/knowledge/INDEX.md`, root `CLAUDE.md`, `docs/knowledge/features/chat-history.md`, `chat-history-api.md`, `chat-history-testing.md`, `development-verification.md`: exact UTF-16 ownership, full-read compatibility, evidence preservation and counted native proof.

## Context

Replace repeated whole-collection decoding with the merged indexed backends. The upgrade is one independently observable deliverable: importing without activating has only this activation as a consumer. Following refinement's floor exception, forecast about 900 written lines (approximately 100 above the normal ceiling), no new exported types, eight construction sites, five behaviors and fewer than ten classified failure branches. Lists will also move into encrypted SQLite cells so removal and import have a single commit boundary. No wire, renderer or UI change is required; no ADR is requested.

## Design

- Extend the database schema additively with protected list cells and a singleton import-completion/source-retirement record. Reject unknown versions without replacement.
- Expose synchronous classified backend execution alongside existing Promise execution. The store checks classified errors and throws them inside its enclosing transaction, ensuring both families and completion roll back together. Bounded page methods remain callable unchanged for #1931.
- Before the first operation, validate the complete version-1 source through the existing collection decoder and `parseChatHistorySnapshot`. In one synchronous transaction, import only missing scopes/lists and commit completion. Existing database records win irrespective of timestamps. Successful application removals always follow completion, so its durable marker also fences replay after deletion and identical-coordinate reuse.
- Encrypt list snapshots with `SecretEncryption`, bind ownership using UTF-16LE BLOBs, and validate decrypted ownership before use. Lists read only their own cell after import.
- Retire the fixed protected source name after commit. A durable pending flag survives interruption or cleanup failure; retry direct deletion without reopening/decrypting the source. Reads remain available from the committed database; removal reports cleanup failure through `remove-failed`.
- Full reads/replacements delegate to the existing backends; replacements remain complete. Remove both families and list entries in one transaction. Host removal enumerates off-screen records through the existing backends.
- Preserve handler saved-host checks and credential-first clear ordering. Add conversation-generation invalidation for requests admitted before confirmed removal; fresh requests may reuse identical coordinates.
- Construct one database/encryption/store at the composition root. Drain the store queue and close the database only on application shutdown after renderer flushing, retaining window-close/reopen behavior.
- #1908 overlaps `src/main/index.ts` in independent device/command wiring; keep edits local.

## State + concurrency model

The handler owns authorization/admission, the store owns serialized import and disk operations, and the database owns synchronous transactions. Never await within a SQLite transaction. No new stream, timer or renderer slice. A failed operation settles the queue; the next request retries from committed state. Source retirement is durable state separate from completion.

## State transitions and identity reuse

| Event | Proof |
| --- | --- |
| First import / fresh reopen / repeated source | Migration tests compare exact two-format snapshots, lists and owner isolation; completion forbids replay. |
| Interrupted import / protection or SQL failure / retry | Migration tests inject failure between formats and assert rollback, intact source and later success. |
| Commit then source cleanup failure / restart | Migration cleanup retry test keeps completion and newer replacements/deletions while retrying retirement. |
| Held import/save then removal or unpair | Existing held-operation regressions move their barriers to operation admission; fresh-instance reads prove both formats and off-screen removal. |
| Conversation or host identity reused / stale queued work | Handler regression rejects prior-generation requests but admits fresh same-id/epoch content and preserves other hosts. |
| Quit / window reopen | Existing flush/relaunch regressions plus store close/drain assertions. |

## Error handling

Keep existing classified results: invalid requests before I/O, unsupported versions, unreadable protected/invalid content, unavailable encryption, write and remove failures. Never delete unreadable sources, recreate an unsupported database, or initialize empty content as recovery. Cleanup failure logs static codes only and remains retryable. Logs exclude identities, text, paths, ciphertext and caught exceptions.

## Testing strategy

- Test first with real temporary SQLite and existing reversible protection fixtures; reopen fresh owners for exact content, optional fields, ownership, saved-empty/missing and full replacements.
- Exercise source validation, rollback, existing newer database content, completion and retirement interruption, restart deletion fences, held operations, unpair, queue recovery and plaintext absence in every history file.
- Adapt existing storage factories and their collection-write barriers to the activated boundary; retain writer-to-restart, protected history, removal and update drain assertions.
- Extend the existing packaged native smoke to use the activated store and request Linux/macOS manager evidence on the pushed revision. Record executed/failed/skipped counts; dispatcher-owned full fake suite remains later-stage work.
- After the final main merge run pre-verify and `npm run build`, plus every changed spec. No live Claude spec is changed or required.

## Open Questions

None. The simpler atomic design stores protected lists in SQLite rather than coordinating two writable stores.

## Security review

**Verdict:** PASS

- [Trust boundaries] `parseChatHistoryRequest`, collection `decode` and backend reconstruction validate untrusted IPC/disk content; list reads additionally compare exact requested ownership.
- [Tokens, secrets] Reuse selected `SecretEncryption`; fail closed before storage when unavailable. Credentials remain in the existing secure store.
- [File operations] Database path comes only from trusted userData; no ids become filenames. Existing 0700 directory, 0600 database, memory temporary store and protected payloads cover journal/temporary leakage. Import and completion share rollback; retirement never erases unreadable input.
- [Electron] No new IPC capability or window policy; all database and protection work stays main-only, behind saved-host authorization.
- [Cryptography] Existing OS protection and backend UUID identities are reused; no new primitives, keys or nonces.
- [Network and I/O] No new network path. Existing relay frame limits and cancellation are unchanged.
- [Errors and logs] Static classified operation/result events only; never log caught errors, fixture content, credentials or raw ids.
- [Concurrency] Serialized authorization/import/save/removal, durable completion and drain-before-close prevent stale work/source replay; fresh admission permits intentional coordinate reuse.
- [Threat model] Malformed daemon/saved content is parsed; compromised renderer lacks filesystem/keys; disk readers see protected payloads. Relay security remains existing transport responsibility; no transport changes.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-15
