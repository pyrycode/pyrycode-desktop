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
Each actual connected opening and owning-host reconnect requests one newest page
after owned read/request settlement. Offline opening waits for connection; opening
never fills the missing range. Served and legacy gaps retain reader-driven markers
and resume positions; older pages require trusted upward thread input;
a retryable failed page has a Retry action. Explicit Forget/Unpair removes the host's saved content after credential removal.
Confirmed conversation deletion removes that host/conversation's saved timeline
and list entry.
Observing, saving, flushing and restoration create no lifecycle demand themselves.
Offline opening and scrolling retain the existing host-scoped request gates. Disk
retention is independent of the renderer holder's ten-conversation memory limit.

## API

See [API and operations](chat-history-api.md) for the fixed IPC contract, saved-host
authorization, removal ordering and supported operations.

## Snapshot contract

Every snapshot has `version: 1`, `serverId` and a `kind` of `list` or `timeline`.
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

The holder retains successful `ConversationSlice.coverage` independently of transient
`history`; the writer also retains it beside each observed timeline.
`HistoryRequestState` alone is insufficient: `markHistoryRequested` and
`recordHistoryFailure` replace its loaded cursor and `atStart`. A served page
updates rows before `recordHistoryPage` publishes successful settlement. The writer
captures `slice.coverage`, not the newest response's loaded cursor/start flag:
using the latter would lose the oldest paging end on restart. A live-only timeline stays `unknown`,
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
rows and oldest-end coverage survive. The writer compares gaps and newest-origin
evidence even when rows are unchanged. Protected restoration retains this evidence
and identities, resetting pending/failure state. Replacement, host removal and
conversation clearing discard slice evidence; confirmed deletion removes its saved
record. Eviction drops memory evidence while buffered saves/disk records remain
for an owned fresh read. See [reader demand and Retry](conversation-timeline-store-internals.md#the-opening-ask-1259).

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
survivors before writer capture. Exclusive evidence from expired receipts becomes
unknown; only independently retained display evidence can still suppress those
contributions. Display rows, row allocation and pager settlement are preserved.
One page exceeding the entire id bound clears all served
provenance while still allowing successful settlement and later content saves.
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

Runtime retention is bounded at 100,000 contributions before writer capture.
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
aligned one-to-one with durable `items`. The writer filters keys with the same
durable-row predicate as rows, while retaining the allocator beyond omitted live-only
rows and placement reservations. `nextRowKey` must exceed every retained key and
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

The writer observes served, display and gap changes even when row references are unchanged;
contribution, receipt/cursor/start, gap-resume and allocator changes participate in canonical snapshot
comparison and saving. Contribution row references are filtered to the same retained
durable keys as snapshot items. Restoration itself still schedules no save and restores
no live phase, pending send, permission or recovery state. Metadata inherits
[received-host ownership and removal](#received-state-admission-and-ownership);
content, ids and cursors never enter diagnostics.

### Durable display rows

`DurableThreadItem` retains the display fields of every current
[`ThreadItem`](../../../src/renderer/src/store/threadTimeline.ts) variant except two live-only
carve-outs: `turnBoundary`'s six `TurnEndMetrics` fields (duration, token counts, the session's
running cost — [#1565](https://github.com/pyrycode/pyrycode-desktop/issues/1565)) are dropped
field-by-field, so a reload never restores them; `attachmentOffer`
([#1621](https://github.com/pyrycode/pyrycode-desktop/issues/1621), a file the assistant sent, see
[Conversation shell § The assistant-offered file row](conversation-shell-message-bubble-attachments.md#the-assistant-offered-file-row-1621))
is dropped whole — the report is live-only with no wire replay, so `chatHistoryWriter.ts`'s
`isDurable` type guard filters the kind out of the timeline's `items` before capture, and the on-disk
parser in `src/shared/chatHistory.ts` has no arm for it. `chatHistoryContract.test.ts` pins
`DurableThreadItem` equal to `ThreadItem` minus both carve-outs, so a future live-only `ThreadItem`
kind that skips narrowing that type and adding a writer filter fails the type check rather than
silently reaching disk. In this table, `?` marks an optional field, and `attachmentOffer` has no row
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

`PairedShell` retains `createNewestHistoryDemand` across effect replay. Each actual
opening of a connected host/conversation asks once with `cursor: ''` and
`HISTORY_PAGE_LIMIT = 200`, regardless of held backwards `atStart`. Leaving and
returning creates a new opening; re-clicks, renders, metadata refresh and effect
replay do not. Offline opening sends nothing; the first connected transition and
each later owning-host connection edge ask once for the still-open target.

Lifecycle demand waits for its owned saved read (stored, missing, failed or
superseded by live data) and any outstanding same-host request. Departure, host
replacement or connection loss invalidates a delayed ask. Main settles an
interrupted request before reconnect's newest ask. Read/page settlement releases
only existing demand; it never creates another opening or an automatic range fill.
The controller consumes demand before marking pending to prevent subscription replay;
shell eligibility checks run after admission/writer capture, while connection loss
is observed synchronously so rapid connection edges survive.

Backwards downloads require trusted upward wheel/trackpad input over the thread, or
ArrowUp/PageUp/Home with the thread itself focused. A visible gap marker
between the measured header/input overlays takes priority, choosing the first
boundary encountered from newer toward older rows. Without one, the current offset must be
within the near-top band — two viewport heights, scaled by the thread's own measured
height — before that input scrolls. Input outside
the band only scrolls locally; entering the band needs another qualifying input.
The same focusable region contains empty and short threads, so first-page demand
does not depend on overflow. Composer navigation, synthetic events, ordinary
scroll events, mounting, resize, bottom pinning and prepend compensation create no
backwards demand.

`requestOlderHistory` reads successful coverage at demand time: unknown coverage
uses `cursor: ''`, while received coverage uses the exact oldest-end cursor,
including one restored from disk. Only `atStart: true` establishes completion;
short, empty and all-undrawable pages do not. One request may be outstanding per
host/conversation, shared by newest, older, gap and Retry. Backwards demand during a
local read or pending request is discarded; lifecycle demand defers instead.
Remaining in the band
after a response also requires new input. There is no timer or automatic walk.

Requests and failures retain same-host rows, prepend metadata and successful
coverage. Pending/failed history retains the requested cursor and purpose (`older`,
`newest`, `gap` or `gap-newest`), plus the selected gap's client identity. Main clears
outstanding history correlations before emitting classified
failure events on connection drop, terminal/error, pairing rejection or explicit
redial, including when no server failure reply arrived. Unavailable/build/send
failures also settle immediately. This releases pending state without retrying:
new qualifying upward input while connected can ask again for an oldest-end page
even when its failure classification is nonretryable. Ordinary gap failures wait
for Retry; `history-invalid-cursor` has no Retry but permits fresh reader input
to use a usable newest origin or acquire one page for that gap. Acquisition and
arrival never continue the walk automatically. Unrelated gaps remain eligible.
The separate [composer Retry action](conversation-shell-composer-status.md#history-page-failure-and-retry)
requires `retryable: true`, the displayed conversation and its connected owning host,
and the same held failure at activation. It calls `requestHistoryPage` with the
captured cursor/purpose and `limit: 200`; newest Retry resends `''` despite held
`atStart`. Gap Retry additionally requires that the captured failed gap still
exists, and also bypasses oldest-end completion. Legacy failures fall back to
backwards coverage. Pending state removes the failure affordance and rejects
duplicate demand without changing rows or successful coverage. A partial history walk
retains its oldest-end cursor through newest refreshes. Offline scrolling only exposes held
content. Host-stamped requests cannot borrow another host's cursor, and stale
cross-host failures cannot settle its replacement slice.

Owned page admission supersedes a loading saved read and clears its token, including
empty/all-undrawable and legacy settlement. Late stored/missing completion, failure
or cancellation cannot replace admitted rows or evidence. Starting, settling or
cancelling a saved read preserves an independently correlated same-host request;
otherwise reopening could send a duplicate that main ignores and consume its one refresh.

The retained [contribution join](conversation-timeline-store-internals.md#the-page-half--the-join)
admits overlap and split assistant turns once in chronological order, preserving
held live/saved rows, surviving row keys and tool expansion. Existing following
and parked-reader behavior remains. [Scroll compensation](conversation-shell-scroll-pin.md#user-demand-and-prepend-position)
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
snapshot and exact coordinates, then admits it only while its process-local
`localReadOwner` symbol, host and loading status still match. Same-host session-error
replacement/clearing preserves ownership even though the slice object changes;
opening and settlement retain the current live notice rather than restoring one
from disk or the original pending object. Live content, local sends, host replacement,
clear, eviction and cancellation invalidate late success and failure. Settled handles
cannot settle twice. See [notice/read interaction](conversation-timeline-store.md#edge-cases-and-limitations).
Opening eleven saved chats and reopening the first therefore reads it again from
disk without increasing the memory bound.

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
during `conversationsReceived`, preserving received order and reconciled read fields.
Read pushes patch held attention immediately but do not themselves write history; a later list
reply captures the monotonic held mark. Timeline updates folded
during daemon delivery use that receipt's origin, never the active host at save time.

Outside daemon delivery, these local edits qualify:

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
- Evidence-only gap/newest-cursor changes with unchanged rows and an established
  matching stamped owner, including explicit owned restoration. Refusal changes
  durable evidence without changing content; requiring a receipt would lose its
  invalidation on restart. Such changes cannot establish ownership from renderer
  state and retain the writer's list-claim checks.

Timeline slices are keyed only by conversation id, so the writer pins an owner
while each slice is held. Explicit main-stamped receipts establish the supplying
host independently of other hosts' equal-id list claims. Active selection never
establishes ownership. Missing receipt origin and ambiguous unstamped echoes
refuse recording with `unknown-ownership`, preserving existing saved copies.

Clean received host replacement requires an explicitly stamped previous host
different from the receipt origin and a new slice stamp matching that origin.
`receivedSlice` clears rows, coverage and served receipts on this transition; the writer releases
the old observation and comparison metadata before admitting the new owner.
Removing only the list-claim check would leave the old observation blocking this
replacement. Previously captured snapshots stay detached and buffered by host,
kind and conversation, so alternation before a flush cannot transfer rows or
coverage between hosts.

A new stamp on previously unowned content is insufficient: the store retains
those rows. A later receipt cannot repair an unknown observation while that
content remains held. Clearing/evicting the slice releases its observation
metadata; explicit saved restoration is a separate admission path. Main
independently checks saved-host membership again.

Startup-empty state, activation, direct snapshot installation, list/holder clears
and memory eviction are not deletion signals. Directly installed nonempty rows
in a timeline have no observed owner and cannot establish one by later live delivery.
Both list and timeline restoration use explicit handles, outside live reducers.
The writer recognizes a newly admitted `restored` marker before receipt checks,
adopting its host and coverage without scheduling a save. Starting a local read
clears prior observation/comparison metadata. Reconnect and metadata-only list refresh
do not reset restored ownership. A later stamped same-host received change
continues recording under that owner with the restored coverage, including when
both hosts' lists claim the id. Clean received host replacement uses the clearing
transition above; retained unknown rows remain refused.
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

These limits govern individual admitted records, including the aggregate receipt-id
bound above. Receipt expiration does not evict durable display rows. There is no
ten-chat disk cap, automatic snapshot eviction, total collection-size bound or
history-download policy.

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

## Testing

See [the testing reference](chat-history-testing.md) for writer admission,
restoration, removal, protected persistence and durable-contract coverage.
