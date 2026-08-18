// The bare `request_session_settings` builder: it serializes the outbound "ask" for the daemon's
// current run configuration — the session id to address a change to, the model / effort / yolo in
// force, and the context-window occupancy (#491). A sibling to requestDebugBundleEnvelope.ts,
// following the same one-concern-per-file split the module already uses.
//
// It is the BARE control frame, NOT the payload-carrying requestSnapshotEnvelope: the daemon's reply
// is daemon-wide, so there is no conversation_id or any other field a client could use to select
// another session's data. That also means it cannot be rejected with `conversation.not_found`.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope } from '../../shared/wire/types'

/**
 * Inputs the consumer (createDaemonConnection.requestSessionSettings) supplies — the envelope id
 * counter and the wall clock. Kept explicit (not read from globals) so the builder is pure and
 * trivially unit-testable, exactly like buildRequestDebugBundle.
 */
export interface RequestSessionSettingsInput {
  /** The request_session_settings Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
}

/**
 * Build the `request_session_settings` early-data bytes: a bare Envelope, serialized to UTF-8 via
 * encodeEnvelope.
 *
 * The daemon never reads Payload for this bare control type (it is intercepted before dispatch and
 * ignores any attached bytes), so it tolerates an absent, `{}`, or `null` payload. The binding
 * constraint is the desktop's OWN decodeEnvelope, which requires a present `payload`, and
 * Envelope.payload is required. So we emit a present-but-empty `payload: {}`, NOT an omission —
 * `{}` (not `null`) upholds the module's "never emit null on the wire" posture. Identical reasoning
 * to buildRequestDebugBundle; do not "fix" this to an omission.
 *
 * MAY throw WireEncodeError in principle (encodeEnvelope's contract), but a fixed-shape ~90-byte
 * empty-payload envelope can never exceed MAX_PLAINTEXT_BYTES; the sole caller catches anyway.
 */
export function buildRequestSessionSettings(input: RequestSessionSettingsInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'request_session_settings',
    ts: input.ts,
    payload: {}
  }
  return encodeEnvelope(envelope)
}
