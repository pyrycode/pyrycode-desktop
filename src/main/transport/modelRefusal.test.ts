import { describe, expect, it } from 'vitest'
import { encodeEnvelope } from './codec'
import { parseInboundMessage } from './inboundMessage'
import type { EnvelopeType } from '../../shared/wire/types'

const common = { conversation_id: 'chat', original_model: 'original', refusal_category: 'future',
  banner: '<script>private prose</script>', truncated_fields: ['banner', 'original_model'], dropped_fields: null }
const frame = (type: EnvelopeType, payload: unknown) => encodeEnvelope({ id: 1, type, ts: 'stamp', payload })

describe.each(['model_refusal_fallback', 'model_refusal_no_fallback'] as const)('%s', type => {
  const payload = type === 'model_refusal_fallback' ? { ...common, fallback_model: 'fallback', scope: 'session' } : common
  it('narrows the union and preserves every field without logging prose', () => {
    const logs: unknown[] = []
    const result = parseInboundMessage(frame(type, payload), { event: entry => logs.push(entry) })
    expect(result?.kind).toBe(type === 'model_refusal_fallback' ? 'model-refusal-fallback' : 'model-refusal-no-fallback')
    if (result?.kind === 'model-refusal-fallback') expect(result.refusal.fallback_model).toBe('fallback')
    else if (result?.kind === 'model-refusal-no-fallback') expect(result.refusal).not.toHaveProperty('fallback_model')
    expect(result).toMatchObject({ refusal: payload, ts: 'stamp' })
    expect(logs).toEqual([expect.objectContaining({ event: 'inbound-decoded', code: type })])
    expect(JSON.stringify(logs)).not.toContain('private prose')
  })
  it.each([null, [], ['banner', 'original_model']].map(report => [report]))('keeps reports %j and empty strings', report => {
    const value = Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, typeof value === 'string' ? '' : report]))
    value.truncated_fields = report
    value.dropped_fields = report
    expect(parseInboundMessage(frame(type, value))).toMatchObject({ refusal: value })
  })
  it.each(Object.keys(payload))('rejects absent or mistyped %s without content in errors/logs', key => {
    const missing: Record<string, unknown> = { ...payload }
    delete missing[key]
    for (const value of [missing, { ...payload, [key]: 42 }]) {
      const logs: unknown[] = []
      expect(() => parseInboundMessage(frame(type, value), { event: entry => logs.push(entry) })).toThrow()
      expect(JSON.stringify(logs)).not.toContain('private prose')
    }
  })
  it('rejects non-string report members', () => {
    expect(() => parseInboundMessage(frame(type, { ...payload, truncated_fields: ['banner', false] }))).toThrow()
  })
  it('decodes history with the same fields and drops payload conversation identity', () => {
    const result = parseInboundMessage(frame('history_page', {
      entries: [{ id: 1, type, ts: 'stamp', payload }], cursor: '', at_start: true
    }))
    expect(result?.kind).toBe('history-page')
    if (result?.kind !== 'history-page') return
    expect(result.historyPage.entries[0]?.event).toMatchObject({
      type: type === 'model_refusal_fallback' ? 'modelRefusalFallback' : 'modelRefusalNoFallback',
      originalModel: 'original', refusalCategory: 'future', banner: common.banner,
      truncatedFields: common.truncated_fields, droppedFields: null
    })
    expect(result.historyPage.entries[0]?.event).not.toHaveProperty('conversationId')
  })
})

it('preserves unknown scope strings', () => {
  expect(parseInboundMessage(frame('model_refusal_fallback', { ...common, fallback_model: '', scope: 'future' })))
    .toMatchObject({ refusal: { scope: 'future', fallback_model: '' } })
})
