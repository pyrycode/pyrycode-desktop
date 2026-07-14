import { describe, it, expect } from 'vitest'
import { buildArchiveConversation } from './archiveConversationEnvelope'
import { decodeEnvelope, WireEncodeError } from './codec'
import { MAX_PLAINTEXT_BYTES, type ArchiveConversationPayload } from '../../shared/wire/types'

// The pure builder mirrors buildUnarchiveConversation: (id, ts, payload) → serialized
// archive_conversation bytes, no clock/counter/side-effects. It uses the REAL codec so the
// assertions pin actual wire bytes. Like the unarchive builder — a single required-string
// field, so there is no explicit-null subtlety to preserve (#363).
describe('buildArchiveConversation', () => {
  const FIXED_TS = '2026-07-14T12:00:00.000Z'

  it('round-trips an archive_conversation envelope carrying the exact id, ts, and conversation_id', () => {
    const payload: ArchiveConversationPayload = { conversation_id: 'conv-9' }

    const envelope = decodeEnvelope(buildArchiveConversation({ id: 2, ts: FIXED_TS, payload }))
    expect(envelope.type).toBe('archive_conversation')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    expect(envelope.payload).toEqual(payload)
  })

  it('throws WireEncodeError when the envelope exceeds the plaintext cap', () => {
    const overCap: ArchiveConversationPayload = {
      conversation_id: 'x'.repeat(MAX_PLAINTEXT_BYTES + 1)
    }

    expect(() => buildArchiveConversation({ id: 2, ts: FIXED_TS, payload: overCap })).toThrow(
      WireEncodeError
    )
  })
})
