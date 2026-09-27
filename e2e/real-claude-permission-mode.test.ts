import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DAEMON_IDENTITY_REJECTION } from './fixtures/daemonVersion'

const harness = vi.hoisted(() => ({
  register: vi.fn(),
  launch: vi.fn(),
  version: vi.fn()
}))

vi.mock('./fixtures/realDaemon', () => ({
  test: Object.assign(harness.register, { use: vi.fn(), setTimeout: vi.fn() }),
  expect: vi.fn(),
  encodePairingPayload: vi.fn(),
  withIsolatedElectronApp: harness.launch
}))

vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util')
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: harness.version }) }
})

// Load the real test body; only its process/fixture boundaries are replaced.
import './real-claude-permission-mode.spec'

describe('permission-mode daemon identity preflight', () => {
  beforeEach(() => {
    harness.launch.mockReset()
    harness.version.mockReset()
  })

  it.each(['', 'pyry', 'pyry dev-XYZ'])('rejects %j without launching Electron', async stdout => {
    harness.version.mockResolvedValue({ stdout })
    expect(harness.register).toHaveBeenCalledOnce()
    const run = harness.register.mock.calls[0][1]
    const eagerPage = vi.fn(() => undefined)
    const fixtures = {
      relay: {},
      daemon: {},
      // Requesting page would launch before the body in Playwright. Track the
      // dependency separately from the explicit launcher used inside the body.
      get page() { return eagerPage() }
    }
    const info = { annotations: [], attach: vi.fn() }

    await expect(run(fixtures, info)).rejects.toThrow(DAEMON_IDENTITY_REJECTION)
    expect(eagerPage).not.toHaveBeenCalled()
    expect(harness.launch).not.toHaveBeenCalled()
    expect(info.annotations).toEqual([])
    expect(info.attach).not.toHaveBeenCalled()
  })
})
