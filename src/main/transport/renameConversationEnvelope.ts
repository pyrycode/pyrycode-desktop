// The post-handshake payload-carrying `rename_conversation` builder: it serializes a caller-supplied
// RenameConversationPayload into the `rename_conversation` early-data bytes the Noise session (#7) /
// relay driver (#50) carry as an opaque Uint8Array — the outbound "ask" that changes a conversation's
// stored name. The daemon updates the name via a single locked Registry.Update, persists eagerly, and
// confirms by REPLYING to the requesting client with a `conversation_updated` record; the desktop does
// not correlate that reply here (#360 reads the new name from the re-list). A sibling to
// unarchiveConversationEnvelope.ts / promoteConversationEnvelope.ts, following the same
// one-concern-per-file split.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope, RenameConversationPayload } from '../../shared/wire/types'

/**
 * Inputs the consumer (createDaemonConnection.renameConversation) supplies — the envelope id counter,
 * the wall clock, and the already-validated payload. Kept explicit (not read from globals) so the
 * builder is pure and trivially unit-testable, exactly like buildUnarchiveConversation.
 */
export interface RenameConversationInput {
  /** The rename_conversation Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  /** The payload the consumer builds as a fresh literal (its two required-string fields), serialized verbatim. */
  payload: RenameConversationPayload
}

/**
 * Build the `rename_conversation` early-data bytes: a `rename_conversation` Envelope wrapping the
 * payload, serialized to UTF-8 via encodeEnvelope. Same shape as buildUnarchiveConversation, but with
 * two fields: both are required strings, so there is no explicit-`null` preservation concern — the
 * payload serializes verbatim. The fresh literal that bounds the field set lives in the connection
 * method (renameConversation).
 *
 * MAY throw WireEncodeError when the serialized envelope exceeds MAX_PLAINTEXT_BYTES; the sole caller
 * (connection.renameConversation) catches it and drops the send.
 */
export function buildRenameConversation(input: RenameConversationInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'rename_conversation',
    ts: input.ts,
    payload: input.payload
  }
  return encodeEnvelope(envelope)
}
