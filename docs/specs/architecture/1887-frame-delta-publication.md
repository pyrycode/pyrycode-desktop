# Frame-coalesced timeline deltas

## Files read
- `src/renderer/src/store/timelineBridge.ts` → `subscribeTimeline`, `useTimelineBridge`: translation, arrival metadata and dual-store fan-out.
- `src/renderer/src/store/timelineStore.ts` → `createTimelineStore`: flat reducer publication.
- `src/renderer/src/store/conversationTimelineStore.ts` → `createConversationTimelineStore`, `dispatchFor`, `receivedSlice`, `retainLiveDisplay`: receipt-bound host ownership and per-event durable joins.
- `src/renderer/src/store/threadTimeline.ts` → `reduceTimeline`: sequence and parent/subagent grouping remain unchanged.
- `src/renderer/src/store/timelineBridge.test.ts` → synchronous subscription regressions.
- `e2e/fixtures/launchPairedApp.ts` → fake daemon and mounted Electron fixture.
- `docs/knowledge/features/conversation-timeline-store-data-flow.md` and `conversation-timeline-store-internals.md`: receipts exist only during delivery; individual contributions and held row identity must survive batching.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: renderer-only implementation, static unit-render limits and focused mounted verification.

## Context
Fast delta arrivals currently publish both timeline stores for each chunk. Delay only uninterrupted delta bursts to the next runnable animation frame, without changing presentation or reducer semantics. This is one timing deliverable, independent of the rendering/layout tickets. No ADR is needed.

## Design
Add a small renderer publication helper used inside both timeline factories. Its synchronous `batch(run)` stages existing mutation results and publishes once; staged reads see prior folds. A before-mutation subscription flushes accepted deltas before any ordinary store action, including history admission, local echo, queue removal and clears. Without a batch, setters retain Zustand's synchronous/no-op behavior. Existing action signatures remain compatible.

`subscribeTimeline` accepts optional frame options: a scheduler with `request(callback): number` and `cancel(handle): void`, a batch runner, arrival-host getter and mutation-boundary subscription. Translate each delta immediately and retain its conversation, timestamp, sequence, parent, join key, durable entry id and host. Schedule only the first pending delta; subsequent arrivals never reschedule. Flush dispatches individual events through the existing actions inside one batch per store. Add an optional trailing receipt-host argument to `dispatchFor`, so deferred writes never consult an expired receipt. The pure reducer and live-display retention are unchanged.

The mounted bridge explicitly supplies browser animation-frame scheduling, receipt capture and both stores' publication/boundary hooks. Existing subscribers without options remain synchronous, including their original unsubscribe handle. Non-delta events flush before translation/reconnect handling, even if they produce no timeline event.

No overlapping in-flight feature branches touch the planned existing production files at planning time. Estimated total work: 600–700 lines including plan/tests; three new exported interfaces/functions, no required consumer migrations, five acceptance behaviors, no new error/reject branches. Within all sizing ceilings.

## State + concurrency model
The subscription owns one FIFO of translated delta deliveries and at most one scheduled callback. Flushing detaches the FIFO and cancels its handle before running folds, preventing recursive mutation-boundary flushing. Store batches synchronously stage state and publish at their end; no awaited work or new Zustand slice is introduced. Cleanup unsubscribes, settles accepted work once, cancels the frame and removes boundary listeners. Stale callbacks check subscription activity and cannot mutate after cleanup. Clear/reset/reconnect actions therefore occur after prior accepted deltas and cannot be undone by queued work.

## Error handling
No new I/O, wire parsing or failure modes. Existing typed boundary results and reducer admission rules remain intact. Scheduling uses the next runnable callback, without a timer deadline or debounce.

## Testing strategy
- Inject a deterministic frame scheduler and isolated stores; prove one publication per burst, first-frame delivery without postponement, exact equivalence to individual folds and parent/subagent grouping.
- Prove arrival-time host, timestamp, conversation, sequence, joins and durable contributions survive deferred delivery, switching and interleaving; repeat history admission without duplicated text.
- Exercise daemon boundaries (including ignored events, tools, terminal/stall/reconnect) and local history/echo/queue/clear mutations; assert earlier text is visible before their effects.
- Cleanup settles once, cancels and ignores a manually invoked stale callback; synchronous existing specs remain unchanged.
- A focused fake-transport Playwright case controls browser frame callbacks, observes actual daemon delivery and mounted React commits, and proves the production bridge withholds a controlled burst then commits it once on the first released callback. No live-Claude test or visual change.

## Open Questions
None. The simpler shape is publication transactions around existing folds rather than a second batch reducer or concatenated text.

## Revisions
2026-10-08: The publication helper also flushes before an action's injected state read, because `beginLocalTimelineRead` can decide whether to replace a slice before reaching its setter. Staged reads inside batches remain immediate. Frame generations invalidate canceled callbacks so they cannot settle a newer burst. The mounted proof uses the existing React production devtools commit hook in the test window, with no production instrumentation.

2026-10-08 (verifier findings 1–4): Persistence must observe individual staged folds as well as unbatched publications. Add `subscribeTimelineWrites(listener)` to the publication helper; staged notifications carry the explicit arrival host (including null), and the final rendering publication is excluded from that observer. `dispatchFor` supplies its captured origin to this channel. `createChatHistoryWriter` optionally uses it, preserving the existing synchronous fallback; its mounted composition explicitly selects it. This keeps intermediate equal-id host replacements saveable without granting earlier deltas a later boundary's receipt. Rendering still receives one publication per store. Narrow `useConversationActionAvailability` to the derived host, preserving immediate latest-entry/read-mark handling while unchanged availability cannot redraw Timeline. The mounted test counts rendered Timeline fibers from before delivery, supplies increasing durable IDs in separate tasks, and expects zero commits before release and one afterward. The resolution-notice test observes its acknowledgement delivery before advancing the paused clock to the next animation frame; its four-second lifetime assertions remain intact. Added regression coverage proves detached persistence/restoration, equal-id and different-id host interleaving, and rejection of ownership from later receipts. No overlapping in-flight branches touch these rework files.

2026-10-08: The named unpair regression exposed the same paused-frame barrier as finding 4. Its local test helper observes delta delivery and releases one frame while retaining the buffered 200ms save. Apply that helper to the existing macOS window-close case too; it remains platform-skipped on Linux. The received-list boundary in the buffered-quit case already flushes its delta synchronously.

2026-10-08 (verifier finding 1 at `5ec25fee`): Window-close history shutdown can stop the writer before the timeline bridge's pending frame runs. Expose `flushTimeline(): void` on the existing publication helper to settle mutation-boundary listeners without a dummy state change. Inject it explicitly into the mounted history writer; `stop` settles accepted deliveries while its per-fold observer is attached, then detaches and awaits the existing storage drain before preload acknowledges shutdown. Repeated stop calls do not flush newly arriving work. Synchronous injected writers without this optional hook retain their existing behavior. Units stop with no frame release, both with and without a saved prefix, then verify captured host, durable fragments, fresh restoration and stale callback suppression. Replace the previously frame-releasing macOS-only close test with a real BrowserWindow-close regression that holds the tail's frame throughout shutdown and checks protected state and mounted content after reopening; macOS reopens a window, other platforms relaunch the same profile. No overlapping in-flight branches touch these files. Incremental repair is approximately 100 written lines, two production files, no new exported types or required consumer migrations.

## Documentation handoff
- Pending for documentation stage: `docs/knowledge/features/conversation-timeline-store-data-flow.md` § Data flow — production frame scheduling, synchronous injection defaults, retained per-event metadata, ordering boundaries and cleanup/callback invalidation.
- Pending for documentation stage: `docs/knowledge/features/conversation-timeline-store-internals.md` § The store and § The translator + binding — frame publication versus per-fold received-state persistence, captured host evidence, controlled-clock tests releasing the next frame, and window-close shutdown settling accepted deliveries before writer detachment and acknowledgement.
