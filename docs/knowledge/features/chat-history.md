# Protected local chat history

The main-process service stores ordered conversation lists and timeline display
records through the [secure store](secure-store.md). A fresh service instance can
read saved content without a connection or Noise handshake. Host identity is the
saved pairing record's `server` field, so equal conversation ids on different
hosts remain separate.

The app records received lists, live timeline content, composer echoes and loaded
history pages automatically. Saved lists restore into the sidebar on launch,
including unavailable and pairing-rejected hosts.
[#1388](https://github.com/pyrycode/pyrycode-desktop/issues/1388) owns on-demand
timeline restoration and ownership installation for restored timeline slices.
[#1340](https://github.com/pyrycode/pyrycode-desktop/issues/1340) owns reconnect,
scroll-trigger changes and explicit host/conversation removal integration.
Observing, saving and flushing add no history requests; existing opening and
scroll requests remain. Disk retention is independent of the renderer holder's
ten-conversation memory limit.

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
Saved hosts are eligible while disconnected or pairing-rejected; a live
connection is never consulted.
The store validates independently but has no pairing dependency, so saved-host
authorization belongs to the handler. Pairing records are reduced to membership,
never forwarded to the caller.

[`src/main/index.ts`](../../../src/main/index.ts) registers one handler over one
store for the app lifetime, sharing the existing secure store and paired-server
store. Preload exposes `window.pyry.chatHistory(request): Promise<ChatHistoryResult>`
on the fixed `pyry:chat-history` channel; `PyryApi` carries its type into the window.
Reads and replacements need no handshake.

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

The writer retains the last successful coverage beside each observed timeline.
`HistoryRequestState` alone is insufficient: `markHistoryRequested` and
`recordHistoryFailure` replace its loaded cursor and `atStart`. A served page
updates rows before `recordHistoryPage` publishes successful coverage; only that
loaded state advances durable coverage. A live-only timeline stays `unknown`,
and a successfully received empty page still establishes coverage.

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

### Received-state admission and ownership

[`createSavedListRestorer`](../../../src/renderer/src/store/savedListRestorer.ts)
mounts once in `PairedShell` and observes saved identities in `serverInfoStore`,
independently of connection state. It calls only `chatHistory`'s `readList` operation
and verifies a stored result's list kind and host identity. The explicit
`conversationListStore.beginLocalListRead(serverId)` handle installs host-stamped
rows directly, preserving snapshot order within existing sidebar grouping and
keeping equal conversation ids on different hosts separate. It never fabricates
a daemon event or calls the received-list setter.

Admission is store-owned: an existing host list or local read prevents another
read. Unique tokens invalidate both late success and late failure after a received
list, host/global clear, or cancellation, including clears before any rows exist.
Other hosts retain their arrays by reference. The restorer attempts each held
identity once, cancels departed hosts, and cancels outstanding handles on teardown.
IPC itself is not abortable; cancelled results cannot change the store. Cancellation
removes pending read state so a later mount can retry, while loaded/failed results
remain settled across navigation.

A saved list is local display data, not current server state. Restoration never
selects a chat, changes selection after navigation, or creates connection or working
state. `SessionState.statuses` remains connection truth: offline row browsing keeps
the existing host-scoped action gates and sends no history or session-configuration
request. List restoration does not restore timeline messages or establish timeline
recording ownership. Received lists still replace their host's displayed list.

[`useChatHistoryWriter`](../../../src/renderer/src/store/chatHistoryWriter.ts)
mounts once from [`App`](app-shell.md#where-the-daemon-bridge-lives), observing
`conversationListStore` and `conversationTimelineStore` across routes. It projects
through `parseChatHistorySnapshot` synchronously, detaching content and host
coordinates before scheduling any write.

Preload's [receipt context](daemon-event-channel-plumbing.md#3-the-preload-subscription-srcpreloadindexts)
exposes only the event type and main-stamped `serverId` during a daemon subscriber's
synchronous call, restoring the previous context in `finally`. This gives store
observers the supplying host without a second event subscription whose ordering
could misattribute content. List recording accepts changed `byServer` arrays only
during `conversationsReceived`, preserving received order. Timeline updates folded
during daemon delivery use that receipt's origin, never the active host at save time.

Outside daemon delivery, two local edits qualify:

- An appended `userText` echo with a message id and `localSendPending`, whose
  preceding rows retain their references and order. Its host must be the unique
  `byServer` list claiming that conversation.
- Removal of one previously admitted echo object with a nonempty message id,
  matching `removeUserEcho`: surviving rows retain their references and order,
  and history/prepend metadata is unchanged. A weak set tracks admitted row
  identities without retaining evicted rows. Cancellation keeps the held owner
  and successful coverage, even when it removes the only row and saves an empty
  timeline. An append-only rule misclassifies this edit as restoration and stops
  later recording; removing an arbitrary restored row cannot authorize a save.

Timeline slices are keyed only by conversation id, so the writer pins an owner
while each slice is held. Missing origin, conflicting list claims or a supplying
host change refuse new replacements and preserve existing saved copies. Once
ownership is unknown or conflicting, a later apparently valid receipt cannot
repair it while the slice remains held; clearing/evicting the slice releases its
observation metadata. Main independently checks saved-host membership again.

Startup-empty state, activation, direct snapshot installation, list/holder clears
and memory eviction are not deletion signals. Directly installed nonempty rows
in a timeline have no observed owner and cannot establish one by later live delivery.
List restoration uses its explicit handle; timeline restoration needs its own
ownership entry point. Neither belongs in live reducers.
Failed requests and rejected pairings do not delete saved content. Received empty
lists/pages and cancellation of an observed echo remain valid durable changes.

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

For sidebar restoration, both `missing` and a stored empty list settle as a loaded
empty host slot (`[]`, with `localListReads` set to `loaded`). Errors and rejected
IPC instead leave the list absent and mark that host `failed`; unexpected result
status, snapshot kind or host coordinates fail the same way. They never masquerade
as loaded-empty data.

`HostRow` shows “Could not read saved chats on this device.” beneath the affected
host in each sidebar tree. This local failure is separate from connection dots,
failed-connection styling and the repair control. It changes neither connection
status nor saved data and triggers no write, deletion, network request or retry
loop. A newer received list clears the local failure state. Stale failures cannot
attach an error to a newer list or a cleared host.

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
`history-storage-operation`, `history-storage-result`, `history-handler-result`,
`history-writer-started`, `history-writer-result`, `history-flushed` and
`history-list-restore` (static start/result/stop codes).
They include no requests, coordinates, message content, keys, storage paths or
caught errors. Successful reads return the declared chat content; error replies
contain only their static classification.

Projection failures, rejected storage results and IPC exceptions stay local to
recording; they never dispatch connection failures or disable the live chat.
The drain remains usable for later changed content. A failed save is not an
automatic retry loop for an unchanged snapshot.

## Storage and concurrency

### Buffered replacements

The renderer writer coalesces bursts on a 200 ms timer in a per-record pending map.
Canonical projected values are compared with the latest observed value, so
transient-only changes and unchanged durable records submit no replacement.
One async drain retains the newest update arriving while a prior write is pending.
It also compares the final candidate with the last successful save: a burst that
changes a saved value and then returns to it needs no replacement. Comparing only
successive queued values misses that case.

Detached pending snapshots survive navigation, host switches, disconnects and
holder eviction with their original coordinates. Eviction drops observation and
comparison metadata, never the pending save or the disk record. The eleventh
received conversation can therefore evict the first before its timer runs without
losing the first conversation's captured snapshot.

### Protected collection

The single main-process store and handler both capture detached validated request
copies before asynchronous work, so caller mutation while queued cannot alter a
pending save. Never create a service per request.

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
Production composition reuses OS-backed encryption and
`fileSecretPersistence(join(app.getPath('userData'), 'secrets'))`; encryption
unavailability, including Linux `basic_text`, cannot fall back to plaintext.
The existing adapter supplies owner-only files and temp-file/rename replacement,
so readers see the old or new complete ciphertext. Atomic replacement supplies
file integrity; the queues supply invocation order. No new cryptography, network
work or background pruning is involved.

### Window close and app quit

`writer.stop()` unsubscribes both stores, cancels the timer and drains buffered
and in-flight updates. Main defers normal window close and `before-quit` teardown
until preload's `onChatHistoryFlush` callback has stopped the writer and sent a
`flushed` acknowledgement over `pyry:chat-history-flush`. Main then awaits already
submitted history operations before resuming close/quit. App quit stops the
connection registry before draining; closing a window leaves the app able to
open a fresh window and writer.

Readiness registration avoids waiting on a window whose observer never mounted.
Lifecycle messages must come from a window's main frame; flush acknowledgements
resolve only that sender's wait. Closing the window releases its wait and tracking
entries. Hook cleanup removes its flush listener, and `will-quit` removes the
main handler and lifecycle listener. Reconnect adds no listeners.

The guarantee covers graceful close/quit. Abrupt process termination cannot drain
renderer buffers; atomic file replacement still protects the last complete
collection. Flushing never adds a completion boundary to a partial answer.

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

[`chatHistoryWriter.test.ts`](../../../src/renderer/src/store/chatHistoryWriter.test.ts)
injects stores, receipt context, scheduling and storage to prove coalescing,
return-to-saved-value suppression, newest-during-write retention, failure recovery,
successful coverage, attribution refusal and capture before eleven-chat eviction.
Cancellation regressions must include later live content and retained coverage;
checking only echo addition or its immediate removal misses a writer that has
silently stopped recording the held chat.

[`savedListRestorer.test.ts`](../../../src/renderer/src/store/savedListRestorer.test.ts)
covers ordered host isolation with equal ids, missing/empty/error results, duplicate
admission and delayed success/failure after received lists, clears and cancellation.
It runs the real writer alongside restoration: installing and clearing local lists
must schedule no save, while a later received list must still record.

[`chat-history-recording.spec.ts`](../../../e2e/chat-history-recording.spec.ts)
exercises the mounted production observer and handler, real composer cancellation,
quit/relaunch and window close/reopen. It freezes renderer timers after earlier
saves, verifies the final content is still absent on disk, then closes: a test
that waits for the debounce before quitting cannot prove the flush. Reusing the
user-data directory proves disconnected local reads without a new handshake,
including the last list, partial live text and loaded older page. The suite also
covers pairing-rejected access, saved-host validation and zero added history
requests. It also proves restored sidebar browsing after normal quit/relaunch,
a rejected host beside a usable connected host, and mounted local read failures.
The pairing-recovery regression must expect the saved row after startup rejection;
row absence no longer proves rejection. Keep the decoded rejection and actual
repair-click assertions. Timeline reads here prove storage access, not restored
message UI. The test encryption backend does not prove the OS keychain adapter.

The exact `DurableThreadItem`/`ThreadItem` equality assertion lives in
[`store/chatHistoryContract.test.ts`](../../../src/renderer/src/store/chatHistoryContract.test.ts).
A shared test importing renderer types crosses the composite Node project's file
boundary; the renderer test project can see both contracts without changing
production layering. Exact equality catches added optional fields that mutual
assignability can miss. This proof depends on the web project's TypeScript check
in `npm run build`; running Vitest alone does not establish it. Runtime parser
fixtures still need to cover newly added fields.
