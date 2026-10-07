# Welcome actionability diagnostic evidence

## Files read
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`: owns default-tier launch ordering, pairing and teardown.
- `e2e/fixtures/pairingArrival.ts` → `pairFromUnpairedLaunch`: shared normal Welcome click; preserve its three-argument contract and all callers.
- `e2e/fixtures/desktopIsolation.ts` → `launchIsolatedApp`, `createLaunchFateLog`, `attachLaunchFate`: native-pointer protection, initialization cleanup and launch-ordered evidence remain unchanged.
- `e2e/launch-fate.spec.ts` → attachment tests: use actual Playwright `TestInfo`, not just a sink double.
- `e2e/fixtures/desktopIsolation.test.ts` → acquisition tests: existing fake launcher and awaited cleanup patterns.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/e2e-harness-desktop-isolation.md` → Separate Welcome readiness boundary: frames and renderer responsiveness were absent from the original failure; green runs establish no cause.
- `docs/knowledge/features/e2e-harness-launch-fate.md` → Launch-fate diagnostics: attach independently of provisional test status; serialize primitives only.
- `docs/knowledge/features/development-verification.md` → Layout and input: shared-display pointer findings concern a different boundary.
- `playwright.config.ts`, `vitest.config.ts`, `package.json`: suffix-separated tests, full default gate with three workers and explicit retries zero.

## Context
The unresolved Welcome actionability stall has only process-fate evidence. Capture a bounded observation when it next happens, without changing actionability or claiming a cause. One independently checkable deliverable: diagnostic capture and its regression proof. No overlapping remote feature branches touch these files. Estimate: approximately 600 written lines including tests and plan, zero new exported types, one updated consumer, five observable acceptance criteria, fewer than ten classified failure branches. The #1067 analogue actually inserted 400 lines including tests and plan.

## Design
Add plain `e2e/fixtures/welcomeDiagnostics.ts`. `withWelcomeDiagnostics(page, app, sink, launchIndex, run)` temporarily registers a page-specific observer in a WeakMap. `observeWelcomeClick(page, click)` executes an ordinary click directly unless that registration exists. The shared arrival helper changes only its Welcome click wrapping; its public contract and 25 consumers are preserved.

The default fixture wraps only its first pairing arrival, supplying a one-based index from the existing launch-fate log. Emit fixed-name `welcome-stall` JSON attachment on a five-second pending trigger or an earlier click rejection. Capture native window visibility, minimized state, focus and numeric bounds independently of renderer response. Capture renderer response status, initial Welcome control presence/enabled/bounds and frame/timer counts with measured interval. Explicit unavailable statuses replace missing readings; zero counts are meaningful only for a successful sampled response. Reports reconstruct allowlisted primitives rather than serializing probe objects or errors.

## State + concurrency model
No product state or listeners change. One Node trigger timer per observed click; no probes on fast success. A triggered capture runs native and renderer reads concurrently with a shared two-second deadline. Renderer sampling lasts at most 750ms, owns one animation-frame callback and one timer chain, and self-expires; the acquired renderer handle exposes a stop-and-snapshot operation. Click settlement cancels Node sampling and requests renderer cleanup before pairing continues. Deadline guards prevent a queued late install from starting an observer. Dispose acquired handles; bound cleanup and tolerate unavailable renderer cleanup. Remove the WeakMap registration in `finally`, including failure. Early failure captures before rethrowing the identical click error; an already triggered capture is reused rather than repeated.

## Error handling
Classify probe outcomes with fixed statuses: available, unavailable, failed, timed-out or cancelled. Preserve native data when renderer probing stalls. Bindingless diagnostic catches never serialize raw error text. Probe, attachment and cleanup failures never replace the original click failure or stop the fixture's existing LIFO drain. Preserve the default 30-second click actionability timeout, retry policy and real pointer input.

## Testing strategy
- Vitest fake timers: no probes/output/timers on fast success; trigger only after five seconds; early failure capture and original error identity; nonresponsive renderer bounded within two seconds with readable native evidence; timers advance with zero frames; cancellation, late response cleanup and failed cleanup/attachment preserve the outcome; secret-bearing extra fields/errors are excluded.
- A fake-transport Playwright fixture regression disables the real Welcome control, lets its ordinary click remain pending, then closes the page after capture. Inspect actual `TestInfo` attachment before fixture teardown and correlate it to launch-fate afterwards. A second successful launch in the same test checks correlation and normal pairing.
- Pre-verify and build after final main merge. Run the focused spec then the full default Playwright gate with three workers, retries zero, retained JSON/log/results under `/tmp/builder-1842/`. Record revision, Linux shown-window presentation and executed/pass/fail/skip counts in the PR. No real-Claude tests required.
- Report whether any natural stall was captured; controlled failures prove instrumentation only. A confirmed-cause investigation/fix belongs to a follow-up after natural failure evidence exists.

## Open Questions
None. Keep the report compact and attachment failures best-effort; no readiness wait, causal fix or documentation edits are required.

## Revisions
2026-10-07: Remember the launch-fate ordinal inside its `watch` registration, rather than reading the count at pairing arrival. Concurrent launch setup could otherwise change the count before pairing starts. The fixture regression closes the stalled page after capture, which also exits that launch; its fate correctly records not-running at teardown, while the second normal launch records running. Both must exit cleanly with no teardown failures.

2026-10-07: Review found that cancelling the acquisition wait could let a queued renderer install arrive after the pairing tail resumed. Retain bounded acquisition ownership until it responds or expires, and give the renderer install the same 1800ms acquisition deadline, reserving 200ms for cleanup inside the two-second capture. An install executing after that deadline returns without creating callbacks. A late responsive handle is stopped/disposed before pairing resumes; an expired late handle receives best-effort disposal. Clear the trigger timer immediately on rejection. Regressions exercise ownership and the actual queued-install deadline guard.

2026-10-07: The controlled fixture now explicitly closes the stalled Electron app after capture rather than its last page. `app.on('window-all-closed')` keeps macOS running, so only explicit app close guarantees the regression's clean first exit on every platform. Diagnostics and normal pairing remain unchanged. Full default gate at `e432236b`: 336 executed/passed, zero failed, four existing platform skips, three workers/retries zero. Run the focused fixture and closing checks again for this test-only portability adjustment; retain the full gate's exact revision separately.
