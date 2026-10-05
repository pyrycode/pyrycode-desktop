// The `send_queued_now` builder (#1726, pyrycode#2729): it serializes a caller-supplied
// SendQueuedNowPayload into the early-data bytes the Noise session / relay driver carry — the outbound
// request to hand one queued message to the RUNNING turn instead of after it ends. The twin of
// dequeueMessageEnvelope.ts: the same two fields, ungated, no nonce, no answer token, no reply frame.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope, SendQueuedNowPayload } from '../../shared/wire/types'

/** The consumer's envelope id, clock and already-validated payload, explicit so the builder is pure. */
export interface SendQueuedNowInput {
  id: number
  ts: string
  payload: SendQueuedNowPayload
}

/**
 * Build the `send_queued_now` early-data bytes. MAY throw WireEncodeError when the serialized envelope
 * exceeds MAX_PLAINTEXT_BYTES; the caller (connection.sendQueuedNow) catches it and drops the send.
 */
export function buildSendQueuedNow(input: SendQueuedNowInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'send_queued_now',
    ts: input.ts,
    payload: input.payload
  }
  return encodeEnvelope(envelope)
}
