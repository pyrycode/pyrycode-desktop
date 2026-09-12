import { describe, expect, it } from 'vitest'
import { encodeEnvelope } from './codec'
import { parseInboundMessage } from './inboundMessage'
import type { EnvelopeType } from '../../shared/wire/types'

const frame = (type: EnvelopeType, payload: unknown) => encodeEnvelope({ id: 1, type, ts: 'stamp', payload })
const identity = { conversation_id: 'private-chat' }

describe('compaction decoding', () => {
  it.each([{}, { compact_result: '', compact_error: '' },
    { compact_result: 'future-result', compact_error: 'private-error' }])('retains outcomes %j and older payloads', report => {
    const payload = { ...identity, active: false, ...report }
    expect(parseInboundMessage(frame('compacting', payload)))
      .toEqual({ kind: 'compacting', compacting: payload, ts: 'stamp' })
    const history = parseInboundMessage(frame('history_page', {
      entries: [{ id: 1, type: 'compacting', ts: 'stamp', payload }], cursor: '', at_start: true
    }))
    expect(history).toMatchObject({ historyPage: { entries: [{ event: {
      type: 'compacting', active: false, compactResult: report.compact_result, compactError: report.compact_error
    } }] } })
  })

  it.each([{}, { pre_tokens: null, post_tokens: null }, { pre_tokens: 0, post_tokens: 0 },
    { pre_tokens: 180000, post_tokens: 40000 }])('keeps missing, null and zero counts distinct: %j', counts => {
    const payload = { ...identity, trigger: 'manual', ...counts }
    expect(parseInboundMessage(frame('compaction_boundary', { ...payload, ignored: 'private-extra' })))
      .toEqual({ kind: 'compaction-boundary', boundary: payload })
  })

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '180000', true, {}, []])('omits unusable count %j without dropping the marker', value => {
    expect(parseInboundMessage(frame('compaction_boundary', {
      ...identity, trigger: 'future', pre_tokens: value, post_tokens: 0
    }))).toMatchObject({ boundary: { pre_tokens: undefined, post_tokens: 0, trigger: 'future' } })
  })

  it.each([
    ['compacting', { ...identity, active: false, compact_result: 1 }],
    ['compacting', { ...identity, active: false, compact_error: null }],
    ['compacting', { ...identity, active: 'false' }],
    ['compacting', { active: true }],
    ['compaction_boundary', { ...identity, trigger: null }],
    ['compaction_boundary', { trigger: 'auto' }],
    ['compaction_boundary', { conversation_id: {}, trigger: 'auto' }],
    ['compaction_boundary', []]
  ] as const)('rejects malformed %s payload', (type, payload) => {
    expect(() => parseInboundMessage(frame(type, payload))).toThrow()
  })

  it.each(['compacting', 'compaction_boundary'] as const)('logs only shape for %s', type => {
    const logs: unknown[] = []
    const bytes = frame(type, { ...identity, active: false, compact_error: 'private-error',
      compact_result: 'private-result', trigger: 'private-trigger', pre_tokens: 180000, post_tokens: 40000 })
    parseInboundMessage(bytes, { event: entry => logs.push(entry) })
    expect(logs).toEqual([{ event: 'inbound-decoded', code: type, bytes: bytes.length, hash: expect.any(String) }])
    expect(JSON.stringify(logs)).not.toMatch(/private|180000|40000/)
  })
})
