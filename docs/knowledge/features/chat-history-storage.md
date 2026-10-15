# Protected local chat history — storage and lifecycle

Part of [protected local chat history](chat-history.md). The application currently
uses the protected collection below; the independently callable
[indexed legacy backend](chat-history.md#storage-and-concurrency) has no production
binding yet.

## Buffered replacements

With optional `threads`, the writer observes changed owned daemon snapshots in the
same queue, excluding the private hydration marker from saves. Removing a held
thread discards its pending replacement; memory cleanup alone does not erase disk.
Confirmed deletion discards both formats' pending replacements, suppresses later
captures and invalidates the thread's reads/held state. Successful unpair clears
every held thread for that host, including off-screen scopes and pending reads;
failure resumes buffered work. `stop()` detaches this observer and awaits owned
removal/flush work. Production thread subscriptions and offline/reconnect screen
proof remain [#1908](https://github.com/pyrycode/pyrycode-desktop/issues/1908).

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
exact conversation's buffered replacements, filters its entry from buffered host lists
without reordering peers, and waits behind any already in-flight write. A per-host
deleted-id set suppresses subsequent timeline/daemon-item captures and filters delayed list
captures for the writer's lifetime, including retained holder mutations and shutdown.
Stale captures therefore cannot overwrite the queued removal or recreate successfully
removed records. Each removal attempt clears comparison state for that timeline and
host list; removal itself is not skipped by replacement deduplication. Successful
unpair resets suppression for fresh same-server re-pairing.

## Protected collection

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

In the application-bound store, all snapshots occupy one versioned collection, `{ version: 1, snapshots: [...] }`,
under the constant secure-store name `chat-history`. Identity comparisons use
string equality over `serverId`, `kind` and, for both conversation formats, `conversationId`;
caller ids never become filenames or object lookup keys. One collection makes
list-entry and both conversation-record removals atomic without a journal or mutable manifest.

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

## Window close and app quit

The mounted `writer.stop()` first calls its injected `flushTimeline` while the
per-fold observer remains attached, settling accepted deltas even when their frame
has not run. Detaching first loses accepted text on window close. Repeated stops
skip this settlement hook; injected writers without it keep their existing behavior.
It then unsubscribes the list/timeline and optional thread observers, daemon events
and host-removal notifications,
waits for already-started host removals to settle, then cancels the timer and drains
buffered and in-flight replacements and confirmed conversation removals in order.
Deletion suppression remains active throughout the flush. Unsubscribing alone
could acknowledge close before failed
unpair resumes its buffered snapshots. Settlement cannot schedule a new timer after
stop. Main defers normal window close and `before-quit` teardown
until preload's `onChatHistoryFlush` callback has stopped the writer and sent a
`flushed` acknowledgement over `pyry:chat-history-flush`. Main then awaits already
submitted history operations before resuming close/quit. App quit and Windows
Restart now share one `createQuitDrain` promise, stopping the connection registry
before draining. Updater installation starts before its explicit app quit, so
`before-quit` alone is too late. After a successful drain, window close guards
pass; an installation failure exits with `autoInstallOnAppQuit` disabled, since
the stopped registry cannot resume. See [updater shutdown](windows-packaging.md#history-drain-and-installation-failure).
Closing only a window leaves the app able to open a fresh window and writer.

Readiness registration avoids waiting on a window whose observer never mounted.
Lifecycle messages must come from a window's main frame; flush acknowledgements
resolve only that sender's wait. Closing the window releases its wait and tracking
entries. Hook cleanup removes its flush listener, and `will-quit` removes the
main handler and lifecycle listener. Reconnect adds no listeners.

The guarantee covers graceful close/quit. Abrupt process termination cannot drain
renderer buffers; atomic file replacement still protects the last complete
collection. Flushing never adds a completion boundary to a partial answer.

