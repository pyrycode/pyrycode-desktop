// The post-handshake bare control-frame builder: it produces the serialized `request_debug_bundle`
// envelope bytes the Noise session (#7) / relay driver (#50) carry as an opaque Uint8Array — the
// outbound "ask" that makes the daemon begin streaming the current debug bundle back. A sibling to
// sendMessageEnvelope.ts, following the same one-concern-per-file split the module already uses
// (helloExchange.ts for the handshake, sendMessageEnvelope.ts for `send_message`). Thinner than
// buildSendMessage: `request_debug_bundle` is a BARE control frame — no payload struct, no
// conversation_id, no session-selecting field (the bundle is daemon-global by construction).
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope } from '../../shared/wire/types'

/**
 * Inputs the consumer (createDaemonConnection.requestDebugBundle) supplies — the envelope id
 * counter and the wall clock. No payload arg: this is a bare control frame. Kept explicit (not read
 * from globals) so the builder is pure and trivially unit-testable, exactly like buildSendMessage.
 */
export interface RequestDebugBundleInput {
  /** The request_debug_bundle Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
}

/**
 * Build the `request_debug_bundle` early-data bytes: a bare `request_debug_bundle` Envelope,
 * serialized to UTF-8 via encodeEnvelope. Same field order as buildSendMessage.
 *
 * The daemon never reads Payload for this bare control type (it is intercepted before dispatch, as
 * `interrupt` and `new_session` are — but this is the only one of the three still BARE: #1092 gave
 * `interrupt` a conversation to name, so it is no longer the sibling to point at for the empty-payload
 * case, only for the interception), so it tolerates an absent, `{}`, or `null` payload. The binding
 * constraint is the desktop's OWN decodeEnvelope, which requires a present `payload` (codec.ts:133
 * throws otherwise), and Envelope.payload is required — not relaxed to optional (that would be a
 * wire-type drift touching every consumer; CLAUDE.md no-drift). So we emit a present-but-empty
 * `payload: {}`, NOT an omission — `{}` (not `null`) upholds the module's "never emit null on the
 * wire" posture (codec.ts:107-108). Mobile likely omits the field (explicitNulls = false); the
 * desktop cannot, and the daemon tolerates the divergence. Do not "fix" this to an omission.
 *
 * MAY throw WireEncodeError in principle (encodeEnvelope's contract), but a fixed-shape ~80-byte
 * empty-payload envelope can never exceed MAX_PLAINTEXT_BYTES; the sole caller catches anyway.
 */
export function buildRequestDebugBundle(input: RequestDebugBundleInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'request_debug_bundle',
    ts: input.ts,
    payload: {}
  }
  return encodeEnvelope(envelope)
}
