import { describe, expect, it } from 'vitest'
import { initialTimelineState, markLocalSendQueued, reduceTimeline, type ThreadEvent, type TimelineState } from './threadTimeline'
import { createConversationTimelineStore, selectTimelineFor } from './conversationTimelineStore'
import { translateTimelineEvent } from './timelineBridge'

const queue = (id = 7, message_id = 'm') => ({ queued_msg_id: id, message_id, text: 'wire copy', ts: '' })
const delta = (turnId: string, text: string): ThreadEvent => ({ type: 'assistantDelta', turnId, seq: 1, text })
const end = (turnId: string): ThreadEvent => ({ type: 'turnEnd', turnId, stopReason: 'end_turn' })
const receipt = (queuedMsgId = 7, sentNow?: boolean): ThreadEvent => ({
  type: 'userText', received: true, messageId: 'm', text: 'receipt copy', queuedMsgId, sentNow
})
function waiting() {
  let s = reduceTimeline(initialTimelineState, delta('first', 'first reply'))
  s = reduceTimeline(s, { type: 'turnState', state: 'responding' })
  s = reduceTimeline(s, { type: 'userText', messageId: 'm', text: 'own', createdAt: 123,
    attachments: [{ attachmentId: 'a', filename: 'kept.txt' }] })
  return markLocalSendQueued(s, [queue()])
}

describe('queued own echo settlement', () => {
  it('keeps row identity through a later queued receipt, makes replay inert and resets arrival order', () => {
    let timeline = reduceTimeline(initialTimelineState, {
      type: 'toolUse', turnId: 't', toolUseId: 'a', name: 'Agent', inputSummary: 'work'
    })
    timeline = reduceTimeline(timeline, { type: 'userText', text: 'queued', messageId: 'q' })
    timeline = markLocalSendQueued(timeline, [queue(1, 'q')])
    const echo = timeline.items[1]
    const key = timeline.rowKeys?.[1]
    expect(timeline.nextRowKey).toBe(2)
    const delivered: ThreadEvent = {
      type: 'userText', text: 'receipt', messageId: 'q', queuedMsgId: 1, received: true, sentNow: true
    }
    timeline = reduceTimeline(timeline, delivered)
    expect(timeline.items[1]).toBe(echo)
    expect(timeline.rowKeys?.[1]).toBe(key)
    expect(timeline.rowArrivalOrder?.get(key!)).toBe(2)
    expect(reduceTimeline(timeline, delivered)).toBe(timeline)
    timeline = reduceTimeline(timeline, { type: 'userText', text: 'later', received: true })
    expect(timeline.items).toHaveLength(3)
    expect(timeline.items[1]).toBe(echo)
    expect(reduceTimeline(timeline, { type: 'reset' }).rowArrivalOrder).toBeUndefined()
  })

  it.each(['removal-first', 'receipt-first'])('settles at the preceding boundary: %s', order => {
    let s = waiting()
    const own = s.items[1]
    const key = s.rowKeys?.[1]
    s = reduceTimeline(s, delta('first', 'last first'))
    s = reduceTimeline(s, end('first'))
    if (order === 'removal-first') s = markLocalSendQueued(s, [])
    s = reduceTimeline(s, receipt())
    s = reduceTimeline(s, delta('answer', 'answer'))
    const at = s.items.indexOf(own)
    expect(at).toBe(3)
    expect(s.rowKeys?.[at]).toBe(key)
    expect(s.items[at]).toBe(own)
    const held = s
    expect(reduceTimeline(s, receipt())).toBe(held)
    expect(reduceTimeline(s, { type: 'userText', received: true, text: 'legacy', messageId: 'm' })).toBe(held)
    expect(markLocalSendQueued(s, [queue()]).items).toBe(s.items)
  })

  it('late fallback leaves the answering stream and activity intact', () => {
    let s = reduceTimeline(waiting(), end('first'))
    s = markLocalSendQueued(s, [])
    s = reduceTimeline(s, delta('answer', 'answer'))
    s = reduceTimeline(s, { type: 'turnState', state: 'responding' })
    s = reduceTimeline(s, { type: 'stallDetected' })
    const before = s
    s = reduceTimeline(s, receipt())
    expect(s.phase).toBe(before.phase)
    expect(s.stalled).toBe(true)
    s = reduceTimeline(s, delta('answer', ' continued'))
    expect(s.items.at(-1)).toMatchObject({ kind: 'assistantText', text: 'answer continued' })
  })

  it('Send now settles at its stream point despite an older observed boundary', () => {
    let s = reduceTimeline(waiting(), end('first'))
    s = reduceTimeline(s, delta('intervening', 'before delivery'))
    s = reduceTimeline(s, receipt(7, true))
    s = reduceTimeline(s, delta('intervening', 'after delivery'))
    expect(s.items).toMatchObject([
      { text: 'first reply' }, { kind: 'turnBoundary' }, { text: 'before delivery' },
      { text: 'own' }, { text: 'after delivery' }
    ])
  })

  it.each([
    { removalFirst: false, released: false }, { removalFirst: true, released: false },
    { removalFirst: false, released: true }, { removalFirst: true, released: true }
  ])('forced delivery advances only still-queued successors: %j', ({ removalFirst, released }) => {
    let s = reduceTimeline(waiting(), { type: 'userText', messageId: 'm', text: 'second own', createdAt: 456 })
    s = markLocalSendQueued(s, [queue(), queue(8)])
    const second = s.items.at(-1)!
    const key = s.rowKeys?.at(-1)
    s = reduceTimeline(s, end('first'))
    s = reduceTimeline(s, delta('second', 'before forced delivery'))
    if (released) s = markLocalSendQueued(s, [queue()])
    const remaining = released ? [] : [queue(8)]
    if (removalFirst) s = markLocalSendQueued(s, remaining)
    s = reduceTimeline(s, receipt(7, true))
    if (!removalFirst) s = markLocalSendQueued(s, remaining)
    s = reduceTimeline(s, delta('second', 'after forced delivery'))
    s = reduceTimeline(s, end('second'))
    s = markLocalSendQueued(s, [])
    s = reduceTimeline(s, delta('third', 'next reply'))
    const before = s
    s = reduceTimeline(s, receipt(8))
    expect(s.phase).toBe(before.phase)
    expect(s.localSendPending).toBe(before.localSendPending)
    expect(s.items[s.rowKeys!.indexOf(key!)]).toBe(second)
    expect(reduceTimeline(s, receipt(7, true))).toBe(s)
    expect(reduceTimeline(s, receipt(8))).toBe(s)
    s = reduceTimeline(s, delta('third', ' continues'))
    expect(s.items.at(-1)).toMatchObject({ text: 'next reply continues' })
  })

  it('keeps submission order and isolates distinct queue entries with colliding message IDs', () => {
    let s = waiting()
    s = reduceTimeline(s, { type: 'userText', messageId: 'm', text: 'second own' })
    s = markLocalSendQueued(s, [queue(), queue(8)])
    s = reduceTimeline(s, delta('first', 'continued'))
    s = reduceTimeline(s, end('first'))
    s = reduceTimeline(s, receipt(7))
    s = reduceTimeline(s, delta('second', 'second reply'))
    expect(s.localEchoes?.filter(e => e.settled)).toHaveLength(1)
    s = reduceTimeline(s, end('second'))
    s = reduceTimeline(s, receipt(8))
    expect(s.localEchoes?.map(echo => [echo.queuedMsgId, echo.settled])).toEqual([[7, true], [8, true]])
    expect(s.items).toMatchObject([
      { text: 'first reply' }, { text: 'continued' }, { kind: 'turnBoundary' }, { text: 'own' },
      { text: 'second reply' }, { kind: 'turnBoundary' }, { text: 'second own' }
    ])
  })

  it('received/history/non-user collisions never acquire ownership, and empty IDs never correlate', () => {
    let s = reduceTimeline(initialTimelineState, { type: 'userText', received: true, text: 'foreign', messageId: 'm' })
    s = reduceTimeline(s, { type: 'userText', text: 'empty', messageId: '' })
    s = markLocalSendQueued(s, [queue(), queue(8, '')])
    expect(s.localEchoes ?? []).toHaveLength(0)
  })

  it('preserves row keys and own correlations across history prepend and conversation isolation', () => {
    const store = createConversationTimelineStore()
    for (const e of [delta('first', 'first'), { type: 'userText', text: 'own', messageId: 'm' } satisfies ThreadEvent]) {
      store.getState().dispatchFor('a', e)
    }
    store.getState().markLocalSendQueued('a', [queue()])
    const held = selectTimelineFor('a')(store.getState())!
    store.getState().prependHistoryFor('a', [{ kind: 'userText', text: 'history', messageId: 'old' }])
    const next = selectTimelineFor('a')(store.getState())!
    expect(next.rowKeys?.slice(1)).toEqual(held.rowKeys)
    expect(next.localEchoes).toEqual(held.localEchoes)
    store.getState().dispatchFor('b', receipt())
    expect(selectTimelineFor('a')(store.getState())).toBe(next)
  })

  it('retains receipt placement through history and navigation, then clears it with its row', () => {
    const store = createConversationTimelineStore()
    for (const event of [delta('first', 'first'), { type: 'userText', text: 'own', messageId: 'm' } satisfies ThreadEvent]) {
      store.getState().dispatchFor('a', event)
    }
    store.getState().markLocalSendQueued('a', [queue()])
    store.getState().dispatchFor('a', receipt(7, true))
    const held = selectTimelineFor('a')(store.getState())!
    expect(held.rowArrivalOrder?.get(1)).toBe(2)
    expect(held.nextRowKey).toBe(3)
    store.getState().prependHistoryFor('a', [{ kind: 'userText', text: 'older' }])
    store.getState().dispatchFor('b', receipt())
    const after = selectTimelineFor('a')(store.getState())!
    expect(after.rowArrivalOrder).toBe(held.rowArrivalOrder)
    expect(after.rowKeys?.slice(1)).toEqual(held.rowKeys)
    store.getState().dispatchFor('a', { type: 'dropUserText', messageId: 'm', queuedMsgId: 7 })
    expect(selectTimelineFor('a')(store.getState())?.rowArrivalOrder?.size).toBe(0)
  })

  it('uses the bound queue identity even when receipt message IDs collide or differ', () => {
    let s = reduceTimeline(waiting(), end('first'))
    const translated = translateTimelineEvent({ type: 'messageReceived', message: {
      conversation_id: 'a', message_id: 'different', role: 'user', text: 'wire copy', queued_msg_id: 7, sent_now: false
    } })!
    expect(translated).toMatchObject({ queuedMsgId: 7, sentNow: false, received: true })
    s = reduceTimeline(s, translated)
    expect(s.localEchoes?.[0].settled).toBe(true)
  })

  it.each([
    { confirmed: true, nextId: 'm', bound: true },
    { confirmed: true, nextId: 'm', bound: false },
    { confirmed: false, nextId: 'new', bound: true }
  ])('prioritizes queue identity over an older echo: %j', ({ confirmed, nextId, bound }) => {
    const legacy: ThreadEvent = { type: 'userText', received: true, messageId: 'm', text: 'legacy receipt' }
    let s = reduceTimeline(initialTimelineState, { type: 'userText', messageId: 'm', text: 'older own' })
    if (confirmed) {
      s = reduceTimeline(s, legacy)
      expect(reduceTimeline(s, legacy)).toBe(s)
    }
    s = reduceTimeline(s, delta('first', 'first reply'))
    s = reduceTimeline(s, { type: 'userText', messageId: nextId, text: 'newer own', createdAt: 123 })
    const own = s.items.at(-1)
    const key = s.rowKeys?.at(-1)
    if (bound) s = markLocalSendQueued(s, [queue(7, nextId)])
    s = reduceTimeline(s, end('first'))
    s = markLocalSendQueued(s, [])
    s = reduceTimeline(s, delta('answer', 'answer'))
    s = reduceTimeline(s, receipt())
    expect(s.items[3]).toBe(own)
    expect(s.rowKeys?.[3]).toBe(key)
    expect(s.localEchoes?.[1]).toMatchObject({ queuedMsgId: 7, settled: true })
    expect(s.localEchoes?.[0].queuedMsgId).toBeUndefined()
    expect(reduceTimeline(s, receipt())).toBe(s)
    if (confirmed) expect(reduceTimeline(s, legacy)).toBe(s)
  })

  it('late confirmation cannot move an older echo into a later completed reply', () => {
    let s = reduceTimeline(waiting(), end('first'))
    s = reduceTimeline(s, delta('answer', 'answer'))
    s = reduceTimeline(s, end('answer'))
    s = reduceTimeline(s, delta('later', 'later reply'))
    s = reduceTimeline(s, { type: 'thinkingProgress', estimatedTokens: 42 })
    s = reduceTimeline(s, receipt())
    expect(s.thinkingTokens).toBe(42)
    s = reduceTimeline(s, delta('later', ' continues'))
    expect(s.items.at(-1)).toMatchObject({ text: 'later reply continues' })
  })

  it('drops only the bound local queue entry, never a colliding received row or another entry', () => {
    let s = reduceTimeline(initialTimelineState, { type: 'userText', received: true, text: 'foreign', messageId: 'm' })
    s = reduceTimeline(s, { type: 'userText', text: 'own one', messageId: 'm' })
    s = reduceTimeline(s, { type: 'userText', text: 'own two', messageId: 'm' })
    s = markLocalSendQueued(s, [queue(), queue(8)])
    s = reduceTimeline(s, { type: 'dropUserText', messageId: 'm', queuedMsgId: 8 })
    expect(s.items).toMatchObject([{ text: 'foreign' }, { text: 'own one' }])
    expect(s.localEchoes).toHaveLength(1)
    const held = s
    expect(reduceTimeline(s, { type: 'dropUserText', messageId: 'm', queuedMsgId: 99 })).toBe(held)
  })

  it('a foreign receipt with a colliding message ID cannot settle a different bound queue entry', () => {
    const held = waiting()
    const received = reduceTimeline(held, { ...receipt(99), type: 'userText', received: true, text: 'foreign' })
    expect(received.localEchoes?.[0].settled).toBeUndefined()
    expect(reduceTimeline(received, receipt(99))).toBe(received)
    expect(received.localSendPending).toBe(held.localSendPending)
  })

  it('idle sends remain at the immediate position and reset clears ownership', () => {
    let s = reduceTimeline(initialTimelineState, { type: 'userText', text: 'idle own', messageId: 'm' })
    s = markLocalSendQueued(s, [queue()])
    s = reduceTimeline(s, delta('answer', 'answer'))
    s = reduceTimeline(s, receipt())
    expect(s.items).toMatchObject([{ text: 'idle own' }, { text: 'answer' }])
    expect(reduceTimeline(s, { type: 'reset' })).toBe(initialTimelineState)
  })
})
