import { afterEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ElectronApplication } from '@playwright/test'
import { installPagingDurabilityEvidence } from './pagingDurabilityEvidence'

afterEach(() => {
  for (const key of ['__pagingDurability', '__observePagingWriter', '__pagingWriterObservations', '__observeProtectedPaging', '__observePagingAdmission']) delete (globalThis as any)[key]
})

it('observes exact owners and split acknowledgements without exposing content or changing IPC', async () => {
  const ipcMain = Object.assign(new EventEmitter(), {
    _invokeHandlers: new Map<string, Function>(),
    removeHandler(channel: string) { this._invokeHandlers.delete(channel) },
    handle(channel: string, handler: Function) { this._invokeHandlers.set(channel, handler) }
  })
  const result = { status: 'ok' }
  const original = vi.fn(async (_event: unknown, request: unknown) => {
    ;(globalThis as any).__observePagingAdmission('admitted', request)
    ;(globalThis as any).__observePagingAdmission('storage-completed', request, result)
    return result
  })
  ipcMain.handle('pyry:chat-history', original)
  const sent = vi.fn()
  const contents = { send: sent }
  const app = { evaluate: async (fn: Function, owner: unknown) => fn({ ipcMain,
    webContents: { getAllWebContents: () => [contents] } }, owner) } as Pick<ElectronApplication, 'evaluate'>
  const page = { evaluate: async (fn: Function, owner: unknown) => fn(owner) } as any
  await installPagingDurabilityEvidence(app, 'host-secret', 'chat-secret', page)
  const handler = ipcMain._invokeHandlers.get('pyry:chat-history')!
  await installPagingDurabilityEvidence(app, 'host-secret', 'chat-secret')
  expect(ipcMain._invokeHandlers.get('pyry:chat-history')).toBe(handler)
  expect(ipcMain.listenerCount('pyry:command')).toBe(1)
  const reply = { type: 'threadReply', serverId: 'host-secret', conversationId: 'chat-secret',
    reply: { type: 'thread_items', payload: { conversation_id: 'chat-secret', epoch: 'epoch-secret', final: true, items: ['content-secret'] } } }
  contents.send('pyry:daemon-event', reply)
  expect(sent).toHaveBeenCalledWith('pyry:daemon-event', reply)
  ipcMain.emit('pyry:command', {}, { type: 'queryThread', serverId: 'host-secret',
    query: { type: 'thread_page', payload: { conversation_id: 'chat-secret', epoch: 'epoch-secret' } } })
  const request = (part: number) => ({ operation: 'mutateThread', serverId: 'host-secret', conversationId: 'chat-secret',
    change: { metadata: { hostId: 'host-secret', conversationId: 'chat-secret', epoch: 'epoch-secret' }, items: ['content-secret'],
      persistence: { id: 'persistence-secret', part, parts: 2 } } })
  const first = request(0), second = request(1)
  const observe = (globalThis as any).__observePagingWriter
  observe('published', first)
  observe('queued', first, { running: true, scheduled: false })
  observe('yielded', first)
  observe('resumed', first)
  observe('queued', { ...first, serverId: 'peer' })
  const rendererTrace = (globalThis as any).__pagingWriterObservations
  expect(rendererTrace.map((e: any) => e.stage)).toEqual(['published', 'queued', 'yielded', 'resumed'])
  expect(rendererTrace.every((e: any) => e.sameOwner && e.sameEpoch)).toBe(true)
  expect(rendererTrace[1]).toMatchObject({ running: true, scheduled: false })
  expect(await handler({}, first)).toBe(result)
  expect(await handler({}, second)).toBe(result)
  expect(original.mock.calls.map(call => call[1])).toEqual([first, second])
  const trace = (globalThis as any).__pagingDurability.observations
  const observeHeader = (globalThis as any).__observeProtectedPaging
  observeHeader('peer', 'chat-secret', { metadata: {} })
  observeHeader('host-secret', 'chat-secret', { metadata: first.change.metadata,
    persistence: { id: 'persistence-secret', next: 1, parts: 2 } })
  expect(trace.at(-1)).toMatchObject({ stage: 'protected-header', sameOwner: true, sameEpoch: true, pending: true, next: 1, parts: 2 })
  expect(trace.find((e: any) => e.stage === 'received')).toMatchObject({ sameOwner: true })
  expect(trace.find((e: any) => e.stage === 'request')).toMatchObject({ sameEpoch: true })
  expect(trace.filter((e: any) => e.stage === 'acknowledged').map((e: any) => e.completed)).toEqual([false, true])
  expect(trace.filter((e: any) => e.stage === 'acknowledged').map((e: any) => e.pendingSaves)).toEqual([1, 0])
  expect(trace.filter((e: any) => e.stage === 'submitted').map((e: any) => [e.sameEpoch, e.save])).toEqual([[true, 1], [true, 1]])
  expect(trace.filter((e: any) => e.stage === 'admitted').map((e: any) => [e.save, e.part])).toEqual([[1, 0], [1, 1]])
  expect(trace.filter((e: any) => e.stage === 'storage-completed').every((e: any) => e.status === 'ok' && e.sameOwner && e.sameEpoch)).toBe(true)
  // A previously accepted prefix replay cannot imply a new pending obligation.
  await handler({}, first)
  expect(trace.at(-1)).toMatchObject({ stage: 'acknowledged', pendingSaves: 0 })
  const count = trace.length
  await handler({}, { ...first, serverId: 'peer' })
  await handler({}, { ...first, conversationId: 'peer' })
  expect(trace).toHaveLength(count)
  for (const value of ['host-secret', 'chat-secret', 'epoch-secret', 'persistence-secret', 'content-secret'])
    expect(JSON.stringify([trace, rendererTrace])).not.toContain(value)
})

it.each([false, true])('retains a classified failure and committed prefix=%s without retrying a mutation', async prefix => {
  const handlers = new Map<string, Function>()
  const failure = { status: 'error', code: 'write-failed' }
  const original = vi.fn(async (): Promise<{ status: string; code?: string }> => failure)
  handlers.set('pyry:chat-history', original)
  const ipcMain = Object.assign(new EventEmitter(), { _invokeHandlers: handlers,
    removeHandler: (channel: string) => handlers.delete(channel),
    handle: (channel: string, fn: Function) => handlers.set(channel, fn) })
  const app = { evaluate: async (fn: Function, owner: unknown) => fn({ ipcMain,
    webContents: { getAllWebContents: () => [] } }, owner) } as Pick<ElectronApplication, 'evaluate'>
  await installPagingDurabilityEvidence(app, 'host', 'chat')
  const request = { operation: 'mutateThread', serverId: 'host', conversationId: 'chat',
    change: { metadata: { epoch: 'epoch' }, items: [], persistence: { id: 'private-save', part: 0, parts: 2 } } }
  if (prefix) {
    original.mockResolvedValueOnce({ status: 'ok' })
    await handlers.get('pyry:chat-history')!({}, request)
  }
  expect(await handlers.get('pyry:chat-history')!({}, { ...request,
    change: { ...request.change, persistence: { ...request.change.persistence, part: prefix ? 1 : 0 } } })).toBe(failure)
  expect(original).toHaveBeenCalledTimes(prefix ? 2 : 1)
  expect((globalThis as any).__pagingDurability.observations.at(-1)).toMatchObject({ stage: 'acknowledged', status: 'error',
    code: 'write-failed', completed: false, pendingSaves: prefix ? 1 : 0 })
})
