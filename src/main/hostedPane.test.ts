import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }))
import { ipcMain } from 'electron'
import { registerHostedPane } from './hostedPane'

it('admits selection only from the attached privileged main frame for a named paired host', async () => {
  const frame = {}, client = Object.assign(new EventEmitter(), { mainFrame: frame, send: vi.fn() })
  const parent = Object.assign(new EventEmitter(), { webContents: client, isDestroyed: () => false })
  const subscribe = vi.fn(() => () => {}), refresh = vi.fn(), open = vi.fn()
  const connection = { hostedApps: { read: () => ({ type: 'unsupported' }), subscribe, refresh } }
  const registry = { connectionFor: vi.fn((server: string) => server === 'paired' ? connection : null) }
  const controller = registerHostedPane({ open } as any, registry as any, async () => null, { event: vi.fn() } as any)
  controller.attach(parent as any)
  const handler = vi.mocked(ipcMain.handle).mock.calls.at(-1)![1]
  const command = { type: 'select', serverId: 'paired', appId: '22222222-2222-4222-8222-222222222222' }
  try {
    for (const event of [{ sender: {}, senderFrame: frame }, { sender: client, senderFrame: {} }]) {
      expect(handler(event as any, command)).toEqual({ ok: false, error: 'refused' })
    }
    expect(registry.connectionFor).not.toHaveBeenCalled()
    const event = { sender: client, senderFrame: frame }
    expect(handler(event as any, { ...command, serverId: 'unknown' })).toEqual({ ok: false, error: 'refused' })
    expect(handler(event as any, { ...command, appId: 'wrong' })).toEqual({ ok: false, error: 'refused' })
    expect(handler(event as any, command)).toMatchObject({ ok: true, state: { type: 'unsupported', serverId: 'paired' } })
    await Promise.resolve()
    expect(subscribe).toHaveBeenCalledOnce()
    expect(refresh).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  } finally { controller.dispose() }
})
