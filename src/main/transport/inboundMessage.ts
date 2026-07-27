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
  StallPayload,
  ApiRetryPayload,
  CompactingPayload,
  UnrecognizedMessagePayload,
  SessionTransitionPayload,
  SessionSettingsUpdatedPayload,
  ToolUsePayload,
  ToolResultPayload,
  QueuedItem,
  QueueStatePayload,
  ConversationSummary,
  ConversationCreatedPayload,
  ConversationUpdatedPayload,
  ConversationDeletedPayload,
  RecentWorkspace,
  WorkspaceFolderCreatedPayload,
  ModalShownPayload,
  ModalDismissedPayload,
  WireModalOption
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
 * text (code / message) is never narrowed or surfaced, only "a terminal error arrived." It DOES
 * carry the optional numeric `inReplyTo` — the `Envelope.in_reply_to` routing id already surfaced by
 * decodeEnvelope (#269), propagated (not re-decoded, no ErrorPayload parsed) so the consumer can
 * correlate the error back to a pending `set_session_settings` request and surface a rejection;
 * `undefined` when the frame omits it (correlation fails closed). Still surfaces NO error content.
 * The `snapshot` kind (#180)
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
 * The `stall` kind (#315) carries the decoded StallPayload — the onset-only liveness signal the daemon
 * fans out to interactive clients when a turn goes quiet. The consumer drops `conversation_id` and emits
 * a NULLARY `stallDetected` event (the payload's only field is not carried); the fail-closed required
 * `conversation_id` string here is the boundary this slice defends. Ships dormant — the render slice
 * (#317) is the first consumer.
 *
 * The `api-retry` kind (#492) carries the decoded ApiRetryPayload — the PTY-derived status peer of
 * `stall` the daemon fans out to interactive clients while claude retries against an API error. Unlike
 * `stall` this arm is NOT nullary: the consumer carries the edge (`active`) and the counter (`current` /
 * `total`) onward, dropping only `conversation_id`. The fail-closed defence here is four required fields
 * — one string, one BOOLEAN (whose `false` is the falling edge, a value not an absence) and two NUMBERS
 * (whose `0` is the legitimate "count unknown" value, so nothing may consult truthiness). NOT onset-only
 * and NOT deduped: N frames narrow to N values. Ships dormant — the render slice (#493) is the first
 * consumer.
 *
 * The `compacting` kind (#495) carries the decoded CompactingPayload — the PTY-derived status peer of
 * `stall` / `api-retry` the daemon fans out to interactive clients while claude auto-compacts the
 * conversation. BANNER-ONLY: the wire carries no progress at all, so the consumer carries just the edge
 * (`active`) onward, dropping `conversation_id`. The fail-closed defence here is two required fields —
 * one string and one BOOLEAN (whose `false` is the explicit falling edge, a value not an absence, so
 * nothing may consult truthiness). NOT onset-only and NOT deduped: N frames narrow to N values. Ships
 * dormant — the render slice (#496) is the first consumer.
 *
 * The `unrecognized-message` kind carries the decoded UnrecognizedMessagePayload — the daemon's report
 * that its stream parser met claude output it has no mapping for. NOT a claude sub-state like its
 * `stall` / `api-retry` / `compacting` neighbours: it reports a gap in the daemon's own mapping. The
 * consumer carries `site`, `message_type`, `raw` and `truncated` onward, dropping `conversation_id` (the
 * turnState convention).
 *
 * This is the ONE inbound kind whose whole point is to carry an unbounded, unstructured daemon string,
 * so the fail-closed defence matters more here than anywhere else on this file: a closed-enum `site`
 * (literal comparison, never requireString), two required strings, and a required BOOLEAN whose `false`
 * is a value not an absence. The daemon caps `raw` at construction and the frame-level
 * MAX_PLAINTEXT_BYTES guard backstops the oversized case, so no length check is duplicated here. Ships
 * dormant — the render slice is the first consumer.
 *
 * The `session-transition` kind (#254) carries the decoded SessionTransitionPayload — the session-boundary
 * marker whose `new_session_id` is the addressing key the #259 holder will retain. The consumer carries
 * ONLY `new_session_id` onward (dropping the other four decoded fields — the #180 content-drop model); the
 * fail-closed `reason` closed-enum check plus the nullable `workspace_cwd` here are the boundary this slice
 * defends. `workspace_cwd` is opaque workspace display text (like `cwd` #139), decoded but dropped at the emit.
 *
 * The `session-settings-updated` kind (#264) carries the decoded SessionSettingsUpdatedPayload — the
 * daemon's confirmation that a `set_session_settings` (#263) request landed. It carries ONLY `session_id`
 * (the addressing key, a routing id not a secret); the reply echoes no settings. The fail-closed defence
 * is a single required `session_id` string (no enum, no nullable). It ALSO carries the optional
 * `inReplyTo` — the numeric `Envelope.in_reply_to` routing id (#261) already surfaced by decodeEnvelope,
 * propagated (not re-decoded) so the consumer (#261) can correlate the reply back to its originating
 * `set_session_settings` request. `inReplyTo` is `undefined` when the frame omits `in_reply_to`, which
 * makes correlation fail closed downstream. The consumer emits `{ sessionId, changeId }` (the client
 * changeId, never the wire in_reply_to); its store consumer is #256, not yet built.
 *
 * The `tool-use` kind (#217) carries the decoded ToolUsePayload — the tool-call enrichment that drives
 * a durable `toolCall` timeline item (#202 / #121). The consumer carries the four render fields onward
 * (dropping `conversation_id`); the fail-closed required-string presence here (five strings, no enum)
 * is the boundary this slice defends. `name` / `input_summary` are opaque display text (like `stop_reason`).
 *
 * The `tool-result` kind (#229) carries the decoded ToolResultPayload — the outcome half that RESOLVES an
 * existing `toolCall` in place (correlated by `tool_use_id`, #121's `fillResult`), NOT a new row. The
 * consumer carries the four render fields onward (dropping `conversation_id`); the fail-closed defence is
 * four required strings PLUS one required boolean (`is_error`, whose `false` is a value, not an absence).
 * `result_summary` is opaque display text carried onward, its DOM sink being the render slice #230.
 *
 * The `queue-state` kind (#292) carries the decoded QueueStatePayload — the daemon's queued-backlog
 * snapshot (daemon STATE, not part of claude's turn stream, #720). Like `conversations`, one frame narrows
 * to a whole ordered list; the fail-closed decode here (a `conversation_id` string plus a per-item narrower
 * over the `queued` array — each item a required NUMBER `queued_msg_id` + two required strings) is the
 * boundary this slice defends. A JSON-string `queued_msg_id` is rejected (the bundle `seq/total` precedent);
 * an empty `queued: []` is valid. The consumer carries `conversation_id` (as `conversationId`) + the backlog
 * onward; `text` is untrusted display text the render slice (#294) must render as plain text. The real
 * consumer is the #293 queue store; all three renderer bridges no-op this arm.
 *
 * The `conversations` kind (#139) carries the decoded ConversationSummary[] (order preserved from the
 * wire). Like `chunk`, a single reply narrows to a whole list; the consumer forwards it verbatim as
 * one `conversationsReceived` event — no field is a secret, so nothing is dropped.
 *
 * The `conversation-created` kind (#241) carries the decoded ConversationCreatedPayload — its OWN
 * 5-field shape (NOT ConversationSummary; the daemon excludes is_archived/last_message_ts on a create
 * reply, spec #274). The fail-closed decode here (four required strings + one required boolean, `name`
 * nullable) is the boundary this slice defends; the consumer forwards it verbatim as one
 * `conversationCreated` event — nothing to drop. `name` / `cwd` are untrusted display text.
 *
 * The `conversation-deleted` kind (#375) carries the decoded single-field ConversationDeletedPayload —
 * the CORRELATED permanent-delete confirmation (matched by `in_reply_to`, NOT a broadcast; the deliberate
 * contrast with `conversation-updated`). The emit (#375) flattens it to the bare `id` — the routing id of
 * the deleted row. `id` is untrusted daemon-supplied routing text; no consumer resolves it to a path.
 *
 * The two modal kinds (#201) carry the decoded ModalShownPayload / ModalDismissedPayload — the
 * permission/trust prompt `claude` blocks on. The fail-closed decode here (two closed-enum checks on
 * `class` / `source` + a per-option narrower over the ordered `options` array) is the boundary this
 * slice defends; `title` / `prompt` / `options[].label` are untrusted display text carried onward
 * (dropping nothing — a modal has no `conversation_id`). BOTH renderer bridges no-op these arms; the
 * real consumer is the modal store + bridge (#223).
 */
export type InboundDaemonMessage =
  | { kind: 'message'; message: MessagePayload }
  | { kind: 'chunk'; messages: MessagePayload[] }
  | { kind: 'bundle-chunk'; seq: number; data: Uint8Array }
  | { kind: 'bundle-done'; total: number }
  | { kind: 'daemon-error'; inReplyTo?: number }
  | { kind: 'snapshot'; snapshot: ScreenSnapshotPayload }
  | { kind: 'assistant-delta'; delta: AssistantDeltaPayload }
  | { kind: 'turn-end'; turnEnd: TurnEndPayload }
  | { kind: 'turn-state'; turnState: TurnStatePayload }
  | { kind: 'stall'; stall: StallPayload }
  | { kind: 'api-retry'; apiRetry: ApiRetryPayload }
  | { kind: 'compacting'; compacting: CompactingPayload }
  | { kind: 'unrecognized-message'; unrecognized: UnrecognizedMessagePayload }
  | { kind: 'session-transition'; sessionTransition: SessionTransitionPayload }
  | {
      kind: 'session-settings-updated'
      sessionSettingsUpdated: SessionSettingsUpdatedPayload
      inReplyTo?: number
    }
  | { kind: 'tool-use'; toolUse: ToolUsePayload }
  | { kind: 'tool-result'; toolResult: ToolResultPayload }
  | { kind: 'queue-state'; queueState: QueueStatePayload }
  | { kind: 'conversations'; conversations: ConversationSummary[] }
  | { kind: 'conversation-created'; conversationCreated: ConversationCreatedPayload }
  | { kind: 'conversation-updated'; conversationUpdated: ConversationUpdatedPayload }
  | { kind: 'conversation-deleted'; conversationDeleted: ConversationDeletedPayload }
  | { kind: 'recent-workspaces'; recentWorkspaces: RecentWorkspace[] }
  | { kind: 'workspace-folder-created'; workspaceFolderCreated: WorkspaceFolderCreatedPayload }
  | { kind: 'modal-shown'; modalShown: ModalShownPayload }
  | { kind: 'modal-dismissed'; modalDismissed: ModalDismissedPayload }

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
 * Narrow an opaque payload into a StallPayload (#315). Fail-closed like parseTurnStatePayload, scaled
 * down to the frame's ONE field: a single `requireString(payload, 'conversation_id')` — no closed enum
 * (stall carries no `state`), no nullable, no cross-field validation. A missing / mistyped
 * `conversation_id` throws WireDecodeError (never a partial value); the frame-level MAX_PLAINTEXT_BYTES
 * guard in parseInboundMessage covers the oversized case. Returns only the one known field; unknown
 * server-added keys (e.g. a spurious `turn_id`) are tolerated (forward-compat) but NOT copied through.
 * Its message names the failure CATEGORY only (`requireString` emits `missing required field:
 * conversation_id`) — never interpolating the value, which is conversation-correlating.
 */
function parseStallPayload(payload: unknown): StallPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed stall payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  return { conversation_id }
}

/**
 * Narrow an opaque payload into an ApiRetryPayload (#492). Fail-closed like parseStallPayload, scaled
 * from one field to four — and every one of them maps onto an existing helper, so no new number check is
 * invented here. `requireBoolean` gives the falling edge for free (its check is on the TYPE, so a literal
 * `false` passes while `0` / `'true'` / `null` fail), and `requireNumber` gives the `0/0` "count unknown"
 * state for free (a plain `typeof === 'number'`, never a truthiness test). It deliberately does NOT
 * range-check or integer-check `current` / `total`: there is no house precedent for range-validating a
 * wire integer (`seq` / `total` / `used_tokens` / `window_tokens` / `queued_msg_id` are all bare
 * requireNumber since #116), and a client-invented bound would silently drop VALID future frames — the
 * drift risk CLAUDE.md / ADR 0002 rank above cosmetic robustness. The render slice (#493) formats the
 * counter defensively instead (in particular `current / total` must handle the legitimate `0/0`).
 *
 * Any missing / mistyped field throws WireDecodeError (never a partial value); the frame-level
 * MAX_PLAINTEXT_BYTES guard in parseInboundMessage covers the oversized case. Returns a fresh four-field
 * literal, so unknown server-added keys (e.g. a spurious `turn_id`) are tolerated (forward-compat) but
 * NOT copied through — which also makes it prototype-pollution-safe. Its messages name the failure
 * CATEGORY only, never interpolating a value.
 */
function parseApiRetryPayload(payload: unknown): ApiRetryPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed api_retry payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const active = requireBoolean(payload, 'active')
  const current = requireNumber(payload, 'current')
  const total = requireNumber(payload, 'total')
  return { conversation_id, active, current, total }
}

/**
 * Narrow an opaque payload into a CompactingPayload (#495). Fail-closed like parseApiRetryPayload,
 * scaled down to the frame's TWO fields — and both map onto an existing helper, so nothing new is
 * invented here. `requireBoolean` gives the explicit falling edge for free (its check is on the TYPE, so
 * a literal `false` passes while `0` / `'true'` / `null` fail). The frame is BANNER-ONLY — the wire
 * carries no counter or percentage — so unlike parseApiRetryPayload there is no numeric field at all,
 * and the range-check question does not arise.
 *
 * Any missing / mistyped field throws WireDecodeError (never a partial value); the frame-level
 * MAX_PLAINTEXT_BYTES guard in parseInboundMessage covers the oversized case. Returns a fresh two-field
 * literal, so unknown server-added keys (e.g. a spurious `turn_id`) are tolerated (forward-compat) but
 * NOT copied through — which also makes it prototype-pollution-safe. Its messages name the failure
 * CATEGORY only, never interpolating a value (a `conversation_id` is conversation-correlating).
 */
function parseCompactingPayload(payload: unknown): CompactingPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed compacting payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const active = requireBoolean(payload, 'active')
  return { conversation_id, active }
}

/**
 * Narrow an opaque payload into an UnrecognizedMessagePayload. Fail-closed like its neighbours, over
 * five fields: two required strings, a required BOOLEAN (`truncated`, whose `false` is a value not an
 * absence, so nothing may consult truthiness), and a `site` closed-enum check cloned from
 * parseSessionTransitionPayload's `reason` check — a bare requireString would accept any string and
 * defeat exactly the boundary that keeps a daemon-supplied value out of a render branch.
 *
 * `message_type` is required but MAY BE EMPTY, and that is a wire-level fact rather than sloppiness: the
 * `undecodable` site means nothing decoded, so no type was ever read. requireString admits `''`, which
 * is the wanted behaviour; the decoder does NOT cross-validate the empty-⟺-`undecodable` invariant
 * (daemon-guaranteed, and enforcing it here would defend an unobserved failure).
 *
 * `raw` gets NO length check. The daemon truncates at construction — that is why `truncated` exists —
 * and parseInboundMessage's frame-level MAX_PLAINTEXT_BYTES guard backstops the oversized case, so a
 * third bound here would be a defence against a failure that cannot reach this line.
 *
 * Returns a fresh five-field literal, so unknown server-added keys (e.g. a spurious `turn_id`) are
 * tolerated (forward-compat) but NOT copied through — which also makes it prototype-pollution-safe.
 * Its messages name the failure CATEGORY only: never the `raw` blob (unbounded, model-adjacent) and
 * never the conversation-correlating id.
 */
function parseUnrecognizedMessagePayload(payload: unknown): UnrecognizedMessagePayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed unrecognized_message payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const message_type = requireString(payload, 'message_type')
  const raw = requireString(payload, 'raw')
  const truncated = requireBoolean(payload, 'truncated')
  const site = payload.site
  if (
    site !== 'line_type' &&
    site !== 'assistant_block' &&
    site !== 'user_block' &&
    site !== 'undecodable'
  ) {
    throw new WireDecodeError('missing required field: site')
  }
  return { conversation_id, site, message_type, raw, truncated }
}

/**
 * Narrow an opaque payload into a SessionTransitionPayload (#254). Fail-closed like parseTurnStatePayload,
 * scaled to five fields: three required strings (`previous_session_id` / `new_session_id` / `occurred_at`),
 * a required nullable `workspace_cwd` via requireStringOrNull (the `ConversationSummary.name` #139 idiom — a
 * literal `null` is a valid value for `clear` / `idle_evict`, but absent/`undefined` or a non-string-non-null
 * throws), and a `reason` closed-enum check cloned from parseTurnStatePayload's `state` check (covers
 * non-string and unknown-string alike, narrowing to WireSessionTransitionReason without a cast — a bare
 * requireString would accept any string and defeat the closed-enum boundary this slice exists to defend). The
 * check stays exhaustive over the full closed set INCLUDING `workspace_change`, even though the producer
 * (#657) emits only `clear` / `idle_evict` today. The decoder does NOT cross-validate the
 * `workspace_cwd`-non-null-⟺-`workspace_change` invariant (daemon-guaranteed on the wire; enforcing it here
 * would defend an unobserved failure). Returns exactly the five known fields; unknown keys (e.g. a spurious
 * `conversation_id`) are tolerated but not copied. Its messages name the failure CATEGORY only — never
 * interpolating a `workspace_cwd` path or a session-correlating id.
 */
function parseSessionTransitionPayload(payload: unknown): SessionTransitionPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed session_transition payload')
  }
  const previous_session_id = requireString(payload, 'previous_session_id')
  const new_session_id = requireString(payload, 'new_session_id')
  const occurred_at = requireString(payload, 'occurred_at')
  const workspace_cwd = requireStringOrNull(payload, 'workspace_cwd')
  const reason = payload.reason
  if (reason !== 'clear' && reason !== 'idle_evict' && reason !== 'workspace_change') {
    throw new WireDecodeError('missing required field: reason')
  }
  return { previous_session_id, new_session_id, reason, occurred_at, workspace_cwd }
}

/**
 * Narrow an opaque payload into a SessionSettingsUpdatedPayload (#264). Fail-closed like
 * parseSessionTransitionPayload, scaled down to the reply's ONE field: a single
 * `requireString(payload, 'session_id')` (no closed enum, no nullable, no cross-field validation — the
 * reply echoes no settings, so `session_id` is all there is). Returns exactly the one known field;
 * unknown server-added keys (e.g. a spurious echoed `model` / `reason`, or an `in_reply_to` echoed onto
 * the payload) are tolerated (forward-compat) but NOT copied through. Its message names the failure
 * CATEGORY only (`requireString` emits `missing required field: session_id`) — never interpolating the
 * value, which is conversation-correlating.
 */
function parseSessionSettingsUpdatedPayload(payload: unknown): SessionSettingsUpdatedPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed session_settings_updated payload')
  }
  const session_id = requireString(payload, 'session_id')
  return { session_id }
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
 * Narrow an opaque payload into a ToolResultPayload (#229). Fail-closed like parseToolUsePayload: four
 * required strings (`conversation_id` / `turn_id` / `tool_use_id` / `result_summary`) PLUS one required
 * boolean `is_error` via requireBoolean (the `yolo` #180 idiom — the check is on the TYPE, so `false`
 * decodes as the value `false`, never treated as an absence, and a non-boolean like the string `'true'`
 * throws rather than being silently accepted by a truthiness check). Unknown keys tolerated but not
 * copied, category-only error messages (no field value interpolated — `result_summary` could echo tool
 * content). `result_summary` is carried through as opaque display text, never interpreted here.
 */
function parseToolResultPayload(payload: unknown): ToolResultPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed tool_result payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const turn_id = requireString(payload, 'turn_id')
  const tool_use_id = requireString(payload, 'tool_use_id')
  const is_error = requireBoolean(payload, 'is_error')
  const result_summary = requireString(payload, 'result_summary')
  return { conversation_id, turn_id, tool_use_id, is_error, result_summary }
}

/**
 * Narrow one opaque queued-backlog entry into a QueuedItem (#292). Fail-closed like parseModalOption:
 * `queued_msg_id` a required NUMBER via requireNumber (the bundle `seq` / `total` #116 idiom — the check
 * is on the TYPE, so a JSON-string `'7'` fails closed rather than being silently coerced, which is exactly
 * what rejects a mistyped counter, AC4), plus `text` / `ts` required strings. Deliberately NO integer /
 * `≥ 1` / range check: "integer ≥ 1" is a daemon guarantee, and policing it here would defend an unobserved
 * failure mode (the parseSessionTransitionPayload no-cross-validate posture). Returns only the three known
 * fields; unknown server-added keys are tolerated (forward-compat) but not copied. Its message names the
 * category only — `text` is untrusted transit content and `queued_msg_id` correlates a message.
 */
function parseQueuedItem(payload: unknown): QueuedItem {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed queued item')
  }
  const queued_msg_id = requireNumber(payload, 'queued_msg_id')
  const text = requireString(payload, 'text')
  const ts = requireString(payload, 'ts')
  return { queued_msg_id, text, ts }
}

/**
 * Narrow an opaque payload into a QueueStatePayload (#292): `conversation_id` a required string, then
 * `queued` must be an array, and every element narrows via parseQueuedItem — one bad item throws, failing
 * the whole snapshot closed (the parseConversationsPayload precedent). An EMPTY array is valid (`[].map()`
 * → `[]`, AC3 — a zero-length backlog is a value, never null or an error). Order is preserved from the
 * wire (enqueue order, AC2). Its messages name the failure category only — a `conversation_id` correlates
 * a conversation and a queued item's `text` is untrusted content.
 */
function parseQueueStatePayload(payload: unknown): QueueStatePayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed queue_state payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const raw = payload.queued
  if (!Array.isArray(raw)) {
    throw new WireDecodeError('malformed queued list')
  }
  return { conversation_id, queued: raw.map(parseQueuedItem) }
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
 * Narrow an opaque payload into one RecentWorkspace (#380). Fail-closed like parseConversationSummary
 * but simpler — two plain required strings, no nullable / boolean / enum: `path` and `last_used_at`.
 * `last_used_at` is checked for the string TYPE only, never parsed as a date (opaque RFC3339, formatted
 * downstream). Returns only the two known fields; unknown server-added keys are tolerated
 * (forward-compat) but NOT copied through. Its message names the failure category only — a `path` could
 * echo a `$HOME` / username / project name, so it is never interpolated.
 */
function parseRecentWorkspace(payload: unknown): RecentWorkspace {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed recent workspace')
  }
  const path = requireString(payload, 'path')
  const last_used_at = requireString(payload, 'last_used_at')
  return { path, last_used_at }
}

/**
 * Narrow an opaque payload into a recent_workspaces_list reply's row list (#380): `workspaces` must be
 * an array, and every element must narrow as a RecentWorkspace — one bad row throws, failing the whole
 * reply closed (mirroring parseConversationsPayload). Order is preserved from the wire — the daemon is
 * the source of truth for ordering (most-recent-first). An empty array is valid (no recent workspaces).
 */
function parseRecentWorkspacesPayload(payload: unknown): RecentWorkspace[] {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed recent_workspaces payload')
  }
  const raw = payload.workspaces
  if (!Array.isArray(raw)) {
    throw new WireDecodeError('malformed recent_workspaces list')
  }
  return raw.map(parseRecentWorkspace)
}

/**
 * Narrow an opaque payload into a ConversationCreatedPayload (#241). Fail-closed like
 * parseConversationSummary, scaled to the create reply's OWN 5-field shape — `id` / `cwd` /
 * `last_used_at` required strings, `is_promoted` a required boolean (the `yolo` #180 idiom — the check
 * is on the TYPE, so `false` decodes as the value `false`, never an absence, and a non-boolean throws),
 * and `name` a required, nullable string (`null` is a valid value — an unnamed scratch conversation,
 * AC5 — but a missing/`undefined` field throws). Returns only the five known fields; unknown
 * server-added keys (e.g. a spurious is_archived/last_message_ts) are tolerated (forward-compat) but
 * NOT copied through. Its messages name the failure category only — a `name` / `cwd` could echo a title
 * or workspace path.
 */
function parseConversationCreatedPayload(payload: unknown): ConversationCreatedPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed conversation_created payload')
  }
  const id = requireString(payload, 'id')
  const is_promoted = requireBoolean(payload, 'is_promoted')
  const cwd = requireString(payload, 'cwd')
  const name = requireStringOrNull(payload, 'name')
  const last_used_at = requireString(payload, 'last_used_at')
  return { id, is_promoted, cwd, name, last_used_at }
}

/**
 * Narrow an opaque payload into a ConversationUpdatedPayload (#273). Fail-closed like
 * parseConversationCreatedPayload, but in the reply's own field order — `name` BEFORE `cwd` (spec #274's
 * intentional reordering vs. the create reply): `id` / `cwd` / `last_used_at` required strings,
 * `is_promoted` a required boolean (the `yolo` #180 idiom — the check is on the TYPE, so `false` decodes
 * as the value `false`, never an absence, and a non-boolean throws), and `name` a required, nullable
 * string (`null` is a valid value — an update that left the name unset, AC — but a missing/`undefined`
 * field throws). Returns only the five known fields; unknown server-added keys (e.g. a spurious
 * is_archived/last_message_ts) are tolerated (forward-compat) but NOT copied through. Its messages name
 * the failure category only — a `name` / `cwd` could echo a title or workspace path.
 */
function parseConversationUpdatedPayload(payload: unknown): ConversationUpdatedPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed conversation_updated payload')
  }
  const id = requireString(payload, 'id')
  const is_promoted = requireBoolean(payload, 'is_promoted')
  const name = requireStringOrNull(payload, 'name')
  const cwd = requireString(payload, 'cwd')
  const last_used_at = requireString(payload, 'last_used_at')
  return { id, is_promoted, name, cwd, last_used_at }
}

/**
 * Narrow an opaque payload into a ConversationDeletedPayload (#375). Fail-closed like
 * parseConversationUpdatedPayload but scaled to ONE field: an `isRecord` guard, then the single required
 * `id` string. Returns a FRESH single-field `{ id }` object — the reply field is `id`, distinct from the
 * request's `conversation_id`; unknown server-added keys (including a stray `conversation_id`) are
 * tolerated (forward-compat) but NOT copied through. Its message names the failure category only (uniform
 * with the file — `id` is a routing id, not a secret, but the category-only posture stays consistent).
 */
function parseConversationDeletedPayload(payload: unknown): ConversationDeletedPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed conversation_deleted payload')
  }
  const id = requireString(payload, 'id')
  return { id }
}

/**
 * Narrow an opaque payload into a WorkspaceFolderCreatedPayload (#381). Fail-closed like
 * parseConversationDeletedPayload but keyed on the create reply's single field: an `isRecord` guard, then
 * the single required `path` string. Returns a FRESH single-field `{ path }` object; unknown server-added
 * keys are tolerated (forward-compat) but NOT copied through. Its message names the failure category only
 * — a `path` is an untrusted daemon-side REMOTE path that could echo a `$HOME` / username / project name,
 * so it is NEVER interpolated (requireString already emits `missing required field: path`).
 */
function parseWorkspaceFolderCreatedPayload(payload: unknown): WorkspaceFolderCreatedPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed workspace_folder_created payload')
  }
  const path = requireString(payload, 'path')
  return { path }
}

/**
 * Narrow one opaque option into a WireModalOption (#201). Fail-closed like parseConversationSummary:
 * two required strings (`id` / `label`), unknown keys tolerated but not copied. Its message names the
 * category only — an option `label` is untrusted `claude`-surfaced display text.
 */
function parseModalOption(payload: unknown): WireModalOption {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed modal option')
  }
  const id = requireString(payload, 'id')
  const label = requireString(payload, 'label')
  return { id, label }
}

/**
 * Narrow an opaque payload into a ModalShownPayload (#201). Fail-closed like parseTurnStatePayload,
 * scaled to six fields plus a nested ordered array. The `class` closed-enum check is cloned from the
 * `role` / `state` idiom: it covers non-string and unknown-string alike, narrowing to WireModalClass
 * without a cast — a bare requireString would accept any string and defeat the closed-enum boundary
 * this slice exists to defend (there is NO `destructive` wire class, ADR 0009). `options` must be an
 * array, then each element narrows via parseModalOption — one bad option throws the whole modal closed
 * (the `conversations` precedent), an empty array tolerated. `default_option_id ∈ options[].id` is NOT
 * cross-checked here (a render concern, #224). Returns exactly the six known fields; unknown keys are
 * tolerated but not copied. Its messages name the failure CATEGORY only — never interpolating
 * `title` / `prompt` / `options[].label` / `modal_id` / `class` (untrusted content or the nonce).
 */
function parseModalShownPayload(payload: unknown): ModalShownPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed modal_shown payload')
  }
  const modal_id = requireString(payload, 'modal_id')
  const cls = payload.class
  if (cls !== 'permission' && cls !== 'trust') {
    throw new WireDecodeError('missing required field: class')
  }
  const title = requireString(payload, 'title')
  const prompt = requireString(payload, 'prompt')
  const rawOptions = payload.options
  if (!Array.isArray(rawOptions)) {
    throw new WireDecodeError('malformed modal options')
  }
  const options = rawOptions.map(parseModalOption)
  const default_option_id = requireString(payload, 'default_option_id')
  return { modal_id, class: cls, title, prompt, options, default_option_id }
}

/**
 * Narrow an opaque payload into a ModalDismissedPayload (#201). Fail-closed: `modal_id` a required
 * string, `outcome` a required OPAQUE string (an option id or producer sentinel — carried verbatim,
 * NOT enum-checked), and the `source` closed-enum check (the `state` idiom, narrows to WireModalSource
 * without a cast). Returns the three known fields; unknown keys tolerated but not copied. Its messages
 * name the failure category only — never interpolating `outcome` / `modal_id` / `source`.
 */
function parseModalDismissedPayload(payload: unknown): ModalDismissedPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed modal_dismissed payload')
  }
  const modal_id = requireString(payload, 'modal_id')
  const outcome = requireString(payload, 'outcome')
  const src = payload.source
  if (src !== 'remote' && src !== 'local' && src !== 'timeout') {
    throw new WireDecodeError('missing required field: source')
  }
  return { modal_id, outcome, source: src }
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
    case 'stall': {
      // Narrow BEFORE logging so a malformed frame (an absent / non-string conversation_id) throws
      // first and leaves no record. No decoded field (conversation_id) is logged — only the frame's
      // byte length + one-way hash, reusing the existing content-free field set (no new DiagnosticEvent
      // field, so #131's renderer pin is untouched).
      const stall = parseStallPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'stall',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'stall', stall }
    }
    case 'api_retry': {
      // Narrow BEFORE logging so a malformed frame (an absent boolean `active`, a string `current`)
      // throws first and leaves no record. No decoded field (conversation_id / active / current / total)
      // is logged — only the frame's byte length + one-way hash, reusing the existing content-free field
      // set (no new DiagnosticEvent field, so #131's renderer pin is untouched).
      const apiRetry = parseApiRetryPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'api_retry',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'api-retry', apiRetry }
    }
    case 'compacting': {
      // Narrow BEFORE logging so a malformed frame (an absent / non-boolean `active`, a non-string
      // conversation_id) throws first and leaves no record. No decoded field (conversation_id / active)
      // is logged — only the frame's byte length + one-way hash, reusing the existing content-free field
      // set (no new DiagnosticEvent field, so #131's renderer pin is untouched).
      const compacting = parseCompactingPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'compacting',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'compacting', compacting }
    }
    case 'unrecognized_message': {
      // Narrow BEFORE logging so a malformed frame (an unknown `site`, an absent `raw`, a non-boolean
      // `truncated`) throws first and leaves no record. The no-content-in-the-log rule binds hardest
      // here: `raw` is the most untrusted string on this wire, so NOTHING decoded is logged — only the
      // frame's byte length + one-way hash, reusing the existing content-free field set. Note the
      // asymmetry that makes this frame worth having: the DAEMON deliberately logs nothing useful about
      // the drop either, which is why it now crosses the wire instead.
      const unrecognized = parseUnrecognizedMessagePayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'unrecognized_message',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'unrecognized-message', unrecognized }
    }
    case 'session_transition': {
      // Narrow BEFORE logging so a malformed frame (a `reason` outside the closed enum, an
      // absent/non-string-non-null `workspace_cwd`) throws first and leaves no record. No decoded field
      // (session ids / reason / occurred_at / workspace_cwd) is logged — only the frame's byte length +
      // one-way hash, reusing the existing content-free field set.
      const sessionTransition = parseSessionTransitionPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'session_transition',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'session-transition', sessionTransition }
    }
    case 'session_settings_updated': {
      // Narrow BEFORE logging so a malformed frame (an absent / non-string `session_id`) throws first
      // and leaves no record. No decoded field (session_id) is logged — only the frame's byte length +
      // one-way hash, reusing the existing content-free field set. The numeric `in_reply_to` is a
      // routing id, not logged (no new DiagnosticEvent field, so #131's renderer pin is untouched).
      const sessionSettingsUpdated = parseSessionSettingsUpdatedPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'session_settings_updated',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      // Propagate the ALREADY-decoded Envelope.in_reply_to (#261) — do not re-decode. `undefined` when
      // the frame omits it, which makes the consumer's correlation fail closed.
      return { kind: 'session-settings-updated', sessionSettingsUpdated, inReplyTo: envelope.in_reply_to }
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
    case 'tool_result': {
      // Narrow BEFORE logging so a malformed frame (a missing / non-string field, or a non-boolean
      // is_error) throws first and leaves no record. No decoded field (result_summary / is_error /
      // tool_use_id / turn_id / conversation_id) is logged — only the frame's byte length + one-way
      // hash, reusing the existing content-free field set. `result_summary` is carried onward by the
      // consumer (the render payload, #230), but it never enters the diagnostic log.
      const toolResult = parseToolResultPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'tool_result',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'tool-result', toolResult }
    }
    case 'queue_state': {
      // Narrow BEFORE logging so a malformed snapshot (a non-array `queued`, a string `queued_msg_id`)
      // throws first and leaves no record. No decoded field (conversation_id / queued_msg_id / text / ts)
      // is logged — only the frame's byte length + one-way hash, reusing the existing content-free field
      // set. Deliberately NO `count` field (the conversations #139 posture): the set stays type/bytes/hash.
      // `text` is carried onward by the consumer (the render payload, #294), but it never enters the log.
      const queueState = parseQueueStatePayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'queue_state',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'queue-state', queueState }
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
    case 'recent_workspaces_list': {
      // Narrow BEFORE logging so a malformed reply (a bad row, a non-array) throws first and leaves no
      // record. No decoded field (path / last_used_at) is logged — only the frame's byte length + one-way
      // hash. Deliberately NO `count` field (the conversations #139 posture): AC restricts the set to
      // type/bytes/hash, and a workspace-count is more identifying than a message-batch size; a `path`
      // could echo a $HOME / username, so nothing but the shape is recorded.
      const recentWorkspaces = parseRecentWorkspacesPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'recent_workspaces_list',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'recent-workspaces', recentWorkspaces }
    }
    case 'conversation_created': {
      // Narrow BEFORE logging so a malformed reply (a missing / mistyped field) throws first and leaves
      // no record. No decoded field (id / name / cwd / last_used_at / is_promoted) is logged — only the
      // frame's byte length + one-way hash, reusing the existing content-free field set. Deliberately NO
      // `count` field (the conversations #139 posture): the set stays type/bytes/hash.
      const conversationCreated = parseConversationCreatedPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'conversation_created',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'conversation-created', conversationCreated }
    }
    case 'conversation_updated': {
      // Narrow BEFORE logging so a malformed broadcast (a missing / mistyped field) throws first and
      // leaves no record. No decoded field (id / name / cwd / last_used_at / is_promoted) is logged —
      // only the frame's byte length + one-way hash, reusing the existing content-free field set.
      // Deliberately NO `count` field (the conversation_created #241 posture): the set stays
      // type/bytes/hash.
      const conversationUpdated = parseConversationUpdatedPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'conversation_updated',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'conversation-updated', conversationUpdated }
    }
    case 'conversation_deleted': {
      // Narrow BEFORE logging so a malformed reply (a missing / non-string `id`) throws first and leaves
      // no record. The decoded `id` is NEVER logged — only the frame's byte length + one-way hash, reusing
      // the existing content-free field set. Deliberately NO `count` field (the conversation_updated #273
      // posture): the set stays type/bytes/hash.
      const conversationDeleted = parseConversationDeletedPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'conversation_deleted',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'conversation-deleted', conversationDeleted }
    }
    case 'workspace_folder_created': {
      // Narrow BEFORE logging so a malformed reply (a missing / non-string `path`) throws first and leaves
      // no record. The decoded `path` is NEVER logged — only the frame's byte length + one-way hash, reusing
      // the existing content-free field set. Deliberately NO `count` field (the conversation_deleted #375
      // posture): the set stays type/bytes/hash — a `path` could echo a $HOME / username, so nothing but
      // the shape is recorded.
      const workspaceFolderCreated = parseWorkspaceFolderCreatedPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'workspace_folder_created',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'workspace-folder-created', workspaceFolderCreated }
    }
    case 'modal_shown': {
      // Narrow BEFORE logging so a malformed frame (a `class` outside the closed enum, a bad option)
      // throws first and leaves no record. No decoded field (modal_id / class / title / prompt /
      // options / default_option_id) is logged — only the frame's byte length + one-way hash, reusing
      // the existing content-free field set. `title` / `prompt` / `options[].label` are carried onward
      // by the consumer (the render payload, #224), but they never enter the diagnostic log.
      const modalShown = parseModalShownPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'modal_shown',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'modal-shown', modalShown }
    }
    case 'modal_dismissed': {
      // Narrow BEFORE logging so a malformed frame (a `source` outside the closed enum) throws first
      // and leaves no record. No decoded field (modal_id / outcome / source) is logged — only the
      // frame's byte length + one-way hash.
      const modalDismissed = parseModalDismissedPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'modal_dismissed',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'modal-dismissed', modalDismissed }
    }
    case 'error':
      // Now MODELED (#116): a single daemon `error` reply terminates an in-flight bundle request.
      // CONTENT-FREE — no ErrorPayload field (code / message) is narrowed or surfaced; the reassembler
      // only needs "a terminal error arrived." It moves from inbound-unmodeled to inbound-decoded(error)
      // now that it is recognised — a content-free, more-accurate log that applies to ALL `error`
      // frames, bundle-related or not (intentional; see the #116 spec). The numeric `in_reply_to` is a
      // routing id, not logged (no new DiagnosticEvent field, so #131's renderer pin is untouched).
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'error',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      // Propagate the ALREADY-decoded Envelope.in_reply_to (#269) — do not re-decode, parse no
      // ErrorPayload. `undefined` when the frame omits it, which makes the consumer's correlation to a
      // pending set_session_settings request fail closed. Carries ONLY the numeric id, never error content.
      return { kind: 'daemon-error', inReplyTo: envelope.in_reply_to }
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
