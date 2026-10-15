# Retire legacy thread presentation

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/conversation-shell.md`, `docs/knowledge/features/thread-runtime.md`: production uses supplied daemon items; the old producers remain for the next cleanup.
- `docs/knowledge/features/development-verification.md`: static render and interaction proof boundaries.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `Timeline`, `ThreadItemsView`, `TimelineRow`: retire the legacy projection; preserve shared rows, canonical scrolling, pinning and composer wiring.
- `src/renderer/src/screens/conversation/BackgroundTaskPanel.tsx` → `BackgroundTaskPanel`, `BackgroundTaskPanelView`, `TaskRow`: keep supplied-task rendering and keyboard arbitration; remove roster subscription and legacy inputs.
- `src/renderer/src/screens/conversation/groupToolRows.ts` → `GroupedToolRow`, `groupToolRows`, `withProvisionalAgents`: keep the shared shape used by canonical nesting and tool runs, delete reconstruction.
- `src/renderer/src/screens/conversation/foldQueuedRows.ts` → `QueuedRowHandle`, `foldQueuedRows`: keep the action handle; delete legacy queue projection.
- Conversation presentation tests, `threadItems.test.tsx`, `threadTaskPresentation.test.tsx`, mixed producer tests, `e2e/tool-groups.spec.ts`, `e2e/background-task-reconnect.spec.ts`: retain shared presentation and producer proofs while deleting reconstruction-specific assertions.
- Daemon ADR 042, Decision and Migration order: daemon owns conversation presentation; the issue records the owner's fallback waiver.

## Context

One deliverable: remove the unused timeline and roster presentation without changing the authoritative route. No design change or new ADR is needed. The `suggestion-quieter-tab-sends` branch overlaps only in unrelated composer code; keep edits local. No numbered in-flight feature branch overlaps these production files.

## Design

Delete `Timeline` and its unreachable container render and presentation-only subscriptions/bookkeeping. Keep producer/store APIs intact for #2024. Retain `ThreadItemsTimeline`/`ThreadItemsView` and their shared rendering helpers unchanged except for the narrower supplied-task drawer contract. Export the existing `TimelineRow` for direct shared-row assertions instead of reconstructing timeline state in tests.

`BackgroundTaskPanelView` requires `suppliedTasks: readonly SuppliedBackgroundTask[]`; remove `entry`, `finishedTaskIds`, `pendingTaskIds` and `agent`. Preserve the existing supplied empty-array rendering, Running/Finished partition, raw Stop callback, progress, escaping, close effect and keyboard arbitration. Remove the unused roster adapter, legacy groups, reading rings and roster-only copy. Retain `backgroundTaskStopSupported` for canonical task eligibility.

Keep `GroupedToolRow` and `QueuedRowHandle` in their current modules. Delete their legacy functions and obsolete tests. In mixed producer tests remove only presentation assertions and their setup; preserve reducer, roster, bridge and history checks. Shared row tests render surviving rows directly; canonical tests retain authority, ancestry, activity, attachments and tool-run coverage. Do not add a raw-event-to-item test converter.

Sizing after caller audit: about 100 production, 400 test and 65 plan lines written, deletions separate; four production files, at most ten surviving test adapters, one existing component newly exported, no new state or reject branches, four observable acceptance criteria. Within all limits.

## State + concurrency model

No new state or async work. Delete only the legacy presentation's expansion/key bookkeeping and roster subscription. Canonical expansion, agent refs, scroll pin, animation-frame markdown and drawer effect cleanup retain their current owners.

## State transitions and identity reuse

| Event | Retained proof |
| --- | --- |
| Item revision, queued handle reuse, agent activity and supplied ancestry | `threadItems.test.tsx`, `threadTaskPresentation.test.tsx` |
| Open/switch/reconnect, follow-newest and pinned agent updates | active `e2e/thread-activation.spec.ts`, `e2e/thread-items.spec.ts`, `e2e/tool-groups.spec.ts` |
| Frame-coalesced text appends | `e2e/timeline-frame-deltas.spec.ts` |
| Drawer open/count/menu, close/Escape and composer/IME arbitration | active fake interaction coverage and `BackgroundTaskPanel.test.tsx` |

## Error handling

No new failures or I/O. Preserve canonical typed action handling, task eligibility, inert text, unknown outcomes and existing composer/status presentation.

## Testing strategy

- Test first: narrow drawer fixtures and assert the obsolete roster input cannot add copy to supplied tasks; observe failure before removal.
- Preserve shared row markup assertions using `TimelineRow` and existing canonical item fixtures. Delete tests of retired grouping, provisional placement, queue inference and gap projection; keep producer assertions in mixed files.
- Remove exactly the three allocated skipped legacy Playwright cases; keep all active cases.
- Final main merge, pre-verify (full units/typecheck), build and docs guard. Run the complete configured fake suite on the native managed route if local Electron is unavailable; inspect executed counts and commit its evidence in this plan. No live Claude tests are changed or required.

## Open Questions

None.

## Revisions

2026-10-15: The scroll hook's two surviving callers both use supplied items. Remove its legacy gap-demand branch and numeric prepend bookkeeping, retaining the identical supplied-item demand and immutable-presentation anchor comparison. Shared attachment, timestamp, copy/reply, delimiter and markdown-link suites render the surviving row view directly; tool-run assertions use supplied snapshots. The drawer's private summary/status inputs are now required supplied facts, so its legacy duplicate-summary suppression and label fallback are also removed.

2026-10-15 (verifier finding 1): Restore producer coverage removed with the mixed presentation suites. Move tool-result parent precedence and adjacent assistant-delta assertions into `threadTimeline.test.ts`, history tool/assistant attribution into `historyPageBridge.test.ts`, and receipt row identity/idempotence/reset into `queuedEchoSettlement.test.ts`. The terminal-status variants used only roster projection, so retain their common reducer assertions once without roster setup. No runtime contract changes or retired presentation API restoration.

Audit the remaining mixed-suite deletions against `ac44f55c`: roster/history/receipt/delivery/stop suites retain their direct producer assertions; grouping, queue folding, gap, task-panel and interaction deletions assert retired presentation. The version-1 assistant-parent round trip already survives in `src/shared/chatHistory.test.ts`. The queue-settlement audit also found producer transitions whose last assertion used the removed projection: retain direct stored-row and settlement assertions, including the deleted Send now stream-position scenario. Rework touches three existing test files and this plan; total written work remains below 800 lines, with no additional exports, consumers, state or reject branches. No numbered in-flight branch overlaps the three test files.

## Validation evidence

- Plan committed first as `f2eb1407`; implementation/runtime candidate `221b9b8b`, containing main `ac44f55c`. Final fixture cleanup changes only two unit specs and this record.
- Test-first regression: the supplied empty drawer fixture with an extra legacy roster reported `Partial list`, failing the new exclusion before removal. The final fixture uses only the narrowed supplied-task contract.
- Pre-verify: all five checks passed; 416 unit files, 10,245 passed and 30 existing skips. Build and documentation guard passed. Final two-spec fixture cleanup: 40 executed, 40 passed.
- Complete configured Linux fake suite: `npx playwright test --reporter=json`, 2026-10-15, four actual workers, clipboard and parallel projects, zero configured retries. **432 executed, 432 passed, 0 failed, 0 flaky, 0 retries, 19 skipped**, duration 243.46 seconds.
- Required active files: `thread-activation.spec.ts` 15/15; `thread-items.spec.ts` 12/12; `timeline-frame-deltas.spec.ts` 1/1; `tool-groups.spec.ts` 4/4. No active case removed or newly skipped.
- Inspected all 19 skips: 16 retained legacy cases owned by #2024 (nine recording, two gaps, one history-open, two own-settlement, one replay and one read-tail); three platform skips (two macOS badge cases and one macOS window-reopen). No unexpected failure or retry result.
- Full JSON: `/tmp/builder-2023-fake-suite.json`, SHA256 `5b786d5054c69063c367b011a7fcd3b58c7e0a68445fc7ab71bb05abb0e98007`; stderr `/tmp/builder-2023-fake-suite.stderr`. Pre-verify/build logs: `/tmp/builder-2023-preverify.log`, `/tmp/builder-2023-final-build.log`. Scratch artifacts remain outside the worktree.
- Final scope: four production files, one existing row component newly exported, no new state/reject branch/dependency. Written work remains below 800 lines; deleted lines are separate. No live specs changed, no live Claude proof required, no documentation handoff requirements.

### Rework validation, 2026-10-15

- Restored/strengthened producer targets: `threadTimeline.test.ts` 213/213, `historyPageBridge.test.ts` 37/37, `queuedEchoSettlement.test.ts` 21/21; **271 executed, 271 passed**. Delta timestamps advance independently so overwriting the first stamp would fail.
- After the final merge of `origin/main` (`ac44f55c`, already contained): pre-verify **5/5 checks passed**, **416 unit files, 10,252 passed, 30 existing skips**; `npm run build` and `npm run check:docs` passed. Logs: `/tmp/builder-2023/rework-preverify.log` and `/tmp/builder-2023/rework-build.log`.
- Rework changes only three producer test files and this plan. Production and browser specs remain identical to verifier-reviewed `5a70a79e`, whose complete configured fake suite passed 432/432 with 19 existing skips. No browser or live test changed or ran in this rework; the dispatcher's next complete fake gate remains pending.

## Documentation handoff

Pending for the documentation stage, as requested by the verifier:

- `docs/knowledge/features/conversation-shell-timeline-render.md` — Structured-stream timeline render; Supplied daemon item presentation; Legacy row reuse and stopped-turn records: describe the authoritative route and surviving shared rows.
- `docs/knowledge/features/conversation-shell-background-tasks.md` — Background-task panel; Stop task; Status tag and summary: remove retired roster-adapter inputs and distinguish supplied task facts from retained producers.
- `docs/knowledge/features/conversation-shell-tool-row-header-groups.md` — Subagent tool groups; Adjacent tool runs: remove retired grouping/queue projections and update coverage locations.
- `docs/knowledge/features/conversation-shell-scroll-pin.md` — User demand and prepend position: remove legacy gap-demand and numeric prepend bookkeeping references while retaining supplied-item scrolling.
