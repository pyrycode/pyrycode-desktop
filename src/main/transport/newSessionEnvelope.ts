// The `new_session` builder (#1217): it serializes the outbound "kill claude and spawn a fresh one in
// this conversation" request the daemon answers by discarding the process and starting a new one under
// a newly minted session id. A sibling to requestModelListEnvelope.ts, following the same
// one-concern-per-file split the module already uses.
//
// IT IS NOT A `/clear`. Sent as ordinary message text, `/clear` makes claude clear its context in place
// and the process keeps everything it holds — loaded workspace instructions, tool servers, every setting
// it was spawned with. This frame throws the process away, which is why it is the route by which a stored
// per-conversation setting takes effect at all. On the Mac the daemon's idle timeout is 0, so nothing
// evicts and `/clear` respawns nothing. (#1496 folded the Actions menu's two reset rows into one: its
// `Reset session` row dispatches THIS frame. `/clear` still reaches claude when an operator types it into
// the composer, which is a message-path concern and not this builder's.)
//
// FIRE-AND-FORGET, and more completely than its neighbours: no nonce, no idempotency key, no
// correlation key and NO REPLY of any kind — not even an error. A named id the daemon cannot act on is
// silently inert, deliberately, so the verb answers no question about which conversation ids exist.
// The observable effect, when there is one, arrives on the pre-existing inbound path as a
// `session_transition` marker. Gated daemon-side on the `interactive` capability (this app advertises
// it since #179); the builder does nothing about that.
//
// THE INPUT'S ID IS REQUIRED WHERE THE WIRE FIELD IS OPTIONAL, and that is the safety property of this
// file rather than an inconsistency. Do NOT copy buildRequestModelList's "`''` reaches the wire as
// written and the daemon answers it, which is the daemon's call rather than a policy this builder
// pre-empts" reasoning here — it is false for this verb. There, an unresolvable id draws one harmless
// `conversation.not_found`. Here, the protocol makes no payload, `{}`, an absent id and an explicitly
// empty one ONE wire meaning: the daemon's process-wide follow-active cursor, stamped only by a routed
// send_message and shared by every connection. So an empty id on the wire IS a restart of whatever
// another device last sent to — the cross-conversation misfire pyrycode#2099 exists to close, where
// opening chat B and restarting before sending anything to B kills chat A mid-work. The protocol's own
// rule is that a client which CAN name a conversation must always name one; this one always can. A
// required input type makes the bare form unreachable at compile time rather than by discipline, and
// `isNewSessionPayload` refuses `''` at the untrusted boundary above.
//
// buildInterrupt's docblock explains why THAT builder emits a present-but-empty `payload: {}` rather
// than an omission or a `null`. Read for the codec constraint it records (decodeEnvelope requires a
// present payload), but the case does not arise here: this builder always has an id to write.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope, NewSessionPayload } from '../../shared/wire/types'

/**
 * Inputs the consumer (createDaemonConnection.newSession) supplies — the envelope id counter, the wall
 * clock, and the conversation to restart. Kept explicit (not read from globals) so the builder is pure
 * and trivially unit-testable, exactly like buildRequestModelList.
 */
export interface NewSessionInput {
  /** The new_session Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  /**
   * The conversation to restart. REQUIRED — see the module header for why this diverges from
   * `NewSessionPayload.conversation_id`, which mirrors the daemon and must stay optional. Not checked
   * for emptiness HERE: the builder stays pure and unconditional, and the guard one layer above is
   * what makes sure it is never handed one.
   */
  conversationId: string
}

/**
 * Build the `new_session` early-data bytes: an Envelope wrapping a one-field conversation_id payload,
 * serialized to UTF-8 via encodeEnvelope.
 *
 * A FRESH LITERAL naming exactly `conversation_id`, never a spread of a caller's object. That is what
 * bounds the outbound wire to the one field regardless of what the structural-minimum boundary guard
 * admitted, so a field smuggled past `isNewSessionPayload` is dropped here rather than sent.
 *
 * MAY throw WireEncodeError in principle (encodeEnvelope's contract), but a fixed-shape ~90-byte
 * envelope plus one client-owned conversation id can never approach MAX_PLAINTEXT_BYTES; the sole
 * caller catches anyway, so an over-cap id would fail closed as a dropped send.
 */
export function buildNewSession(input: NewSessionInput): Uint8Array {
  const payload: NewSessionPayload = { conversation_id: input.conversationId }
  const envelope: Envelope = {
    id: input.id,
    type: 'new_session',
    ts: input.ts,
    payload
  }
  return encodeEnvelope(envelope)
}
