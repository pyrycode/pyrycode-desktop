import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PyryApi } from './index'
import type { DaemonEvent } from '../shared/ipc/events'
type TestEvent = DaemonEvent & { serverId?: string | null }

const electron = vi.hoisted(() => ({ expose: vi.fn(), listeners: new Map<string, Set<Function>>() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: electron.expose }, webUtils: {}, ipcRenderer: {
  on(channel: string, listener: Function) {
    const held = electron.listeners.get(channel) ?? new Set()
    held.add(listener); electron.listeners.set(channel, held)
  },
  removeListener(channel: string, listener: Function) { electron.listeners.get(channel)?.delete(listener) }
} }))
let api: PyryApi
const emit = (event: TestEvent) => {
  for (const listener of electron.listeners.get('pyry:daemon-event') ?? []) listener({}, event)
}
const connected = (serverId = 'a'): TestEvent => ({ type: 'connected', serverId,
  ack: { server_id: 'untrusted-other-origin', conn_id: 'connection', protocol_version: '2', capabilities: ['thread', 'interactive'] } })

beforeEach(async () => {
  vi.resetModules(); electron.expose.mockClear(); electron.listeners.clear()
  await import('./index')
  api = electron.expose.mock.calls[0][1]
})

describe('daemon status subscription boundary', () => {
  it('privately converges independent consumers without rebroadcast or duplicate opening work', () => {
    const event = connected()
    emit(event)
    const runtime = vi.fn(), chrome = vi.fn()
    const off = api.onDaemonEvent(runtime, true)
    expect(runtime.mock.calls).toEqual([[event]])
    api.onDaemonEvent(chrome)
    expect(chrome.mock.calls).toEqual([[event]])
    expect(runtime).toHaveBeenCalledTimes(1)
    off(); emit({ type: 'disconnected', serverId: 'a' })
    expect(runtime).toHaveBeenCalledTimes(1)
    const remount = vi.fn(); api.onDaemonEvent(remount, true)
    expect(remount.mock.calls).toEqual([[{ type: 'disconnected', serverId: 'a' }]])
    expect(chrome).toHaveBeenCalledTimes(2)
  })

  it.each(['connecting', 'disconnected', 'failed'] as const)('retains superseding %s and preserves subsequent live order', type => {
    emit(connected())
    const latest: TestEvent = type === 'failed'
      ? { type, serverId: 'a', error: { code: 'not-paired', message: 'not paired', retryable: false } } : { type, serverId: 'a' }
    emit(latest)
    const listener = vi.fn(); api.onDaemonEvent(listener)
    emit(connected()); emit({ type: 'disconnected', serverId: 'a' })
    expect(listener.mock.calls).toEqual([[latest], [connected()], [{ type: 'disconnected', serverId: 'a' }]])
  })

  it('keeps stamped hosts, null and absent separate and ignores daemon ack identity', () => {
    const events: TestEvent[] = [connected('__proto__'), connected('b'),
      { type: 'connecting', serverId: null }, { type: 'disconnected' }]
    events.forEach(emit)
    const listener = vi.fn(); api.onDaemonEvent(listener)
    expect(listener.mock.calls).toEqual(events.map(event => [event]))
    expect(listener.mock.calls.at(-1)![0]).not.toHaveProperty('serverId')
  })

  it('never retains non-status events, keeps content opt-in and wraps replay receipts', () => {
    const content = { type: 'threadUpdate', serverId: 'a' } as unknown as TestEvent
    const reply = { type: 'threadReply', serverId: 'a' } as unknown as TestEvent
    emit(content); emit(reply); emit(connected())
    const receipts: unknown[] = [], runtime = vi.fn(() => receipts.push(api.chatHistoryReceipt()))
    const chrome = vi.fn(); api.onDaemonEvent(runtime, true); api.onDaemonEvent(chrome)
    expect(runtime).toHaveBeenCalledTimes(1); expect(chrome).toHaveBeenCalledTimes(1)
    expect(receipts).toEqual([{ type: 'connected', serverId: 'a' }])
    expect(api.chatHistoryReceipt()).toBeNull()
    emit(content); emit(reply)
    expect(runtime).toHaveBeenCalledTimes(3); expect(chrome).toHaveBeenCalledTimes(2)
  })
})
