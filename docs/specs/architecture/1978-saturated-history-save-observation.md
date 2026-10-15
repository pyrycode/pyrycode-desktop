# Saturated history save observation

## Files read

- `e2e/chat-history-recording.spec.ts` → receipt saturation scenario, `observeCommands`, protected-handler observation in confirmed deletion: retain the persistence proof and observe actual successful operations.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`: reused profiles reconnect through the first daemon; the hook follows handler registration.
- `e2e/fixtures/mainProcessRead.ts` → `readMainProcess`: only inspection reads may tolerate transient context loss; installation must remain single-shot.
- `src/renderer/src/store/chatHistoryWriter.ts` → `capture`, `drain`: received snapshots are buffered before real protected replacement.
- `src/renderer/src/store/newestHistoryDemand.ts` → `createNewestHistoryDemand`; `historyPageBridge.ts` → `requestHistoryPage`: one opening request, independent oldest coverage.
- `src/renderer/src/store/savedTimelineRestorer.ts` → `readSavedTimeline`: owned restoration precedes newest demand.
- Root `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`, `chat-history.md`, `chat-history-testing.md`, `development-verification-history.md`: separate receipt/save evidence, exact saturation and identity invariants.
- `docs/specs/architecture/1918-receipt-saturation-synchronization.md`, `1986-offline-settings-reliability.md`: neither earlier diagnosis establishes this recurrence's cause.

## Change

Keep the repair inside the named scenario. Before second-launch navigation, wrap the existing protected-history handler once, forwarding every request unchanged and recording only successful matching `replaceTimeline` completions by item count. Poll this small observation with the existing five-second budget before reading the complete saturated snapshot once for exact equality. Do the same for later live content, after positively observing its rendered receipt. Restore the original handler before closing the second process. A failure tears down that process through the existing fixture. Receipt observation and protected-save success remain separate; successful storage, not receipt or elapsed time, releases the full-snapshot assertion. No application, transport, IPC contract, presentation or shared fixture changes.

Preserve immediate correlated fake replies, 500 receipts × 200 ids, only `page-0` eviction, held oldest-end coverage, exactly one newest command, the single assistant at `-8`, later live key `42` / next key `43`, and full saved equality after a third fresh process. Keep the existing CDP command observer: an alternating comparison did not establish it as responsible. No in-flight remote feature branch overlapped the spec during the dependency audit. One deliverable, three criteria, approximately 160 final written lines, zero exported types or consumer migrations, zero production files.

Observed controlled failure at exact historical `3d527863366852cdfa49d945daa192d16df380ce`: eight-worker unchanged named runs alongside its original full suite produced 16 passed / 16 failed, zero skips/retries (`/tmp/builder-1978/historical-contention.json`). Failures occurred in the second launch's later-live five-second saved-text predicate: expected `retained assistant|later live content`, received `retained assistant`; the DOM already contained the live row. Instrumented runs produced 11 passed / 5 failed. Their real-handler traces show the stale read preceding live replacement; replacement returned `ok`, and the first subsequent diagnostic read held two items, keys `[-8, 42]`, next key `43`, 500 receipts and newest cursor `repeat` (`history-instrumented.json`). The expensive full-snapshot read can consume the polling deadline while returning an earlier snapshot. This is an observation race, not evidence of lost persistence. The original archived assertion remains unavailable: managed evidence queries returned no bundles. Do not claim these controlled failures recover its exact assertion.

The CDP/main-observer alternating control recorded 12/4 passed/failed with CDP and 10/4 with main, plus two main-inspection setup failures; it does not justify an observer repair (`observer-comparison.json`). Both unchanged complete suites passed: current main 405 passed / three platform skips, historical revision 395 passed / three skips, zero retries. Passing baselines are not repair proof.

## Testing strategy

- Retain the unchanged failure reports and real-handler traces as test-first evidence. Run the repaired scenario under the same eight-worker contention configuration; exact snapshot assertions must pass without transferring stale large records during save polling.
- Exercise the save observation against a held unsuccessful/pending replacement in a scratch control: receipt alone must not satisfy it; the unchanged full-snapshot equality must still detect incorrect persisted state.
- After final main integration, run pre-verify and build, then 20 consecutive named executions with retries disabled and the complete recording spec with retries disabled. Record commit, counts, skip reasons and artifact paths on the ticket and PR.
- Dispatcher owns the full fake-transport acceptance gate. No live-Claude or documentation deliverable is required.
