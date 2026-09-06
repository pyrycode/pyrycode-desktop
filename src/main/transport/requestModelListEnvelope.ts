// The `request_model_list` builder (#1165): it serializes the outbound "ask" for one conversation's
// model and effort vocabulary — the menu a footer control has nothing to offer without. A sibling to
// requestSessionSettingsEnvelope.ts, following the same one-concern-per-file split the module uses.
//
// IT EXISTS BECAUSE THE PUSHED LANES MISS A WHOLE CLASS OF CONVERSATION. `model_list` reaches this app
// two ways, and neither covers one created AFTER the app connected: the live interactive lane emits
// once per claude child spawn and the daemon drops every event whose producing session is not the
// active conversation's, and the connect-time reconcile runs inside the handshake tail, so a
// conversation that did not exist then is not in it. pyrycode#2125 added the on-demand verb for
// exactly that window.
//
// It CARRIES A PAYLOAD, like requestSessionSettingsEnvelope.ts and unlike its bare neighbours — but
// with the one divergence from that precedent that matters: the id here is REQUIRED, so there is no
// `?? ''` normalisation and no "absent names nothing" case. That verb's id is optional because an
// unnamed request draws a zero-valued reply, which is a real answer; there is no zero answer to "what
// models does nothing offer", so a request with no conversation to name has nothing to ask about and
// the whole chain types the id as required. The id is client-owned — sourced from this app's own
// conversation state, never off the network.
//
// The reply is one `model_list` correlated by `in_reply_to` and carrying no `event_id`; a request the
// daemon cannot answer draws one `error` frame (`conversation.not_found`, or the retryable
// `model_list.unavailable`). NOTHING HERE RETRIES EITHER — a retry against a relay withholding the
// frame is the self-inflicted spin `modelListStore`'s header forbids, and no consumer may block a
// model menu on this frame.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope, RequestModelListPayload } from '../../shared/wire/types'

/**
 * Inputs the consumer (createDaemonConnection.requestModelList) supplies — the envelope id counter,
 * the wall clock, and the conversation to ask about. Kept explicit (not read from globals) so the
 * builder is pure and trivially unit-testable, exactly like buildRequestSessionSettings.
 */
export interface RequestModelListInput {
  /** The request_model_list Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  /**
   * The conversation to ask about. REQUIRED — see the module header for why this diverges from
   * `RequestSessionSettingsInput.conversationId`. Not checked for emptiness: `''` reaches the wire as
   * written and the daemon answers it with `conversation.not_found`, which is the daemon's call to
   * make rather than a policy this builder pre-empts.
   */
  conversationId: string
}

/**
 * Build the `request_model_list` early-data bytes: an Envelope wrapping a one-field conversation_id
 * payload, serialized to UTF-8 via encodeEnvelope.
 *
 * A FRESH LITERAL naming exactly `conversation_id`, never a spread of a caller's object. That is what
 * bounds the outbound wire to the one field regardless of what the structural-minimum boundary guard
 * admitted, so a field smuggled past `isRequestModelListPayload` is dropped here rather than sent.
 *
 * MAY throw WireEncodeError in principle (encodeEnvelope's contract), but a fixed-shape ~100-byte
 * envelope plus one client-owned conversation id can never approach MAX_PLAINTEXT_BYTES; the sole
 * caller catches anyway, so an over-cap id would fail closed as a dropped send.
 */
export function buildRequestModelList(input: RequestModelListInput): Uint8Array {
  const payload: RequestModelListPayload = { conversation_id: input.conversationId }
  const envelope: Envelope = {
    id: input.id,
    type: 'request_model_list',
    ts: input.ts,
    payload
  }
  return encodeEnvelope(envelope)
}
