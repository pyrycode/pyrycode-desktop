# History walk reliability

## Files read

- `e2e/history-walk.spec.ts` → `PAGES`, `walkingFake`, `scrollBack`, `walkBackUntilAskFor`: scripted pages, input and assertions under investigation.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`: existing fake transport and app lifecycle, retained unchanged.
- `src/renderer/src/store/historyPageBridge.ts` → `subscribeHistoryPage`, `requestOlderHistory`, `requestGapHistory`: receipt admission, pending guards and cursor selection.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `useThreadScrollPin`, `readUpward`, `demandHistory`: trusted input measures geometry before scrolling, with visible gaps taking priority.
- `docs/knowledge/features/chat-history.md` → Received-state admission and ownership: received coverage alone determines paging; new input is required after each response.
- `docs/knowledge/features/conversation-shell-scroll-pin.md` → User demand and prepend position: programmatic movement cannot create demand; layout and input ordering matter.
- `docs/knowledge/features/conversation-timeline-store-internals.md` → durable entry IDs define chronological boundaries.
- `docs/knowledge/features/development-verification.md`: positive processing/commit barriers and complete-suite evidence.
- `playwright.config.ts`: four workers, clipboard/parallel projects; explicit zero retries for reliability proof.

## Context

The original #1979 bundle confirms a failed complete gate and a passing isolated rerun, but its truncated original report omits the failed assertion. Do not infer the original schedule from that pass. Reproduce a failure or controlled regression with retained diagnostics before claiming a cause. This is test reliability work with no intended product or visual change and no ADR.

Sizing: one diagnosis-and-repair deliverable, approximately 300 written lines including this plan, no new production exports or consumer migrations, three observable acceptance criteria. No remote numeric feature branch currently edits `e2e/history-walk.spec.ts`. Production edits require rechecking overlaps and recording the evidence first.

## Design

Keep the existing launch fixture and the complete page-walk assertions. Prefer a spec-local repair: model the durable log honestly, and order each trusted input after the required receipt/commit/geometry processing. Do not make frame counts stand in for asynchronous IPC receipt. Use held fake replies and observed renderer state where a controlled schedule is needed. Diagnostics contain only fixture-owned cursors, IDs, counts and geometry.

Before settling on a larger synchronization helper, check whether correcting fixture chronology or using one existing positive readiness boundary suffices. No shared harness, dependencies or speculative production guards.

## State + concurrency model

The fake captures requests and can hold/release a correlated page. Electron main and renderer retain their existing request ownership and single-pending guards. A wire request is not proof that its response committed. Spec-local observers, if needed, live only in the launched page and teardown with it. No new product state or long-lived work.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| Opening received; first trusted upward input | Existing named walk: opening count and overflow before first cursor |
| Empty nonterminal receipt; new upward input | Existing named walk: exact next cursor without automatic continuation |
| Short nonterminal receipt; new upward input | Existing named walk: committed short row, next cursor and no automatic continuation |
| Terminal receipt; repeated upward input | Existing named walk: terminal row, exact request sequence and final count |
| Controlled reproduction schedule | Add a focused regression or a controlled variation of the named walk after diagnosis |

## Error handling

Keep unknown cursors unanswered so they fail a positive next-page barrier. Preserve failure reports and diagnostics outside the worktree under `/tmp/builder-1999/`. Unexpected requests and duplicate rows remain failures; no retries, skips, extra timeouts or sleeps are repairs.

## Testing strategy

- Build the existing app and reproduce the named walk on Linux with retries disabled.
- Establish a controlled failing condition before implementing the repair; record what it proves and what remains unknown about the original incident.
- Preserve opening overflow, trusted input, exact cursor order, `limit: 200`, empty/short continuation, no automatic continuation, `at_start` stop and duplicate-free final count.
- Run ten consecutive named executions with zero retries, then the complete configured four-worker fake gate. Retain JSON reports, stderr and failure artifacts; report executed/passed/failed/skipped/retry counts and revision.
- After the final merge of main, run pre-verify and build. No real Claude test is needed.

## Open Questions

- Which assertion fails under a reproduced condition, and what causal sequence produces it?
- Do invalid fixture ID chronology, premature response readiness or input geometry explain that condition? Resolve with controlled evidence and record the final contract in Revisions.

## Revisions

2026-10-15 — Resolved both questions with a spec-local controlled regression. The unmodified named walk passed 10/10, so that baseline alone diagnoses nothing. Bringing the terminal row into view and issuing trusted ArrowUp failed the existing final exact-cursor equality: expected `['', 'cursor-page-2', 'cursor-page-3', 'cursor-page-4']`, observed one additional `''`. Three diagnostic executions failed identically. Before that input the thread was focused at offset 700 (height 1433, viewport 733); invented gap IDs 113 and 200 occupied y=369–413 and y=497–541. `demandHistory` correctly prioritizes those visible gaps, independently of oldest-end `atStart`. The original fake's later pages used IDs 200 and 300 above opening IDs 100–113, creating disjoint newer spans instead of older continuation. No renderer defect was demonstrated. The exact original #1979 assertion/schedule remains unavailable in the truncated source report; this is a reproduced geometry-dependent failure, not a claim to have recovered that trace.

The repair serves contiguous newest-first IDs 16 through 3, then an empty page, then 2, then 1. The named walk retains the terminal-row reader position as its regression and checks there are no invented gap markers. Restoring only the three old ID expressions in the final test caused 3/3 failures at its exact request equality, each with an extra `''`; retaining the receipt barriers did not mask the defect. Correct IDs passed 10/10 before final gates.

The test now positively observes protected saved coverage before further input, including the otherwise invisible empty-page receipt, then makes a main-process round trip and checks the exact request count. This separately retains the no-automatic-continuation contract without adding sleeps. Existing DOM commit checks, overflow, trusted input helpers and timeout values remain. Final equality checks the conversation and limit on every request, and final row count remains exactly sixteen. Diagnostics attach only fixture-owned cursors/IDs/counts and geometry. No new production state, exports, error branches or shared infrastructure. Written scope remains below the 300-line estimate and all sizing ceilings.

Evidence retained under `/tmp/builder-1999/`: `baseline.json` (10 passed), `control.json` (1 failed), `control-diagnostic.json` (3 failed, pre-input geometry), `final-mutation.json` (3 failed with only old IDs restored), and `repaired.json` (10 passed). Each has matching stderr; failure directories retain Playwright error contexts and JSON embeds diagnostic attachments. All use Linux x86_64, Xvfb, Electron 33, configured four workers, and explicit zero retries.
