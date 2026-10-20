# Bounded thread updates

## Files read
- `src/renderer/src/store/threadItemStore.ts` → `applyFull`, `success`, `publish`, `beginBatch`: admission, immutable snapshots and owned history evidence.
- `src/renderer/src/store/threadRuntime.ts` → `event`, `flush`, `offItems`: current synchronous rebuilds and lifecycle ownership.
- `src/renderer/src/store/threadQueryCoordinator.ts` → `input`, `receive`: correlation, repair and completion certification.
- `src/renderer/src/store/chatHistoryWriter.ts` → `captureChange`, `merge`: owned item arrays and prior progress must survive publication coalescing.
- `src/renderer/src/screens/conversation/threadComposerReports.ts` → `threadComposerReports`: whole-conversation derivation follows item publication.
- `e2e/timeline-frame-deltas.spec.ts` → production React commit observation; `threadRuntime.test.ts` → synchronous factory and frame fixtures.
- `docs/knowledge/INDEX.md`, `CLAUDE.md`, `docs/knowledge/features/thread-runtime.md`, `docs/knowledge/features/development-verification.md`: exact host/session ownership, immutable history evidence and positive mounted barriers.

## Context
Live complete-item bursts repeatedly copy, order and derive the entire conversation. Preserve the existing visual and wire contracts while making this finite work responsive. No visual-design change or provider acceptance is involved. No overlapping feature branch touches the three production files. The nearest analogue is #1887; this change additionally folds map/order work and all owned deltas.

## Design
Add a synchronous item-store transaction, retaining scalar APIs. Within it, admission reads staged slices, each changed item map is copied once, and publication retains all owned changed items and progress evidence. At exit, order and freeze one snapshot per affected conversation and publish once. Existing exact-base, companion and repair logic remains authoritative. Query coordinator batching defers completion notifications until the coherent store publication; receiving or scheduling content never certifies history completion. Runtime subscriptions derive only changed slices.

Replace append-only flushing with a bounded ordered event queue for live additions, changes and appends. A drain applies at most 128 events, folding consecutive content through the coordinator transaction. Controls remain behind preceding content and do not trigger synchronous full-backlog draining. Race an animation frame against a timer fallback; cancel the losing callback and fence late callbacks with a scheduling token. Synchronous factory defaults remain unchanged.

## State + concurrency model
Queue entries retain received host/conversation attribution. Only one drain is scheduled; queued content is never applied recursively from receipt. Navigation/cancellation removes queued work for the departed selection; successful host removal and teardown retire its events and callbacks. Suspend discards pending work rather than synchronously draining it. Reconnection catches up through the existing certified checkpoint. Store generation and epoch admission continue fencing resets and replacement owners.

## State transitions and identity reuse
| Event | Coverage |
| --- | --- |
| Repeated additions/change/append and companion, duplicates/stale, repair then recovery | item-store transaction equivalence and immutable snapshot regression |
| Paused frame, multiple drains, ordered disconnect/control boundary | runtime bounded drain regression with fake timers |
| Navigation/cancel and same-ID cross-host reopen | runtime lifecycle regression |
| Epoch/reset, deletion/unpair and late scheduled callback | runtime lifecycle regression and existing coordinator generation tests |
| Teardown while processing | runtime callback regression and mounted fixture normal teardown |

## Error handling
Existing typed repair/query failures remain unchanged. Transactions retain repair and completion evidence in order for the history writer. Scheduling introduces no new I/O or error result.

## Testing strategy
- Test first: transaction publication/work counts and scalar equivalence across additions, placement changes, companions, stale inputs and recovery; retain old snapshots and verify owned mutation completeness through the existing writer path.
- Runtime fake timers: finite drain limits, timer progress with paused frames, controls ordered after content, changed-slice derivations, cancelled work and late callbacks.
- Mounted native-thread Electron: empty completed baseline, one generated 8333-item varied burst, independent delivery/applied/commit observations, real composer input during advancing unfinished processing, heartbeat gaps, authoritative send/reply/idle, completion under 60 seconds and one-second quiescence. Preserve normal teardown.
- Linux: focused units and mounted spec, affected recorded client replay, final main merge, pre-verify check and build. No second-OS or live-provider claim.

## Open Questions
None. Keep the existing APIs and scope; no dependency or new component is needed. Written-work budget: about 250 production, 300 unit, 180 mounted and 60 plan lines (790 total); one deliverable, at most two new API members, no migrated scalar consumers, five observable acceptance groups, no new reject branches.

## Revisions
2026-10-17: the mounted varied burst completed but consecutive frame scheduling starved the heartbeat for 44 seconds. The initial frame still races the 50 ms fallback; every continuation now schedules through a timer task, never another immediate frame opportunity. The bounded-drain regression advances one timer turn at a time. The mounted observer uses an iterative Fiber walk and main's content-free stdout counters, avoiding observer stack overflow and awaited-inspector loss. Agent/task links and same-session parents in the generated workload follow the existing presentation contract.

2026-10-17: profiling the remaining heartbeat failure found `usePushNotify` rebuilding `threadItemPresentations` directly on each of the 556 received turn endings. Add `src/renderer/src/store/pushNotifyBridge.ts` → `usePushNotify` to Files read. Runtime now exposes an ordered subscription after coherent publication, with disposal cleanup; notification preview rows are cached by immutable snapshot. This necessary batch consumer adds a fourth production file without changing the one deliverable or exceeding 800 written lines. The mounted gate and ordered runtime subscriber assertion cover it; no notification contract or visual layout changes.

2026-10-17: the same profile also showed contextBridge invoking every chrome subscription for every complete content update, although those subscriptions ignore content. Add `src/preload/index.ts` → `onDaemonEvent` to Files read. It now filters `threadUpdate` before crossing into each passive subscriber; the runtime and the mounted frame observer explicitly opt in through the optional second argument. All other event families retain their existing path. This fifth production file is necessary to bound received-update overhead; total written work remains below 800 lines. No daemon, wire or transport format changes.

Content opt-in also requires 13 existing observation call sites (runtime plus browser/shared replay observers) to update together, exceeding the 10-consumer ceiling. These observers must retain every original assertion and request check. A separate API-only sibling would have this repair as its sole consumer, so the sizing floor keeps the work together; the overage is explicit, with total written work still below 800 lines.

The full unit gate found two additional main/preload integration observation sites in `src/main/threadUpdates.test.ts`; both now explicitly request content. The final raw migration count is 15, including those tests. All four original assertions remain required and run in the focused integration check.

## Validation and hold
Linux: the 8333-item mounted regression remains unaccepted and is explicitly skipped pending [#2086](https://github.com/pyrycode/pyrycode-desktop/issues/2086), linked as a blocker. Content-free storage operation/result timestamps measured a 14314 ms synchronous main-process mutation; a mounted input probe measured 17187 ms. Earlier completed runs established exact final state, send settlement, one reply, idle, quiescence and normal teardown, but failed heartbeat limits. Failed contexts and a renderer CPU profile remain under `/tmp/builder-2079/`; no failed run is claimed as a pass. Resume this test after bounded storage writes land. The renderer plan and implementation are preserved while waiting.

Final main: `58d92a423dce`. Build and client-test typecheck pass. Full pre-verify executed 9287 unit tests: 9283 passed, four failed, three skipped. Those four were the two missed preload integration subscriptions above; after correction, all 15 tests in `src/main/threadUpdates.test.ts` pass. The full suite has not been rerun after that test-only correction; its log is `/tmp/builder-2079/pre-verify.log`. A targeted pre-verify rerun is recorded separately. Mounted paused-frame regression passed; the 8333-item acceptance remains blocked, not passed.

Targeted pre-verify passed all five checks using `--test-cmd 'npm test -- src/main/threadUpdates.test.ts'`; this does not represent a second full-suite pass. Guarded recorded client `daemon-built thread streams, places an agent, reconnects, resets and reopens saved items` passed on `ca9647bd`: one executed/passed, zero failed/skipped, zero forbidden launches; `/tmp/builder-2079/recorded-thread.log`. Remaining affected replay scenarios and the final full-suite rerun remain builder work after the #2086 hold. No fresh provider behavior or second-OS acceptance is claimed.

## Revisions
2026-10-20: integrated main `845cf9a2`, including #2087/#2088 bounded protected execution and writer submissions. Retained both cache regression groups and compact/body lifecycle reconciliation, retirement and disposal; bounded queue retirement replaces synchronous flushing on suspend. Re-enabled the original mounted complete-view acceptance without weakening its workload, processing barriers, latency limits or teardown. Earlier failed measurements remain failed evidence above. One behaviour remains: responsiveness of finite complete-item bursts; no additional production repair is planned. Remote #2089 overlaps host removal additively and supplies no dependency.

2026-10-20: the first integrated guarded replay exposed two newly merged content consumers, `createQuestionAnswerEvidence` and `createThreadReplyEvidence`, whose omitted opt-in prevented their original turn/reply witnesses. Both now subscribe with content enabled; no assertions, recording bytes or request checks change. The raw migration count is 17; the same one-consumer sizing floor applies. Failed replay evidence (27 passed, 2 failed, 1 skipped, zero forbidden launches) remains at `/tmp/builder-2079/replay.json` and `replay-results/`.

2026-10-20: the unchanged `read setup is reused across committed same-row deltas on short and long threads` passed on main `845cf9a2` but found four observer rebuilds here: received list progress can precede a queued snapshot. `useReadObservation` in `conversationReadPublisher.ts` now retains the matching owner/tail observer during that gap; its callback still rechecks current eligibility before every publication. Reader, identity and disconnected-tail retirement remain unchanged. Existing visible-tail exclusion and work-count cases cover this integration repair.

## Recovery validation
Linux: pre-verify passed all five checks after merging main; full units at `a312f6e5` executed/passed 9918, failed 0, skipped 3 existing live opt-ins. Cache integration passed 35/35, core lifecycle/equivalence/body checks 272/272 and preload/notification checks 60/60. Logs are under `/tmp/builder-2079/checks/`.
Normal production mounted run at `a312f6e5`: 22/22 passed, zero skipped/retries. Applied progress advanced 1509 → 2149 around input while unfinished; composer submission committed at count 2405. All 8335 items (8333 workload plus authoritative echo/reply) applied in 12306 ms, keyboard commit took 26.7 ms, heartbeat maximum gap was 522 ms, and 79 mounted commits occurred. Exact final state, same-batch send settlement, one reply, idle quiescence and normal teardown passed; total burst test including teardown was 64257 ms. Evidence: `/tmp/builder-2079/mounted.json` and `burst-evidence.json`.
Guarded complete-thread replay at `de6e481a`: 28 passed, 1 intermittent protected-coverage failure, 1 existing reset-prompt fixme skipped; all original assertions retained. The unchanged isolated history rerun passed 1/1 with zero retries. Every guard reported zero forbidden launches. Failure and passing rerun are preserved in `replay-fixed.json` and `replay-history.json`; follow-up #2153 is in Backlog at priority:low. This is not a green full replay or fresh provider evidence.
Final observer collectors passed 70/70 units and client-test typecheck. At `1736d627`, build and 5/5 publisher units passed; all seven original visible-tail work-count/exclusion cases passed with zero retries, after the controlled main-pass/branch-fail comparison. Other changed observer specs passed 7/7. Evidence: `/tmp/builder-2079/read-fixed.json`, `main-read.json`, `observers-mounted.json`, and matching logs. No original assertion was skipped. Dispatcher retains the complete acceptance gate.

2026-10-20 continuation at `5f3aec7f`: final pre-verify 5/5, build and client-test typecheck passed. Full units with `--maxWorkers=2 --minWorkers=1` passed 9918, failed 0, skipped 3 existing live opt-ins; the preceding default-worker run had one unchanged storage rollback test time out at 5000 ms, tracked in Backlog #2155. Its unchanged isolated rerun passed 1/1; no timeout or assertion changed. Evidence: `/tmp/builder-2079/continuation-{pre-verify,build,client-typecheck,units,storage-retry,units-two-workers}.log`.
Final production mounted rerun passed 2/2 with zero retries/skips: applied count advanced 130 → 1538 while unfinished across keyboard input, submission committed at count 1666, and all 8335 items applied in 12969 ms. Keyboard commit took 56.1 ms; maximum heartbeat gap was 633.1 ms. Exact state, send settlement, one reply, idle quiescence and unchanged normal teardown passed. Evidence: `/tmp/builder-2079/continuation-mounted.json` and `continuation-burst-evidence.json`.
Final guarded `complete-thread` replay passed 29/29 executed, failed 0, skipped 1 existing upstream reset-prompt fixme, retried 0, forbidden launches 0, including the unchanged history case from #2153. Earlier failed runs remain failed and both follow-ups remain open. Evidence: `/tmp/builder-2079/continuation-replay.json`, `continuation-replay.log` and `continuation-replay-results/`; normal production output was restored successfully. Final checks cover Linux and recorded behaviour, with no new provider or second-OS claim.

## Revisions
2026-10-20 verifier rework: received correlated terminal query bookkeeping now survives retirement separately from queued application. `observeTerminal` records only the current request's complete-view terminal; navigation/cancellation can release that cancelled slot immediately while discarding all departed content, including a slot cancelled on earlier navigation. Receipt never publishes items or certifies completion. Four paused-frame runtime regressions cover reply/failure across navigation and same-ID cancel/reopen, including late callbacks and no departed items/completion; coordinator regressions reject unrelated/incomplete/projection receipt and cover repeated navigation. #2089 overlaps host removal additively; no dependency or shared-block redesign.

The indexed shutdown fixture advances one bounded application opportunity after positive tail receipt, keeping the writer's 200 ms timer pending. Preserve pre-close baseline, close drain, offline restoration and all original timeouts. These repair the existing burst/lifecycle invariant and its regression coverage; no independent behaviour is added. Rework adds about 75 lines, keeping total written work below 800, with one API member, one consumer and no new rejection state.

## Documentation handoff
Pending documentation stage: `docs/knowledge/features/thread-runtime.md` — bounded complete-item application and lifecycle retirement; preload content opt-in, notification snapshot caching and read-observer reuse. Retain final Linux evidence and earlier failed measurements with #2153/#2155; recorded replay establishes no fresh provider behaviour.
