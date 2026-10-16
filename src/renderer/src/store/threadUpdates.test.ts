import { expect, it, vi } from 'vitest'
import type { DaemonEvent } from '@shared/ipc/events'
import { translateDaemonEvent } from './daemonEventBridge'
import { translateTimelineEvent } from './timelineBridge'
import { translateModalEvent } from './modalBridge'
import { translateQuestionEvent } from './questionBridge'
it('legacy consumers ignore thread updates and scoped repair without throwing or dispatching', () => {
  const events: DaemonEvent[] = [
    { type: 'threadUpdate', conversationId: 'c', update: { type: 'thread_text_append', payload: {
      conversation_id: 'c', epoch: 'e', version: 1, item_id: 0, base_rev: 0, rev: 1, text: ''
    } }, correlation: { id: 4, ts: 'stamp' } },
    { type: 'threadRepairNeeded', conversationId: 'c', reason: 'expired' },
    { type: 'threadReply', conversationId: 'c', requestId: 'r', reply: { type: 'thread_reset', payload: { conversation_id: 'c', epoch: 'e', version: 0 } }, correlation: { id: 9, ts: '', in_reply_to: 2 } },
    { type: 'threadQueryFailed', conversationId: 'c', requestId: 'r', inReplyTo: 2, reason: 'malformed' }
  ]
  for (const e of events) {
    expect(translateDaemonEvent(e)).toBeNull()
    expect(translateTimelineEvent(e)).toBeNull()
    expect(translateModalEvent(e, () => new Set())).toBeNull()
    expect(translateQuestionEvent(e)).toBeNull()
  }
})
