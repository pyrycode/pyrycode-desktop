// The `dequeue_message` builder: it serializes a caller-supplied DequeueMessagePayload into the
// `dequeue_message` early-data bytes the Noise session (#7) / relay driver (#50) carry as an opaque
// Uint8Array — the outbound request to drop one queued-but-not-yet-run message from a conversation's
// backlog (driving the daemon's msgqueue.Remove). A sibling to sendMessageEnvelope.ts, following
// the same one-concern-per-file split the module already uses. It is an UNGATED control frame (SSOT
// pyrycode #720): it carries a real payload (conversation_id + queued_msg_id), but NO nonce and NO
// answer token — unlike the modal-answer builders.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope, DequeueMessagePayload } from '../../shared/wire/types'

/**
 * Inputs the consumer (createDaemonConnection.dequeueMessage, #300) supplies — the envelope id
 * counter, the wall clock, and the already-validated payload. Kept explicit (not read from globals)
 * so the builder is pure and trivially unit-testable, exactly like buildSendMessage.
 */
export interface DequeueMessageInput {
  /** The dequeue_message Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  /** The validated command payload (conversation_id + queued_msg_id), serialized verbatim. */
  payload: DequeueMessagePayload
}

/**
 * Build the `dequeue_message` early-data bytes: a `dequeue_message` Envelope wrapping the payload,
 * serialized to UTF-8 via encodeEnvelope. Same shape as buildSendMessage — a real payload.
 *
 * MAY throw WireEncodeError when the serialized envelope exceeds MAX_PLAINTEXT_BYTES; the eventual
 * caller (connection.dequeueMessage, #300) catches it and drops the send.
 */
export function buildDequeueMessage(input: DequeueMessageInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'dequeue_message',
    ts: input.ts,
    payload: input.payload
  }
  return encodeEnvelope(envelope)
}
