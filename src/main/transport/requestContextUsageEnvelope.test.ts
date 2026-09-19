import { describe, expect, it } from 'vitest'
import { buildRequestContextUsage } from './requestContextUsageEnvelope'
import { decodeEnvelope } from './codec'

describe('buildRequestContextUsage', () => {
  it.each(['conv-42', '', '__proto__', 'conversation\n<&>'])('preserves the exact id %j', (conversationId) => {
    const input = { id: 7, ts: '2026-09-19T10:00:00.000Z', conversationId,
      serverId: 'wrong-host', token: 'must-not-reach-wire' }
    expect(decodeEnvelope(buildRequestContextUsage(input))).toEqual({
      id: 7,
      type: 'request_context_usage',
      ts: '2026-09-19T10:00:00.000Z',
      payload: { conversation_id: conversationId }
    })
  })
})
