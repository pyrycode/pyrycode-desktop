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

## Revisions

2026-10-16: The final consumer search found `DurableThreadItem` had only its obsolete equality test left after renderer retirement; remove both rather than keep an unused storage type. `chatHistoryWriter` also retains an impossible timeline guard and exclusion alias; simplify those to the retained snapshot contract. The packaged smoke replaces obsolete 100,000 receipt memberships with 1,000 retained daemon items and checks protected replacement/reopen timing, production encryption and plaintext exclusion. No retained format or lifecycle changes.

2026-10-16: The required focused live run executed but failed at its unchanged initial channel-post baseline, before storage assertions. The same failure reproduced against an untouched export/build of main `41bd0e2173d5`; its screenshot shows an empty thread and the runner-start failure notice with the existing `spawnClaude: false` fixture. Track the independent investigation in #2046 and skip that scenario with an explicit link, per the out-of-scope bug policy. No live pass is claimed. The retired storage fallback is still removed, and all authoritative assertions remain for re-enablement by #2046.

## Validation — Linux x64, 2026-10-16

- Final merge: `origin/main` at `41bd0e2173d5`; pre-verify passes all five checks. Units: 9,106 executed/passed, 0 failed, 30 skipped across 390 passing files. Build and docs guard pass. Final logs: `/tmp/builder-2026/pre-verify-final.log` and `/tmp/builder-2026/build-final.log`.
- Complete configured fake Playwright: 435 executed/passed, 0 failed, 3 skipped, 0 flaky, 0 retries; both clipboard/parallel projects, four workers, no selection or shard filters. The skips are the two macOS badge cases and macOS window reactivation. Report `/tmp/builder-2026/fake.json`; no top-level errors or fake-daemon-setup attachments. Configuration SHA256 `7097078cf6aaa5b94888a26af30c0f6bb000e6be66ff78891630f2a19a32795b`.
- Packaged smoke within that suite: 1 executed/passed, 0 failed/skipped; Electron 33.4.11, Node 20.18.3, better-sqlite3 12.4.1, `gnome_libsecret`, packaged ASAR/unpacked native addon, 1,000 retained items and 104 ms protected replacement. Original runtime evidence: `/tmp/pyry-history-native-fcNqRi/runtime.stdout`.
- Live named history-on-open scenario: candidate and unchanged main each 1 executed, 0 passed, 1 failed, 0 skipped before storage assertions. Daemon source `0917625fc6e91eeb2a16556f09e5ba0bbf62aabf`, binary SHA256 `dd2c2c290fd4acf58aabc87bbf3459ca18d3aae8f27cdd8b65eeb7cd06927a1f`. Reports `/tmp/builder-2026/live-source.json`, `/tmp/builder-2026/main-live.json`; baseline screenshot `/tmp/builder-2026/baseline-page.png`. Scenario now explicitly skipped pending Backlog/priority:low #2046. This is failed evidence, not live acceptance.
- Size audit: fewer than 400 inserted/rewritten lines including this plan; 693 production and 900 test lines deleted, including the 317-line legacy indexed backend and its 506-line exclusive suite. No new exports or consumer signature migration. macOS is outside this ticket's verification scope.

## Revisions — main integration, 2026-10-16

Merged main `ebea25db792825f9b200541d4d58fe69121ded5c` in `6c0a819e`. Preserve its owned mutations, bounded opening, saved traversal/recovery, writer changes and admission regressions while excluding retired timeline operations. The packaged proof now combines the 1,000-item retained import/replacement fixture with main's owned-update, bounded-opening, traversal and recovery assertions. Its owned-update reopen compares all retained items; plaintext checks include the owned-update sentinel.

The operator handoff closes the historical #2046 prerequisite and retires automatic live gating. Remove this branch's obsolete skip after the merge commit and run the original authoritative history-on-open assertions through the captured-client replay. Earlier failed live evidence above stays failed; replay establishes no current provider behavior.

Security re-review: **PASS**, builder self-review under `builder/security-review.md`. Trust/IPC: storage-only timeline recognition still validates version/ownership and never parses retired content; retained mutations/pages use main's strict admission. Tokens/crypto: safeStorage and production encryption remain unchanged, with no new key or credential paths. Files/storage: exact UTF-16LE cleanup and durable import/retirement fences remain transactional; protected smoke retains fresh-reopen/plaintext checks. Electron/network: no new bridge, navigation, socket or transport capability. Errors/logs: static classified codes only. Concurrency: main's existing queues, progress ordering, cleanup generations and shutdown drain are preserved. Threat model: hostile saved payloads stay inert or strictly validated; renderer access gains no legacy capability. No new findings.

## Documentation handoff

Pending documentation stage: update `docs/knowledge/features/chat-history-api.md` § API and `chat-history-storage.md` § Protected collection for removed legacy APIs/codecs, ownership-only recognition, ignore policy and scoped cleanup without reconstruction. Update `chat-history-testing-native.md` § Native runtime and packaged proof for retained list/item import, protected replacement/reopen, integrated owned/traversal checks and fresh counted Linux evidence. Preserve historical live failures while recording that #2046 and the automatic live hold are retired.
