// Main-process only: encoding and plaintext bytes stay outside the renderer.
import { encodeEnvelope } from './codec'
import type { MCPTogglePayload } from '../../shared/wire/types'

export interface McpToggleInput {
  id: number
  ts: string
  conversationId: string
  serverName: string
  enabled: boolean
}

/** A fresh three-field payload prevents extra renderer fields from reaching the wire, and always writes
 *  `enabled`, so the daemon's omitted-key default never stands in for the operator's choice. */
export function buildMcpToggle(input: McpToggleInput): Uint8Array {
  const payload: MCPTogglePayload = {
    conversation_id: input.conversationId,
    server_name: input.serverName,
    enabled: input.enabled
  }
  return encodeEnvelope({
    id: input.id,
    type: 'mcp_toggle',
    ts: input.ts,
    payload
  })
}
