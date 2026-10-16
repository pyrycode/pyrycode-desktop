# Protected local chat history — storage and lifecycle

Part of [protected local chat history](chat-history.md). The application uses
protected indexed SQLite storage for lists and both conversation formats. The old
protected collection is a one-time migration source.

## Buffered replacements

The writer requires `threads` and `lists` and queues only `daemon-items` and `list`
snapshots for `replaceThread` and `replaceList`. Lists require the matching host's
`conversationsReceived` receipt; item snapshots carry their authoritative scope.
The private hydration marker is excluded from saves. Removing a held
thread discards its pending replacement; memory cleanup alone does not erase disk.
Confirmed deletion discards pending item replacements, suppresses later
captures and invalidates the thread's reads/held state. Successful unpair clears
every held thread for that host, including off-screen scopes and pending reads;
failure resumes buffered work. `stop()` detaches this observer and awaits owned
removal/flush work. There is no legacy timeline observer or frame-flush dependency.
Production composition supplies the runtime item store as
`threads`; its protected restore and query ownership are described in the
[thread runtime](thread-runtime.md#restore-recovery-and-cleanup). Local pending
sends and session prompts are not durable cache content.

The renderer writer coalesces bursts on a 200 ms timer in a per-record pending map.
Canonical projected values are compared with the latest observed value, so
transient-only changes and unchanged durable records submit no replacement.
One async drain retains the newest update arriving while a prior write is pending.
It also compares the final candidate with the last successful save: a burst that
changes a saved value and then returns to it needs no replacement. Comparing only
successive queued values misses that case.

Detached pending snapshots retain their original coordinates across navigation,
host switches and disconnects. Removing an authoritative holder cancels its pending
item replacement and comparison state, without deleting its disk record. A write
already in flight remains ordered by the drain.

Confirmed deletion shares this serial drain with replacements. It discards the
exact conversation's buffered replacements, filters its entry from buffered host lists
without reordering peers, and waits behind any already in-flight write. A per-host
deleted-id set suppresses subsequent daemon-item captures and filters delayed list
captures for the writer's lifetime, including retained holder mutations and shutdown.
Stale captures therefore cannot overwrite the queued removal or recreate successfully
removed records. Each removal attempt clears comparison state for that item scope and
host list; removal itself is not skipped by replacement deduplication. Successful
unpair resets suppression for fresh same-server re-pairing.

Removal entries use `[host, 'removeConversation', id]`, distinct from the item
snapshot's `[host, 'daemon-items', id]` key. Confirmation cancels the snapshot key
before queueing removal. Reusing that key would let a later holder clear cancel
the queued disk deletion. Successful unpair also advances the host generation;
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

`createChatHistoryStore` owns the supplied database and indexed legacy/thread
backends. Schema 5 keeps complete encrypted list cells in `history_lists` beside
both families and singleton completion/retirement state in `history_import`.
Coordinates are exact UTF-16LE BLOBs; caller ids never become filenames. Lists
validate their decrypted host against the requested owner. Full timeline/thread
reads reconstruct only the addressed family; list reads decode only their cell.
Replacements remain full replacements, including identical and empty snapshots.
Removing a conversation validates and deletes both formats and filters its saved
list in one transaction without reordering peers. A resulting saved-empty list
remains distinct from missing. Host removal includes off-screen records absent
from its list and preserves other hosts' equal ids.

Before the first operation, the store reads the fixed secure-store name
`chat-history`, formerly `{ version: 1, snapshots: [...] }`. It validates the whole
source, including duplicate identities and both formats, before importing anything.
All addressed destinations are validated before mutation. Only missing lists and
scopes are imported; existing indexed records win regardless of timestamps.
Parser-normalized supplied order, optional absence and saved evidence survive;
legacy rows never become authoritative items. Import and the completion row commit
in one synchronous SQLite transaction. Backend classified failures are thrown
through the enclosing transaction so either family's failure rolls back both.
Secure-store reads/deletes are asynchronous and never occur inside that transaction.

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
never replaced with empty storage. Before completion, one bad source snapshot
blocks import; afterward validation is scoped to affected indexed records.
Retained timelines can outlive lists and grow independently of memory eviction.
No new cryptography, network work or background pruning is involved.

## Window close and app quit

`writer.stop()` unsubscribes the required list and authoritative item observers,
daemon events and host-removal notifications. It waits for already-started host removals to settle, then cancels the timer and drains
buffered and in-flight replacements and confirmed conversation removals in order.
Deletion suppression remains active throughout the flush. Unsubscribing alone
could acknowledge close before failed
unpair resumes its buffered snapshots. Settlement cannot schedule a new timer after
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
