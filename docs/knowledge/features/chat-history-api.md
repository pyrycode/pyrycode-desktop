# Protected chat history — API and operations

Part of [Protected local chat history](chat-history.md). The fixed IPC surface and
main-process handler authorize saved-host operations independently of connection.

## API

[`src/shared/chatHistory.ts`](../../../src/shared/chatHistory.ts) defines
`ChatHistorySnapshot`, `ThreadSnapshot`, `ChatHistoryRequest` and
`ChatHistoryResult`, plus the pure `parseChatHistorySnapshot` and
`parseChatHistoryRequest` validators. Shared code imports no renderer implementation.
The [thread item store](thread-item-store.md) re-exports `ThreadSnapshot` from this
contract. `kind: 'daemon-items'` records contain `{ version: 1, serverId,
conversationId, thread }`; `thread.hostId` and `thread.conversationId` must match
the outer coordinates. The outer format version and held thread's applied version
are separate values. Shared snapshots admit only `list` and `daemon-items`.
`readTimeline`, `replaceTimeline` and bounded legacy page APIs, their request/result
types, `DurableThreadItem`, `legacyHistoryCodec` and `createIndexedLegacyHistory`
are removed. Retired requests return `invalid-request` before membership lookup
or storage access; shared snapshot admission rejects `kind: 'timeline'`.
Only the [protected collection importer](chat-history-storage.md#protected-collection)
recognizes old timeline envelopes and ignores their payloads. It supplies no IPC
ignore path, conversion or authoritative fallback.

[`createChatHistoryStore({ secureStore, encryption, database, log })`](../../../src/main/chatHistoryStore.ts)
returns `execute(request: unknown): Promise<ChatHistoryResult>` and async `close()`.
It owns serialized retained import, protected lists, authoritative indexed operations
and scoped cleanup of inert legacy records. `close()` stops new admission, drains
admitted work and closes the database; subsequent calls return `unreadable`. The composition root creates one
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

The backend retains a detached-callable Promise `execute` method and exposes a
main-only synchronous `executeSync` seam for enclosing list/thread/cleanup transactions.
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
This index remains for schema compatibility; no legacy page reader survives.
Schema 4 additively creates `thread_scopes`, `thread_records` and the
`thread_ranges` index, preserving legacy data and the receipt-start index. Its
idempotent creation also retains authoritative tables from the earlier schema-3
branch layout. Schema 5 adds `history_lists(server, payload)` and
`history_import(singleton, retired)`. List payloads are encrypted complete list
snapshots; decoding validates their exact host ownership. The singleton's presence
means import is complete; `retired: 0` means source cleanup is pending and
`retired: 1` means cleanup was recorded. Retained and inert legacy ownership uses exact UTF-16LE
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
conversion. List-only operations need not initiate this protected upgrade.

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

Schema 8 adds `history_save_parts(id, part, payload)` atomically with the first
split owned mutation. Its encrypted receipts bind persistence identity, protected
owner, exact scope/epoch/reset lifecycle and total parts, plus each accepted
request's digest; they contain no item content. The database owner admits version 8,
and conversion of another retained scope preserves it. Older executables reject
this schema rather than ignoring pending saves. Snapshot format version 1 and the
daemon wire contract are unchanged. See the independent obligation below.

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
the version-1 secure-store collection. Storage-only recognition validates each
version-1 timeline envelope's bounded ownership before ignoring its retired body.
Retained lists/items use shared snapshot admission; duplicate retained identities
reject the source. Addressed destinations are validated before importing only
missing lists/authoritative scopes. Existing indexed content wins regardless of
timestamps. Retained lists/items and completion commit together; no source I/O
occurs inside that transaction. An absent or legacy-only source also commits
completion. Failed import preserves the source and last committed records; later
queued work can retry. Schema admission may already have committed during the
completion check without importing content.

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
| `persistence?` | Internal split-save `{ id, part, parts }`: UUID-v4 identity, zero-based ordered part and fixed total, bound to the protected owner/lifecycle. Grants no daemon completion or reset authority. |

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

The renderer writer captures immutable detached owned changes in a linked queue per
host/conversation; it does not flatten or revalidate the accumulated backlog.
Capture may coalesce only an unstarted tail with distinct item ids and metadata,
with at most 32 combined items and ordered progress observations. Epoch/reset
admission, removals, ranges and repeated ids remain serial barriers. Started or
failed cursors are immutable; epoch/reset supersession drops the old queue without
rebuilding it.

Every submission contains at most **32 combined items, removals, ranges and progress
observations**, including its final metadata observation. Large changes emit removals,
then items, then ranges in their original order, using at most 31 data entries plus
neutral metadata per part. Original `priorProgress` follows in ordered groups of at
most 32 observations, then the original final metadata/completion/availability.
Neutral data prefixes retain the target version but claim checkpoint zero and no
completion, repair or unfinished progress. They cannot lower an already saved
checkpoint and therefore cannot establish persistence completeness on their own.
Each bounded request is parsed before IPC and independently admitted in main;
persistence-bearing requests exceeding 32 are rejected from raw array lengths
before decoding any item payload. Ordinary requests without these additive fields
retain their prior admission limits.

A change exceeding 32 units receives one UUID and a fixed part count computed from
array lengths when its generator starts. Main atomically commits the first data
prefix with a protected header obligation `{ id, next, parts }`, accepted-part
receipt and owner binding. Each following part must match that exact lifecycle and
expected sequence; skipped parts, changed replays, wrong totals and unrelated
mutations fail with `write-failed` without changing the prefix. Only the expected
last part clears that save's marker after its data and original progress are durable.
This local obligation is independent of daemon `completion`, `repair` and
`uncommittedVersion`: finishing persistence neither advances daemon progress nor
clears genuine repair/unfinished work without its original completion authority.

While the obligation is pending, `readThread`, `openThreadPage`, `newestThreadPage`
and `beforeThreadPage` return `unreadable` before traversal, including through a fresh
database owner. The durable prefix remains on disk. Exact retries can finish it;
reopening or reusing coordinate strings alone cannot. Accepted receipts survive
completion and scope deletion so old requests cannot gain authority over recreated
content. Exact accepted-part replays return success without folding progress again,
including a lost final acknowledgement replay while a newer save is pending.
Explicit authorized epoch/reset supersession, full replacement and deletion can
retire an abandoned obligation; full replacement rotates persistence ownership even
in the same epoch. Their internal validation may inspect the pending prefix, while
public reads stay closed. Stale endings cannot clear another save's marker.

The writer advances its retained request cursor only after successful durable
acknowledgement and a current queue/generation check. Failure preserves the exact
request and persistence identity; the failed key is suppressed for the rest of that
drain and waits for explicit `flush()` or a later received-event retry, with no
automatic retry loop.
Every submitted part, including a failed attempt, yields through a one-shot
`MessageChannel` task; both ports close before resumption. This real event-loop
boundary works even when renderer timers are paused; the normal 200 ms capture
debounce remains timer-controlled. A microtask would not prove native input liveness.

Confirmed deletion remains ordered behind admitted writes and suppresses queued
content for that exact host/conversation. Host removal pauses its queues until
settlement; success invalidates their generations, while failed unpair retains
eligible work. Late callbacks cannot advance a replacement queue or another host's
equal conversation id. `stop()` unsubscribes, waits for pending host-removal
settlement and flushes admitted work with the same bounds and finite failure policy.
Normal window/app teardown awaits that drain; repeatedly failed abandoned work
remains protected and unreadable rather than spinning or manufacturing completion.

After one-time conversion, mutation reads/decrypts only changed items and required
metadata/evidence, with fixed-width lookup and logarithmic sequence work. A protected
aggregate JSON-node count subtracts removed/revised old items and adds changed items;
exceeding the shared 100,000-node limit rolls back the transaction so retained
full/page readers remain coherent. Metadata replay touches the header with work
proportional to received observations, not saved history. Protection stays in main;
the renderer receives no SQL, filesystem, keys or ciphertext. Bounded reads return
only validated projections and opaque local continuations.

An ordinary `mutateThread` save executes through a resumable generator rather than
one synchronous pass, so the main process can still service native callbacks while
a large save is in flight. The work unit is one admitted item or removal, one
preparation entry (an old owner's row during an epoch/reset replacement — deleted
one at a time so the foreign-key cascade on the emptied scope cannot hide a
backlog), one range-traversal candidate or range start, one progress observation,
or one authenticated index row flush. `historyDatabase.ts`'s `transactionSteps`
drains the generator and awaits a turn callback every 16 units — `setImmediate` by
default, a real macrotask, so timers and native events run between batches.
`createChatHistoryStore`'s optional `onMutationTurn` hook overrides that callback;
only deterministic tests pass one, production code takes the default. Range
traversal stays lazy (`windowSteps`, one leaf at a time) and index flushing stays
incremental, so one incoming range merging many saved ranges, or a large pending
backlog, cannot shift the cost into another synchronous phase instead of shrinking it.

One `BEGIN IMMEDIATE` transaction stays open for the whole mutation across every
yield: `COMMIT` runs only once the generator completes, and any thrown error —
including one raised while suspended on a yield — rolls the transaction back, so
no partial submission becomes durable. Earlier acknowledged parts of a split save
remain durable, protected by the independent fail-closed obligation until completion.
Pending schema migrations still commit in their own synchronous transaction
immediately before the bounded one opens, never across a yield. The application store's queue holds the connection for the
mutation's entire promise, so no other admitted read, write, reset, removal or
close touches storage during a yield; `close()` seals admission and waits for the
queue before closing the native connection. There is no internal retry: a failed
mutation returns through the existing error result, and explicit resubmission,
including replaying a lost acknowledgement, is idempotent against the saved state.

A migration failure, or an open failure other than `unsupported-version`, on a
mutation now surfaces as `write-failed` rather than the `unreadable` the old fully
synchronous path returned; both are existing static codes the renderer only logs,
so this changes diagnostics rather than renderer-visible behavior.

Import, retained-format conversion (the one-time upgrade from positional to
sequence-indexed storage) and full-snapshot replacement (`replaceThread`) stay
fully synchronous. They are outside this bounded-execution claim and keep their
existing contracts. Renderer admission, compact transport and lazy presentation are
separate from the writer/storage liveness claim; see the
[native input/heartbeat proof](chat-history-testing-native.md#bounded-writer-native-input-proof).

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
Successful cleanup removes the list, authoritative records and ignored indexed
legacy data for that `server` identity, including off-screen conversations absent from the latest list,
while preserving other hosts' equal conversation/item ids.

Conversation-scoped requests also capture a conversation generation at admission;
`replaceList` captures generations for every listed conversation. A removal attempt
that reaches storage and returns a result advances its conversation generation,
including on classified failure, so already-queued saves, reads and stale lists
cannot undo confirmed deletion. Host removal similarly advances host admission.
Fresh saved-host requests can intentionally replace content at identical host,
conversation and epoch strings. These process-local fences order admitted work;
the durable import-completion marker prevents retained-source replay after restart.
Successful conversation removal atomically deletes authoritative and ignored legacy
data plus its list entry, retaining ordered peers and a saved-empty list when appropriate.
Ignored legacy cleanup uses exact UTF-16LE ownership and cascades without decrypting
or reconstructing retired payloads. Retained replacements remain full; omitting a
conversation from a list alone never deletes its saved snapshots.

Every request has `operation` and `serverId`. Additional fields are operation-specific:

| Operation | Additional fields | Effect |
| --- | --- | --- |
| `readList` | None | Read the host's ordered list snapshot. |
| `replaceList` | `snapshot` of kind `list` | Replace that list; omitted conversation records remain saved. |
| `readThread` | `conversationId` | Read the addressed daemon-item record in full for retained callers. |
| `openThreadPage` | `conversationId`, integer `limit` 1–200 | Select newest shown items plus active/dependency closure. |
| `newestThreadPage` | `conversationId`, integer `limit` 1–200 | Select newest held-item window. |
| `beforeThreadPage` | `conversationId`, integer `limit` 1–200, opaque `continuation` | Select preceding held-item window. |
| `replaceThread` | `conversationId`, `snapshot` of kind `daemon-items` | Replace only that held thread snapshot in full. |
| `mutateThread` | `conversationId`, `change` | Atomically apply validated owned facts/progress; preserve unowned items/evidence. |
| `removeConversation` | `conversationId` | Atomically remove authoritative and ignored legacy data and its entry from the host's saved list. |
| `removeServer` | None | Remove every snapshot for that host, including conversations absent from its latest list. |

Unknown request keys, malformed snapshots, a wrong snapshot kind, or mismatched
snapshot/request coordinates produce `invalid-request` before any record access.
Callers cannot supply a storage path or blob name. Snapshot schema extensions are
discarded on projection rather than rejected, except unknown fields inside held
daemon items, which remain inert JSON.

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
deletion clears that held scope and suppresses stale saved content; successful
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
opening uses the same bounded request, with no full-read fallback. Retired
timeline requests are rejected by the shared contract.
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
