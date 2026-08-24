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
  AssistantDeltaPayload,
  TurnEndPayload,
  TurnStatePayload,
  StallPayload,
  ApiRetryPayload,
  CompactingPayload,
  BackgroundTaskStartedPayload,
  BackgroundTaskUpdatedPayload,
  BackgroundTask,
  BackgroundTaskRosterPayload,
  ModelAnnouncedPayload,
  UnrecognizedMessagePayload,
  SessionTransitionPayload,
  SessionSettingsPayload,
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
 * The `model-announced` kind (#587) carries the decoded ModelAnnouncedPayload — claude's own report of
 * the model it resolved for the turn, off its `system` / `init` line, fanned out to interactive clients.
 * Neither a claude sub-state like its `stall` / `api-retry` / `compacting` neighbours nor a daemon
 * mapping gap like `unrecognized-message`: an IDENTITY report, carrying no `turn_id` and opening and
 * closing no turn. The consumer carries `model` and `truncated` onward, dropping `conversation_id` (#588
 * holds a single value replaced per announcement, so nothing keys by
 * conversation). The fail-closed defence is two required strings plus one required BOOLEAN whose `false`
 * is a VALUE (nothing was cut), not an absence — `truncated` is never optional and never defaults.
 *
 * `model` is held VERBATIM: no normalising, no lowercasing, no allow-list, no family regex, and NO
 * LENGTH CHECK is duplicated here (the daemon caps it at 256 at construction — that is what `truncated`
 * reports — and MAX_PLAINTEXT_BYTES, 65519, backstops the frame with ~250× headroom). A client-invented
 * rule would drop identifiers claude legitimately announces, since the value need not be dated and need
 * not appear in any published list. Ships dormant — the announced-model store (#588) is the first
 * consumer.
 *
 * The `background-task-started` kind (#564) carries the decoded BackgroundTaskStartedPayload — the daemon's
 * announcement that claude started work OUTLIVING the turn that spawned it (pyrycode#1240), fanned out to
 * interactive clients. Unlike its `stall` / `api-retry` / `compacting` neighbours it is not a claude
 * sub-state at all: it carries no `turn_id`, opens and closes no turn, and is daemon STATE keyed by id —
 * so the consumer carries ALL SIX fields onward, `conversation_id` INCLUDED (the queue-state rule, #720;
 * the task store #567 attributes by id). The fail-closed defence is five required strings plus one
 * REQUIRED-PRESENT NULLABLE ARRAY (`truncated_fields`: a literal `null` is the value "nothing was cut", a
 * missing key is an absence and fails closed). `task_type` and the `truncated_fields` elements are
 * deliberately NOT narrowed to closed sets — both are open on the wire. `description` is, for
 * `task_type: local_bash`, the literal command line claude ran: untrusted display text, decoded and never
 * interpreted, never logged. Ships dormant — the task store (#567) is the first consumer.
 *
 * The `background-task-updated` kind (#565) carries the decoded BackgroundTaskUpdatedPayload — the PEER of
 * the kind above, joined on `task_id`: that frame opens a task, this one reports what CHANGED about it
 * afterwards. FOUR fields, not six (no `tool_call_id` / `description` / `task_type`; it gains `patch`).
 * Same non-turn character, so the consumer likewise carries ALL FOUR fields onward, `conversation_id`
 * INCLUDED. The fail-closed defence is three required strings plus the same REQUIRED-PRESENT NULLABLE
 * ARRAY, and neither the `truncated_fields` elements (`task_id` / `patch` here — a DIFFERENT pair from the
 * sibling's, which is why the vocabulary is never narrowed) nor `patch` itself is validated further:
 * `patch` is claude's patch object carried WHOLE AND UNPARSED as a string, which the daemon truncates at
 * construction, so it PROVABLY MAY NOT PARSE and is never fed to a JSON parser here. An EMPTY `patch` is a
 * value ("claude sent no change"), an omitted key an absence that fails closed. Untrusted display text
 * whose keys may carry command text: decoded, never interpreted, never logged. Ships dormant — the task
 * store (#567) is the first consumer.
 *
 * The `background-task-roster` kind (#566) carries the decoded BackgroundTaskRosterPayload — the AGGREGATE
 * peer of the two kinds above: they report what happened to ONE task, this reports WHAT IS ALIVE. A
 * SNAPSHOT, not a delta. Same non-turn character, so the consumer carries ALL THREE fields onward,
 * `conversation_id` INCLUDED. The fail-closed defence is one required string, one REQUIRED ARRAY (never
 * null — an empty `tasks` is the positive "nothing is alive" signal, so the key is always written and
 * `Array.isArray(null)` is `false`), one required NUMBER (`dropped_tasks`, whose `0` is a value not an
 * absence), and a per-row narrower that fails the WHOLE frame on one bad row rather than yielding a
 * partial roster. Within this one frame `tasks: null` fails closed while a ROW's `truncated_fields: null`
 * is a valid value — the same REQUIRED-PRESENT NULLABLE ARRAY the two kinds above use, applied per row.
 * Neither `task_type` nor the `truncated_fields` elements (`task_id` / `task_type` / `description` here —
 * a THIRD distinct set) is narrowed to a closed set. Each row's `description` is, for
 * `task_type: local_bash`, the literal command line claude ran: untrusted display text, decoded and never
 * interpreted, never logged. Ships dormant — the task store (#567) is the first consumer.
 *
 * The `unrecognized-message` kind carries the decoded UnrecognizedMessagePayload — the daemon's report
 * that its stream parser met claude output it has no mapping for. NOT a claude sub-state like its
 * `stall` / `api-retry` / `compacting` neighbours: it reports a gap in the daemon's own mapping. The
 * consumer carries `site`, `message_type`, `raw` and `truncated` onward, dropping `conversation_id`.
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
  | { kind: 'assistant-delta'; delta: AssistantDeltaPayload }
  | { kind: 'turn-end'; turnEnd: TurnEndPayload }
  | { kind: 'turn-state'; turnState: TurnStatePayload }
  | { kind: 'stall'; stall: StallPayload }
  | { kind: 'api-retry'; apiRetry: ApiRetryPayload }
  | { kind: 'compacting'; compacting: CompactingPayload }
  | { kind: 'model-announced'; modelAnnounced: ModelAnnouncedPayload }
  | { kind: 'background-task-started'; backgroundTaskStarted: BackgroundTaskStartedPayload }
  | { kind: 'background-task-updated'; backgroundTaskUpdated: BackgroundTaskUpdatedPayload }
  | { kind: 'background-task-roster'; backgroundTaskRoster: BackgroundTaskRosterPayload }
  | { kind: 'unrecognized-message'; unrecognized: UnrecognizedMessagePayload }
  | { kind: 'session-transition'; sessionTransition: SessionTransitionPayload }
  | {
      kind: 'session-settings-updated'
      sessionSettingsUpdated: SessionSettingsUpdatedPayload
      inReplyTo?: number
    }
  | {
      kind: 'session-settings'
      sessionSettings: SessionSettingsPayload
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

/** Narrow one required, nullable string-ARRAY field off the payload — a `string[]` OR a literal `null`
 *  — or fail closed with a category-only message. requireStringOrNull's semantic widened from a scalar
 *  to a list, for the background-task family's `truncated_fields` (#564, and #565 / #566 which carry the
 *  identical contract). The Go field is `[]string` with NO `omitempty`, so the daemon always writes the
 *  key and emits a literal `null` when nothing was cut: `null` is a VALID VALUE ("nothing was cut",
 *  distinct from the empty list), while an OMITTED key is `undefined` — neither `null` nor an array — and
 *  therefore fails closed, which is what separates this from an optional-field parse.
 *
 *  The element check is a bare `typeof === 'string'`, NOT a record narrower: every other array narrowing
 *  in this file (parseQueueStatePayload, parseMessageChunkPayload, the modal options) maps through a
 *  parseX because its elements are records, and these are bare strings. From parseQueuedItem it takes
 *  only the POSTURE — one bad element throws the whole payload closed, an empty array is valid, the
 *  result is a FRESH array (so array-borne extra properties cannot ride along). Deliberately NO closed-set
 *  validation of the names: `truncated_fields` names this frame's own wire fields today, and a
 *  client-side allowlist would fail-close a valid future frame (the parseQueuedItem no-cross-validate
 *  posture). The message names the field only — an element could echo a wire field name, and the values
 *  it describes are untrusted. */
function requireStringArrayOrNull(
  payload: Record<string, unknown>,
  field: string
): string[] | null {
  const value = payload[field]
  if (value === null) {
    return null
  }
  if (!Array.isArray(value)) {
    throw new WireDecodeError(`missing required field: ${field}`)
  }
  return value.map((element) => {
    if (typeof element !== 'string') {
      throw new WireDecodeError(`missing required field: ${field}`)
    }
    return element
  })
}

/** The three keys that reach Object.prototype's own members. Dropped from any daemon-keyed map, never
 *  copied onto the fresh container — see optionalStringMap. */
const RESERVED_MAP_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/** Narrow one OPTIONAL string-map field off the payload — an object whose every own enumerable value is
 *  a string — or fail closed with a category-only message. requireStringArrayOrNull's posture rotated
 *  from a list to a map, for `tool_use.input` (#642, daemon-side pyrycode#1678):
 *
 *    undefined (key absent)         → undefined      a PRE-#1678 daemon; the one case that does not throw
 *    null / array / string / number → throws         a post-#1678 daemon never writes any of these
 *    {}                             → a fresh {}     an EMPTY MAP, never collapsed into undefined
 *    every own value a string       → a fresh object minus the reserved keys
 *    any own value a non-string     → throws         the WHOLE payload, never a partial map
 *
 *  This is the OPTIONAL-field parse the require* family deliberately is not — hence the name: an
 *  omitted key returns `undefined` rather than failing closed, which is the whole difference
 *  requireStringArrayOrNull's doc comment draws. Optional to the CLIENT, not on the wire: the Go field
 *  has no `omitempty`, so absence means an older daemon (the conversation_updated.is_archived scar —
 *  requiring it would fail-close every frame from a build predating the daemon change).
 *
 *  Taken from requireStringArrayOrNull: one bad entry throws the whole payload closed (never a partial
 *  map with the bad entries skipped — the parseTurnStatePayload posture), an empty container is valid,
 *  and the result is a FRESH container built from own enumerable keys only, so nothing inherited or
 *  container-borne rides along. Deliberately NO cap on entry count or value length: the daemon owns
 *  those bounds and MAX_PLAINTEXT_BYTES already gates the whole frame upstream — a client-invented
 *  bound fail-closes a valid future frame (the parseQueuedItem no-cross-validate posture, ADR 0002).
 *
 *  This is the FIRST narrower in this file where the DAEMON chooses the object keys; every other one
 *  copies a fixed set of known field names, which is why parseApiRetryPayload gets prototype-pollution
 *  safety for free. Three reserved keys are therefore DROPPED rather than carried or thrown on:
 *  throwing would let the model suppress its own tool row from the timeline by naming a parameter
 *  `__proto__`, and carrying would buy inconsistency rather than fidelity, since a downstream
 *  `Object.assign` / `target[k] = …` copy invokes the prototype setter and silently loses the entry
 *  anyway. The value-type check runs for EVERY key, reserved ones included, BEFORE the skip — so
 *  `{"__proto__": {…}}` throws (non-string value) rather than being quietly dropped.
 *
 *  The message is a NEW category — `missing required field:` would be actively misleading here, since
 *  an absent key is exactly the case that does not throw. It names the client-owned `field` constant
 *  only: a daemon-supplied key is model-authored text just like a value, and neither may reach a
 *  message or a log (tool inputs are paths, command lines, URLs, and whatever an MCP tool takes). */
function optionalStringMap(
  payload: Record<string, unknown>,
  field: string
): Record<string, string> | undefined {
  const value = payload[field]
  if (value === undefined) {
    return undefined
  }
  if (!isRecord(value)) {
    throw new WireDecodeError(`malformed optional field: ${field}`)
  }
  const map: Record<string, string> = {}
  for (const key of Object.keys(value)) {
    const entry = value[key]
    if (typeof entry !== 'string') {
      throw new WireDecodeError(`malformed optional field: ${field}`)
    }
    if (RESERVED_MAP_KEYS.has(key)) {
      continue
    }
    map[key] = entry
  }
  return map
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
 * Narrow an opaque payload into a SessionSettingsPayload (#491). Fail-closed: every field is
 * required-present, because every zero value here is a
 * real ANSWER rather than an absence. `session_id: ''` means "the daemon has no session to
 * address", `model`/`effort: ''` mean "inherited daemon default", `yolo: false` means permissions
 * enforced, and `window_tokens: 0` means the usage reader is unwired. Defaulting any of them would
 * make "the daemon said zero" indistinguishable from "the daemon did not say", which is the exact
 * ambiguity that let the inert-sheet defect hide. Returns only the six known fields; unknown
 * server-added keys are tolerated (forward-compat) but not copied through. Its messages name the
 * failure category only — no field value is interpolated.
 */
function parseSessionSettingsPayload(payload: unknown): SessionSettingsPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed session_settings payload')
  }
  const session_id = requireString(payload, 'session_id')
  const model = requireString(payload, 'model')
  const effort = requireString(payload, 'effort')
  const yolo = requireBoolean(payload, 'yolo')
  const used_tokens = requireNumber(payload, 'used_tokens')
  const window_tokens = requireNumber(payload, 'window_tokens')
  return { session_id, model, effort, yolo, used_tokens, window_tokens }
}

/**
 * Narrow an opaque payload into an AssistantDeltaPayload (#199). Fail-closed: every field is
 * required-present — `seq:0` and `text:''` are valid VALUES
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
 * Narrow an opaque payload into a BackgroundTaskStartedPayload (#564). Fail-closed like its neighbours,
 * over six fields: five required strings plus `truncated_fields` through requireStringArrayOrNull — the
 * required-present-but-nullable list whose literal `null` means "nothing was cut" and whose OMITTED key
 * fails closed (the Go field has no `omitempty`, so the key is always on the wire).
 *
 * Deliberately NO closed-set narrowing of `task_type` or the `truncated_fields` element names: both are
 * open on the wire (`local_bash` is one observation, and one observation does not earn an enum), so a
 * client-invented set would fail-close a valid future frame — the drift risk CLAUDE.md / ADR 0002 rank
 * above cosmetic robustness, and the same no-cross-validate posture parseQueuedItem documents. No
 * per-field length check either: every string is bounded by the daemon at construction and the
 * frame-level MAX_PLAINTEXT_BYTES guard in parseInboundMessage covers the oversized case.
 *
 * Any missing / mistyped field throws WireDecodeError (never a partial value). Returns a fresh six-field
 * literal, so unknown server-added keys (e.g. a spurious `turn_id`, which this frame must never have) are
 * tolerated (forward-compat) but NOT copied through — which also makes it prototype-pollution-safe. Its
 * messages name the failure CATEGORY only, never interpolating a value: `description` is a shell command
 * line for `task_type: local_bash`, and the three ids are correlating identifiers.
 */
function parseBackgroundTaskStartedPayload(payload: unknown): BackgroundTaskStartedPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed background_task_started payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const task_id = requireString(payload, 'task_id')
  const tool_call_id = requireString(payload, 'tool_call_id')
  const description = requireString(payload, 'description')
  const task_type = requireString(payload, 'task_type')
  const truncated_fields = requireStringArrayOrNull(payload, 'truncated_fields')
  return { conversation_id, task_id, tool_call_id, description, task_type, truncated_fields }
}

/**
 * Narrow an opaque payload into a BackgroundTaskUpdatedPayload (#565). The subset twin of the narrower
 * above — FOUR fields, not six: three required strings plus `truncated_fields` through the same
 * requireStringArrayOrNull (whose docstring names this ticket; there is deliberately no second narrower
 * and no variant of it). There is no `tool_call_id`, no `description` and no `task_type` here.
 *
 * TWO PROPERTIES FALL OUT OF THE SHAPE rather than needing their own checks, and both are invisible in
 * the code below, which is why each has its own test:
 *
 *   - AN EMPTY `patch` IS VALID. requireString checks `typeof value !== 'string'`, so `''` passes free
 *     (the type-not-truthiness posture requireBoolean documents for `false`). The daemon documents the
 *     field as "empty when claude sent none", so `''` is a real wire value carried as `''`, never a
 *     missing field. A later "hardening" to a `.length` or truthiness check would silently break a
 *     valid frame.
 *   - AN OMITTED `patch` KEY FAILS CLOSED. The Go field has no `omitempty`, so the key is always on the
 *     wire; `undefined` is an absence and requireString throws on it. Same for `truncated_fields`.
 *
 * `patch` IS NEVER PARSED HERE — not by JSON.parse, not by a key lookup, not by a shape check. The daemon
 * truncates it at construction (`maxTaskPatch`), so a truncated object is no longer valid JSON and its
 * own golden fixture is cut mid-token: parsing would turn a VALID frame into a dropped one. It is an
 * opaque display blob whose validity is never assessed. Likewise NO closed-set narrowing of the
 * `truncated_fields` element names: they name this frame's own wire fields today (`task_id` / `patch` —
 * a different pair from the sibling's), and a client-side allowlist would fail-close a valid future
 * frame (the parseQueuedItem no-cross-validate posture). And NO reconciliation between the two: the
 * daemon scrubs invalid UTF-8 out of `patch` by deletion while `truncated_fields` reports the cap cut
 * only, so a mismatch is expected upstream behaviour, not a defect to detect. No per-field length check
 * either — every string is bounded by the daemon at construction and the frame-level MAX_PLAINTEXT_BYTES
 * guard in parseInboundMessage covers the oversized case.
 *
 * Any missing / mistyped field throws WireDecodeError (never a partial value). Returns a fresh four-field
 * literal, so unknown server-added keys — pointedly including the sibling's `tool_call_id` /
 * `description` / `task_type`, which this frame must never have — are tolerated (forward-compat) but NOT
 * copied through, which also makes it prototype-pollution-safe. Its messages name the failure CATEGORY
 * only, never interpolating a value: a `patch` key may carry command text, and the two ids are
 * correlating identifiers.
 */
function parseBackgroundTaskUpdatedPayload(payload: unknown): BackgroundTaskUpdatedPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed background_task_updated payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const task_id = requireString(payload, 'task_id')
  const patch = requireString(payload, 'patch')
  const truncated_fields = requireStringArrayOrNull(payload, 'truncated_fields')
  return { conversation_id, task_id, patch, truncated_fields }
}

/**
 * Narrow one opaque roster row into a BackgroundTask (#566). Takes parseQueuedItem's POSTURE — one bad
 * element throws the WHOLE payload closed (never a partial roster), an empty parent array is valid, the
 * result is a FRESH literal — and pointedly NOT parseBackgroundTaskStartedPayload's SHAPE: this row has
 * no `tool_call_id` and no `patch`, which the scalar frames carry because their LINES do, so a narrower
 * cloned from that one would require `tool_call_id` and fail-close every valid roster.
 *
 * Three required strings plus `truncated_fields` through the same requireStringArrayOrNull the two scalar
 * frames use (whose docstring names this ticket; there is deliberately no second narrower and no variant
 * of it), applied PER ROW: a literal `null` is the value "nothing was cut for this row", an omitted key is
 * an absence that fails closed, and the lists are never hoisted or flattened across rows. Deliberately NO
 * closed-set validation of `task_type` (`local_bash` is one observation and one observation does not earn
 * an enum) nor of the `truncated_fields` element names (`task_id` / `task_type` / `description` here — a
 * THIRD distinct set from #564's and #565's, which is the concrete proof the vocabulary moves per frame
 * and a client-side allowlist would fail-close a valid future frame). No per-field length check either:
 * the daemon bounds each string at construction and the frame-level MAX_PLAINTEXT_BYTES guard in
 * parseInboundMessage covers the oversized case.
 *
 * Returns a fresh four-field literal, so unknown server-added keys — pointedly including the scalar
 * frames' `tool_call_id` / `patch`, which this row must never have — are tolerated (forward-compat) but
 * NOT copied through, which also makes it prototype-pollution-safe. That matters more here than on a
 * scalar frame, because the attacker controls the NUMBER of records offered to this narrower, not just
 * their content. Its message names the failure CATEGORY only — never a value and never the row INDEX:
 * `description` is a literal command line, the ids are correlating identifiers, and an index would be a
 * weak oracle over roster contents that buys nothing.
 */
function parseBackgroundTask(payload: unknown): BackgroundTask {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed background task')
  }
  const task_id = requireString(payload, 'task_id')
  const task_type = requireString(payload, 'task_type')
  const description = requireString(payload, 'description')
  const truncated_fields = requireStringArrayOrNull(payload, 'truncated_fields')
  return { task_id, task_type, description, truncated_fields }
}

/**
 * Narrow an opaque payload into a BackgroundTaskRosterPayload (#566). The AGGREGATE peer of the two
 * narrowers above: they decode what happened to one task, this decodes what is alive. `conversation_id` a
 * required string, `tasks` the parseQueueStatePayload inline shape (an Array.isArray check, then
 * `raw.map(parseBackgroundTask)`), `dropped_tasks` a plain requireNumber.
 *
 * THE TRAP, and it is invisible in the code below: within THIS ONE FRAME, `tasks: null` FAILS CLOSED while
 * a ROW's `truncated_fields: null` is a VALID VALUE returned as `null`. Same shape, opposite contracts.
 * `Array.isArray(null)` is `false`, which is precisely what fails `tasks: null` closed, and an omitted key
 * (`undefined`) fails the same way. The daemon settles the asymmetry explicitly:
 * BackgroundTaskRosterPayload carries interactive.go's ONLY custom MarshalJSON (`:274`), whose whole job is
 * normalising a nil `Tasks` to `[]` so an empty roster never serialises as `null` — and whose comment
 * states that `truncated_fields` is deliberately NOT normalised the same way, because nil and `[]` say the
 * identical thing there while `tasks` is the frame's subject and its empty value is the signal. Reaching
 * for requireStringArrayOrNull here would be the reflex from #564 / #565 and it is wrong.
 *
 * An EMPTY `tasks` array is VALID and decodes to `[]` (`[].map()` → `[]`) — the positive "nothing is alive"
 * statement, not an error and not an absence. Order is preserved from the wire (claude's own order). One
 * bad row throws the whole frame closed rather than yielding a partial roster (the parseQueueStatePayload /
 * parseConversationsPayload precedent).
 *
 * `dropped_tasks` decodes through plain requireNumber, which is correct PRECISELY BECAUSE the Go field has
 * no `omitempty`: the key is always written, so `0` is a genuine wire value carried as `0` — never
 * truthiness-tested — while an absent key is a real defect that fails closed. There is NO range check and
 * no cross-check against `tasks.length`: a client-invented bound would silently drop valid future frames
 * (the requireNumber house posture since #116), and the roster's true size is `tasks.length +
 * dropped_tasks` rather than something to reconcile. Note there is deliberately no top-level
 * `truncated_fields` on this frame — `dropped_tasks` is its only truncation report.
 *
 * No per-row or per-roster count check: the daemon bounds the entry count at construction
 * (`maxTaskRosterEntries`) and the frame-level MAX_PLAINTEXT_BYTES guard already fails an oversized frame
 * closed before this runs — the same reliance queue_state and both scalar siblings have. Returns a fresh
 * three-field literal; unknown server-added keys are tolerated but not copied through. Its messages name
 * the failure category only — a `conversation_id` correlates a conversation and a row's `description` is a
 * literal command line.
 */
function parseBackgroundTaskRosterPayload(payload: unknown): BackgroundTaskRosterPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed background_task_roster payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const raw = payload.tasks
  if (!Array.isArray(raw)) {
    throw new WireDecodeError('malformed tasks list')
  }
  const tasks = raw.map(parseBackgroundTask)
  const dropped_tasks = requireNumber(payload, 'dropped_tasks')
  return { conversation_id, tasks, dropped_tasks }
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
 * `raw` gets NO length check. The daemon truncates at construction to 16 KiB — that is why `truncated`
 * exists — and parseInboundMessage's frame-level MAX_PLAINTEXT_BYTES guard (65519) backstops the
 * oversized case with roughly four times headroom over the daemon's cap. A third bound here would be a
 * defence against a failure that cannot reach this line.
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
 * Narrow an opaque payload into a ModelAnnouncedPayload (#587). Fail-closed like its neighbours, over
 * three fields — and the closest model is parseUnrecognizedMessagePayload directly above, which already
 * narrows a `conversation_id`, a bounded untrusted string and a `truncated` bool with exactly these
 * `require*` calls. Any missing / mistyped field throws WireDecodeError, never a partial value.
 *
 * `model` gets NO LENGTH CHECK, NO CHARSET CHECK, NO ALLOW-LIST and NO NORMALISATION. The producer caps
 * it at 256 at construction (that is what `truncated` reports) and parseInboundMessage's frame-level
 * MAX_PLAINTEXT_BYTES guard (65519) backstops the oversized case with roughly 250× headroom, so a third
 * bound here would defend a failure that cannot reach this line. A client-invented rule would be worse
 * than redundant: claude echoes an identifier at least as specific as the one it was given, so the value
 * is not reliably dated and need not appear in any published list — anything narrower would silently
 * drop VALID future identifiers, the drift risk CLAUDE.md / ADR 0002 rank above cosmetic robustness. A
 * lookup miss is #588's ORDINARY case, not this decoder's problem.
 *
 * requireString admits `''`. The daemon SUPPRESSES the event on an empty model at the producer, so `''`
 * will not arrive off a conforming daemon — and there is deliberately no second suppression branch
 * there, nor one here. Do not add a guard.
 *
 * `truncated` goes through requireBoolean, whose check is on the TYPE: a literal `false` passes (a
 * VALUE — nothing was cut), while an absent field, `0`, `'false'` or `null` all fail the payload closed.
 * It is a REQUIRED wire field, never an optional one, and never defaults to "not cut" — a defaulting
 * reader would present claude's cut identifier as a complete one.
 *
 * Returns a fresh three-field literal, so unknown server-added keys (e.g. a spurious `turn_id`) are
 * tolerated (forward-compat) but NOT copied through — which also makes it prototype-pollution-safe. Its
 * messages name the failure CATEGORY only: never `model` (untrusted, model-influenced) and never the
 * conversation-correlating id.
 */
function parseModelAnnouncedPayload(payload: unknown): ModelAnnouncedPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed model_announced payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const model = requireString(payload, 'model')
  const truncated = requireBoolean(payload, 'truncated')
  return { conversation_id, model, truncated }
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
 *
 * `input` (#642) is the first OPTIONAL field this file narrows off a payload, and the first daemon-KEYED
 * map anywhere in it — both handled by optionalStringMap: an omitted key decodes as `undefined`
 * (a pre-pyrycode#1678 daemon), `{}` as a
 * distinct empty map, and anything else malformed throws the whole frame. The key is set on the
 * returned literal unconditionally — `undefined` when the wire omitted it, which `toEqual` treats as
 * absent and which JSON.stringify drops at the IPC boundary. The consumer contract is
 * `payload.input === undefined`, never `'input' in payload`.
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
  const input = optionalStringMap(payload, 'input')
  return { conversation_id, turn_id, tool_use_id, name, input_summary, input }
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
 * `debug_bundle_done` / `error` → `daemon-error`, #116), an `assistant_delta` → `assistant-delta` and
 * a `turn_end` → `turn-end` (#199), a `conversations` → `conversations` (#139),
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
    case 'session_settings': {
      // Narrow BEFORE logging so a malformed reply throws first and leaves no record. No decoded
      // field is ever logged — not the session id, not the model / effort / yolo, not the usage
      // ints — only the frame's byte length + one-way hash, reusing the existing content-free field
      // set. Mirrors the assistant_delta arm below.
      const sessionSettings = parseSessionSettingsPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'session_settings',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'session-settings', sessionSettings, inReplyTo: envelope.in_reply_to }
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
    case 'model_announced': {
      // Narrow BEFORE logging so a malformed frame (an absent / non-string `model`, a non-boolean
      // `truncated`) throws first and leaves no record. NOTHING decoded is logged — not the
      // conversation_id, not the cut flag, and least of all `model` itself, which is claude-authored
      // text that crossed the subprocess trust boundary. Only the frame's byte length + one-way hash,
      // reusing the existing content-free field set (no new DiagnosticEvent field, so #131's renderer
      // pin is untouched).
      const modelAnnounced = parseModelAnnouncedPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'model_announced',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'model-announced', modelAnnounced }
    }
    case 'background_task_started': {
      // Narrow BEFORE logging so a malformed frame (an omitted `truncated_fields` key, a non-string
      // element in it, an absent id) throws first and leaves no record. NOTHING decoded is logged —
      // not `task_type`, which looks harmless, and least of all `description`, which for
      // `task_type: local_bash` is the literal command line claude ran. Only the frame's byte length +
      // one-way hash, reusing the existing content-free field set (no new DiagnosticEvent field, so
      // #131's renderer pin is untouched).
      const backgroundTaskStarted = parseBackgroundTaskStartedPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'background_task_started',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'background-task-started', backgroundTaskStarted }
    }
    case 'background_task_updated': {
      // Narrow BEFORE logging so a malformed frame (an omitted `patch` or `truncated_fields` key, a
      // non-string element in the latter, an absent id) throws first and leaves no record. NOTHING
      // decoded is logged — least of all `patch`, whose keys may carry command text exactly as the
      // sibling's `description` does. Only the frame's byte length + one-way hash, reusing the existing
      // content-free field set (no new DiagnosticEvent field, so #131's renderer pin is untouched).
      const backgroundTaskUpdated = parseBackgroundTaskUpdatedPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'background_task_updated',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'background-task-updated', backgroundTaskUpdated }
    }
    case 'background_task_roster': {
      // Narrow BEFORE logging so a malformed frame (a `tasks: null`, an omitted `dropped_tasks`, one bad
      // row) throws first and leaves no record. NOTHING decoded is logged — least of all a row's
      // `description`, which is a literal command line, and DELIBERATELY NOT the roster SIZE either:
      // DiagnosticEvent already carries a `count` field, so emitting it would cost nothing structurally
      // and it is omitted on purpose, because how much work claude has running right now is itself a
      // fact about the user's session (the queue_state / conversation_created posture). Only the frame's
      // byte length + one-way hash, reusing the existing content-free field set (no new DiagnosticEvent
      // field, so #131's renderer pin is untouched).
      const backgroundTaskRoster = parseBackgroundTaskRosterPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'background_task_roster',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'background-task-roster', backgroundTaskRoster }
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
      // Narrow BEFORE logging so a malformed frame (a missing / non-string field, or a malformed
      // `input` map) throws first and leaves no record. No decoded field (name / input_summary /
      // tool_use_id / turn_id / conversation_id / input) is logged — only the frame's byte length +
      // one-way hash, reusing the existing content-free field set. Of `input` (#642) NEITHER ITS KEYS
      // NOR ITS VALUES enter the log: a daemon-chosen field name is itself model-authored text, since
      // an MCP tool can name a field anything. `name` / `input_summary` / `input` are carried onward by
      // the consumer (the render payload, #218 / #645), but they never enter the diagnostic log.
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
