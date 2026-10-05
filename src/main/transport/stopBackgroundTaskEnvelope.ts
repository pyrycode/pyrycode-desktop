// Main-process only: encoding and plaintext bytes stay outside the renderer.
import { encodeEnvelope } from './codec'
import type { StopBackgroundTaskPayload } from '../../shared/wire/types'

export interface StopBackgroundTaskInput {
  id: number
  ts: string
  conversationId: string
  taskId: string
}

/** A fresh two-field payload, so extra renderer fields never reach the wire (#1770). */
export function buildStopBackgroundTask(input: StopBackgroundTaskInput): Uint8Array {
  const payload: StopBackgroundTaskPayload = {
    conversation_id: input.conversationId,
    task_id: input.taskId
  }
  return encodeEnvelope({
    id: input.id,
    type: 'stop_background_task',
    ts: input.ts,
    payload
  })
}
