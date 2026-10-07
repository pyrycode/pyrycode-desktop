# #1813 — Launch readiness and isolated input rework

## Files read

- `e2e/fixtures/desktopIsolation.ts` → `launchIsolatedApp`, `ignoreDisplayPointer`, `createLaunchFateLog`: shared acquisition, initialization and teardown boundary.
- `e2e/fixtures/pairingArrival.ts` → `pairFromUnpairedLaunch`: normal Welcome click and pairing flow; its 25 executable callers keep the same contract.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`: registers app teardown only after acquisition returns; `skipPairing` permits launch observation without injecting a route.
- `e2e/fixtures/electronLaunch.ts` → `electron.launch`: approved Electron launcher and sandbox guard.
- `e2e/desktop-isolation.spec.ts` → display-pointer regression: existing cover inherits the same app's mouse-ignore listener.
- `e2e/launch-fate.spec.ts` → `withLaunch`, launch-fate assertions: cleanup accounting and secret-free attachment conventions.
- `src/main/windowPresentation.ts` → `selectWindowPresentation`: packaged builds always use normal presentation.
- `src/main/index.ts` → `createWindow`: initially hidden window, shown on first paint; shown windows retain background throttling.
- `docs/knowledge/features/e2e-harness.md` → Desktop isolation and launch-fate diagnostics: main-process liveness is not renderer progress.
- `docs/knowledge/features/development-verification.md` → Layout and input: use native window geometry and actual input checks.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`: process boundaries, test tiers and reading map.

## Context

The assigned failure in `verifier-gate_#1729_6.log` resolves the Welcome CTA and stalls in Playwright's visibility/enabled/stability wait for 30 seconds. The watched Electron process remains alive and closes cleanly. Its renderer progress and native window state were not recorded. A later, separately reproduced hover loss does not establish this launch failure's cause.

History: the initial Codex diagnosis left a clean branch and no plan because it did not confirm the cause. A subsequent manual intervention committed implementation `1fee300d` without a plan and opened PR #1836, explicitly disclaiming the Welcome failure. This document is retrospective for that intervention, and prospective for this rework. The missing original plan-before-code ordering cannot be repaired retroactively; branch history will not be rewritten.

Scope remains launch/readiness infrastructure. Normal Welcome → pairing → confirmation, toolbar assertions, timeouts and retries remain unchanged. No product presentation change is justified without a discriminating diagnosis. No ADR is proposed. The remote feature-branch overlap check found no overlap for the touched launch and regression files.

Sizing: one launch-infrastructure deliverable, three observable acceptance criteria, no new exported type/store/component, no consumer signature migration, under 500 written lines including this plan and regression tests, and fewer than ten error branches. This remains inside all builder ceilings.

## Design

`launchIsolatedApp(options): Promise<ElectronApplication>` retains its interface. After `electron.launch` succeeds, it owns the acquired app until initialization succeeds. An initialization rejection closes the app through `options.fate.closeWatched(app)` before rethrowing the original rejection. If close itself rejects, record the fixed `app` teardown label; do not replace or log the initialization error.

Unit regression uses the existing launcher seam with a fake acquired application. It distinguishes successful initialization, rejecting initialization followed by successful close, and rejecting initialization followed by rejecting close. The fake records the resource lifecycle rather than checking implementation text. Actual launch-fate recording remains the implementation used by these checks.

Replace the same-process cover in `desktop-isolation.spec.ts` with an independent Electron process whose window remains input-enabled. The cover uses a small scratch program under the OS temporary directory, a fresh profile, and the existing guarded `electron.launch` seam. It maps at `screen.getCursorScreenPoint()` and reports painting before the hovered renderer is inspected. Cover teardown and scratch removal run in `finally`. A same-window mutation (`setIgnoreMouseEvents(false)`) must lose hover while an identical independent cover is input-enabled; the protected arm must retain hover. The source launch-site guard recognizes this intentionally independent cover site explicitly.

Investigate the Welcome stall with controlled native window state and renderer frame/timer progress, compared with the retained actionability signature. Instrumentation and diagnostic scenarios stay under `/tmp/builder-1813/rework/`. A controlled mechanism producing the same signature is a candidate, not proof that the original occurrence used that mechanism. Only evidence distinguishing candidates justifies a causal fix.

## State + concurrency model

No application store or IPC changes. Each launched app retains its own user-data directory and fake transport resources. The launch function owns failure cleanup until it returns; callers own normal teardown after return. Independent covers share only the X display, matching the cross-worker input boundary. All cover processes and temporary directories are awaited and drained before the test finishes. Existing mouse-ignore listeners are process-lifetime listeners and disappear with the acquired app.

## Error handling

Initialization errors propagate unchanged after cleanup. Close failures add only `app` to the existing launch-fate report. No error text, argv, environment values, profile path, pairing payload or daemon text enters diagnostics. Controlled checks report only booleans, counts and fixed labels. Missing causal evidence leaves acceptance criterion 1 explicitly unresolved rather than claiming that green stress runs prove a cause.

## Testing strategy

- Test first: rejecting acquired-app initialization must close the child before rejection reaches its caller; mutation deleting cleanup must fail this check.
- Unit checks also prove original-error identity, settled exit bookkeeping, close-failure classification, and success leaving the child owned by the caller.
- Focused Playwright regression: independent input-enabled cover crosses the display pointer; unprotected hover loses its pill, protected hover retains it.
- Diagnostic controlled checks: native window visibility, responsive timers and animation frames distinguish a frame stall from renderer death or unstable geometry.
- Required acceptance after any justified fix: unchanged named toolbar test, 20 repetitions each at one and three workers, retries zero and no skips; full default fake-transport suite at three workers and zero retries, recording executed counts separately from skips.
- Final merge of main, pre-verify check and build. No live Claude tests are changed or required.

## Open Questions

1. What stopped Welcome actionability in the original failing launch? Unresolved at plan commit; retained log alone does not distinguish frame starvation from an unresponsive renderer.
2. Does an independent input-enabled cover preserve the actual cross-worker regression? Resolve by comparing protected and explicitly unprotected hovered windows with identical cover input behavior.

## Documentation handoff

Pending documentation stage: `docs/knowledge/features/e2e-harness.md` § Desktop isolation (default-tier launches): reconcile confirmed input and launch failure boundaries, platform/window presentation, controlled evidence and limitations; keep Welcome stalls distinct from post-pairing hover loss unless evidence connects them. Record final diagnostic lessons, exact repetition/full-suite counts and retained result locations.
