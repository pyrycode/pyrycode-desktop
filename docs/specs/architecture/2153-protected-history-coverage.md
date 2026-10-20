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

### 2026-10-20 — late subscriber startup repair

The reopened contract now includes production status delivery. One useful behavior:
saved-profile catch-up remains ready when main accepts before React mounts. The
preload listener must exist before document load; a React effect is too late.
Cleaner-shape check: use the existing load replay and a preload-local status cache,
not a second renderer-to-main snapshot request with an asynchronous ordering race.
No consumer signature, main authorization, storage, wire or relay change is needed.

Additional files read:
- `src/main/index.ts` → `openWindow`: load replays retained statuses and starts idempotently.
- `src/main/liveWindow.ts` → `createLiveWindow`, `originOf`: four statuses, trusted stamped origins.
- `src/preload/index.ts` → `onDaemonEvent`: currently subscribes too late; retains receipt/content filtering.
- `src/preload/appUpdate.test.ts` → preload boundary test pattern.
- `src/renderer/src/store/threadRuntime.ts` → `useThreadRuntime`: independent layout subscription.
- `src/renderer/src/store/daemonEventBridge.ts` → `useDaemonEventBridge`: independent effect subscription.
- `e2e/fixtures/launchPairedApp.ts` → native thread scripting and saved profile ownership.
- `e2e/real-daemon-history-on-open.spec.ts` → saved checkpoint and independent protected paging.
- `docs/knowledge/features/live-window.md`, `daemon-connection-lifecycle.md` → retained main status contract.
- `chat-history-testing.md` → Protected paging coverage observation; `chat-history-api.md` → Owned authoritative mutations.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`, development verification overview → guarded counted acceptance.

Design: install a status-only IPC recorder during preload evaluation. Keep the last
`connecting`, `connected`, `failed` or `disconnected` per stamped origin in a Map
(string/null/absent remain distinct). Keep the original event, including capabilities
and absent properties. Each `onDaemonEvent` call registers its live handler, then
synchronously delivers retained statuses only to that listener through its existing
receipt wrapper. No awaits mean no stale connected snapshot can overwrite a later
failure/disconnect. No transcript, query reply or other daemon event is retained.
Main's load replay and idempotent start remain unchanged; no healthy redial.

State/concurrency: cache lifetime is one preload document, including gaps with zero
React consumers. The recorder owns one document-lifetime IPC listener; each consumer
removes its own handler on unsubscribe. Document destruction releases all state.
Snapshot delivery and live IPC execute serially on the renderer thread.

| Repeated event / identity | Regression |
| --- | --- |
| Host status precedes first/second subscription | preload status tests: independent replay without rebroadcast |
| Connected superseded by connecting/failed/disconnected | preload status tests: latest origin status and subsequent live ordering |
| Null, absent, prototype-shaped and multiple hosts | preload status tests: exact stamp/capabilities and distinct Map slots |
| Unsubscribe/remount, content owner opt-in | preload status tests: removed callback stays inert, no content replay |
| Full exit/reopen after accepted main status before React | startup spec: delayed and normal native saved-checkpoint catch-up |

Error handling: no new I/O or rejection path. Existing parsing and main delivery
remain authoritative. Retention never manufactures a connected event or logs payloads.
The controlled startup spec uses static stage names and counts for main acceptance,
renderer status receipt, request dispatch and received publication.

Tests first: preload boundary failures before correction, then production correction.
Adapt the retained HTTP React-mount scheduling diagnostic to native thread replies;
prove saved baseline durability, full exit, main accepted status before releasing
mount, one selection, exact saved-version catch-up, received newest publication and
enabled Send. Run normal bootstrap alongside the delayed control. Preserve the
original diagnostic red in `/tmp/builder-2153/resume/startup-boundary.*`; synthetic
scheduling demonstrates the mechanism, not the unknown historical Linux trigger.
All de6e481a/b505bf01/3e533963 failed/unchanged-pass evidence and the split-save and
bounded-reader repairs remain separate and unchanged.

Validation: finish Node checks (pre-verify, observer/query regressions, client-test
typecheck, docs guard and build), then Electron native preparation and actual startup
controls. Five consecutive complete-thread paired batches, each two named cases
twice, three actual workers, retries zero; then full guarded recorded suite. Retain
counts, build/profile, capture provenance and exchange/guard attachments. Dispatcher
owns configured application gate; no fresh provider or second-OS run is required.

Sizing: approximately 550–650 incremental written lines including this revision,
production/tests and counted evidence; one production file, no new exported types,
no API migrations, five observable criteria, no new rejection state machine. No
remote feature branch overlaps the planned production/scenario files. No independent
plumbing slice is useful without its regression. Open questions: none.

Pending documentation stage: reconcile the production subscriber-readiness contract
and counted execution-OS evidence in `docs/knowledge/features/live-window.md`,
`daemon-connection-lifecycle.md` and `chat-history-testing.md`. Distinguish document
load, accepted main status, renderer subscription, request dispatch and publication.
Preserve historical failures/passes, unknown Linux trigger, existing causal proofs,
capture provenance and reset-prompt exclusion; record dispatcher results separately
from builder results. Update this plan's pending handoff when that evidence arrives.

### 2026-10-20 — verifier rework: document isolation and processing barrier

Answer findings 1 and 2 from the review of `98cb0144`. These are directly
consumed regressions of the existing status-subscription behavior, with no
independently useful production change. Incremental forecast: under 150 written
lines including evidence; no production files, exports, API migrations or new
failure branches. The full branch remains below 800 written lines. Remote
feature-branch inspection found no overlap with the two test files.

Additional files read: `src/main/sessionStateMetadata.test.ts` → `connected`
and host-isolation integration: fixture currently removes the recorder while
retaining the imported preload's Map; `src/preload/daemonStatus.test.ts` →
fresh module-per-document pattern; `e2e/saved-profile-startup.spec.ts` →
observer mount: final request count lacks a processing barrier;
`e2e/visible-tail-read.spec.ts` → ordered context-usage sentinel pattern;
`threadRuntime.ts` → `handle`: connected status dispatches opening work
synchronously; development-verification's positive-processing-barrier contract.

Reset the preload module and mocked IPC listeners together before each metadata
case. Assert an empty initial subscription and one document recorder, then check
host-isolated retained connected baselines separately from subsequent live stall
delivery. Preserve accepted capabilities, provenance and unsubscribe assertions.
For native startup, send a uniquely addressed read-only context-usage sentinel
after mounting/unmounting the observer on the same ordered IPC/transport path.
Require its actual fake-daemon receipt before the unchanged one-query assertion.
No sleeps, timeout changes, synthetic completion or replay changes.

Validation: reproduce the exact unit failure first; run the complete metadata
file plus existing status, history-observer and query controls under Node. After
the final main merge, run pre-verify, build, client-test typecheck and docs guard,
then prepare Electron and run both startup cases. Preserve previous counted
acceptance separately; repeat the five paired batches and full guarded recorded
suite on macOS, with the existing reset-prompt exclusion. Dispatcher owns the
subsequent configured application gate. Documentation handoff above stays pending.

Security re-review per `builder/security-review.md`: **PASS**. Tests only:
main remains the sole status authority; no credentials, storage, crypto, network
policy or Electron surface changes. The sentinel uses existing validated IPC
with a static test identity and no mutation. Diagnostics remain content-free.
Fresh document ownership resets cache/listeners together; ordered daemon receipt
closes the asynchronous observation gap. Existing relay, hostile-daemon, disk and
renderer threat boundaries remain unchanged. No MUST FIX or SHOULD FIX security
findings. Reviewer: builder, 2026-10-20.

### 2026-10-20 — investigate the failed rework acceptance batch

The first new paired batch on `bf14bed8` failed saved-profile catch-up at 45
seconds (3 passed/1 failed; failed exchange 9 matched/20 emitted/23 remaining).
The two startup controls and all 249 focused Node tests pass. This failed report
remains `/tmp/builder-2153/rework/final-paired-1.json`; it is not repaired by an
unchanged rerun. Add local content-free scenario observations around the resumed
selection: latest received status/capabilities, query failure codes, received
reply count and existing main query-observer results, attached even on failure.
Keep the original failure separate from these diagnostic schedules and preserve
all assertions/bounds/envelopes. No production hypothesis is adopted yet. This
adds no authority or payload retention; the security verdict remains PASS.

### 2026-10-20 — macOS production-delivery validation

Final tested source: `33aa5fee23efd70365a829f908f6e736a8ada084`, including final
merged main `3fd12cc640d4`, macOS arm64, Node 25.8.0, Electron 33.4.11. This
following evidence commit changes only the plan. Pre-verify passed all five checks
after that merge (`/tmp/builder-2153/pre-verify-merged.log`); normal build,
client-test typecheck and docs guard passed. All nine focused Node files passed
**151/151**, zero failed/skipped (`units-merged-prepared.log`): preload status,
app-update, live-window, remembered-model and its boundary controls, all 28 history
coverage controls, query-observer installation, query coordinator and runtime.
An initial broader Node check started before the gate's Node-native preparation
finished and failed two protected-storage controls; the sequential prepared run
above passes. All Node work finished before final Electron preparation; no native
rebuild overlapped any replay. Every profile run restored the normal build.

Controlled startup proof: six preload regressions failed before the correction
(`status-red.log`, SHA-256 `164eee9bb139ca1588090209d08d72ff29c9f74ddfa684a75cb676ec40fcaa4e`).
The native startup comparison against byte-identical main production preload
passed normal bootstrap and failed delayed mount with zero status receipts
(`startup-causal-red.log`, SHA-256 `f835ecbbfabd0992218e44001a660dfbbdf9606cf6b317952d2ba9833b70c7a9`);
the prerequisite writer control also passed. A preceding script-development run
used an invalid continuation and failed baseline certification; `startup-red.log`
is retained but is not causal evidence. Corrected final native controls passed
**2/2**, zero failed/skipped (`startup-final.json`, SHA-256
`719294443f3615958a119a330cb3d1acd1ee4a59c467add3ec75cf3515715a3b`).
Delayed trace: saved profile exited → resumed handshake → main accepted connection
→ document loaded before React → renderer received status → resumed request
dispatched → received publication rendered. Assertions require one handshake,
one selection, exact owning catch-up at saved version 1, baseline plus newest
publication, enabled Send and no legacy requests. Original diagnostic
`resume/startup-boundary.json` remains separate, SHA-256
`a9489c619c482dbaed85b034025ee499062be2cd487342c71d8d5510e82a65a1`.
Neither controlled schedule establishes the historical Linux trigger.

Model-recall compatibility proof: the new baseline/reconnect unit failed before
the consumer correction (`model-recall-red.log`, 27 passed/1 failed), then passed
with all 28 remembered-model tests. Its unchanged recorded scenario passed 1/1,
43 matched requests / 150 emitted frames / zero remaining (`model-final.json`,
SHA-256 `7cee41967d97b1d983e8132347372cdf53a782e443c24346d70f9457a4bb7787`).

Final commands from the worktree root; artifacts below use `/tmp/builder-2153/`:
```sh
python3 "$AGENTS_REPO_PATH/bin/pre-verify-check" --test-file src/renderer/src/store/rememberedModel.test.ts
npm run build
npm run typecheck:client-tests
npm run check:docs
npm run rebuild:electron
PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/builder-2153/startup-final.json npx playwright test e2e/saved-profile-startup.spec.ts --project=parallel --no-deps --retries=0 --reporter=list,json --output=/tmp/builder-2153/startup-final-results
# Five consecutive batches, N=1..5:
PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/builder-2153/final-paired-N.json node scripts/run-offline-replay.mjs --profile complete-thread --grep 'a real daemon lazily fills a served gap|daemon-built thread streams' --fully-parallel --workers=3 --repeat-each=2 --retries=0 --reporter=list,json --output=/tmp/builder-2153/final-paired-N-results
PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/builder-2153/final-recorded-full.json node scripts/run-offline-replay.mjs --profile complete-thread --retries=0 --reporter=list,json --output=/tmp/builder-2153/final-recorded-full-results
```

| Report | Executed/passed/failed/skipped | Configured/peak actual workers | SHA-256 |
| --- | --- | --- | --- |
| `final-paired-1.json` | 4/4/0/0 | 3/3 | `7c9572a40cd6ebfdd4f405bffff8a5fc4608d9883183428af0becfa263a6ad6a` |
| `final-paired-2.json` | 4/4/0/0 | 3/3 | `1d683f937e6614b1160d0ec6d5067248bc9e3fa5f7b60c784a0fc0b94eca8c3a` |
| `final-paired-3.json` | 4/4/0/0 | 3/3 | `cf6499b97e81c37b8c8af486c8d82fc4ea7ec6fb5095dbcf954f03bf5212c2fa` |
| `final-paired-4.json` | 4/4/0/0 | 3/3 | `223107c25cca0ed82d1112c8979c9c04e1afd8e391213a3e44852eb410ba12ff` |
| `final-paired-5.json` | 4/4/0/0 | 3/3 | `2d3289769edc63dce16701efade0071cb3df286e2e547e1988c6d2cec72d3240` |
| `final-recorded-full.json` | 29/29/0/1 | 1/1 | `b8b1990ca3daa08e9e7d5dd9e570607e5288035b1612be556d22e5d8373ba6aa` |

Each named history/thread case passed twice per final batch (**20 passes**), then
once in full replay. All retries zero, no flaky results/report errors; actual peak
overlap is three in every batch. Every guard reports zero forbidden launches.
Every successful history exchange is **32/63/0**, thread **45/378/0** (matched /
emitted / remaining). All 29 full exchanges total **773/3216/0**. The sole skip
is `real claude picks up a saved channel system prompt at Reset session`.
`summarize-status.py` asserts multiplicity, retry zero, actual overlap, guard
outcomes, identical clean build maps, input checksums and every exchange remainder.
Its retained output is `validation-status-summary.log`; full counted evidence is
`counted-status-evidence.json`, SHA-256
`e9402ae70a20597fa73e06191250dc7e8da75bb513fe8021b4ec3149f64bc152`.
All six builds report `sourceDirty: false`, profile `complete-thread`, revision
`33aa5fee`. Main bundle SHA-256 `0392503cdc7b6934daebc336f9ec6d5aa3cac5f4f6a24678b29c5e165efdf12c`;
preload `53308858d05c0214442e57352e65e79b7fef59670546a02eec4b4d1e08317080`;
renderer `142d47acd92837310fbeb0f552d7704a9928dc2b7b475f4b2ffe8c75562b061b`.
Full bundle maps and original capture provenance remain in each log/attachment.
History/thread recording hashes remain `de0b1166b6e05e0792228c07be25c20498b117914e673558222eac12cd4e6d2c`
and `53a3db11cfab2d5041b511d7be4d030ab5b2b8449b7fdb3ea1d7e5e3db552ae3`;
capture Desktop `00ec821f9380b00cf2dfc0dd4817ee15584106a5`, daemon
`58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`, binary SHA-256
`5f5b3b9ce42eda74024637f4929dd720d36c1226ce6e370eb62fbe9e6b22f7c0`.

Earlier current-run failures remain failed evidence, all on `1dd48a53`:
- `paired-1/2.json` each passed 4/4; `paired-3.json` failed a relaunch native
  prerequisite (3 passed/1 failed, 10/21/22 exchange), tracked in #2190. Report
  SHA-256 `41b903683f4b93c565de362f65936c797284486ab38bf21f243fe603a3f7f338`.
- After native re-preparation, `accepted-paired-1.json` passed 4/4;
  `accepted-paired-2.json` failed fresh-profile ArrowUp protected `unreadable`
  (3 passed/1 failed, 27/53/5), tracked in #2191, SHA-256
  `85603ed8c9e1391c5e561f4005728c2df465187f3a8ba95e683e2baf87c43c12`.
  Byte-identical main production comparison passed 4/4 (`main-baseline.json`,
  SHA-256 `3aa541480bcdd9859cf532a3632e45498483b4e5908ad614b0c92cd22885a15a`).
  Its checkout provenance is intentionally dirty `1dd48a53`, with production
  preload restored to main. This passing comparison establishes no trigger or
  inheritance. Both investigations remain open; final acceptance does not claim
  to repair their unknown causes or erase those failed reports.
- `recorded-full.json` recorded 28 passed/1 failed/1 existing skip; its model
  recall failure is this repair's regression, corrected and causally tested above.

Historical `de6e481a` and `b505bf01` failure/unchanged-pass pairs and both prior
causal repairs remain above. The distinct `3e533963` Linux failure remains as
refiner-inspected evidence: 528 executed/527 passed/1 failed/4 skipped, history
saved-only at 45 seconds with 9/20/23; selected unchanged rerun 4/4, history32/63/0.
Full-report SHA-256 `f1d1f633f3de3774383e74aaf515616c19ee0c3bee28bb3968aff5dd4eb95982`,
rerun `c45c5219a54fce7024e78f3ab9a4ac2d263254118da19074a84a8b12b84b5e10`;
retained bundle `resume/evidence-2184/9d46d83e031db1ea8b9d7ea972fbc5a1c6a0c08c5a151f8dd6ccb28b2812c905/`.
No new inspection or reproduction of that Linux trigger is claimed here.

Dispatcher owns the subsequent configured application gate, including both named
cases without retry; verifier checks its counted evidence separately. No fresh
provider/daemon, encryption or physical-effect run was required or claimed.
Linux is outside this macOS execution's verification scope.

## Documentation handoff

Pending documentation stage: reconcile the production subscriber-readiness
contract and counted execution-OS evidence in `docs/knowledge/features/live-window.md`,
`docs/knowledge/features/daemon-connection-lifecycle.md` and
`docs/knowledge/features/chat-history-testing.md`. Distinguish document load,
accepted main status, renderer subscription, request dispatch and publication.
Preserve historical failures/passes, unknown Linux trigger, existing causal proofs,
capture provenance and reset-prompt exclusion; record dispatcher results separately
from builder results. Update this plan's pending handoff when that evidence arrives.

## Security review

**Verdict:** PASS

- Trust boundaries: main's parsed/stamped IPC is the sole status producer. The new
  preload cache keys only on `serverId`, never daemon `ack.server_id`; renderer
  callers supply only a callback and cannot assert status or manufacture origins.
- Tokens/secrets: retain only the same four status events already delivered to the
  renderer; no pairing token, key, raw bytes or transcript enters the cache.
- File/storage: no new disk access, paths or persistence; safeStorage is unchanged.
- Electron surface: no new IPC/API/request. Existing context isolation, sandbox,
  navigation guards and main-frame authorization remain unchanged.
- Cryptography: no crypto, randomness, keys or Noise lifecycle changes.
- Network/I/O: no new connections, retries or deadlines. Existing parsed daemon
  status and idempotent connection startup remain authoritative.
- Errors/logging: no production logging added; control evidence contains static
  stage names/counts only, with no daemon text, tokens or exception payloads.
- Concurrency: synchronous private replay avoids await races and rebroadcast;
  per-consumer cleanup removes callbacks, document teardown owns the recorder.
- Threat alignment: relay/daemon cannot mint cache slots through ack contents;
  Map handles prototype-shaped trusted origins safely. Compromised renderer gains
  no new authority or access to main-only credentials/network resources.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-20

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

### Reopened current-source validation results — 2026-10-20

Current-source acceptance passed without another code change. Linux x64, Node
25.8.0, Electron 33.4.11; clean tested revision
`c733774b645ee8673bc84c73ec3be102d2de5075`, containing final merged main
`2d8a7e323ffe74f7ba4e232483a267d8b5a0d0a1` and both existing repairs.
The evidence commit after execution changes only this plan. `src/` and `e2e/`
remain byte-identical to admitted main. No current-reader or application failure
reproduced, so no speculative correction, duplicate regression or new causal
claim is justified.

All five pre-verify checks passed. The entire existing observer regression file
executed/passed **28/28**, zero failed/skipped, explicitly including
`waits across split saves at baseline and after dispatch` and
`bounded protected reads leave time for received paging progress`, plus all
failure, ownership, disconnected-range and successful-value controls. Raw report:
`/tmp/builder-2153/reopened/units/unit-q3svyjl8/0.json`, SHA-256
`130d6f6f137c581ebdd54079cfe62d9680572a4291a1c1a5d4445c1bb5c74475`.
The original split-save failing-before proof/hash remains in Validation evidence
above; the original bounded-reader failing-before proof/hash remains in
`docs/specs/architecture/2158-bounded-protected-coverage.md` → Validation evidence.
These establish their controlled mechanisms, not either historical trigger.

Client-test typecheck, docs guard and normal build passed. Initial sandboxed
installation failed on esbuild binary validation (`EPERM`); approved installation
then passed. This environment failure is not a scenario regression. All Node
checks completed before successful Electron SQLite preparation. Native preparation
and replay never overlapped. Every replay command restored the normal build.

Commands from the worktree root (all artifacts below use prefix
`/tmp/builder-2153/reopened/`; logs use the corresponding report stem):
```sh
npm install --no-audit --no-fund
PYRY_GATE_EVIDENCE_DIR=/tmp/builder-2153/reopened/units python3 /work/Projects/pyrycode-desktop-agents/bin/pre-verify-check --test-file e2e/fixtures/historyCoverage.test.ts
npm run typecheck:client-tests
npm run check:docs
npm run build
npm run rebuild:electron
# Five consecutive batches, N = 1..5:
PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/builder-2153/reopened/paired-N.json node scripts/run-offline-replay.mjs --profile complete-thread --grep 'a real daemon lazily fills a served gap|daemon-built thread streams' --fully-parallel --workers=3 --repeat-each=2 --retries=0 --reporter=list,json --output=/tmp/builder-2153/reopened/paired-N-results
# Followed by the complete committed-recording suite:
PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/builder-2153/reopened/recorded-full.json node scripts/run-offline-replay.mjs --profile complete-thread --retries=0 --reporter=list,json --output=/tmp/builder-2153/reopened/recorded-full-results
```

| Fresh report | Executed / passed / failed / skipped | Configured / peak actual workers | Report SHA-256 |
| --- | --- | --- | --- |
| `paired-1.json` | 4 / 4 / 0 / 0 | 3 / 3 | `cc6c851d40724d80a027d170bfa2b594a7c00fd5e3e6ba9769438a4c47842351` |
| `paired-2.json` | 4 / 4 / 0 / 0 | 3 / 3 | `3d4bdc8945f010d1e0c8569cf8835f1de91bf4af70594d694747358747b19dde` |
| `paired-3.json` | 4 / 4 / 0 / 0 | 3 / 3 | `e3d31e17856597feed0e384561a13328b6cd22de484aef146f5f3d3762351edd` |
| `paired-4.json` | 4 / 4 / 0 / 0 | 3 / 3 | `8b29cd11c18ed48318fa7ea4a06c51c7fd1a51a4763cf3ba0602163d3ff6cb58` |
| `paired-5.json` | 4 / 4 / 0 / 0 | 3 / 3 | `354fb83ae834f57c23a66dc57d61511d72df19dea2e12474ed7c7f465af39239` |
| `recorded-full.json` | 29 / 29 / 0 / 1 | 1 / 1 (unchanged default) | `e96653cc20b655c0832324abe3f879eb19372c868ed58758b667221bbc08e422` |

Both named cases passed twice in each batch (**20 total executed/passed**), then
once each in full replay. Every result has retry zero; no flaky results or report
errors. All batches occupied slots 0/1/2 with three overlapping tests. Batches
1/2/4/5 recycled a completed worker (indices 0/1/2/3); batch 3 used 0/1/2.
The sole skipped full-suite case remains
`real claude picks up a saved channel system prompt at Reset session`, never
counted as passed. No timeout, sleep, retry, skip or concurrency policy changed.

All six guards report `forbiddenLaunchAttempts: 0`. Every history exchange
completed **32 matched requests / 63 emitted frames / 0 remaining**; every thread
exchange completed **45 / 378 / 0**. All 29 full-suite exchanges completed:
**773 matched / 3,216 emitted / 0 remaining**. Every run reports clean source and
profile `complete-thread`, with identical seven-output bundle maps. Main bundle
SHA-256 `0392503cdc7b6934daebc336f9ec6d5aa3cac5f4f6a24678b29c5e165efdf12c`;
renderer bundle SHA-256
`2c054d586268ed0b30f0c5836c1b848085b370391ee9c8325dee6ece299d77e5`.
Full identities, guard outcomes, per-exchange counts and capture provenance are
retained in `counted-evidence.json`, SHA-256
`2decf5ee8a0d12bdf1464e93155636f55a0639e6adec56b0aac1987f398a2f03`.
The read-only `summarize.py` asserts multiplicity, zero retries, actual worker
overlap, shared clean build identity, input checksums, guards and every remaining
request count; `validation-summary.log` retains its counted output.

History/thread recording hashes remain respectively
`de0b1166b6e05e0792228c07be25c20498b117914e673558222eac12cd4e6d2c` /
`53a3db11cfab2d5041b511d7be4d030ab5b2b8449b7fdb3ea1d7e5e3db552ae3`.
Both retain capture Desktop `00ec821f9380b00cf2dfc0dd4817ee15584106a5`, daemon
`58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`, binary SHA-256
`5f5b3b9ce42eda74024637f4929dd720d36c1226ce6e370eb62fbe9e6b22f7c0`.
No recording, envelope matching, causal checkpoint, inspection, profile retirement,
paging assertion or production contract changed.

Historical evidence is preserved separately: downloaded #2125 verifier bundle
`55afa7335001014f2b8b89a282a4635347e5598af427d63db8813d424be43973`
under `evidence-2125/` passes all 24 bundled file checksums and retains the full
failed-report pointer plus the selected rerun report (3 executed/passed).
Downloaded #2158 builder/verifier bundles under `evidence-2158/` also pass all
bundled checksums and retain the original controlled red/green record. These
supplement the original plan references; current passing results do not identify
or erase the `de6e481a` or `b505bf0118` historical failures.

### Reopened dispatcher gate reconciliation

The [accepted verifier review](https://github.com/pyrycode/pyrycode-desktop/pull/2177)
(stage `711a01e64d19d1c402d48ee2fdce2f3f5378eed7848259b8975179b749e34d3b`)
completed the dispatcher handoff on reviewed Linux head
`9b02c253d59b06a608543734e12aa477ae943d47`, including later main changes.
This candidate is distinct from clean builder replay build `c733774b` and the
earlier accepted candidate above. The supplied dispatcher gate report records
unit gate 4 (`unit-test-gate.py`): **9,908 executed/passed, 0 failed, 3 skipped**.
Both `waits across split saves at baseline and after dispatch` and
`bounded protected reads leave time for received paging progress` are explicitly
present and passed. These totals use the supplied gate report rather than the
verdict's differing 9,990 total; the verifier also confirmed all 28 observer tests
passed on the reviewed candidate.

Application gate 7 (`npx playwright test --reporter=json`) recorded
**528 executed/passed, 0 failed, 4 skipped**. Both named history/thread cases
executed/passed once, retries zero, with completed 32/63/0 and 45/378/0 exchanges
(matched requests/emitted frames/remaining requests) and unchanged provenance.
The reset-prompt case remains skipped. Independent verifier summary:
`/tmp/verifier-2177/evidence-summary.json`. The verifier checked all 69 checksums
in retained #2125/#2158 bundles and all 20 files in the earlier accepted verifier
bundle. Neither historical failure is reclassified; neither trigger is established.

These configured gate results complete the pending handoff separately from builder
acceptance. No unit, application or live tests were rerun by documentation.
No fresh provider/daemon or physical-effect result is claimed; macOS is outside
this Linux verification.

## Documentation handoff

Satisfied in [Counted Linux coverage-observer validation](../../knowledge/features/chat-history-testing.md#counted-linux-coverage-observer-validation):
fresh current-source results and the completed dispatcher gate are reconciled
with distinct build identities and counted named passes. Both historical
failure/pass pairs, unknown triggers, controlled failing-before mechanisms,
capture provenance and the reset-prompt exclusion remain preserved. Dispatch,
publication and protected durability retain their separate proof requirements.

## Revisions

### 2026-10-20 — preserve model recall across the subscription baseline

The complete recorded suite on `1dd48a53` exposed one regression from private
synchronous status replay: `createRememberedModel.start` subscribes per creation
attempt and treated the current connected baseline as a subsequent reconnect,
cancelling recall before model/settings receipt. Extend the plan locally to
`src/renderer/src/store/rememberedModel.ts` → `createRememberedModel` and its
adjacent regression file. During the subscription call, connected is the baseline;
after subscription returns, connected still cancels and cleans up the attempt.
No callback signature or other consumer changes. The new regression fails before
this correction, then proves normal recall submission and later reconnect cleanup.
This is the delivery repair's directly consumed regression, not an independent
feature. Security re-review: no new boundary, authority, retention or secret; the
synchronous subscription contract distinguishes initial state from later lifecycle
edges. Verdict remains PASS. Total incremental scope remains below 650 written
lines, two production files, no new exports or API migration.

Current repair documentation remains **pending** for the documentation stage:
reconcile the production subscriber-readiness contract and counted execution-OS
evidence in `docs/knowledge/features/live-window.md`,
`docs/knowledge/features/daemon-connection-lifecycle.md` and
`docs/knowledge/features/chat-history-testing.md`. Distinguish document load,
accepted main status, renderer subscription, request dispatch and publication.
Preserve historical failures/passes, unknown Linux trigger, existing causal proofs,
capture provenance and reset-prompt exclusion; record dispatcher results separately
from builder results. Update this plan's pending handoff when that evidence arrives.
