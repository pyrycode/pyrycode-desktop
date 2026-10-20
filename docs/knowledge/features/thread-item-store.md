# Retained daemon thread items

`createThreadItemStore` in
[`threadItemStore.ts`](../../../src/renderer/src/store/threadItemStore.ts) retains
decoded daemon facts for rendering, sync and cache consumers. The vanilla factory
stays independent of React and transport. The app-lifetime
[thread runtime](thread-runtime.md) owns its production instance and subscriptions.
Every paired conversation uses these items rather than reconstructing rows through
`reduceTimeline`, timestamp matching, receipt reconciliation or roster inference.

The input types are `ThreadItem` and `ThreadUpdate` from `src/shared/wire/thread.ts`;
[main's thread receiver](inbound-message-decode-limits.md#complete-live-thread-validation)
owns wire validation and complete logical-update assembly.

These are complete-route semantics. Explicit `compact-v1` selection uses the
[session-only compact owner](thread-runtime.md#explicit-compact-projection), whose
roots sort by `(order, id)` and whose root coverage/checkpoint/consumed progress
are independent of this store. Tool/agent headers and body/child replies never
become complete items, owned saves, complete-history certificates or unseen-content
read authority. Saved complete checkpoints cannot authorize compact resume.
[ADR 0016](../decisions/0016-session-only-compact-projection.md) records why headers
were kept out of canonical storage. Production opening uses the owning host's
accepted handshake to select compact automatically; omitted runtime options
retain complete delivery.

## Identity, placement and full items

Nested Maps scope state by host then conversation; daemon item ids are unique only
inside that conversation's accepted epoch. Equal conversation/item ids on another
host share no state. Changes publish immutable scoped snapshots while untouched
conversations retain reference identity. `snapshot(hostId, conversationId)` returns
`null` when absent, distinct from an accepted epoch with an empty item list.

Items sort by supplied numeric `order` alone. Unordered items stay at the tail;
equal orders and unordered ties keep first-arrival order. Updating an existing id
does not reset its arrival position, but supplying its order moves it to that
position. Hidden items, parents, recorded session/agent/turn attribution and unknown
kind/status/content/fields remain held. `shown` and `active` are independent supplied
facts, never inferred from status. Active items and parents outside loaded ranges
do not establish additional history coverage.

Snapshots emit immutable `arrivalOrder` ids separately from display-sorted `items`.
Hydration rebuilds Map insertion order from that complete permutation while keeping
supplied held item order unchanged. Saving only display order would change later
ties: A arriving at order 20 before B at 10 displays `[B,A]`, but changing A to 10
must yield `[A,B]`, including after restart. Null-cleared orders retain the same
first-arrival rule. Older snapshots without this metadata use supplied item order
because their original arrival order is unavailable. Declared metadata with missing,
duplicate, unknown or invalid ids is rejected.

Full live additions and `batch.applyItems(items, version)` use each item's `rev`,
independently of reply arrival time or conversation version. A newer revision
replaces the whole held item, removing omitted optional fields; equal/older
revisions preserve held content, except strict text-only prefix growth at the same revision with every other field equal. A kind conflict requests repair even when the
incoming revision is older. A delayed reply cannot roll back newer live content,
and receiving an older item cannot regress the held conversation version.

The supplied `ThreadItemsTimeline` task controls project these snapshots through
[`threadTaskPresentations`](../../../src/renderer/src/screens/conversation/threadTaskPresentation.ts),
without writing to the legacy roster store. Only shown task-linked `agent` and
`tool_call` items establish panel membership: usable nonempty `content.task_id` and
`content.tool_use_id` must match saved `task_id`/`tool_call_id` in `content.task_link`
or its `tasks` rows. Truncated/dropped routing identity, damaged declared
session/agent attribution, hidden items and missing links establish no row or
count; names, background flags and launch-result text cannot substitute for a link.

Deduplication uses host/conversation/epoch/recorded-session/recorded-agent/task id,
with the first linked representation in snapshot order controlling display, count
and action. Recorded session and agent never inherit current-session or Claude
defaults. When either attribution is unavailable, the creating item id joins the
identity so distinct creators stay distinct. Equal task/item/conversation ids on
another host and reused task ids in another recorded session remain separate.
This scoped display identity is distinct from the raw task id used to route Stop.

For these controls, supplied `active === true` alone determines Running grouping
and the count pill; supplied `status` independently supplies Completed, Failed,
Denied, Stopped, Stopping, Ended with session (plus saved `content.ending.cause`)
or Outcome unknown for `gone`/unknown status. Reports, launch results, progress,
turn endings, roster absence and session dividers cannot override either fact.
Unknown status or unavailable display content falls back to escaped item summary
bounded to 4096 characters, without inferring completion or activity. Settled rows
survive reopening even with no count pill; a Background tasks opener remains.

Injected progress and pending/refusal match the same full identity, including the
recorded session and creating item id when attribution is absent; another scope's
readings cannot affect a row. Host/conversation/epoch switches remount the supplied
view and discard local drawer/expansion state. See
[Background-task panel](conversation-shell-background-tasks.md#background-task-panel-581-cap-and-cut-display-since-582-latest-patch-since-583)
for saved-field availability, owning-host Stop gating and raw callback targets.
The [thread runtime](thread-runtime.md) connects these controls to production
subscriptions and host-addressed commands. Legacy roster reports cannot establish
task membership or replace supplied item facts. Credentialed live acceptance is
tracked separately in the [live runbook](live-e2e-runbook.md#current-real-claude-gate-state).

## Exact-base changes, appends and inert JSON

`applyUpdate(hostId, update)` accepts changes/appends only when the item exists,
its held `rev` equals `base_rev`, and the target `rev` increases. An ordered
field-change followed by its text suffix may share the same target revision and
conversation version: that suffix is admitted once only for the immediately
matching item/revision/version. Intervening full data, certification or repair
invalidates the companion. A delayed saved merge preserves it only when the exact
admitted live item wins the merge; a restored replacement invalidates it. Any own `id` or
`kind` entry in `changes` is incompatible, even if its value is unchanged. Changes
replace supplied own fields shallowly: omission preserves the held field, while
empty strings, false, zero and null replace it. `content` replaces its whole value,
including an empty object or null; nested content is never deep-merged.

An append requires kind `user_message` or `assistant_message` and an existing
object `content` with an own string `text`. It appends the suffix while preserving
other content fields; an empty suffix still advances the item revision. Replaying
an append encounters a base mismatch and requests repair without duplicating text.

Missing items, mismatched bases, incompatible updates and kind conflicts return
scoped `repair` results with static reasons `missing`, `base`, `incompatible` or
`kind`. They leave the rejected item/revision, applied version and checkpoint
unchanged while recording repair progress. Other results are `applied`, `ignored`
and `stale`; absent or mismatched epoch ownership is stale. `requireRepair` lets a
caller establish the same fence after a delivery failure.

Inputs are detached with structured cloning and recursively frozen. Own JSON keys
such as `__proto__` and `constructor` survive as inert item/content properties,
without prototype pollution or merging into application state objects. Held items
guarantee id/kind/revision and retain other fields as unknown JSON, allowing explicit
null clears even where the full-item DTO's optional fields require another type.
Optional diagnostics emit only static event/code values, never content or scope ids.

## Snapshots and completed batches

`store.getState().batch(run)` synchronously folds ordered mutations into one
publication for all affected scopes. Nested calls share the outer transaction;
scalar admission remains available outside it. Admission reads staged slices so
later changes/appends see earlier items and companions. Each changed held item map
is copied once, then final display and arrival order are rebuilt once per scope.
Previously published maps, arrays and snapshots remain immutable; untouched scopes
keep their identity. This publication transaction is distinct from the certified
reply handle returned by `beginBatch` and grants no completion evidence.

`ThreadSnapshot` is the host/conversation-scoped sync/cache read surface, defined in
[`src/shared/chatHistory.ts`](../../../src/shared/chatHistory.ts) and re-exported by
the store so storage contracts remain independent of renderer imports:

| Field | Meaning |
| --- | --- |
| `hostId`, `conversationId`, `epoch` | Accepted ownership of the held facts. |
| `items` | Ordered immutable retained items, including hidden and out-of-range items. |
| `arrivalOrder` | Optional complete permutation of held ids in first-arrival order; emitted by the store independently of display placement. |
| `version` | Greatest applied conversation version, including uncertified batch progress. |
| `checkpoint` | Last complete resumable conversation version. |
| `uncommittedVersion` | Optional highest unfinished batch version; only a value above checkpoint fences live success. Store snapshots emit it explicitly. |
| `ranges` | Caller-certified loaded order ranges; item presence alone proves no range. |
| `olderAvailable` | Optional availability reading for the oldest certified boundary. |
| `repair` | Missing-progress fence `{ fromVersion, throughVersion }`, or null. |

Versions can skip integers. Newer held facts may accompany an earlier complete
checkpoint; caching them does not certify the intervening progress. Envelope replay
cursors and fragment progress are [separate transport facts](inbound-message-decode-interface.md#complete-live-thread-updates).

The independently callable [authoritative SQLite backend](chat-history-api.md#bounded-authoritative-opening-and-pages)
preserves full snapshots and exposes explicitly partial shown-opening and held-order
pages through the authorized bridge. Its
`arrivalPositions`, when present, are original first-arrival positions aligned with
selected items, not a shortened `arrivalOrder` permutation. Selected `ranges` are
intact saved ranges containing indexable selected orders plus the newest saved
boundary anchor, deduplicated in saved order. Hidden/unordered items remain held;
their presence adds no coverage. The header returns saved scalar ownership,
progress, repair and optional availability separately and unchanged. Such a page
uses `threadHistoryCodec.page` admission before constructing the resident snapshot;
complete snapshot membership is not inferred from it. Production opening requests
200 shown identities plus active/dependency closure. Optional `availabilityStart`
retains availability ownership outside selected ranges; continuation and the sparse
id-to-arrival-position map stay in separate slice `residency`. Its separate
`traversal` is undefined before the first newest held-page read, a string for the
next before-page token, and null when that pass is exhausted. Optional `recovery`
holds the capability paired with that traversal token; held-page completion updates
both together, clearing recovery when the page omits it. Opening does not install
its capability as traversal state. These opaque values never enter `ThreadSnapshot`
or owned persistence. Opening's continuation alone cannot enumerate hidden items omitted inside/after its shown window, and an
old active dependency cannot stand in for visited content. These values confer no
progress or write authority.

`beginLocalRead(hostId, conversationId, heldPage = false)` provides the narrowly
scoped disk hydration seam. Default opening refuses a held scope. Explicit
`heldPage = true` requires a held scope and refuses another pending read; it permits
repeatable hydration without rotating the slice generation. The one-shot `complete`,
`fail`, `cancel` handle belongs to a private process-local token. Initial epoch
admission and same-owner publication preserve that token. While the read is pending,
a full live addition can establish the first epoch; a patch cannot supply its missing
base. Cancellation, a superseding read, explicit reset (even with the same epoch
string), replacement of a held epoch and conversation/host/global cleanup retire
the token. Delayed stored, missing or failed results then have no authority, including
after identical coordinate/epoch strings are reused.

Completion accepts full snapshots or explicit partial pages. Partial admission
first validates page ownership, facts, sparse aligned arrival positions and opaque
token; `parseChatHistorySnapshot` then validates the resident snapshot before
saved facts are detached/frozen. Sparse positions establish selected first-arrival
order without requiring a dense whole-history permutation. Without overlap it
preserves supplied held order. With same-epoch admitted state, saved-only ids survive; compatible overlaps
keep the higher full revision, with admitted facts winning equal revisions. Each
winner retains its supplied placement and optional-field clears. Saved arrival order
(supplied item order for older snapshots) precedes live-only admission order, so
numeric ties and unordered items remain stable across revision changes. Timestamps
never order items. Kind conflicts keep the admitted item and require repair;
a different saved epoch cannot replace the admitted epoch.

Held-page completion merges against the current resident snapshot, including facts
admitted before the read started. It unions the page's sparse arrival positions with
the resident map before deriving numeric placement and first-arrival ties; opening
closure can precede content that has not yet been visited. Higher compatible full
revisions win, admitted facts win ties, and whole-item replacement preserves optional
field clears. Hidden/unordered facts and overlapping dependencies stay unique by id.
An exact admitted live winner also retains its append companion through hydration.
Resident metadata, repair, checkpoint, unfinished progress and availability boundary
remain authoritative; only supplied saved ranges are unioned. An old page cannot
roll back newer progress or certify the holes between fragmented ranges. The next
opaque token remains generation-bound. With its matching recovery capability, main
can select a newly authenticated identity window after owned mutation or same-epoch
replacement; ordinary stale tokens alone still reject. Recovery pages use this same
merge path and preserve the admitted generation. A failed bounded selection retains
admitted content and the token/capability for explicit Retry; it never spins or
reopens newest. See [saved traversal recovery](thread-runtime.md#independent-saved-traversal).

The pending token records received progress observations, not item payload history.
Opening restoration folds their exact completion intervals, ranges and boundary readings over
saved metadata using the [owned-mutation rules](../decisions/0014-authenticated-owned-thread-mutations.md).
Saved checkpoint, applied/unfinished progress, repair and intact ranges survive
unless admitted completion actually covers the obligation. A higher live scalar
checkpoint cannot bypass a saved fence. Older-boundary availability wins, with
exhaustion retained at an equal boundary. The slice keeps the saved availability
boundary separately when selected evidence omits it, so later completed pages cannot
reopen older exhaustion by comparing only resident ranges. Hydration itself
certifies no interval, missing coverage, daemon completeness or read acknowledgement.

The merged slice retains the admitted generation, keeping surviving same-lifecycle
batch handles valid; only an otherwise absent scope needs a fresh generation.
Missing and failed reads settle without removing admitted facts; a saved-empty
snapshot still contributes validated metadata. Missing without admitted state leaves
the scope absent. The private restored marker publishes no `owned` change and cannot
replay the last received mutation through the
[history writer](chat-history-storage.md#buffered-replacements). Later received
publications still persist normally.

`beginBatch(hostId, conversationId, epoch)` returns null without matching ownership.
Its handle has `applyItems`, `commit` and `abandon`. Applying full items can publish
facts and applied version, but never checkpoint, ranges or older availability.
Admission remains per item: a rejected item does not roll back earlier admitted
facts, but any repair makes the handle ineligible to commit. `applyItems` folds
its supplied array through the synchronous publication transaction. Abandonment
retains received facts and leaves complete progress unchanged.

Only the [thread query coordinator](#thread-query-coordinator) certifies a completed
server reply. The store consumes client-owned
`ThreadBatchCertificate` fields `fromVersion`, `version`, `ranges` and optional
`olderAvailable`; it cannot prove reply completion itself. `commit` is one-shot,
including a rejected commit. Failed, abandoned, settled or stale handles return
`stale`. Invalid bounds or insufficient repair coverage return scoped repair reason
`coverage` without publishing progress: version/range bounds must be nonnegative
safe integers, starts cannot exceed ends, and `fromVersion` cannot exceed the held
checkpoint. An existing repair interval must be covered in full.

A successful commit preserves held items, monotonically advances version/checkpoint,
unions overlapping certified ranges and clears the covered repair. Disjoint ranges
remain disjoint; held active items and supplied parents cannot widen their paging
boundaries. Older availability follows the oldest supplied certified boundary;
later-boundary replies cannot replace it, and a delayed reply cannot reopen an
exhausted (`false`) reading at the same boundary.

Received publications carry a separate `owned` change containing changed complete
items, scalar metadata and only newly certified ranges. Hydration carries none;
missing items/holders imply no removals. Successful `beginBatch.commit` alone adds
`completion: { fromVersion, version }` and optional
`availability: { start, available }` for the oldest supplied certified boundary.
Repair, live updates and same-epoch holder recreation cannot supply that certificate.
Transaction coalescing unions owned changed identities and ranges, retains the
latest admitted item for each identity and records intermediate metadata,
completion and availability in ordered `priorProgress`. Keeping only the last
delta would silently omit saved items; keeping only final metadata could discard
an unfinished/repair obligation. Epoch/reset ownership starts a new owned payload.

The [writer](chat-history-storage.md#buffered-replacements) coalesces item revisions
and ranges while retaining progress/boundary observations in order. Main folds them
against saved evidence, including unloaded obligations. An earlier completion cannot
certify a later live checkpoint, discharge newer pending repair/unfinished progress,
or reopen exhaustion at an older saved boundary. A plain boolean certification
would lose those distinctions during coalescing and failed-write merging. New epochs
start progress empty; retrying a completed repair observation cannot revive it, but
a newly raised repair at the current checkpoint remains an obligation.

## Repair and unfinished-batch checkpoint fences

Live successes may advance checkpoint only without a repair and with unfinished
batch progress at or below checkpoint. Repair starts at the held checkpoint and extends through
the greatest missing version; later successful live updates can change held facts
without bypassing that interval. A completed page outside the interval cannot
repair it. Certification must start at or before the repair's lower bound and
reach its upper bound.

Exact item bases alone cannot establish complete conversation progress: a live
append can succeed against an item from an unfinished reply. The slice therefore
also retains the highest uncommitted batch version, exposed in `ThreadSnapshot` and
persisted separately from applied version. Abandoning that batch does not remove
the fence. A delayed completion advances only to its certified version,
preserving newer held facts; if it falls below pending batch progress, later live
successes remain fenced even after `repair` becomes null.

Equal/older batch revisions must record this pending version even when neither held
content nor applied version changes. For example, checkpoint 100 and missing
progress through 150 can coexist with live facts at version 300. An ignored,
abandoned batch at 250 still prevents a repair certificate through 200 followed by
a live success at 400 from moving checkpoint beyond 200. A completed certificate
covering 250 releases that fence; a subsequent live success can resume progress.
A content-only no-op check would lose this obligation and falsely certify recovery.

Already-covered unfinished versions are valid: after checkpoint 100, an older or
equal batch abandoned at 50 or 100 can leave that value in `uncommittedVersion`.
It does not fence a later live success; rejecting it at the cache boundary would
silently prevent later snapshots from saving. Explicit values are preserved and
must be nonnegative safe integers no greater than applied version. Older supplied
snapshots without the field conservatively restore it as applied `version` when
ahead of checkpoint, otherwise zero. Using applied version for every snapshot
would overstate the unfinished obligation when newer live facts coexist with a
lower pending batch, preventing its actual completion from releasing the fence.

The same fences apply when saved progress arrives after live admission. Saved
checkpoint 100, applied version 300, repair through 150 and unfinished version 250
still resume from 100 after a live fact at 400. An admitted completion through 200
can clear repair but leaves unfinished 250 fencing later live success; covering
250 releases that fence. Folding only the latest scalar metadata would discard
the saved obligations before the server had covered them.

Protected full reads and bounded local pages retain that normalized unfinished
version independently of applied version, including already-covered values. Pages
also preserve complete checkpoint, repair and optional `olderAvailable` without
reinterpreting them for the selected window. A local continuation is a position in
one committed saved snapshot, not a daemon cursor or batch certificate. Reaching
its end cannot advance checkpoint, clear repair, release unfinished progress or
turn unknown/true older availability into false; only completed daemon
certification can establish that progress.

## Epochs and cleanup ownership

`acceptEpoch(hostId, conversationId, epoch, reset = false)` explicitly establishes
ownership. A full live addition may establish initial ownership only during a pending
local read; updates cannot replace a held epoch. Reaccepting a held same epoch is
idempotent unless `reset` is true. A new epoch resets only that conversation's
items, version/checkpoint, ranges, older availability, repair and pending progress,
and creates a new generation. The coordinator passes `true` for explicit daemon
`thread_reset`, including a same-epoch reset. Its unique `resetId` supersedes older
pending facts/progress and is persisted for idempotent acknowledgement retry.
Recreating an absent holder in a saved epoch carries admission without reset and
must preserve unloaded disk facts. Memory cleanup never supplies reset/removal intent.

Batch handles capture a process-local generation symbol rather than trusting epoch
text alone. Replacement invalidates earlier handles even if the old epoch string
is later reused. The cleanup APIs release every corresponding slice, including
off-screen conversations:

- `deleteConversation(hostId, conversationId)` removes one conversation.
- `removeHost(hostId)` removes all that host's conversations.
- `clearAll()` clears pairing-wide state.

Cleared scopes read absent and repeated cleanup is a no-op. Other hosts/conversations
keep their held references. Old batch application/commit cannot recreate a cleared
scope, including after the same host/conversation/epoch is accepted again.
Cleanup also retires a pending read when no slice exists. Initial admission keeps
that read alive; hydration into the same lifecycle must preserve the generation
already captured by its batch handles.

The [thread query coordinator](#thread-query-coordinator) owns requests, recovery and reply certification;
[protected disk persistence](chat-history-api.md#owned-authoritative-mutations) consumes received owned changes.
The [thread runtime](thread-runtime.md#restore-recovery-and-cleanup) supplies production
lifecycle subscriptions. Deletion and successful unpair retire queries, pending
reads, local sends, live bindings and read authority as well as these retained items.
Store-only tests do not establish credentialed live acceptance.

## Thread query coordinator

`createThreadQueryCoordinator` in
[`threadQueryCoordinator.ts`](../../../src/renderer/src/store/threadQueryCoordinator.ts)
coordinates supplied navigation, connection and decoded-event inputs over the same
retained store. It returns `input`, `cancelHost` and `dispose`; it mounts no
production singleton or subscription. Main retains wire validation and logical-part
assembly. The coordinator sends only host-addressed `queryThread` commands containing
`thread_catch_up` or `thread_page`, with no raw-history, replay or resync requests.

### Dependencies and inputs

`ThreadQueryDeps` requires the vanilla `store`, synchronous `sendCommand`,
`requestId` factory and scoped `onState(serverId, conversationId, state)` callback.
Optional `log.event` receives only static `event`/`code` values. Request ids must be
fresh across attempts **and coordinator lifetimes**, such as caller-generated UUIDs:
reusing an id after teardown could correlate a delayed reply with its successor.

`ThreadQueryInput` has these supplied forms:

| Input | Meaning |
| --- | --- |
| `sync {serverId, conversationId, connected, restorePending?}` | Set this host's open conversation and connection/read readiness. `conversationId: null` leaves it; omitted `restorePending` means false. |
| `daemon {event}` | Consume host-stamped `threadReply`, `threadQueryFailed`, `threadUpdate` or `threadRepairNeeded`. Null host stamps are ignored. |
| `older {serverId}` | Demand older items for this host's open conversation. |
| `retry {serverId}` | Retry a failed open scope; otherwise a no-op. |

Opening while connected or reconnecting creates catch-up demand only for that
host's open conversation. Repeated `sync` coalesces; offline opening sends nothing.
`restorePending: true` holds demand until the existing restore owner supplies
readiness. Dispatch reads the current saved epoch and complete `checkpoint`, even
when applied `version` or `uncommittedVersion` is greater; an absent scope uses
empty epoch and version zero. Leaving discards unsent demand.

The additive `createChatHistoryWriter` and `readSavedTimeline` hooks and local-read
handles remain owned by [protected history](chat-history.md#storage-and-concurrency),
as established by [#1903](https://github.com/pyrycode/pyrycode-desktop/issues/1903).
The coordinator never starts/cancels disk reads or replaces cache storage. Hydrated
repair and unfinished-progress fences retain their store meaning.
The [thread runtime](thread-runtime.md) supplies production subscriptions and maps
query state, older demand and retry into the existing conversation controls.
Production navigation opens this coordinator for both existing and newly created
chats. Legacy newest-history demand and history recovery callers are unhooked.
The runtime's [independent saved traversal](thread-runtime.md#independent-saved-traversal)
uses this network-demand contract without giving the coordinator disk-read ownership.

### Reply certification and recovery

Replies must match host, conversation, caller request id and the store generation
captured at dispatch before application. The first valid reply admits its epoch
before opening a batch and captures its version once; nonzero catch-up and pages
must retain the accepted epoch. Every later part must keep that epoch/version.
All complete full items, including active items and out-of-range parents, apply
through the retained store's revision rules; delayed full items cannot overwrite
newer live facts. Store replacement or cleanup invalidates the request even when
the same epoch text is reused.

Only the separate empty `final: true` success marker certifies a batch, including
an empty reply. A nonzero catch-up marker must carry the exact requested
`from_version`; zero-version newest windows and pages certify only supplied order
bounds and availability. The certificate uses captured reply version, never item
revisions or fragment completion. Interrupted application retains received facts
and unfinished-progress fences, with the earlier complete checkpoint unchanged.

Live updates use `applyUpdate` on that same store. `threadRepairNeeded` fences an
existing snapshot through its applied version with `requireRepair`. Off-screen
repair stays scoped without creating off-screen requests. An open repair schedules
catch-up from the unchanged checkpoint; newer live facts cannot bypass it. A page
may retain facts but cannot certify recovery or add coverage while repair is pending.

An initial failed batch certificate permits one automatic repair catch-up. An
incomplete recovery exposes explicit retry; reopening a retained repair already
counts as a recovery attempt. Further live facts cannot restart a failed recovery.

A correlated `thread_reset` abandons its batch, deletes only that conversation and
accepts the reported epoch, including when unchanged. Calling idempotent
`acceptEpoch` alone would leave same-epoch items, coverage and repair behind. The
reset's version establishes no checkpoint: recovery requests a newest window at
version zero in that epoch. Repair recovery and reset-window recovery have separate
ownership, so a repair query's first reset still gets a fresh newest window. A
reset during that window exposes retry instead of looping. Other conversations
retain their snapshots.

### Certified older paging

Older demand waits for catch-up/recovery success and coalesces while waiting.
Repeated demand during an active page does not queue a duplicate page. Dispatch
uses exclusive `before_order` at the lower boundary of the newest continuous
certified range (`ranges.at(-1).start`); an earlier disjoint range cannot bridge the
gap. Without a certified boundary no page is sent.

The runtime consumes saved held pages before adding new older network demand,
independently of pending/failed network state. Hydrating `[100,200)` alongside
`[900,1000)` leaves the next network `before_order` at 900. Short/empty local pages
and null local continuation add no certificate, advance no checkpoint, clear no
repair and do not overwrite older availability. Recovery capabilities and circular
identity-pass exhaustion confer exactly the same lack of completeness authority.
Local exhaustion is separate from daemon exhaustion, resident display and read acknowledgement; hydration emits no save.

A page marker must have `upper_order === before_order` and numeric
`continuation === lower_order`. Commit only supplied `[lower_order, upper_order)`;
after ranges merge, its certified lower boundary drives the next explicit demand.
Authoritative `older_exists: false` suppresses further pages. Item presence, page
length and active/parent extras establish neither continuity nor exhaustion.

### Host slots, presentation and cleanup

Each host owns one unfinished-query slot; other hosts dispatch independently.
Pending state and its 30-second idle timer are installed before presentation/send
callbacks, allowing synchronous cancellation or terminal delivery. Every matching
logical reply part renews the deadline; fragment handling remains in main.

Navigation abandons application and publishes idle. An unsent request immediately
releases its timer/slot. A sent request retains a cancelled tombstone until terminal
reply/reset, query failure or idle expiry, preventing another request from competing
for the daemon's unfinished slot. A nonterminal generation/metadata rejection also
publishes failure while keeping that tombstone. Explicit retry queues behind it;
late parts can release the slot but cannot publish facts or certify a successor.
With [bounded runtime application](thread-runtime.md#bounded-complete-item-application),
`observeTerminal` records a matching received complete-view terminal separately
from queued content. Navigation releases a slot whose terminal is already known,
including a previously cancelled slot on repeated navigation. Incomplete,
unrelated, expansion and compact replies do not qualify. This receipt bookkeeping
never publishes items or certifies completion.

`ThreadQueryState` is `idle`, `loading {purpose}` or
`failed {purpose, reason, retryable: true}`; purpose is `catch-up` or `older`.
Local failure codes are `send-failed`, `disconnected`, `timeout`, `generation`,
`metadata` and `recovery`. Decoded `threadQueryFailed` forwards static transport
codes: `malformed`, `sequence`, `metadata`, `limit`, `final-length`, `digest`,
`reconstructed`, `expired`, `unavailable`, `send-failed`, `interrupted`, `daemon-error`.
No daemon error text, content, epoch or scope id enters diagnostics.

Transport failure, disconnect, sender exception and idle timeout abandon the
batch and release timers/loading/slot. Failure blocks dispatch until explicit
retry or a fresh navigation/reconnect edge. Retry chooses catch-up whenever repair,
catch-up failure or incomplete readiness remains; otherwise it retries the page.
It resumes from complete checkpoint and retains received facts.

`cancelHost(serverId)` means **connection teardown**, not navigation: it removes
that host's scheduling state, clears timers, abandons batches and publishes idle,
without deleting retained items. Navigation uses `sync` so sent slots survive.
`dispose()` cancels every host and ignores subsequent inputs. Store cleanup remains
with the owning lifecycle integration; fresh ids and generation checks fence late
delivery after either form of cleanup.

## Testing

Bounded-update validation for #2079 is linked from the
[runtime's accepted Linux evidence](thread-runtime-update-validation.md#bounded-update-validation).
The supplied dispatcher gate-4 summary reports **9,869 unit tests executed/passed,
0 failed, 3 skipped**; the accepted verdict reports **9,951 executed/passed,
0 failed, 3 skipped**. These are separate reports, not combined totals. The verdict
confirms all four terminal-kind/lifecycle combinations and six coordinator
correlation/repeated-navigation cases passed. Builder rework at `668a6df6` records
**54 runtime/coordinator cases executed/passed, 0 failed/skipped**. See the
[plan](../../specs/architecture/2079-bounded-thread-updates.md).

An earlier guarded replay at `de6e481a` executed
**29: 28 passed, 1 failed, 1 skipped**; the isolated history retry passed
**1/1, 0 failed/skipped**. That protected-coverage failure became
[#2153](https://github.com/pyrycode/pyrycode-desktop/issues/2153), now closed by the
merged history-observation repair. The default-worker unit run's unchanged
five-second storage rollback timeout remains tracked by
[#2155](https://github.com/pyrycode/pyrycode-desktop/issues/2155); its unchanged
isolated retry passed **1/1, 0 failed/skipped**, and the two-worker full run passed
**9,918, 0 failed, 3 skipped**.

The bounded-update regressions compare scalar and folded admission through
additions, field changes, placement ties, same-revision companion appends,
duplicates/stale inputs, repair and recovery, including progress metadata and old
snapshot immutability. Counted map-copy/order assertions distinguish batching from
merely delaying individual rebuilds. The coordinator checks one completion
notification after publication; runtime checks finite drains, changed-slice send
settlement, ordered controls and late lifecycle callbacks. The existing writer
integration flushes a mixed admitted batch and compares its saved state, including
owned progress. See [counted Linux evidence](thread-runtime-update-validation.md#bounded-update-validation).

[`threadItemStore.test.ts`](../../../src/renderer/src/store/threadItemStore.test.ts)
uses supplied complete-item and certificate fixtures without Electron, a daemon or
Claude. It covers revision races, replayed/empty appends, atomic replacement presence,
inert JSON, repair/unfinished-batch fencing, certified boundaries and generation reuse
after each cleanup operation.

The [cache testing reference](chat-history-testing-restoration.md#restoration) covers local-read
ownership, protected fresh-instance restoration and restart regressions for
already-covered unfinished progress and first-arrival ties.

[`indexedThreadHistory.test.ts`](../../../src/main/indexedThreadHistory.test.ts)
covers fresh-instance protected full reads, 200-item backward traversal, bounded
selected reads/decodes/decrypts, long-string continuations, scoped cleanup,
corruption and transactional preservation. The
[verifier re-review](https://github.com/pyrycode/pyrycode-desktop/pull/2014#issuecomment-6191872749)
confirms all 25 authoritative on-disk cases executed and passed, 0 failed and 0
skipped, within the unit gate's 10,356 executed/passed, 0 failed and 3 skipped at
`a57a82d771e1d6c5f2d53765781939091f79ac75`. The cases include
`exact round trip and first-arrival restart retain covered unfinished progress`
and `200-item windows traverse held order exactly once across ties/null/unordered items`;
both were present and passed. Protection uses an injected reversible fake,
including base64 expansion and additional overhead; this proves no OS key-store
round trip or live-daemon behavior.

The [verifier's re-review](https://github.com/pyrycode/pyrycode-desktop/pull/1920#issuecomment-6099461564)
on 2026-10-10 records 2 executed, 2 passed, 0 failed and 32 skipped by its name filter.
Both `retains uncertified progress from equal batch revisions during repair` and
`retains uncertified progress from older batch revisions during repair` were present
and passed. This counted evidence covers those two permanent checkpoint regressions.

[`threadQueryCoordinator.test.ts`](../../../src/renderer/src/store/threadQueryCoordinator.test.ts)
uses an isolated real store, supplied decoded events and fake timers. Coverage
includes saved-checkpoint reopening, empty-marker certification, multipart
disconnect/late completion, live revision overlap, scoped/repeated reset, repair
failure/retry, generation replacement, disjoint paging with out-of-range extras,
host isolation and retained slots, timeout renewal, synchronous callbacks and cleanup.

The [verifier review](https://github.com/pyrycode/pyrycode-desktop/pull/1946#issuecomment-6153714743)
on 2026-10-13 records all 22 coordinator cases executed and passed, 0 failed and
0 skipped, in the dispatcher unit run of 10,033 executed/passed, 0 failed and 3
skipped across 396 passing files at `4b220d4457aaa93a26d7b0a2ea99e205bb4a9778`.
The fake-transport gate recorded 388 executed/passed, 0 failed and 3 skipped;
its `thread` name entry was not run and supplies no coordinator-specific evidence.
These supplied-input checks establish no production daemon or live-Claude proof.
