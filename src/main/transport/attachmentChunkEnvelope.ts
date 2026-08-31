// The `attachment_chunk` builder: it serializes one caller-supplied AttachmentChunkPayload into the
// envelope bytes the Noise session (#7) / relay driver (#50) carry as an opaque Uint8Array. A
// sibling to dequeueMessageEnvelope.ts, following the same one-concern-per-file split.
//
// ONE ENVELOPE PER CHUNK. It takes a single payload, not a whole plan: each chunk gets its own
// envelope id and its own timestamp from the consumer's counter and clock, exactly as every other
// builder here works. Iterating a planAttachmentChunks() result is #861's job, and nothing in this
// module sends.
//
// The frame carries no conversation_id, and that omission is a security property — the daemon places
// an upload in the conversation the authenticated session is already on (see the AttachmentChunkPayload
// doc comment). This builder copies the payload verbatim and adds nothing to it.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`) and the payload carries the file's bytes as
// base64. Never re-export it through any renderer barrel. It performs no logging: `filename` is
// frequently private in itself and `data` is the file.
import { encodeEnvelope } from './codec'
import type { Envelope, AttachmentChunkPayload } from '../../shared/wire/types'

/**
 * Inputs the consumer (the send driver, #861) supplies — the envelope id counter, the clock, and one
 * chunk of an already-built plan. Kept explicit (not read from globals) so the builder is pure and
 * trivially unit-testable, exactly like buildDequeueMessage.
 */
export interface AttachmentChunkInput {
  /** The attachment_chunk Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  /** One element of a planAttachmentChunks() result, serialized verbatim. */
  payload: AttachmentChunkPayload
}

/**
 * Build one `attachment_chunk` envelope's bytes: an `attachment_chunk` Envelope wrapping the payload,
 * serialized to UTF-8 via encodeEnvelope.
 *
 * MAY throw WireEncodeError when the serialized envelope exceeds MAX_PLAINTEXT_BYTES; the eventual
 * caller (#861) catches it and drops the send. That inherited cap is the only validator on this
 * path — the three metadata byte ceilings are documented on the payload type, not enforced here —
 * and it fails closed, so an over-cap envelope never reaches the wire and is never truncated. A
 * legitimate maximal chunk (45000 raw bytes plus every metadata field at its ceiling) clears it with
 * room to spare; a payload that trips it is out of contract by construction.
 */
export function buildAttachmentChunk(input: AttachmentChunkInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'attachment_chunk',
    ts: input.ts,
    payload: input.payload
  }
  return encodeEnvelope(envelope)
}
