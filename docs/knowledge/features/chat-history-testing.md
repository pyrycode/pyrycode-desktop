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

The known-gap scenario in [`history-gaps.spec.ts`](../../../e2e/history-gaps.spec.ts)
measures eligibility before each fresh ArrowUp, including after protected restoration.
A successful programmatic park or screenshot can precede a layout pin that moves
the marker out of view. Its local helper moves the pointer away, focuses the thread,
and polls for scroll offset, content height and viewport dimensions stable within
0.1px over three animation frames. It then centers the marker between the measured
top/input chrome, settles movement, and asserts focused, positive-height marker
intersection with that unobscured reading area and unchanged request count.
Older-end `isNearTop` readiness cannot establish gap eligibility. One fresh key
must add exactly one request with `gap-start`, or the saved `gap-step` after reload;
retain negative/pending-input, no settlement cascade, failure/Retry, sub-two-pixel
anchor, expanded-tool and final-content assertions. See
[controlled cause and counted validation](development-verification-history.md#known-gap-recovery-verification).

The real-daemon gap scenario preserves the same demand contract across a full
Electron exit: save served/display baseline evidence, write all 205 posts while
closed, reopen the same protected profile, and ask newest exactly once with the
empty cursor. Programmatic positioning asks nothing; each fresh focused ArrowUp
at the visible gap asks once, settlement asks nothing, and the resolved transcript
places the baseline before all 205 posts in order, each appearing once.

Its scenario-local `asks(): Promise<string[]>` polls only inspection availability
through `readMainProcess`, bounded at five seconds. `NOT_YET_AVAILABLE` cannot
satisfy a count assertion; every caller gets an actual successful read, including
the immediate empty-cursor and no-cascade checks. A count read failing after a key
does not establish a rejected request or invalid geometry. Never replay the key,
observer installation or posts to recover inspection; other errors propagate.
See [observer recovery](e2e-harness-context-recovery.md#tolerating-a-transient-inspection-context-loss-on-reads)
and [diagnosis and counted live evidence](development-verification-history.md#known-gap-recovery-verification).

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

[`indexedLegacyHistory.test.ts`](../../../src/main/indexedLegacyHistory.test.ts)
uses real temporary SQLite databases with reversible test encryption. Fresh
owners after close/reopen compare parser-normalized snapshots, including fragmented
served/display/gap evidence, ordered child memberships, all durable row fields,
optional absence, empty evidence and saved-empty versus missing. Equal/misleading
timestamps must not affect supplied order. Case variants and equal conversation ids
on different hosts remain distinct.

The parameterized `isolates every UTF-16 %s across restart, replacement and removal`
covers both ownership coordinates with distinct lone high/low surrogates, U+FFFD
and a valid surrogate pair, checking missing peers as well as saved peers. Ordinary
case-sensitive strings alone cannot reveal SQLite TEXT encoding collisions.
The migration regression preserves identities and ciphertext, injects both migration
and post-migration decryption failure, compares unchanged bytes, then retries.

Trigger failures during insertion/cascading deletion and mid-write encryption failure
exercise rollback, later recovery, peer isolation and fresh identity after replacement
or delete/recreate. Corrupt indexes/payloads, unsupported schemas, unavailable
encryption, invalid requests and mismatched coordinates must preserve committed data.
Sentinel checks inspect all files in the history directory (including any sidecars)
and captured diagnostics after success and rollback for message, attachment and
cursor leakage; the durable-row fixture also checks raw unknown text on disk.
These fixtures prove the protected persistence
seam; production OS encryption requires the packaged proof below.

### Bounded legacy page regressions

The same on-disk `indexedLegacyHistory.test.ts` fixture covers callable page reads;
an in-memory database or same-instance traversal alone would miss durable
continuation and reopen failures. The 603-row traversal closes and creates fresh
database owners between 200-row windows, preserving held order, repeated content,
timestamp ties and ordinal-minus-prepended fallback keys. It compares the full
snapshot after paging. Missing versus saved-empty and absent optional evidence
need separate assertions; none establishes daemon completeness.

Fragmented fixtures check selected display ranges, served ids and receipt
memberships, original receipt identity/order and selected membership order,
explicit `partial: true`, both gaps at a shared numeric boundary, selected legacy
gap keys and omitted refused cursors. A separate range/anchor case checks that
only the nearest receipt start supplies the adjacent cursor and that anchor ids
stay outside selected served/receipt membership. Rendering the right rows alone
would miss evidence widening or invented served provenance.

Admission cases reject malformed limits/boundaries, wrong format, cross-owner
reuse, identical replacement and delete/recreate continuations. Parameterized
page ownership cases exercise both coordinates with distinct UTF-16 ids,
including lone surrogates and U+FFFD. Selected corruption cases cover ciphertext,
indexes, row/contribution bindings and protection errors without changing saved
data; an unreadable unselected row stays untouched. Original unwrapped records
remain page-readable. The schema-3 regression removes the receipt-start index,
stages schema 2, injects selected decryption failure and checks rollback of the
index/version and preservation of committed identity before successful retry.
Query-plan inspection must show `legacy_receipt_start` for anchor selection:
bounded returned payloads alone would miss scanning every non-start membership.

The bounded-work regression instruments SQLite result records, JSON decodes and
decrypts. Growing unrelated older history from 600 to 2,000 rows, with additional
receipts/cursors and a single receipt spanning the older history and selected
window, leaves the measured counts equal. Exactly 200 row payloads are read;
only selected evidence/necessary anchors are processed, and at most one order-only
row probe is allowed. Decodes and decrypts each equal the number of row/evidence
payloads read. This is bounded by selected content and relevant evidence, not a
promise of constant evidence size for every row: the heavily fragmented-row case
retains all 1,200 contributions and memberships. Range queries batch at most 100
predicates so one row cannot exceed SQLite's expression-depth limit.

The [verifier verdict for the paging change](https://github.com/pyrycode/pyrycode-desktop/pull/2012#issuecomment-6190982424)
records 10,319 unit tests executed/passed, 0 failed and 3 skipped, including all
26 backend cases, on `de25c375f42755f5da20a4c4003c790e9525522a`. Its fake-transport
gate recorded 428 executed/passed, 0 failed and 3 skipped. These callable
main-process operations require no real-Claude or visual acceptance; application
binding and page consumers remain separate work.

### Native runtime and packaged proof

Host-Node Vitest and Electron use different native ABIs. `npm run rebuild:node`
runs `npm rebuild better-sqlite3` for host tests; `npm run rebuild:electron` runs
`electron-builder install-app-deps` for Electron. Rebuild for the runtime being
used after switching ABIs. Production packaging sets `npmRebuild: true` and
`asarUnpack: node_modules/better-sqlite3/**`; a Node import alone cannot prove the
packaged adapter loads.

On Linux/macOS, `npm run check:history-native -- /tmp/history-native-proof` packages
an isolated entrypoint, launches the packaged Electron app and writes `runtime.stdout`
and `runtime.stderr` beneath the supplied scratch directory. It uses the actual
`electronSecretEncryption`, commits, closes and reopens the database, compares
parser-normalized content structurally, checks persisted sentinels and reports
versions, packaged/asar/native-unpacked flags, static stage and nonzero test counts.
Failure or missing/all-skipped evidence is nonzero. It adds no release channel.

[`history-native.spec.ts`](../../../e2e/history-native.spec.ts) includes
`packaged protected history commits and reopens with production encryption` in the
ordinary Playwright configuration and attaches stdout/stderr. This lets a managed
`desktop-fake-suite` task exercise the native proof on the exact pushed candidate
through normal manager admission. On macOS follow the approved Electron-launch
route from the project instructions. Other platforms explicitly skip this case;
direct smoke invocation rejects them before packaging imports or scratch creation.
[`historyNativePlatform.test.ts`](../../../src/main/historyNativePlatform.test.ts)
pins Windows rejection. Windows execution and NSIS packaging were not run for this
ticket; existing NSIS x64/arm64 targets remain unchanged.

The [final verifier review](https://github.com/pyrycode/pyrycode-desktop/pull/1996#issuecomment-6189261285)
confirmed retained production-encryption artifacts from candidate
`f2ef9815571c2ce773a0d736e0ec32d0f26b776a`, whose backend/native/dependency/packaging
files match the reviewed head. The named packaged case above is present and passed
on both platforms, with `packaged`, `asar` and `unpacked` all true:

| Platform/architecture | Electron | Embedded Node | better-sqlite3 | Encryption backend | Executed | Passed | Failed | Skipped |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| Linux/x64 | 33.4.11 | 20.18.3 | 12.4.1 | `gnome_libsecret` | 1 | 1 | 0 | 0 |
| macOS/arm64 | 33.4.11 | 20.18.3 | 12.4.1 | `os-keychain` | 1 | 1 | 0 | 0 |

Linux evidence is `/tmp/pyry-history-native-oIcJN0/runtime.stdout` and
`/tmp/builder-1979/rework-54c52c4c/linux-native.log`. Managed Mac task
`3e410b97e50a5471f7ce4e37030f5781e4ad1f84b12f515c8520d95a72e515e8`, run
`9297b2992b3b45cb013a6c5f392611eb5e33ca3e7526636e4eb6853acefc73cd`, returned
`/tmp/builder-1979/rework-54c52c4c/mac-results/desktop/playwright.json` with complete
native stdout/stderr attachments; its native case passed in 8.899 seconds with
empty stderr. Exact runtime JSON and artifact locations also live in the
[architecture plan](../../specs/architecture/1979-protected-indexed-legacy-history.md#revisions).

That earlier full Mac suite was not green: 408 executed, 406 passed, 2 failed,
1 skipped, 0 retries. Its pre-launch HTTP 404 remains tracked by #1983 and missing
connect-b completion by #1998; neither is native-backend evidence. The dispatcher's
later supplied verifier gate 6 reports 414 executed, 413 passed, 1 failed, 3 skipped;
`native view retires on unpair` and
`connect roster Agents appear before history and keep identity through live and historical launches`
are individually listed as passed. Its aggregate counts do not identify the native
case, so the retained per-platform artifacts above establish that proof. No live
Claude test is required for this unbound storage backend.

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
[counted verifier evidence](development-verification-what-each-test-tier-proves.md#what-each-test-tier-proves).

## Browser persistence and lifecycle

[`message-reply.spec.ts`](../../../e2e/message-reply.spec.ts)'s enabled
`received history is saved for equal ids on different hosts and replies reopen offline`
uses two hosts advertising `seed-conversation` with distinct assistant replies.
It polls each protected `readTimeline` result, visits the second chat, disconnects
the first host, then reopens its saved chat offline and quotes only its original
reply into that host's draft. Both saved timelines remain independent afterward.
Draft isolation and ordinary saved/offline reply tests remain enabled: either
could pass while received persistence is broken, so neither substitutes for this
regression. See [counted fake-transport evidence](development-verification-what-each-test-tier-proves.md#equal-id-received-history).

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
await delivery separately from successful protected replacement. The receipt is
not proof of the writer's buffered save. Keep immediate fake replies
so synchronization does not remove restoration-overlap coverage; a held reply is
useful for diagnosis, not a replacement for that timing.

The receipt-saturation scenario keeps 500 receipts × 200 ids, evicts only `page-0`
for `repeat`, and preserves oldest-end coverage and the single assistant's key
`-8`. It verifies exactly one newest command (`cursor: ''`, limit 200), retains the
separate 20-second repeated-page receipt wait, then polls successful protected
replacement for five seconds before comparing the complete saved snapshot once.
Later live content uses a host/conversation/message-id-specific `messageReceived`
listener installed before the push, followed by its own five-second save check.
It retains key `42` with next key `43` and checks complete saved-snapshot equality
after a third fresh Electron launch. Reused profiles reconnect through the first
launch's still-running fake; script and observe that daemon. See
[cause and counted validation](development-verification-history.md#served-page-persistence-verification).

Polling a record containing 100,000 receipt ids can consume the deadline while
transferring an old read even after a replacement succeeds. The scenario installs
one forwarding wrapper around the real protected handler in `onLaunched`, after
handler readiness and before navigation. It records item counts only for matching
host/conversation `replaceTimeline` calls returning `ok`. Poll the small observation
through `readMainProcess` for counts `1`, then `2`; retain the full snapshot
assertions to detect incorrect persisted state. Installation is single-shot, and
the original handler is restored before closing. A held-save control confirms
receipt alone cannot release this barrier. Rendered text is also a poor receipt
barrier under contention; the typed event avoids coupling persistence proof to
layout readiness. Alternating CDP/main command observers both reproduced the race,
so this scenario keeps its existing `observeCommands`.

## History continuity and overlap

The continuity scenario starts with incomplete saved coverage, restarts offline,
reads, then reconnects and asks newest once while retaining saved partial-assistant
presentation. Later same-host live text resumes normal rendering; trusted upward
input asks older with the saved cursor. A connected restart checks ordered content,
retained coverage and no duplicate rows. Holding the local read proves zero asks
before settlement, then exactly one newest ask without further reader input.

[`real-daemon-history-on-open.spec.ts`](../../../e2e/real-daemon-history-on-open.spec.ts)
saves a baseline with served/display evidence, fully exits Electron through the
shared protected-profile relaunch fixture, and writes 205 unique `pyry channel post`
entries only in its awaited while-closed callback. Reopening asks newest once
without upward input and exposes the gap. Fresh focused input fills it under the
[demand and observation contract](#demand-and-snapshot-contracts), retaining the
baseline and all posts exactly once in order. `spawnClaude: false` proves real
daemon storage/transport, not a Claude turn or production-relay delivery; see
[counted live acceptance](live-e2e-runbook.md#current-real-claude-gate-state).

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
