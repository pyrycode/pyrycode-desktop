// The post-handshake payload-carrying `delete_conversation` builder: it serializes a caller-supplied
// DeleteConversationPayload into the `delete_conversation` early-data bytes the Noise session (#7) /
// relay driver (#50) carry as an opaque Uint8Array — the outbound "ask" that PERMANENTLY removes a
// conversation. Unlike archive/unarchive (which flip a durable soft-state flag on a surviving row),
// delete removes the row outright. The daemon does NOT reply `conversation_updated`; it replies with a
// distinct `conversation_deleted { id }` record correlated to the requester (`in_reply_to`), with no
// broadcast — so there is no free re-list reflection. Decoding that reply and reflecting the removal via
// an explicit re-list are handled by the Delete-action caller (#367), NOT here; the desktop does not
// correlate any reply in this ticket. A sibling to unarchiveConversationEnvelope.ts /
// archiveConversationEnvelope.ts, following the same one-concern-per-file split.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope, DeleteConversationPayload } from '../../shared/wire/types'

/**
 * Inputs the consumer (createDaemonConnection.deleteConversation) supplies — the envelope id counter,
 * the wall clock, and the already-validated payload. Kept explicit (not read from globals) so the
 * builder is pure and trivially unit-testable, exactly like buildUnarchiveConversation.
 */
export interface DeleteConversationInput {
  /** The delete_conversation Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  /** The payload the consumer builds as a fresh literal (its single required-string field), serialized verbatim. */
  payload: DeleteConversationPayload
}

/**
 * Build the `delete_conversation` early-data bytes: a `delete_conversation` Envelope wrapping the
 * payload, serialized to UTF-8 via encodeEnvelope. Same shape as buildUnarchiveConversation: the sole
 * field is a required string, so there is no explicit-`null` preservation concern — the payload
 * serializes verbatim. The fresh literal that bounds the field set lives in the connection method
 * (deleteConversation).
 *
 * MAY throw WireEncodeError when the serialized envelope exceeds MAX_PLAINTEXT_BYTES; the sole caller
 * (connection.deleteConversation) catches it and drops the send.
 */
export function buildDeleteConversation(input: DeleteConversationInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'delete_conversation',
    ts: input.ts,
    payload: input.payload
  }
  return encodeEnvelope(envelope)
}
