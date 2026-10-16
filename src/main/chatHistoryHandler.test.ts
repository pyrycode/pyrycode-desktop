import { describe, expect, it, vi } from 'vitest'
import { createChatHistoryHandler } from './chatHistoryHandler'
import { registerUnpairServerHandler } from './unpairHandler'
import type { UnpairResult } from '../shared/ipc/unpair'
import type { ChatHistoryRequest, ChatHistoryResult } from '../shared/chatHistory'

describe('chat history injected handler', () => {
  const setup = () => {
    const execute = vi.fn(async (_request: ChatHistoryRequest): Promise<ChatHistoryResult> => ({ status: 'missing' }))
    const loadById = vi.fn(async (server: string) => server === 'saved' ? { server, relay: 'secret', token: 'secret', server_static_pubkey: 'secret' } : null)
    const event = vi.fn()
    return { execute, loadById, event, handle: createChatHistoryHandler({ store: { execute }, pairedServers: { loadById }, log: { event } }) }
  }
  it('rejects malformed requests and unknown hosts before record access; accepts saved disconnected hosts', async () => {
    const h = setup()
    expect(await h.handle(null, { operation: 'readList', serverId: 'saved', name: '/secret' })).toEqual({ status: 'error', code: 'invalid-request' })
    expect(h.loadById).not.toHaveBeenCalled()
    expect(await h.handle(null, { operation: 'readList', serverId: 'unknown' })).toEqual({ status: 'error', code: 'unknown-host' })
    expect(h.execute).not.toHaveBeenCalled()
    expect(await h.handle(null, { operation: 'readList', serverId: 'saved' })).toEqual({ status: 'missing' })
    expect(h.execute).toHaveBeenCalledWith({ operation: 'readList', serverId: 'saved' })
    expect(JSON.stringify(h.event.mock.calls)).not.toContain('secret')
  })
  it('validates bounded pages before membership and authorizes saved-host opening', async () => {
    const h = setup(), request = { operation: 'openThreadPage', serverId: 'saved', conversationId: 'chat', limit: 200 }
    for (const limit of [0, -1, 201, 1.5, '200', null, Infinity])
      expect(await h.handle(null, { ...request, limit })).toEqual({ status: 'error', code: 'invalid-request' })
    expect(await h.handle(null, { ...request, path: '/private' })).toEqual({ status: 'error', code: 'invalid-request' })
    expect(h.loadById).not.toHaveBeenCalled()
    expect(await h.handle(null, { ...request, serverId: 'other' })).toEqual({ status: 'error', code: 'unknown-host' })
    expect(h.execute).not.toHaveBeenCalled()
    for (const operation of ['openThreadPage', 'newestThreadPage', 'beforeThreadPage']) {
      const page = { ...request, operation, ...(operation === 'beforeThreadPage' ? { continuation: 'opaque' } : {}) }
      expect(await h.handle(null, page)).toEqual({ status: 'missing' })
      expect(h.execute).toHaveBeenLastCalledWith(page)
    }
  })
  it('contains lookup exceptions and orders membership checks before queued removals', async () => {
    const h = setup()
    h.loadById.mockRejectedValueOnce(new Error('/secret'))
    expect(await h.handle(null, { operation: 'readList', serverId: 'saved' })).toEqual({ status: 'error', code: 'membership-unavailable' })
    let release = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    h.loadById.mockImplementationOnce(async () => { await held; return { server: 'saved', relay: '', token: '', server_static_pubkey: '' } })
    const first = h.handle(null, { operation: 'readList', serverId: 'saved' })
    const second = h.handle(null, { operation: 'removeServer', serverId: 'saved' })
    release(); await Promise.all([first, second])
    expect(h.execute.mock.calls.map((call) => call[0])).toEqual([
      { operation: 'readList', serverId: 'saved' }, { operation: 'removeServer', serverId: 'saved' }
    ])
  })
  it('guards snapshots before membership and contains storage failures for all six operations', async () => {
    const h = setup()
    expect(await h.handle(null, { operation: 'replaceList', serverId: 'saved', snapshot: { version: 1 } }))
      .toEqual({ status: 'error', code: 'invalid-request' })
    expect(h.loadById).not.toHaveBeenCalled()
    const snapshots = {
      list: { version: 1, kind: 'list', serverId: 'saved', conversations: [] },
      timeline: { version: 1, kind: 'timeline', serverId: 'saved', conversationId: 'chat', items: [], prependedRows: 0, coverage: { status: 'unknown' } }
    }
    for (const operation of ['readList', 'readTimeline', 'replaceList', 'replaceTimeline', 'removeConversation', 'removeServer']) {
      const request = { operation, serverId: 'saved',
        ...(['readTimeline', 'replaceTimeline', 'removeConversation'].includes(operation) ? { conversationId: 'chat' } : {}),
        ...(operation === 'replaceList' ? { snapshot: snapshots.list } : operation === 'replaceTimeline' ? { snapshot: snapshots.timeline } : {}) }
      h.execute.mockRejectedValueOnce(new Error('/secret token private-content'))
      expect(await h.handle(null, request)).toEqual({ status: 'error', code: operation.startsWith('read') ? 'unreadable'
        : operation.startsWith('replace') ? 'write-failed' : 'remove-failed' })
      expect(await h.handle(null, request)).toEqual({ status: 'missing' })
    }
    expect(JSON.stringify(h.event.mock.calls)).not.toMatch(/secret|token|private-content/)
  })

  it('orders credential removal behind held membership and rejects queued old requests after re-pair', async () => {
    const h = setup()
    let release = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    h.loadById.mockImplementationOnce(async () => { await held; return { server: 'saved', relay: '', token: '', server_static_pubkey: '' } })
    const first = h.handle(null, { operation: 'readList', serverId: 'saved' })
    const clear = vi.fn(async () => ({ matched: true, remaining: 0 }))
    const removing = h.handle.clearServer('saved', clear)
    const stale = h.handle(null, { operation: 'readList', serverId: 'saved' })
    await Promise.resolve()
    expect(clear).not.toHaveBeenCalled()
    release()
    await first
    expect(await removing).toEqual({ matched: true, remaining: 0 })
    expect(await stale).toEqual({ status: 'error', code: 'unknown-host' })
    expect(h.execute.mock.calls.map(([r]) => r.operation)).toEqual(['readList', 'removeServer'])
    expect(await h.handle(null, { operation: 'readList', serverId: 'saved' })).toEqual({ status: 'missing' })
  })

  it('retains history on failed or unmatched credential removal and contains cleanup failures', async () => {
    const h = setup()
    await expect(h.handle.clearServer('saved', async () => { throw new Error('private-credential') })).rejects.toThrow()
    expect(await h.handle.clearServer('saved', async () => ({ matched: false, remaining: 1 })))
      .toEqual({ matched: false, remaining: 1 })
    expect(h.execute).not.toHaveBeenCalled()
    for (const throws of [false, true]) {
      if (throws) h.execute.mockRejectedValueOnce(new Error('private-content'))
      else h.execute.mockResolvedValueOnce({ status: 'error', code: 'remove-failed' })
      expect(await h.handle.clearServer('saved', async () => ({ matched: true, remaining: 0 })))
        .toEqual({ matched: true, remaining: 0 })
    }
    h.execute.mockResolvedValueOnce({ status: 'ok' })
    await h.handle.clearServer('saved', async () => ({ matched: true, remaining: 0 }))
    expect(h.event.mock.calls.filter(([e]) => e.event === 'history-unpair-cleanup')).toEqual([
      [{ event: 'history-unpair-cleanup', code: 'failed' }],
      [{ event: 'history-unpair-cleanup', code: 'failed' }],
      [{ event: 'history-unpair-cleanup', code: 'ok' }]
    ])
    expect(JSON.stringify(h.event.mock.calls)).not.toMatch(/saved|private-/)
  })

  it('invalidates queued conversation work while allowing fresh identical coordinates', async () => {
    const h = setup()
    h.execute.mockResolvedValue({ status: 'ok' })
    const remove = h.handle(null, { operation: 'removeConversation', serverId: 'saved', conversationId: 'chat' })
    const stale = h.handle(null, { operation: 'readTimeline', serverId: 'saved', conversationId: 'chat' })
    const staleList = h.handle(null, { operation: 'replaceList', serverId: 'saved', snapshot: {
      version: 1, kind: 'list', serverId: 'saved', conversations: [{ id: 'chat', name: null, cwd: '/',
        is_promoted: false, is_archived: false, last_message_ts: '', last_used_at: '', workspace_label: null }] } })
    const peer = h.handle(null, { operation: 'readTimeline', serverId: 'saved', conversationId: 'peer' })
    await remove
    expect(await stale).toEqual({ status: 'error', code: 'unknown-host' })
    expect(await staleList).toEqual({ status: 'error', code: 'unknown-host' })
    expect(await peer).toEqual({ status: 'ok' })
    expect(await h.handle(null, { operation: 'readTimeline', serverId: 'saved', conversationId: 'chat' })).toEqual({ status: 'ok' })
  })

  it('composes cleanup failure with successful unpair and connection teardown', async () => {
    const h = setup()
    h.execute.mockResolvedValue({ status: 'error', code: 'remove-failed' })
    let listener: (_event: unknown, request: unknown) => Promise<UnpairResult> = async () => ({ result: 'error' })
    const onUnpaired = vi.fn()
    const clearFor = vi.fn(async () => {})
    registerUnpairServerHandler({ handle: (_channel, handle) => { listener = handle }, removeHandler: () => {} }, {
      store: { clearServer: id => h.handle.clearServer(id, async () => ({ matched: true, remaining: 0 })) },
      onUnpaired, hostLabel: { clearFor }
    })
    expect(await listener(null, { serverId: 'saved' })).toEqual({ result: 'ok' })
    expect(onUnpaired).toHaveBeenCalledOnce()
    expect(clearFor).toHaveBeenCalledWith('saved')
    expect(h.event).toHaveBeenCalledWith({ event: 'history-unpair-cleanup', code: 'failed' })
  })
})
