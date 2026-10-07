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

Satisfied in [Desktop isolation](../../knowledge/features/e2e-harness.md#desktop-isolation-default-tier-launches) and its [owning topic](../../knowledge/features/e2e-harness-desktop-isolation.md): confirmed input and launch failure boundaries, platform/window presentation, controlled evidence and limitations, final diagnostic lessons, exact repetition/full-suite counts and retained result locations. Welcome readiness remains separate under #1842. [Launch-fate diagnostics](../../knowledge/features/e2e-harness-launch-fate.md#initialization-ownership) records acquisition cleanup; [Layout and input](../../knowledge/features/development-verification.md#layout-and-input) records the independent-process regression boundary.

## Revisions

2026-10-07 — Accepted scope: the [maintainer's rescope](https://github.com/pyrycode/pyrycode-desktop/issues/1813#issuecomment-6030925132) assigns this ticket the confirmed shared-display pointer cause and moves the original Welcome actionability stall to [#1842](https://github.com/pyrycode/pyrycode-desktop/issues/1842). The unresolved Welcome question and earlier rejection above remain historical investigation, not a requirement that the accepted pointer fix claims to satisfy. The [final verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/1836#issuecomment-6031117734) confirms the independent-cover mutation, both named-test repetition runs and final counted full-suite evidence. Documentation handoff is recorded in the [desktop-isolation topic](../../knowledge/features/e2e-harness-desktop-isolation.md), its harness overview, launch-fate ownership guidance and development-verification input guidance.

2026-10-07 — Findings 3 and 4: initialization failure now awaits launch-fate close before propagating the original error, including the close-failure classification. A deferred fake close proves the ordering rather than only counting calls. The independent-cover regression raises its two controlled windows above unrelated shared-display launches; without that, other mapped windows prevented its negative control from receiving the intended crossing. It preserves protection supplied by launch in its positive arm and explicitly removes it only in the negative arm. Removing the initial `BrowserWindow.getAllWindows()` treatment made the positive arm fail with `{ hovered: false, displayPointerExits: 1 }`; the restored test passed five repetitions with zero failures or skips. Evidence: `/tmp/builder-1813/rework/cover-no-initial-protection.log` and `cover-top-five.json`. This resolves Open Question 2. The documentation-only final-main conflict was resolved by retaining both branches' paragraphs unchanged.

2026-10-07 — Finding 1 remains unresolved. Controlled shown/hidden/minimize-request/unthrottled checks with the existing Chromium switches all returned ten animation frames, a responsive timer, an enabled Welcome CTA and visible document state. Xvfb did not actually minimize the window (`isMinimized()` remained false), so that request is not evidence for minimized behavior. The original retained failure has no renderer/frame/window sample and no repeated unstable-element retries. These checks disprove neither renderer unresponsiveness nor an intermittent frame stall in that occurrence and justify no causal readiness fix. Evidence: `/tmp/builder-1813/rework/window-states.log`. Open Question 1 remains explicitly open.

2026-10-07 — Additional focused test typechecking found the pre-existing `launchIsolatedApp` environment contract (`Record<string, string | undefined>`) differs from Playwright's string-only launch environment type. The changed independent cover filters undefined environment entries and its fake attachment sink is fully typed. The pre-existing shared launch mismatch is unchanged; the application's required tsconfigs do not include `e2e/`. This auxiliary check is not claimed green.

2026-10-07 — Final-main validation exposed an asynchronous native-input readiness race in the negative control: Electron's map/raise returns before X delivers pointer entry. Before injecting the CDP hover, the unprotected arm now observes a native `pointerover` at the display pointer's expected content coordinates, re-delivering native positioning while polling. The protected arm still relies only on launch-applied protection. This strengthens the controlled boundary without changing the assigned toolbar assertions or input policy. The manual intervention's branch-only knowledge paragraph was removed after combining it with new main documentation exceeded the overview cap; all main prose is preserved and this ticket's documentation remains pending for its owning stage.

2026-10-07 — Final regression contract: concurrent unprotected negative controls themselves compete for the display's single native pointer (5/10 failed under three workers). Removed that extra committed arm and its native-entry polling. The regression now tests only launch-applied protection against an independent input-enabled cover; its unprotected control is the explicit single-worker deletion mutation, which must report native pointer exit and lost hover. This avoids creating a second global input harness or weakening the product assertions. Earlier native-entry design above is superseded.
