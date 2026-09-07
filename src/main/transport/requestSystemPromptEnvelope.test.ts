import { describe, it, expect } from 'vitest'
import { buildRequestSystemPrompt } from './requestSystemPromptEnvelope'
import { decodeEnvelope } from './codec'

// The pure builder mirrors buildRequestModelList: (id, ts, conversationId) → serialized
// request_system_prompt bytes, no clock/counter/side-effects. It uses the REAL codec so the
// assertions pin actual wire bytes, exactly like requestModelListEnvelope.test.ts. Like that
// neighbour and unlike requestSessionSettingsEnvelope.test.ts, there is no "names nothing" case to
// loop over: the id is required, so a request with no conversation to name has nothing to ask about.
describe('buildRequestSystemPrompt', () => {
  const FIXED_TS = '2026-09-07T12:00:00.000Z'

  it('round-trips to a request_system_prompt envelope carrying the exact id and ts', () => {
    const bytes = buildRequestSystemPrompt({ id: 7, ts: FIXED_TS, conversationId: 'conv-42' })

    const envelope = decodeEnvelope(bytes)
    expect(envelope.type).toBe('request_system_prompt')
    expect(envelope.id).toBe(7)
    expect(envelope.ts).toBe(FIXED_TS)
  })

  it('carries the named conversation id verbatim', () => {
    // The id is CLIENT-OWNED — it comes from this app's own conversation state, never off the network
    // — and it is asserted distinct from every other string field on the envelope so a transposition
    // against `ts` cannot pass. It travels as a JSON string field into encodeEnvelope and reaches no
    // log line, no path, no attribute and no cache key on either side of the wire.
    const envelope = decodeEnvelope(
      buildRequestSystemPrompt({ id: 1, ts: FIXED_TS, conversationId: 'conv-42' })
    )
    expect(envelope.payload).toEqual({ conversation_id: 'conv-42' })
  })

  it('emits conversation_id as its only key, always a string', () => {
    // Exactly one field reaches the wire. A second selector appearing here would be a new way to
    // address someone else's data, and would fail this — the assertion is the fresh-literal
    // construction's detector, so a later `...spread` of a caller's object reddens here.
    const payload = decodeEnvelope(
      buildRequestSystemPrompt({ id: 2, ts: FIXED_TS, conversationId: 'conv-7' })
    ).payload as Record<string, unknown>

    expect(Object.keys(payload)).toEqual(['conversation_id'])
    expect(typeof payload.conversation_id).toBe('string')
  })

  it('sends an empty conversation id as written, with no normalisation of its own', () => {
    // NOT an endorsement of sending one — this verb has no error frame, so an empty id on the wire
    // draws an ordinary-looking `no_session` reply that nothing downstream can tell from a true one.
    // The refusal lives at the IPC arm's routing lookup, which puts such a frame on no wire at all.
    // What this pins is that the BUILDER invents no policy of its own: no `?? ''` (there is nothing
    // optional to normalise, unlike buildRequestSessionSettings) and no emptiness check that would
    // duplicate a bound the daemon owns. A builder that silently substituted a fallback id here would
    // address a conversation the caller never named.
    const payload = decodeEnvelope(
      buildRequestSystemPrompt({ id: 3, ts: FIXED_TS, conversationId: '' })
    ).payload as Record<string, unknown>

    expect(payload).toEqual({ conversation_id: '' })
  })
})
