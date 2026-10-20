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
`undefined`. Before Home and each ArrowUp it retains the first actual numeric
range start from a stored `daemon-items` snapshot with exact outer and inner
host/conversation ownership. Zero is valid. The successful polling callback
supplies the retained value; a second read could lose availability again.

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
durability and retains starts 100 then 50. Controlled dispatch/publication markers
come from the existing owned-state fixture seam; the application scenario checks
actual requests separately. The content-free trace is
`/tmp/builder-2153/regression.log`; `unit-final/0.log` is only the final
JSON-reporter notification, and `unit-final/0.json` contains the 23 passing results.
Failure controls bound persistent pending/no-progress states at five seconds and
cover terminal errors, rejection, each ownership coordinate, pending-to-terminal
transition and successful zero without rereading. No writer flush, synthetic
completion, repeated input, sleep, retry or longer timeout supplies progress.

The scenario retains saved-checkpoint catch-up, all 205 closed-app posts, trusted
Home/ArrowUp input, exact request growth, bubble growth, baseline recovery, order,
uniqueness and no legacy requests. Synchronous inspection, successful-profile
retirement, full outgoing-envelope matching, causal checkpoints and final exchange
completion remain required. See [owned persistence obligations](chat-history-api.md#owned-authoritative-mutations).

### Counted Linux coverage-observer validation

The [plan and commands](../../specs/architecture/2153-protected-history-coverage.md#validation-evidence)
and [accepted verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2156#issuecomment-6284779714)
record Linux x64 results on 2026-10-20. Builder runs tested clean implementation
`172d3f959d6b1fb89368c7805885d95d44aa6076`, after main `845cf9a25196`;
reviewed head `894c381df2bb1d9da6edbc873aaf31fa214f1a51` adds plan evidence only.
These are recorded results, not documentation-stage test runs.

| Run | Executed / passed / failed / skipped | Workers and retries |
| --- | --- | --- |
| Final controlled/failure regressions, `unit-final/0.json` | 23 / 23 / 0 / 0 | Node-native preparation before Electron preparation |
| Five consecutive guarded paired batches, `paired-{1..5}.json` | 20 / 20 / 0 / 0 | Each 4 / 4 / 0 / 0; three configured/overlapping slots, retries zero |
| Subsequent complete guarded replay, `recorded-full.json` | 29 / 29 / 0 / 1 | One configured/actual worker, retries zero |
| Supplied dispatcher unit gate 4 | 9844 / 9844 / 0 / 3 | Controlled split-save case explicitly present and passed |
| Dispatcher application gate 7, `npx playwright test --reporter=json` | 517 / 517 / 0 / 5 | Both named cases below present and passed without retry |

The paired and complete builder runs used `--profile complete-thread`. Both
`a real daemon lazily fills a served gap after more than 200 entries written while Electron is closed`
and `daemon-built thread streams, places an agent, reconnects, resets and reopens saved items`
passed twice per paired batch and once in complete replay. Separately, the verifier
confirmed each executed/passed once, retries zero, with completed exchanges in the
dispatcher application gate. Unit totals above come from the supplied dispatcher
gate report. Builder reports and the independent verifier summary are retained at
`/tmp/builder-2153/` and `/tmp/verifier-2156/evidence-summary.json` respectively.

All six builder guards recorded zero forbidden launches. Every paired history
exchange matched 32 requests/emitted 63 frames; thread matched 45/emitted 378,
with zero remaining requests per exchange. All 29 full-suite exchanges completed:
773 matched requests, 3,216 emitted frames, zero remaining. Recycled worker
identities in batches 2/4 reused completed slots; all five batches reached three
overlapping tests with retries zero. The plan retains bundle hashes, report hashes,
commands and capture provenance separately from the tested build identity.

Recording bytes remain unchanged: history SHA-256
`de0b1166b6e05e0792228c07be25c20498b117914e673558222eac12cd4e6d2c`;
thread `53a3db11cfab2d5041b511d7be4d030ab5b2b8449b7fdb3ea1d7e5e3db552ae3`.
Both retain capture Desktop `00ec821f9380b00cf2dfc0dd4817ee15584106a5`, daemon
`58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`, binary SHA-256
`5f5b3b9ce42eda74024637f4929dd720d36c1226ce6e370eb62fbe9e6b22f7c0`.
`real claude picks up a saved channel system prompt at Reset session` remains
the explicit full-replay fixme/skip and was skipped in dispatcher gate 7 too.
No fresh provider/daemon or physical-effect acceptance is required or claimed;
macOS is outside this Linux ticket's verification scope.

Historical Linux outcomes at `de6e481a` remain separate: the filed full run
`/tmp/builder-2079/replay-fixed.json` recorded 29 executed, 28 passed, 1 failed,
1 existing reset-prompt skip, and the unchanged isolated `replay-history.json`
recorded 1 executed/passed, 0 failed/skipped. The former timed out on paging
coverage with one outgoing request remaining. These counts come from the
[retained refinement evidence](https://github.com/pyrycode/pyrycode-desktop/issues/2153#issuecomment-6284141287),
not fresh inspection of the original full reports. The controlled old-projection
failure (1 executed/failed, 21 unselected) establishes a pending-save observation
mechanism; it does not establish that historical trigger. Neither the isolated
pass nor later passing replay reclassifies the historical failure.

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
