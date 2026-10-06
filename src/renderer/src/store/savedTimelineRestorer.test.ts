import { describe, expect, it, vi } from 'vitest'
import type { ChatHistorySnapshot, ChatHistoryResult } from '@shared/chatHistory'
import { createConversationTimelineStore } from './conversationTimelineStore'
import { readSavedTimeline } from './savedTimelineRestorer'

const snapshot = (serverId = 'a', conversationId = 'chat'): Extract<ChatHistorySnapshot, { kind: 'timeline' }> => ({
  version: 1, kind: 'timeline', serverId, conversationId, prependedRows: 7,
  coverage: { status: 'received', cursor: 'oldest', atStart: false },
  items: [{ kind: 'userText', text: 'first saved row', messageId: 'saved-id', createdAt: 123 },
    { kind: 'assistantText', turnId: 'turn', text: `${serverId} saved` }]
})
const deferred = () => {
  let resolve!: (result: ChatHistoryResult) => void
  const promise = new Promise<ChatHistoryResult>(r => { resolve = r })
  return { promise, resolve }
}

describe('local timeline admission', () => {
  it.each(['stored', 'missing', 'invalid', 'failure'] as const)(
    'settles a pending %s read after reconnect without restoring the cleared notice', outcome => {
      const store = createConversationTimelineStore(undefined, () => 'a')
      store.getState().dispatchFor('chat', { type: 'sessionError', code: 'session.blocked' })
      const read = store.getState().beginLocalTimelineRead('a', 'chat')!
      store.getState().clearSessionErrorsForHost('a')
      expect(store.getState().timelines.get('chat')?.timeline.sessionError).toBeUndefined()
      if (outcome === 'failure') read.fail()
      else read.complete(outcome === 'stored' ? snapshot() : outcome === 'missing' ? null : snapshot('other-host'))
      const settled = store.getState().timelines.get('chat')!
      expect(settled.localRead).toBe(outcome === 'failure' || outcome === 'invalid' ? 'failed' : 'loaded')
      expect(settled.timeline.items).toEqual(outcome === 'stored' ? snapshot().items : [])
      expect(settled.timeline.sessionError).toBeUndefined()
      // A completed handle cannot later change the settled state.
      const before = store.getState()
      read.fail()
      read.complete(snapshot())
      expect(store.getState()).toBe(before)
    }
  )

  it.each([false, true])('notice replacement and client clearing retain read ownership (fail=%s)', fail => {
    let host = 'a'
    const store = createConversationTimelineStore(undefined, () => host)
    const read = store.getState().beginLocalTimelineRead('a', 'chat')!
    store.getState().dispatchFor('chat', { type: 'sessionError', code: 'session.blocked' })
    store.getState().dispatchFor('chat', { type: 'sessionError', code: 'session.child_crashing' })
    expect(store.getState().timelines.get('chat')?.localRead).toBe('loading')
    host = 'b'
    store.getState().dispatchFor('chat', { type: 'sessionErrorCleared' })
    if (fail) read.fail(); else read.complete(snapshot())
    const settled = store.getState().timelines.get('chat')!
    expect(settled.serverId).toBe('a')
    expect(settled.localRead).toBe(fail ? 'failed' : 'loaded')
    expect(settled.timeline.sessionError).toBeUndefined()
    expect(settled.timeline.items).toEqual(fail ? [] : snapshot().items)
  })

  it('completion carries the latest notice instead of the notice present when the read began', () => {
    const store = createConversationTimelineStore(undefined, () => 'a')
    store.getState().dispatchFor('chat', { type: 'sessionError', code: 'session.blocked' })
    const read = store.getState().beginLocalTimelineRead('a', 'chat')!
    store.getState().dispatchFor('chat', { type: 'sessionError', code: 'session.child_crashing' })
    read.complete(snapshot())
    expect(store.getState().timelines.get('chat')?.timeline.sessionError).toEqual({ code: 'session.child_crashing' })
    expect(store.getState().timelines.get('chat')?.timeline.items).toEqual(snapshot().items)
  })

  it('retains host-stamped local echoes on reopen without admitting them to another host', () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchLocalEcho('a', 'chat', {
      type: 'userText', text: 'composed here', messageId: 'local'
    })
    const held = store.getState().timelines.get('chat')
    expect(held?.serverId).toBe('a')
    expect(store.getState().beginLocalTimelineRead('a', 'chat')).toBeNull()
    expect(store.getState().timelines.get('chat')).toBe(held)
    const other = store.getState().beginLocalTimelineRead('b', 'chat')!
    expect(store.getState().timelines.get('chat')?.timeline.items).toEqual([])
    other.complete(snapshot('b'))
    expect(store.getState().timelines.get('chat')?.timeline.items).toEqual(snapshot('b').items)
  })

  it('local echoes replace a differently owned slice and invalidate a pending local read', () => {
    const store = createConversationTimelineStore()
    store.getState().beginLocalTimelineRead('b', 'chat')!.complete(snapshot('b'))
    store.getState().dispatchLocalEcho('a', 'chat', {
      type: 'userText', text: 'own echo', messageId: 'local'
    })
    expect(store.getState().timelines.get('chat')?.timeline.items).toMatchObject([{ text: 'own echo' }])
    const pending = store.getState().beginLocalTimelineRead('b', 'chat')!
    store.getState().dispatchLocalEcho('b', 'chat', {
      type: 'userText', text: 'newer echo', messageId: 'new'
    })
    pending.complete(snapshot('b'))
    expect(store.getState().timelines.get('chat')?.timeline.items).toMatchObject([{ text: 'newer echo' }])
  })

  it('installs only durable rows, preserving order, coverage and row identity metadata', () => {
    const store = createConversationTimelineStore()
    const read = store.getState().beginLocalTimelineRead('a', 'chat')!
    read.complete(snapshot())
    const slice = store.getState().timelines.get('chat')!
    expect(slice.timeline.items).toEqual(snapshot().items)
    expect(slice.prependedRows).toBe(7)
    expect(slice.restored?.coverage).toEqual(snapshot().coverage)
    expect(slice.timeline.phase).toBe('idle')
    expect(slice.timeline.refusalOffer).toBeUndefined()
    expect(store.getState().beginLocalTimelineRead('a', 'chat')).toBeNull()
  })

  it.each(['clear', 'clearAll', 'receive', 'evict', 'cancel'] as const)('ignores delayed success and failure after %s', action => {
    for (const fail of [false, true]) {
      const store = createConversationTimelineStore()
      const handle = store.getState().beginLocalTimelineRead('a', 'chat')!
      if (action === 'clear') store.getState().clearTimelineFor('chat')
      if (action === 'clearAll') store.getState().clearAllTimelines()
      if (action === 'receive') store.getState().dispatchFor('chat', {
        type: 'assistantDelta', turnId: 'new', seq: 0, text: 'new receipt'
      })
      if (action === 'evict') for (let i = 0; i < 10; i++) store.getState().markViewed(String(i))
      if (action === 'cancel') handle.cancel()
      const before = store.getState()
      if (fail) handle.fail(); else handle.complete(snapshot())
      expect(store.getState()).toBe(before)
    }
  })

  it('isolates equal ids and reloads the first of eleven saved chats after eviction', () => {
    const store = createConversationTimelineStore()
    for (let i = 0; i < 11; i++) store.getState().beginLocalTimelineRead('a', String(i))!.complete(snapshot('a', String(i)))
    expect(store.getState().timelines.size).toBe(10)
    expect(store.getState().timelines.has('0')).toBe(false)
    store.getState().beginLocalTimelineRead('a', '0')!.complete(snapshot('a', '0'))
    const a = store.getState().beginLocalTimelineRead('a', 'chat')!
    const b = store.getState().beginLocalTimelineRead('b', 'chat')!
    a.complete(snapshot())
    b.complete(snapshot('b'))
    expect(store.getState().timelines.get('chat')?.timeline.items).toEqual(snapshot('b').items)
    store.getState().beginLocalTimelineRead('a', 'chat')!.complete(snapshot())
    expect(store.getState().timelines.get('chat')?.serverId).toBe('a')
  })

  it('never appends another supplying host onto restored rows', () => {
    let host = 'a'
    const store = createConversationTimelineStore(undefined, () => host)
    store.getState().beginLocalTimelineRead('a', 'chat')!.complete(snapshot())
    host = 'b'
    store.getState().dispatchFor('chat', { type: 'assistantDelta', turnId: 'turn', seq: 0, text: 'b live' })
    expect(store.getState().timelines.get('chat')).toMatchObject({ serverId: 'b',
      timeline: { items: [{ text: 'b live' }] } })
    expect(store.getState().timelines.get('chat')?.restored).toBeUndefined()
    store.getState().beginLocalTimelineRead('a', 'chat')!.complete(snapshot())
    expect(store.getState().timelines.get('chat')?.timeline.items).toEqual(snapshot().items)
  })
})

describe('injected saved timeline reads', () => {
  it('performs another disk read only when a held saved copy was evicted', async () => {
    const timelines = createConversationTimelineStore()
    const read = vi.fn(async (request): Promise<ChatHistoryResult> => ({ status: 'stored',
      snapshot: snapshot(request.serverId, request.conversationId) }))
    const deps = { timelines, read, log: vi.fn() }
    for (let i = 0; i < 11; i++) await readSavedTimeline(deps, 'a', String(i)).done
    await readSavedTimeline(deps, 'a', '10').done
    expect(read).toHaveBeenCalledTimes(11)
    await readSavedTimeline(deps, 'a', '0').done
    expect(read).toHaveBeenCalledTimes(12)
    expect(timelines.getState().timelines.size).toBe(10)
    expect(timelines.getState().timelines.get('0')?.timeline.items).toEqual(snapshot('a', '0').items)
  })

  it.each([false, true])('distinguishes a successful empty read (stored=%s)', async stored => {
    const timelines = createConversationTimelineStore()
    await readSavedTimeline({ timelines, read: async () => stored
      ? { status: 'stored', snapshot: { ...snapshot(), items: [] } } : { status: 'missing' }, log: vi.fn() }, 'a', 'chat').done
    expect(timelines.getState().timelines.get('chat')?.localRead).toBe('loaded')
    expect(timelines.getState().timelines.get('chat')?.timeline.items).toEqual([])
  })

  it.each(['error', 'reject', 'wrongHost', 'wrongChat', 'wrongKind', 'ok'] as const)('shows a local failure for %s', kind => {
    const timelines = createConversationTimelineStore()
    const read = async (): Promise<ChatHistoryResult> => {
      if (kind === 'reject') throw Error('private content')
      if (kind === 'error') return { status: 'error', code: 'unreadable' }
      if (kind === 'ok') return { status: 'ok' }
      if (kind === 'wrongKind') return { status: 'stored', snapshot: { version: 1, kind: 'list', serverId: 'a', conversations: [] } }
      return { status: 'stored', snapshot: snapshot(kind === 'wrongHost' ? 'b' : 'a', kind === 'wrongChat' ? 'other' : 'chat') }
    }
    const log = vi.fn()
    return readSavedTimeline({ timelines, read, log }, 'a', 'chat').done.then(() => {
      expect(timelines.getState().timelines.get('chat')?.localRead).toBe('failed')
      expect(JSON.stringify(log.mock.calls)).not.toContain('private content')
    })
  })

  it('cancels navigation without changing another selection or saving', async () => {
    const timelines = createConversationTimelineStore()
    const pending = deferred()
    const read = vi.fn(() => pending.promise)
    const task = readSavedTimeline({ timelines, read, log: vi.fn() }, 'a', 'chat')
    expect(read).toHaveBeenCalledWith({ operation: 'readTimeline', serverId: 'a', conversationId: 'chat' })
    task.cancel()
    timelines.getState().markViewed('other')
    const before = timelines.getState()
    pending.resolve({ status: 'stored', snapshot: snapshot() })
    await task.done
    expect(timelines.getState()).toBe(before)
  })
})
