import { beforeEach, expect, it, vi } from 'vitest'
import type { PyryApi } from './index'
const electron = vi.hoisted(() => ({
  expose: vi.fn(), invoke: vi.fn(), listeners: new Map<string, (...args: any[]) => void>()
}))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: electron.expose }, webUtils: {}, ipcRenderer: {
  invoke: electron.invoke,
  on: (channel: string, handler: (...args: any[]) => void) => electron.listeners.set(channel, handler),
  removeListener: (channel: string) => electron.listeners.delete(channel)
} }))
import './index'
const api: PyryApi = electron.expose.mock.calls[0][1]
const channel = 'pyry:hosted-apps-display'
beforeEach(() => { electron.invoke.mockReset(); electron.listeners.clear() })

it.each(['refused', 'rejected'])('shows static failure on a %s watch', async outcome => {
  electron.invoke.mockImplementation(() => outcome === 'refused'
    ? Promise.resolve({ ok: false, error: 'refused' }) : Promise.reject(new Error('private error')))
  const listener = vi.fn(), off = api.onHostedApps('host', listener)
  await vi.waitFor(() => expect(listener).toHaveBeenCalledWith({ serverId: 'host', type: 'failed' }))
  off()
})

it.each(['snapshot', 'cleanup'])('late refusal cannot overwrite %s', async cause => {
  let finish!: (value: unknown) => void
  electron.invoke.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    .mockResolvedValue({ ok: true })
  const listener = vi.fn(), off = api.onHostedApps('host', listener)
  if (cause === 'snapshot') {
    const token = electron.invoke.mock.calls[0][1].token
    electron.listeners.get(channel)!({}, { token, state: { serverId: 'host', type: 'ready', items: [] } })
  } else off()
  finish({ ok: false, error: 'refused' })
  await new Promise(resolve => setImmediate(resolve))
  expect(listener.mock.calls).toEqual(cause === 'snapshot' ? [[{ serverId: 'host', type: 'ready', items: [] }]] : [])
  if (cause === 'snapshot') off()
})
