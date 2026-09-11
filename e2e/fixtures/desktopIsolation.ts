import { expect, type ElectronApplication, type TestInfo } from '@playwright/test'
import { electron } from './electronLaunch'
import type { ChildProcess } from 'node:child_process'
import { HIDDEN_WINDOW_ENV_FLAG } from '../../src/main/windowPresentation'

// The one place the default tier launches Electron (#1067). Both launch sites — `launchPairedApp.ts`
// (48 of the 49 spec files) and `smoke.spec.ts` (the 49th) — go through `launchIsolatedApp` below, so
// the isolation cannot be applied at one and forgotten at the other.
//
// WHY THIS EXISTS. The tier reddened one spec per run, a different one each run, always at
// `pairFromUnpairedLaunch`'s fingerprint-card wait. That step is pure synchronous work — pairing IPC →
// parsePairingPayload → prepare's BLAKE2s hash, no socket and no handshake — so a 5000 ms miss means the
// renderer was STOPPED, not that the step was slow. Every launch used to show and focus a window, 49
// times per `workers: 1` run, and Chromium backgrounds and throttles a renderer whose window is occluded
// or unfocused. An operator using their own machine while a run is in progress is therefore enough to
// stall one, and a shown window additionally accepts their real keystrokes and clicks.
//
// TWO LEVERS, AND NEITHER IS SUFFICIENT ALONE. Not showing the window keeps the operator out of it, but a
// hidden window IS an occluded window, so on its own it earns exactly the throttling this module exists
// to remove. The throttling opt-outs on their own leave every launch stealing focus. So the switches
// below are applied here and the never-show is applied by the main process behind
// HIDDEN_WINDOW_ENV_FLAG, whose hidden branch also sets `backgroundThrottling: false` — the only lever
// that keeps the Page Visibility API reporting visible, which is what Playwright's own rAF-based
// stability check depends on.
//
// A PLAIN, SIDE-EFFECT-FREE module, not a Playwright fixture — the `pairingArrival.ts` /
// `conversationStateFake.ts` convention. It calls no `base.extend`, so it drags no second fixture
// extension into a spec that already has one, which is what lets both launch sites import it.
//
// SECRET HYGIENE. `args` and `env` both carry `--user-data-dir=<path>` — the directory every persisted
// secret of the run lands in. Nothing here logs, prints, or attaches either to the report, and the
// read-back below deliberately returns `hasSwitch` booleans and integer counts rather than
// `process.argv`, which would carry that path straight into a failure diff. `smoke.spec.ts` already
// discards close errors unlogged for the same reason. The launch-fate report at the bottom of this file
// is held to the SAME contract, by construction rather than by care — see its own note.
//
// `e2e/fixtures/realDaemon.ts` keeps its own launch and is deliberately NOT a caller: the `real-*` tier
// is operator-supervised by nature, and routing it through here would put a change that can be proven
// without a live daemon behind a live gate. It is the one exemption the launch-site guard in
// `desktop-isolation.spec.ts` allows.

/**
 * The Chromium switches that exempt the launched renderer from being slowed down when its window is not
 * the operator's foreground one. Stored as BARE names (no `--`), which is the single source for both
 * halves of the contract: `launchIsolatedApp` derives the `--<name>` argv entries, and
 * `readDesktopIsolation` asks Chromium's own parsed command line for the same names. A switch added or
 * dropped here moves both at once, so the read-back can never drift into proving something the launch no
 * longer applies.
 */
export const RENDERER_THROTTLING_SWITCHES = [
  'disable-renderer-backgrounding',
  'disable-backgrounding-occluded-windows',
  'disable-background-timer-throttling'
] as const

/** What the launched app reports about its own isolation. Counts and booleans only — never a path. */
export type DesktopIsolationState = {
  /** The subset of RENDERER_THROTTLING_SWITCHES that Chromium actually parsed off this launch's argv. */
  switchesApplied: string[]
  /** How many windows exist. Read so a launch with NO window cannot pass the visibility check vacuously. */
  windows: number
  /** How many of them are visible. The whole point: zero, for the entire life of the launch. */
  visibleWindows: number
}

/**
 * Launch the built app with the desktop isolation applied. A drop-in for `electron.launch` at both
 * default-tier sites: the caller keeps owning its own `args` (`'.'` plus its per-run `--user-data-dir`)
 * and its own `env` (with `ELECTRON_RENDERER_URL` stripped, plus any scenario flags), and this adds only
 * what every default-tier launch needs.
 *
 * The switches are APPENDED, so `'.'` stays the first non-switch argument — the app path — exactly as
 * `--user-data-dir` is appended today. The env flag is set on a COPY, so a caller's object is never
 * mutated.
 *
 * `fate` is REQUIRED, not optional (#1127). `e2e/` is outside both tsconfigs and Playwright strips types
 * with esbuild, so a type alone guarantees nothing at run time — but a required option that a site
 * forgets makes `watch` throw at that site's first launch, loudly, instead of silently recording nothing.
 * That is the failure mode that killed `electronApp.ts` (#546, optional → zero importers → deleted) and
 * that #1067 needed a source guard to close. Registration happens HERE, at the one chokepoint, so a
 * launch that reaches Electron is a launch whose fate is being tracked.
 */
export async function launchIsolatedApp(options: {
  args: string[]
  env: Record<string, string | undefined>
  fate: LaunchFateLog
}): Promise<ElectronApplication> {
  const app = await electron.launch({
    args: [...options.args, ...RENDERER_THROTTLING_SWITCHES.map((name) => `--${name}`)],
    env: { ...options.env, [HIDDEN_WINDOW_ENV_FLAG]: '1' }
  })
  options.fate.watch(app)
  return app
}

/**
 * Read the isolation back FROM INSIDE the launched app, which is the only reading that proves anything:
 * `app.commandLine.hasSwitch` is Chromium's own parsed view of the command line it was started with, and
 * `isVisible()` is the window's actual state — neither is the fixture repeating a string it wrote, and
 * neither can be satisfied by source text that merely looks right.
 */
export async function readDesktopIsolation(
  app: ElectronApplication
): Promise<DesktopIsolationState> {
  return app.evaluate(({ app: electronApp, BrowserWindow }, switches) => {
    const windows = BrowserWindow.getAllWindows()
    return {
      switchesApplied: switches.filter((name) => electronApp.commandLine.hasSwitch(name)),
      windows: windows.length,
      visibleWindows: windows.filter((window) => window.isVisible()).length
    }
  }, [...RENDERER_THROTTLING_SWITCHES])
}

/**
 * Assert the launch is isolated. Dropping the isolation from `launchIsolatedApp` — or from the main
 * process's hidden branch — reddens every spec that calls this.
 *
 * The `windows > 0` clause is not decoration: `visibleWindows === 0` is trivially true of a launch with
 * no window at all, so without it a regression that lost the window entirely would read as a pass.
 */
export async function expectDesktopIsolated(app: ElectronApplication): Promise<void> {
  const state = await readDesktopIsolation(app)
  expect(state.switchesApplied).toEqual([...RENDERER_THROTTLING_SWITCHES])
  expect(state.windows).toBeGreaterThan(0)
  expect(state.visibleWindows).toBe(0)
}

// --- Launch fate (#1127) ------------------------------------------------------------------------
//
// The tier reddens intermittently, on a different spec each run, and once on an untouched merge-base.
// #1067 already spent one guess at a flake of this shape and fixed a real cause; these failures are
// post-#1067 with different signatures, so guessing again is the move that has already been made. What
// is shippable instead is the observation that the harness ALREADY KNOWS things about a failing launch
// and throws them all away: nothing reads the Electron process's exit code or terminating signal (so
// `socket hang up` cannot be told from an OOM kill, a crash, or a clean early exit), nothing records
// whether it was still alive when the test failed (so a 1.0m timeout cannot be told from "app dead" vs
// "app alive but wedged"), and every teardown failure is swallowed by a bare `catch {}` (so an
// `app.close()` that failed — which under `workers: 1` leaks a process into the next spec's launch —
// leaves no trace).
//
// This does not fix the flake. It makes the next occurrence readable off a single failing run.
//
// SECRET HYGIENE, by construction rather than by care. Three independent structural guarantees, because
// the launch argv embeds `--user-data-dir=<path>` — the run's secret store — and an Electron close error
// can carry that argv:
//   1. The report is built from PRIMITIVES ONLY. Booleans, integers, null, and a POSIX signal name out
//      of Node's closed `NodeJS.Signals` set. No path, argv entry, or env value is in scope where the
//      body is serialized.
//   2. Every `catch` at every call site stays BINDINGLESS. The error object is not reachable from the
//      recording code, which is why the report names the STEP and never the message.
//   3. `TeardownStep` is a closed union of fixed literals, so the only strings that can reach the body
//      are ones written in this repo's source.

/** The attachment name a failing test carries. Fixed: the operator greps for it, and a name beginning
 *  with `_` would be skipped by Playwright's reporter entirely. */
export const LAUNCH_FATE_ATTACHMENT = 'launch-fate'

/** How long `closeWatched` waits, after `app.close()` resolves, for Node to record the child's exit.
 *  Normally a no-op — `close()` already waits for the app to go away — but a `null` exit code that means
 *  "not recorded yet" would read as "never exited", and a misleading diagnostic is worse than none. */
const EXIT_SETTLE_TIMEOUT_MS = 2_000

/** The teardown steps a drain can fail at, as fixed literals. Adding a resource to a site's drain adds
 *  its label here — which is the point: no free-form string can reach the report. */
export type TeardownStep =
  | 'app'
  | 'daemon'
  | 'forwarder'
  | 'daemon-2'
  | 'forwarder-2'
  | 'user-data-dir'

/** What the harness knows about one launched Electron process once the test is over. */
export type LaunchFate = {
  /** Was it still running when its close was requested — i.e. at the test's outcome? `null` means its
   *  close was never reached at all, which is itself diagnostic: the drain did not get here. */
  runningAtOutcome: boolean | null
  /** Node's record of the exit code once the drain has run; `null` if it never exited. */
  exitCode: number | null
  /** The signal that terminated it (a POSIX name from Node's closed set); `null` if none did. */
  signal: string | null
}

export type LaunchFateReport = {
  /** One entry per launch, in launch order — a test may launch twice (the relaunch-persistence spec). */
  launches: LaunchFate[]
  /** The steps that threw, in drain order. Never an error message. */
  teardownFailures: TeardownStep[]
}

/** The per-test log. A VALUE the caller creates and owns — this module stays plain and side-effect-free,
 *  so nothing is module-scoped and no state can cross tests. */
export type LaunchFateLog = {
  /** Register a launch. Called by `launchIsolatedApp`; a site never calls this itself. */
  watch(app: ElectronApplication): void
  /**
   * Close a watched app. The ONLY supported way to close one, and the reason there is no separate
   * `observe()` step: AC1's three facts have a strict ordering — liveness must be read before the close,
   * and the exit code only settles after it — and a separate call is one a future edit can move or drop
   * with nothing to notice. Folding the ordering into the call that replaces `app.close()` puts it where
   * a site already wrote one line.
   *
   * PROPAGATES a close failure, so a site's existing `try { … } catch { … }` shape is unchanged and the
   * recording stays uniform across all four drain steps.
   */
  closeWatched(app: ElectronApplication): Promise<void>
  /** Name a teardown step that threw. The body a bindingless `catch` gains. */
  recordTeardownFailure(step: TeardownStep): void
  /** The report, read after the drain. */
  report(): LaunchFateReport
}

/** The slice of `TestInfo` the attach needs: the sink to write to, and nothing else. A `Pick` rather
 *  than the whole interface so the type states exactly what the function touches.
 *
 *  It used to carry `status` too, and dropping it is the structural half of #1202's fix — restoring the
 *  outcome gate means putting `status` back on this type, which is a visible edit rather than a one-line
 *  condition slipped back into the body. */
export type LaunchFateSink = Pick<TestInfo, 'attach'>

/**
 * Node's own bookkeeping, not a `process.kill(pid, 0)` probe: `app.process()` already exposes both
 * fields, they are the same object the exit code and signal come from (so the triple is one consistent
 * snapshot), and it costs no pid and no syscall. Its one weakness — a process that died microseconds
 * ago whose `'exit'` has not been delivered — is self-correcting for a reader, because the post-drain
 * exit code and signal then contradict the liveness. `fixture-teardown-leak.spec.ts`'s `isAlive` probe
 * is deliberately not reused: it answers a different question (did teardown reap a pid) in a spec this
 * ticket does not touch.
 */
function isRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null
}

/** Wait for Node to record the child's exit, bounded. Returns immediately when it already has. Owns one
 *  listener and one timer and clears both on whichever settles first, so it leaves neither behind. */
function settleExit(child: ChildProcess): Promise<void> {
  if (!isRunning(child)) return Promise.resolve()
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      child.off('exit', done)
      resolve()
    }
    const timer = setTimeout(done, EXIT_SETTLE_TIMEOUT_MS)
    child.once('exit', done)
  })
}

export function createLaunchFateLog(): LaunchFateLog {
  // Keyed by app identity so two launches in one test each get their own fate, rather than the second
  // stamping the first. A Map preserves insertion order, which is what makes `launches` launch-ordered.
  //
  // The `ChildProcess` is captured HERE, at watch time, and never re-read off the app afterwards:
  // `ElectronApplication.process()` reaches through a channel object that `close()` tears down, so a
  // lazy read after the close throws `Cannot read properties of undefined (reading '_object')`. The
  // handle itself stays valid and keeps reporting `exitCode`/`signalCode` long after the app is gone,
  // which is the whole reason the exit code is readable at all.
  const watched = new Map<
    ElectronApplication,
    { child: ChildProcess; runningAtOutcome: boolean | null }
  >()
  const teardownFailures: TeardownStep[] = []

  return {
    watch(app) {
      watched.set(app, { child: app.process(), runningAtOutcome: null })
    },
    async closeWatched(app) {
      const record = watched.get(app)
      if (record !== undefined) record.runningAtOutcome = isRunning(record.child)
      await app.close()
      if (record !== undefined) await settleExit(record.child)
    },
    recordTeardownFailure(step) {
      teardownFailures.push(step)
    },
    report() {
      return {
        launches: [...watched.values()].map((record) => ({
          runningAtOutcome: record.runningAtOutcome,
          exitCode: record.child.exitCode,
          signal: record.child.signalCode
        })),
        teardownFailures: [...teardownFailures]
      }
    }
  }
}

/**
 * Attach the report. UNCONDITIONALLY, whenever there is one — this function does not decide whether an
 * operator sees it, the reporter does.
 *
 * #1202: it used to return early unless `sink.status` was in the failure set, and that gate is why the
 * diagnostic did not fire on the one red it was built for (`question-picks.spec.ts`, a bare
 * `socket hang up` on PR #1195). Both drain sites call this from a fixture epilogue, and a test's status
 * is NOT final there. `TestInfoImpl.status` is `'passed'` until `_failWithError` runs, and Playwright
 * runs that later than the epilogue in two ways this tier hits: a teardown that drains after
 * `launchPairedApp`'s — a fixture set up before it tears down after it — and `WorkerMain.unhandledError`,
 * which routes an `uncaughtException`/`unhandledRejection` to the still-open current test, the shape of
 * a bare `socket hang up` with no in-spec stack frame on a worker that owns two fake sockets. Both were
 * reproduced against `main` before this changed. Nothing readable at epilogue time IS the final status,
 * so the code stopped reading it: deferring the attach into a fixture that drains last would beat the
 * first way and still lose to the second.
 *
 * A GREEN RUN'S TERMINAL OUTPUT IS UNCHANGED, because the suppression moved rather than vanished.
 * Playwright's terminal reporter prints an attachment only from `formatFailure`, which is reached only
 * for a result that carries errors — so a passing test's attachment exists in its result and is never
 * printed. What a green run now carries that it did not before is one unprinted attachment per test.
 *
 * `text/plain` is not cosmetic either: the reporter prints a body inline only when the content type
 * starts with `text/` and the name does not begin with `_`, and it truncates at 300 characters. An
 * `application/json` body would be silently invisible in the `reporter: 'list'` output the operator
 * actually reads. The report's size is bounded by construction — three primitives per launch plus fixed
 * labels.
 *
 * Writes no file (`attach`'s `body` form is held in memory, and is mutually exclusive with `path`), so
 * calling it from a teardown epilogue does not reintroduce #517's hazard of a throwing `finally`
 * replacing the causal error.
 */
export async function attachLaunchFate(sink: LaunchFateSink, log: LaunchFateLog): Promise<void> {
  const report = log.report()
  // NOT a status gate: it keeps a site that never launched and never recorded a teardown failure from
  // attaching an empty object. A launch that reached Electron makes `launches` non-empty, so any drain
  // with something to say still reports.
  if (report.launches.length === 0 && report.teardownFailures.length === 0) return

  await sink.attach(LAUNCH_FATE_ATTACHMENT, {
    body: JSON.stringify(report),
    contentType: 'text/plain'
  })
}
