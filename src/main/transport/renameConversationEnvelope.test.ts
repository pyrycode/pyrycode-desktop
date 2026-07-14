import { describe, it, expect } from 'vitest'
import { buildRenameConversation } from './renameConversationEnvelope'
import { decodeEnvelope, WireEncodeError } from './codec'
import { MAX_PLAINTEXT_BYTES, type RenameConversationPayload } from '../../shared/wire/types'

// The pure builder mirrors buildUnarchiveConversation / buildPromoteConversation: (id, ts, payload) →
// serialized rename_conversation bytes, no clock/counter/side-effects. It uses the REAL codec so the
// assertions pin actual wire bytes. Two required-string fields (conversation_id, name), so — like
// unarchive/promote — there is no explicit-null subtlety to preserve (#359).
describe('buildRenameConversation', () => {
  const FIXED_TS = '2026-07-14T12:00:00.000Z'

  it('round-trips a rename_conversation envelope carrying the exact id, ts, and payload', () => {
    const payload: RenameConversationPayload = { conversation_id: 'conv-9', name: 'weekly sync' }

    const envelope = decodeEnvelope(buildRenameConversation({ id: 2, ts: FIXED_TS, payload }))
    expect(envelope.type).toBe('rename_conversation')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    expect(envelope.payload).toEqual(payload)
  })

  it('throws WireEncodeError when the envelope exceeds the plaintext cap', () => {
    const overCap: RenameConversationPayload = {
      conversation_id: 'conv-9',
      name: 'x'.repeat(MAX_PLAINTEXT_BYTES + 1)
    }

    expect(() => buildRenameConversation({ id: 2, ts: FIXED_TS, payload: overCap })).toThrow(
      WireEncodeError
    )
  })
})
