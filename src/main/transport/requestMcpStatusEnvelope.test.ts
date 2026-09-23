import { describe, expect, it } from 'vitest'
import { buildRequestMcpStatus } from './requestMcpStatusEnvelope'
import { decodeEnvelope } from './codec'

describe('buildRequestMcpStatus', () => {
  it.each(['conv-42', '', '__proto__', 'conversation\n<&>'])('preserves the exact id %j', (conversationId) => {
    const input = { id: 7, ts: '2026-09-23T10:00:00.000Z', conversationId,
      serverId: 'wrong-host', token: 'must-not-reach-wire' }
    expect(decodeEnvelope(buildRequestMcpStatus(input))).toEqual({
      id: 7,
      type: 'mcp_status_request',
      ts: '2026-09-23T10:00:00.000Z',
      payload: { conversation_id: conversationId }
    })
  })
})
