import { EventEmitter } from 'node:events'
import type { ElectronApplication } from '@playwright/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { electron } from './electronLaunch'
import {
  attachLaunchFate, createLaunchFateLog, launchIsolatedApp,
  e2eShowsWindow, SHOW_WINDOW_E2E_ENV_FLAG
} from './desktopIsolation'

vi.mock('./electronLaunch', () => ({ electron: { launch: vi.fn() } }))

function acquiredApp(initializationError?: Error, closeError?: Error, closeWait?: Promise<void>) {
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null
  })
  const app = {
    process: () => child,
    evaluate: vi.fn(async () => {
      if (initializationError) throw initializationError
    }),
    close: vi.fn(async () => {
      if (closeError) throw closeError
      if (closeWait) await closeWait
      child.exitCode = 0
      child.emit('exit', 0, null)
    })
  }
  vi.mocked(electron.launch).mockResolvedValue(app as unknown as ElectronApplication)
  return { app, child }
}

beforeEach(() => vi.stubEnv('PYRY_E2E_SHOW_WINDOW', '1'))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('launchIsolatedApp acquisition ownership', () => {
  it('leaves a successfully initialized app running for its caller', async () => {
    const { app, child } = acquiredApp()
    const fate = createLaunchFateLog()
    expect(await launchIsolatedApp({ args: ['.'], env: {}, fate })).toBe(app)
    expect(app.close).not.toHaveBeenCalled()
    expect(child.exitCode).toBe(null)
    expect(fate.report().launches[0].runningAtOutcome).toBe(null)
  })

  it('closes a rejecting initialization before the original error reaches its caller', async () => {
    const error = new Error('initialization failed')
    let finishClose = () => {}
    const closeWait = new Promise<void>((resolve) => { finishClose = resolve })
    const { app, child } = acquiredApp(error, undefined, closeWait)
    const fate = createLaunchFateLog()
    const outcome = vi.fn()
    const result = launchIsolatedApp({ args: ['.'], env: {}, fate })
    void result.then(outcome, outcome) // Observe settlement while cleanup is deliberately pending.
    await vi.waitFor(() => expect(app.close).toHaveBeenCalledOnce())
    expect(outcome).not.toHaveBeenCalled()
    expect(child.exitCode).toBe(null)
    finishClose()
    await expect(result).rejects.toBe(error)
    expect(child.exitCode).toBe(0)
    expect(fate.report()).toEqual({
      launches: [{ runningAtOutcome: true, exitCode: 0, signal: null }],
      teardownFailures: []
    })
  })

  it('records a close failure without replacing or attaching either error', async () => {
    const error = new Error('private initialization details')
    const { app } = acquiredApp(error, new Error('private close details'))
    const fate = createLaunchFateLog()
    await expect(launchIsolatedApp({ args: ['.'], env: {}, fate })).rejects.toBe(error)
    expect(app.close).toHaveBeenCalledOnce()
    expect(fate.report().teardownFailures).toEqual(['app'])
    const attach = vi.fn<Parameters<typeof attachLaunchFate>[0]['attach']>(async () => {})
    await attachLaunchFate({ attach }, fate)
    const body = attach.mock.calls[0][1].body!.toString()
    expect(JSON.parse(body).teardownFailures).toEqual(['app'])
    expect(body).not.toContain('private')
  })
})

describe('e2e window presentation', () => {
  it('keeps the window hidden on macOS and Windows unless the run opts out', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      expect(e2eShowsWindow({}, platform)).toBe(false)
      expect(e2eShowsWindow({ [SHOW_WINDOW_E2E_ENV_FLAG]: 'true' }, platform)).toBe(false)
      expect(e2eShowsWindow({ [SHOW_WINDOW_E2E_ENV_FLAG]: '1' }, platform)).toBe(true)
    }
  })

  it('shows the window on Linux without the opt-out, where a hidden window never paints', () => {
    // A Codex agent's shell drops the dispatcher's PYRY_E2E_SHOW_WINDOW, so the Linux default must
    // already be the one the gate uses.
    expect(e2eShowsWindow({}, 'linux')).toBe(true)
  })
})
