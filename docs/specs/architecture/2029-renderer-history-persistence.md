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
