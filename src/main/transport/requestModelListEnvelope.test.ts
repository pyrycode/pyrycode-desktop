import { describe, it, expect } from 'vitest'
import { buildRequestModelList } from './requestModelListEnvelope'
import { decodeEnvelope } from './codec'

// The pure builder mirrors buildRequestSessionSettings: (id, ts, conversationId) → serialized
// request_model_list bytes, no clock/counter/side-effects. It uses the REAL codec so the assertion
// pins actual wire bytes, exactly like requestSessionSettingsEnvelope.test.ts. The one divergence
// from that neighbour is what it CANNOT test: there is no "names nothing" case here, because the id
// is required — a request with no conversation to name has nothing to ask about, so the pair of
// shapes that file loops over collapses to one.
describe('buildRequestModelList', () => {
  const FIXED_TS = '2026-09-06T12:00:00.000Z'

  it('round-trips to a request_model_list envelope carrying the exact id and ts', () => {
    const bytes = buildRequestModelList({ id: 7, ts: FIXED_TS, conversationId: 'conv-42' })

    const envelope = decodeEnvelope(bytes)
    expect(envelope.type).toBe('request_model_list')
    expect(envelope.id).toBe(7)
    expect(envelope.ts).toBe(FIXED_TS)
  })

  it('carries the named conversation id verbatim', () => {
    // The id is CLIENT-OWNED — it comes from the renderer's own conversation state, never off the
    // network — and it is asserted distinct from every other string field on the envelope so a
    // transposition against `ts` cannot pass. It travels as a JSON string field into encodeEnvelope
    // and reaches no log line, no path, no attribute and no cache key on either side of the wire.
    // An id the daemon cannot resolve draws one `error` frame (`conversation.not_found`), never
    // another conversation's list.
    const envelope = decodeEnvelope(
      buildRequestModelList({ id: 1, ts: FIXED_TS, conversationId: 'conv-42' })
    )
    expect(envelope.payload).toEqual({ conversation_id: 'conv-42' })
  })

  it('emits conversation_id as its only key, always a string', () => {
    // Exactly one field reaches the wire. A second selector appearing here would be a new way to
    // address someone else's data, and would fail this — the assertion is the fresh-literal
    // construction's detector, so a later `...spread` of a caller's object reddens here.
    const payload = decodeEnvelope(
      buildRequestModelList({ id: 2, ts: FIXED_TS, conversationId: 'conv-7' })
    ).payload as Record<string, unknown>

    expect(Object.keys(payload)).toEqual(['conversation_id'])
    expect(typeof payload.conversation_id).toBe('string')
  })
})
