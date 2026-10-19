# Protected local chat history

The main-process service stores ordered conversation lists and daemon-item
snapshots in protected indexed SQLite storage, using the same OS-backed
protection as the [secure store](secure-store.md). A
fresh service instance can read completed saved content without a connection or
Noise handshake. Interrupted split saves remain protected and unreadable until
exact retry or authorized supersession. Host identity is the
saved pairing record's `server` field, so equal conversation ids on different
hosts remain separate.

The app records received lists and owned authoritative daemon-item changes automatically.
Subset and metadata-only saves preserve unloaded items and evidence.
Saved lists restore into the sidebar on launch, including unavailable and
pairing-rejected hosts. Opening a saved chat requests the newest 200 shown
`daemon-items` plus active and recorded dependencies through a bounded partial projection on demand.
It never draws a saved legacy timeline. Offline display grants no network capability.
Once that host accepts `thread`, opening and reconnect resume from the saved epoch
and complete checkpoint. Older input first traverses bounded saved held pages,
even offline or while a server reply is pending/failed. Local loading/retry is
independent; after local exhaustion, later demand uses the thread query coordinator.
See [production restore and recovery](thread-runtime.md#restore-recovery-and-cleanup).
Explicit Forget/Unpair removes the host's saved content after credential removal.
Confirmed conversation deletion removes authoritative and ignored legacy data
and that host/conversation's list entry.
Observing, saving, flushing and restoration create no lifecycle demand themselves.
Offline opening and scrolling use saved-host authorization; connectivity gates
apply only to network demand. Disk retention is independent of memory residency.

## API

See [API and operations](chat-history-api.md) for the fixed IPC contract, saved-host
authorization, removal ordering and supported operations.

## Snapshot contract

Every admitted snapshot has `version: 1`, `serverId` and a `kind` of `list` or
`daemon-items`. Legacy timeline APIs, codecs, reconstruction and persistence types
are retired. Old timeline envelopes receive storage-only version/ownership
recognition and their bodies are ignored. They never become authoritative daemon
items, even beside retained records at the same coordinates. See
[protected collection recognition and cleanup](chat-history-storage.md#protected-collection).
Ownership is exact and case-sensitive. SQLite coordinates use UTF-16LE BLOBs:
TEXT binding would replace lone surrogates and merge distinct admitted JavaScript
ids with U+FFFD. See [migration limits](chat-history-api.md#api) for earlier TEXT keys.

A daemon-item record adds `conversationId` and shared `ThreadSnapshot` field
`thread`, retaining epoch, item ids/revisions, held order, hidden/unordered items,
attribution and unknown inert JSON, including patch-produced nulls. It also retains
applied `version`, complete `checkpoint`, certified `ranges`, optional
`olderAvailable`, `repair`, `uncommittedVersion` and optional `arrivalOrder`.
Hydration certifies no additional progress or coverage. Older snapshots without
unfinished metadata conservatively fence applied progress ahead of checkpoint;
without arrival metadata, supplied item order is the fallback. See
[snapshot and hydration rules](thread-item-store.md#snapshots-and-completed-batches)
and [API validation](chat-history-api.md#api). Permission prompts, question batches,
session live state and local unaccepted messages do not enter this cache.

A list retains the eight required `ConversationSummary` fields:
`id`, `name`, `is_promoted`, `is_archived`, `cwd`, `last_message_ts`, `last_used_at`
and `workspace_label`. Optional `is_muted` and `agent` (mapped through `agentFromWire`) are retained;
older rows restore without an agent key. Duplicate IDs within a list are invalid; order is preserved.

Optional `read_up_to` and `latest_entry_id` retain non-negative safe integers, including zero.
Null, negative, fractional, nonnumeric and unsafe values reject the snapshot without coercion.
Older version-1 lists remain valid with neither field; omission never becomes zero.

`archived_at?: string | null` is also retained. Snapshot validation preserves strings (including
invalid timestamps) and explicit `null`, rejects other value types, and restores pre-field rows
without adding the key. This differs from live list decoding, which normalizes absence to `null`.
Timestamp eligibility belongs to the [Archive derivation](archive-screen.md#the-view-model-archiveviewmodelts),
so rejecting invalid date strings here would prevent its last-use fallback and discard an otherwise
valid saved list. Saved order remains unchanged; Archive sorts its own per-tab arrays.

### Received-state admission and ownership

[`useChatHistoryWriter`](../../../src/renderer/src/store/chatHistoryWriter.ts)
mounts once from [`App`](app-shell.md#where-the-daemon-bridge-lives) across routes.
`createChatHistoryWriter` requires `threads` and `lists`; production supplies
`threadRuntime.items` and `conversationListStore`. It observes only received lists
and authoritative owned changes, submitting `replaceList` and `mutateThread`.
It has no legacy timeline subscription, receipt/row-key/echo observation,
`replaceTimeline` path or timeline-frame flush hook. Legacy renderer producers were
retired in #2030; #2026 also removes their shared admission, indexed backend, codecs
and exclusive persistence types. Only compatibility recognition/schema and scoped
cleanup of saved legacy data remain.

List admission still requires preload's synchronous `conversationsReceived` receipt
with a string `serverId`, and a changed `byServer` array for that exact host.
The [receipt context](daemon-event-channel-plumbing.md#3-the-preload-subscription-srcpreloadindexts)
is restored in `finally`; active selection cannot establish ownership.
Read pushes update attention immediately but do not themselves save a list; a later
received list captures the reconciled read marks. Startup state, local list
restoration and clears schedule no list write.

Item ownership comes from each received transition's `owned` change at the exact
host/conversation/epoch. The writer skips unchanged ownership references and local
restoration, so hydration schedules no save. Capture links immutable detached owned
changes; `parseChatHistoryRequest` validates/detaches each bounded submission before
IPC and independently in main. It does not project a shortened holder as a complete
snapshot. Ordered completion intervals and availability boundaries preserve saved
repair/unfinished fences
that the holder may not contain. Holder loss retains pending work; intentional
same-epoch resets carry a unique retry identity. See
[owned mutation admission](chat-history-api.md#owned-authoritative-mutations).
Local unaccepted sends, permissions and session state never enter this cache.
See [buffering and removal ordering](chat-history-storage.md#buffered-replacements).

[`createSavedListRestorer`](../../../src/renderer/src/store/savedListRestorer.ts)
mounts once in `PairedShell` and observes saved identities independently of connection
status. It requests only `readList`, verifies kind and host, and completes the
store-owned `beginLocalListRead(serverId)` handle. It preserves saved order without
fabricating a daemon event or calling the received-list setter. Existing lists or
reads prevent duplicate admission. Received lists, cancellation and host/global
clears invalidate late successes and failures, including clears before rows exist.
Departed hosts and teardown cancel outstanding handles; IPC itself is not abortable.
A cancelled read can be retried by a later mount; loaded/failed reads stay settled.
Other hosts' arrays retain their identity. Restoration never selects a chat or
creates connection, working or recovery state.

[`readSavedTimeline`](../../../src/renderer/src/store/savedTimelineRestorer.ts)
keeps its runtime name but requires `threads` and requests `openThreadPage` with
limit 200 by default. Explicit traversal demand selects newest/before held pages
at the same limit. It accepts validated partial daemon-item pages with the exact
requested host and conversation, retaining sparse arrival positions and saved availability
boundary separately from selected coverage. Wrong kinds/coordinates, unexpected
results, classified errors and rejected IPC fail the current handle without importing
data; missing opening records complete it with null. There is no `readTimeline` fallback.

`threadRuntime.restore` invokes this reader, which opens the store-owned
`beginLocalRead(host, conversation)` handle and returns `{ done, cancel }`.
Default opening refuses held scopes; explicit held-page admission requires one
and permits only one pending read. Process-local tokens fence delayed completion
and failure after cancellation, replacement reads, explicit reset, epoch replacement or conversation/host/global
clear, even if coordinate or epoch strings are reused. Initial epoch admission and
same-owner live publication preserve the read. Explicit partial restoration merges
saved-only items with admitted revisions and arrival ties while retaining saved
repair/unfinished obligations; only exact completed coverage can release their
checkpoint fences. See [store hydration](thread-item-store.md#snapshots-and-completed-batches).
Hydration emits no owned save and certifies no new progress or read acknowledgement.
Restoration creates no transport request or raw event. Opening/reconnect network
catch-up remains coordinator-owned; older demand first consumes saved pages and
Retry resumes local failure when present, otherwise delegates to that coordinator.
See [runtime ownership](thread-runtime.md#independent-saved-traversal). No legacy
content request is introduced.

Confirmed `conversationDeleted` delivery queues `removeConversation` using its
main-stamped host and confirmed id, even without a held scope or list entry.
Missing host origin reports `unknown-ownership` and never borrows selection.
The writer clears that authoritative scope and cancels its local read, removes
buffered item content, filters delayed list captures and suppresses later item
captures for that host/id. The ordered backend operation removes
authoritative data, ignored legacy records and the list entry. Other hosts' equal ids and same-host peers
survive. A delete command without confirmation removes no saved content.

[`runUnpairServer`](../../../src/renderer/src/screens/settings/unpairServerAction.ts)
begins the renderer-local [removal lifecycle](../../../src/renderer/src/store/chatHistoryRemoval.ts)
before invoking main. The writer pauses that host's drain while allowing others
to proceed. Failure resumes buffered work and retains deletion suppression.
Success discards pending/comparison state, resets deletion suppression, advances
the host generation and removes all authoritative host scopes and pending reads,
including scopes omitted from the latest list. An old in-flight save cannot
repopulate comparison state after this generation change: otherwise fresh identical
items after same-session re-pairing could be incorrectly deduplicated.
Clearing only listed scopes would also let omitted erased content survive re-pairing.
Network failure, rejected/expired pairing, repair, list omission and memory cleanup
are not disk-deletion signals. See [shutdown draining](chat-history-storage.md#window-close-and-app-quit).

### Admission limits

The parsers reject oversized values without truncating them:

- Server/conversation ids use `MAX_SERVER_ID_LENGTH` (currently 8,192 UTF-16
  code units). Empty ids and path-like strings are valid data; membership still
  requires exact equality with a saved `server` identity.
- Other strings allow at most `16 * 1024 * 1024` UTF-16 code units
  (`string.length`, not a byte-size limit). Snapshot arrays allow at most 100,000
  entries each.
- Daemon item ids/revisions and progress are nonnegative safe integers. Inert item
  JSON has a depth limit of 64 and an aggregate limit of 100,000 nodes; see
  [API admission](chat-history-api.md#application-bound-operations).

There is no automatic snapshot eviction, total disk-size bound or history-download
policy. Ignored timeline bodies are outside retained payload admission.

## Results and failure preservation

See [results and failure preservation](chat-history-results.md#results-and-failure-preservation)
for saved-read notices, result/error classifications and preservation after failed writes or removal.

## Storage and concurrency

Production `createChatHistoryStore` composes the authoritative indexed backend
with protected list cells, stable authoritative payloads, schema-7 authenticated
mutable indexes and schema-8 split-save receipts/obligations. One main-process
database owner lazily opens a reusable synchronous connection at
`history/history.sqlite` beneath
trusted `userDataPath`. The composition root retains it across window reopening;
graceful app quit flushes renderers, drains handler/store admission and closes it.
Directory creation uses mode 0700 and the database is set to 0600. Reads run
synchronously within transactions; ordinary owned mutations yield within
one atomic transaction per submission. Secure-store I/O is outside transactions.
See [schema admission and migration](chat-history-api.md#api).

First access recognizes and ignores owned version-1 legacy envelopes, validates
retained lists/items and imports missing retained data in one transaction with a
durable completion marker. Existing indexed content wins regardless of timestamps.
A failure before commit leaves no partial import or completion marker. After
completion, no operation reopens/decrypts the source. Thread reads select only
authoritative scopes and list reads decode only their protected cell.

Source retirement has a separate durable flag. Cleanup retries delete the fixed
source directly without replaying it, so a retained source cannot overwrite newer
records or resurrect deletions after restart or identity reuse. Conversation
removal commits authoritative/ignored legacy cleanup and the saved list entry
together; host removal
includes off-screen scopes. Handler host/conversation generations reject stale
queued work while fresh authorized replacements may reuse identical coordinates.
The [storage reference](chat-history-storage.md#protected-collection) details queues,
retirement failure and credential-first unpair ordering.

Ignored indexed legacy data has no read or reconstruction path. Exact scoped
cleanup cascades from `legacy_scopes` without inspecting retired payloads; old
schema handling remains compatible. See the [storage reference](chat-history-storage.md#protected-collection).

Authoritative scopes separately protect header metadata, item placements, stable
item payloads and ranges, including first-arrival and containing-range associations.
Payload lookup uses stable owner/item id; protected placements bind the exact
ciphertext digest. Retained full-replacement scopes bind placements/evidence to
the current generation. Mutable scopes instead authenticate them through roots
in the protected header, with an AVL sequence for held order/rank and fixed-width
radix lookup/order/evidence paths. Parent hints require root-to-node verification;
owner binding alone would allow old-record replay. A protected aggregate JSON-node
count keeps incremental admission within full/page reader limits. Schema-5 conversion
validates all authoritative scopes; schema-6-to-mutable conversion validates only
the addressed scope in its first owned transaction. Subsequent mutations/pages
avoid conversion scans and retain untouched ciphertext. See
[storage bindings and migration](chat-history-api.md#api).
Lists remain complete protected cells. Retained reads preserve exact supplied
ownership and content; legacy rows never supply daemon facts.

Every replacement and owned mutation, including metadata-only work, rotates its
continuation identity. Authoritative scopes retain their owner for same-epoch replacement and rotate a protected generation, reusing
unchanged same-epoch item ciphertext. Epoch-changing replacement receives a new
owner. Delete/recreate receives fresh ownership; deletion cascades to all evidence
and payloads. These identities are not authorization. Payload protection
and reviewed structural columns are detailed in
[failure preservation](chat-history-results.md#results-and-failure-preservation).

The adapter is pinned to `better-sqlite3` 12.4.1. Host Node and Electron require
separate native rebuilds; packaging rebuilds for the target ABI and unpacks the
adapter from asar. See [runtime preparation and counted native proof](chat-history-testing-native.md#native-runtime-and-packaged-proof).
Windows NSIS x64/arm64 targets remain configured; these smokes add no Linux/macOS
release channel. Authoritative opening and held-page variants use the fixed
authorized bridge. Ordinary owned
writes preserve unloaded history. Production opening uses partial selection with
no full-read fallback; retained full operations remain callable. Complete unchanged
saved traversal starts newest-first independently of opening's shown-window token
and preserves the visible-row anchor. A separate authenticated recovery capability
rebases invalidated traversal in bounded identity windows after owned mutations or
same-epoch replacement. Ordinary stale tokens still reject, and selection failures
retain displayed facts for explicit Retry. Indexed replacement rebuilds indexes in
its write transaction; initial conversion remains separate from cold opening/recovery.
See [the recovery contract](chat-history-api.md#bounded-authoritative-opening-and-pages)
and [ADR 0015](../decisions/0015-protected-saved-traversal-recovery.md).

## Testing

See [the testing reference](chat-history-testing.md) for writer admission,
restoration, removal and protected retained-contract coverage.
Authoritative cache tests retain shutdown, restart and checkpoint coverage.
When seeding a protected snapshot,
wait for the opening page's buffered save first or it can overwrite the seed.
