import { describe, expect, it, vi } from 'vitest'
import { createConversationListStore } from './conversationListStore'
import { createConversationTimelineStore } from './conversationTimelineStore'
import { createChatHistoryWriter } from './chatHistoryWriter'
import { subscribeHistoryPage } from './historyPageBridge'
import { beginChatHistoryRemoval } from './chatHistoryRemoval'
import { parseChatHistorySnapshot, type ChatHistoryRequest, type ChatHistoryResult } from '@shared/chatHistory'
import type { StampedDaemonEvent } from '@shared/ipc/events'
import type { ConversationSummary } from '@shared/wire/types'

const row = (id: string): ConversationSummary => ({ id, name: id, cwd: '/', is_promoted: false,
  is_archived: false, last_message_ts: '', last_used_at: '', workspace_label: null })
function harness(write = async (_request: ChatHistoryRequest): Promise<ChatHistoryResult> => ({ status: 'ok' })) {
  const lists = createConversationListStore()
  let receipt: { type: string; serverId: string | null } | null = null
  const timelines = createConversationTimelineStore(undefined, () => receipt?.serverId)
  let scheduled: (() => void) | undefined
  const log = vi.fn()
  const save = vi.fn(write)
  let listener: (event: StampedDaemonEvent) => void = () => {}
  const offEvents = vi.fn(() => { listener = () => {} })
  const writer = createChatHistoryWriter({ lists, timelines, write: save, log,
    subscribeEvents: onEvent => { listener = onEvent; return offEvents },
    receipt: () => receipt, schedule: (run) => { scheduled = run; return () => { scheduled = undefined } } })
  const receive = (type: string, action: () => void, serverId: string | null = 'a') => {
    receipt = { type, serverId }
    try { action() } finally { receipt = null }
  }
  const list = (ids = ['chat'], serverId = 'a') => receive('conversationsReceived',
    () => lists.getState().setConversations(ids.map(row), serverId), serverId)
  const delta = (text: string, id = 'chat', serverId: string | null = 'a') => receive('assistantDelta',
    () => timelines.getState().dispatchFor(id, { type: 'assistantDelta', turnId: 'turn', seq: 0, text }), serverId)
  return { lists, timelines, writer, save, log, receive, list, delta, offEvents,
    event: (event: StampedDaemonEvent) => listener(event), run: () => scheduled?.() }
}

it('saves newest receipts with retained oldest-end coverage through protected restoration', async () => {
  const h = harness()
  h.list(); h.delta('held row')
  h.receive('historyPageReceived', () => h.timelines.getState().recordHistoryPage('chat', 'oldest', true, [1]))
  h.timelines.getState().markHistoryRequested('chat', 'a', '', 'newest')
  h.receive('historyPageReceived', () => h.timelines.getState().recordHistoryPage('chat', 'fresh', false, [4, 6]))
  await h.writer.flush()
  const saved = timelineRequests(h).at(-1)!.snapshot
  expect(saved.coverage).toEqual({ status: 'received', cursor: 'oldest', atStart: true })
  expect(saved.served?.ids).toEqual([1, 4, 6])
  const parsed = parseChatHistorySnapshot(JSON.parse(JSON.stringify(saved)))
  if (parsed.kind !== 'timeline') throw new Error('Expected timeline')
  const fresh = createConversationTimelineStore()
  fresh.getState().beginLocalTimelineRead('a', 'chat')!.complete(parsed)
  expect(fresh.getState().timelines.get('chat')?.coverage).toEqual(saved.coverage)
  expect(fresh.getState().timelines.get('chat')?.served).toEqual(saved.served)
  await h.writer.stop()
})
const timelineRequests = (h: ReturnType<typeof harness>) => h.save.mock.calls
  .map(([r]) => r).filter((r) => r.operation === 'replaceTimeline')

it('saves metadata-only gap progress and restores it without pending or failure state', async () => {
  const h = harness(); h.list()
  h.receive('historyPageReceived', () => h.timelines.getState().recordHistoryPage('chat', 'oldest', true, [1]))
  h.timelines.getState().markHistoryRequested('chat', 'a', '', 'newest')
  h.receive('historyPageReceived', () => h.timelines.getState().recordHistoryPage('chat', 'newer', false, [5]))
  await h.writer.flush()
  const rows = h.timelines.getState().timelines.get('chat')!.timeline.items
  h.timelines.getState().markHistoryRequested('chat', 'a', 'newer', 'gap', 1)
  h.receive('historyPageReceived', () => h.timelines.getState().recordHistoryPage('chat', 'step', false, [4]))
  await h.writer.flush()
  const saved = timelineRequests(h).at(-1)!.snapshot
  expect(h.timelines.getState().timelines.get('chat')!.timeline.items).toBe(rows)
  expect(saved.gaps).toEqual([{ olderId: 1, newerId: 4, cursor: 'step' }])
  expect(saved.coverage).toEqual({ status: 'received', cursor: 'oldest', atStart: true })
  const parsed = parseChatHistorySnapshot(JSON.parse(JSON.stringify(saved)))
  if (parsed.kind !== 'timeline') throw new Error('Expected timeline')
  const fresh = createConversationTimelineStore()
  fresh.getState().beginLocalTimelineRead('a', 'chat')!.complete(parsed)
  expect(fresh.getState().timelines.get('chat')?.gaps).toEqual(saved.gaps)
  expect(fresh.getState().timelines.get('chat')?.history).toBeNull()
  await h.writer.stop()
})

describe('chat history recording', () => {
  it('captures confirmed coordinates without a held timeline, list entry or selection', async () => {
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
    h.timelines.getState().clearAllTimelines()
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
    expect(timelineRequests(h)).toMatchObject([{ snapshot: { items: [{ text: 'fresh' }] } }])
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
    expect(timelineRequests(h)).toHaveLength(0)
    const removed = beginChatHistoryRemoval('a')
    removed(true)
    h.list()
    h.delta('fresh')
    await h.writer.stop()
    expect(timelineRequests(h)).toMatchObject([{ snapshot: { items: [{ text: 'fresh' }] } }])
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
    h.list()
    release()
    await flushing
    expect(h.save.mock.calls.map(([r]) => r.operation)).toEqual(['replaceList', 'replaceList'])
    await h.writer.stop()
  })

  it('adopts explicit restored ownership and coverage without saving restoration or eviction', async () => {
    const h = harness()
    h.list()
    h.list(['chat'], 'b')
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
    expect(Object.keys(snapshot).sort()).toEqual(['conversationId', 'coverage', 'items', 'kind', 'prependedRows', 'rowIdentity', 'serverId', 'version'])
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

  // #1621: an offered file is live-only — the wire cannot resupply it — so it never reaches the durable
  // snapshot, and no claude-authored filename is written to disk through this path.
  it('leaves offered-file rows out of the saved timeline', async () => {
    const h = harness()
    h.list()
    h.delta('here it is')
    h.receive('attachmentOffered', () => h.timelines.getState().dispatchFor('chat', {
      type: 'attachmentOffered', attachment: { attachmentId: 'offer-1', filename: 'secret-name.pdf' } }))
    await h.writer.stop()
    const saved = timelineRequests(h)
    expect(saved.length).toBeGreaterThan(0)
    expect(h.timelines.getState().timelines.get('chat')?.timeline.items.map((i) => i.kind))
      .toEqual(['assistantText', 'attachmentOffer'])
    for (const request of saved) {
      expect(request.snapshot.items.map((i) => i.kind)).toEqual(['assistantText'])
      expect(JSON.stringify(request.snapshot)).not.toContain('secret-name')
    }
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

  it.each(['restored', 'replacement'])('does not authorize %s content by removing an echo', async (mode) => {
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
    const requests = timelineRequests(h)
    expect(requests).toHaveLength(mode === 'restored' ? 1 : 3)
    if (mode === 'replacement') {
      expect(requests.slice(1).map(r => [r.serverId, r.snapshot.items])).toEqual([
        ['b', [{ kind: 'assistantText', turnId: 'turn', text: 'foreign' }]],
        ['a', [{ kind: 'assistantText', turnId: 'turn', text: 'later' }]]
      ])
    }
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

  it('saves clean stamped host replacements independently despite equal list ids', async () => {
    const h = harness()
    h.list()
    h.list(['chat'], 'b')
    const complete = (serverId: string) => h.receive('turnEnd', () => h.timelines.getState().dispatchFor('chat', {
      type: 'turnEnd', turnId: 'turn', stopReason: 'end_turn'
    }), serverId)
    const page = (serverId: string, cursor: string, atStart: boolean) => h.receive('historyPageReceived',
      () => h.timelines.getState().recordHistoryPage('chat', cursor, atStart), serverId)
    h.delta('first a')
    page('a', 'cursor-a', true)
    complete('a')
    h.delta('first b', 'chat', 'b')
    page('b', 'cursor-b', false)
    complete('b')
    // Replace A again before any buffered snapshot has reached storage.
    h.delta('second a')
    complete('a')
    expect(h.save).not.toHaveBeenCalled()
    await h.writer.flush()
    expect(timelineRequests(h).map(r => [r.serverId, r.snapshot])).toEqual([
      ['a', { version: 1, kind: 'timeline', serverId: 'a', conversationId: 'chat', prependedRows: 0,
        rowIdentity: { rowKeys: [0, 1], nextRowKey: 2 }, items: [{ kind: 'assistantText', turnId: 'turn', text: 'second a' },
          { kind: 'turnBoundary', turnId: 'turn', stopReason: 'end_turn' }], coverage: { status: 'unknown' } }],
      ['b', { version: 1, kind: 'timeline', serverId: 'b', conversationId: 'chat', prependedRows: 0,
        rowIdentity: { rowKeys: [0, 1], nextRowKey: 2 }, items: [{ kind: 'assistantText', turnId: 'turn', text: 'first b' },
          { kind: 'turnBoundary', turnId: 'turn', stopReason: 'end_turn' }],
        coverage: { status: 'received', cursor: 'cursor-b', atStart: false } }]
    ])
    h.delta('second b', 'chat', 'b')
    complete('b')
    h.delta('third a')
    page('a', 'new-a', false)
    complete('a')
    await h.writer.stop()
    expect(timelineRequests(h).slice(2)).toMatchObject([
      { serverId: 'b', snapshot: { items: [{ text: 'second b' }, { kind: 'turnBoundary' }], coverage: { status: 'unknown' } } },
      { serverId: 'a', snapshot: { items: [{ text: 'third a' }, { kind: 'turnBoundary' }],
        coverage: { status: 'received', cursor: 'new-a', atStart: false } } }
    ])
    expect(h.log).not.toHaveBeenCalledWith({ event: 'history-writer-result', code: 'unknown-ownership' })
  })

  it('refuses missing origins and cannot attribute retained unowned rows with a later stamp', async () => {
    const h = harness()
    h.list()
    h.list(['chat'], 'b')
    h.timelines.getState().dispatchFor('chat', { type: 'userText', text: 'ambiguous echo', messageId: 'echo' })
    h.delta('cannot own the echo')
    h.delta('unknown', 'missing', null)
    h.delta('cannot repair unknown', 'missing')
    await h.writer.stop()
    expect(timelineRequests(h)).toHaveLength(0)
    expect(h.timelines.getState().timelines.get('missing')?.timeline.items[0]).toMatchObject({ text: 'unknowncannot repair unknown' })
    expect(h.log).toHaveBeenCalledWith({ event: 'history-writer-result', code: 'unknown-ownership' })
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

describe('served receipt persistence', () => {
  it('keeps saving with unknown provenance when one receipt exceeds the entire metadata bound', async () => {
    const h = harness()
    h.delta('kept')
    h.receive('historyPageReceived', () => h.timelines.getState().recordHistoryPage('chat', 'bounded', false, [7]))
    h.receive('historyPageReceived', () => h.timelines.getState().recordHistoryPage('chat', 'oversized', false,
      Array.from({ length: 100_001 }, (_, i) => i)))
    expect(h.timelines.getState().timelines.get('chat')?.served).toBeUndefined()
    h.receive('userText', () => h.timelines.getState().dispatchFor('chat', { type: 'userText', text: 'live' }))
    await h.writer.stop()
    const saved = timelineRequests(h).at(-1)!.snapshot
    expect(saved.items).toMatchObject([{ text: 'kept' }, { text: 'live' }])
    expect(saved.coverage).toEqual({ status: 'received', cursor: 'oversized', atStart: false })
    expect(saved).not.toHaveProperty('served')
    expect(h.log).not.toHaveBeenCalledWith({ event: 'history-writer-result', code: 'invalid-snapshot' })
  })

  it('bounds empty receipts and recomputes exact evidence when whole older receipts expire', async () => {
    const h = harness()
    const snapshot = { version: 1, kind: 'timeline', serverId: 'a', conversationId: 'chat', items: [],
      prependedRows: 0, coverage: { status: 'received', cursor: 'old', atStart: false },
      served: { ids: [7], highestId: 7, receipts: [
        { ids: [7], cursor: 'old', atStart: false },
        ...Array.from({ length: 99_999 }, () => ({ ids: [], cursor: '', atStart: false }))
      ] } }
    const parsed = parseChatHistorySnapshot(snapshot)
    if (parsed.kind !== 'timeline') throw new Error('expected timeline')
    h.timelines.getState().beginLocalTimelineRead('a', 'chat')!.complete(parsed)
    h.receive('historyPageReceived', () => h.timelines.getState().recordHistoryPage('chat', 'new', false, [1]))
    await h.writer.stop()
    const saved = timelineRequests(h).at(-1)!.snapshot
    expect(saved.served?.receipts).toHaveLength(100_000)
    expect(saved.served?.receipts.at(-1)).toEqual({ ids: [1], cursor: 'new', atStart: false })
    expect(saved.served?.ids).toEqual([1])
    expect(saved.served?.highestId).toBe(1)
    expect(saved.coverage).toEqual({ status: 'received', cursor: 'new', atStart: false })
    expect(h.log).not.toHaveBeenCalledWith({ event: 'history-writer-result', code: 'invalid-snapshot' })
  })

  it('saves metadata-only and empty receipts, filters identities with durable rows and restores fresh allocations', async () => {
    const h = harness()
    h.list()
    h.delta('kept')
    h.receive('attachmentOffered', () => h.timelines.getState().dispatchFor('chat', {
      type: 'attachmentOffered', attachment: { attachmentId: 'offer', filename: 'live-only' }
    }))
    h.receive('historyPageReceived', () => h.timelines.getState().recordHistoryPage('chat', 'one', false, [0, 5]))
    await h.writer.flush()
    const first = timelineRequests(h).at(-1)!.snapshot
    expect(first.items).toHaveLength(1)
    expect(first.rowIdentity?.rowKeys).toEqual([0])
    expect(first.rowIdentity?.nextRowKey).toBe(2)
    h.receive('historyPageReceived', () => h.timelines.getState().recordHistoryPage('chat', 'two', false, []))
    await h.writer.flush()
    const saved = timelineRequests(h).at(-1)!.snapshot
    expect(saved.served).toEqual({ ids: [0, 5], highestId: 5, receipts: [
      { ids: [0, 5], cursor: 'one', atStart: false }, { ids: [], cursor: 'two', atStart: false }
    ] })
    expect(saved.items).toEqual(first.items)
    const fresh = createConversationTimelineStore(undefined, () => 'a')
    fresh.getState().beginLocalTimelineRead('a', 'chat')!.complete(JSON.parse(JSON.stringify(saved)))
    expect(fresh.getState().timelines.get('chat')?.timeline.rowKeys).toEqual([0])
    expect(fresh.getState().timelines.get('chat')?.served).toEqual(saved.served)
    let repeat: (event: StampedDaemonEvent) => void = () => {}
    subscribeHistoryPage(on => { repeat = on; return () => {} }, (id, rows, cursor, atStart, _placements, ids) => {
      fresh.getState().prependHistoryFor(id, rows)
      fresh.getState().recordHistoryPage(id, cursor, atStart, ids)
    }, () => {}, undefined, id => new Set(fresh.getState().timelines.get(id)?.served?.ids))
    repeat({ type: 'historyPageReceived', serverId: 'a', conversationId: 'chat', cursor: 'repeat', atStart: false,
      servedIds: [0, 5], entries: [{ id: 5, ts: 'old', event: { type: 'assistantDelta', turnId: 'turn', seq: 0, text: 'kept' } }] })
    expect(fresh.getState().timelines.get('chat')?.timeline.items).toEqual(saved.items)
    expect(fresh.getState().timelines.get('chat')?.timeline.nextRowKey).toBe(2)
    fresh.getState().dispatchFor('chat', { type: 'userText', text: 'live' })
    fresh.getState().prependHistoryFor('chat', [{ kind: 'assistantText', turnId: 'old', text: 'older' }], true)
    const restored = fresh.getState().timelines.get('chat')!
    expect(restored.timeline.items).toMatchObject([{ text: 'older' }, { text: 'kept' }, { text: 'live' }])
    expect(new Set(restored.timeline.rowKeys).size).toBe(3)
    expect(restored.timeline.rowKeys).toEqual([4, 0, 2])
    expect(restored.timeline.nextRowKey).toBe(5)
    await h.writer.stop()
  })

  it('removes provenance with the received host, unpair, conversation clear and holder eviction', async () => {
    const h = harness()
    const record = (host: string, ids: number[]) => h.receive('historyPageReceived', () =>
      h.timelines.getState().recordHistoryPage('chat', 'c', false, ids), host)
    record('a', [1])
    record('b', [2])
    expect(h.timelines.getState().timelines.get('chat')?.served?.ids).toEqual([2])
    const settle = beginChatHistoryRemoval('b')
    settle(true)
    expect(h.timelines.getState().timelines.has('chat')).toBe(false)
    record('a', [3])
    h.timelines.getState().clearTimelineFor('chat')
    record('a', [4])
    expect(h.timelines.getState().timelines.get('chat')?.served?.ids).toEqual([4])
    for (let i = 0; i < 10; i++) {
      h.delta('other', `other-${i}`)
      h.timelines.getState().markViewed(`other-${i}`)
    }
    expect(h.timelines.getState().timelines.has('chat')).toBe(false)
    record('a', [])
    expect(h.timelines.getState().timelines.get('chat')?.served).toEqual({ ids: [], receipts: [
      { ids: [], cursor: 'c', atStart: false }
    ] })
    await h.writer.stop()
  })
})

it('saves all-skipped coverage and narrow legacy pager advances without manufacturing served receipts', async () => {
  const h = harness()
  const page = (cursor: string, ids?: number[]) => h.receive('historyPageReceived', () =>
    h.timelines.getState().recordHistoryPage('chat', cursor, false, ids))
  page('skipped', [0, 9])
  await h.writer.flush()
  page('legacy')
  await h.writer.flush()
  expect(timelineRequests(h)).toHaveLength(2)
  expect(timelineRequests(h)[1].snapshot).toMatchObject({ items: [],
    coverage: { status: 'received', cursor: 'legacy', atStart: false },
    served: { ids: [0, 9], highestId: 9, receipts: [{ ids: [0, 9], cursor: 'skipped', atStart: false }] }
  })
  page('empty', [])
  await h.writer.stop()
  expect(timelineRequests(h)[2].snapshot.served?.receipts.at(-1)).toEqual({ ids: [], cursor: 'empty', atStart: false })
})

it('saves orphan-only display changes and restores protected contribution joins in fresh instances', async () => {
  const h = harness()
  h.list()
  const result = { id: 3, ts: 'result', event: { type: 'toolResult' as const, turnId: 't', toolUseId: 'tool',
    isError: false, resultSummary: 'completed' } }
  h.receive('historyPageReceived', () => {
    h.timelines.getState().prependHistoryFor('chat', [], false, [result])
    h.timelines.getState().recordHistoryPage('chat', 'opaque', false, [3, 4])
  })
  await h.writer.flush()
  const saved = timelineRequests(h).at(-1)!.snapshot
  expect(saved.items).toEqual([])
  expect(saved.display).toMatchObject([{ id: 3, kind: 'patch', result: { resultSummary: 'completed' } }])
  expect(saved.served?.ids).toEqual([3, 4])
  const fresh = createConversationTimelineStore(undefined, () => 'a')
  fresh.getState().beginLocalTimelineRead('a', 'chat')!.complete(JSON.parse(JSON.stringify(saved)))
  fresh.getState().prependHistoryFor('chat', [], false, [{ id: 2, ts: 'call', event: {
    type: 'toolUse', turnId: 't', toolUseId: 'tool', name: 'Read', inputSummary: 'input' } }])
  expect(fresh.getState().timelines.get('chat')?.timeline.items).toMatchObject([
    { kind: 'toolCall', result: { resultSummary: 'completed' } }
  ])
  expect(h.log.mock.calls.flat().map(value => JSON.stringify(value)).join('')).not.toContain('completed')
  await h.writer.stop()
})
