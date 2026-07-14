// The post-handshake payload-carrying `archive_conversation` builder: it serializes a caller-supplied
// ArchiveConversationPayload into the `archive_conversation` early-data bytes the Noise session (#7) /
// relay driver (#50) carry as an opaque Uint8Array — the outbound "ask" that archives an active
// conversation. The daemon sets the durable archived flag, persists eagerly, and confirms with a
// `conversation_updated` record; the desktop does not correlate that reply here (#366 reads the archived
// row leaving from the re-list). The mirror-image twin of unarchiveConversationEnvelope.ts, following the
// same one-concern-per-file split.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope, ArchiveConversationPayload } from '../../shared/wire/types'

/**
 * Inputs the consumer (createDaemonConnection.archiveConversation) supplies — the envelope id counter,
 * the wall clock, and the already-validated payload. Kept explicit (not read from globals) so the
 * builder is pure and trivially unit-testable, exactly like buildUnarchiveConversation.
 */
export interface ArchiveConversationInput {
  /** The archive_conversation Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  /** The payload the consumer builds as a fresh literal (its single required-string field), serialized verbatim. */
  payload: ArchiveConversationPayload
}

/**
 * Build the `archive_conversation` early-data bytes: an `archive_conversation` Envelope wrapping the
 * payload, serialized to UTF-8 via encodeEnvelope. Same shape as buildUnarchiveConversation: the sole
 * field is a required string, so there is no explicit-`null` preservation concern — the payload
 * serializes verbatim. The fresh literal that bounds the field set lives in the connection method
 * (archiveConversation).
 *
 * MAY throw WireEncodeError when the serialized envelope exceeds MAX_PLAINTEXT_BYTES; the sole caller
 * (connection.archiveConversation) catches it and drops the send.
 */
export function buildArchiveConversation(input: ArchiveConversationInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'archive_conversation',
    ts: input.ts,
    payload: input.payload
  }
  return encodeEnvelope(envelope)
}
