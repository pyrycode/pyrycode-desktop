// The post-handshake bare control-frame builder: it produces the serialized `list_conversations`
// envelope bytes the Noise session (#7) / relay driver (#50) carry as an opaque Uint8Array — the
// outbound "ask" that makes the daemon reply with the current conversation list. A sibling to
// requestDebugBundleEnvelope.ts, following the same one-concern-per-file split the module already
// uses. Thinner than buildRequestSnapshot: `list_conversations` is a BARE control frame — no payload
// struct, no conversation_id (the request selects nothing; the daemon returns every conversation).
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope } from '../../shared/wire/types'

/**
 * Inputs the consumer (createDaemonConnection.requestConversations) supplies — the envelope id
 * counter and the wall clock. No payload arg: this is a bare control frame. Kept explicit (not read
 * from globals) so the builder is pure and trivially unit-testable, exactly like
 * buildRequestDebugBundle.
 */
export interface ListConversationsInput {
  /** The list_conversations Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
}

/**
 * Build the `list_conversations` early-data bytes: a bare `list_conversations` Envelope, serialized
 * to UTF-8 via encodeEnvelope. Same shape as buildRequestDebugBundle.
 *
 * The daemon's ListConversationsPayload is `struct{}` — it never reads a payload for this type, so it
 * tolerates an absent, `{}`, or `null` payload. The binding constraint is the desktop's OWN
 * decodeEnvelope, which requires a present `payload` (codec.ts throws otherwise), and Envelope.payload
 * is required — not relaxed to optional (that would be a wire-type drift touching every consumer;
 * CLAUDE.md no-drift). So we emit a present-but-empty `payload: {}`, NOT an omission — `{}` (not
 * `null`) upholds the module's "never emit null on the wire" posture. Do not "fix" this to an omission.
 *
 * MAY throw WireEncodeError in principle (encodeEnvelope's contract), but a fixed-shape ~80-byte
 * empty-payload envelope can never exceed MAX_PLAINTEXT_BYTES; the sole caller catches anyway.
 */
export function buildListConversations(input: ListConversationsInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'list_conversations',
    ts: input.ts,
    payload: {}
  }
  return encodeEnvelope(envelope)
}
