// The post-handshake bare control-frame builder: it produces the serialized `interrupt` envelope
// bytes the Noise session (#7) / relay driver (#50) carry as an opaque Uint8Array — the outbound
// "stop the current turn" signal the daemon maps to a single claude Esc keystroke (daemon SSOT
// pyrycode #707). A sibling to requestDebugBundleEnvelope.ts / listConversationsEnvelope.ts,
// following the same one-concern-per-file split the module already uses. `interrupt` is a BARE
// control frame — no payload struct, no conversation_id, no nonce, no answer token, no idempotency
// key (a replayed interrupt is a benign extra Esc, a no-op with no running turn). Fire-and-forget:
// the daemon sends no reply; the turn-stopped signal rides the existing interactive stream
// (turn_state{idle} / turn_end). Honoured only for a connection that negotiated the `interactive`
// capability (desktop advertises it since #179); that gate is daemon-side — the builder does nothing
// about it.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope } from '../../shared/wire/types'

/**
 * Inputs the consumer (#306's createDaemonConnection.interrupt) supplies — the envelope id counter
 * and the wall clock. No payload arg: this is a bare control frame. Kept explicit (not read from
 * globals) so the builder is pure and trivially unit-testable, exactly like buildRequestDebugBundle.
 */
export interface InterruptInput {
  /** The interrupt Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
}

/**
 * Build the `interrupt` bytes: a bare `interrupt` Envelope, serialized to UTF-8 via encodeEnvelope.
 * Same shape as buildRequestDebugBundle.
 *
 * The daemon never reads a payload for this bare control type (it is intercepted before dispatch),
 * so it tolerates an absent, `{}`, or `null` payload. The binding constraint is the desktop's OWN
 * decodeEnvelope, which requires a present `payload` (codec.ts:133 throws otherwise), and
 * Envelope.payload is required — not relaxed to optional (that would be a wire-type drift touching
 * every consumer; CLAUDE.md no-drift). So we emit a present-but-empty `payload: {}`, NOT an omission
 * — `{}` (not `null`) upholds the module's "never emit null on the wire" posture (codec.ts:107-108).
 * Do not "fix" this to an omission.
 *
 * MAY throw WireEncodeError in principle (encodeEnvelope's contract), but a fixed-shape ~60-byte
 * empty-payload envelope can never exceed MAX_PLAINTEXT_BYTES; the sole caller (#306) catches anyway.
 */
export function buildInterrupt(input: InterruptInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'interrupt',
    ts: input.ts,
    payload: {}
  }
  return encodeEnvelope(envelope)
}
