import { expect, it, vi } from 'vitest'
import type { DaemonEvent } from '@shared/ipc/events'
import { translateDaemonEvent } from './daemonEventBridge'
import { translateTimelineEvent, subscribeTimeline } from './timelineBridge'
import { translateModalEvent } from './modalBridge'
import { translateQuestionEvent } from './questionBridge'
import { createTimelineStore } from './timelineStore'
it('legacy consumers ignore thread updates and scoped repair without throwing or dispatching', () => {
  const events: DaemonEvent[] = [
    { type: 'threadUpdate', conversationId: 'c', update: { type: 'thread_text_append', payload: {
      conversation_id: 'c', epoch: 'e', version: 1, item_id: 0, base_rev: 0, rev: 1, text: ''
    } }, correlation: { id: 4, ts: 'stamp' } },
    { type: 'threadRepairNeeded', conversationId: 'c', reason: 'expired' }
  ]
  for (const e of events) {
    expect(translateDaemonEvent(e)).toBeNull()
    expect(translateTimelineEvent(e)).toBeNull()
    expect(translateModalEvent(e, () => new Set())).toBeNull()
    expect(translateQuestionEvent(e)).toBeNull()
  }
})
it('thread indications leave scheduled legacy deltas and store identity untouched', () => {
  let emit!: (e: DaemonEvent) => void, frame!: () => void
  const store = createTimelineStore(), before = store.getState()
  const dispatch = vi.fn(e => store.getState().dispatch(e)), cancel = vi.fn()
  const off = subscribeTimeline(listener => { emit = listener; return () => {} }, dispatch, () => 0, undefined, {
    scheduler: { request: callback => { frame = callback; return 1 }, cancel },
    receiptHost: () => null, batch: run => run(), beforeMutation: () => () => {}
  })
  emit({ type: 'assistantDelta', conversationId: 'c', turnId: 'turn', seq: 0, text: 'pending' })
  emit({ type: 'threadRepairNeeded', conversationId: 'c', reason: 'expired' })
  emit({ type: 'threadUpdate', conversationId: 'c', update: { type: 'thread_text_append', payload: {
    conversation_id: 'c', epoch: 'e', version: 1, item_id: 0, base_rev: 0, rev: 1, text: ''
  } }, correlation: { id: 4, ts: 'stamp' } })
  expect(store.getState()).toBe(before)
  expect(dispatch).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled()
  frame(); expect(dispatch).toHaveBeenCalledTimes(1); off()
})
