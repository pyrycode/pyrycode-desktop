// The post-handshake payload-carrying `create_conversation` builder: it serializes a caller-supplied
// CreateConversationPayload into the `create_conversation` early-data bytes the Noise session (#7) /
// relay driver (#50) carry as an opaque Uint8Array — the outbound "ask" that makes the daemon create a
// fresh conversation and reply with one `conversation_created` frame. A sibling to
// sendMessageEnvelope.ts, following the same one-concern-per-file split.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope, CreateConversationPayload } from '../../shared/wire/types'

/**
 * Inputs the consumer (createDaemonConnection.createConversation) supplies — the envelope id counter,
 * the wall clock, and the already-validated payload. Kept explicit (not read from globals) so the
 * builder is pure and trivially unit-testable, exactly like buildSendMessage.
 */
export interface CreateConversationInput {
  /** The create_conversation Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  /** The payload the consumer builds as a fresh literal (its three nullable fields), serialized verbatim. */
  payload: CreateConversationPayload
}

/**
 * Build the `create_conversation` early-data bytes: a `create_conversation` Envelope wrapping the
 * payload, serialized to UTF-8 via encodeEnvelope. Same shape as buildSendMessage.
 *
 * JSON.stringify PRESERVES the three fields' explicit `null` values (it drops only `undefined`), so an
 * all-null payload serializes to `{"is_promoted":null,"name":null,"cwd":null}` — exactly the daemon's
 * own encoding, its "take the server default" signal. No special null handling is needed here; the
 * fresh literal that bounds the field set lives in the connection method (createConversation).
 *
 * MAY throw WireEncodeError when the serialized envelope exceeds MAX_PLAINTEXT_BYTES; the sole caller
 * (connection.createConversation) catches it and drops the send.
 */
export function buildCreateConversation(input: CreateConversationInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'create_conversation',
    ts: input.ts,
    payload: input.payload
  }
  return encodeEnvelope(envelope)
}
