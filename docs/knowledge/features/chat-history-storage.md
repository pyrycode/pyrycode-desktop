# Protected local chat history — storage and lifecycle

Part of [protected local chat history](chat-history.md). The application uses
protected indexed SQLite storage for lists and daemon items. The old protected
collection is a one-time retained-data import source; legacy timeline bodies are ignored.

## Buffered replacements

The writer requires `threads` and `lists`. Ordinary thread saves are detached
`mutateThread` requests from the slice's `owned` change; list saves remain complete
`replaceList` snapshots requiring the exact host's `conversationsReceived` receipt.
Hydration publishes no owned change and schedules no save. Store no-ops and unchanged
ownership references are skipped. Received repair/progress can schedule metadata-only
work without validating/serializing the held item array. Production supplies
`threadRuntime.items`; see [restore/query ownership](thread-runtime.md#restore-recovery-and-cleanup).
Local unaccepted sends and session prompts are not durable cache content.

The renderer uses a 200 ms capture debounce and an ordered linked queue per
host/conversation. Immutable owned changes are linked without scanning the backlog.
Only an unstarted tail of distinct items/metadata may coalesce within 32 counted
units; removals, ranges, repeated identities and owner/reset barriers stay serial.
Ordered application retains revisions, equal-revision text extensions, placement,
ranges and progress evidence. An admitted new epoch or explicit reset supersedes
prior pending ownership. A unique `resetId` survives exact retry and is recorded
in the protected header. Reaccepting the same epoch without reset preserves history.
Omission and holder loss imply no deletion/reset; pending work survives navigation
and holder recreation.

One serial drain submits at most 32 items/removals/ranges/progress observations per
request and yields a MessageChannel task between submissions, even with paused
renderer timers. Success advances only the current request cursor. Failure retains
that exact request before newer queued work, subject to ownership fences, and
suppresses its key for the rest of the drain. It schedules no immediate retry timer;
a later explicit flush or received event retries with the same bounds.
Split saves retain a separate protected persistence obligation until all their
parts and original ordered progress are durable. Interrupted full/page reads fail
closed, even when the saved checkpoint already covers the incoming version. Exact
accepted acknowledgements are idempotent; authorized reset/replacement/deletion can
supersede abandoned work. See the
[complete obligation and retry contract](chat-history-api.md#owned-authoritative-mutations).

List canonical-value comparison still suppresses unchanged received lists and bursts
that return to the last successfully saved list value; it does not compare whole
thread snapshots.

Thread and list durability require separate observations. A protected `readThread`
containing saved replies does not establish that the host's later named list has
been received, submitted or acknowledged. The handler orders submitted IPC only;
renderer work still buffered or awaiting receipt is outside that queue. Before
retiring a profile whose saved row must reopen, observe the actual protected
`readList` for that exact host and conversation. Sidebar text or a named row at
other coordinates cannot establish this. The
[saved-title observation contract and controlled regression](development-verification.md#protected-saved-list-title-observation)
distinguish pending results from terminal failures without flushing the writer.

Detached changes keep their original coordinates across host switches and disconnects.
Main applies completion intervals and oldest-boundary availability against saved
fences, including unloaded evidence. OR-ing a certification flag while replacing
metadata would let an earlier completion certify later live progress. See
[owned admission and progress folding](chat-history-api.md#owned-authoritative-mutations).

Confirmed deletion shares this serial drain with saves. It discards the
exact conversation's buffered owned changes, filters its entry from buffered host lists
without reordering peers, and waits behind any already in-flight write. A per-host
deleted-id set suppresses subsequent daemon-item captures and filters delayed list
captures for the writer's lifetime, including retained holder mutations and shutdown.
Stale captures therefore cannot overwrite the queued removal or recreate successfully
removed records. Each removal attempt clears comparison state for that item scope and
host list; removal itself is not skipped by replacement deduplication. Successful
unpair resets suppression for fresh same-server re-pairing.

Removal entries use `[host, 'removeConversation', id]`, distinct from the item
mutation's `[host, 'daemon-items', id]` key. Confirmation cancels the mutation key
before queueing removal. Keeping removal distinct prevents content coalescing from
replacing disk deletion. Successful unpair also advances the host generation;
completion of an older in-flight save may not restore its successful-comparison
state. Otherwise fresh identical content after re-pairing could be suppressed.

## Protected collection

The single main-process store and handler both capture detached validated request
copies before asynchronous work, so caller mutation while queued cannot alter a
pending save. Never create a service per request.

The handler queues valid calls before the asynchronous membership lookup and
waits for storage completion. The store has its own queue covering every valid
read and mutation across all hosts. Ordering only the filesystem writes would
allow a slow earlier membership check to submit an old save after a later removal;
both queues are necessary. Global ordering serializes import, saves and cleanup
across hosts. Reads wait for earlier operations, failures leave the queues
usable, and an earlier pending save cannot overtake a later save or resurrect a
later-removed record. Separate service instances or processes have no shared lock.

`createChatHistoryStore` owns the supplied database and authoritative indexed
backend. Schema 5 keeps complete encrypted list cells in `history_lists` beside
authoritative tables, inert legacy tables and completion/retirement state in
`history_import`. Coordinates are exact UTF-16LE BLOBs; caller ids never become
filenames. Lists validate their decrypted host against the requested owner.
Full thread reads reconstruct only authoritative items; list reads decode only
their cell. Retained replacements remain full replacements, including identical
and empty snapshots. Ordinary thread mutations preserve unowned items/evidence
using the [schema-7 authenticated layout](chat-history-api.md#api).

Conversation removal validates the retained thread/list, deletes the exact
`legacy_scopes` ownership row and cascading `legacy_records` without decrypting
or reconstructing them, removes the authoritative scope and filters the saved list
in one transaction without reordering peers. A resulting saved-empty list remains
distinct from missing. Host removal includes off-screen scopes absent from its
list and preserves other hosts' equal ids. SQL or retained-data validation failure
rolls back the transaction, including ignored-record cleanup. Corrupt retired
payload bytes cannot block cleanup. Legacy tables, indexes and old schema migrations
remain for compatibility; schema-1 ownership migration uses retained request
identifier admission without inspecting retired content. There is no legacy
reader/writer, background migration or table drop.

The policy is **ignore, not migrate**: legacy timelines never become daemon items.
Before the first operation, the store reads the fixed secure-store name
`chat-history`, formerly `{ version: 1, snapshots: [...] }`. After collection
version admission, it recognizes `kind: 'timeline'` before retained snapshot
validation: require numeric safe-integer version 1 and bounded `serverId` and
`conversationId` strings, using `readThread` request admission for ownership only,
then skip the body. Rows, receipts, coverage and other retired payload fields are
never schema-decoded, imported, converted or drawn. The outer JSON must still
be readable. Shared IPC/snapshot admission has no ignore path. Rejecting timeline
kinds in the whole-collection parser would strand valid saved hosts in mixed files;
applying the retired row schema would let irrelevant malformed bodies do the same.

All retained list/item snapshots are strictly parsed before mutation. Invalid
ownership, unknown kinds/versions, malformed retained records and duplicate retained
identities keep fail-closed behavior; repeated ignored timeline identities are inert.
Only missing retained lists/scopes are imported; existing indexed records win
regardless of timestamps. Parser-normalized order, optional absence and saved
evidence survive. Retained data and completion commit in one synchronous SQLite
transaction. Classified backend failures are thrown through the enclosing
transaction to roll back all retained writes and the marker. Secure-store I/O
never occurs inside it. A legacy-only source produces no authoritative items;
existing indexed legacy scopes likewise read as missing through thread APIs and
may remain inert until addressed cleanup.

Completion is durable even when the source is absent. Interruption before the
import commit retries without duplicates; after commit the store never reopens or
decrypts the source. Its presence cannot replace newer content or resurrect a
deleted scope, including after identical host/conversation/epoch reuse. The
completion marker supplies this restart fence independently of source cleanup.

Source retirement follows a successful operation transaction. With `retired: 0`,
the store directly deletes the fixed source and then commits `retired: 1`.
Interruption or cleanup failure leaves retirement retryable on later operations
without replaying imported records or losing lists. Reads and replacements can
succeed while cleanup is pending. Removal reports `remove-failed` when source
cleanup fails, even after its SQLite deletion committed; it does not restore those
deleted records. A repeated removal can retry retirement. Static
`history-source-retired` diagnostics distinguish `ok` and `remove-failed`.

The handler's host/conversation generations reject stale queued saves, reads and
list replacements after removal; fresh authorized requests may save at reused
coordinates. Main-only `clearServer` shares that admission queue and erases
credentials before history. A matched credential erase remains successful if
history cleanup fails, advances the host generation and permits ordinary unpaired
teardown. An erase that throws or matches nothing leaves history/generations
unchanged. See [authorization and cleanup results](chat-history-api.md#application-bound-operations).

Protection inherits [ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md).
Production composition shares one OS-backed `SecretEncryption` with the secure
store, retaining Linux `basic_text` rejection. Indexed payloads, including lists,
are encrypted before SQLite sees them; the directory is 0700, the database 0600
and temporary storage is memory-only. Database/journal/temporary files must contain
no payload plaintext. Unreadable sources and unsupported databases are preserved,
never replaced with empty storage. Before completion, a bad envelope or retained
snapshot blocks import; ignored payload schema does not. Afterward validation is
scoped to affected retained indexed records.
Mutable authentication uses standard SHA-256 under OS-protected roots. No new
network work or background pruning is involved.

## Window close and app quit

`writer.stop()` unsubscribes the required list and authoritative item observers,
daemon events and host-removal notifications. It waits for already-started host removals to settle, then cancels the timer and drains
buffered and in-flight owned changes, list replacements and confirmed conversation
removals in order. Failed owned writes remain pending for a later flush; stop does
not manufacture a successful commit or retry indefinitely.
Deletion suppression remains active throughout the flush. Unsubscribing alone
could acknowledge close before failed
unpair resumes its buffered work. Settlement cannot schedule a new timer after
stop. Main defers normal window close and `before-quit` teardown
until preload's `onChatHistoryFlush` callback has stopped the writer and sent a
`flushed` acknowledgement over `pyry:chat-history-flush`. Main then awaits already
submitted history operations before resuming window close. App quit and Windows
Restart now share one `createQuitDrain` promise, stopping the connection registry
before draining. Updater installation starts before its explicit app quit, so
`before-quit` alone is too late. After a successful drain, window close guards
pass; an installation failure exits with `autoInstallOnAppQuit` disabled, since
the stopped registry cannot resume. See [updater shutdown](windows-packaging.md#history-drain-and-installation-failure).
Quit additionally awaits `historyHandler.drain()` and `historyStore.close()` after
all renderer flushes. Store close rejects new admission, drains its queue and
closes the database. Closing only a window leaves the same store/database owner
usable for a fresh window and writer; it does not call store close.

Readiness registration avoids waiting on a window whose observer never mounted.
Lifecycle messages must come from a window's main frame; flush acknowledgements
resolve only that sender's wait. Closing the window releases its wait and tracking
entries. Hook cleanup removes its flush listener, and `will-quit` removes the
main handler and lifecycle listener. Reconnect adds no listeners.

The guarantee covers graceful close/quit. Abrupt process termination cannot drain
renderer buffers; SQLite transactions and durable completion/retirement state
protect committed snapshots and prevent source replay. Flushing never adds a
completion boundary to a partial answer.
