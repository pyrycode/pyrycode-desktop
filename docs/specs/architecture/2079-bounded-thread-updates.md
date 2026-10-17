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
