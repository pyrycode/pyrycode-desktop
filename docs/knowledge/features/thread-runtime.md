# Production daemon-built threads

The desktop app draws daemon-authored conversation items for every paired host.
[`threadRuntime.ts`](../../../src/renderer/src/store/threadRuntime.ts) owns the
application's item store, local pending sends, live session state and query
coordinator. `App` installs its subscriptions. `PairedShell` opens it for both
sidebar navigation and newly created chats. The existing conversation components
provide the rows, composer, menus, prompts, task drawer and scrolling.

## Accepted capability and host routing

The client hello requests `interactive`, `thread`, `thread_expansion` and
`thread_compact`. Main checks each host's accepted handshake independently.
A handshake without `thread` produces
`update-required` with a daemon cause and no `connected` event. The existing failed
host treatment names the daemon and offers no app download link. That host draws
no conversation rows and sends no content or recovery requests.

The driver is parked with reconnect supervision retained. A later accepted
handshake with `thread` connects normally and clears the failed treatment. Another
host's capability or connection cannot select this host's content route. Saved
format provenance permits offline display only and never establishes network
capability. The legacy event/history path is unhooked from paired-host production
content. The renderer reconstruction producers were deleted in #2030, with no
fallback when authoritative inputs are absent.

Conversation commands capture the selected or retained host. Main resolves that
explicit host through the paired registry. A last claimant of an equal conversation
ID cannot redirect the request. Device identity is a separate authenticated fact.
On-demand bodies and child pages additionally require the current owning
handshake to accept `interactive`, `thread` and `thread_expansion`; unsupported
expansion leaves complete reading available.

## Explicit compact projection

`runtime.open(host, chat, { projection: 'compact-v1' })` explicitly selects a
separate session-only owner after negotiation of `interactive`, `thread`,
`thread_expansion` and `thread_compact`. Production opening, including creation,
uses `projection: 'auto'` to select compact from that owning host's accepted
handshake. Omitted options retain complete delivery. Automatic recovery selects
from the current accepted connection before dispatching queries; advertisement
alone cannot select compact delivery. Offline compact reopening exposes session-held
facts without disk restoration or reads. Compact failure requires explicit Retry
and cannot select complete as a fallback.

See [compact runtime](thread-runtime-compact.md) for root coverage/checkpoints,
consumed live progress, demanded detail freshness, wire-lane admission, lifecycle
fences and offline state, and its [counted Linux evidence](thread-runtime-compact.md#validation-evidence).
[ADR 0016](../decisions/0016-session-only-compact-projection.md) records the boundary.

## Restore, recovery and cleanup

Complete opening first starts an owned protected `openThreadPage` with limit 200
through `readSavedTimeline`. The partial projection selects newest shown identities plus
active/recorded dependencies, preserving saved progress and sparse arrival order.
A legacy saved timeline is never drawn or converted. Protected indexed storage is
the application backend; ordinary fresh-owner reads decode only selected facts and
evidence after one-time conversion/import. Retried invalidated opening uses the
same bounded selection with no full-read fallback. User-driven traversal uses the
[independent saved-demand path](#independent-saved-traversal) below. See
[storage activation](chat-history-testing-native.md#native-runtime-and-packaged-proof).

While opening's saved read is pending, network query demand waits but same-owner
live additions can already render. Local settlement merges saved-only rows and winning revisions
with those live rows, keeping both visible while the server reply remains held.
A connected opening or reconnect then supplies the admitted snapshot's epoch and
complete checkpoint to the coordinator. Applied version, unfinished batches and
item presence cannot certify resumable progress.
Live/reply overlap follows item revisions. Interrupted or abandoned batches retain
received facts without certifying completion. Repair resumes the complete
checkpoint. A correlated reset retires the old scope and starts the new epoch's
newest window. Older and Retry controls invoke host-addressed thread queries.

Navigation cancels the selected local read and abandons application of its query.
The coordinator retains sent-query ownership until terminal delivery or expiry;
a correlated terminal already received before retirement permits immediate slot
release, including across repeated navigation.
Local read tokens, request IDs and store generations reject stale callbacks even
when host, conversation or epoch strings are later reused.
Initial epoch admission and same-owner publications preserve the read; explicit
reset or epoch replacement retires it. Runtime selection/generation checks also
prevent late settlement from recreating a removed restoring indicator or read route.
Restoration creates no owned save, read acknowledgement or current-session/prompt
authority; pending local sends keep their separate ownership.

Confirmed deletion clears the owning conversation's retained items, pending sends,
live binding, completion and read authority. Successful unpair retires those
resources for every scope on that host, including scopes without content. The
protected writer removes saved content through its existing ordered removal path.
Failed credential removal does not grant successful-unpair cleanup. Other hosts
with equal IDs remain independent.

### Bounded complete-item application

Production queues live additions, changes and text appends together in received
order. Once content is queued, subsequent controls join that queue: questions,
permissions, session changes and disconnects wait behind preceding content without
forcing a synchronous backlog flush. Each drain consumes at most **128 events**,
including controls. Consecutive content runs share a coordinator/store transaction;
each run publishes one coherent immutable snapshot per changed host/conversation.
Only changed slices settle sends and task stops and derive composer reports.
Authoritative delivery clears Sending in its admitting snapshot.

The first drain races an animation frame against a **50 ms timer**, cancelling
the losing callback and fencing late callbacks with a scheduling token. Further
drains yield through **zero-delay timer tasks**: chaining frames alone starved
the heartbeat. Paused frames still progress with the same per-drain bound.
Factory instances without a frame scheduler retain synchronous event application;
scalar item-store APIs remain synchronous too.

The [item-store transaction](thread-item-store.md#snapshots-and-completed-batches)
copies each changed map and orders its contents once, preserving immutable prior
snapshots and scalar admission semantics. Owned changes retain all changed items
and ordered progress/completion evidence for the writer; retaining only the final
delta would lose saved content. Coordinator completion notifications follow the
coherent publication once per scope. Receipt and scheduling certify nothing.

Deferred entries retain their received host/conversation and store-generation
owner. Navigation/cancel removes departed work; reset/epoch replacement fences
old owners, including reused strings. Confirmed deletion, successful unpair,
suspend and disposal retire their queues and callbacks. Suspend discards pending
application and reconnect resumes from the certified checkpoint. Disposal also
clears ordered subscribers. None of these paths drains an abandoned backlog.

Terminal cleanup has separate receipt bookkeeping: `observeTerminal` recognizes
only the outstanding host/request/conversation's complete-view final reply, reset
or failure. Navigation can then release a cancelled slot immediately, even when
the terminal arrived after an earlier cancellation and another navigation follows.
Unrelated, incomplete, expansion or compact replies cannot release it. Receipt
neither admits departed items nor certifies completion; discarding that bookkeeping
with the content would stall the next conversation until the 30-second timeout.

### Independent saved traversal

`query('older', host)` first consumes bounded saved pages for the exact selected
host/conversation lifecycle. The first demand requests `newestThreadPage` even when
opening returned null or included an old active dependency. Later demands follow
only `residency.traversal`: undefined is unstarted, a string continues the held pass,
and null is local exhaustion. Opening's shown-window continuation cannot enumerate
all omitted hidden/newer held facts. Repeated demand coalesces into one local read;
opening must settle before traversal starts. No new older network demand is sent
on the input that exhausts local traversal; a later input delegates to the coordinator.
Without saved residency, demand delegates directly.

`localQueries` retains local idle/loading/failed state independently of network
`queries`. A disconnected host or held/failed server reply cannot block saved demand.
Local loading/failure takes precedence in the existing presentation without replacing
network state. Upward input cannot retry a local failure: explicit Retry repeats
that demand, otherwise Retry delegates to the coordinator. Errors retain displayed
content and content-free classifications. Each demand makes one IPC call and one
selection attempt for at most 200 identities plus relevant saved evidence, with no
automatic retry loop. Explicit Retry prioritizes failed local demand and starts
another bounded attempt.

Only held traversal stores and echoes `residency.recovery` alongside its continuation;
opening's capability cannot seed the traversal. Main authenticates the pair against
the exact scope owner, epoch and decoded continuation. On generation invalidation
from owned writes or same-epoch replacement, it selects a bounded circular identity
pass around the retained boundary, then returns each window in current held order.
That pass covers items moved across the old boundary and removed boundaries without
reopening newest or replaying loaded depth. Another invalidation can rebase a later
demand; selection failure retains content and requires explicit Retry. There is no
recovery based on a generic error or weakened ordinary-token validation. Same-epoch
replacement rebuilds existing indexes during its write transaction, keeping later
recovery reads bounded. See [the protected contract](chat-history-api.md#bounded-authoritative-opening-and-pages)
and [ADR 0015](../decisions/0015-protected-saved-traversal-recovery.md).

The selected local job captures the item-store generation. Navigation cancels it;
reset/epoch replacement, deletion, successful unpair and teardown retire it. Both
page admission and failure presentation require current ownership, even after the
same strings are reused. Same-lifecycle live/network/newest facts merge by compatible
revision, with admitted facts winning ties and saved sparse arrival positions retained.
Held-page hydration preserves resident progress and older-availability ownership,
unioning only supplied saved ranges. It emits no owned save, new certificate or read
acknowledgement. A disjoint saved range cannot advance network paging across a hole;
local exhaustion offline still needs a connection when daemon completeness is unknown.

The scroll callback returns whether local demand started or network demand is eligible.
At zero with no accepted demand, the pin restores prior following intent so a short
offline thread still follows intrinsic row growth. Accepted saved demand preserves
the existing visible-row anchor and offset. See
[scroll demand](conversation-shell-scroll-pin.md#user-demand-and-prepend-position) and
[counted recovery proof](chat-history-testing-restoration.md#counted-saved-traversal-recovery-validation).

## On-demand bodies

`createThreadRuntime().bodies.demand(request, listener?)` returns a lease with
`getState()`, `release()` and `retry()`. The request names `serverId`,
`conversationId`, `epoch`, `itemId`, `revision` and `kind` (`tool_call` or `agent`).
Admission requires the selected conversation's current epoch and valid positive
safe-integer item/revision coordinates. Main and runtime independently gate reads
on the owning host's current accepted `interactive`, `thread`, `thread_expansion`
handshake. The [main correlation contract](daemon-connection-correlation-requests.md#bounded-thread-body-reads)
owns peer validation and local receive cleanup.

Equal host/conversation/epoch/item/revision/kind demands share one queued or active
read. Each lease owns one consumer and optional synchronous listener; releasing
one leaves others active, while the last release cancels queued work locally and
active work through the validated cancellation bridge. Each attempt captures a
fresh UUID request ID and the current connection token, alongside selection and
item-store generation ownership.
Reused conversation, epoch or external owner strings cannot admit old data,
fragments, markers or failures into a replacement attempt.

State is `missing` with a reason (including offline, evicted or limit), `loading`,
`failed` with a static reason, or `ready` with object content and a `stale` flag.
Loading/failed states may retain stale completed content. Data is staged until the
separate matching success marker arrives; fragment completion alone leaves the
lease loading. Empty input/output can succeed, while absent/unavailable content
cannot become an empty success. Unknown content stays inert JSON. Failure requires
an active lease's explicit `retry()`; another demand, navigation or reconnect
does not retry a retained failure automatically.

### Shared body and child cache

Bodies and [child pages](#on-demand-child-pages) use one `createThreadBodies`
owner, record map, queue and lease budget. Complete-view queries progress
independently when expansion reads are saturated. The shared finite limits are:

| Resource | Limit |
| --- | ---: |
| Active reads | 4 |
| Queued reads | 28 (32 outstanding total) |
| Entry records | 64 |
| Retained bodies, partial child summaries and cursor metadata, measured as UTF-8 JSON | 16 MiB |
| Demand leases, including listener subscriptions | 128 |
| Active-read deadline | 30 seconds |

Demand touches the entry's LRU position. Byte pressure discards retained content
and reports truthful `missing/evicted` state for successful entries, including to
their listeners. Failed content can also be discarded, but its record, reason and
explicit-retry requirement survive: content eviction must never turn failure into
an automatically fetchable miss. Record admission evicts only an unleased,
nonfailed entry without active/queued work. Failed records remain bounded at the
same 64-entry cap; if no eligible victim exists, a new identity is rejected with
`missing/limit`. A separate failure ledger is unnecessary. Scope clearing removes
these records; explicit retry authorizes replacement work. Child failure admission
also spans page-limit variants, as described below.

Reopening unchanged retained success in the same connection reuses the cache.
Navigation retires leases and unfinished work but may retain completed content.
Disconnect also withdraws capability and leaves retained content stale and
readable offline. Offline missing demand sends nothing. A new connection fetches
nothing on its own: an explicit demand starts a revision-checked read, retaining
stale content until the new data and marker succeed. Cancelling that validation
cannot make the retained content fresh. Failed revalidation preserves the retry
requirement even under byte or record pressure.

Retirement first snapshots affected entries, disables **all** their leases and
detaches listeners, then cancels work and settles or deletes entries before
notifying the saved listeners with `missing/retired`. `demand`, `retry`, `start`
and `pump` cannot dispatch replacement work during retirement. Revoking just the
notified lease would let its callback retry through a second lease on the same or
another departing entry. Reset/store-generation replacement, epoch replacement,
conversation deletion and successful unpair clear the corresponding entries;
disposal clears all entries, timers and subscriptions. Navigation/disconnect
retain failure admission until explicit retry or lifecycle clearing.

Bodies and child pages remain session memory only. Production compact presentation
mounts visible [body/direct-child leases](thread-runtime-compact.md#demanded-detail-refresh-and-retirement);
complete delivery keeps locally held expansion and readable saved-complete history.
Expansion replies are consumed before complete-query batch admission and
write no canonical item, coverage, completion certificate or read receipt. Neither
operation prefetches bodies, nested rows or another page. Compact selection supplies
[ancestor invalidation and demanded refresh](thread-runtime-compact.md#demanded-detail-refresh-and-retirement).
No detail persistence is added.

## On-demand child pages

`createThreadRuntime().children.demand(request, listener?)` accepts `serverId`,
`conversationId`, `epoch`, parent `itemId`, expected `revision` and optional `limit`;
it supplies `kind: 'children'` internally. It uses the selected owning host and
the same accepted-capability, connection, scope and generation fences as bodies.
The limit defaults to 50 (including zero) and clamps to 256. Equal demands with
equal normalized limits share one read with independent leases; distinct limits
keep separate successful caches. An unchanged success reopens in the same
connection without refetch, even when another limit variant has failed.

The lease has `getState()`, `release()`, `retry()` and `continue(cursor)`. Its
`missing`, `loading`, `failed` and `ready` states retain the compatible body-state
shape; child content is in optional `page`, with inert empty `content` on success.
`page.children` accumulates received direct-child summaries, alongside capture
`version`, enumeration `complete`, and marker-supplied `more`/`cursor`. Partial
data is observable as loading and stale. Only the matching separate success
marker makes the page ready; marker-only empty success is valid. Only authoritative
`more: false` makes `page.complete` true for that enumeration at its capture. A
short page proves neither exhaustion nor complete-thread coverage.

Another page requires `continue(page.cursor)` echoing all seven fields:
`conversation_id`, `epoch`, `item_id`, `rev`, `version`, `order`, `id`. Cursor
`version` is consumed-history version: another change can invalidate it while
the parent's revision stays unchanged. Zero version/order are valid. Summaries
advance in strict ascending `(order, id)` order, including zero-order ties; IDs
must remain unique across retained pages, since increasing tuples alone would
allow the same ID to reappear at a greater order. Duplicate continuation shares
queued/active work, and an exact already-consumed cursor reuses success after its
marker. Consumed cursors and an active continuation cursor count toward retained
bytes; they are cleared when a replacement enumeration receives its first reply.

Optional summary facts preserve absence separately from known zero, false or
empty text. `kind` and `status` remain open strings. Unknown child counts,
existence or subtree versions supply no freshness or completeness authority;
summaries include neither bodies nor descendant inventory. The
[main validation contract](daemon-connection-correlation-requests.md#bounded-thread-child-reads)
owns their field, count and routing checks.

A failed, refused or invalid continuation retains available summaries as stale
and incomplete. Explicit `retry()` starts a replacement **first page without a
cursor**. Old summaries can remain while waiting, but the first replacement reply
replaces them, and only replacement pages can complete the new enumeration.
Repeated demand, changed limits, reconnect and byte/record eviction cannot bypass
failure. Failed records and their parent-scoped admission object survive content
eviction within the shared 64-record bound; no separate failure ledger is used.

Limit-specific entries in the same host/conversation/epoch/parent/revision and
store generation share the current failure identity. Retry acknowledges that
identity for the entry's replacement enumeration, allowing each explicitly
demanded continuation through authoritative `more: false`. A later actual failure
replaces the identity and invalidates the earlier acknowledgment; admission
refusal copies its reason without creating a new failure. Both `start` before
queuing and `pump` immediately before dispatch check admission. Checking only when
queuing would let a saturated continuation bypass a newer sibling failure when
an active slot opens. Ordinary first-page demand and retirement discard retry
acknowledgment; cached success remains independently reusable.

Child leases follow the shared release, offline, reconnect and cleanup rules
above. Explicitly demanding a changed parent revision retires the old revision's
leases synchronously. After retirement callbacks, admission rechecks selected
ownership, selection token, epoch, store generation and connection: a callback
can navigate, reopen equal IDs or disconnect before demand resumes. Late replies
cannot populate replacement identities. Disconnect leaves only stale retained
pages or explicit missing/evicted state; reconnect sends no child read until demand.

## Navigation boundaries

Navigation no longer resets, creates, views or clears legacy timelines (#2028).
Renderer legacy saved IO retired separately (#2029). #2030 deletes the flat/keyed
holders, `reduceTimeline`, content subscriptions, delta joining/open-bubble lookback,
result filling, history reconciliation/demand/retry, type/timestamp joins,
gap/receipt tracking, legacy echo settlement, inferred rosters and reconstructed
row keys, along with their exclusive bridges, mounts and tests. The exclusive
queue store/actions and local-count last-read store/cleanup are also gone.

Shared declarations stay at `threadTimeline.ts` and `backgroundTaskRosterStore.ts`;
shared translation remains at `timelineBridge.ts`. Those paths no longer imply a
content producer. #2025 removes the main/IPC raw-history command, correlation,
page/failure events, exclusive decoder and replay/resync recovery. Initial and
reconnect hellos omit both replay fields. Live-envelope metadata/admission,
thread queries/checkpoints, host/fragment isolation and held-send `sendPairing`
fencing remain; see [retired network surface](request-history-send.md).
Saved-format admission and indexed legacy storage retirement remains #2026.

Active ID/session/configuration/prompt cleanup remains synchronous before exit navigation. Same-ID
reopening preserves held configuration and requests a refresh every time. Server removal samples
exclusive departed IDs before dropping the list slot, then exits a matching active chat.
Protected removal retains its owning lifecycle; local-count mark persistence no longer participates. See
[the shell's retained boundaries](paired-shell-conversation-exits.md).

`conversationLastReadBridge` keeps its paired-shell `useReadPublication` mount while dropping the
legacy count helper and timeline subscription. Its wrapper remains after #2030 removes the
underlying count store. Navigation alone creates no read evidence; the
committed-visible-content fences below and daemon acknowledgements remain authoritative.

## Sending and authenticated identity

The no-argument `window.pyry.deviceIdentity()` invoke returns the lowercase
hexadecimal public key from main's protected Noise keypair. Failure returns only
`identity-unavailable`. No private key or token crosses IPC. Each submission
captures this identity with host/conversation and current selection ownership.
Identity failure, lost ownership and a false submit result preserve recoverable
input without overwriting a newer draft. Attachment rollback has one owner.

The pending-send store supplies local rows before acceptance. An authoritative
`user_message` settles a row only when both `content.device_id` and
`content.message_id` match the captured pair in the exact host/conversation.
Equal text, a peer device's equal message ID and another host cannot settle it.
After acceptance, only daemon content supplies the row. Explicit native `written`
status displays one user row without queue actions while awaiting the eventual
echo or placement; it does not assert final delivery. Terminal or hidden items
can settle a send even when they are the first observed revision.

Queued actions use genuine `content.queued_msg_id` handles with owning coordinates.
Send now additionally requires the session's reported capability. Complete task
membership, activity and saved attribution come from linked daemon items. Compact
additionally admits current-session live task identities with an actual task ID and
explicit owning-summary agent, without inventing tool linkage. No legacy roster
supplies membership. Stop retains agent and owning-host capability checks; see
[live task authority](conversation-shell-turn-status.md#session-scoped-live-presentation).

## Live controls and read publication

Only the owning summary's `current_session_id` binds live state. Admitted readings
also require the owning host and conversation. A validated top-level
`conversation_id` routes newer supplied live state independently of the producing
`session_id` (which may identify a daemon-wide source). Without that route the
existing bound-session provenance check remains. Payload route conflicts fail
admission. Durable items,
saved restoration and session-transition markers cannot choose the current live
session. The selected host's projection supplies existing model, effort, context,
MCP and other configuration readers. Off-screen hosts keep separate live state.
An admitted withdrawal of held settings permits one settings/model refresh per
selected bound session and opening; missing initial replies are not retried.
Effort recall waits for a non-null configuration reading before treating an empty
effort as unset. Native reset causes map to the existing divider presentation.

The prompt slot reuses existing permission, consent and questionnaire components.
Replies retain the original host and prompt object. Session replacement and
reconnect invalidate stale handles. Rejection feedback survives reconnect.
Current prompts remain usable during pending or failed initial history recovery.
Composer hook stops and refusal offers derive from full items in the selected
`presentation(host, chat)`, including admitted compact roots. Foreground-tool status
can also use compact headers. Retained complete items cannot override selected
compact facts. Session errors come from admitted live readings. Without a snapshot
there are no content-derived reports or item previews; without a session binding
there are no current-session reports or admitted live activity. Available daemon
items and local unaccepted sends retain their own presentation authority. Neither
absence selects a reconstructed source. Badge/sidebar status combines admitted
live inputs (idle when unavailable) with received host-qualified shown/read marks.
`notificationPreviewFromItems` remains shared; `notificationPreviewIn` is deleted.

Preload's `onDaemonEvent(listener, includeThreadUpdates = false)` filters
`threadUpdate` before invoking passive listeners across contextBridge. Runtime and
raw content observers explicitly pass `true`; other event families keep their
existing delivery. A replay witness that needs turn/reply content must opt in too.
Otherwise an unchanged assertion can lose its witness without a wire change.

Notifications subscribe through `threadRuntime.subscribe`, which emits content
in order after the coherent publication and emits controls after their preceding
content. `usePushNotify` caches presentation rows in a WeakMap keyed by immutable
snapshot, so multiple turn endings in one batch reuse one projection. Subscribing
directly to received content would repeat a whole-thread projection for every
turn ending and bypass bounded application.

`subscribeRefusalRecovery` still forwards newly selected model writes into
`threadRuntime.refusals`; it no longer dispatches into timelines or settles legacy
events. The overlay consumes the exact displayed authoritative session-error
reading on departure through its microtask fence, preserving StrictMode replay
and preventing a stale cleanup from consuming a replacement reading.

The screen shares one scroll pin with the actual authoritative scroller. The
Background tasks menu, count pill and close action share drawer state. Immutable
source items retain presentation identity while another row streams. Presentation
memoization is restricted to frozen inputs so mutable supplied fixtures stay fresh.

Complete-route read publication uses the committed immutable snapshot, received
owning summary and a certified newest/catch-up completion watermark. Visibility, ordered shown
content, reader coverage and repair/unfinished fences remain required. Sending a
read command is distinct from received daemon acknowledgement. Every host-stamped
sidebar row uses `last_shown_version` for unread state before its first opening;
legacy local read stamps cannot replace a missing authoritative mark.
`readTargetFor(inputs)` and `useReadObservation` have no legacy receipt/row-key
branch. The publisher requires the authoritative epoch and shown watermark;
`latest_entry_id` and local counts cannot supply missing eligibility. Observation
cleanup, acknowledgement and reconnect retry retain their existing ownership fences.
`useReadObservation` retains its observer while host/conversation/epoch, newest
shown item, region, pane and connected tail match and the reader stays closed.
Received list progress can temporarily precede the queued snapshot and make
`readTargetFor` ineligible; that gap does not require rebuilding the observer.
Every callback rechecks the latest committed inputs, certification, owning route,
focus, visibility and uncovered tail geometry before publishing. Reader opening,
identity changes and detached tails still retire the setup.
Compact display facts have zero complete version/checkpoint and no ranges; production
supplies no read observer inputs for them, even with a retained complete checkpoint.
See [compact evidence separation](thread-runtime-compact.md#root-facts-and-independent-evidence).

## Validation boundaries

### Bounded update validation

The [accepted verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2154#issuecomment-6285177896),
stage `7b3ee7f4`, records Linux validation on 2026-10-20 at `eb35b16f`.
Its exact-head production run executed/passed **4 tests, 0 failed/skipped/retried**.
All four are present and passed: `8333 finite updates keep mounted
keyboard, heartbeat, delivery and teardown responsive`, `the mounted bridge
publishes a delta-only burst with paused frames through its bounded timer
fallback`, and both `indexed history drains a buffered thread replacement on
quit/window and restores it offline` variants. Reports:
`/tmp/verifier-2154/recheck/approved-mounted.json` and `burst-evidence.json`.

After an empty completed baseline, the burst sends the original varied 8,333-item
workload once and stops. Main delivery, applied progress and mounted commits are
observed independently. Application advanced **1,530 → 2,194** while unfinished
across real keyboard input; composer state committed in **24.9 ms**, and submission
occurred at applied count 2,298. All **8,335** items, including authoritative
echo/reply, applied in **7,295 ms**; maximum heartbeat gap was **353 ms**, with
**77 mounted commits**. Exact final state, same-batch send settlement, one reply,
idle, one-second application quiescence and normal teardown passed without an
increased timeout. Shutdown fixtures advance 50 ms after positive tail receipt,
keeping the writer's 200 ms timer buffered for pre-close baseline, close drain and
offline restoration.

The [item-store tests](thread-item-store.md#testing) retain the differing counted
unit reports and the final lifecycle/correlation regression results.

The configured verifier Playwright gate executed **1 test: 0 passed, 1 failed,
522 skipped**. The native-writer prerequisite passed its isolated same-tree retry
(**1 executed/passed, 0 failed, 0 skipped**); the dispatcher accepted the
[#2125](https://github.com/pyrycode/pyrycode-desktop/issues/2125) flake. The dependent
suite was not rerun. Neither the skipped recorded-thread nor read-observer case
is a pass in that configured run.

Builder's guarded complete-thread replay at `668a6df6` executed/passed **29 tests,
0 failed, 1 existing reset-prompt fixme skipped, 0 retries/forbidden launches**.
`daemon-built thread streams, places an agent, reconnects, resets and reopens saved
items` is present and passed in `/tmp/builder-2079/rework/replay.json`. Exact-head
replay was not repeated; the verdict confirms unchanged production `src/` between
that revision and reviewed head. The earlier read-observer run at `1736d627`
executed/passed **7 tests, 0 failed/skipped/retried**, including `read setup is reused
across committed same-row deltas on short and long threads` and the hidden, queued,
uncommitted-tail and late-contract exclusions (`/tmp/builder-2079/read-fixed.json`).

Earlier failures remain failures. The installed `ad83461f` macOS probe received all
8,333 items but applied only 2,501 after 44,823 ms and exceeded teardown's budget:
a finite backlog. Initial batching still produced a 44-second heartbeat gap.
Protected storage measured a **14,314 ms** synchronous mutation and **17,187 ms**
input latency; acceptance waited for #2087/#2088. The
[item-store testing record](thread-item-store.md#testing) retains the failed
protected-coverage replay and storage rollback timeout, isolated retries and
follow-ups [#2153](https://github.com/pyrycode/pyrycode-desktop/issues/2153) (merged)
and [#2155](https://github.com/pyrycode/pyrycode-desktop/issues/2155) (open).
Initial terminal-cleanup and shutdown-visibility failures were resolved by rework. The verifier's first mounted sandbox attempt
failed all four cases at loopback setup before assertions. The
[plan](../../specs/architecture/2079-bounded-thread-updates.md#validation-and-hold)
retains earlier failed runs and artifact references.

These recorded Linux client results establish no fresh provider/daemon behavior;
none is required for this renderer repair. macOS is outside this ticket's current
verification scope. Only the docs guard runs in the documentation stage.

### On-demand child validation

The [accepted verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2116#issuecomment-6258925278)
for #2102, stage `723e52c7`, records Linux validation on 2026-10-19 at
`1864014571f037af499516cdfa3c9c67f5e1856c`. The documentation handoff's dispatcher
gate-4 report counts **9,537 unit tests executed/passed, 0 failed, 3 skipped**;
the accepted verdict separately reports **9,615 executed/passed, 0 failed,
3 skipped**, including all **124 received-frame/preload/runtime cases** and
**25 adjacent cache cases** present and passed. The supplied aggregate totals
differ and are retained separately rather than combined.

The dispatcher report explicitly lists passing `child pages traverse production
frames and preload, preserve zero ties and continue only on demand`, `marker-only
empty success is cached, and unknown optional facts remain absent`, `failed
continuation retains incomplete summaries and retry starts a replacement first
page`, and `mixed body/child saturation leaves complete queries progressing
without prefetch`. It also lists the passing byte/record-eviction, normalized-limit,
two-host, changed-revision, offline/reconnect, last-release, all-lease retirement
and deadline cases. Its named retry regressions include `replacement child retry
acknowledges one failure across pages and requires retry after another`, `a later
in-flight sibling failure invalidates a replacement enumeration acknowledgment`
and `queued child continuation rechecks a later sibling failure before dispatch`.
The latter positively observes queued work and both failures before excluding a
new request, then proves explicit first-page recovery, inert late replies,
duplicate continuation and completion using replacement summaries alone.
Canonical state and receipts remain unchanged. See the
[plan's regression inventory](../../specs/architecture/2102-direct-child-pages.md#state-transitions-and-identity-reuse).

Dispatcher gate 7 and the accepted verdict record the configured Linux Playwright
run: **505 executed/passed, 0 failed, 5 skipped**. The named captured scenario
`daemon-built thread streams, places an agent, reconnects, resets and reopens
saved items` was present and passed. The verdict identifies the skips as three
macOS-only cases, the existing system-prompt-reset fixme and the unreachable-host
unpair case awaiting #2089; none supplies acceptance evidence. Builder's final
affected run records **149 executed/passed, 0 failed, 0 skipped** and its guarded
focused thread replay **1 executed/passed, 0 failed, 0 skipped**, with zero
forbidden launches. The original assertions and strict outgoing matching remain.

The thread recording is historical: captured 2026-10-16 at Desktop `00ec821f`
and daemon `58f46aa5`. Frame tests exercise production connection, command/event
validation, mocked Electron IPC, preload and runtime; replay exercises the actual
application with captured messages. These recorded runs establish synthetic
client handling, with no fresh provider, physical-effect, cryptography or native
transport acceptance claim. macOS is outside this Linux ticket's verification
scope. See [recorded tests](../../recorded-tests.md) and the
[replay inventory and exclusions](../../client-replay-migration.md).

### On-demand body validation

The accepted verifier stage `fd6b8506` for [#2101 / PR #2108](https://github.com/pyrycode/pyrycode-desktop/pull/2108)
records Linux evidence on 2026-10-18 at
`1ce9eaf139a5607ef1bfadb54487cd40e867ce9b`: **9,511 unit tests executed,
9,511 passed, 0 failed, 3 skipped**. All **48 frame/preload/runtime cases** in
`e2e/threadBodies.test.ts` and **18 cache cases** in `threadBodies.test.ts` were
present and passed. The three skipped unit cases require credentialed relay/Noise
execution; suite and unhandled-error audits were empty.

That counted run includes `runtime body tool_call traverses frames and preload,
completes only at marker and reopens from cache`, `navigation back to the same
strings creates new demand ownership and never adopts a late old failure`,
`two hosts with colliding identities keep frame results isolated through the real
bridge and runtime` and `reconnect leaves retained bodies stale until explicit
fresh demand, and offline missing sends nothing`. It also includes the passing
`byte eviction preserves failed revalidation until explicit retry`, `record
eviction preserves failed admission until explicit retry`, saturation/scope-clear
cases, all-lease retirement callbacks and the production regression `navigation
cannot restart failed body work through a second existing lease in a retirement
callback`. The [plan's regression inventory](../../specs/architecture/2101-tool-body-demand.md#revisions)
maps the remaining parameterized lifecycle and boundary proofs. Synthetic frames
exercise `createDaemonConnection`, command/event validation, preload and runtime;
the Electron bridge is mocked in Vitest and establishes client contract handling.

The configured Linux application gate executed **499 tests: 499 passed, 0 failed,
5 skipped**, with no flaky results or report errors. All **29 captured scenarios**
were present and passed, with zero remaining requests. Skips were three macOS-only
cases, the existing system-prompt-reset fixme and unreachable-host unpair coverage
awaiting #2089. The captured thread scenario, `daemon-built thread streams, places
an agent, reconnects, resets and reopens saved items`, matched 45 requests and
emitted 378 frames. Its source capture is historical:
`2026-10-16T12:29:37.005Z`, Desktop `00ec821f9380b00cf2dfc0dd4817ee15584106a5`,
daemon `58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`.

Builder evidence independently records **2,396 affected tests executed/passed,
0 failed, 0 skipped**, plus the focused guarded thread replay **1 executed/passed,
0 failed, 0 skipped**. Accepted verifier pre-verify passed three checks and
deliberately skipped two with `--no-suite`; install, docs guard, build/typecheck
and Electron native preparation passed. These are recorded runs, not
documentation-stage reruns. Captured replay and synthetic handling supply no new
fresh-provider, physical-effect or encryption proof; none was required by this
client-contract operation. macOS is outside this Linux ticket's verification scope.

### Production activation validation

The final Mac fake-daemon suite on 2026-10-15 executed and passed 434 cases,
with zero failures, retries or flaky cases and 20 skips. Source was
`8d2f3a03d69c7b81019354feca58d42e0008d977`. All 1093 tracked source/configuration
files matched the frozen executed copy. The full unit suite passed 10391 cases
with 38 existing skips. Build, pre-verifier, documentation and packaged storage
checks also passed.

The final report contains all 15 `thread-activation.spec.ts` cases, all 12
`thread-items.spec.ts` cases and the single `timeline-frame-deltas.spec.ts` case,
each executed and passed. Production cases cover fresh creation/send, identity and
bridge failure, host isolation, session/error/prompt controls, saved offline display,
restore/live overlap, interrupted catch-up, epoch replacement, queue recovery,
deletion/unpair, older paging and capability recovery.

The [activation plan](../../specs/architecture/1908-thread-activation.md#manual-completion-shared-fake-migration-and-client-regressions)
retains that historical run's exact counts and hashes and the now-completed
19-case retirement inventory. Its twentieth skip was the pre-existing
desktop-isolation case. Cleanup allocation is tracked in
[#2020](https://github.com/pyrycode/pyrycode-desktop/issues/2020#issuecomment-6200547647).
The [fake publisher](e2e-harness.md#scripted-and-native-thread-fixtures) supplies test
protocol data only. These checks establish no credentialed real-daemon pass.
The [live runbook](live-e2e-runbook.md#current-real-claude-gate-state) records the
remaining required scenarios and executable provenance.

### Navigation retirement validation

The [#2028 verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2031#issuecomment-6205882433)
records Linux gates at `d3df5ec300026501d3a8d52488dfdba696609aeb` on 2026-10-16:
10,196 unit tests executed/passed, 0 failed, 30 skipped across 415 files; build and docs guard passed.
The complete configured fake-transport suite executed and passed 432 tests, with 0 failed,
10 skipped, 0 flaky and 0 retries. Both configured projects and four workers ran without selection
or shard filters; seven skips concern retired legacy scenarios and three are macOS-only cases.

All 15 `thread-activation.spec.ts`, all 12 `thread-items.spec.ts` and the single
`settings-per-server-unpair.spec.ts` case are explicitly present and passed in that counted Linux
run. They include deletion/owning-pairing cleanup, host isolation and both committed-visible-
authoritative-read variants. No top-level errors or fake-daemon-setup attachments were reported.
At that revision the navigation factories retained seeded legacy-store preservation assertions;
\#2030 removes those setups with the deleted producers. Tests exclusive to stamping and its
removed subscription had already been deleted.

Historical macOS task `db47ef552e357d3da36abf43f54891dbcfc0aee1588e9a697235800c8860e37e`
ran candidate `4d695203d5035b69ba02d77f1368e2809ead676d`: 434 executed/passed, 0 failed,
17 skipped, 0 flaky and 0 retries out of 451 configured cases. All 15 thread-activation, 12
thread-items and one settings-per-server-unpair case were present and passed there too. The
verifier inspected all six artifacts; capture, JSON and list/execution logs agreed and the
configuration hash matched that candidate. All seven #2028 production modules are unchanged
between that candidate and the Linux gate head. Later main changes to #2029 saved IO and #2033
scroll-test readiness are covered by the Linux gates. These native counts establish only the
recorded historical candidate; current-head macOS checks are outside this Linux ticket's scope.
No real-Claude or visual result is claimed for this navigation-only change. The
[plan](../../specs/architecture/2028-retire-navigation-bookkeeping.md#returned-native-evidence--2026-10-16)
retains the full candidate/configuration and skip breakdown.

### Renderer producer retirement validation

The [#2030 verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2039#issuecomment-6208863531)
records Linux gates on 2026-10-16 at
`c42a778299612f1b9ac0f2d786cc02dc132fe2ae`: units **9,152 executed/passed,
0 failed, 30 skipped** across 392 passing files; complete configured fake Playwright
**435 executed/passed, 0 failed, 3 skipped, 0 flaky**, four workers, clipboard/parallel
projects, no selection/shard filters and zero retries. The skips are two macOS badge
cases and the macOS window-reopen case. Install, docs guard, build and both native
addon rebuilds passed. Pre-verify ran three checks and intentionally skipped two
with `--no-suite`; units and typecheck ran in the subsequent unit/build gates.

All 15 `thread-activation.spec.ts` and all 12 `thread-items.spec.ts` cases are
explicitly present and passed, including both committed-visible-authoritative-read
widths, missing-`thread` recovery, paging/checkpoint recovery and owning-scope cleanup.
The retained activation cases assert zero legacy content requests on opening,
reconnect, paging and retry. Both indexed-history lifecycle cases also passed.
No broader suite or shared fake publisher was disabled; active cases in mixed
files, cache/removal/restart and conversation-feature coverage remain.

The last seven retired renderer-only cases were removed with their producers:

| File | Removed cases |
| --- | ---: |
| `history-gaps.spec.ts` (file deleted) | 2 |
| `reconnect-event-replay.spec.ts` | 1 |
| `queued-own-settlement.spec.ts` | 2 |
| `history-on-open.spec.ts` | 1 |
| `visible-tail-read.spec.ts` | 1 |

Together with three presentation cases removed in #2023 and nine recording cases
removed in #2029, this completes the [19-case inventory](../../specs/architecture/1908-thread-activation.md#manual-completion-shared-fake-migration-and-client-regressions).
Producer-exclusive unit regressions retired only with their implementations;
shared translator/presentation tests remain. The verdict references dispatcher
`verifier-gate_#2030.pass.json`, unit `_5.log` and Playwright JSON `_8.log` in its
logs directory. These are recorded gate results, not documentation-stage reruns.
macOS is outside this Linux ticket's verification scope. No real-Claude result or
visual capture is claimed; existing live obligations remain in the runbook.

### Main request and recovery retirement validation

The [#2025 verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/2049#issuecomment-6209638001)
records Linux gates on 2026-10-16 at
`aed31cfc8fae69954696af09909f53643541ce6d`. Full units: **9,037 executed/passed,
0 failed, 3 skipped**, 391 passing files. Complete configured
`npx playwright test --reporter=json`: **435 executed/passed, 0 failed,
3 skipped, 0 flaky, 0 retries**, four workers, clipboard/parallel projects and no
selection/shard filters. All 15 thread-activation, 12 thread-items and 3
markdown-reader-menu cases were present and passed. The activation cases include
missing-`thread` isolation/recovery and zero legacy requests on open, reconnect,
paging and retry; the dispatcher's named `paging and retry` result also passed.
No top-level errors or fake-daemon setup error attachments were reported.

Install, docs guard, build and Node/Electron addon rebuilds passed. Pre-verify
used `--no-suite` (three checks passed, two intentionally skipped); subsequent
unit/build gates covered units/typecheck. The three fake skips were two macOS
badge cases and the macOS window-reopen case. macOS is outside this Linux ticket's
verification scope. Credentialed real-Claude tests were not run or claimed.

The [builder's recorded runs](../../specs/architecture/2025-retire-history-recovery.md#validation-evidence)
retain the initial complete Linux fake run at
`072e01596f5c2a57e93aedca33ffc86e5b0fe8ae`: **435 executed, 434 passed,
1 failed, 3 skipped**. The 800px reader return-scroll assertion expected 1300 and
received 1020. A one-test isolated-main comparison passed (1 executed/passed,
0 failed, 0 skipped); that diagnostic does not establish attribution. Cause
remains under investigation in [#2047](https://github.com/pyrycode/pyrycode-desktop/issues/2047).
The builder's final complete rerun at
`afe635930ce58ffba12c02bc6537cd424ba1c4e7` passed **435 executed/passed,
0 failed, 3 skipped**, followed by the complete verifier pass above. Neither
complete pass skipped or weakened the reader assertion; the earlier failure
remains recorded as failed.
