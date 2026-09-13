import { describe, expect, it, vi } from 'vitest'
import type { ChatHistoryResult } from '@shared/chatHistory'
import { createConversationListStore } from './conversationListStore'
import { createServerInfoStore } from './serverInfoStore'
import { createSavedListRestorer } from './savedListRestorer'
import { createChatHistoryWriter } from './chatHistoryWriter'
import { createConversationTimelineStore } from './conversationTimelineStore'

const row = (id = 'same') => ({ id, name: '<saved>', is_promoted: false, is_archived: false,
  cwd: '/workspace', last_message_ts: '', last_used_at: '', workspace_label: null })
const stored = (serverId = 'a', conversations = [row()]): ChatHistoryResult => ({
  status: 'stored', snapshot: { version: 1, kind: 'list', serverId, conversations }
})
const tick = async () => { await Promise.resolve(); await Promise.resolve() }
function setup() {
  const lists = createConversationListStore()
  const servers = createServerInfoStore()
  const pending = new Map<string, { resolve: (r: ChatHistoryResult) => void; reject: () => void }>()
  const read = vi.fn(({ serverId }: { serverId: string }) => new Promise<ChatHistoryResult>((resolve, reject) => {
    pending.set(serverId, { resolve, reject: () => reject(new Error('private error')) })
  }))
  const log = vi.fn()
  const stop = createSavedListRestorer({ lists, servers, read, log })
  const saved = (...ids: string[]) => servers.getState().setServers(ids.map(serverId => ({ serverId, relayUrl: '' })))
  return { lists, servers, pending, read, log, stop, saved }
}

describe('saved list restoration', () => {
  it('restores saved identities in row order with equal ids isolated and records no content', async () => {
    const s = setup()
    const write = vi.fn(async () => ({ status: 'ok' as const }))
    let receipt: { type: string; serverId: string } | null = null
    const writer = createChatHistoryWriter({ lists: s.lists, timelines: createConversationTimelineStore(),
      receipt: () => receipt, write, log: vi.fn(), schedule: () => () => {} })
    s.saved('a', '__proto__')
    s.pending.get('a')!.resolve(stored('a', [row('z'), row('same'), row('a')]))
    s.pending.get('__proto__')!.resolve(stored('__proto__'))
    await tick()
    expect(s.lists.getState().byServer.get('a')?.map(r => r.id)).toEqual(['z', 'same', 'a'])
    expect(s.lists.getState().byServer.get('__proto__')).toEqual([{ ...row(), serverId: '__proto__' }])
    expect(s.lists.getState().localListReads.get('a')).toBe('loaded')
    s.saved('a', '__proto__')
    expect(s.read.mock.calls).toEqual([[{ operation: 'readList', serverId: 'a' }],
      [{ operation: 'readList', serverId: '__proto__' }]])
    s.lists.getState().clearAllConversations()
    await writer.flush()
    expect(write).not.toHaveBeenCalled()
    receipt = { type: 'conversationsReceived', serverId: 'a' }
    s.lists.getState().setConversations([row('received')], 'a')
    receipt = null
    await writer.stop()
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ operation: 'replaceList', serverId: 'a' }))
    expect(JSON.stringify(s.log.mock.calls)).not.toContain('<saved>')
    s.stop()
  })

  it.each(['missing', 'empty', 'error', 'rejected', 'wrong-host', 'wrong-kind', 'ok'])(
    'settles %s independently of another host', async kind => {
      const s = setup()
      s.saved('a', 'b')
      const b = [row('live')]
      s.lists.getState().setConversations(b, 'b')
      const kept = s.lists.getState().byServer.get('b')
      const results: Record<string, ChatHistoryResult> = {
        missing: { status: 'missing' }, empty: stored('a', []),
        error: { status: 'error', code: 'unreadable' }, 'wrong-host': stored('b'),
        'wrong-kind': { status: 'stored', snapshot: { version: 1, kind: 'timeline', serverId: 'a',
          conversationId: 'same', items: [], prependedRows: 0, coverage: { status: 'unknown' } } },
        ok: { status: 'ok' }
      }
      if (kind === 'rejected') s.pending.get('a')!.reject()
      else s.pending.get('a')!.resolve(results[kind])
      await tick()
      const success = kind === 'missing' || kind === 'empty'
      expect(s.lists.getState().localListReads.get('a')).toBe(success ? 'loaded' : 'failed')
      expect(s.lists.getState().byServer.get('a')).toEqual(success ? [] : undefined)
      expect(s.lists.getState().byServer.get('b')).toBe(kept)
      expect(JSON.stringify(s.log.mock.calls)).not.toContain('private error')
      s.stop()
    })

  for (const boundary of ['received', 'host-clear', 'global-clear', 'removed', 'stop'] as const) {
    it.each(['success', 'failure'])(`ignores delayed %s after ${boundary}`, async result => {
      const s = setup()
      s.saved('a', 'b')
      s.pending.get('b')!.resolve(stored('b'))
      await tick()
      const b = s.lists.getState().byServer.get('b')
      if (boundary === 'received') s.lists.getState().setConversations([row('new')], 'a')
      if (boundary === 'host-clear') s.lists.getState().clearConversationsFor('a')
      if (boundary === 'global-clear') s.lists.getState().clearAllConversations()
      if (boundary === 'removed') s.saved('b')
      if (boundary === 'stop') s.stop()
      const before = s.lists.getState()
      if (result === 'success') s.pending.get('a')!.resolve(stored())
      else s.pending.get('a')!.reject()
      await tick()
      expect(s.lists.getState()).toBe(before)
      if (boundary !== 'global-clear') expect(s.lists.getState().byServer.get('b')).toBe(b)
      s.stop()
    })
  }

  it('does not read a received list and admits a retry after teardown cancellation', async () => {
    const s = setup()
    s.lists.getState().setConversations([], 'a')
    s.saved('a', 'b')
    expect(s.read).toHaveBeenCalledTimes(1)
    expect(s.lists.getState().beginLocalListRead('b')).toBeNull()
    s.stop()
    const handle = s.lists.getState().beginLocalListRead('b')!
    handle.complete([row()])
    expect(s.lists.getState().byServer.get('b')).toHaveLength(1)
    s.pending.get('b')!.resolve(stored('b', [row('stale')]))
    await tick()
    expect(s.lists.getState().byServer.get('b')?.[0].id).toBe('same')
  })
})
