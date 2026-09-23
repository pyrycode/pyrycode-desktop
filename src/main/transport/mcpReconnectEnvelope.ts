// Main-process only: encoding and plaintext bytes stay outside the renderer.
import { encodeEnvelope } from './codec'
import type { MCPReconnectPayload } from '../../shared/wire/types'

export interface McpReconnectInput {
  id: number
  ts: string
  conversationId: string
  serverName: string
}

/** A fresh two-field payload prevents extra renderer fields from reaching the wire. */
export function buildMcpReconnect(input: McpReconnectInput): Uint8Array {
  const payload: MCPReconnectPayload = { conversation_id: input.conversationId, server_name: input.serverName }
  return encodeEnvelope({
    id: input.id,
    type: 'mcp_reconnect',
    ts: input.ts,
    payload
  })
}
