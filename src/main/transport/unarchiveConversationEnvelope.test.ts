import { describe, it, expect } from 'vitest'
import { buildUnarchiveConversation } from './unarchiveConversationEnvelope'
import { decodeEnvelope, WireEncodeError } from './codec'
import { MAX_PLAINTEXT_BYTES, type UnarchiveConversationPayload } from '../../shared/wire/types'

// The pure builder mirrors buildPromoteConversation: (id, ts, payload) → serialized
// unarchive_conversation bytes, no clock/counter/side-effects. It uses the REAL codec so the
// assertions pin actual wire bytes. Simpler than the promote builder — a single required-string
// field, so there is no explicit-null subtlety to preserve (#346).
describe('buildUnarchiveConversation', () => {
  const FIXED_TS = '2026-07-14T12:00:00.000Z'

  it('round-trips an unarchive_conversation envelope carrying the exact id, ts, and conversation_id', () => {
    const payload: UnarchiveConversationPayload = { conversation_id: 'conv-9' }

    const envelope = decodeEnvelope(buildUnarchiveConversation({ id: 2, ts: FIXED_TS, payload }))
    expect(envelope.type).toBe('unarchive_conversation')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    expect(envelope.payload).toEqual(payload)
  })

  it('throws WireEncodeError when the envelope exceeds the plaintext cap', () => {
    const overCap: UnarchiveConversationPayload = {
      conversation_id: 'x'.repeat(MAX_PLAINTEXT_BYTES + 1)
    }

    expect(() => buildUnarchiveConversation({ id: 2, ts: FIXED_TS, payload: overCap })).toThrow(
      WireEncodeError
    )
  })
})
