// The typed event pipe from the background process to the renderer window: one sealed
// discriminated union plus the channel it travels on, imported by both process sides. This
// is the event-pipe half of the background↔window bridge (#18); the command half is #17.
//
// The session-lifecycle members reuse a wire payload type from ../wire/types verbatim; the
// debug-bundle members (#168) carry only a count, a local filesystem path, and a closed
// category enum — never a token, key, raw frame, or bundle bytes. AC4 is enforced by
// construction: no member has a field that could hold a secret (QrPayload/HelloClientPayload
// tokens, InnerFrameV2 bytes are not referenced here), so a developer cannot serialize one
// onto this channel.
//
// Imported by src/main and src/preload, which have no @shared path alias — hence the
// relative import here and in those callers (see tsconfig.node.json).
import type {
  HelloAckPayload,
  MessagePayload,
  ErrorPayload,
  ConversationSummary,
  ConversationCreatedPayload,
  ConversationUpdatedPayload,
  RecentWorkspace,
  QueuedItem,
  BackgroundTask,
  WireTurnState,
  WireSessionTransitionReason,
  WireUnrecognizedSite,
  WireModalClass,
  WireModalSource,
  WireModalOption,
  ModalShownPayload,
  WireQuestion,
  WireSlashCommand,
  WireModelOption,
  SessionPromptStatus,
  ContextUsageCategory,
  ContextUsageMCPTool,
  MCPServerStatus,
  ContextUsageMemoryFile,
  MemorySearchPayload,
  WireResetPhase,
  WireResetHandoff
} from '../wire/types'

/**
 * A `turn_end`'s claude `result` numbers (#1565), each optional and carried as received from the
 * daemon: no summing, differencing or clamping, so `0` and negatives arrive unchanged. What "not
 * reported" means (absent, `0`) is the display's call, not this carrier's. All are this turn's except
 * `costUsdTotal`, which is the SESSION's running total in US dollars, claude's estimate. Rides the live
 * and history `turnEnd` arms here and the renderer's `turnEnd` / `turnBoundary`. Not persisted:
 * `DurableThreadItem` does not carry it.
 */
export interface TurnEndMetrics {
  durationMs?: number
  inputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  outputTokens?: number
  costUsdTotal?: number
}

/** Validated shape, untrusted content: render only as bounded text, never attributes or logs. */
export type ModelRefusalEvent = {
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
 * A stored history entry's payload, decoded into the shape its LIVE `DaemonEvent` twin carries (#1227) —
 * one arm per type the timeline draws, plus the operator's own `message`, which appears only in history
 * (the daemon pushes no `message` frame on the interactive lane). A consumer can run the window's
 * existing live-lane mapping over one of these unchanged.
 *
 * IT MIRRORS `DecodedHistoryEvent` IN `src/main/transport/inboundMessage.ts` BY HAND rather than
 * importing it, and that is the placement rule rather than an oversight. `inboundMessage.ts` is IPC-free
 * by construction — the `transport/` directory holds the wire boundary and never imports this module — so
 * a type the decode produces cannot be shared across the boundary it exists to cross. `HistoryRequestFailure`
 * above and `AttachmentUploadFailure` already mirror a transport type the same way for the same reason.
 * The two are kept in agreement structurally: `daemonConnection`'s single emit assigns the decoded array
 * into this field, so an arm missing here is a compile error at that one site, and a type-only
 * mutual-assignability guard in `daemonConnection.test.ts` catches the other direction. One residual gap,
 * stated rather than papered over: an added OPTIONAL field on one side alone passes both checks.
 *
 * NO ARM CARRIES A `conversationId`. Every live-lane parser requires the payload's `conversation_id`, but
 * that value is DAEMON-ASSERTED while a page is attributed by CORRELATION to the conversation this client
 * asked about — so it is dropped at the decode, and `historyPageReceived.conversationId` stays the only
 * routing key on the page. Carrying both would hand a consumer two ids that can disagree and a routing
 * decision it must never be given, which is the misattribution #1222's correlation exists to remove.
 *
 * SECURITY — DECODING MAKES THE SHAPE TRUSTED AND NEVER THE CONTENT. `assistantDelta.text`,
 * `toolUse.name` / `inputSummary` and BOTH the keys and the values of its `input` map,
 * `toolResult.resultSummary` / `resultDetail`, `unrecognizedMessage.raw` / `messageType`,
 * `sessionTransition.workspaceCwd` and `message.text` are all REPLAYED daemon-, claude- or
 * operator-authored strings carrying exactly the trust class of the live frame they mirror — nothing about
 * one is more trusted for having been stored, and the daemon's § Security model threat 1 lands on every
 * one. Each is PLAIN TEXT ONLY at the render boundary: never into a raw-markup sink (no innerHTML /
 * dangerouslySetInnerHTML), never into an attribute or a URL, and never a filename, a cache key or a
 * lookup path — if a consumer indexes by one, the index is a `Map`. `workspaceCwd` is the trap worth
 * naming twice: it is a daemon-supplied filesystem PATH and no consumer resolves, joins or opens it.
 *
 * No token, key or raw frame can ride any arm (by construction — every field is a scalar or a
 * string→string map built solely from a decoded payload). The `__proto__`-as-an-own-data-property hazard
 * `HistoryEntry` warns its consumers about does NOT reach here: every arm is a fresh literal and the
 * decoder drops the three reserved keys from `input`, so no reference to the `JSON.parse` result survives.
 *
 * `toolUse.input` and `toolResult.resultDetail` stay OPTIONAL — test `=== undefined`, never `'input' in
 * event`, which structured clone makes true either way. Absence means the WIRE omitted it (an older
 * daemon); an empty map and `''` are different facts and are never collapsed into it.
 */
export type HistoryTimelineEvent =
  | ModelRefusalEvent
  | { type: 'assistantDelta'; turnId: string; seq: number; text: string }
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
  | { type: 'messageReceived'; message: Omit<MessagePayload, 'conversation_id'> }

/**
 * ONE ENTRY of a served history page, decoded (#1227) — the typed timeline event beside the entry's own
 * durable log `id` and its `ts`. Both survive the decode deliberately: #1225 joins a loaded page to the
 * live stream on `ts` and cannot recover one lost here.
 *
 * `id` IS THE ON-DISK LOG ID AND IS NEVER JOINED AGAINST AN `event_id` — that one belongs to the
 * in-memory replay ring, is reset by a daemon restart, and means something else entirely. They are
 * different sequences that both look like small integers, which is why a join would typecheck and be wrong.
 */
export interface HistoryTimelineEntry {
  id: number
  ts: string
  event: HistoryTimelineEvent
}

/** The IPC channel every typed daemon event travels on, main → renderer.
 *  Single source of truth: the emit helper sends on it, the preload subscribes to it.
 *  A mismatch would silently drop every event, so both sides reference this constant. */
export const DAEMON_EVENT_CHANNEL = 'pyry:daemon-event' as const

/**
 * The coarse, closed set of user-facing debug-bundle failure categories (#168). Deliberately
 * information-minimising: the orchestrator (#169) collapses the transport's finer
 * BundleFailReason set plus any save errno onto these three, so the renderer never learns
 * transport internals. Carries no message, stack, or secret — just a category.
 */
export type DebugBundleFailure = 'unavailable' | 'stream-corrupt' | 'write-failed'

/**
 * The closed set of ways one `request_history` can be refused (#1222) — `DebugBundleFailure`'s shape
 * applied to a correlated round trip, and information-minimising in the same way: a category, never a
 * message, a stack, an echoed cursor or a daemon string.
 *
 * IT DUPLICATES `HistoryRejectReason`'s MEMBERS BY HAND rather than importing them, and that is the
 * placement rule rather than an oversight. `inboundMessage.ts` is IPC-free by construction — the
 * `transport/` directory holds the wire boundary and never imports this module — so the narrowed type
 * cannot be shared across the boundary it exists to cross. `AttachmentUploadFailure` already mirrors
 * `DaemonErrorOutcome` the same way, for the same reason, and the two lists are kept in agreement by
 * the single mapping in `daemonConnection`'s emit. Each member's meaning is documented at its source.
 *
 * THE SIXTH MEMBER IS NOT A HEDGE. The daemon publishes five refusals for this verb, and a sixth
 * outcome is reachable anyway: when one stored entry is too large to fit in ANY page the daemon emits
 * it regardless and its own transport answers `message.too_long`, correlated to this client's ask. A
 * correlated refusal must always settle the outstanding request — a walk that dropped one would stall
 * with no terminal and no way to step past the entry — so anything outside the five arrives here.
 */
export type HistoryRequestFailure =
  | 'conversation-not-found'
  | 'history-invalid-request'
  | 'history-invalid-page-size'
  | 'history-invalid-cursor'
  | 'history-unavailable'
  | 'unclassified'

/**
 * Why a `set_system_prompt` write did not take (#1249). Every member is NON-RETRYABLE — which is why
 * this union's carrier has no `retryable` field, where `historyRequestFailed` has one: a flag whose
 * value is a constant across the whole set carries no information, and `HistoryRequestFailure`'s
 * reason for carrying one (exactly one retryable member, computed at the single emit so a walk driver
 * cannot re-derive it wrong) does not transfer to a set with none.
 *
 * IT MIRRORS `SystemPromptRejectReason`'S TWO MEMBERS BY HAND rather than importing them, the
 * placement rule `HistoryRequestFailure` and `AttachmentUploadFailure` already follow:
 * `inboundMessage.ts` is IPC-free by construction, so a type the decode produces cannot be shared
 * across the boundary it exists to cross. The lists are kept in agreement by the single mapping in
 * `daemonConnection`'s emit.
 *
 * THE FIRST MEMBER IS THIS CLIENT'S OWN VERDICT AND HAS NO WIRE CODE AT ALL. `prompt-too-long` is
 * raised BEFORE the send, so nothing reached the wire and nothing was refused by anyone; it is
 * deliberately NOT folded into `protocol-malformed`, which the daemon returns for an over-length value
 * AND for a payload that would not decode. Folding them would claim the daemon said something it never
 * did, and would blur the one repair an operator can actually make — shorten the text — with one they
 * cannot.
 *
 * THE LAST MEMBER IS NOT A HEDGE, `HistoryRequestFailure`'s argument transplanted. The daemon
 * publishes two refusals for this verb, and a correlated refusal must ALWAYS settle the outstanding
 * write: a code outside the published set that was dropped instead would leave #1250 reporting a
 * rejected write as permanently in flight.
 */
export type SystemPromptWriteFailure =
  /** This client refused the value before the send: over MAX_SYSTEM_PROMPT_BYTES of UTF-8. No frame
   *  was built and no frame reached any wire. */
  | 'prompt-too-long'
  /** The daemon could not decode the payload, or the value exceeded its own 8192-byte cap. Nothing was
   *  stored. Its static message echoes no supplied byte, and none of it crosses here. */
  | 'protocol-malformed'
  /** The `conversation_id` matched no conversation in the daemon's registry. Nothing was stored. */
  | 'conversation-not-found'
  /** A refusal correlated to this write whose code is outside the two published above — reported
   *  rather than dropped, so the write always settles. */
  | 'unclassified'

/**
 * Why the daemon did not answer an `mcp_status_request` (#1578). Mirrors `MCPStatusRejectReason` by
 * hand, as `SystemPromptWriteFailure` mirrors its decode-side twin, and the single emit in
 * `daemonConnection` keeps the two in agreement.
 */
export type MCPStatusRequestFailure =
  /** The conversation is hosted but has no bound session, no live eligible child, or the child's reply
   *  was unusable. The daemon marks it retryable after a backoff; nothing on this side retries. */
  | 'mcp-status-unavailable'
  /** Any other correlated refusal: `protocol.malformed` and `conversation.not_found` (both a bug on this
   *  side), an unknown code, or an unreadable payload. */
  | 'unclassified'

/**
 * The relay-socket leg's state category (#328), mirroring mobile's RelayLinkStatus where it maps
 * cleanly: 'connected' = socket up; 'offline' = socket dropped (an ordinary retryable close);
 * 'daemon-absent' = relay reachable but no daemon registered behind it (the relay's 4404 close). No
 * Reconnecting-countdown category — the supervisor exposes no remaining-backoff, so desktop cannot
 * honestly emit it (out of scope). A closed, information-minimising enum: it carries no token, key,
 * raw frame, close code, or payload byte — only the display category.
 */
export type RelayLinkStatus = 'connected' | 'offline' | 'daemon-absent'

/**
 * A single typed event from the background process to the renderer window. Sealed
 * discriminated union on `type`. The session-lifecycle members
 * (connecting | connected | disconnected | failed | messageReceived | messagesReceived) map
 * 1:1 onto the session-store's SessionAction arms — #19 maps them with no gaps and no spares.
 * The debug-bundle members (debugBundleProgress | debugBundleSaved | debugBundleFailed, #168) map
 * to NO SessionAction — the download UI (#72) consumes them, not the session store, so the
 * renderer bridge translates them to `null` (see daemonEventBridge).
 *
 * Spans transport-lifecycle events (`connecting`/`disconnected`, from the transport
 * supervisor) and daemon-originated events (`connected`/`failed`/messages, derived from
 * validated wire envelopes upstream). Never carries a token, key, raw frame, or bundle bytes
 * (AC4): the session members reuse only wire payload types, and the debug-bundle members carry
 * only a count, a local path, and the closed DebugBundleFailure enum. Session member and field
 * names mirror SessionAction's so #19's mapping is near-identity, while the two unions stay
 * separately declared per layer.
 *
 * NOT THE EXPORTED TYPE since #1225 — `DaemonEvent` below is this union with the optional envelope
 * timestamp mixed in. Every arm is still declared here and nothing about an arm changed; see
 * `DaemonEventTimestamp` for why the field is added by intersection rather than per arm.
 */
type BaseDaemonEvent =
  | (ModelRefusalEvent & { conversationId: string })
  | { type: 'connecting' }
  | { type: 'connected'; ack: HelloAckPayload }
  | { type: 'disconnected' }
  | { type: 'failed'; error: ErrorPayload }
  | { type: 'messageReceived'; message: MessagePayload }
  | { type: 'messagesReceived'; messages: readonly MessagePayload[] }
  | { type: 'debugBundleProgress'; chunksReceived: number }
  | { type: 'debugBundleSaved'; path: string }
  | { type: 'debugBundleFailed'; reason: DebugBundleFailure }
  // The run-configuration arm (#491). Six fields: the session's `model` / `effort` / `yolo` plus its
  // two context-window ints (#191), and the `sessionId` the run-config sheet needs to address a
  // set_session_settings to. All six come from the dedicated `session_settings` reply.
  //
  // The sheet was moved onto that reply at #491/#500, off the screen-photograph path it read
  // before: a screen_snapshot is refused outright whenever there is no terminal to photograph —
  // which is always, on the stream-json interactive runner — so the sheet was inert in production.
  // That is why this arm exists, and why its values must keep coming from a reply the runner
  // actually answers.
  //
  // `sessionId: ''` is a real value meaning "the daemon has no session to address" and MUST NOT be
  // coerced to null; the sheet's gate treats it as not-addressable. A session id is a routing id,
  // not a secret (the conversation_id / sessionTransition convention), and no token, key, raw
  // frame, or rendered screen `text` can ride this arm.
  //
  // `permissionMode` (#1020) is the session's permission mode off the same reply — camelCase per this
  // arm's convention (`sessionId`, and the "wire is snake, IPC is camel" rule the assistantDelta arm
  // below states); `used_tokens` / `window_tokens` are the two LEGACY exceptions here and are not a
  // precedent to extend. `''` means NO SESSION WAS RESOLVED and crosses verbatim beside
  // `sessionId: ''` — the pair is read together, and neither is inferred from `yolo`, which can only
  // separate `bypassPermissions` from the other five modes.
  //
  // SECURITY: it is daemon-asserted text held with NO client-side allowlist, deliberately — the read
  // half carries six modes while the write half accepts five (#1021), so narrowing here would be
  // wrong. It is therefore a REPORT, NEVER A CONTROL INPUT: no security-relevant behaviour may branch
  // on it. Like `model` on the announced-model arm below, its render surface (#682) must treat it as
  // PLAIN TEXT ONLY — never HTML (no innerHTML / dangerouslySetInnerHTML), never into an attribute or
  // a URL, and never a filename, a cache key or a lookup path. It reaches no log sink: the decode arm
  // logs byte length and a one-way hash only, and emitDaemonEvent is log-free by construction.
  //
  // `conversationId` (#1176) is the conversation this reply DESCRIBES, and it is the one
  // `conversationId` on this whole union that the daemon did not assert. The wire reply carries no
  // conversation id at all — `SessionSettingsPayload` has no field for one, and giving it one would be
  // a wire change (ADR 0002) — so it is resolved in the background process instead: the envelope id of
  // each `request_session_settings` is recorded against the conversation that request named, and the
  // reply is matched back by `Envelope.in_reply_to`. What crosses here is therefore CLIENT-OWNED — the
  // id this app put in its own outbound frame, held in main-process memory and handed back — never a
  // string parsed out of an inbound payload.
  //
  // That provenance is stated because it is the ONE thing a later editor must not generalise from the
  // daemon-asserted ids on assistantDelta / modelAnnounced / toolUse: their warnings are theirs, and
  // relaxing them by pointing at this arm would be wrong. What this arm DOES share with them is the
  // required-ness and the reason for it — an optional routing key invites `?? activeConversation`
  // fallbacks, which is the exact misattribution #1176 exists to remove, so it is REQUIRED and a
  // consumer that cannot resolve it must drop the event rather than guess. It is still a routing key
  // and not rendered text: never markup, an attribute, a URL, a filename, a cache key or a lookup
  // path, and it reaches no log sink (emitDaemonEvent is log-free by construction, and the decode-side
  // session_settings log is pinned content-free independently). The numeric `in_reply_to` it was
  // resolved from is deliberately NOT carried: the renderer receives the id it supplied, never the
  // wire routing id. Consumed by `subscribeRunConfig`, which drops a reply naming any conversation but
  // the open one.
  | {
      type: 'runConfigReceived'
      conversationId: string
      sessionId: string
      model: string
      /** Saved choice, independent of the applied report. */
      effort: string
      /**
       * Applied report: undefined = unavailable, null = no effort parameter; strings stay verbatim.
       * Untrusted display text only: never a control input, markup, attribute, URL, path, cache key
       * or log value. Receiving it must not write settings or overwrite the remembered choice.
       */
      effectiveEffort?: string | null
      yolo: boolean
      permissionMode: string
      used_tokens: number
      window_tokens: number
      /**
       * The session's capability flags (#1654, pyrycode#2670): whether it answers slash-command,
       * MCP-status and context-breakdown requests — true for Claude, false for Codex. undefined = not
       * reported (no `capabilities` on the reply, or a daemon predating the flag), distinct from false.
       * A statement of support, not a permission: the daemon re-checks every request.
       */
      slashCommands?: boolean
      mcpServers?: boolean
      contextUsageDetail?: boolean
      /** Daemon-owned memory-search status; undefined when omitted by an older daemon. */
      memorySearch?: MemorySearchPayload
    }
  // The two v2 interactive-stream arms (#199). `text` IS the render payload (#203) and crosses IPC
  // deliberately — the boundary defended upstream is the fail-closed decode, not this internal
  // channel. Consumed by the renderer timeline bridge (#202), not the session store. camelCase per AC3.
  //
  // assistantDelta carries `conversationId` (#751) — the frame's `conversation_id`, copied BY NAME at the
  // emit from an already-validated payload, never by spreading the decoded payload. The decode already
  // required it and this ticket did not touch that: a missing or non-string `conversation_id` fails the
  // whole line without emitting. The "turn-stream item, or daemon state?" test that governs the status
  // arms answers differently here and the id crosses anyway — a delta IS a turn-stream item, and it
  // carries the id not to report per-conversation state but because a slice of assistant text has to be
  // filed in the right thread, and a consumer cannot route what it cannot attribute (#675). REQUIRED,
  // never optional: an optional routing key invites `?? activeConversation` fallbacks, which is the
  // misattribution this work exists to remove.
  //
  // The id is a daemon-asserted ROUTING KEY, not rendered text — none of the untrusted-text warnings that
  // attach to `text` on this same arm attach to it. It is never markup, a filename, a cache key, a lookup
  // path, an attribute or a URL, and it reaches no log sink (emitDaemonEvent is log-free by construction,
  // and the decode-side assistant_delta log is pinned content-free independently). It STOPS at the
  // renderer timeline bridge (#202), which rebuilds a fresh ThreadEvent from named fields and omits it;
  // ThreadEvent does not carry it, and the consumers that route by conversation are #756. No token, key,
  // or raw frame.
  //
  // Stateless and un-coalesced: N frames produce N events in arrival order, `seq` rides along for wire
  // fidelity but is not consulted, and merging slices into one bubble is the reducer's job. The added
  // field brings no per-id buffer, dedup, last-seq memo or ordering check with it.
  | { type: 'assistantDelta'; turnId: string; seq: number; text: string; conversationId: string }
  // turnEnd closes the turn and carries turnId / stopReason plus `conversationId` (#752) — the frame's
  // `conversation_id`, copied BY NAME at the emit from an already-validated payload, never by spreading
  // the decoded payload. It crosses for the reason the delta arm above carries it, on the same terms:
  // REQUIRED never optional (an optional routing key invites `?? activeConversation` fallbacks, which is
  // the misattribution this work exists to remove), a daemon-asserted ROUTING KEY rather than rendered
  // text, and a fail-closed decode — a missing or non-string id fails the whole line without emitting.
  // A turn boundary that cannot be attributed closes the wrong thread's turn (#675). It STOPS at the
  // renderer timeline bridge, which rebuilds a fresh ThreadEvent from named fields and omits it;
  // ThreadEvent does not carry it, and the consumers that route by conversation are #756. No token,
  // key, or raw frame.
  | ({ type: 'turnEnd'; turnId: string; stopReason: string; outcome?: string; isError?: boolean; terminalReason?: string; errorCategory?: string; conversationId: string } & TurnEndMetrics)
  // The coarse turn-lifecycle arm (#214, widened by #724). Carries `state` (a closed 3-value wire enum)
  // and `conversationId` — the frame's `conversation_id`, copied BY NAME at the emit from an
  // already-validated payload (the decode stays fail-closed: a missing or non-string id fails the whole
  // line). It crosses for the reason backgroundTaskStarted's does — the "turn-stream item, or daemon
  // state?" test — and per-conversation phase is daemon state: the sidebar must say a chat is thinking
  // while the operator looks at a different one (#674). REQUIRED, never optional: an optional routing key
  // invites `?? activeConversation` fallbacks, which is the misattribution this work exists to remove.
  //
  // The id is a daemon-asserted ROUTING KEY, not rendered text — none of the untrusted-text warnings on
  // `model` / `description` / `raw` attach to it. It is never markup, a filename, a cache key, a lookup
  // path, an attribute or a URL, and it reaches no log sink (emitDaemonEvent is log-free by construction).
  // It STOPS at the renderer timeline bridge (#202), which rebuilds a fresh ThreadEvent with named fields
  // and omits it → `phase`, not the session store; ThreadEvent does not carry it, and the consumers that
  // key off the id are #674. No token, key, or raw frame.
  | { type: 'turnState'; state: WireTurnState; conversationId: string }
  // The stall-liveness arm (#315, widened by #732). Carries `conversationId` — the wire StallPayload's
  // only field (`conversation_id`), copied BY NAME at the emit from an already-validated payload (the
  // decode stays fail-closed: a missing or non-string id fails the whole line). It crosses for the reason
  // turnState's and backgroundTaskStarted's do — the "turn-stream item, or daemon state?" test — and
  // per-conversation liveness is daemon state: the sidebar must show that a chat has gone quiet while the
  // operator looks at a different one (#674). REQUIRED, never optional: an optional routing key invites
  // `?? activeConversation` fallbacks, which is the misattribution this work exists to remove.
  //
  // The id is a daemon-asserted ROUTING KEY, not rendered text — none of the untrusted-text warnings on
  // `model` / `description` / `raw` attach to it. It is never markup, a filename, a cache key, a lookup
  // path, an attribute or a URL, and it reaches no log sink (emitDaemonEvent is log-free by construction,
  // and the decode-side stall log is pinned content-free independently). It STOPS at the renderer
  // timeline bridge (#202), which rebuilds a fresh ThreadEvent and omits it; ThreadEvent stays nullary,
  // and the consumers that key off the id are #674. No token, key, or raw frame.
  //
  // Onset-only; the client self-clear on next turn activity is the render slice's concern (#317), and the
  // added field brings no dedup or timer state with it. Consumed by the render slice #317 (not yet
  // built), so all three exhaustive bridges no-op it for now — the sessionSettingsRejected-was-a-no-op
  // precedent.
  // Transient status only. Daemon message/extras never cross IPC; code is compared to client literals.
  | { type: 'sessionError'; conversationId: string; code: string }
  | { type: 'stallDetected'; conversationId: string }
  // The api-retry arm (#492, widened by #737) — claude is retrying against an API error. It carries the
  // edge (`active` — true is the rising edge, false the explicit falling one) and the attempt counter
  // (`current` / `total`), because the render slice #493 shows "attempt N/M" and the wire gives it
  // nowhere else, plus `conversationId` — the frame's `conversation_id`, copied BY NAME at the emit from
  // an already-validated payload (the decode stays fail-closed: a missing or non-string id fails the
  // whole line). It crosses for the reason turnState's and stallDetected's do — the "turn-stream item, or
  // daemon state?" test — and per-conversation retry is daemon state: the sidebar must show that a chat
  // is stuck retrying while the operator looks at a different one (#674). REQUIRED, never optional: an
  // optional routing key invites `?? activeConversation` fallbacks, which is the misattribution this work
  // exists to remove.
  //
  // The id is a daemon-asserted ROUTING KEY, not rendered text — none of the untrusted-text warnings on
  // `model` / `description` / `raw` attach to it. It is never markup, a filename, a cache key, a lookup
  // path, an attribute or a URL, and it reaches no log sink (emitDaemonEvent is log-free by construction,
  // and the decode-side api_retry log is pinned content-free independently). It STOPS at the renderer
  // timeline bridge (#202), which rebuilds a fresh ThreadEvent from named fields and omits it;
  // ThreadEvent keeps its four, and the consumers that key off the id are #674. No token, key, or raw
  // frame.
  //
  // NOT onset-only and NOT deduped: the daemon re-fires the rising edge as the count climbs, and the
  // transport holds no state, so a consumer sees exactly one event per daemon frame (including a verbatim
  // repeat) — and the added field brings no dedup, coalescing, timer or per-id memo with it. `current: 0`
  // with `total: 0` is the legitimate "retrying, count unknown" value — #493 must format it defensively
  // (never a literal "0/0", never `current / total` without handling the NaN) since the decoder
  // type-checks but does not range-check. Ships dormant: all three exhaustive bridges no-op it until
  // #493 — the stallDetected-was-a-no-op-until-#317 precedent.
  | { type: 'apiRetry'; active: boolean; current: number; total: number; conversationId: string }
  // Conversation-scoped status and delayed boundary metadata. Outcomes and trigger are open
  // daemon strings, classified by the timeline rather than displayed or logged. The id routes
  // only to its own held conversation and is dropped by translateTimelineEvent.
  | { type: 'compacting'; active: boolean; conversationId: string; compactResult?: string; compactError?: string }
  | { type: 'compactionBoundary'; conversationId: string; trigger: string; preTokens?: number | null; postTokens?: number | null }
  /** Untrusted Claude prose: text children only, never attributes/logs; stopsTurn controls display only. */
  | { type: 'banner'; conversationId: string; level: string; text: string; stopsTurn: boolean; truncated: boolean }
  // The announced-model arm (#587) — what claude named as the model it resolved for the turn, off its
  // `system` / `init` line. Neither a claude sub-state like its three status neighbours above nor a
  // daemon mapping gap like unrecognizedMessage: an IDENTITY report, answering what the spawn argument
  // cannot — the daemon knows what it REQUESTED, only claude knows what it GOT.
  //
  // `model` COLLIDES BY NAME WITH AN ARM ABOVE AND MEANS THE OPPOSITE THING. runConfigReceived
  // carries a `model: string` meaning the per-session OVERRIDE, where `''` means "inherited default,
  // no override". This one means what claude ANNOUNCED, and in the ordinary case the two disagree:
  // the override is `''` while claude has named a concrete model. Both values are destined for the
  // same run-configuration sheet, so the collision is live rather than theoretical. The daemon's wire
  // field name is kept (no drift, ADR 0002) and the distinction is drawn here, the way the daemon's
  // own payload doc draws it.
  //
  // The identifier is VERBATIM: not reliably dated, and it need not appear in any published model list
  // (requesting `claude-haiku-4-5` yields it back undated), so a MISS on #588's lookup is ORDINARY,
  // not an error — and #588 must not normalise, lowercase, allow-list, or regex a family out of it.
  //
  // `truncated` is LOAD-BEARING: a reader that ignores it presents claude's cut text as complete. It is
  // sharper here than on unrecognizedMessage, because a cut identifier always misses #588's exact
  // lookup and so always renders verbatim, looking exactly like a legitimate unrecognised model.
  // `false` is a VALUE (nothing was cut), never an absence, and the decoder never defaults it.
  //
  // SECURITY: `model` is UNTRUSTED, model-influenced daemon-relayed text that crossed the subprocess
  // trust boundary. The daemon BOUNDS it (256 bytes) but does NOT SANITIZE it — no control-character or
  // terminal-escape stripping happens anywhere on this path — so #588 and its render surface must treat
  // it as PLAIN TEXT ONLY, NEVER HTML (no innerHTML / dangerouslySetInnerHTML), never into an attribute
  // or a URL, mirroring the identical warning on unrecognizedMessage / backgroundTaskStarted. It is a
  // REPORT, NEVER A CONTROL INPUT: no security-relevant behaviour may branch on it, and it is not a
  // cache key, a filename, or a lookup path. This slice has no DOM sink; the constraint is inherited
  // here for #588.
  //
  // Carries `conversationId` alongside `model` and `truncated` (#714) — the frame's `conversation_id`,
  // copied BY NAME at the emit from an already-validated payload (the decode stays fail-closed: a missing
  // or non-string id fails the whole line, and parseModelAnnouncedPayload is untouched). It crosses by the
  // RULE, not by comparison with a neighbour: this frame carries no `turn_id` and opens and closes no
  // turn, so it is daemon STATE rather than a turn-stream item — the same test backgroundTaskStarted and
  // queueState keep it under (#720). Per-conversation attribution is what #588 / #674 need in order to say
  // WHICH chat announced WHICH model. REQUIRED, never optional: an optional routing key invites
  // `?? activeConversation` fallbacks, which is the misattribution this work exists to remove.
  //
  // This arm's safety argument used to be ARITHMETIC — that dropping the id left exactly one untrusted
  // string crossing here rather than two. That argument is REPLACED, not renumbered: counting the strings
  // was never what made them safe, and re-counting to two would assert that `conversationId` is untrusted
  // text of the same kind as `model`, which it is not. It now rests on the NATURE of each string, and the
  // two are NOT of one kind. `model` keeps every warning above IN FULL. The id is a daemon-asserted
  // ROUTING KEY, not rendered text and not model-influenced — it is never markup, a filename, a cache key,
  // a lookup path, an attribute or a URL, and it reaches no log sink (emitDaemonEvent is log-free by
  // construction, and the decode-side model_announced log is pinned content-free independently). It used
  // to STOP at the announced-model bridge (#588), which rebuilt a fresh two-field literal from named
  // fields; #1146 widened that literal, because dropping the id is precisely what made the announced-model
  // store one app-wide slot showing the wrong server's model. It now travels one hop further and STOPS as
  // a `Map` KEY in that store — never copied into the held record, which keeps `model` + `truncated`, so
  // it reaches neither of that value's DOM sinks. Every bar above still binds it there, and that store
  // mandates `ReadonlyMap` over `Record` so a hostile id is an ordinary key rather than a prototype write.
  // An unknown id must be an explicit no-match, never a fallback onto the open conversation — which the
  // store gets by construction, since a reader can only ask for a conversation it can select. No token,
  // key, or raw frame.
  //
  // NOT deduped: the transport holds no state, so a consumer sees exactly one event per daemon frame,
  // including a verbatim repeat — which is what tells #588 the value is still current, and the added field
  // brings no dedup, coalescing, timer or per-id memo with it. Ships dormant: all three exhaustive bridges
  // no-op it until #588 — the compacting-was-a-no-op-until-#496 precedent.
  | { type: 'modelAnnounced'; model: string; truncated: boolean; conversationId: string }
  | {
      // Shape-validated claims only; never authority for permissions or turn state.
      type: 'sessionFacts'
      conversationId: string
      claudeCodeVersion: string
      permissionMode: string
      truncatedFields: string[] | null
    }
  | {
      // Claude's MCP server list for one conversation (#1490). `servers: []` is claude's positive report
      // of no servers, distinct from no event at all; `droppedServers` is the daemon's own count. Every
      // row string is untrusted claude text: render only, never a key, attribute, URL or log field.
      type: 'mcpStatus'
      conversationId: string
      servers: readonly MCPServerStatus[]
      droppedServers: number
    }
  | {
      // The daemon refused this app's `mcp_status_request` (#1578). `conversationId` is the one this app
      // asked about, never read from the error. No daemon code, message or in_reply_to crosses, and a
      // refusal neither clears nor replaces a stored report. A routing key, never markup or a log field.
      type: 'mcpStatusRequestRejected'
      conversationId: string
      reason: MCPStatusRequestFailure
    }
  | {
      // The daemon refused this app's `mcp_reconnect` (#1582). One permanent outcome for every code: the
      // daemon merges its causes on purpose and this side must not split them again, so there is no
      // reason field. `conversationId` is the one recorded at send time, never read from the error; no
      // daemon code, message, server name or in_reply_to crosses. A routing key, never markup or a log field.
      type: 'mcpReconnectRejected'
      conversationId: string
    }
  | {
      // The daemon refused this app's `mcp_toggle` (#1586), distinct from the reconnect refusal above so the
      // sheet can say which action was refused. Same rules: one permanent outcome for every code, the
      // conversation recorded at send time, and no daemon code, message, server name or requested state.
      type: 'mcpToggleRejected'
      conversationId: string
    }
  | {
      // The daemon refused this app's `stop_background_task` (#1770). Both ids are the ones recorded at
      // send time: the error frame never carries a task id, and its `conversation_id` is not read. No
      // daemon code, message or in_reply_to crosses. Routing keys, never markup or a log field.
      type: 'backgroundTaskStopRejected'
      conversationId: string
      taskId: string
    }
  // The background-task open arm (#564) — claude started work that OUTLIVES the turn that spawned it
  // (pyrycode#1240), the frame that separates that case from a genuine finish.
  //
  // Carries `conversationId`, as every turn-stream arm now does (#675 finished with #766). The
  // test is "turn-stream item, or daemon state?", not "does the frame have the field": this one carries
  // NO turn_id, opens and closes no turn, and the daemon doc says a client renders it "as its own thread
  // of activity, not as part of the turn it appeared in" — the same characterization queue_state got in
  // #720, and queueState keeps it for the same reason (replacement-truth state a store keys by id). The
  // task store (#567) attributes by id, so dropping it here would make that slice unbuildable.
  //
  // `toolCallId` is the wire `tool_call_id` (NOT `tool_use_id`, despite toolUse / toolResult spelling it
  // that way); the VALUE is the same identifier those two carry, which is what lets #567 join all three
  // background-task frames with no lookup. `taskType` is an OPEN string — `local_bash` is the only
  // observed value and one observation does not earn an enum. `truncatedFields: null` means NOTHING WAS
  // CUT and must not be collapsed into `[]`; it is load-bearing, since a reader that ignores it presents
  // claude's cut text as complete.
  //
  // SECURITY: `description` and `taskType` are UNTRUSTED, model-influenced daemon-relayed text, and for
  // `taskType: local_bash` the `description` IS the literal command line claude ran. The panel slice
  // (#568) must render both as PLAIN TEXT, NEVER HTML (no innerHTML / dangerouslySetInnerHTML), never
  // into an attribute or a URL, and must never execute or re-shell it — mirroring the identical warning
  // on queueState / conversationCreated / unrecognizedMessage, sharpened by the command-line hazard. This
  // slice has no DOM sink; the constraint is inherited here. No token, key, or raw frame can ride the arm
  // (five bounded opaque strings and a list of wire field names is the whole payload). Ships dormant: all
  // three exhaustive bridges no-op it until #567 — the apiRetry-was-a-no-op-until-#493 precedent.
  | {
      type: 'backgroundTaskStarted'
      conversationId: string
      taskId: string
      toolCallId: string
      description: string
      taskType: string
      truncatedFields: readonly string[] | null
    }
  // The background-task update arm (#565) — the PEER of the arm above, joined on `taskId`: that frame
  // opens a task, this one reports what happened to it afterwards. Six fields, but not the arm above's
  // six: no `toolCallId`, no `description`, no `taskType`, and it gains `patch`, `status` and `summary`.
  //
  // `status` and `summary` (#1560) are the TERMINAL half of the frame; `patch` is the mid-life half, and
  // claude never fills both. `status: ''` means the task has not reported an end (a mid-life frame, or a
  // daemon predating the field); a NON-EMPTY `status` is the family's only finish signal. It is an OPEN
  // string — only `completed` has been captured, `failed` / `stopped` never have — so a consumer must
  // handle a token it has not seen rather than switch exhaustively. `summary` is model-authored free
  // text that can be the task's command line: the same render-never-execute rule as `patch` below
  // applies, and neither field is ever logged.
  //
  // Carries `conversationId` for the sibling's reason, which is settled in-family rather than argued
  // fresh: the test is "turn-stream item, or daemon state?", and this frame carries NO turn_id and opens
  // and closes no turn, so it follows the queue_state rule (#720). The task store (#567) attributes by
  // id, so dropping it here would make that slice unbuildable.
  //
  // `patch` IS AN OPAQUE DISPLAY BLOB THAT IS NOT GUARANTEED TO PARSE. The daemon truncates it at
  // construction, so a truncated object is no longer valid JSON — its own golden fixture is cut
  // mid-token. A consumer that wants its keys must parse BEHIND AN ERROR BRANCH that falls back to inert
  // text, and must never enumerate a closed key set (the daemon enumerates none, because a mapping that
  // listed the keys it knew would silently discard every key claude ships next). `patch: ''` means claude
  // sent no change — a VALUE, not an absence. `truncatedFields: null` means NOTHING WAS CUT and must not
  // be collapsed into `[]`; it reports the CAP CUT ONLY, so `patch` may differ from claude's bytes
  // without appearing there (the daemon also scrubs invalid UTF-8 by deletion) — record it, never
  // cross-check it.
  //
  // SECURITY: `patch` and `summary` are UNTRUSTED, model-influenced daemon-relayed text that may carry
  // command text exactly as the sibling's `description` does. A consumer must render them as PLAIN
  // TEXT, NEVER HTML (no innerHTML / dangerouslySetInnerHTML), never into an attribute, a URL, a
  // filename, a cache key or a log, and must never execute or re-shell them — the daemon doc states
  // this rule in THIS frame's section rather than delegating it to the sibling, because a patch's
  // structured shape makes it the more tempting thing to feed somewhere that runs it, and `summary` is
  // prose a client will actually render. This slice has no DOM sink and runs no JSON.parse; the
  // constraint is inherited here. No token, key, or raw frame can ride the arm (five bounded strings
  // and a list of wire field names is the whole payload). `status` / `summary` ship dormant: no bridge
  // reads them until #1561 (`status`) and #1246 (`summary`) — the precedent is this arm's own, which
  // every exhaustive bridge no-opped until #567.
  | {
      type: 'backgroundTaskUpdated'
      conversationId: string
      taskId: string
      patch: string
      status: string
      summary: string
      truncatedFields: readonly string[] | null
    }
  // The background-task progress arm (#1638) — the fourth frame of the family: a running task is still
  // working, and what it is doing right now. Joined to the other three on `taskId`. Carries
  // `conversationId` for the siblings' reason: no turn_id, opens and closes no turn, so daemon STATE
  // (the queue_state rule, #720).
  //
  // `currentActivity` IS THE WIRE `description`, RENAMED ON PURPOSE. On this frame it is the task's
  // current activity ("Reading alpha.txt"); on `backgroundTaskStarted` the same wire name is the task's
  // opening description, a literal command line for `local_bash`. The distinct name keeps a consumer from
  // ever joining or overwriting one with the other.
  //
  // The three counters are claude's own readings, CUMULATIVE PER TASK and NOT GUARANTEED MONOTONIC,
  // carried exactly as received: never sum two frames, and tolerate a negative difference. The frames
  // are rate-bounded per task, so a gap between them proves nothing about a stall. There is no
  // `summary`, `patch` or `ambient` here. `truncatedFields: null` means NOTHING WAS CUT and must not be
  // collapsed into `[]`.
  //
  // SECURITY: `currentActivity`, `subagentType` and `lastToolName` are UNTRUSTED model- and
  // tool-authored text, and the current activity names a file on the operator's host. A consumer must
  // render them as PLAIN TEXT, NEVER HTML (no innerHTML / dangerouslySetInnerHTML), never into an
  // attribute, a URL, a filename, a path, a cache key or a log, and must never parse, execute or
  // re-shell them. Ships dormant: every exhaustive bridge no-ops it until #1640.
  | {
      type: 'backgroundTaskProgress'
      conversationId: string
      taskId: string
      currentActivity: string
      subagentType: string
      lastToolName: string
      totalTokens: number
      toolUses: number
      durationMs: number
      truncatedFields: readonly string[] | null
    }
  // The background-task roster arm (#566) — the AGGREGATE PEER of the two arms above: they report what
  // happened to ONE task, this reports the WHOLE LIVE SET. Three fields: one id, the rows, and a count.
  //
  // A SNAPSHOT, NOT A DELTA. Each frame replaces the reader's view of what is running rather than
  // amending it, so #567 REPLACES its held set per frame rather than merging into it. `tasks: []` is a
  // POSITIVE STATEMENT THAT NOTHING IS ALIVE — the payoff signal for pyrycode#1240 — and must be emitted
  // and consumed, NEVER dropped, filtered, or coalesced as "no news".
  //
  // Top-level fields are snake→camel; THE ROW TYPE IS REUSED VERBATIM with snake_case fields. That is not
  // an inconsistency to fix but the settled house rule for nested arrays, with two precedents (queueState
  // above and conversationsReceived): the row narrower already stripped each row to its known fields, so
  // there is nothing to drop and no mapping to write. `readonly` on the array mirrors queueState; the row
  // interface itself stays mutable, exactly like QueuedItem.
  //
  // Carries `conversationId` for the siblings' reason, settled in-family rather than argued fresh: the
  // test is "turn-stream item, or daemon state?", and this frame carries NO turn_id and opens and closes
  // no turn, so it follows the queue_state rule (#720). The task store (#567) attributes by id.
  //
  // `droppedTasks` is this frame's ONLY truncation report — there is deliberately no top-level
  // truncatedFields — so THE TRUE ROSTER SIZE IS `tasks.length + droppedTasks`, and a panel that shows
  // only the carried rows silently presents a capped roster as the whole one. `0` is a VALUE, never
  // consulted for truthiness. Each row's `truncated_fields: null` means nothing was cut FOR THAT ROW, is
  // distinct from `[]`, and is per-row: never hoist or flatten the lists across rows. `task_type` is an
  // OPEN string. NO TERMINAL EVENT EXISTS IN THIS FAMILY by design, so "finished" is a client conclusion
  // drawn from a task's absence in a LATER roster — legitimate for #567 to draw on its own terms, never
  // something to present as reported by the daemon.
  //
  // SECURITY: each row's `description` is UNTRUSTED, model-influenced daemon-relayed text and for
  // `task_type: local_bash` IS THE LITERAL COMMAND LINE claude ran. The panel slice (#568) must render it
  // as PLAIN TEXT, NEVER HTML (no innerHTML / dangerouslySetInnerHTML), never into an attribute or a URL,
  // and must never execute or re-shell it. The daemon states this rule PER ROW rather than delegating it
  // to the scalar frames, and its reason is the temptation unique to this arm: A LIST OF COMMAND LINES IS
  // A MORE TEMPTING SHAPE TO FEED SOMEWHERE STRUCTURED THAN A SINGLE ONE — treat `tasks` as a DISPLAY
  // list, never as a structured work list something iterates and acts on. This slice has no DOM sink; the
  // constraint is inherited here. No token, key, or raw frame can ride the arm (one id, a bounded list of
  // four-field rows, and a count is the whole payload). Ships dormant: all three exhaustive bridges no-op
  // it until #567 — the apiRetry-was-a-no-op-until-#493 precedent.
  | {
      type: 'backgroundTaskRoster'
      conversationId: string
      tasks: readonly BackgroundTask[]
      droppedTasks: number
    }
  // The unrecognized-message arm — the daemon's stream parser met claude output it has no mapping for.
  // Unlike its three status-peer neighbours above, this one is NOT a claude sub-state: it reports a gap
  // in the DAEMON's own mapping, and it is the reason the drop is visible at all (the daemon's own debug
  // log is not printed in production, so before this the drop left no trace anywhere).
  //
  // A DELIBERATE, security-reviewed WIDENING, and the widest on this union: `raw` is unbounded,
  // unstructured, model-adjacent JSON. It crosses IPC for the same reason `assistantDelta.text` does —
  // the raw text IS the render payload, and there is no summary that could replace it, because
  // the whole point is showing an operator the bytes we could not interpret. The boundary defended is
  // the fail-closed decode upstream (parseUnrecognizedMessagePayload: closed-enum `site`, required
  // strings, required boolean), not this internal channel. The daemon caps `raw` at 16 KiB and the
  // frame-level MAX_PLAINTEXT_BYTES guard (65519) backstops it, so the string is bounded before it gets
  // here — twice, by two independent limits.
  //
  // `raw` and `messageType` are UNTRUSTED daemon-relayed content: the consumer must render them as PLAIN
  // TEXT, NEVER HTML (no innerHTML / dangerouslySetInnerHTML) and never into an attribute or a URL —
  // mirroring the identical warning on conversationCreated / sessionTransition / queueState. React
  // escapes text children, so a `<pre>{raw}</pre>` is inert; those two sinks are the only ways to
  // break that, and neither appears in the consumer.
  //
  // `messageType` is deliberately allowed to be the empty string — the `undecodable` site means nothing
  // decoded, so no type was ever read.
  //
  // It carries `conversationId` (#784) — the frame's `conversation_id`, copied BY NAME at the emit from
  // an already-validated payload, never by spreading the decoded payload. The decode already required it
  // and this ticket did not touch that: a missing or non-string `conversation_id` fails the whole line
  // without emitting. REQUIRED, never optional: an optional routing key invites the `?? activeConversation`
  // fallback #675 exists to remove. A parser-gap row that cannot be attributed lands in the wrong thread —
  // and once the screen reads its own conversation's slice (#758), in no thread at all, which would make
  // an otherwise-silent gap in the daemon's stream mapping silent again.
  //
  // The id is a daemon-asserted ROUTING KEY, not rendered text — none of the untrusted-text warnings that
  // attach to `raw` and `messageType` above attach to it. It is never markup, a filename, a cache key, a
  // lookup path, an attribute or a URL, and it reaches no log sink (emitDaemonEvent is log-free by
  // construction, and the decoder's own messages name the failure CATEGORY only, never this id). It STOPS
  // at the renderer timeline bridge (#202), which rebuilds a fresh ThreadEvent from named fields and omits
  // it; ThreadEvent does not carry it, and the consumer that routes by it is the keyed holder (#755/#756).
  // Not dormant: that bridge owns the arm and reduceTimeline tail-appends a real row for it.
  | {
      type: 'unrecognizedMessage'
      conversationId: string
      site: WireUnrecognizedSite
      messageType: string
      raw: string
      truncated: boolean
    }
  // The session-boundary arm (#254, widened #285). Carries the four render fields the delimiter slice
  // (#286) needs: `newSessionId` (the addressing key the #259 holder retains), `reason` (the closed
  // WireSessionTransitionReason enum, carried so #286's title switch stays exhaustive — NOT a bare
  // string), `occurredAt` (RFC3339Nano, an opaque unparsed string), and `workspaceCwd` (`string | null`
  // — the new workspace dir for a `workspace_change`, `null` for `clear` / `idle_evict`, wire nullability
  // PRESERVED, never coerced to ''). Only `previous_session_id` is dropped at the emit (#285) — it has no
  // consumer. A session_id is a routing id, not a secret (the conversation_id convention), so no token,
  // key, or raw frame can ride this arm. `workspaceCwd` is an UNTRUSTED daemon-supplied filesystem
  // path: the render slice #286 must render it as plain text, NEVER HTML (no innerHTML /
  // dangerouslySetInnerHTML) — mirroring the identical warning on conversationCreated /
  // conversationUpdated. This ticket has no DOM sink; the constraint is inherited here for #286.
  // Consumed by the renderer holder (#259) and the delimiter slice (#286, not yet built), so all three
  // exhaustive bridges no-op it for now — matching how stallDetected was a no-op in daemonEventBridge
  // until #317.
  //
  // `conversationId` (#1192) is the marker's routing key: the conversation whose session rotated. Unlike
  // `runConfigReceived`'s above, this one IS daemon-asserted — the wire payload has carried it since
  // upstream #740/#741, and the daemon drops a transition it cannot bind rather than guessing — so it is
  // copied BY NAME at the emit from an already-validated payload, never by spreading the decoded payload.
  // REQUIRED, never optional, for the reason unrecognizedMessage states: an optional routing key invites
  // the `?? activeConversation` fallback #675 exists to remove, and here that fallback IS the defect this
  // arm's consumer was fixed for. The marker is pushed UNSOLICITED, so no envelope-id correlation of the
  // #1176 kind is available to substitute for it; this key is the only attribution there is.
  //
  // It is a ROUTING KEY, not rendered text — the untrusted-text warning above attaches to `workspaceCwd`
  // and not to this. It is never markup, an attribute, a URL, a filename, a cache key or a lookup path,
  // and it reaches no log sink (the decoder's messages name the failure CATEGORY only, and
  // emitDaemonEvent is log-free by construction). It is never rendered. It has two renderer consumers.
  // `subscribeSessionId` COMPARES it against the open conversation and discards it. Since #1559,
  // `timelineTargetFor` routes the session-boundary row by it, so it is also a key into the keyed
  // timeline store's `Map`, as every id-carrying arm's routing key already is.
  | {
      type: 'sessionTransition'
      conversationId: string
      newSessionId: string
      reason: WireSessionTransitionReason
      occurredAt: string
      workspaceCwd: string | null
    }
  // The set_session_settings confirmation arm (#264, correlated by #261). Carries `sessionId` — the
  // reply's one wire field (a routing id, not a secret, the conversation_id / sessionTransition
  // convention) — plus `changeId`, the RENDERER-MINTED correlation key (#261) that main matched the
  // reply to by `Envelope.in_reply_to` and echoed back so the renderer can tell two same-`sessionId`
  // changes apart. `changeId` is client-minted, non-secret, and IPC-internal; it is NOT the wire
  // `in_reply_to` — that numeric routing id stays main-internal and never rides this arm. No token,
  // key, or raw frame can ride it (AC3-by-construction). Consumed by #256 (pending→confirm/reject
  // store, not yet built), so all three exhaustive bridges no-op it for now — the
  // sessionTransition-was-a-no-op-until-#259 precedent.
  | { type: 'sessionSettingsUpdated'; sessionId: string; changeId: string }
  // The set_session_settings REJECTION arm (#269), the rejected twin of sessionSettingsUpdated. Emitted
  // by the MAIN-side correlation gate (daemonConnection.ts) when a content-free daemon `error` (#116)
  // arrives whose `Envelope.in_reply_to` matches a pending set_session_settings request — the client
  // learns its model / effort / YOLO change was rejected so #256 can roll back. Carries ONLY `changeId`,
  // the RENDERER-MINTED correlation key (#261) that main matched the error to; it disambiguates two
  // outstanding changes to the same session (AC4). Deliberately NO `sessionId` (the wire `error` frame
  // is content-free — carries no session_id — and `changeId` alone disambiguates), NO `in_reply_to`
  // (that numeric wire routing id stays main-internal), and NO error code / message (attacker-influenceable
  // bytes; no consumer needs them). No token, key, or raw frame can ride it (AC1/AC4-by-construction).
  // Consumed by #256 (pending→confirm/reject store, not yet built), so all three exhaustive bridges no-op
  // it for now — the sessionSettingsUpdated-was-a-no-op precedent.
  | { type: 'sessionSettingsRejected'; changeId: string }
  // The tool-call arm (#217, widened by #763). Carries the five render fields plus `conversationId` —
  // the frame's `conversation_id`, copied BY NAME at the emit from an already-validated payload, never by
  // spreading it. REQUIRED never optional (an optional routing key invites the `?? activeConversation`
  // fallback #675 exists to remove), a daemon-asserted ROUTING KEY rather than rendered text on the terms
  // the modelAnnounced arm above states in full, and fail-closed by a decode that needed no change: a
  // missing or non-string id drops the whole line without emitting. A tool call that cannot be attributed
  // renders as a row in the wrong thread (#675). It STOPS at the renderer timeline bridge (#202), which
  // rebuilds a fresh ThreadEvent from named fields and omits it; ThreadEvent does not carry it, and the
  // consumers that route by conversation are #756.
  // Consumed by that bridge → a `toolCall` item, not the session store. `name` / `inputSummary` are
  // opaque daemon display text the render slice (#218) must render as plain text. No token, key, or raw
  // frame — `input` is a string→string record built solely from the decoded payload, so that claim
  // survives it.
  // `input` (#642) is the tool's own input fields, name → value. ABSENT means the WIRE omitted it (a
  // pre-pyrycode#1678 daemon) — test `event.input === undefined`, never `'input' in event`; an empty
  // map is a DIFFERENT fact ("this daemon sent no fields for this call") and is never collapsed into
  // absence. Both its keys and its values are untrusted daemon display text under the same
  // plain-text-NEVER-HTML constraint as `name` / `inputSummary`; the render slice (#645) owns that DOM
  // sink. Key order is meaningless (alphabetical, a Go map artefact), the map may be incomplete (the
  // daemon's total bound drops fields and names none — `inputSummary` stays the whole-input fallback),
  // and the reserved keys `__proto__` / `constructor` / `prototype` can never appear (dropped by the
  // decoder), so consumers must ITERATE rather than probe by key. See ToolUsePayload for the full
  // contract.
  | {
      type: 'toolUse'
      conversationId: string
      turnId: string
      toolUseId: string
      parentToolUseId?: string
      name: string
      inputSummary: string
      input?: Readonly<Record<string, string>>
    }
  // The tool-result arm (#229, widened by #766). Carries the four render fields plus `conversationId` —
  // the frame's `conversation_id`, copied BY NAME at the emit from an already-validated payload, never by
  // spreading it. REQUIRED never optional (an optional routing key invites the `?? activeConversation`
  // fallback #675 exists to remove), a daemon-asserted ROUTING KEY rather than rendered text on the terms
  // the modelAnnounced arm above states in full, and fail-closed by a decode that needed no change: a
  // missing or non-string id drops the whole line without emitting. A tool result that cannot be
  // attributed resolves a tool call in the WRONG thread (#675). It STOPS at the renderer timeline bridge
  // (#202), which rebuilds a fresh ThreadEvent from named fields and omits it; ThreadEvent does not carry
  // it, and the consumers that route by conversation are #756.
  // Consumed by that bridge, which folds it through `fillResult` to RESOLVE the correlated `toolCall`'s
  // result in place — not the session store; that correlation stays on `toolUseId` alone. `isError` is a
  // boolean (`false` = success, a value); `resultSummary` is opaque daemon display text the render slice
  // (#230) must render as plain text. No token, key, or raw frame.
  // `resultDetail` (#773) is the daemon's short précis of the call's STRUCTURED outcome — "265 lines",
  // "110 of 1676 lines" — carried verbatim, unit words and interior spaces included, because a client
  // cannot tell a read from a search without switching on a tool name. ABSENT means the WIRE omitted it
  // (a pre-pyrycode#2024 daemon) — test `event.resultDetail === undefined`, never
  // `'resultDetail' in event`, which structured clone makes true either way. Absence and `''` mean the
  // same thing upstream (no count), but they are carried DISTINCTLY here: collapsing is lossy and buys
  // nothing, and the decision that both draw nothing belongs to the render slice (#856), which owns that
  // DOM sink. Untrusted daemon display text under the same plain-text-NEVER-HTML constraint as
  // `resultSummary` — never parsed back into a number, never an attribute, a URL, a filename, a cache
  // key, or a log line.
  | {
      type: 'toolDenied'
      conversationId: string
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
      conversationId: string
      turnId: string
      toolUseId: string
      parentToolUseId?: string
      isError: boolean
      resultSummary: string
      resultDetail?: string
    }
  // The queued-backlog arm (#292). Reuses the wire QueuedItem row type verbatim (the
  // conversationsReceived precedent) — snake_case, order preserved from the wire (enqueue order). Carries
  // `conversationId` (as every turn-stream arm now does) because the snapshot is REPLACEMENT-truth
  // and the #293 store keys its backlog by it. Consumed by the #293 queue store, NOT the session / timeline
  // / modal store — queue_state is daemon STATE, not a turn-stream item (#720), so all three exhaustive
  // bridges no-op it. `text` is UNTRUSTED daemon-relayed transit content the eventual render slice (#294)
  // must render as plain text, NEVER HTML (no innerHTML / dangerouslySetInnerHTML); this slice has no DOM
  // sink, but the constraint is inherited here. No token, key, or raw frame can ride this arm (AC5-by-
  // construction: QueuedItem holds only a numeric counter, opaque text, and a timestamp).
  | { type: 'queueState'; conversationId: string; queued: readonly QueuedItem[] }
  // The conversation-list arm (#139). Reuses the wire ConversationSummary row type verbatim (the
  // messagesReceived precedent) — snake_case, order preserved from the wire. Consumed by the
  // conversation-list store (#208), not the session store, so the session bridge maps it to `null`.
  // No token/key/raw frame — ConversationSummary carries only ids, a nullable title, two flags, a
  // workspace path, a nullable workspace NAME (#1287's `workspace_label`), and two timestamps. The path
  // and the name are both untrusted opaque display text; the name is not a path and nothing parses it.
  | { type: 'conversationsReceived'; conversations: readonly ConversationSummary[] }
  // The conversation-created arm (#241). Reuses the wire ConversationCreatedPayload verbatim (the
  // conversationsReceived / messageReceived precedent) — nothing to drop, no secret field: it carries
  // an id, a flag, a nullable title, a workspace path, a nullable workspace name (#1287's
  // `workspace_label`), and a timestamp. Consumed by the render slice
  // (#242, which opens the new thread), not the session store, so every exhaustive consumer no-ops it.
  // `name` and `cwd` are UNTRUSTED daemon-supplied strings: the render slice #242 must render them as
  // plain text, NEVER HTML (no innerHTML / dangerouslySetInnerHTML). This ticket has no DOM sink, but
  // the constraint is inherited here — do not drop this warning.
  | { type: 'conversationCreated'; conversation: ConversationCreatedPayload }
  // The conversation-updated arm (#273). Reuses the wire ConversationUpdatedPayload verbatim (the
  // conversationCreated precedent) — nothing to drop, no secret field: it carries an id, a flag, a
  // nullable title, a workspace path, a nullable workspace name (#1287's `workspace_label`), and a
  // timestamp. Emitted from an UNSOLICITED daemon BROADCAST
  // (not correlated by in_reply_to). Consumed by the list-reflect slice (#275, which flips the row from
  // discussion to channel), not the session store, so every exhaustive consumer no-ops it. `name`,
  // `cwd` and `workspace_label` are UNTRUSTED daemon-supplied strings: the render/store slice #275 must
  // render them as plain text, NEVER HTML (no innerHTML / dangerouslySetInnerHTML). This ticket has no
  // DOM sink, but the constraint is inherited here — do not drop this warning. READ THE LIST AS CLOSED
  // ONLY AS OF ITS LAST EDIT: #1287 added the third name to it, and a field left off a list that reads
  // as exhaustive is how a "this one is trusted" assumption gets inherited by a later consumer.
  | { type: 'conversationUpdated'; conversation: ConversationUpdatedPayload }
  // The conversation-deleted arm (#375). Carries the BARE routing `id` (a fresh literal, not the wire
  // payload object): the sibling conversationUpdated reuses ConversationUpdatedPayload by reference
  // because it has five fields with nothing to drop, but a delete reply has exactly one field, and the
  // single-field emit idiom (sessionSettingsUpdated naming `sessionId`) is a
  // fresh literal naming individual fields — so this flattens to `id: string`. The renderer removes a row
  // by id, a bare string is exactly what it needs, and events.ts stays free of a ConversationDeletedPayload
  // import (a primitive crosses IPC). Emitted from a CORRELATED reply (matched by in_reply_to, NOT a
  // broadcast — the deliberate contrast with conversationUpdated), but the `id` is self-sufficient so no
  // correlation state is threaded. Consumed by the list-reflect slice (#376, not yet built), so every
  // exhaustive consumer no-ops it for now; ships DORMANT (the stallDetected-was-a-no-op-until-#317
  // precedent). No token, key, or raw frame can ride a bare string id (AC-by-construction).
  | { type: 'conversationDeleted'; id: string }
  // The recent-workspaces arm (#380). Reuses the wire RecentWorkspace row type verbatim (the
  // conversationsReceived precedent) — snake_case, order preserved from the wire (most-recent-first).
  // Consumed by the recent-workspaces store (#382), NOT the session store, so every exhaustive consumer
  // no-ops it. No token/key/raw frame — each row carries only a `path` (untrusted display text) and an
  // opaque `last_used_at` timestamp. `path` is an UNTRUSTED daemon-supplied filesystem path: the #382
  // render slice must render it as PLAIN TEXT, NEVER HTML (no innerHTML / dangerouslySetInnerHTML) and
  // must NEVER resolve it into a local filesystem operation (it is a remote daemon-side path). This
  // ticket has no DOM sink, but the constraint is inherited here — do not drop this warning.
  | { type: 'recentWorkspacesReceived'; recentWorkspaces: readonly RecentWorkspace[] }
  // The workspace-folder-created arm (#381). Carries the BARE created `path` (a fresh literal, not the
  // wire payload object): the sibling conversationCreated reuses ConversationCreatedPayload by reference
  // because it has five fields with nothing to drop, but this reply has exactly one field, so it flattens
  // to `path: string` — the single-field emit idiom (conversationDeleted naming `id`,
  // sessionSettingsUpdated naming `sessionId`): a fresh literal naming the one field, keeping
  // events.ts free of a WorkspaceFolderCreatedPayload import (a primitive crosses IPC). Emitted from a
  // CORRELATED reply (matched by in_reply_to, NOT a broadcast), but the `path` is self-sufficient so no
  // correlation state is threaded. `path` is an UNTRUSTED daemon-supplied REMOTE filesystem path: the
  // Create-folder dialog (#157, not yet built) must render it as PLAIN TEXT, NEVER HTML (no innerHTML /
  // dangerouslySetInnerHTML) and must NEVER resolve it into a local filesystem operation (it is a remote
  // daemon-side path). This ticket has no DOM sink, but the constraint is inherited here — do not drop this
  // warning. Consumed by #157, so every exhaustive consumer no-ops it for now; ships DORMANT (the
  // conversationDeleted-was-a-no-op-until-#376 precedent). No token, key, or raw frame can ride a bare
  // string path (AC-by-construction).
  | { type: 'workspaceFolderCreated'; path: string }
  // The workspace-updated arm (#1288) — the daemon's report that a WORKSPACE's label changed, where the
  // sibling above reports that a workspace DIRECTORY was made. Carries the two fields FLAT (fresh
  // literals, not the wire payload object): the small-payload emit idiom its neighbours use
  // (workspaceFolderCreated naming `path`, conversationDeleted naming `id`), keeping events.ts free of a
  // WorkspaceUpdatedPayload import. Emitted from a frame that is CORRELATED by in_reply_to when this
  // client asked for the rename and UNSOLICITED otherwise — both emit identically, so no
  // correlation handle rides this broadcast arm. Identified results use workspaceRenameResult.
  //
  // NO CONSUMER READS EITHER FIELD, AND THAT IS THE DESIGN — read this before writing the first one.
  // The event is a REFRESH TRIGGER: `shouldRefreshList` reacts to its OCCURRENCE and re-requests the
  // conversation list, and the label that reaches the sidebar rides the authoritative `conversations`
  // reply on ConversationSummary.workspace_label, through the decode path #1287 hardened. Do NOT patch a
  // row from these fields — that would put untrusted daemon text on screen bypassing the list decode.
  //
  // BOTH STRINGS ARE UNTRUSTED DAEMON-SUPPLIED TEXT, and the warning binds at this declaration precisely
  // because nothing reads them today: `label` is operator-chosen text owed PLAIN-TEXT rendering, NEVER
  // HTML (no innerHTML / dangerouslySetInnerHTML); `path` is a REMOTE daemon-side filesystem path that
  // must never be resolved into a local filesystem operation, never keyed into a lookup (it is the
  // obvious key for a future workspace map and a plain object would resolve `__proto__`), never a
  // filename or cache key, and never a log argument. No token, key, or raw frame can ride two bare
  // strings (AC-by-construction).
  | { type: 'workspaceUpdated'; path: string; label: string | null }
  // Additive acknowledgement for identified renames; host origin is stamped in main.
  | { type: 'workspaceRenameResult'; attemptId: string; outcome: 'confirmed' | 'rejected' }
  // The outcome of one set_conversation_muted write (#1595), correlated by the renderer's attemptId.
  // Content-free on purpose: no conversation id, no daemon code or text, no muted value. What the
  // conversation now holds is the re-listed row's `is_muted`, not this event.
  | { type: 'conversationMuteResult'; attemptId: string; outcome: 'confirmed' | 'rejected' }
  // The create_workspace_folder REJECTION arm (#396), the rejected twin of workspaceFolderCreated.
  // Emitted by the MAIN-side correlation gate (daemonConnection.ts) when a content-free daemon `error`
  // (#116) arrives whose `Envelope.in_reply_to` matches a pending create_workspace_folder request — the
  // client learns its folder-creation request was rejected (a bad name — path separator, `..`, absolute,
  // or empty) so the Create-folder dialog (#398) can stay open for correction rather than spin forever.
  // BARE — carries NOTHING (contrast sessionSettingsRejected's `changeId` and modalAnswerRejected's
  // `modalId`, each of which disambiguates concurrent requests): only ONE create-folder dialog is open at
  // a time, so there is no concurrency to disambiguate, and the success twin workspaceFolderCreated carries
  // only `path` with no correlation key — the rejection twin is symmetric and, being bare, is maximally
  // content-free (AC3-by-construction: no field can hold a daemon-supplied byte, error code, message, path,
  // or wire id). Consumed by #397 (round-trip store, not yet built), so all three exhaustive bridges no-op
  // it for now — the workspaceFolderCreated-was-a-no-op precedent.
  | { type: 'workspaceFolderRejected' }
  // The create_conversation REJECTION arm (#1307), the rejected twin of conversationCreated and the
  // workspaceFolderRejected arm above in every respect but the verb. Emitted by the MAIN-side correlation
  // gate (daemonConnection.ts) when a content-free daemon `error` (#116) arrives whose
  // `Envelope.in_reply_to` matches a pending create_conversation request — so a create that cannot succeed
  // (a workspace folder that does not exist, or one escaping the daemon's home) can be reported instead of
  // looking like nothing happened. Before it, `createConversation` was fire-and-forget end to end and its
  // two callers — the FAB (#242) and the Channels-tree workspace plus (#1179) — had no failure path at all.
  // BARE — carries NOTHING (the workspaceFolderRejected argument, and one more besides): only one create
  // dialog is open at a time so there is no concurrency to disambiguate, and the daemon's own refusal
  // message never echoes the path, so there is nothing to surface even if the arm carried a field. Being
  // bare makes it maximally content-free BY CONSTRUCTION — no field can hold a daemon-supplied byte, error
  // code, message, path, or wire id. A LATE REJECTION IS POSSIBLE AND THE CONSUMER OWNS IT: the success
  // reply does not consume the pending entry (it doubles as an unsolicited broadcast), so an error
  // correlated to an already-created conversation still emits this. Gate on your own in-flight state, the
  // way #396's newFolderStore honors a reply only while a request is outstanding. Consumed by #1308's Add
  // workspace dialog, so all four exhaustive bridges no-op it for now — the workspaceFolderRejected-was-a-
  // no-op precedent.
  | { type: 'conversationCreateRejected' }
  // The notification-click arm (#393). UNLIKE every other arm, this is the FIRST MAIN-LOCAL signal on
  // the channel: it is NOT derived from a validated wire envelope — it is emitted by the main-process
  // notification click handler (index.ts) when the user clicks a fired OS notification, so the
  // emitDaemonEvent "nothing else sends on the channel" nuance now has exactly one main-local sender,
  // noted here rather than editing that helper. NULLARY by construction (AC3): it carries NO payload,
  // so no daemon-relayed content, conversation id, or wire field can ride it (mirroring
  // workspaceFolderRejected). Consumed by the notificationActivatedBridge (#393), which drives the
  // paired `open` nav (focus the window + show the single active conversation's thread) — a consume-only
  // filter bridge, so all three exhaustive bridges (session / timeline / modal) no-op it.
  // #1597: it may echo back the opaque `token` the renderer minted into that notification's `notify`
  // command, so the click opens the conversation that raised it. Main copies it unread; it names no
  // conversation or server, and the renderer re-validates it (isNotificationToken) before any lookup.
  // Optional, so an absent token keeps the old meaning: show the active conversation.
  | { type: 'notificationActivated'; token?: string }
  // The two modal arms (#201). Field names/types mirror `ModalEvent` (modalPrompts.ts, #122) so the
  // #223 bridge is a thin snake→camel rename. Consumed by the modal store + bridge (#223), NOT the
  // session store or timeline store.
  //
  // modalShown carries `conversationId` (#871) — the frame's `conversation_id` (pyrycode#1065, decoded
  // by #870), copied BY NAME at the emit from an already-validated payload, never by spreading the
  // decoded payload. The decode already required it: a missing or non-string `conversation_id` fails
  // the whole line without emitting, so the emit reads it bare and a `?? ''` there would turn that
  // fail-closed drop into a silent misattribution — a permission prompt filed against the wrong
  // conversation. REQUIRED, never optional: the wire has it always-present, and an assigned `undefined`
  // survives the structured clone across this channel, so an optional field would invent an absence
  // case the daemon never produces and make a later `'conversationId' in event` check read true on an
  // event carrying nothing.
  //
  // The id is a daemon-asserted SCOPING KEY, not rendered text — none of the untrusted-text warnings
  // below attach to it. It is never markup, a filename, a cache key, a lookup path, an attribute or a
  // URL, and it reaches no log sink (emitDaemonEvent is log-free by construction). The renderer modal
  // bridge (#223) rebuilds a fresh ModalEvent from named fields and, as of #877, copies this one across
  // by name onto the `shown` arm. #878 carries it one hop further still: `reduceModal` copies it by
  // name onto the held `ModalPrompt`, and `selectHasOutstandingFor` is the consumer that scopes a
  // prompt to a conversation. It is an OUTBOUND scoping key only: `modalId` remains the sole
  // correlation key for ANSWERING a prompt, and the daemon still resolves an inbound `modal_answer`
  // against its own outstanding-modal state.
  //
  // `title` / `prompt` / `options[].label` are untrusted `claude`-surfaced display text the render
  // slice (#224) must render as plain text, never HTML. No token, key, or raw frame (AC4).
  | {
      type: 'modalShown'
      conversationId: string
      modalId: string
      class: WireModalClass
      title: string
      prompt: string
      options: readonly WireModalOption[]
      defaultOptionId: string
      /** Untrusted JSON/text for display only; no attributes, paths, authority or logs. */
      reason?: unknown
      reasonType?: string
      blockedPath?: string
      description?: string
      defaultToNo?: boolean
      alwaysAllow?: ModalShownPayload['always_allow']
    }
  | { type: 'modalDismissed'; modalId: string; outcome: string; source: WireModalSource }
  // The question-batch arm (#885) — one whole batch of the clarifying questions claude's
  // `AskUserQuestion` tool raised, decoded fail-closed by #884 from the `question_shown` frame. Placed
  // beside the modal arms rather than at the end of the union because it copies `modalShown`'s
  // conversation-scoping shape and the two families are read together — but it is NOT a modal: a modal
  // is a permission prompt gating an action, answered against `modal_id`, while this is claude asking
  // the operator to choose, with its own nonce and (as yet) NO answer frame in the daemon contract at
  // all.
  //
  // Top-level fields are snake→camel; THE NESTED ROW TYPES ARE REUSED VERBATIM with their snake_case
  // fields, so `multi_select` stays `multi_select`. That is the settled house rule for nested arrays
  // (queueState / conversationsReceived / backgroundTaskRoster), for its usual reason: #884's narrower
  // already stripped each row to its known fields, so there is nothing to drop and no mapping to write.
  // THIS FAMILY NESTS TWO LEVELS where those three nest one — `options` hangs off each QUESTION, not
  // off the payload the way ModalShownPayload.options does — so the rule applies at BOTH levels, and a
  // reader pattern-matching off the modal family above gets that wrong by default. `readonly` on the
  // outer array mirrors queueState; WireQuestion and WireQuestionOption stay mutable interfaces exactly
  // as QueuedItem and BackgroundTask are.
  //
  // PROVENANCE IS PER FIELD and must not be flattened. The two ids are DAEMON-ASSERTED — the daemon
  // fills them from its own state, never from claude's tool input. `question`, `header`, and every
  // option's `label` and `description` are CLAUDE-AUTHORED: they crossed the subprocess trust boundary
  // and the daemon NEITHER BOUNDS NOR SANITIZES them (nothing on the path strips control characters or
  // terminal escapes). DECODED IS NOT SANITIZED — #884 made the SHAPE trusted and nothing more, and
  // `string` carries no signal for that. The render slice owes the escaping: plain text only, never
  // HTML (no innerHTML / dangerouslySetInnerHTML), never into an attribute, a URL, a filename, a cache
  // key, a lookup path, or a log. The last three are the ones a paraphrase drops and the ones a
  // question panel reaches for first, keying a tab by `header` or memoising by `label`.
  //
  // `conversationId` is an OUTBOUND display-scoping key only — what lets a client with several live
  // conversations avoid rendering one conversation's questions in another. `questionBatchId` remains
  // the SOLE correlation key, exactly the split modalShown has carried since #870. The nonce is
  // one-time and UNGUESSABLE, so it must never reach a log; nothing on this leg has a sink
  // (emitDaemonEvent is log-free by construction).
  //
  // An empty `questions` array is OUT OF CONTRACT daemon-side (a producer bug, not "claude asked
  // nothing" — the opposite of modelList's empty array) but it crosses unchanged: the transport
  // polices type, not membership, and what an empty batch means on screen is #850's call.
  //
  // PERMANENTLY no-op in all three exhaustive bridges, NOT dormant — the distinction matters, because
  // "dormant" in this file's vocabulary means a bridge case expected to flip later, and several have
  // (stallDetected #317, apiRetry #493, compacting #496, connected #538). This one cannot: its consumer
  // is #850's question store plus a DEDICATED bridge — a FOURTH independent subscriber on this channel,
  // the announcedModelBridge shape — so no case in session, timeline or modal will ever claim it.
  | {
      type: 'questionShown'
      conversationId: string
      questionBatchId: string
      questions: readonly WireQuestion[]
    }
  // The question-retirement arm (#895) — the frame that ends the batch above, decoded fail-closed by
  // #894, so a client takes the panel down rather than rendering an ask that is already dead.
  //
  // `source` IS A PLAIN string AND DELIBERATELY NOT WireModalSource, and getting that wrong is the
  // single most likely mistake in this family — it compiles nowhere it should and passes everywhere it
  // shouldn't. The pull is real: this file already imports WireModalSource, the modalDismissed arm two
  // lines up annotates its `source` with it, and QuestionDismissedPayload's own doc calls this frame
  // "field for field with ModalDismissedPayload". It is still wrong. That closed set is
  // {remote, local, timeout} and THE PRODUCER EMITS NO MEMBER OF IT: `remote` and `local` are ANSWERED
  // outcomes belonging to the not-yet-landed answer half (upstream pyrycode#1907), and `timeout` is not
  // emitted either, because the dismissal arbiter is one closure the control server defers on every
  // `Await` return and cannot tell an elapsed approval window from a caller disconnect or a daemon
  // shutdown — so all three terminal paths emit the ONE landed pair, `outcome: "unanswered"` with
  // `source: "no_answer"`. Closing the enum here rejects the only traffic that exists. The trap has
  // teeth because `timeout` IS a valid member and is sitting in upstream
  // internal/protocol/testdata/question_dismissed.json — a SHAPE fixture minted by the declaring slice
  // before any producer existed, not the live vocabulary. An arm typed WireModalSource and tested with
  // `timeout` typechecks AND passes while rejecting every real frame. If a type error appears at the
  // emit site, WIDEN THE ARM; never cast the payload, never copy that fixture's value.
  // parseQuestionDismissedPayload's docblock made this same call one hop upstream ("do not tighten them
  // toward each other") — do not un-make it here.
  //
  // THE FAIL-CLOSED READING RULE IS WHAT MAKES THE OPEN TYPE SAFE, and it belongs to the consumer: an
  // unrecognised `source` means RESOLVED, CAUSE UNKNOWN, and NEVER an answer. Backwards, it renders a
  // daemon safe-deny as the operator's own choice — showing them as having approved something they
  // never saw. The values a client written today will not recognise are precisely the ones the producer
  // has yet to name, so this is a live path, not a hypothetical one.
  //
  // NO conversationId, and DO NOT ADD ONE "for symmetry with the batch" — the absence is part of the
  // contract. The batch nonce is the sole correlation key; a shape carrying both would admit a
  // disagreeing pair someone has to adjudicate, and a client holding the batch already knows its
  // conversation. This arm carries exactly one id where questionShown carries two.
  //
  // THE TRUST TIER DIFFERS FROM ITS SIBLING'S IN BOTH DIRECTIONS. Unlike questionShown this arm carries
  // NO CLAUDE-AUTHORED BYTE: the id is daemon-asserted and `outcome` is an opaque producer-defined
  // sentinel carried verbatim and never enum-checked, which NEVER carries a claude-authored option
  // label — a published contract rather than a coincidence, and the reason a consumer needing the label
  // reads it from the batch it already holds, keyed on questionBatchId. So questionShown's per-field
  // escaping obligations have no counterpart here. THEY ARE NOT REPLACED BY A SAFETY GUARANTEE: all
  // three fields are daemon-ASSERTED, not daemon-BOUNDED. That provenance is the honest producer's
  // promise, not a property anything verifies — the only check at the boundary is `typeof === 'string'`,
  // and a compromised daemon puts whatever it likes in `outcome` and `source` at whatever length the
  // frame cap allows. Do not read "daemon-asserted" as "safe to render as trusted chrome": the escaping
  // and length-bounding boundary is still this client's.
  //
  // `questionBatchId` is the batch's one-time UNGUESSABLE nonce echoed back and must never reach a log;
  // nothing on this leg has a sink (emitDaemonEvent is log-free by construction). It is DEAD once this
  // frame lands, and receiving it is NOT a capability — a retired batch resolves nothing daemon-side,
  // the way a stale modalId resolves nothing under first-answer-wins. Matching it against a held batch
  // wants plain `===`, not crypto.timingSafeEqual: a local routing decision between two values the
  // client already holds, not a secret compared against an attacker's guess.
  //
  // PERMANENTLY no-op in all three exhaustive bridges, NOT dormant, on its sibling's terms — its
  // consumer is #850's question store plus a DEDICATED bridge, a FOURTH independent subscriber on this
  // channel, so no case in session, timeline or modal will ever claim it.
  | { type: 'questionDismissed'; questionBatchId: string; outcome: string; source: string }
  // The correlated modal-answer rejection arm (#248). Emitted by the MAIN-side correlation window
  // (daemonConnection.ts) when a content-free daemon `error` (#116) arrives while a `modal_answer` this
  // client sent (#236) is awaiting its reply — an ungranted device's answer round-trips to an `error`
  // that carries NO `modal_id` (ADR 0009), so attribution is the transport's own outstanding-answer
  // memory, never a field read from the untrusted `error`. Carries ONLY `modalId` — the one-time nonce
  // already renderer-visible from `modalShown` (#201), NEVER the daemon ErrorPayload text (AC4/AC3 by
  // construction: no field can hold the error content, a token, key, or raw frame). Consumed by the
  // modal bridge (#249, render), NOT the session or timeline store — so this slice ships the arm
  // DORMANT (every exhaustive bridge routes or no-ops it), matching how sessionTransition (#254) added
  // the arm + three bridge no-ops while its consumer (#259) waited.
  | { type: 'modalAnswerRejected'; modalId: string }
  // The relay-link status arm (#328). Content-free by construction (ADR 0007): carries ONLY the
  // closed RelayLinkStatus category — no token, key, raw frame, close code, or payload byte. Surfaces
  // the relay SOCKET leg (dialing / dropped) as a signal distinct from the session `connecting` /
  // `connected` / `failed` arms, so a later two-dot indicator can tell a relay-hop stall from a
  // daemon-hop stall. Consumed by the renderer relay-link store + bridge (#329, not yet built) → the
  // two-dot indicator (#330); ships DORMANT — all three exhaustive bridges no-op it (the
  // stallDetected-was-a-no-op-until-#317 precedent).
  | { type: 'relayLinkChanged'; status: RelayLinkStatus }
  // The slash-command menu arm (#937) — the verbs claude will accept for one conversation IN ITS
  // WORKING DIRECTORY, decoded fail-closed by #936 from the `slash_command_list` frame. Placed at the
  // end of the union rather than beside its wire neighbours the question arms: those sit mid-file
  // because `questionShown` copies `modalShown`'s conversation-scoping shape and the two families are
  // read together, whereas this one opens its own family and has no such neighbour. Its structural
  // relative is `backgroundTaskRoster` above — one id, the rows, and a drop count — and the name
  // follows it: a NOUN naming the snapshot, not a past participle naming an occurrence, and
  // deliberately not `slashCommandsReceived`, since the union's `…Received` arms
  // (`conversationsReceived`, `recentWorkspacesReceived`) name a reply to a request THIS CLIENT MADE
  // and this frame is unsolicited.
  //
  // A SNAPSHOT, NOT A DELTA. Each frame REPLACES a reader's view of the menu rather than amending it.
  // `commands: []` is a POSITIVE STATEMENT THAT CLAUDE OFFERED NOTHING — note the contrast with
  // `questionShown`, whose empty array is out of contract and means a producer bug; the two read alike
  // and say opposite things — so an empty menu must be emitted and consumed, never dropped or coalesced
  // as "no news".
  //
  // Top-level fields are snake→camel; THE ROW TYPE IS REUSED VERBATIM with its snake_case fields, so
  // `argument_hint` and `truncated_fields` stay as the wire spells them. That is the settled house rule
  // for nested arrays, with four precedents (queueState, conversationsReceived, backgroundTaskRoster,
  // questionShown): #936's narrower already stripped each row to its five known fields, so there is
  // nothing to drop and no mapping to write. This family nests ONE level, unlike questionShown's two.
  // `readonly` on the array mirrors queueState; WireSlashCommand itself stays a mutable interface,
  // exactly as QueuedItem and BackgroundTask are.
  //
  // All three fields are REQUIRED, never optional: the wire has them always-present, #936's decode
  // requires all three, and an assigned `undefined` SURVIVES THE STRUCTURED CLONE across this channel —
  // so an optional field would invent an absence case the daemon never produces and make a later
  // `'droppedCommands' in event` check read true on an event carrying nothing.
  //
  // `droppedCommands` IS THIS FRAME'S ONLY TRUNCATION REPORT AT THE FRAME LEVEL, so THE MENU'S TRUE
  // SIZE IS `commands.length + droppedCommands` and a panel showing only the carried rows silently
  // presents a cut menu as the whole one. `0` is a VALUE, never consulted for truthiness — the key is
  // always written, so an absent one is a real defect rather than a valid zero — and nothing may
  // recompute it from, or reconcile it against, the number of rows carried. Each row's
  // `truncated_fields` names THAT ROW'S OWN cut fields and `null` means nothing was cut for it, a value
  // distinct from `[]`: never hoist or flatten those lists across rows.
  //
  // **A CUT `aliases` IS UNKNOWABLE FROM `aliases` ALONE.** The wire collapses absent and empty into
  // the same `[]`, so a `truncated_fields` NAMING `aliases` is the ONLY signal separating "cut to
  // nothing" from "none", and a consumer must read it as UNKNOWN, never as *no aliases*. Reading it as
  // "none" greys out a working command — the Actions menu's own `reset` entry is an ALIAS of `clear`
  // (#681), not a command name.
  //
  // SECURITY — `name`, `argument_hint`, `description` and EVERY STRING IN `aliases` are
  // WORKSPACE-AUTHORED: whoever wrote the repository wrote them. That is a LOWER TRUST TIER than the
  // claude-authored strings `modelAnnounced` and `questionShown` carry, not a restatement of it. The
  // daemon BOUNDS THEM AND DOES NOT SANITIZE THEM, and #936 made the SHAPE trusted and nothing more —
  // `string` carries no signal for that. The render slice owes the escaping: plain text only, never
  // HTML (no innerHTML / dangerouslySetInnerHTML), never into an attribute, a URL, a filename, a cache
  // key, a lookup path, or a log. `name` in particular IS NOT AN IDENTIFIER — one measured name is
  // `__remote-workflow` — so nothing may key a cache or a memo by it. The log clause bites harder here
  // than on the neighbouring arms and the reason is measured: `0x0a` is the ONLY sub-`0x20` byte
  // anywhere across the capture's 51 entries, so the control character that actually occurs is the one
  // that splits a log line, and a logged description is a workspace author forging log records.
  // `conversationId` is an OUTBOUND routing/scoping key and NOT a nonce — nothing on this arm is
  // unguessable and nothing is a secret, unlike questionShown's batch id — so the never-log rule
  // applies here for log forgery rather than for secrecy. No token, key, or raw frame can ride the arm
  // (one id, a bounded list of five-field rows, and a count is the whole payload).
  //
  // Ships DORMANT: all FOUR exhaustive bridges no-op it until #938 holds the list per conversation
  // (the apiRetry-was-a-no-op-until-#493 precedent), and #681 matches an Actions-menu entry against a
  // name or an alias. Dormant, NOT permanent like the two question arms — whether #938 subscribes
  // through an existing bridge or stands up its own is #938's call, not this slice's.
  | {
      type: 'slashCommandList'
      conversationId: string
      commands: readonly WireSlashCommand[]
      droppedCommands: number
    }
  // The model-menu arm (#973) — the IDENTITIES claude will accept for one conversation, decoded
  // fail-closed by #972 from the `model_list` frame. Its sibling `slashCommandList` above rides the same
  // `initialize` control reply and is its structural twin in every respect: one id, the rows, and a drop
  // count. Placed after it for that arm's own stated reason — this family opens its own group and has no
  // mid-file neighbour to sit beside. The name is a NOUN naming the snapshot, following
  // `slashCommandList` and `backgroundTaskRoster` and deliberately not `modelsReceived`: the union's
  // `…Received` arms (`conversationsReceived`, `recentWorkspacesReceived`) name a reply to a request THIS
  // CLIENT MADE, and this frame is unsolicited — it rides a `control_response` but is not correlated by
  // this client's outstanding-request memory, so it is emitted unconditionally on decode.
  //
  // EXACTLY TWO OTHER ARMS IN THIS UNION CARRY A FIELD NAMED `model`, AND BOTH MEAN SOMETHING ELSE THAN
  // THIS ONE. `runConfigReceived.model` is the per-session OVERRIDE, where `''` means "inherited default,
  // no override". `modelAnnounced.model` is what claude announced FOR THE CURRENT TURN. This arm's rows
  // are a THIRD meaning — the MENU, what claude will accept BEFORE a turn picks one — and a reader
  // meeting any of the three needs the other two to place it. Two, not three; do not transcribe a count
  // from neighbouring prose.
  //
  // A SNAPSHOT, NOT A DELTA. Each frame REPLACES a reader's view of the menu rather than amending it. And
  // A CONSUMER MUST NEVER BLOCK A MODEL MENU ON THIS FRAME: its delivery window is narrow and lossy, so a
  // menu that waits for it can wait forever.
  //
  // ONE FRAME STATES THREE DIFFERENT POSITIONS ON EMPTY, and a reader who assumes one rule gets two of
  // them wrong. `models: []` is a POSITIVE STATEMENT THAT CLAUDE OFFERED NOTHING — the daemon normalises
  // a nil slice and `omitempty` is deliberately out — so an empty menu must be emitted and consumed,
  // never dropped or coalesced as "no news". A row's `effort_levels: []` is a COLLAPSE, not a statement:
  // absent, null and empty all arrive as `[]` because a client's behaviour is identical for all three.
  // And `truncated_fields` is EXEMPT FROM NORMALISATION ENTIRELY, so `null` and `[]` are distinct values
  // there and neither may be folded into the other.
  //
  // Top-level fields are snake→camel; THE ROW TYPE IS REUSED VERBATIM with its snake_case fields, so
  // `resolved_model`, `display_name`, `effort_levels`, `supports_auto_mode` and `truncated_fields` stay
  // as the wire spells them. That is the settled house rule for nested arrays, with five precedents
  // (queueState, conversationsReceived, backgroundTaskRoster, questionShown, slashCommandList): #972's
  // narrower already rebuilt each row as a fresh six-field literal, so there is nothing to drop and no
  // mapping to write. This family nests ONE level. `readonly` on the array mirrors queueState and
  // slashCommandList; WireModelOption itself stays a mutable interface, exactly as QueuedItem and
  // BackgroundTask are.
  //
  // All three fields are REQUIRED, never optional: the wire has them always-present, #972's decode
  // requires all three, and an assigned `undefined` SURVIVES THE STRUCTURED CLONE across this channel —
  // so an optional field would invent an absence case the daemon never produces and make a later
  // `'droppedModels' in event` check read true on an event carrying nothing.
  //
  // TRUNCATION — `droppedModels` IS THIS FRAME'S ONLY REPORT AT THE FRAME LEVEL, so THE MENU'S TRUE SIZE
  // IS `models.length + droppedModels` and a panel showing only the carried rows silently presents a cut
  // menu as the whole one ("10 of 40" is the honest render). THE LIST IS CUT FROM THE TAIL, so the rows
  // carried are claude's FIRST N IN CLAUDE'S OWN ORDER — order is meaning here, never to be re-sorted
  // before a reader is told what was lost. `0` is a VALUE, never consulted for truthiness — the key is
  // always written, so an absent one is a real defect rather than a valid zero — and nothing may
  // recompute it from, or reconcile it against, the number of rows carried. THE PRODUCER'S TEN-ENTRY CAP
  // IS A DAEMON-SIDE PRODUCER CAP, NOT A WIRE CONSTANT: nothing may hardcode it, treat a list of exactly
  // ten as a signal, or derive truncation from anything but this field. Each row's `truncated_fields`
  // names THAT ROW'S OWN cut fields and reports only for itself — never hoist or flatten those lists
  // across rows, and note there is no hoisted list on the frame at all.
  //
  // **A CUT `effort_levels` IS UNKNOWABLE FROM `effort_levels` ALONE.** The wire collapses absent and
  // empty into the same `[]`, so a `truncated_fields` NAMING `effort_levels` is the ONLY signal
  // separating "cut to nothing, or shortened" from "this model exposes no effort control", and a consumer
  // must read it as UNKNOWN, never as *none*. Read as "none", a cut list silently removes an effort
  // control the model actually supports. `WireSlashCommand`'s cut-`aliases` hazard, transposed.
  //
  // SECURITY — PROVENANCE IS PER FIELD, and the two halves differ. `conversationId` is DAEMON-ASSERTED:
  // an OUTBOUND DISPLAY-SCOPING KEY ONLY, which is what lets a client with several live conversations
  // avoid showing one conversation's model menu in another. It grants no inbound capability and is NOT a
  // nonce — nothing here is unguessable and nothing is a secret, the posture `modal_shown` and
  // `question_shown` carry — so matching it wants plain `===` and specifically not
  // `crypto.timingSafeEqual`. EVERY STRING IN A ROW — `resolved_model`, `value`, `display_name`, and
  // every string in `effort_levels` — is CLAUDE-AUTHORED text that crossed the subprocess trust boundary.
  // That is a HIGHER trust tier than `slashCommandList`'s workspace-authored strings, not a restatement
  // of it. DECODED IS NOT SANITIZED: #972 made the SHAPE trusted and nothing more (a `string` carries no
  // signal for that), the daemon BOUNDS THESE STRINGS AND DOES NOT SANITIZE THEM, and THE RENDER BOUNDARY
  // THAT OWES THE ESCAPING IS THIS CLIENT'S. Safe as inert, escaped, length-bounded text; never into a
  // raw-markup sink (no innerHTML / dangerouslySetInnerHTML), an attribute, a URL, a filename, a cache
  // key, a lookup path, or a log. Unlike its sibling's, the never-a-log clause here rests on the CONTRACT
  // rather than on a measurement: no control byte is measured in these short labels, but the daemon does
  // not sanitize, so one is PERMITTED rather than excluded. `value` in particular IS NOT PARSEABLE FOR
  // MATCHING, INDEXING OR KEYING — the measured entries are `default`, `opus[1m]`, `claude-fable-5[1m]`,
  // `sonnet`, `haiku` — so no join may split it, no index may be built from a piece of it, and it may
  // never be presented as a version. #1095 re-scoped this from the absolute it used to state: deriving a
  // DISPLAY LABEL is none of those three, and the footer's model control derives a family from a leading
  // run of ASCII letters. That is a view-side transform downstream of every lookup on this arm, and no
  // derived label is ever fed back into one. If a consumer indexes rows by `display_name`,
  // THE INDEX IS A `Map`: `index[row.display_name] = row` with a `__proto__` label writes through to
  // Object.prototype. No token, key, or raw frame can ride the arm (one id, a bounded list of six-field
  // rows, and a count is the whole payload).
  //
  // PERMANENTLY no-op in all FOUR exhaustive bridges, NOT dormant — and unlike the sibling's, which
  // shipped dormant because #938 had not yet chosen, this is already decided: #974 commits to a DEDICATED
  // subscriber in the announcedModelBridge / backgroundTaskRosterBridge / slashCommandListBridge posture,
  // so no case in the session, modal, question or timeline switch will ever claim it.
  | {
      type: 'modelList'
      conversationId: string
      models: readonly WireModelOption[]
      droppedModels: number
    }
  // The two conversation-history arms (#1222) — one backward step of a scroll-back walk, and its
  // refusal. Both cross from the background process, which owns the ask, the correlation and the
  // decode; nothing in the window drives either yet (#1224 asks, #1223 renders, #1225 joins a page to
  // the live stream), so all four exhaustive bridges take null arms.
  //
  // `conversationId` IS THE ONE FIELD ON BOTH ARMS THE DAEMON DID NOT ASSERT, and the provenance is
  // `runConfigReceived`'s exactly: a `history_page` carries NO conversation id — a decision rather than
  // an omission, since correlation rides `in_reply_to` and nothing in a page is echoed from the request
  // — so it is resolved in the background process, which records each `request_history`'s envelope id
  // against the conversation that request named and matches the reply back by `Envelope.in_reply_to`.
  // What crosses is therefore CLIENT-OWNED: the id this app put in its own outbound frame, held in
  // main-process memory and handed back, never a string parsed out of an inbound payload. That is the
  // one thing not to generalise from the daemon-asserted ids on assistantDelta / modelAnnounced /
  // toolUse — their warnings are theirs. What it DOES share with them is required-ness and the reason:
  // an optional routing key invites `?? openConversation` fallbacks, which is the misattribution the
  // correlation exists to remove, so a consumer that cannot resolve it drops the event rather than
  // guessing. It is a routing key and not rendered text — never markup, an attribute, a URL, a
  // filename, a cache key or a lookup path — and it reaches no log sink. The numeric `in_reply_to` it
  // was resolved from is deliberately NOT carried: the window receives the id it supplied.
  //
  // SECURITY — `entries` IS REPLAYED CONTENT AND THE MOST UNTRUSTED PAYLOAD ON THIS UNION. Each entry
  // is one stored envelope's worth, operator-authored for a stored `message` and `claude`-authored for
  // a stored assistant frame, carrying EXACTLY the trust class of the live frame it mirrors — nothing
  // about it is more trusted for having been stored, and the daemon's § Security model threat 1 lands
  // here.
  //
  // SINCE #1227 NOTHING UNTYPED CROSSES. #1222 shipped this field as `readonly HistoryEntry[]` — a
  // stored `type` string nothing re-validated beside a `payload` of arbitrary unparsed JSON — and the
  // window would have had to parse it, on the wrong side of the boundary CLAUDE.md draws. The
  // background process now decodes each entry against the same payload parser the live lane uses, so
  // what crosses is `HistoryTimelineEntry`: a closed union of scalars, with the entry's `id` and `ts`
  // beside it. That NARROWS this arm rather than widening it, and it is where the untrusted-text rules
  // now live — see `HistoryTimelineEvent` above, which names every replayed string and binds each to
  // plain text only, never a markup sink, an attribute, a URL, a filename, a cache key or a lookup path.
  //
  // TWO SKIPS ARE ORDINARY AND NEITHER COSTS THE PAGE. An entry of a stored type the timeline does not
  // draw is skipped, and so is one whose payload fails to parse; order is preserved among the
  // survivors, and a page every entry of which was skipped crosses as an EMPTY page rather than as a
  // failure, so #1224's walk can still step past it. NO PROMPT EVER CROSSES: `modal_shown` /
  // `question_shown` have no arm in the decode, so nothing answerable can reach the window from
  // history, whether a future daemon starts logging one or a hostile one plants one in a page.
  // No token, key or raw frame can ride either arm.
  //
  // `cursor` and `atStart` cross AS SENT and are never inferred from each other or from the entry
  // count. `atStart` is the ONLY termination signal — a page filling exactly at the log's first entry
  // reports it false with a usable cursor, and a SHORT page says nothing, since the daemon may serve
  // fewer entries than asked to fit the envelope cap. The cursor is opaque: stored and handed back
  // verbatim, never parsed, and NOT a secret and NOT a capability — it is deliberately unsigned, and
  // authorization is pairing, enforced at the Noise handshake.
  | {
      type: 'historyPageReceived'
      conversationId: string
      entries: readonly HistoryTimelineEntry[]
      cursor: string
      atStart: boolean
    }
  // The refusal half. `reason` is a CLIENT-OWNED literal narrowed from the daemon's `code` at the
  // decode boundary and compared there against constants — no daemon string crosses, and neither the
  // daemon's static message nor anything echoed from the request does either.
  //
  // `retryable` is CARRIED rather than left to the consumer to derive, which diverges from
  // `DaemonErrorOutcome`'s "retryability is documented, not computed" posture on purpose. That posture
  // holds because the attachment flags live in two upstream files, so no single client-side list could
  // be right; here the whole set is one verb's, published in one section, with exactly ONE retryable
  // member. Computing it once, at the single emit, is what stops the walk driver (#1224) from
  // re-deriving it wrong into a retry loop against a relay that is merely withholding the frame.
  | {
      type: 'historyRequestFailed'
      conversationId: string
      reason: HistoryRequestFailure
      retryable: boolean
    }
  // The system-prompt read arm (#1230): what prompt a conversation holds, and whether the running
  // session was started with a different one. It crosses from the background process, which owns the
  // ask, the correlation and the decode; NOTHING IN THE WINDOW CONSUMES IT YET — the store is #1231
  // and the editor surface #1078 — so all four exhaustive bridges take a no-op arm.
  //
  // `conversationId` IS THE FIELD THE DAEMON DID NOT ASSERT, and the provenance is `runConfigReceived`'s
  // and `historyPageReceived`'s exactly: a `system_prompt` reply carries NO conversation id, so it is
  // resolved in the background process, which records each `request_system_prompt`'s envelope id
  // against the conversation that request named and matches the reply back by `Envelope.in_reply_to`.
  // What crosses is CLIENT-OWNED — the id this app put in its own outbound frame, held in main-process
  // memory and handed back — never a string parsed out of an inbound payload. Do not generalise that
  // from here to the daemon-asserted ids on assistantDelta / modelAnnounced / toolUse; their warnings
  // are theirs. What it DOES share with them is required-ness and the reason: an optional routing key
  // invites `?? openConversation` fallbacks, which is the misattribution the correlation exists to
  // remove, so a consumer that cannot resolve it drops the event rather than guessing. It is a routing
  // key and not rendered text — never markup, an attribute, a URL, a filename, a cache key or a lookup
  // path — and it reaches no log sink. The numeric `in_reply_to` it was resolved from is deliberately
  // NOT carried: the window receives the id it supplied.
  //
  // HERE THE MISSING CONVERSATION ID IS ALSO A SECURITY PROPERTY UPSTREAM, not just an inconvenience:
  // it is what makes an unhosted conversation's reply byte-identical to a hosted-but-quiet one, so the
  // verb cannot be used as a conversation-membership probe. A consumer must not try to recover the
  // distinction; `sessionPromptStatus: 'no_session'` merges five daemon states and is ONE reading.
  //
  // SECURITY — `systemPrompt` IS UNTRUSTED OPERATOR TEXT arriving over the network, and the most
  // sensitive string on this union after the timeline's replayed content. It is a value to be RENDERED
  // (#1078) and edited, and nothing else: never into a raw-markup sink (no innerHTML /
  // dangerouslySetInnerHTML), never into an attribute or a URL, and never a filename, a cache key or a
  // lookup path — the `runConfigReceived` / `permissionMode` rule, restated because this field is
  // longer, operator-authored and round-trips back to the daemon as a write. It reaches NO LOG SINK on
  // any path: the decode arm logs byte length and a one-way hash only, the decode-failure catch drops
  // its caught error rather than quoting it, and `emitDaemonEvent` is log-free by construction. THE
  // ONE SINK LEFT IS THE BRIDGES' `assertNever`, which stringifies the whole event into an `Error`
  // message — which is why every exhaustive switch over this union takes an explicit arm for this
  // type rather than relying on a `default`.
  //
  // THE TRI-STATE CROSSES INTACT AND MUST KEEP CROSSING INTACT. `undefined` means no prompt is stored,
  // `''` means an explicitly empty prompt IS stored, and any other string is the stored text; a
  // consumer that collapses the first two cannot write the value back without changing it. Declared as
  // a REQUIRED key of type `string | undefined` rather than an optional property, so no consumer can
  // forget it and no producer can omit it; `undefined` is a structured-clone-supported value, so the
  // distinction survives the IPC bridge as written.
  //
  // `sessionPromptStatus` is INDEPENDENT of it and neither is derived from the other. Text beside
  // `no_session` is the ordinary "configured, applies at the next session start" reading; an absent
  // prompt beside `matches` is a conversation holding nothing whose session spawned with nothing,
  // because the daemon compares the COLLAPSED stored value. The spawned-with text is deliberately not
  // carried — `differs` says the two disagree and stops there. The status is a CLIENT-OWNED literal
  // narrowed at the decode boundary against constants, so no daemon string crosses on that field.
  | {
      type: 'systemPromptReceived'
      conversationId: string
      systemPrompt: string | undefined
      sessionPromptStatus: SessionPromptStatus
    }
  // The system-prompt WRITE arms (#1249), the read arm's counterpart: one confirmation, one refusal,
  // and exactly one of the two per write. NOTHING IN THE WINDOW CONSUMES THEM YET — the sender and the
  // store holding the outcome are #1250, the editor surface #1078 — so all four exhaustive bridges
  // take a no-op arm for each.
  //
  // `conversationId` IS THE CORRELATION HANDLE, and it is what keeps these off the
  // `workspaceFolderRejected` precedent above, which carries NOTHING. A bare outcome would satisfy a
  // careless reading of "exactly one confirmation outcome" while leaving the consumer unable to settle
  // the write that caused it. Its provenance is `historyPageReceived`'s and `systemPromptReceived`'s
  // exactly: the background process records each `set_system_prompt`'s envelope id against the
  // conversation that write named, and matches the answer back by `Envelope.in_reply_to`. What crosses
  // is CLIENT-OWNED — the id this app put in its own outbound frame — and on the confirmation that
  // matters more than on the read arm, because here a daemon-asserted id IS available and must not be
  // used: the ack record carries an `id` of its own, so a hostile or confused daemon answering write A
  // with a record naming conversation B would misattribute the outcome if the emit read it. The
  // numeric `in_reply_to` the match was resolved from is deliberately NOT carried.
  //
  // EXACTLY ONE OUTCOME PER WRITE IS STRUCTURAL, NOT PROMISED. Both arms consume the SAME correlation
  // entry, so a daemon sending both an ack and an error for one write settles it once — whichever
  // frame arrives first wins, and the second matches nothing.
  //
  // THE CONFIRMATION CARRIES NOTHING ELSE, DELIBERATELY. The `conversation_updated` record that
  // answers this write does not carry the prompt — it is broadcast-shaped daemon-side, and only the
  // requester asked about the value — so this arm must not be grown a field that would suggest it
  // does. What a conversation now holds is the READ path's answer (`systemPromptReceived`), and that a
  // saved prompt leaves the RUNNING session untouched, taking effect at the next spawn, is #1078's to
  // tell the operator. Nothing here may paper over that with an optimistic local value.
  //
  // SECURITY: neither arm carries a prompt byte, nor its length, on any path — the ack has no prompt
  // field to carry and the refusal echoes no supplied byte. `reason` is a CLIENT-OWNED literal:
  // narrowed at the decode boundary against constants for the two daemon conditions, and minted here
  // for `prompt-too-long`, which no daemon ever sends. `conversationId` is a routing key and not
  // rendered text — never markup, an attribute, a URL, a filename, a cache key or a lookup path — and
  // it reaches no log sink; if a consumer indexes by it, THE INDEX IS A `Map`.
  | { type: 'systemPromptWriteConfirmed'; conversationId: string }
  | {
      type: 'systemPromptWriteRejected'
      conversationId: string
      reason: SystemPromptWriteFailure
    }
  // The thinking-token arm (#1313) — claude's only mid-turn proof of life on the stream-json surface,
  // the daemon's translation of its `system/thinking_tokens` line, decoded at #1312 and carried here.
  //
  // A READING, NOT A STATE TRANSITION, and that is what separates it from every `apiRetry` /
  // `compacting` neighbour above: it has no rising and no falling edge at all, so no consumer may look
  // for one. It carries no `turn_id` and opens and closes no turn, which makes it daemon STATE by the
  // queueState rule (#720) rather than a turn-stream item — an identity report ABOUT a turn is not an
  // item IN one, the same test `modelAnnounced` passes above.
  //
  // TWO OF THE WIRE'S THREE FIELDS CROSS. `estimated_tokens_delta` does NOT: nothing consumes it (the
  // render slice #1314 shows the total alone), and the payload's own contract says the deltas received
  // do not sum to the turn's total, so no consumer may accumulate them into one. A field crosses when
  // something needs it, not before — and a delta present on the arm is an invitation to sum it.
  //
  // NO `daemonTs`, and the omission is the design. That mix-in marks the arms `decodeHistoryEvent`
  // draws, which need (`type`, `ts`) as the join key between a served page and what the live stream
  // already drew; a stored `thinking_progress` is still skipped, so there is no page half to join
  // against and stamping it would advertise a join nothing can perform. `modelAnnounced`, not
  // `apiRetry`, is the precedent for this arm's shape.
  //
  // `estimatedTokens: 0` IS A VALUE, NEVER AN ABSENCE — neither Go field carries `omitempty`, so the
  // daemon's zero round-trips as legal traffic and nothing may consult truthiness on it. Nor may
  // anything assume the reading only grows: it RESTARTS NEAR ZERO at every inference-request boundary,
  // four times inside the daemon's own committed single-turn capture, so a drop is ordinary traffic
  // and a monotonic filter would eat it.
  //
  // NOT DEDUPED, and this arm needs that said more loudly than its neighbours: the wire re-fires as
  // the count climbs, so a consumer sees exactly one event per daemon frame including a verbatim
  // repeat, and the transport holds no coalescing, timer or per-conversation memo to make it otherwise.
  // ABSENCE PROVES NOTHING: the frames are rate-bounded and do not enumerate claude's lines, so no
  // consumer may infer a stall, a finish, or a thinking-stopped edge from a gap between them.
  //
  // SECURITY: neither field is untrusted display text, so the render-as-plain-text warning that
  // dominates `modelAnnounced` / `backgroundTaskStarted` has no subject here — and the obligations
  // that replace it are narrower and different in kind. `estimatedTokens` is an UNBOUNDED
  // daemon-asserted integer: a consumer must never size an allocation, index a buffer, or bound a loop
  // proportionally to it (`attachment_chunk`'s `total_chunks` is the neighbour that earned the rule —
  // never allocate from a claim), and it must format it defensively rather than trusting its range. It
  // is also a SIDE-CHANNEL ON HOW MUCH CLAUDE THOUGHT about private work, which is why it reaches no
  // log on any path: `emitDaemonEvent` is log-free by construction and the decode-side
  // `thinking_progress` log line is pinned content-free independently. `conversationId` is a
  // daemon-asserted ROUTING KEY, never rendered text — never markup, an attribute, a URL, a filename,
  // a cache key or a lookup path, and never an authorization signal; if a consumer indexes by it, THE
  // INDEX IS A `Map`. REQUIRED, never optional, for the reason every routing key on this union is: an
  // optional one invites `?? activeConversation` fallbacks, which is the misattribution to remove.
  // Ships dormant — all four exhaustive bridges no-op it until #1314, the
  // compacting-was-a-no-op-until-#496 precedent.
  | { type: 'thinkingProgress'; estimatedTokens: number; conversationId: string }
  | {
      type: 'toolProgress'
      conversationId: string
      turnId: string
      toolUseId: string
      elapsedSeconds: number
    }
  // The usage-limit arm (#1319) — the daemon's report that claude's usage-limit window is in a state
  // other than the one measured-benign one, decoded at #1318 and carried here.
  //
  // A READING, NOT A STATE TRANSITION, exactly as `thinkingProgress` above and for the same reason:
  // no rising and no falling edge, no `turn_id`, opening and closing no turn — daemon STATE by the
  // queueState rule (#720) rather than a turn-stream item, because a usage-limit window is orthogonal
  // to whichever turn happened to observe it. Nothing may read a lift from a gap in the frames.
  //
  // A FRAME IS NOT PROOF THAT ANYTHING WAS BLOCKED, and the daemon names this as THE realistic client
  // bug. The one measured non-benign value is `allowed_warning` (2026-08-22, claude 2.1.239,
  // `limit_type: seven_day`): the account was inside its weekly warning band and every turn still ran
  // normally. The plain reading is "claude said something about the usage window worth repeating",
  // never "you are rate limited" — a consumer rendering the latter tells the user they are blocked
  // while their turns keep working. It is restated on this arm rather than left on the wire type
  // because the WORDING DECISION IS MADE AGAINST THIS ARM, not against the payload.
  //
  // FOUR OF THE WIRE'S FIVE FIELDS CROSS. `truncated_fields` does NOT: nothing consumes it. The
  // eventual surface renders no daemon-authored string at all — it selects CLIENT-OWNED COPY by
  // `status` / `limitType` and falls back to generic wording on a miss — so a value the producer cut
  // misses that lookup exactly as an unrecognised value does, and there is nothing on screen for a
  // truncation marker to qualify. A field crosses when something needs it, not before.
  //
  // NO `daemonTs`, and the omission is the design. That mix-in marks the arms `decodeHistoryEvent`
  // draws, which need (`type`, `ts`) as the join key between a served page and what the live stream
  // already drew; #1318 keeps this type armless there, so there is no page half to join against and
  // stamping it would advertise a join nothing can perform. `thinkingProgress` and `modelAnnounced`,
  // not `apiRetry`, are the precedent for this arm's shape.
  //
  // NOT DEDUPED: one event per decoded frame, verbatim repeats included. The daemon re-reports the
  // window once per run whatever its state, and the transport holds no coalescing, timer or
  // per-conversation memo to make it otherwise — suppressing a repeat would eat the report that says
  // the reading is still current.
  //
  // SECURITY. `status` AND `limitType` ARE CLAUDE-AUTHORED OPEN STRINGS THAT CROSSED THE SUBPROCESS
  // TRUST BOUNDARY — the daemon bounds them but does not sanitize them, and deliberately did not
  // close either set (the value set beyond the one measured-benign status is unmeasured, so a client
  // that narrows either drops the first real limit that fires). On this union they are usable ONLY AS
  // LOOKUP KEYS FOR CLIENT-OWNED COPY, never rendered verbatim, never an authorization signal, never
  // a filename, a cache key or a lookup path — and a client MUST NOT BRANCH SECURITY-RELEVANT
  // BEHAVIOUR ON `status`, which is what keeps a wrong or hostile value costing at most one
  // misleading row. That contract diverges TWICE from `RateLimitedPayload`'s, deliberately, and a
  // reader meeting both should not have to guess which binds. Rendering is TIGHTENED: the wire type
  // says the strings are safe as inert text, and they are, but no surface here draws one. Lookup is
  // LOOSENED: the wire's "never a Map key" targets a key that resolves a RESOURCE — a filename, a
  // path, an icon URL, a cache entry — where an attacker-chosen value escapes the program's own
  // constants, whereas a key into a client-owned copy table selects among strings this client wrote,
  // falls back on a miss, and pollutes no prototype when the table is a `Map` (or an
  // `Object.hasOwn`-guarded record). `resetsAt` IS NEVER A SCHEDULING INPUT: it is an unvalidated
  // claude-authored number, `0` meaning "claude did not report one" and not the epoch, so a delay
  // derived from it can be negative (fires immediately, and spins if the handler re-arms) or past
  // setTimeout's ~24.8-day clamp, which ALSO fires immediately rather than never — never schedule,
  // allocate or iterate from it (`attachment_chunk`'s "never allocate from a claim", one arm over),
  // and format it defensively rather than trusting its range. NOTHING DECODED REACHES A LOG on any
  // path: `emitDaemonEvent` is log-free by construction and #1318's decode-side line is pinned
  // content-free, which matters for all four fields — the pair of strings discloses the ACCOUNT'S
  // QUOTA POSTURE, a fact about the operator rather than about this frame. `conversationId` is a
  // daemon-asserted ROUTING KEY, never rendered text and never an authorization signal; if a consumer
  // indexes by it, THE INDEX IS A `Map`. REQUIRED, never optional, for the reason every routing key on
  // this union is: an optional one invites `?? activeConversation` fallbacks, which is the
  // misattribution to remove. Ships dormant — all four exhaustive bridges no-op it until #1320.
  | {
      type: 'rateLimited'
      conversationId: string
      status: string
      limitType: string
      resetsAt: number
    }
  // The context-window arm (#1419) — claude's own report of how full the window is, plus the three
  // inventories that say how it got that way. Decoded across #1454 (the reading), #1455 (the category
  // breakdown), #1459 (the MCP-tool inventory) and #1460 (the memory-file inventory), and carried here.
  //
  // A READING, NOT A STATE TRANSITION, exactly as `rateLimited` above: no rising and no falling edge,
  // no `turn_id`, opening and closing no turn — daemon STATE by the queueState rule (#720). Fanned out
  // to `interactive`-capable clients after every turn end.
  //
  // ALL ELEVEN WIRE FIELDS CROSS, and unlike `rateLimited` nothing is left behind: the frame carries no
  // truncation marker to drop and every field has a consumer in #1420 / #1421.
  //
  // TOP-LEVEL FIELDS ARE snake→camel; THE THREE ROW TYPES ARE REUSED VERBATIM with their snake_case
  // fields. That is not an inconsistency to fix but the settled house rule for nested arrays, with two
  // precedents on this union (`queueState.queued` and `backgroundTaskRoster.tasks`): the row narrower
  // already stripped each row to its known fields, so there is nothing to drop and no mapping to write.
  // Hence `server_name` INSIDE its row while `mcp_tools` → `mcpTools` at the top level; the acronym
  // lowercases in a FIELD name (mechanical snake→camel) and stays capitalised in the TYPE name
  // (`ContextUsageMCPTool`), which is the existing split rather than a new one. `readonly` on each
  // array mirrors both precedents; the row interfaces stay mutable, exactly as `QueuedItem` does.
  //
  // NO `daemonTs`, and the omission is the design. That mix-in marks the arms `decodeHistoryEvent`
  // draws, which need (`type`, `ts`) as the join key between a served page and what the live stream
  // already drew; the decode arm takes no FrameTimestamp, so there is no page half to join against and
  // stamping it would advertise a join nothing can perform. `rateLimited` and `thinkingProgress`, not
  // `apiRetry`, are the precedent for this arm's shape.
  //
  // PROVENANCE IS MIXED WITHIN THIS ONE ARM, and it is the field-level fact a reader is likeliest to
  // get wrong. `conversationId` is DAEMON-authored — the mapper fills it from the daemon's own registry
  // record, never from claude's bytes. `model`, every row label, every `server_name` and every `path`
  // and `type` are CLAUDE- or WORKSPACE-authored. Assuming one provenance for the whole arm errs in a
  // harmful direction half the time, because it promotes the rest to a value they were never checked
  // to be.
  //
  // THE READING IS INFORMATIONAL AND NOTHING RECONCILES. `percentage` is NOT derivable from
  // `totalTokens` / `maxTokens` — the daemon neither recomputes nor normalizes claude's integers, and a
  // client that recomputes disagrees with the figure claude reported, which is the whole reason this
  // frame displaces the transcript route. The categories need not sum to the total. EACH DROPPED COUNT
  // IS INDEPENDENT AND NOT INFERABLE: each accumulates the producer's own caps PLUS the mapper's frame-
  // byte budget, so an inventory's true size is `list.length + its OWN dropped count`, a retained
  // list's LENGTH IS NO EVIDENCE OF COMPLETENESS in either direction, and no count says anything about
  // another's length. ROWS ARRIVE AS A PREFIX IN THE PRODUCER'S DESCENDING-TOKEN ORDER, any cut taking
  // entries off the TAIL — so a shortened list is never a list with holes, and re-sorting or
  // de-duplicating destroys the only ordering signal a consumer gets.
  //
  // `0` IS A VALUE AND `[]` IS A VALUE. An empty inventory is the POSITIVE STATEMENT that claude
  // reported no rows, never the absence a frame that never arrived yields, and a dropped count of `0`
  // is a genuine zero. Nothing may test either for truthiness.
  //
  // NEVER ALLOCATE, ITERATE OR SIZE ANYTHING FROM ANY OF THE SIX INTEGERS — `attachment_chunk`'s
  // never-allocate-from-a-claim rule, and sharper here than anywhere it has applied before: a DROPPED
  // COUNT IS A COUNT OF ROWS THAT ARE NOT PRESENT, so the natural "…and 3 more" rendering invites
  // `Array(droppedCategories)` or a loop to that bound, which is an allocation sized by an unbounded
  // daemon-supplied number. Render the figure; never a structure sized by it. Two formatting traps ride
  // along: a `maxTokens` of `0` yields `Infinity` from the obvious ratio (the renderer's own
  // `contextUsagePercent` already documents this), and none of the six is range-checked in either
  // direction — a `percentage` over 100, a total exceeding the max and a negative are all representable
  // and none is rejected.
  //
  // NOT DEDUPED: one event per decoded frame, verbatim repeats included. The daemon fans this out after
  // every turn end, so consecutive frames legitimately repeat AND legitimately FALL (a window shrinks
  // at a `/clear` or a compaction); the transport holds no coalescing, timer or per-conversation memo
  // to make it otherwise. Suppressing a repeat would eat the report that says the reading is current,
  // and filtering a fall would eat ordinary traffic.
  //
  // SECURITY — THE UNTRUSTED CONTENT IS NESTED, which has no precedent on this union and is the thing a
  // reader will miss. `model` is one untrusted string on the arm itself; every other one is INSIDE a
  // row of one of the three inventories, so a consumer that has internalised "the untrusted fields are
  // the string-typed ones on the arm" will handle exactly one of them. The daemon bounds all of them at
  // construction but neither validates nor sanitizes any, so each stays untrusted, model- or
  // workspace-authored text: safe to render as INERT TEXT, never fed to an HTML sink (no innerHTML /
  // dangerouslySetInnerHTML), never into an attribute or a URL, and never a CSS class or an icon name.
  // Three per-row prohibitions are forwarded rather than delegated, each stated in full on its row type
  // in ../wire/types:
  //   - `name` is a tool or category LABEL, never a handle to call anything by.
  //   - `server_name` IS INERT DESPITE ITS NAME. It spells the same field as the daemon's
  //     `MCPReconnectPayload.ServerName`, which crosses an ACTUATION seam verbatim — and having the
  //     same spelling as a field that actuates is not having its meaning. It must NEVER be fed to an
  //     MCP verb (a reconnect, a tool invocation, a server lookup) or joined against `mcp_status` on
  //     the strength of having appeared here.
  //   - `path` IS NOT A FILE HANDLE. It is path-shaped descriptive text that nothing joins, cleans,
  //     resolves or opens — reporting what claude READ rather than granting access to anything — so it
  //     is never an `href`, a `shell.openExternal` target, a `path.join` argument, a filename or a
  //     cache key. A path-shaped string is not a path-constrained one: the daemon constrains neither
  //     scheme nor shape, so a `javascript:` URI, a `file://` URL and a UNC path all arrive as an
  //     ordinary `path`. The `type` beside it is a LABEL, NEVER A DISCRIMINANT — a field spelled `type`
  //     in this repo invites `switch (row.type)`, which is exactly wrong: it is an OPEN set a claude
  //     release widens by definition, and it carries no authority, no trust level and no scope.
  // IF A CONSUMER INDEXES ANY INVENTORY BY ANY OF ITS STRINGS, THE INDEX IS A `Map`, never a plain
  // object, and the same goes for a React `key`: a legend keyed by category name, a panel grouped by
  // `server_name` and a list keyed by `path` are all the obvious view models, and `__proto__` and
  // `../..` are ordinary values in all three. `model` IS ALSO NOT AN IDENTITY — `modelAnnounced`
  // remains the authority on which model is running, and this is descriptive text beside a token count,
  // never a key to match a model menu against. The whole frame is a REPORT, NEVER A CONTROL INPUT: no
  // security-relevant behaviour may branch on any field. `conversationId` is a daemon-asserted ROUTING
  // KEY, never rendered text and never an authorization signal; REQUIRED, never optional, for the
  // reason every routing key on this union is — an optional one invites `?? activeConversation`
  // fallbacks, the misattribution to remove.
  //
  // NOTHING DECODED REACHES A LOG on any path: `emitDaemonEvent` is log-free by construction and the
  // decode-side line is pinned content-free. The grounds ESCALATE across the frame. The three integers
  // disclose how much private work is in the window; each per-row figure discloses how the window is
  // COMPOSED rather than merely how full it is; a `server_name` is WORKSPACE CONFIGURATION, disclosing
  // what the operator WIRED UP, so a server named after internal infrastructure must not ride into a
  // bundle an operator may send off-box; and a `path` is the strongest on the frame — it discloses WHO
  // THE USER IS AND WHERE THEY WORK. It is also an INTEGRITY rule and not only a privacy one: the
  // diagnostic stream is line-delimited JSON, and both the committed MCP fixture's EMBEDDED NEWLINE and
  // the newline a POSIX path may legitimately contain could FORGE A RECORD.
  //
  // Ships dormant — all four exhaustive bridges no-op it until #1420. That is not a formality: the
  // `assertNever` guard stringifies the WHOLE event into an `Error` message, and this is the LARGEST
  // arm on the union and the one carrying the most disclosive fields, so a missing case would put every
  // path and every server name into a stack trace and a crash reporter.
  | {
      type: 'contextUsage'
      conversationId: string
      model: string
      totalTokens: number
      maxTokens: number
      percentage: number
      categories: readonly ContextUsageCategory[]
      droppedCategories: number
      mcpTools: readonly ContextUsageMCPTool[]
      droppedMcpTools: number
      memoryFiles: readonly ContextUsageMemoryFile[]
      droppedMemoryFiles: number
    }
  // The session-reset arm (#1515) — the daemon's report that a conversation's session is being reset
  // and which phase of it the conversation is in, decoded at #1514 and carried here.
  //
  // TWO EDGES, like `apiRetry` and `compacting` and never a reading like the two arms above:
  // `active: true` is the rising edge and `active: false` the explicit falling edge, so a client never
  // derives "cleared" from turn activity. THE RISING EDGE RE-FIRES as the phase advances
  // (`wrapping_up` → `restarting`), one event per actual change — so a second rising edge is a real
  // transition and NOT a duplicate to suppress. The daemon's three rows, in the order an upstream
  // real-claude test asserts them:
  //
  //   active:true   phase:wrapping_up   handoff:pending
  //   active:true   phase:restarting    handoff:written | skipped
  //   active:false  phase:''            handoff:''
  //
  // CONVERSATION-SCOPED, NOT TURN-SCOPED: no `turn_id`, opening and closing no turn, which makes it
  // daemon STATE by the queueState rule (#720) rather than a turn-stream item. A reset is orthogonal
  // to whichever turn happened to be running.
  //
  // BOTH EMPTY STRINGS CROSS AS THE CONTRACT'S OWN ZERO VALUE — not as `undefined`, and not as absent
  // keys. This is the one thing about this arm worth reading twice. The daemon writes both keys on
  // every frame (nothing upstream is `omitempty`), `''` is Go's zero value and a DECLARED MEMBER of
  // both closed sets, and the window gates on `active`: a consumer that saw a missing key could not
  // tell a falling edge from a malformed one. Structured clone PRESERVES an undefined-valued property
  // across this bridge, so "absent" and "present and empty" are distinctions the boundary can
  // actually keep — and the `'conversationId' in event` ban in `timelineBridge`'s `timelineTargetFor`
  // docblock is the standing lesson about probing for a field instead of requiring it.
  //
  // NEITHER TOKEN IS WIDENED TO `string` HERE. `WireResetPhase` and `WireResetHandoff` cross as the
  // closed sets #1514 established, the `WireTurnState` precedent — unlike `rateLimited` two arms
  // above, whose `status` and `limitType` stay open because they are CLAUDE-authored and the value
  // set beyond the one measured-benign status is unmeasured. Every field here is DAEMON-authored, so
  // narrowing is safe and widening would throw away a four-value switch for an open one.
  //
  // NO `daemonTs`, and the omission is the design. That mix-in marks the arms `decodeHistoryEvent`
  // draws, which need (`type`, `ts`) as the join key between a served page and what the live stream
  // already drew; #1514 keeps this type armless there — a stored `resetting` is SKIPPED rather than
  // served — so there is no page half to join against and stamping it would advertise a join nothing
  // can perform. `rateLimited` and `thinkingProgress`, NOT `apiRetry` or `compacting`, are the
  // precedent for this arm's shape; `HistoryTimelineEvent` gains nothing, because `resetting` has no
  // replay ring upstream.
  //
  // NOT DEDUPED: one event per decoded frame, verbatim repeats included. The transport holds no
  // coalescing, timer or per-conversation memo, and must not grow one — suppressing a repeat would
  // eat the re-fire that says the phase moved.
  //
  // SECURITY: NARROWED IS NOT TRUSTED, and this arm inverts the usual hazard of its neighbours. A
  // closed union is a compile-time invitation to `switch (phase)` and read the result as settled
  // fact. It is not. A narrowed value is still a CLAIM BY A PEER: a hostile daemon can send any of
  // the sixteen (`active`, `phase`, `handoff`) combinations, so a consumer must handle ALL of them
  // rather than only the producer's three rows, and MUST NOT BRANCH SECURITY-RELEVANT BEHAVIOUR on
  // either token. THE FRAME IS A REPORT, NEVER A CONTROL INPUT OR AN AUTHORIZATION SIGNAL.
  // `handoff: 'written'` describes a file the daemon wrote and the payload deliberately carries NO
  // PATH, so nothing downstream can resolve, join, open, stat or link one — the token is a
  // four-value status, not a locator, and no consumer may synthesize a path from it. Nothing decoded
  // REACHES A LOG on any path: `emitDaemonEvent` is log-free by construction and #1514's decode-side
  // line is pinned content-free, which matters for the pair as much as for the id — together they
  // disclose WHICH conversation the operator reset and whether a handoff note was written, a fact
  // about the operator's workflow rather than about this frame. `conversationId` is a daemon-asserted
  // ROUTING KEY, never rendered text, never an authorization signal and never resolved against a
  // filesystem; if a consumer indexes by it, THE INDEX IS A `Map`. REQUIRED, never optional, for the
  // reason every routing key on this union is: an optional one invites `?? activeConversation`
  // fallbacks, which is the misattribution to remove.
  //
  // A CONSUMER MUST NOT RELY ON THE FALLING EDGE ARRIVING. A daemon that crashes or is killed
  // mid-reset sends no `active: false`, so an indicator cleared ONLY by that frame pins on forever;
  // the clearing path needs an INDEPENDENT trigger (disconnect, conversation exit, turn activity).
  // Nothing on this leg can defend that, so the obligation rides this arm's contract forward to its
  // consumers. Ships dormant — all four exhaustive bridges no-op it until #1516 (the channel-list
  // dot) and #1517 (the composer status row).
  | {
      type: 'resetting'
      conversationId: string
      active: boolean
      phase: WireResetPhase
      handoff: WireResetHandoff
    }
  // The assistant sent the operator a file (#1620) — the daemon's `attachment_offered` announcement,
  // decoded at #1619 and carried here. BROADCAST to every attached client, so a consumer filters on
  // `conversationId`. LIVE-ONLY, so NO `daemonTs`: the decode arm takes no FrameTimestamp and there is
  // no history arm to join against (the `resetting` precedent directly above).
  //
  // SECURITY: NARROWED IS NOT TRUSTED — every field is a claim by the peer. `conversationId` is a
  // daemon-asserted ROUTING KEY, never authorization; if a consumer indexes by it, the index is a
  // `Map`. `attachmentId` passed the lowercase-UUIDv4 rule, which proves nothing about the bytes
  // existing, and it reaches the filesystem only through `resolveAttachmentPath`. `filename` is
  // CLAUDE-AUTHORED display text of at most ATTACHMENT_FILENAME_MAX_BYTES UTF-8 bytes that may carry
  // control or bidi characters: render it only as bounded, escaped text, never as an attribute, URL,
  // path, cache key or log field. Ships dormant — all four exhaustive bridges no-op it until #1621 (the
  // thread's file row).
  | {
      type: 'attachmentOffered'
      conversationId: string
      attachmentId: string
      filename: string
    }

/**
 * The daemon envelope timestamp, forwarded verbatim by `createDaemonConnection` for live timeline
 * events. Most events use it only for bounded (`type`, `ts`) history joins. User receipts convert a
 * bounded, usable timestamp into `createdAt` for display; their identity join uses `message_id`.
 * Assistant `createdAt` remains the renderer arrival stamp.
 *
 * Optional: lifecycle events and history-only translations have no live envelope timestamp. Never
 * substitute an arrival clock for absence. `decodeEnvelope` validates string shape, not date format;
 * the receipt translator admits only finite parsed times and draws without time on unusable input.
 * The raw string is never rendered, logged or used as a path, URL, filename or React key. Existing
 * diagnostics expose only static codes, byte lengths and payload hashes. History join consumers bound
 * comparands and fail open on unusable input so uncertain identity cannot silently remove a row.
 */
interface DaemonEventTimestamp {
  daemonTs?: string
}

/** Distributes `DaemonEventTimestamp` over each arm of a union — `WithOrigin`'s mechanism below, and
 *  written as a distributive conditional for the same reason: the result is a genuine union of stamped
 *  members, so `.type` narrowing and `Extract<…>` behave exactly as they do on the bare union. */
type WithDaemonTs<E> = E extends unknown ? E & DaemonEventTimestamp : never

/** A single typed event from the background process to the renderer window (see `BaseDaemonEvent` for
 *  the arms) plus, on the arms decoded from a timeline-bearing envelope, the daemon's own timestamp for
 *  the logical event. */
export type DaemonEvent = WithDaemonTs<BaseDaemonEvent>

/**
 * Which server an event came from (#1068). Carried BESIDE the union rather than inside it: the app
 * will hold several paired servers at once (#1084 builds the connection registry), and the renderer
 * cannot tell two connections' events apart without an origin on every event.
 *
 * `null` means NO PAIRED RECORD WAS IN HAND when the emitter was bound — an honest unknown, and today
 * the value on every event in production, because the one connection is constructed at launch before
 * any record is read and it outlives a re-pair (`onPaired` reconnects the same connection rather than
 * rebuilding it), so a launch-time literal would be right at boot and would silently mis-attribute
 * every event after the operator pairs a different machine. It is a PRESENT null, never an absent
 * property: `undefined` here would mean an emitter that never went through a binding at all.
 *
 * PROVENANCE: the paired record's `server` field (`PairedServerRecord = QrPayload`), the same value
 * that rides the `X-Pyrycode-Server` relay header and the same one `ServerInfo.serverId` already
 * crosses on. Deliberately NOT `hello_ack.server_id`, which is a DISTINCT value — `serverInfo.ts`
 * ruled this already and the reason is worth restating: the id is bound at CONSTRUCTION from a record
 * this client holds, so a hostile or confused daemon cannot make its events claim another server's
 * identity, which a wire-sourced id would let it do.
 *
 * SECURITY: it is a NON-SECRET ROUTING ID, one of the two safe record fields — `token` and
 * `server_static_pubkey` are structurally unreachable from this path, which is handed a `string | null`
 * scalar and never a record. Like every daemon-adjacent string on this channel it is PLAIN TEXT ONLY at
 * the render boundary: never into a raw-markup sink (no innerHTML / dangerouslySetInnerHTML), never
 * into an attribute or a URL, and never a filename, a cache key or a lookup path — if a consumer
 * indexes by it, THE INDEX IS A `Map` (a `__proto__` id would write through Object.prototype on a bare
 * object). It is a REPORT, not a control input: no security-relevant behaviour may branch on it.
 */
interface ServerOrigin {
  serverId: string | null
}

/**
 * Distributes `ServerOrigin` over each arm of a union. Written as a distributive conditional rather
 * than the plainer `DaemonEvent & ServerOrigin` so the result is a genuine union of stamped
 * members: `.type` narrowing and `Extract<…>` then behave for consumers exactly as they do on the bare
 * union, which a single unnormalised intersection does not reliably give.
 */
type WithOrigin<E> = E extends unknown ? E & ServerOrigin : never

/**
 * What actually travels on DAEMON_EVENT_CHANNEL (#1068): a `DaemonEvent` plus the id of the server it
 * came from. An INTERSECTION over the existing union, never a member added to each arm —
 * that choice is the whole reason this is one slice rather than three. It keeps the union's arms
 * untouched, so the 33 test files that build bare `DaemonEvent` literals for the renderer bridges
 * still compile, and it makes the two directions of assignability do the work:
 *
 *   - a StampedDaemonEvent IS a DaemonEvent, so every consumer typed on the bare union — the 27
 *     renderer subscribers included — keeps compiling and receives the field as an extra property;
 *   - a DaemonEvent is NOT a StampedDaemonEvent, so a producer cannot claim to have stamped one.
 *
 * The stamp is applied MAIN-SIDE, AFTER decode, by `bindServerOrigin` (emitDaemonEvent.ts), and is
 * read by no outbound envelope builder — it cannot reach the wire.
 */
export type StampedDaemonEvent = WithOrigin<DaemonEvent>
