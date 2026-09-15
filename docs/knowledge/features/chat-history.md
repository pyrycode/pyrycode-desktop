# Protected local chat history

The main-process service stores ordered conversation lists and timeline display
records through the [secure store](secure-store.md). A fresh service instance can
read saved content without a connection or Noise handshake. Host identity is the
saved pairing record's `server` field, so equal conversation ids on different
hosts remain separate.

The app records received lists, live timeline content, composer echoes and loaded
history pages automatically. Saved lists restore into the sidebar on launch,
including unavailable and pairing-rejected hosts. Opening a saved chat restores its
timeline on demand whether its host is connected or unavailable. Restored rows remain
readable through reconnect and subsequent same-host receipts continue saving.
Downloads require explicit upward thread input or a retryable failed page's Retry
action, including after reconnect; explicit Forget/Unpair removes the host's saved content after credential removal.
Confirmed conversation deletion removes that host/conversation's saved timeline
and list entry.
Observing, saving, flushing and restoration add no history requests.
Offline opening and scrolling retain the existing host-scoped request gates. Disk
retention is independent of the renderer holder's ten-conversation memory limit.

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

The callable handler also exposes main-only `clearServer(serverId, clearCredentials)`.
The composition root supplies it to the existing unpair handler: credential erasure
and protected `removeServer` run in the same queue as history membership checks and
storage operations. Earlier admitted work finishes before removal. Each history
request captures a host generation at admission; a matched credential erase advances
that generation before releasing the queue, even if history cleanup fails. Requests
queued behind removal with the old generation return `unknown-host`, including after
same-server re-pairing. Fresh requests still require saved-host membership. Calling
renderer `removeServer` after erasing credentials cannot replace this coordination:
it would fail membership validation.

A credential erase that throws or matches no record leaves history and the generation
untouched. After a matched erase, cleanup failure or a thrown cleanup error preserves
the successful credential outcome, so label cleanup, connection teardown and the
unpaired-state transition continue. `history-unpair-cleanup` records only static
`ok` or `failed`; successful unpair alone does not establish successful history deletion.
Successful cleanup removes the list and every timeline for that `server` identity,
including omitted timelines, while preserving other hosts' equal conversation ids.

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

Restoration preserves this coverage, durable row order, optional identity metadata
and `prependedRows`, but initializes transient timeline state afresh. Saved coverage
records what was received previously, not the server's current history or freshness.
While offline, before the oldest saved row, the view shows “Older messages require
a connection.” unless coverage explicitly reports `atStart: true`; neither a short nor an empty
saved snapshot proves completeness. This notice sends no request.

The holder retains successful `ConversationSlice.coverage` independently of transient
`history`; the writer also retains it beside each observed timeline.
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
Resetting transient state is insufficient for display: a partial assistant tail
and unresolved grouped tools derive working indicators from row shape. Offline or
locally restored rendering separately suppresses the streaming cursor and grouped-tool
running label, including on connected opening and after reconnect. New live receipts
resume normal rendering; connection status alone cannot revive saved working state.
Renderer web storage remains prohibited for conversation content.

### Received-state admission and ownership

Apart from explicit Retry of a failed page, history downloads require trusted
upward wheel/trackpad input over the thread, or
ArrowUp/PageUp/Home with the thread itself focused. The current offset must be
within the existing 200px near-top band before that input scrolls. Input outside
the band only scrolls locally; entering the band needs another qualifying input.
The same focusable region contains empty and short threads, so first-page demand
does not depend on overflow. Composer navigation, synthetic events, ordinary
scroll events, mounting, resize, bottom pinning and prepend compensation send no
history command. Launch, opening, restoration and reconnect do not request pages.

`requestOlderHistory` reads successful coverage at demand time: unknown coverage
uses `cursor: ''`, while received coverage uses the exact last successful cursor,
including one restored from disk. Only `atStart: true` establishes completion;
short, empty and all-undrawable pages do not. One request may be outstanding per
host/conversation. Demand during a local read or pending request is discarded,
not queued; settling either does not trigger a download. Remaining in the band
after a response also requires new input. There is no timer or automatic walk.

Requests and failures retain same-host rows, prepend metadata and successful
coverage. Main clears outstanding history correlations before emitting classified
failure events on connection drop, terminal/error, pairing rejection or explicit
redial, including when no server failure reply arrived. Unavailable/build/send
failures also settle immediately. This releases pending state without retrying:
new qualifying upward input while connected can ask again from the retained cursor
even when the server's failure classification is nonretryable. The separate
[composer Retry action](conversation-shell-composer-status.md#history-page-failure-and-retry)
requires `retryable: true`, the displayed conversation and its connected owning host,
and the same held failure at activation. It calls `requestOlderHistory` with the
same cursor and `limit: 0`; pending state removes the failure affordance and rejects
duplicate demand without changing rows or successful coverage. A partial history walk
never restarts itself at the newest page. Offline scrolling only exposes held
content. Host-stamped requests cannot borrow another host's cursor, and stale
cross-host failures cannot settle its replacement slice.

Page admission keeps the existing [history/live overlap filter](conversation-timeline-store-internals.md#the-historylive-join-1225)
and row order. [Scroll compensation](conversation-shell-scroll-pin.md#user-demand-and-prepend-position)
preserves a surviving row at zero offset as well as through native nonzero
anchoring; compensation itself cannot request another page.

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

[`readSavedTimeline`](../../../src/renderer/src/store/savedTimelineRestorer.ts)
uses only `readTimeline`. `PairedShell` starts it from every clicked host-stamped
sidebar row, regardless of connection status, and retains those coordinates explicitly:
active metadata reseeding projects wire fields and can discard an incidental host stamp.
The view checks the selected host against the held slice in either connection state;
another host's rows under an equal conversation id cannot substitute.
Reconnect and received list refreshes retain that selected timeline. Actual selected-host
status controls offline notices; local-read status controls saved-row presentation and
exclusion of unrelated conversation-id-only queue rows.

`conversationTimelineStore.beginLocalTimelineRead(serverId, conversationId)`
installs a pending slice in the existing ten-slot holder at the viewed tail. A
same-host local read (including a settled failure) or nonempty held timeline is
reused; unowned or differently owned content is replaced. Completion validates the
snapshot and exact coordinates, then admits it only if the exact pending slice is
still held. Replacement, received mutations, clear, eviction and cancellation
invalidate late success and failure. Opening eleven saved chats and reopening the
first therefore reads it again from disk without increasing the memory bound.

Composer echoes must already have explicit ownership before reopening. Composer
passes the host synchronously resolved by `connectedConversationHostNow` to
`dispatchLocalEcho(serverId, conversationId, userText)`. That write retains only
same-host rows, stamps the slice and invalidates any pending read. An unstamped echo
would be replaced on connected reopening; admitting unowned rows during restoration
would weaken host isolation. The writer still requires its existing message-id and
unique-list-owner checks before saving an echo.

Cancellation removes only the pending slice, never saved data, and cannot abort
IPC or change selection. Sidebar activation, active-id changes, actual departure
from the thread and shell teardown cancel pending reads. Opening host repair keeps
the origin thread mounted, so its read must survive the modal and cancellation of
repair. Cancelling on every non-thread route would leave the retained view loading
forever after the correctly rejected result; read lifetime follows the retained
background route. Metadata-only active-row refreshes do not cancel it.

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
Both list and timeline restoration use explicit handles, outside live reducers.
The writer recognizes a newly admitted `restored` marker before receipt checks,
adopting its host and coverage without scheduling a save. Starting a local read
clears prior observation/comparison metadata. Reconnect and metadata-only list refresh
do not reset restored ownership. A later unambiguous same-host
received change continues recording under that owner with the restored coverage;
conflicting list claims still refuse recording. Receipt-stamped holder mutations
start from an empty slice when the supplying host differs, preventing mixed-host
rows; they do not bypass the writer's ownership refusal.
Failed requests, network failure and rejected or expired pairings do not delete saved
content. Opening/cancelling repair and successful same-server repair retain timelines
and never enter the explicit removal lifecycle. Missing or partial lists are not
timeline-deletion signals; received lists still replace the saved list. Received empty
lists/pages and cancellation of an observed echo remain valid durable changes.

Confirmed `conversationDeleted` delivery is an explicit deletion signal. The writer
subscribes through `window.pyry.onDaemonEvent` and captures the main-stamped
`serverId` and confirmed `id` synchronously before queuing `removeConversation`.
Store observation alone misses this event: the list bridge only requests a separate
refresh, and the synchronous receipt context carries no deleted id. Removal runs
even without a held timeline or matching list entry, independently of selection or
the refresh response. Missing supplying-host context reports `unknown-ownership`
and never borrows the active host. Other conversations on that host and equal ids
on other hosts remain saved. Sending a delete command without confirmation, including
rejection or network failure, removes no saved timeline. Persistence removal does
not itself change renderer display state.

[`runUnpairServer`](../../../src/renderer/src/screens/settings/unpairServerAction.ts)
begins the renderer-local [removal lifecycle](../../../src/renderer/src/store/chatHistoryRemoval.ts)
before invoking main and settles it before refreshing identities. While pending,
writers pause draining that host and allow other hosts' buffered work to proceed.
Failure resumes the paused operations and retains conversation-deletion suppression.
Success discards pending operations, the host's deleted-id set and comparison
state, invalidates observation ownership and prevents an in-flight completion from
repopulating deduplication state, including when main reported cleanup failure.

Successful settlement also clears every held timeline stamped with that host's
`serverId`, including omitted, restored and pending-read slices; other host-stamped
slices survive. Enumerating only the latest list misses retained timelines. Resetting
ownership alone would block later receipts, while restoring ownership over old rows
would save erased text again. Clearing the actual slices invalidates pending local
reads and lets fresh receipts after same-session re-pairing save only fresh content.

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

Timeline reading shows “Loading saved messages…” while pending in either connection
state. Nonempty restored content shows “Offline. Showing saved messages.” only while
the selected host is unavailable; connected opening and reconnect show no offline
notice. Both `missing` and a stored empty timeline succeed and draw no notice at
all — a loaded, empty local read reads as the ordinary state of a chat opened for
the first time on this machine, not a fault (\#1447). Errors, rejected
IPC, invalid snapshots, unexpected result statuses and wrong host/conversation/kind
results instead show “Could not read saved messages on this device.” A local read
failure changes neither `SessionState.statuses` nor saved data and creates no
connection, working, permission or recovery state. The failed-host repair control
remains available. Stale failures cannot replace newer received content or attach
to a cleared/evicted slice. There is no automatic retry loop.

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
| `unknown-host` | No saved pairing exists, or removal invalidated the request's admission generation. |
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
`history-writer-started`, `history-writer-result`, `history-flushed`,
`history-list-restore`, `history-timeline-restore` and `history-unpair-cleanup`
(static lifecycle/result codes).
They include no requests, coordinates, message content, keys, storage paths or
caught errors. Successful reads return the declared chat content; error replies
contain only their static classification.

Projection failures, rejected storage results and IPC exceptions stay local to
recording; they never dispatch connection failures or disable the live chat.
The drain remains usable for later changed content. A failed save is not an
automatic retry loop for an unchanged snapshot.

Conversation cleanup reports `history-writer-result: conversation-removed` only
after storage returns `status: 'ok'`. Classified failures report their static error
code, unexpected results report `remove-failed`, and thrown IPC failures report
`ipc-failed`, without coordinates or exception text. Failed removal preserves the
protected store's prior content and retains stale-save suppression; daemon
confirmation alone does not prove local cleanup succeeded. There is no automatic
removal retry, but another confirmed receipt can retry it.

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

Confirmed deletion shares this serial drain with replacements. It discards the
exact timeline's buffered replacement, filters its entry from buffered host lists
without reordering peers, and waits behind any already in-flight write. A per-host
deleted-id set suppresses subsequent timeline captures and filters delayed list
captures for the writer's lifetime, including retained holder mutations and shutdown.
Stale captures therefore cannot overwrite the queued removal or recreate successfully
removed records. Each removal attempt clears comparison state for that timeline and
host list; removal itself is not skipped by replacement deduplication. Successful
unpair resets suppression for fresh same-server re-pairing.

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

`writer.stop()` unsubscribes both stores, daemon events and host-removal notifications,
waits for already-started host removals to settle, then cancels the timer and drains
buffered and in-flight replacements and confirmed conversation removals in order.
Deletion suppression remains active throughout the flush. Unsubscribing alone
could acknowledge close before failed
unpair resumes its buffered snapshots. Settlement cannot schedule a new timer after
stop. Main defers normal window close and `before-quit` teardown
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

[`historyDemand.test.ts`](../../../src/renderer/src/store/historyDemand.test.ts)
checks unknown/restored/complete coverage, discarded pending demand, failure retry
from the retained cursor and host isolation. Main connection tests cover abandoned
requests and late replies. [`history-on-open.spec.ts`](../../../e2e/history-on-open.spec.ts)
now tests explicit demand: its main IPC observer is installed before pairing and
activation, so zero commands cannot be confused with commands discarded by host
routing. Genuine wheel/keyboard input is compared with composer navigation,
synthetic events and programmatic movement, including empty/short threads and
reconnect. An empty page needs a later received live frame as a receipt barrier;
row count alone cannot prove that the empty response has settled.

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

Removal regressions hold membership checks and protected writes, then use fresh
storage instances to verify absent lists and omitted timelines, stale admission
rejection, other-host preservation and fresh saves after re-pairing. Writer tests
also hold removal through shutdown for both outcomes.
[`chat-history-removal.test.ts`](../../../e2e/chat-history-removal.test.ts) combines
receipt-stamped holders, the real scoped-clear selector and protected storage.
Its same-session re-pair must save only fresh text for an omitted timeline. Manually
clearing all timelines or restarting before re-pairing masks the retained-slice bug.
The recording Playwright scenario re-pairs before restart, then checks persistence
after restart and no added history downloads.

Conversation-deletion regressions hold real protected-store list and timeline writes,
deliver confirmation with buffered and later stale captures, and await flush/stop
before fresh-instance reads. They check both removed records, same-host peers and
another host's equal id. Empty/partial lists and eviction must retain timelines;
failed cleanup must preserve content without a success diagnostic. The recording
Playwright test holds confirmation after the delete command, proves retention, then
waits for the actual `removeConversation` result to be `ok` before asserting absence
and restarting. Renderer disappearance or an early missing read cannot prove cleanup
or ordering; the scenario withholds list refresh responses throughout deletion.

[`savedTimelineRestorer.test.ts`](../../../src/renderer/src/store/savedTimelineRestorer.test.ts)
covers explicit admission, row identity metadata and coverage, equal-id host
isolation, delayed success/failure after invalidation, and eleven-chat eviction
and reload. Echo regressions cover same-host reopening, cross-host replacement and
rejection of a delayed read after sending. Writer tests pair restoration with a
subsequent same-host receipt:
restoration and eviction must write nothing, but later content must save with the
restored owner and coverage. Static screen tests cover local notices, host-bound
display and partial-row cursor suppression both connected and offline, normal rendering
after live receipts, and held versus restored queue visibility. Healthy-host interaction
tests assert no `.conversation__banner` at all, so they still reject an additional
connection warning caused by another host's failure.
`beginLocalTimelineRead(host, id)!.complete(null)` is the shortest way to stage a
settled-empty local read in a static screen test: it parses a synthesized empty
snapshot and settles `localRead: 'loaded'` with no items, which is otherwise awkward
to reach through the store's public surface. Removing a piece of rendered copy
silently deletes every `not.toContain`/absence assertion aimed at it too — those
assertions keep passing against a screen that renders nothing at all, so a copy
removal needs a sweep for such assertions and a flip to a positive claim about what
does render (\#1447).

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
repair-click assertions. Restored message UI is exercised by opening and copying
received content after restart, including a rejected host beside a connected one.
A held-IPC result crosses repair opening/cancellation before release, then proves
reading and copying without renderer commands during opening or scrolling. Command
observation must precede main's host routing: absent socket traffic can hide a
renderer command discarded offline. In the held-IPC scenario, observing
`pyry:command` at main avoids CDP function-breakpoint observation stalling the test.
Reload fixtures wait for saved-list persistence and use a newly named received row
as their receipt barrier; saved rows can return without a status replay, so row
count alone is not that barrier. The test encryption backend does not prove the OS
keychain adapter.

The continuity scenario starts with incomplete saved coverage, restarts offline,
reads, reconnects and receives new same-host text, then demands one older page with
the saved cursor. A connected restart checks ordered older/restored/new content and
the advanced coverage, with no duplicate rows on reopening. Holding the local read
and observing commands before host routing proves opening, pending demand, settlement
and reconnect send zero history requests; only fresh qualifying input requests a page.
Overlap fixtures must place the live overlap at the newest end of the newest-first
page. Putting an unmatched older entry first exercises the intentional
stop-at-first-unmatched rule in `withoutLiveEntries`, producing a duplicate instead
of testing overlap suppression. A `messageReceived` entry is the one exception to
that stop rule (#1437): the daemon never pushes a live frame for the operator's own
message, so that entry no longer ends the walk — it is kept and stepped over, and an
unmatched entry beneath it still stops the walk as before. A fixture placing the
operator's own message at the newest end therefore does not, by itself, exercise
stop-at-first-unmatched; put the unmatched entry there instead.

A unit test's comment can cite an e2e spec as corroboration for a stop-rule assertion
that the spec never actually reaches. `e2e/real-daemon-history-on-open.spec.ts`
archives before re-opening, so its page always joins against an empty live key set
and `withoutLiveEntries` returns on the `liveKeys.size === 0` early exit before the
walk runs at all — it was never evidence about the walk's stop rule, and the #1437
fix (above) inverted the unit assertion that comment was defending. Check that a
cited spec's fixture actually drives the code path the comment claims, rather than
trusting the citation.

The exact `DurableThreadItem`/`ThreadItem` equality assertion lives in
[`store/chatHistoryContract.test.ts`](../../../src/renderer/src/store/chatHistoryContract.test.ts).
A shared test importing renderer types crosses the composite Node project's file
boundary; the renderer test project can see both contracts without changing
production layering. Exact equality catches added optional fields that mutual
assignability can miss. This proof depends on the web project's TypeScript check
in `npm run build`; running Vitest alone does not establish it. Runtime parser
fixtures still need to cover newly added fields.
