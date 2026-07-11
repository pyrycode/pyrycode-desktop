// The post-handshake payload-carrying `promote_conversation` builder: it serializes a caller-supplied
// PromoteConversationPayload into the `promote_conversation` early-data bytes the Noise session (#7) /
// relay driver (#50) carry as an opaque Uint8Array — the outbound "ask" that promotes a discussion into
// a saved channel. The daemon confirms it with an unsolicited `conversation_updated` BROADCAST (not an
// in_reply_to reply). A sibling to createConversationEnvelope.ts / sendMessageEnvelope.ts, following the
// same one-concern-per-file split.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope, PromoteConversationPayload } from '../../shared/wire/types'

/**
 * Inputs the consumer (createDaemonConnection.promoteConversation) supplies — the envelope id counter,
 * the wall clock, and the already-validated payload. Kept explicit (not read from globals) so the
 * builder is pure and trivially unit-testable, exactly like buildCreateConversation.
 */
export interface PromoteConversationInput {
  /** The promote_conversation Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  /** The payload the consumer builds as a fresh literal (its three required-string fields), serialized verbatim. */
  payload: PromoteConversationPayload
}

/**
 * Build the `promote_conversation` early-data bytes: a `promote_conversation` Envelope wrapping the
 * payload, serialized to UTF-8 via encodeEnvelope. Same shape as buildCreateConversation, but simpler:
 * all three fields are required strings, so there is no explicit-`null` preservation concern — the
 * payload serializes verbatim. The fresh literal that bounds the field set lives in the connection
 * method (promoteConversation).
 *
 * MAY throw WireEncodeError when the serialized envelope exceeds MAX_PLAINTEXT_BYTES; the sole caller
 * (connection.promoteConversation) catches it and drops the send.
 */
export function buildPromoteConversation(input: PromoteConversationInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'promote_conversation',
    ts: input.ts,
    payload: input.payload
  }
  return encodeEnvelope(envelope)
}
