# Permission reader setup reliability

## Files read

- `e2e/permission-modal-answer-paths.spec.ts` → inline arrival regression: setup and retained assertions.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `useThreadScrollPin`: geometry guard retains following; trusted upward input releases it before scrolling.
- `src/renderer/src/screens/conversation/PermissionModal.tsx` → `PermissionModalView`: initial Cancel focus already prevents scrolling.
- `e2e/thread-scroll-pin.spec.ts` → `stableThreadOffset`, `primeOverflowingThread`: rendered-history and native-motion verification patterns.
- `e2e/fixtures/desktopIsolation.ts` → `e2eShowsWindow`: Linux runs shown on Xvfb.
- `docs/knowledge/features/conversation-shell-scroll-pin.md` → Thread scroll pin / Streaming input verification: intent and stable-frame observation.
- `docs/knowledge/features/conversation-shell-permission-modal.md` → Presentation: inline card and independent composer.
- `docs/knowledge/features/development-verification.md` → Layout and input: metadata hover/focus changes geometry before baselines.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`: repository conventions and reading map.

## Change

Repair only the named Playwright regression. Confirm all 24 completed seeded replies render and overflow before testing pinning. After pinned-card dismissal, settle pointer/layout, use trusted upward wheel input, and require actual upward movement and a settled position away from the bottom before delivering the held card. Keep that baseline immutable across arrival, initial Cancel focus, same-request content growth and composer draft. Observe stable geometry after each action; require positive rendered growth and checked/armed state where relevant. Deliberate visible-control positioning remains before its own baseline.

Confirmed setup race: the geometry guard intentionally preserves following through native layout movement. A programmatic scroll concurrent with metadata reveal does not express trusted upward intent, so resize delivery can re-pin it. At base revision `794574c4`, focusing an existing message Copy control with `preventScroll` immediately before the original assignment reproduced the recorded 1125 → 1567 jump in 3/3 attempts. Instrumented setter stacks showed `ResizeObserver` re-pinning 100 → 1125 before the baseline, then the screen layout effect pinning the arriving card. All 24 rows were already rendered; no seeded delivery was pending. A settled control observation passed 3/3, and original-timing instrumented repetitions passed 20/20: green repetitions alone would have missed the cause. Logs: `/tmp/builder-1916/controlled.json`, `diagnostic.json`, `diagnostic-fast.json`.

Original evidence at `de222e52ff`: `verifier-gate_#1913_6.log` recorded 3 workers, 376 pass / 1 fail / 3 skip, with the named test failing on attempt zero; `2026-10-10T11-14-25-205Z_verifier-gate-rerun_#1913.log` recorded 1 worker, 1 pass / 0 fail / 0 skip. Metadata reveal adds 28px, producing the observed 1125px endpoint; Cancel focus collapses it while the 470px card arrives, explaining the 442px net jump.

No production change, exported type, state or failure mode. Remote numeric feature branches have no overlapping changes in the spec or either candidate renderer file. Estimated written work: under 180 lines, zero production files, zero consumer changes, three acceptance behaviours; within all sizing limits. No UI change requires a Figma read.

## Testing strategy

- Before repair, run the controlled metadata/setup observation and watch the existing held-arrival assertion fail for the exact recorded offsets.
- Preserve pinned arrival/arming, hinted Cancel focus, held arrival, same-request growth, draft, visible checkbox editing and visible choice arming in the named regression. Stable samples must include content/viewport heights as well as offset; do not recapture after arrival or poll until a jump disappears.
- Repeat the repaired test 20 times with 3 configured/actual workers and retries disabled, with zero skips. Run the full default fake-transport gate at 3 workers and zero retries, reporting this test separately from unrelated failures (explicit ticket acceptance requires this full run).
- Final merge of main, pre-verify check and build. No live Claude test is required.
