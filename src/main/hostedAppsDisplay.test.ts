import { expect, it, vi } from 'vitest'
const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => any>())
vi.mock('electron', () => ({ ipcMain: { handle: (key: string, fn: any) => handlers.set(key, fn), removeHandler: (key: string) => handlers.delete(key) } }))
import { registerHostedAppsDisplay } from './hostedAppsDisplay'

it('copies display only and fences replacement, unpair, retired watches and reload', () => {
  function service(title: string) {
    const listeners: (() => void)[] = []
    const record = { app_id: 'app', title, state: 'running', active_release: 'secret-authority' }
    return { read: () => ({ type: 'ready', items: [record] }), refresh: vi.fn(),
      subscribe: (fn: () => void) => { listeners.push(fn); return vi.fn() }, listeners, record }
  }
  const a = service('first'), b = service('second')
  let current: any = a
  const registry: any = { connectionFor: vi.fn((id: string) => id === 'host' && current ? { hostedApps: current } : null) }
  const events = new Map<string, () => void>(), sent: any[] = []
  const client: any = { mainFrame: {}, send: (_channel: string, value: any) => sent.push(value), on: (key: string, fn: () => void) => events.set(key, fn) }
  const parent: any = { webContents: client, isDestroyed: () => false, once: (key: string, fn: () => void) => events.set(key, fn) }
  const bridge = registerHostedAppsDisplay(registry, { event: vi.fn() })
  bridge.attach(parent)
  const invoke = (command: any, event = { sender: client, senderFrame: client.mainFrame }) => handlers.get('pyry:hosted-apps-display')!(event, command)
  expect(invoke({ type: 'watch', serverId: 'host', token: 1 })).toEqual({ ok: true })
  expect(sent.at(-1)).toEqual({ token: 1, state: { serverId: 'host', type: 'ready', items: [{ appId: 'app', title: 'first', state: 'running' }] } })
  a.record.title = 'mutated'
  expect(sent.at(-1).state.items[0].title).toBe('first')
  current = b; bridge.reconcile()
  a.listeners[0]()
  expect(sent.at(-1).state.items[0].title).toBe('second')
  invoke({ type: 'watch', serverId: 'host', token: 2 })
  expect(invoke({ type: 'unwatch', serverId: 'host', token: 1 })).toEqual({ ok: true })
  b.listeners[0]()
  expect(sent.at(-1).token).toBe(2)
  current = null; bridge.reconcile(); b.listeners.at(-1)!()
  expect(sent.at(-1).state).toEqual({ serverId: 'host', type: 'unavailable' })
  expect(invoke({ type: 'refresh', serverId: 'host', token: 0 })).toEqual({ ok: false, error: 'refused' })
  current = b; bridge.reconcile()
  events.get('did-start-loading')!()
  const count = sent.length; b.listeners.at(-1)!()
  expect(sent).toHaveLength(count)
  const lookups = registry.connectionFor.mock.calls.length
  for (const type of ['watch', 'refresh']) for (const event of [{ sender: {}, senderFrame: null }, { sender: client, senderFrame: null }])
    expect(invoke({ type, serverId: 'host', token: 0 }, event as any)).toEqual({ ok: false, error: 'refused' })
  expect(registry.connectionFor).toHaveBeenCalledTimes(lookups)
  expect(b.refresh).not.toHaveBeenCalled()
  bridge.dispose()
})
