// Main-process only: encoding and plaintext bytes stay outside the renderer.
import { encodeEnvelope } from './codec'
import type { MCPStatusRequestPayload } from '../../shared/wire/types'

export interface RequestMcpStatusInput {
  id: number
  ts: string
  conversationId: string
}

/** A fresh one-field payload prevents extra renderer fields from reaching the wire. */
export function buildRequestMcpStatus(input: RequestMcpStatusInput): Uint8Array {
  const payload: MCPStatusRequestPayload = { conversation_id: input.conversationId }
  return encodeEnvelope({
    id: input.id,
    type: 'mcp_status_request',
    ts: input.ts,
    payload
  })
}
