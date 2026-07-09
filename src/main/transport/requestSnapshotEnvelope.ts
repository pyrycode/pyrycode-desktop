// The post-handshake payload-carrying `request_snapshot` builder: it serializes a caller-supplied
// RequestSnapshotPayload into the `request_snapshot` early-data bytes the Noise session (#7) / relay
// driver (#50) carry as an opaque Uint8Array — the outbound "ask" for the daemon's current
// screen_snapshot (its model / effort / yolo for a conversation). A sibling to sendMessageEnvelope.ts,
// following the same one-concern-per-file split the module already uses. It is the PAYLOAD-carrying
// builder (a conversation_id selects the conversation), NOT the bare request_debug_bundle control
// frame — the daemon rejects an empty/unknown id with `conversation.not_found` (#180).
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope, RequestSnapshotPayload } from '../../shared/wire/types'

/**
 * Inputs the consumer (createDaemonConnection.requestSnapshot) supplies — the envelope id counter,
 * the wall clock, and the already-validated payload. Kept explicit (not read from globals) so the
 * builder is pure and trivially unit-testable, exactly like buildSendMessage.
 */
export interface RequestSnapshotInput {
  /** The request_snapshot Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  /** The validated command payload (conversation_id), serialized verbatim as the Envelope payload. */
  payload: RequestSnapshotPayload
}

/**
 * Build the `request_snapshot` early-data bytes: a `request_snapshot` Envelope wrapping the payload,
 * serialized to UTF-8 via encodeEnvelope. Same shape as buildSendMessage — a real payload, unlike
 * the bare buildRequestDebugBundle.
 *
 * MAY throw WireEncodeError when the serialized envelope exceeds MAX_PLAINTEXT_BYTES; the sole caller
 * (connection.requestSnapshot) catches it and drops the send.
 */
export function buildRequestSnapshot(input: RequestSnapshotInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'request_snapshot',
    ts: input.ts,
    payload: input.payload
  }
  return encodeEnvelope(envelope)
}
