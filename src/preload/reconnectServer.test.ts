import { describe, expect, it, vi } from 'vitest'
import type { PyryApi } from './index'

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(async () => ({ privateResult: 'must-not-cross-bridge' }))
}))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: { invoke: electron.invoke },
  webUtils: {}
}))
import './index'

describe('preload reconnectServer', () => {
  it('exposes a fixed-channel request with no result data', async () => {
    expect(electron.exposeInMainWorld.mock.calls).toEqual([['pyry', expect.any(Object)]])
    const api: PyryApi = electron.exposeInMainWorld.mock.calls[0][1]
    const acknowledgement: Promise<void> = api.reconnectServer('__proto__')
    await expect(acknowledgement).resolves.toBeUndefined()
    expect(electron.invoke.mock.calls).toEqual([
      ['pyry:reconnect-server', { serverId: '__proto__' }]
    ])
  })
})
