import { describe, it, expect } from 'vitest'
import { buildRequestSnapshot } from './requestSnapshotEnvelope'
import { decodeEnvelope, WireEncodeError } from './codec'
import { MAX_PLAINTEXT_BYTES, type RequestSnapshotPayload } from '../../shared/wire/types'

// The pure builder mirrors buildSendMessage: (id, ts, payload) → serialized request_snapshot bytes,
// no clock/counter/side-effects. It uses the REAL codec so the assertions pin actual wire bytes.
// Unlike buildRequestDebugBundle (a bare control frame), request_snapshot carries a real payload —
// the conversation_id the daemon needs to select which screen to snapshot (#180).
describe('buildRequestSnapshot', () => {
  const FIXED_TS = '2026-07-08T12:00:00.000Z'
  const PAYLOAD: RequestSnapshotPayload = { conversation_id: 'conv-1' }

  it('round-trips to a request_snapshot envelope carrying the exact id, ts, and payload', () => {
    const bytes = buildRequestSnapshot({ id: 2, ts: FIXED_TS, payload: PAYLOAD })

    const envelope = decodeEnvelope(bytes)
    expect(envelope.type).toBe('request_snapshot')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    expect(envelope.payload).toEqual(PAYLOAD)
  })

  it('throws WireEncodeError when the envelope exceeds the plaintext cap', () => {
    const overCap: RequestSnapshotPayload = { conversation_id: 'x'.repeat(MAX_PLAINTEXT_BYTES + 1) }

    expect(() => buildRequestSnapshot({ id: 2, ts: FIXED_TS, payload: overCap })).toThrow(
      WireEncodeError
    )
  })
})
