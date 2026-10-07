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
import { MAX_SYSTEM_PROMPT_BYTES } from '../../shared/wire/types'
import {
  ATTACHMENT_FILENAME_MAX_BYTES,
  MAX_PLAINTEXT_BYTES,
  agentFromWire
} from '../../shared/wire/types'
import type {
  Envelope,
  ReplySuggestionPayload,
  WireAgent,
  BannerPayload,
  MessagePayload,
  MessageChunkPayload,
  AssistantDeltaPayload,
  TurnEndPayload,
  TurnStatePayload,
  StallPayload,
  ApiRetryPayload,
  CompactingPayload,
  ResettingPayload,
  AttachmentOfferedPayload,
  CompactionBoundaryPayload,
  BackgroundTaskStartedPayload,
  BackgroundTaskUpdatedPayload,
  BackgroundTaskProgressPayload,
  BackgroundTask,
  BackgroundTaskRosterPayload,
  ModelAnnouncedPayload,
  SessionFactsPayload,
  ThinkingProgressPayload,
  RateLimitedPayload,
  ContextUsageCategory,
  ContextUsageMCPTool,
  ContextUsageMemoryFile,
  ContextUsagePayload,
  MCPServerStatus,
  MCPStatusPayload,
  UnrecognizedMessagePayload,
  SessionTransitionPayload,
  SessionSettingsPayload,
  SessionCapabilitiesPayload,
  MemorySearchPayload,
  MemorySearchAvailability,
  SessionPromptStatus,
  SystemPromptPayload,
  HostSystemPromptPayload,
  SessionSettingsUpdatedPayload,
  HistoryEntry,
  HistoryPagePayload,
  ToolUsePayload,
  ToolProgressPayload,
  ToolResultPayload,
  ToolDeniedPayload,
  ModelRefusalFallbackPayload,
  ModelRefusalNoFallbackPayload,
  QueuedItem,
  QueueStatePayload,
  ConversationSummary,
  ConversationCreatedPayload,
  ConversationUpdatedPayload,
  ConversationDeletedPayload,
  RecentWorkspace,
  WorkspaceFolderCreatedPayload,
  WorkspaceUpdatedPayload,
  ModalShownPayload,
  ModalDismissedPayload,
  WireModalOption,
  QuestionShownPayload,
  QuestionDismissedPayload,
  WireQuestion,
  WireQuestionOption,
  SlashCommandListPayload,
  WireSlashCommand,
  ModelListPayload,
  WireModelOption,
  AttachmentStoredPayload,
  AttachmentChunkPayload,
  WireTurnState,
  WireSessionTransitionReason,
  WireUnrecognizedSite
} from '../../shared/wire/types'
import type { TurnEndMetrics } from '../../shared/ipc/events'
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
 * WHICH WAY a daemon `error` frame failed, as a CLIENT-OWNED value (#965). Every inhabitant is a
 * literal written in this file, so the type itself is the trust signal: a value of this type provably
 * holds no daemon text. That is the whole point — `ErrorPayload.code` is untrusted text from an
 * internet-exposed boundary, and CLAUDE.md forbids it becoming a lookup path, a filename or a cache
 * key, so it is compared against these constants and dropped, never carried.
 *
 * THE CLASSIFIED MEMBERS SPAN BOTH ATTACHMENT LEGS, listed upload-first then retrieval, in the same
 * order the narrower's `switch` cases appear so the two lists diff against each other by eye. The
 * retrieval pair was absent until #999 because that leg did not exist upstream; it does now
 * (`pyrycode#2053` streams it, `#2054` emits both codes), so the omission's reason has expired. No count
 * is given here on purpose — one went stale the moment this pair landed, and a fresh numeral would only
 * queue up the next staleness. The members below are the list.
 *
 * `attachment.not_found` ANSWERS TWO VERBS, not retrieval alone (`pyrycode#2036`): a `request_attachment`
 * whose id resolves to no file inside the named conversation's directory, and a `send_message` whose
 * `attachment_ids` names an id that does not resolve under that message's own conversation. One code
 * rather than two, because the predicate, the retryability, the static message and the client's repair
 * are identical. THE MERGE IS DELIBERATE AND MUST NOT BE UNDONE HERE: upstream makes the code
 * indistinguishable across an unknown id, an id whose canonical shape is invalid, and an id resolving
 * outside the directory — a disclosure decision, not an imprecision, since two codes would turn the
 * asking verb into a path-existence oracle for a traversal probe. The daemon's message is static, never
 * echoes the requested id or the resolved path, and where a request names several ids never says WHICH
 * one failed. There are no sub-cases on the wire, so there are no branches to model for them.
 *
 * RETRYABILITY IS DOCUMENTED HERE, NOT COMPUTED HERE, and no isRetryable helper ships with it. The
 * daemon never sends `retry_after_s` on either leg (`attachmentReplyError` marshals a closed
 * `{Code, Message, Retryable}` literal and the field is `*int,omitempty`), so a client cannot learn a
 * backoff duration from the wire and "after a backoff" is a CLIENT-OWNED POLICY. Policy belongs to the
 * consumer that acts on it (#861), not to a decode boundary whose job is to say which failure this was.
 * Each member's flag is read off the daemon's own reject table rather than inferred from the code name
 * — `internal/relay/v2session_attachment.go` for the upload leg, `v2session_attachment_request.go` for
 * the retrieval one. The flags are stated per member rather than gathered into a tuple here: they now
 * live in two upstream files, so no single list could be right, and a member is where a reader looks.
 */
export type DaemonErrorOutcome =
  /** Framing claims are inconsistent — duplicate index, index out of range, `total_chunks` disagreeing
   *  across chunks. NOT retryable: the receiver discards the whole in-flight stream, so the repair is to
   *  re-chunk. */
  | 'attachment-invalid-chunk'
  /** Assembled bytes or length disagree with the declared `sha256` / `size`. NOT retryable: the repair
   *  is to re-derive the metadata from the file, never to retry the same bytes against the same claims. */
  | 'attachment-integrity-failed'
  /** The WHOLE transfer exceeds the receiver's per-upload byte bound — permanent for that file, and the
   *  bound is receiver-configured and unpublished, so a client learns it only by being rejected. NOT
   *  retryable. Distinct from `message-too-long`, which is one oversized envelope. */
  | 'attachment-too-large'
  /** The receiver's concurrency bound is hit. Retryable after a backoff, but it clears only when OTHER
   *  uploads finish — nothing this client does to this transfer advances it. */
  | 'attachment-too-many-uploads'
  /** The host write failed. Retryable after a backoff, though the condition may not clear at all. The
   *  daemon's message for it is static — never a path, never the filesystem error — but that is the
   *  daemon's promise about its own behaviour, not a property this client relies on: no message crosses. */
  | 'attachment-storage-failed'
  /** ONE envelope was oversized — a producer bug on THIS side, not a verdict on the transfer's size, and
   *  raised by the transport rather than the attachment path. NOT retryable: resending the same envelope
   *  reproduces it. */
  | 'message-too-long'
  /** An attachment id did not resolve to a file inside the named conversation's directory — the first
   *  RETRIEVAL-leg member, and the one that also answers a `send_message` naming an unresolvable id (see
   *  the header). NOT retryable (`rejectAttachmentNotFound`'s flag is `false`): the repair is to re-list
   *  the conversation's attachments, never to re-ask for the same id, which reproduces it. Deliberately
   *  covers every way a request yields no bytes, with no sub-case to branch on. */
  | 'attachment-not-found'
  /** The daemon abandoned a retrieval MID-STREAM. Retryable AFTER A BACKOFF (`rejectStreamAborted`'s
   *  flag is `true`), never immediately — a re-request re-runs the same resolution work. It carries an
   *  obligation no other member has: on receiving it a client MUST DISCARD everything accumulated for
   *  that transfer and MUST NOT present the partial bytes as the file. The retrieval leg has no
   *  completion frame, so this is the stream's ONLY negative signal, and a client that keeps its buffer
   *  renders a truncated file as a whole one. Enforcing that belongs to the reassembling consumer
   *  (#995); this boundary can only say which failure occurred. */
  | 'attachment-stream-aborted'
  /** Everything else, and it covers two causes on purpose: a code outside the classified set above
   *  (including a future one this client predates), and a payload that carried no readable `code` at
   *  all — absent, non-object, or `code` missing / not a string. Both mean the same thing to a consumer,
   *  "this client declined to classify the failure", and neither is a reason to drop a terminal frame. */
  | 'unclassified'

/**
 * How the daemon refused one `request_history` (#1222), as CLIENT-OWNED values — the closed set from
 * the daemon's § Conversation history (v2) → Rejects, mapped off its untrusted `code` string here.
 *
 * IT IS A SECOND TYPE BESIDE DaemonErrorOutcome RATHER THAN FIVE MEMBERS ADDED TO IT, and that is a
 * decision worth reading before "unifying" the two. DaemonErrorOutcome is not a free-standing
 * vocabulary: `AttachmentTransferFailure` (attachmentTransfer.ts) inherits it WHOLE,
 * `AttachmentUploadFailure` (shared/ipc/attachmentUpload.ts) mirrors that mechanically across IPC, and
 * a renderer copy table is keyed on the mirror. So a `history-invalid-cursor` added there would land in
 * the attachment-upload failure union and demand composer copy for a failure no upload can produce.
 * The two unions describe different verbs and stay separate; what they SHARE is every property below.
 *
 * The `switch` IS the trust boundary, exactly as narrowDaemonErrorOutcome's is: it COMPARES the
 * untrusted string against client-owned constants and RETURNS a client-owned constant, so the daemon's
 * string is never the operand of an index, a join or a resolve, and nothing is retained from the
 * payload. A `Record`-keyed table is the shape to avoid for that reason — it would make untrusted text
 * a lookup path, the thing CLAUDE.md forbids.
 *
 * RETRYABILITY IS NOT ON THIS TYPE. `history.unavailable` is the group's one retryable member — a
 * corrupt segment, an I/O failure, or a log that is wired but not open, none of them a fault in the
 * request — and the flag is computed once at the single emit in daemonConnection rather than here, so
 * the walk driver (#1224) cannot re-derive it wrong into a retry loop. This differs from
 * DaemonErrorOutcome's documented-not-computed posture on purpose: those flags live in two upstream
 * files, where these are one verb's, published in one section.
 *
 * THE SET IS NOT EXHAUSTIVE OVER WHAT A REQUEST_HISTORY CAN DRAW, which is why the narrower below
 * returns `undefined` rather than an `unclassified` member. § Page size publishes a real case: when one
 * stored entry cannot fit in any page the daemon emits it anyway and its own transport answers
 * `message.too_long`, which narrows to a DaemonErrorOutcome and not to any member here.
 */
export type HistoryRejectReason =
  /** The `conversation_id` is not of canonical shape, or names no conversation in the daemon's
   *  registry. NOT retryable. One condition, one gate — the registry holds canonical ids only, so a
   *  malformed id fails membership. Deliberately DISTINGUISHABLE from the cursor's answer below, unlike
   *  `attachment.not_found`'s merge, because there is no second id here to build a path-existence
   *  oracle over. Also the permanent answer for a conversation the daemon no longer hosts: deleting one
   *  and the idle sweep both drop it from the registry while its log stays on disk. */
  | 'conversation-not-found'
  /** The payload did not decode. NOT retryable. A DECODE FAILURE IS A REJECTED FRAME, NEVER AN
   *  EMPTY-BUT-SUCCESSFUL REQUEST: every key is optional to Go's decoder, so a truncated or hostile
   *  payload would otherwise decode to an empty conversation id, which names nothing and must never be
   *  joined into a path where an empty component resolves to the log root. The daemon's message is
   *  static and echoes nothing from the payload; nothing crosses from it here either. */
  | 'history-invalid-request'
  /** The `limit` was NEGATIVE. NOT retryable. `0` is not a reject — it asks the daemon to choose — and
   *  an ask ABOVE the ceiling is not one either; it is clamped. `buildRequestHistory` normalises an
   *  absent or non-positive ask to `0`, so a conforming send of this client's cannot draw this. */
  | 'history-invalid-page-size'
  /** The `cursor` did not decode, was minted for another conversation, or names a position no longer in
   *  the log. NOT retryable. ONE MERGED ANSWER for all three, and the merge is a disclosure decision
   *  rather than an imprecision: the distinctions are exactly what a probe would want, so a client that
   *  cannot tell them apart cannot leak them. The refusal never echoes the cursor back, and nothing
   *  here undoes that. */
  | 'history-invalid-cursor'
  /** The daemon could not read the log — a corrupt segment, an I/O failure, or a log that is wired but
   *  not open. THE GROUP'S ONE RETRYABLE MEMBER, and the only one that is not a fault in the request:
   *  it can clear without the client changing anything. Nothing retries it here; see the type header. */
  | 'history-unavailable'

/**
 * Which of `set_system_prompt`'s two published refusals a correlated `error` frame carries (#1249) —
 * the client-owned form of the daemon's `code`, narrowed at this boundary so no daemon string crosses
 * IPC.
 *
 * `HistoryRejectReason`'s twin, sharing its placement argument and its `undefined`-outside-the-set
 * return. It is a THIRD union rather than members bolted onto either neighbour for the reason the
 * first split states: `DaemonErrorOutcome` answers "what class of failure is this" over EVERY frame,
 * and these two answer "is this ONE VERB's refusal, and which". `conversation.not_found` appearing in
 * both this union and `HistoryRejectReason` is that separation working as designed, not duplication to
 * fold: the same wire code means "no such conversation to read a page from" there and "no such
 * conversation to write a prompt to" here, and a consumer of one has no business narrowing the other.
 *
 * BOTH MEMBERS ARE NON-RETRYABLE, and neither carries a byte of what was supplied. The daemon's
 * message for each is static, and nothing crosses from it: this narrower reads `code` and drops it.
 *
 * THE SET IS NOT EXHAUSTIVE OVER WHAT A `set_system_prompt` CAN DRAW — the narrower returns
 * `undefined` outside it, and the single consumer maps that to a terminal, so a correlated refusal
 * always settles the write rather than leaving it reported as in flight.
 */
export type SystemPromptRejectReason =
  /** The payload would not decode, or `system_prompt` exceeded the daemon's own 8192-byte cap. NOT
   *  retryable. One code, two conditions, and the merge is the daemon's: both are faults in the
   *  request, and its message for either echoes nothing supplied. This client bounds the value before
   *  the send precisely so the over-length half is not normally reached — see MAX_SYSTEM_PROMPT_BYTES
   *  — and the two verdicts stay DISTINCT on the IPC side (`prompt-too-long` vs `protocol-malformed`),
   *  because a refusal this client made itself is not one the daemon issued. */
  | 'protocol-malformed'
  /** The `conversation_id` matched no conversation in the daemon's registry. NOT retryable, and
   *  nothing is stored. Also the permanent answer for a conversation the daemon no longer hosts. */
  | 'conversation-not-found'

/**
 * Which `mcp_status_request` refusal a correlated `error` frame carries (#1578), the client-owned form of
 * the daemon's `code`. `SystemPromptRejectReason`'s twin with ONE member: `mcp_status.unavailable` is the
 * only refusal the window treats differently. `protocol.malformed` and `conversation.not_found` are both
 * a bug on this side and fall to the absence, which the single consumer maps to `'unclassified'`.
 */
export type MCPStatusRejectReason = 'mcp-status-unavailable'

/**
 * One decoded `attachment_chunk` frame from the RETRIEVAL leg (#998) — the client-owned form of
 * AttachmentChunkPayload, differing in exactly one field: `data` is raw bytes here, base64 on the wire.
 *
 * IT IS DECLARED IN THIS FILE RATHER THAN IN wire/types.ts, and that placement is a decision. That
 * module mirrors the daemon field-for-field (CLAUDE.md § Wire protocol); a `Uint8Array` where the daemon
 * has a base64 string is a DECODE PRODUCT, not a wire type, and putting it there would drift the mirror.
 * DaemonErrorOutcome above — the other client-owned type derived from a wire payload — is exported from
 * here for the same reason, and `bundle-chunk` declares its own `data: Uint8Array` inline on the union
 * member. This one earns a name rather than an inline literal only because it carries eight fields.
 *
 * The `Omit` REUSES the seven metadata fields instead of restating them, so their doc comments, their
 * byte ceilings and any later daemon-side correction reach this type automatically. Restating them here
 * would create a second place to keep in agreement with the wire contract.
 *
 * DECODING MAKES THE SHAPE TRUSTED AND NEVER THE CONTENT, and the type system carries no signal for that
 * — a `string` is a `string`. `filename`, `mime_type` and `sha256` are attacker-shaped text and `data` is
 * attacker-chosen bytes even though they now sit in a settled-looking type. Deriving `mime_type`
 * host-side improved these fields' PROVENANCE — genuinely daemon-authored rather than client strings
 * echoed back — and not their TRUST: a sniffed `text/html` is exactly as dangerous to render as a
 * declared one. Every client obligation stands: sanitise `filename` before rendering it, never resolve
 * it into a path or a filesystem name, and never dispatch on `mime_type` in a way that grants the
 * content privileges.
 */
export interface RetrievedAttachmentChunk extends Omit<AttachmentChunkPayload, 'data' | 'conversation_id'> {
  // NO `conversation_id`, deliberately, after #1205 made it required on the UPLOAD frame. On retrieval the
  // daemon emits the field EMPTY and a receiver ignores it (pyrycode #2142): a retrieval chunk is
  // correlated by `in_reply_to` to a request that already named the conversation, so there is nothing
  // to read here and the decoder keeps returning a fresh eight-key literal, dropping the empty key.
  /** This chunk's RAW bytes, base64-decoded at the untrusted boundary so the reassembler (#995) stays
   *  byte-pure — parseDebugBundleChunkPayload's posture. Content-bearing: a user's own private file
   *  bytes, never logged, and never written to a path derived from `filename`. */
  data: Uint8Array
}

/**
 * The daemon envelope timestamp, mixed into live timeline-bearing results. The message arm also
 * carries it for receipt display. It is per-frame, independent of server origin. History page
 * envelope times are not entry times, so the page arm intentionally carries no FrameTimestamp.
 *
 * SECURITY: `decodeEnvelope` validates string shape. Timeline joins use a bounded comparand; user
 * receipts parse a bounded value into finite epoch milliseconds. Never use it as a path, filename,
 * URL, React key or log field. Diagnostics carry only static codes, byte lengths and payload hashes.
 */
interface FrameTimestamp {
  ts: string
}

/**
 * Which modeled app-message the envelope carried. NOT a wire type and NOT a DaemonEvent — the
 * transport layer stays IPC-free. An internal transport result the consumer (#62) maps onto the
 * daemon-event channel.
 *
 * The three debug-bundle kinds (#116) are recognised additively: the `message` / `message_chunk`
 * path is unchanged, and `daemon-error`'s content-free rule is now SCOPED rather than absolute (#965)
 * — narrowed for the codes named in DaemonErrorOutcome, still closed for everything else.
 * ErrorPayload's `code` is read as a COMPARAND: matched against
 * client-owned literals and dropped. No daemon text is narrowed or surfaced; what crosses in its place
 * is a client-owned `outcome`, which is REQUIRED on the kind so there is no absent state to mishandle.
 * Only a boolean wire `retryable` is carried for switch refusals; `message` and `retry_after_s`
 * are discarded. It DOES also carry the
 * optional numeric `inReplyTo` — the `Envelope.in_reply_to` routing id already surfaced by
 * decodeEnvelope (#269), propagated (not re-decoded, no ErrorPayload re-parsed for it) so the consumer
 * can correlate the error back to a pending `set_session_settings` request and surface a rejection;
 * `undefined` when the frame omits it (correlation fails closed). Still surfaces NO daemon-supplied
 * error content.
 *
 * The two interactive-stream kinds (#199) carry the decoded AssistantDeltaPayload / TurnEndPayload.
 * Unlike `snapshot`, the assistant delta `text` IS the render payload — the consumer carries it onward,
 * and `conversation_id` with it, by name as `conversationId` (#751 for the delta, #752 for the turn end);
 * the fail-closed decode here is the boundary this slice defends. The "turn-stream item, or daemon state?"
 * test that governs the status kinds below answers differently on these two and the id crosses anyway: a
 * delta and the boundary that closes it ARE turn-stream items, and they carry the id not to report
 * per-conversation state but because a slice of assistant text has to be filed in the right thread, and a
 * consumer cannot route what it cannot attribute (#675). Both parsers require `conversation_id`, so each
 * emit reads it BARE — a missing or non-string one drops the whole line rather than closing the wrong
 * thread's turn.
 *
 * The `turn-state` kind (#214) carries the decoded TurnStatePayload — the coarse lifecycle scalar that
 * drives the timeline `phase` (#202). The consumer carries `state` onward, and `conversation_id` with it,
 * by name as `conversationId` (#724), because per-conversation phase is daemon state rather than a
 * turn-stream item: the sidebar must say a chat is thinking while the operator looks at a different one
 * (#674). That id is a daemon-asserted ROUTING KEY and not rendered text — never markup, an attribute, a
 * URL, a filename, a cache key or a lookup path, and none of the untrusted-display-text warnings this
 * block attaches elsewhere attach to it. The fail-closed `state` enum check here is the boundary this
 * slice defends, and the required `conversation_id` string beside it fails the whole line rather than
 * emitting a phase attributed to nothing.
 *
 * The `stall` kind (#315) carries the decoded StallPayload — the onset-only liveness signal the daemon
 * fans out to interactive clients when a turn goes quiet. The consumer carries the payload's only field,
 * `conversation_id`, onward by name as `conversationId` (#732) — per-conversation liveness is daemon
 * state, so the sidebar can show a chat has gone quiet while the operator looks at a different one
 * (#674). The fail-closed required `conversation_id` string here is the boundary this slice defends: a
 * missing or non-string id fails the whole line rather than emitting a stall attributed to nothing.
 * Ships dormant — the render slice (#317) is the first consumer.
 *
 * The `api-retry` kind (#492) carries the decoded ApiRetryPayload — the PTY-derived status peer of
 * `stall` the daemon fans out to interactive clients while claude retries against an API error. The render
 * slice #493 shows "attempt N/M", so the consumer carries the edge (`active`) and the counter (`current` /
 * `total`) onward — and `conversation_id` with them, by name as `conversationId` (#737), because
 * per-conversation retry is daemon state: the sidebar must show a chat is stuck retrying while the
 * operator looks at a different one (#674). The fail-closed defence here is four required fields
 * — one string, one BOOLEAN (whose `false` is the falling edge, a value not an absence) and two NUMBERS
 * (whose `0` is the legitimate "count unknown" value, so nothing may consult truthiness). NOT onset-only
 * and NOT deduped: N frames narrow to N values. Ships dormant — the render slice (#493) is the first
 * consumer.
 *
 * The `compacting` kind carries status plus optional outcome strings. A separate
 * `compaction-boundary` kind supplies delayed trigger/count metadata. Required fields fail closed;
 * unusable counts degrade to absence, and diagnostics never include any decoded values.
 *
 * The `resetting` kind (#1514) carries the decoded ResettingPayload — which phase of a session reset a
 * conversation is in. A two-edge status peer of the two kinds above, conversation-scoped (no
 * `turn_id`, and it opens and closes no turn), but the provenance runs the other way: those report
 * what CLAUDE is doing, this reports what the DAEMON is doing to claude. The fail-closed defence is
 * one required string, one required BOOLEAN (whose `false` is the falling edge — a value, never an
 * absence) and TWO NARROWED TOKENS, each checked against its closed set by comparand chain.
 *
 * BOTH TOKENS ARE NARROWED, and here that is the OPPOSITE call from `rate-limited` below for the
 * opposite reason: nothing on this frame is claude's, so there is no unmeasured open set to preserve.
 * `''` IS A FOURTH ACCEPTED VALUE ON EACH, admitted UNCONDITIONALLY — it is the daemon's declared zero
 * value once the reset is over, so a set of only the named tokens would reject every falling edge and
 * leave the window with an indicator nothing can clear. Gating it on `active` would be cross-field
 * validation, which this family refuses, so `active: true` with `phase: ''` decodes too.
 *
 * NARROWED IS NOT TRUSTED. A closed union invites a consumer to `switch (phase)` and read the result
 * as settled fact; it is a claim by a peer, which can send any of the sixteen combinations, so a
 * consumer handles all of them and branches no security-relevant behaviour on either token. The frame
 * is a REPORT, never a control input, and `handoff: 'written'` names no path — there is nothing to
 * open or resolve.
 *
 * IT TAKES NO FrameTimestamp, and the neighbouring `compacting` arm — which DOES mix it in — is the
 * wrong half of the family to copy here. That mix-in marks exactly the arms decodeHistoryEvent draws;
 * `resetting` is ephemeral status with no replay ring and no durable history upstream, so it gains no
 * arm there, and stamping a `ts` would advertise a join nothing can perform.
 *
 * NOTHING DECODED REACHES THE LOG, and the reason is NOT `rate-limited`'s: both tokens are daemon
 * constants rather than claude-authored text. It is that the pair beside `conversation_id` discloses
 * which conversation the operator reset and whether a handoff was written — a fact about the
 * operator's workflow, in a log they may send off-box. Ships dormant — daemonConnection's inbound
 * switch has no catch-all, so the report stops here until #1515 claims it.
 *
 * The `model-announced` kind (#587) carries the decoded ModelAnnouncedPayload — claude's own report of
 * the model it resolved for the turn, off its `system` / `init` line, fanned out to interactive clients.
 * Neither a claude sub-state like its `stall` / `api-retry` / `compacting` neighbours nor a daemon
 * mapping gap like `unrecognized-message`: an IDENTITY report, carrying no `turn_id` and opening and
 * closing no turn. The consumer carries `model` and `truncated` onward, and `conversation_id` with it, by name
 * as `conversationId` (#714), because per-conversation attribution is what lets #588 / #674 say WHICH chat
 * announced WHICH model. The fail-closed defence is two required strings plus one required BOOLEAN whose
 * `false` is a VALUE (nothing was cut), not an absence — `truncated` is never optional and never defaults.
 *
 * `model` is held VERBATIM: no normalising, no lowercasing, no allow-list, no family regex, and NO
 * LENGTH CHECK is duplicated here (the daemon caps it at 256 at construction — that is what `truncated`
 * reports — and MAX_PLAINTEXT_BYTES, 65519, backstops the frame with ~250× headroom). A client-invented
 * rule would drop identifiers claude legitimately announces, since the value need not be dated and need
 * not appear in any published list. Ships dormant — the announced-model store (#588) is the first
 * consumer.
 *
 * The `thinking-progress` kind (#1312) carries the decoded ThinkingProgressPayload — claude's only
 * mid-turn proof of life on the stream-json surface, the daemon's translation of its
 * `system/thinking_tokens` line. A READING, not a state transition: unlike its `api_retry` /
 * `compacting` neighbours it has no rising and no falling edge at all, carries no `turn_id`, and opens
 * and closes no turn. The fail-closed defence is one required string plus TWO required NUMBERS, whose
 * `0` is a legitimate value rather than an absence — neither Go field carries `omitempty`, so the
 * daemon's zero value is legal traffic and nothing may consult truthiness.
 *
 * DELIBERATELY NOT RANGE-CHECKED, and on this frame that is sharper than the house rule it follows.
 * There is no precedent in this file for range-validating a wire integer, and a client-invented bound
 * silently drops valid future frames; but a monotonicity or non-negativity rule here would be actively
 * wrong rather than merely unprecedented, because `estimated_tokens` restarts near zero at every
 * inference-request boundary — four times inside the daemon's committed single-turn capture. See
 * ThinkingProgressPayload for that hazard and its two siblings (the frames are rate-bounded and do not
 * enumerate claude's lines; the deltas received do not sum to the turn's total).
 *
 * IT TAKES NO FrameTimestamp, and the omission is the design rather than an oversight. That mix-in
 * marks exactly the arms `decodeHistoryEvent` draws, which need (`type`, `ts`) as the join key between a
 * served page and what the live stream already drew. This type gains no arm there — a stored one is
 * still skipped — so there is no page half for a `ts` to join against, and stamping it would advertise a
 * join nothing can perform. `model-announced` above is the precedent.
 *
 * NOTHING DECODED REACHES THE LOG, including the two integers: a reading of how much claude thought is a
 * side-channel on private work, as unwelcome in a log an operator may send off-box as the correlating
 * `conversation_id` beside it. Ships dormant — daemonConnection's inbound switch has no catch-all, so the
 * reading stops here until the carry slice claims it. A consumer that later renders it must not allocate
 * or iterate proportionally to either number, which are unbounded daemon-supplied values.
 *
 * The `rate-limited` kind (#1318) carries the decoded RateLimitedPayload — the daemon's report that
 * claude's usage-limit window is in a state other than the one measured-benign one. Conversation-scoped
 * like the kind above: no `turn_id`, and it opens and closes no turn, because a usage-limit window is
 * orthogonal to whichever turn observed it. The fail-closed defence is THREE required strings, one
 * required NUMBER whose `0` is a value ("claude did not report a reset instant", never the epoch), and
 * one REQUIRED-PRESENT NULLABLE ARRAY (`truncated_fields`: a literal `null` is the value "nothing was
 * cut", a missing key is an absence and fails closed).
 *
 * NEITHER `status` NOR `limit_type` IS NARROWED TO A CLOSED SET, and here that is a SECURITY decision
 * as much as the usual no-drift one. The house rule applies — a client-invented set fail-closes a valid
 * future frame — but the sharper reason is the daemon's: the value set beyond the one measured-benign
 * status is UNMEASURED (no capture of a limit actually in force exists), so a closed set drops the first
 * real limit that fires, and narrowing is the first step of branching on a value the daemon says a
 * client MUST NOT branch security-relevant behaviour on. The empty string decodes for each: that is the
 * producer's cut-to-nothing case, reported by `truncated_fields`, not an absence.
 *
 * `resets_at` IS DELIBERATELY NOT RANGE-CHECKED either. It is claude's number, unvalidated upstream in
 * both directions, so negative, zero and absurd magnitudes are all ordinary traffic here; rejecting one
 * would be a validation rule with no captured negative case behind it. A consumer must not assume it
 * lies in the future — and must never SCHEDULE from it, since a delay derived from it fires immediately
 * both when negative and when past setTimeout's ~24.8-day clamp. See RateLimitedPayload.
 *
 * IT TAKES NO FrameTimestamp, for the kind above's reason: that mix-in marks exactly the arms
 * `decodeHistoryEvent` draws, this type gains no arm there, and stamping it would advertise a join
 * nothing can perform.
 *
 * NOTHING DECODED REACHES THE LOG. `status` and `limit_type` are claude-authored text that crossed the
 * subprocess trust boundary — untrusted and unsanitized, so logging them would put model-influenced
 * strings into a file whose readers assume it is machine-written — and the pair together discloses the
 * account's quota posture. Untrusted DISPLAY text, decoded and never interpreted: a later consumer
 * renders them as inert text and feeds neither to an HTML sink, an attribute, a URL, a Map key or a
 * lookup path. Ships dormant — daemonConnection's inbound switch has no catch-all, so the report stops
 * here until the carry slice claims it.
 *
 * The `context-usage` kind (#1454) carries the decoded ContextUsagePayload — claude's own report of what
 * is in the context window, published after every turn end on the interactive path. THE READING AND ALL
 * THREE OF ITS INVENTORIES: #1455 decodes `categories` / `dropped_categories`, #1459 `mcp_tools` /
 * `dropped_mcp_tools` and #1460 `memory_files` / `dropped_memory_files`, after which every key the
 * daemon writes is read. Conversation-scoped like the two kinds above — no `turn_id`, and it
 * opens and closes no turn. The fail-closed defence is two required strings and three required NUMBERS,
 * each through the type-not-truthiness helpers, so `''` and `0` survive as the values the daemon's empty
 * fixture states them to be rather than being read as absences — and, per inventory, a list-shape
 * guard plus a per-row narrowing where ONE BAD ROW DROPS THE WHOLE FRAME rather than yielding a partial
 * inventory.
 *
 * NO INVENTORY IS EVER NULL and an empty list is the POSITIVE STATEMENT that claude reported no
 * categories, no MCP tools, or no memory files; the rows are a PREFIX in the producer's descending-token
 * order, so a short list is never a list with holes. EACH DROPPED COUNT IS INDEPENDENT AND NOT INFERABLE
 * — two cuts' worth of loss apiece, so a retained list's length says nothing about completeness, nothing
 * here reconciles a count with a length, and the three counts are never read against each other either.
 *
 * PROVENANCE IS MIXED WITHIN THE ONE PAYLOAD, which is what separates this kind from every neighbour
 * here: `conversation_id` is daemon-authored, `model` and every row's `name` are claude-authored and
 * unsanitized, and every `server_name` is workspace configuration. A consumer assuming one provenance
 * for the whole value is wrong half the time, in the
 * direction that promotes those strings to checked values. A row's `name` is a LABEL, never a selector,
 * and if a consumer indexes rows by it the index is a `Map`, never a plain object. **AND
 * `server_name` IS INERT DESPITE ITS NAME** — it collides with the actuation-crossing `ServerName` on
 * the daemon's MCP reconnect payload, so it must never be fed to an MCP verb, a reconnect or a server
 * lookup, nor joined against `mcp_status`, on the strength of having appeared in this reading.
 * **AND A MEMORY FILE'S `path` IS NOT A FILE HANDLE** — it is WORKSPACE-AUTHORED path-shaped descriptive
 * text that nothing joins, cleans, resolves or opens, so a consumer must not `path.join` it against a
 * root, render it as an `href`, hand it to `shell.openExternal`, or key a plain object by it; the
 * daemon's committed fixture carries `../../../etc/passwd` and this decoder passes it through verbatim
 * on purpose. The `type` beside it is claude's LABEL and NOT A DISCRIMINANT, however much the spelling
 * invites a `switch` in a file where every other `type` narrows an envelope. **This is the docblock the
 * IPC carry reads**: #1419 is where `path` first crosses `contextBridge` into the renderer and #1421 is
 * where the render sink lives, so both inherit these prohibitions rather than re-deciding them. See
 * ContextUsagePayload, ContextUsageCategory, ContextUsageMCPTool and ContextUsageMemoryFile, which name
 * the split field by field.
 *
 * THE THREE INTEGERS ARE NOT RANGE-CHECKED and are NOT mutually consistent by contract. The daemon
 * neither recomputes nor normalizes claude's figures, so a consumer must not derive `percentage` from
 * the token pair, must guard its own arithmetic (a `max_tokens` of `0` yields `Infinity` — the renderer's
 * `contextUsagePercent` documents what that does to a gauge), and must never allocate, iterate or size
 * anything proportional to any of them.
 *
 * IT TAKES NO FrameTimestamp, for the two kinds above's reason: that mix-in marks exactly the arms
 * `decodeHistoryEvent` draws, this type gains no arm there, and stamping it would advertise a join
 * nothing can perform.
 *
 * NOTHING DECODED REACHES THE LOG. `model` is claude-authored text that crossed the subprocess trust
 * boundary — untrusted and unsanitized, so logging it would put model-influenced strings into a file
 * whose readers assume it is machine-written — and the three integers disclose how much private work is
 * in the window, as unwelcome in a log an operator may send off-box as the correlating `conversation_id`
 * beside them. Untrusted DISPLAY text, decoded and never interpreted: a later consumer renders `model` as
 * inert text and feeds it to no HTML sink, attribute, URL, Map key, icon lookup or path. Ships dormant —
 * daemonConnection's inbound switch has no catch-all, so the reading stops here until #1419 claims it.
 *
 * The `mcp-status` kind (#1489) carries the decoded MCPStatusPayload — claude's MCP server list for one
 * conversation, published live and as the answer to `mcp_status_request`. Conversation-scoped like the
 * kinds above, and like them it takes NO FrameTimestamp, because this type gains no `decodeHistoryEvent`
 * arm. The fail-closed defence is one required string, a list-shape guard and one required number, plus
 * a per-row narrowing of FIVE plain `requireString`s where ONE BAD ROW DROPS THE WHOLE FRAME rather than
 * yielding a partial list. `servers: []` is a POSITIVE report of no servers and `dropped_servers` is
 * copied, never reconciled with the list's length. `status` and `scope` are open-set CLAIMS and `version`
 * is opaque, so none is narrowed against a client vocabulary. A row's `name` is the server's identity in
 * the list, which a later slice may carry into an MCP actuation verb the daemon gates, but on this side it
 * is never a lookup key, a React key, a Map index, a path, a filename or a cache key. The strings cross
 * byte-for-byte: escaping is owed at the render sink. NOTHING DECODED REACHES THE LOG — every row string
 * is claude-authored and may carry a newline that would forge a record in the line-delimited stream, and
 * `conversation_id` is a correlating identifier. See MCPStatusPayload and MCPServerStatus. Ships dormant
 * until #1490 claims it.
 *
 * The `background-task-started` kind (#564) carries the decoded BackgroundTaskStartedPayload — the daemon's
 * announcement that claude started work OUTLIVING the turn that spawned it (pyrycode#1240), fanned out to
 * interactive clients. Unlike its `stall` / `api-retry` / `compacting` neighbours it is not a claude
 * sub-state at all: it carries no `turn_id` and opens and closes no turn. It is daemon STATE keyed by id,
 * and THAT is why ALL SIX fields cross, `conversation_id` INCLUDED (the queue-state rule, #720;
 * the task store #567 attributes by id). The fail-closed defence is five required strings plus one
 * REQUIRED-PRESENT NULLABLE ARRAY (`truncated_fields`: a literal `null` is the value "nothing was cut", a
 * missing key is an absence and fails closed). `task_type` and the `truncated_fields` elements are
 * deliberately NOT narrowed to closed sets — both are open on the wire. `description` is, for
 * `task_type: local_bash`, the literal command line claude ran: untrusted display text, decoded and never
 * interpreted, never logged. Ships dormant — the task store (#567) is the first consumer.
 *
 * The `background-task-updated` kind (#565) carries the decoded BackgroundTaskUpdatedPayload — the PEER of
 * the kind above, joined on `task_id`: that frame opens a task, this one reports what CHANGED about it
 * afterwards. A DIFFERENT six fields (no `tool_call_id` / `description` / `task_type`; it gains `patch`,
 * `status` and `summary`). Same non-turn character, so the consumer likewise carries ALL SIX fields
 * onward, `conversation_id` INCLUDED. The fail-closed defence is three required strings, two strings that
 * read an omitted key as `''` (`status` / `summary`, #1560 — a pre-2026-09-10 daemon sends neither) but
 * reject a present non-string, plus the same REQUIRED-PRESENT NULLABLE ARRAY. A non-empty `status` is the
 * family's only finish signal; it is an open string, never narrowed. Neither the `truncated_fields`
 * elements (`task_id` / `patch` / `status` / `summary` here — a DIFFERENT set from the sibling's, which is
 * why the vocabulary is never narrowed) nor `patch` itself is validated further:
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
 * consumer carries `site`, `message_type`, `raw` and `truncated` plus `conversation_id` onward (#784).
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
 * FIVE of the six decoded fields onward: `newSessionId`, `reason`, `occurredAt` and `workspaceCwd`, the
 * four the delimiter slice #286 reads (#285), plus `conversation_id` by name as `conversationId` (#1192),
 * the marker's own routing key naming WHOSE session rotated. Only `previous_session_id` is dropped at the
 * emit — it has no consumer. The fail-closed `reason` closed-enum check plus the nullable `workspace_cwd`
 * here are the boundary this slice defends. `workspace_cwd` is opaque workspace display text (like `cwd`
 * #139), carried onward as `string | null` with the null PRESERVED rather than coerced to `''`; the
 * routing key beside it is daemon-asserted and not rendered text, so that display-text warning attaches
 * to the cwd and not to it.
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
 * a durable `toolCall` timeline item (#202 / #121). The consumer carries the five render fields plus
 * `conversation_id` onward (#763). The fail-closed required-string presence here (five strings, no enum) is
 * the boundary this slice defends. `name` / `input_summary` are opaque display text (like `stop_reason`).
 *
 * The `tool-result` kind (#229) carries the decoded ToolResultPayload — the outcome half that RESOLVES an
 * existing `toolCall` in place (correlated by `tool_use_id`, #121's `fillResult`), NOT a new row. The
 * consumer carries the four render fields plus `conversation_id` onward (#766); the fail-closed defence is
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
 * slice defends; `title` / `prompt` / `options[].label` are untrusted display text carried onward.
 * A `modal_shown` also carries a `conversation_id` (pyrycode#1065, decoded by #870), and the consumer
 * carries it onward by name as `conversationId` (#871) — a permission prompt is daemon state that must be
 * filed against the conversation which raised it, since the operator may be looking at a different one
 * (#674). It is a daemon-asserted OUTBOUND SCOPING key, not rendered text and not a correlation key:
 * answering still goes by `modalId` alone. A `modal_dismissed` carries no `conversation_id` at all and
 * none is invented for it. BOTH renderer bridges no-op these arms; the real consumer is the modal store +
 * bridge (#223).
 *
 * The `slash-command-list` kind (#936) carries the decoded SlashCommandListPayload — the verbs the
 * workspace will accept for one conversation, where `model_list` inventories the identities claude will
 * run as. A conversation-scoped SNAPSHOT that REPLACES a reader's view of the menu, never a delta; it
 * rides a `control_response`, so it opens and closes no turn. The fail-closed decode here (a required
 * `conversation_id`, a never-null `commands` array narrowed per row, a carried-not-recomputed
 * `dropped_commands`) is the boundary this slice defends, and it is the ONLY sanctioned route to the
 * type — a bare cast would hand a `.map` a non-array and would silently invert the cut-aliases reading
 * rule. All four strings on a row are UNTRUSTED WORKSPACE-AUTHORED text carried verbatim, owed escaping
 * at the render sink; nothing consumes this arm yet (the IPC carry is #937, the Actions-menu match #681,
 * and daemonConnection's inbound switch has no catch-all, so the menu stops here until claimed).
 *
 * The `model-list` kind (#972) carries the decoded ModelListPayload — the IDENTITIES claude will run as
 * for one conversation, where its sibling `slash-command-list` inventories the VERBS. Drawn from the same
 * `initialize` control reply, so like that one it rides a `control_response`, opens and closes no turn,
 * and is a SNAPSHOT that REPLACES a reader's view of the menu rather than a delta. The fail-closed decode
 * here (a required `conversation_id`, a never-null `models` array narrowed per row, a
 * carried-not-recomputed `dropped_models`) is the boundary this slice defends, and it is the ONLY
 * sanctioned route to the type — a bare cast would hand a `.map` a non-array and would silently invert
 * the cut-`effort_levels` reading rule.
 *
 * ONE FRAME STATES THREE DIFFERENT POSITIONS ON EMPTY, and a reader who assumes one gets two wrong: an
 * empty `models` is a POSITIVE STATEMENT that claude offered nothing, an empty `effort_levels` is a
 * COLLAPSE of claude's absent / null / empty into one value, and `truncated_fields` is exempt from
 * normalisation entirely so its `null` is preserved. Every string on a row — and every `effort_levels`
 * element — is UNTRUSTED CLAUDE-AUTHORED text that crossed the subprocess trust boundary, a HIGHER trust
 * tier than `slash-command-list`'s workspace-authored strings but untrusted all the same, carried
 * verbatim and owed escaping at the render sink. Nothing consumes this arm yet (the IPC carry, the store
 * and the run-configuration rows are the slices below this one, and daemonConnection's inbound switch has
 * no catch-all), so the menu stops here until claimed.
 *
 * The `attachment-stored` kind (#964) carries the decoded AttachmentStoredPayload — the upload leg's ONE
 * POSITIVE TERMINAL, and the frame that lets a finished transfer resolve instead of spinning forever.
 * The fail-closed decode here (a single required NON-EMPTY string) is the boundary this slice defends.
 *
 * **IT DELIBERATELY CARRIES NO `inReplyTo`, and that absence is the design.** Three kinds above DO carry
 * one — `daemon-error`, `session-settings`, `session-settings-updated` — because for those the envelope
 * id IS the correlation. Here it is not: `Envelope.in_reply_to` names the chunk WHOSE ARRIVAL COMPLETED
 * THE TRANSFER, not the highest index, and since chunks are index-addressed and may be reassembled in any
 * order, a client cannot predict which of its envelope ids that will be. Surfacing it would hand the
 * consumer a plausible-looking match key that SILENTLY NEVER FIRES. Omitting it makes "match on the
 * payload's attachment_id" structural rather than advisory — the only correlation handle a consumer can
 * reach is the one that works. A consumer that later needs the envelope id must argue for it on its own
 * ticket. Nothing consumes this arm yet: the send driver is #861, and daemonConnection's inbound switch
 * has no catch-all, so it stops here until claimed.
 *
 * The `attachment-chunk` kind (#998) carries one decoded slice of the RETRIEVAL leg's byte stream — the
 * answer to the `request_attachment` #993 builds. It sits directly beneath `attachment-stored` and the
 * two SAY OPPOSITE THINGS ABOUT THE SAME ENVELOPE FIELD, so read both before changing either.
 *
 * **ITS `inReplyTo` IS REQUIRED, where the three kinds above type theirs OPTIONAL.** Those frames can
 * legitimately arrive unsolicited; a retrieval chunk cannot. `Envelope.in_reply_to` here names the
 * `request_attachment` THE CLIENT ITSELF SENT — the only handle the answer carries — where on
 * `attachment-stored` the same field names whichever chunk closed the set, which no client can predict.
 * So the argument for omitting it there is the argument for requiring it here, and neither is precedent
 * for the other. Upstream sets it on every frame the retrieval stream builds and its own reader drops a
 * chunk whose value is nil or mismatched; the daemon's committed `attachment_chunk_retrieval.json` rides
 * `in_reply_to: 91` against `request_attachment.json`'s `id: 91`. Requiring it makes a chunk without one
 * MALFORMED rather than an uncorrelated variant, which keeps a can't-happen branch out of #995.
 *
 * CHUNKS ARE INDEX-ADDRESSED AND MAY ARRIVE IN ANY ORDER — `debug_bundle_chunk`'s strict ascending `seq`
 * is the neighbouring rule and the wrong one here. Recognition claims one frame at a time and enforces
 * no ordering; it only refuses an `index` outside `[0, total_chunks)`. And THERE IS NO COMPLETION FRAME
 * and none is coming: `total_chunks` rides every chunk, so a receiver knows the expected count from the
 * first frame it sees. Nothing analogous to `debug_bundle_done` exists on this leg — do not invent one.
 *
 * FOUR OBLIGATIONS LAND ON #995 RATHER THAN HERE, each because this boundary cannot discharge it:
 *
 *   - NEVER ALLOCATE FROM A CLAIM. `total_chunks` and `size` are unbounded daemon-supplied numbers and
 *     this arm allocates from neither (its one allocation is the base64 decode, already bounded by
 *     MAX_PLAINTEXT_BYTES above). `new Array(total_chunks)` from a claimed 2**53 is an instant OOM. The
 *     bound to use is a DAEMON-PUBLISHED INVARIANT rather than an invented ceiling —
 *     `total_chunks == max(1, ceil(size / 45000))`, the admission check ATTACHMENT_CHUNK_DATA_BYTES's
 *     docblock records — because a client-invented ceiling here would fail-close a large valid transfer.
 *   - VERIFY `sha256` AT ASSEMBLY, never per chunk: the digest is over the WHOLE file and this arm sees
 *     one slice. Carrying it through is what makes that possible. It is INTEGRITY and not authenticity
 *     (the same party supplies the bytes and the digest), and comparing it needs no constant-time
 *     primitive since neither side is a secret.
 *   - MATCH ON A REQUEST THIS CLIENT MINTED. A required `inReplyTo` makes a chunk CORRELATABLE, not
 *     AUTHENTIC: a hostile daemon inside the session can answer a request never sent, or aim chunks at a
 *     different pending one. Note the contrast with #861's rule — `inReplyTo` is a NUMBER, so a
 *     plain-object lookup keyed on it is prototype-safe by construction, where `attachment_stored`'s
 *     string `attachment_id` needs a `Map` to dodge `__proto__`. The `attachment_id` this frame also
 *     carries is still a string and still needs one.
 *   - TREAT `filename` AS A DISPLAY STRING ONLY. It arrives unsanitised on purpose (see
 *     RetrievedAttachmentChunk): sanitising at the decode would hide the untrusted-ness behind a value
 *     that looks cleaned, and would drift wire/types.ts from the daemon's mirror.
 *
 * Nothing consumes this arm yet: the reassembler is #995, and daemonConnection's inbound switch has no
 * catch-all, so the stream stops here until claimed.
 */
export type InboundDaemonMessage =
  | { kind: 'reply-suggestion'; replySuggestion: ReplySuggestionPayload }
  | { kind: 'host-system-prompt'; hostSystemPrompt: HostSystemPromptPayload; inReplyTo: number | undefined }
  | { kind: 'banner'; banner: BannerPayload }
  | ({ kind: 'message'; message: MessagePayload } & FrameTimestamp)
  | { kind: 'chunk'; messages: MessagePayload[] }
  | { kind: 'bundle-chunk'; seq: number; data: Uint8Array }
  | { kind: 'bundle-done'; total: number }
  | {
      kind: 'daemon-error'
      inReplyTo?: number
      retryable?: boolean
      outcome: DaemonErrorOutcome
      pairingReject?: 'pairing-rejected'
      // The app-too-old rejection (#1613): set only for the exact `client.update_required` code. The
      // minimum rides along only when narrowUpdateRequired accepted it as a digits-only
      // MAJOR.MINOR.PATCH; any other value is dropped here and never logged.
      updateRequired?: { minClientVersion?: string }
      // The history verb's refusal (#1222), narrowed off the SAME untrusted `code` string `outcome` is
      // and by the same comparand idiom — see HistoryRejectReason for why it is a second field rather
      // than five members added to that union.
      //
      // OPTIONAL, where `outcome` is deliberately required, and the divergence is the point. That one
      // is required so no consumer has a field-missing state to mishandle across four correlations;
      // here absence has exactly ONE meaning — "this code is outside the published history set" — read
      // at exactly ONE emit, which maps it to the `'unclassified'` member of the IPC-side failure. That
      // member is not a hedge: a `message.too_long` correlated to a `request_history` is a published
      // case (§ Page size), and a walk that dropped it would stall with no terminal.
      historyReject?: HistoryRejectReason
      // The system-prompt WRITE verb's refusal (#1249), narrowed off the SAME untrusted `code` string
      // the two fields above are and by the same comparand idiom — see SystemPromptRejectReason for
      // why it is a third field rather than two members added to either union.
      //
      // OPTIONAL for `historyReject`'s reason exactly: absence has ONE meaning — "this code is outside
      // the published set for this verb" — read at ONE emit, which maps it to the `'unclassified'`
      // member of the IPC-side failure so that a correlated refusal always settles the write.
      //
      systemPromptReject?: SystemPromptRejectReason
      // The MCP status ask's refusal (#1578), a fourth per-verb field on `systemPromptReject`'s terms:
      // absence means "outside this verb's narrowed set" and the one emit maps it to `'unclassified'`.
      //
      // FOUR PER-VERB NARROWED FIELDS IS PAST THE CEILING THIS SHAPE WAS GIVEN. The next correlated verb
      // should collapse them into one narrowed field carrying a verb tag rather than add a fifth.
      mcpStatusReject?: MCPStatusRejectReason
    }
  // The ten arms carrying FrameTimestamp start here (#1225) — see that type for why the mix-in is
  // named at each site rather than distributed over the union.
  | ({ kind: 'assistant-delta'; delta: AssistantDeltaPayload } & FrameTimestamp)
  | ({ kind: 'turn-end'; turnEnd: TurnEndPayload } & FrameTimestamp)
  | ({ kind: 'turn-state'; turnState: TurnStatePayload } & FrameTimestamp)
  | { kind: 'session-error'; sessionError: { conversation_id: string; code: string } }
  | ({ kind: 'stall'; stall: StallPayload } & FrameTimestamp)
  | ({ kind: 'api-retry'; apiRetry: ApiRetryPayload } & FrameTimestamp)
  | ({ kind: 'compacting'; compacting: CompactingPayload } & FrameTimestamp)
  | { kind: 'resetting'; resetting: ResettingPayload }
  | { kind: 'attachment-offered'; attachmentOffered: AttachmentOfferedPayload }
  | { kind: 'compaction-boundary'; boundary: CompactionBoundaryPayload }
  | { kind: 'session-facts'; sessionFacts: SessionFactsPayload }
  | { kind: 'model-announced'; modelAnnounced: ModelAnnouncedPayload }
  | { kind: 'thinking-progress'; thinkingProgress: ThinkingProgressPayload }
  | { kind: 'tool-progress'; toolProgress: ToolProgressPayload }
  | { kind: 'rate-limited'; rateLimited: RateLimitedPayload }
  | { kind: 'context-usage'; contextUsage: ContextUsagePayload }
  | { kind: 'mcp-status'; mcpStatus: MCPStatusPayload }
  | ({ kind: 'background-task-started'; backgroundTaskStarted: BackgroundTaskStartedPayload } & FrameTimestamp)
  | ({ kind: 'background-task-updated'; backgroundTaskUpdated: BackgroundTaskUpdatedPayload } & FrameTimestamp)
  | { kind: 'background-task-roster'; backgroundTaskRoster: BackgroundTaskRosterPayload }
  | { kind: 'background-task-progress'; backgroundTaskProgress: BackgroundTaskProgressPayload }
  | ({ kind: 'unrecognized-message'; unrecognized: UnrecognizedMessagePayload } & FrameTimestamp)
  | ({ kind: 'session-transition'; sessionTransition: SessionTransitionPayload } & FrameTimestamp)
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
  | ({ kind: 'tool-use'; toolUse: ToolUsePayload } & FrameTimestamp)
  | ({ kind: 'tool-result'; toolResult: ToolResultPayload } & FrameTimestamp)
  | ({ kind: 'tool-denied'; toolDenied: ToolDeniedPayload } & FrameTimestamp)
  | ({ kind: 'model-refusal-fallback'; refusal: ModelRefusalFallbackPayload } & FrameTimestamp)
  | ({ kind: 'model-refusal-no-fallback'; refusal: ModelRefusalNoFallbackPayload } & FrameTimestamp)
  | { kind: 'queue-state'; queueState: QueueStatePayload }
  | { kind: 'conversations'; conversations: ConversationSummary[] }
  | { kind: 'conversation-created'; conversationCreated: ConversationCreatedPayload }
  | {
      kind: 'conversation-updated'
      conversationUpdated: ConversationUpdatedPayload
      // OPTIONAL, like `session-settings`' and `history-page`'s (#1249). Absence is the ORDINARY case
      // here, not a degraded one, which is why this member carried no handle at all until a consumer
      // needed one: the daemon also pushes this record genuinely unsolicited, with no `in_reply_to`,
      // when a host-side `pyry channel new` mints a conversation (pyrycode#2156). So a record without
      // a handle is merely uncorrelatable, never malformed, and the fail-closed drop belongs one layer
      // up rather than here as a decode failure.
      //
      // IT IS NOT THE ONLY HANDLE, and that is what makes this member unlike its two neighbours. The
      // record names its own `id`, so a consumer COULD attribute by it — and must not, on the write
      // path: a daemon answering write A with a record naming conversation B would misattribute the
      // outcome. `set_system_prompt`'s confirmation (#1249) is resolved by matching this against the
      // envelope id the write was sent under, and the conversation it names comes from the requester's
      // own record of what it asked.
      inReplyTo?: number
    }
  | { kind: 'conversation-deleted'; conversationDeleted: ConversationDeletedPayload }
  | { kind: 'recent-workspaces'; recentWorkspaces: RecentWorkspace[] }
  | { kind: 'workspace-folder-created'; workspaceFolderCreated: WorkspaceFolderCreatedPayload }
  // The `workspace-updated` kind (#1288) carries the decoded two-field WorkspaceUpdatedPayload — the
  // daemon's report that a WORKSPACE's label changed, where its `workspace-folder-created` neighbour
  // reports that a workspace DIRECTORY was made. Correlated by `in_reply_to` to whoever asked for the
  // rename and pushed UNSOLICITED to every other interactive client, so both shapes are real traffic.
  //
  // Optional correlation settles an identified rename; every update still refreshes the list.
  | { kind: 'workspace-updated'; workspaceUpdated: WorkspaceUpdatedPayload; inReplyTo?: number }
  | { kind: 'modal-shown'; modalShown: ModalShownPayload }
  | { kind: 'modal-dismissed'; modalDismissed: ModalDismissedPayload }
  | { kind: 'question-shown'; questionShown: QuestionShownPayload }
  | { kind: 'question-dismissed'; questionDismissed: QuestionDismissedPayload }
  | { kind: 'slash-command-list'; slashCommandList: SlashCommandListPayload }
  | { kind: 'model-list'; modelList: ModelListPayload }
  | { kind: 'attachment-stored'; attachmentStored: AttachmentStoredPayload }
  | {
      kind: 'history-page'
      // ALREADY-DECODED since #1227: `entries` holds typed timeline events, not the wire's
      // `{ type, payload }` pairs. `parseHistoryPagePayload` still narrows the wire shape one step
      // earlier and still fails the WHOLE page closed on a malformed entry envelope; what this field
      // carries is what survived the second, per-entry payload-decode stage.
      historyPage: DecodedHistoryPage
      // OPTIONAL, like `session-settings`' and unlike `attachment-chunk`'s required one — and for the
      // opposite reason to that neighbour's. A retrieval chunk cannot legitimately arrive unsolicited,
      // so one without a correlation handle is MALFORMED; a page without one is merely uncorrelatable,
      // and the fail-closed drop one layer up is the behaviour wanted rather than a decode failure.
      //
      // IT IS THE ONLY HANDLE THERE IS. The page carries no `conversation_id` — a decision, not an
      // omission — so which conversation it describes is knowable only from which envelope it answers.
      // The consumer keeps its outstanding asks keyed by envelope id and this is what it matches on.
      inReplyTo?: number
    }
  | {
      kind: 'system-prompt'
      systemPrompt: SystemPromptPayload
      // OPTIONAL, like `session-settings`' and `history-page`'s, and for the same reason as the
      // latter: a reply without a correlation handle is merely UNCORRELATABLE, not malformed, so the
      // fail-closed drop belongs one layer up rather than here as a decode failure.
      //
      // IT IS THE ONLY HANDLE THERE IS, and here that is a security property rather than an
      // inconvenience. The reply carries no `conversation_id` — the omission is what makes an unhosted
      // conversation's answer byte-identical to a hosted-but-quiet one, so the verb cannot be used as
      // a membership probe. The consumer keeps its outstanding asks keyed by envelope id and this is
      // what it matches on.
      inReplyTo?: number
    }
  | {
      kind: 'attachment-chunk'
      attachmentChunk: RetrievedAttachmentChunk
      // REQUIRED, not optional — see the type's docblock above. It names the request_attachment this
      // stream answers, the one handle a consumer can correlate on.
      inReplyTo: number
    }

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
 * Narrow one required string field that must ALSO be non-empty, or fail closed with a category-only
 * message. A SIBLING of requireString (#964), never a replacement for it, and the distinction is the
 * whole reason this exists as its own function rather than a tightened `requireString`.
 *
 * requireString polices TYPE and accepts `''`, which is correct at every one of its call sites and
 * LOAD-BEARING at some: an empty `argument_hint` is ordinary data on 33 of the 51 measured
 * slash-command rows, and `question_dismissed` decodes an all-empty payload because an empty string
 * there is a VALUE, not an absence. Tightening requireString in place would fail-close valid traffic
 * on both.
 *
 * This helper is for the opposite case — a field where the empty string is a DISTINCT FAILURE MODE —
 * and the reason is upstream's rather than a style preference. Every key is optional to Go's
 * `encoding/json`, so a truncated or hostile payload decodes daemon-side to the ZERO VALUE and arrives
 * here with the field present, typed, and empty. Through requireString that yields a SUCCESS NAMING
 * NOTHING: an `attachment_stored` whose `attachment_id` is `''` matches no transfer a client ever
 * started, so a consumer resolves nothing while the decode reports success. Fail it closed instead.
 *
 * DO NOT swap this in elsewhere "for consistency" — each field's emptiness rule is its own, and the two
 * arms named above read alike and say the opposite thing.
 */
function requireNonEmptyString(payload: Record<string, unknown>, field: string): string {
  const value = requireString(payload, field)
  if (value.length === 0) {
    throw new WireDecodeError(`empty required field: ${field}`)
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
 *  it describes are untrusted.
 *
 *  Since #936 the array half of that check is requireStringArray below, and this is the `null` gate in
 *  front of it: identical messages, identical fresh-array result. The split exists because
 *  `slash_command_list`'s `aliases` needs the array check WITHOUT the null admission — see that helper
 *  for why admitting one there would be wrong. */
function requireStringArrayOrNull(
  payload: Record<string, unknown>,
  field: string
): string[] | null {
  return payload[field] === null ? null : requireStringArray(payload, field)
}

/** Narrow one required, NON-nullable string-ARRAY field off the payload — a `string[]`, and nothing else
 *  — or fail closed with a category-only message. requireStringArrayOrNull minus the one thing its name
 *  promises, split out for `slash_command_list`'s `aliases` (#936), which is the first field on this wire
 *  that is an array of bare strings AND never `null`.
 *
 *  The two live one field apart on the SAME row and carry OPPOSITE contracts: a `WireSlashCommand`'s
 *  `truncated_fields` may be a literal `null` (nothing was cut) while its `aliases` may not — the daemon
 *  normalises a nil alias slice to `[]` and deliberately does not do the same for the cut list. Reaching
 *  for the nullable helper on `aliases` is the reflex to resist: it would quietly admit a `null` the wire
 *  never sends, and WireSlashCommand would then be lying about the type of its own field.
 *
 *  An EMPTY array is VALID. For `aliases` it is not an absence but a COLLAPSE — claude never emits an
 *  empty alias list, so an absent-aliases row and an empty-aliases row arrive as the identical `[]`, and
 *  the row's own `truncated_fields` naming `aliases` is the only thing that separates "cut to nothing"
 *  from "none". That reading rule is only sound because an OMITTED `truncated_fields` fails closed here
 *  rather than decoding to `undefined`, which `?.includes(...)` would read as falsy exactly the way it
 *  reads a `null`.
 *
 *  Same posture as the nullable sibling otherwise: one bad element throws the WHOLE payload closed, the
 *  result is a FRESH array (so array-borne extra properties cannot ride along), no closed-set validation
 *  of the element values, and the message names the client-owned `field` constant only — an element is
 *  untrusted workspace-authored text. */
function requireStringArray(payload: Record<string, unknown>, field: string): string[] {
  const value = payload[field]
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

/** Narrow one required OBJECT field off the payload — `isRecord`'s structural minimum applied to a
 *  named field — or fail closed with a category-only message. The sibling of requireString /
 *  requireNumber / requireBoolean for a `history_page` entry's `payload` (#1222), the first field on
 *  this wire that is an object whose SHAPE this client deliberately does not know.
 *
 *  It exists because no other helper fits. `optionalStringMap` is the near miss and is wrong twice
 *  over: it requires every value to be a string, where an entry payload is arbitrary nested JSON, and
 *  it is an optional-field parse, where this key is always on the wire and an absent one is malformed.
 *
 *  THE RESULT IS THE SAME OBJECT, NOT A FRESH ONE, which is the deliberate divergence from every other
 *  narrower in this file. A fresh container is cheap for a flat map and unbounded for arbitrary nesting
 *  — a recursive copy would be attacker-driven work on a hostile frame — so this validates the shape
 *  and carries the value. Nothing is stripped, `RESERVED_MAP_KEYS` included: a `__proto__` key off
 *  JSON.parse is an ordinary own data property, inert to read, to spread and to structuredClone, and
 *  the reachable hazard is `Object.assign(target, payload)` or a `target[k] = v` copy loop in a LATER
 *  consumer, which HistoryEntry's docblock forbids at the field. Do not swap this in where the daemon
 *  chooses the keys of a map this client then indexes — that is optionalStringMap's case, and its
 *  reserved-key drop is not a style the two share. */
function requireRecord(
  payload: Record<string, unknown>,
  field: string
): Record<string, unknown> {
  const value = payload[field]
  if (!isRecord(value)) {
    throw new WireDecodeError(`missing required field: ${field}`)
  }
  return value
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

/** Narrow one OPTIONAL scalar string field off the payload, or fail closed with a category-only
 *  message. optionalStringMap's posture with the map walk removed, for `tool_result.result_detail`
 *  (#773, daemon-side pyrycode#2024):
 *
 *    undefined (key absent)       → undefined      a pre-pyrycode#2024 daemon; the one case that does not throw
 *    ''                           → ''             an EMPTY value, never collapsed into undefined
 *    any other string             → that string    verbatim, never trimmed or parsed
 *    null / number / object / array → throws       a post-pyrycode#2024 daemon never writes any of these
 *
 *  Optional to the CLIENT, not on the wire — the same distinction optionalStringMap draws: the Go field
 *  has no `omitempty`, so absence means an older daemon and requiring it would fail-close every frame
 *  from a build predating the daemon change.
 *
 *  The empty string is the case worth stating twice. Absence and `''` MEAN the same thing upstream (no
 *  count), yet they are kept distinct here, because collapsing them is a lossy transform that buys
 *  nothing and no stage of a carry should invent a meaning the row (#856) owns. A `value || undefined`
 *  or a truthiness check would do exactly that collapse — the check is on the TYPE, the requireBoolean
 *  #180 discipline.
 *
 *  Deliberately NO length cap and NO alphabet check, even though the upstream declaration says this
 *  field's producer only ever formats decoded integers. That describes an honest producer, not a wire
 *  guarantee — but the bound that makes a cap here redundant is the same one every other narrower in
 *  this file cites: parseInboundMessage's frame-level MAX_PLAINTEXT_BYTES guard (65519), applied to the
 *  plaintext BEFORE decodeEnvelope and so before any narrower runs (decodeEnvelope itself size-checks
 *  nothing, which is why that guard is where it is). `maxPayload` on the relay socket in
 *  relayConnection is the outer socket-level bound behind it, not the nearer one. A client-invented
 *  per-field rule would only fail-close a valid future frame (the parseQueuedItem no-cross-validate
 *  posture, ADR 0002).
 *
 *  Shares optionalStringMap's message category rather than `missing required field:`, which for an
 *  optional field is actively misleading since an absent key is the one case that does NOT throw. It
 *  names the client-owned `field` constant only — the value is untrusted daemon-supplied text. */
function optionalString(payload: Record<string, unknown>, field: string): string | undefined {
  const value = payload[field]
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'string') {
    throw new WireDecodeError(`malformed optional field: ${field}`)
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
  const queued_msg_id = payload.queued_msg_id
  if (queued_msg_id !== undefined &&
      (typeof queued_msg_id !== 'number' || !Number.isSafeInteger(queued_msg_id) || queued_msg_id < 1)) {
    throw new WireDecodeError('invalid message queue identity')
  }
  const sent_now = payload.sent_now
  if (sent_now !== undefined && typeof sent_now !== 'boolean') {
    throw new WireDecodeError('invalid message delivery mode')
  }
  return { conversation_id, message_id, role, text,
    ...(queued_msg_id === undefined ? {} : { queued_msg_id }),
    ...(sent_now === undefined ? {} : { sent_now }) }
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
 * Narrow an opaque payload into a SessionSettingsPayload (#491). Fail-closed: each original field is
 * required-present, because every zero value here is a
 * real ANSWER rather than an absence. `session_id: ''` means "the daemon has no session to
 * address", `model`/`effort: ''` mean "inherited daemon default", `yolo: false` means permissions
 * enforced, and `window_tokens: 0` means the usage reader is unwired. Defaulting any of them would
 * make "the daemon said zero" indistinguishable from "the daemon did not say", which is the exact
 * ambiguity that let the inert-sheet defect hide. Returns only the known fields; unknown
 * server-added keys are tolerated (forward-compat) but not copied through. Its messages name the
 * failure category only — no field value is interpolated.
 *
 * `permission_mode` (#1020) is read with requireString and NOT requireNonEmptyString, deliberately:
 * `''` is a VALUE here ("no session was resolved", the reading that arrives beside `session_id: ''`),
 * and requireNonEmptyString is the sibling that exists to refuse exactly that. requireString checks
 * the TYPE, not truthiness, so only a missing key or a non-string rejects. No allowlist: the value is
 * never checked against claude's six mode names, because the read half deliberately carries one mode
 * the write half refuses (#1021) and the daemon already normalises at every construction site.
 *
 * `effective_effort` is optional and independent of saved `effort`: absence stays undefined, null
 * means no effort parameter, and strings (including empty/unknown values) pass through unchanged.
 * Present malformed values reject the complete frame before logging, using requireStringOrNull.
 *
 * `capabilities` (#1654) is optional the same way: absent stays undefined, present is narrowed by
 * parseSessionCapabilities, and a present malformed value rejects the complete frame.
 */
function parseSessionSettingsPayload(payload: unknown): SessionSettingsPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed session_settings payload')
  }
  const session_id = requireString(payload, 'session_id')
  const model = requireString(payload, 'model')
  const effort = requireString(payload, 'effort')
  const effective_effort = payload.effective_effort === undefined
    ? undefined
    : requireStringOrNull(payload, 'effective_effort')
  const yolo = requireBoolean(payload, 'yolo')
  const permission_mode = requireString(payload, 'permission_mode')
  const used_tokens = requireNumber(payload, 'used_tokens')
  const window_tokens = requireNumber(payload, 'window_tokens')
  const capabilities = payload.capabilities === undefined
    ? undefined
    : parseSessionCapabilities(payload.capabilities)
  const memory_search = Object.hasOwn(payload, 'memory_search')
    ? parseMemorySearchReport(payload.memory_search)
    : undefined
  return {
    session_id, model, effort, effective_effort, yolo, permission_mode, used_tokens, window_tokens,
    capabilities, memory_search
  }
}

/** A malformed present report is unknown as a whole; no partial provider can confirm availability. */
function parseMemorySearchReport(value: unknown): MemorySearchPayload {
  const unknown: MemorySearchPayload = { availability: 'unknown', providers: [] }
  if (!isRecord(value) || !Array.isArray(value.providers)) return unknown
  const availability = memorySearchAvailability(value.availability)
  if (availability === null) return unknown

  const providers: MemorySearchPayload['providers'] = []
  for (const provider of value.providers) {
    if (!isRecord(provider) ||
      typeof provider.id !== 'string' ||
      typeof provider.display_name !== 'string' ||
      typeof provider.installed !== 'boolean' ||
      typeof provider.enabled !== 'boolean') return unknown
    const providerAvailability = memorySearchAvailability(provider.availability)
    if (providerAvailability === null) return unknown
    providers.push({
      id: provider.id,
      display_name: provider.display_name,
      installed: provider.installed,
      enabled: provider.enabled,
      availability: providerAvailability
    })
  }
  return { availability, providers }
}

function memorySearchAvailability(value: unknown): MemorySearchAvailability | null {
  switch (value) {
    case 'available': return 'available'
    case 'unavailable': return 'unavailable'
    case 'absent': return 'absent'
    case 'unknown': return 'unknown'
    default: return null
  }
}

/**
 * Narrow a present `session_settings.capabilities` into its decoded flags (#1654, #1726). A non-object
 * rejects; each flag is optional (absent = not reported, distinct from `false`) but a present
 * non-boolean rejects through requireBoolean. Returns a fresh literal of the modelled flags only, so the
 * object's other upstream keys are never copied.
 */
function parseSessionCapabilities(value: unknown): SessionCapabilitiesPayload {
  if (!isRecord(value)) {
    throw new WireDecodeError('malformed session_settings capabilities')
  }
  const optionalBoolean = (field: string): boolean | undefined =>
    value[field] === undefined ? undefined : requireBoolean(value, field)
  return {
    slash_commands: optionalBoolean('slash_commands'),
    mcp_servers: optionalBoolean('mcp_servers'),
    context_usage_detail: optionalBoolean('context_usage_detail'),
    mid_turn_input: optionalBoolean('mid_turn_input')
  }
}

/**
 * Narrow the untrusted `session_prompt_status` string onto the three CLIENT-OWNED literals the daemon
 * publishes, or fail closed (#1230). `narrowDaemonErrorOutcome`'s comparand idiom — a switch against
 * constants written here, never a value carried through from the frame — with the one divergence that
 * matters: that function cannot throw and lands an unrecognised code on a catch-all `'unclassified'`
 * member, because a consumer there has four correlations to serve however mangled the frame. This one
 * REJECTS, because the daemon sets one of exactly three on every path including every unresolvable
 * one, so a fourth value has no defined reading and a catch-all would hand a consumer a case with no
 * behaviour to attach to it.
 *
 * Returns the narrowed member or `null`; the caller turns `null` into the throw, so the rejected value
 * stays out of this function and out of any message built from it.
 */
function narrowSessionPromptStatus(value: string): SessionPromptStatus | null {
  switch (value) {
    case 'matches':
      return 'matches'
    case 'differs':
      return 'differs'
    case 'no_session':
      return 'no_session'
    default:
      return null
  }
}

/**
 * Narrow an opaque payload into a SystemPromptPayload (#1230). Fail-closed on both fields, and the two
 * are narrowed DIFFERENTLY on purpose — see SystemPromptPayload for the wire contract.
 *
 * `system_prompt` goes through `optionalString`, which is exactly this tri-state already solved: an
 * ABSENT key returns `undefined` (no prompt stored), `''` returns `''` (an explicitly empty prompt IS
 * stored), any other string returns it verbatim, and a `null` / number / object / array throws. The
 * `null` rejection is load-bearing rather than incidental: the daemon's `*string`-with-`omitempty`
 * encoding omits the key for nil and NEVER writes null, so an explicit null is off-contract and has no
 * legitimate reading — folding it into either no-bytes state would let it round-trip back as a write.
 * Nothing here trims, parses or truthiness-tests the value; a `?? ''` or a `|| undefined` anywhere on
 * this path is the collapse the whole tri-state exists to prevent.
 *
 * `session_prompt_status` is narrowed against a CLOSED client-owned set, which is the opposite of
 * `parseSessionSettingsPayload`'s deliberate no-allowlist on `permission_mode` — and the divergence is
 * upstream's rather than a style drift. That field's read half carries one mode its write half
 * refuses, so a client-side allowlist would fail-close valid traffic. This field is a published
 * three-value enum with no zero value: the daemon sets one of the three on EVERY path including every
 * unresolvable one, so a fourth value is a malformed or hostile frame rather than a future one, and
 * accepting it would hand a consumer a fourth case with no defined reading.
 *
 * NO LENGTH BOUND ON THE PROMPT, deliberately (the parseQueuedItem / ADR 0002 no-cross-validate
 * posture). The daemon caps it write-side at 8192 bytes, and parseInboundMessage's frame-level
 * MAX_PLAINTEXT_BYTES guard already fails an oversized frame before this runs; a second bound here
 * would defend a failure that cannot reach this code and, if set below the daemon's, would silently
 * fail-close valid prompts.
 *
 * Returns a FRESH literal of the two known fields, so a server-added key — a `conversation_id` this
 * reply deliberately does not carry included — is tolerated for forward-compat but never copied
 * through. Its messages name the failure CATEGORY and the client-owned field constant only: the value
 * is the operator's own prompt text, and an Error message is a sink that reaches a stack trace, a
 * crash reporter, and anything that catches and logs.
 */
function parseSystemPromptPayload(payload: unknown): SystemPromptPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed system_prompt payload')
  }
  const system_prompt = optionalString(payload, 'system_prompt')
  const session_prompt_status = narrowSessionPromptStatus(
    requireString(payload, 'session_prompt_status')
  )
  if (session_prompt_status === null) {
    // The rejected value is NOT interpolated — it is daemon-supplied and this message is a sink.
    throw new WireDecodeError('malformed field: session_prompt_status')
  }
  return { system_prompt, session_prompt_status }
}

/**
 * Narrow ONE element of a `history_page`'s `entries` into a HistoryEntry (#1222). Fail-closed: all four
 * fields are required-present, and every zero value is a real VALUE rather than an absence — `id: 0`
 * is a log's first entry, `ts: ''` and `type: ''` would be malformed rather than empty, and
 * `payload: {}` is an entry whose stored frame had a bare body. Returns a FRESH four-key literal, so a
 * page-borne extra property (an `event_id`, a `conversation_id` the daemon never promised) cannot ride
 * along. Its messages name the failure category only — a value here is replayed content.
 *
 * `type` IS NOT NARROWED to `EnvelopeType` or to any closed set, and reaching for one is the reflex to
 * resist. It is a stored string nothing re-validates, spanning the whole live-lane vocabulary plus
 * `session_transition` plus the operator's own `message`, so a client MUST tolerate one it does not
 * recognise; an allowlist here would fail-close a valid future frame. That is the same
 * no-cross-validate posture parseQueuedItem states, applied to a type name rather than to a bound.
 *
 * `payload` goes through requireRecord and is then CARRIED BY REFERENCE, unparsed and uninterpreted at
 * THIS stage. Validating its shape is all this boundary can do: what is IN it is replayed content
 * carrying exactly the trust class of the live frame it mirrors, and nothing about it is more trusted for
 * having been stored. See HistoryEntry for the two rules a consumer inherits.
 *
 * #1227 adds the SECOND stage that reads it — `decodeHistoryPage`, running after this one — so the
 * reference this function returns no longer reaches IPC: every decoded arm is a fresh literal of scalars,
 * and nothing off the `JSON.parse` result survives into the emitted event. What this function still owns
 * is the ENVELOPE posture, and it is unchanged: one malformed entry envelope throws the WHOLE page. Do
 * not relax it to a skip to match the payload stage's — that would silently drop a shipped guarantee.
 */
function parseHistoryEntry(raw: unknown): HistoryEntry {
  if (!isRecord(raw)) {
    throw new WireDecodeError('malformed history_page entry')
  }
  const id = requireNumber(raw, 'id')
  if (!Number.isSafeInteger(id) || id < 0) throw new WireDecodeError('malformed history_page entry')
  const type = requireString(raw, 'type')
  const payload = requireRecord(raw, 'payload')
  const ts = requireString(raw, 'ts')
  return { id, type, payload, ts }
}

/**
 * Narrow an opaque payload into a HistoryPagePayload (#1222). Fail-closed on every field.
 *
 * `entries` takes parseQueueStatePayload's inline shape — `Array.isArray` then `.map` through the row
 * narrower — so ONE BAD ELEMENT THROWS THE WHOLE PAGE CLOSED rather than yielding a page with the bad
 * entries skipped, and the result is a FRESH array. An EMPTY array is VALID and is not an absence: the
 * daemon always writes the key and an empty page carries `[]`, never `null` and never an omitted key,
 * so `null` fails closed here.
 *
 * `cursor` is read with requireString and NOT requireNonEmptyString, and that choice is load-bearing
 * rather than incidental: the reply's cursor is EMPTY whenever `at_start` is true, so the sibling
 * helper would fail-close the terminal page of every walk. `''` is a VALUE here — the same reading its
 * outbound twin gives it — and it is carried, never parsed and never rewritten.
 *
 * `at_start` is checked for TYPE, never truthiness — `false` is what every mid-walk page carries.
 *
 * NO COUNT BOUND AND NO SIZE BOUND, deliberately (the parseBackgroundTaskRosterPayload posture, ADR
 * 0002). The frame-level MAX_PLAINTEXT_BYTES guard at the top of parseInboundMessage already fails an
 * oversized frame before this runs, and the daemon clamps the entry count at construction, re-asking a
 * too-large page at a smaller size rather than truncating one — so a second bound here would defend a
 * failure that cannot reach this code, and one below the daemon's 4096 would silently drop valid pages.
 * Nothing is allocated from a daemon-supplied count either: the array is built by mapping an
 * already-materialised one, never `new Array(claimed)`.
 *
 * BOTH `cursor` AND `at_start` ARE CARRIED AS SENT and neither is inferred from the other or from the
 * entry count. `at_start` is the ONLY termination signal — a page that fills exactly at the log's first
 * entry reports it false with a usable cursor, and a short page says nothing at all, because the daemon
 * may serve fewer entries than asked to fit the envelope cap. Normalising either into an end-of-log
 * flag here would break the walk at exactly the boundary it exists to find. #1224 walks; nothing here
 * acts on them.
 */
function parseHistoryPagePayload(payload: unknown): HistoryPagePayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed history_page payload')
  }
  const raw = payload.entries
  if (!Array.isArray(raw)) {
    throw new WireDecodeError('missing required field: entries')
  }
  const entries = raw.map(parseHistoryEntry)
  const cursor = requireString(payload, 'cursor')
  const at_start = requireBoolean(payload, 'at_start')
  return { entries, cursor, at_start }
}

/**
 * ONE STORED HISTORY ENTRY, DECODED (#1227) — the typed timeline event a page entry became, beside the
 * entry's own durable log `id` and its `ts`. Both survive the decode because #1225 joins a loaded page to
 * the live stream on `ts` and cannot recover one lost here; `id` is the on-disk log id and is NEVER joined
 * against an `event_id` (see HistoryEntry).
 *
 * The wire `{ type, payload }` pair does NOT survive. `HistoryEntry` stays the pre-decode wire type,
 * mirroring the daemon field-for-field; this is what crosses IPC instead of it.
 */
export interface DecodedHistoryEntry {
  id: number
  ts: string
  event: DecodedHistoryEvent
}

type DecodedModelRefusalEvent = {
  originalModel: string
  refusalCategory: string
  banner: string
  truncatedFields: readonly string[] | null
  droppedFields: readonly string[] | null
} & (
  | { type: 'modelRefusalFallback'; fallbackModel: string; scope: string }
  | { type: 'modelRefusalNoFallback' }
)

/**
 * A stored entry's payload decoded into the shape its LIVE `DaemonEvent` twin carries (#1227) — one arm
 * per type the timeline draws, which is the set of non-null arms in the renderer's
 * `translateTimelineEvent` minus its client-side `connected` edge, plus the operator's own `message`.
 * A consumer can therefore run the window's existing live-lane mapping over one of these unchanged.
 *
 * NO ARM CARRIES A `conversationId`, and that is the point rather than an omission. Every one of the
 * eleven parsers requires the payload's `conversation_id` — on the live lane it is the routing key, and
 * the fail-closed read is what makes `?? ''` misattribution impossible there — but the value it reads is
 * DAEMON-ASSERTED, while a page is attributed by CORRELATION to the conversation this client asked
 * about. Carrying both would hand a consumer two ids that can disagree and a routing decision it must
 * never be given, which is the misattribution #1222's correlation exists to remove. So the id is dropped
 * here, one layer earlier than `translateTimelineEvent` drops it on every live arm — a filter plus a
 * fresh named-field literal, never a pass-through of the parsed payload. `session_transition`'s
 * `previous_session_id` is dropped on the same terms the live emit drops it: no consumer.
 *
 * DECODING MAKES THE SHAPE TRUSTED AND NEVER THE CONTENT, and the type system carries no signal for that.
 * `assistantDelta.text`, `toolUse.name` / `inputSummary` and BOTH the keys and the values of its `input`
 * map, `toolResult.resultSummary` / `resultDetail`, `unrecognizedMessage.raw` / `messageType`,
 * `sessionTransition.workspaceCwd` and `message.text` are all replayed daemon-, claude- or
 * operator-authored strings carrying EXACTLY the trust class of the live frame they mirror — nothing about
 * one is more trusted for having been stored. Every one is PLAIN TEXT ONLY at the render boundary: never
 * into a raw-markup sink (no innerHTML / dangerouslySetInnerHTML), never into an attribute or a URL, and
 * never a filename, a cache key or a lookup path. `workspaceCwd` is the trap worth naming twice — it is a
 * daemon-supplied filesystem path and this client never resolves, joins or opens it. #1223 owns the DOM
 * sink and inherits this contract through the mirrored `HistoryTimelineEvent` in shared/ipc/events.ts.
 *
 * `toolUse.input` and `toolResult.resultDetail` stay OPTIONAL, so absence keeps meaning "the wire omitted
 * it" (an older daemon) rather than collapsing into an empty map or an empty string, which are different
 * facts — the contract their live arms already state.
 */
export type DecodedHistoryEvent =
  | { type: 'backgroundTaskStarted'; taskId: string; toolCallId: string; taskType: string; description: string }
  | { type: 'backgroundTaskUpdated'; taskId: string; status: string }
  | DecodedModelRefusalEvent
  | { type: 'assistantDelta'; turnId: string; seq: number; text: string; parentToolUseId?: string }
  | ({ type: 'turnEnd'; turnId: string; stopReason: string; outcome?: string; isError?: boolean; terminalReason?: string; errorCategory?: string } & TurnEndMetrics)
  | { type: 'turnState'; state: WireTurnState }
  | {
      type: 'toolUse'
      turnId: string
      toolUseId: string
      parentToolUseId?: string
      name: string
      inputSummary: string
      input?: Readonly<Record<string, string>>
    }
  | {
      type: 'toolDenied'
      turnId: string
      toolUseId: string
      toolName: string
      decisionReasonType: string
      decisionReason: string
      message: string
      truncatedFields: readonly string[] | null
      droppedFields: readonly string[] | null
    }
  | {
      type: 'toolResult'
      turnId: string
      toolUseId: string
      parentToolUseId?: string
      isError: boolean
      resultSummary: string
      resultDetail?: string
    }
  | {
      type: 'sessionTransition'
      newSessionId: string
      reason: WireSessionTransitionReason
      occurredAt: string
      workspaceCwd: string | null
    }
  | { type: 'stallDetected' }
  | { type: 'apiRetry'; active: boolean; current: number; total: number }
  | { type: 'compacting'; active: boolean; compactResult?: string; compactError?: string }
  | {
      type: 'unrecognizedMessage'
      site: WireUnrecognizedSite
      messageType: string
      raw: string
      truncated: boolean
    }
  // The operator's own message, the one type that appears ONLY in history — the daemon pushes no
  // `message` frame on the interactive lane. Nested and snake-cased, mirroring the live
  // `messageReceived` arm's reuse of the wire payload verbatim, with the drop expressed in the type
  // itself: `Omit` is what makes "the conversation id does not cross" a compile-time fact rather than a
  // convention the emit has to remember.
  | { type: 'messageReceived'; message: Omit<MessagePayload, 'conversation_id'> }

/**
 * A served page whose entries have been decoded (#1227). `cursor` and `at_start` keep their WIRE names
 * and their values — the snake→camel flip stays at the IPC emit, this channel's convention — and both
 * cross exactly as served: `at_start` is the only termination signal, and nothing here infers either from
 * the other or from how many entries survived the decode.
 */
export interface DecodedHistoryPage {
  servedIds?: readonly number[]
  entries: readonly DecodedHistoryEntry[]
  cursor: string
  at_start: boolean
}

/**
 * Decode ONE stored entry's payload against the live-lane parser for its type (#1227), or return `null`
 * when the timeline does not draw that type.
 *
 * IT MIRRORS `parseInboundMessage`'s type-to-parser pairing AND SHARES NONE OF ITS BODY, deliberately.
 * That switch is bound to raw plaintext and interleaved with per-case diagnostics keyed on the frame's
 * bytes; refactoring it to be reachable from here would be a large mechanical change to a
 * security-sensitive file for no gain. The pairing is duplicated; the parsers are not.
 *
 * A `switch` STATEMENT, NEVER AN OBJECT-LITERAL DISPATCH TABLE, and that is a security constraint rather
 * than a style choice. `type` is a stored, daemon-authored string that nothing re-validates, so
 * `TABLE[type]` would be a LOOKUP PATH on untrusted input: `'__proto__'` resolves to `Object.prototype`
 * (truthy, and then called) and `'constructor'` is worse. A switch compares values and touches no
 * prototype chain. The same rule binds any later "which types do we draw?" set — a `Set`, never a bare
 * object used as a map.
 *
 * `default: return null` is what AC3 rests on, and the types it silently covers are worth naming: the
 * ten this client DOES decode on the live lane and never draws in a thread (`background_task_roster`, `model_announced`, `model_list`, `slash_command_list`, and — since #1312,
 * #1318, #1454 and #1514 — `thinking_progress`, `rate_limited`, `context_usage` and `resetting`, whose
 * live-lane parsers each deliberately came with no
 * arm here), any type a later daemon invents — and `modal_shown` /
 * `question_shown`. THAT LAST PAIR IS THE SHARPEST CASE: no prompt may ever reach the window from history
 * as something answerable, because resolving a modal that closed hours ago is a real action taken on a
 * replayed frame. Having no arm is what guarantees it, for a future daemon that starts logging one and for
 * a hostile one that plants one alike. Do not add an arm for either.
 *
 * THROWS on a payload that does not fit its type — the parser's own fail-closed behaviour, unchanged. The
 * caller turns that into a skip; nothing is caught here, so no arm can accidentally half-decode.
 */
function decodeHistoryEvent(
  type: string,
  payload: Record<string, unknown>
): DecodedHistoryEvent | null {
  switch (type) {
    case 'background_task_started': {
      const p = parseBackgroundTaskStartedPayload(payload)
      return { type: 'backgroundTaskStarted', taskId: p.task_id, toolCallId: p.tool_call_id,
        taskType: p.task_type, description: p.description }
    }
    case 'background_task_updated': {
      const p = parseBackgroundTaskUpdatedPayload(payload)
      return { type: 'backgroundTaskUpdated', taskId: p.task_id, status: p.status }
    }
    case 'assistant_delta': {
      const p = parseAssistantDeltaPayload(payload)
      return { type: 'assistantDelta', turnId: p.turn_id, seq: p.seq, text: p.text, parentToolUseId: p.parent_tool_use_id }
    }
    case 'turn_end': {
      const p = parseTurnEndPayload(payload)
      return { type: 'turnEnd', turnId: p.turn_id, stopReason: p.stop_reason,
        outcome: p.outcome, isError: p.is_error, terminalReason: p.terminal_reason, errorCategory: p.error_category,
        ...turnEndMetricsOf(p) }
    }
    case 'turn_state': {
      const p = parseTurnStatePayload(payload)
      return { type: 'turnState', state: p.state }
    }
    case 'tool_use': {
      const p = parseToolUsePayload(payload)
      return {
        type: 'toolUse',
        turnId: p.turn_id,
        toolUseId: p.tool_use_id,
        parentToolUseId: p.parent_tool_use_id,
        name: p.name,
        inputSummary: p.input_summary,
        // Assigned unconditionally, never a conditional spread — the live emit's discipline. An absent
        // map stays absent rather than becoming `{}`, which is the different fact that the daemon sent
        // no fields for this call.
        input: p.input
      }
    }
    case 'model_refusal_fallback': {
      const p = parseModelRefusalFallbackPayload(payload)
      return { type: 'modelRefusalFallback', originalModel: p.original_model, refusalCategory: p.refusal_category,
        banner: p.banner, truncatedFields: p.truncated_fields, droppedFields: p.dropped_fields,
        fallbackModel: p.fallback_model, scope: p.scope }
    }
    case 'model_refusal_no_fallback': {
      const p = parseModelRefusalNoFallbackPayload(payload)
      return { type: 'modelRefusalNoFallback', originalModel: p.original_model, refusalCategory: p.refusal_category,
        banner: p.banner, truncatedFields: p.truncated_fields, droppedFields: p.dropped_fields }
    }
    case 'tool_denied': {
      const p = parseToolDeniedPayload(payload)
      return {
        type: 'toolDenied',
        turnId: p.turn_id,
        toolUseId: p.tool_use_id,
        toolName: p.tool_name,
        decisionReasonType: p.decision_reason_type,
        decisionReason: p.decision_reason,
        message: p.message,
        truncatedFields: p.truncated_fields,
        droppedFields: p.dropped_fields
      }
    }
    case 'tool_result': {
      const p = parseToolResultPayload(payload)
      return {
        type: 'toolResult',
        turnId: p.turn_id,
        toolUseId: p.tool_use_id,
        parentToolUseId: p.parent_tool_use_id,
        isError: p.is_error,
        resultSummary: p.result_summary,
        resultDetail: p.result_detail
      }
    }
    case 'session_transition': {
      const p = parseSessionTransitionPayload(payload)
      return {
        type: 'sessionTransition',
        newSessionId: p.new_session_id,
        reason: p.reason,
        occurredAt: p.occurred_at,
        // Wire nullability preserved, never coerced to ''.
        workspaceCwd: p.workspace_cwd
      }
    }
    case 'stall': {
      // Parsed for its fail-closed effect and nothing else: a stored `stall` whose payload names no
      // conversation is malformed and is skipped, exactly as the live lane refuses one.
      parseStallPayload(payload)
      return { type: 'stallDetected' }
    }
    case 'api_retry': {
      const p = parseApiRetryPayload(payload)
      return { type: 'apiRetry', active: p.active, current: p.current, total: p.total }
    }
    case 'compacting': {
      const p = parseCompactingPayload(payload)
      return { type: 'compacting', active: p.active, compactResult: p.compact_result, compactError: p.compact_error }
    }
    case 'unrecognized_message': {
      const p = parseUnrecognizedMessagePayload(payload)
      return {
        type: 'unrecognizedMessage',
        site: p.site,
        messageType: p.message_type,
        raw: p.raw,
        truncated: p.truncated
      }
    }
    case 'message': {
      // The SSOT's prose says a stored operator message is typed `send_message`; the daemon's third
      // history producer appends `protocol.TypeMessage` — `"message"` — carrying a MessagePayload, so
      // this is the right pairing and the prose is stale (pyrycode#2115).
      const p = parseMessagePayload(payload)
      return {
        type: 'messageReceived',
        message: { message_id: p.message_id, role: p.role, text: p.text }
      }
    }
    default:
      return null
  }
}

/**
 * Decode one served page's entries (#1227), dropping the ones that cannot cross.
 *
 * TWO FAIL POSTURES COEXIST ON THIS PATH AND NEITHER MAY BE COLLAPSED INTO THE OTHER.
 * `parseHistoryPagePayload` / `parseHistoryEntry` above fail the WHOLE page closed when an entry's
 * ENVELOPE (`id`, `type`, `payload`, `ts`) is malformed — #1222's shipped guarantee, unchanged. The skip
 * here belongs to the payload-decode stage only, and its reason is different in kind: an undrawn type and
 * a payload that does not fit its type are both ORDINARY, since a page is a replay of everything the log
 * holds and this client draws a subset of it. One bad entry must never cost the page, and a page every
 * entry of which was skipped crosses as an EMPTY page rather than as a failure — #1224's walk must still
 * be able to step past it, and a dropped page would stall the walk with no terminal.
 *
 * NEVER THROWS, which is what lets `parseInboundMessage` run it AFTER the diagnostic line without
 * breaking its narrow-before-logging invariant.
 *
 * The catch binds NO error. That is deliberate and is the AC4 half about logs: the parsers' messages name
 * a failure CATEGORY only, but a caught error that nothing can name is a stronger guarantee than one that
 * merely happens not to be interpolated today. Nothing daemon-authored — not the failure text, not the
 * entry's `type`, `id`, `ts` or any payload field — reaches a message, an event or a log line from here.
 *
 * Order is preserved among the survivors; skipped entries leave no hole and shift nothing.
 */
function decodeHistoryPage(page: HistoryPagePayload): { page: DecodedHistoryPage; skipped: number } {
  const entries: DecodedHistoryEntry[] = []
  let skipped = 0
  for (const entry of page.entries) {
    let event: DecodedHistoryEvent | null
    try {
      event = decodeHistoryEvent(entry.type, entry.payload)
    } catch {
      event = null
    }
    if (event === null) {
      skipped += 1
      continue
    }
    entries.push({ id: entry.id, ts: entry.ts, event })
  }
  return { page: { entries, servedIds: page.entries.map(entry => entry.id), cursor: page.cursor, at_start: page.at_start }, skipped }
}

/**
 * Narrow an opaque payload into an AssistantDeltaPayload (#199). Fail-closed: every field is
 * required-present — `seq:0` and `text:''` are valid VALUES
 * (a turn's first slice / an empty slice), never absences, so requireNumber / requireString check the
 * TYPE not truthiness. Returns only the known fields; unknown server-added keys are tolerated
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
  const parent_tool_use_id = optionalString(payload, 'parent_tool_use_id') || undefined
  return { conversation_id, turn_id, seq, text, parent_tool_use_id }
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
  const boundedReport = (value: unknown): string | undefined =>
    typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 256 ? value : undefined
  // #1565: lenient like the reports above: a non-number or non-finite value (`1e400` parses to
  // Infinity) is dropped, never a reject. No clamping, so `0` and negatives are carried as received.
  const finiteNumber = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined
  return { conversation_id, turn_id, stop_reason,
    outcome: boundedReport(payload.outcome),
    is_error: typeof payload.is_error === 'boolean' ? payload.is_error : undefined,
    terminal_reason: boundedReport(payload.terminal_reason),
    error_category: boundedReport(payload.error_category),
    duration_ms: finiteNumber(payload.duration_ms),
    input_tokens: finiteNumber(payload.input_tokens),
    cache_read_tokens: finiteNumber(payload.cache_read_tokens),
    cache_creation_tokens: finiteNumber(payload.cache_creation_tokens),
    output_tokens: finiteNumber(payload.output_tokens),
    cost_usd_total: finiteNumber(payload.cost_usd_total)
  }
}

/**
 * The six turn-end numbers of a decoded TurnEndPayload, snake→camel, as a fresh literal of named
 * fields (#1565). Shared by the history translation in decodeHistoryEvent and the live emit in
 * daemonConnection.ts, so both paths carry the same set; spreading its result never smuggles a
 * later decoder field across IPC.
 */
export function turnEndMetricsOf(p: TurnEndPayload): TurnEndMetrics {
  return {
    durationMs: p.duration_ms,
    inputTokens: p.input_tokens,
    cacheReadTokens: p.cache_read_tokens,
    cacheCreationTokens: p.cache_creation_tokens,
    outputTokens: p.output_tokens,
    costUsdTotal: p.cost_usd_total
  }
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

/** Validate known fields and discard extras; raw outcome strings are never display copy. */
function parseCompactingPayload(payload: unknown): CompactingPayload {
  if (!isRecord(payload)) throw new WireDecodeError('malformed compacting payload')
  return {
    conversation_id: requireString(payload, 'conversation_id'),
    active: requireBoolean(payload, 'active'),
    compact_result: optionalString(payload, 'compact_result'),
    compact_error: optionalString(payload, 'compact_error')
  }
}

/**
 * Narrow an opaque payload into a ResettingPayload (#1514). parseApiRetryPayload's shape with its two
 * numbers replaced by two NARROWED TOKENS: an isRecord gate, one requireString, one requireBoolean,
 * then parseSessionTransitionPayload's `reason` check cloned once per token — a chain of `!==`
 * comparisons against literals, which covers non-string and unknown-string alike and narrows without a
 * cast. Returns a fresh four-field literal. No helper is invented.
 *
 * `''` IS IN EACH COMPARAND CHAIN UNCONDITIONALLY, and that is the whole point of this parser. It is
 * the daemon's declared zero value on the falling edge (no `omitempty`, so the key is always written),
 * so a chain admitting only the two phases and the three handoffs would reject every falling edge and
 * leave the window with an indicator nothing can clear. It is admitted whatever `active` says: gating
 * the token set on `active` would be CROSS-FIELD VALIDATION, which this family refuses by name (see
 * parseQueuedItem), so `active: true` with `phase: ''` — a pair the producer never emits — decodes
 * rather than throwing. Do not "tighten" either chain; the tests that pin this are the ones that
 * redden.
 *
 * requireBoolean checks the TYPE, never truthiness. `active: false` IS the falling edge — the one
 * reading a consumer most needs — so a truthiness test would read the whole signal as an absence.
 *
 * NEITHER TOKEN IS LOOKED UP, only compared. No dispatch table, no Set, no object index: the chain
 * compares values and touches no prototype chain, which is decodeHistoryEvent's
 * switch-never-a-lookup-table rule applied one level down to a string the peer controls. Returning a
 * fresh literal rather than a spread makes the same guarantee from the other side — unknown
 * server-added keys (a spurious `turn_id`, a planted `__proto__`) are tolerated for forward-compat but
 * never copied through. Its messages name the failure CATEGORY only, never interpolating a value:
 * `conversation_id` correlates a conversation and the token pair discloses what the operator was doing
 * to it.
 */
function parseResettingPayload(payload: unknown): ResettingPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed resetting payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const active = requireBoolean(payload, 'active')
  const phase = payload.phase
  if (phase !== 'wrapping_up' && phase !== 'restarting' && phase !== '') {
    throw new WireDecodeError('missing required field: phase')
  }
  const handoff = payload.handoff
  if (handoff !== 'pending' && handoff !== 'written' && handoff !== 'skipped' && handoff !== '') {
    throw new WireDecodeError('missing required field: handoff')
  }
  return { conversation_id, active, phase, handoff }
}

/**
 * The lowercase-UUIDv4 rule from pyrycode docs/protocol-mobile.md § The `attachment_id` shape (#1619).
 * Anchored and CASE-SENSITIVE on purpose: no `i` flag, so an uppercase id fails, and no `m` flag, so
 * `$` matches only at the end of input and a trailing newline fails. Stricter than the path-safety
 * alphabet in attachmentPath, which it does not replace.
 */
const ATTACHMENT_ID_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/**
 * Narrow an opaque payload into an AttachmentOfferedPayload (#1619). parseResettingPayload's shape over
 * three required strings, each with a rule `requireString` alone does not apply, since it admits `''`
 * and a truncated or hostile payload arrives as three empty strings: a non-empty conversation_id, an
 * attachment_id matching ATTACHMENT_ID_UUID_V4, and a filename that is non-empty and at most
 * ATTACHMENT_FILENAME_MAX_BYTES in UTF-8 BYTES, not characters. Returns a fresh three-field literal, so
 * unknown server-added keys are tolerated but never copied through. Messages name the failure CATEGORY
 * only: the filename is claude-authored and the conversation id correlates a conversation.
 */
function parseAttachmentOfferedPayload(payload: unknown): AttachmentOfferedPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed attachment_offered payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  if (conversation_id === '') {
    throw new WireDecodeError('missing required field: conversation_id')
  }
  const attachment_id = requireString(payload, 'attachment_id')
  if (!ATTACHMENT_ID_UUID_V4.test(attachment_id)) {
    throw new WireDecodeError('malformed attachment_offered attachment_id')
  }
  const filename = requireString(payload, 'filename')
  if (filename === '' || Buffer.byteLength(filename, 'utf8') > ATTACHMENT_FILENAME_MAX_BYTES) {
    throw new WireDecodeError('malformed attachment_offered filename')
  }
  return { conversation_id, attachment_id, filename }
}

/** Invalid counts degrade to absence, never to zero or rejection of the whole divider. */
function compactionCount(value: unknown): number | null | undefined {
  if (value === null) return null
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function parseCompactionBoundaryPayload(payload: unknown): CompactionBoundaryPayload {
  if (!isRecord(payload)) throw new WireDecodeError('malformed compaction boundary payload')
  return {
    conversation_id: requireString(payload, 'conversation_id'),
    trigger: requireString(payload, 'trigger'),
    pre_tokens: compactionCount(payload.pre_tokens),
    post_tokens: compactionCount(payload.post_tokens)
  }
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
 * Narrow an opaque payload into a BackgroundTaskUpdatedPayload (#565). The twin of the narrower above,
 * with a DIFFERENT six fields: three required strings, two TOLERANT strings (`status` / `summary`, #1560),
 * and `truncated_fields` through the same requireStringArrayOrNull (whose docstring names this ticket;
 * there is deliberately no second narrower and no variant of it). There is no `tool_call_id`, no
 * `description` and no `task_type` here.
 *
 * `status` AND `summary` READ AN OMITTED KEY AS `''`, a deliberate departure from `patch`'s fail-closed
 * posture below. A current daemon always sends both, but a binary predating 2026-09-10 (pyrycode#2245)
 * sends neither, and an older daemon is an observed condition on this pipeline. Failing closed would drop
 * `patch` with the frame — a regression on today's behaviour. Reading `''` is safe because `''` is already
 * the in-domain value every mid-life frame carries on both fields, so absence and emptiness mean the same
 * thing here, and an absence can never forge a finish (a finish is a NON-EMPTY `status`). A PRESENT
 * non-string — `null` included — still throws through optionalString and rejects the whole frame.
 * Neither is narrowed to a closed set: `status` is an open token (only `completed` observed), and
 * `summary` is model-authored free text that may be the task's command line. No per-field length check:
 * the daemon caps `summary` (`maxTaskSummary`) and names a cut in `truncated_fields`.
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
 * `truncated_fields` element names: they name this frame's own wire fields today (`task_id` / `patch` /
 * `status` / `summary` — a different set from the sibling's), and a client-side allowlist would
 * fail-close a valid future frame (the parseQueuedItem no-cross-validate posture). And NO reconciliation between the two: the
 * daemon scrubs invalid UTF-8 out of `patch` by deletion while `truncated_fields` reports the cap cut
 * only, so a mismatch is expected upstream behaviour, not a defect to detect. No per-field length check
 * either — every string is bounded by the daemon at construction and the frame-level MAX_PLAINTEXT_BYTES
 * guard in parseInboundMessage covers the oversized case.
 *
 * Any missing required / mistyped field throws WireDecodeError (never a partial value). Returns a fresh
 * six-field literal, so unknown server-added keys — pointedly including the sibling's `tool_call_id` /
 * `description` / `task_type`, which this frame must never have — are tolerated (forward-compat) but NOT
 * copied through, which also makes it prototype-pollution-safe. Its messages name the failure CATEGORY
 * only, never interpolating a value: a `patch` key or the `summary` may carry command text, and the two
 * ids are correlating identifiers.
 */
function parseBackgroundTaskUpdatedPayload(payload: unknown): BackgroundTaskUpdatedPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed background_task_updated payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const task_id = requireString(payload, 'task_id')
  const patch = requireString(payload, 'patch')
  const status = optionalString(payload, 'status') ?? ''
  const summary = optionalString(payload, 'summary') ?? ''
  const truncated_fields = requireStringArrayOrNull(payload, 'truncated_fields')
  return { conversation_id, task_id, patch, status, summary, truncated_fields }
}

/**
 * Narrow an opaque payload into a BackgroundTaskProgressPayload (#1638). Fail-closed like its three
 * siblings over nine fields: five required strings, three requireNumber counters and `truncated_fields`
 * through the same requireStringArrayOrNull (a literal `null` means nothing was cut; an omitted key
 * fails closed, since the Go field has no `omitempty`).
 *
 * The counters get NO range, integer or monotonicity check — parseThinkingProgressPayload's posture, for
 * the same reason: they are cumulative but not monotonic, so "only grows" or "never negative" would
 * fail-close ordinary traffic. requireNumber checks the type, never truthiness, so a `0` is carried and a
 * JSON-string number throws. No closed-set narrowing of `subagent_type`, `last_tool_name` or the
 * `truncated_fields` names, and no per-field length check (the daemon caps each string at construction;
 * the frame-level MAX_PLAINTEXT_BYTES guard covers the oversized case).
 *
 * Returns a fresh nine-field literal, so unknown keys — a `summary`, `patch` or `ambient` this frame must
 * never have — are tolerated but not copied through, which also makes it prototype-pollution-safe. Its
 * messages name the failure category only: `description` can name a file on the operator's host.
 */
function parseBackgroundTaskProgressPayload(payload: unknown): BackgroundTaskProgressPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed background_task_progress payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const task_id = requireString(payload, 'task_id')
  const description = requireString(payload, 'description')
  const subagent_type = requireString(payload, 'subagent_type')
  const last_tool_name = requireString(payload, 'last_tool_name')
  const total_tokens = requireNumber(payload, 'total_tokens')
  const tool_uses = requireNumber(payload, 'tool_uses')
  const duration_ms = requireNumber(payload, 'duration_ms')
  const truncated_fields = requireStringArrayOrNull(payload, 'truncated_fields')
  return {
    conversation_id,
    task_id,
    description,
    subagent_type,
    last_tool_name,
    total_tokens,
    tool_uses,
    duration_ms,
    truncated_fields
  }
}

/**
 * Narrow one opaque roster row into a BackgroundTask (#566). Takes parseQueuedItem's POSTURE — one bad
 * element throws the WHOLE payload closed (never a partial roster), an empty parent array is valid, the
 * result is a fresh named-field literal. Daemon #2753 adds optional `tool_call_id`: missing is valid,
 * a supplied value must be a string (including empty), and strings are preserved exactly.
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
 * Unknown server-added keys, including scalar patches, are tolerated (forward-compat) but
 * not copied through, which also makes it prototype-pollution-safe. That matters more here than on a
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
  const toolId = 'tool_call_id' in payload ? { tool_call_id: requireString(payload, 'tool_call_id') } : {}
  return { task_id, task_type, description, truncated_fields, ...toolId }
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
    site !== 'undecodable' &&
    site !== 'codex_method' &&
    site !== 'codex_item'
  ) {
    throw new WireDecodeError('missing required field: site')
  }
  return { conversation_id, site, message_type, raw, truncated }
}

function parseSessionFactsPayload(payload: unknown): SessionFactsPayload {
  if (!isRecord(payload)) throw new WireDecodeError('malformed session_facts payload')
  return {
    conversation_id: requireString(payload, 'conversation_id'),
    claude_code_version: requireString(payload, 'claude_code_version'),
    permission_mode: requireString(payload, 'permission_mode'),
    truncated_fields: requireStringArrayOrNull(payload, 'truncated_fields')
  }
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
 * Narrow an opaque payload into a ThinkingProgressPayload (#1312). Fail-closed like
 * parseApiRetryPayload, scaled from four fields to three and from one boolean to none: one
 * `requireString` for `conversation_id` and one `requireNumber` for each of the two readings, so no new
 * helper is invented here.
 *
 * `requireNumber` CHECKS THE TYPE, NEVER TRUTHINESS, and that is load-bearing on this frame rather than
 * merely idiomatic: neither Go field carries `omitempty`, so the daemon's zero value round-trips and an
 * all-zero reading is legal traffic a truthiness test would read as an absence.
 *
 * NO RANGE CHECK AND NO INTEGER CHECK on either number, which follows the house rule for a stronger
 * reason than usual. The rule itself is parseApiRetryPayload's — there is no precedent in this file for
 * range-validating a wire integer (`seq` / `total` / `used_tokens` / `queued_msg_id` are all bare
 * requireNumber) and a client-invented bound silently drops VALID future frames, the drift risk
 * CLAUDE.md / ADR 0002 rank above cosmetic robustness. Here the reflex to resist is more specific: the
 * two obvious "sanity" rules, that the reading only grows and that neither value is negative, would
 * FAIL-CLOSE ORDINARY TRAFFIC, because `estimated_tokens` restarts near zero at every inference-request
 * boundary — four times inside the daemon's committed single-turn capture. See ThinkingProgressPayload
 * for that hazard and its siblings. A consumer that formats these numbers handles the range defensively;
 * this boundary says only that they are numbers.
 *
 * Any missing / mistyped field throws WireDecodeError (never a partial value); the frame-level
 * MAX_PLAINTEXT_BYTES guard in parseInboundMessage covers the oversized case. Returns a fresh three-field
 * literal, so unknown server-added keys (a spurious `turn_id`, which this frame must never have, or a
 * planted `__proto__`) are tolerated (forward-compat) but NOT copied through — which also makes it
 * prototype-pollution-safe. Its messages name the failure CATEGORY only, never interpolating a value: the
 * id is conversation-correlating and the two readings are a side-channel on how much claude thought.
 */
function parseThinkingProgressPayload(payload: unknown): ThinkingProgressPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed thinking_progress payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const estimated_tokens = requireNumber(payload, 'estimated_tokens')
  const estimated_tokens_delta = requireNumber(payload, 'estimated_tokens_delta')
  return { conversation_id, estimated_tokens, estimated_tokens_delta }
}

function parseToolProgressPayload(payload: unknown): ToolProgressPayload {
  if (!isRecord(payload)) throw new WireDecodeError('malformed tool_progress payload')
  const conversation_id = requireString(payload, 'conversation_id')
  const turn_id = requireString(payload, 'turn_id')
  const tool_use_id = requireString(payload, 'tool_use_id')
  const elapsed_seconds = requireNumber(payload, 'elapsed_seconds')
  if (!Number.isInteger(elapsed_seconds)) {
    throw new WireDecodeError('invalid tool_progress elapsed_seconds')
  }
  return { conversation_id, turn_id, tool_use_id, elapsed_seconds }
}

/**
 * Narrow an opaque payload into a RateLimitedPayload (#1318). Fail-closed like
 * parseBackgroundTaskStartedPayload, whose shape this is minus two strings plus one number: three
 * `requireString`s, one `requireNumber` for `resets_at`, and `truncated_fields` through the same
 * requireStringArrayOrNull — the required-present-but-nullable list whose literal `null` means "nothing
 * was cut" and whose OMITTED key fails closed (the Go field has no `omitempty`, so the key is always on
 * the wire). No helper is invented here.
 *
 * DELIBERATELY NO MEMBERSHIP CHECK on `status` or `limit_type`, and on this frame that is a SECURITY
 * decision as well as the house no-drift one. The house rule is parseBackgroundTaskStartedPayload's — a
 * client-invented set fail-closes a valid future frame, the drift risk CLAUDE.md / ADR 0002 rank above
 * cosmetic robustness. The sharper reason is the daemon's: the value set beyond the one measured-benign
 * status is UNMEASURED (no capture of a limit actually in force exists on any claude version), the
 * producer's gate is loud in the same direction on purpose — the benign status is silent and any other
 * non-empty status emits, so an unrecognised one surfaces and a human looks — and narrowing here is the
 * first step of branching on a value the daemon states a client MUST NOT branch security-relevant
 * behaviour on. Rejecting the benign status itself is the same mistake in the other direction: it would
 * fail-close a frame from a daemon whose gate changed, for a worst case of one extra row.
 *
 * An EMPTY `status` or `limit_type` decodes. requireString checks `typeof value !== 'string'`, so `''`
 * passes free — the type-not-truthiness posture — and an empty value is the producer's cut-to-nothing
 * case, which `truncated_fields` reports rather than an absence.
 *
 * `resets_at` GOES THROUGH requireNumber, WHICH CHECKS THE TYPE AND NOT TRUTHINESS, and gets no range
 * check. `0` is a legal reading meaning claude did not report a reset instant — never the epoch — and a
 * truthiness test would read it as an absence. Negative, past and absurd magnitudes all decode, because
 * the value is claude's and is unvalidated in both directions upstream; rejecting one would be a
 * validation rule with no captured negative case behind it. This boundary says only that it is a number.
 *
 * The `truncated_fields` element names are NOT cross-validated against this frame's own field set (the
 * parseQueuedItem no-cross-validate posture), and one bad element throws the WHOLE payload rather than
 * yielding a partial cut list. No per-field length check either: both strings are bounded by the daemon
 * AT CONSTRUCTION — a second cap here would be a second place the limit is decided and the two could
 * disagree silently — and the frame-level MAX_PLAINTEXT_BYTES guard in parseInboundMessage covers the
 * oversized case.
 *
 * Any missing / mistyped field throws WireDecodeError (never a partial value). Returns a fresh five-field
 * literal, so unknown server-added keys (a spurious `turn_id`, which this conversation-scoped frame must
 * never have, a `utilization` that is not on the wire, or a planted `__proto__`) are tolerated
 * (forward-compat) but NOT copied through — which also makes it prototype-pollution-safe. Its messages
 * name the failure CATEGORY only, never interpolating a value: `status` and `limit_type` are untrusted
 * claude-authored text and `conversation_id` is a correlating identifier.
 */
function parseRateLimitedPayload(payload: unknown): RateLimitedPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed rate_limited payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const status = requireString(payload, 'status')
  const limit_type = requireString(payload, 'limit_type')
  const resets_at = requireNumber(payload, 'resets_at')
  const truncated_fields = requireStringArrayOrNull(payload, 'truncated_fields')
  return { conversation_id, status, limit_type, resets_at, truncated_fields }
}

/**
 * Narrow one row of a `context_usage` frame's category breakdown into a ContextUsageCategory (#1455).
 * parseModelOption's shape scaled down to two fields: an isRecord gate, one requireString, one
 * requireNumber, returning a fresh two-field literal. No helper is invented here.
 *
 * WHAT IS DELIBERATELY NOT CHECKED, each of which would fail-close valid traffic:
 *
 *   - NO emptiness check on `name`. requireString polices the TYPE, so `''` passes free — the daemon
 *     states both keys remain present even when Name is empty, so an empty label is a VALUE. The same
 *     posture makes `tokens: 0` claude's reading of zero rather than an absence.
 *   - NO range check on `tokens`, and no running total. The frame's own no-range-check rule one level
 *     down: the figures are claude's and the daemon neither recomputes nor normalizes them. The
 *     categories NEED NOT SUM to `total_tokens` by contract, and a cut list makes the sum smaller
 *     still, so a consumer must not derive a total from these rows or read a gap as an error.
 *   - NO trim, normalise, strip, escape, re-encode or length cap on `name`. It is CLAUDE-AUTHORED text
 *     that crossed the subprocess trust boundary; the producer bounds it at construction and
 *     parseInboundMessage's MAX_PLAINTEXT_BYTES guard backstops the frame, so a third bound here would
 *     be a client-invented one to keep in agreement (the parseSlashCommand posture). The committed
 *     fixture's `Messages <&>` crosses byte-for-byte on purpose: ESCAPING AT A DECODER IS ESCAPING AT
 *     THE WRONG LAYER — it corrupts the value for every non-HTML sink and buys false safety at the real
 *     one. CLAUDE.md's 2026-08-20 operator ruling puts it at the render sink, which is #1421's.
 *   - NO closed set on `name`. It is descriptive text a claude release renames by definition, so a
 *     client-side set would fail-close a valid future frame.
 *
 * Its message names the failure CATEGORY only, never a value and NEVER THE ROW INDEX — parseModelOption's
 * rule verbatim: every string here is untrusted text, daemonConnection catches WireDecodeError into a
 * caller that may log it, and an index would be a weak oracle over the breakdown that buys nothing.
 */
function parseContextUsageCategory(payload: unknown): ContextUsageCategory {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed context usage category')
  }
  const name = requireString(payload, 'name')
  const tokens = requireNumber(payload, 'tokens')
  return { name, tokens }
}

/**
 * Narrow one row of a `context_usage` frame's MCP-tool inventory into a ContextUsageMCPTool (#1459).
 * parseContextUsageCategory directly above with one more string, which is parseModelOption's shape
 * scaled to three fields: an isRecord gate, two requireStrings, one requireNumber, returning a fresh
 * three-field literal. No helper is invented here.
 *
 * WHAT IS DELIBERATELY NOT CHECKED, each of which would fail-close valid traffic:
 *
 *   - NO emptiness check on `name` OR `server_name`, and requireString rather than
 *     requireNonEmptyString ON PURPOSE. That sibling exists for a field whose `''` is a DISTINCT
 *     FAILURE MODE: every key is optional to Go's `encoding/json`, so a truncated payload arrives
 *     present, typed and empty, and through requireString a LOOKUP KEY like `attachment_id` would
 *     decode to a success naming nothing. THAT HAZARD NEEDS A LOOKUP TO ARISE, AND NOTHING LOOKS THESE
 *     STRINGS UP — they are inert by contract — so `''` here is a display value rather than a
 *     resolution that silently found nothing, and the daemon states all three keys stay present when
 *     the strings are empty. The two facts are ONE DECISION: if a later slice ever makes `server_name`
 *     a lookup key, this helper choice must be revisited together with the never-actuate prohibition.
 *   - NO range check on `tokens`, and no running total. The frame's own no-range-check rule one level
 *     down: the figures are claude's and the daemon neither recomputes nor normalizes them. The
 *     inventory NEED NOT SUM to `total_tokens` by contract, and a cut list makes the sum smaller still.
 *   - NO server lookup, NO membership check against a known-servers list, and NO JOIN WITH
 *     `mcp_status`. `server_name` is INERT — it names a contributor to a READING, never an actuation
 *     target — and its collision with the actuation-crossing `MCPReconnectPayload.ServerName` is the
 *     trap ContextUsageMCPTool's docblock states in full. A client-side set of server names would also
 *     fail-close a valid frame the moment a workspace adds a server.
 *   - NO trim, normalise, strip, escape, re-encode or length cap on either string. Both crossed the
 *     subprocess trust boundary; the producer bounds them at construction and parseInboundMessage's
 *     MAX_PLAINTEXT_BYTES guard backstops the frame, so a third bound here would be a client-invented
 *     one to keep in agreement (the parseSlashCommand posture). The committed fixture's embedded
 *     NEWLINE (`query\ndocs`) and `remote<mcp>` metacharacters cross byte-for-byte on purpose:
 *     ESCAPING AT A DECODER IS ESCAPING AT THE WRONG LAYER, and CLAUDE.md's 2026-08-20 operator ruling
 *     puts it at the render sink, which is #1421's.
 *
 * Its message names the failure CATEGORY only, never a value and NEVER THE ROW INDEX — parseModelOption's
 * rule verbatim. It matters more here than one inventory over: `name` is model-influenced text,
 * `server_name` is WORKSPACE CONFIGURATION naming infrastructure, daemonConnection catches
 * WireDecodeError into a caller that may log it, and that fixture newline would FORGE A RECORD in a
 * line-delimited log.
 */
function parseContextUsageMCPTool(payload: unknown): ContextUsageMCPTool {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed context usage mcp tool')
  }
  const name = requireString(payload, 'name')
  const server_name = requireString(payload, 'server_name')
  const tokens = requireNumber(payload, 'tokens')
  return { name, server_name, tokens }
}

/**
 * Narrow one row of a `context_usage` frame's MEMORY-FILE inventory into a ContextUsageMemoryFile
 * (#1460). parseContextUsageMCPTool directly above field-for-field with different key names: an isRecord
 * gate, two requireStrings, one requireNumber, returning a fresh three-field literal. No helper is
 * invented here, and this is the LAST of the frame's three inventories — after it every key the daemon
 * writes is read.
 *
 * WHAT IS DELIBERATELY NOT CHECKED, each of which would fail-close valid traffic:
 *
 *   - **NO join, resolve, normalise, clean, realpath, prefix check or open on `path`, and NO stat.**
 *     The daemon's own comment states the constraint in those words: `path` is PATH-SHAPED DESCRIPTIVE
 *     TEXT, NOT A FILE HANDLE, and nothing on this path touches it — not the producer, not the mapper,
 *     not this decoder — because normalising the string would IMPLY IT NAMES A REAL FILE THIS FRAME ACTS
 *     ON, which it does not. Rejecting a traversal-shaped value would be worse than useless: it buys
 *     nothing here (this decoder opens nothing), and `../CLAUDE.md` is an ORDINARY memory-file reference
 *     in a monorepo, since claude genuinely loads memory from parent directories — so a client-side
 *     traversal check would drop legitimate frames while leaving the real sink, a later `path.join` or
 *     `href`, exactly as exposed. The defence is the PROHIBITION (ContextUsageMemoryFile states it, and
 *     #1419 / #1421 inherit it) plus the render sink, and the committed fixture's `../../../etc/passwd`
 *     crossing byte-for-byte is what pins it by a test rather than by prose.
 *   - NO scheme check on `path` either. A path-shaped string is not a path-CONSTRAINED one: the daemon
 *     constrains neither scheme nor shape, so a `javascript:` URI, a `file://` URL and a UNC path arrive
 *     as ordinary values and cross as ordinary values. That is why the prohibition on the type names
 *     `href` and `openExternal` specifically rather than saying "not a link".
 *   - NO closed set on `type`, and no branch on it anywhere. It is claude's own descriptive LABEL, open
 *     by definition, so a client-side set fail-closes a valid future frame — and it is NOT a
 *     DISCRIMINANT, however much a field spelled `type` looks like one in a file whose every other
 *     `type` narrows an envelope. It carries no authority: nothing may branch security-relevant
 *     behaviour on it.
 *   - NO emptiness check on `path` OR `type`, and requireString rather than requireNonEmptyString for
 *     parseContextUsageMCPTool's stated reason: that sibling exists for a string whose `''` is a
 *     DISTINCT FAILURE MODE because it is a LOOKUP KEY, and nothing looks these up. An empty `path` is
 *     emphatically not a lookup that resolved to the filesystem root — it resolves to nothing at all,
 *     because nothing resolves it. The daemon states all three keys stay present when the strings are
 *     empty.
 *   - NO range check on `tokens`, and no running total. The frame's own no-range-check rule one level
 *     down: the figures are claude's and the daemon neither recomputes nor normalizes them. The
 *     inventory NEED NOT SUM to `total_tokens` by contract, and a cut list makes the sum smaller still.
 *   - NO trim, strip, escape, re-encode or length cap on either string. Both crossed the subprocess
 *     trust boundary; the producer bounds them at construction and parseInboundMessage's
 *     MAX_PLAINTEXT_BYTES guard backstops the frame, so a third bound here would be a client-invented
 *     one to keep in agreement (the parseSlashCommand posture). ESCAPING AT A DECODER IS ESCAPING AT THE
 *     WRONG LAYER, and CLAUDE.md's 2026-08-20 operator ruling puts it at the render sink, which is
 *     #1421's.
 *
 * Its message names the failure CATEGORY only, never a value and NEVER THE ROW INDEX — parseModelOption's
 * rule verbatim, and this is its sharpest instance on the frame. A `path` names the OPERATOR'S OWN
 * FILESYSTEM: the daemon's fixture value alone discloses a home directory, a username and a project
 * name, daemonConnection catches WireDecodeError into a caller that may log it, and a log is exactly
 * what an operator forwards off-box when reporting a fault. A newline in a path would forge a record in
 * that line-delimited stream on top of it.
 */
function parseContextUsageMemoryFile(payload: unknown): ContextUsageMemoryFile {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed context usage memory file')
  }
  const path = requireString(payload, 'path')
  const type = requireString(payload, 'type')
  const tokens = requireNumber(payload, 'tokens')
  return { path, type, tokens }
}

/**
 * Narrow an opaque payload into a ContextUsagePayload (#1454 the reading, #1455 the category breakdown,
 * #1459 the MCP-tool inventory, #1460 the memory-file inventory).
 * Fail-closed like parseRateLimitedPayload directly above, extended with parseModelListPayload's
 * list-frame shape applied THREE TIMES: two `requireString`s, three `requireNumber`s, then per inventory
 * an inline Array.isArray-then-`.map` over the rows and a plain `requireNumber` for its dropped count. No
 * helper is invented here, and nothing is cross-validated.
 *
 * EVERY KEY ON THE FRAME IS NOW READ, so this parser is no longer the place a real frame's keys get
 * dropped — the statement that some are is GONE rather than decremented, and the payload-level
 * forward-compatibility proof rests on the shipped test that plants a `turn_id` on an otherwise valid
 * frame. What the FRESH ELEVEN-FIELD LITERAL still buys is that same tolerance for a key a LATER daemon
 * adds, plus prototype-pollution safety against a planted `__proto__`: it copies nothing through, at the
 * payload level and at every row.
 *
 * EACH INVENTORY FAILS CLOSED ON `null`, ON AN ABSENT KEY AND ON ANY NON-ARRAY, while an EMPTY ARRAY
 * DECODES TO `[]`. The daemon's MarshalJSON normalises every nil inventory slice to `[]` precisely so a
 * client never has to tell the two apart, which makes `[]` the POSITIVE STATEMENT that claude reported no
 * categories, no MCP tools, or no memory files, and makes a `null` a real defect; `Array.isArray(null)`
 * is `false`, which
 * is exactly what fails it, and an omitted key (`undefined`) fails the same way. That empty list must
 * stay distinguishable from the absence a frame that never arrived yields — which is a CONSUMER
 * obligation from #1419 onward, since this decoder only ever returns one or throws. ORDER IS PRESERVED
 * FROM THE WIRE: the rows are a prefix of the producer's descending-token order with any cut taken off
 * the TAIL, so a shortened list is never a list with holes and re-sorting would destroy the only
 * ordering signal a consumer gets. ONE BAD ROW IN ANY LIST THROWS THE WHOLE FRAME rather than
 * yielding a partial inventory — `.map` propagates the first throw — and a half-populated inventory is
 * worse than none, because nothing downstream could tell the two apart once its dropped count no longer
 * accounts for the loss. THE THREE LISTS ARE NEVER CROSSED: each is guarded, mapped and counted on its
 * own, and a well-formed sibling neither rescues nor validates another.
 *
 * EACH DROPPED COUNT decodes through plain requireNumber, correct PRECISELY BECAUSE the Go fields have
 * no `omitempty`: the key is always written, so `0` is a genuine value carried as `0` and never
 * truthiness-tested, while an absent key is a real defect. NOTHING CROSS-CHECKS ANY AGAINST ITS
 * LIST'S LENGTH, NOTHING CROSS-READS THE THREE COUNTS, AND NOTHING CAPS ANY ENTRY COUNT (AC4). Each
 * count is TWO CUTS' worth of loss — the
 * producer's entry and string caps plus the mapper's own frame-byte budget — so a retained list's length
 * is no evidence of completeness in either direction, and the committed fixture's `3`, `5` and `7` each
 * beside exactly two rows are the cases that prove it; `list.length + its OWN dropped count` is the true
 * size, not something to reconcile. The daemon divides ONE envelope across THREE lists and can cut all
 * three at once, so one count is no evidence about another. The producer's caps are DAEMON-SIDE and may change
 * without any change to this
 * contract, so re-deciding a bound here would be a second place the limit lives, free to disagree
 * silently. NOTHING IS ALLOCATED, SIZED OR LOOPED FROM A CLAIMED COUNT: each `.map` allocates from the
 * array that ACTUALLY arrived, which is AttachmentChunkPayload's never-allocate-from-a-claim rule, and
 * the arrays themselves are already bounded because parseInboundMessage checks MAX_PLAINTEXT_BYTES as its
 * first statement — ahead of decodeEnvelope and therefore ahead of the JSON.parse that materialises them.
 * Iterating a SECOND and a THIRD daemon-supplied list does not multiply that exposure: all three are
 * materialised by that one parse, so they COMPETE FOR ONE BYTE BUDGET rather than each getting their own.
 *
 * NO RANGE CHECK ON ANY OF THE THREE INTEGERS AND NO CROSS-FIELD CHECK, and the daemon's contract is why:
 * the reading is INFORMATIONAL — claude's own integers, which the daemon neither recomputes nor
 * normalizes — so nothing may assume `percentage` is derivable from `total_tokens` and `max_tokens`. A
 * `percentage` over 100, a total exceeding the window, a `max_tokens` of `0` beside a non-zero total and
 * a negative are all ordinary traffic here; rejecting one would be a validation rule with no captured
 * negative case behind it, and re-deriving the percentage would make this client disagree with the figure
 * claude reported, which is the whole reason the frame displaces the transcript route. This is the bare
 * posture parseSessionSettingsPayload takes for `used_tokens` / `window_tokens`. The unguarded-`Infinity`
 * hazard a `max_tokens` of `0` creates is a RENDER concern and already has a home in the renderer's
 * `contextUsagePercent`; it does not belong at this boundary.
 *
 * requireNumber CHECKS THE TYPE AND NOT TRUTHINESS, so `0` survives as `0` — and `0` is what the daemon's
 * committed empty fixture carries for all three. A `!value` guard anywhere here would read that whole
 * frame as missing and drop a legitimate one. requireString is the same posture for the two strings:
 * `''` passes free, and the empty fixture's `conversation_id` and `model` are both `''`.
 *
 * DELIBERATELY NO MEMBERSHIP CHECK ON `model`. The house rule is parseBackgroundTaskStartedPayload's — a
 * client-invented set fail-closes a valid future frame, the drift risk CLAUDE.md / ADR 0002 rank above
 * cosmetic robustness — and it binds here because a new claude release renames the string by definition.
 * It is claude-authored descriptive text beside a token count, NOT an identity to match against a model
 * menu: `model_announced` remains that authority. See ContextUsagePayload for the inert-text obligation
 * that travels with it.
 *
 * Any missing / mistyped field throws WireDecodeError (never a partial value), dropping the frame as a
 * whole the way every other arm drops one. Its messages name the failure CATEGORY only, never
 * interpolating a value: `model`, every row's `name` and every `type` are untrusted claude-authored
 * text, every `server_name` is workspace configuration, every `path` NAMES THE OPERATOR'S OWN FILESYSTEM
 * — disclosing a home-directory username and a project name, the strongest such ground on the frame —
 * and `conversation_id` is a correlating identifier.
 */
function parseContextUsagePayload(payload: unknown): ContextUsagePayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed context_usage payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const model = requireString(payload, 'model')
  const total_tokens = requireNumber(payload, 'total_tokens')
  const max_tokens = requireNumber(payload, 'max_tokens')
  const percentage = requireNumber(payload, 'percentage')
  const raw = payload.categories
  if (!Array.isArray(raw)) {
    throw new WireDecodeError('malformed context usage categories list')
  }
  const categories = raw.map(parseContextUsageCategory)
  const dropped_categories = requireNumber(payload, 'dropped_categories')
  const rawTools = payload.mcp_tools
  if (!Array.isArray(rawTools)) {
    throw new WireDecodeError('malformed context usage mcp tools list')
  }
  const mcp_tools = rawTools.map(parseContextUsageMCPTool)
  const dropped_mcp_tools = requireNumber(payload, 'dropped_mcp_tools')
  const rawMemoryFiles = payload.memory_files
  if (!Array.isArray(rawMemoryFiles)) {
    throw new WireDecodeError('malformed context usage memory files list')
  }
  const memory_files = rawMemoryFiles.map(parseContextUsageMemoryFile)
  const dropped_memory_files = requireNumber(payload, 'dropped_memory_files')
  return {
    conversation_id,
    model,
    total_tokens,
    max_tokens,
    percentage,
    categories,
    dropped_categories,
    mcp_tools,
    dropped_mcp_tools,
    memory_files,
    dropped_memory_files
  }
}

/**
 * Narrow one row of an `mcp_status` frame's server list into an MCPServerStatus (#1489).
 * parseContextUsageMCPTool's STRUCTURE scaled to five strings: an isRecord gate, five plain
 * requireStrings in wire order, and a fresh five-field literal. No helper is invented here. Its
 * inertness doctrine does NOT carry over: this `name` is the server list's own identity, which a later
 * slice may carry into an MCP actuation verb — see MCPServerStatus.
 *
 * WHAT IS DELIBERATELY NOT CHECKED, each of which would fail-close valid traffic:
 *
 *   - NO emptiness check, and requireString rather than requireNonEmptyString ON PURPOSE. The daemon
 *     encodes a missing or zero-valued source string as `''` and keeps all five keys present, so `''` is
 *     a value the contract states — an empty `error` is the ordinary healthy row — not a failed lookup.
 *   - NO closed set on `status` or `scope`, and NO parse of `version`. Both are claude's open-set text,
 *     reports rather than authority, and `version` is opaque. An unrecognised word crosses as written.
 *   - NO trim, normalise, escape, re-encode or length cap. The producer caps `error` at 256 bytes (a size
 *     bound, not sanitisation) and parseInboundMessage's MAX_PLAINTEXT_BYTES guard backstops the frame.
 *     The fixture's `remote<&>` and its embedded newline cross byte-for-byte: escaping belongs at the
 *     render sink (CLAUDE.md's 2026-08-20 operator ruling).
 *
 * Its message names the failure CATEGORY only, never a value and never the row index: every string here
 * is untrusted claude-authored text, daemonConnection catches WireDecodeError into a caller that may log
 * it, and the fixture's newline would forge a record in a line-delimited log.
 */
function parseMCPServerStatus(payload: unknown): MCPServerStatus {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed mcp server status')
  }
  const name = requireString(payload, 'name')
  const status = requireString(payload, 'status')
  const error = requireString(payload, 'error')
  const scope = requireString(payload, 'scope')
  const version = requireString(payload, 'version')
  return { name, status, error, scope, version }
}

/**
 * Narrow an opaque payload into an MCPStatusPayload (#1489) — parseContextUsagePayload's list shape over
 * a single inventory. An isRecord gate, a requireString for the daemon-authored `conversation_id`, an
 * `Array.isArray` guard then a `.map` over the rows, and a plain requireNumber for `dropped_servers`,
 * returning a fresh three-field literal.
 *
 * `servers` MUST BE AN ARRAY: the daemon normalises nil to `[]`, so `[]` is a positive report of no
 * servers and a `null` or an absent key is a defect that drops the frame. One malformed row drops the
 * whole frame rather than yielding a partial list. `dropped_servers` is copied, NOT RECONCILED against
 * the list's length and not range-checked, and NOTHING CAPS THE ENTRY COUNT: the producer's cap is not a
 * wire constant. The `.map` allocates from the array that actually arrived, never from the claimed count,
 * and that array is already bounded by the MAX_PLAINTEXT_BYTES check ahead of the JSON.parse.
 *
 * Any missing / mistyped field throws WireDecodeError naming the failure category only, never a value.
 */
function parseMCPStatusPayload(payload: unknown): MCPStatusPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed mcp_status payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const rawServers = payload.servers
  if (!Array.isArray(rawServers)) {
    throw new WireDecodeError('malformed mcp status servers list')
  }
  const servers = rawServers.map(parseMCPServerStatus)
  const dropped_servers = requireNumber(payload, 'dropped_servers')
  return { conversation_id, servers, dropped_servers }
}

/**
 * Narrow an opaque payload into a SessionTransitionPayload (#254). Fail-closed like parseTurnStatePayload,
 * scaled to six fields: four required strings (`conversation_id` / `previous_session_id` /
 * `new_session_id` / `occurred_at`),
 * a required nullable `workspace_cwd` via requireStringOrNull (the `ConversationSummary.name` #139 idiom — a
 * literal `null` is a valid value for `clear` / `idle_evict`, but absent/`undefined` or a non-string-non-null
 * throws), and a `reason` closed-enum check cloned from parseTurnStatePayload's `state` check (covers
 * non-string and unknown-string alike, narrowing to WireSessionTransitionReason without a cast — a bare
 * requireString would accept any string and defeat the closed-enum boundary this slice exists to defend). The
 * check stays exhaustive over the full closed set INCLUDING `workspace_change`, even though the producer
 * (#657) emits only `clear` / `idle_evict` today. The decoder does NOT cross-validate the
 * `workspace_cwd`-non-null-⟺-`workspace_change` invariant (daemon-guaranteed on the wire; enforcing it here
 * would defend an unobserved failure).
 *
 * `conversation_id` is REQUIRED (#1192), narrowed by the same bare `requireString` every sibling
 * `conversation_id` in this decoder uses (parseUnrecognizedMessagePayload directly above is the closest
 * model). It is the marker's only attribution — the daemon pushes this frame unsolicited, so there is no
 * request to correlate it against — and the renderer's session-id write is gated on it. A missing or
 * non-string one therefore throws, which drops the whole frame at daemonConnection's decode boundary
 * without emitting and without disturbing the connection. Required rather than optional on purpose: an
 * optional routing key invites the `?? activeConversation` fallback the #675 family exists to remove, and
 * here that fallback IS the defect. No length check, no charset check, no allow-list — the frame-level
 * MAX_PLAINTEXT_BYTES guard is the bound, and a second one here would defend a failure that cannot reach
 * this line.
 *
 * Returns exactly the six known fields; unknown server-added keys are tolerated (forward-compat) but not
 * copied. Its messages name the failure CATEGORY only — never interpolating a `workspace_cwd` path, a
 * session-correlating id, or the conversation-correlating one.
 */
function parseSessionTransitionPayload(payload: unknown): SessionTransitionPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed session_transition payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const previous_session_id = requireString(payload, 'previous_session_id')
  const new_session_id = requireString(payload, 'new_session_id')
  const occurred_at = requireString(payload, 'occurred_at')
  const workspace_cwd = requireStringOrNull(payload, 'workspace_cwd')
  const reason = payload.reason
  if (reason !== 'clear' && reason !== 'idle_evict' && reason !== 'workspace_change') {
    throw new WireDecodeError('missing required field: reason')
  }
  return {
    conversation_id,
    previous_session_id,
    new_session_id,
    reason,
    occurred_at,
    workspace_cwd
  }
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
  const parent_tool_use_id = optionalString(payload, 'parent_tool_use_id') || undefined
  const name = requireString(payload, 'name')
  const input_summary = requireString(payload, 'input_summary')
  const input = optionalStringMap(payload, 'input')
  return { conversation_id, turn_id, tool_use_id, parent_tool_use_id, name, input_summary, input }
}

/** Both refusal variants share required fields; validation never interprets Claude's prose. */
function parseModelRefusalNoFallbackPayload(payload: unknown): ModelRefusalNoFallbackPayload {
  if (!isRecord(payload)) throw new WireDecodeError('malformed model refusal payload')
  return {
    conversation_id: requireString(payload, 'conversation_id'),
    original_model: requireString(payload, 'original_model'),
    refusal_category: requireString(payload, 'refusal_category'),
    banner: requireString(payload, 'banner'),
    truncated_fields: requireStringArrayOrNull(payload, 'truncated_fields'),
    dropped_fields: requireStringArrayOrNull(payload, 'dropped_fields')
  }
}

function parseModelRefusalFallbackPayload(payload: unknown): ModelRefusalFallbackPayload {
  if (!isRecord(payload)) throw new WireDecodeError('malformed model refusal payload')
  return {
    ...parseModelRefusalNoFallbackPayload(payload),
    fallback_model: requireString(payload, 'fallback_model'),
    scope: requireString(payload, 'scope')
  }
}

/** Validate denial shape without interpreting source tokens or collapsing nullable reports. */
function parseToolDeniedPayload(payload: unknown): ToolDeniedPayload {
  if (!isRecord(payload)) throw new WireDecodeError('malformed tool_denied payload')
  return {
    conversation_id: requireString(payload, 'conversation_id'),
    turn_id: requireString(payload, 'turn_id'),
    tool_use_id: requireString(payload, 'tool_use_id'),
    tool_name: requireString(payload, 'tool_name'),
    decision_reason_type: requireString(payload, 'decision_reason_type'),
    decision_reason: requireString(payload, 'decision_reason'),
    message: requireString(payload, 'message'),
    truncated_fields: requireStringArrayOrNull(payload, 'truncated_fields'),
    dropped_fields: requireStringArrayOrNull(payload, 'dropped_fields')
  }
}

/**
 * Narrow an opaque payload into a ToolResultPayload (#229). Fail-closed like parseToolUsePayload: four
 * required strings (`conversation_id` / `turn_id` / `tool_use_id` / `result_summary`) PLUS one required
 * boolean `is_error` via requireBoolean (the `yolo` #180 idiom — the check is on the TYPE, so `false`
 * decodes as the value `false`, never treated as an absence, and a non-boolean like the string `'true'`
 * throws rather than being silently accepted by a truthiness check). Unknown keys tolerated but not
 * copied, category-only error messages (no field value interpolated — `result_summary` could echo tool
 * content). `result_summary` is carried through as opaque display text, never interpreted here.
 *
 * `result_detail` (#773) is the one OPTIONAL field, handled by optionalString: an omitted key decodes
 * as `undefined` (a pre-pyrycode#2024 daemon), `''` as a distinct empty value, and any present
 * non-string throws the whole frame. The key is set on the returned literal UNCONDITIONALLY —
 * `undefined` when the wire omitted it, which `toEqual` treats as absent. The consumer contract is
 * `payload.result_detail === undefined`, never `'result_detail' in payload`. Carried through as opaque
 * display text like `result_summary`, never parsed back into the number it describes.
 */
function parseToolResultPayload(payload: unknown): ToolResultPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed tool_result payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const turn_id = requireString(payload, 'turn_id')
  const tool_use_id = requireString(payload, 'tool_use_id')
  const parent_tool_use_id = optionalString(payload, 'parent_tool_use_id') || undefined
  const is_error = requireBoolean(payload, 'is_error')
  const result_summary = requireString(payload, 'result_summary')
  const result_detail = optionalString(payload, 'result_detail')
  return { conversation_id, turn_id, tool_use_id, parent_tool_use_id, is_error, result_summary, result_detail }
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
 *
 * #1213 adds a FOURTH field on the opposite footing from those three: `message_id` via `optionalString`,
 * because AC1 requires a pre-pyrycode#2092 daemon's snapshot to still decode. Absence is a VALUE, not a
 * decode error (the `result_detail` posture) — the fail-closed reading stays for the fields that carry it.
 * `''` is likewise a value, carried through rather than normalised to absence: the two collapse only at the
 * consumer, where both mean "correlates with nothing". A NON-STRING still fails the whole snapshot closed,
 * which is `optionalString`'s own rule and the safe direction. The value is relayed VERBATIM — no trim, no
 * case fold, no client-side mint when the wire sent none — because it is another client's id and any edit
 * here would silently break the correlation it exists for.
 */
function parseQueuedItem(payload: unknown): QueuedItem {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed queued item')
  }
  const queued_msg_id = requireNumber(payload, 'queued_msg_id')
  const text = requireString(payload, 'text')
  const ts = requireString(payload, 'ts')
  const message_id = optionalString(payload, 'message_id')
  return { queued_msg_id, text, ts, message_id }
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
 * Returns only the known fields; unknown server-added keys are tolerated (forward-compat) but
 * NOT copied through — this is what keeps the emitted event minimal. Its messages name the failure
 * category only — a `name` / `cwd` / `workspace_label` could echo a conversation title, a workspace path
 * or a workspace name.
 *
 * `workspace_label` (#1287) takes the `name` treatment for the same reason: the daemon writes the key
 * unconditionally, so `null` is a VALUE and an absent key fails closed. That direction is deliberate —
 * defaulting an absent key to `null` would let a stale or impersonating daemon silently suppress a label
 * the user set from another client, which is exactly the outcome the field exists to make impossible.
 *
 * `is_muted` (#1594) takes the opposite direction on absence, and deliberately: a daemon predating the
 * field omits it, and its rows must keep notifying, so an absent key decodes as `false` (the
 * conversation_updated.is_archived lesson). A present non-boolean still fails the row closed. The
 * decoder always emits a boolean here, although the type marks the field optional.
 *
 * `agent` (#1649) is optional the other way: an absent key stays absent, through optionalAgent.
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
  const archived_at = payload.archived_at === undefined ? null : requireStringOrNull(payload, 'archived_at')
  const workspace_label = requireStringOrNull(payload, 'workspace_label')
  const is_muted = payload.is_muted === undefined ? false : requireBoolean(payload, 'is_muted')
  return {
    id,
    name,
    is_promoted,
    is_archived,
    is_muted,
    cwd,
    last_message_ts,
    last_used_at,
    archived_at,
    workspace_label,
    ...optionalAgent(payload),
    ...optionalReadId(payload, 'read_up_to'),
    ...optionalReadId(payload, 'latest_entry_id')
  }
}

/** Omitted legacy fields remain unknown; numeric IDs are admitted without coercion. */
function optionalReadId(payload: Record<string, unknown>, key: 'read_up_to' | 'latest_entry_id'): { read_up_to?: number; latest_entry_id?: number } {
  const value = payload[key]
  if (value === undefined) return {}
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new WireDecodeError('malformed conversation read ID')
  }
  return key === 'read_up_to' ? { read_up_to: value } : { latest_entry_id: value }
}

/**
 * The `agent` tag a `multi_agent` client receives (#1649), shared by the conversations row, the create
 * reply and the model row. An absent key yields no key at all, so an untagged frame decodes to exactly
 * the literal it did before; a present one must be a string and is held through agentFromWire, so the
 * daemon's own string never is; a non-string fails the frame closed.
 */
function optionalAgent(payload: Record<string, unknown>): { agent?: WireAgent } {
  return payload.agent === undefined ? {} : { agent: agentFromWire(requireString(payload, 'agent')) }
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
 * AC5 — but a missing/`undefined` field throws), and `workspace_label` (#1287) a required, nullable
 * string on the same contract. Returns only the six known fields; unknown server-added keys (e.g. a
 * spurious is_archived/last_message_ts) are tolerated (forward-compat) but NOT copied through. Its
 * messages name the failure category only — a `name` / `cwd` / `workspace_label` could echo a title, a
 * workspace path or a workspace name. An optional `agent` (#1649) rides beside them through optionalAgent.
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
  const workspace_label = requireStringOrNull(payload, 'workspace_label')
  return { id, is_promoted, cwd, name, last_used_at, workspace_label, ...optionalAgent(payload) }
}

/**
 * Narrow an opaque payload into a ConversationUpdatedPayload (#273). Fail-closed like
 * parseConversationCreatedPayload, but in the reply's own field order — `name` BEFORE `cwd` (spec #274's
 * intentional reordering vs. the create reply): `id` / `cwd` / `last_used_at` required strings,
 * `is_promoted` a required boolean (the `yolo` #180 idiom — the check is on the TYPE, so `false` decodes
 * as the value `false`, never an absence, and a non-boolean throws), and `name` a required, nullable
 * string (`null` is a valid value — an update that left the name unset, AC — but a missing/`undefined`
 * field throws), and `workspace_label` (#1287) a required, nullable string on the same contract — the
 * live path by which a label set from another client reaches the sidebar, since this arm is an
 * unsolicited broadcast rather than a reply. Returns only the six known fields; unknown server-added
 * keys (e.g. a spurious is_archived/last_message_ts) are tolerated (forward-compat) but NOT copied
 * through. Its messages name the failure category only — a `name` / `cwd` / `workspace_label` could echo
 * a title, a workspace path or a workspace name.
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
  const workspace_label = requireStringOrNull(payload, 'workspace_label')
  return { id, is_promoted, name, cwd, last_used_at, workspace_label, ...optionalReadId(payload, 'read_up_to') }
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
 * Narrow an opaque payload into a WorkspaceUpdatedPayload (#1288). Fail-closed like
 * parseWorkspaceFolderCreatedPayload, whose `path` posture it inherits, plus the nullable second field:
 * an `isRecord` guard, then the required `path` string and the required, NULLABLE `label`. Returns a
 * FRESH two-field object; unknown server-added keys are tolerated (forward-compat) but NOT copied through.
 *
 * THE TWO FIELDS HAVE DELIBERATELY DIFFERENT NULLABILITY, and reaching for one helper on both is the
 * reflex to resist. A `null` PATH names no workspace and must fail the frame; a `null` LABEL is the value
 * "this workspace's label was cleared", distinct from an OMITTED key, which is an absence and fails
 * closed. That separation is what keeps a cleared label distinguishable from a truncated frame — the
 * ConversationUpdatedPayload.workspace_label contract this mirrors.
 *
 * Its messages name the failure CATEGORY only — `path` is an untrusted daemon-side REMOTE path that could
 * echo a `$HOME` / username / project name, and `label` is untrusted operator-chosen text, so NEITHER is
 * ever interpolated (requireString / requireStringOrNull emit the client-owned field NAME alone).
 */
function parseWorkspaceUpdatedPayload(payload: unknown): WorkspaceUpdatedPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed workspace_updated payload')
  }
  const path = requireString(payload, 'path')
  const label = requireStringOrNull(payload, 'label')
  return { path, label }
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
 * Narrow an opaque payload into a ModalShownPayload (#201, #870). Fail-closed like parseTurnStatePayload,
 * with optional permission context and ordered options/rules. The `class` closed-enum check follows the
 * `role` / `state` idiom: it covers non-string and unknown-string alike, narrowing to WireModalClass
 * without a cast — a bare requireString would accept any string and defeat the closed-enum boundary
 * this slice exists to defend (there is NO `destructive` wire class, ADR 0009). `options` must be an
 * array, then each element narrows via parseModalOption — one bad option throws the whole modal closed
 * (the `conversations` precedent), an empty array tolerated. `default_option_id ∈ options[].id` is NOT
 * cross-checked here (a render concern, #224). `conversation_id` (#870) is narrowed like every other
 * required string and, for the same reason, is NOT cross-checked against any known-conversation set —
 * that is a scoping concern for the consuming slice (#872); this decoder polices TYPE, not membership.
 * Fail-closed on it is decided, not open: the field shipped in pyrycode#1065, so a tolerant fallback
 * would only buy compatibility with a daemon that will never be run, at the cost of a silently
 * unattributed prompt. Returns only declared fields; unknown payload/offer keys are not copied.
 * Opaque reason keys are preserved. Errors name only the failure category, never `title` / `prompt` /
 * `options[].label` / `modal_id` / `class` / `conversation_id` (untrusted content or the nonce).
 */
function parseModalShownPayload(payload: unknown): ModalShownPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed modal_shown payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
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
  const result: ModalShownPayload = {
    conversation_id, modal_id, class: cls, title, prompt, options, default_option_id
  }
  // decodeEnvelope already parsed JSON. Preserve opaque reasons without traversal or truthiness checks.
  if ('reason' in payload) result.reason = payload.reason
  if ('reason_type' in payload) result.reason_type = requireString(payload, 'reason_type')
  if ('blocked_path' in payload) result.blocked_path = requireString(payload, 'blocked_path')
  if ('description' in payload) result.description = requireString(payload, 'description')
  if ('default_to_no' in payload) result.default_to_no = requireBoolean(payload, 'default_to_no')
  if ('always_allow' in payload) {
    const offer = requireRecord(payload, 'always_allow')
    result.always_allow = {
      offered: requireBoolean(offer, 'offered'),
      rules: requireStringArray(offer, 'rules')
    }
  }
  return result
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
 * Narrow one opaque choice into a WireQuestionOption (#884). Fail-closed like parseModalOption, with two
 * required strings and unknown keys tolerated but not copied. There is NO `id` — claude's answer protocol
 * selects an option by its `label`, so `label` IS the option's identity. Its message names the category
 * only: both fields are untrusted CLAUDE-AUTHORED text that crossed the subprocess trust boundary, neither
 * bounded nor sanitized by the daemon. NO length check on either — see parseQuestionShownPayload.
 */
function parseQuestionOption(payload: unknown): WireQuestionOption {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed question option')
  }
  const label = requireString(payload, 'label')
  const description = requireString(payload, 'description')
  return { label, description }
}

/**
 * Narrow one opaque question into a WireQuestion (#884). Fail-closed like parseModalShownPayload, scaled
 * to two strings plus a nested ordered array plus the family's only boolean.
 *
 * **`options` nests HERE, on each question** — not flat on the payload the way ModalShownPayload.options
 * is. This shape has two nesting levels where the modal family has one, so a reader pattern-matching off
 * that family gets it wrong by default. Each element narrows via parseQuestionOption: one bad option
 * throws the whole batch closed (the parseModalOption posture), an empty array is tolerated.
 *
 * `multi_select` goes through requireBoolean, which checks the TYPE rather than truthiness — the string
 * `"false"` is truthy, so a `!!` here would decode it as `true`. It is always present on the wire, so
 * `false` is a STATED POSITION rather than an absence.
 *
 * Its messages name the failure category only — `question` and `header` are untrusted claude-authored
 * text. NO length check on either, `header`'s documented-12/observed-14 cap included.
 */
function parseQuestion(payload: unknown): WireQuestion {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed question')
  }
  const question = requireString(payload, 'question')
  const header = requireString(payload, 'header')
  const rawOptions = payload.options
  if (!Array.isArray(rawOptions)) {
    throw new WireDecodeError('malformed question options')
  }
  const options = rawOptions.map(parseQuestionOption)
  const multi_select = requireBoolean(payload, 'multi_select')
  return { question, header, options, multi_select }
}

/**
 * Narrow an opaque payload into a QuestionShownPayload (#884) — claude's whole clarifying-question batch,
 * carried in ONE frame. Fail-closed like parseModalShownPayload, scaled to TWO nesting levels: an isRecord
 * guard, two required strings, then an Array.isArray check on `questions` whose elements narrow via
 * parseQuestion. An empty `questions` is tolerated — out of contract daemon-side and a producer bug, but
 * this decoder polices TYPE, not membership, and a client must not crash on one. Returns exactly the three
 * known fields; unknown keys are tolerated (forward-compat) but NOT copied.
 *
 * `conversation_id` is narrowed like any other required string and, for parseModalShownPayload's reason, is
 * NOT cross-checked against any known-conversation set — that is the consuming slice's scoping concern
 * (#885). Fail-closed on it is decided, not open: the field is in the settled contract, so a tolerant
 * fallback would only buy compatibility with a daemon that will never be run, at the cost of a silently
 * unattributed question panel.
 *
 * **NO CONTRACT BOUND IS ENFORCED HERE, and that is a decision rather than an omission.** No 1-4 question
 * count, no 2-4 option count, and no maximum length on any of the four strings: nothing enforces any of
 * them daemon-side as of 2026-09-01, and `header`'s cap is documented 12 but OBSERVED 14 runes in the one
 * real header ever captured, so a client rejecting at 12 would reject valid traffic. The wire type's
 * "an over-long field must be a fail-closed REJECT rather than a silent trim" caveat chooses between two
 * wrong behaviours should a bound ever become enforceable; its operative half here is the negative one —
 * never silently trim. Copying verbatim satisfies it. Do not add a length check, a max constant, or a
 * truncation.
 *
 * There is no count field in this shape to trust, so the batch is bounded only by parseInboundMessage's
 * MAX_PLAINTEXT_BYTES guard — which holds only because `.map` allocates from the array that actually
 * arrived, never from a claimed count.
 *
 * Its messages name the failure CATEGORY only, never interpolating `question` / `header` / `label` /
 * `description` (untrusted claude-authored text) or `conversation_id` / `question_batch_id` (a routing key
 * and an unguessable nonce). The message reaches a caller's catch, so a value echoed here could ride into
 * a log this decoder is otherwise careful never to write.
 */
function parseQuestionShownPayload(payload: unknown): QuestionShownPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed question_shown payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const question_batch_id = requireString(payload, 'question_batch_id')
  const rawQuestions = payload.questions
  if (!Array.isArray(rawQuestions)) {
    throw new WireDecodeError('malformed questions')
  }
  const questions = rawQuestions.map(parseQuestion)
  return { conversation_id, question_batch_id, questions }
}

/**
 * Narrow an opaque payload into a QuestionDismissedPayload (#894) — the frame that retires a
 * `question_shown` batch. Fail-closed like parseModalDismissedPayload, whose structure this copies
 * exactly, MINUS its closed-enum check: an isRecord guard then three requireString calls, returning the
 * three known fields. Unknown keys are tolerated (forward-compat) but NOT copied, which is also what
 * keeps a stray `conversation_id` from riding into a consumer that would then hold two correlation keys
 * able to disagree. This frame carries none, deliberately — the batch nonce is the sole one.
 *
 * **`source` goes through plain requireString and is NOT closed to WireModalSource, unlike its modal
 * twin one screen up.** That is the one intended divergence between the two functions, so do not
 * tighten them toward each other. Two of the producer's three terminal paths — a caller disconnect and
 * a daemon shutdown — have no member in `{remote, local, timeout}` at all, and its arbiter cannot tell
 * the three apart, so all three emit `no_answer`: closing the enum would reject the only traffic that
 * exists. This decoder polices TYPE, not membership, and the fail-closed READING rule that makes the
 * open type safe belongs to the consumer — an unrecognised `source` means *resolved, cause unknown*,
 * never an answer. `outcome` is likewise an opaque producer sentinel carried verbatim.
 *
 * Its messages name the failure CATEGORY only: `question_batch_id` is an unguessable nonce, and
 * `outcome` / `source` are producer-controlled strings with no business in an error a caller may log
 * (daemonConnection catches WireDecodeError, so a value echoed here rides into that caller's log).
 */
function parseQuestionDismissedPayload(payload: unknown): QuestionDismissedPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed question_dismissed payload')
  }
  const question_batch_id = requireString(payload, 'question_batch_id')
  const outcome = requireString(payload, 'outcome')
  const source = requireString(payload, 'source')
  return { question_batch_id, outcome, source }
}

/**
 * Narrow one opaque row into a WireSlashCommand (#936) — one verb the workspace will accept. Fail-closed
 * like parseBackgroundTask, whose four-field shape this scales to five: an isRecord guard, three required
 * strings, then the SAME-SHAPED-OPPOSITE-CONTRACT pair one field apart — `aliases` through
 * requireStringArray (never `null`), `truncated_fields` through requireStringArrayOrNull (`null` is a
 * VALID VALUE meaning nothing was cut). Returns a fresh five-field literal, so unknown server-added keys
 * are tolerated (forward-compat) but NOT copied through, which also makes it prototype-pollution-safe.
 *
 * FOUR CHECKS THAT DELIBERATELY DO NOT EXIST HERE, each of which would fail-close valid traffic:
 *
 *   - NO charset or identifier validation on `name`. One measured name is `__remote-workflow`, so a name
 *     is not an identifier and nothing downstream may key a cache, a memo or a lookup path by one either.
 *   - NO length check on any of the four strings. The daemon bounds them at construction and
 *     parseInboundMessage's MAX_PLAINTEXT_BYTES guard backstops the frame; a third bound here would be a
 *     client-invented one to keep in agreement (the parseQuestionShownPayload / requireNumber posture).
 *   - NO trim, normalise, strip or re-encode. The strings are WORKSPACE-AUTHORED — whoever wrote the
 *     repository wrote them, a LOWER trust tier than the claude-authored strings the question/model arms
 *     carry — and the daemon bounds them without sanitizing them. They are carried VERBATIM, embedded
 *     newlines included (`0x0a` is the only sub-`0x20` byte measured across the capture's 51 entries).
 *     Rewriting a `name` here would make the two ends disagree about what the command is CALLED; the
 *     escaping is owed at the render boundary (#681), which is this client's, not the daemon's.
 *   - NO closed set on the `truncated_fields` element names (parseBackgroundTask's rule verbatim).
 *
 * An EMPTY `argument_hint` is ORDINARY DATA — empty on 33 of the capture's 51 entries — so nothing may
 * read `''` as missing. Its messages name the failure CATEGORY only and never the row INDEX: every field
 * here is untrusted text, a `description` can carry a newline and forge a log record if one ever reaches
 * a log, and an index would be a weak oracle over the menu that buys nothing.
 */
function parseSlashCommand(payload: unknown): WireSlashCommand {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed slash command')
  }
  const name = requireString(payload, 'name')
  const argument_hint = requireString(payload, 'argument_hint')
  const description = requireString(payload, 'description')
  const aliases = requireStringArray(payload, 'aliases')
  const truncated_fields = requireStringArrayOrNull(payload, 'truncated_fields')
  return { name, argument_hint, description, aliases, truncated_fields }
}

/**
 * Narrow an opaque payload into a SlashCommandListPayload (#936) — the whole slash-command menu for one
 * conversation, carried in ONE frame. The structural twin of parseBackgroundTaskRosterPayload, and its
 * shape is copied deliberately: an isRecord guard, a required `conversation_id`, the inline
 * Array.isArray-then-`raw.map` over the rows, and a plain requireNumber for the dropped count.
 *
 * THE SAME TRAP AS THE ROSTER'S, and it is invisible in the code below: within THIS ONE FRAME
 * `commands: null` FAILS CLOSED while a ROW's `truncated_fields: null` is a VALID VALUE returned as
 * `null`. `Array.isArray(null)` is `false`, which is precisely what fails the first closed, and an omitted
 * key (`undefined`) fails the same way. The daemon settles the asymmetry: MarshalJSON normalises a nil
 * `commands` to `[]` so an empty menu never serialises as `null`, and deliberately does NOT normalise a
 * row's `truncated_fields` the same way, because nil and `[]` say the identical thing there.
 *
 * An EMPTY `commands` array is VALID and decodes to `[]` — the POSITIVE STATEMENT that claude offered
 * nothing, which a consumer must keep distinguishable from the `null` an unobserved frame yields. Note
 * the contrast with parseQuestionShownPayload, whose empty array is OUT OF CONTRACT: the two read alike
 * and say opposite things. Order is preserved from the wire (claude's own). One bad row throws the whole
 * frame closed rather than yielding a partial menu.
 *
 * `dropped_commands` decodes through plain requireNumber, correct PRECISELY BECAUSE the Go field has no
 * `omitempty`: the key is always written, so `0` is a genuine value carried as `0` and never
 * truthiness-tested, while an absent key is a real defect. NOTHING CROSS-CHECKS IT AGAINST
 * `commands.length` AND NOTHING CAPS THE ENTRY COUNT. Two producer cuts feed the number — an entry cap
 * and a frame-level byte bound, both cutting from the tail — and the byte bound can fire BEFORE the entry
 * cap is reached, so a non-zero count arrives beside ANY number of entries and list length is no evidence
 * of completeness. `commands.length + dropped_commands` is the menu's true size, not something to
 * reconcile. The count is also workspace- and version-dependent by design (51 entries measured in one
 * repository, 74 in another), so a client-side entry cap would fail-close valid traffic rather than
 * defend anything; the frame cannot arrive unbounded regardless, since MAX_PLAINTEXT_BYTES gates the
 * plaintext before any parse and `raw.map` allocates from the array that ACTUALLY arrived rather than
 * from the claimed count.
 *
 * Returns a fresh three-field literal; unknown server-added keys are tolerated but not copied through —
 * including a HOISTED `truncated_fields`, which this frame deliberately does not have (a cut is a
 * property of one row and rides that row). Its messages name the failure CATEGORY only: a
 * `conversation_id` correlates a conversation, and every string on a row is untrusted workspace text.
 */
function parseSlashCommandListPayload(payload: unknown): SlashCommandListPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed slash_command_list payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const raw = payload.commands
  if (!Array.isArray(raw)) {
    throw new WireDecodeError('malformed commands list')
  }
  const commands = raw.map(parseSlashCommand)
  const dropped_commands = requireNumber(payload, 'dropped_commands')
  return { conversation_id, commands, dropped_commands }
}

/**
 * Narrow one opaque row into a WireModelOption (#972) — one identity claude will accept for this
 * conversation. Fail-closed like parseSlashCommand, whose five-field shape this scales to six: an
 * isRecord guard, three required strings, a required boolean, and the SAME-SHAPED-OPPOSITE-CONTRACT
 * array pair — `effort_levels` through requireStringArray (never `null`), `truncated_fields` through
 * requireStringArrayOrNull (`null` is a VALID VALUE meaning nothing was cut for this row). Returns a
 * fresh six-field literal, so unknown server-added keys are tolerated (forward-compat) but NOT copied
 * through, which also makes it prototype-pollution-safe.
 *
 * EVERY STRING GOES THROUGH requireString, NONE THROUGH requireNonEmptyString, and that is a decision
 * rather than an oversight. The daemon's committed all-zero fixture is LEGAL TRAFFIC: no key on either
 * struct carries `omitempty`, so an empty `resolved_model`, `value` or `display_name` is a real value.
 * The attachment_stored argument for the tighter helper — an empty id is what a truncated frame looks
 * like — does not transfer to a display label.
 *
 * `supports_auto_mode` is checked on the TYPE, never truthiness: claude refuses `auto` permission mode
 * per model, and an absent key in claude's own reply decodes daemon-side to `false`, so `false` is the
 * CORRECT reading rather than a missing one. A coercing decoder would wave through the string `'true'`.
 *
 * FOUR CHECKS THAT DELIBERATELY DO NOT EXIST HERE, each of which would fail-close valid traffic:
 *
 *   - NO charset, identifier or parseability check on `value`. It is the ARGUMENT you pass, not a dated
 *     identifier: the measured entries are `default`, `opus[1m]`, `claude-fable-5[1m]`, `sonnet` and
 *     `haiku` — a literal, a bare alias, or a bracketed variant — so splitting one on `-` to derive a
 *     family yields nothing usable and no consumer may try.
 *   - NO length check on any of the three strings. The daemon bounds them at construction and
 *     parseInboundMessage's MAX_PLAINTEXT_BYTES guard backstops the frame; a third bound here would be a
 *     client-invented one to keep in agreement (the parseSlashCommand posture).
 *   - NO trim, normalise, strip or re-encode. The strings are CLAUDE-AUTHORED — they crossed the
 *     subprocess trust boundary, a HIGHER trust tier than parseSlashCommand's workspace-authored ones —
 *     and the daemon bounds them WITHOUT sanitizing them, so they stay untrusted, model-influenced text
 *     all the way here. `resolved_model` arrives as a literal `<unmeasured>` on four of the committed
 *     fixture's five rows, angle brackets included, which is exactly the byte a render sink is tempted
 *     by; the escaping is owed at that sink, and it is a later slice's.
 *   - NO closed set on either array's elements. For `truncated_fields` that is parseSlashCommand's rule
 *     verbatim. For `effort_levels` it also answers a DIRECTION HAZARD: the daemon's INBOUND
 *     `validEffort` enum is closed at the five levels claude returns today while `validModel` was
 *     widened, so a level claude adds later is published here and refused inbound — closing the set at
 *     this decoder would discard the very evidence a consumer needs to handle that refusal.
 *
 * A CUT `value` IS LOAD-BEARING DATA, not decoration, and it is why the no-validation posture above is
 * not merely inherited: `value` is the one field a client sends BACK, and `validModel` is a
 * charset-and-length rule rather than a membership check against the published list — so a `value` cut
 * mid-token (`claude-fable-5[1m]` → `claude-fable-5`) stays inside the rule and is ACCEPTED. The operator
 * picks one row and gets a different model, with no error frame anywhere on the path. Carrying the cut
 * text and its `truncated_fields` report intact is the only thing that lets a consumer say so.
 *
 * Its messages name the failure CATEGORY only and never the row INDEX: every string here is untrusted
 * text, and an index would be a weak oracle over the menu that buys nothing.
 */
function parseModelOption(payload: unknown): WireModelOption {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed model option')
  }
  const resolved_model = requireString(payload, 'resolved_model')
  const value = requireString(payload, 'value')
  const display_name = requireString(payload, 'display_name')
  const effort_levels = requireStringArray(payload, 'effort_levels')
  const supports_auto_mode = requireBoolean(payload, 'supports_auto_mode')
  const truncated_fields = requireStringArrayOrNull(payload, 'truncated_fields')
  return {
    resolved_model,
    value,
    display_name,
    effort_levels,
    supports_auto_mode,
    truncated_fields,
    ...optionalAgent(payload),
    // `family` (#1649) is kept as sent — daemon text, compared by equality only downstream.
    ...(payload.family === undefined ? {} : { family: requireString(payload, 'family') })
  }
}

/**
 * Narrow an opaque payload into a ModelListPayload (#972) — every identity claude will accept for one
 * conversation, carried in ONE frame. The structural twin of parseSlashCommandListPayload, and its shape
 * is copied deliberately: an isRecord guard, a required `conversation_id`, the inline
 * Array.isArray-then-`raw.map` over the rows, and a plain requireNumber for the dropped count.
 *
 * THE SAME TRAP AS THE SIBLING'S, and it is invisible in the code below: within THIS ONE FRAME
 * `models: null` FAILS CLOSED while a ROW's `truncated_fields: null` is a VALID VALUE returned as `null`.
 * `Array.isArray(null)` is `false`, which is precisely what fails the first closed, and an omitted key
 * (`undefined`) fails the same way. The daemon settles the asymmetry: MarshalJSON normalises a nil
 * `models` to `[]` so an empty menu never serialises as `null`, and deliberately does NOT normalise a
 * row's `truncated_fields` the same way, because nil and `[]` say the identical thing there.
 *
 * An EMPTY `models` array is VALID and decodes to `[]` — the POSITIVE STATEMENT that claude offered
 * nothing, which a consumer must keep distinguishable from the `null` an unobserved frame yields. Note
 * that this is NOT the argument behind a row's empty `effort_levels`, which is a COLLAPSE rather than a
 * statement: the two read alike within one frame and mean different things. Order is preserved from the
 * wire (claude's own, truncated from the tail). One bad row throws the whole frame closed rather than
 * yielding a partial menu — a half-populated model menu is the outcome this narrower exists to prevent.
 *
 * `dropped_models` decodes through plain requireNumber, correct PRECISELY BECAUSE the Go field has no
 * `omitempty`: the key is always written, so `0` is a genuine value carried as `0` and never
 * truthiness-tested, while an absent key is a real defect. NOTHING CROSS-CHECKS IT AGAINST
 * `models.length` AND NOTHING CAPS THE ENTRY COUNT. The producer's ten-entry cap is a DAEMON-SIDE
 * PRODUCER CAP rather than a wire constant — it may change without any change to this contract — so a
 * client must never hardcode it, treat a list of exactly ten as a signal, or derive it from anything but
 * this field; `models.length + dropped_models` is the menu's true size, not something to reconcile. The
 * committed fixture does not even satisfy the producer's own stated invariant (five rows beside a count
 * of two), because it pins shape rather than capturing live traffic. Nor is the number range-checked:
 * JSON carries no NaN or Infinity, so `typeof === 'number'` is complete against the wire, and a client
 * rule about which numbers are plausible would be a second place the count's validity is decided. The
 * frame cannot arrive unbounded regardless, since MAX_PLAINTEXT_BYTES gates the plaintext before any
 * parse and `raw.map` allocates from the array that ACTUALLY arrived rather than from the claimed count.
 *
 * Returns a fresh three-field literal; unknown server-added keys are tolerated but not copied through —
 * including a HOISTED `truncated_fields`, which this frame deliberately does not have (a cut is a
 * property of one row and rides that row). Its messages name the failure CATEGORY only: a
 * `conversation_id` correlates a conversation, and every string on a row is untrusted claude-authored
 * text.
 */
function parseModelListPayload(payload: unknown): ModelListPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed model_list payload')
  }
  const conversation_id = requireString(payload, 'conversation_id')
  const raw = payload.models
  if (!Array.isArray(raw)) {
    throw new WireDecodeError('malformed models list')
  }
  const models = raw.map(parseModelOption)
  const dropped_models = requireNumber(payload, 'dropped_models')
  return { conversation_id, models, dropped_models }
}

/**
 * Narrow an opaque payload into an AttachmentStoredPayload (#964) — the upload leg's one positive
 * terminal. The shape of parseQuestionDismissedPayload minus two fields: an isRecord guard, then the
 * single required key, returning a fresh one-field literal so unknown server-added keys are tolerated
 * (forward-compat) but NOT copied through, which also makes it prototype-pollution-safe.
 *
 * THE ONE FIELD GOES THROUGH requireNonEmptyString, NOT requireString, and that is the only interesting
 * line here. A truncated or hostile frame decodes daemon-side to the zero value, so `attachment_id: ''`
 * is the shape a bad frame actually takes; accepting it would yield a success naming no transfer. See
 * the helper's own block for why requireString is right everywhere else and wrong here.
 *
 * WHAT IS DELIBERATELY NOT CHECKED, each of which would fail-close valid traffic:
 *
 *   - NO shape validation on the id. Upstream publishes a canonical lowercase UUIDv4, where lowercase is
 *     load-bearing because the id becomes a directory name and only a lowercase alphabet keeps the
 *     id-to-directory mapping injective on a case-insensitive filesystem (APFS is one by default). That
 *     rule binds the side that MINTS ids — the outbound leg — not this one. Here the contract is
 *     recognise-or-ignore against ids this client itself chose, so re-validating the shape of a value we
 *     originated buys nothing and fail-closes a valid frame the moment the two copies disagree.
 *   - NO length check (the parseSlashCommand posture): the daemon bounds the field at construction and
 *     parseInboundMessage's MAX_PLAINTEXT_BYTES guard backstops the whole frame ahead of this call, so a
 *     third bound here would be a client-invented one to keep in agreement.
 *   - NO reject list for `__proto__` / `constructor` / `prototype`. This function builds no container
 *     FROM the value — RESERVED_MAP_KEYS exists because optionalStringMap keys an object by wire strings,
 *     which is a different hazard — and a fresh literal plus JSON.parse are both prototype-safe. The
 *     obligation lands on the CONSUMER (#861): look the id up in a `Map` keyed by ids this client minted,
 *     never as `pending[id]` on a plain object, where `__proto__` reads back a truthy Object.prototype
 *     and resolves a transfer that does not exist.
 *
 * Its message names the failure CATEGORY and the static field name only. The id is not a secret — upstream
 * states plainly that receiving this frame is not a capability — but daemonConnection catches
 * WireDecodeError into a caller that may log it, so a value echoed here would ride into that log.
 */
function parseAttachmentStoredPayload(payload: unknown): AttachmentStoredPayload {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed attachment_stored payload')
  }
  const attachment_id = requireNonEmptyString(payload, 'attachment_id')
  return { attachment_id }
}

/**
 * Narrow an opaque payload into a RetrievedAttachmentChunk (#998) — one slice of the retrieval leg's
 * byte stream. parseAttachmentStoredPayload's shape with seven more fields and a base64 decode: an
 * isRecord guard, then each required key, returning a fresh EIGHT-KEY literal so unknown server-added
 * keys are tolerated (forward-compat) but NOT copied through, which also makes it
 * prototype-pollution-safe. Every failure throws; nothing partial is ever returned.
 *
 * THE BASE64 DECODE HAPPENS HERE, at the untrusted boundary, so the reassembler stays byte-pure —
 * parseDebugBundleChunkPayload's posture. base64StdDecode is STRICT (it decodes, then requires the input
 * to be the exact base64-std re-encoding of those bytes), so Node's lenient Buffer.from — which strips
 * non-alphabet characters and tolerates missing padding — cannot turn a corrupt frame into a plausible
 * SHORTER file that then fails the whole transfer's digest for no legible reason.
 *
 * WHICH FIELDS GET WHICH NARROWER IS THE INTERESTING PART, and the asymmetry is deliberate:
 *
 *   - `attachment_id` goes through requireNonEmptyString for #964's reason, which transfers verbatim:
 *     every key is optional to Go's encoding/json, so a truncated or hostile frame arrives with the
 *     field present, typed and EMPTY, and `''` names no transfer any client ever started.
 *   - `filename` / `mime_type` / `sha256` get plain requireString — TYPE ONLY. Emptiness is not a
 *     modelled failure on any of the three, and a second emptiness rule would fail-close valid traffic
 *     for a rule this layer never agreed to enforce. `sha256` gets no 64-character length check either:
 *     this layer declares shapes and validates none, and integrity belongs to #995, against the
 *     assembled bytes rather than one slice.
 *   - `index` and `total_chunks` get an INTEGER check on top of requireNumber, because the daemon types
 *     both `integer` and a fractional `index` would address nothing in an index-addressed accumulator.
 *     `total_chunks >= 1` is the daemon's own bound and it is what makes `[0, total_chunks)` a non-empty
 *     range; it is narrowed FIRST so the index range check has its bound.
 *
 * NO UPPER BOUND ON `total_chunks` OR `size`, deliberately. This function allocates from neither — its
 * one allocation is the base64 decode of `data`, already bounded by parseInboundMessage's
 * MAX_PLAINTEXT_BYTES guard ahead of it. Upstream's "bound what you allocate from an outbound size /
 * total_chunks" binds the component that pre-allocates the assembly buffer (#995), which has a
 * daemon-published invariant available rather than an invented ceiling; see the union member's docblock.
 *
 * NO SHAPE VALIDATION ON `attachment_id`, for parseAttachmentStoredPayload's reason: the canonical
 * lowercase-UUIDv4 rule binds the side that MINTS ids, and re-validating a value this client originated
 * fail-closes a valid frame the moment the two copies disagree.
 *
 * Its messages name the failure CATEGORY and a STATIC field name only. That matters more here than on
 * its neighbours: the natural phrasing of a range rejection interpolates the two daemon-supplied numbers,
 * and daemonConnection catches WireDecodeError into a caller that may log it. The unit tests assert the
 * exact message text, not merely the error class, so a later interpolation reddens.
 */
function parseAttachmentChunkPayload(payload: unknown): RetrievedAttachmentChunk {
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed attachment_chunk payload')
  }
  const attachment_id = requireNonEmptyString(payload, 'attachment_id')
  const total_chunks = requireNumber(payload, 'total_chunks')
  if (!Number.isInteger(total_chunks) || total_chunks < 1) {
    throw new WireDecodeError('invalid attachment_chunk total_chunks')
  }
  const index = requireNumber(payload, 'index')
  if (!Number.isInteger(index) || index < 0 || index >= total_chunks) {
    throw new WireDecodeError('invalid attachment_chunk index')
  }
  const filename = requireString(payload, 'filename')
  const mime_type = requireString(payload, 'mime_type')
  const size = requireNumber(payload, 'size')
  const sha256 = requireString(payload, 'sha256')
  const data = base64StdDecode(requireString(payload, 'data'))
  // Wire order, for readability against the daemon's own field table — this is a decoded object, so
  // key order carries no contract the way an outbound builder's does.
  return { attachment_id, index, total_chunks, filename, mime_type, size, sha256, data }
}

/**
 * Map a daemon `error` frame's payload onto a client-owned DaemonErrorOutcome (#965).
 *
 * TOTAL BY CONSTRUCTION: it never throws and has no failure return, which INVERTS this module's usual
 * fail-closed idiom (`throw new WireDecodeError` for a malformed payload of a claimed type, as
 * parseMessagePayload does) — deliberately, and a later reader should not "fix" it into conformity.
 * daemonConnection wraps parseInboundMessage in a bare `catch { return }` that drops the frame with no
 * event and no log, so a throw here would silently kill all four behaviours the `daemon-error` case
 * drives: the set_session_settings rejection correlation (#269), the create_workspace_folder rejection
 * correlation (#396), reassembler.fail('daemon-error') for an in-flight debug bundle (#116), and the
 * modal-answer FIFO rejection (#248). None of the four reads error content — each correlates on
 * `in_reply_to` and emits a client-minted id — so all four must fire for EVERY `error` envelope, however
 * mangled its payload. AN ERROR FRAME IS TERMINAL BECAUSE IT ARRIVED, NOT BECAUSE ITS PAYLOAD PARSED.
 * Throwing would have handed a hostile daemon a one-frame kill switch for those four.
 *
 * The `switch` IS the trust boundary. It COMPARES the untrusted string against client-owned constants
 * and RETURNS a client-owned constant; the daemon's string is never the operand of an index, a join or
 * a resolve. A `Record`-keyed table is the shape to avoid for exactly that reason — it would make
 * untrusted text a lookup path, the thing CLAUDE.md forbids. Inline literal comparison mirrors
 * parseTurnStatePayload's `state` check, this module's idiom for narrowing a closed enum without a cast.
 *
 * Nothing is retained from the payload, so `code` needs no length bound: MAX_LOGGED_TYPE_CHARS exists
 * because the unmodeled branch LOGS a wire-supplied string, and nothing wire-supplied is logged or kept
 * here. The frame-level MAX_PLAINTEXT_BYTES guard at the top of parseInboundMessage already bounds a
 * hostile oversized frame before this runs.
 */
function narrowDaemonErrorOutcome(payload: unknown): DaemonErrorOutcome {
  // isRecord rejects null and arrays; a string / number / absent payload lands here too. Reading
  // `payload.code` off a JSON.parse result is prototype-safe — a `__proto__` key round-trips as an
  // ordinary OWN data property, and this never ASSIGNS, which is the only real hazard.
  if (!isRecord(payload)) return 'unclassified'
  const code = payload.code
  if (typeof code !== 'string') return 'unclassified'
  switch (code) {
    case 'attachment.invalid_chunk':
      return 'attachment-invalid-chunk'
    case 'attachment.integrity_failed':
      return 'attachment-integrity-failed'
    case 'attachment.too_large':
      return 'attachment-too-large'
    case 'attachment.too_many_uploads':
      return 'attachment-too-many-uploads'
    case 'attachment.storage_failed':
      return 'attachment-storage-failed'
    case 'message.too_long':
      return 'message-too-long'
    case 'attachment.not_found':
      return 'attachment-not-found'
    case 'attachment.stream_aborted':
      return 'attachment-stream-aborted'
    default:
      return 'unclassified'
  }
}

/**
 * Map a daemon `error` frame's payload onto a client-owned HistoryRejectReason (#1222), or `undefined`
 * when the code is outside the history verb's published set.
 *
 * narrowDaemonErrorOutcome's twin, sharing every property that matters and diverging in exactly one:
 * it returns `undefined` rather than an `unclassified` member. That is not a weaker contract — it is
 * the honest one. This narrower answers "is this ONE VERB's refusal, and which", where its neighbour
 * answers "what class of failure is this" over every frame; a code outside this set is not an
 * unclassified history reject, it is not a history reject at all. § Page size publishes the case that
 * makes this reachable rather than theoretical: an entry too large for any page is emitted anyway and
 * the daemon's own transport answers `message.too_long`, which its neighbour DOES classify. The single
 * consumer maps the absence to a terminal, so a correlated refusal always settles the ask.
 *
 * TOTAL BY CONSTRUCTION: it never throws and has no failure return, for the reason its neighbour's
 * docblock states in full — an error frame is terminal because it ARRIVED, not because its payload
 * parsed, and a throw here would silently kill every consumer of the `daemon-error` kind and hand a
 * hostile daemon a one-frame kill switch.
 *
 * The `switch` IS the trust boundary: the untrusted string is a COMPARAND against client-owned literals
 * and is then dropped, never an index, a join or a resolve, and nothing is retained from the payload —
 * so `code` needs no length bound, and the frame-level MAX_PLAINTEXT_BYTES guard already bounds a
 * hostile oversized frame before this runs.
 */
function narrowHistoryRejectReason(payload: unknown): HistoryRejectReason | undefined {
  // isRecord rejects null and arrays; a string / number / absent payload lands here too. Reading
  // `payload.code` off a JSON.parse result is prototype-safe — a `__proto__` key round-trips as an
  // ordinary OWN data property, and this never ASSIGNS, which is the only real hazard.
  if (!isRecord(payload)) return undefined
  const code = payload.code
  if (typeof code !== 'string') return undefined
  switch (code) {
    case 'conversation.not_found':
      return 'conversation-not-found'
    case 'history.invalid_request':
      return 'history-invalid-request'
    case 'history.invalid_page_size':
      return 'history-invalid-page-size'
    case 'history.invalid_cursor':
      return 'history-invalid-cursor'
    case 'history.unavailable':
      return 'history-unavailable'
    default:
      return undefined
  }
}

/**
 * Map a daemon `error` frame's payload onto a client-owned SystemPromptRejectReason (#1249), or
 * `undefined` when the code is outside the `set_system_prompt` verb's two published rejects.
 *
 * narrowHistoryRejectReason's twin, sharing every property that matters: it returns `undefined` rather
 * than an `unclassified` member (this narrower answers "is this THIS VERB's refusal, and which", where
 * narrowDaemonErrorOutcome answers "what class of failure is this" over every frame), and the single
 * consumer maps that absence to a terminal so a correlated refusal always settles the write.
 *
 * TOTAL BY CONSTRUCTION: it never throws and has no failure return, for the reason both neighbours'
 * docblocks state — an error frame is terminal because it ARRIVED, not because its payload parsed, and
 * a throw here would silently kill every consumer of the `daemon-error` kind and hand a hostile daemon
 * a one-frame kill switch.
 *
 * The `switch` IS the trust boundary: the untrusted string is a COMPARAND against client-owned
 * literals and is then dropped, never an index, a join or a resolve, and nothing is retained from the
 * payload — so `code` needs no length bound, and the frame-level MAX_PLAINTEXT_BYTES guard already
 * bounds a hostile oversized frame before this runs.
 */
function narrowSystemPromptRejectReason(payload: unknown): SystemPromptRejectReason | undefined {
  // isRecord rejects null and arrays; a string / number / absent payload lands here too. Reading
  // `payload.code` off a JSON.parse result is prototype-safe — a `__proto__` key round-trips as an
  // ordinary OWN data property, and this never ASSIGNS, which is the only real hazard.
  if (!isRecord(payload)) return undefined
  const code = payload.code
  if (typeof code !== 'string') return undefined
  switch (code) {
    case 'protocol.malformed':
      return 'protocol-malformed'
    case 'conversation.not_found':
      return 'conversation-not-found'
    default:
      return undefined
  }
}

/**
 * Map a daemon `error` frame's payload onto the client-owned MCPStatusRejectReason (#1578), or
 * `undefined` outside it. narrowSystemPromptRejectReason's twin in every property: total, never throws,
 * the untrusted `code` is a comparand against one client-owned literal and is then dropped.
 */
function narrowMCPStatusRejectReason(payload: unknown): MCPStatusRejectReason | undefined {
  if (!isRecord(payload)) return undefined
  return payload.code === 'mcp_status.unavailable' ? 'mcp-status-unavailable' : undefined
}

/**
 * The daemon's minimum app version as the window may see it (#1613): ASCII digits only, exactly
 * three parts, at most five digits each, so at most 17 characters. Anchored, and linear, so a
 * hostile string costs one pass. Everything else, including a pre-release suffix, is rejected.
 */
const MIN_CLIENT_VERSION_PATTERN = /^[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}$/

/**
 * Recognise the app-too-old rejection (#1613), or `undefined` for any other code. The untrusted
 * `code` is a comparand against one client-owned literal, like `auth.invalid_token`. The optional
 * `min_client_version` is kept only when it matches MIN_CLIENT_VERSION_PATTERN; a malformed one
 * degrades to a rejection with no version, never a dropped rejection. Total, never throws.
 */
function narrowUpdateRequired(payload: unknown): { minClientVersion?: string } | undefined {
  if (!isRecord(payload) || payload.code !== 'client.update_required') return undefined
  const min = payload.min_client_version
  return typeof min === 'string' && MIN_CLIENT_VERSION_PATTERN.test(min) ? { minClientVersion: min } : {}
}

function parseBannerPayload(payload: unknown): BannerPayload {
  if (!isRecord(payload)) throw new WireDecodeError('malformed banner payload')
  return {
    conversation_id: requireString(payload, 'conversation_id'),
    level: requireString(payload, 'level'),
    text: requireString(payload, 'text'),
    stops_turn: requireBoolean(payload, 'stops_turn'),
    truncated: requireBoolean(payload, 'truncated')
  }
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
  diagnosticLog?: DiagnosticLog,
  observeEnvelope?: (envelope: Envelope) => void
): InboundDaemonMessage | null {
  // Size guard (AC4): decodeEnvelope does not size-check, so this is the only thing that makes an
  // oversized-but-valid-JSON frame fail closed here. The upstream Noise transport already bounds the
  // plaintext, but this boundary re-checks what it owns rather than trusting the caller (the unit
  // test drives this function directly, and a future driver change must not silently un-bound it).
  if (plaintext.length > MAX_PLAINTEXT_BYTES) {
    throw new WireDecodeError('inbound plaintext exceeds max size')
  }
  const envelope = decodeEnvelope(plaintext)
  // Replay position belongs to the admitted envelope, even when payload narrowing later fails.
  observeEnvelope?.(envelope)
  // Each log fires AFTER the modeled envelope has fully narrowed, so the throw path stays unlogged: a
  // frame that fails to narrow throws first and leaves no record. Optional chaining short-circuits the
  // whole call (including hashPlaintext) when no logger is injected — absent-logger costs nothing.
  switch (envelope.type) {
    case 'reply_suggestion': {
      const payload = envelope.payload
      const text = isRecord(payload) ? payload.suggested_reply : undefined
      // Reject lone UTF-16 surrogates as well as actual invalid UTF-8 caught by decodeEnvelope.
      const validText = text === null || (typeof text === 'string' && text.trim() !== '' &&
        !/[\r\n\u2028\u2029]/u.test(text) &&
        Buffer.from(text, 'utf8').toString('utf8') === text && Buffer.byteLength(text, 'utf8') <= 1024)
      if (!isRecord(payload) || typeof payload.conversation_id !== 'string' ||
          typeof payload.session_id !== 'string' || typeof payload.revision !== 'number' ||
          !Number.isSafeInteger(payload.revision) || payload.revision <= 0 || !validText ||
          (text !== null && typeof text !== 'string')) {
        diagnosticLog?.event({ event: 'inbound-rejected', code: 'reply-suggestion-invalid' })
        throw new WireDecodeError('invalid reply suggestion')
      }
      diagnosticLog?.event({ event: 'inbound-decoded', code: 'reply_suggestion',
        bytes: plaintext.length, hash: hashPlaintext(plaintext) })
      return { kind: 'reply-suggestion', replySuggestion: {
        conversation_id: payload.conversation_id, session_id: payload.session_id,
        revision: payload.revision, suggested_reply: text
      } }
    }
    case 'resync':
      return null
    case 'message': {
      const message = parseMessagePayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'message',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'message', message, ts: envelope.ts }
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
    case 'host_system_prompt': {
      const payload = envelope.payload
      if (!isRecord(payload) || typeof payload.system_prompt !== 'string' ||
          typeof payload.default_system_prompt !== 'string' ||
          Buffer.byteLength(payload.system_prompt, 'utf8') > MAX_SYSTEM_PROMPT_BYTES ||
          Buffer.byteLength(payload.default_system_prompt, 'utf8') > MAX_SYSTEM_PROMPT_BYTES) {
        throw new WireDecodeError('invalid host system prompt payload')
      }
      diagnosticLog?.event({ event: 'inbound-decoded', code: 'host_system_prompt' })
      return { kind: 'host-system-prompt', inReplyTo: envelope.in_reply_to,
        hostSystemPrompt: { system_prompt: payload.system_prompt, default_system_prompt: payload.default_system_prompt } }
    }
    case 'system_prompt': {
      // Narrow BEFORE logging so a malformed reply throws first and leaves no record — and on this
      // frame that ordering is the AC rather than a convention it shares with its neighbours. NO
      // decoded field is ever logged: not the prompt, not the status, only the frame's byte length and
      // a one-way hash, reusing the existing content-free field set (no new DiagnosticEvent field, so
      // the renderer-side allowlist pin is untouched).
      //
      // THE PROMPT REACHES NO SINK ON ANY PATH, INCLUDING THE FAILURE PATH, and the check is against
      // what a caught or wrapped error can QUOTE rather than only the fields this line names.
      // parseSystemPromptPayload's messages carry the failure category and the client-owned field
      // constant only, and the sole caller's catch (daemonConnection's `parseInboundMessage` try)
      // drops its caught object outright — so a rejected frame leaves neither a diagnostic record nor
      // an error string an operator could ship off-box in a debug bundle.
      const systemPrompt = parseSystemPromptPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'system_prompt',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      // Propagate the ALREADY-decoded Envelope.in_reply_to — the reply's ONLY correlation handle,
      // since it carries no conversation id of its own. `undefined` when the frame omits it, which
      // makes the consumer's correlation fail closed one layer up.
      return { kind: 'system-prompt', systemPrompt, inReplyTo: envelope.in_reply_to }
    }
    case 'history_page': {
      // Narrow BEFORE logging so a malformed page throws first and leaves no record. NO decoded field
      // is ever logged — not the cursor, not an entry's `type`, `id`, `ts` or `payload` — only the
      // frame's byte length + one-way hash, reusing the existing content-free field set. The cursor is
      // the one worth naming: the daemon's own reject messages are static and echo nothing from the
      // request, and logging what came back would undo that from this side. Mirrors the
      // session_settings arm above.
      const wirePage = parseHistoryPagePayload(envelope.payload)
      const pageHash = hashPlaintext(plaintext)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'history_page',
        bytes: plaintext.length,
        hash: pageHash
      })
      // The second, per-entry stage (#1227): decode each entry's payload against the live-lane parser
      // for its type and drop the ones the timeline cannot draw. It runs AFTER the line above and never
      // throws, so the narrow-before-logging invariant is untouched — the throwing narrow is still the
      // one on the line before the log.
      const { page: historyPage, skipped } = decodeHistoryPage(wirePage)
      if (skipped > 0) {
        // ONE AGGREGATED LINE PER PAGE, NEVER ONE PER ENTRY, and that is a security constraint. A page
        // holds ~1200 entries inside one frame, a hostile daemon can send them all malformed and repeat
        // the frame, and a per-entry line would hand it a three-orders-of-magnitude log-write amplifier
        // against a disk-backed sink. Every field is content-free and already in the allowlisted set:
        // `count` is this client's own reading of how many rows it could not draw — not daemon content —
        // and `hash` is the page line's, so an operator can correlate the two. Deliberately absent: the
        // skipped entries' `type`, `id`, `ts`, any payload field, and any parser message.
        diagnosticLog?.event({
          event: 'inbound-decode-skipped',
          code: 'history_page_entry',
          count: skipped,
          hash: pageHash
        })
      }
      // Propagate the ALREADY-decoded Envelope.in_reply_to — the page's ONLY correlation handle, since
      // it names no conversation. `undefined` when the frame omits it, which makes the consumer's
      // lookup fail closed and drop the page rather than attribute it to a guess.
      return { kind: 'history-page', historyPage, inReplyTo: envelope.in_reply_to }
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
      return { kind: 'assistant-delta', delta, ts: envelope.ts }
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
      return { kind: 'turn-end', turnEnd, ts: envelope.ts }
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
      return { kind: 'turn-state', turnState, ts: envelope.ts }
    }
    case 'session_error': {
      if (!isRecord(envelope.payload)) throw new WireDecodeError('malformed session_error payload')
      const sessionError = {
        conversation_id: requireString(envelope.payload, 'conversation_id'),
        code: requireString(envelope.payload, 'code')
      }
      // Ignore message/extras; neither required string is a diagnostic value.
      diagnosticLog?.event({ event: 'inbound-decoded', code: 'session_error',
        bytes: plaintext.length, hash: hashPlaintext(plaintext) })
      return { kind: 'session-error', sessionError }
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
      return { kind: 'stall', stall, ts: envelope.ts }
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
      return { kind: 'api-retry', apiRetry, ts: envelope.ts }
    }
    case 'banner': {
      const banner = parseBannerPayload(envelope.payload)
      diagnosticLog?.event({ event: 'inbound-decoded', code: 'banner',
        bytes: plaintext.length, hash: hashPlaintext(plaintext) })
      return { kind: 'banner', banner }
    }
    case 'compaction_boundary': {
      const boundary = parseCompactionBoundaryPayload(envelope.payload)
      diagnosticLog?.event({ event: 'inbound-decoded', code: 'compaction_boundary',
        bytes: plaintext.length, hash: hashPlaintext(plaintext) })
      return { kind: 'compaction-boundary', boundary }
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
      return { kind: 'compacting', compacting, ts: envelope.ts }
    }
    case 'resetting': {
      // Narrow BEFORE logging so a malformed frame (an unknown token, a non-boolean `active`, a
      // payload that is not an object) throws first and leaves no record. NOTHING decoded is logged —
      // not `phase` or `handoff`, and not the conversation_id beside them, because the three together
      // disclose which conversation the operator reset and whether a handoff was written, which is a
      // fact about the operator's workflow rather than about this frame. Only the frame's byte length
      // + one-way hash, reusing the existing content-free field set (no new DiagnosticEvent field, so
      // #131's renderer pin is untouched). Strictly safer than the `default:` arm this replaces for
      // the type, which logged a WIRE-SUPPLIED `envelope.type`; the code here is a static literal.
      //
      // NO `ts` on the returned arm — see the kind's paragraph on InboundDaemonMessage: the mix-in
      // marks the arms decodeHistoryEvent draws, and this type gains no arm there.
      // Nothing consumes this arm yet: daemonConnection's inbound switch has no catch-all, so the
      // report stops here until #1515 claims it.
      const resetting = parseResettingPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'resetting',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'resetting', resetting }
    }
    case 'attachment_offered': {
      // Narrow BEFORE logging so a malformed frame throws first and leaves no record. NOTHING decoded
      // is logged: not the claude-authored filename, not the conversation_id, and not the attachment
      // id either, though a validated one would be allowed, because nothing needs it and it would add
      // a DiagnosticEvent field. The code is a static literal, never the wire-supplied envelope.type.
      // NO `ts`: the frame is live-only and gains no decodeHistoryEvent arm. Nothing consumes this arm
      // yet; the IPC carry to the window is a later ticket.
      const attachmentOffered = parseAttachmentOfferedPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'attachment_offered',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'attachment-offered', attachmentOffered }
    }
    case 'session_facts': {
      const sessionFacts = parseSessionFactsPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'session_facts',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'session-facts', sessionFacts }
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
    case 'thinking_progress': {
      // Narrow BEFORE logging so a malformed frame (an absent / non-number reading, a JSON-string
      // number) throws first and leaves no record. NOTHING decoded is logged — not the
      // conversation_id, and not the two readings, which look like harmless integers and are a
      // side-channel on how much claude thought about the operator's private work. Only the frame's
      // byte length + one-way hash, reusing the existing content-free field set (no new
      // DiagnosticEvent field, so #131's renderer pin is untouched). Strictly safer than the
      // `default:` arm this replaces for the type, which logged a WIRE-SUPPLIED `envelope.type`; the
      // code here is a static literal.
      //
      // NO `ts` on the returned arm — see the kind's paragraph on InboundDaemonMessage: the mix-in
      // marks the arms decodeHistoryEvent draws, and this type gains no arm there.
      // Nothing consumes this arm yet: daemonConnection's inbound switch has no catch-all, so the
      // reading stops here until the carry slice claims it.
      const thinkingProgress = parseThinkingProgressPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'thinking_progress',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'thinking-progress', thinkingProgress }
    }
    case 'tool_progress': {
      const toolProgress = parseToolProgressPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'tool_progress',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'tool-progress', toolProgress }
    }
    case 'rate_limited': {
      // Narrow BEFORE logging so a malformed frame (an omitted `truncated_fields` key, a JSON-string
      // `resets_at`, an absent status) throws first and leaves no record. NOTHING decoded is logged —
      // not `status` or `limit_type`, which are claude-authored text that crossed the subprocess trust
      // boundary and are unsanitized, and which together disclose the account's quota posture; and not
      // the conversation_id beside them. Only the frame's byte length + one-way hash, reusing the
      // existing content-free field set (no new DiagnosticEvent field, so #131's renderer pin is
      // untouched). Strictly safer than the `default:` arm this replaces for the type, which logged a
      // WIRE-SUPPLIED `envelope.type`; the code here is a static literal.
      //
      // NO `ts` on the returned arm — see the kind's paragraph on InboundDaemonMessage: the mix-in
      // marks the arms decodeHistoryEvent draws, and this type gains no arm there.
      // Nothing consumes this arm yet: daemonConnection's inbound switch has no catch-all, so the
      // report stops here until the carry slice claims it.
      const rateLimited = parseRateLimitedPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'rate_limited',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'rate-limited', rateLimited }
    }
    case 'context_usage': {
      // Narrow BEFORE logging so a malformed frame (a JSON-string `percentage`, an absent `model`, a
      // payload that is not an object) throws first and leaves no record. NOTHING decoded is logged —
      // not `model`, which is claude-authored text that crossed the subprocess trust boundary and is
      // unsanitized; not the three integers, which disclose how much private work is in the window; and
      // not the `conversation_id` beside them. Only the frame's byte length + one-way hash, reusing the
      // existing content-free field set (no new DiagnosticEvent field, so #131's renderer pin is
      // untouched). Strictly safer than the `default:` arm this replaces for the type, which logged a
      // WIRE-SUPPLIED `envelope.type`; the code here is a static literal.
      //
      // NO `ts` on the returned arm — see the kind's paragraph on InboundDaemonMessage: the mix-in marks
      // the arms decodeHistoryEvent draws, and this type gains no arm there.
      // Nothing consumes this arm yet: daemonConnection's inbound switch has no catch-all, so the
      // reading stops here until the carry slice claims it.
      const contextUsage = parseContextUsagePayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'context_usage',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'context-usage', contextUsage }
    }
    case 'mcp_status': {
      // Narrow BEFORE logging so a malformed frame (a `null` server list, a row missing a field, an
      // absent `dropped_servers`) throws first and leaves no record. NOTHING decoded is logged — no row
      // string, each of which is claude-authored and may carry a newline that would forge a record in
      // this line-delimited stream, no list length, and not the `conversation_id`. Only the frame's byte
      // length + one-way hash under a static code literal, reusing the existing content-free field set.
      //
      // NO `ts` on the returned arm: this type gains no decodeHistoryEvent arm. Nothing consumes this
      // arm yet — daemonConnection's inbound switch has no catch-all, so the list stops here until #1490.
      const mcpStatus = parseMCPStatusPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'mcp_status',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'mcp-status', mcpStatus }
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
      return { kind: 'background-task-started', backgroundTaskStarted, ts: envelope.ts }
    }
    case 'background_task_updated': {
      // Narrow BEFORE logging so a malformed frame (an omitted `patch` or `truncated_fields` key, a
      // non-string element in the latter, a present non-string `status` / `summary`, an absent id)
      // throws first and leaves no record. NOTHING decoded is logged — least of all `patch` and
      // `summary`, which may carry command text exactly as the sibling's `description` does. Only the frame's byte length + one-way hash, reusing the existing
      // content-free field set (no new DiagnosticEvent field, so #131's renderer pin is untouched).
      const backgroundTaskUpdated = parseBackgroundTaskUpdatedPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'background_task_updated',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'background-task-updated', backgroundTaskUpdated, ts: envelope.ts }
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
    case 'background_task_progress': {
      // Narrow BEFORE logging so a malformed frame (an absent field, a JSON-string counter, an omitted
      // `truncated_fields`) throws first and leaves no record. NOTHING decoded is logged — least of all
      // `description`, the current activity, which names a file on the operator's host; nor the
      // counters, a side-channel on the operator's work (the thinking_progress posture). Only the
      // frame's byte length + one-way hash under a static code literal.
      const backgroundTaskProgress = parseBackgroundTaskProgressPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'background_task_progress',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'background-task-progress', backgroundTaskProgress }
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
      return { kind: 'unrecognized-message', unrecognized, ts: envelope.ts }
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
      return { kind: 'session-transition', sessionTransition, ts: envelope.ts }
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
      return { kind: 'tool-use', toolUse, ts: envelope.ts }
    }
    case 'model_refusal_fallback': {
      const refusal = parseModelRefusalFallbackPayload(envelope.payload)
      diagnosticLog?.event({ event: 'inbound-decoded', code: 'model_refusal_fallback',
        bytes: plaintext.length, hash: hashPlaintext(plaintext) })
      return { kind: 'model-refusal-fallback', refusal, ts: envelope.ts }
    }
    case 'model_refusal_no_fallback': {
      const refusal = parseModelRefusalNoFallbackPayload(envelope.payload)
      diagnosticLog?.event({ event: 'inbound-decoded', code: 'model_refusal_no_fallback',
        bytes: plaintext.length, hash: hashPlaintext(plaintext) })
      return { kind: 'model-refusal-no-fallback', refusal, ts: envelope.ts }
    }
    case 'tool_denied': {
      const toolDenied = parseToolDeniedPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'tool_denied',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'tool-denied', toolDenied, ts: envelope.ts }
    }
    case 'tool_result': {
      // Narrow BEFORE logging so a malformed frame (a missing / non-string field, or a non-boolean
      // is_error, or a non-string result_detail) throws first and leaves no record. No decoded field
      // (result_summary / result_detail / is_error / tool_use_id / turn_id / conversation_id) is
      // logged — only the frame's byte length + one-way hash, reusing the existing content-free field
      // set. `result_summary` and `result_detail` (#773) are carried onward by the consumer (the render
      // payload, #230 / #856), but neither ever enters the diagnostic log.
      const toolResult = parseToolResultPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'tool_result',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'tool-result', toolResult, ts: envelope.ts }
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
      // Propagate the ALREADY-decoded Envelope.in_reply_to (#1249) — do not re-decode it. `undefined`
      // when the frame omits it, which is the ordinary case for the genuinely unsolicited producer
      // (pyrycode#2156's host-side channel create) and makes a write's correlation fail closed one
      // layer up. The numeric id is a routing id and is not logged (no new DiagnosticEvent field).
      //
      // ADDITIVE FOR EVERY EXISTING CONSUMER. This record has one already — the conversation-list
      // refresh — which reads only `conversationUpdated` and must keep firing on every frame,
      // correlated or not. The handle is a SECOND reading of the same frame, never a gate on the
      // first.
      return { kind: 'conversation-updated', conversationUpdated, inReplyTo: envelope.in_reply_to }
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
    case 'workspace_updated': {
      // Narrow BEFORE logging so a malformed frame (a missing / non-string `path`, a `label` that is
      // neither string nor null) throws first and leaves no record. NEITHER decoded field is logged —
      // only the frame's byte length + one-way hash, reusing the existing content-free field set.
      // Deliberately NO `count` field (the workspace_folder_created #381 posture): the set stays
      // type/bytes/hash. `path` could echo a $HOME / username and `label` is operator-chosen text, so
      // nothing but the shape is recorded. `code` is a client-owned literal, never the peer's `type`.
      //
      const workspaceUpdated = parseWorkspaceUpdatedPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'workspace_updated',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'workspace-updated', workspaceUpdated,
        ...(envelope.in_reply_to === undefined ? {} : { inReplyTo: envelope.in_reply_to }) }
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
    case 'question_shown': {
      // Narrow BEFORE logging so a malformed frame (a non-array `questions`, a bad option two levels
      // down, a non-boolean `multi_select`) throws first and leaves no record. No decoded field is
      // logged — only the frame's byte length + one-way hash, reusing the existing content-free field
      // set. Deliberately no `count` of questions (the modal_shown posture, not message_chunk's).
      // Strictly safer than the `default:` arm this replaces for the type, which logged a WIRE-SUPPLIED
      // `envelope.type`; the code here is a static literal.
      //
      // The narrowing makes the SHAPE trusted; it does not make the CONTENT trusted, and the type system
      // carries no signal for that (a `string` is a `string`). `questions[].question` / `.header` and
      // every `options[].label` / `.description` stay untrusted claude-authored text owed escaping at the
      // render boundary — that boundary is this client's, since the daemon neither bounds nor sanitizes
      // them. `question_batch_id` is an unguessable one-time nonce and must never reach a log.
      // Nothing consumes this arm yet: the IPC carry is #885, and daemonConnection's inbound switch has
      // no catch-all, so the batch stops here until that slice claims it.
      const questionShown = parseQuestionShownPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'question_shown',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'question-shown', questionShown }
    }
    case 'question_dismissed': {
      // Narrow BEFORE logging so a malformed frame (a non-record payload, a non-string field) throws
      // first and leaves no record. No decoded field is logged — only the frame's byte length + one-way
      // hash, the same content-free field set as the batch's arm, and deliberately no `outcome` or
      // `source` even though neither is secret. Strictly safer than the `default:` arm this replaces
      // for the type, which logged a WIRE-SUPPLIED `envelope.type`; the code here is a static literal.
      //
      // The narrowing makes the SHAPE trusted; it does not make the CONTENT trusted, and the frame's
      // published *daemon-asserted* provenance is the honest producer's PROMISE rather than a property
      // checked here — all this arm verifies is `typeof === 'string'`. A compromised daemon puts
      // whatever it likes in `outcome` and `source`, at whatever length the frame cap allows, so a
      // consumer must not read "decoded" as "sanitized": the escaping and length-bounding boundary is
      // the eventual render slice's. `question_batch_id` is the batch's unguessable one-time nonce,
      // dead once this frame lands, and must never reach a log.
      // Nothing consumes this arm yet: the IPC carry is #895, matching a dismissal to a held batch is
      // #850, and daemonConnection's inbound switch has no catch-all, so it stops here until claimed.
      const questionDismissed = parseQuestionDismissedPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'question_dismissed',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'question-dismissed', questionDismissed }
    }
    case 'slash_command_list': {
      // Narrow BEFORE logging so a malformed frame (a `commands: null`, an omitted `dropped_commands`, an
      // `aliases: null`, one bad row) throws first and leaves no record. NOTHING decoded is logged, and
      // on this frame that rule bites harder than on its neighbours: the four strings on every row are
      // WORKSPACE-AUTHORED — whoever wrote the repository wrote them, a LOWER trust tier than the
      // claude-authored strings the question arms carry — and `0x0a` is the only sub-`0x20` byte measured
      // across the capture's 51 entries, so an author who can put a newline in a `description` holds a
      // log-forgery primitive the moment any decoded value reaches this JSON-lines log (which the
      // operator can ship off-box in a debug bundle). Only the frame's byte length + one-way hash, the
      // existing content-free field set (no new DiagnosticEvent field, so #131's renderer pin is
      // untouched). DELIBERATELY NO `count` of commands: DiagnosticEvent already carries the field, so
      // emitting it would cost nothing structurally and it is omitted on purpose, because how many verbs
      // a workspace offers is itself a fact about the repository the user has open (the
      // background_task_roster / modal_shown posture, not message_chunk's). Strictly safer than the
      // `default:` arm this replaces for the type, which logged a WIRE-SUPPLIED `envelope.type`; the code
      // here is a static literal.
      //
      // The narrowing makes the SHAPE trusted; it does not make the CONTENT trusted, and the type system
      // carries no signal for that (a `string` is a `string`). `conversation_id` is an outbound
      // routing/scoping key, not a nonce and not a capability, and it is kept out of the log all the same.
      // Nothing consumes this arm yet: the IPC carry is #937, the Actions-menu alias match #681, and
      // daemonConnection's inbound switch has no catch-all, so the menu stops here until claimed.
      const slashCommandList = parseSlashCommandListPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'slash_command_list',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'slash-command-list', slashCommandList }
    }
    case 'model_list': {
      // Narrow BEFORE logging so a malformed frame (a `models: null`, an omitted `dropped_models`, an
      // `effort_levels: null`, a non-boolean `supports_auto_mode`, one bad row) throws first and leaves
      // no record. NOTHING decoded is logged. The rule is the sibling arm's, but ITS ARGUMENT IS NOT:
      // `slash_command_list` rests the never-into-a-log clause on a MEASURED `0x0a` across 51
      // workspace-authored entries, and these strings are CLAUDE-AUTHORED — a different and higher trust
      // tier, with no control byte measured in these short labels. The clause holds here on the CONTRACT
      // instead: the daemon bounds these strings and states plainly that it does not sanitize them, so a
      // control byte is PERMITTED rather than excluded, and a decoded value reaching this JSON-lines log
      // (which the operator can ship off-box in a debug bundle) would be a forgery primitive on exactly
      // the same footing. Transcribing the sibling's measurement here would be a false claim about this
      // frame. Only the frame's byte length + one-way hash, the existing content-free field set (no new
      // DiagnosticEvent field, so #131's renderer pin is untouched). DELIBERATELY NO `count` of models:
      // DiagnosticEvent already carries the field, so emitting it would cost nothing structurally and it
      // is omitted on purpose, because how many models claude offers for a session is itself a fact about
      // that session (the background_task_roster / model_announced posture, not message_chunk's).
      // Strictly safer than the `default:` arm this replaces for the type, which logged a WIRE-SUPPLIED
      // `envelope.type`; the code here is a static literal.
      //
      // The narrowing makes the SHAPE trusted; it does not make the CONTENT trusted, and the type system
      // carries no signal for that (a `string` is a `string`). `conversation_id` is an outbound
      // routing/scoping key, not a nonce and not a capability, and it is kept out of the log all the
      // same. Two obligations land on the consumers below rather than here: a `display_name` index must
      // be a `Map` and never `index[row.display_name] = row`, where a `__proto__` label writes through to
      // Object.prototype; and no model menu may BLOCK on this frame, whose delivery window is narrow and
      // lossy. Nothing consumes this arm yet: the IPC carry, the store and the run-configuration rows are
      // the slices below this one, and daemonConnection's inbound switch has no catch-all, so the menu
      // stops here until claimed.
      const modelList = parseModelListPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'model_list',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'model-list', modelList }
    }
    case 'attachment_stored': {
      // Narrow BEFORE logging so a malformed frame (a non-record payload, a missing / non-string /
      // EMPTY `attachment_id`) throws first and leaves no record. The empty case is the one worth
      // naming: it is what a truncated or hostile frame actually looks like, since every key is
      // optional to Go's encoding/json, and a plain requireString would let it through as a success
      // naming no transfer.
      //
      // NOTHING DECODED IS LOGGED, and here that is a decision rather than an inherited rule. Upstream
      // states this payload is SAFE TO LOG WHOLE — it carries none of `filename` / `sha256` / `data`,
      // the three `attachment_chunk` may never log — but that is a statement about the FRAME, not a
      // licence to widen DiagnosticEvent, which would disturb the renderer pin at #131. The id is
      // omitted even though `code` and `count` already exist and would cost nothing structurally: it is
      // the client's OWN id, so logging it buys a correlation handle this client already holds, at the
      // cost of putting a per-upload identifier into a JSON-lines log the operator can ship off-box in a
      // debug bundle. Only the frame's byte length + one-way hash, the existing content-free field set.
      // Strictly safer than the `default:` arm this replaces for the type, which logged a WIRE-SUPPLIED
      // `envelope.type` capped at MAX_LOGGED_TYPE_CHARS; the code here is a static literal.
      //
      // `envelope.in_reply_to` IS DELIBERATELY NOT PROPAGATED — the one place the contrast with the
      // `error` arm below matters. There the numeric id is the correlation and is carried; here it names
      // whichever chunk closed the set, which no client can predict, so carrying it would offer a match
      // key that silently never fires. The union member's own comment has the full argument.
      //
      // The narrowing makes the SHAPE trusted; it does not make the CONTENT trusted. A compromised
      // daemon picks this string, and all this arm verifies is `typeof === 'string'` plus non-emptiness.
      // The consumer (#861) owes the recognise-or-ignore lookup — in a `Map` keyed by ids this client
      // MINTED, never as `pending[id]` on a plain object — and must not read the reply's arrival as
      // proof every chunk was sent: a relay is content-blind but on-path, so it may reorder.
      const attachmentStored = parseAttachmentStoredPayload(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'attachment_stored',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'attachment-stored', attachmentStored }
    }
    case 'attachment_chunk': {
      // The RETRIEVAL leg's byte stream (#998), and the frame that until now fell through to `default:`
      // and was dropped as unrecognised — it rides outbound only today, for uploads (#860 built its
      // envelope, #861 drives it).
      //
      // THE CORRELATION IS CHECKED BEFORE THE PAYLOAD IS PARSED, AND THE ORDER IS LOAD-BEARING. Parsing
      // base64-decodes up to 45000 raw bytes; a frame that cannot be correlated is rejected anyway, so
      // doing that work first would let a hostile daemon spend this client's memory and CPU on frames it
      // has already disqualified. Both steps throw before the log, so the ordering changes no record.
      //
      // decodeEnvelope assigns `in_reply_to` only when it decodes as a NUMBER, so an absent key, a null
      // and a string all arrive here identically as `undefined` — one check covers all three. Requiring
      // it is THE inversion of the `attachment_stored` arm directly above, which deliberately propagates
      // nothing; see the union member's docblock for why neither is precedent for the other.
      const inReplyTo = envelope.in_reply_to
      if (typeof inReplyTo !== 'number') {
        throw new WireDecodeError('missing required field: in_reply_to')
      }
      const attachmentChunk = parseAttachmentChunkPayload(envelope.payload)
      // NOTHING DECODED IS LOGGED, and on this frame that is STRICTER than what upstream permits.
      // § Trust and content hygiene says "log the attachment id, the index and the total; never the
      // bytes, and never a raw filename". This client logs none of the three. `data` is a user's own
      // private file bytes and `filename` is doubly out — often private in itself, and a
      // client-supplied string in a line-oriented log is a log-injection shape. `sha256` and
      // `mime_type` follow. The ID is out for #993's reason rather than by inheritance: upstream
      // permits logging an id only AFTER its shape has been validated, and nothing on this side
      // validates. `index` / `total_chunks` follow the slash_command_list / model_list posture —
      // DiagnosticEvent already carries `count`, so emitting one would cost nothing structurally and
      // is omitted on purpose, because how a user's file is shaped is a fact about that file. Only the
      // frame's byte length + one-way hash, the existing content-free field set (no new
      // DiagnosticEvent field, so #131's renderer pin is untouched). Strictly safer than the
      // `default:` arm this replaces for the type, which logged a WIRE-SUPPLIED `envelope.type`.
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'attachment_chunk',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      return { kind: 'attachment-chunk', attachmentChunk, inReplyTo }
    }
    case 'error': {
      // Now MODELED (#116): a single daemon `error` reply terminates an in-flight bundle request.
      // Its content-free rule is SCOPED, not absolute (#965): `code` is read only
      // as a comparand against client-owned literals — see
      // narrowDaemonErrorOutcome, which owns the boundary and the argument for why it cannot throw.
      // A boolean `retryable` is carried for switch refusals; message and retry_after_s are dropped.
      // It moves from
      // inbound-unmodeled to inbound-decoded(error) now that it is recognised — a content-free,
      // more-accurate log that applies to ALL `error` frames, bundle-related or not (intentional; see
      // the #116 spec). The numeric `in_reply_to` is a routing id, not logged (no new DiagnosticEvent
      // field, so #131's renderer pin is untouched).
      //
      // THE LOGGED `code` IS A CLIENT-OWNED LITERAL AND MUST STAY ONE. ADR 0007's allowlist is enforced
      // over field NAMES, not values, so `code: envelope.payload.code` would typecheck cleanly and ship
      // daemon-controlled text into a JSON-lines log an operator can send off-box in a debug bundle.
      // The unit test asserting the record omits the wire code is the deterministic guard for this.
      const outcome = narrowDaemonErrorOutcome(envelope.payload)
      // The history verb's refusal (#1222), narrowed off the SAME untrusted `code` by the same
      // comparand idiom and into a SEPARATE client-owned union — see HistoryRejectReason for why the
      // two do not merge. Like `outcome` it cannot throw, so both consumers of this frame still fire
      // however mangled its payload; and like `outcome` the daemon's string is dropped, so the logged
      // `code` below stays the client-owned literal it must be.
      const historyReject = narrowHistoryRejectReason(envelope.payload)
      // The system-prompt WRITE verb's refusal (#1249), narrowed off the SAME untrusted `code` by the
      // same comparand idiom and into a THIRD client-owned union — see SystemPromptRejectReason for
      // why the three do not merge. Like its two neighbours it cannot throw, so every consumer of this
      // frame still fires however mangled its payload; and like them the daemon's string is dropped,
      // so the logged `code` below stays the client-owned literal it must be.
      const systemPromptReject = narrowSystemPromptRejectReason(envelope.payload)
      // The MCP status ask's refusal (#1578), a fourth narrowing by the same idiom and with the same
      // guarantees: it cannot throw, and the daemon's string is dropped.
      const mcpStatusReject = narrowMCPStatusRejectReason(envelope.payload)
      diagnosticLog?.event({
        event: 'inbound-decoded',
        code: 'error',
        bytes: plaintext.length,
        hash: hashPlaintext(plaintext)
      })
      // Propagate the ALREADY-decoded Envelope.in_reply_to (#269) — do not re-decode it, and parse no
      // ErrorPayload for it. `undefined` when the frame omits it, which makes the consumer's correlation
      // to a pending set_session_settings request fail closed. Carries ONLY the numeric id and the
      // client-owned outcome and optional boolean retryability, never daemon text. `outcome` is
      // REQUIRED rather than optional so a
      // mangled payload yields 'unclassified' instead of absence: a consumer has no "field missing"
      // state to mishandle, and no `if (outcome)` branch that behaves differently for a hostile frame.
      return {
        kind: 'daemon-error',
        inReplyTo: envelope.in_reply_to,
        retryable: isRecord(envelope.payload) && typeof envelope.payload.retryable === 'boolean'
          ? envelope.payload.retryable : undefined,
        outcome,
        pairingReject: isRecord(envelope.payload) && envelope.payload.code === 'auth.invalid_token'
          ? 'pairing-rejected' : undefined,
        updateRequired: narrowUpdateRequired(envelope.payload),
        historyReject,
        systemPromptReject,
        mcpStatusReject
      }
    }
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
