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
import type {
  MessagePayload,
  MessageChunkPayload,
  ScreenSnapshotPayload,
  AssistantDeltaPayload,
  TurnEndPayload,
  TurnStatePayload,
  ToolUsePayload,
  ConversationSummary
} from '../../shared/wire/types'
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
 *
 * The two interactive-stream kinds (#199) carry the decoded AssistantDeltaPayload / TurnEndPayload.
 * Unlike `snapshot`, the assistant delta `text` IS the render payload — the consumer carries it onward
 * (dropping only `conversation_id`); the fail-closed decode here is the boundary this slice defends.
 *
 * The `turn-state` kind (#214) carries the decoded TurnStatePayload — the coarse lifecycle scalar that
 * drives the timeline `phase` (#202). The consumer carries only `state` onward (dropping
 * `conversation_id`); the fail-closed `state` enum check here is the boundary this slice defends.
 *
 * The `tool-use` kind (#217) carries the decoded ToolUsePayload — the tool-call enrichment that drives
 * a durable `toolCall` timeline item (#202 / #121). The consumer carries the four render fields onward
 * (dropping `conversation_id`); the fail-closed required-string presence here (five strings, no enum)
 * is the boundary this slice defends. `name` / `input_summary` are opaque display text (like `stop_reason`).
 *
 * The `conversations` kind (#139) carries the decoded ConversationSummary[] (order preserved from the
 * wire). Like `chunk`, a single reply narrows to a whole list; the consumer forwards it verbatim as
 * one `conversationsReceived` event — no field is a secret, so nothing is dropped.
 */
export type InboundDaemonMessage =
  | { kind: 'message'; message: MessagePayload }
  | { kind: 'chunk'; messages: MessagePayload[] }
  | { kind: 'bundle-chunk'; seq: number; data: Uint8Array }
  | { kind: 'bundle-done'; total: number }
  | { kind: 'daemon-error' }
  | { kind: 'snapshot'; snapshot: ScreenSnapshotPayload }
  | { kind: 'assistant-delta'; delta: AssistantDeltaPayload }
  | { kind: 'turn-end'; turnEnd: TurnEndPayload }
  | { kind: 'turn-state'; turnState: TurnStatePayload }
  | { kind: 'tool-use'; toolUse: ToolUsePayload }
  | { kind: 'conversations'; conversations: ConversationSummary[] }

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

/** Narrow one required, nullable string field off the payload — a `string` OR a literal `null` — or
 *  fail closed with a category-only message. The sibling of requireString for the conversation `name`
 *  (#139), the only nullable wire field in the codec so far. A literal `null` is a VALID value (a
 *  distinct "unnamed" conversation, AC2), NOT an absence: a missing/`undefined` field, a number, or an
 *  object all fail closed (`name` is never omitted on the wire). The message names the field only — a
 *  `name` value could echo a conversation title. */
function requireStringOrNull(payload: Record<string, unknown>, field: string): string | null {
  const value = payload[field]
  if (typeof value !== 'string' && value !== null) {
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
 * mistyped field throws WireDecodeError rather than defaulting. Returns only the eight known fields;
 * unknown server-added keys are tolerated (forward-compat, matching parseMessagePayload) but not
 * copied through. Its messages name the failure category only — no field value is interpolated (the
 * `text` / `conversation_id` could echo sensitive rendered output). The two usage ints (#191) are
 * `used_tokens` / `window_tokens` — required numbers like the bundle `seq` / `total`, so a missing
 * field or a non-number throws (AC2) and `0` is decoded as the value `0`, never treated as absent (AC3).
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
  const used_tokens = requireNumber(payload, 'used_tokens')
  const window_tokens = requireNumber(payload, 'window_tokens')
  return { conversation_id, text, ts, model, effort, yolo, used_tokens, window_tokens }
}

/**
 * Narrow an opaque payload into an AssistantDeltaPayload (#199). Fail-closed like
 * parseScreenSnapshotPayload: every field is required-present — `seq:0` and `text:''` are valid VALUES
 * (a turn's first slice / an empty slice), never absences, so requireNumber / requireString check the
 * TYPE not truthiness. Returns only the four known fields; unknown server-added keys are tolerated
 * (forward-compat) but not copied through. Its messages name the failure category only — the `text` /
 * `turn_id` could echo conversation content, so no field value is interpolated.
 */
function parseAssistantDeltaPayload(payload: unknown): AssistantDeltaPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed assistant_delta payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const turn_id = requireString(payload, 'turn_id')
  const seq = requireNumber(payload, 'seq')
  const text = requireString(payload, 'text')
  return { conversation_id, turn_id, seq, text }
}

/**
 * Narrow an opaque payload into a TurnEndPayload (#199). Fail-closed: three required strings
 * (`conversation_id` / `turn_id` / `stop_reason`), unknown keys tolerated but not copied, category-only
 * error messages (no field value interpolated). `stop_reason` is carried through as an opaque string.
 */
function parseTurnEndPayload(payload: unknown): TurnEndPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed turn_end payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const turn_id = requireString(payload, 'turn_id')
  const stop_reason = requireString(payload, 'stop_reason')
  return { conversation_id, turn_id, stop_reason }
}

/**
 * Narrow an opaque payload into a TurnStatePayload (#214). Fail-closed like parseMessagePayload. The
 * single `state` enum check is cloned from parseMessagePayload's `role` check: it covers non-string and
 * unknown-string alike, narrowing to WireTurnState without a cast — a bare requireString would accept
 * any string and defeat the closed-enum boundary this slice exists to defend. Its message names the
 * failure CATEGORY only (never interpolating `state` or the conversation-correlating `conversation_id`),
 * matching the uniform no-echo discipline of the decoder. Returns only the two known fields; unknown
 * server-added keys are tolerated (forward-compat) but not copied through.
 */
function parseTurnStatePayload(payload: unknown): TurnStatePayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed turn_state payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const state = payload.state
  if (state !== 'thinking' && state !== 'responding' && state !== 'idle') {
    throw new WireDecodeError('missing required field: state')
  }
  return { conversation_id, state }
}

/**
 * Narrow an opaque payload into a ToolUsePayload (#217). Fail-closed like parseTurnEndPayload: five
 * required strings (`conversation_id` / `turn_id` / `tool_use_id` / `name` / `input_summary`), unknown
 * keys tolerated but not copied, category-only error messages (no field value interpolated — `name` /
 * `input_summary` could echo tool content). Unlike parseTurnStatePayload there is NO enum: the
 * fail-closed defence is required-string presence, and requireString covers missing / non-string alike.
 * `name` / `input_summary` are carried through as opaque display text, never interpreted here.
 */
function parseToolUsePayload(payload: unknown): ToolUsePayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed tool_use payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const turn_id = requireString(payload, 'turn_id')
  const tool_use_id = requireString(payload, 'tool_use_id')
  const name = requireString(payload, 'name')
  const input_summary = requireString(payload, 'input_summary')
  return { conversation_id, turn_id, tool_use_id, name, input_summary }
}

/**
 * Narrow an opaque payload into one ConversationSummary (#139). Fail-closed like parseMessagePayload:
 * every field is required-present — `name: null` is a valid VALUE (a distinct unnamed conversation,
 * AC2), and `is_promoted: false` / `is_archived: false` are valid values (an ad-hoc discussion /
 * unarchived), never absences, so requireStringOrNull / requireBoolean check the TYPE, not truthiness.
 * Returns only the seven known fields; unknown server-added keys are tolerated (forward-compat) but
 * NOT copied through — this is what keeps the emitted event minimal. Its messages name the failure
 * category only — a `name` / `cwd` could echo a conversation title or workspace path.
 */
function parseConversationSummary(payload: unknown): ConversationSummary {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed conversation summary')
  }
  const id = requireString(payload, 'id')
  const name = requireStringOrNull(payload, 'name')
  const is_promoted = requireBoolean(payload, 'is_promoted')
  const is_archived = requireBoolean(payload, 'is_archived')
  const cwd = requireString(payload, 'cwd')
  const last_message_ts = requireString(payload, 'last_message_ts')
  const last_used_at = requireString(payload, 'last_used_at')
  return { id, name, is_promoted, is_archived, cwd, last_message_ts, last_used_at }
}

/**
 * Narrow an opaque payload into a conversations reply's row list (#139): `conversations` must be an
 * array, and every element must narrow as a ConversationSummary — one bad row throws, failing the
 * whole reply closed (mirroring parseMessageChunkPayload). Order is preserved from the wire — the
 * daemon is the source of truth for ordering. An empty array is valid (no conversations yet).
 */
function parseConversationsPayload(payload: unknown): ConversationSummary[] {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed conversations payload')
  }
  const raw = payload.conversations
  if (!Array.isArray(raw)) {
    throw new WireDecodeError('malformed conversations list')
  }
  return raw.map(parseConversationSummary)
}

/**
 * Decode + route + narrow one decrypted app-message plaintext. Returns an InboundDaemonMessage for a
 * `message` / `message_chunk` envelope, the three debug-bundle kinds (`debug_bundle_chunk` /
 * `debug_bundle_done` / `error` → `daemon-error`, #116), a `screen_snapshot` → `snapshot` (#180), an
 * `assistant_delta` → `assistant-delta` and a `turn_end` → `turn-end` (#199), a `conversations` →
 * `conversations` (#139),
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
    case 'assistant_delta': {
      // Narrow BEFORE logging so a malformed delta throws first and leaves no record. The decoded
      // `text` / `turn_id` / `seq` are NEVER logged — only the frame's byte length + one-way hash,
      // reusing the existing content-free field set (no new DiagnosticEvent field). The `text` IS
      // carried onward by the consumer (the render payload), but it does not enter the diagnostic log.
      const delta = parseAssistantDeltaPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'assistant_delta',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'assistant-delta', delta }
    }
    case 'turn_end': {
      // Narrow BEFORE logging (see the assistant_delta case). No decoded field (turn_id / stop_reason)
      // is logged — only the frame's byte length + one-way hash.
      const turnEnd = parseTurnEndPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'turn_end',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'turn-end', turnEnd }
    }
    case 'turn_state': {
      // Narrow BEFORE logging so a malformed frame (a `state` outside the closed enum) throws first
      // and leaves no record. No decoded field (state / conversation_id) is logged — only the frame's
      // byte length + one-way hash, reusing the existing content-free field set.
      const turnState = parseTurnStatePayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'turn_state',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'turn-state', turnState }
    }
    case 'tool_use': {
      // Narrow BEFORE logging so a malformed frame (a missing / non-string field) throws first and
      // leaves no record. No decoded field (name / input_summary / tool_use_id / turn_id /
      // conversation_id) is logged — only the frame's byte length + one-way hash, reusing the existing
      // content-free field set. `name` / `input_summary` are carried onward by the consumer (the render
      // payload, #218), but they never enter the diagnostic log.
      const toolUse = parseToolUsePayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'tool_use',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'tool-use', toolUse }
    }
    case 'conversations': {
      // Narrow BEFORE logging so a malformed reply (a bad row, a non-array) throws first and leaves no
      // record. No decoded field (id / name / cwd / timestamp) is logged — only the frame's byte length
      // + one-way hash. Deliberately NO `count` field (unlike the message_chunk arm): AC7 restricts the
      // set to type/bytes/hash, and a conversation-count is more identifying than a message-batch size.
      const conversations = parseConversationsPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'conversations',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'conversations', conversations }
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
