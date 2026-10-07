# E2E harness — launch-fate diagnostics

Launch liveness, exit reports and unconditional diagnostic attachments. See the [harness overview](e2e-harness.md).

## Launch-fate diagnostics

[#1127](https://github.com/pyrycode/pyrycode-desktop/issues/1127) closes a related gap: the tier reddens intermittently, a different spec each run, and no failure reproduces on demand — the harness knew the failing launch's exit code, signal, and liveness, and threw all three away. `launchIsolatedApp` now takes a required `fate: LaunchFateLog` (`createLaunchFateLog()`) and registers each launch itself — required, not optional, the `electronApp.ts` (#546) lesson applied early. `closeWatched(app)` replaces `app.close()` at both drain sites: liveness read before the close, exit code settled after, off a `ChildProcess` handle captured at `watch()` time (`ElectronApplication.process()` throws once `close()` tears its channel down). Each drain thunk carries a fixed-literal `TeardownStep` label; the catch stays bindingless — a close error can carry the launch argv, embedding `--user-data-dir=<path>` — so only the step name is recorded. `closeWatched` is the supported close path *for a teardown drain*, not the only way to ever close a watched app: `push-toggle-persist-relaunch.spec.ts` still closes launch 1 directly mid-test for its `SingletonLock` barrier, and the later drain's `closeWatched` on that app still reports honestly. As with #1067, no fails-on-main test for the flake itself — see `e2e/launch-fate.spec.ts`.

`attachLaunchFate` attaches the report **unconditionally**, whenever it is non-empty — not gated on the test's status. It originally returned early unless `sink.status` was in `{failed, timedOut, interrupted}`, and [#1202](https://github.com/pyrycode/pyrycode-desktop/issues/1202) found that gate is why the diagnostic didn't fire on the one red it was built for: both drain sites call `attachLaunchFate` from a *fixture epilogue*, where the test's status is not yet final. `TestInfoImpl.status` stays `'passed'` until Playwright calls `_failWithError`, and that can happen later than the epilogue in two ways this tier hits — a teardown that drains after `launchPairedApp`'s (a fixture set up before it tears down after it), and `WorkerMain.unhandledError` routing an `uncaughtException`/`unhandledRejection` to the still-open current test, which is the shape of a bare `socket hang up` with no in-spec stack frame on a worker that owns two fake sockets. Deferring the attach into a fixture that drains last would beat the first mechanism and still lose to the second, so the fix removes the status read rather than relocating it: `LaunchFateSink` narrowed from `Pick<TestInfo, 'status' | 'attach'>` to `Pick<TestInfo, 'attach'>`, so restoring the gate is a visible type edit, not a one-line condition slipped back in. The kept early return is for an empty report (no launches, no teardown failures), not for status.

Suppression on a green run did not disappear, it moved to where it was always actually enforced: Playwright's terminal reporter (`reporter: 'list'`) prints an attachment's body only from `formatFailure`, reached only for a result that carries errors, so a passing test's attachment exists in its result but is never printed — the `text/plain` content type (name not underscore-prefixed, truncated at 300 chars) is what makes it inline-readable when it is. Measured, not assumed: a green run leaves one *empty* `test-results/` directory per test that actually attaches (`TestInfo.attach` calls `outputPath()`, which `mkdirSync`s it), and Playwright wipes `test-results/` at the start of every run, so this is per-run litter with no growth. `e2e/launch-fate.spec.ts` drives the real `testInfo` throughout rather than the `recordingSink` double it used to use — that double supplied a constant `status`, substituting exactly the seam that turned out to be broken, so every one of its assertions could pass while a real red carried nothing.

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
