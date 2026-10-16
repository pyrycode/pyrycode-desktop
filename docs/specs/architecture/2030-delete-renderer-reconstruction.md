# Delete renderer reconstruction producers

## Files read
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: repository contracts and counted verification.
- `docs/knowledge/features/thread-runtime.md`, `docs/knowledge/features/conversation-shell.md`: authoritative content, pending-send identity and cleanup fences.
- `src/renderer/src/store/threadRuntime.ts` → `createThreadRuntime`: accepted host/session authority, restoration and removal ownership.
- `src/renderer/src/store/threadTimeline.ts` → `reduceTimeline`, `ThreadItem`, `ThreadEvent`: retired reducer beside shared presentation declarations.
- `src/renderer/src/store/timelineBridge.ts` → `translateTimelineEvent`, `subscribeTimeline`: preserve shared translation; remove content subscription and joins.
- `src/renderer/src/store/conversationTimelineStore.ts`, `historyPageBridge.ts`, `historyContributions.ts`, `backgroundTaskRosterStore.ts`: exclusive reconstruction, receipts, history demand and inferred agents.
- `src/renderer/src/App.tsx`, `PairedShell.tsx`, `clearPairingScopedState.ts`, `clearServerScopedState.ts`: mounts and exclusive queue/read cleanup.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx`: composer, refusal and session-error fallback readers.
- `src/renderer/src/store/conversationReadPublisher.ts`: authoritative committed observation and retired receipt observation.
- `src/renderer/src/store/appBadgeBridge.ts`, `pushNotifyBridge.ts`, `conversationUnread.ts`, `screens/channels/ChannelList.tsx`: status, preview and unread fallbacks.
- `src/renderer/src/store/runSettingsWriteBridge.ts` → `subscribeRefusalRecovery`: model-selection forwarding must survive.

## Context
Every accepted host requires daemon-built thread items. Navigation and saved IO retirement have merged; dormant reconstruction and fallback consumers can now be deleted. Shared declarations remain in place. No ADR is needed; this implements ADR 042 and the owner's no-fallback decision.

Sizing: approximately 760 inserted lines including tests and this plan, with thousands deleted; no new exported abstraction or reject machine, five acceptance behaviors. At least eleven surviving integration modules exceed the consumer ceiling. Recorded parentage #2020 → #2024 → #2030 forbids another split; retain `needs-human:sizing` and build in place. The cleaner shape is deletion of exclusive consumers, with existing item/live surfaces supplying the surviving readers.

Remote feature-branch audit after fetch found no overlap in the identified production integration files. Preserve additive changes in surviving cache/browser fixtures if encountered.

## Design
Delete flat/keyed timeline stores, reducer implementation, history reconciliation/demand/retry, joins, gaps/receipts, legacy echo settlement, roster inference and their exclusive mounts/tests. Keep shared presentation types and translations at their existing paths. Remove queue and local-count last-read bookkeeping once their exclusive consumers disappear. Main, IPC and saved-format contracts remain for #2025/#2026.

Status uses admitted host-qualified live readings and received shown/read watermarks. Missing snapshot or binding produces empty content-derived reports/previews and idle live status, never reconstructed state. Composer sends remain owned by `threadRuntime.sends`; canonical items settle them by exact host/device/message identity. Refusal model-selection forwarding remains, while timeline dispatch and legacy event settlement disappear. Preserve authoritative session-error consumption identity and microtask fencing.

`readTargetFor` accepts authoritative inputs only. Remove legacy DOM observation and retain committed immutable snapshot, completion, epoch, visibility/focus, reader, acknowledgement and teardown fences. Preserve `useReadPublication`'s shell lifetime. Item-based notification previews remain.

## State + concurrency model
No new state. Existing item/query/live/send/read stores retain their ownership and cancellation. Deleting exclusive subscriptions removes their async jobs; authoritative cache, generation fences, checkpoint certification, deletion and unpair ordering remain untouched.

## State transitions and identity reuse
| Event | Existing retained proof |
| --- | --- |
| Open/reopen, reconnect, paging/retry and missing-thread recovery | `e2e/thread-activation.spec.ts` |
| Exact send acceptance, queue recovery, host/device collision | `threadSendStore.test.ts`, `e2e/thread-activation.spec.ts` |
| Session replacement, refusal model selection and session-error consumption | `threadLiveState.test.ts`, `threadComposerReports.test.ts`, active conversation feature specs |
| Pre-commit append, epoch replacement, focus/reader/viewport changes and read acknowledgement | `conversationReadPublisher.test.ts`, `e2e/thread-items.spec.ts` |
| Offline restore, deletion/unpair, restart and stale callbacks | `threadRuntime.test.ts`, active cache/removal specs |

## Error handling
No new failure modes. Existing typed authoritative query/send/live feedback remains. Missing authoritative input yields no content report. Remove legacy history failures/retry UI adapters; authoritative query error/retry stays in its existing item view.

## Testing strategy
Write focused missing-authority/unread assertions first and observe their failure, then delete producers and adapt active tests without duplicate authoritative proofs. Remove producer-exclusive tests only with their producer. Remove exactly seven retired browser cases from history-gaps, reconnect-event-replay, queued-own-settlement, history-on-open and visible-tail-read; preserve mixed-file active cases and shared publisher.

Run install, final main merge, pre-verify, build and the complete configured fake Playwright suite on Linux, recording executed/skipped counts. Keep all active cache/removal/restart and conversation feature coverage. No changed live specs are planned.

## Open Questions
None. The shared declarations' surviving imports determine what stays; no replacement hierarchy or rename cascade is introduced.

## Revisions
2026-10-16: The final caller audit found two unused queue action helpers, `dropQueuedMessage` and `sendQueuedNow`, whose presentation callers retired in #2023. Delete them and their exclusive tests; retain `QueuedRowHandle` in place. `ComposerSendDeps` now requires the captured host and authoritative pending-send store, removing its unused flat/keyed dispatch callbacks. Existing exact-settlement tests remain the proof; composer tests retain command, attachment and diagnostic assertions without constructing a legacy holder.

The read publisher also requires an authoritative epoch and shown watermark; remove its optional legacy latest-entry eligibility branch. Its existing retry, acknowledgement and ownership cases now supply authoritative epochs. Shared presentation/translator declarations remain at their existing paths. Final written work remains below 800 inserted lines, with the recorded consumer-count exception unchanged.
