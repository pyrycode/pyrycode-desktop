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

## Revisions
2026-10-14 — The unchanged default-hidden test at plan commit `f00774c4` (production/base `c75bc69d46`) failed at `asks` immediately after ArrowUp: `electronApplication.evaluate` reported inspection context destruction, before returning any count. One executed/failed, zero passed/skipped/retried; `/tmp/builder-1947/baseline-hidden.json`. A visible-window run and the next hidden run passed; those passes alone are not diagnosis. Five instrumented hidden runs also passed without reproducing that transient error. No invalid park or product rejection was observed, so do not change geometry or renderer recovery.

The existing `readMainProcess` helper and harness context-recovery overview describe exactly this failure. Controlled pre-repair injection of that same error once after a successful count read of two real requests failed the original assertion with Electron running (1 executed/failed, zero skipped/retried; `controlled-before.json`). The identical injected read fault with the repair passed all original assertions (1 executed/passed, zero failed/skipped/retried; `controlled-after.json`, attached facts: running true, observedCount 2). This proves observer recovery without replaying a key or listener; it does not establish the upstream Electron/Playwright trigger or retrospectively identify the absent October 14 reports' assertion.

Revised contract: scenario-local `asks(): Promise<string[]>` uses `readMainProcess` in a five-second availability poll. Only the known inspection-context error produces the unavailable sentinel; no sentinel satisfies a count assertion and all other errors propagate. Every caller receives an actual successful read, including immediate opening-cursor and no-cascade assertions. Keep every original control action and transcript check unchanged. No shared harness, product, timeout or retry configuration change. The helper's existing unit tests cover falsy counts, the sentinel, fatal errors and callback identity; run them with the full pre-verify suite.

Daemon for diagnosis and validation: `/usr/local/bin/pyry`, version 0.39.0; Go build metadata module `github.com/pyrycode/pyrycode` v0.39.0, checksum `h1:G/dTdPcdztQXiz8fUTq7ubCshd0Lvld7iCpm+ulxkig=`, binary SHA-256 `a76a703551edf81a42e5b0b1112bf453ed52f08fab19c7f7cfee6ee296b2b3c8`. All runs explicitly select that executable. Five final serial focused passes and full dispatcher-gate handoff remain required.
