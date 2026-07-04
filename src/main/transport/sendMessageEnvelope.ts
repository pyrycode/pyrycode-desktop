// The post-handshake app-message envelope builder: it turns an accepted send_message command's
// SendMessagePayload into the serialized `send_message` early-data bytes the Noise session (#7) /
// relay driver (#50) carry as an opaque Uint8Array. A sibling to helloExchange.ts, not part of it:
// helloExchange.ts is scoped to the handshake exchange (`hello`/`hello_ack`); `send_message` is
// post-handshake application traffic — same one-concern-per-file split the module already follows.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`) and the payload it serializes carries
// message plaintext. Never re-export it through any renderer barrel — the plaintext and raw bytes
// must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope, SendMessagePayload } from '../../shared/wire/types'

/**
 * Inputs the consumer (#62 `createDaemonConnection.send`) supplies — the envelope id counter, the
 * wall clock, and the already-validated payload. Kept explicit (not read from globals) so the
 * builder is pure and trivially unit-testable: no clock read, no counter, no side effects — exactly
 * like buildClientHello.
 */
export interface SendMessageInput {
  /** The send_message Envelope's numeric id (the consumer's id counter; hello consumed id 1). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  /** The validated command payload, serialized verbatim as the Envelope payload. */
  payload: SendMessagePayload
}

/**
 * Build the `send_message` early-data bytes: a `send_message` Envelope wrapping the payload,
 * serialized to UTF-8 via encodeEnvelope. Thinner than buildClientHello — SendMessagePayload has no
 * defaulted fields, so there is no make…Payload constructor to route through (codec.ts:157).
 *
 * MAY throw WireEncodeError when the serialized envelope exceeds MAX_PLAINTEXT_BYTES; the sole
 * caller (connection.send) catches it and drops the send.
 */
export function buildSendMessage(input: SendMessageInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'send_message',
    ts: input.ts,
    payload: input.payload
  }
  return encodeEnvelope(envelope)
}
