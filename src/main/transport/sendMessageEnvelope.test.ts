import { describe, it, expect } from 'vitest'
import { buildSendMessage } from './sendMessageEnvelope'
import { decodeEnvelope, WireEncodeError } from './codec'
import { MAX_PLAINTEXT_BYTES, type SendMessagePayload } from '../../shared/wire/types'

// The pure builder mirrors buildClientHello: (id, ts, payload) → serialized send_message bytes,
// no clock/counter/side-effects. It uses the REAL codec so the assertions pin actual wire bytes,
// exactly like codec.test.ts's send_message round-trip (:193).
describe('buildSendMessage', () => {
  const FIXED_TS = '2026-07-04T12:00:00.000Z'
  const PAYLOAD: SendMessagePayload = { conversation_id: 'c1', message_id: 'm1', text: 'go' }

  it('round-trips to a send_message envelope carrying the exact id, ts, and payload', () => {
    const bytes = buildSendMessage({ id: 2, ts: FIXED_TS, payload: PAYLOAD })

    const envelope = decodeEnvelope(bytes)
    expect(envelope.type).toBe('send_message')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    expect(envelope.payload).toEqual(PAYLOAD)
  })

  // #1055 — the wire form of a message's attachments, asserted at the layer that actually decides it.
  // The builder serializes the payload verbatim, so `attachment_ids` is on the wire exactly as the
  // composer assigned it, in the order the pending set held.
  it('#1055: carries attachment_ids when the message names some', () => {
    const withFiles: SendMessagePayload = { ...PAYLOAD, attachment_ids: ['u-1', 'u-2'] }

    const envelope = decodeEnvelope(buildSendMessage({ id: 3, ts: FIXED_TS, payload: withFiles }))
    expect(envelope.payload).toEqual(withFiles)
  })

  // ⭐ AC1's absent-key regression case, and the reason the composer needs no conditional key: the
  // field is assigned `undefined` unconditionally (the `createdAt` idiom) and JSON.stringify drops it,
  // so the frame keeps its three-key form — never `null`, never `[]`.
  it('#1055: emits NO attachment_ids key for an undefined value', () => {
    const noFiles: SendMessagePayload = { ...PAYLOAD, attachment_ids: undefined }

    const envelope = decodeEnvelope(buildSendMessage({ id: 4, ts: FIXED_TS, payload: noFiles }))
    expect(Object.keys(envelope.payload as object).sort()).toEqual([
      'conversation_id',
      'message_id',
      'text'
    ])
  })

  it('throws WireEncodeError when the envelope exceeds the plaintext cap', () => {
    const overCap: SendMessagePayload = {
      conversation_id: 'c1',
      message_id: 'm1',
      text: 'x'.repeat(MAX_PLAINTEXT_BYTES + 1)
    }

    expect(() => buildSendMessage({ id: 2, ts: FIXED_TS, payload: overCap })).toThrow(
      WireEncodeError
    )
  })
})
