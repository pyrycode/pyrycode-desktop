import { describe, expect, it } from 'vitest'
import { parseInboundMessage } from './inboundMessage'
import { encodeEnvelope } from './codec'

const base = { conversation_id: 'c', turn_id: 't', stop_reason: 'end_turn' }
function decode(payload: unknown, history = false) {
  const result = parseInboundMessage(encodeEnvelope({ id: 1, ts: '2026-09-11T12:00:00Z',
    type: history ? 'history_page' : 'turn_end',
    payload: history ? { entries: [{ id: 1, type: 'turn_end', ts: '2026-09-11T12:00:00Z', payload }], cursor: '', at_start: true } : payload
  }))
  if (result?.kind === 'turn-end') return result.turnEnd
  if (result?.kind === 'history-page') return result.historyPage.entries[0]?.event
  throw new Error('missing boundary')
}
describe('stopped turn metadata decoding', () => {
  for (const history of [false, true]) {
    const keys = history ? ['outcome', 'isError', 'terminalReason', 'errorCategory'] : ['outcome', 'is_error', 'terminal_reason', 'error_category']
    it(`preserves optional fields in ${history ? 'history' : 'live'} delivery`, () => {
      const parsed = decode({ ...base, outcome: 'success', is_error: true, terminal_reason: 'prompt_too_long', error_category: 'future' }, history)
      expect(parsed).toMatchObject(Object.fromEntries(keys.map((key, i) => [key, ['success', true, 'prompt_too_long', 'future'][i]])))
      expect(decode({ ...base, outcome: '', is_error: false, terminal_reason: '', error_category: '' }, history)).toMatchObject(
        Object.fromEntries(keys.map((key, i) => [key, i === 1 ? false : ''])))
      const absent = decode(base, history)
      for (const key of keys) expect(absent).not.toHaveProperty(key, expect.anything())
    })
    it(`ignores malformed optional values without losing ${history ? 'history' : 'live'} boundary`, () => {
      const parsed = decode({ ...base, outcome: 7, is_error: 'true', terminal_reason: [], error_category: {} }, history)
      for (const key of keys) expect(parsed).not.toHaveProperty(key, expect.anything())
      for (const value of ['x'.repeat(257), 'é'.repeat(129)]) {
        const overlong = decode({ ...base, outcome: value, terminal_reason: value, error_category: value }, history)
        for (const key of [keys[0], keys[2], keys[3]]) expect(overlong).not.toHaveProperty(key, expect.anything())
      }
      expect(decode({ ...base, outcome: 'é'.repeat(128) }, history)).toHaveProperty('outcome', 'é'.repeat(128))
    })
  }
  it('still rejects a malformed required field', () => {
    expect(() => decode({ ...base, turn_id: 1 })).toThrow()
  })
})
