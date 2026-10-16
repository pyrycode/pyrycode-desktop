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
saves a baseline with served/display evidence, fully exits Electron through the
shared protected-profile relaunch fixture, and writes 205 unique `pyry channel post`
entries only in its awaited while-closed callback. Reopening asks newest once
without upward input and exposes the gap. Fresh focused input fills it under the
[demand and observation contract](chat-history-testing-contracts.md#demand-and-snapshot-contracts), retaining the
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
