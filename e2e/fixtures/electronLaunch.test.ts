import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const { launchSpy } = vi.hoisted(() => ({ launchSpy: vi.fn() }))
vi.mock('@playwright/test', () => ({ _electron: { launch: launchSpy } }))

import { electron } from './electronLaunch'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  launchSpy.mockReset()
})

describe('Electron test launch', () => {
  it.each(['desktopIsolation.ts', 'realDaemon.ts'])('%s uses the guarded launcher', (file) => {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    expect(source).toContain("import { electron } from './electronLaunch'")
    expect(source).not.toMatch(/_electron\s+as\s+electron/)
  })

  it('stops a macOS sandbox launch before starting a process', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    vi.stubEnv('CODEX_SANDBOX', 'seatbelt')
    await expect(electron.launch({ args: ['.'] })).rejects.toThrow('outside the Codex sandbox')
    expect(launchSpy).not.toHaveBeenCalled()
  })

  it('passes launch options and the application through outside the sandbox', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    vi.stubEnv('CODEX_SANDBOX', undefined)
    const options = { args: ['.'], env: { TEST: 'preserved' } }
    const app = { close: vi.fn() }
    launchSpy.mockResolvedValue(app)
    expect(await electron.launch(options)).toBe(app)
    expect(launchSpy).toHaveBeenCalledOnce()
    expect(launchSpy).toHaveBeenCalledWith(options)
  })

  it('does not apply the macOS restriction on other platforms', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.stubEnv('CODEX_SANDBOX', 'seatbelt')
    await electron.launch({ args: ['.'] })
    expect(launchSpy).toHaveBeenCalledOnce()
  })
})
