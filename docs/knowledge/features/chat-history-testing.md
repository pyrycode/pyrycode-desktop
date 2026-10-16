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
temporary SQLite/protected-source files with injected reversible encryption to cover
fresh-instance reads, empty-versus-missing records, host separation, retained unlisted timelines,
held overlapping writes/removals and preservation after read/write/delete failures.
These tests exercise the storage seams without proving the OS keychain adapter.
[`chatHistoryHandler.test.ts`](../../../src/main/chatHistoryHandler.test.ts)
covers membership, rejected requests before record access, ordering and contained
failures. `invalidates queued conversation work while allowing fresh identical
coordinates` includes a stale list replacement as well as conversation requests;
the daemon-cache tests below cover `readThread`/`replaceThread`.

[`chatHistoryMigration.test.ts`](../../../src/main/chatHistoryMigration.test.ts)
tests activated storage with real disk, fresh owners and reversible protection.
Its 21 cases were present and passed in the counted Linux unit run below:

| Named case (parameterized variants included) | What it establishes |
| --- | --- |
| `imports both exact formats once, preserves newer indexed content and never reopens the source after restart` | Exact parser-normalized formats/lists, ownership, existing indexed precedence, no source access after completion and no fixture plaintext in history files. |
| `rolls back an interrupted two-format import and retries without duplicates` | Neither family nor completion survives a failed import; retry succeeds. |
| `classifies an import %s failure and rolls back both families before queued retry` | List insertion, marker insertion and outer COMMIT fail as writes; source/committed peers survive and fresh-owner reads match after retry. |
| `preserves a stored list with version %s across reads and mutations` | Safe-integer 9 remains unsupported; malformed 1.5/string versions stay unreadable across reads/replacement/removals, preserving ciphertext and both families. |
| `keeps invalid destination list decoding unreadable before importing either family` | Complete destination validation precedes mutation; a raw JSON error cannot become a write error merely because another family needs importing. |
| `classifies an outer %s replacement commit failure and preserves the committed snapshot` | Both families roll back successful nested replacements when the enclosing COMMIT fails. |
| `preserves an unreadable %s source and recovers without poisoning the queue` | Invalid, unsupported-version and decrypt-failing sources stay intact; later work recovers. |
| `retries retirement after commit without replaying removed records, even with reused identities` | Commit-before-cleanup interruption, restart, deletion and fresh replacements cannot replay the retained source. |
| `orders a held import before %s removal and rejects queued stale saves after identical reuse` | Conversation deletion and credential-first host forgetting serialize import, reject stale work and preserve equal-id peers. |
| `drains accepted import before close and rejects later admission` | Shutdown waits for admitted storage and refuses later calls. |
| `preserves committed records and source when database admission or encryption is unavailable` | Unsupported schema/protection failure preserves originals and permits recovery. |
| `commits a saturated receipt replacement through handler admission and preserves it across fresh owners` | Full receipt replacement and queued reads settle with exact persisted content. |
| `keeps detached Promise backend execution callable` | The synchronous transaction seam does not add a `this` dependency to existing Promise methods. |

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
main-process operations require no real-Claude or visual acceptance. Full indexed
storage is now active; page IPC, renderer consumers and partial writes remain #1931.

### Native runtime and packaged proof

Host-Node Vitest and Electron use different native ABIs. `npm run rebuild:node`
runs `npm rebuild better-sqlite3` for host tests; `npm run rebuild:electron` runs
`electron-builder install-app-deps` for Electron. Rebuild for the runtime being
used after switching ABIs. Production packaging sets `npmRebuild: true` and
`asarUnpack: node_modules/better-sqlite3/**`; a Node import alone cannot prove the
packaged adapter loads.

Prepare host Node before unit gates, then prepare Electron again before the ordinary
app's Playwright gate. `npm install` or a successful Node gate does not establish
Electron readiness. An isolated packaged smoke rebuilds its own adapter copy and
cannot certify the ordinary application's ABI preparation. The activation review
reproduced host Node 25.8.0 / ABI 141 loading an adapter that Electron 33.4.11 /
Node 20.18.3 / ABI 130 rejected. The unchanged full suite passed after the Electron
rebuild; local verifier runner preparation was tracked by #2038, separately from
the managed runner repair in #2018.

The [renderer-retirement PR](https://github.com/pyrycode/pyrycode-desktop/pull/2039)
records the same trap after indexed storage merged: 13 failures in the first
post-merge fake run used the host-Node adapter. Rebuilding for Electron made all
13 pass without source changes. The final counted Linux gate executed/passed
435 cases, 0 failed, 3 skipped. Treat the earlier capture as failed and the later
pass as separate evidence; the rebuild order is Node units, then Electron suite.

On Linux/macOS, `npm run check:history-native -- /tmp/history-native-proof` packages
an isolated entrypoint, launches the packaged Electron app and writes `runtime.stdout`
and `runtime.stderr` beneath the supplied scratch directory. It uses the actual
`electronSecretEncryption` through activated `createChatHistoryStore`, imports
both protected formats, closes/reopens the database and compares parser-normalized
content structurally. A 500-receipt by 200-id fixture exercises 100,000 memberships,
full replacement and exact fresh reopen. It checks all history-directory files for
fixture plaintext and reports versions, packaged/asar/native-unpacked flags,
static stage and nonzero test counts.
Failure or missing/all-skipped evidence is nonzero. It adds no release channel.

[`history-native.spec.ts`](../../../e2e/history-native.spec.ts) includes
`packaged protected history commits and reopens with production encryption` in the
ordinary Playwright configuration and attaches stdout/stderr. This lets a managed
`desktop-fake-suite` task exercise the native proof on the exact pushed candidate
through normal manager admission. On macOS follow the approved Electron-launch
route from the project instructions. Other platforms explicitly skip this case;
direct smoke invocation rejects them before packaging imports or scratch creation.
[`historyNativePlatform.test.ts`](../../../src/main/historyNativePlatform.test.ts)
pins Windows rejection. Run the native proof on the operating system running the
ticket; opposite-OS scheduling is outside scope. Existing NSIS x64/arm64 targets
remain unchanged.

The [activation verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2019#issuecomment-6208451299)
and dispatcher gate 8 record Linux x64 acceptance on
`2af705788086ec1339f0b271a891da19b18e956f` (2026-10-16):

| Run or included module | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Full unit suite, 420 passing files | 10,247 | 10,247 | 0 | 30 inherited |
| Migration module, included above | 21 | 21 | 0 | 0 |
| Protected store module, included above | 14 | 14 | 0 | 0 |
| Handler admission module, included above | 7 | 7 | 0 | 0 |
| Daemon-item history module, included above | 6 | 6 | 0 | 0 |
| Removal/unpair integration module, included above | 6 | 6 | 0 | 0 |
| Daemon-item cache integration module, included above | 5 | 5 | 0 | 0 |
| Update draining module, included above | 15 | 15 | 0 | 0 |
| Complete configured Linux Playwright suite | 435 | 435 | 0 | 10 existing |
| Packaged production-encryption case, included above | 1 | 1 | 0 | 0 |

The named `packaged protected history commits and reopens with production encryption`
case is present and passed. The verifier inspected both attachments and raw
`/tmp/pyry-history-native-pjNuvq/runtime.stdout` / `runtime.stderr`: Electron
33.4.11, embedded Node 20.18.3, better-sqlite3 12.4.1, `gnome_libsecret`,
packaged/asar/unpacked true and `stage: complete`. Exact two-format import/reopen,
full replacement/fresh reopen and plaintext rejection passed; saturated replacement
took 3,877 ms. The report stderr attachment is empty; raw stderr retains
system-bus/GPU diagnostics with successful counted completion.

The full fake gate ran both configured projects with four concurrent worker slots,
zero retries/flaky results, no filters and no global errors, after Electron
preparation. All 15 `thread-activation.spec.ts` cases, both indexed quit/window
cases named below and `local list read failures stay beside the saved host` are
present and passed. The ten skips are seven retired legacy scenarios and three
macOS-only checks; skips establish no execution proof. macOS is outside this Linux
ticket's verification scope. No live-Claude spec changed or live run was required.
Verifier artifacts are retained under `/tmp/verifier-2019/current-2af70578/`;
full report SHA256 is `1c4b5faf5de7b9c65324dd9a476467fefcdc3b820cb07b058aa53bcf3f3fcabe`.

Historical activation failures retain their status. The initial Linux gate on
`54d7010a` executed 434: 421 passed, 13 failed, 10 skipped; its ABI diagnostic rerun
executed/passed 13, failed/skipped 0 and did not replace the complete gate. The
later Linux focused run on `41fbd1f4` executed 19: 18 passed, one inspection-context
failure, zero skips/retries; the unchanged case passed alone (1/1) and in the final
focused group (19/19), both with zero failures/skips. #2035 records that intermittent
inspection failure without claiming its cause repaired. Earlier Mac capture
`d89f50d5` remains 438 executed, 437 passed, one failed, one skipped; abandoned final
task `a1e15a53baa351db3fb77b5e6f613e289d8b4e878d0911e6b9c20b748afa55bf`
on `109888c4` was settled interrupted with no results and drained custody. Neither
that interrupted task nor a passing earlier revision proves final Mac acceptance.
The [activation plan](../../specs/architecture/1975-activate-indexed-history.md#revisions)
retains the full chronology, including earlier failed ABI captures.

Earlier backend-only proof from the [final verifier review](https://github.com/pyrycode/pyrycode-desktop/pull/1996#issuecomment-6189261285)
confirmed retained production-encryption artifacts from candidate
`f2ef9815571c2ce773a0d736e0ec32d0f26b776a`, whose backend/native/dependency/packaging
files matched that review's head. The named packaged case above was present and passed
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
Claude test was required for that backend-only change.

## Recording and removal

[`chatHistoryWriter.test.ts`](../../../src/renderer/src/store/chatHistoryWriter.test.ts)
injects required list/item stores, receipt context, scheduling and storage. It
covers host-matched received-list admission, coalescing, return-to-saved-value
suppression, newest-during-write retention, contained write failures and shutdown.
Generic persistence/removal assertions use authoritative snapshots.
`retains ordered deletion when a late item holder is cleared before draining`
pins the independent removal queue key: clearing a late holder must cancel its
pending item save without cancelling disk removal. Pending-unpair tests hold both
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
restores it offline`. Both are present and passed in the 435-executed Linux gate
above (zero failed, ten existing skips). Each pauses the writer timer, proves the
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

Restoration requires `readSavedTimeline({ threads, ... })` and requests only
`readThread`. The authoritative cache harness checks the exact request and admits
only daemon-item snapshots at the requested host/conversation; timeline, list,
wrong-coordinate and unexpected-status results fail without importing data.
`daemonItemCache.test.ts` covers stored/missing/error/rejected reads settling after live admission, cancellation,
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

These supplied-state tests cover cache preparation and local hydration.
`e2e/thread-activation.spec.ts` exercises the production runtime's saved restore,
reconnect, interrupted recovery, epoch replacement and cleanup. Its counted final
fake-suite results are recorded in the [activation plan](../../specs/architecture/1908-thread-activation.md#manual-completion-shared-fake-migration-and-client-regressions).
Existing legacy browser/liveness proofs below do not establish daemon-item live
acceptance. Production uses complete indexed snapshots; bounded pages remain
main-only until #1931 activates consumers and partial writers.

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

## Browser persistence and lifecycle

[`message-reply.spec.ts`](../../../e2e/message-reply.spec.ts)'s enabled
`received history is saved for equal ids on different hosts and replies reopen offline`
uses two hosts advertising `seed-conversation` with distinct assistant replies.
It polls each protected `readThread` result, visits the second chat, disconnects
the first host, then reopens its saved chat offline and quotes only its original
reply into that host's draft. Both saved daemon-item records remain independent
afterward.
Draft isolation and ordinary saved/offline reply tests remain enabled: either
could pass while received persistence is broken, so neither substitutes for this
regression. See [counted fake-transport evidence](development-verification-what-each-test-tier-proves.md#equal-id-received-history).

[`chat-history-recording.spec.ts`](../../../e2e/chat-history-recording.spec.ts)
retains the active `local list read failures stay beside the saved host` case.
The exact nine already-skipped legacy-only cases from the
[cleanup inventory](https://github.com/pyrycode/pyrycode-desktop/issues/2020#issuecomment-6200547647)
were deleted by #2029, together with their private fixtures:

- `confirmed deletion removes saved content through restart without waiting for a list refresh`
- `explicit unpair discards buffered history across restart while same-server repair retains it`
- `receipt saturation still saves a repeated page and later live content across fresh relaunches`
- `records received content, drains buffered quit, and reads locally after relaunch`
- `window close saves accepted deltas before their frame and reopening restores the full reply`
- `restores a pairing-rejected saved host beside a usable connected host`
- `pending saved reading survives opening and cancelling host repair`
- `saved coverage survives offline restart, reconnect, live receipts and connected reopening`
- `protected restoration joins partial pages while retaining an expanded tool and content anchor`

Authoritative cache/removal/restart tests and all 15 `thread-activation.spec.ts`
cases remain. They cover offline restoration/live overlap, complete and interrupted
checkpoints, deletion/unpair, saved-checkpoint reconnect and older paging. No
broader suite was disabled, and no skip or assertion was weakened by this removal.
When seeding protected state, await a successful buffered save separately from the
received-event barrier; receipt or rendered text alone does not prove persistence.

### Counted validation for renderer persistence removal

After #2033's scroll-readiness repair merged through main
`1366e69e1e23d1ae264735f449ed86ff2dd7373b`, the completed builder run on
`79c7a4aae729c53019295a507de748b530089c43` superseded the earlier one-failure
run. The [plan](../../specs/architecture/2029-renderer-history-persistence.md#validation-after-blocker-repair)
records 432 executed, 432 passed, 0 failed and 10 existing skips, with two workers,
both projects and zero retries/flaky results. All 15 thread-activation cases passed.

The dispatcher's verifier gate 6 on `9971072191ad45844bfae3d5581a218e97f9f024`
independently recorded **432 executed, 432 passed, 0 failed, 10 skipped**.
Its named results explicitly include passed
`local list read failures stay beside the saved host` and
`gaps, long hidden runs and target changes preserve a valid anchor and clean observations`.
The [verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2032#issuecomment-6204463520)
also confirms all 15 thread-activation cases passed, plus unit results of
10,224 executed and passed, 0 failed and 30 skipped across 416 files. Build and
docs guard passed.
The 10 browser skips were three macOS-only cases and seven pre-existing legacy
scenarios; they are not execution evidence for those paths. No live spec changed
and this refactor required no live-Claude run.

## History continuity and overlap

Production offline/live continuity and checkpoint overlap are covered by
`thread-activation.spec.ts` and the authoritative cache restart fixtures above.
The retired recording continuity cases no longer provide browser proof for legacy
cursor/receipt persistence. The remaining renderer reconstruction producers and
their exclusive fixtures were deleted in #2030. The historical overlap discussion
below explains the old reconstruction path, not current executable regressions or
authoritative restoration. See [completed inventory and validation](thread-runtime.md#renderer-producer-retirement-validation).

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


## Packaged native storage check

`scripts/history-native-smoke.mjs` builds an isolated application and verifies
protected history in the packaged Electron runtime. Dependency collection must
use that isolated application as `projectDir`. Building from the repository root
can package the ordinary Node database module even when the staged copy was
rebuilt for Electron, producing a native-module ABI mismatch after packaging.

The final macOS arm64 check for the thread activation passed with Electron 33.4.11,
Node 20.18.3 and `better-sqlite3` 12.4.1. The native module was unpacked from the
archive and the production OS keychain backend was available. A Linux
`basic_text` backend cannot prove protected storage and must remain a failure.
Fake encryption unit tests and an unpackaged launch are separate evidence.
