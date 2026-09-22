import { describe, expect, it } from 'vitest'
import { parseInboundMessage, turnEndMetricsOf } from './inboundMessage'
import { encodeEnvelope } from './codec'

// #1565: the six claude `result` numbers a `turn_end` carries, on the live frame and inside a
// history page. Mirrors stoppedTurn.test.ts, which covers the frame's optional report strings.
const base = { conversation_id: 'c', turn_id: 't', stop_reason: 'end_turn' }
function decode(payload: unknown, history = false) {
  const result = parseInboundMessage(encodeEnvelope({ id: 1, ts: '2026-09-22T12:00:00Z',
    type: history ? 'history_page' : 'turn_end',
    payload: history ? { entries: [{ id: 1, type: 'turn_end', ts: '2026-09-22T12:00:00Z', payload }], cursor: '', at_start: true } : payload
  }))
  if (result?.kind === 'turn-end') return result.turnEnd
  if (result?.kind === 'history-page') return result.historyPage.entries[0]?.event
  throw new Error('missing boundary')
}

const wireKeys = ['duration_ms', 'input_tokens', 'cache_read_tokens', 'cache_creation_tokens', 'output_tokens', 'cost_usd_total']
const eventKeys = ['durationMs', 'inputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'outputTokens', 'costUsdTotal']
const withValues = (values: readonly unknown[]) => ({ ...base, ...Object.fromEntries(wireKeys.map((k, i) => [k, values[i]])) })

describe('turn end metrics decoding', () => {
  for (const history of [false, true]) {
    const keys = history ? eventKeys : wireKeys
    const label = history ? 'history' : 'live'

    it(`carries all six numbers as received in ${label} delivery`, () => {
      const values = [61234, 12, 40000, 3000, 850, 1.2345]
      expect(decode(withValues(values), history)).toMatchObject(Object.fromEntries(keys.map((k, i) => [k, values[i]])))
    })

    it(`carries zero and negatives unchanged, with no clamping, in ${label} delivery`, () => {
      const values = [0, -5, 0, -1, 0, -0.01]
      expect(decode(withValues(values), history)).toMatchObject(Object.fromEntries(keys.map((k, i) => [k, values[i]])))
    })

    it(`decodes a ${label} boundary without them exactly as before`, () => {
      const absent = decode(base, history)
      for (const key of keys) expect(absent).not.toHaveProperty(key, expect.anything())
      expect(absent).toMatchObject(history ? { turnId: 't', stopReason: 'end_turn' } : base)
    })

    it(`drops non-numeric values without losing the ${label} boundary`, () => {
      const parsed = decode(withValues(['12', null, true, {}, [], '0.5']), history)
      for (const key of keys) expect(parsed).not.toHaveProperty(key, expect.anything())
      expect(parsed).toMatchObject(history ? { turnId: 't' } : { turn_id: 't' })
    })

    it(`never carries duration_api_ms or num_turns in ${label} delivery`, () => {
      const parsed = decode({ ...base, duration_api_ms: 99, num_turns: 4 }, history)
      expect(JSON.stringify(parsed)).not.toMatch(/99|num_turns|numTurns|durationApi|duration_api/)
    })
  }

  it('drops an out-of-range literal that JSON.parse turns into Infinity, keeping the boundary', () => {
    // JSON.stringify cannot emit a non-finite number, but JSON.parse reads `1e400` as Infinity, so a
    // daemon frame CAN carry one. Build the bytes by hand to reach the guard through the real decode.
    const json = JSON.stringify({ id: 1, ts: '2026-09-22T12:00:00Z', type: 'turn_end',
      payload: { ...base, duration_ms: '@INF@', output_tokens: '@NEGINF@', input_tokens: 7 } })
      .replace('"@INF@"', '1e400').replace('"@NEGINF@"', '-1e400')
    const result = parseInboundMessage(new TextEncoder().encode(json))
    if (result?.kind !== 'turn-end') throw new Error('missing boundary')
    expect(result.turnEnd).toMatchObject({ ...base, input_tokens: 7 })
    expect(result.turnEnd).not.toHaveProperty('duration_ms', expect.anything())
    expect(result.turnEnd).not.toHaveProperty('output_tokens', expect.anything())
  })

  it('maps the snake-case payload to a fresh camelCase literal carrying only the six fields', () => {
    const metrics = turnEndMetricsOf({ conversation_id: 'c', turn_id: 't', stop_reason: 'end_turn', outcome: 'x',
      duration_ms: 1, input_tokens: 2, cache_read_tokens: 3, cache_creation_tokens: 4, output_tokens: 5, cost_usd_total: 6 })
    expect(metrics).toEqual({ durationMs: 1, inputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4, outputTokens: 5, costUsdTotal: 6 })
    expect(Object.keys(metrics).sort()).toEqual([...eventKeys].sort())
  })
})
