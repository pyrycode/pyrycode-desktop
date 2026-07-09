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
// ids, the offending role value, or the raw bytes.
//
// It emits CONTENT-FREE diagnostic records (#130) through the OPTIONAL injected DiagnosticLog: for
// each decoded outcome — a modeled `message` / `message_chunk`, or a well-formed-but-unmodeled type
// that would otherwise vanish — it logs the envelope type, the plaintext byte length, and a one-way
// BLAKE2s hash of the frame, never the payload value or any decoded field. The THROW path is never
// logged here (a malformed/oversized frame leaves no record — the pre-decryption raw-byte case is
// sibling #133). Absent a logger the module is silent; behaviour is otherwise identical.
import { blake2s } from '@noble/hashes/blake2'
import { decodeEnvelope, base64StdDecode, WireDecodeError } from './codec'
import { MAX_PLAINTEXT_BYTES } from '../../shared/wire/types'
import type { MessagePayload, MessageChunkPayload, ScreenSnapshotPayload } from '../../shared/wire/types'
import type { DiagnosticLog } from '../diagnosticLog'

/**
 * Cap on the peer-supplied `type` string logged in the unmodeled branch. Real wire types
 * (`ack`, `error`, `hello_ack`, `message`, `message_chunk`) are all < 16 chars, so this is lossless
 * for legitimate traffic; it deterministically bounds a hostile daemon that could otherwise stuff up
 * to MAX_PLAINTEXT_BYTES of arbitrary text into `type` (#130 security review). Belt-and-suspenders:
 * a code-level cap, not a stochastic rule.
 */
const MAX_LOGGED_TYPE_CHARS = 64

/**
 * A one-way, content-free digest of the decrypted plaintext FRAME bytes — never `envelope.payload`
 * (a parsed `unknown` whose re-serialization is non-deterministic on JSON key order). BLAKE2s-256 as
 * lowercase hex (64 chars). `blake2s` comes from @noble/hashes, not node:crypto: Electron's BoringSSL
 * has no BLAKE2 family (note #101), and this stays synchronous. Hashing the whole frame — not just
 * the payload text — implicitly salts the digest with the server-assigned id/ts/message_id, so a
 * read-the-log dictionary attack must reconstruct the entire frame, not merely guess the text.
 */
function hashPlaintext(plaintext: Uint8Array): string {
  return Buffer.from(blake2s(plaintext, { dkLen: 32 })).toString('hex')
}

/**
 * Which modeled app-message the envelope carried. NOT a wire type and NOT a DaemonEvent — the
 * transport layer stays IPC-free. An internal transport result the consumer (#62) maps onto the
 * daemon-event channel.
 *
 * The three debug-bundle kinds (#116) are recognised additively: the `message` / `message_chunk`
 * path is unchanged, and `daemon-error` is deliberately CONTENT-FREE — the daemon's ErrorPayload
 * text is never narrowed or surfaced, only "a terminal error arrived." The `snapshot` kind (#180)
 * carries the full decoded ScreenSnapshotPayload; the consumer (#62) drops all but model/effort/yolo
 * before emitting, so the sensitive `text` never crosses IPC.
 */
export type InboundDaemonMessage =
  | { kind: 'message'; message: MessagePayload }
  | { kind: 'chunk'; messages: MessagePayload[] }
  | { kind: 'bundle-chunk'; seq: number; data: Uint8Array }
  | { kind: 'bundle-done'; total: number }
  | { kind: 'daemon-error' }
  | { kind: 'snapshot'; snapshot: ScreenSnapshotPayload }

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

/** Narrow one required number field off the payload, or fail closed with a category-only message.
 *  The sibling of requireString for the bundle payloads' numeric `seq` / `total` (#116). JSON.parse
 *  never yields NaN/Infinity, so a plain `typeof === 'number'` check suffices. */
function requireNumber(payload: Record<string, unknown>, field: string): number {
  const value = payload[field]
  if (typeof value !== 'number') {
    throw new WireDecodeError(`missing required field: ${field}`)
  }
  return value
}

/** Narrow one required boolean field off the payload, or fail closed with a category-only message.
 *  The sibling of requireString / requireNumber for the snapshot's `yolo` (#180). The check is on the
 *  TYPE, never truthiness — `false` is a valid value (permissions enforced), not an absence. */
function requireBoolean(payload: Record<string, unknown>, field: string): boolean {
  const value = payload[field]
  if (typeof value !== 'boolean') {
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
 * Narrow a debug_bundle_chunk payload (#116): `seq` a number, `data` standard base64 that
 * base64StdDecode (STRICT — throws WireDecodeError on non-canonical / truncated input) turns into
 * raw bytes. The base64 decode happens HERE, at the untrusted boundary, so the reassembler stays
 * byte-pure. Fail-closed: any structural mismatch throws, never a partial value.
 */
function parseDebugBundleChunkPayload(payload: unknown): { seq: number; data: Uint8Array } {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed debug_bundle_chunk payload')
  }
  const seq = requireNumber(payload, 'seq')
  const data = base64StdDecode(requireString(payload, 'data'))
  return { seq, data }
}

/** Narrow a debug_bundle_done payload (#116): `total` a number. Fail-closed. */
function parseDebugBundleDonePayload(payload: unknown): { total: number } {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed debug_bundle_done payload')
  }
  return { total: requireNumber(payload, 'total') }
}

/**
 * Narrow an opaque payload into a ScreenSnapshotPayload (#180). Fail-closed like parseMessagePayload:
 * every field is required-present — an empty `model`/`effort` and `yolo:false` are valid VALUES
 * (inherited daemon default / permissions enforced), never absences (AC2/AC3), so a missing or
 * mistyped field throws WireDecodeError rather than defaulting. Returns only the six known fields;
 * unknown server-added keys are tolerated (forward-compat, matching parseMessagePayload) but not
 * copied through. Its messages name the failure category only — no field value is interpolated (the
 * `text` / `conversation_id` could echo sensitive rendered output).
 */
function parseScreenSnapshotPayload(payload: unknown): ScreenSnapshotPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed screen_snapshot payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const text = requireString(payload, 'text')
  const ts = requireString(payload, 'ts')
  const model = requireString(payload, 'model')
  const effort = requireString(payload, 'effort')
  const yolo = requireBoolean(payload, 'yolo')
  return { conversation_id, text, ts, model, effort, yolo }
}

/**
 * Decode + route + narrow one decrypted app-message plaintext. Returns an InboundDaemonMessage for a
 * `message` / `message_chunk` envelope, the three debug-bundle kinds (`debug_bundle_chunk` /
 * `debug_bundle_done` / `error` → `daemon-error`, #116), a `screen_snapshot` → `snapshot` (#180),
 * `null` for a well-formed envelope of any OTHER type (ignored, AC5), or throws WireDecodeError — the
 * single failure type, so the consumer's one catch covers oversized / malformed / unparseable /
 * mistyped alike (fail-closed, AC4).
 */
export function parseInboundMessage(
  plaintext: Uint8Array,
  diagnosticLog?: DiagnosticLog
): InboundDaemonMessage | null {
  // Size guard (AC4): decodeEnvelope does not size-check, so this is the only thing that makes an
  // oversized-but-valid-JSON frame fail closed here. The upstream Noise transport already bounds the
  // plaintext, but this boundary re-checks what it owns rather than trusting the caller (the unit
  // test drives this function directly, and a future driver change must not silently un-bound it).
  if (plaintext.length > MAX_PLAINTEXT_BYTES) {
    throw new WireDecodeError('inbound plaintext exceeds max size')
  }
  const envelope = decodeEnvelope(plaintext)
  // Each log fires AFTER the modeled envelope has fully narrowed, so the throw path stays unlogged: a
  // frame that fails to narrow throws first and leaves no record. Optional chaining short-circuits the
  // whole call (including hashPlaintext) when no logger is injected — absent-logger costs nothing.
  switch (envelope.type) {
    case 'message': {
      const message = parseMessagePayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'message',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'message', message }
    }
    case 'message_chunk': {
      const { messages } = parseMessageChunkPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'message_chunk',
        bytes: plaintext.length,
        count: messages.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'chunk', messages }
    }
    case 'debug_bundle_chunk': {
      // Narrow + base64-decode BEFORE logging so a malformed chunk (bad base64, non-number seq)
      // throws first and leaves no record. `seq` / `data` are never logged — only the frame's
      // byte length + one-way hash.
      const { seq, data } = parseDebugBundleChunkPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'debug_bundle_chunk',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'bundle-chunk', seq, data }
    }
    case 'debug_bundle_done': {
      const { total } = parseDebugBundleDonePayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'debug_bundle_done',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'bundle-done', total }
    }
    case 'screen_snapshot': {
      // Narrow BEFORE logging so a malformed snapshot throws first and leaves no record. No decoded
      // field (text / conversation_id / model / effort / yolo) is ever logged — only the frame's byte
      // length + one-way hash, reusing the existing content-free field set (no new DiagnosticEvent
      // field, so #131's renderer pin is untouched). The consumer drops all but model/effort/yolo.
      const snapshot = parseScreenSnapshotPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'screen_snapshot',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'snapshot', snapshot }
    }
    case 'error':
      // Now MODELED (#116): a single daemon `error` reply terminates an in-flight bundle request.
      // CONTENT-FREE — no ErrorPayload field is narrowed or surfaced; the reassembler only needs
      // "a terminal error arrived." It moves from inbound-unmodeled to inbound-decoded(error) now
      // that it is recognised — a content-free, more-accurate log that applies to ALL `error`
      // frames, bundle-related or not (intentional; see the #116 spec).
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'error',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'daemon-error' }
    default:
      // A well-formed `ack` / `error` / etc. is not an error — it is simply not modeled here. Log it
      // content-free (capped type + size + hash) so an unforeseen kind still leaves a footprint (#130
      // catch-all), then keep the unchanged behaviour: still return null, still not surfaced to the UI.
      diagnosticLog?.event({
        event: 'inbound-unmodeled',
        code: envelope.type.slice(0, MAX_LOGGED_TYPE_CHARS),
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return null
  }
}
