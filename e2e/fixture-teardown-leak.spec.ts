import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import { withIsolatedElectronApp } from './fixtures/realDaemon'

// #517 — the leak regression. Before this ticket the `page` fixture in realDaemon.ts (and the
// structurally identical local fixtures in smoke.spec.ts) registered teardown only AFTER `await use(...)`,
// so anything that threw between "app launched" and "use returned" made the cleanup lines unreachable:
// the Electron process AND its `mkdtemp --user-data-dir` — which is where the persisted pairing record
// lands — both leaked, for the whole remaining run (`workers: 1`).
//
// The test drives the REAL converted setup path (withIsolatedElectronApp, the extracted fixture body),
// not a re-transcription of it, and forces a failure after launch. Driving the function directly rather
// than nesting a Playwright run sidesteps the cross-project lesson from pyrycode #68
// (docs/lessons.md:122): an inner test whose failure you want to observe propagates to the parent and
// ends it before the post-state assertions can run.
//
// This spec deliberately imports ONLY `withIsolatedElectronApp` from ./fixtures/realDaemon (`test` and
// `expect` come from @playwright/test), so the `daemon` fixture is never declared and no `pyry` is
// spawned. Importing the module just runs `base.extend({...})`. It is not named `real-*`, so the default
// config runs it and the real-claude config ignores it: it passes on a machine with neither `pyry` nor
// `claude`.

// A fixed literal — no path, pid, or env interpolation (the leaked dir is credential storage; teardown
// diagnostics inherit realDaemon.ts's no-echo rule).
const SETUP_FAILURE_SENTINEL = 'e2e #517: forced setup failure after launch'

// One built-app launch plus a bounded death poll; the 30s default is tight on a cold runner (same
// rationale as launchPairedApp.ts's LAUNCH_TEST_TIMEOUT_MS).
const TEST_TIMEOUT_MS = 60_000
const DEATH_TIMEOUT_MS = 15_000
const DEATH_POLL_INTERVAL_MS = 100

/** Node's zero-signal liveness probe: `process.kill(pid, 0)` sends nothing and throws ESRCH once the
 *  process is gone. Any other error (EPERM — alive but not ours) still means "not reaped", but a child
 *  of this very process can only give ESRCH, so a plain false is honest here. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Poll rather than probe once: `app.close()` resolving does not guarantee the OS reaped the pid in the
 *  same tick. Resolves true as soon as the pid is gone, false at the deadline. */
async function waitForDeath(pid: number): Promise<boolean> {
  const deadline = Date.now() + DEATH_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true
    await delay(DEATH_POLL_INTERVAL_MS)
  }
  return !isAlive(pid)
}

test('a setup failure after launch still reaps the app and its user-data dir', async () => {
  test.setTimeout(TEST_TIMEOUT_MS)

  // An array, not a nullable `let`: the callback's assignment is invisible to TS's flow analysis, which
  // would narrow a `let record: T | null = null` to `null` at every read below. The length check after
  // the drive is the explicit non-vacuity guard — without it every post-assertion passes vacuously when
  // the callback never runs.
  const launched: Array<{ pid: number; userDataDir: string }> = []

  const attempt = withIsolatedElectronApp(async ({ app, userDataDir }) => {
    const pid = app.process().pid
    expect(typeof pid).toBe('number')
    if (pid === undefined) {
      throw new Error('e2e #517: launched app exposes no pid')
    }

    // Mutation controls. Without these the two post-assertions could pass because the probe is broken or
    // the app never launched at all, rather than because teardown ran.
    expect(isAlive(pid)).toBe(true)
    expect(existsSync(userDataDir)).toBe(true)

    launched.push({ pid, userDataDir })

    // The failure this ticket is about: raised after both resources exist, before `use`/`run` returns.
    throw new Error(SETUP_FAILURE_SENTINEL)
  })

  // Teardown neither swallowed the causal error nor replaced it with its own.
  await expect(attempt).rejects.toThrow(SETUP_FAILURE_SENTINEL)

  expect(launched.length).toBe(1)
  const record = launched[0]

  // Both post-state assertions are SOFT so a run records both failures (process alive AND dir present),
  // which is what makes the pre-fix RED evidence readable; the test still fails on either.
  // Booleans only — the pid and the dir path never reach an assertion message.
  expect.soft(await waitForDeath(record.pid)).toBe(true)
  expect.soft(existsSync(record.userDataDir)).toBe(false)
})
