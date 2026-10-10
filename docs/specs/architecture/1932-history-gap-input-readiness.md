# History-gap input readiness

## Files read
- `e2e/history-gaps.spec.ts` → named known-gap scenario: both fresh ArrowUp sites position before focus without final eligibility checks; retain failure/Retry, anchor, expansion and protected resume assertions.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `useThreadScrollPin`, `demandHistory`, `readUpward`: trusted thread input measures gap intersection before native scrolling; programmatic movement cannot release following during geometry changes.
- `playwright.config.ts` → `workerCount`: repeats must use at least three actual workers with retries explicitly disabled; full gate retains normal workers.
- `docs/knowledge/features/chat-history-testing.md` → demand and restoration contracts: persistence observation is separate from rendered settlement.
- `docs/knowledge/features/development-verification-history.md` → Known-gap recovery verification: preserve saved walk and mounted tool/anchor identity.
- `docs/knowledge/features/development-verification.md` → Layout and input: hover/focus reflow can invalidate a programmatic park; older-end readiness does not establish gap intersection.
- Shipped #1916 plan and test diff → analogue for measured layout readiness rather than delays.
- Original #1904 failure and rerun logs → four-worker gate failed at request three (2 received), single-worker rerun passed; neither records pre-key geometry.

## Change
Repair one fake-transport scenario without changing the history contract or presentation. First instrument the unchanged setup and obtain a controlled failing observation of focus, geometry and trusted input. If it confirms invalid positioning or unsettled layout, use scenario-local readiness at both fresh-input sites: settle pointer/focus and geometry, position the gap in the actual unobscured reading area, assert final intersection and unchanged request count, then send one ArrowUp. Readiness must not send extra trusted input, retry keys, sleep or extend timeouts. Production correction requires a recorded revision if valid eligible input is instead rejected. No in-flight feature branches overlap the test or renderer file. Sized at approximately 170 test/plan lines, zero public exports, two local call sites, three acceptance behaviours and no new failure state.

## Testing strategy
- Capture a controlled pre-repair failure and compare the original logs; publish the causal observation on #1932.
- Preserve the named test's existing negative-input, pending-input, loading/failure/Retry, sub-two-pixel anchor, expanded tool, protected `gap-step` cursor and final-content assertions.
- Assert layout settlement/programmatic setup adds no requests at both fresh-input sites, and exactly one fresh key asks the expected cursor.
- Run 20 repetitions of the named test with retries zero and at least three actual workers, then the complete default fake tier with normal workers and retries zero. Report actual workers and executed/passed/failed/skipped counts, plus the named full-suite result separately.
- After final main merge run pre-verify and build. No live-Claude or visual-design work applies to a test synchronization repair.
