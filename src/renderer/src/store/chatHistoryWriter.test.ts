import { describe, expect, it, vi } from 'vitest'
import { createConversationListStore } from './conversationListStore'
import { createThreadItemStore } from './threadItemStore'
import { createChatHistoryWriter } from './chatHistoryWriter'
import { beginChatHistoryRemoval } from './chatHistoryRemoval'
import type { ChatHistoryRequest, ChatHistoryResult } from '@shared/chatHistory'
import type { StampedDaemonEvent } from '@shared/ipc/events'
import type { ConversationSummary } from '@shared/wire/types'

const realTimeout = setTimeout
const realClearTimeout = clearTimeout

const row = (id: string): ConversationSummary => ({ id, name: id, cwd: '/', is_promoted: false,
  is_archived: false, last_message_ts: '', last_used_at: '', workspace_label: null })
function harness(write = async (_request: ChatHistoryRequest): Promise<ChatHistoryResult> => ({ status: 'ok' })) {
  const lists = createConversationListStore()
  let receipt: { type: string; serverId: string | null } | null = null
  const threads = createThreadItemStore()
  let revision = 0
  let scheduled: (() => void) | undefined
  const log = vi.fn()
  const save = vi.fn(write)
  let listener: (event: StampedDaemonEvent) => void = () => {}
  const offEvents = vi.fn(() => { listener = () => {} })
  const schedule = vi.fn((run: () => void) => { scheduled = run; return () => { scheduled = undefined } })
  const writer = createChatHistoryWriter({ lists, threads, write: save, log,
    subscribeEvents: onEvent => { listener = onEvent; return offEvents },
    receipt: () => receipt, schedule })
  const receive = (type: string, action: () => void, serverId: string | null = 'a') => {
    receipt = { type, serverId }
    try { action() } finally { receipt = null }
  }
  const list = (ids = ['chat'], serverId = 'a') => receive('conversationsReceived',
    () => lists.getState().setConversations(ids.map(row), serverId), serverId)
  const delta = (text: string, id = 'chat', serverId = 'a') => {
    const api = threads.getState(), held = api.snapshot(serverId, id)
    api.acceptEpoch(serverId, id, 'e')
    api.applyUpdate(serverId, { type: 'thread_item_added', payload: {
      conversation_id: id, epoch: 'e', version: ++revision,
      item: { id: 1, rev: revision, kind: 'assistant_message', shown: true, active: false,
        status: 'done', summary: '', content: { text: String((held?.items[0]?.content as { text: string } | undefined)?.text ?? '') + text } }
    } })
  }
  return { lists, threads, writer, save, log, receive, list, delta, offEvents, schedule,
    hasScheduled: () => scheduled !== undefined,
    event: (event: StampedDaemonEvent) => listener(event), run: () => scheduled?.() }
}

const threadRequests = (h: ReturnType<typeof harness>) => h.save.mock.calls
  .map(([request]) => request).filter(request => request.operation === 'mutateThread')

describe('chat history recording', () => {
  it('schedules owned work captured during final list settlement exactly once', async () => {
    let release: (result: ChatHistoryResult) => void = () => {}
    const acknowledged: ChatHistoryRequest[] = []
    const h = harness(request => request.operation === 'replaceList'
      ? new Promise(resolve => { release = result => { acknowledged.push(request); resolve(result) } })
      : Promise.resolve().then(() => { acknowledged.push(request); return { status: 'ok' } }))
    try {
      h.list()
      const draining = h.writer.flush()
      expect(h.save).toHaveBeenCalledOnce()
      release({ status: 'ok' })
      // The drain continuation is queued first; this publication precedes its finally cleanup.
      queueMicrotask(() => h.delta('settlement'))
      await draining
      expect(h.schedule).toHaveBeenCalledTimes(2)
      expect(h.hasScheduled()).toBe(true)
      expect(threadRequests(h)).toHaveLength(0)
      h.run()
      await vi.waitFor(() => expect(acknowledged.filter(r => r.operation === 'mutateThread')).toHaveLength(2))
      // Wait through the cursor's task yield and settlement without flushing it ourselves.
      await vi.waitFor(() => expect(h.log).toHaveBeenCalledTimes(4))
      expect(threadRequests(h).map(r => r.change.items)).toEqual([
        [], [expect.objectContaining({ id: 1, rev: 1, content: { text: 'settlement' } })]
      ])
      expect(h.hasScheduled()).toBe(false)
      expect(h.schedule).toHaveBeenCalledTimes(2)
    } finally { h.save.mockResolvedValue({ status: 'ok' }); release({ status: 'ok' }); await h.writer.stop() }
  })

  it.each(['flush', 'received'] as const)('keeps failed cursors suppressed across settlement continuations until %s', async retry => {
    let release: (result: ChatHistoryResult) => void = () => {}
    let fail = true
    const acknowledged: ChatHistoryRequest[] = []
    const h = harness(request => {
      if (request.operation === 'replaceList') return new Promise(resolve => {
        release = result => { acknowledged.push(request); resolve(result) }
      })
      if (request.operation === 'mutateThread' && request.conversationId === 'failed' && fail)
        return Promise.resolve({ status: 'error', code: 'write-failed' })
      return Promise.resolve().then(() => { acknowledged.push(request); return { status: 'ok' } })
    })
    try {
      h.delta('failed', 'failed'); h.list()
      const draining = h.writer.flush()
      await vi.waitFor(() => expect(h.save.mock.calls.at(-1)?.[0].operation).toBe('replaceList'))
      const failed = threadRequests(h)[0]
      release({ status: 'ok' })
      queueMicrotask(() => {
        h.delta(' newer', 'failed')
        h.delta('first eligible', 'good')
        h.list(['continuation'])
      })
      await draining
      expect(h.hasScheduled()).toBe(true)
      h.run()
      await vi.waitFor(() => expect(h.save.mock.calls.filter(([r]) => r.operation === 'replaceList')).toHaveLength(2))
      expect(threadRequests(h).filter(r => r.conversationId === 'failed')).toEqual([failed])
      release({ status: 'ok' })
      queueMicrotask(() => { h.delta('second eligible', 'next'); h.list(['terminal']) })
      // A task barrier allows both the queued publication and promise cleanup to finish.
      await new Promise<void>(resolve => realTimeout(resolve, 0))
      expect(h.hasScheduled()).toBe(true)
      h.run()
      // A final list submission proves the item cursors and their task yields finished.
      await vi.waitFor(() => expect(h.save.mock.calls.filter(([r]) => r.operation === 'replaceList')).toHaveLength(3))
      expect(acknowledged.filter(r => r.operation === 'mutateThread')).toHaveLength(4)
      release({ status: 'ok' })
      await new Promise<void>(resolve => realTimeout(resolve, 0))
      expect(threadRequests(h).filter(r => r.conversationId === 'failed')).toEqual([failed])
      expect(h.schedule).toHaveBeenCalledTimes(3)
      expect(h.hasScheduled()).toBe(false)
      fail = false
      if (retry === 'flush') await h.writer.flush()
      else {
        h.delta('later event', 'trigger')
        h.run()
        await vi.waitFor(() => expect(acknowledged.filter(r => r.operation === 'mutateThread' && r.conversationId === 'trigger')).toHaveLength(2))
      }
      const retried = threadRequests(h).filter(r => r.conversationId === 'failed')
      expect(retried).toHaveLength(4)
      expect(retried[1]).toEqual(failed)
      expect(retried.slice(2).flatMap(r => r.change.items.map(i => i.content?.text))).toEqual(['failed', 'failed newer'])
    } finally { h.save.mockResolvedValue({ status: 'ok' }); release({ status: 'ok' }); await h.writer.stop() }
  })

  it('does not schedule paused-only work captured during settlement', async () => {
    let release: (result: ChatHistoryResult) => void = () => {}
    const h = harness(() => new Promise(resolve => { release = resolve }))
    let resume = (_removed: boolean) => {}
    try {
      h.list()
      const draining = h.writer.flush()
      resume = beginChatHistoryRemoval('b')
      release({ status: 'ok' })
      queueMicrotask(() => h.delta('paused', 'chat', 'b'))
      await draining
      expect(h.hasScheduled()).toBe(false)
      expect(h.schedule).toHaveBeenCalledOnce()
      expect(h.save).toHaveBeenCalledOnce()
    } finally { resume(true); await h.writer.stop() }
  })

  it('allows a later received event to retry before a settlement continuation runs', async () => {
    let release: (result: ChatHistoryResult) => void = () => {}
    let fail = true
    const h = harness(request => request.operation === 'replaceList'
      ? new Promise(resolve => { release = resolve })
      : Promise.resolve(fail && request.operation === 'mutateThread' && request.conversationId === 'failed'
        ? { status: 'error', code: 'write-failed' } : { status: 'ok' }))
    try {
      h.delta('retained', 'failed'); h.list()
      const draining = h.writer.flush()
      await vi.waitFor(() => expect(h.save.mock.calls.at(-1)?.[0].operation).toBe('replaceList'))
      const failed = threadRequests(h)[0]
      release({ status: 'ok' })
      queueMicrotask(() => h.delta('eligible', 'good'))
      await draining
      expect(h.hasScheduled()).toBe(true)
      fail = false
      h.delta('later received event', 'trigger')
      h.run()
      await vi.waitFor(() => expect(threadRequests(h).filter(r => r.conversationId === 'trigger')).toHaveLength(2))
      expect(threadRequests(h).filter(r => r.conversationId === 'failed')[1]).toEqual(failed)
    } finally { h.save.mockResolvedValue({ status: 'ok' }); release({ status: 'ok' }); await h.writer.stop() }
  })

  it('does not schedule after stop in the settlement gap', async () => {
    let release: (result: ChatHistoryResult) => void = () => {}
    const h = harness(request => request.operation === 'replaceList'
      ? new Promise(resolve => { release = resolve }) : Promise.resolve({ status: 'ok' }))
    h.list()
    const draining = h.writer.flush()
    let stopping: Promise<void> | undefined
    release({ status: 'ok' })
    queueMicrotask(() => { h.delta('before stop'); stopping = h.writer.stop() })
    await draining
    await stopping
    expect(h.hasScheduled()).toBe(false)
    expect(h.schedule).toHaveBeenCalledOnce()
    expect(threadRequests(h)).toHaveLength(2)
  })

  it('flushes and stops a bounded backlog while the renderer clock stays paused', async () => {
    const h = harness()
    h.delta('seed'); await h.writer.flush(); h.save.mockClear()
    const slice = h.threads.getState().hosts.get('a')!.get('chat')!
    const items = Array.from({ length: 100 }, (_, n) => ({ id: n + 100, rev: 1, kind: 'user_message', content: { text: 'fixture' } }))
    let delivered = 0
    const turns: number[] = []
    const { port1, port2 } = new MessageChannel()
    port1.onmessage = () => { delivered++ }
    h.save.mockImplementation(async () => {
      turns.push(delivered)
      port2.postMessage(null)
      return { status: 'ok' }
    })
    let deadline: ReturnType<typeof setTimeout> | undefined
    vi.useFakeTimers()
    try {
      h.threads.setState({ hosts: new Map([['a', new Map([['chat', { ...slice,
        owned: { ...slice.owned!, acceptEpoch: false, items }
      }]])]]) })
      const completed = (async () => {
        await h.writer.flush()
        h.delta('after flush')
        await h.writer.stop()
      })()
      await Promise.race([completed, new Promise<void>((_, reject) => {
        deadline = realTimeout(() => reject(new Error('writer waited for the paused renderer clock')), 1000)
      })])
      const requests = threadRequests(h)
      expect(turns).toEqual(requests.map((_, n) => n))
      expect(delivered).toBe(requests.length)
      expect(requests.flatMap(r => r.change.items.map(i => i.id))).toEqual([...items.map(i => i.id), 1])
      expect(requests.at(-1)?.change.items[0]).toMatchObject({ id: 1, rev: 2, content: { text: 'seedafter flush' } })
      for (const { change: c } of requests) expect(c.items.length + c.removeIds.length + c.ranges.length +
        (c.priorProgress?.length ?? 0) + 1).toBeLessThanOrEqual(32)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      if (deadline !== undefined) realClearTimeout(deadline)
      await vi.runAllTimersAsync()
      vi.useRealTimers()
      await h.writer.stop()
      port1.close(); port2.close()
    }
  })
  it('coalesces distinct queued items within the same counted budget', async () => {
    const h = harness()
    h.delta('seed'); await h.writer.flush(); h.save.mockClear()
    for (let id = 2; id <= 61; id++) h.threads.getState().applyUpdate('a', { type: 'thread_item_added', payload: {
      conversation_id: 'chat', epoch: 'e', version: id,
      item: { id, rev: 1, kind: 'assistant_message', shown: true, active: false, status: 'finished', summary: '', content: {} }
    } })
    await h.writer.stop()
    const requests = threadRequests(h)
    expect(requests.length).toBeLessThan(10)
    expect(requests.flatMap(r => r.change.items.map(i => i.id))).toEqual(Array.from({ length: 60 }, (_, n) => n + 2))
    for (const { change: c } of requests)
      expect(c.items.length + (c.priorProgress?.length ?? 0) + 1).toBeLessThanOrEqual(32)
  })
  it('bounds every owned work category, yields between submissions and retries only unsaved cursors', async () => {
    let failAt = 3
    const h = harness(async () => h.save.mock.calls.length === failAt
      ? { status: 'error', code: 'write-failed' } : { status: 'ok' })
    h.delta('seed')
    await h.writer.flush()
    h.save.mockClear()
    const slice = h.threads.getState().hosts.get('a')!.get('chat')!
    const metadata = { ...slice.owned!.metadata, version: 100, checkpoint: 100 }
    const change = { ...slice.owned!, metadata, acceptEpoch: false,
      items: Array.from({ length: 75 }, (_, n) => ({ id: n + 100, rev: 1, kind: 'user_message', content: { text: 'fixture' } })),
      removeIds: Array.from({ length: 71 }, (_, n) => n + 1000),
      ranges: Array.from({ length: 69 }, (_, n) => ({ start: n * 3, end: n * 3 + 1 })),
      priorProgress: Array.from({ length: 67 }, () => ({ metadata })) }
    let beats = 0
    const { port1, port2 } = new MessageChannel()
    port1.onmessage = () => { beats++ }
    h.save.mockImplementation(async () => {
      port2.postMessage(null)
      return h.save.mock.calls.length === failAt ? { status: 'error', code: 'write-failed' } : { status: 'ok' }
    })
    h.threads.setState({ hosts: new Map([['a', new Map([['chat', { ...slice, owned: change }]])]]) })
    let failed: ChatHistoryRequest | undefined
    try {
      await h.writer.flush()
      expect(h.save).toHaveBeenCalledTimes(3)
      failed = threadRequests(h).at(-1)
      failAt = -1
      await h.writer.stop()
    } finally { port1.close(); port2.close() }
    const requests = threadRequests(h)
    expect(requests[3]).toEqual(failed)
    for (const { change: c } of requests) expect(c.items.length + c.removeIds.length + c.ranges.length +
      (c.priorProgress?.length ?? 0) + 1).toBeLessThanOrEqual(32)
    expect(new Set(requests.flatMap(r => r.change.items.map(i => i.id))).size).toBe(75)
    expect(new Set(requests.flatMap(r => r.change.removeIds)).size).toBe(71)
    expect(requests.flatMap(r => r.change.ranges)).toHaveLength(69)
    expect(requests.flatMap(r => [...r.change.priorProgress ?? [], r.change])
      .filter(p => p.metadata.checkpoint === 100)).toHaveLength(68)
    expect(beats).toBe(requests.length)
  })
  it.each(['reset', 'epoch', 'delete', 'unpair', 'failed-unpair'] as const)('fences a held bounded cursor after %s with the same chat on another host', async action => {
    let release: (result: ChatHistoryResult) => void = () => {}
    let hold = false
    const h = harness(() => hold ? new Promise(resolve => { release = resolve }) : Promise.resolve({ status: 'ok' }))
    h.delta('seed'); h.delta('other host', 'chat', 'b')
    await h.writer.flush()
    const slice = h.threads.getState().hosts.get('a')!.get('chat')!
    h.threads.setState(state => ({ hosts: new Map(state.hosts).set('a', new Map([['chat', { ...slice,
      owned: { ...slice.owned!, items: Array.from({ length: 100 }, (_, id) => ({ id: id + 100, rev: 1, kind: 'user_message' })) }
    }]])) }))
    let count = 0
    h.save.mockImplementation(async request => {
      if (request.operation === 'mutateThread' && ++count === 2) { hold = true; return new Promise(resolve => { release = resolve }) }
      return { status: 'ok' }
    })
    const flushing = h.writer.flush()
    await vi.waitFor(() => expect(hold).toBe(true))
    const boundary = h.save.mock.calls.length
    if (action === 'reset') { h.threads.getState().acceptEpoch('a', 'chat', 'e', true); h.delta('replacement') }
    if (action === 'epoch') h.threads.getState().acceptEpoch('a', 'chat', 'replacement')
    if (action === 'delete') h.event({ type: 'conversationDeleted', serverId: 'a', id: 'chat' })
    if (action === 'unpair') beginChatHistoryRemoval('a')(true)
    if (action === 'failed-unpair') beginChatHistoryRemoval('a')(false)
    release({ status: 'error', code: 'write-failed' })
    await flushing
    h.delta(' survives', 'chat', 'b')
    await h.writer.stop()
    const after = h.save.mock.calls.slice(boundary).map(([r]) => r)
    expect(after.filter(r => r.operation === 'mutateThread' && r.serverId === 'a')
      .flatMap(r => r.operation === 'mutateThread' ? r.change.items : []).some(i => i.id >= 100)).toBe(action === 'failed-unpair')
    expect(threadRequests(h).at(-1)).toMatchObject({ serverId: 'b', change: { items: [{ content: { text: 'other host survives' } }] } })
  })
  it('submits owned changes and retains failed work for a later explicit retry', async () => {
    let fail = true
    const h = harness(async () => fail ? { status: 'error', code: 'write-failed' } : { status: 'ok' })
    h.delta('owned')
    await h.writer.flush()
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.save.mock.calls[0][0]).toMatchObject({ operation: 'mutateThread', change: {
      acceptEpoch: true, items: []
    } })
    fail = false
    await h.writer.flush()
    expect(threadRequests(h).at(-1)).toMatchObject({ change: { items: [{ id: 1, content: { text: 'owned' } }] } })
    await h.writer.stop()
  })
  it('retains newer owned work through a held failure and memory-only holder loss', async () => {
    let release: (value: ChatHistoryResult) => void = () => {}
    let first = true
    const h = harness(() => {
      if (!first) return Promise.resolve({ status: 'ok' })
      first = false
      return new Promise(resolve => { release = resolve })
    })
    h.delta('one')
    const draining = h.writer.flush()
    h.delta(' two'); h.delta(' three')
    h.threads.getState().deleteConversation('a', 'chat')
    release({ status: 'error', code: 'write-failed' })
    await draining
    expect(h.save).toHaveBeenCalledTimes(1)
    await h.writer.flush()
    expect(h.save).toHaveBeenCalledTimes(5)
    expect(threadRequests(h).at(-1)).toMatchObject({ change: {
      items: [{ rev: 3, content: { text: 'one two three' } }] } })
    await h.writer.stop()
  })
  it('requires a received list receipt belonging to the changed host', async () => {
    const h = harness()
    for (const [type, serverId] of [['assistantDelta', 'a'], ['conversationsReceived', null],
      ['conversationsReceived', 'b']] as const) {
      h.receive(type, () => h.lists.getState().setConversations([row('unowned')], 'a'), serverId)
      await h.writer.flush()
      expect(h.save).not.toHaveBeenCalled()
    }
    h.list([])
    await h.writer.stop()
    expect(h.save.mock.calls.map(([request]) => request)).toEqual([
      { operation: 'replaceList', serverId: 'a', snapshot: { version: 1, kind: 'list', serverId: 'a', conversations: [] } }
    ])
  })
  it('captures confirmed coordinates without held items, a list entry or selection', async () => {
    const h = harness()
    const event: StampedDaemonEvent = { type: 'conversationDeleted', serverId: 'a', id: 'unloaded' }
    h.event(event)
    event.serverId = 'b'
    event.id = 'changed'
    await h.writer.stop()
    expect(h.save.mock.calls.map(([r]) => r)).toEqual([
      { operation: 'removeConversation', serverId: 'a', conversationId: 'unloaded' }
    ])
    expect(h.log).toHaveBeenCalledWith({ event: 'history-writer-result', code: 'conversation-removed' })
    expect(h.offEvents).toHaveBeenCalledOnce()
    h.event({ type: 'conversationDeleted', serverId: 'b', id: 'after-stop' })
    await h.writer.flush()
    expect(h.save).toHaveBeenCalledOnce()
  })

  it('retains ordered deletion when a late item holder is cleared before draining', async () => {
    const h = harness()
    h.delta('old')
    h.event({ type: 'conversationDeleted', serverId: 'a', id: 'chat' })
    h.delta('late')
    h.threads.getState().clearAll()
    await h.writer.stop()
    expect(h.save.mock.calls.map(([request]) => request)).toEqual([
      { operation: 'removeConversation', serverId: 'a', conversationId: 'chat' }
    ])
  })

  it('ignores missing origin and non-confirmation events', async () => {
    const h = harness()
    h.list()
    h.delta('kept')
    await h.writer.flush()
    h.save.mockClear()
    h.event({ type: 'conversationDeleted', serverId: null, id: 'chat' })
    h.event({ type: 'conversationsReceived', serverId: 'a', conversations: [] })
    h.receive('deleteConversation', () => {})
    h.receive('error', () => {})
    h.lists.getState().clearAllConversations()
    h.threads.getState().clearAll()
    await h.writer.stop()
    expect(h.save).not.toHaveBeenCalled()
    expect(h.log).not.toHaveBeenCalledWith({ event: 'history-writer-result', code: 'conversation-removed' })
  })

  it.each(['error', 'throw'])('reports removal %s without success or content', async mode => {
    const h = harness(async () => {
      if (mode === 'throw') throw new Error('private detail')
      return { status: 'error', code: 'remove-failed' }
    })
    h.event({ type: 'conversationDeleted', serverId: 'private host', id: 'private chat' })
    await h.writer.stop()
    expect(h.log).toHaveBeenCalledWith({ event: 'history-writer-result',
      code: mode === 'throw' ? 'ipc-failed' : 'remove-failed' })
    expect(h.log).not.toHaveBeenCalledWith({ event: 'history-writer-result', code: 'conversation-removed' })
    expect(JSON.stringify(h.log.mock.calls)).not.toContain('private')
  })

  it('pauses buffered host saves, discards them on removal and admits fresh re-pair receipts', async () => {
    const h = harness()
    h.list()
    h.delta('old')
    const settle = beginChatHistoryRemoval('a')
    h.list(['other'], 'b')
    await h.writer.flush()
    expect(h.save.mock.calls.map(([r]) => r.serverId)).toEqual(['b'])
    settle(true)
    await h.writer.flush()
    expect(h.save).toHaveBeenCalledTimes(1)
    h.list()
    h.delta('fresh')
    await h.writer.flush()
    expect(threadRequests(h).at(-1)).toMatchObject({ change: { items: [{ content: { text: 'fresh' } }] } })
    await h.writer.stop()
  })

  it('retains deletion suppression on failed unpair and releases it for fresh re-pair', async () => {
    const h = harness()
    h.list()
    h.delta('old')
    h.event({ type: 'conversationDeleted', serverId: 'a', id: 'chat' })
    await h.writer.flush()
    const failed = beginChatHistoryRemoval('a')
    failed(false)
    h.delta(' stale')
    h.list()
    await h.writer.flush()
    expect(threadRequests(h)).toHaveLength(0)
    const removed = beginChatHistoryRemoval('a')
    removed(true)
    h.list()
    h.delta('fresh')
    await h.writer.stop()
    expect(threadRequests(h).at(-1)).toMatchObject({ change: { items: [{ content: { text: 'fresh' } }] } })
  })

  it('resumes buffered history when credential removal fails', async () => {
    const h = harness()
    h.list()
    h.delta('kept')
    const settle = beginChatHistoryRemoval('a')
    await h.writer.flush()
    expect(h.save).not.toHaveBeenCalled()
    settle(false)
    await h.writer.flush()
    expect(threadRequests(h).at(-1)).toMatchObject({ change: { items: [{ content: { text: 'kept' } }] } })
    await h.writer.stop()
  })

  it.each([false, true])('settles pending removal before the shutdown flush (removed=%s)', async removed => {
    const h = harness()
    h.delta('pending at close')
    const settle = beginChatHistoryRemoval('a')
    let stopped = false
    const stopping = h.writer.stop().then(() => { stopped = true })
    await vi.waitFor(() => expect(h.save).not.toHaveBeenCalled())
    await Promise.resolve()
    expect(stopped).toBe(false)
    settle(removed)
    await stopping
    expect(h.save).toHaveBeenCalledTimes(removed ? 0 : 2)
  })

  it('does not let an in-flight save restore comparison state after successful removal', async () => {
    let release = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    const h = harness(async () => { await held; return { status: 'ok' } })
    h.list()
    const flushing = h.writer.flush()
    h.delta('buffered')
    const settle = beginChatHistoryRemoval('a')
    settle(true)
    h.list()
    release()
    await flushing
    expect(h.save.mock.calls.map(([r]) => r.operation)).toEqual(['replaceList', 'replaceList'])
    await h.writer.stop()
  })

  it('coalesces received lists in order and ignores restoration, empty startup and unchanged values', async () => {
    const h = harness()
    await h.writer.flush()
    h.lists.getState().setConversations([row('restored')], 'a')
    await h.writer.flush()
    expect(h.save).not.toHaveBeenCalled()
    h.list(['z', 'b'])
    h.list(['z', 'b'])
    expect(h.save).not.toHaveBeenCalled()
    await h.writer.flush()
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.save.mock.calls[0][0]).toMatchObject({ operation: 'replaceList', serverId: 'a',
      snapshot: { conversations: [row('z'), row('b')] } })
    h.list(['z', 'b'])
    h.lists.getState().clearAllConversations()
    await h.writer.stop()
    expect(h.save).toHaveBeenCalledTimes(1)
  })

  it('does not replace a record whose buffered changes return to its saved value', async () => {
    const h = harness()
    h.list(['saved'])
    await h.writer.flush()
    h.list(['intermediate'])
    h.list(['saved'])
    await h.writer.stop()
    expect(h.save).toHaveBeenCalledTimes(1)
  })

  it('keeps the newest content received during an in-flight write and drains it on stop', async () => {
    let release: (r: ChatHistoryResult) => void = () => {}
    let first = true
    const h = harness(() => {
      if (!first) return Promise.resolve({ status: 'ok' })
      first = false
      return new Promise((resolve) => { release = resolve })
    })
    h.delta('one')
    h.run()
    await vi.waitFor(() => expect(h.save).toHaveBeenCalledTimes(1))
    h.delta(' two')
    h.delta(' three')
    const stopped = h.writer.stop()
    release({ status: 'ok' })
    await stopped
    expect(threadRequests(h).at(-1)?.change.items[0].content).toMatchObject({ text: 'one two three' })
    h.delta(' after stop')
    h.run()
    expect(h.save).toHaveBeenCalledTimes(4)
  })

  it.each(['result', 'throw'])('contains %s failures and permits subsequent saves', async (mode) => {
    let fail = true
    const h = harness(async () => {
      if (fail && mode === 'throw') throw new Error('secret error')
      return fail ? { status: 'error', code: 'write-failed' } : { status: 'ok' }
    })
    h.delta('live')
    await h.writer.flush()
    expect(h.threads.getState().snapshot('a', 'chat')?.items[0].content).toMatchObject({ text: 'live' })
    fail = false
    h.delta(' usable')
    await h.writer.stop()
    expect(h.save).toHaveBeenCalledTimes(4)
    expect(JSON.stringify(h.log.mock.calls)).not.toContain('secret error')
    expect(JSON.stringify(h.log.mock.calls)).not.toContain('usable')
  })

})
