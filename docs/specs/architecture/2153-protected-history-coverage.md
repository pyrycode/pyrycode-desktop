# Protected history paging observations

## Files read
- `e2e/real-daemon-history-on-open.spec.ts` → `coverage`, `mainRead`: collapsed protected results and one-shot paging baseline; synchronous inspection remains intact.
- `e2e/fixtures/savedListTitle.ts`, `savedListTitle.test.ts` → `readSavedListTitle`: bounded result classification and real protected-store regression setup.
- `src/renderer/src/store/chatHistoryWriter.ts` → `mutationSteps`, `drain`: bounded split submissions and acknowledgement-driven cursor.
- `src/main/chatHistoryHandler.ts` → `createChatHistoryHandler`: saved-host authorization and serialized operations.
- `src/main/indexedThreadHistory.ts` → `load`: pending persistence obligations reject public reads.
- `src/renderer/src/store/threadItemStore.ts` → `beginBatch`: publication and certified ranges.
- `e2e/daemon-item-cache.test.ts` → split-save controls: existing owned-state injection through the real writer.
- `docs/knowledge/features/chat-history-api.md` → Owned authoritative mutations: preserve fail-closed reads until final durable part.
- `docs/knowledge/features/development-verification.md`, `docs/recorded-tests.md`, `docs/client-replay-migration.md`: counted guarded replay, native ABI preparation, capture provenance and excluded reset fixme.
- Root `CLAUDE.md`, `docs/knowledge/INDEX.md`: test-first and process boundaries.

## Context
One independently useful behavior: trustworthy durable progress for each trusted paging input. Its single-consumer reader and causal/failure controls belong together. The historical Linux failure at `de6e481a` and unchanged isolated pass remain separate outcomes; neither establishes the trigger. The controlled pending-save mechanism demonstrates the observation defect without claiming to reproduce that historical trigger. No production repair or ADR is needed.

Sizing: approximately 450 written lines including plan/evidence, zero production files, one helper export, one scenario consumer, four observable acceptance criteria, fewer than ten classified observation branches. Recount before implementation remains below all ceilings. Remote feature-branch inspection found no overlap with the three planned e2e paths (including #2079).

## Design
Add `readHistoryCoverage(read, host, conversation, before?): Promise<number>` in `e2e/fixtures/historyCoverage.ts`. Consume complete `ChatHistoryResult` values. Return the actual first numeric range start, including zero, only for daemon items with exact outer and inner ownership. With `before`, require a strictly smaller value. Retain the successful value from the polling callback itself; never reread it after success.

Use one five-second polling bound per observation. Missing snapshots, empty ranges, pending-save `unreadable`, and unchanged/increased starts remain pending categories. Other classified errors, rejected reads, unexpected status/kind and wrong ownership terminate immediately with content-free diagnostics. Polling yields static categories, never snapshots or exceptions.

Before Home and each ArrowUp obtain a numeric baseline. After each input start durable-progress observation alongside the existing exact request-count check, so waiting for dispatch cannot add another coverage deadline. Preserve bubble growth, all 205 posts, saved-checkpoint catch-up, trusted input, recovery/order/uniqueness/no-legacy assertions. Leave synchronous inspector access and profile retirement untouched. No new state store, production interface, dependency or harness migration.

## State + concurrency model
Observation state is local to one call: a retained numeric result and static status. It performs read-only IPC; it does not flush writers or retry inputs. The controlled regression schedules the real writer and holds split submission/acknowledgement boundaries outside the handler queue, allowing actual protected reads while the obligation is pending. Gates release and writer/store/database cleanup finish in `finally`.

## State transitions and identity reuse
| Event | Regression |
| --- | --- |
| Split prefix durable before baseline | `waits across split saves at baseline and after dispatch`: old projection is undefined, reader stays pending until final durability. |
| Page dispatched/published while persistence pending | Same regression: request/publication trace precedes unreadable read, then final acknowledgement and strictly older range. |
| Consecutive paging observations | Same regression retains first numeric baseline and uses it for the next save; successful baseline is read once. |
| Unavailable state persists | `bounds persistent ...`: unreadable, missing, empty, equal and increased starts fail by five seconds. |
| Wrong owner/kind, classified error or rejection | `does not repeat ...`: one read, static diagnostic, no content. |
| Zero range start | `returns actual zero without rereading`: zero satisfies availability and strict progress. |

## Error handling
Only `unreadable` is a retryable classified storage result. Missing/empty coverage and no progress are bounded failures, never coverage. Read rejections become `read-failed`; unexpected status/kind and ownership use static diagnostics. No caught error, message content or credentials enter traces.

## Testing strategy
- Write controlled and failure tests first and observe the missing/broken reader fail, then implement.
- Real SQLite/protection, secure-store setup, handler and writer; controlled scheduling at existing writer seam. Assert the original projection fails under held durable prefixes, and the repaired observation does not finish prematurely.
- Fake timers for observation deadlines; real writer event-loop yields remain intact. Cover baseline retention, zero, pending states, strict decrease, all terminal result codes, rejection and exact ownership.
- After final main merge: pre-verify with the new unit file, client-test typecheck, docs check and normal build. Complete Node-native checks before Electron-native rebuild.
- Linux only: five consecutive guarded complete-thread paired batches, each named history/thread case twice, three actual workers, retries zero (20 total passes), followed by complete guarded committed replay. Retain reports, build identity, capture hashes, exchange counts and guard counts in validation evidence. Dispatcher owns configured application gate for both named cases; existing reset-prompt fixme stays excluded. No fresh live acceptance required.

## Open Questions
None. A single observation helper is the smallest shape; no new generalized polling framework.

## Validation evidence
Linux x64, 2026-10-20. Tested implementation `172d3f959d6b1fb89368c7805885d95d44aa6076`, containing final merged main `845cf9a25196`. The subsequent evidence commit changes only this plan. All six guarded runs identify that clean implementation (`sourceDirty: false`), profile `complete-thread`, and identical bundle hashes. Main bundle SHA-256: `14964f03eb41095b9ee91af5f78d8a422a44c760386a9c8e498c33ff1865b69f`; renderer bundle SHA-256: `6a805af00d6ad979a615b7fc660d69ed81bfcd2ed5b81c4650f87e66098e02a9`. Full bundle maps remain in each run log and `/tmp/builder-2153/counted-evidence.json`.

Controlled proof: the original one-shot projection failed with an actual pending protected save (1 executed, 1 failed, 21 unselected; `/tmp/builder-2153/original-regression.log`, SHA-256 `9ac0bc9838ab12fd5700bd42006400811aae32efabfb420749e09f9179fbe82f`). The real writer submitted a durable prefix; protected reads returned `unreadable` both before baseline acquisition and after controlled page publication. The repaired reader remained pending across the held prefix acknowledgement and held final submission. After the final durable commit/acknowledgement it retained starts 100 then 50. The content-free trace in `/tmp/builder-2153/regression.log` separates the controlled dispatch/publication markers at the existing owned-state fixture seam, protected read statuses, prefix/final durability, acknowledgements and retained numeric starts; actual application dispatch is independently checked by the unchanged guarded scenario and full envelope matching. This establishes the controlled mechanism, not the unknown historical trigger. `unit-final/0.log` contains the final JSON-reporter notification, not this trace; `unit-final/0.json` contains the 23 passing regression results.

The additional pending-to-unexpected-result control also failed before its correction (`terminal-transition-red.log`); final regressions cover immediate terminal classification after pending reads. Final Node-native preparation and pre-verify passed all five checks with 23 executed/passed, zero failed/skipped. Raw unit JSON: `/tmp/builder-2153/unit-final/0.json`, SHA-256 `8959f12c67359862dbfe2ea589fc736f216a00a1fd1faf7761e5c21c3c16bd0f`. Client-test typecheck, docs guard and `npm run build` passed after the final main merge. Node preparation finished before `npm run rebuild:electron`; no native rebuild competed with replay. Every profile run restored the normal build successfully.

Commands, from the worktree root:
```sh
python3 /work/Projects/pyrycode-desktop-agents/bin/pre-verify-check --test-file e2e/fixtures/historyCoverage.test.ts
npm run typecheck:client-tests
npm run check:docs
npm run build
npm run rebuild:electron
# Five consecutive batches, N = 1..5, each with its own log/results directory:
PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/builder-2153/paired-N.json node scripts/run-offline-replay.mjs --profile complete-thread --grep 'a real daemon lazily fills a served gap|daemon-built thread streams' --fully-parallel --workers=3 --repeat-each=2 --retries=0 --reporter=list,json --output=/tmp/builder-2153/paired-N-results
PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/builder-2153/recorded-full.json node scripts/run-offline-replay.mjs --profile complete-thread --retries=0 --reporter=list,json --output=/tmp/builder-2153/recorded-full-results
```

| Report under `/tmp/builder-2153/` | Executed / passed / failed / skipped | Configured / concurrent worker slots | Report SHA-256 |
| --- | --- | --- | --- |
| `paired-1.json` | 4 / 4 / 0 / 0 | 3 / 3 | `e0777fa844ebf0e4804541e5b28d5920d0d54187ee9bdd62f956ad93f18590a6` |
| `paired-2.json` | 4 / 4 / 0 / 0 | 3 / 3 | `b854609f5b573ed2a7005026f019f3f535a9239be72f259e077a1feee0ee814a` |
| `paired-3.json` | 4 / 4 / 0 / 0 | 3 / 3 | `eb1d933fdc2c96ca3ee571391c901db89585914f31a76d39c288412b80684208` |
| `paired-4.json` | 4 / 4 / 0 / 0 | 3 / 3 | `5367994ef47848bc687443de2ae9afd5fba15d82f2344ed4878858ea1ae682ea` |
| `paired-5.json` | 4 / 4 / 0 / 0 | 3 / 3 | `f073ea4f1e1ffc3b4b3abe33ff76d6cf6e2ae13e1e363b3becfbb2639cf65adf` |
| `recorded-full.json` | 29 / 29 / 0 / 1 | 1 / 1 (unchanged default) | `a7594142b6e1dc26a4451e69c4228bd4d55f1256669513c93f4c3cf86a343cf2` |

All retries are zero, with no flaky results or report errors. Every batch used actual parallel slots 0/1/2 and reached three overlapping tests. Worker indices were 0/1/2 in batches 1/3/5 and 0/1/2/3 in batches 2/4: the latter recycled one completed worker slot without retry or increased concurrency. Full replay used worker/slot 0. Both named cases passed twice in every paired batch (20 total passes) and once each in full replay. The sole full-suite skip remains `real claude picks up a saved channel system prompt at Reset session`; it is not a pass.

Every guard reported `forbiddenLaunchAttempts: 0`. Every history exchange matched 32 requests/emitted 63 frames, and every thread exchange matched 45/emitted 378, with zero remaining requests per exchange. All 29 full-suite exchanges completed: 773 matched requests, 3,216 emitted frames, zero remaining. Logs are `paired-{1..5}.log` and `recorded-full.log`; original JSON attachments retain per-exchange counts, input checksums and provenance. The read-only summarizer `/tmp/builder-2153/summarize.py` checks named-case multiplicity, retries, worker overlap, build identity, guard outcomes and every exchange's remaining count; its output is `validation-summary.log` / `counted-evidence.json`.

Recording bytes are unchanged. History SHA-256: `de0b1166b6e05e0792228c07be25c20498b117914e673558222eac12cd4e6d2c`; thread SHA-256: `53a3db11cfab2d5041b511d7be4d030ab5b2b8449b7fdb3ea1d7e5e3db552ae3`. Both retain capture Desktop `00ec821f9380b00cf2dfc0dd4817ee15584106a5`, daemon `58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`, daemon binary SHA-256 `5f5b3b9ce42eda74024637f4929dd720d36c1226ce6e370eb62fbe9e6b22f7c0`. Full outgoing-envelope matching, causal checkpoints, synchronous inspection, profile retirement and final exchange completion remain intact.

Historical outcomes remain retained by reference to the ticket's refinement evidence: the Linux failure at `de6e481a` (`/tmp/builder-2079/replay-fixed.json`, filed counts 29 executed / 28 passed / 1 failed / 1 existing skip), followed by an unchanged isolated pass (`replay-history.json`, 1 executed/passed). These are historical filed counts, not freshly inspected reports or evidence of the trigger. Neither that passing rerun nor these new passing replays reclassifies the old failure.

Dispatcher handoff: run the configured application gate and retain counted no-retry passes for both named cases; verifier reviews that evidence separately from inherited failures. This builder does not claim that gate passed. No fresh provider/daemon or physical-effect acceptance is required or claimed. macOS is outside this Linux ticket's verification scope.

### Dispatcher gate reconciliation

The [accepted verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2156#issuecomment-6284779714)
subsequently completed that handoff on reviewed head
`894c381df2bb1d9da6edbc873aaf31fa214f1a51`. The supplied dispatcher gate report
records Linux unit gate 4 (`python3 /work/Projects/pyrycode-desktop-agents/bin/unit-test-gate.py`):
9,844 executed/passed, 0 failed, 3 skipped, with
`waits across split saves at baseline and after dispatch` explicitly present and passed.
These unit totals use the supplied gate report rather than the verdict's differing
9,926 total. Application gate 7 (`npx playwright test --reporter=json`) recorded
517 executed/passed, 0 failed, 5 skipped. Both named history/thread cases above
are explicitly present and passed; the verifier confirmed each executed/passed
once with retries zero and completed exchanges. The reset-prompt case remains
skipped. These dispatcher results are separate from the builder's guarded runs;
no gate or live test was rerun by documentation. The reconciled contract and
evidence live in [protected history testing](../../knowledge/features/chat-history-testing.md#protected-paging-coverage-observation).

## Revisions

### 2026-10-20 — reopened current-source validation plan

The reopened contract first validates the already merged split-save repair
`172d3f95` and bounded-reader repair `a17ce883` on admitted current main
`2d8a7e323ffe74f7ba4e232483a267d8b5a0d0a1`. Both are ancestors of this tree.
No implementation change is planned unless current-source execution demonstrates
a local observer/scenario defect. Existing causal regressions are reused.

Additional files read: `e2e/fixtures/historyCoverage.ts` → `readHistoryCoverage`
(exact-owner `newestThreadPage`, limit 1, newest range, retained numeric value);
`e2e/fixtures/historyCoverage.test.ts` → held split-save and bounded-read contention
regressions plus pending/terminal/ownership/disconnected-range/zero controls;
`docs/specs/architecture/2158-bounded-protected-coverage.md` → original causal red
and subsequent green evidence; `docs/knowledge/features/chat-history-testing.md`
→ Protected paging coverage observation; `chat-history-api.md` → Owned authoritative
mutations; replay/profile documentation and development verification overview.
QMD found the owning observation contract. Remote feature-branch overlap inspection
after fetch found no overlap with the plan, observer, regression or scenario paths.
The issue labels were read before this plan commit; no security-sensitive label.

One deliverable remains durable numeric progress at every trusted paging input.
Incremental scope: approximately 150–250 written plan/evidence lines, zero
production files, zero new exported types, one existing scenario consumer,
four acceptance behaviors and no new rejection branches. This fits all ceilings;
the regression and single-consumer observer remain one verifiable slice.

Retain the bounded contract added by #2158 rather than the original full-reader
design above: newest authenticated range for page results, exact ownership,
numeric baseline before each input and strictly older numeric progress in the
existing single five-second bound. Existing lifecycle, failure and identity tests
remain the coverage table; add no state, cancellation path, UI or production change.

Validation order: install dependencies; finish Node-native pre-verify for the
entire `historyCoverage.test.ts` file, client-test typecheck and docs guard; build;
prepare Electron SQLite; run five consecutive complete-thread paired batches
(both named history/thread cases twice, three actual workers, retries zero),
then the complete guarded committed suite. Count executions, skips, worker
overlap, guard attempts, build identity, input provenance and every exchange's
remaining requests. Keep the existing reset-prompt fixme explicitly excluded.
Dispatcher owns the subsequent configured application gate, including no-retry
passes for both named cases; verifier reviews that evidence separately.

Historical outcomes are not reclassified: the original `de6e481a` failure and
unchanged isolated pass remain recorded above. The reopened #2125 failure at
`b505bf011812970b2b8048afebb735381b8e4691` contains the split-save repair but
predates `a17ce883`. Refinement independently inspected report SHA-256
`6357d95a5b114944be2f73f747764f711ebf675884d785423e5035367ea48218`:
518 executed / 516 passed / 2 failed / 5 skipped, history ArrowUp `no-progress`,
32 matched / 63 emitted / 0 remaining. Its unchanged selected rerun passed
3 / 3 / 0 / 0. Neither historical trigger is established. Preserve original
causal failing-before evidence above and in the #2158 plan; do not manufacture
a new failure or claim exchange completion proves publication/durability.

Open questions: none. Linux x64 is this run's verification scope; no fresh
provider/daemon or physical-effect acceptance is required.
