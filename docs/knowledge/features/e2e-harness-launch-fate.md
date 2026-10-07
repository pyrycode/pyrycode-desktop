# E2E harness — launch-fate diagnostics

Launch liveness, exit reports and unconditional diagnostic attachments. See the [harness overview](e2e-harness.md).

## Launch-fate diagnostics

[#1127](https://github.com/pyrycode/pyrycode-desktop/issues/1127) closes a related gap: the tier reddens intermittently, a different spec each run, and no failure reproduces on demand — the harness knew the failing launch's exit code, signal, and liveness, and threw all three away. `launchIsolatedApp` now takes a required `fate: LaunchFateLog` (`createLaunchFateLog()`) and registers each launch itself — required, not optional, the `electronApp.ts` (#546) lesson applied early. `closeWatched(app)` replaces `app.close()` at both drain sites: liveness read before the close, exit code settled after, off a `ChildProcess` handle captured at `watch()` time (`ElectronApplication.process()` throws once `close()` tears its channel down). Each drain thunk carries a fixed-literal `TeardownStep` label; the catch stays bindingless — a close error can carry the launch argv, embedding `--user-data-dir=<path>` — so only the step name is recorded. `closeWatched` is the supported close path *for a teardown drain*, not the only way to ever close a watched app: `push-toggle-persist-relaunch.spec.ts` still closes launch 1 directly mid-test for its `SingletonLock` barrier, and the later drain's `closeWatched` on that app still reports honestly. As with #1067, no fails-on-main test for the flake itself — see `e2e/launch-fate.spec.ts`.

`attachLaunchFate` attaches the report **unconditionally**, whenever it is non-empty — not gated on the test's status. It originally returned early unless `sink.status` was in `{failed, timedOut, interrupted}`, and [#1202](https://github.com/pyrycode/pyrycode-desktop/issues/1202) found that gate is why the diagnostic didn't fire on the one red it was built for: both drain sites call `attachLaunchFate` from a *fixture epilogue*, where the test's status is not yet final. `TestInfoImpl.status` stays `'passed'` until Playwright calls `_failWithError`, and that can happen later than the epilogue in two ways this tier hits — a teardown that drains after `launchPairedApp`'s (a fixture set up before it tears down after it), and `WorkerMain.unhandledError` routing an `uncaughtException`/`unhandledRejection` to the still-open current test, which is the shape of a bare `socket hang up` with no in-spec stack frame on a worker that owns two fake sockets. Deferring the attach into a fixture that drains last would beat the first mechanism and still lose to the second, so the fix removes the status read rather than relocating it: `LaunchFateSink` narrowed from `Pick<TestInfo, 'status' | 'attach'>` to `Pick<TestInfo, 'attach'>`, so restoring the gate is a visible type edit, not a one-line condition slipped back in. The kept early return is for an empty report (no launches, no teardown failures), not for status.

Suppression on a green run did not disappear, it moved to where it was always actually enforced: Playwright's terminal reporter (`reporter: 'list'`) prints an attachment's body only from `formatFailure`, reached only for a result that carries errors, so a passing test's attachment exists in its result but is never printed — the `text/plain` content type (name not underscore-prefixed, truncated at 300 chars) is what makes it inline-readable when it is. Measured, not assumed: a green run leaves one *empty* `test-results/` directory per test that actually attaches (`TestInfo.attach` calls `outputPath()`, which `mkdirSync`s it), and Playwright wipes `test-results/` at the start of every run, so this is per-run litter with no growth. `e2e/launch-fate.spec.ts` drives the real `testInfo` throughout rather than the `recordingSink` double it used to use — that double supplied a constant `status`, substituting exactly the seam that turned out to be broken, so every one of its assertions could pass while a real red carried nothing.

### Welcome stall diagnostics

[`welcomeDiagnostics.ts`](../../../e2e/fixtures/welcomeDiagnostics.ts) adds
default-tier-only observation of the ordinary Welcome click through a temporary
page-keyed WeakMap registration. `withWelcomeDiagnostics` registers the observer;
`observeWelcomeClick` otherwise calls the click directly. `launchPairedApp`
supplies the ordinal remembered inside its launch-fate `watch` registration.
Reading the launch count later at pairing arrival would misattribute evidence
when launch setup overlaps. The shared three-argument pairing contract and real
tier callers remain unchanged; skipped pairing and reused paired profiles do not
observe a Welcome click.

Only a click pending after five seconds or rejecting earlier produces the fixed
`welcome-stall` attachment (`application/json`, inline body in Playwright JSON).
One capture is reused if a pending click later rejects. It records `launchIndex`,
fixed `trigger` (`pending` or `failed`), `captureMs`, native and renderer readings,
and cleanup status. Native readings contain each window's boolean visibility,
minimized state and focus plus numeric bounds. Renderer readings contain measured
`intervalMs`, frame and timer counts, and initial Welcome control presence,
enabled state and bounds when present. Reconstructing the primitive allowlist
drops extra fields: no DOM/text dump, field values, pairing codes, tokens, paths,
argv/environment values or raw errors enter the report.

Native and renderer reads start independently under a shared two-second capture
deadline. Renderer acquisition expires at 1800ms, reserving 200ms for cleanup;
sampling targets 750ms and stops earlier on click settlement. Only measured
intervals up to 1000ms are admitted. A successful validated reading has
`status: available` and a value. Missing/malformed,
rejected, expired or aborted reads use `unavailable`, `failed`, `timed-out` or
`cancelled` with no value. Renderer nonresponse does not discard readable native
evidence. Zero frame/timer counts mean sampled zero progress only when the
renderer reading is available.

Cancelling just the acquisition waiter can release the pairing tail while a
queued renderer install still exists. Keep acquisition ownership until response
or expiry; the install checks the same deadline before creating any callbacks.
Click settlement cancels the trigger/sample waits and requests stop/snapshot and
handle disposal before pairing resumes. The renderer owns one frame chain and
one timer chain with self-expiry; its stop clears both and the expiry timer.
A responsive late handle is stopped/disposed within the capture budget; an
expired late handle receives bounded best-effort stop/disposal. The WeakMap
registration and Node abort listeners/timers are removed in `finally`.
Attachment has a separate 200ms best-effort bound after capture. Probe,
attachment and cleanup failures preserve the identical original click error and
the fixture's existing teardown drain. Fast success creates no probes/output,
adds no diagnostic wait and leaves no observer behind.

[`welcomeDiagnostics.test.ts`](../../../e2e/fixtures/welcomeDiagnostics.test.ts)
checks delayed/early triggers, bounded nonresponse, advancing timers with zero
frames, original-error identity, allowlisting, late acquisition ownership,
expired queued installs and actual callback cleanup using fake timers.
[`welcome-stall.spec.ts`](../../../e2e/welcome-stall.spec.ts) disables the real
Welcome button and suppresses frame callbacks while timers run. It checks the
attachment through actual Playwright `TestInfo` before explicitly closing that
Electron app, then launches normally again. Closing only the last page is not
portable: macOS keeps the process alive on `window-all-closed`. Post-teardown
checks require launch-fate ordinals, two clean exits and no teardown failures;
the second launch adds no stall attachment.

### Recorded Welcome diagnostic acceptance

The [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1859#issuecomment-6038410039)
records the following revision-separated evidence on 2026-10-07. Full default
fake-transport runs used three actual workers and retries zero. Builder runs
used Linux x64, Electron 33.4.11 and shown 1100×800 Xvfb windows with
native-pointer protection.

| Run | Revision | Executed / passed / failed / skipped | Retained result |
| --- | --- | --- | --- |
| Builder full default gate | `e432236bf1aa2457d0c697639ae163a5cd7911be` | 336 / 336 / 0 / 4 | `/tmp/builder-1842/full-default.json` |
| Builder final focused fixture | `ef7db90ea5556543a23d5b8e5cf6a0281d5b36a4` | 1 / 1 / 0 / 0 | `/tmp/builder-1842/focused.json` |
| Dispatcher verifier gate 6, `npx playwright test --reporter=json` | `ef7db90ea5556543a23d5b8e5cf6a0281d5b36a4` | 336 / 336 / 0 / 4 | `/work/Projects/pyrycode-desktop-agents/logs/verifier-gate_#1842_6.log` |

The builder full gate preceded the test-only macOS app-close correction; the
dispatcher full gate covers that final fixture revision. The four full-run skips
are existing platform checks, not passes. Builder log/results remain at
`/tmp/builder-1842/full-default.log` and `full-default-results/` in that directory;
`validation-summary.json` records revision/platform/counts. The dispatcher
revision record is `verifier-gate_#1842.pass.json` beside its gate log. These paths
record supplied retained evidence, not committed artifacts or new docs-stage runs.

The named test, `a controlled real Welcome stall retains progress evidence before
teardown and correlates multiple launches`, was present, executed and passed in
the final dispatcher run, as explicitly confirmed by the verdict. Its attachment
for launch 1 recorded available native state and disabled Welcome bounds,
0 frames / 14 timers over 750.7ms, a 771ms capture and available cleanup.
Launch-fate recorded two clean exits and no teardown failures; the normal second
launch added no stall attachment. The verdict also confirms all 11 diagnostic
unit regressions passed in the unit run: 9,354 executed/passed, 0 failed, 3 skipped.

No naturally occurring Welcome stall was captured; every retained stall
attachment belongs to the controlled regression. Controlled faults establish
diagnostic behavior only. Native macOS execution and actual OS-minimized behavior
were not exercised, and no live-Claude acceptance was required. Retain the first
natural failure's evidence before a follow-up claims a confirmed cause and fixes
its boundary; see [the separate readiness boundary](e2e-harness-desktop-isolation.md#separate-welcome-readiness-boundary).

### Initialization ownership

`launchIsolatedApp` watches the acquired Electron app before shown-window
[display-pointer initialization](e2e-harness-desktop-isolation.md#native-display-pointer-protection).
Until that initialization returns successfully, the launch helper owns cleanup:
callers cannot register teardown for a handle they have not received. On rejection
it awaits `fate.closeWatched(app)` before propagating the original error unchanged.
A rejecting close records only the fixed `app` teardown label and still preserves
the initialization error. Neither error's text enters the diagnostic attachment.
After successful return the caller owns ordinary teardown.

[`desktopIsolation.test.ts`](../../../e2e/fixtures/desktopIsolation.test.ts) uses
the existing launcher seam and real launch-fate log. Its deferred fake close keeps
the child alive and the returned promise unsettled until close is released,
proving ordering rather than merely counting calls. It also checks original-error
identity, settled exit bookkeeping, success leaving the child running for its
caller, and close-failure classification without private error contents.
