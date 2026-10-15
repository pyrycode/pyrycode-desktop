## Files read

- `src/shared/chatHistory.ts` → `parseChatHistoryRequest`, `parseChatHistorySnapshot`: admission, projection and reconstruction contract.
- `src/main/chatHistoryStore.ts` → `createChatHistoryStore`: static results and diagnostic vocabulary; existing callers remain intact.
- `src/main/secureStore.ts`, `src/main/electronSecretEncryption.ts` → `SecretEncryption`, `electronSecretEncryption`: byte protection and Linux fail-closed gate.
- `src/main/chatHistoryStore.test.ts`: real-directory fixture and restart conventions.
- `docs/knowledge/features/chat-history.md` → Snapshot contract; `chat-history-api.md`, `chat-history-results.md`, `chat-history-testing.md`: ownership, failure preservation and proof boundaries.
- `docs/knowledge/features/development-verification.md`, root `CLAUDE.md`: counted verification and process boundaries.
- `package.json`, `electron-builder.yml`, `electron.vite.config.ts`: host Node, Electron ABI, dependency externalization and Windows packaging.
- Mobile #2162: independent indexed rows and evidence, without importing Mobile's different validation rules.

## Context

Supply an independently callable legacy backend, leaving application binding to #1975, authoritative storage to #1974 and bounded selection to #1980. One reusable database owner and a native runtime are one deliverable. No in-flight feature branches overlap the proposed files. No ADR is required.

## Design

`createHistoryDatabase({ userDataPath })` lazily owns one synchronous better-sqlite3 connection at a fixed `history/history.sqlite` beneath the trusted main-process application directory. It exposes transaction access for the legacy backend and future authoritative backend, plus explicit close. Schema version 1 is created transactionally only for an empty database; unfamiliar schemas are rejected without recreation. Foreign keys cascade scope removal. Schema additions use explicit versioned migrations in follow-ups.

`createIndexedLegacyHistory({ database, encryption, log })` exposes `execute(unknown): Promise<ChatHistoryResult>` for readTimeline, replaceTimeline, removeConversation and removeServer. Parse and detach requests before database access. Read and validate the affected scopes before mutation; unsupported or unreadable records prohibit replacement/removal. Reads reconstruct inside a SQLite transaction and pass the full result through the existing parser.

Each scope has exact BINARY server/conversation ownership and a fresh random UUID committed-snapshot identity on every replacement, including empty replacement and delete/recreate. A scope header holds only coverage, optional-field presence, allocator and prepended count. Separately encrypted record payloads represent held rows, served ids, receipts, receipt membership, display associations, gaps, legacy gap membership and refused cursors. Ordered child membership is separate from its parent payload. Plain numeric indexes support future row/evidence selection; no whole-timeline or all-evidence cell exists.

Pin better-sqlite3 12.4.1 and its type declarations. Keep host-Node rebuild separate from Electron rebuild (`electron-builder install-app-deps`); packaging rebuilds the adapter and unpacks native files from asar. Preserve NSIS x64/arm64 and add no release channel. A focused smoke packages an isolated entrypoint, uses the production backend, commits/closes/reopens the database, and emits runtime versions and nonzero counts. Linux runs locally; macOS evidence is recorded as pending per the issue's recovery direction if no managed Desktop-native route exists.

## State + concurrency model

All database work is synchronous inside transactions, with no await across a read/write seam. No renderer store, subscriptions, timers or background tasks are added. The caller owns connection close. SQLite rollback retains the prior committed snapshot, and later operations remain usable.

## State transitions and identity reuse

| Event | Test in `indexedLegacyHistory.test.ts` |
| --- | --- |
| Close/reopen over disk | exact fragmented round trip |
| Repeated replacement and delete/recreate | fresh identity and scoped isolation |
| Replacement failure after deletion/insertion | rollback and subsequent recovery |
| Host/conversation removal failure | rollback and subsequent recovery |
| Unreadable/unsupported storage | preserve original bytes |
| Unavailable encryption | reject before mutation |

## Error handling

Use existing static invalid-request, unreadable, unsupported-version, encryption-unavailable, write-failed and remove-failed codes. No caught exception strings escape. Encryption happens before each payload reaches SQL; transaction failure rolls back every indexed record. Diagnostics use only history-storage-operation/result and static operation/result codes.

## Testing strategy

Test first with real temporary databases and injected reversible encryption, reusing focused timeline shapes. Assert full parser-normalized equality including optional absence, misleading timestamps, attachments, fragmented evidence, saved-empty/missing, case-sensitive ownership, restart and malformed request rejection. Inject SQLite trigger failures during insertion/deletion and encryption/decryption failures; verify rollback, later recovery and unchanged unsupported/corrupt data. Inspect every database/sidecar/temp byte and captured diagnostic for unique message, attachment and cursor sentinels after successful and failed mutations.

Run focused Vitest, pre-verify and build after the final main merge. The packaged smoke must report actual production encryption, asar/native unpacking, platform/architecture, Electron/Node/adapter versions and executed/passed/failed/skipped counts. No Playwright or live daemon changes.

## Open Questions

None. A simpler shape was considered: a single encrypted timeline cell cannot support indexed evidence selection and violates the required follow-up seam. A shared typed record table avoids separate near-identical persistence implementations.

## Security review

**Verdict:** PASS

- **Trust boundaries:** Request admission and reconstructed disk input use the existing full parsers; SQL uses bound parameters and exact ownership. Unsupported operations are rejected before access.
- **Secrets:** Every payload uses main-process SecretEncryption. Unavailable encryption fails closed, including Linux basic_text. No credentials are introduced.
- **Storage:** Fixed application-private directory (0700), database (0600); sidecars inherit SQLite's database permissions. Transactions protect rows and evidence together. No destructive schema recovery.
- **Plaintext columns:** scope server/conversation are bounded exact ownership strings; snapshot identity is a locally generated UUID. Record kind is a fixed schema enum; ordinal/parent are nonnegative array positions; entry/range/anchor ids are nonnegative safe integers or null; row keys are signed safe integers or null. Payload is ciphertext BLOB. SQLite schema version is integer 1; indexes duplicate only these columns. No timestamps, join strings, cursors, attachment fields, message text or raw unknown objects are plaintext.
- **Electron:** No IPC/window/navigation changes. Native module and OS encryption remain in main; packaged smoke does not select test encryption.
- **Cryptography:** Existing OS-backed encryption, no new cryptographic primitive. UUIDs use node:crypto randomUUID and identify commits, not authorization.
- **Network/I/O:** No networking. Hostile saved content remains bounded by canonical parsing; SQLite errors are contained.
- **Diagnostics:** Static events/codes only; no coordinates, paths, payloads or exception details. Byte/diagnostic sentinel tests cover success and rollback.
- **Concurrency:** Synchronous transaction owner; no asynchronous suspension, jobs or resource listeners. Close/reopen and mutation failures are explicit tests.
- **Threat alignment:** Disk readers see ciphertext plus reviewed structural indexes. Hostile daemon/saved data passes allowlisted validation. Compromised renderer gains no new API. Relay threats remain in the existing transport, outside this ticket.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-15

Size recount: approximately 760 written lines (300 backend/schema, 150 native/build/lockfile, 230 tests, 80 plan), zero existing consumer changes, at most five exported declarations, four acceptance behaviours and six classified error outcomes.

## Revisions

2026-10-15: Native dependency resolution adds 347 lockfile lines rather than the forecast allowance. Measured final scope is approximately 910 written lines including lockfile and plan, with two exported factories and no consumer migration. Confirmed parentage #1930 → #1973 → #1979 prohibits another split; applied needs-human:sizing and continued the one independently usable backend/runtime deliverable. Without that floor/depth restriction, native packaging infrastructure would be the potential seam; it cannot independently establish this backend's protection.

Reconstruction groups child records by kind/parent to avoid repeatedly scanning every evidence record for each receipt/gap. The packaged check compares parser-normalized snapshots structurally, because JSON property order does not establish content equality. The smoke has explicit nonzero failure exit and static stage codes.

Linux packaged evidence: `/tmp/builder-1979/native-linux-4/runtime.stdout`, linux/x64, Electron 33.4.11, embedded Node 20.18.3, better-sqlite3 12.4.1; packaged=true, asar=true, unpacked=true, backend=gnome_libsecret; 1 executed, 1 passed, 0 failed, 0 skipped. Host-Node focused database suite: 6 executed, 6 passed. These are distinct runtime proofs.

Pending native artifact: macOS arm64 production-keychain packaged close/reopen proof, running `npm run check:history-native -- /tmp/builder-1979/native-macos-<run>` on the pushed candidate through manager admission. Retain `runtime.stdout` and `runtime.stderr` from that directory and attach counted runtime evidence to the PR. The current memory-runtime-smoke fleet recipe still clones core and runs Go; desktop-fake-suite runs the browser tier. Neither is a Desktop packaged SQLite smoke. The issue's recovery note explicitly directs recording macOS as pending in the PR; no macOS pass is claimed.

To make the existing Mac manager route usable without dispatcher changes, `e2e/history-native.spec.ts` executes the isolated packaging smoke as one ordinary Playwright case and records counted runtime stdout/stderr. Request desktop-fake-suite on the exact pushed commit; its unmodified full configuration then includes this native check. This replaces the earlier pending-only delivery route. No fake encryption or new shared fixture is introduced.
