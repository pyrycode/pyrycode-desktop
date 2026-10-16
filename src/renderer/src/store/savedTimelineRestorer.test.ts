import { describe, expect, it } from 'vitest'
import type { ChatHistorySnapshot } from '@shared/chatHistory'
import { createConversationTimelineStore } from './conversationTimelineStore'

const snapshot = (serverId = 'a', conversationId = 'chat'): Extract<ChatHistorySnapshot, { kind: 'timeline' }> => ({
  version: 1, kind: 'timeline', serverId, conversationId, prependedRows: 7,
  coverage: { status: 'received', cursor: 'oldest', atStart: false },
  items: [{ kind: 'userText', text: 'first saved row', messageId: 'saved-id', createdAt: 123 },
    { kind: 'assistantText', turnId: 'turn', text: `${serverId} saved` }]
})
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

  it.each([false, true])('restored keys survive live output and history prepends (history first=%s)', historyFirst => {
    const store = createConversationTimelineStore(undefined, () => 'a')
    store.getState().beginLocalTimelineRead('a', 'chat')!.complete(snapshot())
    const restored = store.getState().timelines.get('chat')!.timeline
    expect(restored.rowKeys).toEqual([-7, -6])
    const live = () => store.getState().dispatchFor('chat', { type: 'assistantDelta', turnId: 'live', seq: 0, text: 'new' })
    const prepend = () => store.getState().prependHistoryFor('chat', [{ kind: 'userText', text: 'older' }])
    for (const update of historyFirst ? [prepend, live] : [live, prepend]) {
      update()
      const current = store.getState().timelines.get('chat')!.timeline
      restored.items.forEach((item, i) => expect(current.rowKeys?.[current.items.indexOf(item)]).toBe(restored.rowKeys?.[i]))
      expect(new Set(current.rowKeys).size).toBe(current.items.length)
    }
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
