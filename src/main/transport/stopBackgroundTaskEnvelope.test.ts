import { describe, expect, it } from 'vitest'
import { buildStopBackgroundTask } from './stopBackgroundTaskEnvelope'
import { decodeEnvelope, encodeEnvelope } from './codec'

describe('buildStopBackgroundTask', () => {
  it.each([
    ['conv-42', 'task-7'],
    ['__proto__', 'constructor'],
    ['conversation\n<&>', 'task "<img src=x>"\u0000']
  ])('carries exactly conversation %j and task %j, byte-exact', (conversationId, taskId) => {
    const input = { id: 7, ts: '2026-10-05T10:00:00.000Z', conversationId, taskId,
      serverId: 'wrong-host', token: 'must-not-reach-wire' }
    const bytes = buildStopBackgroundTask(input)
    expect(bytes).toEqual(encodeEnvelope({
      id: 7,
      type: 'stop_background_task',
      ts: '2026-10-05T10:00:00.000Z',
      payload: { conversation_id: conversationId, task_id: taskId }
    }))
    expect(Object.keys(decodeEnvelope(bytes).payload as object)).toEqual(['conversation_id', 'task_id'])
  })
})
