import { describe, it, expect } from 'vitest'
import { buildInterrupt } from './interruptEnvelope'
import { decodeEnvelope } from './codec'

// The pure builder mirrors buildNewSession: (id, ts, conversationId) → serialized interrupt bytes, no
// clock/counter/side-effects. It uses the REAL codec so the assertion pins actual wire bytes, exactly
// like newSessionEnvelope.test.ts.
//
// The BARE form is not tested here because it is unreachable: `InterruptInput.conversationId` is
// required (#1092), so a builder call naming no conversation is a compile error rather than a case to
// assert on. That is the point of the required input — the empty form is the daemon's process-wide
// follow-active cursor, i.e. some other conversation's turn.
describe('buildInterrupt', () => {
  const FIXED_TS = '2026-07-04T12:00:00.000Z'

  it('round-trips to an interrupt envelope carrying the exact id, ts and conversation_id', () => {
    const bytes = buildInterrupt({ id: 7, ts: FIXED_TS, conversationId: 'conv-42' })

    const envelope = decodeEnvelope(bytes)
    expect(envelope.type).toBe('interrupt')
    expect(envelope.id).toBe(7)
    expect(envelope.ts).toBe(FIXED_TS)
    expect(envelope.payload).toEqual({ conversation_id: 'conv-42' })
  })

  it('bounds the payload to the one modeled field', () => {
    // The fresh-literal net: the builder names `conversation_id` and nothing else, so a field
    // smuggled past the structural-minimum boundary guard is dropped here rather than sent. Asserting
    // the KEY SET, not just the value, is what makes that a measurement — `toEqual` above would pass
    // on a spread that happened to carry the right id alongside an extra key it did not name.
    const envelope = decodeEnvelope(buildInterrupt({ id: 1, ts: FIXED_TS, conversationId: 'c-1' }))
    expect(Object.keys(envelope.payload as object)).toEqual(['conversation_id'])
  })
})
