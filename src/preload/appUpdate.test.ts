import { describe, expect, it, vi } from 'vitest'
import type { PyryApi } from './index'
const electron = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn(), send: vi.fn(), listeners: new Map<string, Function>() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: electron.expose }, webUtils: {}, ipcRenderer: {
  invoke: electron.invoke, send: electron.send,
  on: (channel: string, listener: Function) => electron.listeners.set(channel, listener),
  removeListener: (channel: string) => electron.listeners.delete(channel)
} }))
import './index'
const api: PyryApi = electron.expose.mock.calls[0][1]
const tick = () => new Promise(resolve => setImmediate(resolve))

describe('app-update bridge', () => {
  it('subscribes before snapshot and never overwrites newer state or delivers after cleanup', async () => {
    let finish!: (value: unknown) => void
    electron.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const listener = vi.fn()
    const off = api.onAppUpdate(listener)
    expect(electron.invoke).toHaveBeenLastCalledWith('pyry:app-update-state')
    electron.listeners.get('pyry:app-update-state')!({}, { type: 'ready', version: '1.2.3', path: 'PRIVATE' })
    finish({ type: 'idle' }); await tick()
    expect(listener.mock.calls).toEqual([[{ type: 'ready', version: '1.2.3' }]])
    off(); expect(electron.listeners.has('pyry:app-update-state')).toBe(false)
    const off2 = api.onAppUpdate(listener); off2(); finish({ type: 'failed' }); await tick()
    expect(listener).toHaveBeenCalledTimes(1)
  })
  it('receives current completion and projects metadata, invalid versions and raw failures', async () => {
    electron.invoke.mockResolvedValue({ type: 'ready', version: 'v1.2.3', releaseNotes: 'PRIVATE' })
    const listener = vi.fn(); const off = api.onAppUpdate(listener); await tick()
    expect(listener).toHaveBeenLastCalledWith({ type: 'ready', version: null })
    electron.listeners.get('pyry:app-update-state')!({}, { type: 'failed', error: 'PRIVATE' })
    expect(listener).toHaveBeenLastCalledWith({ type: 'failed' })
    off()
    electron.invoke.mockRejectedValue(Error('PRIVATE'))
    const invisible = vi.fn(); const stop = api.onAppUpdate(invisible); await tick(); stop()
    expect(invisible).not.toHaveBeenCalled()
    api.sendAppUpdateAction({ type: 'restart' })
    expect(electron.send).toHaveBeenLastCalledWith('pyry:app-update-action', { type: 'restart' })
  })
})
