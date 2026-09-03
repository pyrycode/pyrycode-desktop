// The `request_attachment` builder: it serializes one caller-supplied RequestAttachmentPayload into
// the envelope bytes the Noise session (#7) / relay driver (#50) carry as an opaque Uint8Array — the
// outbound "ask" that makes the daemon stream a stored attachment back as `attachment_chunk` frames.
// A sibling to requestDebugBundleEnvelope.ts, following the same one-concern-per-file split and the
// same ask-the-daemon-for-X idiom: the envelope id and the timestamp are explicit inputs, never read
// from a counter or a clock in here.
//
// NOTHING SENDS THIS YET. The driver that does is a later slice, exactly as attachmentChunkEnvelope.ts
// landed in #860 one slice ahead of the sender in #861.
//
// The frame carries a conversation_id where `attachment_chunk` deliberately carries none, and that
// asymmetry is deliberate on the daemon's side: an upload lands in the conversation the authenticated
// session is already on, while a retrieval has to be able to say which conversation's file it wants.
// Naming one is NOT authorization — the daemon validates the id against its own registry before it
// becomes a path component, and confinement rather than an id's shape is what bounds a hostile
// client. See the RequestAttachmentPayload doc comment for the contract in full.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through any renderer
// barrel — the raw bytes must stay out of the web layer. It makes no log call of any kind: upstream
// permits these two ids in a log only after their shape has been validated, and nothing on this side
// validates, so raw they stay out of one entirely.
import { encodeEnvelope } from './codec'
import type { Envelope, RequestAttachmentPayload } from '../../shared/wire/types'

/**
 * Inputs the eventual consumer supplies — the envelope id counter, the clock, and the request itself.
 * Kept explicit (not read from globals) so the builder is pure and trivially unit-testable, exactly
 * like buildRequestDebugBundle and buildAttachmentChunk.
 */
export interface RequestAttachmentInput {
  /** The request_attachment Envelope's numeric id (the consumer's id counter). It is also what the
   *  daemon's answering chunks and its reject will name in `in_reply_to`, so a consumer that wants to
   *  correlate the reply must retain this value — the payload carries no request id. */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  /** The conversation and attachment being asked for, serialized verbatim. */
  payload: RequestAttachmentPayload
}

/**
 * Build one `request_attachment` envelope's bytes: a `request_attachment` Envelope wrapping the
 * payload, serialized to UTF-8 via encodeEnvelope. Same field order as every sibling builder, which
 * is also the daemon's committed fixture order.
 *
 * IT TAKES A WHOLE PAYLOAD rather than two discrete id arguments, which is where it parts from
 * buildRequestSessionSettings and follows buildAttachmentChunk instead. That builder normalises an
 * absent id to `''` because its whole main-side chain types the id optional; nothing here is
 * optional, and copying the normalisation would MINT a zero value. Both keys are therefore always
 * present without any defaulting — the daemon's struct has no `omitempty`, so absent is not a case
 * on this wire — and an empty id can only arrive because a caller passed one. That matters because a
 * zero-valued request is the specific silent failure the contract warns about: joining the empty
 * string onto a directory yields that directory, so a receiver that skips its shape check addresses
 * the conversation directory root rather than erroring.
 *
 * This module adds NO validator. It checks neither id against the canonical lowercase-UUIDv4 shape
 * the payload type documents — this wire layer declares shapes and validates none, the posture both
 * sibling payload types ship with, and enforcement belongs to the daemon that owns the reject path.
 *
 * MAY throw WireEncodeError in principle (encodeEnvelope's contract), but a fixed-shape ~180-byte
 * envelope carrying two canonical ids can never approach MAX_PLAINTEXT_BYTES; that inherited cap is
 * the only backstop on this path and it fails closed, so an out-of-contract id long enough to trip
 * it never reaches the wire and is never truncated.
 */
export function buildRequestAttachment(input: RequestAttachmentInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'request_attachment',
    ts: input.ts,
    payload: input.payload
  }
  return encodeEnvelope(envelope)
}
