import { describe, it, expect } from 'vitest'
import { buildDeleteConversation } from './deleteConversationEnvelope'
import { decodeEnvelope, WireEncodeError } from './codec'
import { MAX_PLAINTEXT_BYTES, type DeleteConversationPayload } from '../../shared/wire/types'

// The pure builder mirrors buildUnarchiveConversation: (id, ts, payload) → serialized
// delete_conversation bytes, no clock/counter/side-effects. It uses the REAL codec so the
// assertions pin actual wire bytes. A single required-string field, so there is no explicit-null
// subtlety to preserve; delete is the PERMANENT hard-delete verb (#364).
describe('buildDeleteConversation', () => {
  const FIXED_TS = '2026-07-14T12:00:00.000Z'

  it('round-trips a delete_conversation envelope carrying the exact id, ts, and conversation_id', () => {
    const payload: DeleteConversationPayload = { conversation_id: 'conv-del-9' }

    const envelope = decodeEnvelope(buildDeleteConversation({ id: 2, ts: FIXED_TS, payload }))
    expect(envelope.type).toBe('delete_conversation')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    expect(envelope.payload).toEqual(payload)
  })

  it('throws WireEncodeError when the envelope exceeds the plaintext cap', () => {
    const overCap: DeleteConversationPayload = {
      conversation_id: 'x'.repeat(MAX_PLAINTEXT_BYTES + 1)
    }

    expect(() => buildDeleteConversation({ id: 2, ts: FIXED_TS, payload: overCap })).toThrow(
      WireEncodeError
    )
  })
})
