// The post-handshake payload-carrying `unarchive_conversation` builder: it serializes a caller-supplied
// UnarchiveConversationPayload into the `unarchive_conversation` early-data bytes the Noise session (#7) /
// relay driver (#50) carry as an opaque Uint8Array — the outbound "ask" that restores an archived
// conversation to active. The daemon clears the durable archived flag, persists eagerly, and confirms with
// a `conversation_updated` record; the desktop does not correlate that reply here (#348 reads the restored
// state from the re-list). A sibling to promoteConversationEnvelope.ts / createConversationEnvelope.ts,
// following the same one-concern-per-file split.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope, UnarchiveConversationPayload } from '../../shared/wire/types'

/**
 * Inputs the consumer (createDaemonConnection.unarchiveConversation) supplies — the envelope id counter,
 * the wall clock, and the already-validated payload. Kept explicit (not read from globals) so the
 * builder is pure and trivially unit-testable, exactly like buildPromoteConversation.
 */
export interface UnarchiveConversationInput {
  /** The unarchive_conversation Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  /** The payload the consumer builds as a fresh literal (its single required-string field), serialized verbatim. */
  payload: UnarchiveConversationPayload
}

/**
 * Build the `unarchive_conversation` early-data bytes: an `unarchive_conversation` Envelope wrapping the
 * payload, serialized to UTF-8 via encodeEnvelope. Same shape as buildPromoteConversation, but simpler:
 * the sole field is a required string, so there is no explicit-`null` preservation concern — the payload
 * serializes verbatim. The fresh literal that bounds the field set lives in the connection method
 * (unarchiveConversation).
 *
 * MAY throw WireEncodeError when the serialized envelope exceeds MAX_PLAINTEXT_BYTES; the sole caller
 * (connection.unarchiveConversation) catches it and drops the send.
 */
export function buildUnarchiveConversation(input: UnarchiveConversationInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'unarchive_conversation',
    ts: input.ts,
    payload: input.payload
  }
  return encodeEnvelope(envelope)
}
