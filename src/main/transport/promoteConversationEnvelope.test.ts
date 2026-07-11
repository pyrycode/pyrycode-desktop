import { describe, it, expect } from 'vitest'
import { buildPromoteConversation } from './promoteConversationEnvelope'
import { decodeEnvelope, WireEncodeError } from './codec'
import { MAX_PLAINTEXT_BYTES, type PromoteConversationPayload } from '../../shared/wire/types'

// The pure builder mirrors buildCreateConversation: (id, ts, payload) → serialized promote_conversation
// bytes, no clock/counter/side-effects. It uses the REAL codec so the assertions pin actual wire bytes.
// Simpler than the create builder — all three fields are required strings, so there is no explicit-null
// subtlety to preserve (#273).
describe('buildPromoteConversation', () => {
  const FIXED_TS = '2026-07-12T12:00:00.000Z'

  it('round-trips a promote_conversation envelope carrying the exact id, ts, and three fields', () => {
    const payload: PromoteConversationPayload = {
      conversation_id: 'conv-9',
      name: 'weekly sync',
      cwd: '/home/user/project'
    }

    const envelope = decodeEnvelope(buildPromoteConversation({ id: 2, ts: FIXED_TS, payload }))
    expect(envelope.type).toBe('promote_conversation')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    expect(envelope.payload).toEqual(payload)
  })

  it('throws WireEncodeError when the envelope exceeds the plaintext cap', () => {
    const overCap: PromoteConversationPayload = {
      conversation_id: 'conv-9',
      name: 'x'.repeat(MAX_PLAINTEXT_BYTES + 1),
      cwd: '/home/user/project'
    }

    expect(() => buildPromoteConversation({ id: 2, ts: FIXED_TS, payload: overCap })).toThrow(
      WireEncodeError
    )
  })
})
