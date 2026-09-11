import { describe, expect, it } from 'vitest'
import { encodeEnvelope } from './codec'
import { parseInboundMessage } from './inboundMessage'

const payload = {
  conversation_id: 'c1', turn_id: 't1', tool_use_id: 'u1', tool_name: 'Bash',
  decision_reason_type: 'rule', decision_reason: 'Blocked command', message: 'Permission required',
  truncated_fields: ['message'], dropped_fields: ['tool_name']
}
const frame = (value: unknown) => encodeEnvelope({ id: 1, type: 'tool_denied', ts: '2026-09-11T12:00:00Z', payload: value })

describe('tool denial decoder', () => {
  it('retains every field and logs only frame metadata', () => {
    const entries: unknown[] = []
    expect(parseInboundMessage(frame(payload), { event: (entry) => entries.push(entry) })).toMatchObject({
      kind: 'tool-denied', toolDenied: payload
    })
    expect(entries).toEqual([expect.objectContaining({ event: 'inbound-decoded', code: 'tool_denied' })])
    expect(JSON.stringify(entries)).not.toContain('Blocked command')
  })
  it.each([null, []])('preserves reports %j and empty strings', (reports) => {
    const value = { ...payload, decision_reason_type: '', decision_reason: '', message: '', truncated_fields: reports, dropped_fields: reports }
    expect(parseInboundMessage(frame(value))).toMatchObject({ kind: 'tool-denied', toolDenied: value })
  })
  it('preserves unknown source tokens without interpreting them', () => {
    const value = { ...payload, decision_reason_type: 'future' }
    expect(parseInboundMessage(frame(value))).toMatchObject({ toolDenied: value })
  })
  it.each(Object.keys(payload))('rejects a mistyped or absent %s', (key) => {
    expect(() => parseInboundMessage(frame({ ...payload, [key]: 42 }))).toThrow()
    const missing: Record<string, unknown> = { ...payload }
    delete missing[key]
    expect(() => parseInboundMessage(frame(missing))).toThrow()
  })
  it('rejects a non-string report entry', () => {
    expect(() => parseInboundMessage(frame({ ...payload, dropped_fields: [4] }))).toThrow()
  })
  it('decodes the same marker from stored history', () => {
    const decoded = parseInboundMessage(encodeEnvelope({
      id: 2, type: 'history_page', ts: '2026-09-11T12:00:00Z',
      payload: { entries: [{ id: 1, type: 'tool_denied', ts: '2026-09-11T12:00:00Z', payload }], cursor: '', at_start: true }
    }))
    expect(decoded).toMatchObject({ historyPage: { entries: [{ event: {
      type: 'toolDenied', turnId: 't1', toolUseId: 'u1', toolName: 'Bash',
      decisionReasonType: 'rule', decisionReason: 'Blocked command', message: 'Permission required',
      truncatedFields: ['message'], droppedFields: ['tool_name']
    } }] } })
  })
})
