# Protected local chat history

The main-process service stores ordered conversation lists and timeline display
records through the [secure store](secure-store.md). A fresh service instance can
read saved content without a connection or Noise handshake. Host identity is the
saved pairing record's `server` field, so equal conversation ids on different
hosts remain separate.

The service and injected handler are available; application recording is not yet
wired. [#1338](https://github.com/pyrycode/pyrycode-desktop/issues/1338) owns production
registration, preload exposure and renderer projection/recording;
[#1339](https://github.com/pyrycode/pyrycode-desktop/issues/1339) owns offline display;
[#1340](https://github.com/pyrycode/pyrycode-desktop/issues/1340) owns reconnect and
explicit-removal integration. Storage does not fetch history. Retention covers
received content, including pages fetched through scrolling, independently of the
renderer holder's ten-conversation memory limit.

## API

[`src/shared/chatHistory.ts`](../../../src/shared/chatHistory.ts) defines
`ChatHistorySnapshot`, `DurableThreadItem`, `ChatHistoryRequest` and
`ChatHistoryResult`, plus the pure `parseChatHistorySnapshot` and
`parseChatHistoryRequest` validators. Shared code imports no renderer implementation.

[`createChatHistoryStore({ secureStore, log })`](../../../src/main/chatHistoryStore.ts)
returns `execute(request: unknown): Promise<ChatHistoryResult>`.
[`createChatHistoryHandler({ store, pairedServers, log })`](../../../src/main/chatHistoryHandler.ts)
returns an injected listener `(event: unknown, request: unknown)` with the same
result. It validates and copies the request synchronously, then checks
`pairedServers.loadById(serverId)` for existence before accessing chat storage.
Saved disconnected hosts are eligible; a live connection is never consulted.
The store validates independently but has no pairing dependency, so saved-host
authorization belongs to the handler. Pairing records are reduced to membership,
never forwarded to the caller.

Every request has `operation` and `serverId`. Additional fields are operation-specific:

| Operation | Additional fields | Effect |
| --- | --- | --- |
| `readList` | None | Read the host's ordered list snapshot. |
| `replaceList` | `snapshot` of kind `list` | Replace that list; timelines omitted from it remain saved. |
| `readTimeline` | `conversationId` | Read the addressed timeline. |
| `replaceTimeline` | `conversationId`, `snapshot` of kind `timeline` | Replace that timeline in full, preserving supplied row order. |
| `removeConversation` | `conversationId` | Atomically remove its timeline and its entry from the host's saved list. |
| `removeServer` | None | Remove every snapshot for that host, including timelines absent from its latest list. |

Unknown request keys, malformed snapshots, a wrong snapshot kind, or mismatched
snapshot/request coordinates produce `invalid-request` before any record access.
Callers cannot supply a storage path or blob name. Snapshot schema extensions are
discarded on projection rather than rejected; declared tool `input` remains a
string-to-string map with its supplied keys.

## Snapshot contract

Every snapshot has `version: 1`, `serverId` and a `kind` of `list` or `timeline`.
A list's `conversations` array retains all eight `ConversationSummary` fields:
`id`, `name`, `is_promoted`, `is_archived`, `cwd`, `last_message_ts`, `last_used_at`
and `workspace_label`. Duplicate conversation ids within one list are invalid;
array order is preserved without sorting.

A timeline adds `conversationId`, ordered `items`, `prependedRows` and `coverage`.
`prependedRows` is the nonnegative safe-integer index offset used to preserve
[row keys across history prepends](conversation-timeline-store.md#edge-cases-and-limitations).
Coverage is either `{ status: 'unknown' }`, when no history page has been received,
or `{ status: 'received', cursor: string, atStart: boolean }`. The cursor is the
opaque oldest retained history cursor, and `atStart` records the server's report
that history has reached its beginning. Empty cursor strings are valid. Successful
coverage stays separate from later pending or failed requests; row count alone
does not establish coverage or the beginning of history.

`DurableThreadItem` retains the display fields of every current
[`ThreadItem`](../../../src/renderer/src/store/threadTimeline.ts) variant. In this
table, `?` marks an optional field:

| Row kind | Retained fields beyond `kind` |
| --- | --- |
| `assistantText` | `turnId`, `text`, `createdAt?` |
| `userText` | `text`, `createdAt?`, `messageId?`, `attachments?` containing `attachmentId` and `filename` |
| `toolCall` | `turnId`, `toolUseId`, `parentToolUseId?`, `name`, `inputSummary`, `input?`, `result`, `denial?`, `elapsedSeconds?` |
| `turnBoundary` | `turnId`, `stopReason`, `outcome?`, `isError?`, `terminalReason?`, `errorCategory?` |
| `sessionBoundary` | `reason` (`clear`, `idle_evict` or `workspace_change`), nullable `workspaceCwd`, `occurredAt` |
| `unrecognizedMessage` | `site` (`line_type`, `assistant_block`, `user_block` or `undecodable`), `messageType`, `raw`, `truncated` |
| `compactionBoundary` | `failed`, `manual`, nullable optional `preTokens?` and `postTokens?` |
| `banner` | `level`, `text`, `stopsTurn`, `truncated` |
| `modelRefusal` | `refusal`, containing the shared `ModelRefusalEvent` report |

Tool `result` is `null` or `{ isError, resultSummary, resultDetail? }`. Optional
`denial` retains `toolName`, `decisionReasonType`, `decisionReason`, `message`,
`truncatedFields` and `droppedFields`; the last two are string arrays or `null`.
Refusal reports retain `type`, `originalModel`, `refusalCategory`, `banner`,
`truncatedFields` and `droppedFields`, plus `fallbackModel` and `scope` for
`modelRefusalFallback`. `modelRefusalNoFallback` has no fallback fields.

Only declared schema fields are persisted and returned, including nested records.
Absent optional values stay absent on disk, and empty strings, false values,
declared nulls and array order survive. Saving or reading never synthesizes a
terminal row: partial assistant text and unresolved tool results stay partial.
Attachment references survive; attachment file bodies do not.

Connection state, running-turn phase, in-flight requests, pending permissions,
recovery offers/actions and credentials are excluded. Retained reports and denial
text are display data; they cannot restore a live permission or recovery action.
Renderer web storage remains prohibited for conversation content.

### Admission limits

The parsers reject oversized values without truncating them:

- Id fields use `MAX_SERVER_ID_LENGTH` (currently 8,192 UTF-16 code units),
  including server, conversation, turn, tool-use, message and attachment ids.
  Empty ids and path-like strings are valid data; host membership still requires
  exact equality with a saved `server` identity.
- Other strings, including cursors and tool-input keys/values, allow at most
  `16 * 1024 * 1024` UTF-16 code units (`string.length`, not a byte-size limit).
- Snapshot arrays allow at most 100,000 entries each; tool-input maps allow at
  most 100,000 entries. Numbers must be finite; `prependedRows` additionally must
  be a nonnegative safe integer.

These limits govern individual admitted records. They impose no ten-chat disk
cap, automatic eviction, total collection-size bound or history-download policy.

## Results and failure preservation

| Result | Meaning |
| --- | --- |
| `{ status: 'missing' }` | No matching snapshot exists in a readable or absent collection. |
| `{ status: 'stored', snapshot }` | A snapshot exists, including an explicitly saved empty list or timeline. |
| `{ status: 'ok' }` | A mutation completed, including an unchanged replacement or repeated removal. |
| `{ status: 'error', code }` | A static failure classification; no caught exception details. |

| Error code | Meaning |
| --- | --- |
| `invalid-request` | Request validation failed, including an unsupported version supplied for replacement. |
| `unknown-host` | The handler found no saved pairing for `serverId`. |
| `membership-unavailable` | The saved-host lookup threw. |
| `unreadable` | Reading, decryption, UTF-8/JSON decoding or stored-record validation failed. Duplicate snapshot identities are invalid. |
| `unsupported-version` | The stored collection or a stored snapshot has a safe-integer numeric version other than 1. Malformed version values are `unreadable`. |
| `encryption-unavailable` | A required protected write raised `EncryptionUnavailableError`, including a removal that must rewrite remaining records. |
| `write-failed` | A replacement failed for another write/encryption reason. |
| `remove-failed` | A removal's replacement or deletion failed for another reason. |

Reads never write. Every mutation first reads and validates the entire collection;
an unreadable or unsupported collection is preserved, including on removal. It is
never treated as an empty default. A failed replacement leaves the previous
readable ciphertext intact and does not prevent subsequent operations. This
differs from the [paired-server store](paired-server-store.md)'s deliberate
malformed-record overwrite during re-pairing: chat history has no such recovery
exception.

Diagnostics contain only static lifecycle event names and operation/result codes:
`history-storage-operation`, `history-storage-result` and `history-handler-result`.
They include no requests, coordinates, message content, keys, storage paths or
caught errors. Successful reads return the declared chat content; error replies
contain only their static classification.

## Storage and concurrency

One main-process owner must construct one store and one handler, never a service
per request. Both capture detached validated request copies before asynchronous
work, so caller mutation while queued cannot alter a pending save.

The handler queues valid calls before the asynchronous membership lookup and
waits for storage completion. The store has its own queue covering every valid
read and mutation across all hosts. Ordering only the filesystem writes would
allow a slow earlier membership check to submit an old save after a later removal;
both queues are necessary. Global ordering also prevents cross-host read/modify/
write lost updates. Reads wait for earlier operations, failures leave the queues
usable, and an earlier pending save cannot overtake a later save or resurrect a
later-removed record. Separate service instances or processes have no shared lock.

All snapshots occupy one versioned collection, `{ version: 1, snapshots: [...] }`,
under the constant secure-store name `chat-history`. Identity comparisons use
string equality over `serverId`, `kind` and, for timelines, `conversationId`;
caller ids never become filenames or object lookup keys. One collection makes
list-entry/timeline removal atomic without a journal or mutable manifest.

Each operation reads and validates the whole collection; each changed mutation
encrypts and replaces it in full, unless removing the final snapshot deletes the
blob. Unchanged replacements and repeated removals skip persistence. Removing a
conversation can leave a stored empty list, which remains distinct from missing.
Other hosts' records and all pairing credential blobs are untouched.

The tradeoff is whole-collection I/O and a shared unreadable-data failure domain:
one bad snapshot or unsupported version blocks access to every host's chat
records. Retained timelines can outlive their list entries and grow independently
of memory eviction. A future storage-layout change must account for the versioned
format and atomic removal contract.

Protection inherits [ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md).
Production composition must reuse OS-backed encryption and
`fileSecretPersistence(join(app.getPath('userData'), 'secrets'))`; encryption
unavailability, including Linux `basic_text`, cannot fall back to plaintext.
The existing adapter supplies owner-only files and temp-file/rename replacement,
so readers see the old or new complete ciphertext. Atomic replacement supplies
file integrity; the queues supply invocation order. No new cryptography, network
work or background pruning is involved.

## Testing

[`chatHistory.test.ts`](../../../src/shared/chatHistory.test.ts) exercises every
current row shape, optional/empty values, coverage, nested field projection,
detached inputs, admission limits and request coordinates.
[`chatHistoryStore.test.ts`](../../../src/main/chatHistoryStore.test.ts) uses real
temporary files with injected reversible encryption to cover fresh-instance
reads, empty-versus-missing records, host separation, retained unlisted timelines,
held overlapping writes/removals and preservation after read/write/delete failures.
These tests exercise the storage seams without proving the OS keychain adapter.
[`chatHistoryHandler.test.ts`](../../../src/main/chatHistoryHandler.test.ts)
covers membership, rejected requests before record access, ordering and contained
failures for all six operations.

The exact `DurableThreadItem`/`ThreadItem` equality assertion lives in
[`store/chatHistoryContract.test.ts`](../../../src/renderer/src/store/chatHistoryContract.test.ts).
A shared test importing renderer types crosses the composite Node project's file
boundary; the renderer test project can see both contracts without changing
production layering. Exact equality catches added optional fields that mutual
assignability can miss. This proof depends on the web project's TypeScript check
in `npm run build`; running Vitest alone does not establish it. Runtime parser
fixtures still need to cover newly added fields.
