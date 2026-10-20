# Protected local chat history — testing

Verification reference for [protected local chat history](chat-history.md).
Received ownership and storage behavior are defined in the parent overview.

- [Demand and admission](chat-history-testing-contracts.md): snapshot validation, migration and fresh-owner contracts.
- [Indexed storage](chat-history-testing-storage.md): owned mutations, bounded work, rollback and counted validation.
- [Native runtime](chat-history-testing-native.md): ABI preparation, packaged protection and counted native evidence.
- [Restoration and removal](chat-history-testing-restoration.md): delayed reads, lifecycle fences and protected restart regressions.

## Stable protected authoritative storage and pages

[`indexedThreadHistory.test.ts`](../../../src/main/indexedThreadHistory.test.ts)
uses disk databases and fresh owners for exact admitted round trips, 200-item
held-order traversal, first-arrival ties, hidden/unordered items, inert JSON/nulls,
optional defaults and covered unfinished progress. It retains scoped cleanup,
missing/saved-empty, token size/coordinate bounds, selected-index tampering and
rollback regressions. The schema-6 fixtures add:

- `upgrades committed schema-5 history transactionally and preserves old continuations`:
  independently seeded old protected envelopes upgrade with exact content and
  arrival positions; the old token still works after conversion and fresh reopen.
- `preserves schema-5 commits across failed migration and retries: %s`:
  corrupt associations, unavailable protection, encryption failure and SQL insertion
  failure leave identical committed database bytes, schema 5 and no payload table.
  Removing the injected fault permits exact reads and old-token traversal.
- `retains stable payloads while replacement rotates generation and changes placement`:
  held-order/evidence/progress changes and identical replacement retain payload
  bytes while invalidating continuations. A revised item changes only its payload;
  an epoch change replaces payloads. The encryption fake prefixes a new serial on
  every call: deterministic encryption could produce identical bytes after an
  unnecessary rewrite and falsely prove retention.
- `rejects protected payload association tampering: %s`:
  lookup/revision edits, payload substitution, cross-owner ciphertext, orphans and
  old placement/range replay reject full reads/replacement while preserving the
  equal-id peer host. Selected pages reject relevant corruption; an unselected
  orphan is deliberately left to complete validation.
- `empty replacements always rotate protected generation and invalidate older continuations`:
  repeated saved-empty replacements rotate generation, complementing existing
  identical replacement and deletion/recreation token rejection.

`selected reads/JSON decodes/decrypts stay bounded when unrelated history grows`
compares 10 versus 1,000 items/ranges after storage conversion. Its two-item page
reads seven SQL results: scope, header, two placements, two directly looked-up
payloads and newest range. Six JSON decodes and six decrypts account separately
for placements and payloads; growing unrelated history changes none of these counts.
Paging calls no full reader and performs no whole-history scan after migration.
Selected containing-range evidence plus the newest anchor remains intact.

Those schema-6 fixtures retain full/page compatibility proof. Owned writes use the
[schema-7 regressions](chat-history-testing-storage.md#owned-mutation-regressions-and-counted-validation).
Production shown-opening and newest-first saved traversal use authorized partial
page IPC. The [restart and mounted regressions](chat-history-testing-restoration.md#restoration)
cover opening omissions, offline/held-reply input, anchor offsets and local retry.
See the [bounded-opening regressions](chat-history-testing-storage.md#bounded-opening-selection-and-work).
Multi-family import, outer-commit rollback and
[fresh-owner fixtures](chat-history-testing-contracts.md#demand-and-snapshot-contracts) still apply.

## Recording and removal

The [recording/removal fixtures](chat-history-testing-restoration.md#recording-and-removal)
hold writer admission and removal settlement, then reopen protected storage through
fresh owners. Only confirmed deletion or successful unpair grants cleanup;
failed unpair preserves admitted facts and pending read ownership.

## Restoration

Bounded `openThreadPage` restoration selects 200 shown identities plus active and
recorded dependencies, then merges saved-only rows and compatible revisions with
same-owner live facts. Initial admission preserves the read; cancellation,
reset/replacement and cleanup fence it even after identical strings are reused.
Hydration emits no owned save; subsequent received changes still persist.

The [restoration regressions](chat-history-testing-restoration.md#restoration)
cover revision/arrival ties, saved repair/unfinished fences, surviving batches,
protected fresh-owner overlap and mounted visibility while the server reply is held.
Keep the covered-unfinished-progress and arrival-order restart tests. See
[counted bounded-opening validation](chat-history-testing-native.md#counted-bounded-opening-validation)
for the opening measurements, and
[unchanged traversal validation](chat-history-testing-native.md#counted-unchanged-saved-traversal-validation)
for the current Linux revision, counted suite/native results and selected traversal work.

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

Authoritative cache/removal/restart tests and all 16 `thread-activation.spec.ts`
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
`thread-activation.spec.ts` and the
[authoritative cache restart fixtures](chat-history-testing-restoration.md#restoration).
The retired recording continuity cases no longer provide browser proof for legacy
cursor/receipt persistence. The remaining renderer reconstruction producers and
their exclusive fixtures were deleted in #2030. The historical overlap discussion
below explains the old reconstruction path, not current executable regressions or
authoritative restoration. See [completed inventory and validation](thread-runtime.md#renderer-producer-retirement-validation).

[`real-daemon-history-on-open.spec.ts`](../../../e2e/real-daemon-history-on-open.spec.ts)
saves an authoritative epoch/checkpoint baseline, fully exits Electron through the
shared protected-profile relaunch fixture, and writes 205 unique `pyry channel post`
entries only in its awaited while-closed callback. Reopening asks newest once
without upward input and exposes the gap. Fresh focused input fills it under the
[demand and observation contract](chat-history-testing-contracts.md#demand-and-snapshot-contracts), retaining the
baseline and all posts exactly once in order. The configured captured-client
replay preserves these assertions and proves no current provider behavior. The
source live scenario uses `spawnClaude: false`; even a live pass would establish
daemon storage/transport rather than a Claude turn or production-relay delivery.
See [current replay/native evidence and historical live failures](chat-history-testing-native.md#counted-legacy-storage-retirement-validation).

### Protected paging coverage observation

Dispatch, renderer publication and protected durability are separate facts.
[`readHistoryCoverage`](../../../e2e/fixtures/historyCoverage.ts) consumes complete
`ChatHistoryResult` values instead of collapsing unavailable results to
`undefined`. It constructs an exact-host/conversation `newestThreadPage` request
with `limit: 1`; the scenario forwards it through the existing preload API.
Before Home and each ArrowUp it validates page metadata ownership and retains
the actual numeric start of the newest authenticated range (`ranges.at(-1)`).
An older disconnected range cannot establish progress of the newest window.
Stored `daemon-items` regression fixtures still require both outer and inner
ownership and use their first range. Zero is valid. The successful polling
callback supplies the retained value; a second read could lose availability again.

Full protected transcript reads decrypt every retained item on main's serial
storage queue, competing with the receipt/persistence they observe. Growing
observation work can consume the progress deadline before ready page delivery
runs. The one-item page bounds that work while retaining authenticated range
evidence and the store's rejection of pending split saves. Continuation tokens,
checkpoints and rendered rows supply no substitute for a protected range.

After input, one five-second progress observation runs alongside the exact
one-additional-`thread_page` assertion and requires a strictly smaller protected
start. `unreadable`, missing snapshots, empty ranges and equal/increased starts
remain pending within that bound; none supplies coverage. Other classified
errors, rejected reads, unexpected status/kind and wrong ownership stop without
another read, using static codes rather than exception text or content. A pending
status must not mask a later terminal result. Request counts, loading-indicator
disappearance and bubble growth retain their separate assertions.

[`historyCoverage.test.ts`](../../../e2e/fixtures/historyCoverage.test.ts)'s
`waits across split saves at baseline and after dispatch` uses the real writer,
handler, SQLite database and protected store with test encryption. It holds prefix
acknowledgement and final submission outside the handler queue, so reads actually
return `unreadable` before baseline acquisition and after controlled publication.
The old projection fails on those reads; the reader remains pending until final
durability and retains starts 100 then 50, now through the bounded page reader.
Controlled dispatch/publication markers
come from the existing owned-state fixture seam; the application scenario checks
actual requests separately. The content-free trace is
`/tmp/builder-2153/regression.log`; `unit-final/0.log` is only the final
JSON-reporter notification, and `unit-final/0.json` contains the 23 passing results.
Failure controls bound persistent pending/no-progress states at five seconds and
cover terminal errors, rejection, each ownership coordinate, pending-to-terminal
transition and successful zero without rereading. No writer flush, synthetic
completion, repeated input, sleep, retry or longer timeout supplies progress.

`bounded protected reads leave time for received paging progress` seeds 300
items in real protected SQLite storage, restores the real item store and schedules
received page publication after the initial read. Each observed decrypt advances
only Vitest's fake monotonic clock by 10 ms; task delivery stays real, without
wall-clock sleeps. The original full reader performs 603 decrypts and times out
with `no-progress` at start 113 before publication. Bounded observations perform
nine decrypts across the trace
`query-dispatched → protected-read:113 → page-published → protected-read:error → range-durable → protected-read:63`.
The error is the real pending split save; only the subsequent durable protected
start 63 establishes progress. Page-owner controls and an unchanged newest range
beside an older disconnected range prevent false progress. This establishes a
contention mechanism, without attributing unrecorded host/keychain timings to
the historical failures.

The scenario retains saved-checkpoint catch-up, all 205 closed-app posts, trusted
Home/ArrowUp input, exact request growth, bubble growth, baseline recovery, order,
uniqueness and no legacy requests. Synchronous inspection, successful-profile
retirement, full outgoing-envelope matching, causal checkpoints and final exchange
completion remain required, as does connection ownership. See
[owned persistence obligations](chat-history-api.md#owned-authoritative-mutations).

### Counted Linux bounded-observation validation

The [bounded-observation plan](../../specs/architecture/2158-bounded-protected-coverage.md#validation-evidence)
retains commands, report hashes and build/input identities for Linux x64 on
2026-10-20. Builder acceptance used clean normal build
`a17ce88308917e07480fbe99c01ff61c25dc5aee`, containing main `1c001e0e`.
Reviewed head `4d276367eb48b34e1bb2890fc240647c9d36286a` adds plan evidence only.
These are recorded results, not documentation-stage executions.

| Run | Executed / passed / failed / skipped | Evidence |
| --- | --- | --- |
| Original full-read causal regression | 1 / 0 / 1 / 27 unselected | `/tmp/builder-2158/causal-before-clock.log` |
| Final observer regressions | 28 / 28 / 0 / 0 | `/tmp/builder-2158/units-final/unit-o3ppu_e3/0.json` |
| Exact named guarded history case, normal build | 1 / 1 / 0 / 0 | `/tmp/builder-2158/named-final.json` |
| Subsequent complete guarded replay, normal build | 29 / 29 / 0 / 1 | `/tmp/builder-2158/recorded-full-final.json` |
| Supplied dispatcher unit gate 4 | 9874 / 9874 / 0 / 3 | Both causal and split-save tests explicitly present and passed |
| Dispatcher application gate 7 | 518 / 516 / 2 / 5 | Named history case explicitly present and passed |

`a real daemon lazily fills a served gap after more than 200 entries written while Electron is closed`
is present and passed at retry 0 in both builder replay reports and the configured
`npx playwright test --reporter=json` gate, as confirmed by the accepted verifier
stage (`68cc9d585ffff8e22eba7ec9cb8eb817d206e3fd4eb5cbba445beddfe69e9cc0`).
Each history exchange completed 32 matched requests / 63 emitted frames / zero
remaining requests. Builder runs used one worker, retries zero, no flaky results
and zero forbidden launches; all 29 complete-suite exchanges finished with zero
remaining requests. The application gate's two unrelated thumbnail failures
received the dispatcher's accepted same-tree rerun disposition; its original
counts above retain those failures. The existing
`real claude picks up a saved channel system prompt at Reset session` case was
skipped in complete replay and application gate 7.

Node checks finished before Electron native preparation. The plan retains both
earlier preparation failures, which provide no acceptance proof. History recording
bytes remain unchanged: SHA-256
`de0b1166b6e05e0792228c07be25c20498b117914e673558222eac12cd4e6d2c`;
capture Desktop `00ec821f9380b00cf2dfc0dd4817ee15584106a5`, daemon
`58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`, binary SHA-256
`5f5b3b9ce42eda74024637f4929dd720d36c1226ce6e370eb62fbe9e6b22f7c0`,
capture time `2026-10-16T12:30:09.805Z`, Claude `not-spawned`.
Captured-client acceptance establishes no fresh provider/daemon or physical-effect
result. macOS is outside this Linux ticket's verification scope.

The later historical failures found during #2155 verification remain retained in
bundle `14df6631806c2588217566de95cd3eee953c694985c152a314a588117e8f300f`,
retrieved under `/tmp/builder-2158/evidence-2155/`. Candidate `9189aa1a` and isolated
main `64e0a66876fe` both failed with `no-progress`, 30 matched requests / 59 emitted
frames / two remaining requests. The accepted verifier checked all 25 bundle
hashes. Those failures remain distinct from the controlled mechanism and subsequent
acceptance; their precise host scheduling conditions were not captured.

### Counted Linux coverage-observer validation

[Current-source validation and commands](../../specs/architecture/2153-protected-history-coverage.md#reopened-current-source-validation-results--2026-10-20)
record Linux x64 results on 2026-10-20, Node 25.8.0 and Electron 33.4.11.
Clean builder build `c733774b645ee8673bc84c73ec3be102d2de5075` contains admitted
main `2d8a7e323ffe74f7ba4e232483a267d8b5a0d0a1`, split-save repair `172d3f95`
and bounded-reader repair `a17ce883`. Current-source acceptance required no
additional implementation change. Separately, the
[accepted verifier review](https://github.com/pyrycode/pyrycode-desktop/pull/2177)
(stage `711a01e64d19d1c402d48ee2fdce2f3f5378eed7848259b8975179b749e34d3b`)
checked reviewed application-gate head `9b02c253d59b06a608543734e12aa477ae943d47`,
which includes later main changes. These are recorded results; documentation ran
no unit, application or live tests.

| Run | Executed / passed / failed / skipped | Workers and named evidence |
| --- | --- | --- |
| Existing observer regressions, `units/unit-q3svyjl8/0.json` | 28 / 28 / 0 / 0 | Both split-save and bounded-read contention cases below present and passed, including failure/ownership controls |
| Five consecutive guarded paired batches, `paired-{1..5}.json` | 20 / 20 / 0 / 0 | Each 4 / 4 / 0 / 0; three configured/overlapping slots, retries zero |
| Subsequent complete guarded replay, `recorded-full.json` | 29 / 29 / 0 / 1 | One configured/actual worker, retries zero |
| Supplied dispatcher unit gate 4, `unit-test-gate.py` | 9908 / 9908 / 0 / 3 | Both split-save and bounded-read contention cases below explicitly present and passed |
| Dispatcher application gate 7, `npx playwright test --reporter=json` | 528 / 528 / 0 / 4 | Both named history/thread cases below present and passed once, retries zero |

The unit cases are `waits across split saves at baseline and after dispatch` and
`bounded protected reads leave time for received paging progress`. The supplied
dispatcher gate report supplies unit totals above rather than the verdict's
9,990 total; named passes agree, and the verifier confirms all 28 observer tests
passed on the reviewed candidate. The application gate is completed separately
from builder acceptance; the earlier candidate's accepted gate is not its proof.

All six builder runs used `--profile complete-thread`. Both
`a real daemon lazily fills a served gap after more than 200 entries written while Electron is closed`
and `daemon-built thread streams, places an agent, reconnects, resets and reopens saved items`
passed twice per paired batch and once in complete replay. Every batch reached
three overlapping tests in slots 0/1/2. Batches 1/2/4/5 recycled a completed
worker; this changed worker identities without changing concurrency or retrying.
The verifier independently confirmed each named case executed/passed once at
retry zero in dispatcher gate 7, with completed history 32/63/0 and thread
45/378/0 exchanges (matched requests/emitted frames/remaining requests).
Builder artifacts are under `/tmp/builder-2153/reopened/`; the independent
verifier summary is `/tmp/verifier-2177/evidence-summary.json`.

All six builder guards recorded zero forbidden launches. Every history exchange
matched 32 requests/emitted 63 frames; thread matched 45/emitted 378, with zero
remaining per exchange. All 29 full-suite exchanges completed: 773 matched
requests, 3,216 emitted frames, zero remaining. Exchange completion establishes
neither renderer publication nor protected durability; numeric coverage retains
its separate progress assertion. Node checks finished before Electron native
preparation, and every profile run restored the normal build. The plan retains
commands, report hashes, identical seven-output bundle maps and the counted
summary SHA-256 `2decf5ee8a0d12bdf1464e93155636f55a0639e6adec56b0aac1987f398a2f03`.

Recording bytes remain unchanged: history SHA-256
`de0b1166b6e05e0792228c07be25c20498b117914e673558222eac12cd4e6d2c`;
thread `53a3db11cfab2d5041b511d7be4d030ab5b2b8449b7fdb3ea1d7e5e3db552ae3`.
Both retain capture Desktop `00ec821f9380b00cf2dfc0dd4817ee15584106a5`, daemon
`58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`, binary SHA-256
`5f5b3b9ce42eda74024637f4929dd720d36c1226ce6e370eb62fbe9e6b22f7c0`.
`real claude picks up a saved channel system prompt at Reset session` remains
the explicit full-replay fixme/skip and was skipped in dispatcher gate 7 too.
No timeout, sleep, retry, skip, concurrency, envelope matching, causal checkpoint,
synchronous inspection, successful-profile retirement or paging assertion changed.
No fresh provider/daemon or physical-effect acceptance is required or claimed;
macOS is outside this Linux ticket's verification scope.

The [earlier split-save acceptance](../../specs/architecture/2153-protected-history-coverage.md#validation-evidence)
and [accepted verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2156#issuecomment-6284779714)
remain distinct: builder `172d3f959d6b1fb89368c7805885d95d44aa6076` after main
`845cf9a25196`, reviewed head `894c381df2bb1d9da6edbc873aaf31fa214f1a51`.
Its controlled regressions passed 23 / 23 / 0 / 0; five paired batches passed
20 / 20 / 0 / 0; complete replay recorded 29 / 29 / 0 / 1. Supplied dispatcher
unit totals were 9844 / 9844 / 0 / 3, with the split-save case passed; application
gate recorded 517 / 517 / 0 / 5, both named history/thread cases passed once
without retry. Artifacts remain at `/tmp/builder-2153/` and
`/tmp/verifier-2156/evidence-summary.json`; the original plan retains their hashes.

Historical Linux outcomes at `de6e481a` remain separate: the filed full run
`/tmp/builder-2079/replay-fixed.json` recorded 29 executed, 28 passed, 1 failed,
1 existing reset-prompt skip, and the unchanged isolated `replay-history.json`
recorded 1 executed/passed, 0 failed/skipped. The former timed out on paging
coverage with one outgoing request remaining. These counts come from the
[retained refinement evidence](https://github.com/pyrycode/pyrycode-desktop/issues/2153#issuecomment-6284141287),
not fresh inspection of the original full reports.

The [reopened refinement evidence](https://github.com/pyrycode/pyrycode-desktop/issues/2153#issuecomment-6289103979)
retains the second failure/unchanged-pass pair on `b505bf011812970b2b8048afebb735381b8e4691`:
application gate 518 executed / 516 passed / 2 failed / 5 skipped, then a selected
same-tree rerun 3 / 3 / 0 / 0. History failed on ArrowUp with `no-progress` despite
32 matched requests / 63 emitted frames / zero remaining. That candidate contains
`172d3f95` but predates `a17ce883`; the failure does not demonstrate recurrence
after the bounded repair. The retained report SHA-256 is
`6357d95a5b114944be2f73f747764f711ebf675884d785423e5035367ea48218`, in the
checksummed #2125 evidence referenced by the plan.

The original one-shot projection failure (1 executed/failed, 21 unselected) and
[full-read contention failure](../../specs/architecture/2158-bounded-protected-coverage.md#validation-evidence)
(1 executed/failed, 27 unselected) preserve the controlled failing-before proofs;
their hashes remain in the original plans. They establish split-save observation
and growing-read contention mechanisms, not either historical trigger. The verifier
checked all 69 checksums in retained #2125/#2158 bundles and all 20 files in the
earlier accepted verifier bundle. Neither historical trigger is established;
unchanged reruns and current passing acceptance do not reclassify either failure.

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

## Retained storage contract

Legacy `DurableThreadItem`, row codecs and their exact renderer-type equality
fixture were deleted with the retired storage API. Lists and `ThreadSnapshot`
remain the shared persistence contract. Parser/owned/page admission and protected
fresh-owner tests cover retained behavior; see
[ignore-policy and lifecycle regressions](chat-history-testing-contracts.md#demand-and-snapshot-contracts)
and [current native evidence](chat-history-testing-native.md#counted-legacy-storage-retirement-validation).

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
