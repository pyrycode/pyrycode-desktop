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
progress/completeness/read receipt. Explicit Retry repeats a failed bounded demand;
main can rebase invalidated held traversal only with its paired authenticated
recovery capability. Generic failures retain valid content for explicit Retry.
See [counted recovery evidence](#counted-saved-traversal-recovery-validation) and
[bounded-opening evidence](chat-history-testing-native.md#counted-bounded-opening-validation).

`savedThreadTraversal.test.ts` extends the existing runtime/store fixtures for held
admission. It exercises newest traversal despite null opening continuation,
coalescing, explicit local retry and exhaustion offline; pending/failed server
state stays independent. Sparse positions 800/20/5 and delayed higher/equal revisions
pin first-arrival ordering and optional-field clears. Cleanup tables fence late
success/failure after cancellation/navigation, epoch replacement, same-epoch reset,
delete, unpair and global clear with reused strings. Protection/storage/token and
IPC failure classifications retain facts without loops or private diagnostic text.
Disjoint saved ranges `[100,200)` / `[900,1000)` leave the next network page at 900.
`echoes only the traversal recovery capability and retries classified failures
without spinning` supplies a different opening capability, proving the first newest
demand ignores it. A failed before-demand retains the traversal pair for one explicit
Retry. Existing delayed success/error cleanup tables still fence recovery admission
and presentation through navigation, epoch/reset, deletion, unpair and teardown.

`fresh protected traversal reaches every fragmented saved identity including opening
omissions without writes (invalidation %s)` in the existing Node integration fixture
runs both unchanged and metadata-invalidated saved traversal over 650 identities:
250 shown and 400 hidden, including unordered content and an old active dependency.
A fresh runtime opens 201 selected facts, then traverses newest/before held windows
and compares the exact complete snapshot and 650 unique ids. All runtime storage
requests are reads and the result is marked restored. A token survives another fresh owner while
unchanged, then an ordinary request without recovery returns `unreadable` after
replacement; the displayed snapshot stays intact. The invalidation variant commits
metadata at depth, then continues the exact snapshot comparison without hydration
writes. Overlapping opening facts must not skip omitted saved content.

The mounted `unchanged saved traversal scrolls independently while server reply is
held` and `unchanged saved traversal scrolls independently offline` cases reuse that
650-item fragmented shape after closing/reopening the protected profile. The online
case positively observes the catch-up request while scripted transport withholds its
reply. `heldThreadRead` can select an operation and skip count: holding the third
`beforeThreadPage` lets the test compare the same visible row's offset across the
final insertion and prove repeated wheel input coalesces. All 250 shown rows render,
without additional network pages or read acknowledgements; saved unread evidence
does not become acknowledged by hydration. Captures at 1100×773 preserve the existing
sidebar, conversation pane, footer and notices.

Their `invalidated saved traversal ...` variants remove saved boundary identity 50
before the next held read, anchor surviving visible row 51 and assert its
viewport offset across recovery. Both offline and positively held-reply variants
retain coalescing, saved unread evidence and zero extra network-page/read-ack
assertions. Measuring row count alone would miss a jump to newest or an identity
omitted when its order moved across the old boundary.

Protected `indexedThreadHistory.test.ts` adds metadata, revision/order movement,
boundary removal and same-epoch replacement cases with exact remaining content
comparison after fresh reopen. It separately checks repeated invalidation with one
bounded window per demand and complete identity traversal once writes settle.
Capability substitution/wrong-scope tests cover epoch-string round trips, explicit
same-epoch reset, deletion and unpair recreation. Ordinary stale-token rejection
remains asserted even when the matching recovery capability exists. See
[work and packaged measurements](chat-history-testing-native.md#counted-saved-traversal-recovery-validation).

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

### Counted saved traversal recovery validation

The [recovery verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/2067#issuecomment-6218610544)
and dispatcher report record Linux x64 on 2026-10-16 at
`5e84fc20d0ef7f175f7d3b2f1d1ce0e488b51340`:

| Run or included case | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Full units, 400 passing files | 9,240 | 9,240 | 0 | 3 |
| Complete configured Playwright suite, verifier gate 8 | 468 | 468 | 0 | 4 |
| `invalidated saved traversal scrolls independently offline`, included above | 1 | 1 | 0 | 0 |
| `invalidated saved traversal scrolls independently while server reply is held`, included above | 1 | 1 | 0 | 0 |
| Packaged production-encryption check, included above | 1 | 1 | 0 | 0 |

Both named invalidated cases are explicitly present and passed in the dispatcher
report. The verifier also confirms both unchanged traversal cases passed, preserving
four-case coverage. The complete gate ran clipboard/parallel projects with two
workers, no filters, zero retries/flaky results and no top-level errors in 777.3 s.
Captured clients contributed **28 executed/passed, 0 failed, 1 existing reset fixme
skipped**, included in the totals. Remaining fake skips are three macOS-only cases;
unit skips are existing opt-in checks. Install, pre-verify `--no-suite`, docs guard,
Node/Electron adapter preparation, units and build passed. The unit counts come
from the verifier's counted unit report, not the pre-verify exit code.

Both current-head 1100×773 `saved-traversal-held.png` captures were inspected by the
verifier. Boundary-removal offset and zero extra network-page/read-ack assertions
precede capture; sidebar, conversation, footer and notices retain their presentation.
The 650-identity protected restart compares exact content, uniqueness, opening
omissions and fragmented ranges, with no hydration save.

The [plan evidence](../../specs/architecture/2064-saved-traversal-recovery.md#validation-evidence)
retains the builder's independent full pass at implementation `823b6dd2`:
9,240 units executed/passed, 0 failed, 3 skipped; 468 fake/client cases executed/passed,
0 failed, 4 skipped in 855.8 s. All four traversal cases and the single packaged
case are explicitly recorded as passed there too. The initial pre-verify capture
`/tmp/builder-2064/pre-verify.log` remains failed: six schema migration assertions
exposed replacement-header inspection running during schema-5 conversion. Header
inspection now requires a validated previous snapshot. The final full pass is a
separate run; initial sandbox installation's esbuild permission failure is also
retained in the plan, followed by approved installation.

See [native/work evidence](chat-history-testing-native.md#counted-saved-traversal-recovery-validation)
for separate selected, structural, conversion and timing measurements. macOS is
outside this Linux ticket's verification scope. Controlled fake transport suffices;
no real-Claude run was required or claimed. These are recorded results;
documentation runs only the docs guard.

### Counted unchanged saved traversal validation

The [post-merge verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/2066#issuecomment-6217180444)
and dispatcher gate report record Linux x64 on 2026-10-16 at
`8fa5f23fc349c11d1564dfbb54d3ece845a74636`:

| Run or included case | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Full units, 400 passing files | 9,228 | 9,228 | 0 | 3 |
| Complete configured Playwright suite, verifier gate 8 | 466 | 466 | 0 | 4 |
| Saved traversal while server reply is held, included above | 1 | 1 | 0 | 0 |
| Saved traversal offline, included above | 1 | 1 | 0 | 0 |
| Packaged production-encryption check, included above | 1 | 1 | 0 | 0 |

Both exact mounted traversal names above are explicitly present and passed in gate
8. The verifier also confirms all four `no-op ... on a short offline thread keeps
following row growth` cases passed. Both configured clipboard/parallel projects ran
with two actual workers, zero retries/flaky results and no report-level errors;
traversal launch-fate attachments report no teardown failures. The four skips are
three macOS-only checks and the existing system-prompt fixme. Install, docs guard,
Node/Electron rebuilds and build/typecheck passed. Pre-verify used `--no-suite`
(three passed checks, two intentional skips); units ran in the separate gate.

The [builder's validation record](../../specs/architecture/2063-saved-thread-traversal.md#validation-evidence)
retains the historical complete run on implementation
`58953c28970b4d81e8ee7d361110a1b2b22bfdc8`: **438 executed, 434 passed, 4 failed,
3 skipped**. Removing the connectivity guard had released following on short offline
threads even when no demand was accepted. Repair `b3a26802a30dc4061752a90d12d323fb9055e2eb`
made the callback report accepted demand and restored prior following intent for
zero-offset no-ops. The four failures and both new traversal cases then passed
**6 executed/passed, 0 failed/skipped**. The later complete green gate above covers
the repair and merged main; it does not turn the original failed run into a pass.

See [bounded-work and packaged measurements](chat-history-testing-native.md#counted-unchanged-saved-traversal-validation)
for fixture sizes, selected versus structural work, conversion and cold-opening
times. Other operating systems are outside this Linux ticket's verification scope.
No live-Claude run was required or claimed. These are recorded builder/verifier
results; documentation ran only the docs guard.
