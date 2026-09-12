# Protected local chat history

## Files read

- `src/main/secureStore.ts` → `createSecureStore`, `EncryptionUnavailableError`: protected byte boundary and missing/decrypt distinction.
- `src/main/fileSecretPersistence.ts` → `fileSecretPersistence`: owner-only files, atomic temp/rename replacement, idempotent deletion.
- `src/main/pairedServerStore.ts` → `createPairedServerStore`: constant collection name, saved `server` identity and ordered mutations.
- `src/main/serverInfoHandler.ts` → `registerServerInfoHandler`: injected boundary and credential containment.
- `src/main/hostLabelHandler.ts` → `registerHostLabelSetHandler`: saved-host membership independent of connection state.
- `src/main/diagnosticLog.ts` → `DiagnosticLog`: static event/code logging.
- `src/shared/wire/types.ts` → `ConversationSummary`: eight ordered-list metadata fields.
- `src/shared/ipc/events.ts` → `ModelRefusalEvent`: retained refusal report fields.
- `src/renderer/src/store/threadTimeline.ts` → `ThreadItem`: nine current display variants, optional values and attachment references.
- `src/renderer/src/store/conversationTimelineStore.ts` → `HistoryRequestState`, `ConversationSlice`: successful coverage and row offset versus transient requests.
- `docs/knowledge/features/secure-store.md` and ADR 0005: fail closed, no plaintext fallback, composition-owned adapters.
- `docs/knowledge/features/paired-server-store.md`: one collection avoids caller-controlled blob names.
- `docs/knowledge/features/thread-timeline.md`: report rows persist; live recovery offers do not.
- `docs/knowledge/features/development-verification.md`: node tests and unavailable-codegraph fallback.

Codegraph context was unavailable (index not initialized); source reads supplied this map.

## Context

Provide the independently testable protected storage and injected handler boundary for #1338–#1340. No application registration, preload, renderer, fetching or connection change. Existing ADR 0005 suffices; no new ADR is needed.

Size check: one deliverable, three production files, approximately 780 written lines including tests and this plan, four exported types, zero existing consumer changes, five acceptance criteria, eight classified failure outcomes. This fits the refiner's four-file/~780-line forecast. The #1069 analogue's large explanatory plan is unnecessary here. Refreshed all remote feature branches: no overlap with the six proposed source/test paths.

## Design

`src/shared/chatHistory.ts` defines `ChatHistorySnapshot`, `ChatHistoryRequest`, `ChatHistoryResult` and `DurableThreadItem`. Pure parsers validate unknown values and construct fresh allowlisted records. Shared code imports no renderer implementation. The row parser explicitly retains all current variant fields, nested tool input/results/denials, refusal reports, timestamps and attachment references. It neither invents terminal rows nor turns a retained refusal into a recovery action.

Version-1 snapshots are discriminated by `kind` (`list` or `timeline`) and include `serverId`, the saved pairing record's `server` identity. Timeline snapshots also carry `conversationId`, ordered `items`, `prependedRows` (the existing index offset), and `coverage`: unknown, or received with opaque `cursor` and `atStart`. Successful coverage is independent of subsequent in-flight/failed requests. Lists carry ordered `ConversationSummary` records. A stored empty snapshot is distinct from absence. Optional fields retain omission semantics; unknown fields are dropped recursively. IDs are bounded by the existing server-id limit; display strings have a generous 16-MiB admission bound and arrays a 100,000-entry per-array bound. Reject oversize values; never truncate stored content. These are admission limits, not eviction or history-download policies.

The six request operations are `readList`, `replaceList`, `readTimeline`, `replaceTimeline`, `removeConversation`, and `removeServer`. Requests accept no filesystem path or blob name; reject unknown request keys and mismatched snapshot coordinates. Snapshot extensions are discarded by projection. Results distinguish `missing`, `stored` (snapshot), `ok` (mutation) and static error codes.

`src/main/chatHistoryStore.ts` exports `createChatHistoryStore({ secureStore, log })` with `execute(request: unknown): Promise<ChatHistoryResult>`. Store exactly one versioned collection under the constant `chat-history` name. Snapshot identity uses string equality, never caller-controlled object keys or filenames. Each replacement substitutes only the matching snapshot and retains all omitted timelines. Removing a conversation filters its timeline and its list entry in one atomic replacement; removing a server filters every snapshot for that host, including orphans. Delete the collection blob when the last record is removed. Pairing names are never accessed.

One collection makes removal atomic without a journal or mutable manifest. The tradeoff is whole-collection reads/writes and a shared unreadable-data failure domain. No automatic pruning, ten-chat disk cap or background work. A future scaling change can migrate the versioned format; this ticket introduces no speculative storage infrastructure.

`src/main/chatHistoryHandler.ts` exports `createChatHistoryHandler({ store, pairedServers, log })`, returning an injected listener accepting unknown event/request arguments. Validate/project synchronously; check `loadById(serverId)` only for existence and contain exceptions. Queue handler calls before the asynchronous membership check, so reversed lookup completion cannot reorder storage mutations. Only validated records reach storage; only the store's typed content/result reaches the caller. Production registration and preload exposure belong to #1338.

## State + concurrency model

Each store instance owns one promise chain for all operations; handler membership checks have their own ordered chain. The stricter global ordering satisfies host-local invocation order and prevents cross-host read/modify/write lost updates. Parse/copy requests at invocation so caller mutation while queued cannot change a pending write. Failures resolve to typed results and leave the chain usable. Reads wait for earlier operations. Production must construct one service and handler, as #1338 will wire. No timers, streams or subscriptions require cancellation; operations are finite awaited filesystem work. Process termination during replacement inherits temp/rename safety from `fileSecretPersistence`.

## Error handling

Static error codes: `invalid-request`, `unknown-host`, `membership-unavailable`, `unreadable`, `unsupported-version`, `encryption-unavailable`, `write-failed`, `remove-failed`. Unsupported numeric versions are distinct from malformed data. Reads never write. Mutations refuse unreadable/unsupported collections instead of replacing them with an empty default. Replacement failures leave the old readable ciphertext intact. Removal errors are reported even when the underlying operation throws. Log only static lifecycle event names and result codes through `DiagnosticLog`; never requests, IDs, data, paths or caught errors.

## Testing strategy

Write node Vitest tests first and observe RED before production code. Shared tests cover every current row variant, optional/empty values, nested allowlisting, malformed records/requests, coordinate matching and coverage distinctions. A test-only structural check compares the shared row contract with current `ThreadItem` in both directions.

Real temporary-file tests use `createSecureStore` and `fileSecretPersistence` with injected reversible encryption. Cover fresh-instance reads, no plaintext in files, saved empty versus missing, host separation, more than ten timelines, repeated replacements, list ordering, partial answers, removal of unlisted timelines, pairing-blob preservation, unsupported/malformed/decrypt failures without erasure, failed replacement preservation and recovery. Hold persistence to test overlapping saves/removals and read atomicity; inject write/delete failures. Handler tests verify malformed requests and unknown hosts touch no chat storage, saved disconnected hosts work, membership ordering, contained exceptions and content-free logs/replies.

Run touched test files and `npm run build`. No Electron or live-daemon test is needed for this nonvisual service.

## Open questions

None. Renderer projection (#1338), offline display (#1339), and reconnect/unpair coordination (#1340) remain explicit downstream work.

## Documentation handoff

Pending for the documentation stage: no explicit documentation requirement/path/section was present in the ticket. Document the public storage/request/result contract and whole-collection tradeoff in the owning feature overview under `docs/knowledge/features/` (new chat-history topic and its API/concurrency sections); update discovery links as appropriate. Builder does not edit shared knowledge files.

## Security review

**Verdict:** PASS

- [Trust boundaries] Parsers project renderer requests and decrypted disk records before use; unknown nested fields cannot carry credentials back. Store and handler validate independently using the same deterministic parser.
- [Tokens] Existing `SecureStore` encryption is mandatory; unavailable protection returns a static failure before persistence. No token is created or copied. Membership is reduced to a boolean.
- [File/storage] A single constant name prevents ID/path traversal. The existing persistence adapter uses open/ENOENT handling, owner-only modes and atomic temp/rename. #1338 must reuse the production `userData/secrets` adapter and OS-backed encryption; no renderer web storage.
- [Electron] No window, navigation, protocol or IPC registration is added. The factory accepts only six validated chat operations. #1338 owns registration/preload; raw storage is never exposed.
- [Cryptography] No new primitive, nonce or key handling. At-rest protection inherits ADR 0005, including rejection of Linux basic_text.
- [Network/I/O] No network surface or automatic history fetch. Size/type admission checks constrain individual supplied fields/arrays. Whole retained collection growth is an accepted cost of the requested retention policy; no implicit eviction.
- [Errors/logs] Static outcomes and lifecycle codes only; no caught object, content diagnostic, local path, key or coordinate enters a log/reply diagnostic.
- [Concurrency] Both queues begin before asynchronous work, recover after failure and use detached input copies. Atomic replacement covers both list and timeline removal. One main-process owner is required; multiple-process writers are unsupported.
- [Threat alignment] Protected ciphertext raises the bar for disk readers; compromised renderer access remains limited to saved-host chat operations. Hostile daemon display text stays inert data. Relay attacks and reconnect/removal coordination are outside this service; existing transport and #1340 own them. Backup ciphertext and a compromised OS account remain ADR 0005 residual risks.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-12
