import { expect, _electron as electron, type ElectronApplication } from '@playwright/test'
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
// discards close errors unlogged for the same reason.
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
 */
export async function launchIsolatedApp(options: {
  args: string[]
  env: Record<string, string | undefined>
}): Promise<ElectronApplication> {
  return electron.launch({
    args: [...options.args, ...RENDERER_THROTTLING_SWITCHES.map((name) => `--${name}`)],
    env: { ...options.env, [HIDDEN_WINDOW_ENV_FLAG]: '1' }
  })
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
