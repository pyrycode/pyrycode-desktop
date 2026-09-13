import { describe, expect, it, vi } from 'vitest'
import { createConversationListStore } from './conversationListStore'
import { createConversationTimelineStore } from './conversationTimelineStore'
import { createChatHistoryWriter } from './chatHistoryWriter'
import { beginChatHistoryRemoval } from './chatHistoryRemoval'
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
  it('pauses buffered host saves, discards them on removal and admits fresh re-pair receipts', async () => {
    const h = harness()
    h.list()
    h.delta('old')
    const settle = beginChatHistoryRemoval('a')
    h.list(['other'], 'b')
    await h.writer.flush()
    expect(h.save.mock.calls.map(([r]) => r.serverId)).toEqual(['b'])
    settle(true)
    h.timelines.getState().clearAllTimelines()
    await h.writer.flush()
    expect(h.save).toHaveBeenCalledTimes(1)
    h.list()
    h.delta('fresh')
    await h.writer.flush()
    expect(timelineRequests(h)).toMatchObject([{ snapshot: { items: [{ text: 'fresh' }] } }])
    await h.writer.stop()
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
    expect(timelineRequests(h)).toMatchObject([{ snapshot: { items: [{ text: 'kept' }] } }])
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
    h.timelines.getState().clearAllTimelines()
    h.list()
    release()
    await flushing
    expect(h.save.mock.calls.map(([r]) => r.operation)).toEqual(['replaceList', 'replaceList'])
    await h.writer.stop()
  })

  it('adopts explicit restored ownership and coverage without saving restoration or eviction', async () => {
    const h = harness()
    h.list()
    await h.writer.flush()
    h.save.mockClear()
    h.timelines.getState().beginLocalTimelineRead('a', 'chat')!.complete({
      version: 1, kind: 'timeline', serverId: 'a', conversationId: 'chat', prependedRows: 4,
      items: [{ kind: 'assistantText', turnId: 'turn', text: 'saved' }],
      coverage: { status: 'received', cursor: 'old', atStart: true }
    })
    await h.writer.flush()
    expect(h.save).not.toHaveBeenCalled()
    h.delta(' later')
    await h.writer.flush()
    expect(timelineRequests(h)).toMatchObject([{ serverId: 'a', snapshot: {
      items: [{ text: 'saved later' }], prependedRows: 4,
      coverage: { status: 'received', cursor: 'old', atStart: true }
    } }])
    h.save.mockClear()
    for (let i = 0; i < 10; i++) h.timelines.getState().markViewed(String(i))
    await h.writer.flush()
    expect(h.save).not.toHaveBeenCalled()
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

  it('saves cancelled echoes and subsequent live content with the held host and successful coverage', async () => {
    const h = harness()
    h.list()
    h.delta('partial')
    h.receive('historyPageReceived', () => {
      h.timelines.getState().prependHistoryFor('chat', [{ kind: 'userText', text: 'older', messageId: 'old' }])
      h.timelines.getState().recordHistoryPage('chat', 'cursor', true)
    })
    h.timelines.getState().dispatchFor('chat', { type: 'userText', text: 'queued', messageId: 'echo' })
    await h.writer.flush()
    h.timelines.getState().markHistoryRequested('chat')
    h.receive('historyRequestFailed', () => h.timelines.getState().recordHistoryFailure('chat', 'history-unavailable', true))
    h.receive('turnState', () => h.timelines.getState().dispatchFor('chat', { type: 'turnState', state: 'idle' }))
    h.lists.getState().clearAllConversations()
    h.timelines.getState().dispatchFor('chat', { type: 'dropUserText', messageId: 'echo' })
    await h.writer.flush()
    expect(timelineRequests(h)).toHaveLength(2)
    expect(timelineRequests(h)[1].snapshot).toMatchObject({ serverId: 'a', prependedRows: 1,
      coverage: { status: 'received', cursor: 'cursor', atStart: true }, items: [
        { kind: 'userText', text: 'older', messageId: 'old' }, { kind: 'assistantText', text: 'partial' }
      ] })
    h.delta(' continued')
    await h.writer.stop()
    expect(timelineRequests(h)).toHaveLength(3)
    expect(timelineRequests(h)[2].snapshot).toMatchObject({ serverId: 'a', prependedRows: 1,
      coverage: { status: 'received', cursor: 'cursor', atStart: true }, items: [
        { kind: 'userText', text: 'older' }, { kind: 'assistantText', text: 'partial continued' }
      ] })
  })

  it('saves an empty timeline after cancelling its only observed echo without inventing coverage', async () => {
    const h = harness()
    h.list()
    h.timelines.getState().dispatchFor('chat', { type: 'userText', text: 'queued', messageId: 'echo' })
    await h.writer.flush()
    h.timelines.getState().dispatchFor('chat', { type: 'dropUserText', messageId: 'echo' })
    await h.writer.stop()
    expect(timelineRequests(h)).toHaveLength(2)
    expect(timelineRequests(h)[1].snapshot).toMatchObject({ items: [], coverage: { status: 'unknown' } })
  })

  it.each(['restored', 'conflicting'])('does not authorize %s content by removing an echo', async (mode) => {
    const h = harness()
    h.list()
    h.delta('safe')
    h.timelines.getState().dispatchFor('chat', { type: 'userText', text: 'queued', messageId: 'echo' })
    await h.writer.flush()
    if (mode === 'restored') {
      h.timelines.getState().prependHistoryFor('chat', [{ kind: 'userText', text: 'restored', messageId: 'old' }])
    } else {
      h.list(['chat'], 'b')
      h.delta('foreign', 'chat', 'b')
      h.lists.getState().clearConversationsFor('b')
    }
    h.timelines.getState().dispatchFor('chat', { type: 'dropUserText', messageId: 'echo' })
    h.delta('later')
    await h.writer.stop()
    expect(timelineRequests(h)).toHaveLength(1)
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
