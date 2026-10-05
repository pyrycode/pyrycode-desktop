import { describe, expect, it } from 'vitest'
import { initialTimelineState, markLocalSendQueued, reduceTimeline, type ThreadEvent, type TimelineState } from './threadTimeline'
import { foldQueuedRows } from '../screens/conversation/foldQueuedRows'
import { createConversationTimelineStore, selectTimelineFor } from './conversationTimelineStore'
import { translateTimelineEvent } from './timelineBridge'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Timeline } from '../screens/conversation/ConversationScreen'

const queue = (id = 7, message_id = 'm') => ({ queued_msg_id: id, message_id, text: 'wire copy', ts: '' })
const delta = (turnId: string, text: string): ThreadEvent => ({ type: 'assistantDelta', turnId, seq: 1, text })
const end = (turnId: string): ThreadEvent => ({ type: 'turnEnd', turnId, stopReason: 'end_turn' })
const receipt = (queuedMsgId = 7, sentNow?: boolean): ThreadEvent => ({
  type: 'userText', received: true, messageId: 'm', text: 'receipt copy', queuedMsgId, sentNow
})
const fold = (s: TimelineState, q = [queue()]) => foldQueuedRows(s.items, q, s.localEchoes, s.rowKeys)
const text = (s: TimelineState, q = [queue()]) => fold(s, q).map(r => 'text' in r.item ? r.item.text : r.item.kind)
function waiting() {
  let s = reduceTimeline(initialTimelineState, delta('first', 'first reply'))
  s = reduceTimeline(s, { type: 'turnState', state: 'responding' })
  s = reduceTimeline(s, { type: 'userText', messageId: 'm', text: 'own', createdAt: 123,
    attachments: [{ attachmentId: 'a', filename: 'kept.txt' }] })
  return markLocalSendQueued(s, [queue()])
}

describe('queued own echo settlement', () => {
  it('projects below continuing assistant and tool output with source indices', () => {
    let s = waiting()
    s = reduceTimeline(s, { type: 'toolUse', turnId: 'first', toolUseId: 'tool', name: 'Read', inputSummary: 'file' })
    s = reduceTimeline(s, delta('first', 'continued'))
    expect(text(s)).toEqual(['first reply', 'toolCall', 'continued', 'own'])
    expect(fold(s).map(r => r.itemIndex)).toEqual([0, 2, 3, 1])
    expect(fold(s).at(-1)?.queued?.queuedMsgId).toBe(7)
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
    expect(text(s, [])).toEqual(['first reply', 'last first', 'turnBoundary', 'own', 'answer'])
    const at = s.items.indexOf(own)
    expect(at).toBe(3)
    expect(s.rowKeys?.[at]).toBe(key)
    expect(s.items[at]).toBe(own)
    expect(fold(s).find(r => r.item === own)?.queued).not.toBeNull()
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
    expect(text(s, [])).toEqual(['first reply', 'turnBoundary', 'own', 'answer continued'])
  })

  it('Send now settles at its stream point and does not wait for a boundary', () => {
    let s = reduceTimeline(waiting(), delta('first', 'before delivery'))
    s = reduceTimeline(s, receipt(7, true))
    s = reduceTimeline(s, delta('first', 'after delivery'))
    expect(text(s, [])).toEqual(['first reply', 'before delivery', 'own', 'after delivery'])
  })

  it('keeps submission order and isolates distinct queue entries with colliding message IDs', () => {
    let s = waiting()
    s = reduceTimeline(s, { type: 'userText', messageId: 'm', text: 'second own' })
    s = markLocalSendQueued(s, [queue(), queue(8)])
    s = reduceTimeline(s, delta('first', 'continued'))
    expect(text(s, [queue(8), queue()]).slice(-2)).toEqual(['own', 'second own'])
    s = reduceTimeline(s, end('first'))
    s = reduceTimeline(s, receipt(7))
    s = reduceTimeline(s, delta('second', 'second reply'))
    expect(s.localEchoes?.filter(e => e.settled)).toHaveLength(1)
    s = reduceTimeline(s, end('second'))
    s = reduceTimeline(s, receipt(8))
    expect(text(s, [])).toEqual(['first reply', 'continued', 'turnBoundary', 'own', 'second reply', 'turnBoundary', 'second own'])
  })

  it('received/history/non-user collisions never acquire ownership, and empty IDs never correlate', () => {
    let s = reduceTimeline(initialTimelineState, { type: 'userText', received: true, text: 'foreign', messageId: 'm' })
    s = reduceTimeline(s, { type: 'userText', text: 'empty', messageId: '' })
    s = markLocalSendQueued(s, [queue(), queue(8, '')])
    expect(s.localEchoes ?? []).toHaveLength(0)
    expect(fold(s, [queue(), queue(8, '')])).toHaveLength(4)
    expect(fold(s).find(r => r.item === s.items[0])?.queued).toBeNull()
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

  it('uses the bound queue identity even when receipt message IDs collide or differ', () => {
    let s = reduceTimeline(waiting(), end('first'))
    const translated = translateTimelineEvent({ type: 'messageReceived', message: {
      conversation_id: 'a', message_id: 'different', role: 'user', text: 'wire copy', queued_msg_id: 7, sent_now: false
    } })!
    expect(translated).toMatchObject({ queuedMsgId: 7, sentNow: false, received: true })
    s = reduceTimeline(s, translated)
    expect(text(s, [])).toEqual(['first reply', 'turnBoundary', 'own'])
    expect(s.localEchoes?.[0].settled).toBe(true)
  })

  it('late confirmation cannot move an older echo into a later completed reply', () => {
    let s = reduceTimeline(waiting(), end('first'))
    s = reduceTimeline(s, delta('answer', 'answer'))
    s = reduceTimeline(s, end('answer'))
    s = reduceTimeline(s, delta('later', 'later reply'))
    s = reduceTimeline(s, { type: 'thinkingProgress', estimatedTokens: 42 })
    s = reduceTimeline(s, receipt())
    expect(text(s, [])).toEqual(['first reply', 'turnBoundary', 'own', 'answer', 'turnBoundary', 'later reply'])
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
    expect(text(s, [])).toEqual(['foreign', 'own one'])
    expect(s.localEchoes).toHaveLength(1)
    const held = s
    expect(reduceTimeline(s, { type: 'dropUserText', messageId: 'm', queuedMsgId: 99 })).toBe(held)
  })

  it('a foreign receipt with a colliding message ID cannot settle a different bound queue entry', () => {
    const held = waiting()
    const received = reduceTimeline(held, { ...receipt(99), type: 'userText', received: true, text: 'foreign' })
    expect(received.localEchoes?.[0].settled).toBeUndefined()
    expect(text(received)).toEqual(['first reply', 'foreign', 'own'])
    expect(reduceTimeline(received, receipt(99))).toBe(received)
    expect(received.localSendPending).toBe(held.localSendPending)
  })

  it('idle sends remain at the immediate position and reset clears ownership', () => {
    let s = reduceTimeline(initialTimelineState, { type: 'userText', text: 'idle own', messageId: 'm' })
    s = markLocalSendQueued(s, [queue()])
    s = reduceTimeline(s, delta('answer', 'answer'))
    s = reduceTimeline(s, receipt())
    expect(text(s, [])).toEqual(['idle own', 'answer'])
    expect(reduceTimeline(s, { type: 'reset' })).toBe(initialTimelineState)
  })

  it('retains cursor and closed-turn stats on their content through projection and settlement', () => {
    let s = reduceTimeline(waiting(), delta('first', 'last assistant'))
    let markup = renderToStaticMarkup(createElement(Timeline, { ...s, queued: [queue()] }))
    expect(markup.indexOf('last assistant')).toBeLessThan(markup.indexOf('bubble__cursor'))
    expect(markup.indexOf('bubble__cursor')).toBeLessThan(markup.indexOf('data-thread-role="queued">own'))
    s = reduceTimeline(s, { ...end('first'), type: 'turnEnd', turnId: 'first', stopReason: 'end_turn', durationMs: 9000, outputTokens: 12 })
    s = reduceTimeline(s, receipt())
    s = reduceTimeline(s, delta('answer', 'answer'))
    markup = renderToStaticMarkup(createElement(Timeline, { ...s, queued: [] }))
    expect(markup.indexOf('last assistant')).toBeLessThan(markup.indexOf('12 out'))
    expect(markup.indexOf('12 out')).toBeLessThan(markup.indexOf('data-thread-role="user">own'))
    expect(markup.indexOf('answer')).toBeLessThan(markup.indexOf('bubble__cursor'))
    expect(markup.match(/12 out/g)).toHaveLength(1)
  })
})
