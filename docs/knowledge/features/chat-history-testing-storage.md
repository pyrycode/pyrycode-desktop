# Protected history testing — indexed storage

Part of [protected history testing](chat-history-testing.md).

## Bounded opening selection and work

The protected-disk `indexedThreadHistory.test.ts` fixtures extend the existing
backend/fresh-owner harness:

- `bounded opening selects shown, active and recorded dependencies after fresh reopen`
  puts 240 shown messages after a shown parent, a hidden ancestor and attributed
  hidden ending, followed by 1,000 hidden items including one active item. Opening
  retains the last 200 shown messages, both recorded ancestors, the ending and the
  active item, excluding an unrelated descendant. Reversed first-arrival metadata
  and misleading timestamps cannot change held selection. Exact agent fields retain
  ending/marker placement; hidden dependencies keep `shown: false`.
- `opening indexes follow owned revisions and removal without reviving old dependencies`
  changes shown/active flags, removes an item and reopens a fresh owner. Selection
  follows committed revisions/removal instead of stale index membership.
- `cold opening payload work stays bounded as unrelated older, hidden and range history grows`
  compares 262/1,242 items with additional unrelated ranges. It pays retained
  replacement conversion before close/reopen, then instruments structural rows,
  protected records, direct payload lookup and decrypts independently. Both opens
  select 200 base items, one active item, one parent dependency and three intact
  evidence ranges. Each requires 206 protected record reads, 202 payload reads and
  408 decrypts; structural traversal is allowed logarithmic growth. See
  [counted measurements and timings](chat-history-testing-native.md#counted-bounded-opening-validation).
  The same fixture resets counters and measures a 200-item newest held traversal
  page: 200 payload reads, at most 204 protected record reads and 408 decrypts at
  both sizes. Structural work is counted separately; see
  [traversal measurements](chat-history-testing-native.md#counted-unchanged-saved-traversal-validation).

Filtering existing held pages would scan long hidden tails. Counting only decrypts
would also miss repeated authenticated structural traversal: the first capture
performed about 35,000 structural reads for 200 base items. Transaction-local caches
keyed by complete authenticated proofs reduce repeated SQL/JSON work while retaining
root verification, detached mutation containers and selected evidence caching.
One-time collection import/retirement and addressed conversion can scale with data;
measure them outside ordinary cold opening. A full replacement invalidates indexes
atomically and requires conversion once again, while owned writes maintain them.

## Owned mutation regressions and counted validation

The same protected-disk `indexedThreadHistory.test.ts` fixtures cover subset and
metadata-only saves, highest revisions, explicit removal/epoch transition, stale
tokens, range merging without placement rewrites, placement/range/branch replay,
transactional rollback/retry and lazy schema-6 conversion. Aggregate admission uses
two separately flushed 60,000-null items: the second rejects atomically and fresh
full/page reads retain the first. Old fractional roots convert with exact placement
bytes; tampered parent hints cannot authorize rank.

Replacement-seeded edits can hide growing append cost. `successive owned additions
keep ordering paths and record work bounded without rewriting placements` starts
empty, adds through 513 items and checks mutations at 16/128/512: fewer than 500
record reads and 300 writes, with the first placement unchanged. Shuffled additions,
order movement, internal removal and fresh pages pin AVL behavior. `ordinary owned
validation, serialization and protected record work stay bounded as unrelated
history grows` compares 10/1,000 items: each revision has three decrypts, three
encrypts and equal item-serialization counts, with fewer than 40 extra reads/writes
for logarithmic sequence work. `coalesces shared protected paths into one write per
path in an owned batch` checks one write per final path for 400 items. See the
[focus classification](development-verification-layout-and-input.md#visible-tail-focus-reliability):
batching resolved the observed timeout even in isolation; native-focus scheduling
remains unproven. Keep this regression and the read spec.

`reuses constructed authenticated nodes within one owned submission without reparsing them`
counts reparses of locally serialized index nodes in a shuffled 31-item submission,
requires zero, then compares exact fresh-owner contents and rejects disk-node
corruption in a later transaction. Counting SQL or protected payload operations alone
misses this CPU cost: populating caches only during reads still reparsed constructed
nodes 3,349 times before the correction. The causal red/green runs each executed one
test (78 filtered, none skipped): red failed, green passed. All 79 indexed-storage
tests then executed/passed with zero failures/skips. See the
[native comparison and counted Linux evidence](chat-history-testing-native.md#reopened-slow-drain-cause-and-correction)
for unchanged storage-operation counts and real input/heartbeat acceptance.

`e2e/daemon-item-cache.test.ts` compares separate, coalesced and held-failure saves
through protected disk/reopen. It covers saved/pending repair and unfinished fences,
partial/repeated completion, later live progress, same-epoch holder recreation,
explicit same-epoch reset and lost acknowledgements. A retried completed repair
cannot revive obligations behind checkpoint; a new repair at checkpoint persists.
Certified older/newer/equal boundaries preserve oldest exhaustion through metadata-only
saves. Writer fixtures retain newer work after failure and memory-only holder loss;
existing removal/cache/arrival-restart proofs now exercise owned requests.

The [final verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/2053#issuecomment-6212879270)
records Linux x64 on `5005bf69a9eb04ea2d7e11dbccd50cfbc464680e`, 2026-10-16:

| Run | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Units, 391 passing files | 9,103 | 9,103 | 0 | 3 |
| Complete configured fake suite, verifier gate 8 | 435 | 435 | 0 | 3 |
| Packaged production-protection case, included above | 1 | 1 | 0 | 0 |

The verifier confirms the repaired ordering, aggregate, reset and availability
regressions passed. Gate 8 explicitly contains passed `read setup is reused across
committed same-row deltas on short and long threads`. The packaged
`packaged protected history commits and reopens with production encryption` case
passed, including exact owned-update/reopen and 100,000 retained memberships.
Its inspected `/tmp/pyry-history-native-rDa7aD/runtime.stdout` records Linux x64,
Electron 33.4.11 / Node 20.18.3, better-sqlite3 12.4.1, `gnome_libsecret`,
packaged/asar/native-unpacked true and stage complete. Fake suite: four workers,
both configured projects, zero retries/flaky results or top-level errors. Build,
install, native rebuilds and docs guard passed. Pre-verify ran three structural/security
checks with `--no-suite`; counted units and build ran separately.

Unit skips require live-relay credentials; browser skips are three macOS-only
badge/window cases. Neither establishes live acceptance. macOS and live-Claude
are outside this ticket's scope; no live-Claude run was required. Earlier failures
remain failed in the [plan](../../specs/architecture/2044-owned-thread-changes.md):
fractional ordering missed bounded append work, and an exploratory packaged run
rejected `basic_text` until the existing admitted secret service was supplied.
The earlier full fake run with 434 passed, 1 failed, 3 skipped hit teardown context
loss repaired by [#2054](e2e-harness-context-recovery.md#disconnected-delivery-observations-and-cleanup),
with separate controlled recovery proof and counted Linux verification; the upstream
trigger and original cleanup execution remain unconfirmed. Final counted passes
supersede those candidates; no assertion, timeout, retry, skip or suite configuration
was weakened.

## Ignored legacy compatibility

The legacy indexed backend and its exclusive full/page suite are retired. Saved
legacy data is covered only at the compatibility boundary: mixed-source ignore,
strict retained admission, inert legacy-only scopes, schema-1 ownership and exact
scoped cleanup with unreadable payloads. See
[the migration regression inventory](chat-history-testing-contracts.md#demand-and-snapshot-contracts).
Authoritative opening, owned mutations and traversal/recovery retain their existing
protected-disk fixtures and [fresh counted native proof](chat-history-testing-native.md#counted-legacy-storage-retirement-validation).
