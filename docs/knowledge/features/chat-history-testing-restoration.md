# Protected history testing — restoration and removal

Part of [protected history testing](chat-history-testing.md).

## Recording and removal

[`chatHistoryWriter.test.ts`](../../../src/renderer/src/store/chatHistoryWriter.test.ts)
injects required list/item stores, receipt context, scheduling and storage. It
covers host-matched received-list admission, coalescing, return-to-saved-value
suppression, newest-during-write retention, contained write failures and shutdown.
Generic persistence/removal assertions use authoritative snapshots.
`retains ordered deletion when a late item holder is cleared before draining`
pins the independent removal queue key: clearing a late holder must preserve
queued disk removal. Memory-only disappearance now retains owned pending saves;
confirmed deletion explicitly discards them. Pending-unpair tests hold both
settlement outcomes through shutdown, and old in-flight completions cannot restore
comparison state after successful removal.

[`daemonItemCache.test.ts`](../../../src/renderer/src/store/daemonItemCache.test.ts)
proves that legacy rows, receipts, row identities and echoes create no writes while
the authoritative writer is mounted. The exclusion fixture must carry a stamped
receipt: unstamped mutations were already rejected by the old writer and would
pass before branch removal. It also holds a save through newer snapshots and epoch
replacement, checks equal-id host isolation, and verifies hydration schedules no
write while later owned changes remain saveable.
`does not deduplicate fresh identical items against a pre-unpair in-flight save`
pins the host-generation fence; using different fresh content could conceal stale
successful-comparison state. Successful/failed unpair covers pauses, off-screen
scopes, delayed reads, other-host preservation and same-host reuse.

[`chat-history-removal.test.ts`](../../../e2e/chat-history-removal.test.ts) is a
Vitest integration module using authoritative holders and real protected storage.
It holds list or item writes, confirms deletion with later stale captures, and
awaits flush/stop before fresh-service reads. Same-host peers and another host's
equal id survive. Omission, empty lists and memory cleanup retain cached records;
only confirmation removes them. Failed cleanup preserves content without a success
diagnostic when the database deletion fails. Inject that SQL failure against
`thread_scopes` for authoritative fixtures: a trigger on legacy scopes would never
fire and would test successful deletion instead of rollback. Its same-session
re-pair must save only fresh items from an omitted scope: clearing every holder
manually or restarting first would mask the bug.

[`daemonItemHistory.test.ts`](../../../src/main/daemonItemHistory.test.ts) uses the
existing protected filesystem seam and fresh storage services to check coexistence
of legacy/daemon records, equal conversation/item ids on two hosts, and ordered
removal of both formats plus the saved-list entry. Main-handler unpair tests reject
stale reads/writes, remove off-screen records and allow fresh same-host requests.
Malformed IPC/disk metadata, bounded inert JSON, missing optional availability and
unavailable encryption cases check classified failures and preservation of data.
Arrival-order rejection fixtures include missing, duplicate, unknown and invalid
ids; diagnostics remain content-free and inert keys cannot affect object prototypes.

Activated-store tests must hold the operation they intend to order. A source
collection write barrier no longer holds an indexed replacement: store tests hold
source import, handler tests hold membership and writer integration tests hold
writer admission. SQLite triggers establish actual mutation failure/rollback.
Classified source-retirement failure is a separate post-commit path, covered by
the migration module; it cannot use the assertion that prior database content
must survive every `remove-failed` result.

[`indexed-history-lifecycle.spec.ts`](../../../e2e/indexed-history-lifecycle.spec.ts)
executes `indexed history drains a buffered thread replacement on quit and restores
it offline` and `indexed history drains a buffered thread replacement on window and
restores it offline`. Both are present and passed in the [435-executed Linux activation gate](chat-history-testing-native.md#counted-stable-binding-validation)
(zero failed, ten existing skips). Each pauses the writer timer, proves the
tail rendered while storage still holds the baseline, then closes without advancing
time. Exact tail/checkpoint restoration offline proves graceful draining. Linux
window close exits/relaunches; the macOS same-process reactivation branch was not
executed in this Linux run. The main-only close regression separately checks
admitted import drain and rejected late calls.

Full replacement decrypts old evidence and encrypts every replacement membership;
row count alone understates its work. Saturated receipt storage can exceed a
five-second observer deadline. Polling successful saves without admission/failure
evidence cannot diagnose a lost write. The migration and packaged fixtures instead
assert classified completion, queued/fresh-owner reads and exact content, while
the packaged run records elapsed replacement time.

## Restoration

Restoration requires `readSavedTimeline({ threads, ... })` and requests
`openThreadPage` with limit 200. The authoritative cache harness checks that exact
request and admits only explicitly partial pages at the requested host/conversation;
full stored snapshots, timeline/list results, wrong coordinates and unexpected
statuses fail without importing data. `daemonItemCache.test.ts` adapts its retained
full fixtures into partial projections and holds reads through initial live admission.
`merges delayed restoration with admitted revisions and original arrival ties`
checks lower/equal/higher overlapping revisions, saved-only/live-only ids, explicit
arrival metadata and the older supplied-order fallback; timestamps cannot break
arrival ties.
It flushes before and after hydration to prove no new write or replay, then verifies
a later received append still saves. Kind conflicts retain live facts with repair;
different saved epochs and invalid arrival metadata cannot replace admitted state.
Saved-empty, missing, classified failure and rejected IPC remain separate cases.

The lifecycle table runs delayed stored/missing/failed results after cancellation,
superseding reads, epoch replacement, same-string reset and conversation/host/global
cleanup, then reuses the scope strings. A separate test commits a surviving batch
after hydration, catching accidental generation rotation. Successful/failed unpair
also overlaps live admission during the held read: failure preserves ownership,
while success cleans only the owning host.

`preserves saved obligations while folding admitted progress` combines a higher
live version with saved repair/unfinished work and admitted completion or abandonment.
An absent obligation in live scalar metadata cannot erase one loaded from disk. The
incomplete/repair fixture restores checkpoint 100, applied version 300 and unfinished
version 250: a certificate through 200 clears repair but leaves later live success
fenced until certification covers 250. Partial restoration retains selected intact
ranges and older availability without adding coverage. `partial opening preserves omitted availability ownership and sparse
arrival positions` uses positions 800/20 and saved boundary 1 outside selected
900–910 evidence. Later certified boundaries at 100 then 50 cannot reopen the saved
exhaustion; the slice retains the sparse map independently of resident arrival order.

[`daemon-item-cache.test.ts`](../../../e2e/daemon-item-cache.test.ts) is a Node Vitest
integration test, despite its directory. It connects the real writer to protected
temporary-file storage, flushes or stops the writer, constructs fresh storage and thread
store instances, and hydrates through the local reader without Electron or a daemon.
Both completion variants compare snapshots across restart, preserve hidden items,
patch nulls and inert own keys, and apply later live changes on one of two equal-id
hosts. The test encryption backend proves the protected persistence seam, not the
OS keychain adapter. Keeping cross-process imports here avoids pulling renderer
implementation into the composite Node production project.

`fresh protected restoration merges live ownership without saving hydration` holds
the fresh owner's read while a live revision and an equal-id peer host are admitted.
It flushes the received writes before releasing storage, then requires no additional
write at hydration. Saved-only rows, checkpoint 100, applied 400, unfinished 250,
repair through 150 and exhausted availability survive. A subsequent append saves
normally and another fresh storage/store pair must equal the merged snapshot.
A same-owner in-memory read alone would miss persistence or stale-comparison bugs.

Permanent restart regressions in that file cover two traps that a same-instance
read misses. `saves live success after abandoning a batch already covered through
%s` uses both 50 and 100 beneath/equal to checkpoint 100, checks that revision and
checkpoint 200 reach fresh storage, then verifies live progress after hydration.
`restart preserves first-arrival ties after order changes and clears` compares
restored and uninterrupted stores after numeric ties and null-cleared orders.
The renderer test `restores snapshots without arrival metadata using their supplied
held order` covers the older-snapshot fallback. These fixtures complement unfinished
progress tests; accepting covered values must not weaken fences above checkpoint.

These supplied-state tests cover cache preparation and local hydration.
`e2e/thread-activation.spec.ts` exercises the production runtime's saved restore,
reconnect, interrupted recovery, epoch replacement and cleanup. The overlap case
holds the server reply through local-read release and saved/live visibility assertions.
It seeds 220 older shown identities, 500 hidden identities, one hidden active item
and a saved-only row plus unfinished version 25/checkpoint 20. Setup pays retained
replacement conversion before closing the owner; reopening must return exactly 200
shown items plus the hidden active item and exclude the oldest shown identity. It
admits a higher live revision and a live-only row, then requires the released
catch-up to use the admitted epoch and checkpoint 20. Allowing the server reply first could refetch a
lost row and conceal broken restoration. Reconnect waits for completion 25 to be
persisted, rather than merely dispatched. The retained prompt and queued cleanup
cases check authority during pending/failed recovery and confirmed deletion/unpair.
See [counted validation](#counted-savedlive-restoration-validation) and the earlier
[activation inventory](../../specs/architecture/1908-thread-activation.md#manual-completion-shared-fake-migration-and-client-regressions).
The [legacy browser/liveness discussion](chat-history-testing.md#history-continuity-and-overlap)
does not establish daemon-item live acceptance. Production opening admits bounded
partial indexed pages and saves only owned changes; hydration emits no save or new
progress/completeness/read receipt. Invalidated reads retry the bounded operation.
User-driven older saved-page traversal remains #2042. See
[counted bounded-opening evidence](chat-history-testing-native.md#counted-bounded-opening-validation)
for the inspected mounted held-reply and protected opening/reopen cases.

The direct legacy `beginLocalTimelineRead` admission, newest-demand and exclusive
bridge/frame tests were removed with the renderer holder/producers in #2030.
`savedTimelineRestorer.test.ts` retains authoritative restoration coverage;
there is no production `readTimeline` path. The shared fake publisher remains
active for authoritative browser scenarios. An absence assertion alone can pass
against a screen that renders nothing: when removing copy, pair updated assertions
with a positive claim about what the screen now renders.

[`savedListRestorer.test.ts`](../../../src/renderer/src/store/savedListRestorer.test.ts)
covers ordered host isolation with equal ids, missing/empty/error results, duplicate
admission and delayed success/failure after received lists, clears and cancellation.
It runs the real writer alongside restoration: installing and clearing local lists
must schedule no save, while a later received list must still record.

[`received-read-marks.spec.ts`](../../../e2e/received-read-marks.spec.ts) separates immediate mounted
dot/badge clearing from persistence: after host A's push, saved host marks remain the received
list values `[0, 2]`. A store update alone cannot prove a saved mark. See
[counted verifier evidence](development-verification-what-each-test-tier-proves.md#what-each-test-tier-proves).

### Counted saved/live restoration validation

The [verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/2060#issuecomment-6213917266)
records Linux x86_64 gates on 2026-10-16 at
`a062c8aedc45b2d4bb2cbeec26d89305700898d3`:

| Run | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Full units, 392 passing files | 9,133 | 9,133 | 0 | 3 |
| Complete configured fake suite, dispatcher gate 8 | 436 | 436 | 0 | 3 |

The verdict explicitly confirms all 16 `thread-activation.spec.ts` cases were
present and passed, including `restore overlapping live content retains complete
progress across an interrupted catch-up and epoch replacement`, pending/failed
recovery prompts and confirmed unpair/deletion cleanup. The fake gate used four
workers, clipboard/parallel projects, zero retries, no shard and zero flaky results;
no report errors or fake-daemon-setup attachments were reported. Configuration
SHA256: `7097078cf6aaa5b94888a26af30c0f6bb000e6be66ff78891630f2a19a32795b`.
Install, docs guard, Node/Electron addon rebuilds, typecheck and build passed.
Pre-verify ran three checks and intentionally skipped two with `--no-suite`;
the separate unit/build gates covered those checks.

The [builder evidence](../../specs/architecture/2058-saved-live-restoration.md#validation-evidence)
at implementation `dfcc48214c073c3ec111c29e3c5c716c4d85088a` retains the
cache/restart run (59 executed/passed, 0 failed/skipped). Its focused mounted overlap
case passed after Electron adapter preparation (1 executed/passed, 0 failed/skipped),
followed by the full fake pass (436 executed/passed, 0 failed, 3 skipped).
The plan retains the earlier initial-save-barrier failure and raw reports, including
`/tmp/builder-2058/fake-suite.json`; the later passes do not change that failure's status.

The fake skips are two macOS badge cases and the macOS window-reopen case. macOS
is outside this Linux ticket's verification scope. No live-Claude run was required
or claimed. These are recorded builder/verifier results, not documentation-stage
test reruns.
