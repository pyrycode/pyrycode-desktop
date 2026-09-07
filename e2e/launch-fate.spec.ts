import { test, expect, type TestInfo } from '@playwright/test'
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import {
  LAUNCH_FATE_ATTACHMENT,
  attachLaunchFate,
  createLaunchFateLog,
  launchIsolatedApp,
  type LaunchFateLog
} from './fixtures/desktopIsolation'

// #1127's cover. The fake tier reddens intermittently — a different spec each run, once on an untouched
// merge-base — and neither observed failure reproduces on demand. #1067 already spent one guess at a
// flake of this shape and fixed a real cause (renderer throttling); these are post-#1067 and carry
// different signatures. So this ticket buys EVIDENCE, not a cure: the three facts the harness already
// knows about a failing launch and used to throw away — the process's exit code, its terminating signal,
// and whether it was still running when the test failed — plus the name of any teardown step that threw.
//
// THERE IS DELIBERATELY NO FAILS-ON-MAIN TEST FOR THE FLAKE ITSELF, for the same reason #1067 had none.
// What ships is the capture, and this file proves the capture: two real launches driven to a known fate
// (killed, and alive-then-closed), the hygiene bound asserted against a real `--user-data-dir`, the
// failure gate asserted from both sides, and a source guard for the one thing an in-process assertion
// structurally cannot see.
//
// Follows `fixture-teardown-leak.spec.ts` (#517): drive the extracted functions DIRECTLY and force the
// failure, rather than nesting a Playwright run inside a test — an inner test whose failure you want to
// observe otherwise propagates to the parent and ends it before the post-state assertions run
// (cross-project lesson, pyrycode #68).
//
// It launches through `launchIsolatedApp` — the tier's one chokepoint — so it needs no `pyry`, no
// `claude` and no credential, and it is not named `real-*`, so the default config runs it and the
// real-claude config ignores it.

// One built-app launch apiece; the 30s default is tight on a cold runner (same rationale as
// launchPairedApp.ts's LAUNCH_TEST_TIMEOUT_MS).
const TEST_TIMEOUT_MS = 60_000

// Playwright's terminal reporter prints an attachment's body inline only when the content type starts
// with `text/`, and it truncates that body at 300 characters. Both are asserted below, because a
// diagnostic the operator cannot read in `reporter: 'list'` output buys nothing.
const REPORTER_INLINE_BODY_LIMIT = 300

/**
 * The launch-fate attachments this test has accumulated, read back off the REAL `TestInfo`.
 *
 * #1202 deleted the `recordingSink` double this file used to attach through. The double was a
 * hand-written `{ status, attach }` pair, and it stood in for exactly the part that turned out to be
 * broken: the status it carried was a constant the test chose, while the real `TestInfo.status` is
 * `'passed'` until something calls `_failWithError` — which Playwright can do LATER than the fixture
 * epilogue that attaches. Every assertion in this file passed while a real red carried nothing. So the
 * tests below drive the real `testInfo`, and read what a real failing run would have carried.
 *
 * Filtered by name because a future Playwright default (a trace, a screenshot) could put something else
 * in the list, and this file's subject is one attachment.
 */
function attachedFates(testInfo: TestInfo): TestInfo['attachments'] {
  return testInfo.attachments.filter((attachment) => attachment.name === LAUNCH_FATE_ATTACHMENT)
}

/** Launch the built app in its own throwaway user-data dir, hand it to `run`, and reap the dir after.
 *  The app itself is closed by `run` through `log.closeWatched`, which is the call under test. */
async function withLaunch(
  log: LaunchFateLog,
  run: (app: Awaited<ReturnType<typeof launchIsolatedApp>>, userDataDir: string) => Promise<void>
): Promise<void> {
  const env = { ...process.env }
  delete env.ELECTRON_RENDERER_URL
  const userDataDir = await mkdtemp(join(tmpdir(), 'pyry-e2e-fate-'))
  try {
    const app = await launchIsolatedApp({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env,
      fate: log
    })
    await run(app, userDataDir)
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
}

test('a killed launch reports not-running, no exit code, and the signal that took it', async ({}, testInfo) => {
  test.setTimeout(TEST_TIMEOUT_MS)

  const log = createLaunchFateLog()
  let userDataDir = ''

  await withLaunch(log, async (app, dir) => {
    userDataDir = dir
    const child = app.process()

    // The `socket hang up` shape made deterministic: the Electron process goes away under the driver.
    // Awaiting `'exit'` is what makes the read below deterministic rather than racing Node's bookkeeping.
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill('SIGKILL')
    await exited

    // The site's shape, verbatim: `closeWatched` replaces `app.close()` and owns the ordering (liveness
    // first, exit code after), and the site's bindingless catch names the step. Whether `close()` on an
    // already-dead app resolves or throws is deliberately not asserted — either is correct, and this
    // test's subject is the fate, not the drain.
    try {
      await log.closeWatched(app)
    } catch {
      log.recordTeardownFailure('app')
    }
  })

  const report = log.report()
  expect(report.launches).toHaveLength(1)
  const fate = report.launches[0]

  // The three AC1 facts. Each reddens on a distinct deletion: the length above on `watch`, the liveness
  // on `closeWatched`'s pre-close read, the signal on its post-close settle.
  expect(fate.runningAtOutcome).toBe(false)
  expect(fate.exitCode).toBe(null)
  expect(fate.signal).toBe('SIGKILL')

  // #1127's AC3, against a REAL `--user-data-dir` this run actually launched with — the path that embeds
  // the run's secret store, and the reason `smoke.spec.ts` discards close errors unlogged. Asserting the
  // absence of any `/` at all is the structural form: no path and no argv entry can survive it.
  //
  // #1202 moved this onto the real `testInfo`, which is the channel that actually carries the body to
  // the operator. It is the strongest hygiene evidence in the file — a real launch, a real secret path,
  // and the real sink — and it was the one place the double was weakest.
  await attachLaunchFate(testInfo, log)
  expect(attachedFates(testInfo)).toHaveLength(1)
  const attachment = attachedFates(testInfo)[0]
  const body = attachment.body?.toString() ?? ''
  expect(userDataDir).not.toBe('')
  expect(body).not.toContain(userDataDir)
  expect(body).not.toContain('/')
  expect(attachment.contentType).toBe('text/plain')
  expect(body.length).toBeLessThan(REPORTER_INLINE_BODY_LIMIT)
})

test('a launch still running when the test ends reports running, then a settled exit', async () => {
  test.setTimeout(TEST_TIMEOUT_MS)

  const log = createLaunchFateLog()

  await withLaunch(log, async (app) => {
    // Wait for a real window so the app is genuinely up, not merely spawned — otherwise "still running"
    // could be true of a process that had not finished starting.
    await app.firstWindow()
    await log.closeWatched(app)
  })

  const report = log.report()
  expect(report.launches).toHaveLength(1)
  const fate = report.launches[0]

  // The "app alive but wedged" arm — the reading the 1.0m timeout needs, and the mutation control for
  // the killed arm above: if the liveness read were hard-coded either way, one of these two fails.
  expect(fate.runningAtOutcome).toBe(true)
  expect(fate.signal).toBe(null)
  // The exit SETTLED. A null here would mean `closeWatched`'s post-close wait was dropped, which is what
  // turns a real exit code into a misleading "never exited" on a slow runner.
  expect(fate.exitCode).not.toBe(null)
})

// #1202's cover, and the seam #1127's own tests structurally could not reach. The diagnostic did not
// fire on the one red it was built for (`question-picks.spec.ts`, a bare `socket hang up` on PR #1195):
// `attachLaunchFate` gated on `sink.status`, and a fixture epilogue reads that BEFORE the test's status
// is final. `TestInfoImpl.status` is `'passed'` until `_failWithError` runs, and Playwright runs that
// later than the epilogue in two ways this tier hits — a teardown that drains after `launchPairedApp`'s,
// and `WorkerMain.unhandledError`, which routes an `uncaughtException`/`unhandledRejection` to the
// current test for as long as it is open. Both were reproduced against `main` before the fix.
//
// So the gate is gone, and this test is what holds it gone: it drives the real `TestInfo` at the one
// moment the old code returned empty-handed — while the test is still passing. Restore the gate and the
// count assertion below reddens.
//
// Suppression on a green run did not disappear; it moved to where it was always enforced. Playwright's
// terminal reporter prints an attachment only from `formatFailure`, reached only for a result carrying
// errors — so a passing test's attachment exists and is never printed. That is why the `text/plain`
// content type, the un-underscored name and the inline length bound are still asserted here and above:
// they are the reporter's actual conditions for showing the body to an operator.
test('the report reaches a real TestInfo while the test is still passing, and names the steps that threw', async ({}, testInfo) => {
  const log = createLaunchFateLog()

  // #1127's AC2 subject, unchanged. Two steps, recorded in drain order — the body must name WHICH step
  // threw, never the error, which can carry the launch argv.
  log.recordTeardownFailure('daemon')
  log.recordTeardownFailure('user-data-dir')

  // The premise, asserted rather than assumed: this test is passing right now, so the old gate's
  // `status !== 'failed' && …` branch is the one being taken. Without this the test could silently stop
  // testing what it claims — a status that had somehow become a failure would make it pass vacuously.
  expect(testInfo.status).toBe('passed')
  expect(attachedFates(testInfo)).toHaveLength(0)

  // The kept early return, and this test's non-vacuity control: a log with no launches and no teardown
  // failures still attaches nothing, so the count below is a real transition rather than a constant.
  await attachLaunchFate(testInfo, createLaunchFateLog())
  expect(attachedFates(testInfo)).toHaveLength(0)

  await attachLaunchFate(testInfo, log)
  expect(attachedFates(testInfo)).toHaveLength(1)

  const attachment = attachedFates(testInfo)[0]
  const body = attachment.body?.toString() ?? ''
  expect(JSON.parse(body).teardownFailures).toEqual(['daemon', 'user-data-dir'])
  expect(attachment.contentType).toBe('text/plain')
  // Still an in-memory `body` attachment, never a `path` one: no file is written, so calling this from a
  // teardown epilogue cannot reintroduce #517's hazard of a throwing `finally` replacing the causal
  // error — and no string of ours reaches a filesystem path.
  expect(attachment.path).toBe(undefined)
  expect(body).not.toContain('/')
  expect(body.length).toBeLessThan(REPORTER_INLINE_BODY_LIMIT)
})

// The deterministic guard for the one gap the four tests above structurally cannot cover: a site that
// creates a log and then never attaches it records everything and reports nothing, and every existing
// spec stays green. Same shape as `desktop-isolation.spec.ts`'s launch-site guard, and the same reason —
// an in-process assertion cannot see a call that a file simply does not make.
test('every file that opens a launch-fate log also attaches it', async () => {
  // `__dirname`, not `import.meta.url`: the repo has no `"type": "module"`, so Playwright transpiles
  // specs to CommonJS and `import.meta` is not available in one.
  const e2eDir = __dirname

  // The defining module names both symbols by declaring them, which is not a call site.
  const DEFINITION = 'fixtures/desktopIsolation.ts'
  const OPENS = /createLaunchFateLog\(/
  const ATTACHES = /attachLaunchFate\(/

  const walk = async (dir: string): Promise<string[]> => {
    const entries = await readdir(dir, { withFileTypes: true })
    const found = await Promise.all(
      entries.map(async (entry) => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return walk(path)
        return entry.name.endsWith('.ts') ? [path] : []
      })
    )
    return found.flat()
  }

  const opens: string[] = []
  const attaches: string[] = []
  for (const path of await walk(e2eDir)) {
    const rel = relative(e2eDir, path)
    if (rel === DEFINITION) continue
    const source = await readFile(path, 'utf-8')
    if (OPENS.test(source)) opens.push(rel)
    if (ATTACHES.test(source)) attaches.push(rel)
  }

  // Not `toEqual([...known files])`: pinning the membership would make every new launch site edit this
  // assertion, and an author editing it is an author who has stopped reading it. The invariant is the
  // pairing, and it holds for a set of any size.
  expect(opens.sort()).toEqual(attaches.sort())
  // Non-vacuity: two sites plus this spec. Without it, deleting both calls everywhere passes.
  expect(opens.length).toBeGreaterThanOrEqual(3)
})
