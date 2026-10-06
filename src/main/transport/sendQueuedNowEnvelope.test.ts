import { describe, it, expect } from 'vitest'
import { buildSendQueuedNow } from './sendQueuedNowEnvelope'
import { decodeEnvelope, WireEncodeError } from './codec'
import { MAX_PLAINTEXT_BYTES, type SendQueuedNowPayload } from '../../shared/wire/types'

// The pure builder mirrors buildDequeueMessage against the REAL codec, so the assertions pin wire bytes.
describe('buildSendQueuedNow (#1726)', () => {
  const FIXED_TS = '2026-10-05T12:00:00.000Z'
  const PAYLOAD: SendQueuedNowPayload = { conversation_id: 'conv-1', queued_msg_id: 7 }

  it('round-trips to a send_queued_now envelope carrying the exact id, ts, and payload', () => {
    const envelope = decodeEnvelope(buildSendQueuedNow({ id: 3, ts: FIXED_TS, payload: PAYLOAD }))

    expect(envelope.type).toBe('send_queued_now')
    expect(envelope.id).toBe(3)
    expect(envelope.ts).toBe(FIXED_TS)
    expect(envelope.payload).toEqual(PAYLOAD)
  })

  it('throws WireEncodeError when the envelope exceeds the plaintext cap', () => {
    const overCap: SendQueuedNowPayload = {
      conversation_id: 'x'.repeat(MAX_PLAINTEXT_BYTES + 1),
      queued_msg_id: 7
    }

    expect(() => buildSendQueuedNow({ id: 3, ts: FIXED_TS, payload: overCap })).toThrow(WireEncodeError)
  })
})
