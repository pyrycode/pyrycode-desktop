import { describe, expect, it, vi } from 'vitest'
import type { PyryApi } from './index'

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(async () => ({ privateResult: 'must-not-cross-bridge' })), on: vi.fn(), removeListener: vi.fn()
}))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: { invoke: electron.invoke, on: electron.on, removeListener: electron.removeListener },
  webUtils: {}
}))
import './index'

describe('preload reconnectServer', () => {
  it('forwards content only to its opt-in owner and preserves passive control delivery and cleanup', () => {
    const api: PyryApi = electron.exposeInMainWorld.mock.calls[0][1]
    const passive = vi.fn(), owner = vi.fn()
    const offPassive = api.onDaemonEvent(passive), offOwner = api.onDaemonEvent(owner, true)
    const handlers = electron.on.mock.calls.slice(-2).map(call => call[1])
    const update = { type: 'threadUpdate', serverId: 'one' }, control = { type: 'disconnected', serverId: 'one' }
    for (const handler of handlers) { handler({}, update); handler({}, control) }
    expect(passive.mock.calls).toEqual([[control]])
    expect(owner.mock.calls).toEqual([[update], [control]])
    offPassive(); offOwner()
    expect(electron.removeListener.mock.calls.slice(-2)).toEqual(handlers.map(handler => ['pyry:daemon-event', handler]))
  })

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
