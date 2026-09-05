import { test, expect } from '@playwright/test'
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import {
  LAUNCH_FATE_ATTACHMENT,
  attachLaunchFate,
  createLaunchFateLog,
  launchIsolatedApp,
  type LaunchFateLog,
  type LaunchFateSink
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

/** A `TestInfo` double that records what was attached. The status is the whole point: `attachLaunchFate`
 *  gates on it, and a real passing test cannot exhibit the failing branch from inside itself. Everything
 *  else about the function under test is real. */
function recordingSink(status: LaunchFateSink['status']): LaunchFateSink & {
  attached: Array<{ name: string; body: string; contentType: string }>
} {
  const attached: Array<{ name: string; body: string; contentType: string }> = []
  return {
    status,
    attached,
    async attach(name, options) {
      attached.push({
        name,
        body: String(options?.body ?? ''),
        contentType: options?.contentType ?? ''
      })
    }
  }
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

test('a killed launch reports not-running, no exit code, and the signal that took it', async () => {
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

  // AC3, against a REAL `--user-data-dir` this run actually launched with — the path that embeds the
  // run's secret store, and the reason `smoke.spec.ts` discards close errors unlogged. Asserting the
  // absence of any `/` at all is the structural form: no path and no argv entry can survive it.
  const sink = recordingSink('failed')
  await attachLaunchFate(sink, log)
  expect(sink.attached).toHaveLength(1)
  const body = sink.attached[0].body
  expect(userDataDir).not.toBe('')
  expect(body).not.toContain(userDataDir)
  expect(body).not.toContain('/')
  expect(sink.attached[0].name).toBe(LAUNCH_FATE_ATTACHMENT)
  expect(sink.attached[0].contentType).toBe('text/plain')
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

test('a teardown step that throws is named, and only a failing test carries the diagnostic', async () => {
  const log = createLaunchFateLog()

  // AC2's subject. Two steps, recorded in drain order — the body must name WHICH step threw, never the
  // error, which can carry the launch argv.
  log.recordTeardownFailure('daemon')
  log.recordTeardownFailure('user-data-dir')

  const failed = recordingSink('failed')
  await attachLaunchFate(failed, log)
  expect(failed.attached).toHaveLength(1)
  expect(JSON.parse(failed.attached[0].body).teardownFailures).toEqual(['daemon', 'user-data-dir'])

  // A timed-out test is the other observed failure class (`attachment-file-row.spec.ts` at 1.0m), so it
  // must carry the diagnostic too — the gate is the failure SET, not equality with 'failed'.
  const timedOut = recordingSink('timedOut')
  await attachLaunchFate(timedOut, log)
  expect(timedOut.attached).toHaveLength(1)

  // AC1's second half: a green run's output is unchanged. Same log, same content — only the status
  // differs, so this reddens the moment the gate is dropped.
  const passed = recordingSink('passed')
  await attachLaunchFate(passed, log)
  expect(passed.attached).toHaveLength(0)

  const skipped = recordingSink('skipped')
  await attachLaunchFate(skipped, log)
  expect(skipped.attached).toHaveLength(0)
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
