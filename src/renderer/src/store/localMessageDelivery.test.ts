import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { initialTimelineState, reduceTimeline, markLocalSendQueued, type ThreadEvent } from './threadTimeline'
import { createConversationTimelineStore, selectTimelineFor } from './conversationTimelineStore'
import { createTimelineStore } from './timelineStore'
import { submitMessage } from '../screens/conversation/composerSend'
import { Timeline } from '../screens/conversation/ConversationScreen'
import { translateTimelineEvent, timelineTargetFor } from './timelineBridge'

const status = (value: 'waiting' | 'not-sent' | 'written', serverId = 'host-a'): Extract<ThreadEvent, { type: 'messageDelivery' }> =>
  ({ type: 'messageDelivery', messageId: 'own', status: value, serverId })
const echo: ThreadEvent = { type: 'userText', messageId: 'own', text: 'original', createdAt: 123,
  attachments: [{ attachmentId: 'file', filename: 'original.txt' }] }

describe('local message delivery', () => {
  it('updates both echo identities before synchronous status reporting and preserves a failed draft', () => {
    const active = createTimelineStore()
    const held = createConversationTimelineStore()
    const rollback = vi.fn()
    const sendCommand = vi.fn(() => {
      expect(active.getState().items).toHaveLength(1)
      expect(held.getState().timelines.get('conv')?.timeline.items).toHaveLength(1)
      throw new Error('SECRET must not be logged')
    })
    expect(submitMessage('draft', 'conv', { sendCommand, newMessageId: () => 'own',
      takeAttachments: () => ({ attachments: [{ attachmentId: 'file', filename: 'file.txt' }], rollback }),
      dispatch: active.getState().dispatch,
      dispatchFor: (id, event) => event.type === 'userText' ? held.getState().dispatchLocalEcho('host-a', id, event)
        : event.type === 'messageDelivery' ? held.getState().dispatchFor(id, { ...event, serverId: 'host-a' }) : undefined
    })).toBe(false)
    expect(rollback).toHaveBeenCalledOnce()
    expect(active.getState().localEchoes?.[0].delivery).toBe('not-sent')
    expect(held.getState().timelines.get('conv')?.timeline.items).toEqual(active.getState().items)
  })

  it('isolates retained host/conversation/message owners and translates no payload content', () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchLocalEcho('host-a', 'inactive', echo)
    store.getState().dispatchLocalEcho('host-b', 'active', echo)
    store.getState().dispatchFor('inactive', status('waiting', 'host-b'))
    expect(store.getState().timelines.get('inactive')?.timeline.localEchoes?.[0].delivery).toBeUndefined()
    store.getState().dispatchFor('inactive', status('waiting'))
    store.getState().dispatchFor('inactive', { ...status('not-sent'), messageId: 'other' })
    expect(store.getState().timelines.get('inactive')?.timeline.localEchoes?.[0].delivery).toBe('waiting')
    expect(store.getState().timelines.get('active')?.timeline.localEchoes?.[0].delivery).toBeUndefined()
    const event = { type: 'messageDelivery', conversationId: 'inactive', messageId: 'own', status: 'written', serverId: 'host-a' } as const
    expect(timelineTargetFor(event)).toBe('inactive')
    expect(translateTimelineEvent(event)).toEqual(status('written'))
  })

  it('renders held and failed copy, then settles one row before its reply with original metadata', () => {
    let s = reduceTimeline(initialTimelineState, { type: 'assistantDelta', turnId: 'first', seq: 0, text: 'first answer' })
    s = reduceTimeline(s, echo)
    s = reduceTimeline(s, status('waiting'))
    const markup = () => renderToStaticMarkup(createElement(Timeline, { ...s }))
    expect(markup()).toContain('Waiting for connection')
    expect(markup()).not.toContain('data-thread-role="queued"')
    s = reduceTimeline(s, status('not-sent'))
    expect(markup()).toContain('Not sent')
    s = reduceTimeline(s, status('waiting'))
    s = reduceTimeline(s, status('written'))
    const queued = [{ message_id: 'own', queued_msg_id: 7, text: 'wire copy', ts: '' }]
    s = markLocalSendQueued(s, queued)
    s = reduceTimeline(s, { type: 'turnEnd', turnId: 'first', stopReason: 'end_turn' })
    const receipt: ThreadEvent = { type: 'userText', received: true, queuedMsgId: 7, messageId: 'own', text: 'receipt copy' }
    s = reduceTimeline(s, receipt)
    s = reduceTimeline(s, { type: 'assistantDelta', turnId: 'second', seq: 0, text: 'own answer' })
    const settled = s
    expect(reduceTimeline(s, receipt)).toBe(settled)
    expect(s.items.filter(item => item.kind === 'userText')).toEqual([{ kind: 'userText', text: 'original',
      messageId: 'own', createdAt: 123, attachments: [{ attachmentId: 'file', filename: 'original.txt' }] }])
    expect(s.items.findIndex(item => item.kind === 'userText')).toBeLessThan(s.items.findIndex(item => item.kind === 'assistantText' && item.turnId === 'second'))
    expect(markup()).not.toContain('Waiting for connection')
  })
})
