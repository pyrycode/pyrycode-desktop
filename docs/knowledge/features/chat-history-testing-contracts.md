# Protected history testing — demand and admission

Part of [protected history testing](chat-history-testing.md).

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

[`chatHistory.test.ts`](../../../src/shared/chatHistory.test.ts) checks retained list/item
projection, detached inputs, limits, coordinates and owned/page admission. Read-ID
cases round-trip zero/safe maximum, restore older omitted list fields and reject
invalid values. Legacy row-schema and durable-type equality fixtures are retired.
[`chatHistoryStore.test.ts`](../../../src/main/chatHistoryStore.test.ts) uses real
temporary SQLite/protected-source files with injected reversible encryption to cover
fresh-instance reads, empty-versus-missing records, host separation, retained unlisted threads,
held overlapping writes/removals and preservation after read/write/delete failures.
These tests exercise the storage seams without proving the OS keychain adapter.
[`chatHistoryHandler.test.ts`](../../../src/main/chatHistoryHandler.test.ts)
covers membership, rejected requests before record access, ordering and contained
failures. `invalidates queued conversation work while allowing fresh identical
coordinates` includes a stale list replacement as well as conversation requests;
the [daemon-cache tests](chat-history-testing-restoration.md#recording-and-removal) cover
`readThread`/`mutateThread`.

[`chatHistoryMigration.test.ts`](../../../src/main/chatHistoryMigration.test.ts)
tests activated storage with real disk, fresh owners and reversible protection.
The [current counted Linux validation](chat-history-testing-native.md#counted-legacy-storage-retirement-validation)
records full-suite evidence without treating older module counts as fresh results.
The retained migration regressions cover:

| Case or boundary | What it establishes |
| --- | --- |
| Mixed-source ignore and fresh reopen | Version-1 timeline ownership is validated while retired rows/receipts are not decoded; retained lists/items survive, with no imported legacy scopes or plaintext. |
| Retired request rejection | `readTimeline`, `replaceTimeline`, `readTimelineNewestPage` and `readTimelineBeforePage` fail before membership or storage access. |
| Invalid source admission | Invalid/oversized ownership, unknown kinds/versions, malformed retained records and duplicate retained identities preserve source bytes and leave no completion marker. |
| Legacy-only source | Even duplicate ignored envelopes yield no authoritative data, complete retirement and never replay after fresh reopen. |
| Exact indexed cleanup | Directly seed unreadable legacy bytes across case/NUL/lone-surrogate/U+FFFD owners. Reads remain missing; conversation deletion/unpair removes only addressed data, cascading records without reconstruction. Injected SQL failure rolls back cleanup. |
| Schema-1 compatibility | TEXT ownership migrates to exact UTF-16LE keys without retired payload decoding, then scoped cleanup succeeds. |
| Indexed precedence and import rollback | Existing authoritative data wins; list/item writes and completion commit together. Interrupted encryption, list/marker insertion and outer COMMIT failures preserve source/peers and permit queued retry. |
| Retained validation | Unsupported/malformed list versions and invalid destination data remain classified and preserve ciphertext before any import mutation. |
| Replacement COMMIT failure | A successful nested authoritative replacement rolls back when its enclosing COMMIT fails. |
| Completion/retirement fences | Cleanup retries never reopen completed source bytes or resurrect removal after restart or identical identity reuse. Held import precedes deletion/unpair; generation fences reject queued stale work. |
| Close and availability | Close drains admitted import and refuses late calls; unavailable protection/unsupported schemas preserve source and commits. |
| Callable backend | Detached Promise `execute` remains callable without a `this` dependency. |

Legacy backend, row-codec and bounded-page exclusive suites were deleted with their
APIs. Existing isolation, protected restart, progress and deletion/unpair assertions
use retained authoritative snapshots. Keep ignored-byte cleanup tests independent
of the removed writer: using a reconstruction helper would both revive the retired
contract and let corrupt retired payloads block deletion. Reversible unit encryption
proves storage behavior; [packaged production protection](chat-history-testing-native.md#native-runtime-and-packaged-proof)
remains separate evidence.
