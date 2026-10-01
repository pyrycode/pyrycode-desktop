import { describe, it, expect, vi } from 'vitest'
import type { DaemonEvent, HistoryTimelineEntry } from '@shared/ipc/events'
import { translateTimelineEvent, timelineTargetFor, timelineWriteTarget, subscribeTimeline, liveJoinKeyFor } from './timelineBridge'
import { reduceTimeline, initialTimelineState, type ThreadEvent, type TimelineState } from './threadTimeline'
import { createConversationTimelineStore, selectTimelineFor } from './conversationTimelineStore'
import { isConversationUnread } from './conversationUnread'
import { reduceHistoryPage } from './historyPageBridge'
import { foldQueuedRows } from '../screens/conversation/foldQueuedRows'

const receipt = (messageId = 'phone-1', conversationId = 'background', daemonTs?: string): DaemonEvent => ({
  type: 'messageReceived', daemonTs,
  message: { conversation_id: conversationId, message_id: messageId, role: 'user', text: 'From phone' }
})
const translated = (event = receipt()): ThreadEvent => {
  const result = translateTimelineEvent(event)
  if (result === null) throw new Error('Missing receipt translation')
  return result
}

describe('live user receipts', () => {
  it('routes to the named held/new slices and leaves the other slice and read mark alone', () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('open', { type: 'userText', text: 'Desktop' })
    store.getState().dispatchFor('background', { type: 'userText', text: 'Older' })
    const open = selectTimelineFor('open')(store.getState())
    const before = selectTimelineFor('background')(store.getState())
    expect(isConversationUnread(before, 1)).toBe(false)
    let listener: (event: DaemonEvent) => void = () => {}
    const off = vi.fn()
    const getOpen = vi.fn(() => 'open')
    const unsubscribe = subscribeTimeline(cb => { listener = cb; return off }, (event, id, key) => {
      const target = timelineWriteTarget(event, id, getOpen)
      if (target !== null) store.getState().dispatchFor(target, event, key)
    })
    listener(receipt())
    expect(selectTimelineFor('background')(store.getState())?.items).toHaveLength(2)
    expect(isConversationUnread(selectTimelineFor('background')(store.getState()), 1)).toBe(true)
    expect(selectTimelineFor('open')(store.getState())).toBe(open)
    listener(receipt('new', '__proto__'))
    expect(selectTimelineFor('__proto__')(store.getState())?.items).toHaveLength(1)
    expect(getOpen).not.toHaveBeenCalled()
    const held = store.getState()
    listener(receipt('empty', ''))
    listener({ type: 'messageReceived', message: { conversation_id: 'other', message_id: 'a', role: 'assistant', text: 'No' } })
    expect(store.getState()).toBe(held)
    expect(timelineTargetFor(receipt('empty', ''))).toBeNull()
    expect(timelineTargetFor({ type: 'messageReceived', message: { conversation_id: 'other', message_id: 'a', role: 'assistant', text: 'No' } })).toBeNull()
    unsubscribe()
    expect(off).toHaveBeenCalledOnce()
  })

  it('uses daemon time without consulting the desktop arrival clock', () => {
    const now = vi.fn(() => 1)
    expect(translateTimelineEvent(receipt('m', 'c', '2026-01-13T13:55:00.000Z'), now)).toMatchObject({
      type: 'userText', received: true, createdAt: 1768312500000
    })
    expect(now).not.toHaveBeenCalled()
  })

  it.each([undefined, '', 'not a time', 'x'.repeat(65)])('draws without a time for unusable ts %s', ts => {
    const event = translated(receipt('m', 'c', ts))
    const state = reduceTimeline(initialTimelineState, event)
    expect(state.items).toHaveLength(1)
    expect(state.items[0]).toMatchObject({ kind: 'userText', text: 'From phone' })
    expect(state.items[0]).toHaveProperty('createdAt', undefined)
    expect(state.localSendPending).toBe(false)
  })

  it.each([false, true])('preserves localSendPending=%s for a fresh receipt', localSendPending => {
    const state = reduceTimeline({ ...initialTimelineState, localSendPending }, translated())
    expect(state.localSendPending).toBe(localSendPending)
    expect(reduceTimeline(initialTimelineState, { type: 'userText', text: 'Local' }).localSendPending).toBe(true)
  })

  it('returns the exact held state before any content or sidecar mutations for a duplicate', () => {
    const attachments = [{ attachmentId: 'file', filename: 'held.txt' }]
    const state: TimelineState = {
      ...initialTimelineState, localSendPending: true, phase: 'thinking', stalled: true,
      apiRetry: { current: 1, total: 3 }, compacting: true, thinkingTokens: 42,
      latestTurnEnd: { type: 'turnEnd', turnId: 't', stopReason: 'error', isError: true },
      stoppingBanner: { level: 'error', text: 'Held banner', stopsTurn: true, truncated: false },
      items: [
        { kind: 'userText', text: 'Original', messageId: 'phone-1', createdAt: 123, attachments },
        { kind: 'assistantText', turnId: 't', text: 'After' }
      ]
    }
    expect(reduceTimeline(state, translated())).toBe(state)
    expect(reduceTimeline(state, translated(receipt('phone-1', 'background', '2026-01-13T13:55:00Z')))).toBe(state)
  })

  it('keeps repeated receipts once but equal text with distinct or empty/absent ids separately', () => {
    const first = reduceTimeline(initialTimelineState, translated())
    expect(reduceTimeline(first, translated())).toBe(first)
    let state = reduceTimeline(first, translated(receipt('different')))
    const empty = translated(receipt(''))
    state = reduceTimeline(reduceTimeline(state, empty), empty)
    const absent = { ...empty, messageId: undefined } as ThreadEvent
    state = reduceTimeline(reduceTimeline(state, absent), absent)
    expect(state.items).toHaveLength(6)
  })

  it('preserves the optimistic row through receipts, queued folding and a later history page', () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('background', { type: 'userText', text: 'Original', messageId: 'phone-1', createdAt: 123 })
    const held = store.getState()
    const row = selectTimelineFor('background')(held)?.items[0]
    store.getState().dispatchFor('background', translated())
    expect(store.getState()).toBe(held)
    const items = selectTimelineFor('background')(store.getState())?.items ?? []
    const folded = foldQueuedRows(items, [{ queued_msg_id: 1, message_id: 'phone-1', text: 'Daemon version', ts: '' }])
    expect(folded).toHaveLength(1)
    expect(folded[0].item).toBe(row)
    expect(folded[0].queued?.messageId).toBe('phone-1')
    const entry: HistoryTimelineEntry = { id: 1, ts: '2026-01-13T13:55:00Z', event: {
      type: 'messageReceived', message: { message_id: 'phone-1', role: 'user', text: 'History version' }
    } }
    const history = reduceHistoryPage([entry])
    expect(history[0]).toHaveProperty('createdAt', undefined)
    store.getState().prependHistoryFor('background', history)
    expect(selectTimelineFor('background')(store.getState())?.items).toEqual(items)
    expect(selectTimelineFor('background')(store.getState())?.items[0]).toBe(row)
  })

  it('joins a received row to later history by id, never by timestamp', () => {
    const store = createConversationTimelineStore()
    const event = receipt('phone-1', 'background', '2026-01-13T13:55:00Z')
    expect(liveJoinKeyFor(event)).toBeUndefined()
    store.getState().dispatchFor('background', translated(event))
    const held = selectTimelineFor('background')(store.getState())?.items[0]
    const entries: HistoryTimelineEntry[] = [{ id: 1, ts: 'other timestamp', event: {
      type: 'messageReceived', message: { message_id: 'phone-1', role: 'user', text: 'History copy' }
    } }]
    store.getState().prependHistoryFor('background', reduceHistoryPage(entries))
    expect(selectTimelineFor('background')(store.getState())?.items).toEqual([held])
    expect(selectTimelineFor('background')(store.getState())?.items[0]).toBe(held)
  })

  it('keeps a held history row when its receipt arrives later', () => {
    const store = createConversationTimelineStore()
    const row = { kind: 'userText', text: 'History', messageId: 'phone-1' } as const
    store.getState().prependHistoryFor('background', [row])
    const held = store.getState()
    store.getState().dispatchFor('background', translated())
    expect(store.getState()).toBe(held)
  })
})
