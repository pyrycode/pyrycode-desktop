import { describe, expect, it } from 'vitest'
import { buildMcpReconnect } from './mcpReconnectEnvelope'
import { decodeEnvelope } from './codec'

describe('buildMcpReconnect', () => {
  it.each([
    ['conv-42', 'docs'],
    ['', ''],
    ['__proto__', 'constructor'],
    ['conversation\n<&>', 'server "<img src=x>"\u0000']
  ])('carries exactly %j and %j, unchanged', (conversationId, serverName) => {
    const input = { id: 7, ts: '2026-09-23T10:00:00.000Z', conversationId, serverName,
      serverId: 'wrong-host', token: 'must-not-reach-wire' }
    expect(decodeEnvelope(buildMcpReconnect(input))).toEqual({
      id: 7,
      type: 'mcp_reconnect',
      ts: '2026-09-23T10:00:00.000Z',
      payload: { conversation_id: conversationId, server_name: serverName }
    })
  })
})
