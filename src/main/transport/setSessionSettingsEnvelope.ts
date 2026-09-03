// The post-handshake payload-carrying `set_session_settings` builder: it serializes a caller-supplied
// SetSessionSettingsPayload into the `set_session_settings` early-data bytes the Noise session (#7) /
// relay driver (#50) carry as an opaque Uint8Array — the outbound "set" that changes one session's
// model / reasoning effort / permission mode / YOLO (pyrycode #844 wire vocab, #845 handler;
// `permission_mode` from pyrycode#1687, picked up in #1021). A sibling to createConversationEnvelope.ts,
// following the same one-concern-per-file split the module already uses.
//
// UNLIKE its siblings this builder is more than a dumb wrapper: it OWNS the omitempty PRESENCE
// CONTRACT. The daemon's fields are `Model, Effort, PermissionMode *string; YOLO *bool` with
// `,omitempty`, so a non-nil pointer to a zero value marshals the key at its zero value while a nil
// pointer omits it entirely. TS has no `omitempty`, so the builder reconstructs that by assigning each
// optional key to a fresh literal ONLY when the command field is present (`!== undefined`). This
// conditional-key construction doubles as the deterministic anti-smuggling net (#236's fresh-literal
// posture): the literal names exactly the five modeled keys, so any renderer-smuggled extra field the
// structural-minimum guard admitted is dropped here. The connection method therefore stays a faithful `send` twin (passes `payload`
// straight through) — the presence contract lives here per AC2 (the golden test targets this builder),
// a deliberate divergence from createConversation/answerModal (which build their fresh literal in the
// connection method). See #263.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope, SetSessionSettingsPayload } from '../../shared/wire/types'

/**
 * Inputs the consumer (createDaemonConnection.setSessionSettings) supplies — the envelope id counter,
 * the wall clock, and the already-validated payload. Kept explicit (not read from globals) so the
 * builder is pure and trivially unit-testable, exactly like buildSendMessage.
 */
export interface SetSessionSettingsInput {
  /** The set_session_settings Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  /** The validated command payload; the builder decides each optional key's PRESENCE (see below). */
  payload: SetSessionSettingsPayload
}

/**
 * Build the `set_session_settings` early-data bytes: a `set_session_settings` Envelope wrapping a fresh
 * payload literal, serialized to UTF-8 via encodeEnvelope.
 *
 * THE PRESENCE CONTRACT. `session_id` is always assigned. Each optional (`model` / `effort` / `yolo` /
 * `permission_mode`) is assigned to the literal IFF it is `!== undefined`. This must be an explicit
 * `!== undefined` check — NEVER a truthiness test: `if (payload.model)` would wrongly drop `''` and
 * `if (payload.yolo)` would wrongly drop `false`, collapsing the present-zero case the daemon
 * distinguishes from omitted. An assigned optional therefore reaches the wire even at its zero value; an
 * unassigned one is absent (JSON.stringify drops the missing key — the omitempty equivalent), never a
 * literal `null`.
 *
 * PRESENCE, NOT VALUE. The builder is not the policy point, and this matters most on `permission_mode`,
 * whose empty string the daemon REFUSES rather than reading as a clear-to-default. A `''` still crosses
 * the wire here, because pre-empting a daemon rule with a truthiness test is exactly the collapse the
 * paragraph above forbids — the daemon's refusal is the correct place for that verdict. For the same
 * reason nothing here rejects a payload carrying both `permission_mode` and `yolo`: callers keep those
 * apart by building a single-key payload, and the daemon refuses the frame if one ever does not.
 *
 * MAY throw WireEncodeError when the serialized envelope exceeds MAX_PLAINTEXT_BYTES; the sole caller
 * (connection.setSessionSettings) catches it and drops the send.
 */
export function buildSetSessionSettings(input: SetSessionSettingsInput): Uint8Array {
  const { payload } = input
  // Fresh literal naming exactly the modeled keys — never a spread of `payload`. Optionals are added
  // only when present, so an absent field never crosses the wire (omitempty) and a smuggled extra key
  // is dropped.
  const wire: SetSessionSettingsPayload = { session_id: payload.session_id }
  if (payload.model !== undefined) wire.model = payload.model
  if (payload.effort !== undefined) wire.effort = payload.effort
  if (payload.yolo !== undefined) wire.yolo = payload.yolo
  if (payload.permission_mode !== undefined) wire.permission_mode = payload.permission_mode

  const envelope: Envelope = {
    id: input.id,
    type: 'set_session_settings',
    ts: input.ts,
    payload: wire
  }
  return encodeEnvelope(envelope)
}
