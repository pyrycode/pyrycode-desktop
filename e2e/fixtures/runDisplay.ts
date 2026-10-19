import { spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'

// Each Linux Playwright worker acquires one private X display at its first Electron launch.
// Global setup validates the policy before workers start; electronLaunch applies the worker's
// display to every app, including live and replay fixtures. Native focus, pointer and clipboard
// state cannot cross worker or run boundaries. Apps within a scenario still share one display.
// Existing pointer protection remains useful for deliberately overlapping windows in that scenario.
//
// Opt-out: `PYRY_E2E_DISPLAY=inherit` keeps the inherited `DISPLAY`, for example to watch a run on a
// Linux desktop session. `PYRY_E2E_SHOW_WINDOW` cannot be that switch: the agent container sets it for
// gates, so it does not mean "this display was chosen on purpose". macOS and Windows have no X server
// and are left alone.

export const RUN_DISPLAY_ENV_FLAG = 'PYRY_E2E_DISPLAY'

/** What global setup does about the display. */
export type RunDisplayPlan =
  | { kind: 'own' }
  | { kind: 'inherit'; reason: 'not-linux' | 'opted-out' | 'no-xvfb' }

/**
 * Decide, without side effects. `own` unless the platform has no X server, the run opted out, or there is
 * no Xvfb but there is a display to inherit. Explicit `own` without Xvfb, no Xvfb and no display, and an
 * unrecognised value all throw, so a run fails at setup with the reason instead of failing every launch
 * with "Unable to open X display".
 */
export function planRunDisplay(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
  xvfbAvailable: boolean
): RunDisplayPlan {
  if (platform !== 'linux') return { kind: 'inherit', reason: 'not-linux' }
  const choice = env[RUN_DISPLAY_ENV_FLAG] ?? ''
  if (choice !== '' && choice !== 'own' && choice !== 'inherit') {
    throw new Error(`${RUN_DISPLAY_ENV_FLAG} must be "own" or "inherit", got "${choice}"`)
  }
  if (choice === 'inherit') return { kind: 'inherit', reason: 'opted-out' }
  if (xvfbAvailable) return { kind: 'own' }
  if (choice === 'own') throw new Error(`${RUN_DISPLAY_ENV_FLAG}=own needs Xvfb on PATH`)
  if (env.DISPLAY) return { kind: 'inherit', reason: 'no-xvfb' }
  throw new Error('No X display for Electron: install Xvfb (the xvfb package) or set DISPLAY')
}

/** Whether an executable `Xvfb` is on PATH. */
export function xvfbOnPath(path: string | undefined = process.env.PATH): boolean {
  for (const dir of (path ?? '').split(delimiter)) {
    if (dir === '') continue
    try {
      accessSync(join(dir, 'Xvfb'), constants.X_OK)
      return true
    } catch {
      // not here, keep scanning
    }
  }
  return false
}

/** How long Xvfb gets to report its display before setup gives up. Start-up takes milliseconds. */
const XVFB_READY_TIMEOUT_MS = 15_000

/** How long teardown waits for the server to stop before it kills the guard outright. */
const XVFB_STOP_TIMEOUT_MS = 5_000

/** The same screen and options as the agent container's own display (pyrycode-agents entrypoint). */
export const XVFB_ARGS = ['-screen', '0', '1920x1080x24', '-nolisten', 'tcp', '-noreset'] as const

/**
 * The shell that holds the server, so the server can never outlive the run:
 *  - it stops the server when its standard input reaches end of file. The runner holds the other end, so
 *    that happens at teardown and also when the runner dies in any way, a kill of its PID alone included;
 *  - it exits when the server exits, so the runner hears about a server that died during the run.
 * A signal to the whole process group, a Ctrl+C in a terminal or the dispatcher's SIGTERM at a gate
 * timeout, reaches the server directly and stops it at once.
 * fd 4 carries standard input into the watcher because a background job in a non-interactive shell gets
 * /dev/null as its standard input.
 */
const XVFB_GUARD = [
  'exec 4<&0',
  'Xvfb "$@" &',
  'xvfb=$!',
  '( cat <&4 >/dev/null; kill "$xvfb" 2>/dev/null ) &',
  'wait "$xvfb"'
].join('\n')

export type RunDisplay = { display: string; stop: () => Promise<void> }

/**
 * Start a private Xvfb and resolve once it accepts connections. `-displayfd` makes the server pick a free
 * display number itself and write it back only after it is listening, so concurrent runs cannot pick the
 * same number and no readiness poll is needed. `-noreset` for the reason the container's display has it:
 * a server that resets when its last client leaves can refuse the next Electron launch while it resets.
 */
export async function startRunDisplay(): Promise<RunDisplay> {
  const child = spawn('sh', ['-c', XVFB_GUARD, 'run-display', '-displayfd', '3', ...XVFB_ARGS], {
    stdio: ['pipe', 'ignore', 'pipe', 'pipe']
  })
  // Bounded tail of the server's own messages, kept for the failure messages and drained for the whole
  // run so a chatty server can never fill the pipe and block.
  let log = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    log = (log + chunk.toString()).slice(-2_000)
  })
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  // Nothing is ever written to the guard; closing its input after the guard has gone must not throw.
  child.stdin?.on('error', () => {})
  const release = (): void => {
    child.stdin?.end()
  }

  const number = await new Promise<string>((resolve, reject) => {
    let reported = ''
    const fail = (error: Error): void => {
      clearTimeout(timer)
      release()
      child.kill('SIGKILL')
      reject(error)
    }
    const timer = setTimeout(
      () => fail(new Error(`Xvfb reported no display within ${XVFB_READY_TIMEOUT_MS} ms: ${log.trim()}`)),
      XVFB_READY_TIMEOUT_MS
    )
    const onEarlyExit = (code: number | null, signal: NodeJS.Signals | null): void =>
      fail(new Error(`Xvfb exited before reporting a display (code ${code}, signal ${signal}): ${log.trim()}`))
    child.once('error', fail)
    child.once('exit', onEarlyExit)
    const fd = child.stdio[3] as NodeJS.ReadableStream | null
    fd?.on('data', (chunk: Buffer) => {
      reported += chunk.toString()
      const match = /^(\d+)\n/.exec(reported)
      if (match) {
        clearTimeout(timer)
        child.off('exit', onEarlyExit)
        resolve(match[1])
      }
    })
  })

  const display = `:${number}`
  let stopping = false
  // Every later Electron launch of the run would fail on a dead server, so say why once, where the run's
  // output shows it.
  child.once('exit', (code, signal) => {
    if (!stopping) {
      process.stderr.write(`[run-display] Xvfb on ${display} exited during the run (code ${code}, signal ${signal}): ${log.trim()}\n`)
    }
  })

  return {
    display,
    stop: async () => {
      stopping = true
      release()
      if (child.exitCode !== null || child.signalCode !== null) return
      let timer: NodeJS.Timeout | undefined
      const late = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, XVFB_STOP_TIMEOUT_MS)
      })
      await Promise.race([exited, late])
      clearTimeout(timer)
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
  }
}

/**
 * Validate before collection. Resource ownership belongs to workers rather than the runner.
 */
export default async function globalSetup(): Promise<undefined> {
  planRunDisplay(process.env, process.platform, xvfbOnPath())
  return undefined
}

// Module state is private to a Playwright worker process. The stdin guard in startRunDisplay closes
// the server when that process exits, including abrupt worker termination. Concurrent launches in one
// worker share one acquisition; app restarts never reset the display or its clipboard.
let workerDisplay: Promise<RunDisplay> | undefined
export async function withWorkerDisplay(
  env: Record<string, string> | undefined
): Promise<Record<string, string> | undefined> {
  if (planRunDisplay(process.env, process.platform, xvfbOnPath()).kind === 'inherit') return env
  workerDisplay ??= startRunDisplay()
  const own = await workerDisplay
  return { ...(env ?? process.env) as Record<string, string>, DISPLAY: own.display }
}
