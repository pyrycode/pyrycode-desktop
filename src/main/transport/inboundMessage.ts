// The inbound app-message envelope decoder: the untrusted→trusted boundary for a decrypted
// application-message plaintext the Noise session (#7) / relay driver (#50) surface as opaque bytes.
// It turns those bytes into a narrowed InboundDaemonMessage (a `message` or `message_chunk`),
// returns null for any OTHER well-formed envelope type (ignored), and FAILS CLOSED — throws
// WireDecodeError, never a partial value — on oversized / malformed / unparseable / mistyped input.
// A sibling to helloExchange.ts (which owns the handshake `hello`/`hello_ack` exchange) and
// sendMessageEnvelope.ts (the outbound builder): the same one-concern-per-file split.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`) and the payload it narrows carries message
// plaintext. Never re-export it through any renderer barrel — the plaintext and raw bytes must stay
// out of the web layer.
//
// parseInboundMessage sits on the untrusted→trusted boundary, mirroring parseHelloAck: it layers the
// semantic narrowing the codec deliberately defers (Envelope.payload stays `unknown`) onto
// decodeEnvelope's structural boundary, plus the oversized guard decodeEnvelope omits. Its error
// messages name the failure CATEGORY only — never echoing the message text, the conversation/message
// ids, the offending role value, or the raw bytes. This module performs no logging.
import { decodeEnvelope, WireDecodeError } from './codec'
import { MAX_PLAINTEXT_BYTES } from '../../shared/wire/types'
import type { MessagePayload, MessageChunkPayload } from '../../shared/wire/types'

/**
 * Which modeled app-message the envelope carried. NOT a wire type and NOT a DaemonEvent — the
 * transport layer stays IPC-free. An internal transport result the consumer (#62) maps onto the
 * daemon-event channel.
 */
export type InboundDaemonMessage =
  | { kind: 'message'; message: MessagePayload }
  | { kind: 'chunk'; messages: MessagePayload[] }

/** True iff `value` is a non-null, non-array object — the structural minimum for a wire payload.
 *  A small local copy: codec's `isRecord` is not exported, and duplicating it keeps this the edge
 *  that validates the opaque payload (same rationale as helloExchange.ts). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrow one required string field off the payload, or fail closed with a category-only message. */
function requireString(payload: Record<string, unknown>, field: string): string {
  const value = payload[field]
  if (typeof value !== 'string') {
    throw new WireDecodeError(`missing required field: ${field}`)
  }
  return value
}

/**
 * Narrow an opaque payload into a MessagePayload. Fail-closed: throws WireDecodeError (never a
 * partial value) on any structural or semantic mismatch. Returns only the four known fields; unknown
 * server-added keys are tolerated (forward-compat, matching parseHelloAck) but not copied through.
 *
 * The single `role` enum check covers non-string and unknown-string alike, narrowing to WireRole
 * without a cast. Its message names the failure category only — a `role: ${value}` interpolation
 * would echo user conversation content into a message a future caller might surface.
 */
function parseMessagePayload(payload: unknown): MessagePayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed message payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const message_id = requireString(payload, 'message_id')
  const text = requireString(payload, 'text')
  const role = payload.role
  if (role !== 'user' && role !== 'assistant') {
    throw new WireDecodeError('missing required field: role')
  }
  return { conversation_id, message_id, role, text }
}

/**
 * Narrow an opaque payload into a MessageChunkPayload: `messages` must be an array, and every
 * element must narrow as a MessagePayload — one bad element throws, failing the whole chunk closed.
 * An empty array is valid (a zero-length batch, harmless downstream).
 */
function parseMessageChunkPayload(payload: unknown): MessageChunkPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed message_chunk payload')
  }
  const raw = payload.messages
  if (!Array.isArray(raw)) {
    throw new WireDecodeError('malformed message_chunk messages')
  }
  return { messages: raw.map(parseMessagePayload) }
}

/**
 * Decode + route + narrow one decrypted app-message plaintext. Returns an InboundDaemonMessage for a
 * `message` / `message_chunk` envelope, `null` for a well-formed envelope of any OTHER type
 * (ignored, AC5), or throws WireDecodeError — the single failure type, so the consumer's one catch
 * covers oversized / malformed / unparseable / mistyped alike (fail-closed, AC4).
 */
export function parseInboundMessage(plaintext: Uint8Array): InboundDaemonMessage | null {
  // Size guard (AC4): decodeEnvelope does not size-check, so this is the only thing that makes an
  // oversized-but-valid-JSON frame fail closed here. The upstream Noise transport already bounds the
  // plaintext, but this boundary re-checks what it owns rather than trusting the caller (the unit
  // test drives this function directly, and a future driver change must not silently un-bound it).
  if (plaintext.length > MAX_PLAINTEXT_BYTES) {
    throw new WireDecodeError('inbound plaintext exceeds max size')
  }
  const envelope = decodeEnvelope(plaintext)
  switch (envelope.type) {
    case 'message':
      return { kind: 'message', message: parseMessagePayload(envelope.payload) }
    case 'message_chunk':
      return { kind: 'chunk', messages: parseMessageChunkPayload(envelope.payload).messages }
    default:
      // A well-formed `ack` / `error` / etc. is not an error — it is simply not modeled here.
      return null
  }
}
