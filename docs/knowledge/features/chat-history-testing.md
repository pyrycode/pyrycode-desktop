# Protected local chat history — testing

Verification reference for [protected local chat history](chat-history.md).
Received ownership and storage behavior are defined in the parent overview.

## Demand and snapshot contracts

[`historyDemand.test.ts`](../../../src/renderer/src/store/historyDemand.test.ts)
checks unknown/restored/complete coverage, discarded pending backwards demand,
failure retry from the retained cursor and host isolation. Main connection tests cover abandoned
requests and late replies. [`history-on-open.spec.ts`](../../../e2e/history-on-open.spec.ts)
counts opening/reconnect asks and leave/reopen deferral behind an owned read and
original request. Its IPC observer is installed before pairing/activation, so
counts cannot be confused with commands discarded by host routing. Settle opening
with backwards paging eligible before rejecting composer/synthetic/downward input,
resize and programmatic movement; pending exclusion alone would hide broken input
gates. A separate case withholds opening to prove pending exclusion. Mounted newest
content appears without upward input and arrival creates no scroll cascade.
An empty page needs a later received live frame as a receipt barrier;
row count alone cannot prove that the empty response has settled.

[`newestHistoryDemand.test.ts`](../../../src/renderer/src/store/newestHistoryDemand.test.ts)
covers offline opening, connection edges, navigation/equal-id host isolation,
duplicate sync, read settlement/cancellation/live supersession, pending deferral,
held `atStart`, newest failure/Retry and retained coverage/receipts. Page-first
missing/stored read completion must also be covered after reopening, including a
failed following refresh: read-first tests alone miss disk results erasing newly
admitted rows and evidence. Empty/undrawable/legacy settlement retires loading read
ownership while settled saved presentation survives.

[`chatHistory.test.ts`](../../../src/shared/chatHistory.test.ts) checks row shapes, projection,
detached inputs, limits and coordinates. Read-ID cases round-trip zero/safe maximum, restore older
omitted fields and reject invalid values. Attribution cases round-trip parented/older parentless
rows and reject malformed parents; `toolGroups.test.tsx` checks restored grouping.
[`chatHistoryStore.test.ts`](../../../src/main/chatHistoryStore.test.ts) uses real
temporary files with injected reversible encryption to cover fresh-instance
reads, empty-versus-missing records, host separation, retained unlisted timelines,
held overlapping writes/removals and preservation after read/write/delete failures.
These tests exercise the storage seams without proving the OS keychain adapter.
[`chatHistoryHandler.test.ts`](../../../src/main/chatHistoryHandler.test.ts)
covers membership, rejected requests before record access, ordering and contained
failures for the original six operations; the daemon-cache tests below cover the
additive `readThread`/`replaceThread` operations.

## Recording and removal

[`chatHistoryWriter.test.ts`](../../../src/renderer/src/store/chatHistoryWriter.test.ts)
injects stores, receipt context, scheduling and storage to prove coalescing,
return-to-saved-value suppression, newest-during-write retention, failure recovery,
successful coverage, attribution refusal and capture before eleven-chat eviction.
Equal-id cases alternate stamped hosts before and after buffered writes flush,
checking distinct text, turn completion and coverage without crossover. Explicit
saved restoration followed by a same-host receipt must keep recording even when
both lists claim the id. Separate refusal cases retain unknown/directly installed
rows through a later stamp and reject missing origins and ambiguous local echoes;
a store-cleared host replacement must not be treated as retained contamination.
Cancellation regressions must include later live content and retained coverage;
checking only echo addition or its immediate removal misses a writer that has
silently stopped recording the held chat.

Removal regressions hold membership checks and protected writes, then use fresh
storage instances to verify absent lists and omitted timelines, stale admission
rejection, other-host preservation and fresh saves after re-pairing. Writer tests
also hold removal through shutdown for both outcomes.
[`chat-history-removal.test.ts`](../../../e2e/chat-history-removal.test.ts) combines
receipt-stamped holders, the real scoped-clear selector and protected storage.
Its same-session re-pair must save only fresh text for an omitted timeline. Manually
clearing all timelines or restarting before re-pairing masks the retained-slice bug.
The recording Playwright scenario re-pairs before restart, then checks persistence
after restart and no added history downloads.

Conversation-deletion regressions hold real protected-store list and timeline writes,
deliver confirmation with buffered and later stale captures, and await flush/stop
before fresh-instance reads. They check both removed records, same-host peers and
another host's equal id. Empty/partial lists and eviction must retain timelines;
failed cleanup must preserve content without a success diagnostic. The recording
Playwright test holds confirmation after the delete command, proves retention, then
waits for the actual `removeConversation` result to be `ok` before asserting absence
and restarting. Renderer disappearance or an early missing read cannot prove cleanup
or ordering; the scenario withholds list refresh responses throughout deletion. Its two
`__conversationRemovals` counter reads go through the shared `readMainProcess` helper, bounded at
five seconds, so a transient loss of Electron's inspection context does not redden the scenario (see
[E2E test harness § Tolerating a transient inspection-context loss on
reads](e2e-harness-context-recovery.md#tolerating-a-transient-inspection-context-loss-on-reads)); the counting
wrapper's own install stays a single un-retried call.

[`daemonItemCache.test.ts`](../../../src/renderer/src/store/daemonItemCache.test.ts)
injects the optional thread source into the same writer. It holds an in-flight save
while newer snapshots and an epoch replacement arrive, then checks the final owned
snapshot and the equal-id peer host. Hydration schedules no write; subsequent owned
facts remain saveable. Confirmation during buffered/held saves clears the held
conversation, suppresses later captures and queues removal behind admitted writes.
Successful/failed unpair cases exercise the pause, off-screen scopes, delayed reads,
other-host preservation and fresh same-host reuse rather than restarting away
ownership bugs. `stop()` must detach the thread observer and finish its owned work.

[`daemonItemHistory.test.ts`](../../../src/main/daemonItemHistory.test.ts) uses the
existing protected filesystem seam and fresh storage services to check coexistence
of legacy/daemon records, equal conversation/item ids on two hosts, and ordered
removal of both formats plus the saved-list entry. Main-handler unpair tests reject
stale reads/writes, remove off-screen records and allow fresh same-host requests.
Malformed IPC/disk metadata, bounded inert JSON, missing optional availability and
unavailable encryption cases check classified failures and preservation of data.
Arrival-order rejection fixtures include missing, duplicate, unknown and invalid
ids; diagnostics remain content-free and inert keys cannot affect object prototypes.

## Restoration

Daemon restoration uses `readSavedTimeline({ threads, ... })` and `readThread`,
separately from the legacy holder path below. `daemonItemCache.test.ts` covers
stored/missing/error/rejected reads settling after live admission, cancellation,
replacement reads, epoch-string reuse and conversation/host/global cleanup. Its
incomplete/repair fixture restores checkpoint 100, applied version 300 and unfinished
version 250: a certificate through 200 clears repair but leaves later live success
fenced until certification covers 250. A completed snapshot's restoration retains
its exact ranges and older availability without adding coverage.

[`daemon-item-cache.test.ts`](../../../e2e/daemon-item-cache.test.ts) is a Node Vitest
integration test, despite its directory. It connects the real writer to protected
temporary-file storage, flushes or stops the writer, constructs fresh storage and thread
store instances, and hydrates through the local reader without Electron or a daemon.
Both completion variants compare snapshots across restart, preserve hidden items,
patch nulls and inert own keys, and apply later live changes on one of two equal-id
hosts. The test encryption backend proves the protected persistence seam, not the
OS keychain adapter. Keeping cross-process imports here avoids pulling renderer
implementation into the composite Node production project.

Permanent restart regressions in that file cover two traps that a same-instance
read misses. `saves live success after abandoning a batch already covered through
%s` uses both 50 and 100 beneath/equal to checkpoint 100, checks that revision and
checkpoint 200 reach fresh storage, then verifies live progress after hydration.
`restart preserves first-arrival ties after order changes and clears` compares
restored and uninterrupted stores after numeric ties and null-cleared orders.
The renderer test `restores snapshots without arrival metadata using their supplied
held order` covers the older-snapshot fallback. These fixtures complement unfinished
progress tests; accepting covered values must not weaken fences above checkpoint.

These supplied-state tests cover cache preparation and local hydration. Production
thread subscriptions, capability activation, actual offline screen display and
reconnect from the saved complete checkpoint through #1902 remain
[#1908](https://github.com/pyrycode/pyrycode-desktop/issues/1908). Existing legacy
browser/liveness proofs below do not establish that daemon-item integration.

[`savedTimelineRestorer.test.ts`](../../../src/renderer/src/store/savedTimelineRestorer.test.ts)
covers explicit admission, row identity metadata and coverage, equal-id host
isolation, delayed success/failure after invalidation, and eleven-chat eviction
and reload. Echo regressions cover same-host reopening, cross-host replacement and
rejection of a delayed read after sending. Writer tests pair restoration with a
subsequent same-host receipt:
restoration and eviction must write nothing, but later content must save with the
restored owner and coverage. Static screen tests cover local notices, host-bound
display and partial-row cursor suppression both connected and offline, normal rendering
after live receipts, and held versus restored queue visibility. Healthy-host interaction
tests assert no `.conversation__banner` at all, so they still reject an additional
connection warning caused by another host's failure.
`beginLocalTimelineRead(host, id)!.complete(null)` is the shortest way to stage a
settled-empty local read in a static screen test: it parses a synthesized empty
snapshot and settles `localRead: 'loaded'` with no items, which is otherwise awkward
to reach through the store's public surface. Removing a piece of rendered copy
silently deletes every `not.toContain`/absence assertion aimed at it too — those
assertions keep passing against a screen that renders nothing at all, so a copy
removal needs a sweep for such assertions and a flip to a positive claim about what
does render (\#1447).

[`savedListRestorer.test.ts`](../../../src/renderer/src/store/savedListRestorer.test.ts)
covers ordered host isolation with equal ids, missing/empty/error results, duplicate
admission and delayed success/failure after received lists, clears and cancellation.
It runs the real writer alongside restoration: installing and clearing local lists
must schedule no save, while a later received list must still record.

[`received-read-marks.spec.ts`](../../../e2e/received-read-marks.spec.ts) separates immediate mounted
dot/badge clearing from persistence: after host A's push, saved host marks remain the received
list values `[0, 2]`. A store update alone cannot prove a saved mark. See
[counted verifier evidence](development-verification.md#what-each-test-tier-proves).

## Browser persistence and lifecycle

[`message-reply.spec.ts`](../../../e2e/message-reply.spec.ts)'s enabled
`received history is saved for equal ids on different hosts and replies reopen offline`
uses two hosts advertising `seed-conversation` with distinct assistant replies.
It polls each protected `readTimeline` result, visits the second chat, disconnects
the first host, then reopens its saved chat offline and quotes only its original
reply into that host's draft. Both saved timelines remain independent afterward.
Draft isolation and ordinary saved/offline reply tests remain enabled: either
could pass while received persistence is broken, so neither substitutes for this
regression. See [counted fake-transport evidence](development-verification.md#equal-id-received-history).

[`chat-history-recording.spec.ts`](../../../e2e/chat-history-recording.spec.ts)
exercises the mounted production observer and handler, real composer cancellation,
quit/relaunch and window close/reopen. It freezes renderer timers after earlier
saves, verifies the final content is still absent on disk, then closes: a test
that waits for the debounce before quitting cannot prove the flush. Reusing the
user-data directory proves disconnected local reads without a new handshake,
including the last list, partial live text and loaded older page. The suite also
covers pairing-rejected access, saved-host validation and zero added history
requests. It also proves restored sidebar browsing after normal quit/relaunch,
a rejected host beside a usable connected host, and mounted local read failures.
The pairing-recovery regression must expect the saved row after startup rejection;
row absence no longer proves rejection. Keep the decoded rejection and actual
repair-click assertions. Restored message UI is exercised by opening and copying
received content after restart, including a rejected host beside a connected one.
A held-IPC result crosses repair opening/cancellation before release, then proves
reading and copying without renderer commands during opening or scrolling. Command
observation must precede main's host routing: absent socket traffic can hide a
renderer command discarded offline. In the held-IPC scenario, observing
`pyry:command` at main avoids CDP function-breakpoint observation stalling the test.
Reload fixtures wait for saved-list persistence and use a newly named received row
as their receipt barrier; saved rows can return without a status replay, so row
count alone is not that barrier. The test encryption backend does not prove the OS
keychain adapter.

Repeated-page persistence needs separate receipt and save barriers. Restored rows
and enabled Send can precede the newest reply; focusing the thread creates no
history demand. Install `observeCommands` and a `historyPageReceived` listener
before opening the saved chat, match the host/conversation/expected cursor, then
await delivery before polling the actual protected `readTimeline` snapshot. The
receipt is not proof of the writer's buffered save. Keep immediate fake replies
so synchronization does not remove restoration-overlap coverage; a held reply is
useful for diagnosis, not a replacement for that timing.

The receipt-saturation scenario keeps 500 receipts × 200 ids, evicts only `page-0`
for `repeat`, and preserves oldest-end coverage and the single assistant's key
`-8`. It verifies exactly one newest command (`cursor: ''`, limit 200), retains the
five-second full saved-snapshot predicate after the separate 20-second receipt
wait, then saves later live content at key `42` with next key `43` and checks
equality after a third fresh Electron launch. See
[cause and counted validation](development-verification-history.md#served-page-persistence-verification).

## History continuity and overlap

The continuity scenario starts with incomplete saved coverage, restarts offline,
reads, then reconnects and asks newest once while retaining saved partial-assistant
presentation. Later same-host live text resumes normal rendering; trusted upward
input asks older with the saved cursor. A connected restart checks ordered content,
retained coverage and no duplicate rows. Holding the local read proves zero asks
before settlement, then exactly one newest ask without further reader input.

[`real-daemon-history-on-open.spec.ts`](../../../e2e/real-daemon-history-on-open.spec.ts)
saves a baseline with served/display evidence, fully exits Electron through the
shared protected-profile relaunch fixture, and posts a unique `pyry channel post`
only in its awaited while-closed callback. Reopening observes exactly one marker
bubble and one newest command without upward input. The marker was absent from the
saved baseline. This proves real daemon storage/transport, not a Claude turn or
production-relay delivery; see [counted live acceptance](live-e2e-runbook.md#current-real-claude-gate-state).

Legacy row-fold overlap fixtures must place the live overlap at the newest end of the newest-first
page. Putting an unmatched older entry first exercises the intentional
stop-at-first-unmatched rule in `withoutLiveEntries`, producing a duplicate instead
of testing overlap suppression. A `messageReceived` entry is the one exception to
that stop rule (#1437): the daemon never pushes a live frame for the operator's own
message, so that entry no longer ends the walk — it is kept and stepped over, and an
unmatched entry beneath it still stops the walk as before. A fixture placing the
operator's own message at the newest end therefore does not, by itself, exercise
stop-at-first-unmatched; put the unmatched entry there instead.

A unit test's comment can cite an e2e spec as corroboration for a stop-rule assertion
that the spec never actually reaches. `e2e/real-daemon-history-on-open.spec.ts`
archives before re-opening, so its page always joins against an empty live key set
and `withoutLiveEntries` returns on the `liveKeys.size === 0` early exit before the
walk runs at all — it was never evidence about the walk's stop rule, and the #1437
fix (above) inverted the unit assertion that comment was defending. Check that a
cited spec's fixture actually drives the code path the comment claims, rather than
trusting the citation.

## Durable type contract

The exact `DurableThreadItem`/`ThreadItem` equality assertion lives in
[`store/chatHistoryContract.test.ts`](../../../src/renderer/src/store/chatHistoryContract.test.ts).
A shared test importing renderer types crosses the composite Node project's file
boundary; the renderer test project can see both contracts without changing
production layering. Exact equality catches added optional fields that mutual
assignability can miss. This proof depends on the web project's TypeScript check
in `npm run build`; running Vitest alone does not establish it. Runtime parser
fixtures still need to cover newly added fields.

**The guard compares against `ThreadItem` minus a named exclusion, not against
`ThreadItem` itself, since [#1565](https://github.com/pyrycode/pyrycode-desktop/issues/1565).**
`turnBoundary`'s six `TurnEndMetrics` fields are deliberately
[live-only](chat-history.md#snapshot-contract), so the old
`expectTypeOf<DurableThreadItem>().toEqualTypeOf<ThreadItem>()` no longer typechecks once they
exist on `ThreadItem`. A local `PersistedThreadItem` type omits `keyof TurnEndMetrics` from the
`turnBoundary` arm and leaves every other arm untouched, and the assertion compares against that
instead. The fix for a live-only field belongs here, narrowing the guard's comparison type —
never widening `DurableThreadItem` to carry a field the persistence layer must keep stripping.
