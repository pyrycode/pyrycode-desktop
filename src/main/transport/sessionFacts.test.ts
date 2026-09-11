import { describe, expect, it, vi } from 'vitest'
import { parseInboundMessage } from './inboundMessage'
import { encodeEnvelope, WireDecodeError } from './codec'

const report = {
  conversation_id: 'facts-chat',
  claude_code_version: 'build-preview',
  permission_mode: 'futureMode',
  truncated_fields: ['permission_mode', 'future_field']
}
const frame = (payload: unknown) =>
  encodeEnvelope({ id: 1, type: 'session_facts', ts: '2026-09-11T12:00:00Z', payload })

describe('session_facts decoding', () => {
  it.each([{ truncated_fields: null }, { truncated_fields: [] }, { truncated_fields: ['permission_mode', 'future_field'] }])('preserves complete metadata $truncated_fields', ({ truncated_fields }) => {
    const sessionFacts = { ...report, truncated_fields }
    const decoded = parseInboundMessage(frame({ ...sessionFacts, extra: 'discard' }))
    expect(decoded).toEqual({ kind: 'session-facts', sessionFacts })
    if (decoded?.kind !== 'session-facts') throw new Error('wrong kind')
    expect(decoded.sessionFacts.permission_mode).toBe('futureMode')
  })

  it('preserves empty required strings', () => {
    const sessionFacts = { conversation_id: '', claude_code_version: '', permission_mode: '', truncated_fields: null }
    expect(parseInboundMessage(frame(sessionFacts))).toEqual({ kind: 'session-facts', sessionFacts })
  })

  it.each(Object.keys(report))('rejects missing %s', (field) => {
    const payload: Record<string, unknown> = { ...report }
    delete payload[field]
    expect(() => parseInboundMessage(frame(payload))).toThrow(WireDecodeError)
  })

  it.each([
    ['conversation_id', null], ['claude_code_version', 123], ['permission_mode', false],
    ['truncated_fields', 'permission_mode'], ['truncated_fields', [1]], ['truncated_fields', {}]
  ])('rejects mistyped %s', (field, value) => {
    expect(() => parseInboundMessage(frame({ ...report, [String(field)]: value }))).toThrow(WireDecodeError)
  })

  it('logs only static classification, length and hash', () => {
    const event = vi.fn()
    parseInboundMessage(frame(report), { event })
    expect(event).toHaveBeenCalledWith({
      event: 'inbound-decoded', code: 'session_facts', bytes: frame(report).length, hash: expect.any(String)
    })
    expect(JSON.stringify(event.mock.calls)).not.toContain(report.permission_mode)
    expect(JSON.stringify(event.mock.calls)).not.toContain(report.claude_code_version)
    expect(JSON.stringify(event.mock.calls)).not.toContain(report.conversation_id)
  })
})
