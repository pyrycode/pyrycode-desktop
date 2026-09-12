import { describe, expect, it, vi } from 'vitest'
import { createChatHistoryHandler } from './chatHistoryHandler'
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
})
