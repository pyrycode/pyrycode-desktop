import { describe, it, expect } from 'vitest'
import { buildModalAnswer, buildModalCancel } from './modalResolutionEnvelope'
import { decodeEnvelope, WireEncodeError } from './codec'
import {
  MAX_PLAINTEXT_BYTES,
  type ModalAnswerPayload,
  type ModalCancelPayload
} from '../../shared/wire/types'

// The pure builders mirror buildSendMessage: (id, ts, payload) → serialized bytes, no
// clock/counter/side-effects. They use the REAL codec so the assertions pin actual wire bytes.
// Both are outbound-only (client → daemon) — there is no decode path for these modal-resolution
// frames, so the round-trip only proves the encode side is byte-faithful.
describe('buildModalAnswer', () => {
  const FIXED_TS = '2026-07-10T12:00:00.000Z'
  const PAYLOAD: ModalAnswerPayload = {
    modal_id: 'mdl-7f3a',
    option_id: 'allow',
    answer_token: 'tok-9c2e'
  }

  it('round-trips to a modal_answer envelope carrying the exact id, ts, and payload', () => {
    const bytes = buildModalAnswer({ id: 3, ts: FIXED_TS, payload: PAYLOAD })

    const envelope = decodeEnvelope(bytes)
    expect(envelope.type).toBe('modal_answer')
    expect(envelope.id).toBe(3)
    expect(envelope.ts).toBe(FIXED_TS)
    // toEqual the whole payload confirms all three fields present, nothing dropped or added.
    expect(envelope.payload).toEqual(PAYLOAD)
  })

  it('throws WireEncodeError when the envelope exceeds the plaintext cap', () => {
    const overCap: ModalAnswerPayload = {
      modal_id: 'mdl-7f3a',
      option_id: 'allow',
      answer_token: 'x'.repeat(MAX_PLAINTEXT_BYTES + 1)
    }

    expect(() => buildModalAnswer({ id: 3, ts: FIXED_TS, payload: overCap })).toThrow(
      WireEncodeError
    )
  })
})

describe('buildModalCancel', () => {
  const FIXED_TS = '2026-07-10T12:00:00.000Z'
  const PAYLOAD: ModalCancelPayload = { modal_id: 'mdl-7f3a' }

  it('round-trips to a modal_cancel envelope carrying the exact id, ts, and no other fields', () => {
    const bytes = buildModalCancel({ id: 4, ts: FIXED_TS, payload: PAYLOAD })

    const envelope = decodeEnvelope(bytes)
    expect(envelope.type).toBe('modal_cancel')
    expect(envelope.id).toBe(4)
    expect(envelope.ts).toBe(FIXED_TS)
    // toEqual({ modal_id }) confirms modal_id is the sole payload field — no conversation_id.
    expect(envelope.payload).toEqual({ modal_id: 'mdl-7f3a' })
  })

  it('throws WireEncodeError when the envelope exceeds the plaintext cap', () => {
    const overCap: ModalCancelPayload = { modal_id: 'x'.repeat(MAX_PLAINTEXT_BYTES + 1) }

    expect(() => buildModalCancel({ id: 4, ts: FIXED_TS, payload: overCap })).toThrow(
      WireEncodeError
    )
  })
})
