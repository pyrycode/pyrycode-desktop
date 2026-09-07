// The `request_history` builder (#1222): it serializes the outbound "ask" for one backward step of a
// walk over a conversation's history — the entries that arrived before this client ever connected. A
// sibling to requestModelListEnvelope.ts, following the same one-concern-per-file split the module uses.
//
// IT EXISTS BECAUSE A CONVERSATION OPENED TODAY SHOWS NOTHING THAT HAPPENED BEFORE THIS CLIENT
// CONNECTED. The reconnect replay does not cover it and is not a substitute: that one is catch-up
// across a dropped connection over a bounded IN-MEMORY ring the daemon empties on restart, where this
// asks a daemon-owned log ON DISK that survives one (pyrycode#2112). They answer different questions
// and a client uses both.
//
// It CARRIES A PAYLOAD of three fields, and all three are ALWAYS emitted — the daemon declares no
// `omitempty`, so a decoder may rely on all three. Two of them carry rules a later editor must not
// "tidy":
//
//   - THE CURSOR IS ECHOED VERBATIM AND NEVER PARSED. It names a position in an append-only file, not
//     an offset or a page number, and the daemon's own parseCursor is the only thing anywhere that
//     reads one. `''` is the normal OPENING value of a walk ("start at the newest"), never a missing
//     one, so there is no non-empty check here and no normalisation of any kind. It is also NOT A
//     SECRET AND NOT A CAPABILITY — deliberately unsigned, trivially reversible, carrying only the
//     conversation id the client already knows — so it is echoed, never compared and never treated as
//     proving anything. Authorization is pairing, enforced at the Noise IK handshake.
//   - `limit` NORMALISES DOWN, NEVER UP. `0` is the daemon's published "you choose" value and never
//     means zero entries; a NEGATIVE limit is a reject (`history.invalid_page_size`). So an absent or
//     non-positive ask becomes `0` here rather than reaching the wire. There is deliberately NO upper
//     clamp: the daemon clamps at `history.MaxPageEntries` (4096) and re-asks a too-large page at a
//     smaller size rather than truncating one, so a client-invented ceiling would be a second bound to
//     keep in agreement — and one set below 4096 would drop valid pages.
//
// The reply is ONE `history_page` correlated by `in_reply_to`; there is no request-id key, so the
// conversation a page describes is knowable only from which envelope it answers. That is why the sole
// caller records this frame's envelope id against the conversation it named. A request the daemon
// cannot answer draws one `error` instead (`conversation.not_found`, `history.invalid_request`,
// `history.invalid_page_size`, `history.invalid_cursor`, or the one retryable member
// `history.unavailable`). NOTHING HERE OR IN THE CALLER RETRIES ANY OF THEM — a retry against a relay
// withholding the frame is the self-inflicted spin requestModelListEnvelope.ts's header forbids, and
// the walk's retry policy is #1224's to own.
//
// SSOT pyrycode docs/protocol-mobile.md § Conversation history (v2). Declared by pyrycode#2113,
// answered by #2116.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope, RequestHistoryPayload } from '../../shared/wire/types'

/**
 * Inputs the consumer (createDaemonConnection.requestHistory) supplies — the envelope id counter, the
 * wall clock, and the three published request fields. Kept explicit (not read from globals) so the
 * builder is pure and trivially unit-testable, exactly like buildRequestModelList.
 */
export interface RequestHistoryInput {
  /** The request_history Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  /**
   * The conversation whose history is wanted. REQUIRED, like `RequestModelListInput.conversationId`
   * and unlike `RequestSessionSettingsInput`'s: there is no zero-valued answer to "what came before
   * nothing", so an unnamed request has nothing to ask about. Not checked for emptiness — `''` reaches
   * the wire as written and the daemon answers it with `conversation.not_found`, which is the daemon's
   * call to make rather than a policy this builder pre-empts. Client-owned: sourced from this app's own
   * conversation state, never off the network.
   */
  conversationId: string
  /**
   * The position handed back by the previous page, or `''` to start at the newest. REQUIRED and
   * carried verbatim — see the module header for why there is no normalisation and no non-empty check.
   */
  cursor: string
  /**
   * How many entries to ask for, or absent to let the daemon choose. OPTIONAL here where its two
   * neighbours are required, because the wire has a published value for "you choose" and this is the
   * one field a caller can legitimately have no opinion about. Normalised below; see the header.
   */
  limit?: number
}

/**
 * Build the `request_history` early-data bytes: an Envelope wrapping the three-field payload,
 * serialized to UTF-8 via encodeEnvelope.
 *
 * A FRESH LITERAL naming exactly the three published keys, never a spread of a caller's object. That is
 * what bounds the outbound wire regardless of what the structural-minimum boundary guard admitted, so a
 * field smuggled past `isRequestHistoryPayload` is dropped here rather than sent.
 *
 * MAY throw WireEncodeError in principle (encodeEnvelope's contract). Unlike its fixed-shape
 * neighbours this frame carries a daemon-minted cursor of unpublished length, so an over-cap ask is
 * conceivable rather than merely theoretical; the sole caller catches, so it fails closed as a dropped
 * send and the walk stalls rather than the module throwing.
 */
export function buildRequestHistory(input: RequestHistoryInput): Uint8Array {
  // The `Number.isFinite` clause is not defensive noise: JSON.stringify writes NaN and Infinity as
  // `null`, which would break the payload's always-a-number contract at the decoder on the far side,
  // where a negative value merely draws a documented reject. Both collapse to the published "you
  // choose" value. Non-integers are deliberately NOT floored — every call site supplies an integer,
  // and the daemon answers a malformed payload with `history.invalid_request`, which this slice
  // surfaces as a typed failure, so the failure mode stays observable rather than silently repaired.
  const limit =
    typeof input.limit === 'number' && Number.isFinite(input.limit) && input.limit > 0
      ? input.limit
      : 0
  const payload: RequestHistoryPayload = {
    conversation_id: input.conversationId,
    cursor: input.cursor,
    limit
  }
  const envelope: Envelope = {
    id: input.id,
    type: 'request_history',
    ts: input.ts,
    payload
  }
  return encodeEnvelope(envelope)
}
