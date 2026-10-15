# Retire legacy navigation bookkeeping (#2028)

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: repository conventions and counted native evidence requirements.
- `docs/knowledge/features/conversation-shell.md`, `docs/knowledge/features/thread-runtime.md`: production has no legacy content route; committed visible content alone supplies read evidence.
- `src/renderer/src/activateConversation.ts` → `activateConversation`, and its test: activation identity gate and configuration refresh.
- `src/renderer/src/exitActiveConversation.ts` → `exitActiveConversation`, and its test: matching-id cleanup before navigation.
- `src/renderer/src/confirmConversationDeleted.ts` → `confirmConversationDeleted`, and its test: owning-host admission before active exit.
- `src/renderer/src/clearPairingScopedState.ts` → `clearPairingScopedState`, and its test: pairing cleanup and persistence-last ordering.
- `src/renderer/src/clearServerScopedState.ts` → `serverScopedClearDeps`, and its test: exclusive departed IDs sampled before list removal.
- `src/renderer/src/PairedShell.tsx` → activation/exit/pairing dependencies, created navigation and deletion callback: composition and retained host gate.
- `src/renderer/src/store/conversationLastReadBridge.ts` → `useConversationLastRead`, and its test: disabled legacy stamping and mounted publication.
- `src/renderer/src/store/conversationReadPublisher.ts` → `useReadPublication`: authoritative subscription ownership remains unchanged.

## Context

Production requires daemon-built threads. Navigation still mutates dormant flat/keyed timelines and invokes disabled local count stamps. Remove that bookkeeping without changing displayed behavior. Current issue includes created-chat initialization and inactive confirmed deletion. No new ADR is needed.

One deliverable, approximately 390 inserted lines including tests and plan; deletions separate. No new exports, state or rejection branches; seven production modules and fewer than ten surviving production consumer adaptations. No overlapping remote numbered feature branches touch the planned production files.

## Design

- Remove `dispatchTimeline`, `stampLastRead` and `markViewed` from activation. Retain session/configuration clearing only on identity change, payload refresh and configuration requests on every activation.
- Remove `dispatchTimeline` and `clearTimelineFor` from exit and inherited server/deletion dependencies. Exit still gates on active ID, clears active/session/configuration state and navigates last.
- Remove pairing's `dispatchTimeline` and `clearAllTimelines`. Keep all other cleanup declarations, including local last-read, queue and roster cleanup. Keep persistence last.
- Server cleanup samples exclusive departed IDs before dropping their list slot, exits any matching active chat and clears local read marks last. Remove its per-ID legacy timeline clear.
- Confirmed deletion preserves the existing owning-host getter/check and active exit. Remove inactive legacy clearing and its diagnostic. Authoritative runtime/protected removal is unchanged.
- Remove corresponding PairedShell wiring and created-chat `initializeCreatedTimeline`. Keep the timeline import needed by deletion ownership and saved IO. Do not change saved-format admission or other producers.
- Reduce `conversationLastReadBridge` to its existing hook calling `useReadPublication`. Remove count-stamp helpers, dependencies, subscription and exclusive tests. The publisher implementation remains unchanged.
- Adapt existing spy/real dependency factories; retain negative assertions against seeded legacy stores to prove navigation leaves them alone.

## State + concurrency model

No new state or async task. Navigation remains synchronous. Remove one legacy store subscription; authoritative read publication retains its existing mount/cleanup and committed-snapshot fences. Authoritative item, pending-send, host-scoped runtime and protected-storage removal remain at their existing boundaries.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| First activation, switch, same-ID reopen, fresher payload | `activateConversation.test.ts`: existing activation/configuration cases adapted to preserve legacy state |
| Active deletion/archive, mismatched ID, repeated confirmation | `exitActiveConversation.test.ts`: existing gate, ordering and idempotence cases |
| Owned inactive deletion, missing/wrong host, duplicate deletion | `confirmConversationDeleted.test.ts`: retain admission/active cleanup; replace retired-clear expectations with unchanged state |
| Whole pairing clear and repeat | `clearPairingScopedState.test.ts`: existing real-store cleanup/idempotence and persistence-order cases |
| Server removal with other host active, no rows, several departed IDs | `clearServerScopedState.test.ts`: existing exclusive-ID and navigation cases |
| Creation, host isolation, deletion/unpair, committed visible read publication | Existing complete fake-transport suite, including `thread-activation.spec.ts` and `thread-items.spec.ts` |

## Error handling

No new errors or logs. Preserve unowned/unattributed deletion diagnostics and active-exit diagnostic. Retain local read persistence after in-memory cleanup so a storage failure cannot interrupt other clears. Remove diagnostics claiming inactive legacy content was cleared.

## Testing strategy

Write changed regression expectations first and observe failures on existing behavior. Remove tests exclusive to retired stamping/eviction/navigation clears; standalone producers and store tests remain. Preserve all configuration, prompt, host isolation, protected removal and authoritative publication coverage. Run focused units, then final main merge, install, pre-verify and build. Request the complete configured fake suite for the exact pushed candidate through managed `desktop-fake-suite`; inspect counted results and attachments, and record returned evidence here. No live tests or visual changes.

## Open Questions

None.

## Validation

- Test-first: changing the existing preservation expectations failed on activation reset, exit reset and inactive deletion clearing (3 failures, 42 passes).
- After the final merge of `origin/main` (`0d299bd26ede`), pre-verify passed all five checks: 415 unit files, 10,224 passed tests and 30 existing skips. `npm run build` and `npm run check:docs` passed.
- Focused final navigation/cleanup units: 66 executed, 66 passed across five files.
- Complete configured native fake-transport suite: managed task `db47ef552e357d3da36abf43f54891dbcfc0aee1588e9a697235800c8860e37e` is queued for pushed candidate `4d695203d5035b69ba02d77f1368e2809ead676d`. Native acceptance remains pending. On return, inspect `desktop/capture.json`, `desktop/playwright.json`, `desktop/playwright.list.log`, `desktop/execution.log`, `desktop/playwright.config.ts` and every fake-daemon-setup attachment; record executed/passed/failed/skipped/retry counts and skip reasons here in an evidence commit. No native pass is claimed.
