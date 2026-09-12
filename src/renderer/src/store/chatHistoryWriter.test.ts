import { describe, expect, it, vi } from 'vitest'
import { createConversationListStore } from './conversationListStore'
import { createConversationTimelineStore } from './conversationTimelineStore'
import { createChatHistoryWriter } from './chatHistoryWriter'
import type { ChatHistoryRequest, ChatHistoryResult } from '@shared/chatHistory'
import type { ConversationSummary } from '@shared/wire/types'

const row = (id: string): ConversationSummary => ({ id, name: id, cwd: '/', is_promoted: false,
  is_archived: false, last_message_ts: '', last_used_at: '', workspace_label: null })
function harness(write = async (_request: ChatHistoryRequest): Promise<ChatHistoryResult> => ({ status: 'ok' })) {
  const lists = createConversationListStore()
  const timelines = createConversationTimelineStore()
  let receipt: { type: string; serverId: string | null } | null = null
  let scheduled: (() => void) | undefined
  const log = vi.fn()
  const save = vi.fn(write)
  const writer = createChatHistoryWriter({ lists, timelines, write: save, log,
    receipt: () => receipt, schedule: (run) => { scheduled = run; return () => { scheduled = undefined } } })
  const receive = (type: string, action: () => void, serverId: string | null = 'a') => {
    receipt = { type, serverId }
    try { action() } finally { receipt = null }
  }
  const list = (ids = ['chat'], serverId = 'a') => receive('conversationsReceived',
    () => lists.getState().setConversations(ids.map(row), serverId), serverId)
  const delta = (text: string, id = 'chat', serverId: string | null = 'a') => receive('assistantDelta',
    () => timelines.getState().dispatchFor(id, { type: 'assistantDelta', turnId: 'turn', seq: 0, text }), serverId)
  return { lists, timelines, writer, save, log, receive, list, delta, run: () => scheduled?.() }
}
const timelineRequests = (h: ReturnType<typeof harness>) => h.save.mock.calls
  .map(([r]) => r).filter((r) => r.operation === 'replaceTimeline')

describe('chat history recording', () => {
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

  it('saves echoes, live text, tools and older pages while retaining successful coverage', async () => {
    const h = harness()
    h.list()
    h.timelines.getState().markViewed('chat')
    h.timelines.getState().dispatchFor('chat', { type: 'userText', text: 'sent', messageId: 'echo',
      createdAt: 1, attachments: [{ attachmentId: 'attachment', filename: 'image.png' }] })
    h.delta('partial')
    h.receive('toolUse', () => h.timelines.getState().dispatchFor('chat', {
      type: 'toolUse', turnId: 'turn', toolUseId: 'tool', name: 'Read', inputSummary: 'input', input: { path: '/' } }))
    h.receive('toolResult', () => h.timelines.getState().dispatchFor('chat', {
      type: 'toolResult', turnId: 'turn', toolUseId: 'tool', isError: false, resultSummary: 'done', resultDetail: 'detail' }))
    h.receive('historyPageReceived', () => {
      h.timelines.getState().prependHistoryFor('chat', [{ kind: 'userText', text: 'older', messageId: 'old' }])
      h.timelines.getState().recordHistoryPage('chat', 'cursor', true)
    })
    await h.writer.flush()
    const snapshot = timelineRequests(h)[0].snapshot
    expect(snapshot).toMatchObject({ serverId: 'a', prependedRows: 1,
      coverage: { status: 'received', cursor: 'cursor', atStart: true }, items: [
        { kind: 'userText', text: 'older', messageId: 'old' },
        { kind: 'userText', text: 'sent', messageId: 'echo', createdAt: 1,
          attachments: [{ attachmentId: 'attachment', filename: 'image.png' }] },
        { kind: 'assistantText', text: 'partial', turnId: 'turn' },
        { kind: 'toolCall', toolUseId: 'tool', input: { path: '/' }, result: { resultDetail: 'detail' } }
      ] })
    expect(Object.keys(snapshot).sort()).toEqual(['conversationId', 'coverage', 'items', 'kind', 'prependedRows', 'serverId', 'version'])
    h.timelines.getState().markHistoryRequested('chat')
    h.receive('historyRequestFailed', () => h.timelines.getState().recordHistoryFailure('chat', 'history-unavailable', true))
    h.receive('stallDetected', () => h.timelines.getState().dispatchFor('chat', { type: 'stallDetected' }))
    await h.writer.flush()
    expect(timelineRequests(h)).toHaveLength(1)
    h.delta(' tail')
    await h.writer.stop()
    expect(timelineRequests(h)[1].snapshot.coverage).toEqual(snapshot.coverage)
    expect(timelineRequests(h)[1].snapshot.items.some((i) => i.kind === 'turnBoundary')).toBe(false)
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
    expect(timelineRequests(h)[1].snapshot.items[0]).toMatchObject({ text: 'one two three' })
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
    expect(h.timelines.getState().timelines.get('chat')?.timeline.items[0]).toMatchObject({ text: 'live' })
    fail = false
    h.delta(' usable')
    await h.writer.stop()
    expect(h.save).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(h.log.mock.calls)).not.toContain('secret error')
    expect(JSON.stringify(h.log.mock.calls)).not.toContain('usable')
  })

  it('captures supplying hosts before switches, disconnection, list removal and eviction', async () => {
    const disk = new Map<string, ChatHistoryRequest>()
    const h = harness(async (request) => { disk.set(JSON.stringify([request.serverId,
      'conversationId' in request ? request.conversationId : null]), request); return { status: 'ok' } })
    h.list(['first'])
    h.delta('first saved', 'first')
    for (let i = 0; i < 10; i++) {
      h.delta(`text ${i}`, `chat-${i}`, 'b')
      h.timelines.getState().markViewed(`chat-${i}`)
    }
    expect(h.timelines.getState().timelines.has('first')).toBe(false)
    h.lists.getState().clearAllConversations()
    h.timelines.getState().clearAllTimelines()
    await h.writer.stop()
    expect(disk.size).toBe(12)
    expect(disk.get(JSON.stringify(['a', 'first']))).toMatchObject({ operation: 'replaceTimeline',
      snapshot: { serverId: 'a', items: [{ text: 'first saved' }], coverage: { status: 'unknown' } } })
    expect([...disk.values()].filter((r) => r.serverId === 'b')).toHaveLength(10)
  })

  it('refuses ambiguous/missing ownership and never reattributes a contaminated slice', async () => {
    const h = harness()
    h.list()
    h.delta('safe')
    h.list(['chat'], 'b')
    h.delta('foreign', 'chat', 'b')
    h.lists.getState().clearConversationsFor('b')
    h.delta('still mixed')
    h.delta('unknown', 'missing', null)
    h.delta('cannot repair unknown', 'missing')
    await h.writer.stop()
    expect(timelineRequests(h)).toHaveLength(1)
    expect(timelineRequests(h)[0].snapshot.items[0]).toMatchObject({ text: 'safe' })
  })

  it('does not attribute existing restored rows or save transient-only/empty slices', async () => {
    const h = harness()
    h.list()
    h.timelines.getState().markViewed('chat')
    h.timelines.getState().markHistoryRequested('chat')
    h.receive('historyRequestFailed', () => h.timelines.getState().recordHistoryFailure('chat', 'history-unavailable', true))
    await h.writer.flush()
    expect(timelineRequests(h)).toHaveLength(0)
    h.timelines.getState().prependHistoryFor('chat', [{ kind: 'assistantText', turnId: 'old', text: 'restored' }])
    h.delta('new')
    await h.writer.stop()
    expect(timelineRequests(h)).toHaveLength(0)
  })

  it('saves a received empty page and empty list but contains invalid projections', async () => {
    const h = harness()
    h.list([])
    h.timelines.getState().markViewed('chat')
    h.receive('historyPageReceived', () => h.timelines.getState().recordHistoryPage('chat', '', true))
    await h.writer.flush()
    expect(h.save).toHaveBeenCalledTimes(2)
    h.list(['duplicate', 'duplicate'])
    await h.writer.stop()
    expect(h.save).toHaveBeenCalledTimes(2)
    expect(h.log).toHaveBeenCalledWith({ event: 'history-writer-result', code: 'invalid-snapshot' })
  })
})
