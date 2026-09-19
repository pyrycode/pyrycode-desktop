// Main-process only: encoding and plaintext bytes stay outside the renderer.
import { encodeEnvelope } from './codec'
import type { RequestContextUsagePayload } from '../../shared/wire/types'

export interface RequestContextUsageInput {
  id: number
  ts: string
  conversationId: string
}

/** A fresh one-field payload prevents extra renderer fields from reaching the wire. */
export function buildRequestContextUsage(input: RequestContextUsageInput): Uint8Array {
  const payload: RequestContextUsagePayload = { conversation_id: input.conversationId }
  return encodeEnvelope({
    id: input.id,
    type: 'request_context_usage',
    ts: input.ts,
    payload
  })
}
