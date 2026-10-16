# Protected local chat history

The main-process service stores ordered conversation lists, legacy timeline display
records and daemon-item snapshots in protected indexed SQLite storage, using the
same OS-backed protection as the [secure store](secure-store.md). A
fresh service instance can read saved content without a connection or Noise handshake. Host identity is the
saved pairing record's `server` field, so equal conversation ids on different
hosts remain separate.

The app records received lists and authoritative daemon-item snapshots automatically.
Saved lists restore into the sidebar on launch, including unavailable and
pairing-rejected hosts. Opening a saved chat reads only `daemon-items` on demand.
It never draws a saved legacy timeline. Offline display grants no network capability.
Once that host accepts `thread`, opening and reconnect resume from the saved epoch
and complete checkpoint. Older demand and Retry use the thread query coordinator.
See [production restore and recovery](thread-runtime.md#restore-recovery-and-cleanup).
Explicit Forget/Unpair removes the host's saved content after credential removal.
Confirmed conversation deletion removes both saved conversation formats
and that host/conversation's list entry.
Observing, saving, flushing and restoration create no lifecycle demand themselves.
Offline opening and scrolling retain the existing host-scoped request gates. Disk
retention is independent of the legacy holder's ten-conversation memory limit.

## API

See [API and operations](chat-history-api.md) for the fixed IPC contract, saved-host
authorization, removal ordering and supported operations.

## Snapshot contract

Every snapshot has `version: 1`, `serverId` and a `kind` of `list`, `timeline` or
`daemon-items`. Legacy timelines remain valid stored records for retained APIs and
cleanup, but the ordinary app never reads them for display. They never become
authoritative daemon items. Both formats may coexist at the same coordinates.
The legacy coverage, receipt and display contracts below describe retained formats
and producer/store behavior, not renderer persistence. The renderer no longer
observes or restores those timelines; shared admission is unchanged.

Legacy full operations use the unchanged `parseChatHistorySnapshot` admission and
allowlisted projection for full snapshots. Indexed disk reconstruction preserves
supplied held order, optional-field absence and all admitted evidence; equal or misleading timestamps
never reorder rows. Ownership remains exact and case-sensitive. SQLite coordinates
use UTF-16LE BLOBs for every lookup, enumeration, insert and removal: TEXT binding
would replace lone surrogates and merge distinct admitted JavaScript ids with U+FFFD.
See [migration limits](chat-history-api.md#api) for earlier TEXT keys.

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

A timeline adds `conversationId`, ordered `items`, `prependedRows` and `coverage`.
`prependedRows` is the nonnegative safe-integer count of inserted history rows,
also used by the legacy [row-key fallback](conversation-timeline-store-limits.md#edge-cases-and-limitations).
Coverage is either `{ status: 'unknown' }`, when no history page has been received,
or `{ status: 'received', cursor: string, atStart: boolean }`. The cursor is the
exact opaque cursor at the held oldest paging end, and `atStart` records the server's report
that this backwards walk reached its beginning. Newest responses preserve received
coverage; without it, they seed backwards paging. Empty cursor strings are valid. Successful
coverage stays separate from later pending or failed requests; row count alone
does not establish coverage or the beginning of history.

Restoration preserves this coverage, durable row order, optional identity metadata
and `prependedRows`, but initializes transient timeline state afresh. Saved coverage
records what was received previously, not the server's current history or freshness.
While offline, before the oldest saved row, the view shows “Older messages require
a connection.” unless coverage explicitly reports `atStart: true`; neither a short nor an empty
saved snapshot proves completeness. This notice sends no request.

The retained legacy holder keeps successful `ConversationSlice.coverage`
independently of transient `history`.
`HistoryRequestState` alone is insufficient: `markHistoryRequested` and
`recordHistoryFailure` replace its loaded cursor and `atStart`. A served page
updates rows before `recordHistoryPage` publishes successful settlement. Legacy
snapshot coverage describes the oldest paging end, not the newest response's
loaded cursor/start flag. A live-only timeline stays `unknown`,
and a successfully received empty page still establishes coverage.

### Served provenance and page suppression

Optional protected `gaps` records unresolved boundaries independently of receipts
and display contributions. Each gap has nonnegative safe-integer `newerId`, optional
`cursor` and optional `refusedCursors`; it has either `olderId` for a served-envelope hole or
`legacyRowKeys` for held display-only rows, never both. Legacy keys claim no envelope
ids or numeric hole. Optional `newestCursor` retains the latest received newest-page
origin separately from walked positions and oldest-end coverage.

Numeric gaps use nonnegative safe ids separated by at least one missing position.
Newest admission compares complete served ids with held high-water: overlap
containing it creates no tail marker; disjoint spans and older holes can create
one. First opening without evidence and adjacency create none. Skipped ids cover
their positions; timestamps and replay ids cannot establish gaps. Only complete
surviving served coverage connecting the boundaries retires a numeric gap.
Receipt expiry loses evidence, never proves completion; `gaps` can outlive `served`.

Parsing requires received coverage for `gaps` or `newestCursor`, sorted nonoverlapping
numeric boundaries and unique client gap identities. Legacy key arrays must be
nonempty, with unique signed safe integers referencing retained rows in chronological
order, using `rowIdentity` or the legacy fallback. Refused cursors must be unique bounded
strings; a declared resume cursor cannot also be refused. Arrays retain the
100,000-entry bound; cursors retain the string bound below, including valid empty
strings. Unknown fields are projected away; malformed declared metadata rejects
the snapshot. Invalidated cursors are omitted, never declared as `undefined`.
Older version-1 snapshots remain valid without these fields.

The first represented newest admission captures display-only restored keys before
draw and retains their boundary until provable overlap or a selected fresh backwards
`atStart`; held/newest completion cannot close it. Covered spans still need walking.
Refusal removes only the selected gap's resume cursor and remembers it; other gaps,
rows and oldest-end coverage survive. The retained format admits gap/newest-origin
evidence independently of row changes and preserves its identities. Replacement,
host removal and conversation clearing discard slice evidence; confirmed deletion removes its saved
record. Eviction drops memory evidence without deleting legacy disk records. See [reader demand and Retry](conversation-timeline-store-internals.md#the-opening-ask-1259).

Version-1 timelines optionally retain `served: { ids, highestId?, receipts }`.
`ids` is the sorted unique set of durable `HistoryEntry.id` values observed in
retained receipts; each receipt has its own sorted unique `ids`, exact opaque
`cursor` and boolean `atStart`. These are envelope ids, independent of message ids
and replay-ring `event_id`. Main validates every envelope and nonnegative safe-integer
id before payload decoding. Unsupported types and malformed/skipped payloads still
contribute their valid envelope ids; a malformed envelope or invalid id rejects
the whole page before any coverage advances. Only validated ids and typed drawable
events cross IPC; raw envelopes and skipped payloads stay in main.

Snapshot validation requires at least one receipt, `coverage.status: 'received'`,
and exact equality between `served.ids` and the receipt union. `highestId` must be
the maximum covered id, or absent when that union is empty. Holes remain unknown:
neither the maximum, timestamps, drawable ids nor row counts prove coverage.
An empty page retains an empty receipt, and an all-skipped page retains its ids;
both settle successfully. An empty receipt does not prove an empty conversation.
The pager's `coverage.cursor`/`atStart` may differ from the latest receipt: a newest
page retains its own complete receipt and updates retained high-water evidence
without replacing the oldest paging end or covering holes. A narrow
legacy event can advance successful paging without declaring served provenance.
It preserves known receipts rather than manufacturing a new empty receipt.
Older snapshots/events without `served` remain valid with unknown provenance.
Declared malformed metadata rejects the snapshot; unknown fields are projected away.

Runtime receipts form a bounded retention window: after moving an exact repeat
(same ids, cursor and start flag) to the newest position, `recordHistoryPage`
expires oldest whole receipts until both receipt count and aggregate receipt-id
count are at most 100,000. It rebuilds exact coverage and its maximum from the
survivors in the retained store. Exclusive evidence from expired receipts becomes
unknown; only independently retained display evidence can still suppress those
contributions. Display rows, row allocation and pager settlement are preserved.
One page exceeding the entire id bound clears all served
provenance while still allowing successful settlement.
Disk admission rejects oversized metadata rather than trimming it. Repeated spans
with changed cursors can exhaust the aggregate bound even with few distinct ids
and unchanged rows; bounding only unique coverage would eventually stop saving.

The legacy row-only bridge suppresses ordinary rows for a fully covered nonempty
page. The mounted contribution path instead admits typed entries against retained
`display`, even when every served id is known: a receipt-only snapshot may lack
the contribution needed to finish a reply. Both paths record exact cursor/start
and collect lifecycle evidence from the original page. Served coverage never
proves display retention.

### Retained display contributions

Version-1 timelines optionally carry sorted `display: HistoryContribution[]`,
independent of `served`. Each contribution has a nonnegative safe-integer durable
`id`, an optional bounded `joinKey` (`type` plus timestamp), and an optional surviving
client `rowKey`. Its operation is a durable `row` with an allowlisted `item`, a
tool-result/denial `patch`, or an explicitly `suppressed` contribution. Assistant
items retain fragment text rather than whole replies or raw envelopes. Suppressed
operator contributions reference the surviving message-id row; these references
remain chronological anchors and text barriers.

Rows must reference a retained `rowIdentity` key and agree with its row kind and
turn, tool, message or parent identity as applicable. Patches may remain unbound
until their call arrives; a bound patch must reference that call's tool identity.
Denials require nonempty `turnId` and `toolUseId` and matching retained-call turn
correlation. Declared patch sources must match the operation: `toolResult` for a
result, `toolDenied` for a denial. Both cross-source mismatches reject the snapshot;
omitting the source remains valid. Otherwise a restored denial could falsely
suppress a later live result sharing its timestamp.

Declared ids/ranges must be strictly increasing and nonoverlapping. A `lastId`
range is inclusive, belongs only to an assistant-text row and carries no join key.
The parser applies the existing array, string and map bounds, allows only known
join sources and nonempty timestamp suffixes of at most 64 characters, and rejects
malformed declared operations or row references. Unknown fields are projected
away. Permissions, questions, attachment offers, terminal metrics and transient
live state cannot enter this metadata.

`reconcileHistory` admits unseen contributions in durable-id order regardless of
receipt coverage, joins adjacent matching turn/parent text and retains orphan
patches for a later call. Protected writes and fresh reads preserve these joins
and surviving row keys. Absence of `display` in older version-1 data, including
receipt-only snapshots, means unknown display provenance: keep the saved rows,
without inferring entry ids or completeness from timestamps or row counts.

Validated live/replayed `history_entry_id` now uses this same protected `display`
contract. A display-changing live fold retains the entry's typed `row` or `patch`
operation and surviving row key, including each delta's own fragment. Saving only
a row reference or the accumulated bubble would lose fragment order when history
later fills a missing delta between live entries. Tool results/denials retain their
patch identity; no-op, orphan and ID-less folds supply no new row-bound target.
Fresh protected restoration preserves this identity without a schema migration.

Non-row display changes carry only transient `displayStateId`; it can advance a
read observation after the corresponding display commits with an identified newest
message visible. It and unconfirmed read commands never enter a saved snapshot.
Older snapshots without contributions retain unknown identity. ID-less replay is
never assigned an ID by looking it up in history: an independently admitted newest
page establishes its own retained display target. Open/reconnect newest requests
and trusted reader-driven backwards/gap paging remain unchanged, without recovery
fetches or loops. Receipt high-water alone cannot mark content read. See
[committed-tail observation](conversation-last-read-store.md#how-it-works).

Legacy runtime retention is bounded at 100,000 contributions.
At saturation, consecutive retained assistant fragments for the same row compact
into an `id`/`lastId` range; only contiguous contributed ids qualify, never gaps
filled from receipts. Compaction drops timestamp evidence, keeping reverse live
suppression conservative. If still oversized, represented groups retire to
unknown provenance while their rows survive; unresolved calls/patches remain
while capacity permits, with a final bounded tail ensuring later saves stay valid.
Receipt expiry alone never retires display evidence. See
[reconciliation and held-row boundaries](conversation-timeline-store-internals.md#the-page-half--the-join).

### Protected row identities and saving

Optional `rowIdentity: { rowKeys, nextRowKey }` preserves client-owned allocation
through protected saving and restoration. Keys are unique signed safe integers
aligned one-to-one with durable `items`.
`nextRowKey` must exceed every retained key and
leave headroom for 100,000 rows plus one placement reservation
(`<= Number.MAX_SAFE_INTEGER - 100_001`). A safe integer alone is insufficient.
Restoration installs supplied keys and allocator unchanged; retained receipts
continue suppressing covered repeats after restart. Legacy snapshots use
index-minus-`prependedRows` keys and the corresponding next-key fallback.
Later appends/prepends allocate fresh identities without reordering retained rows.
Cancelling an echo removes its row but leaves its identity consumed: unchanged
durable content does not imply whole-snapshot equality or permit allocator rewind.

Protected restoration keeps oldest-end coverage beside newest receipts, high-water,
display evidence and row identities. Legacy display-only rows imply no entry ids or
completeness. Settled saved presentation survives newest pending/admission/failure;
clearing it on demand would make a partial saved assistant appear to stream.

These legacy metadata fields remain admitted by the shared parser and storage
APIs, but changes to rows, receipts, gaps, contributions or allocation no longer
schedule renderer saves. Legacy local-read store admission remains independently
testable; production restoration admits only daemon-item snapshots.

### Durable display rows

`DurableThreadItem` retains the display fields of every current
[`ThreadItem`](../../../src/renderer/src/store/threadTimeline.ts) variant except two live-only
carve-outs: `turnBoundary`'s six `TurnEndMetrics` fields (duration, token counts, the session's
running cost — [#1565](https://github.com/pyrycode/pyrycode-desktop/issues/1565)) are dropped
field-by-field, so a reload never restores them; `attachmentOffer`
([#1621](https://github.com/pyrycode/pyrycode-desktop/issues/1621), a file the assistant sent, see
[Conversation shell § The assistant-offered file row](conversation-shell-message-bubble-attachments.md#the-assistant-offered-file-row-1621))
is excluded from the retained shared format: the on-disk parser in
`src/shared/chatHistory.ts` has no arm for it. `chatHistoryContract.test.ts` pins
`DurableThreadItem` equal to `ThreadItem` minus both carve-outs. This is a retained
format/type contract; the renderer writer no longer filters or captures legacy
rows. In this table, `?` marks an optional field, and `attachmentOffer` has no row
at all:

| Row kind | Retained fields beyond `kind` |
| --- | --- |
| `assistantText` | `turnId`, `text`, `createdAt?`, `parentToolUseId?` |
| `userText` | `text`, `createdAt?`, `messageId?`, `attachments?` containing `attachmentId` and `filename` |
| `toolCall` | `turnId`, `toolUseId`, `parentToolUseId?`, `name`, `inputSummary`, `input?`, `result`, `denial?`, `elapsedSeconds?` |
| `turnBoundary` | `turnId`, `stopReason`, `outcome?`, `isError?`, `terminalReason?`, `errorCategory?` |
| `sessionBoundary` | `reason` (`clear`, `idle_evict` or `workspace_change`), nullable `workspaceCwd`, `occurredAt` |
| `unrecognizedMessage` | `site` (`line_type`, `assistant_block`, `user_block`, `undecodable`, `codex_method` or `codex_item`), `messageType`, `raw`, `truncated` |
| `compactionBoundary` | `failed`, `manual`, nullable optional `preTokens?` and `postTokens?` |
| `banner` | `level`, `text`, `stopsTurn`, `truncated` |
| `modelRefusal` | `refusal`, containing the shared `ModelRefusalEvent` report |

Assistant `parentToolUseId` survives saving and restoring with its Agent/Task owner,
so [grouping](conversation-shell-tool-row-header-groups.md#subagent-tool-groups) is
recomputed from the restored rows. Version 1 is unchanged: older snapshots without
the field remain readable and render parentless replies as before. The `threadItem`
parser validates a supplied parent with the bounded `id` parser, just like tool
attribution; `null`, non-strings and values over 8,192 UTF-16 code units reject with
`INVALID_CHAT_HISTORY`. Unlike wire normalization, saved empty strings remain valid
id data and establish no owner. The hint grants no authority and never becomes a path.

Tool `result` is `null` or `{ isError, resultSummary, resultDetail? }`. Optional
`denial` retains `toolName`, `decisionReasonType`, `decisionReason`, `message`,
`truncatedFields` and `droppedFields`; the last two are string arrays or `null`.
Refusal reports retain `type`, `originalModel`, `refusalCategory`, `banner`,
`truncatedFields` and `droppedFields`, plus `fallbackModel` and `scope` for
`modelRefusalFallback`. `modelRefusalNoFallback` has no fallback fields.

For legacy display rows, only declared schema fields are persisted and returned,
including nested records.
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

### Bounded local-page evidence

The indexed backend's [main-only page methods](chat-history-api.md#main-only-bounded-legacy-pages)
return selected rows and their evidence separately from the full snapshot contract.
`savedCoverage` is the saved scope's oldest-end coverage; optional `newestCursor`
retains its saved origin. Neither is recalculated from the selected row count.
A short/empty local page or `continuation: null` establishes no daemon completeness,
freshness or new coverage. Optional evidence absent in the snapshot remains absent;
a present evidence field can project to an empty array.

`display` includes committed contributions bound to the selected row keys. Their
inclusive `id`/`lastId` ranges select existing `servedIds` and receipt memberships;
display-only rows never acquire invented served ids. Each receipt projection keeps
its original snapshot ordinal as `identity`, original receipt order, selected
membership order, cursor and `atStart`, and explicitly carries `partial: true`.
Omitted memberships and receipts remain unknown. These projections cannot replace
the complete receipt union required by full-snapshot admission.

`gaps` includes numeric gaps intersecting those contribution ranges inclusively,
so both gaps survive when a selected id is their shared boundary. Legacy gaps
retain only memberships for selected keys in their original order. Each projection
keeps its snapshot ordinal `identity` and `partial: true`; it omits unselected
memberships and all `refusedCursors`. Absence from a page does not retire saved gaps
or promote omitted facts to known coverage.

Necessary adjacent cursors appear separately in
`cursorAnchors: { receiptIdentity, id, cursor, atStart }[]`. For each selected gap,
selection uses the nearest receipt whose first membership is at or after its
`newerId`, breaking ties by receipt ordinal and deduplicating receipts. It does
not collect every cursor from intersecting spans. Anchor ids alone never become
selected served ids or receipt memberships, and their start flags certify no
additional completeness. See [selected-record validation and protection](chat-history-results.md#bounded-page-results)
and [bounded-work fixtures](chat-history-testing.md#bounded-legacy-page-regressions).

### Received-state admission and ownership

[`useChatHistoryWriter`](../../../src/renderer/src/store/chatHistoryWriter.ts)
mounts once from [`App`](app-shell.md#where-the-daemon-bridge-lives) across routes.
`createChatHistoryWriter` requires `threads` and `lists`; production supplies
`threadRuntime.items` and `conversationListStore`. It observes only received lists
and authoritative item snapshots, submitting `replaceList` and `replaceThread`.
It has no legacy timeline subscription, receipt/row-key/echo observation,
`replaceTimeline` path or timeline-frame flush hook. Legacy renderer producers and
their direct store/bridge tests remain; main, preload, shared format admission,
indexed reconstruction and legacy storage APIs remain valid for other consumers.
Producer retirement belongs to #2030 and saved-format retirement to #2026.

List admission still requires preload's synchronous `conversationsReceived` receipt
with a string `serverId`, and a changed `byServer` array for that exact host.
The [receipt context](daemon-event-channel-plumbing.md#3-the-preload-subscription-srcpreloadindexts)
is restored in `finally`; active selection cannot establish ownership.
Read pushes update attention immediately but do not themselves save a list; a later
received list captures the reconciled read marks. Startup state, local list
restoration and clears schedule no list write.

Item ownership comes from the authoritative store's host/conversation scope.
The writer compares immutable snapshot references and skips the private `restored`
identity so hydration schedules no save. Later authoritative changes remain
saveable, preserving complete checkpoints, certified ranges, repair and unfinished
batch fences exactly as held. Projection through `parseChatHistorySnapshot`
detaches coordinates and content synchronously before scheduling.
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
keeps its runtime name but requires `threads` and always requests `readThread`.
It accepts stored results only of kind `daemon-items` with the exact requested
host and conversation. Wrong kinds/coordinates, unexpected results, classified
errors and rejected IPC fail the current handle without importing data; missing
records complete it with null. There is no `readTimeline` fallback.

`threadRuntime.restore` invokes this reader, which opens the store-owned
`beginLocalRead(host, conversation)` handle and returns `{ done, cancel }`.
Held scopes prevent duplicate reads.
Process-local tokens fence delayed completion and failure after cancellation,
replacement reads, live admission, epoch replacement or conversation/host/global
clear, even if coordinate or epoch strings are reused. Hydration certifies no new
progress. Restoration creates no transport request or raw event; opening, reconnect,
older demand and Retry use the [thread coordinator](thread-runtime.md#restore-recovery-and-cleanup)
and introduce no legacy content request.

Confirmed `conversationDeleted` delivery queues `removeConversation` using its
main-stamped host and confirmed id, even without a held scope or list entry.
Missing host origin reports `unknown-ownership` and never borrows selection.
The writer clears that authoritative scope and cancels its local read, removes
buffered item content, filters delayed list captures and suppresses later item
captures for that host/id. The ordered backend operation removes both saved
conversation formats and the list entry. Other hosts' equal ids and same-host peers
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

- Id fields use `MAX_SERVER_ID_LENGTH` (currently 8,192 UTF-16 code units),
  including server, conversation, turn, tool-use, message and attachment ids.
  Empty ids and path-like strings are valid data; host membership still requires
  exact equality with a saved `server` identity.
- Other strings, including cursors and tool-input keys/values, allow at most
  `16 * 1024 * 1024` UTF-16 code units (`string.length`, not a byte-size limit).
- Snapshot arrays allow at most 100,000 entries each; tool-input maps allow at
  most 100,000 entries. Numbers must be finite; `prependedRows` additionally must
  be a nonnegative safe integer.

These limits govern individual admitted records, including the aggregate receipt-id
bound above. Receipt expiration does not evict durable display rows. There is no
ten-chat disk cap, automatic snapshot eviction, total disk-size bound or
history-download policy.

## Results and failure preservation

See [results and failure preservation](chat-history-results.md#results-and-failure-preservation)
for saved-read notices, result/error classifications and preservation after failed writes or removal.

## Storage and concurrency

Production `createChatHistoryStore` composes the indexed legacy and authoritative
backends with protected list cells and schema-6 authoritative payloads. One
main-process database owner lazily opens a reusable synchronous connection at
`history/history.sqlite` beneath
trusted `userDataPath`. The composition root retains it across window reopening;
graceful app quit flushes renderers, drains handler/store admission and closes it.
Directory creation uses mode 0700 and the database is set to 0600. Reads and
mutations run synchronously within transactions; secure-store I/O is outside them.
See [schema admission and migration](chat-history-api.md#api).

First access validates the complete encrypted version-1 `chat-history` source and
imports missing lists and both snapshot families in one transaction with a durable
completion marker. Existing indexed records win regardless of timestamps. Legacy
rows stay legacy; parser-normalized order, optional absence and saved evidence
survive. A failure before commit leaves no partial import or completion marker.
After completion, no operation reopens/decrypts the source: timeline/thread reads
select their family and list reads decode only their protected list cell.

Source retirement has a separate durable flag. Cleanup retries delete the fixed
source directly without replaying it, so a retained source cannot overwrite newer
records or resurrect deletions after restart or identity reuse. Conversation
removal commits both families and the saved list entry together; host removal
includes off-screen scopes. Handler host/conversation generations reject stale
queued work while fresh authorized replacements may reuse identical coordinates.
The [storage reference](chat-history-storage.md#protected-collection) details queues,
retirement failure and credential-first unpair ordering.

Each committed legacy scope has separately encrypted records for held rows, served ids,
ordered receipts and their individual id memberships, display contributions and
row associations, gaps, legacy gap-key memberships and refused cursors. The encrypted
header retains scope coverage, newest cursor, optional-evidence presence, allocator
and prepended count independently of those records. Plain numeric indexes support
bounded page selection without a whole-timeline or all-evidence cell. Full
reconstruction returns one committed snapshot and checks its records against
canonical parser output.

Authoritative scopes separately protect header metadata, item placements, stable
item payloads and ranges, including first-arrival and containing-range associations.
Payload lookup uses stable owner/item id; protected placements bind the exact
ciphertext digest and current generation. Binding placements only to the stable
owner would allow older placement/evidence replay. Schema-5 conversion validates
all authoritative scopes atomically and preserves old continuations; ordinary
schema-6 pages perform no conversion scan. See
[storage bindings and migration](chat-history-api.md#api).
Lists remain complete protected cells. Both full readers preserve exact supplied
ownership and content; neither family converts into the other.

Every replacement, including identical or empty content, rotates its continuation
identity. Legacy scopes use a fresh snapshot UUID; authoritative scopes retain
their owner and rotate a protected generation, reusing unchanged same-epoch item
ciphertext. Delete/recreate receives fresh ownership; deletion cascades to all
evidence and payloads. These identities are not authorization. Payload protection
and reviewed structural columns are detailed in
[failure preservation](chat-history-results.md#results-and-failure-preservation).

The adapter is pinned to `better-sqlite3` 12.4.1. Host Node and Electron require
separate native rebuilds; packaging rebuilds for the target ABI and unpacks the
adapter from asar. See [runtime preparation and counted native proof](chat-history-testing.md#native-runtime-and-packaged-proof).
Windows NSIS x64/arm64 targets remain configured; these smokes add no Linux/macOS
release channel. Bounded legacy and authoritative pages remain callable main-only.
Owned incremental writes remain #2044; partial restoration/navigation remain
\#2041/#2042 under #1931, with no renderer page IPC added by the binding migration.
Production reads and replacements still use complete snapshots.

## Testing

See [the testing reference](chat-history-testing.md) for writer admission,
restoration, removal, protected persistence and durable-contract coverage.
Authoritative cache tests retain shutdown, restart and checkpoint coverage.
When seeding a protected snapshot,
wait for the opening page's buffered save first or it can overwrite the seed.
