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
  it('skips malformed history entries without dropping valid attributed entries', () => {
    const decoded = parseInboundMessage(encodeEnvelope({
      id: 3, type: 'history_page', ts: '2026-09-11T12:00:00Z',
      payload: { entries: [null, 42, 'parent'].map((parent, id) => ({
        id, type: 'tool_use', ts: '2026-09-11T12:00:00Z',
        payload: { ...payload, parent_tool_use_id: parent }
      })), cursor: '', at_start: true }
    }))
    if (decoded?.kind !== 'history-page') throw new Error('missing history')
    expect(decoded.historyPage.entries).toHaveLength(1)
    expect(decoded.historyPage.entries[0].event).toMatchObject({ parentToolUseId: 'parent' })
  })
  it('replays attribution through history translation and result reduction', () => {
    const decoded = parseInboundMessage(encodeEnvelope({
      id: 2, type: 'history_page', ts: '2026-09-11T12:00:00Z',
      payload: { entries: ['tool_use', 'tool_result'].map((type, id) => ({
        id, type, ts: '2026-09-11T12:00:00Z',
        payload: { ...payload, parent_tool_use_id: id === 0 ? 'parent' : '' }
      })), cursor: '', at_start: true }
    }))
    if (decoded?.kind !== 'history-page') throw new Error('missing history')
    expect(decoded.historyPage.entries.map((entry) => entry.event)).toMatchObject([
      { type: 'toolUse', parentToolUseId: 'parent' },
      { type: 'toolResult', parentToolUseId: undefined }
    ])
  })
})
