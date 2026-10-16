import { describe, expect, it } from 'vitest'
import { encodeEnvelope } from './codec'
import { parseInboundMessage } from './inboundMessage'

const payload = { conversation_id: 'c1', turn_id: 't1', tool_use_id: 'child', name: 'Read', input_summary: 'file', is_error: false, result_summary: 'done' }
const frame = (type: 'tool_use' | 'tool_result', parent: unknown) => encodeEnvelope({
  id: 1, type, ts: '2026-09-11T12:00:00Z', payload: { ...payload, parent_tool_use_id: parent }
})

describe('tool parent attribution', () => {
  for (const type of ['tool_use', 'tool_result'] as const) {
    it.each([undefined, '', ' parent <x> '])(`${type} preserves or normalizes %j`, (parent) => {
      const entries: unknown[] = []
      const decoded = parseInboundMessage(frame(type, parent), { event: (entry) => entries.push(entry) })
      if (!decoded) throw new Error('missing frame')
      const value = decoded.kind === 'tool-use' ? decoded.toolUse : decoded.kind === 'tool-result' ? decoded.toolResult : null
      expect(value).toHaveProperty('parent_tool_use_id', parent || undefined)
      expect(JSON.stringify(entries)).not.toContain('parent <x>')
    })
    it.each([null, 42, {}, []])(`${type} rejects non-string %j`, (parent) => {
      expect(() => parseInboundMessage(frame(type, parent))).toThrow()
    })
  }
})
