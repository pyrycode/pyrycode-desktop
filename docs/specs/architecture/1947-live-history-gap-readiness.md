# Real-daemon history-gap recovery

## Files read
- `e2e/real-daemon-history-on-open.spec.ts` → named history-on-open scenario: protected baseline, full process exit, 205 real posts, one opening ask and fresh input per gap page.
- `e2e/history-gaps.spec.ts` → `prepareGapInput`, `settled`: shipped local focus and measured-layout readiness analogue from #1932.
- `e2e/fixtures/realDaemon.ts` → `withIsolatedElectronApp`, `resolvePyryBin`: protected profile relaunch and actual daemon executable.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `useThreadScrollPin`, `demandHistory`, `readUpward`: gap intersection is measured between chrome before trusted native input scrolls.
- `docs/knowledge/features/chat-history-testing.md` → Demand and snapshot contracts: persisted coverage and rendered settlement are separate; positioning cannot demand history.
- `docs/knowledge/features/development-verification-history.md` → Known-gap recovery verification: preserve one request per fresh input and no settlement cascade.
- `docs/knowledge/features/development-verification.md`, `live-e2e-runbook.md` → controlled diagnosis, executable provenance and counted live results.
- Root `CLAUDE.md` and shared working practice → test-first, local helper scope and live launcher requirements.

## Change
Repair the existing real-daemon recovery scenario without changing its presentation or storage/protocol contract. Original October 14 reports are absent on this worker, so capture a fresh failing observation on main `c75bc69d46d61495242ac966a6f180b2a10cdcad` before selecting the repair. Instrument only focus, geometry, request counts and trusted-input facts, never credentials or daemon text. If the observation proves an invalid park, adapt #1932's scenario-local readiness: move the pointer away, focus, settle measured layout, center the gap between actual chrome, settle movement and assert focused intersection plus unchanged request count before exactly one ArrowUp. If valid eligible input is rejected instead, record a revision before a bounded renderer correction. Preserve all existing baseline, full-exit, 205-post, opening-cursor, paging, settlement, ordering and uniqueness assertions. No new exported types, state or failure mode is anticipated. Estimated total written work: 180–300 lines, zero public exports, one local consumer and three observable acceptance criteria; production scope is at most two existing renderer files if evidence requires it. Remote feature overlaps are recorded below after inspection; overlap alone is no dependency.

## Testing strategy
- Run the unchanged named live test, then controlled diagnostic coverage if an ordinary rerun passes; record failing step, tested revision and `/usr/local/bin/pyry` version/source identity on #1947.
- Preserve protected baseline served/display persistence and same-profile relaunch after all 205 posts made with Electron fully exited.
- Prove programmatic setup asks nothing, each fresh focused ArrowUp at the visible gap asks once and settled rendering/persistence asks nothing.
- Run the exact named test in five serial focused executions with retries zero, recording executed/passed/failed/skipped counts and daemon identity.
- After final merge of main, run pre-verify and build. Hand off the full real gate and named-test acceptance on the merged repair to the dispatcher; keep `needs-real-claude`.

No in-flight remote feature branch changes the named spec or renderer file. Readiness remains a hypothesis until a failing observation distinguishes setup from product rejection; record the conclusion in Revisions before handoff.
