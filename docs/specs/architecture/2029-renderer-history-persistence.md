# Renderer authoritative history persistence

## Files read
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/chat-history.md` and `docs/knowledge/features/development-verification.md`: process boundaries, authoritative cache contract and validation.
- `src/renderer/src/store/chatHistoryWriter.ts` → `createChatHistoryWriter`, `useChatHistoryWriter`: buffered subscriptions, list receipts, serial drain and removal generations.
- `src/renderer/src/store/savedTimelineRestorer.ts` → `readSavedTimeline`: cancellable reads and coordinate admission.
- `src/renderer/src/store/threadItemStore.ts` → `beginLocalRead`, `snapshot`: restored identity and complete/interrupted checkpoints.
- `src/renderer/src/store/chatHistoryWriter.test.ts`, `daemonItemCache.test.ts` and `savedListRestorer.test.ts`: writer lifecycle and received-list regression harnesses.
- `src/renderer/src/store/savedTimelineRestorer.test.ts`, `newestHistoryDemand.test.ts` and `timelineFrames.test.ts`: distinguish exclusive persistence tests from retained store/bridge producer tests.
- `e2e/chat-history-removal.test.ts`, `e2e/daemon-item-cache.test.ts`, `e2e/chat-history-recording.spec.ts`: protected restart/removal harnesses and the nine retired cases.
- Issue #2020 cleanup inventory and #2029 refinement evidence: exact retirement and consumer boundaries.

## Context
The renderer production route already uses authoritative daemon items. Retired timeline persistence still subscribes to reconstructed content and retains a legacy reader branch. Remove that branch without changing main, preload, shared admission, storage formats or the retained timeline producers. No new ADR is needed.

## Design
Require the existing `threads` dependency in both writer and reader. The writer observes only received lists with a matching `conversationsReceived` host receipt and immutable authoritative item snapshots, writing `replaceList` or `replaceThread`. Remove all timeline dependencies, observations, receipt/row-key/echo reconstruction and timeline-flush integration. Narrow internal queued snapshots to the two admitted kinds; parser admission remains shared and unchanged.

Keep the serial pending map, duplicate comparisons, host pauses/generations, deletion suppression and removal settlement. Key conversation removal by its authoritative scope so buffered item saves are replaced in order. Keep `useChatHistoryWriter` and `readSavedTimeline` names and runtime entry points; restoration always requests `readThread` and accepts only matching daemon-item coordinates.

Retire the nine skipped recording cases and exclusive legacy writer/injected-reader/frame-persistence fixtures. Preserve the active local-list error case, the shared fake publisher and direct timeline producer tests. Adapt generic writer/removal tests to authoritative snapshots; retain protected restart and checkpoint tests.

In-flight overlap: #1975 edits backend setup in `e2e/chat-history-removal.test.ts` and `e2e/daemon-item-cache.test.ts`; no dependency on its additions. Keep adaptations local for the later merge.

## State + concurrency model
No new state or async work. List and item subscriptions capture detached snapshots before the scheduled drain. A single awaited drain serializes writes/removal. Successful unpair advances the host generation, discards pending/comparison state and removes host items; failed unpair resumes buffered work. Stop unsubscribes, awaits removal settlements and drains pending writes. Local read handles retain their store-owned cancellation and live-admission fences.

## State transitions and identity reuse
| Event | Test coverage |
| --- | --- |
| Repeated snapshots/list receipts, invalid or absent host receipt | `chatHistoryWriter.test.ts`: duplicate/list receipt admission tests |
| Restored snapshot followed by live state | `daemonItemCache.test.ts`: retains exact unfinished and repair fences after offline hydration |
| New snapshot during held save, epoch replacement, equal IDs across hosts | `daemonItemCache.test.ts`: flushes the newest snapshot through a held write and epoch replacement |
| Confirmed deletion during buffered/in-flight saves, late receipts, repeated removal | `chat-history-removal.test.ts`: orders deletion after saves and through shutdown; removes omitted cached items only on confirmation |
| Successful/failed unpair, omitted held items, same-session re-pair | `daemonItemCache.test.ts`: unpair invalidates old work and preserves another host; `chat-history-removal.test.ts`: forgets omitted held items before same-session re-pair |
| Removal settlement during shutdown; old save completion after successful removal | `chatHistoryWriter.test.ts`: pending removal shutdown and in-flight comparison generation tests |
| Read cancellation/repeated read, live admission, epoch/scope clear and reuse | `daemonItemCache.test.ts`: ignores delayed read outcomes; invalidates local reads across cancellation and reused scope identities |
| Complete/interrupted batch, offline restart and later live update | `e2e/daemon-item-cache.test.ts`: protected writer-to-offline-store restart retains completion |

## Error handling
Keep parser rejection and typed IPC result classifications with content-free diagnostics. Reader wrong kind/host/conversation, IPC failure and rejection fail the current handle without importing data. No new error branches.

## Testing strategy
First add a regression proving legacy mutations cannot create persistence writes with the authoritative writer mounted, then run it red before deleting the branch. Add read-only-thread request/admission assertions to the authoritative cache harness. Preserve/adapt generic list, failed-write, shutdown and removal tests. Run every touched unit module, pre-verify and build after the final main merge. Run the complete configured fake-transport Playwright suite; use the managed native route if native execution is missing locally. No live specs change.

## Open Questions
None. The existing two-kind writer is the simplest shape; no abstraction or backend redesign is needed.

## Size check
One deliverable, four acceptance criteria, two production files, no new exports/state/error branches and at most eight surviving external construction sites. Forecast about 420 inserted lines including plan and adapted regressions, with legacy deletions separate; below all builder limits.

## Revisions
2026-10-15: Removal queue entries use a distinct `removeConversation` key while cancelling the `daemon-items` snapshot key. Reusing the snapshot key would let a later item-holder clear discard the queued removal. `retains ordered deletion when a late item holder is cleared before draining` covers this invariant. The drain clears authoritative item/list comparisons after removal. `does not deduplicate fresh identical items against a pre-unpair in-flight save` also pins the retained generation fence.

Retired only the nine inventoried recording cases, exclusive writer/injected-reader/frame-persistence cases and their private fixtures. Direct timeline store admission, newest-demand and bridge/frame tests remain. Generic writer and protected removal assertions now use authoritative snapshots; restart/checkpoint tests retain their existing scenarios. Final written scope remains below the forecast and every sizing limit.

## Validation evidence
- Implementation candidate: `14b11df1b32877f37393fb866ad6f5be946c32c1`; final main merge contains `0d299bd26ede123c5dbda7295f7c5f85b52453d6`.
- The stamped legacy-mutation regression failed before implementation with one `replaceTimeline` request; all 132 targeted tests passed after removal. The final edited protected removal module also passed all six tests.
- Completed dependency installation, final pre-verify (all five checks; 416 files, 10,224 tests passed, 30 existing skips), build and docs guard passed. Logs: `/tmp/builder-2029/pre-verify-final.log` and `/tmp/builder-2029/build.log`.
- Complete configured fake suite: 432 executed, 431 passed, one failed, 10 existing skips, zero retries/flaky results or report-level errors; inherited two-worker setting and both clipboard/parallel projects. The active local-list failure case and all 15 thread-activation cases passed, including offline restore, live overlap, checkpoint and deletion/unpair coverage. Report: `/tmp/builder-2029/playwright-final.json`; summary: `/tmp/builder-2029/playwright-final-summary.txt`.
- The sole failure is the unchanged `thread-scroll-work.spec.ts` case `gaps, long hidden runs and target changes preserve a valid anchor and clean observations`: its five-second wait for `History row 99` expires at row 90. Candidate focused control: one executed, one failed (row 93). An unchanged main archive built with the same dependencies reproduces twice under two workers: two executed, two failed (rows 25 and 0). Reports: `/tmp/builder-2029/scroll-focused.json` and `/tmp/builder-2029/scroll-main.json`.
- Follow-up #2033 is open in Backlog with `priority:low` and linked as blocking #2029's required complete fake-suite green check. No failing assertion was skipped or weakened; its repair is outside this renderer persistence removal. PR #2032 preserves the implementation pending that gate repair. No live tests changed and no native task remains open.
- An earlier browser attempt was interrupted after Electron setup failures because dependency installation was still finishing; only the fresh completed run above supplies the full-suite result.

## Validation after blocker repair
2026-10-15: #2033 is closed and its repair is merged through main `1366e69e1e23d1ae264735f449ed86ff2dd7373b`. The resumed candidate is `79c7a4aae729c53019295a507de748b530089c43`; no implementation changes were needed. This completed run supersedes the pending gate above.

- Dependency installation, pre-verify (all five checks; 416 files, 10,224 tests passed, 30 existing skips), build and docs guard passed after the final main merge. The initial sandboxed check could not access labels/loopback transport; approved execution passed. Logs: `/tmp/builder-2029/install-resumed.log`, `/tmp/builder-2029/pre-verify-approved.log` and `/tmp/builder-2029/build-resumed.log`.
- Complete configured fake suite: **432 executed, 432 passed, zero failed, 10 existing skips, zero retries/flaky results and no report-level errors**. Configured and actual workers were both two; both clipboard/parallel projects retained zero retries. The command was `npx playwright test --reporter=json`, with no filters or configuration changes.
- The active `local list read failures stay beside the saved host` case, all 15 thread-activation cases and both scroll-work cases passed, including offline restoration/live overlap, checkpoint, deletion/unpair and the repaired gap/hidden-run scenario.
- Skips remain the three macOS-only cases and seven existing legacy-scenario skips in history-gaps, history-on-open, queued-own-settlement, reconnect-event-replay and visible-tail-read. No test was newly skipped or weakened. No live spec changed and no native task is open.
- Full report, stderr and inspected per-case/skip summary: `/tmp/builder-2029/playwright-resumed.json`, `/tmp/builder-2029/playwright-resumed.stderr.log` and `/tmp/builder-2029/playwright-resumed-summary.txt`.
- SHA256: report `9a875e14502b6507295825e63234c06e15663c974f8f1b9da3653846bda6c7b9`; unchanged configuration `3b6b77443bf5f4d3f6d56ece6c6b19ec95566efd9d4d445c2374239406b9db80`.
