// The post-handshake control-frame builder: it produces the serialized `interrupt` envelope bytes the
// Noise session (#7) / relay driver (#50) carry as an opaque Uint8Array — the outbound "stop the
// running turn in this conversation" signal the daemon maps to the neutral `turnevent.Cancel` and
// routes to that conversation's bound runner as claude's own interrupt (daemon SSOT
// docs/protocol-mobile.md § Interrupt (v2)). A sibling to newSessionEnvelope.ts /
// requestDebugBundleEnvelope.ts, following the same one-concern-per-file split the module already
// uses.
//
// IT IS NO LONGER A BARE FRAME, and #1092 rewrote this header rather than amending it because the old
// text asserted the opposite at length. From pyrycode #707 until #2103 the frame carried no payload
// struct and no conversation_id, and the daemon stopped whichever conversation its own process-wide
// follow-active cursor pointed at — a cursor only a routed `send_message` stamps and every connection
// shares. With the sidebar making "switch chats without sending" the ordinary path, that meant Stop
// pressed on chat B stopped chat A's turn, or nothing at all. #2103 published an optional
// `conversation_id` validated against the daemon's registry, and this builder always writes one.
//
// FIRE-AND-FORGET: no nonce, no idempotency key, no answer token and no correlation key — a replayed
// interrupt simply stops the turn again, and an interrupt with no running turn is a no-op, so there is
// nothing to dedup. The daemon sends no reply of any kind; the stop is observed through the existing
// `turn_end` marker (`stop_reason: cancelled`) on the interactive stream. Honoured only for a
// connection that negotiated the `interactive` capability (desktop advertises it since #179), and
// naming a conversation is not a way around that gate; it is daemon-side either way, and the builder
// does nothing about it.
//
// THE INPUT'S ID IS REQUIRED WHERE THE WIRE FIELD IS OPTIONAL, and that is the safety property of this
// file rather than an inconsistency — `buildNewSession`'s header states the same asymmetry for the
// twin verb. The protocol makes no payload, `{}`, an absent id and an explicitly empty one ONE wire
// meaning: the follow-active cursor. So an empty id on the wire IS a stop of whatever another device
// last sent to. The protocol's own rule is that a client which CAN name a conversation must always
// name one; this one always can. A required input type makes the bare form unreachable at compile
// time rather than by discipline, and `isInterruptPayload` refuses `''` at the untrusted boundary
// above.
//
// The old docblock below explained a present-but-empty `payload: {}` — why `{}` rather than an
// omission or a `null`, given that decodeEnvelope requires a present payload (codec.ts). That
// constraint is real and unchanged; it simply no longer arises here, because this builder always has
// an id to write. `buildRequestDebugBundle` is where the empty-payload case still lives.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope, InterruptPayload } from '../../shared/wire/types'

/**
 * Inputs the consumer (createDaemonConnection.interrupt) supplies — the envelope id counter, the wall
 * clock, and the conversation whose turn to stop. Kept explicit (not read from globals) so the builder
 * is pure and trivially unit-testable, exactly like buildNewSession.
 */
export interface InterruptInput {
  /** The interrupt Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  /**
   * The conversation whose running turn to stop. REQUIRED — see the module header for why this
   * diverges from `InterruptPayload.conversation_id`, which mirrors the daemon and must stay optional.
   * Not checked for emptiness HERE: the builder stays pure and unconditional, and the guard one layer
   * above is what makes sure it is never handed one.
   */
  conversationId: string
}

/**
 * Build the `interrupt` bytes: an Envelope wrapping a one-field conversation_id payload, serialized to
 * UTF-8 via encodeEnvelope. Same shape as buildNewSession.
 *
 * A FRESH LITERAL naming exactly `conversation_id`, never a spread of a caller's object. That is what
 * bounds the outbound wire to the one field regardless of what the structural-minimum boundary guard
 * admitted, so a field smuggled past `isInterruptPayload` is dropped here rather than sent.
 *
 * MAY throw WireEncodeError in principle (encodeEnvelope's contract), but a fixed-shape ~90-byte
 * envelope plus one client-owned conversation id can never approach MAX_PLAINTEXT_BYTES; the sole
 * caller catches anyway, so an over-cap id would fail closed as a dropped send.
 */
export function buildInterrupt(input: InterruptInput): Uint8Array {
  const payload: InterruptPayload = { conversation_id: input.conversationId }
  const envelope: Envelope = {
    id: input.id,
    type: 'interrupt',
    ts: input.ts,
    payload
  }
  return encodeEnvelope(envelope)
}
