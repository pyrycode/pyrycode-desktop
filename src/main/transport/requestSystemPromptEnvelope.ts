// The `request_system_prompt` builder (#1230): it serializes the outbound "ask" for what system
// prompt one conversation holds, and whether the running session was started with a different one. A
// sibling to requestModelListEnvelope.ts, following the same one-concern-per-file split the module
// uses.
//
// IT EXISTS BECAUSE A STORED PROMPT TAKES EFFECT ONLY AT THE NEXT SESSION START. The daemon shipped
// the write half first (pyrycode#2151), so a client that did not itself perform the write had no way
// to learn what a conversation's stored prompt holds, and no way at all to learn that the child it is
// typing at predates an edit. pyrycode#2152 added the read verb for exactly that.
//
// It CARRIES A PAYLOAD with a REQUIRED id, like buildRequestModelList and unlike
// buildRequestSessionSettings — so there is no `?? ''` normalisation and no "absent names nothing"
// case. That verb's id is optional because an unnamed request draws a zero-valued reply, which is a
// real answer; an unnamed request here has nothing to ask about, and the whole chain types the id as
// required. The id is client-owned — sourced from this app's own conversation state, never off the
// network.
//
// NO EMPTINESS CHECK HERE, and the reason diverges from the neighbour's rather than copying it.
// buildRequestModelList declines one because the daemon answers an unresolvable id with a visible
// `conversation.not_found`, which is the daemon's call to make. THIS VERB HAS NO ERROR FRAME AT ALL:
// it mints no wire code and has no failure branch, so an empty id reaching the wire would draw an
// ordinary-looking `no_session` reply with an absent prompt, and the caller's correlation map would
// file that false "no prompt, no session" reading against a real conversation — indistinguishable
// downstream from a true one. The refusal that keeps such a frame off the wire is the ROUTING LOOKUP
// at the IPC arm (`router.route(id)?.…`), which is where an unroutable id is already refused and
// logged. Putting a second, different bound here would leave two rules to keep in agreement, and the
// one that actually fires would still be the router's.
//
// The reply is one `system_prompt` correlated by `in_reply_to`, carrying no `event_id` and no
// conversation id of its own. NOTHING RETRIES AND NOTHING BLOCKS ON IT — a retry against a relay
// withholding the frame is the self-inflicted spin `modelListStore`'s header forbids, and the daemon
// answers a conn that never negotiated the interactive capability with nothing at all, so a reply is
// not owed in the first place.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope, RequestSystemPromptPayload } from '../../shared/wire/types'

/**
 * Inputs the consumer (createDaemonConnection.requestSystemPrompt) supplies — the envelope id
 * counter, the wall clock, and the conversation to ask about. Kept explicit (not read from globals)
 * so the builder is pure and trivially unit-testable, exactly like buildRequestModelList.
 */
export interface RequestSystemPromptInput {
  /** The request_system_prompt Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  /**
   * The conversation to ask about. REQUIRED — see the module header for why this diverges from
   * `RequestSessionSettingsInput.conversationId`. Not checked for emptiness, and not defaulted: `''`
   * reaches the wire as written, because substituting a fallback would address a conversation the
   * caller never named. Keeping such a frame off the wire is the routing lookup's job, one layer up.
   */
  conversationId: string
}

/**
 * Build the `request_system_prompt` early-data bytes: an Envelope wrapping a one-field
 * conversation_id payload, serialized to UTF-8 via encodeEnvelope.
 *
 * A FRESH LITERAL naming exactly `conversation_id`, never a spread of a caller's object. That is what
 * bounds the outbound wire to the one field regardless of what the structural-minimum boundary guard
 * admitted, so a field smuggled past `isRequestSystemPromptPayload` is dropped here rather than sent.
 *
 * MAY throw WireEncodeError in principle (encodeEnvelope's contract), but a fixed-shape ~110-byte
 * envelope plus one client-owned conversation id can never approach MAX_PLAINTEXT_BYTES; the sole
 * caller catches anyway, so an over-cap id would fail closed as a dropped send.
 */
export function buildRequestSystemPrompt(input: RequestSystemPromptInput): Uint8Array {
  const payload: RequestSystemPromptPayload = { conversation_id: input.conversationId }
  const envelope: Envelope = {
    id: input.id,
    type: 'request_system_prompt',
    ts: input.ts,
    payload
  }
  return encodeEnvelope(envelope)
}
