import { describe, expect, it } from 'vitest'
import { buildMcpToggle } from './mcpToggleEnvelope'
import { decodeEnvelope } from './codec'

describe('buildMcpToggle', () => {
  it.each([
    ['conv-42', 'docs', true],
    ['conv-42', 'docs', false],
    ['', '', false],
    ['__proto__', 'constructor', true],
    ['conversation\n<&>', 'server "<img src=x>"\u0000', false]
  ])('carries exactly %j, %j and enabled %j, unchanged', (conversationId, serverName, enabled) => {
    const input = { id: 7, ts: '2026-09-23T10:00:00.000Z', conversationId, serverName, enabled,
      serverId: 'wrong-host', token: 'must-not-reach-wire' }
    const frame = decodeEnvelope(buildMcpToggle(input))
    expect(frame).toEqual({
      id: 7,
      type: 'mcp_toggle',
      ts: '2026-09-23T10:00:00.000Z',
      payload: { conversation_id: conversationId, server_name: serverName, enabled }
    })
    // Present for false too: the daemon's omitted-key default must never be what carries the operator's choice.
    expect(Object.keys(frame.payload as object)).toContain('enabled')
  })
})
