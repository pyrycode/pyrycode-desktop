# Compact projection runtime

`runtime.open(host, chat, { projection: 'compact-v1' })` explicitly selects the
session-only `runtime.compact` owner in
[`threadCompact.ts`](../../../src/renderer/src/store/threadCompact.ts).
The owning handshake must accept `interactive`, `thread`, `thread_expansion` and
`thread_compact`. Advertisement alone never selects compact delivery:
omitted options and ordinary production opening
retain the complete route. Unsupported or unknown projections refuse without a
complete-history fallback. Presentation, row demand wiring and integrated activation
belong to #2081. [ADR 0016](../decisions/0016-session-only-compact-projection.md)
records the separate authority boundary.

First selection uses `thread_catch_up` with `projection: 'compact-v1'`, version
zero and an initially empty epoch to request a bounded newest root window. Older
uses `thread_page` with the accepted epoch and certified root boundary. Switching
between complete and compact initializes the destination query at zero while
preserving independently held complete items/checkpoints. Incompatible compact
reselection retains readable facts, invalidates detail and drops prior coverage.
Reconnect can resume only a completed compact checkpoint for the same host,
conversation, projection and epoch; a saved complete checkpoint cannot seed it.

## Root facts and independent evidence

Compact snapshots merge full non-tool/agent roots with metadata-only tool/agent
headers by identity and sort by `(order, id)`, including zero-order ties. Per-item
source versions, revisions and supplied `subtree_version` prevent a delayed query
from replacing newer admitted live facts. Equal conversation versions may replace
distinct roots, and a same-revision header can supply newer freshness. Missing
freshness stays unknown rather than becoming zero or inheriting an older value.

| Evidence | Authority |
| --- | --- |
| Root rows | Supplied root facts only; a header holds no downloaded body or descendant inventory. |
| Root ranges | Only a matching separate successful query marker certifies its root window. |
| Compact checkpoint | Successful newest/catch-up completion supplies resumable compact evidence. Older-page completion cannot advance it. |
| Consumed progress | Admitted live intervals, including hidden-only progress, advance consumption without inventing rows or a checkpoint. |
| Child enumeration | Only successful replacement/continuation pages can establish that enumeration's completeness at its capture. |
| Body freshness | Matching revision/scope, adequate capture version, data and success marker are required; root coverage supplies none of these. |

Assembly final establishes a logical payload only. Interrupted data may remain
readable without any new certificate. A live `from_version` gap records a repair
target and requests bounded catch-up from the certified checkpoint. Overlapping
intervals still admit distinct replacements. Older-page success cannot discharge
a live gap. A matching reset replaces compact scope and requests a version-zero
newest window; failed recovery requires explicit Retry, including after Older,
reopening or reconnect. The single initial query/live cancellation recovery is
bounded and cannot become a refusal loop.

Compact facts, headers and expansion replies never enter canonical complete items,
owned persistence writes or unseen-content read receipts. Saved-complete restoration
remains available only on the complete route. Offline compact reopening reads no
disk and exposes only session-held roots/detail with truthful stale/missing state.

## Demanded detail refresh and retirement

A newer admitted revision or changed/unknown ancestor `subtree_version` invalidates
retained detail even when ancestor `rev` is unchanged. Without descendant inventory,
the owner conservatively invalidates detail across the selected scope. Existing
content remains readable as stale; absent content remains missing. Active leases
coalesce replacement work into one microtask under the existing
[finite cache limits](thread-runtime.md#shared-body-and-child-cache).
Undemanded bodies, unopened rows and next pages send no reads.

Invalidation cancels queued/active attempts, updates demanded revisions and removes
child cursors so refresh starts at page one. Old summaries can remain incomplete
until replacement data arrives; only replacement pages can complete the enumeration.
Further pages still require explicit `continue(cursor)`, validated against the
entry's current admitted revision rather than the lease's original request.
Attempts capture the admitted minimum compact version and reject older captures.
Child summaries can update demanded child revisions before queued wire dispatch.
Late root/detail results cannot make obsolete content fresh. A failed entry remains
failed through invalidation, changed limits or eviction until its lease explicitly
retries.

Compact recovery and body/child reads share one per-host wire lane for Core's single
unfinished-query slot. The lane has a bounded queue and deadline. Locally cancelling
an attempt does not stop Core, so replacement work waits for terminal delivery or
expiry. Detail outcomes must settle in the cache owner **before** lane release;
the lane then rechecks parent-scoped failure admission at actual dispatch. Checking
only the cache queue would let a sibling limit variant slip through after another
read fails. Explicit retry authorizes that replacement enumeration's continuations,
not unrelated variants.

Navigation, disconnect, epoch/reset replacement, deletion, successful unpair and
disposal retire pending queries, refresh work and leases with connection, selection,
request and generation ownership. Mutations recheck captured ownership after
synchronous invalidation/store callbacks and before publication or follow-up dispatch:
a callback can delete, dispose, disconnect or reopen the same IDs during delivery.
Checking only handler entry can resurrect retired state. Disconnect keeps previously
held facts readable without admitting the interrupted update; another host's equal
IDs remain independent. Clearing a scope or disposing removes its retained state.

## Validation evidence

The [accepted verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2124#issuecomment-6260677987)
and authoritative stage `db1aeb178b714752a8387c3b86dd6ca2daf45666531ef84914b3e0b1ed58cb70`
record Linux validation on 2026-10-19 at
`bbeca34f574ebaaab9928e871e6625ceba95cea6`. The supplied dispatcher gate report
records **9,600 unit tests executed/passed, 0 failed, 3 skipped**; the accepted
verdict reports **9,678 executed/passed, 0 failed, 3 skipped**, across 407 files.
These differing aggregates remain separate. The verdict confirms all **162
received-frame/preload/runtime cases executed/passed, 0 failed/skipped** in
`e2e/threadBodies.test.ts`, including the nine rework regressions.

That file includes passing `compact frames certify roots separately, sort mixed
ties, page with epoch and consume hidden progress`, `compact assembly final holds
facts but only the separate query marker certifies coverage`, `compact child
failure blocks queued limit variants until their explicit retry, including
continuations` and `compact Older and reconnect preserve failed recovery admission
until explicit Retry`. Its remaining cases cover query/live overlap, same-revision
invalidation during reads, unknown freshness, refreshed-parent continuation,
reentrant delete/dispose/disconnect/reopen, reset, host isolation and offline held
state. The [plan](../../specs/architecture/2103-compact-projection.md#revisions)
records the regression boundaries. Synthetic received frames exercise the production
connection, command/preload and runtime path with mocked Electron IPC.

The complete configured application run recorded **506 executed, 504 passed,
2 failed, 5 skipped**. The dispatcher accepted a same-tree rerun of **3 executed,
3 passed, 0 failed/skipped**, including both initially failing identities:
`connection pills clear and float over hidden rows`
([#2120](https://github.com/pyrycode/pyrycode-desktop/issues/2120)) and captured
`a real daemon lazily fills a served gap after more than 200 entries written while
Electron is closed` ([#2072](https://github.com/pyrycode/pyrycode-desktop/issues/2072)).
The accepted flaky disposition makes the gates green without erasing the failures.
Captured-client replay initially recorded **28 executed, 27 passed, 1 failed,
1 skipped**; its failed identity passed in that rerun. The captured thread scenario
`daemon-built thread streams, places an agent, reconnects, resets and reopens saved
items` was present and passed in the complete run. Builder rework separately records
**220 affected units executed/passed, 0 failed/skipped** and that guarded thread
replay **1 executed/passed, 0 failed/skipped**, with zero forbidden launches.

The [earlier failed verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2124#issuecomment-6260161825)
at `869c02ee` retains the prior complete run's **506 executed, 504 passed, 2 failed,
5 skipped**, retry **3 executed, 1 passed, 2 failed, 0 skipped**, and unchanged-main
comparison **3 executed/passed, 0 failed/skipped**. Its failures,
`finite protected writer backlog preserves native keyboard and both event loops`
([#2125](https://github.com/pyrycode/pyrycode-desktop/issues/2125)) and
`restore overlapping live content retains complete progress across an interrupted
catch-up and epoch replacement`
([#2122](https://github.com/pyrycode/pyrycode-desktop/issues/2122)), both passed in
the accepted complete run. Their independent trackers and causal investigations
remain separate from this change. The focused verifier regressions initially
recorded **4 executed, 0 passed, 4 failed, 0 skipped**; those failures are historical
evidence of the repaired admission/retirement defects.

The accepted stage's evidence bundle retains the verdict, report tails and rerun
`2026-10-19T05-51-04-022Z_verifier-gate-rerun_#2103.log`; `pointers.json` locates
full gate-4/gate-7 reports under the dispatcher's logs directory. Pre-verify passed
three checks and deliberately skipped two under `--no-suite`; separate units,
build/typecheck, install, docs guard and Electron native preparation passed.
These are recorded Linux runs, not documentation-stage reruns. Captured replay is
offline client-contract evidence, including the historically named real-daemon
scenario; it proves no fresh provider, physical transport or encryption behavior.
Those live runs were not required for this nonvisual slice. macOS is outside this
ticket's verification scope.
