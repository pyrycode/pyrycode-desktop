import { describe, it, expect } from 'vitest'
import { buildNewSession } from './newSessionEnvelope'
import { decodeEnvelope } from './codec'

// The pure builder mirrors buildRequestModelList: (id, ts, conversationId) → serialized new_session
// bytes, no clock/counter/side-effects. It uses the REAL codec so the assertions pin actual wire
// bytes, exactly like requestModelListEnvelope.test.ts.
//
// The divergence from that neighbour is what this file CANNOT test, and it is a safety property
// rather than an omission: there is no "names nothing" case, because an empty or absent id is not an
// unresolvable id on this verb — the protocol makes no payload, `{}`, an absent id and an explicitly
// empty one ONE wire meaning, the daemon's process-wide follow-active cursor. So the bare form is not
// a degraded request here, it is a restart of whichever conversation another connection's last
// send_message happened to stamp. This builder never emits it: the input types the id as required and
// the boundary guard refuses `''` one layer above (see the spec's § Security review).
describe('buildNewSession', () => {
  const FIXED_TS = '2026-09-07T12:00:00.000Z'

  it('round-trips to a new_session envelope carrying the exact id and ts', () => {
    const bytes = buildNewSession({ id: 7, ts: FIXED_TS, conversationId: 'conv-42' })

    const envelope = decodeEnvelope(bytes)
    expect(envelope.type).toBe('new_session')
    expect(envelope.id).toBe(7)
    expect(envelope.ts).toBe(FIXED_TS)
  })

  it('carries the named conversation id verbatim (AC2)', () => {
    // The id is CLIENT-OWNED — it comes from the renderer's own conversation state, never off the
    // network — and it is asserted distinct from every other string field on the envelope so a
    // transposition against `ts` cannot pass. It travels as a JSON string field into encodeEnvelope
    // and reaches no log line, no path, no attribute and no cache key on either side of the wire.
    // Daemon-side it is a registry-validated lookup key, never authorization; an id the daemon cannot
    // act on is silently inert, with no reply and never a fall-through to another conversation.
    const envelope = decodeEnvelope(
      buildNewSession({ id: 1, ts: FIXED_TS, conversationId: 'conv-42' })
    )
    expect(envelope.payload).toEqual({ conversation_id: 'conv-42' })
  })

  it('emits conversation_id as its only payload key, always a string', () => {
    // Exactly one field reaches the wire. A second selector appearing here would be a new way to
    // address someone else's data, and would fail this — the assertion is the fresh-literal
    // construction's detector, so a later `...spread` of a caller's object reddens here.
    const payload = decodeEnvelope(
      buildNewSession({ id: 2, ts: FIXED_TS, conversationId: 'conv-7' })
    ).payload as Record<string, unknown>

    expect(Object.keys(payload)).toEqual(['conversation_id'])
    expect(typeof payload.conversation_id).toBe('string')
  })

  it('carries no token, no nonce, no answer token and no correlation key (AC2, negative half)', () => {
    // The whole-key-set assertion, not a per-field absence check: `new_session` is fire-and-forget
    // with no reply, so it needs no correlation key, and the daemon documents a replay as harmless
    // (it simply starts another fresh session), so it needs no idempotency key or nonce. Any of those
    // appearing later would add a key to one of these two sets and redden here.
    const envelope = decodeEnvelope(
      buildNewSession({ id: 3, ts: FIXED_TS, conversationId: 'conv-7' })
    )

    expect(Object.keys(envelope).sort()).toEqual(['id', 'payload', 'ts', 'type'])
    expect(Object.keys(envelope.payload as Record<string, unknown>)).toEqual(['conversation_id'])
  })
})
