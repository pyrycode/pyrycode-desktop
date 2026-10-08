import { expect, it, vi } from 'vitest'
import type { DaemonEvent } from '@shared/ipc/events'
import { subscribeTimeline, translateTimelineEvent, timelineWriteTarget } from './timelineBridge'
import { createTimelineStore } from './timelineStore'
import { createConversationTimelineStore } from './conversationTimelineStore'
import { createConversationListStore } from './conversationListStore'
import { createChatHistoryWriter } from './chatHistoryWriter'
import type { ChatHistoryRequest, ChatHistoryResult } from '@shared/chatHistory'

function harness() {
  let listener: (event: DaemonEvent) => void = () => {}
  let host: string | undefined = 'host-a'
  let open: string | null = 'a'
  let clock = 100
  let next = 0
  const callbacks = new Map<number, () => void>()
  const cancelled: number[] = []
  const flat = createTimelineStore()
  const keyed = createConversationTimelineStore(undefined, () => host)
  const flatPublications = vi.fn()
  const keyedPublications = vi.fn()
  flat.subscribe(flatPublications)
  keyed.subscribe(keyedPublications)
  const off = vi.fn()
  const stop = subscribeTimeline(cb => { listener = cb; return off },
    (event, id, join, entry, origin) => {
      flat.getState().dispatch(event)
      const target = timelineWriteTarget(event, id, () => open)
      if (target !== null) keyed.getState().dispatchFor(target, event, join, entry, origin)
    }, () => clock++, undefined, {
      scheduler: {
        request: cb => { callbacks.set(++next, cb); return next },
        cancel: id => { cancelled.push(id); callbacks.delete(id) }
      },
      receiptHost: () => host,
      batch: run => flat.batchTimeline(() => keyed.batchTimeline(run)),
      beforeMutation: flush => {
        const a = flat.onBeforeTimelineMutation(flush)
        const b = keyed.onBeforeTimelineMutation(flush)
        return () => { a(); b() }
      }
    })
  const delta = (seq: number, conversationId = 'a', parentToolUseId?: string) => {
    const event: DaemonEvent = { type: 'assistantDelta', conversationId,
      turnId: 'turn', seq, text: `${seq}`, parentToolUseId,
      daemonTs: `stamp-${seq}`, historyEntryId: seq + 1 }
    listener(event)
    return event
  }
  const frame = () => {
    const cb = [...callbacks.values()][0]
    expect(cb).toBeDefined()
    cb()
  }
  return { flat, keyed, delta, frame, callbacks, cancelled, stop, off,
    flatPublications, keyedPublications, emit: (event: DaemonEvent) => listener(event),
    open: (value: string | null) => { open = value },
    receipt: () => host === undefined ? null : { type: 'assistantDelta', serverId: host },
    host: (value: string | undefined) => { host = value } }
}

function historyWriter(h: ReturnType<typeof harness>) {
  const save = vi.fn(async (_request: ChatHistoryRequest): Promise<ChatHistoryResult> => ({ status: 'ok' }))
  const writer = createChatHistoryWriter({ lists: createConversationListStore(), timelines: h.keyed,
    subscribeTimelineWrites: h.keyed.subscribeTimelineWrites,
    receipt: h.receipt, write: save, log: vi.fn(), schedule: () => () => {} })
  const snapshots = () => save.mock.calls.map(([request]) => request)
    .filter(request => request.operation === 'replaceTimeline').map(request => request.snapshot)
  return { save, writer, snapshots }
}

it('saves a deferred burst after receipt expiry and restores all durable fragments', async () => {
  const h = harness()
  const w = historyWriter(h)
  h.delta(0); h.delta(1)
  h.host(undefined)
  h.frame()
  await w.writer.flush()
  expect(w.snapshots()).toHaveLength(1)
  const saved = w.snapshots()[0]
  expect(saved).toMatchObject({ serverId: 'host-a', conversationId: 'a', items: [{ text: '01' }] })
  expect(saved.display?.map(part => part.id)).toEqual([1, 2])
  const restored = createConversationTimelineStore()
  restored.getState().beginLocalTimelineRead('host-a', 'a')!.complete(saved)
  expect(restored.getState().timelines.get('a')?.timeline.items[0]).toMatchObject({ text: '01' })
  expect(h.keyedPublications).toHaveBeenCalledTimes(1)
  h.stop(); await w.writer.stop()
})

it.each(['a', 'b'])('saves interleaved host receipts independently for conversation %s', async other => {
  const h = harness()
  const w = historyWriter(h)
  h.delta(0, 'a')
  h.host('host-b'); h.delta(1, other)
  h.host(undefined); h.frame()
  await w.writer.flush()
  expect(w.snapshots()).toMatchObject([
    { serverId: 'host-a', conversationId: 'a', items: [{ text: '0' }] },
    { serverId: 'host-b', conversationId: other, items: [{ text: '1' }] }
  ])
  expect(h.keyedPublications).toHaveBeenCalledTimes(1)
  h.stop(); await w.writer.stop()
})

it('a later boundary receipt cannot supply ownership to earlier deferred deltas', async () => {
  const h = harness()
  const w = historyWriter(h)
  h.host(undefined); h.delta(0, 'unknown')
  h.host('host-a'); h.delta(1, 'a')
  h.host('host-b')
  h.emit({ type: 'disconnected' })
  await w.writer.flush()
  expect(w.snapshots()).toMatchObject([{ serverId: 'host-a', conversationId: 'a', items: [{ text: '1' }] }])
  h.stop(); await w.writer.stop()
})

it('delivers the first frame once without postponing, with each fold and sidecar intact', () => {
  const h = harness()
  const events = [h.delta(0), h.delta(1), h.delta(2, 'a', 'parent'), h.delta(3)]
  expect(h.callbacks.size).toBe(1)
  expect(h.flatPublications).not.toHaveBeenCalled()
  expect(h.keyedPublications).not.toHaveBeenCalled()
  h.frame()
  expect(h.flatPublications).toHaveBeenCalledTimes(1)
  expect(h.keyedPublications).toHaveBeenCalledTimes(1)
  const sync = createConversationTimelineStore(undefined, () => 'host-a')
  events.forEach((event, index) => sync.getState().dispatchFor('a',
    translateTimelineEvent(event, () => 100 + index)!, `assistantDelta stamp-${index}`, index + 1))
  expect(h.keyed.getState().timelines).toEqual(sync.getState().timelines)
  h.delta(4)
  expect(h.callbacks.size).toBe(1)
  h.frame()
  expect(h.keyedPublications).toHaveBeenCalledTimes(2)
  h.stop()
})

it('captures receipt hosts before they expire and never redirects interleaved conversations', () => {
  const h = harness()
  h.delta(0, 'a')
  h.host('host-b')
  h.delta(1, 'b')
  h.host(undefined)
  h.open('unrelated')
  h.frame()
  expect(h.keyed.getState().timelines.has('unrelated')).toBe(false)
  expect(h.keyed.getState().timelines.get('a')?.serverId).toBe('host-a')
  expect(h.keyed.getState().timelines.get('b')?.serverId).toBe('host-b')
  expect(h.keyed.getState().timelines.get('a')?.timeline.items[0]).toMatchObject({ text: '0', createdAt: 100 })
  expect(h.keyed.getState().timelines.get('b')?.timeline.items[0]).toMatchObject({ text: '1', createdAt: 101 })
  h.stop()
})

it.each(['turnEnd', 'stallDetected', 'toolUse', 'disconnected'] as const)(
  'flushes before the immediate %s daemon boundary', type => {
    const h = harness()
    h.delta(0)
    const event: DaemonEvent = type === 'turnEnd'
      ? { type, conversationId: 'a', turnId: 'turn', stopReason: 'end_turn' }
      : type === 'toolUse'
        ? { type, conversationId: 'a', turnId: 'turn', toolUseId: 'tool', name: 'Task', inputSummary: '' }
        : type === 'stallDetected' ? { type, conversationId: 'a' }
          : { type }
    h.emit(event)
    expect(h.keyed.getState().timelines.get('a')?.timeline.items[0]).toMatchObject({ text: '0' })
    expect(h.callbacks.size).toBe(0)
    h.stop()
  })

it('flushes before local echo, history admission, queue removal and clear; stale callbacks cannot restore rows', () => {
  const h = harness()
  h.delta(0)
  h.keyed.getState().dispatchLocalEcho('host-a', 'a', { type: 'userText', text: 'local', messageId: 'local' })
  expect(h.keyed.getState().timelines.get('a')?.timeline.items.map(i => i.kind)).toEqual(['assistantText', 'userText'])
  h.delta(1)
  h.keyed.getState().prependHistoryFor('a', [])
  expect(h.callbacks.size).toBe(0)
  h.delta(2)
  h.keyed.getState().dispatchFor('a', { type: 'dropUserText', messageId: 'local' })
  expect(h.callbacks.size).toBe(0)
  h.delta(3)
  const stale = [...h.callbacks.values()][0]
  h.keyed.getState().clearAllTimelines()
  expect(h.keyed.getState().timelines.size).toBe(0)
  stale()
  expect(h.keyed.getState().timelines.size).toBe(0)
  h.stop()
})

it('settles cleanup once, cancels the callback and ignores late delivery', () => {
  const h = harness()
  h.delta(0)
  const stale = [...h.callbacks.values()][0]
  h.stop()
  expect(h.off).toHaveBeenCalledTimes(1)
  expect(h.cancelled).toEqual([1])
  expect(h.keyedPublications).toHaveBeenCalledTimes(1)
  stale()
  h.delta(1)
  h.stop()
  expect(h.keyedPublications).toHaveBeenCalledTimes(1)
})

it('preserves duplicate-sequence and root/subagent grouping across tool boundaries', () => {
  const h = harness()
  const sync = createTimelineStore()
  let clock = 100
  const apply = (event: DaemonEvent) => {
    h.emit(event)
    const translated = translateTimelineEvent(event, () => clock++)
    if (translated) sync.getState().dispatch(translated)
  }
  apply({ type: 'assistantDelta', conversationId: 'a', turnId: 'turn', seq: 0, text: 'root ' })
  apply({ type: 'toolUse', conversationId: 'a', turnId: 'turn', toolUseId: 'child', parentToolUseId: 'parent', name: 'Read', inputSummary: '' })
  apply({ type: 'assistantDelta', conversationId: 'a', turnId: 'turn', seq: 1, text: 'tail' })
  apply({ type: 'assistantDelta', conversationId: 'a', turnId: 'turn', seq: 1, text: 'duplicate' })
  apply({ type: 'assistantDelta', conversationId: 'a', turnId: 'turn', seq: 2, text: 'child', parentToolUseId: 'parent' })
  h.frame()
  expect(h.flat.getState().items).toEqual(sync.getState().items)
  expect(h.flat.getState().items[0]).toMatchObject({ text: 'root tailduplicate' })
  expect(h.flat.getState().items.at(-1)).toMatchObject({ text: 'child', parentToolUseId: 'parent' })
  h.stop()
})

it('retains durable per-delta fragments and joins the same history page without duplication', () => {
  const h = harness()
  h.delta(0)
  h.delta(1)
  h.host(undefined)
  h.frame()
  const held = h.keyed.getState().timelines.get('a')!
  expect(held.display?.map(d => d.id)).toEqual([1, 2])
  expect([...held.liveKeys]).toEqual(['assistantDelta stamp-0', 'assistantDelta stamp-1'])
  const entries = [1, 0].map(seq => ({ id: seq + 1, ts: `stamp-${seq}`,
    event: { type: 'assistantDelta' as const, turnId: 'turn', seq, text: `${seq}` } }))
  h.keyed.getState().prependHistoryFor('a', [], false, entries)
  h.keyed.getState().prependHistoryFor('a', [], false, entries)
  expect(h.keyed.getState().timelines.get('a')?.timeline.items).toEqual(held.timeline.items)
  expect(h.keyed.getState().timelines.get('a')?.timeline.rowKeys).toEqual(held.timeline.rowKeys)
  h.stop()
})

it('flushes before action reads, flat resets and reconnect handling; an old callback cannot flush a new burst', () => {
  const h = harness()
  h.delta(0)
  expect(h.keyed.getState().beginLocalTimelineRead('host-a', 'a')).toBeNull()
  const held = h.keyed.getState().timelines.get('a')!
  expect(held.timeline.items[0]).toMatchObject({ text: '0' })
  h.delta(1)
  const stale = [...h.callbacks.values()][0]
  h.flat.getState().dispatch({ type: 'reset' })
  expect(h.flat.getState().items).toEqual([])
  h.delta(2)
  stale()
  expect(h.flat.getState().items).toEqual([])
  h.emit({ type: 'connected', ack: {
    protocol_version: 'v2', server_id: 'host-a', conn_id: 'conn', capabilities: ['interactive']
  } })
  expect(h.flat.getState().items[0]).toMatchObject({ text: '2' })
  expect(h.flat.getState().phase).toBe('idle')
  h.stop()
})

it('queue state and tool results see accepted deltas immediately at their boundaries', () => {
  const h = harness()
  h.keyed.getState().dispatchLocalEcho('host-a', 'a', { type: 'userText', text: 'local', messageId: 'local' })
  h.delta(0)
  h.keyed.getState().markLocalSendQueued('a', [])
  expect(h.callbacks.size).toBe(0)
  h.emit({ type: 'toolUse', conversationId: 'a', turnId: 'turn', toolUseId: 'tool', name: 'Read', inputSummary: '' })
  h.delta(1)
  h.emit({ type: 'toolResult', conversationId: 'a', turnId: 'turn', toolUseId: 'tool', isError: false, resultSummary: 'done' })
  expect(h.callbacks.size).toBe(0)
  expect(h.keyed.getState().timelines.get('a')?.timeline.items.find(i => i.kind === 'toolCall')).toMatchObject({ result: { resultSummary: 'done' } })
  h.stop()
})


it('an absent arrival receipt cannot adopt the host selected at flush time', () => {
  const h = harness()
  h.host(undefined)
  h.delta(0)
  h.host('later-host')
  h.frame()
  expect(h.keyed.getState().timelines.get('a')?.serverId).toBeUndefined()
  h.stop()
})
