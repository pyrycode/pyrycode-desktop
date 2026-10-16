# Protected chat history — API and operations

Part of [Protected local chat history](chat-history.md). The fixed IPC surface and
main-process handler authorize saved-host operations independently of connection.

## API

[`src/shared/chatHistory.ts`](../../../src/shared/chatHistory.ts) defines
`ChatHistorySnapshot`, `ThreadSnapshot`, `DurableThreadItem`, `ChatHistoryRequest` and
`ChatHistoryResult`, plus the pure `parseChatHistorySnapshot` and
`parseChatHistoryRequest` validators. Shared code imports no renderer implementation.
The [thread item store](thread-item-store.md) re-exports `ThreadSnapshot` from this
contract. `kind: 'daemon-items'` records contain `{ version: 1, serverId,
conversationId, thread }`; `thread.hostId` and `thread.conversationId` must match
the outer coordinates. The outer format version and held thread's applied version
are separate values. Version-1 `timeline` records keep app-built rows and merge
evidence for retained legacy APIs. They coexist with daemon records at the same
host/conversation, but production display reads only `daemon-items`. Legacy reads
never convert rows into authoritative items and supply no fallback route.

[`createChatHistoryStore({ secureStore, encryption, database, log })`](../../../src/main/chatHistoryStore.ts)
returns `execute(request: unknown): Promise<ChatHistoryResult>` and async `close()`.
It owns serialized import, protected lists and full operations over both indexed
families. `close()` stops new admission, drains admitted work and closes the
database; subsequent calls return `unreadable`. The composition root creates one
store/database for the app lifetime. Window close flushes without closing that
owner; graceful quit flushes renderers, awaits handler `drain()` and then closes
the store. See [shutdown ordering](chat-history-storage.md#window-close-and-app-quit).

[`createChatHistoryHandler({ store, pairedServers, log })`](../../../src/main/chatHistoryHandler.ts)
returns an injected listener `(event: unknown, request: unknown)` with the same
result. It validates and copies the request synchronously, then checks
`pairedServers.loadById(serverId)` for existence before accessing chat storage.
Saved hosts are eligible while disconnected or pairing-rejected; a live
connection is never consulted.
The store validates independently but has no pairing dependency, so saved-host
authorization belongs to the handler. Pairing records are reduced to membership,
never forwarded to the caller.

The independently callable
[`createIndexedLegacyHistory({ database, encryption, log })`](../../../src/main/indexedLegacyHistory.ts)
also returns `execute(unknown): Promise<ChatHistoryResult>`, accepting only
`readTimeline`, `replaceTimeline`, `removeConversation` and `removeServer`.
It parses and detaches requests before database access; unsupported operations,
invalid snapshots and coordinate mismatches return `invalid-request`. Its removals
delete only the addressed legacy SQLite scope(s) and indexed evidence. They do not
update lists or daemon-item records. The application-bound operations in the table
below retain their existing wider removal behavior. Saved-host authorization remains
with `createChatHistoryHandler` in production.

The authoritative family has its own main-only
[`createIndexedThreadHistory({ database, encryption, log })`](../../../src/main/indexedThreadHistory.ts).
Its `execute(unknown): Promise<ThreadHistoryResult>` accepts `readThread`,
`replaceThread`, `mutateThread`, `removeConversation`, `removeServer`,
`newestThreadPage`, `beforeThreadPage` and `openThreadPage`. Full operations use the
existing shared request/result shapes;
replacement retains the normalized `daemon-items` snapshot exactly, including
hidden/unordered items, inert unknown JSON, explicit nulls and optional arrival
metadata. Requests are detached and validated before database access. Removal
affects only authoritative scopes for the exact owner, preserving legacy records,
lists and other hosts' equal ids. This callable backend shares the supplied database
owner. Production `createChatHistoryStore` delegates full, owned and bounded page
operations to it;
direct backend calls perform no saved-host authorization.

Both backends retain detached-callable Promise `execute` methods and expose
main-only synchronous `executeSync` seams for enclosing multi-family transactions.
The enclosing caller must throw classified error results to roll back its outer
transaction; returning an error normally would commit it. No SQLite transaction
may span asynchronous secure-store I/O.

[`createHistoryDatabase({ userDataPath })`](../../../src/main/historyDatabase.ts)
owns the connection and exposes synchronous `transaction(run)` plus `close()`.
An empty schema-version-0 database initializes the base schema 2 transactionally;
its first transaction migrates to schema 5. An unversioned
database containing tables or an unfamiliar version is rejected without recreation.
Schema 1 migrates TEXT ownership keys to UTF-16LE BLOBs inside the calling operation's
transaction, then chains through schemas 2, 3, 4 and 5, retaining ciphertext and
committed-snapshot UUIDs. Schema 3 adds only the partial `legacy_receipt_start`
index on `(scope, entry_id, parent)` where `kind = 'receipt-id' AND ordinal = 0`.
It lets adjacent-cursor selection skip non-start memberships in spanning receipts;
indexing all memberships would still allow that lookup's work to grow with older
history. Schema 4 additively creates `thread_scopes`, `thread_records` and the
`thread_ranges` index, preserving legacy data and the receipt-start index. Its
idempotent creation also retains authoritative tables from the earlier schema-3
branch layout. Schema 5 adds `history_lists(server, payload)` and
`history_import(singleton, retired)`. List payloads are encrypted complete list
snapshots; decoding validates their exact host ownership. The singleton's presence
means import is complete; `retired: 0` means source cleanup is pending and
`retired: 1` means cleanup was recorded. Lists and both families use exact UTF-16LE
BLOB ownership, preserving NUL and lone-surrogate distinctions. A later validation
or decryption failure in the same transaction rolls back its migrations, index and
version changes too, allowing retry. Migration preserves strings already stored in schema 1; it cannot
recover surrogate distinctions lost during earlier TEXT binding. Future schema
additions require explicit versioned migrations; snapshot `version: 1` is unchanged.

The owner also admits schema 6. The first authoritative backend operation on
schema 5 validates every saved authoritative scope through the old protected
decoder and complete snapshot admission, creates `thread_payloads`, rewrites
headers/placements/ranges and sets version 6 in the same transaction. Earlier
supported schemas chain through schema 5 first. This one-time conversion retains
each scope owner as its initial protected generation, preserving old continuations.
Corrupt input, unavailable protection, conversion or later operation failure leaves
the last commit intact and permits retry; no version marker commits ahead of
conversion. Legacy/list-only operations need not initiate this protected upgrade.

In the retained schema-6 representation, `thread_scopes.identity` is the stable
owner. Item lookup uses
`thread_payloads(scope, item_id)`; its protected envelope binds owner, epoch, id,
revision and the exact admitted item, independently of held/range positions or
continuation generation. A protected item placement in `thread_records` binds all
selection indexes and `{ id, rev, digest }`, where `digest` is SHA-256 of the exact
item ciphertext. Reading verifies lookup revision, digest and protected payload
facts. Headers bind the owner and exact coordinates; placements and ranges bind
the header's current generation. Binding only the stable owner would permit replay
of older protected placements/evidence after replacement. See
[the binding decision](../decisions/0013-stable-protected-thread-bindings.md).

Same-epoch full replacement preserves the owner, rotates generation and rewrites
placement and evidence records. It reuses exact ciphertext for unchanged items in the same
epoch; changed items or a changed epoch receive new payloads. This remains a full
snapshot validation/replacement, not an incremental write. Epoch-changing replacement
receives a fresh owner, fencing capabilities even after an epoch-string round trip.
Scope removal cascades to placements, ranges and payloads; recreation receives a new owner and generation.

Schema 7 adds `thread_auth(scope, tree, path, payload)` in the first owned-write
or opening-conversion transaction. Conversion is lazy per addressed scope: fully
validate its schema-6 snapshot, retain exact item ciphertext and held/arrival order, then rebind placements
and ranges to the stable owner and build authenticated indexes. Other scopes keep
their retained representation. Conversion, schema marker and requested operation
commit or roll back together. Existing fractional-index scopes also convert once,
after full validation, to the final AVL representation without rewriting placements.
See [ADR 0014](../decisions/0014-authenticated-owned-thread-mutations.md).

The mutable protected header authenticates item-id, numeric-order/arrival and range
radix roots plus an AVL held sequence with subtree counts. Stable placement ordinals
identify nodes; they are not dense display positions. Rank verifies the complete
hinted route from the protected root, so plaintext parent hints grant no authority.
Leaves bind exact placement/range ciphertext digests, and placements still bind the
item payload digest. Changed paths and the protected header commit with changed
facts; each path flushes once per transaction. Unchanged payloads and placements
stay byte-identical. Continuation generation rotates independently on every owned
commit, including metadata-only work. Old records/branches cannot authenticate
against the current root; rolling back every protected record remains outside the
guarantee. Full/page readers support both representations.

Before its first operation, the application store checks completion, then decrypts
and validates the entire version-1 secure-store collection, including duplicate
identities, through shared snapshot admission. It validates addressed destination
records before mutation and imports only missing scopes/lists. Existing indexed
content wins regardless of timestamps. Lists, both formats and completion commit
together; no source I/O occurs inside that transaction. An absent source also
commits completion. Failed import preserves the source and last committed records;
later queued work can retry. Schema admission may already have committed during
the completion check without importing any content.

Once complete, the store never reads/decrypts the source again. After a successful
operation transaction it retries direct source deletion while retirement is pending,
then records retirement separately. Interruption between either commit and cleanup
cannot replay old records. Reads/replacements remain available when source deletion
fails; a removal reports `remove-failed` even if its SQLite deletion committed.
See [failure preservation](chat-history-results.md#results-and-failure-preservation).

Full reads reconstruct and validate one committed snapshot through
`parseChatHistorySnapshot`, then compare canonical records with stored payloads
and indexes to reject missing/orphan records or inconsistent indexes. Replacement
and conversation removal validate the existing addressed snapshot before mutation;
host removal validates every scope in the backend's own family for that exact host.
Other hosts and peer conversations remain independent. See
[rollback and protection](chat-history-results.md#results-and-failure-preservation).

### Owned authoritative mutations

Ordinary received saves use the existing fixed IPC with
`{ operation: 'mutateThread', serverId, conversationId, change }`:

| `change` field | Contract |
| --- | --- |
| `metadata` | Exact host/conversation/epoch and scalar progress, repair and optional availability; excludes items, ranges and arrival arrays. |
| `items`, `removeIds`, `ranges` | Changed complete item facts, explicit item removals and newly certified ranges. Omitted saved facts/evidence survive. |
| `acceptEpoch` | Required boolean allowing creation/epoch transition. Reaccepting an already saved epoch preserves it. |
| `resetId?` | Bounded identity for an explicit reset with epoch admission; a new identity resets even the same epoch, while retrying the recorded identity preserves later facts. |
| `completion?` | Exact completed `{ fromVersion, version }`, supplied by successful `beginBatch.commit`; never an unbound certification flag. |
| `availability?` | `{ start, available }` for the certified oldest supplied boundary; requires completion. |
| `priorProgress?` | Earlier metadata/completion/availability observations retained in admission order during coalescing and retry. |

`parseChatHistoryRequest` detaches only changed JSON and bounded observations.
Unknown request/change/observation keys, duplicate item/removal ids, overlap between
those ids, mismatched observation coordinates/epochs and invalid intervals reject
before storage.
Completion requires `0 <= fromVersion <= version <= metadata.checkpoint`.
Hydration and missing/recreated holders supply no completion or removal authority.
Higher stored revisions win over older/equal revisions; a conflicting item kind
rejects the mutation. New items receive stable first-arrival positions; revisions
retain them. Ordering uses saved neighbors, including unloaded items, rather than
the apparent tail of a partial holder. Removal leaves arrival gaps.

Main folds `priorProgress` then the current observation against saved progress.
Completion is admitted only when `fromVersion <= saved checkpoint`; it can advance
fenced progress only through its own `version`. Uncovered saved and pending repair
or unfinished obligations survive metadata-only saves and later live progress.
New epochs start from empty progress. Retrying already-covered repair observations
does not revive old obligations, but a new repair at the current checkpoint persists.
Availability compares certified boundaries against retained evidence: older wins,
equal-boundary exhaustion (`false`) wins, and newer/metadata-only observations cannot
erase older exhaustion. A holder's scalar checkpoint or availability alone cannot
certify unloaded work.

After one-time conversion, mutation reads/decrypts only changed items and required
metadata/evidence, with fixed-width lookup and logarithmic sequence work. A protected
aggregate JSON-node count subtracts removed/revised old items and adds changed items;
exceeding the shared 100,000-node limit rolls back the transaction so retained
full/page readers remain coherent. Metadata replay touches the header with work
proportional to received observations, not saved history. Protection stays in main;
the renderer receives no SQL, filesystem, keys or ciphertext. Bounded reads return
only validated projections and opaque local continuations.

### Bounded authoritative opening and pages

The fixed shared/preload/main `chatHistory` bridge admits authoritative page
requests through `parseChatHistoryRequest`, the saved-host handler and serialized
application store. Preload forwards the shared variants unchanged. Database access,
protection and continuation contents stay in main. Requests have these fields:

| Operation | Additional fields beyond `operation`, `serverId`, `conversationId` |
| --- | --- |
| `openThreadPage` | `limit`: integer 1–200; production opening uses 200 shown identities plus closure. |
| `newestThreadPage` | `limit`: integer 1–200 held items. |
| `beforeThreadPage` | The same `limit`, an opaque `continuation` from a prior page, and optional paired opaque `recovery`. |

Unknown request keys reject. All three return `{ status: 'page', page }`, with
`page.partial: true`, selected `items`, selected intact `ranges`, separate saved
`metadata` and `continuation: string | null`. `metadata` is
`Omit<ThreadSnapshot, 'items' | 'ranges' | 'arrivalOrder'>`; it preserves ownership,
epoch, applied version, checkpoint, unfinished progress, repair and optional older
availability. Optional aligned `arrivalPositions` hold each selected item's saved
first-arrival position. Opening conversion assigns supplied held-order positions
when older snapshots lack arrival metadata; retained held pages may omit the field. Sparse positions remain valid after removals and are not a complete
arrival permutation. Optional `availabilityStart` preserves the saved oldest
availability boundary even when that range is outside the selected evidence.
`threadHistoryCodec.page` validates partial ownership/metadata, unique item ids,
aligned unique nonnegative safe-integer arrival positions, ranges, optional boundary
and null or bounded base64url continuation separately from full-snapshot membership.
Optional `recovery` is admitted as a bounded base64url string too; it is separate
from the continuation and absent from production opening results.

Opening selects the final `limit` saved identities whose `shown === true`, or all
if fewer, in retained held order. Hidden items and synthetic presentation markers
consume no base slots; folding does not affect selection. Authenticated AVL
shown/active subtree counts select the window and every saved `active === true`
item without filtering hidden tails. Closure follows recorded numeric parent edges
through the id index, retaining agent ancestor chains, and joins assistant messages
to saved `turn_end` facts by session/agent/turn/parent attribution. The authenticated
ending index stores the attribution digest and placement ordinal. Included agent
fields retain background marker/ending anchors and recipient joins. No names,
results or unrelated descendants establish parentage. Each scoped identity is
included once in held order, retaining `shown`, `active`, nesting and placement;
required shown parents may render beyond the limit, while hidden dependencies stay
hidden. Timestamps never order selection or first-arrival ties.

Newest selects the final held-array window; before selects the immediately preceding
window, exclusive of its continuation boundary. Items keep supplied held order,
including hidden items, ties and absent/null/non-numeric orders. Missing newest
returns `missing`; saved-empty returns a page with empty items and null continuation.
Following continuations on an unchanged snapshot traverses held items backwards
exactly once, with each window internally in held order.

Opening indexes and their protected roots are maintained in the same transaction
as owned revision/removal changes. An addressed retained scope, including older
mutable scopes without these indexes, converts once after complete validation;
conversion preserves held/arrival order and existing mutable placement ciphertext.
Same-epoch full replacement of an indexed scope rebuilds its authenticated indexes
inside the replacement transaction. Deferring that rebuild would make the next
recovery read pay whole-snapshot conversion. Fresh owners reuse committed indexes;
initial retained-scope conversion and import can scale with saved data and are
measured separately from ordinary cold opening and recovery. Full reads preserve
optional arrival metadata exactly; mutable pages expose authenticated placement
positions, including conversion-synthesized positions. Owned mutations publish
arrival metadata once they use those positions.

Authenticated AVL/radix nodes are cached by their complete proof within each
transaction-local index instance, with detached node containers returned to mutation.
Selected payload and evidence decoding is cached too. Bounded payload work alone
can conceal thousands of repeated structural SQL/JSON reads; proof caching avoids
that repetition without trusting plaintext hints or a proof from an earlier root.
Unrelated older/hidden items or ranges add no selected placement/payload decoding;
authenticated structural traversal may grow logarithmically. See
[opening work measurements](chat-history-testing-native.md#counted-bounded-opening-validation).

After conversion, each page decodes only the protected header, selected item
placements and their directly looked-up payloads, and relevant ranges in one
synchronous transaction. Ranges are the saved ranges containing selected
nonnegative safe-integer orders (`start <= order < end`), plus the newest saved
range as an anchor even for empty/unordered windows, once each in saved range order.
Retained placements use protected per-item range membership to verify containment.
Mutable scopes instead authenticate range predecessor/exact lookup against the
protected range root, so merged evidence needs no untouched placement rewrite.
Trusting mutable numeric range indexes alone could silently omit damaged evidence.
Nonindexable orders remain inert item content and establish no coverage. Header
counts determine window contiguity and exhaustion without a continuation probe.
Neither the full reader nor complete item/range/arrival arrays are loaded. Shared
`threadHistoryCodec` validators admit selected facts without treating a shortened
snapshot as complete; full reads retain aggregate and complete-membership validation.

An ordinary base64url continuation protects exactly `{ format: 'daemon-items', identity,
before }` through `SecretEncryption`. `identity` is the protected generation UUID;
`before` is a positive safe-integer exclusive held rank (ordinal in retained scopes).
Exact scoped lookup and
the validated header bind that generation to host, conversation and epoch in the
same transaction. Migration alone and fresh-instance reopen retain validity;
every replacement and owned mutation, including identical or empty content, rotates
generation without necessarily re-encrypting item payloads. Deletion/recreation cannot revive it.
These tokens are local positions, separate from daemon cursors.

Ordinary held-rank token plaintext is at most 101 ASCII bytes, independent of
coordinate/epoch length or JSON escaping (at most 136 base64 bytes before production OS protection).
Generation and admission share a 65,536-character encoded limit; excessive
protection overhead fails without returning an inadmissible token. Copying owner
and epoch strings into the token would break traversal for valid long surrogate
strings after JSON/protection expansion. See [page failures](chat-history-results.md#bounded-page-results).

Authoritative full operations, collection import and owned mutations share the
readers above. Production restoration uses `openThreadPage` with explicit partial
admission. User-driven traversal starts separately at `newestThreadPage`, then
follows its own `beforeThreadPage` continuations with limit 200. Opening's token
precedes the base shown window; it cannot enumerate hidden items within/after that
window, even when null. An old active dependency also cannot define the visited
boundary. Overlapping opening/dependency facts merge by identity, so an unchanged
saved generation is traversable completely without duplicate resident identities.

Slice residency keeps `traversal` separately: undefined means unstarted, a string
is the next opaque token, and null means locally exhausted. Neither short/empty
pages nor null certify daemon completeness, clear repair, advance checkpoint or
replace boundary-owned older availability. Only supplied saved ranges are unioned;
loading `[100,200)` beside `[900,1000)` leaves the unsaved hole and the coordinator's
network boundary at 900. Saved-but-unloaded content, resident content and acknowledged
reads remain distinct. Hydration creates no owned save, coverage certificate or read
acknowledgement. Local exhaustion offline retains connection-needed treatment when
daemon completeness is unknown.

Mutable held pages with a non-null continuation also mint a separate protected
`recovery` capability. It binds `format: 'daemon-items-rebase'`, the stable scope
owner, SHA-256 of the epoch and exact decoded continuation, and a numeric boundary
identity. Main validates both token shapes and current exact host/conversation scope
before considering recovery. A stale ordinary continuation still rejects without
its matching capability; malformed tokens, capability substitution and generic read
errors cannot authorize a rebase. Both opaque strings share the 65,536-character
admission/protection limit and remain memory-only in renderer residency, never logs.

Only a generation mismatch with that validated capability starts a newly
authenticated circular identity pass: descend ids below the retained boundary,
then wrap through the remaining ids at/above it. Authenticated id-radix lookup
works even when the boundary was removed. Each selected window is returned in
current authenticated held order through verified sequence ranks, retaining sparse
arrival positions and relevant evidence. Identity selection is private traversal
state, separate from display order and daemon `before_order`. Resuming only at a
boundary's current held rank could miss unvisited items moved across it; a complete
identity pass after writes settle visits every remaining saved identity. Resident
overlap merges by id rather than creating duplicate rows.

The new continuation carries generation-bound ring state; another write can rebase
it with its own paired capability. Unchanged ordinary and recovery continuations
survive fresh protected reopen. Epoch replacement/round trips, explicit reset,
deletion/recreation and unpair retire ownership rather than granting recovery.
Selection, proof validation and token minting share one synchronous transaction.
Each demand makes **one IPC call and one selection attempt, at most 200 identities**
plus relevant range evidence. Authenticated lookup and up to 200 rank proofs have
logarithmic structural work; selected payload work is independent of loaded depth
and unrelated history. No replay from newest, resident inventory or full read is
used for recovery after conversion.

Classified protection, storage/token and IPC failures retain displayed valid facts
and settle into content-free local failure. Explicit Retry starts one new bounded
attempt with the retained pair; there is no automatic retry loop or full-read
fallback. See [runtime ownership](thread-runtime.md#independent-saved-traversal)
and [ADR 0015](../decisions/0015-protected-saved-traversal-recovery.md).

### Main-only bounded legacy pages

The indexed legacy backend exposes `newestPage(unknown)` and `beforePage(unknown)`,
each returning `Promise<LegacyHistoryPageResult>`. Their request objects have no
`operation` field:

| Method | Request fields | Successful result |
| --- | --- | --- |
| `newestPage` | `serverId`, `conversationId`, `limit` | `status: 'newest-page'`, selecting the final saved rows. |
| `beforePage` | The same fields plus `continuation` | `status: 'before-page'`, selecting rows strictly before its held-order boundary. |

Both admit only numeric integer limits 1–200 and exact bounded ownership strings;
unknown request keys reject before database access. Results contain at most that
many `items` with aligned `rowKeys`, preserving supplied held order, content and
multiplicity independently of timestamps. Without saved `rowIdentity`, keys use
the original whole-snapshot ordinal minus saved `prependedRows`, never a page-local
index. A missing newest scope returns `missing`; a saved-empty scope returns
`newest-page` with empty items/keys and `continuation: null`.

Successful pages also contain `savedCoverage`, optional saved `newestCursor`,
[selected partial evidence](chat-history.md#bounded-local-page-evidence) and
`continuation`. A non-null `LegacyHistoryContinuation` has exactly
`{ format: 'legacy-v1', serverId, conversationId, snapshotId, before }`.
`snapshotId` identifies the committed UUID; `before` is the exclusive, positive
safe-integer ordinal of an existing held row. It is a local structural position,
separate from every opaque daemon cursor. Admission checks exact coordinates,
format, committed identity and boundary existence. Reopening a fresh database
owner preserves a continuation while that snapshot is unchanged. Every replacement,
including identical content, rotates the UUID; deletion and delete/recreate also
invalidate earlier continuations. Following returned continuations traverses the
unchanged held rows backwards once, with each page internally in held order.
Null means local exhaustion and certifies no daemon completeness.

One synchronous transaction selects the header, rows and relevant evidence from
one committed snapshot. Paging never calls the full reader or loads whole receipt
or gap membership arrays to discover its window. Only before-boundary admission
needs one additional order-only row read; contiguous replacement ordinals determine
local exhaustion without another payload decode. The shared `legacyHistoryCodec`
reuses record checks and validates selected row/contribution bindings and payload/index
associations. A page is never submitted as a shortened snapshot to
`parseChatHistorySnapshot`: complete receipt-union and whole-held-row validation
remain required for full snapshots. See [page failures](chat-history-results.md#bounded-page-results).

These methods add no IPC, preload or renderer capability. Full indexed storage and
collection import are active; page IPC, renderer activation and partial writers
remain #1931. The application-bound API continues below.

### Application-bound operations

[`src/main/index.ts`](../../../src/main/index.ts) registers one handler over one
store for the app lifetime, sharing the existing secure store and paired-server
store and one selected encryption adapter/database. Preload exposes
`window.pyry.chatHistory(request): Promise<ChatHistoryResult>`
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
Successful cleanup removes the list and every timeline/daemon-item record for that
`server` identity, including off-screen conversations absent from the latest list,
while preserving other hosts' equal conversation/item ids.

Conversation-scoped requests also capture a conversation generation at admission;
`replaceList` captures generations for every listed conversation. A removal attempt
that reaches storage and returns a result advances its conversation generation,
including on classified failure, so already-queued saves, reads and stale lists
cannot undo confirmed deletion. Host removal similarly advances host admission.
Fresh saved-host requests can intentionally replace content at identical host,
conversation and epoch strings. These process-local fences order admitted work;
the durable import-completion marker prevents retained-source replay after restart.
Successful conversation removal atomically deletes both families and its list
entry, retaining ordered peers and a saved-empty list when appropriate. Every
replacement remains full; omitting a conversation from a list alone never deletes
its saved snapshots.

Every request has `operation` and `serverId`. Additional fields are operation-specific:

| Operation | Additional fields | Effect |
| --- | --- | --- |
| `readList` | None | Read the host's ordered list snapshot. |
| `replaceList` | `snapshot` of kind `list` | Replace that list; omitted conversation records remain saved. |
| `readTimeline` | `conversationId` | Read only the addressed legacy timeline. |
| `replaceTimeline` | `conversationId`, `snapshot` of kind `timeline` | Replace only that legacy timeline in full, preserving supplied row order. |
| `readThread` | `conversationId` | Read the addressed daemon-item record in full for retained callers. |
| `openThreadPage` | `conversationId`, integer `limit` 1–200 | Select newest shown items plus active/dependency closure. |
| `newestThreadPage` | `conversationId`, integer `limit` 1–200 | Select newest held-item window. |
| `beforeThreadPage` | `conversationId`, integer `limit` 1–200, opaque `continuation` | Select preceding held-item window. |
| `replaceThread` | `conversationId`, `snapshot` of kind `daemon-items` | Replace only that held thread snapshot in full. |
| `mutateThread` | `conversationId`, `change` | Atomically apply validated owned facts/progress; preserve unowned items/evidence. |
| `removeConversation` | `conversationId` | Atomically remove both conversation formats and its entry from the host's saved list. |
| `removeServer` | None | Remove every snapshot for that host, including conversations absent from its latest list. |

Unknown request keys, malformed snapshots, a wrong snapshot kind, or mismatched
snapshot/request coordinates produce `invalid-request` before any record access.
Callers cannot supply a storage path or blob name. Snapshot schema extensions are
discarded on projection rather than rejected, except unknown fields inside held
daemon items, which remain inert JSON. Declared legacy tool `input` remains a
string-to-string map with its supplied keys.

Daemon validation requires nonnegative safe-integer item ids/revisions and progress,
unique held ids, checkpoint no greater than applied version, and ordered,
nonoverlapping ranges with valid endpoints. A declared repair starts at checkpoint
and cannot end below it; `uncommittedVersion` cannot exceed applied version but may
be at or below checkpoint. Optional `arrivalOrder` must be a complete permutation
of held ids, with no missing, duplicate, unknown or invalid ids. Optional
`olderAvailable` is boolean; omission remains absent. See
[unfinished-progress defaults](thread-item-store.md#repair-and-unfinished-batch-checkpoint-fences).

Held items validate id/kind/revision rather than full-add wire optional fields:
patch-produced nulls and unknown attribution/content fields must survive. JSON
copying preserves own `__proto__`/`constructor` keys as data, rejects non-JSON values,
cycles, nesting beyond 64 and more than 100,000 aggregate item JSON nodes, and uses
the existing string/array bounds. Invalid requests are classified before storage;
malformed saved metadata uses `unreadable`. Neither path replaces valid saved data,
and diagnostics remain static event/code values without content or coordinates.

`createChatHistoryWriter` requires `threads` and `lists`; it sends `mutateThread`
for owned authoritative changes and `replaceList` for received lists with a matching
host receipt. Full `replaceThread` remains available to retained callers/import.
Legacy timeline observations and
`replaceTimeline` submission are removed from the renderer. Hydration
is excluded from saves, and later received changes remain eligible. Confirmed
deletion clears that held scope and suppresses both saved formats; successful
unpair invalidates all that host's held threads and reads. See
[storage ordering](chat-history.md#storage-and-concurrency).

`readSavedTimeline` requires `threads`. Without explicit demand it requests
`openThreadPage`; demand selects `newestThreadPage` or `beforeThreadPage` with its
opaque continuation and optional paired recovery capability. Every request uses
limit 200. It returns `{ done, cancel }`;
`done` resolves to a static outcome used for local loading/retry. It admits only a
validated partial page at the exact requested host/conversation before completing
the store-owned read. Missing opening completes with null; saved-empty still
contributes metadata. Unexpected full stored results fail. A retried invalidated
opening uses the same bounded request, with no full-read fallback. The retained
legacy IPC/storage operations above and shared format admission remain outside
renderer writer/restorer paths.
`beginLocalRead(host, conversation)` refuses held scopes for opening.
`beginLocalRead(host, conversation, true)` explicitly admits a held-page read only
with an existing scope and no read already pending. Its one-shot complete/fail/cancel
handle uses a process-local token. A replacement read, explicit reset, replacement of a held epoch or scoped cleanup invalidates it, even
when identity strings are reused. Initial epoch admission and same-owner publication
preserve it. Validated partial saved results merge by revision and original arrival
order with same-epoch admitted facts, preserving saved progress obligations through
exact completion observations. Missing/failure cannot erase admitted facts, and
a different saved epoch cannot replace the admitted epoch. See
[store restoration rules](thread-item-store.md#snapshots-and-completed-batches).
Restoration sends no transport requests or raw events and certifies no progress.
The [thread runtime](thread-runtime.md#restore-recovery-and-cleanup) uses this
authoritative restore path in production, then resumes the coordinator with the
admitted epoch and complete checkpoint while saved rows remain visible. Sparse
arrival positions, continuation and recovery capability remain residency metadata;
the separately saved availability boundary cannot become new coverage or a hydration save.
