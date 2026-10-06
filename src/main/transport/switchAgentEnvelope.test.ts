import { describe, expect, it } from 'vitest'
import { buildSwitchAgent } from './switchAgentEnvelope'
import { decodeEnvelope } from './codec'
import type { SwitchAgentPayload } from '../../shared/wire/types'

describe('buildSwitchAgent', () => {
  const ts = '2026-10-06T00:00:00.000Z'
  const variants: SwitchAgentPayload[] = [
    { conversation_id: 'conv-1', agent: 'codex', model: '' },
    { conversation_id: 'conv-1', agent: 'claude', model: '  opus  ', effort: ' high ' },
    { conversation_id: 'conv-1', agent: 'codex', model: '', effort: '' },
    { conversation_id: 'conv-1', agent: 'claude', model: '', effort: undefined }
  ]
  it.each(variants)('encodes exact envelope bytes and strips extra fields: %j', (payload) => {
    const expectedPayload = { ...payload }
    if (expectedPayload.effort === undefined) delete expectedPayload.effort
    const bytes = buildSwitchAgent({ id: 7, ts, payload: { ...payload, extra: 'untrusted' } as SwitchAgentPayload })
    const expected = { id: 7, type: 'switch_agent', ts, payload: expectedPayload }
    expect(Buffer.from(bytes).toString('utf8')).toBe(JSON.stringify(expected))
    expect(decodeEnvelope(bytes)).toEqual(expected)
  })
})
