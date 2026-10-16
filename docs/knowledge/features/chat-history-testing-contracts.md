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
the [daemon-cache tests](chat-history-testing-restoration.md#recording-and-removal) cover
`readThread`/`mutateThread`.

[`chatHistoryMigration.test.ts`](../../../src/main/chatHistoryMigration.test.ts)
tests activated storage with real disk, fresh owners and reversible protection.
Its 21 cases were present and passed in the
[counted Linux unit run](chat-history-testing-native.md#counted-stable-binding-validation):

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
seam; production OS encryption requires the
[packaged proof](chat-history-testing-native.md#native-runtime-and-packaged-proof).

