import { describe, it, expect } from 'vitest'
import { buildDequeueMessage } from './dequeueMessageEnvelope'
import { decodeEnvelope, WireEncodeError } from './codec'
import { MAX_PLAINTEXT_BYTES, type DequeueMessagePayload } from '../../shared/wire/types'

// The pure builder mirrors buildRequestSnapshot: (id, ts, payload) → serialized dequeue_message bytes,
// no clock/counter/side-effects. It uses the REAL codec so the assertions pin actual wire bytes.
// `dequeue_message` is an ungated control frame (SSOT pyrycode #720) — it carries a real payload
// (the conversation_id + the queued_msg_id the daemon's msgqueue.Remove deletes), but no nonce and
// no answer token.
describe('buildDequeueMessage', () => {
  const FIXED_TS = '2026-07-12T12:00:00.000Z'
  const PAYLOAD: DequeueMessagePayload = { conversation_id: 'conv-1', queued_msg_id: 7 }

  it('round-trips to a dequeue_message envelope carrying the exact id, ts, and payload', () => {
    const bytes = buildDequeueMessage({ id: 3, ts: FIXED_TS, payload: PAYLOAD })

    const envelope = decodeEnvelope(bytes)
    expect(envelope.type).toBe('dequeue_message')
    expect(envelope.id).toBe(3)
    expect(envelope.ts).toBe(FIXED_TS)
    expect(envelope.payload).toEqual(PAYLOAD)
  })

  it('decodes queued_msg_id as a number — symmetric with the inbound QueuedItem', () => {
    const bytes = buildDequeueMessage({ id: 3, ts: FIXED_TS, payload: PAYLOAD })

    const envelope = decodeEnvelope(bytes)
    expect(typeof (envelope.payload as DequeueMessagePayload).queued_msg_id).toBe('number')
  })

  it('throws WireEncodeError when the envelope exceeds the plaintext cap', () => {
    const overCap: DequeueMessagePayload = {
      conversation_id: 'x'.repeat(MAX_PLAINTEXT_BYTES + 1),
      queued_msg_id: 7
    }

    expect(() => buildDequeueMessage({ id: 3, ts: FIXED_TS, payload: overCap })).toThrow(
      WireEncodeError
    )
  })
})
