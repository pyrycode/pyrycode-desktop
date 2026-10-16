import { describe, expect, it, vi } from 'vitest'
import { createThreadItemStore } from './threadItemStore'
import { createThreadRuntime } from './threadRuntime'
import type { ChatHistoryResult, ThreadHistoryPage } from '@shared/chatHistory'

const item = (id: number, rev = 1, extra = {}) => ({ id, rev, kind: 'assistant_message', order: 10,
  shown: true, summary: '', content: { text: String(id) }, ...extra })
const page = (items = [item(2)], continuation: string | null = 'YQ'): ThreadHistoryPage => ({ partial: true,
  metadata: { hostId: 'a', conversationId: 'c', epoch: 'e', version: 20, checkpoint: 10,
    repair: { fromVersion: 10, throughVersion: 20 }, olderAvailable: false },
  items, ranges: [{ start: 900, end: 1000 }], arrivalPositions: items.map(i => i.id * 10), continuation })
const deferred = () => {
  let resolve!: (value: ChatHistoryResult) => void
  return { promise: new Promise<ChatHistoryResult>(r => { resolve = r }), resolve: (v: ChatHistoryResult) => resolve(v) }
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

describe('saved held-page admission', () => {
  it('merges sparse arrivals, full revisions and clears without certifying or saving hydration', () => {
    const store = createThreadItemStore(), s = store.getState()
    s.beginLocalRead('a', 'c')!.complete(page([item(2, 2, { note: null }), item(4)]))
    const read = s.beginLocalRead('a', 'c', true)!
    expect(read).not.toBeNull()
    s.applyUpdate('a', { type: 'thread_item_added', payload: { conversation_id: 'c', epoch: 'e', version: 30,
      item: item(2, 3, { note: null }) as never } })
    s.beginBatch('a', 'c', 'e')!.commit({ fromVersion: 10, version: 40, ranges: [], olderAvailable: true })
    const before = s.snapshot('a', 'c')!
    read.complete({ ...page([item(4, 2, { note: null }), item(2, 3, { note: 'stale tie' }), item(1)], null),
      ranges: [{ start: 100, end: 200 }], arrivalPositions: [800, 20, 5] })
    const slice = store.getState().hosts.get('a')!.get('c')!
    expect(slice.snapshot.items.map(i => i.id)).toEqual([1, 2, 4])
    expect(slice.snapshot.items[1]).toMatchObject({ rev: 3, note: null })
    expect(slice.snapshot.items[2]).toMatchObject({ rev: 2, note: null })
    expect(slice.snapshot).toMatchObject({ checkpoint: before.checkpoint, version: 40,
      repair: before.repair, olderAvailable: false, ranges: [{ start: 100, end: 200 }, { start: 900, end: 1000 }] })
    expect(slice.restored).toBe(slice.snapshot)
    expect(slice.owned).toBeUndefined()
    expect(slice.residency?.traversal).toBeNull()
    expect(slice.residency?.arrivalPositions.get(4)).toBe(800)
  })
  it.each(['cancel', 'epoch', 'reset', 'delete', 'host', 'clear'] as const)('fences late held-page success after %s with reused strings', cleanup => {
    const store = createThreadItemStore(), s = store.getState()
    s.beginLocalRead('a', 'c')!.complete(page())
    const read = s.beginLocalRead('a', 'c', true)!
    if (cleanup === 'cancel') read.cancel()
    else if (cleanup === 'epoch') s.acceptEpoch('a', 'c', 'other')
    else if (cleanup === 'reset') s.acceptEpoch('a', 'c', 'e', true)
    else if (cleanup === 'delete') s.deleteConversation('a', 'c')
    else if (cleanup === 'host') s.removeHost('a')
    else s.clearAll()
    s.acceptEpoch('a', 'c', 'e')
    const before = s.snapshot('a', 'c')
    read.complete(page([item(99)])); read.fail()
    expect(s.snapshot('a', 'c')).toBe(before)
  })
})

describe('runtime local history demand', () => {
  it.each(['encryption-unavailable', 'unreadable', 'invalid-request', 'ipc-failed'] as const)('retains valid displayed content and classified %s without retry loops', async code => {
    const read = vi.fn().mockResolvedValueOnce({ status: 'page', page: page() })
    if (code === 'ipc-failed') read.mockRejectedValueOnce(Error('private IPC detail'))
    else read.mockResolvedValueOnce({ status: 'error', code })
    const log = vi.fn(), r = createThreadRuntime({ read, send: vi.fn(), log })
    try {
      await r.open('a', 'c').done
      const before = r.items.getState().snapshot('a', 'c')
      r.query('older', 'a'); await tick(); r.query('older', 'a'); await tick()
      expect(r.items.getState().snapshot('a', 'c')).toBe(before)
      expect(r.state.getState().localQueries.get('["a","c"]')).toMatchObject({ type: 'failed', reason: code })
      expect(read).toHaveBeenCalledTimes(2)
      expect(log.mock.calls.flat().some(v => JSON.stringify(v).includes('private IPC detail'))).toBe(false)
    } finally { r.dispose() }
  })
  it.each(['held', 'failed'] as const)('loads saved pages independently of a %s server reply and keeps fragmented paging at 900', async network => {
    const saved = { ...page(), metadata: { ...page().metadata, checkpoint: 20, repair: null, olderAvailable: true } }
    const older = { ...saved, items: [item(1)], arrivalPositions: [1], ranges: [{ start: 100, end: 200 }], continuation: null }
    const read = vi.fn().mockResolvedValueOnce({ status: 'page', page: saved }).mockResolvedValueOnce({ status: 'page', page: older })
    const send = vi.fn(), r = createThreadRuntime({ read, send, log: vi.fn() })
    try {
      r.event({ type: 'connected', serverId: 'a', ack: { protocol_version: 'v2', server_id: 'a', conn_id: 'link', capabilities: ['thread'] } })
      await r.open('a', 'c').done
      const request = send.mock.calls[0][0]
      if (network === 'failed') r.event({ type: 'threadQueryFailed', serverId: 'a', conversationId: 'c', requestId: request.requestId, inReplyTo: 1, reason: 'unavailable' })
      const before = r.state.getState().queries.get('["a","c"]')
      r.query('older', 'a'); await tick()
      expect(r.items.getState().snapshot('a', 'c')!.items.map(i => i.id)).toEqual([1, 2])
      expect(r.state.getState().queries.get('["a","c"]')).toBe(before)
      expect(send).toHaveBeenCalledOnce()
      if (network === 'held') {
        r.event({ type: 'threadReply', serverId: 'a', conversationId: 'c', requestId: request.requestId,
          correlation: { id: 1, ts: '' }, reply: { type: 'thread_items', payload: { conversation_id: 'c', epoch: 'e', version: 20,
            final: true, items: [], from_version: 20 } } })
        r.query('older', 'a')
        expect(send.mock.calls[1][0].query).toEqual({ type: 'thread_page', payload: { conversation_id: 'c', before_order: 900 } })
      }
    } finally { r.dispose() }
  })
  it('traverses newest despite null opening token, coalesces, retries locally and exhausts offline', async () => {
    const held = deferred(), read = vi.fn()
      .mockResolvedValueOnce({ status: 'page', page: page([item(2)], null) })
      .mockImplementationOnce(() => held.promise)
      .mockResolvedValueOnce({ status: 'error', code: 'invalid-request' })
      .mockResolvedValueOnce({ status: 'page', page: page([item(1)], null) })
    const send = vi.fn(), r = createThreadRuntime({ read, send, log: vi.fn() })
    try {
      await r.open('a', 'c').done
      r.query('older', 'a'); r.query('older', 'a')
      expect(read).toHaveBeenCalledTimes(2)
      expect(read.mock.calls[1][0]).toEqual({ operation: 'newestThreadPage', serverId: 'a', conversationId: 'c', limit: 200 })
      expect(r.state.getState().localQueries.get('["a","c"]')?.type).toBe('loading')
      held.resolve({ status: 'page', page: page([item(3)]) }); await tick()
      r.query('older', 'a'); await tick()
      expect(r.state.getState().localQueries.get('["a","c"]')?.type).toBe('failed')
      r.query('older', 'a'); expect(read).toHaveBeenCalledTimes(3)
      r.query('retry', 'a'); await tick()
      expect(read.mock.calls[3][0]).toMatchObject({ operation: 'beforeThreadPage', continuation: 'YQ' })
      expect(r.items.getState().snapshot('a', 'c')!.items.map(i => i.id)).toEqual([1, 2, 3])
      r.query('older', 'a'); expect(read).toHaveBeenCalledTimes(4)
      expect(send).not.toHaveBeenCalled()
    } finally { r.dispose() }
  })
  it.each(['navigate', 'reset', 'delete', 'unpair'] as const)('fences delayed local errors after %s', async cleanup => {
    const held = deferred(), read = vi.fn().mockResolvedValueOnce({ status: 'page', page: page() }).mockReturnValueOnce(held.promise)
    const r = createThreadRuntime({ read, send: vi.fn(), log: vi.fn() })
    try {
      const opening = r.open('a', 'c'); await opening.done; r.query('older', 'a')
      if (cleanup === 'navigate') opening.cancel()
      else if (cleanup === 'reset') r.items.getState().acceptEpoch('a', 'c', 'e', true)
      else if (cleanup === 'delete') r.event({ type: 'conversationDeleted', serverId: 'a', id: 'c' })
      else r.items.getState().removeHost('a')
      held.resolve({ status: 'error', code: 'unreadable' }); await tick()
      expect(r.state.getState().localQueries.get('["a","c"]')?.type).not.toBe('failed')
    } finally { r.dispose() }
  })
})
