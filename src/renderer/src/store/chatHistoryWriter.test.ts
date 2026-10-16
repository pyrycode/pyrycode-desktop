import { describe, expect, it, vi } from 'vitest'
import { createConversationListStore } from './conversationListStore'
import { createThreadItemStore } from './threadItemStore'
import { createChatHistoryWriter } from './chatHistoryWriter'
import { beginChatHistoryRemoval } from './chatHistoryRemoval'
import type { ChatHistoryRequest, ChatHistoryResult } from '@shared/chatHistory'
import type { StampedDaemonEvent } from '@shared/ipc/events'
import type { ConversationSummary } from '@shared/wire/types'

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
  const writer = createChatHistoryWriter({ lists, threads, write: save, log,
    subscribeEvents: onEvent => { listener = onEvent; return offEvents },
    receipt: () => receipt, schedule: (run) => { scheduled = run; return () => { scheduled = undefined } } })
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
  return { lists, threads, writer, save, log, receive, list, delta, offEvents,
    event: (event: StampedDaemonEvent) => listener(event), run: () => scheduled?.() }
}

const threadRequests = (h: ReturnType<typeof harness>) => h.save.mock.calls
  .map(([request]) => request).filter(request => request.operation === 'replaceThread')

describe('chat history recording', () => {
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
    expect(threadRequests(h)).toMatchObject([{ snapshot: { thread: { items: [{ content: { text: 'fresh' } }] } } }])
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
    expect(threadRequests(h)).toMatchObject([{ snapshot: { thread: { items: [{ content: { text: 'fresh' } }] } } }])
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
    expect(threadRequests(h)).toMatchObject([{ snapshot: { thread: { items: [{ content: { text: 'kept' } }] } } }])
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
    expect(h.save).toHaveBeenCalledTimes(removed ? 0 : 1)
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
    const h = harness(() => new Promise((resolve) => { release = resolve }))
    h.delta('one')
    h.run()
    await vi.waitFor(() => expect(h.save).toHaveBeenCalledTimes(1))
    h.delta(' two')
    h.delta(' three')
    const stopped = h.writer.stop()
    release({ status: 'ok' })
    await vi.waitFor(() => expect(h.save).toHaveBeenCalledTimes(2))
    expect(threadRequests(h)[1].snapshot.thread.items[0].content).toMatchObject({ text: 'one two three' })
    release({ status: 'ok' })
    await stopped
    h.delta(' after stop')
    h.run()
    expect(h.save).toHaveBeenCalledTimes(2)
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
    expect(h.save).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(h.log.mock.calls)).not.toContain('secret error')
    expect(JSON.stringify(h.log.mock.calls)).not.toContain('usable')
  })

})
