// The `request_session_settings` builder: it serializes the outbound "ask" for one conversation's
// current run configuration — the session id to address a change to, the model / effort / yolo in
// force, and the context-window occupancy (#491). A sibling to requestDebugBundleEnvelope.ts,
// following the same one-concern-per-file split the module already uses.
//
// It CARRIES A PAYLOAD, like dequeueMessageEnvelope.ts and unlike its bare neighbours: a single
// conversation_id the daemon resolves to a session (pyrycode#1586 minted the field, pyrycode#1610
// taught the handler to read it; SSOT internal/protocol/settings.go). The frame was genuinely bare
// until 2026-08-20 and this file asserted that as fact for two weeks after it stopped being true,
// which is the whole of #945: an unnamed request addresses nothing, so the daemon answered every one
// with a zero-valued session_settings and the run-config sheet had no session id to write back to.
// The id is client-owned — sourced from the client's own conversation state, never off the network.
// Naming an unhosted or unbound conversation is still answered with that zero reply rather than an
// error frame, so this frame remains unrejectable: there is no `conversation.not_found` for it.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope, RequestSessionSettingsPayload } from '../../shared/wire/types'

/**
 * Inputs the consumer (createDaemonConnection.requestSessionSettings) supplies — the envelope id
 * counter, the wall clock, and the conversation to ask about. Kept explicit (not read from globals)
 * so the builder is pure and trivially unit-testable, exactly like buildRequestDebugBundle.
 */
export interface RequestSessionSettingsInput {
  /** The request_session_settings Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  /**
   * The conversation to ask about. Absent → `conversation_id: ''` on the wire, which names nothing
   * and draws the zero reply. Optional only until #946 gives the renderer an id to supply.
   */
  conversationId?: string
}

/**
 * Build the `request_session_settings` early-data bytes: an Envelope wrapping a one-field
 * conversation_id payload, serialized to UTF-8 via encodeEnvelope.
 *
 * The daemon's field has no `omitempty`, so absent and empty are the same case for it and the key is
 * ALWAYS emitted — a present string, never omitted and never `null` (the module's "never emit null
 * on the wire" posture). The `?? ''` normalisation lives here rather than in the caller so the
 * present-always invariant is provable in this module's own test, against real codec bytes.
 *
 * MAY throw WireEncodeError in principle (encodeEnvelope's contract), but a fixed-shape ~110-byte
 * envelope plus one client-owned conversation id can never approach MAX_PLAINTEXT_BYTES; the sole
 * caller catches anyway, so an over-cap id would fail closed as a dropped send.
 */
export function buildRequestSessionSettings(input: RequestSessionSettingsInput): Uint8Array {
  const payload: RequestSessionSettingsPayload = { conversation_id: input.conversationId ?? '' }
  const envelope: Envelope = {
    id: input.id,
    type: 'request_session_settings',
    ts: input.ts,
    payload
  }
  return encodeEnvelope(envelope)
}
