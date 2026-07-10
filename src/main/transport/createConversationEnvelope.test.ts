import { describe, it, expect } from 'vitest'
import { buildCreateConversation } from './createConversationEnvelope'
import { decodeEnvelope, WireEncodeError } from './codec'
import { MAX_PLAINTEXT_BYTES, type CreateConversationPayload } from '../../shared/wire/types'

// The pure builder mirrors buildRequestSnapshot: (id, ts, payload) → serialized create_conversation
// bytes, no clock/counter/side-effects. It uses the REAL codec so the assertions pin actual wire
// bytes — including the load-bearing subtlety that the three nullable fields serialize as explicit
// `null`s (JSON.stringify keeps them), exactly the daemon's own encoding (#241).
describe('buildCreateConversation', () => {
  const FIXED_TS = '2026-07-10T12:00:00.000Z'

  it('round-trips a create_conversation envelope preserving the three explicit nulls (daemon defaults)', () => {
    const allNull: CreateConversationPayload = { is_promoted: null, name: null, cwd: null }

    const bytes = buildCreateConversation({ id: 2, ts: FIXED_TS, payload: allNull })

    const envelope = decodeEnvelope(bytes)
    expect(envelope.type).toBe('create_conversation')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    // The explicit nulls survive JSON.stringify — the key is present with a null value (never omitted),
    // which is the daemon's "take the server default" signal.
    expect(envelope.payload).toEqual({ is_promoted: null, name: null, cwd: null })
  })

  it('round-trips a fully-populated create_conversation envelope carrying the exact payload', () => {
    const populated: CreateConversationPayload = {
      is_promoted: true,
      name: 'design review',
      cwd: '/home/user/project'
    }

    const envelope = decodeEnvelope(buildCreateConversation({ id: 3, ts: FIXED_TS, payload: populated }))
    expect(envelope.type).toBe('create_conversation')
    expect(envelope.id).toBe(3)
    expect(envelope.payload).toEqual(populated)
  })

  it('throws WireEncodeError when the envelope exceeds the plaintext cap', () => {
    const overCap: CreateConversationPayload = {
      is_promoted: null,
      name: 'x'.repeat(MAX_PLAINTEXT_BYTES + 1),
      cwd: null
    }

    expect(() => buildCreateConversation({ id: 2, ts: FIXED_TS, payload: overCap })).toThrow(
      WireEncodeError
    )
  })
})
