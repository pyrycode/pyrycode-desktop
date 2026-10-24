import { describe, expect, it } from 'vitest'
import { encodeEnvelope, decodeEnvelope } from '../../src/main/transport/codec'
import type { ThreadItem, ThreadUpdate } from '../../src/shared/wire/thread'
import { conversationStateFake } from './conversationStateFake'
import { createCanonicalThread } from './canonicalThread'

const frame = (id: number, type: string, payload: unknown) =>
  encodeEnvelope({ id, type, ts: '2026-10-24T00:00:00Z', payload })
const stop = (id: number, conversation_id = 'chat', task_id = 'raw-task') =>
  frame(id, 'stop_background_task', { conversation_id, task_id })
const summary = { id: 'chat', name: 'Stop test', cwd: '/fake', workspace_label: null,
  is_promoted: false, is_archived: false, last_message_ts: '', last_used_at: '', current_session_id: 'session' }
const item: ThreadItem = { id: 7, order: 10, rev: 1, kind: 'tool_call', status: 'running',
  active: true, shown: true, summary: '', session: 'session', agent: 'claude',
  content: { task_id: 'raw-task', tool_use_id: 'call', task_link: { task_id: 'raw-task', tool_call_id: 'call' } } }
const update: Extract<ThreadUpdate, { type: 'thread_item_changed' }> = {
  type: 'thread_item_changed', payload: { conversation_id: 'chat', epoch: 'epoch', version: 2,
    item_id: 7, base_rev: 1, rev: 2, changes: { status: 'stopped', active: false } }
}

describe('conversation fake canonical Stop controls', () => {
  it('preserves default/configured silence, exact-pair routing and copied request order', () => {
    const fake = conversationStateFake()
    fake.setBackgroundTaskStopAnswer('chat', 'raw-task', update)
    expect(fake(stop(1, 'other'))).toEqual([])
    expect(fake(stop(2, 'chat', 'other-task'))).toEqual([])
    fake.setBackgroundTaskStopAnswer('chat', 'raw-task', 'silent')
    expect(fake(stop(3))).toEqual([])
    expect(fake.replyToBackgroundTaskStop(2, 'silent')).toEqual([])
    const requests = fake.backgroundTaskStopRequests()
    requests[0].task_id = 'mutated-copy'
    expect(fake.backgroundTaskStopRequests()).toEqual([
      { conversation_id: 'other', task_id: 'raw-task' },
      { conversation_id: 'chat', task_id: 'other-task' },
      { conversation_id: 'chat', task_id: 'raw-task' }
    ])
  })

  it.each(['configured', 'delayed'] as const)('publishes the %s authored update unchanged and retains it for queries', mode => {
    const fake = conversationStateFake({ conversations: [summary] })
    const thread = createCanonicalThread({ conversations: [{ summary, epoch: 'epoch', version: 1, items: [item] }] })
    if (mode === 'configured') fake.setBackgroundTaskStopAnswer('chat', 'raw-task', update)
    const frames = fake(stop(41))
    const replies = mode === 'configured' ? thread.reply(stop(41), frames) :
      fake.replyToBackgroundTaskStop(0, update).flatMap(thread.publish)
    expect(replies.map(decodeEnvelope)).toEqual([expect.objectContaining(update)])
    const queried = thread.reply(frame(42, 'thread_catch_up', { conversation_id: 'chat', epoch: '', version: 0 }), [])
      .map(decodeEnvelope)
    expect(queried[0].payload).toMatchObject({ version: 2, items: [{ ...item, rev: 2, status: 'stopped', active: false }] })
  })

  it('keeps delayed refusal correlated to its request despite an unrelated payload conversation', () => {
    const fake = conversationStateFake()
    fake(stop(41)); fake(stop(99, 'other'))
    expect(fake.replyToBackgroundTaskStop(0, 'refused').map(decodeEnvelope)).toEqual([
      expect.objectContaining({ type: 'error', in_reply_to: 41, payload: {
        code: 'background_task.refused', message: 'Synthetic refusal', retryable: false,
        conversation_id: 'deliberately-unrelated-conversation'
      } })
    ])
  })
})
