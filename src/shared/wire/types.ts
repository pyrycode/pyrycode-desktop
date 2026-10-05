// Wire protocol shared between the background process (transport) and the renderer.
// Ported from the pyrycode-mobile Kotlin wire models. The daemon does not care which
// client speaks it, so these must match the mobile JSON field-for-field.
//
// Source of truth (pyrycode-mobile):
//   app/src/main/java/de/pyryco/mobile/data/network/NoiseIkSession.kt   (PROTOCOL)
//   app/src/main/java/de/pyryco/mobile/data/network/MobileWireModels.kt (frame + envelope)
//   app/src/main/java/de/pyryco/mobile/data/network/MessagePayload.kt   (payloads + role)

/** Noise handshake variant. MUST match the daemon exactly or the handshake fails silently. */
export const NOISE_PROTOCOL = 'Noise_IK_25519_ChaChaPoly_BLAKE2s' as const

export const PROTOCOL_VERSION = 'v2' as const
export const CAPABILITY_INTERACTIVE = 'interactive' as const
/** Tells the daemon this client understands more than one agent, so it sends Codex conversations (#1657). */
export const CAPABILITY_MULTI_AGENT = 'multi_agent' as const
/** Detection only (pyrycode#2797): the daemon echoes it when it accepts `stop_background_task` (#1770). */
export const CAPABILITY_STOP_BACKGROUND_TASK = 'stop_background_task' as const

/** Which agent runs a conversation or offers a model row (#1649). */
export type WireAgent = 'claude' | 'codex'

/**
 * The one mapping from a daemon agent string to a held agent (#1649): the exact string `codex` is Codex,
 * anything else — an unknown agent, a case variant, an absent key — is Claude. The raw string never
 * survives it, so no daemon agent text is ever held or rendered.
 */
export function agentFromWire(raw: string | undefined): WireAgent {
  return raw === 'codex' ? 'codex' : 'claude'
}

/**
 * v2 outer WebSocket frame cap, in bytes (256 KiB). A v2 Noise transport message is at most
 * 65535 bytes; base64-std of that plus the InnerFrameV2 JSON envelope stays well under this,
 * and the daemon/relay reject a larger frame. Source: pyrycode docs/protocol-mobile.md
 * § Application-envelope size cap.
 */
export const MAX_FRAME_BYTES = 256 * 1024 // 262144

/**
 * v2 decrypted application-envelope (plaintext) cap, in bytes. Every transport frame fits
 * inside one Noise transport message (65535 bytes including the 16-byte AEAD tag), so the
 * decrypted Envelope is capped at 65519 bytes. This supersedes v1's 1 MiB cap. Source:
 * pyrycode docs/protocol-mobile.md § Application-envelope size cap.
 */
export const MAX_PLAINTEXT_BYTES = 65519

/**
 * The daemon's write-side cap on a conversation's stored system prompt, in BYTES OF UTF-8 (#1249).
 * Mirrors `internal/conversations.MaxSystemPromptBytes` (pyrycode#2149); a value above it is refused
 * with `protocol.malformed` and nothing is stored.
 *
 * MEASURE IT WITH `Buffer.byteLength(value, 'utf8')`, NEVER `value.length`. JavaScript's `.length`
 * counts UTF-16 code units, and the two disagree for every multi-byte prompt — an emoji-heavy prompt
 * well under 8192 code units can be several thousand bytes over the daemon's bound, which would spend
 * a non-retryable refusal on text this client could have refused for free.
 *
 * A PRE-FLIGHT BOUND ON ONE FIELD, never a substitute for MAX_PLAINTEXT_BYTES above, which remains the
 * only frame-level size gate on either direction. It is deliberately NOT applied to the INBOUND prompt
 * (#1230 argued that case and declined): the daemon caps it write-side, so a second inbound bound would
 * either defend an unreachable failure or, set below the daemon's, fail-close a valid prompt. This is
 * the OUTBOUND direction, where the operator's own text is bounded before a refusal is spent on it.
 * Source: pyrycode docs/protocol-mobile.md § Setting a conversation's system prompt.
 */
export const MAX_SYSTEM_PROMPT_BYTES = 8192

/** Inner frame carried inside the Noise-encrypted channel (InnerFrameV2). */
export interface InnerFrameV2 {
  v: 2
  type: string
  /** base64 (standard, padded) of the serialized Envelope. */
  data: string
}

export type EnvelopeType =
  | 'request_host_system_prompt'
  | 'set_host_system_prompt'
  | 'host_system_prompt'
  | 'hello'
  | 'hello_ack'
  | 'message'
  | 'message_chunk'
  | 'backfill_since'
  | 'send_message'
  | 'request_debug_bundle'
  | 'debug_bundle_chunk'
  | 'debug_bundle_done'
  | 'set_session_settings'
  | 'session_settings_updated'
  // v2-only phone→binary control frame — asks for one conversation's current run configuration.
  // Carries RequestSessionSettingsPayload: a single `conversation_id`, always present (`''` names
  // nothing). Answered by `session_settings`, correlated on in_reply_to. Naming a conversation the
  // daemon does not host, one bound to no live session, or none at all are all answered with a
  // zero-valued reply — never an error frame and never another session's values. SSOT pyrycode
  // #491, made conversation-keyed by pyrycode#1586 / #1610 (internal/protocol/settings.go).
  | 'request_session_settings'
  | 'session_settings'
  | 'assistant_delta'
  | 'turn_end'
  | 'turn_state'
  | 'session_error'
  | 'stall'
  | 'api_retry'
  | 'compacting'
  // The reset lifecycle report (#1514). Grouped HERE rather than with the claude-translation cluster
  // further down, because it shares the shape of the three members above: an `interactive`-gated
  // binary → client status frame with a rising and a falling edge, conversation-scoped, opening and
  // closing no turn. What separates it from all three is provenance in the other direction —
  // `stall` / `api_retry` / `compacting` report what CLAUDE is doing, this reports what the DAEMON is
  // doing TO claude, and every field on it is the daemon's own rather than a value claude authored.
  //
  // SSOT pyrycode#2453 (shape) / #2478 (producer) / internal/protocol/interactive.go ResettingPayload;
  // see ResettingPayload for the four rows and for why `''` is an accepted token on both closed sets.
  | 'resetting'
  | 'compaction_boundary'
  | 'banner'
  // v2-only daemon→client diagnostic — the daemon's stream parser met claude output it has no
  // mapping for. Not a claude sub-state like its neighbours above: it reports a gap in the
  // DAEMON's own mapping. SSOT pyrycode `internal/protocol` UnrecognizedMessagePayload.
  | 'unrecognized_message'
  | 'session_transition'
  | 'tool_use'
  | 'tool_progress'
  | 'tool_result'
  | 'tool_denied'
  | 'model_refusal_fallback'
  | 'model_refusal_no_fallback'
  | 'queue_state'
  // The first of the three `interactive`-gated background-task frames (#564). Announces work claude
  // left running past the turn that spawned it — the frame that separates a genuine finish from a
  // `turn_end` whose command is still alive. SSOT pyrycode#1394 / internal/protocol/interactive.go.
  | 'background_task_started'
  // The peer of the frame above (#565): that one OPENS a task, this one reports what happened to it
  // afterwards. The two join on `task_id`. Same gating and same non-turn character.
  | 'background_task_updated'
  // The AGGREGATE peer of the two above (#566): they report what happened to ONE task, this reports
  // what is ALIVE. A SNAPSHOT, not a delta — each frame replaces the reader's view of what is running
  // rather than amending it — and an EMPTY `tasks` is the positive statement that NOTHING is alive,
  // which is the payoff signal of the whole family. Same gating and same non-turn character.
  | 'background_task_roster'
  // The fourth background-task frame (#1638): a running task is still working, and what it is doing
  // right now. Rate-bounded per task by the daemon. Same gating and same non-turn character as the
  // three above. Not claude's `tool_progress`, which is a different thing under a similar name.
  | 'background_task_progress'
  // The announced-model report (#587). Grouped alone rather than with the status cluster above,
  // following the daemon's own rationale: it is not a turn sub-state with two edges, not
  // turn-independent work, not a periodic reading and not a condition report about a window. It is an
  // IDENTITY report — what claude says it IS, for the turn it says it about. SSOT pyrycode#1616 /
  // internal/protocol/codes.go TypeModelAnnounced; binary → phone only.
  | 'model_announced'
  // The thinking-progress reading (#1312) — claude's only mid-turn proof of life on the stream-json
  // surface. Placed beside `model_announced` because the two are siblings in provenance: both are the
  // daemon's translation of a claude `system/*` subtype, and the daemon groups each ALONE rather than
  // with the status cluster or the background-task three. This one is neither a show/clear sub-state
  // with two edges nor turn-independent work — it is a periodic READING of work in progress, with no
  // edges at all.
  //
  // THE NAME IS THE DAEMON'S, NOT CLAUDE'S, and the discriminating word is deliberate: the wire follows
  // internal/turnevent's variant (`progress`, what the daemon reports), never claude's subtype
  // (`thinking_tokens`), so a claude rename lands in one upstream place instead of breaking every
  // client at once. Do not key a client on claude's vocabulary. It also disambiguates against
  // ThoughtChunk, which carries the CONTENT of claude's reasoning and is never forwarded (ADR 025).
  // SSOT pyrycode#1386 / internal/protocol/codes.go TypeThinkingProgress; binary → phone only.
  | 'thinking_progress'
  // The usage-limit window report (#1318). Grouped alone for the daemon's own reason, and it is the
  // one category `model_announced` above excludes itself from by name: not a turn sub-state with two
  // edges, not turn-independent work, not a periodic reading, not an identity report — a CONDITION
  // REPORT ABOUT A WINDOW. Placed beside the two frames above because all three are daemon
  // translations of a claude line, but it is the one that is NOT a `system/*` subtype: claude reports
  // it as the top-level `rate_limit_event` line type, which is why the daemon's `system`-subtype count
  // deliberately excludes it.
  //
  // A FRAME IS NOT PROOF THAT ANYTHING WAS BLOCKED — see RateLimitedPayload, where the daemon names
  // that as the realistic client bug. SSOT pyrycode#1405 (shape) / #1410 (producer) /
  // internal/protocol/codes.go TypeRateLimited; binary → phone only.
  | 'rate_limited'
  // Claude's own report of what is IN the context window (#1454). Placed beside the three frames above
  // because it shares their provenance — the daemon's translation of something claude said — and their
  // shape: conversation-scoped, no `turn_id`, and receiving one neither opens nor closes a turn. It is a
  // periodic READING like `thinking_progress`, not a condition report or an identity report; #2371
  // publishes one after every turn end on the interactive path.
  //
  // WHY IT EXISTS HERE AT ALL: the desktop's only context figure until now is the `used_tokens` /
  // `window_tokens` pair on `session_settings`, which the daemon reconstructs by scanning the transcript
  // on disk — a route that reads 0% for a conversation opened in a workspace (pyrycode#2423) and whose
  // window half is a guess until a turn ends. Decided 2026-09-14: the claude-reported figure becomes the
  // display source and the transcript route becomes the fallback.
  //
  // NEVER ACCEPTED FROM A CLIENT — binary → phone only, v2-only, interactive-capability-gated, and
  // deliberately absent from the daemon's inbound type set, which is the structural guarantee that
  // nothing upstream accepts a context reading FROM a phone. `request_context_usage` (pyrycode#2431) is
  // the separate client → daemon ASK and is a different type with a different payload; do not conflate
  // the two. SSOT pyrycode#2370 (shape) / #2371 (producer) / internal/protocol/codes.go
  // TypeContextUsage.
  | 'context_usage'
  // Claude's MCP SERVER LIST for one conversation (#1489) — which servers claude has and what it says
  // about each. Same provenance and shape as the frames above: conversation-scoped, no `turn_id`, and
  // receiving one neither opens nor closes a turn. Published live and as the answer to
  // `mcp_status_request` (correlated by `in_reply_to`), which is the separate client → daemon ASK
  // declared below (#1578). A SNAPSHOT that replaces a reader's view rather than a delta.
  // Binary → phone only. SSOT pyrycode#2373 (shape) / #2375 (live producer) / #2381 (on-demand reply) /
  // internal/protocol/codes.go TypeMCPStatus.
  | 'mcp_status'
  | 'dequeue_message'
  // v2-only phone→binary control frame — stops the running turn in the conversation it names, which
  // the daemon maps to the neutral turnevent.Cancel and routes to that conversation's bound runner as
  // claude's own interrupt. Carries InterruptPayload (one optional conversation_id) and NO nonce,
  // answer token or idempotency key; daemon-gated on the `interactive` capability; fire-and-forget
  // (no reply — the stop is observed through the existing turn_end marker). SSOT pyrycode #707,
  // widened by pyrycode#2103.
  | 'interrupt'
  // v2-only phone→binary control frame — asks the daemon to KILL claude and spawn a fresh one under a
  // new session id in the conversation it names. Grouped with `interrupt` above rather than with the
  // payload-carrying request verbs because it shares that frame's daemon-side character: intercepted
  // by the v2 session manager before dispatch.Route, `interactive`-capability-gated, fire-and-forget
  // with no reply. Carries NewSessionPayload (one optional conversation_id) and NO nonce, answer token
  // or correlation key. NOT a `/clear` sent as ordinary text: that clears context in place and the
  // process keeps everything it holds, this discards the process. (Since #1496 this frame is what the
  // app's one Reset-session action dispatches; a typed `/clear` still goes down the message path.)
  // SSOT pyrycode docs/protocol-mobile.md § New session (v2), widened by pyrycode#2099.
  | 'new_session'
  | 'modal_shown'
  | 'modal_dismissed'
  | 'modal_answer'
  | 'modal_cancel'
  // One whole batch of the clarifying questions claude's `AskUserQuestion` tool asks (#883). v2
  // outbound (binary → phone), interactive-capability-gated and NOT in the daemon's `v1TypeSet`, so
  // an old client never receives it. A NEW FAMILY rather than a grown `modal_shown`, decided
  // upstream on security grounds: `modal_shown`'s `default_option_id` is the deny option and MUST
  // equal one of `options[].id`, a TOTAL invariant on the permission surface, and a clarifying
  // question has no deny option — growing the modal payload would have made that invariant
  // class-conditional. SSOT pyrycode docs/protocol-mobile.md § Question (v2) / internal/protocol.
  | 'question_shown'
  // The frame that RETIRES the batch above (#894), so a client clears the panel instead of rendering
  // an ask that is already dead. Same v2 gating and same not-in-`v1TypeSet` posture. ITS OWN TYPE
  // rather than a reused `modal_dismissed`, decided upstream: that frame identifies what it clears by
  // `modal_id` and a client routes it to the modal panel, so a `question_batch_id` arriving in that
  // field would clear the wrong panel or none — making the routing depend on a value's shape instead
  // of on the frame's name. SSOT pyrycode docs/protocol-mobile.md § Question (v2) / internal/protocol
  // codes.go TypeQuestionDismissed; emitted by pyrycode#1973.
  | 'question_dismissed'
  // The two frames that RESOLVE the batch above (#919) — the first OUTBOUND members of this family,
  // everything above them being inbound. `question_answer` carries the operator's selections,
  // `question_refused` says they declined to choose. Two types rather than one with an empty
  // `answers`, mirroring `modal_cancel` beside `modal_answer` and following the precedent
  // `question_dismissed` set: a distinct meaning gets a distinct type, so a reader routes on the
  // frame's name rather than on a value's shape. Both are switch-intercepted daemon-side (upstream
  // #1984) before dispatch.Route, exactly as `modal_answer` is. SSOT pyrycode
  // docs/protocol-mobile.md § Question (v2) / internal/protocol codes.go TypeQuestionAnswer,
  // TypeQuestionRefused; declared by pyrycode#1983, resolved by #1990/#1991, gated by #1986.
  | 'question_answer'
  | 'question_refused'
  // The ASK for the frame below (#1165) — v2-only client→daemon control frame, gated on the negotiated
  // `interactive` capability, INERT on a conn that did not negotiate it (no reply, no error). It exists
  // because both of that frame's delivery lanes structurally miss a conversation created AFTER this app
  // connected: the live lane emits once per claude child spawn and drops every event whose producing
  // session is not the active conversation's, and the connect-time reconcile runs inside the handshake
  // tail, so a conversation that did not exist then is not in it.
  //
  // Carries RequestModelListPayload: a single REQUIRED `conversation_id`. Answered by ONE `model_list`
  // correlated by `in_reply_to` and carrying NO `event_id` — the same deliberate omission the
  // reconciled frame makes, which keeps it out of the daemon's turn-event replay ring — whose payload
  // is what the connect-time reconcile would have sent, INCLUDING for a conversation with no bound
  // session, answered from the daemon-wide vocabulary (pyrycode#2124). A request the daemon cannot
  // answer draws one `error` frame instead: `conversation.not_found` (not retryable) or
  // `model_list.unavailable` (retryable).
  //
  // NEITHER IS RETRIED CLIENT-SIDE, and the retryable one is the trap. A retry against a relay that is
  // withholding the frame is the self-inflicted spin `modelListStore`'s header forbids, and the rule
  // below still binds in full: never block a model menu on this frame. Both codes fall through
  // `narrowDaemonErrorOutcome`'s allowlist to `unclassified`, which is correct and complete — surfacing
  // a refusal to the operator is #1036's job. SSOT pyrycode#2125 / internal/protocol/interactive.go.
  | 'request_model_list'
  // Client → daemon, interactive-capability-gated (pyrycode#2431). One context_usage
  // reply correlated by in_reply_to, or conversation.not_found/context_usage.unavailable.
  // The client does not retry either error or a missing reply.
  | 'request_context_usage'
  // Client → daemon, interactive-capability-gated (pyrycode#2276 / #2381). One mcp_status reply
  // correlated by in_reply_to, or protocol.malformed / conversation.not_found / mcp_status.unavailable.
  // The client does not retry any of them or a missing reply (#1578).
  | 'mcp_status_request'
  // Client → daemon, interactive-capability-gated and gated per device (pyrycode#2419 / #2420). Asks the
  // daemon to reconnect one named MCP server on the conversation's live child. Accepted: one mcp_status
  // correlated by in_reply_to. Refused: mcp_actuation.refused / protocol.malformed /
  // conversation.not_found, all non-retryable; the client does not retry any of them (#1582).
  | 'mcp_reconnect'
  // Client → daemon, same gates, answer and refusal codes as mcp_reconnect above (pyrycode#2419 / #2420).
  // Asks the daemon to move one named MCP server to the requested enabled state. The client sends
  // `enabled` explicitly for both values and never retries a refusal (#1586).
  | 'mcp_toggle'
  // Client → daemon (pyrycode#2796). Asks the daemon to stop one background task. Accepted: no reply.
  // Refused: one error `stop_background_task.refused` correlated by in_reply_to. Never retried (#1770).
  | 'stop_background_task'
  // The conversation's MODEL inventory (#971) — the identities claude will run as, with the
  // reasoning-effort levels each one supports. Same shape of frame as its sibling below and drawn from
  // the same `initialize` control reply: v2 outbound (binary → phone), interactive-capability-gated,
  // absent from the daemon's `v1TypeSet` so an old client never receives it, riding a
  // `control_response` rather than the turn stream, and a conversation-scoped SNAPSHOT that replaces a
  // reader's view rather than a delta amending it — receiving one neither opens nor closes a turn, and
  // it carries no `turn_id`.
  //
  // THE DELIVERY WINDOW HAS TWO LANES, and a consumer that knows only the live one gets this frame
  // wrong. On the LIVE LANE what the daemon runs on a schedule is an ASK, not a delivery: one
  // `initialize` exchange per claude child spawn, emitted to whatever interactive connections exist at
  // that instant. Three losses sit between that emit and a client — no conversation is routed yet (the
  // daemon spawns its first child eagerly at startup, and that child's menu is lost UNCONDITIONALLY),
  // the session is busy (the frame is classed droppable at fan-in, nothing is retried, and no error
  // frame says a menu was lost), and the emitting child is not the active conversation's bound session
  // (a rotation starts a new child, and therefore a new ask, but does NOT deliver a fresh menu).
  //
  // The second lane is a CONNECT-TIME SNAPSHOT. The daemon's `reconcileModelLists` fires from its
  // handshake tail on EVERY handshake — gated only on the negotiated interactive flag and a wired
  // `RetainedModelLists` seam — and unicasts the retained set to the just-opened conn, so a FIRST
  // attach is not hopeless and this frame arrives in two shapes a reader must handle. At connect it is
  // a BURST of N payloads, one per conversation whose bound session holds a list, delivered OUTSIDE any
  // turn; it is enumerate-all rather than keyed to "this conn's conversation" (a relay session carries
  // no conversation id), ARCHIVED conversations contribute, and the order is the daemon's registry
  // insertion order and is NOT a contract. On the live lane it is single frames, subject to the three
  // losses above. The reconciled frame carries NO `event_id`, deliberately: that keeps it out of the
  // daemon's turn-event replay ring and makes the reconnect `last_event_id` dedup INERT for it, so a
  // store deduping on event id will double-apply or drop it. CORRELATE ON `conversation_id` — the
  // envelope's own `id` is a fixed `1` upstream and explicitly non-load-bearing.
  //
  // **STILL NEVER BLOCK A MODEL MENU ON THIS FRAME.** The snapshot narrows the gap rather than closing
  // it: only a session actually HOLDING a list contributes, and the eagerly-spawned bootstrap child has
  // no conversation record, so it contributes on neither lane. Render a usable UI without one rather
  // than waiting for a frame that may never arrive.
  //
  // SSOT internal/protocol/interactive.go plus the daemon's `reconcileModelLists` and
  // `RetainedModelLists` — NOT docs/protocol-mobile.md § model_list, whose live prose still says this
  // frame has no connect-time snapshot and is deliberately absent from the Mode B list; that file's
  // 2026-09-02 changelog entry names both claims stale and is the current half. Shape declared by
  // pyrycode#1704, fixtures and section by #1705, mapping by #1848, producer by #1849, proven end to
  // end by #1845; the connect-time reconcile by #1863.
  | 'model_list'
  // The workspace's slash-command inventory (#935) — a conversation-scoped MENU rather than a turn
  // event: it rides a `control_response` from the same `initialize` reply `model_list` is drawn from,
  // so receiving one neither opens nor closes a turn, and it is a SNAPSHOT that replaces a reader's
  // view rather than a delta amending it. Same v2 gating as the question family above and likewise
  // absent from the daemon's `v1TypeSet`, so an old client never receives it. Its sibling `model_list`
  // rides the same reply and IS modelled on this side (#971), the member directly above: that one
  // inventories the IDENTITIES claude will run as, this one the VERBS the working directory will
  // accept. SSOT pyrycode docs/protocol-mobile.md § slash_command_list /
  // internal/protocol/interactive.go; type declared by pyrycode#1726, shape by #1727, fixtures and
  // section by #1718, and emitted by the #2001–#2007 family (#2003 on the live lane, #2004–#2007 on
  // connect) — NOT by #1720, which the published section still names and which was abandoned.
  | 'slash_command_list'
  | 'list_conversations'
  | 'conversations'
  | 'recent_workspaces'
  | 'recent_workspaces_list'
  | 'create_conversation'
  | 'conversation_created'
  | 'promote_conversation'
  | 'archive_conversation'
  | 'unarchive_conversation'
  | 'delete_conversation'
  | 'conversation_deleted'
  | 'rename_conversation'
  | 'change_workspace'
  // The write half of a conversation's system prompt (#1249) — phone → binary, map-dispatched by the
  // daemon like its neighbours in this group, and carrying NO interactive-capability gate, unlike its
  // read half `request_system_prompt`. That asymmetry is the daemon's and needs nothing here.
  //
  // KEYED BY CONVERSATION, NOT BY SESSION. The prompt must be settable when nothing is running, and it
  // outlives every session the conversation has. The session-keyed `set_session_settings` is a
  // different verb with different semantics; do NOT model this on it.
  //
  // Carries SetSystemPromptPayload — a required `conversation_id` beside a TRI-STATE `system_prompt`.
  // Answered by the reused `conversation_updated` record correlated by `in_reply_to`, which
  // deliberately does NOT carry the prompt back (that record is broadcast-shaped, and only the
  // requester asked about the value). Refused with `protocol.malformed` (payload will not decode, or
  // the value exceeds MAX_SYSTEM_PROMPT_BYTES) or `conversation.not_found`; both are NON-RETRYABLE,
  // both echo no supplied byte, and nothing is stored on either. SSOT pyrycode
  // docs/protocol-mobile.md § Setting a conversation's system prompt / internal/protocol/codes.go.
  // Declared and answered by pyrycode#2151.
  | 'set_system_prompt'
  // Mute or unmute one conversation's notifications on its host (#1595, pyrycode#2572). Carries
  // SetConversationMutedPayload. Answered by the reused `conversation_updated` correlated by
  // `in_reply_to` and carrying the new `is_muted`, pushed uncorrelated to every other connection;
  // refused with a correlated non-retryable `error`.
  | 'set_conversation_muted'
  | 'create_workspace_folder'
  | 'workspace_folder_created'
  // The client's ASK that a workspace be renamed (#1289) — the outbound half of the contract whose
  // inbound half is `workspace_updated` below. Carries RenameWorkspacePayload, a DISTINCT type from
  // that reply's despite the identical field set (the verb owns its wire surface). Routed by SERVER
  // rather than by conversation: a workspace label is not scoped to a chat. The daemon answers it with
  // one `workspace_updated` correlated to the requester; this client neither awaits nor correlates
  // that reply. SSOT pyrycode#2209.
  | 'rename_workspace'
  // The daemon's report that a WORKSPACE's label changed (#1288) — correlated by `in_reply_to` to the
  // client that asked for the rename, and pushed UNSOLICITED to every other connected interactive one, so
  // a rename performed anywhere reaches every open client. Distinct from `conversation_updated` beneath
  // it, which fans out on a CONVERSATION mutation: a bare workspace rename produces no such frame, which
  // is exactly the gap this type closes. Carries WorkspaceUpdatedPayload. SSOT pyrycode#2209.
  | 'workspace_updated'
  | 'conversation_updated'
  // ONE frame carrying BOTH directions: it rides upload (client → daemon) and retrieval
  // (daemon → client) alike, and all eight AttachmentChunkPayload fields are always present in
  // both. There is NO conversation_id on it, and the omission is a SECURITY PROPERTY: an upload
  // lands in the conversation the authenticated session is already on, decided daemon-side from
  // session context, so a client cannot steer bytes into another conversation's directory by naming
  // one. Do not add one "for clarity". SSOT pyrycode #1752 / docs/protocol-mobile.md § Attachments.
  | 'attachment_chunk'
  // The upload leg's ONE POSITIVE TERMINAL (#964) — the transfer completed, its claims were checked,
  // and the bytes are on the host under the id the client chose. BINARY → CLIENT ONLY, which is the
  // whole difference from the frame it answers: `attachment_chunk` rides both legs, this one does not.
  // It is the single positive terminal for the WHOLE transfer, NOT a report that the storage step alone
  // succeeded — six other `attachment.*` error codes terminate an upload, and this is their one
  // counterpart. Before it a client that uploaded was told what went wrong on every failure path and got
  // SILENCE on the one that worked. It is a REPLY, correlated by the envelope's `in_reply_to`, and that
  // field names THE CHUNK WHOSE ARRIVAL COMPLETED THE TRANSFER — not the one with the highest index.
  // Chunks are index-addressed and may be reassembled in any order, so the completing chunk is whichever
  // closed the set and a client CANNOT PREDICT which of its envelope ids that will be; every other chunk
  // of a healthy upload gets no reply at all. That is why AttachmentStoredPayload also carries the
  // attachment id: the envelope field says which frame this answers, the payload says which transfer it
  // concludes, and only the second is a value the client chose and can look up. SSOT pyrycode
  // docs/protocol-mobile.md § Attachments / internal/protocol codes.go TypeAttachmentStored — read that
  // section's SHAPE prose, not its STATUS prose, which still says nothing emits this and went stale
  // hours after it was written. Declared by pyrycode#1895, emitted by #1897, observed by #1898.
  | 'attachment_stored'
  // The retrieval leg's ASK (#993) — the frame a client sends to fetch a stored attachment back.
  // ONE DIRECTION ONLY, client → daemon, and that is the whole difference from the frame it is
  // answered with: `attachment_chunk` rides both legs and so has to make a consumer decide trust
  // from where the frame arrived, while here there is nothing to decide — every field is an
  // unverified claim on the receiving side, always.
  // IT NAMES A CONVERSATION AND AN ATTACHMENT, AND NOTHING ELSE. There is NO request-id key,
  // because correlation rides the ENVELOPE: the answering chunks and the reject both name this
  // frame through `in_reply_to`, and the daemon's committed retrieval-chunk fixture rides
  // `in_reply_to: 91` against request_attachment.json's `id: 91`. Inventing one here would leave a
  // landed upstream fixture describing a different scheme. It DOES carry a conversation_id where
  // `attachment_chunk` deliberately carries none, and that asymmetry is deliberate on both sides —
  // see RequestAttachmentPayload, which also records why naming one is not authorization.
  // Nothing in this repo sends, dispatches or answers it yet; the driver is a later slice, exactly
  // as `attachment_chunk`'s builder landed in #860 ahead of #861. SSOT pyrycode
  // internal/protocol/attachments.go RequestAttachmentPayload / codes.go TypeRequestAttachment,
  // docs/protocol-mobile.md § Attachments. Declared by pyrycode#2052, answered by #2054.
  | 'request_attachment'
  // Reads one markdown file LIVE from a conversation's recorded workspace (#1626). v2 client →
  // daemon only. Carries ReadWorkspaceFilePayload. Answered like `request_attachment` — an
  // `attachment_chunk` stream correlated by `in_reply_to`, or one `attachment.not_found` — except
  // that the daemon mints the transfer's `attachment_id`, so the client cannot know it in advance.
  // SSOT pyrycode internal/protocol/attachments.go ReadWorkspaceFilePayload (pyrycode#2598).
  | 'read_workspace_file'
  // The daemon's announcement that the ASSISTANT sent the operator a file (#1619) — emitted when claude
  // calls its `send_file` tool (pyrycode#2165, emitted since #2166). DAEMON → CLIENT ONLY, and
  // BROADCAST to every attached client, so a consumer filters on the payload's conversation_id. It is
  // LIVE-ONLY: decodeHistoryEvent gains no arm for it. Its attachment_id is the first id on this wire
  // the client did not mint. Carries AttachmentOfferedPayload. SSOT pyrycode docs/protocol-mobile.md
  // § Attachments, heading `attachment_offered`.
  | 'attachment_offered'
  // Conversation scroll-back's ASK (#1222) — one backward step of a walk over the daemon-owned,
  // append-only on-disk log (pyrycode#2112), which a conversation opened today can otherwise see
  // nothing of. v2 client → daemon only, absent from the daemon's `v1TypeSet`, so an old client never
  // sends one and `IsKnownAppType` refuses it.
  //
  // NOT the Mode A `last_event_id` replay, and confusing the two is the mistake this comment exists to
  // prevent. That one is catch-up across a dropped connection over a bounded IN-MEMORY ring that is
  // empty after a daemon restart; this is a log on disk that survives one. They answer different
  // questions and a client uses both.
  //
  // Carries RequestHistoryPayload: `conversation_id`, an opaque `cursor` and a `limit`, all three
  // ALWAYS on the wire. Answered by ONE `history_page` correlated by `in_reply_to` — there is no
  // request-id key, the decision `attachment_stored` already took. A request the daemon cannot answer
  // draws one `error`: `conversation.not_found`, `history.invalid_request`,
  // `history.invalid_page_size`, `history.invalid_cursor`, or the one retryable member
  // `history.unavailable`. SSOT pyrycode docs/protocol-mobile.md § Conversation history (v2).
  // Declared by pyrycode#2113, answered by #2116.
  | 'request_history'
  // The answer to the ask above (#1222): one backward step of a walk, newest-first, correlated by
  // `in_reply_to`. Carries HistoryPagePayload — `entries`, a `cursor` to ask again with, and
  // `at_start`.
  //
  // IT CARRIES NO `conversation_id`, and that is a decision rather than an omission — the shape
  // `session_settings` already takes for the same reason. A client knows which conversation a page
  // describes because it knows which envelope the page answers, so it keeps its outstanding asks keyed
  // by envelope id. Nothing in a page is echoed back from the request.
  //
  // A WALK TERMINATES ON `at_start`, NEVER ON AN EMPTY `entries`, and a SHORT PAGE IS NOT AN
  // END-OF-LOG SIGNAL: the entry clamp bounds a count while the envelope cap bounds bytes, so the
  // daemon may serve fewer entries than asked for. See HistoryPagePayload. SSOT pyrycode
  // docs/protocol-mobile.md § Conversation history (v2).
  | 'history_page'
  // The ASK for the frame below (#1230) — v2-only client→daemon CONTROL frame, intercepted upstream in
  // `dispatchAppFrame` before `dispatch.Route`, gated on the negotiated `interactive` capability and
  // FULLY INERT on a conn that did not negotiate it: no decode, no reply, no error. It exists because
  // a stored system prompt takes effect only at a conversation's NEXT session start, so a client that
  // did not itself perform the write had no way to learn what a conversation holds, nor that the child
  // it is typing at predates an edit.
  //
  // Carries RequestSystemPromptPayload: a single REQUIRED `conversation_id`, like
  // `request_model_list` and unlike `request_session_settings`. Answered by ONE `system_prompt`
  // correlated by `in_reply_to`, and BY NOTHING ELSE.
  //
  // THERE IS NO ERROR FRAME FOR THIS VERB — it mints no wire code and has no failure branch, which is
  // the whole difference from `request_model_list` and the reason an empty id must never reach the
  // wire. Every unresolvable case upstream (no such conversation, no session, a request that named
  // nothing) already has a truthful constant answer, so there is nothing for a code to distinguish.
  // Two consequences bind this client: NOTHING RETRIES AND NOTHING BLOCKS on the reply (the rule
  // `modelListStore`'s header states), and an id the client cannot route must be refused BEFORE the
  // send — an empty one on the wire would draw an ordinary-looking `no_session` reply with an absent
  // prompt, and nothing downstream could tell that false reading from a real one. SSOT pyrycode
  // docs/protocol-mobile.md § Reading a conversation's system prompt / internal/protocol/system_prompt.go.
  // Declared and answered by pyrycode#2152.
  | 'request_system_prompt'
  // The answer to the ask above (#1230): what system prompt a conversation holds, and whether the
  // running session was started with a different one. Unicast to the conn that asked, correlated by
  // `in_reply_to`, carrying NO `event_id`.
  //
  // IT CARRIES NO `conversation_id`, the decision `session_settings` and `history_page` already take,
  // and here it is load-bearing rather than merely consistent: it is what makes an UNHOSTED
  // conversation's answer byte-identical to a hosted-but-quiet one, which is what stops the verb being
  // a conversation-membership oracle. A client knows which conversation a reply describes because it
  // knows which envelope the reply answers, so it keeps its outstanding asks keyed by envelope id.
  //
  // Carries SystemPromptPayload — a tri-state `system_prompt` beside a three-value
  // `session_prompt_status`. See that type for why the two fields are INDEPENDENT and why neither may
  // be derived from the other. SSOT pyrycode docs/protocol-mobile.md § Reading a conversation's system
  // prompt.
  | 'system_prompt'
  | 'ack'
  | 'error'

/** Top-level application envelope. */
export interface Envelope {
  id: number
  type: EnvelopeType | string
  ts: string
  payload: unknown
  // Optional wire fields: absent means omitted (never emitted as null — mobile's
  // explicitNulls = false). `number | undefined` is the faithful representation; a `| null`
  // here would invite a caller to write null, which JSON.stringify would serialize.
  in_reply_to?: number
  event_id?: number
}

export type WireRole = 'user' | 'assistant'

export interface HelloClientPayload {
  role: 'client'
  device_name: string
  client_version: string
  protocol_versions: string[]
  token: string
  capabilities: string[]
  /** Requests the bounded current-conversation tail after this daemon-wide event position. */
  last_event_id?: number
  /** Legacy optional timestamp; the daemon has no consumer. Desktop does not send it. */
  last_seen_ts?: string
}

export interface HelloAckPayload {
  workspace_root?: string
  protocol_version: string
  server_id: string
  conn_id: string
  capabilities: string[]
}

export interface MessagePayload {
  conversation_id: string
  message_id: string
  role: WireRole
  text: string
}

export interface MessageChunkPayload {
  messages: MessagePayload[]
}

/**
 * Outbound `send_message` payload (client → daemon). The three original fields are required and
 * predate v2; `attachment_ids` (#1055, upstream pyrycode#2036) is the frame's only optional key.
 *
 * `attachment_ids` NAMES A MESSAGE'S ATTACHMENTS, which uploading a file does not: the upload leg
 * stores the bytes on the host under the id the client minted, and nothing else on the wire says which
 * message they belong to. Consumed by the daemon since pyrycode#2038, which resolves each named id to
 * its on-host path and composes a prompt naming those paths for `claude` to read — it builds no native
 * image block, so the bytes are never duplicated into the transcript.
 *
 * ABSENT IS THE CANONICAL "NONE" and this type expresses it the way the sibling optional payloads do:
 * TS has no `omitempty`, so `?` merely PERMITS absence and the ENCODER is what enforces it —
 * `buildSendMessage` serializes this object verbatim, and `JSON.stringify` drops a key whose value is
 * `undefined`. Upstream also accepts `null` and `[]` and cannot tell the three apart, so no daemon
 * behaviour can depend on which; this client sends the absent form only.
 *
 * EACH ELEMENT IS A LOWERCASE UUIDv4 under § The `attachment_id` shape — the same canonical rule
 * binding `RequestAttachmentPayload`'s ids, and lowercase is load-bearing there for the same reason
 * (the id becomes a directory name on a case-insensitive filesystem). DOCUMENTED, NOT VALIDATED here,
 * that type's posture verbatim: this wire layer declares shapes and validates none. Upstream mandates
 * the check on the RECEIVER and enforces it, which is where it answers both of the hazards it names —
 * an element becoming a path component, and an element becoming prompt content claude reads
 * (§ Security model threat 1). Containment is upstream's confinement to the message's own
 * conversation directory, never this side's checking and never the id's unguessability.
 *
 * AT MOST 32 ELEMENTS, counting elements rather than distinct ids; upstream refuses an over-bound list
 * with `protocol.malformed`, taking the whole message with it. Published as contract clarity rather
 * than as a DoS mitigation (the envelope cap already bounds the list far lower than any resolution
 * cost matters), and NOT guarded on this side — reaching it needs 33 attach gestures on one message,
 * which has never happened, and what to do with the 33rd file is an unmade UX decision.
 */
export interface SendMessagePayload {
  conversation_id: string
  message_id: string
  text: string
  /** The uploaded attachments this message references, in the composer's own order. Absent = none. */
  attachment_ids?: string[]
}

/**
 * Outbound `set_session_settings` payload (client → daemon). Mirrors the daemon's
 * SetSessionSettingsPayload{SessionID string; Model, Effort, PermissionMode *string; YOLO *bool}
 * field-for-field (pyrycode #844 wire vocab, #845 handler; `permission_mode` added in pyrycode#1687,
 * picked up here in #1021): changes one session's model / reasoning effort / permission mode / YOLO.
 *
 * The optional `?` fields mirror the daemon's `*T ...,omitempty` nil-pointer omission and carry a
 * PRESENCE CONTRACT: an ABSENT key means "leave unchanged"; a key PRESENT at its zero value (`''` /
 * `false`) means "set to this value" (an empty-string clear, or permissions-enforced). On the wire
 * this distinction is an absent key (omitempty) vs a present key — NEVER a literal `null`. TS has no
 * `omitempty`, so this type merely PERMITS absence; the contract is ENFORCED by the builder
 * (setSessionSettingsEnvelope.ts), which assigns a key only when its field `!== undefined`. `session_id`
 * is the addressing key (matches the daemon's Pool.UpdateSettings id), never a secret — always required.
 *
 * `permission_mode` and `yolo` are TWO SPELLINGS OF ONE POSTURE, and the daemon refuses a frame carrying
 * BOTH as malformed — checked before the mode's value, so that refusal is unconditional. This type
 * permits both (it is a structural mirror, not a policy); keeping them off one frame is the job of the
 * single-key literal each caller builds (`buildSettingsPayload`, #1021).
 */
export interface SetSessionSettingsPayload {
  session_id: string
  /** *string omitempty — absent = leave unchanged; '' = clear to the daemon default. */
  model?: string
  /** *string omitempty — absent = leave unchanged; '' = clear to the daemon default. */
  effort?: string
  /** *bool omitempty — absent = leave unchanged; false = permissions enforced (never omitted-as-false). */
  yolo?: boolean
  /**
   * *string omitempty (pyrycode#1687) — absent = leave unchanged. UNLIKE `model`/`effort`, a present
   * `''` is REFUSED rather than meaning "claude's own default": the default posture is itself a nameable
   * mode, so an explicit `''` names nothing. The daemon accepts a closed FIVE — `default`, `acceptEdits`,
   * `plan`, `auto`, `dontAsk` — at `validPermissionMode`; `bypassPermissions` is refused HERE on purpose,
   * so the escalation keeps exactly one spelling on the wire (`yolo: true`). Note the read half is WIDER:
   * `SessionSettingsPayload.permission_mode` (#1020) additionally reports `bypassPermissions`, so a
   * value observed there is not necessarily one this field will accept back.
   *
   * A lone `permission_mode` CAN move a session out of bypass — the pool sets
   * `merged.YOLO = (mode == "bypassPermissions")` on any present mode — and can never move one INTO it,
   * because the value that would do so is the refused one. No client-side allowlist mirrors any of this:
   * every refusal replies with the same fixed constant, so the client cannot tell them apart anyway.
   */
  permission_mode?: string
}

/**
 * Inbound `session_settings_updated` reply (daemon → client). Mirrors the daemon's
 * SessionSettingsUpdatedPayload{SessionID string} field-for-field (pyrycode #844 wire vocab, #845
 * handler, both on `main`): confirms a `set_session_settings` (#263) request landed. It carries ONLY
 * `session_id` — no `omitempty`, the one field is always present on the wire — and deliberately does NOT
 * echo the applied `model` / `effort` / `yolo` (the client already knows what it sent; the reply carries
 * only the addressing id). `session_id` is the addressing key (matches the request's `session_id` and the
 * daemon's Pool.UpdateSettings id), a routing id, NEVER a secret (the `SetSessionSettingsPayload.session_id`
 * / `conversation_id` convention). Correlation to the specific pending request is by `Envelope.in_reply_to`
 * (on the Envelope, NOT the payload) — decoded/carried by #261 when its consumer exists, never here. See #264.
 */
export interface SessionSettingsUpdatedPayload {
  session_id: string
}

/**
 * Outbound `request_session_settings` payload (client → daemon). Mirrors the daemon's
 * internal/protocol/settings.go RequestSessionSettingsPayload field-for-field: one
 * `conversation_id`, no `omitempty`, so the key is ALWAYS on the wire and `''` is a real value
 * meaning "this request names nothing" rather than an absence. The frame was genuinely bare when
 * #491 shipped it; pyrycode#1586 gave it this payload and pyrycode#1610 taught the handler to
 * resolve it, which is why a client still sending `{}` got the zero reply forever.
 *
 * `conversation_id` is a routing id, NEVER a secret (the `SetSessionSettingsPayload.session_id` /
 * `conversation_id` convention). Upstream uses it for exactly one in-memory resolution through the
 * handler's conversation-keyed run-configuration seam; it reaches no log line, error string,
 * filesystem path, or reply on either side.
 */
export interface RequestSessionSettingsPayload {
  conversation_id: string
}

/**
 * Inbound `session_settings` reply (daemon → client). Mirrors the daemon's
 * internal/protocol/settings.go SessionSettingsPayload field-for-field, wire order
 * `session_id, model, effort, effective_effort, yolo, permission_mode, used_tokens, window_tokens`.
 * The original fields are always present, so their zero values are real answers. The additive
 * `effective_effort` report (pyrycode#2517) is omitted when the applied reading is unavailable.
 * `permission_mode` (pyrycode#1687) sits BETWEEN `yolo` and `used_tokens`, not at the end; requiring
 * it couples this client to a daemon carrying that change, which #1020's real-daemon gate is what
 * proves.
 *
 * The answer to a `request_session_settings` naming one conversation (RequestSessionSettingsPayload
 * above), and the run-configuration sheet's source of truth (#491). A request that names a
 * conversation the daemon does not host, one bound to no live session, or none at all is answered
 * with every field zero-valued — never an error frame and never another session's values — so a
 * `session_id` of `''` is as much a real answer here as a resolved one.
 * It replaces reading these values off the daemon's `screen_snapshot` reply, which still carries
 * copies: that reply is a picture of the terminal, and a daemon on the stream-json interactive
 * runner has no terminal, so it answers `server.binary_offline` and the settings — which have
 * nothing to do with a terminal — were refused along with it. On the runner in production that left
 * the sheet with no values, no session id and no context figure at all.
 */
export interface SessionSettingsPayload {
  /**
   * The session a `set_session_settings` must address. `''` = the daemon has no session to
   * address, so the controls must stay read-only rather than sending an empty id (which the daemon
   * would reject). This is the client's reliable source for it: the unsolicited
   * `session_transition` marker fires only on a clear or an idle eviction, never on session
   * creation, so a fresh conversation never yielded one and the sheet stayed inert forever (#491).
   */
  session_id: string
  /** Active model; '' = inherited daemon default (never treated as absent). */
  model: string
  /** Saved reasoning-effort choice; '' = inherited daemon default. */
  effort: string
  /** Confirmed applied effort: absent = unavailable, null = no parameter, string = verbatim report. */
  effective_effort?: string | null
  /** Permissions posture; `false` = permissions enforced. */
  yolo: boolean
  /**
   * The session's permission mode (pyrycode#1687, picked up by #1020). On a RESOLVED session it names
   * one of claude's SIX modes — `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`,
   * `bypassPermissions` — normalised by the daemon at every construction site.
   *
   * `''` means NO SESSION WAS RESOLVED. It is the one zero on this payload that does not name a real
   * posture, and it occurs only in the all-zero reply, beside `session_id: ''`. Read the pair
   * together: `''` is never a mode, and never coerced to one or to `null`.
   *
   * It always AGREES with `yolo`, because the daemon stores them so they cannot disagree — a session
   * in bypass reports `bypassPermissions` and `yolo: true`. Neither is derived from the other here:
   * `yolo` is a boolean and there are six modes, so it can only separate `bypassPermissions` from
   * everything else, which is the whole reason this field exists.
   *
   * The read half carries SIX; the write half's `validPermissionMode` accepts a closed FIVE with
   * `bypassPermissions` excluded (#1021). That asymmetry is deliberate upstream — so this side must
   * not narrow to five, and no client-side allowlist of mode names belongs anywhere on this chain.
   */
  permission_mode: string
  /** Current context size on the latest usage-bearing transcript entry; NOT a running total. */
  used_tokens: number
  /** Context-window size (200000 today); `0` = usage seam unwired — do NOT render a percentage. */
  window_tokens: number
  /**
   * What the resolved session supports (pyrycode#2646). Absent unless the client advertised
   * `multi_agent` and the reply resolved a session. Only the three flags below are decoded (#1654).
   */
  capabilities?: SessionCapabilitiesPayload
  /** Optional daemon memory-search report; omission means no reading was supplied. */
  memory_search?: MemorySearchPayload
}

export type MemorySearchAvailability = 'available' | 'unavailable' | 'absent' | 'unknown'

/** A complete daemon report, including explicit false flags and an optionally empty provider list. */
export interface MemorySearchPayload {
  availability: MemorySearchAvailability
  providers: {
    id: string
    display_name: string
    installed: boolean
    enabled: boolean
    availability: MemorySearchAvailability
  }[]
}

/**
 * The decoded subset of the daemon's `SessionCapabilities` (pyrycode#2670): whether the session answers
 * slash-command, MCP-status and context-breakdown requests at all — true for Claude, false for Codex.
 * Upstream always writes them on a present object, but a daemon predating #2670 does not, so each is
 * optional: absent = not reported, which is distinct from `false`. Support is not permission; the
 * daemon re-checks every request. The object's other keys (`interrupt`, `mid_turn_input`,
 * `effort_levels`, `permission_modes`, `attachment_types`, `models`) are deliberately not modelled.
 */
export interface SessionCapabilitiesPayload {
  slash_commands?: boolean
  mcp_servers?: boolean
  context_usage_detail?: boolean
}

/**
 * Inbound `assistant_delta` event (daemon → client). Mirrors the daemon's AssistantDeltaPayload
 * field-for-field (pyrycode #607, protocol-mobile.md), wire order `conversation_id, turn_id, seq,
 * text` — all always present (no `omitempty`). One incremental slice of the assistant reply on the
 * v2 interactive stream, which REPLACES the coarse `message` fan-out (pyrycode #699): assistant text
 * arrives only here once #179 flips `interactive` on. `text` is the render payload (#203), carried
 * verbatim. See #199.
 */
export interface AssistantDeltaPayload {
  /** Spawning Agent/Task id; empty or absent for main-thread text. Display attribution only. */
  parent_tool_use_id?: string
  conversation_id: string
  turn_id: string
  /** Per-turn sequence, non-negative, resets each turn (daemon Seq int, #607); `0` is a valid value. */
  seq: number
  /** One incremental slice of assistant reply text. */
  text: string
}

/**
 * Inbound `turn_end` event (daemon → client). Mirrors the daemon's TurnEndPayload field-for-field
 * (pyrycode #607, protocol-mobile.md), wire order `conversation_id, turn_id, stop_reason` — all
 * always present (no `omitempty`). Closes a turn on the v2 interactive stream. `stop_reason` (e.g.
 * "end_turn") is an opaque enum string, decoded but not interpreted at the transport (#199).
 */
export interface TurnEndPayload {
  conversation_id: string
  turn_id: string
  stop_reason: string
  /** Optional on older daemons; reports are untrusted display text, at most 256 UTF-8 bytes. */
  outcome?: string
  is_error?: boolean
  terminal_reason?: string
  error_category?: string
  /**
   * Claude's `result` numbers (pyrycode #2260 / #2261, #1565), each optional and carried as received:
   * no clamping, so `0` and negatives pass through. All are this turn's except `cost_usd_total`, the
   * SESSION's running total in US dollars. `duration_api_ms` and `num_turns` are deliberately not read.
   */
  duration_ms?: number
  input_tokens?: number
  cache_read_tokens?: number
  cache_creation_tokens?: number
  output_tokens?: number
  cost_usd_total?: number
}

/**
 * The coarse turn lifecycle scalar on the wire. Mirrors WireRole: a plain string on the daemon side
 * (no named enum), exactly like MessagePayload.role. Structurally identical to the renderer-side
 * TurnPhase (threadTimeline.ts) — declared separately because shared code cannot import a renderer
 * type; the timeline bridge (#202) assigns one to the other with no cast.
 */
export type WireTurnState = 'thinking' | 'responding' | 'idle'

/**
 * Inbound `turn_state` event (daemon → client). Mirrors the daemon's TurnStatePayload field-for-field
 * (pyrycode #607 / #794, protocol-mobile.md), wire order `conversation_id, state` — both always present
 * (no `omitempty`). The coarse lifecycle scalar of the v2 interactive stream (ADR 0008): a `phase`, NOT
 * a timeline item. `state` is a plain wire string exactly like `MessagePayload.role`, closed to the
 * three WireTurnState values; the daemon emits `turn_state{thinking}` on the rising edge of a turn,
 * before any `assistant_delta` (pyrycode #632). See #214.
 */
export interface TurnStatePayload {
  conversation_id: string
  state: WireTurnState
}

/**
 * Inbound `stall` event (daemon → client). Mirrors the daemon's StallPayload field-for-field (pyrycode
 * #638 wire vocab, #639 fan-out), which carries `conversation_id` ONLY — always present (no `omitempty`).
 * An internal-only liveness signal the daemon fans out ONLY to `interactive`-capable clients when a turn
 * goes quiet (claude stalled mid-turn, or the screen-parser degrading); it has no ACP equivalent.
 *
 * ONSET-ONLY: the daemon emits one `stall` on the rising edge and does NOT repeat it while the stall
 * persists; there is NO "stall cleared" frame. It is deliberately NOT turn-scoped, so there is no
 * `turn_id`, and it carries no clearing / recovery field — the client self-clears on the next turn
 * activity, which is the render slice's concern (#317), not this wire type's. See #315.
 */
export interface StallPayload {
  conversation_id: string
}

/**
 * Inbound `api_retry` event (daemon → client). Mirrors the daemon's ApiRetryPayload field-for-field
 * (pyrycode #1074; detector upstream tui-driver #303), whose four fields are always present (no
 * `omitempty`). A PTY-derived status peer of StallPayload, fanned out ONLY to `interactive`-capable
 * clients: claude hit an API error and is retrying, rendering `API error · Retrying in Ns · attempt N/M`.
 *
 * NOT ONSET-ONLY — the deliberate contrast with `stall`. `active: true` is the rising edge, `active:
 * false` the explicit falling edge (claude recovered), so the client never derives "cleared" from turn
 * activity. The counter rides BOTH edges; the falling edge repeats the last-known value verbatim so the
 * final render stays coherent. The rising edge RE-FIRES as the count climbs (`3/10` → `4/10`), one frame
 * per actual count change, with no dedup on the wire — so a consumer must not dedup or coalesce either.
 *
 * `current: 0` alongside `total: 0` is a LEGITIMATE "retrying, count unknown" state (claude's on-screen
 * counter did not parse) — not an error, and not a sentinel to coerce away. Like `stall` it is
 * conversation-level, so there is no `turn_id`, and receiving it never opens, closes, or alters a turn.
 * See #492 (this decode) and #493 (the render).
 */
export interface ApiRetryPayload {
  conversation_id: string
  active: boolean
  current: number
  total: number
}

/** Compaction status and optional outcomes from the daemon; older daemons omit outcomes. */
export interface CompactingPayload {
  conversation_id: string
  active: boolean
  compact_result?: string
  compact_error?: string
}

/**
 * How far along a reset is. A closed wire enum like WireSessionTransitionReason, so the decoder
 * compares against literals rather than accepting any string — and unlike RateLimitedPayload's
 * `status` / `limit_type` one screen down, narrowing here is safe precisely because the daemon
 * AUTHORS these tokens itself rather than carrying claude's.
 *
 * `''` IS A MEMBER, and it is the one thing about this type worth reading twice. Upstream names only
 * `wrapping_up` and `restarting` as constants; `''` is Go's zero value, and since the daemon declares
 * no `omitempty` the key is written on every frame, so `''` is what the falling edge carries once the
 * reset is over. A set admitting only the two named tokens rejects every falling edge.
 */
export type WireResetPhase = 'wrapping_up' | 'restarting' | ''

/**
 * What became of the handoff document a reset writes. A closed wire enum like WireResetPhase above,
 * with `''` a member for the same reason: it is the daemon's declared zero value on the falling edge,
 * not an absence. `pending` rides the `wrapping_up` phase; `written` and `skipped` ride `restarting`.
 */
export type WireResetHandoff = 'pending' | 'written' | 'skipped' | ''

/**
 * Inbound `resetting` event (daemon → client). Mirrors the daemon's ResettingPayload field-for-field
 * (SSOT pyrycode#2453 declared / #2478 emitted, internal/protocol/interactive.go with the `ResetPhase*`
 * and `ResetHandoff*` constants), wire order `conversation_id, active, phase, handoff` — all four
 * ALWAYS PRESENT (no `omitempty` on any of them). Fanned out ONLY to `interactive`-capable clients: a
 * conversation's session is being reset, and this says which phase of it the conversation is in.
 *
 * THE FOUR ROWS, exactly as the daemon emits them, with an upstream real-claude test asserting the
 * three edges in order:
 *
 *   active:true   phase:wrapping_up   handoff:pending
 *   active:true   phase:restarting    handoff:written | skipped
 *   active:false  phase:''            handoff:''
 *
 * TWO EDGES, like ApiRetryPayload and CompactingPayload above and never onset-only like StallPayload.
 * `active: true` is the rising edge and `active: false` the explicit falling edge, so a client never
 * derives "cleared" from turn activity; the rising edge RE-FIRES as the phase advances
 * (`wrapping_up` → `restarting`), one frame per actual change.
 *
 * `''` IS ACCEPTED WHATEVER `active` SAYS, and that is the design rather than a gap. The decoder
 * admits it UNCONDITIONALLY on both fields: gating the token set on `active` would be cross-field
 * validation, which this decoder family refuses by name (see QueuedItem's no-cross-validate posture),
 * and upstream's "gate on `active` rather than inventing a fourth token" is addressed to a CONSUMER
 * switching over either set. So the pair the daemon never emits — `active: true` with `phase: ''` —
 * DECODES rather than throwing, because rejecting it would defend an unobserved failure mode and
 * would fail-close a daemon that later adds a phase or reorders its edges.
 *
 * CONVERSATION-SCOPED, NOT TURN-SCOPED: there is no `turn_id`, and receiving one neither opens nor
 * closes a turn. A reset is orthogonal to whichever turn happened to be running.
 *
 * SECURITY: NARROWED IS NOT TRUSTED, and this frame inverts the usual hazard of its neighbours. Every
 * field here is DAEMON-AUTHORED — the id is one the daemon assigned, `active` a bool it computed, both
 * tokens its own constants — which is why both are narrowed to closed sets where RateLimitedPayload's
 * claude-authored strings deliberately stay open. The risk is the mirror image: a closed union is a
 * compile-time invitation to `switch (phase)` and read the result as settled fact. It is not. A
 * narrowed value is still a CLAIM BY A PEER: a hostile daemon can send any of the sixteen
 * combinations, so a consumer must handle all of them rather than only the producer's three, and must
 * never branch security-relevant behaviour on either token. THE FRAME IS A REPORT, NEVER A CONTROL
 * INPUT OR AN AUTHORIZATION SIGNAL. `handoff: 'written'` describes a file the daemon wrote and the
 * payload deliberately carries NO PATH, so nothing downstream can resolve, join, open or link one —
 * the token is a three-value status, not a locator. `conversation_id` is a daemon-asserted routing
 * key, never an authorization signal and never resolved against a filesystem. Nothing decoded reaches
 * a log: the pair plus the id discloses which conversation the operator reset and whether a handoff
 * was written, which is a fact about the operator's workflow rather than about this frame.
 *
 * A CONSUMER MUST NOT RELY ON THE FALLING EDGE ARRIVING. A daemon that crashes or is killed mid-reset
 * sends no `active: false`, so an indicator cleared ONLY by that frame pins on forever; the clearing
 * path needs an independent trigger (disconnect, conversation exit, turn activity). Nothing at the
 * decode boundary can defend that. See #1514 (this decode); nothing consumes the decoded arm yet —
 * the IPC carry is #1515, and its two consumers follow it.
 */
export interface ResettingPayload {
  conversation_id: string
  active: boolean
  phase: WireResetPhase
  handoff: WireResetHandoff
}

/** Delayed display metadata from the daemon. Missing/null counts differ from zero. */
export interface CompactionBoundaryPayload {
  conversation_id: string
  trigger: string
  pre_tokens?: number | null
  post_tokens?: number | null
}

/**
 * Inbound `model_announced` event (daemon → client). Mirrors the daemon's ModelAnnouncedPayload
 * field-for-field (SSOT pyrycode#1616, internal/protocol/interactive.go:462; producer #1638), wire
 * order `conversation_id, model, truncated` — all three ALWAYS PRESENT (no `omitempty`; the daemon's
 * own zero fixture testdata/model_announced_zero.json round-trips `{"","",false}`). Fanned out ONLY to
 * `interactive`-capable clients: claude names the model it resolved for a turn on its `system` / `init`
 * line, and until #1638 that value stopped at the daemon boundary.
 *
 * NOT a claude sub-state like its `stall` / `api_retry` / `compacting` neighbours, and not a daemon
 * mapping gap like `unrecognized_message`. It is an IDENTITY report — what claude says it IS, for the
 * turn it says it about. It answers what the spawn argument cannot: the daemon knows what it REQUESTED,
 * only claude knows what it GOT. Conversation-scoped rather than turn-scoped, so there is NO `turn_id`,
 * and receiving one neither opens nor closes a turn.
 *
 * `model` IS THE RENDER PAYLOAD and is claude's identifier VERBATIM — never empty (the producer
 * suppresses the event on an empty model). claude echoes an identifier AT LEAST AS SPECIFIC as the one
 * it was given, so the value is not reliably dated and NEED NOT APPEAR IN ANY PUBLISHED MODEL LIST:
 * requesting `haiku` yields `claude-haiku-4-5-20251001`, requesting `claude-haiku-4-5` yields it back
 * unchanged, requesting nothing yields `claude-sonnet-5`. A LOOKUP MISS IS THEREFORE ORDINARY, not an
 * error. Hold it verbatim: no normalising, no lowercasing, no allow-list, and above all no regexing a
 * family out of it — the published list mixes dated (`claude-haiku-4-5-20251001`) and undated
 * (`claude-opus-5`) shapes, so any pattern that works today breaks on the first identifier without a
 * family word. Resolution to a display name is #588's concern and is an exact lookup, never inference.
 *
 * `truncated` is a BOOL, not the background-task / rate-limit `truncated_fields: string[]`, following
 * UnrecognizedMessagePayload: this payload bounds a SINGLE string, so a name list would be permanently
 * either `null` or `["model"]`. It is load-bearing either way — a reader that ignores it presents
 * claude's cut identifier as a complete one, and that failure is sharper here than elsewhere, because a
 * cut identifier will ALWAYS miss #588's exact lookup and so will always render verbatim, looking
 * exactly like a legitimate unrecognised model.
 *
 * The bound is the PRODUCER's, decided at construction (pyrycode internal/streamsup/parser.go's
 * `maxModelField`, 256). This type re-decides no maximum: a second cap here would be a second place the
 * limit is decided and the two could disagree silently. Nor is there a charset check — pyrycode
 * internal/relay's `validModel` bounds a PHONE-SUPPLIED OVERRIDE and is deliberately a different rule;
 * applying it here would reject identifiers claude legitimately announces.
 *
 * SECURITY: `model` is a claude-authored string that crossed the subprocess trust boundary. The daemon
 * BOUNDS it but does NOT SANITIZE it — no control-character or terminal-escape stripping happens
 * anywhere on this path — so it stays untrusted, model-influenced text and the render boundary owes the
 * sanitization. Safe to render as INERT PLAIN TEXT only: never through an HTML sink (`innerHTML` /
 * `dangerouslySetInnerHTML`), never into an attribute, never into a URL. It is a REPORT, NEVER A
 * CONTROL INPUT — no security-relevant behaviour may branch on it.
 *
 * See #587 (this decode) and #588 (the store).
 */
// Untrusted informational report; strings are open values, never permission controls.
export interface SessionFactsPayload {
  conversation_id: string
  claude_code_version: string
  permission_mode: string
  truncated_fields: string[] | null
}

export interface ModelAnnouncedPayload {
  conversation_id: string
  model: string
  truncated: boolean
}

/**
 * Inbound `thinking_progress` event (daemon → client). Mirrors the daemon's ThinkingProgressPayload
 * field-for-field (SSOT pyrycode#1386, internal/protocol/interactive.go, docs/protocol-mobile.md
 * § thinking_progress), wire order `conversation_id, estimated_tokens, estimated_tokens_delta` — all
 * three ALWAYS PRESENT (no `omitempty`, so the daemon's zero value is legal traffic). Fanned out ONLY
 * to `interactive`-capable clients: it is the daemon's translation of claude's `system/thinking_tokens`
 * line, and claude's ONLY mid-turn proof of life on the stream-json surface — during a long assistant
 * turn nothing else crosses the wire, so a client showing "thinking" for three minutes cannot otherwise
 * separate a slow answer from a wedged session.
 *
 * A READING, NOT A STATE TRANSITION, which is the contrast with every neighbour above. `api_retry` and
 * `compacting` are sub-states with a rising and a falling edge; this frame has no edges at all, and the
 * turn's thinking state is already reported by `turn_state: thinking`. Conversation-scoped rather than
 * turn-scoped, so there is NO `turn_id`, and receiving one neither opens nor closes a turn — the daemon
 * emits these during an inference request that may not have produced any assistant content yet, so a
 * turn opened on one would have no guaranteed end.
 *
 * IT CARRIES NO REASONING TEXT (ADR 025), and that makes it the one frame in this family with no
 * untrusted display string at all: the content of claude's thinking is never forwarded on this wire, so
 * a client that tries to render this as text has nothing to render. For the same reason there is no
 * `truncated` / `truncated_fields` here, an absence that is a DECISION rather than an omission — this
 * payload bounds no claude-authored text, so nothing is ever cut and a permanently-null cut list would
 * claim a bound that does not exist. There is likewise no producer byte cap to mirror.
 *
 * THREE THINGS A CONSUMER GETS WRONG BY DEFAULT, each measured upstream on one committed capture of a
 * single turn rather than inferred:
 *
 *   - THE FRAMES ARE RATE-BOUNDED AND DO NOT ENUMERATE CLAUDE'S LINES. The daemon emits at most one
 *     frame per 64 tokens of accumulated delta: 33 lines became 8 frames. Never treat a frame as
 *     "claude produced one line", and never count frames to count anything of claude's.
 *   - `estimated_tokens` IS NOT MONOTONIC. It restarts near zero at every inference-request boundary,
 *     which happens repeatedly inside one turn — that capture's single turn contains four restarts
 *     (5→184, then 4→167, then 3→126, then 1→197). Two readings must therefore NEVER be subtracted
 *     expecting a non-negative result. It is a progress reading, not a turn total and not a counter to
 *     difference.
 *   - THE DELTAS RECEIVED DO NOT SUM TO THE TURN'S TOTAL. The rate bound drops most of claude's lines
 *     and their increments go with them: 674 tokens of delta arrived as 243 across 8 frames. NO FIELD
 *     REPORTS THE RESIDUE, deliberately — this is a rate reading, not an accumulator input — so summing
 *     the deltas undercounts by an amount the wire does not disclose.
 *
 * ABSENCE PROVES NOTHING, for two distinct reasons that BOTH apply, and this is a correctness rule
 * rather than a UX note. Only the stream-json parser produces the event, so a client attached to a
 * PTY-driven session will NEVER receive one however long claude thinks; and even on the emitting
 * surface a gap may only mean the 64-token bound has not been crossed yet. A client MUST NOT infer a
 * stall from either — this frame is proof of life WHEN PRESENT and says nothing when absent. The
 * daemon's separate stall signal is `stall`, which has its own producer and is untouched by this frame
 * in both directions.
 *
 * SECURITY: `conversation_id` is a daemon-asserted routing key, never an authorization signal and never
 * resolved against a filesystem. The two integers are claude's own readings, carried verbatim; they are
 * never used to size an allocation, index a buffer, or bound a loop, and they never reach a log — a
 * reading of how much claude thought is a side-channel on private work, as unwelcome in a log an
 * operator may send off-box as the correlating id beside it. See #1312 (this decode); nothing consumes
 * the decoded arm yet.
 */
export interface ThinkingProgressPayload {
  conversation_id: string
  estimated_tokens: number
  estimated_tokens_delta: number
}

/**
 * Inbound `rate_limited` event (daemon → client). Mirrors the daemon's RateLimitedPayload
 * field-for-field (SSOT pyrycode#1405 declared / #1410 emitted, internal/protocol/interactive.go,
 * docs/protocol-mobile.md § rate_limited), wire order `conversation_id, status, limit_type, resets_at,
 * truncated_fields` — all five ALWAYS PRESENT (no `omitempty`). Fanned out ONLY to
 * `interactive`-capable clients: claude's usage-limit window is in a state other than the one
 * measured-benign one, and this frame says why, which limit, and when claude says it lifts.
 *
 * WHY THE FRAME EXISTS. A turn that stops making progress because of a usage limit otherwise says
 * nothing about why. claude reports the window ONCE PER RUN WHATEVER ITS STATE, so a 1:1 translation
 * would put a row on every healthy turn and make the frame worthless noise. The daemon gates it
 * instead: the one measured-benign status is silent, and ANY OTHER NON-EMPTY STATUS EMITS. That
 * direction is deliberate — an unrecognised status surfaces and a human looks, rather than a real limit
 * vanishing — and it is also why this client must not narrow the set at the other end.
 *
 * A FRAME IS NOT PROOF THAT ANYTHING WAS BLOCKED, and the daemon names this as THE realistic client
 * bug. The one measured non-benign value is `allowed_warning`, seen 2026-08-22 on claude 2.1.239
 * against `limit_type: seven_day`: the account was inside its weekly warning band and EVERY TURN STILL
 * RAN NORMALLY. So the frame's plain reading is "claude said something about the usage window worth
 * repeating", never "you are rate limited" — a client rendering the latter tells the user they are
 * blocked while their turns keep working. Warning ahead of the wall is this frame's most useful moment,
 * the only one where the user can still act, so the answer is wording that does not overclaim rather
 * than suppression.
 *
 * `status` AND `limit_type` ARE OPEN STRINGS, NEVER CLOSED ENUMS, and the daemon gives the reason: the
 * value set beyond the benign one is UNMEASURED — no capture of a limit actually in force exists on any
 * claude version. A client that closes either set drops the first real limit that fires. `status` is
 * claude's own status for the window, carried verbatim precisely so the set gets measured the first
 * time one does; `limit_type` is which limit the report concerns (`five_hour` and `seven_day` are the
 * observed values, and two observations do not earn an enum). Neither wire name tracks claude's key —
 * claude's are `rateLimitType` / `resetsAt` under `rate_limit_info` — so a claude rename lands in one
 * upstream place instead of breaking every client.
 *
 * `resets_at` IS CLAUDE'S NUMBER, NOT THE DAEMON'S CLOCK, and it is unvalidated in BOTH directions.
 * Unix seconds, with `0` meaning claude did not report one — NOT the epoch. Negative, zero and
 * year-40000 values are all representable and none is rejected, because rejecting one would be a
 * validation rule with no captured negative case behind it. Formatting it as a date without a range
 * check is the second named realistic bug. It is also never a SCHEDULING input: a delay computed from
 * it can be negative (fires immediately, and spins if the handler re-arms) or past setTimeout's ~24.8-
 * day clamp, which ALSO fires immediately rather than never. Never schedule, allocate or iterate from
 * this number — AttachmentChunkPayload's "never allocate from a claim" rule, one field over.
 *
 * `truncated_fields` IS LOAD-BEARING, NOT DECORATION: a client ignoring it presents claude's cut text
 * as complete. It names the fields the producer cut to fit its cap, under THESE wire names (`status`,
 * `limit_type`, in that order), and is a literal `null` when nothing was cut, NEVER `[]` — which is why
 * the Go type has no MarshalJSON. That is `BackgroundTask.truncated_fields`'s nullability and
 * emphatically NOT `BackgroundTaskRosterPayload.tasks`'s fail-closed shape: nil→[] there means the
 * OPPOSITE (an empty roster is a positive statement, whereas nothing-was-cut is an absence). Both
 * strings were bounded by the daemon AT CONSTRUCTION, so an oversized value never reaches this wire and
 * a client re-deciding the maximum would be a second place the limit is decided.
 *
 * CONVERSATION-SCOPED, NOT TURN-SCOPED, like ThinkingProgressPayload above: there is no `turn_id`, and
 * receiving one neither opens nor closes a turn. A usage-limit window is orthogonal to whichever turn
 * happened to observe it, so attributing it to one would be a claim the daemon cannot honestly make.
 * The bridge supplies `conversation_id` because the internal event carries none. claude's `session_id`
 * and `uuid` are deliberately absent — they are claude's session identity and per-line message id,
 * neither of which is the daemon's conversation identity.
 *
 * SECURITY: `status` and `limit_type` are claude-authored strings that crossed the SUBPROCESS TRUST
 * BOUNDARY. The daemon bounds them but does NOT sanitize them, so they stay untrusted,
 * model-influenced text all the way here: safe to render as INERT TEXT, never fed to an HTML sink
 * (`innerHTML` / `dangerouslySetInnerHTML`), an attribute, or a URL, and never used as a Map key, a
 * lookup path or a filename — `limit_type` is exactly the shape of short token that invites an
 * icon-lookup. THE FRAME IS A REPORT, NEVER A CONTROL INPUT: nothing in the daemon keys a behaviour on
 * any field (no backoff, throttle, retry, turn suspension or reconnect delay) and a client MUST NOT
 * branch security-relevant behaviour on `status`. That is what keeps a wrong — or hostile — value
 * costing at most one misleading row. `conversation_id` is a daemon-asserted routing key, never an
 * authorization signal and never resolved against a filesystem. Nothing decoded reaches a log: the pair
 * discloses the account's quota posture, which is a fact about the operator rather than about this
 * frame. See #1318 (this decode); nothing consumes the decoded arm yet.
 */
export interface RateLimitedPayload {
  conversation_id: string
  status: string
  limit_type: string
  // Go `int64`; a plain `number` like every other integer on this wire — JSON.parse produces no
  // bigint, and a value past Number.MAX_SAFE_INTEGER is covered by the no-range-check rule above
  // rather than by a type change.
  resets_at: number
  truncated_fields: string[] | null
}

/**
 * ONE ROW of a `context_usage` frame's category breakdown (daemon → client, #1455). Mirrors the daemon's
 * `ContextUsageCategory` field-for-field (SSOT pyrycode#2370, internal/protocol/interactive.go), wire
 * order `name, tokens`. One named contribution to the reading in ContextUsagePayload below.
 *
 * NAMED WITHOUT THE `Wire` PREFIX, deliberately. That prefix is this file's mark for a nested row whose
 * BARE NAME IS GENERIC ENOUGH TO BE WANTED AGAIN DOWNSTREAM — `WireQuestion`, `WireModalOption`,
 * `WireModelOption`, `WireSlashCommand`, each of which would otherwise claim a name a store or a screen
 * naturally wants for its own view model. `ContextUsageCategory` is already qualified by its frame and
 * claims nothing a consumer would want back, so it joins the rows named plainly after the daemon's own
 * type: `BackgroundTask`, `QueuedItem`, `HistoryEntry`. Colliding with a Go type name is NOT the
 * criterion — all three of those collide too.
 *
 * BOTH KEYS ARE ALWAYS PRESENT, with no `omitempty` on either, so `name: ''` is a VALUE and `tokens: 0`
 * is claude's reading of zero. An absent key is a real defect rather than an empty row, and a truthiness
 * test on either would read a legitimate row as malformed and drop the whole frame with it.
 *
 * `tokens` IS ONE CONTRIBUTION, AND THE CONTRIBUTIONS DO NOT RECONCILE. The daemon states the categories
 * need not sum to `total_tokens`, and a cut list makes the sum smaller still — so a consumer must not
 * derive a total from these rows, present their sum as the reading, or treat a gap between the two as an
 * error. It is not range-checked in either direction, for the reading's own reason: the figures are
 * claude's and the daemon neither recomputes nor normalizes them.
 *
 * SECURITY: `name` is claude-authored descriptive text that crossed the SUBPROCESS TRUST BOUNDARY. The
 * producer bounds it at construction but neither validates nor sanitizes it, so it stays untrusted,
 * model-influenced text all the way here — the daemon calls it a LABEL, never a selector a client may
 * branch on for authority. Safe to render as INERT TEXT, never fed to an HTML sink (`innerHTML` /
 * `dangerouslySetInnerHTML`), an attribute or a URL, and never used as a lookup path, a filename, a CSS
 * class or an icon name. The committed fixture carries `Messages <&>` with its markup metacharacters on
 * purpose and this decoder passes them through byte-for-byte: the escaping is owed at the RENDER SINK
 * (CLAUDE.md's 2026-08-20 operator ruling), and escaping here would corrupt the value for every
 * non-HTML sink while buying false safety at the real one. **IF A CONSUMER INDEXES ROWS BY THIS FIELD,
 * THE INDEX IS A `Map`, NEVER A PLAIN OBJECT** — `byName[row.name] = row` with a `__proto__` label
 * writes through to `Object.prototype`, which is `WireModelOption.display_name`'s rule one frame over
 * and a stronger invitation here, because a breakdown is exactly the shape a legend or a chart keys by
 * its label. The same goes for a React `key`. See #1455 (this decode); the IPC carry is #1419, the
 * store #1420, the surfaces #1421.
 */
export interface ContextUsageCategory {
  name: string
  // Go `int`; a plain `number` like every other integer on this wire.
  tokens: number
}

/**
 * ONE ROW of a `context_usage` frame's MCP-tool inventory (daemon → client, #1459). Mirrors the daemon's
 * `ContextUsageMCPTool` field-for-field (SSOT pyrycode#2370, internal/protocol/interactive.go), wire
 * order `name, server_name, tokens`. One tool DEFINITION's contribution to the reading in
 * ContextUsagePayload below.
 *
 * NAMED WITHOUT THE `Wire` PREFIX and with the acronym CAPITALISED, both for ContextUsageCategory's
 * stated reason: a nested row already qualified by its frame is named plainly after the daemon's own
 * type, as `BackgroundTask`, `QueuedItem` and `HistoryEntry` are. `QrPayload` is the one exported name
 * here that lowercases an acronym and it does NOT govern — it is a house-named client-side type with no
 * daemon counterpart to mirror, so it is evidence about naming a new type rather than about mirroring one.
 *
 * ALL THREE KEYS ARE ALWAYS PRESENT, with no `omitempty` on any, so `name: ''` and `server_name: ''` are
 * VALUES and `tokens: 0` is claude's reading of zero. An absent key is a real defect rather than an empty
 * row, and a truthiness test on any of the three would read a legitimate row as malformed and drop the
 * whole frame with it.
 *
 * SECURITY — `server_name` IS INERT, AND THE NAME COLLISION IS THE TRAP THIS BLOCK EXISTS TO DEFUSE. The
 * daemon's `MCPReconnectPayload.ServerName` spells the same field name, crosses an ACTUATION SEAM
 * verbatim, and is validated by nothing in its package or in internal/relay. THIS ONE NAMES A
 * CONTRIBUTOR TO A READING: it is never an actuation target, never an authorization input, and MUST NOT
 * BE FED TO AN MCP VERB — a reconnect, a tool invocation, a server lookup — on the strength of having
 * appeared here, nor joined against `mcp_status` to look one up. Having the same spelling as a field
 * that actuates is not having its meaning. `name` carries the same constraint: it is a tool
 * definition's LABEL, never a handle to call it by.
 *
 * Both strings crossed the SUBPROCESS TRUST BOUNDARY. The producer bounds them at construction but
 * neither validates nor sanitizes them, so they stay untrusted all the way here — safe to render as
 * INERT TEXT, never fed to an HTML sink (`innerHTML` / `dangerouslySetInnerHTML`), an attribute or a
 * URL, and never used as a lookup path, a filename, a CSS class or an icon name. A tool name is
 * frequently path- or command-shaped in practice (`read_file` is the committed fixture's own), which is
 * exactly the shape that invites a later `path.join`. **IF A CONSUMER INDEXES ROWS BY EITHER STRING, THE
 * INDEX IS A `Map`, NEVER A PLAIN OBJECT** — an inventory keyed by server is the obvious view model, so
 * this row is a STRONGER invitation than the category row was, and `byServer[row.server_name]` with a
 * `__proto__` server name writes through to `Object.prototype`. The same goes for a React `key`.
 *
 * The committed fixture carries an EMBEDDED NEWLINE (`query\ndocs`) and `remote<mcp>` metacharacters on
 * purpose and this decoder passes them through byte-for-byte: the escaping is owed at the RENDER SINK
 * (CLAUDE.md's 2026-08-20 operator ruling), and escaping here would corrupt the value for every
 * non-HTML sink while buying false safety at the real one. That newline is also why NEITHER STRING MAY
 * REACH A LOG FIELD for an INTEGRITY reason and not merely a privacy one: the diagnostic stream is
 * line-delimited JSON, so a logged tool name lets a daemon-supplied string FORGE A RECORD.
 *
 * `tokens` IS ONE CONTRIBUTION, AND THE CONTRIBUTIONS DO NOT RECONCILE — ContextUsageCategory's rule one
 * inventory over. It is not range-checked in either direction, the figures being claude's own, and a
 * consumer must not derive a total from these rows or read a gap against `total_tokens` as an error.
 *
 * See #1459 (this decode); the IPC carry is #1419, the store #1420, the surfaces #1421.
 */
export interface ContextUsageMCPTool {
  name: string
  server_name: string
  // Go `int`; a plain `number` like every other integer on this wire.
  tokens: number
}

/**
 * ONE ROW of a `context_usage` frame's MEMORY-FILE inventory (daemon → client, #1460). Mirrors the
 * daemon's `ContextUsageMemoryFile` field-for-field (SSOT pyrycode#2370, internal/protocol/interactive.go),
 * wire order `path, type, tokens`. One memory FILE's contribution to the reading in ContextUsagePayload
 * below, and the LAST of that frame's three inventories: after this row type every key on the frame is
 * declared and parsed.
 *
 * Named without the `Wire` prefix for ContextUsageCategory's stated reason, as ContextUsageMCPTool is.
 *
 * ALL THREE KEYS ARE ALWAYS PRESENT, with no `omitempty` on any, so `path: ''` and `type: ''` are VALUES
 * and `tokens: 0` is claude's reading of zero. An absent key is a real defect rather than an empty row,
 * and a truthiness test on any of the three would read a legitimate row as malformed and drop the whole
 * frame with it. An empty `path` is emphatically NOT a lookup that resolved to the filesystem root —
 * nothing resolves it at all, which is the whole of the next paragraph.
 *
 * SECURITY — **`path` IS PATH-SHAPED DESCRIPTIVE TEXT, NOT A FILE HANDLE**, and the daemon's own comment
 * states the constraint in those words. NOTHING JOINS, CLEANS, RESOLVES OR OPENS IT — not the daemon, not
 * this client's decoder, and not a consumer — because normalising the string would imply it names a real
 * file this frame acts on, WHICH IT DOES NOT. This is the first field on this frame whose NAME ASSERTS A
 * CAPABILITY THE VALUE DOES NOT HAVE: `name` invites a Map key and `server_name` invites an MCP verb, but
 * `path` invites `fs.readFile`, a `path.join` against a workspace root, a `shell.openExternal`, an
 * `href`. None of those may happen on the strength of this frame, which reports what claude READ rather
 * than granting access to anything. The value is WORKSPACE-AUTHORED and unvalidated, so: render it as
 * INERT TEXT, never as a link, never as a lookup path, a filename, a cache key, a React `key` or a key
 * on a plain object (a `Map` if a consumer indexes by it — `../..` and `__proto__` are both ordinary
 * segments here). A PATH-SHAPED STRING IS NOT A PATH-CONSTRAINED ONE either: the daemon constrains
 * neither scheme nor shape, so a `javascript:` URI, a `file://` URL and a UNC path all arrive as an
 * ordinary `path`, which is why "never as a link" means never an `href` and never an `openExternal`
 * target specifically. The daemon's committed fixture carries `../../../etc/passwd` DELIBERATELY so the
 * pass-through is pinned by a test rather than by this comment, and it crosses byte-for-byte: escaping
 * or normalising at a decoder is doing it at the WRONG LAYER, which CLAUDE.md's 2026-08-20 operator
 * ruling puts at the render sink (#1421's).
 *
 * **`type` IS A LABEL, NEVER A DISCRIMINANT.** It is claude's own descriptive text for the entry — the
 * daemon's comment says exactly that — and it carries the same inert-text constraint as `path`. A field
 * spelled `type` on an interface in THIS repo is a standing invitation to misread: the inbound union
 * narrows on `kind` and every envelope narrows on `type`, so `switch (row.type)` reads as idiomatic here
 * and is exactly wrong. It is an OPEN set a claude release widens by definition — a client-side closed
 * set fail-closes a valid future frame, the drift risk CLAUDE.md / ADR 0002 rank above cosmetic
 * robustness — and it carries NO AUTHORITY: nothing may branch security-relevant behaviour on it, and it
 * is never a trust level, a scope or a permission.
 *
 * NEITHER STRING MAY REACH A LOG FIELD, on grounds stronger than any field before it. A `path` discloses
 * WHO THE USER IS AND WHERE THEY WORK — the daemon's own fixture value leaks a home-directory username
 * and a project name — where the integers disclose only how full the window is. And a POSIX path may
 * legitimately contain a NEWLINE, so the line-delimited diagnostic stream makes this an INTEGRITY rule
 * too, ContextUsageMCPTool's forge-a-record ground one inventory over.
 *
 * `tokens` IS ONE CONTRIBUTION, AND THE CONTRIBUTIONS DO NOT RECONCILE — ContextUsageCategory's rule one
 * inventory over. It is not range-checked in either direction, the figures being claude's own, and a
 * consumer must not derive a total from these rows or read a gap against `total_tokens` as an error.
 *
 * See #1460 (this decode); the IPC carry is #1419, the store #1420, the surfaces #1421. The carry is
 * where `path` first crosses `contextBridge` and the surfaces are where the render sink lives, so both
 * inherit this block's prohibitions rather than re-deciding them.
 */
export interface ContextUsageMemoryFile {
  path: string
  type: string
  // Go `int`; a plain `number` like every other integer on this wire.
  tokens: number
}

/**
 * Inbound `context_usage` event (daemon → client), THE READING PLUS ALL THREE OF ITS INVENTORIES (#1454
 * the reading, #1455 the category breakdown, #1459 the MCP-tool inventory, #1460 the memory-file
 * inventory). Mirrors the daemon's ContextUsagePayload in full (SSOT pyrycode#2370 declared / #2371
 * emitted, internal/protocol/interactive.go), wire order `conversation_id, model, total_tokens,
 * max_tokens, percentage, categories, dropped_categories, mcp_tools, dropped_mcp_tools, memory_files,
 * dropped_memory_files` — all eleven ALWAYS PRESENT (no `omitempty`). Fanned out ONLY to
 * `interactive`-capable clients, after every turn end on the interactive path. Conversation-scoped like
 * RateLimitedPayload above: no `turn_id`, and receiving one neither opens nor closes a turn.
 *
 * EVERY KEY THE DAEMON WRITES IS NOW DECLARED AND PARSED. Each pair's declaration landed with its
 * parsing rather than ahead of it, a declared-but-unparsed field being a promise the decoder does not
 * keep. `parseContextUsagePayload` still returns a FRESH eleven-field literal, which is what keeps it
 * forward-compatible with a key a later daemon adds and prototype-pollution-safe against a planted
 * `__proto__`.
 *
 * EACH INVENTORY IS A PLAIN ARRAY AND NEVER `...[] | null`: the daemon's `MarshalJSON` normalises every
 * nil inventory slice to `[]` precisely so a client never has to tell the two apart, and `omitempty` is
 * deliberately out. AN EMPTY `[]` IS THE POSITIVE STATEMENT THAT CLAUDE REPORTED NO CATEGORIES, NO MCP
 * TOOLS, OR NO MEMORY FILES, which a consumer must keep distinguishable from the absence a frame that
 * never arrived yields; a `null` or an absent key is a real defect. THE ROWS ARRIVE AS A PREFIX IN THE
 * PRODUCER'S DESCENDING-TOKEN ORDER, any cut taking entries off the TAIL — so a shortened list is never
 * a list with holes, and re-sorting or de-duplicating destroys the only ordering signal a consumer gets.
 * Both rules hold PER LIST: the three are decoded independently and none is ever consulted about another.
 *
 * EACH DROPPED COUNT IS INDEPENDENT AND NOT INFERABLE, and they are the fields a reader is likeliest to
 * try to reconcile. Each accumulates TWO SEPARATE CUTS: the producer's entry and string caps, plus the
 * mapper's own frame-byte budget spent keeping the envelope under the v2 cap. So a retained list's
 * LENGTH IS NO EVIDENCE OF COMPLETENESS in either direction — the committed fixture's `3`, `5` and `7`
 * each sit beside exactly two retained rows — and `list.length + its OWN dropped count` is that
 * inventory's true size rather than something to check. A client that reads a full list as proof nothing
 * was dropped, or an empty one as proof everything was, is wrong both times. THE COUNTS ARE ALSO
 * INDEPENDENT OF EACH OTHER AND ARE NEVER CROSS-READ: the daemon divides ONE envelope across THREE lists
 * and can cut all three at once, so no count is evidence about another and none says anything about
 * another's length. `0` is a VALUE, never consulted for truthiness: the
 * key is always written, so an absent one is a defect rather than a valid zero. The producer's caps are
 * DAEMON-SIDE and may change without any change to this contract, so a client must never hardcode one,
 * treat a particular length as a signal, or re-decide a bound here.
 *
 * PROVENANCE IS MIXED WITHIN THIS ONE STRUCT, and it is the field-level fact a reader is likeliest to get
 * wrong. `conversation_id` is DAEMON-authored: the mapper fills it from the daemon's own registry record,
 * never from claude's bytes. `model` is CLAUDE-authored descriptive text. Assuming one provenance for the
 * whole payload errs in a harmful direction half the time, because it promotes `model` to a value it was
 * never checked to be. The daemon says so in those words, and the split is why this docblock names the
 * two fields separately rather than giving the type one blanket sentence.
 *
 * THE READING IS INFORMATIONAL. The daemon neither recomputes nor normalizes claude's integers, so
 * NOTHING MAY ASSUME `percentage` IS DERIVABLE from `total_tokens` and `max_tokens` — a client that
 * recomputes it disagrees with the figure claude reported, which is the whole reason this frame displaces
 * the transcript route. None of the three is range-checked in either direction: a `percentage` over 100,
 * a `total_tokens` exceeding `max_tokens`, a `max_tokens` of `0` beside a non-zero total, and a negative
 * are all representable and none is rejected. `0` is claude's reading of zero, never an absence. A
 * consumer formatting these must guard its own arithmetic — a `max_tokens` of `0` yields `Infinity`,
 * which the renderer's `contextUsagePercent` already documents — and must never allocate, iterate or
 * size anything proportional to any of them; they are unbounded daemon-supplied values, and that is
 * AttachmentChunkPayload's never-allocate-from-a-claim rule one frame over.
 *
 * SECURITY: `model`, every `name` on the two label-bearing inventories, every `server_name` and every
 * `path` and `type` are strings that crossed the SUBPROCESS TRUST BOUNDARY. The daemon
 * bounds them at construction but does NOT validate or sanitize them, so they stay untrusted
 * text all the way here: safe to render as INERT TEXT, never fed to an HTML sink
 * (`innerHTML` / `dangerouslySetInnerHTML`), an attribute, or a URL, and never used as a Map key, an
 * icon lookup, a CSS class, a lookup path or a filename — it is exactly the shape of short token that
 * invites one, the finding `limit_type` drew at #1318. `model` IS ALSO NOT AN IDENTITY:
 * `model_announced` remains the authority on which model is running, and this string is descriptive text
 * beside a token count, never a key to match a model menu against. AND `server_name` IS INERT DESPITE
 * ITS NAME: it collides with the actuation-crossing `ServerName` on the daemon's MCP reconnect payload,
 * and must never be fed to an MCP verb or joined against `mcp_status` on the strength of appearing here
 * — see ContextUsageMCPTool, which states the trap in full. **AND `path` IS NOT A FILE HANDLE**: it is
 * path-shaped descriptive text that nothing joins, cleans, resolves or opens, so it is never an `href`,
 * an `openExternal` target, a `path.join` argument or a plain-object key, and the `type` beside it is a
 * LABEL rather than a discriminant to `switch` on — see ContextUsageMemoryFile, which states both in
 * full. `conversation_id` is a daemon-asserted routing key, never an authorization signal and never
 * resolved against a filesystem.
 *
 * NOTHING DECODED REACHES A LOG: the three integers disclose how much private work is in the window, a
 * side-channel as unwelcome in a log an operator may send off-box as the correlating id beside them.
 * Each INVENTORY is a finer instance of that same side-channel and is excluded for the same reason — a
 * per-row figure discloses how the window is composed and not merely how full it is, and a list's LENGTH
 * is a weak reading of the same thing. The two later inventories add grounds of their own, in
 * ESCALATING order. A `server_name` is WORKSPACE CONFIGURATION, disclosing what the operator WIRED UP
 * rather than what claude read, so a server named after internal infrastructure must not ride into such
 * a log. A `path` goes further and is the STRONGEST ground on the frame: it discloses WHO THE USER IS
 * AND WHERE THEY WORK — the daemon's own fixture value leaks a home-directory username and a project
 * name, where every field before it disclosed only what was in the window. The exclusion is also an
 * INTEGRITY rule, since this stream is line-delimited JSON: the MCP fixture's EMBEDDED NEWLINE and the
 * newline a POSIX path may legitimately contain could each FORGE A RECORD. See #1454 (the reading),
 * #1455 (the breakdown), #1459 (the MCP-tool inventory) and #1460 (the memory-file inventory); the IPC
 * carry is #1419, the store #1420, the surfaces #1421.
 */
export interface ContextUsagePayload {
  conversation_id: string
  model: string
  // Go `int`; plain `number`s like every other integer on this wire. The no-range-check rule above
  // covers a value past Number.MAX_SAFE_INTEGER rather than a type change.
  total_tokens: number
  max_tokens: number
  percentage: number
  categories: ContextUsageCategory[]
  dropped_categories: number
  mcp_tools: ContextUsageMCPTool[]
  dropped_mcp_tools: number
  memory_files: ContextUsageMemoryFile[]
  dropped_memory_files: number
}

/**
 * ONE ROW of an `mcp_status` frame's server list (daemon → client, #1489). Mirrors the daemon's
 * `MCPServerStatus` field-for-field (SSOT pyrycode#2373, internal/protocol/interactive.go), wire order
 * `name, status, error, scope, version`. Named without the `Wire` prefix and with the acronym
 * capitalised, for ContextUsageCategory's stated reason.
 *
 * ALL FIVE KEYS ARE ALWAYS PRESENT, and a missing or zero-valued source string encodes as `''`. So `''`
 * is a VALUE on every one of them — an empty `error` is the ordinary healthy row — and an absent key is
 * a real defect rather than an empty field.
 *
 * `status` AND `scope` ARE OPEN-SET CLAIMS, NOT ENUMS AND NOT AUTHORITY. The daemon calls `status`
 * claude's open-set status text, a report rather than a state a client may treat as authority, and
 * `scope` is open the same way. A client-side closed set fail-closes a valid future frame the moment a
 * claude release adds a word, so nothing narrows either, and nothing may branch security-relevant
 * behaviour on them. `version` is OPAQUE: never semver-parsed, compared or ordered (the daemon's fixture
 * carries `2.0-beta` to stop exactly that). `error` carries a 256-byte producer cap, which is a SIZE
 * BOUND AND NOT SANITISATION.
 *
 * `name` IS THE SERVER'S IDENTITY IN THIS LIST, which is the inverse of ContextUsageMCPTool's
 * `server_name` — that one names a contributor to a reading and is inert, and its prohibition on
 * actuation does NOT carry over here. A later slice legitimately carries a `name` into `mcp_reconnect` /
 * `mcp_toggle`, where the daemon gates per device and the actuation seam is its sole validator. What
 * binds on THIS side is the client-side rule: a `name` is never a lookup key, a React `key`, a `Map`
 * index or a plain-object key (`__proto__` is an ordinary server name here), a path, a filename, a
 * cache key or a log field.
 *
 * Every string crossed the SUBPROCESS TRUST BOUNDARY and is neither validated nor sanitised upstream:
 * render it as INERT TEXT, never into an HTML sink (`innerHTML` / `dangerouslySetInnerHTML`), an
 * attribute or a URL. The daemon's fixture carries `remote<&>` and an embedded newline in `error` on
 * purpose, and both cross this decoder byte-for-byte — escaping is owed at the render sink (CLAUDE.md's
 * 2026-08-20 operator ruling). That newline is also why NO ROW STRING MAY REACH A LOG FIELD for an
 * integrity reason and not only a privacy one: the diagnostic stream is line-delimited JSON, so a
 * logged value could forge a record.
 *
 * See #1489 (this decode); the carry is #1490.
 */
export interface MCPServerStatus {
  name: string
  status: string
  error: string
  scope: string
  version: string
}

/**
 * Inbound `mcp_status` event (daemon → client, #1489): claude's MCP server list for one conversation.
 * Mirrors the daemon's MCPStatusPayload field-for-field (SSOT pyrycode#2373 shape / #2375 live producer /
 * #2381 on-demand reply, internal/protocol/interactive.go), wire order `conversation_id, servers,
 * dropped_servers`, all three ALWAYS PRESENT. `parseMCPStatusPayload` returns a FRESH three-field literal,
 * which keeps it forward-compatible with a key a later daemon adds and prototype-pollution-safe.
 *
 * `servers` IS A PLAIN ARRAY AND NEVER `null`: the daemon's `MarshalJSON` normalises a nil slice to `[]`
 * so a client never has to tell the two apart. AN EMPTY `[]` IS THE POSITIVE REPORT THAT CLAUDE HAS NO
 * SERVERS, which a consumer must keep distinguishable from the absence a frame that never arrived
 * yields; a `null` or an absent key is a real defect. The rows keep CLAUDE'S ORDER — never re-sort them.
 *
 * `dropped_servers` IS COPIED FROM THE PRODUCER, NOT INFERRED, and is never reconciled against the list:
 * `servers.length + dropped_servers` is the original size, and the retained length is no evidence of
 * completeness in either direction. `0` is a value, never consulted for truthiness. The producer's entry
 * cap is DAEMON-SIDE and not a wire constant, so a client must never hardcode one or treat a particular
 * length as a signal.
 *
 * PROVENANCE IS MIXED: `conversation_id` is DAEMON-authored — a routing key, never an authorization
 * signal — and every row string is CLAUDE-authored. See MCPServerStatus for what a row's strings may and
 * may not become. NOTHING DECODED REACHES A LOG: the row strings for MCPServerStatus's reasons, and the
 * `conversation_id` as a correlating identifier.
 */
export interface MCPStatusPayload {
  conversation_id: string
  servers: MCPServerStatus[]
  // Go `int`; a plain `number` like every other integer on this wire.
  dropped_servers: number
}

/**
 * Inbound `background_task_started` event (daemon → client). Mirrors the daemon's
 * BackgroundTaskStartedPayload field-for-field (SSOT pyrycode#1394, internal/protocol/interactive.go:177,
 * docs/protocol-mobile.md § background_task_started), wire order `conversation_id, task_id, tool_call_id,
 * description, task_type, truncated_fields` — all always present (no `omitempty`). Fanned out ONLY to
 * `interactive`-capable clients: claude started a command that OUTLIVES THE TURN THAT SPAWNED IT
 * (pyrycode#1240). This frame is what separates that case from a genuine finish — without it a `turn_end`
 * carrying `end_turn` while the command is provably still running is indistinguishable from a real one.
 *
 * NOT A TURN-STREAM ITEM. It carries NO `turn_id` and opens, closes, and alters no turn: a background
 * task's lifecycle is orthogonal to its turn's, which is the whole #1240 point. The daemon doc is
 * explicit that a client renders it "as its own thread of activity, not as part of the turn it appeared
 * in" — the same characterization `queue_state` got in #720, and the reason the emitted event KEEPS
 * `conversation_id` — daemon state keyed by id ("turn-stream item, or daemon state?", `events.ts`).
 *
 * `tool_call_id` IS THE WIRE NAME, not `tool_use_id` — the daemon's own prose reads "claude's
 * `tool_use_id`, under the name `tool_use` and `tool_result` already use for it", which invites the
 * misreading, and ToolUsePayload / ToolResultPayload above spell it `tool_use_id`, so the wrong name
 * looks locally consistent. The Go tag is `json:"tool_call_id"` and `truncated_fields` reports it under
 * that name. The VALUE is the same identifier `tool_use` / `tool_result` carry, which is what lets the
 * task store (#567) join all three background-task frames with no vocabulary lookup.
 *
 * `task_type` is an OPEN STRING (`local_bash` is the only observed value), and `truncated_fields` an
 * OPEN LIST of this frame's own wire field names. Neither may be narrowed to a client-side union: one
 * observation does not earn an enum, and a closed set would fail-close a valid future frame — the drift
 * risk CLAUDE.md / ADR 0002 rank above cosmetic robustness.
 *
 * `truncated_fields` names the fields the daemon cut to fit their caps; `null` means NOTHING WAS CUT and
 * is a distinct value from `[]`, never to be collapsed into it. It is load-bearing, not decoration — a
 * client that ignores it presents claude's cut text as complete. Every string is bounded by the daemon at
 * construction, so an oversized value never reaches this wire.
 *
 * SECURITY: `description` is the task's label, and for `task_type: local_bash` it is the LITERAL COMMAND
 * LINE claude ran. The daemon bounds it but does not sanitize it — it stays untrusted, model-influenced
 * text all the way here. Safe to render as INERT PLAIN TEXT only: never execute it, never re-shell it,
 * and never feed it to an HTML sink (`innerHTML` / `dangerouslySetInnerHTML`), an attribute, or a URL.
 * See #564 (this decode), #567 (the task store) and #568 (the panel).
 */
export interface BackgroundTaskStartedPayload {
  conversation_id: string
  task_id: string
  tool_call_id: string
  description: string
  task_type: string
  truncated_fields: string[] | null
}

/**
 * Inbound `background_task_updated` event (daemon → client). Mirrors the daemon's
 * BackgroundTaskUpdatedPayload field-for-field (SSOT pyrycode#1394, internal/protocol/interactive.go:215,
 * docs/protocol-mobile.md § background_task_updated), wire order `conversation_id, task_id, patch,
 * status, summary, truncated_fields` — none with `omitempty` on a current daemon. Fanned out ONLY to
 * `interactive`-capable clients.
 *
 * THE PEER of BackgroundTaskStartedPayload above, joined on `task_id`: that frame OPENS a task, this one
 * reports what happened to it afterwards. Six fields, but NOT the sibling's six — this frame has no
 * `tool_call_id`, no `description` and no `task_type`, and gains `patch`, `status` and `summary`.
 *
 * TWO OF CLAUDE'S LINES FILL DISJOINT HALVES of this one frame (pyrycode#2245). A MID-LIFE frame (claude's
 * `system/task_updated`) fills `patch` and leaves `status` / `summary` as `''`; a TERMINAL frame
 * (`system/task_notification`) fills `status` / `summary` and leaves `patch` as `''`. A NON-EMPTY `status`
 * is the family's only finish signal: the daemon synthesises no finish event and never diffs rosters.
 *
 * `status` IS AN OPEN STRING — claude's claim that the task ended, not the daemon's detection. Only
 * `completed` has ever been captured; the documented `failed` / `stopped` never have. Never narrow it to a
 * client-side union: that would fail-close the first real `failed` (the drift risk CLAUDE.md / ADR 0002
 * rank above cosmetic robustness). A consumer must handle a token it has not seen.
 *
 * `status` and `summary` ARE TOLERATED WHEN OMITTED, unlike every other field here (#1560). A daemon
 * predating 2026-09-10 sends neither key, and `''` is already the in-domain value every mid-life frame
 * carries, so the narrower reads an absence as `''` rather than dropping the frame (and its `patch`). The
 * decoded type is therefore always a plain `string`, never optional.
 *
 * NOT A TURN-STREAM ITEM, exactly like its sibling: no `turn_id`, and it opens, closes and alters no
 * turn — a background task's lifecycle is orthogonal to its turn's, which is the whole #1240 point. Hence
 * the emitted event KEEPS `conversation_id` — daemon state keyed by id ("turn-stream item, or
 * daemon state?", `events.ts`).
 *
 * `patch` IS AN OPAQUE STRING. Do not type it as JSON, do not parse it, do not enumerate its keys:
 *
 *   1. IT PROVABLY MAY NOT PARSE. The daemon truncates it at construction (`maxTaskPatch = 4 << 10`,
 *      internal/streamsup/parser.go) and a truncated object is no longer valid JSON. The Go field is a
 *      plain `string`, NOT `json.RawMessage`, for exactly this reason — typing it as structured JSON on
 *      this wire would be a lie that broke decoding. The daemon's own golden fixture ships
 *      `{"is_backgrounded":tr`, cut mid-token.
 *   2. ENUMERATING KEYS SILENTLY DISCARDS CLAUDE'S NEXT ONE. The daemon deliberately enumerates none,
 *      because a mapping that listed the keys it knew would drop every key claude ships next
 *      (`is_backgrounded` is the one key observed so far). A client must do the same: read the keys it
 *      understands, pass the rest through or ignore it. Any consumer that later wants those keys parses
 *      BEHIND AN ERROR BRANCH that falls back to rendering it as text — #567 / #568's problem, not the
 *      decode's.
 *   3. IT IS UNTRUSTED TEXT. See the SECURITY note below.
 *
 * An EMPTY `patch` is a VALUE, not an absence: the daemon documents it as "empty when claude sent none",
 * and the field has no `omitempty`, so `''` is carried as `''` while an omitted key fails closed.
 *
 * `truncated_fields` names the fields the daemon cut to fit their caps — for THIS frame `task_id` /
 * `patch` / `status` / `summary`, a DIFFERENT set from the sibling's, which is itself the argument against
 * ever narrowing the element vocabulary to a client-side union (a closed set would fail-close a valid future frame — the
 * drift risk CLAUDE.md / ADR 0002 rank above cosmetic robustness). `null` means NOTHING WAS CUT and is a
 * distinct value from `[]`, never to be collapsed into it.
 *
 * DO NOT RECONCILE `patch` AGAINST `truncated_fields`. The daemon also scrubs invalid UTF-8 from `patch`
 * by DELETING the offending bytes, while `truncated_fields` reports the cap cut ONLY — so `patch` can
 * differ from claude's bytes without appearing there. A stated upstream limitation; a client cannot act
 * differently either way, so no cross-check is warranted.
 *
 * SECURITY: a `patch` key may carry command text exactly as the sibling's `description` does. The daemon
 * bounds and UTF-8-scrubs it but does not sanitize its content — it stays untrusted, model-influenced
 * text all the way here. Safe to render as INERT PLAIN TEXT only: never execute it, never re-shell it,
 * and never feed it to an HTML sink (`innerHTML` / `dangerouslySetInnerHTML`), an attribute, or a URL.
 * The daemon doc states this rule in THIS frame's section rather than delegating it to the sibling,
 * because a patch's structured shape makes it the more tempting thing to feed somewhere that runs it.
 * See #565 (this decode), #567 (the task store) and #568 (the panel).
 *
 * SECURITY: `summary` is MODEL-AUTHORED FREE TEXT and, in the one captured terminal frame, it IS the
 * task's command line — the family's second field of that class after the sibling's `description`. Unlike
 * `patch` it is prose a client will actually render, so it reaches a template by the normal path. The
 * daemon caps it at construction (`maxTaskSummary`) and names a cut in `truncated_fields`; the frame-level
 * MAX_PLAINTEXT_BYTES guard is the only client bound. Render `summary` and `status` as INERT PLAIN TEXT
 * only: never execute or re-shell them, never feed them to an HTML sink, an attribute, a URL, a filename,
 * a cache key or a log. The decode logs neither (#1560).
 */
export interface BackgroundTaskUpdatedPayload {
  conversation_id: string
  task_id: string
  patch: string
  /** Terminal state claude reported; '' on a mid-life frame (or from a pre-#2245 daemon). Open string. */
  status: string
  /** claude's account of the finished task; '' on a mid-life frame. Untrusted free text, never logged. */
  summary: string
  truncated_fields: string[] | null
}

/**
 * Inbound `background_task_progress` event (daemon → client, #1638). Mirrors the daemon's
 * BackgroundTaskProgressPayload field-for-field (SSOT pyrycode#2246, internal/protocol/interactive.go,
 * docs/protocol-mobile.md § background_task_progress), wire order `conversation_id, task_id,
 * description, subagent_type, last_tool_name, total_tokens, tool_uses, duration_ms, truncated_fields` —
 * all always present (no `omitempty`). Fanned out ONLY to `interactive`-capable clients. Joined to its
 * three siblings on `task_id`; no `turn_id`, and it opens and closes no turn.
 *
 * `description` IS THE TASK'S CURRENT ACTIVITY ("Reading alpha.txt"), NOT its opening description,
 * which BackgroundTaskStartedPayload carries under the same wire name. The wire keeps the daemon's name;
 * the emitted daemon event renames it `currentActivity` so the two are never joined.
 *
 * The three counters are claude's own readings, CUMULATIVE PER TASK and NOT GUARANTEED MONOTONIC. The
 * daemon accumulates and computes nothing, and neither does this client: each is carried as received,
 * with no range or monotonicity check. Summing two frames double-counts; a diff may be negative. The
 * frames are rate-bounded per task, so they do not enumerate claude's lines, and ABSENCE PROVES
 * NOTHING (a task past the daemon's concurrent-task cap gets no progress frames at all).
 *
 * There is deliberately NO `summary`, NO `patch` and NO `ambient` on this frame. `truncated_fields` names
 * the cut string fields (`task_id` / `description` / `subagent_type` / `last_tool_name`); `null` means
 * NOTHING WAS CUT and is distinct from `[]`. Its element vocabulary stays open.
 *
 * SECURITY: `description`, `subagent_type` and `last_tool_name` are model- and tool-authored text, and
 * the current activity NAMES A FILE on the operator's host in every captured frame. They arrive
 * repeatedly for one row, the shape most likely to be bound straight into a template. Render them as
 * INERT PLAIN TEXT only: never parse them, never execute or re-shell them, and never feed them to an
 * HTML sink (`innerHTML` / `dangerouslySetInnerHTML`), an attribute, a URL, a filename, a path, a cache
 * key or a log. See #1638 (this decode) and #1640 (the store and the render).
 */
export interface BackgroundTaskProgressPayload {
  conversation_id: string
  task_id: string
  /** The task's CURRENT ACTIVITY — not the opening description. Untrusted text; may name a file. */
  description: string
  subagent_type: string
  last_tool_name: string
  // Go `int`s; plain `number`s like every other integer on this wire. Cumulative, not monotonic.
  total_tokens: number
  tool_uses: number
  duration_ms: number
  truncated_fields: string[] | null
}

/**
 * ONE ROW of a BackgroundTaskRosterPayload (daemon → client). Mirrors the daemon's BackgroundTask
 * field-for-field (SSOT pyrycode#1394, internal/protocol/interactive.go:313, docs/protocol-mobile.md
 * § background_task_roster), wire order `task_id, task_type, description, truncated_fields` — all always
 * present (no `omitempty` on any of them).
 *
 * FOUR FIELDS, AND THEY ARE NOT THE SCALAR SIBLINGS' FOUR. There is deliberately NO `tool_call_id` and
 * NO `patch`: the daemon's comment is explicit that those ride the scalar frames because their LINES do,
 * and claude's roster line carries only these four. A row type cloned from BackgroundTaskStartedPayload
 * would require `tool_call_id` and fail-close every valid roster. `task_id` is the join key back to the
 * `background_task_started` that opened the task — the same identifier all three frames carry.
 *
 * `task_type` is an OPEN string. `local_bash` is the only observed value and one observation does not
 * earn an enum; a closed set would fail-close a valid future frame (the drift risk CLAUDE.md / ADR 0002
 * rank above cosmetic robustness).
 *
 * `truncated_fields` names THIS ROW'S OWN cut fields (`task_id` / `task_type` / `description`) — a THIRD
 * distinct set from #564's and #565's, which is itself the argument against ever narrowing the element
 * vocabulary. Each row reports its own: there is no hoisted or flattened list anywhere on this frame.
 * `null` means NOTHING WAS CUT for this row and is a distinct value from `[]`, never to be collapsed
 * into it. Note the contrast with the parent's `tasks`, which is never nullable — see
 * BackgroundTaskRosterPayload.
 *
 * SECURITY: `description` carries the SAME LITERAL COMMAND LINE as
 * BackgroundTaskStartedPayload.description, under a TIGHTER producer cap — here it is one label in a
 * list whose length claude chooses, and the full-length copy already crossed the wire on the
 * `background_task_started` this row joins back to. Untrusted, model-influenced text: render as INERT
 * PLAIN TEXT ONLY — never execute it, never re-shell it, and never feed it to an HTML sink (`innerHTML`
 * / `dangerouslySetInnerHTML`), an attribute, or a URL. The daemon repeats this rule PER ROW rather than
 * delegating it to the sibling's section, and its stated reason is worth carrying: A LIST OF COMMAND
 * LINES IS A MORE TEMPTING SHAPE TO FEED SOMEWHERE STRUCTURED THAN A SINGLE ONE. The temptation unique
 * to this frame is treating the array as a structured WORK LIST rather than a display list. See #566
 * (this decode), #567 (the task store) and #568 (the panel).
 */
export interface BackgroundTask {
  task_id: string
  task_type: string
  description: string
  truncated_fields: string[] | null
}

/**
 * Inbound `background_task_roster` event (daemon → client). Mirrors the daemon's
 * BackgroundTaskRosterPayload field-for-field (SSOT pyrycode#1394, internal/protocol/interactive.go:242,
 * docs/protocol-mobile.md § background_task_roster), wire order `conversation_id, tasks, dropped_tasks`
 * — all always present (no `omitempty`). Fanned out ONLY to `interactive`-capable clients.
 *
 * THE AGGREGATE PEER of the two scalar frames above: they report what happened to ONE task, this reports
 * WHAT IS ALIVE. It is a SNAPSHOT, NOT A DELTA — each frame replaces the reader's view of what is
 * running, never amends it. The frame is named for its trigger, the daemon's own naming, not claude's.
 *
 * `tasks` IS A PLAIN ARRAY AND NEVER `BackgroundTask[] | null`, and that is the daemon's deliberate
 * contract rather than a client assumption. This payload carries interactive.go's ONLY custom
 * `MarshalJSON` (`:274`), whose entire job is normalising a nil `Tasks` to `[]` so an empty roster never
 * serialises as `null`; `omitempty` is deliberately out, because eliding the key would erase the frame's
 * whole point. AN EMPTY `[]` IS A POSITIVE STATEMENT THAT NOTHING IS ALIVE — the reassurance that a turn
 * really is finished (pyrycode#1240's symptom), not an absence of information. A client decoding into a
 * non-optional array type therefore never has to branch on `null`.
 *
 * THE TRAP, stated here so a reader meets both contracts at once: within THIS ONE PAYLOAD, `tasks: null`
 * FAILS CLOSED while a row's `truncated_fields: null` is a VALID VALUE. They look like the same shape and
 * are not. The daemon's marshaller normalises the first and deliberately does NOT normalise the second,
 * because nil and `[]` say the identical thing for `truncated_fields` while `tasks` is the frame's
 * subject and its empty value is the signal.
 *
 * `dropped_tasks` IS THIS FRAME'S ONLY TRUNCATION REPORT. There is deliberately no top-level
 * `truncated_fields` here, so a reader grepping for that name finds nothing and would silently believe a
 * capped roster is the whole roster: THE ROSTER'S TRUE SIZE IS `tasks.length + dropped_tasks`. A COUNT is
 * carried rather than a name because a name-only report loses HOW MANY were lost; per-row text cuts are a
 * property of one row and ride that row's own `truncated_fields`. `dropped_tasks: 0` is a VALUE, never
 * consulted for truthiness — and the absence of `omitempty` is what makes a plain number decode correct,
 * since the key is always written and an absent key is a real defect rather than a valid zero.
 *
 * NOT A TURN-STREAM ITEM, exactly like both siblings: no `turn_id`, and it opens and closes no turn.
 * Hence the emitted event KEEPS `conversation_id` — daemon state keyed by id ("turn-stream item,
 * or daemon state?", `events.ts`).
 *
 * NO TERMINAL / FINISH EVENT EXISTS IN THIS FAMILY, BY DESIGN. A task's disappearance from a later roster
 * is the available finish signal, but the daemon does not report a finish it cannot detect. "Finished" is
 * therefore a CLIENT conclusion drawn from absence, never something the wire reports — legitimate for the
 * task store (#567) to draw on its own terms, and emphatically not this decode's to draw.
 *
 * SECURITY: every row's `description` is untrusted, model-influenced text and for `task_type: local_bash`
 * is the literal command line claude ran — see BackgroundTask above for the per-row rule and the daemon's
 * reason for stating it per row. See #566 (this decode), #567 (the task store) and #568 (the panel).
 */
export interface BackgroundTaskRosterPayload {
  conversation_id: string
  tasks: BackgroundTask[]
  dropped_tasks: number
}

/**
 * The reason a daemon session rotated, on the wire. Mirrors WireTurnState / MessagePayload.role: a plain
 * daemon-side string over a closed set (no named enum), closed to the three SSOT #656 values. The producer
 * (pyrycode/pyrycode#657) emits only `clear` / `idle_evict` today; `workspace_change` is kept in the closed
 * set anyway so the wire contract stays fully expressible (a consumer enum may admit a value the producer
 * cannot yet emit — SSOT #656). A future fourth reason would fail closed here (the frame drops) until this
 * decoder is widened — the correct no-drift posture for a wire enum.
 */
/**
 * Inbound `unrecognized_message` diagnostic (daemon → client). Mirrors the daemon's
 * UnrecognizedMessagePayload field-for-field, wire order `conversation_id, site, message_type, raw,
 * truncated` — all always present (no `omitempty`).
 *
 * WHAT IT IS. The daemon's stream parser maps a fixed set of top-level message types from claude and a
 * fixed set of content blocks. Anything outside a MEASURED known-ignored list used to be dropped into a
 * debug log the production daemon does not print, so a claude version that moved something meaningful
 * into a new message type would show nothing, anywhere, with nothing saying why. This frame is that
 * drop, made visible. It is deliberately NOT emitted for `system/*` or `rate_limit_event`, which would
 * otherwise put a row on every turn.
 *
 * WHAT THE DAEMON FORWARDS TODAY. The two reach that unreachability by DIFFERENT routes, and the
 * distinction is the daemon's own. `system` is the single member of its `ignoredLineTypes` map, so
 * `consumeLine`'s `default` returns before `emitUnrecognized` for a system line whatever its subtype —
 * a guarantee held BY LIST MEMBERSHIP, and the reason keeping `system` whole on that list is what makes
 * the unrecognized lane structurally unreachable from any of them. `rate_limit_event` is not on the
 * list at all; it has an arm of its own, so its unreachability holds BY MATCHING, which the daemon
 * documents as the stronger of the two. Either way, unreachable here is the whole of what "the daemon
 * ignores these" still means — it does NOT mean the lines go nowhere. Measured 2026-09-07 against
 * pyrycode `internal/streamsup/parser.go` (`consumeLine`, `emitSystemSubtype`, `emitRateLimit`); do not
 * size work against the 2026-07-27 census the older wording came from:
 *
 *   - Five `system` subtypes MAP to frames. `task_started`, `task_updated` and
 *     `background_tasks_changed` become `background_task_started` / `background_task_updated` /
 *     `background_task_roster`; `thinking_tokens` becomes `thinking_progress` when its reported delta
 *     is positive AND reaches the daemon's coalescing floor, so it is not a frame per line (a
 *     non-positive delta is dropped, a below-floor one accumulates into the next); `init` becomes
 *     `model_announced` carrying the model and nothing else (a model-less `init` is consumed silently).
 *     Every other subtype, `status` among them, is still dropped silently.
 *   - Top-level `rate_limit_event` MAPS to `rate_limited` for every reading whose status is not
 *     `allowed`. An `allowed`, statusless, or undecodable one is dropped silently.
 *   - `conversation_reset`, `tool_progress` and `control_response` have arms of their own. The first two
 *     are MATCHERS — a frame they cannot consume falls through and still emits this diagnostic — while
 *     the third consumes unconditionally. `tool_progress` is SUPPRESSION, not mapping: consumed, and
 *     mapped to no frame at all.
 *
 * WHAT THIS CLIENT DECODES of the six frames above: all six. `background_task_started` / `_updated` /
 * `_roster` and `model_announced` have arms in `parseInboundMessage`, joined by `thinking_progress` at
 * #1312 and `rate_limited` at #1318. None of the six reaches that `default` any more, so none is logged
 * `inbound-unmodeled`; each writes one content-free `inbound-decoded` record under a client-owned type
 * literal instead. Decoded is not the same as CONSUMED — the last two arms ship dormant until their
 * carry slices claim them.
 *
 * NOT a claude sub-state, the contrast with its `stall` / `api_retry` / `compacting` neighbours: those
 * report what claude is doing, this reports a gap in the daemon's own mapping. It is conversation-level
 * (no `turn_id` — the daemon could not parse the message well enough to attribute a turn to it), and
 * receiving it never opens, closes, or alters a turn.
 *
 * `raw` IS THE RENDER PAYLOAD, and it is the only interactive frame carrying unbounded model-adjacent
 * JSON. It is a plain string, NOT parsed JSON, because the daemon truncates it at 16 KiB and a truncated
 * blob is no longer valid JSON — `truncated` says whether that happened. That cap is roughly a quarter of
 * MAX_PLAINTEXT_BYTES (65519), so the frame guard is a backstop here rather than the live constraint.
 * Treat `raw` as the most untrusted string on this wire: it must be rendered as PLAIN TEXT only, never
 * through an HTML sink (`innerHTML` / `dangerouslySetInnerHTML`), an attribute, or a URL.
 */
export interface UnrecognizedMessagePayload {
  conversation_id: string
  site: WireUnrecognizedSite
  message_type: string
  raw: string
  truncated: boolean
}

export type WireSessionTransitionReason = 'clear' | 'idle_evict' | 'workspace_change'

/**
 * The places the daemon's stream parser can meet agent output it has no mapping for. A closed
 * wire enum like WireSessionTransitionReason, so the decoder compares against literals rather than
 * accepting any string. `line_type` is a whole top-level message; `assistant_block` / `user_block` are
 * one content block of an otherwise-fine message; `undecodable` is a line or block that would not
 * JSON-decode at all, and is the one value for which `message_type` is empty (nothing decoded, so no
 * type was ever read). `codex_method` is an unmapped Codex notification (such as `error` or `warning`)
 * and `codex_item` an unmapped Codex item (such as a web search).
 */
export type WireUnrecognizedSite =
  | 'line_type'
  | 'assistant_block'
  | 'user_block'
  | 'undecodable'
  | 'codex_method'
  | 'codex_item'

/**
 * Inbound `session_transition` marker (daemon → client). Mirrors the daemon's SessionTransitionPayload
 * field-for-field (pyrycode/pyrycode#656, internal/protocol/messaging.go), wire order
 * `conversation_id, previous_session_id, new_session_id, reason, occurred_at, workspace_cwd` — all
 * always present (no `omitempty`). A session-boundary event the daemon emits when a conversation's session
 * rotates (a `/clear`, an idle eviction, a workspace change); it carries `new_session_id`, the addressing
 * key a client needs to change per-session settings (model / effort / YOLO).
 *
 * `conversation_id` is the marker's ROUTING KEY, and it has been on the wire since upstream #740/#741
 * (merged 2026-06-23): the daemon resolves the owning conversation from `NewSessionID` once per
 * transition and stamps it before marshalling, and an unresolvable binding DROPS the whole event rather
 * than emitting a guessed or empty key. So a conforming daemon never sends this payload without one, and
 * the decoder requires it (#1192). This port previously asserted the opposite — that a session boundary
 * was attributed by the connection it arrives on — which was true of the port, never of the daemon; the
 * marker is unsolicited, so this key is the ONLY thing that says which chat it describes.
 *
 * `reason` is a plain wire string like `MessagePayload.role`, closed to the
 * three WireSessionTransitionReason values. `occurred_at` is RFC3339Nano (a plain string on the wire; the
 * decoder requires a string but does not parse the timestamp). `workspace_cwd` is `string | null` (the
 * `ConversationSummary.name` valid-`null` idiom): the new workspace dir, non-null iff
 * `reason == workspace_change`, literal `null` for `clear` / `idle_evict`. Interactive-capability gated
 * (#179). See #254.
 */
export interface SessionTransitionPayload {
  conversation_id: string
  previous_session_id: string
  new_session_id: string
  reason: WireSessionTransitionReason
  occurred_at: string
  workspace_cwd: string | null
}

/** Live reading for an existing call; mirrors the upstream ToolProgressPayload. */
export interface ToolProgressPayload {
  conversation_id: string
  turn_id: string
  tool_use_id: string
  elapsed_seconds: number
}

/**
 * Inbound `tool_use` event (daemon → client). Mirrors the daemon's ToolUsePayload field-for-field
 * (pyrycode #607 / ADR 025, protocol-mobile.md), wire order `conversation_id, turn_id, tool_use_id,
 * name, input_summary` — all always present (no `omitempty`), all plain strings (no enum, unlike
 * `turn_state`). The tool-call enrichment of the v2 interactive stream (ADR 0008): a durable, ordered
 * timeline item (a `toolCall`), NOT a coarse scalar. `name` and `input_summary` are untrusted
 * daemon-supplied strings carried as opaque display text (like `stop_reason` #199, `cwd` #139) —
 * decoded, never interpreted. `input_summary` is the daemon's human-readable précis of the tool input,
 * NOT the raw input (pyrycode `internal/turnbridge`), carried verbatim and never re-summarized. The
 * render slice (#218) must render both as plain text, never HTML. See #217.
 *
 * `input` is a SIXTH field (pyrycode#1678, merged as pyrycode PR #1682): the tool's own input fields
 * as name → value, so a client can list what a tool is acting on instead of only the `input_summary`
 * précis. The contract this comment carries to the store slice (#643) and the render slice (#645):
 *
 * - The values are DISPLAY STRINGS, NOT CAPABILITIES — model-authored text that crossed the subprocess
 *   trust boundary, which the daemon neither resolved nor validated. A `file_path` is not canonicalised
 *   and may be relative or traversing; a `Bash` `command` is a literal shell command line. Never
 *   resolve, open, fetch, or execute anything derived from a value, and never let one become a path, a
 *   filename, a cache key, or a lookup path. The field NAMES are daemon-chosen too — an MCP tool can
 *   name a field anything — so they are as untrusted as the values.
 * - OPTIONAL TO THE CLIENT, not optional on the wire. The Go field carries no `omitempty` and a custom
 *   MarshalJSON normalises a nil map to `{}`, so a post-#1678 daemon ALWAYS writes the key and never
 *   `null`, emitting `{}` alike for an absent, empty, or non-object input. An absent key means a
 *   PRE-#1678 daemon — the everyday case while daemon and client are built days apart. An empty map is
 *   therefore distinguishable from an absent one and must never be collapsed into it.
 * - KEY ORDER IS ALPHABETICAL AND MEANINGLESS (a Go map-marshalling artefact, not the tool's argument
 *   order). Display order is the client's choice.
 * - THE MAP MAY BE INCOMPLETE: the daemon's bounds (4000 runes per value; 8500 runes of keys plus
 *   values across at most 16 fields) drop fields and name none of them. `input_summary` stays the
 *   whole-input fallback. A value the daemon shortened ends in `…`, indistinguishable from one that
 *   legitimately ends in `…` — carried verbatim, never stripped, never detected here.
 * - The three reserved keys `__proto__`, `constructor` and `prototype` are DROPPED by the decoder and
 *   can never appear in this map. Consumers must ITERATE (`Object.entries`), never probe by key: the
 *   container has an ordinary prototype, so `map['toString']` returns an inherited function, not data.
 * - Like `name` / `input_summary`, every key and value is plain text for the render slice — never HTML.
 *
 * See #642.
 */
export interface ToolUsePayload {
  conversation_id: string
  turn_id: string
  tool_use_id: string
  parent_tool_use_id?: string
  name: string
  input_summary: string
  input?: Record<string, string>
}

/**
 * Inbound `tool_result` event (daemon → client). Mirrors the daemon's ToolResultPayload field-for-field
 * (pyrycode #607 / ADR 025, protocol-mobile.md), wire order `conversation_id, turn_id, tool_use_id,
 * is_error, result_summary, result_detail` — all written by a current daemon (no `omitempty` on any of
 * them; only `result_detail` is optional HERE, and only because an older daemon predates it). The outcome
 * half of the tool-call enrichment on the v2 interactive stream (ADR 0008): it resolves an existing
 * `toolCall` timeline item in place, correlated by `tool_use_id`, NOT a new row. `is_error` is a required
 * boolean whose `false` is a value (success), never an absence (the `yolo` #180 convention) — the daemon
 * pins `is_error: false` exactly (no `omitempty`). `result_summary` is an untrusted daemon-supplied string
 * carried as opaque display text (like `input_summary` #217, `stop_reason` #199, `cwd` #139) — decoded,
 * never interpreted; its DOM sink is the render slice (#230), which must render it as plain text, never
 * HTML. `tool_use_id` is the correlation key. See #229.
 *
 * `result_detail` (#773, daemon-side pyrycode#2024) is the OPTIONAL sixth field: a short précis of the
 * call's STRUCTURED outcome — `"265 lines"`, `"110 of 1676 lines"` — composed by the daemon from the
 * `tool_use_result` sidecar. The unit words are carried on purpose, because a client cannot tell a read
 * from a search without switching on a tool name; nothing on this path may parse, trim, or extract a
 * number from it. Optional to the CLIENT, not on the wire (the `ToolUsePayload.input` #642 precedent):
 * the Go field has no `omitempty`, so a current daemon always writes the key — absence means a build
 * predating pyrycode#2024, and requiring it would fail-close every frame from one.
 *
 * Absence and `""` MEAN THE SAME THING (no count — the answer for most tools, for every failed call,
 * and for every sidecar shape the daemon does not recognise), per the upstream declaration's own
 * comment. They are nonetheless carried DISTINCTLY the whole way to the timeline item, because
 * collapsing is a lossy transform that buys nothing; the decision that both draw nothing belongs to the
 * row (#856), not to any stage of the carry.
 *
 * Its provenance differs from `result_summary` — that is claude's own text under a rune cap, while this
 * contains no claude-supplied byte (its producer formats decoded integers). That describes an HONEST
 * producer, not a wire guarantee: a hostile daemon, or a peer impersonating one inside the session,
 * controls these bytes. So it is neither trusted nor alphabet-validated here (a client-invented rule
 * would fail-close a valid future frame, ADR 0002) — it is narrowed to a string and carried, exactly
 * like `result_summary`, and its only sink is auto-escaped React children.
 */
export interface ToolResultPayload {
  conversation_id: string
  turn_id: string
  tool_use_id: string
  parent_tool_use_id?: string
  is_error: boolean
  result_summary: string
  result_detail?: string
}

/**
 * One entry of a queued-backlog snapshot (daemon → client). Mirrors the daemon's queue-item struct
 * field-for-field (SSOT pyrycode #720, docs/protocol-mobile.md § Queue), wire order
 * `queued_msg_id, text, ts` — all always present (no `omitempty`). Array position in
 * `QueueStatePayload.queued` IS the enqueue order. `queued_msg_id` is a plain per-conversation
 * counter (an integer ≥ 1) and decodes as a NUMBER, never a string (the daemon guarantees the range;
 * the decoder narrows the type but does not police it). `text` is UNTRUSTED, client-originated transit
 * content, relayed by a content-blind relay — carried as opaque display text, decoded but never
 * interpreted; the eventual render slice (#294) must render it as plain text, never HTML. `ts` is the
 * enqueue time (RFC3339), a plain wire string the decoder requires but does not parse. See #292.
 *
 * #1213 / pyrycode#2092: `message_id` names the `send_message` that produced this item — the id the
 * ORIGINATING CLIENT minted, relayed byte-for-byte and never authored by the daemon. It is the correlation
 * key between a queued row and the sending window's own optimistic timeline echo, which is what lets a drop
 * take both out. OPTIONAL on this type even though the daemon ships it non-`omitempty`, because that is the
 * DAEMON's struct: a pre-#2092 daemon's snapshot must still decode rather than failing the whole backlog
 * closed. So absence is a VALUE here — the `result_detail` / `last_seen_ts` posture — and so is `''`; both
 * mean "correlates with nothing", and a drop keyed on either removes no echo rather than the wrong one.
 *
 * UNTRUSTED on exactly the terms `text` is, and for the same reason: it arrives from another client through
 * a content-blind relay. It is read for strict string EQUALITY only — never a lookup path, a cache key, a
 * filename, a URL, a Map key or a React key (the row key is `queued_msg_id`) — and it is never rendered and
 * never logged. A consumer needing any of those mints its own key rather than widening this one.
 */
export interface QueuedItem {
  queued_msg_id: number
  text: string
  ts: string
  message_id?: string
}

/**
 * Inbound `queue_state` event (daemon → client). Mirrors the daemon's queue-snapshot struct
 * field-for-field (SSOT pyrycode #720, docs/protocol-mobile.md § Queue), wire order
 * `conversation_id, queued` — both always present. An UNSOLICITED snapshot the daemon emits whenever
 * the per-conversation backlog changes (not a reply to any request): `queue_state` is daemon STATE,
 * not part of claude's turn stream, so it gets its own daemon event and is NOT folded into the
 * thread-timeline reducer (#720's "queue backlog is state, not turn-stream" decision). `queued` is
 * ALWAYS present and enqueue-ordered — an empty backlog is `[]` (never omitted, never null); it is a
 * REPLACEMENT-truth snapshot (the whole current backlog), not a delta. Where the backlog is held is
 * the next slice's decision (#293). See #292.
 */
export interface QueueStatePayload {
  conversation_id: string
  queued: QueuedItem[]
}

/**
 * Outbound `dequeue_message` payload (client → daemon). Mirrors the daemon SSOT (pyrycode #720,
 * docs/protocol-mobile.md § Queue) field-for-field, wire order `conversation_id, queued_msg_id` —
 * both always present (no `omitempty`). Drops one queued-but-not-yet-run message from a
 * conversation's backlog, driving the daemon's `msgqueue.Remove`.
 *
 * This is an UNGATED control frame — it carries NO nonce and NO answer token (contrast
 * `ModalAnswerPayload`, which carries `answer_token`). Any paired client may drop a queued message
 * (project security model #720). `queued_msg_id` is SYMMETRIC with the inbound
 * `QueuedItem.queued_msg_id`: a plain per-conversation integer (a JSON number, never a string) that
 * selects the entry to remove. The builder does not police its range — an out-of-range id is a
 * daemon-side no-op, exactly as the inbound decoder narrows the type but does not police it. See #292.
 */
export interface DequeueMessagePayload {
  conversation_id: string
  queued_msg_id: number
}

/**
 * Outbound `interrupt` payload (client → daemon). Mirrors the daemon SSOT (pyrycode#2103,
 * docs/protocol-mobile.md § Interrupt (v2)) field-for-field: ONE field and nothing else. Asks the
 * daemon to stop the running turn in the conversation it names — the remote equivalent of pressing
 * Esc at the local terminal, mapped to the neutral `turnevent.Cancel` and routed to that
 * conversation's bound runner.
 *
 * UNGATED BY TOKEN and carrying NO nonce, answer token, idempotency key or correlation key: the frame
 * is fire-and-forget with no reply at all, and the daemon documents a replay as harmless (it simply
 * stops the turn again, and an interrupt with no running turn is a no-op), so there is nothing to
 * dedup and nothing to correlate. The daemon's `interactive` capability gate is the only gate, and it
 * is daemon-side — naming a conversation is not a way around it.
 *
 * `conversation_id` IS OPTIONAL BECAUSE THE DAEMON PUBLISHES IT SO, NOT BECAUSE THIS CLIENT OMITS IT.
 * The frame carried no payload at all from pyrycode#707 until #2103, so upstream keeps the absent form
 * meaningful as a compatibility promise: no payload, `{}`, an absent id and an explicitly EMPTY one
 * are ONE wire meaning — stop the turn in whichever conversation the daemon's process-wide
 * follow-active cursor points at, a cursor only a routed `send_message` stamps and every connection
 * shares.
 *
 * THIS APP NEVER SENDS THAT FORM, and the asymmetry is deliberate rather than a mismatch to reconcile.
 * The protocol's own rule is that a client which CAN name a conversation must always name one, and
 * this one always can: the sidebar makes switching chats without sending the ordinary path, so the
 * cursor points at the last chat ANY client messaged rather than at the one on screen — Stop pressed
 * on chat B stopped chat A's turn, the defect #1092 closes. So the id is REQUIRED on
 * `InterruptCommandPayload` (a `Required` derivative of this interface) and on `InterruptInput`, and
 * `isInterruptPayload` refuses `''`. Do NOT tighten it HERE to match them: this interface answers to
 * the daemon, and narrowing it would be a wire drift (CLAUDE.md no-drift). `types.test.ts` pins the
 * optionality.
 *
 * WHERE THIS DIVERGES FROM ITS `new_session` TWIN, and it is one state only: a conversation whose
 * child is not running is a NO-OP here rather than a refusal — the daemon attempts the stop, the write
 * finds no live child, and nothing happens. There is nothing to protect, because an interrupt mutates
 * no state before it discovers the child is gone, so the named and bare paths agree on that state
 * where `new_session` refuses the named form and rotates the bare one.
 *
 * The id is a REGISTRY-VALIDATED LOOKUP KEY, never authorization and never a path component — the rule
 * this protocol already publishes for `request_attachment`, `attachment_chunk` and `new_session`.
 * Naming a conversation is not a widening of trust: a device could already route a message to any
 * conversation to move the cursor there and then send the bare frame, so what the field removes is a
 * two-frame dance only a BENIGN client was unable to perform. A named id the daemon cannot act on (not
 * canonical, not hosted, no bound session) is SILENTLY INERT — no stop, no reply, and never a
 * fall-through to another conversation, so the frame answers no question about which conversation ids
 * exist. The observable effect, when there is one, is the existing `turn_end` marker
 * (`stop_reason: cancelled`) for that conversation.
 */
export interface InterruptPayload {
  conversation_id?: string
}

/**
 * Outbound `new_session` payload (client → daemon). Mirrors the daemon SSOT (pyrycode#2099,
 * docs/protocol-mobile.md § New session (v2)) field-for-field: ONE field and nothing else. Asks the
 * daemon to kill claude and spawn a fresh one under a newly minted session id — on the stream path a
 * kill and respawn, NOT the `/clear` keystroke the terminal-era framing described, and not a `/clear`
 * sent as ordinary message text (that clears context in place and the process keeps its loaded
 * instructions, tool servers and spawn settings; this discards all of it, so every stored setting
 * re-applies at the spawn). Since #1496 this payload is what the app's one Reset-session action puts on
 * the wire; a typed `/clear` is a `send_message` and never becomes one of these.
 *
 * UNGATED BY TOKEN and carrying NO nonce, answer token, idempotency key or correlation key: the frame
 * is fire-and-forget with no reply at all, and the daemon documents a replay as harmless (it simply
 * starts another fresh session), so there is nothing to dedup and nothing to correlate. The daemon's
 * `interactive` capability gate is the only gate, and it is daemon-side.
 *
 * `conversation_id` IS OPTIONAL BECAUSE THE DAEMON PUBLISHES IT SO, NOT BECAUSE THIS CLIENT OMITS IT.
 * The frame carried no payload at all from pyrycode#831 until #2099, so upstream keeps the absent form
 * meaningful as a compatibility promise: no payload, `{}`, an absent id and an explicitly EMPTY one
 * are ONE wire meaning — restart whichever conversation the daemon's process-wide follow-active cursor
 * points at, a cursor only a routed `send_message` stamps and every connection shares.
 *
 * THIS APP NEVER SENDS THAT FORM, and the asymmetry is deliberate rather than a mismatch to reconcile.
 * The protocol's own rule is that a client which CAN name a conversation must always name one, because
 * another device's send can move the cursor between the operator's button press and the restart —
 * opening chat B and restarting before sending anything to B killed chat A mid-work, the defect #2099
 * closed. So the id is REQUIRED on `NewSessionCommandPayload` (a `Required` derivative of this
 * interface) and on `NewSessionInput`, and `isNewSessionPayload` refuses `''`. Do NOT tighten it HERE
 * to match them: this interface answers to the daemon, and narrowing it would be a wire drift
 * (CLAUDE.md no-drift). `types.test.ts` pins the optionality.
 *
 * The id is a REGISTRY-VALIDATED LOOKUP KEY, never authorization and never a path component — the rule
 * this protocol already publishes for `request_attachment` and `attachment_chunk`. Naming a
 * conversation is not a widening of trust: a device could already route a message to any conversation
 * to move the cursor there and then send the bare frame. A named id the daemon cannot act on (not
 * canonical, not hosted, no bound session, no live child) is SILENTLY INERT — no restart, no reply,
 * and never a fall-through to another conversation, so the frame answers no question about which
 * conversation ids exist. The observable effect, when there is one, is the existing
 * `session_transition` marker, which carries the NAMED conversation's id and reaches every interactive
 * connection.
 */
export interface NewSessionPayload {
  conversation_id?: string
}

/**
 * The modal class on the wire. A plain daemon-side string over a closed set exactly like
 * `MessagePayload.role` / `WireTurnState` — the desktop narrows it to the two SHIPPED values
 * (`permission | trust`, #716), structurally equal to the renderer-side `ModalClass` (modalPrompts.ts
 * / ADR 0009) so the #223 bridge assigns one to the other with no cast. There is NO `destructive` wire
 * class — a "second confirm" is a client-side UX policy on the answer path, not a wire distinction
 * (ADR 0009). This is stricter-than-wire (the daemon models `class` as an open string, SSOT #701), so
 * the fail-closed decode drops an unknown class — a deliberate no-drift posture (a dropped modal blocks
 * `claude`, so widening is a coordinated 3-touch change: this + `ModalClass` #122 + the decoder). See #201.
 */
export type WireModalClass = 'permission' | 'trust'

/**
 * What resolved a modal, on the wire. A closed set `{ remote, local, timeout }`, fully determined by
 * the resolution mechanism (SSOT #701): `remote` = a phone/desktop answer, `local` = answered at the
 * desktop TTY, `timeout` = deny-on-timeout fired. A plain wire string closed to the three values like
 * `WireTurnState`; structurally equal to the inline union on `ModalEvent.dismissed` (modalPrompts.ts).
 */
export type WireModalSource = 'remote' | 'local' | 'timeout'

/**
 * One selectable modal option. Mirrors the daemon `ModalOption` field-for-field (SSOT #701), both
 * fields always present (no `omitempty`). Array position (in `ModalShownPayload.options`) IS the
 * display/selection order. Structurally equal to the renderer-side `ModalOption` (modalPrompts.ts).
 */
export interface WireModalOption {
  id: string
  label: string
}

/**
 * Inbound `modal_shown` event (daemon → client). Mirrors the daemon's ModalShownPayload field-for-field
 * (SSOT #701, ADR 0009), wire order `conversation_id, modal_id, class, title, prompt, options,
 * default_option_id` — those fields are always present. The permission/trust prompt `claude` raises
 * during an interactive session (surfaced once #179 flips `interactive` on).
 *
 * `conversation_id` (pyrycode#1065, #870) is an **OUTBOUND routing/scoping key only**: the daemon asserts
 * it from its own active-conversation cursor so a client filters display by conversation and one
 * conversation's permission prompt is never rendered by a client viewing another. **`modal_id` remains
 * the sole INBOUND correlation key** — a one-time nonce; a `modal_answer` / `modal_cancel` carries no
 * conversation id and the daemon resolves the answer against its own outstanding-modal state, so a
 * client cannot assert which conversation an answer targets. Adding this field does not loosen that
 * anti-forgery model.
 *
 * `class` is a plain wire string closed to `WireModalClass` exactly like `MessagePayload.role`.
 * `options` is ORDERED. `default_option_id` is the id of a fail-safe deny default set daemon-side (its
 * `∈ options[].id` invariant is a render concern, #224, not cross-checked at decode). `title` / `prompt`
 * / each `options[].label` are untrusted `claude`-surfaced FREE TEXT the render slice (#224) must render
 * as plain text, never HTML. See #201.
 */
export interface ModalShownPayload {
  conversation_id: string
  modal_id: string
  class: WireModalClass
  title: string
  prompt: string
  options: WireModalOption[]
  default_option_id: string
  /** Opaque JSON display context, independent of reason_type. Narrow before rendering;
   * never merge object keys into application state, use as authority, or log its content. */
  reason?: unknown
  /** Open category and display text; never authorization, filesystem inputs, attributes or logs. */
  reason_type?: string
  blocked_path?: string
  description?: string
  default_to_no?: boolean
  /** Session-rule display offer, optional for older daemons. Rules retain source order.
   * The daemon owns grant validation; these strings must never be echoed as answer authority. */
  always_allow?: { offered: boolean; rules: string[] }
}

/**
 * Inbound `modal_dismissed` event (daemon → client). Mirrors the daemon's ModalDismissedPayload
 * field-for-field (SSOT #701, ADR 0009), wire order `modal_id, outcome, source` — all always present
 * (no `omitempty`). Clears an outstanding modal by `modal_id` (the sole correlation key; no
 * `conversation_id`). `outcome` is the answered option id or a producer sentinel — an OPAQUE string
 * (the vocabulary is the producer's), carried verbatim, never enum-checked. `source` is closed to
 * `WireModalSource`. See #201.
 */
export interface ModalDismissedPayload {
  modal_id: string
  outcome: string
  source: WireModalSource
}

/**
 * Outbound `modal_answer` request body (client → daemon) — the user's choice resolving an outstanding
 * modal. Mirrors the daemon's ModalAnswerPayload field-for-field (SSOT protocol-mobile.md § Modal (v2),
 * #701, ADR 0009), required fields `modal_id, option_id, answer_token`, plus optional `always_allow`.
 * The OUTBOUND counterpart to the inbound `modal_shown`/`modal_dismissed` above (this is the frame the
 * desktop sends back). **`modal_id` is the sole correlation key — NO `conversation_id` rides an ANSWER**
 * (the daemon resolves `modal_id` against its own outstanding-modal state, ADR 0009). One does ride the
 * inbound `modal_shown` as of pyrycode#1065 (#870), but purely as an outbound display-scoping key — a
 * client still cannot assert which conversation an answer targets.
 * `option_id` is a SINGLE string referencing a `WireModalOption.id` from the inbound
 * `modal_shown.options[].id` — NOT the stale ADR-025 multi-select `option_ids[]`. `answer_token` is a
 * client-minted idempotency key tying the answer to the one-time `modal_id` so a replayed / reordered
 * answer is inert (first-answer-wins, daemon-side): its uniqueness and stability matter, but its
 * secrecy does NOT — it is an anti-replay key, not a credential, and is minted main-side by #236 (not
 * here). See #235.
 */
export interface ModalAnswerPayload {
  modal_id: string
  option_id: string
  answer_token: string
  /** Request the daemon's retained session rules on an authorized allow. Absent/false adds no grant. */
  always_allow?: boolean
}

/**
 * Outbound `modal_cancel` request body (client → daemon) — dismiss an outstanding modal from the
 * desktop. Mirrors the daemon's ModalCancelPayload field-for-field (SSOT protocol-mobile.md § Modal (v2),
 * #701, ADR 0009): `modal_id` only, always present (no `omitempty`). The OUTBOUND counterpart to the
 * inbound modal frames above. **`modal_id` is the sole correlation key — NO `conversation_id`** (ADR
 * 0009). See #235.
 */
export interface ModalCancelPayload {
  modal_id: string
}

/**
 * One offered choice within a `question_shown` question. Mirrors the daemon `QuestionOption`
 * field-for-field (SSOT pyrycode docs/protocol-mobile.md § Question (v2), `internal/protocol`
 * questions.go), both fields always present (no `omitempty`). Array position (in
 * `WireQuestion.options`) IS the display order.
 *
 * `label` and `description` are the COMPLETE per-option key set. claude's contract also gives an
 * option an optional `preview` carrying an HTML fragment, emitted only when
 * `toolConfig.askUserQuestion`'s `previewFormat` is set — pyry never sets it, so the field is absent
 * BY CONSTRUCTION rather than dropped. Do not model it "for completeness".
 *
 * **There is NO `id`** — unlike `WireModalOption`'s `{ id, label }` above. claude's answer protocol
 * selects an option by its `label`, so `label` IS the option's identity. The consequence is for
 * whoever writes the answer frame (none exists yet; upstream pyrycode#1907): it will carry a
 * claude-authored string back across the trust boundary, and publishing that string here does not
 * make it trusted on the way back — it is re-resolved daemon-side against the recorded batch, keyed
 * on `question_batch_id`, exactly as `modal_answer` is against `modal_id`.
 *
 * Both fields are CLAUDE-AUTHORED: see `QuestionShownPayload`'s provenance note.
 */
export interface WireQuestionOption {
  label: string
  description: string
}

/**
 * One question within a `question_shown` batch. Mirrors the daemon `Question` field-for-field (same
 * SSOT), all four fields always present (no `omitempty`). Array position (in
 * `QuestionShownPayload.questions`) IS the canonical display order — claude's own.
 *
 * The wire key is `question`, NOT the Go struct's field name: upstream renamed the field to `Text`
 * only because `Question.Question` stutters, and the WIRE key is what a client mirrors.
 *
 * **`options` nests HERE, on each question** — not flat on the payload the way
 * `ModalShownPayload.options` is. This shape has two nesting levels and the modal family has one, so
 * a reader pattern-matching off that family gets it wrong by default. It is a plain non-optional
 * array (never `| null`): the daemon's `MarshalJSON` normalises a nil slice to `[]`, so no consumer
 * branches on null. That is the opposite of `BackgroundTask.truncated_fields`, whose nullability is
 * real — the two live one file apart and read alike.
 *
 * `multi_select` is claude's camelCase `multiSelect`, snake-cased for this wire exactly as
 * `argument_hint` snake-cases `argumentHint`. Always present, so `false` is a STATED POSITION rather
 * than an absent key.
 *
 * `header` is the short label a client shows on a tab, and its cap is the fact most likely to be got
 * wrong: **documented 12, observed 14, counted in RUNES.** claude's vendor page says "max 12
 * characters" while the only header in the committed upstream capture (`Write strategy`) is 14, so
 * the cap is a generation-side guideline claude does not itself hold to, not a wire invariant — size
 * a field for 14 and never truncate at 12. Nothing enforces it on either side. The rune/byte units
 * coincide on that pure-ASCII sample and NOTHING COMMITTED ANYWHERE separates them, so the
 * coincidence is not a measurement and must not be read as one.
 *
 * `question` and `header` are CLAUDE-AUTHORED: see `QuestionShownPayload`'s provenance note.
 */
export interface WireQuestion {
  question: string
  header: string
  options: WireQuestionOption[]
  multi_select: boolean
}

/**
 * Inbound `question_shown` event (daemon → client). Mirrors the daemon's QuestionShownPayload
 * field-for-field (SSOT pyrycode docs/protocol-mobile.md § Question (v2), shape pyrycode#1963,
 * fixtures and section #1964), wire order `conversation_id, question_batch_id, questions` — all
 * always present (no `omitempty`). The whole batch of clarifying questions claude's
 * `AskUserQuestion` tool raises, carried in ONE frame because a client steps through it with header
 * tabs and a Previous button and therefore needs every question in hand at once.
 *
 * **Wire vocabulary only.** Nothing decodes, narrows, emits or renders this yet — the fail-closed
 * parse and the question panel are later slices, and upstream's producer is pyrycode#1973.
 *
 * **PROVENANCE IS PER FIELD, and a client must not flatten it.** The two ids are DAEMON-ASSERTED:
 * the daemon fills them from its own state and they never come from claude's tool input. The four
 * strings — `WireQuestion.question`, `WireQuestion.header`, and every `WireQuestionOption.label` and
 * `.description` — are CLAUDE-AUTHORED at `model_list`'s trust tier: they crossed the subprocess
 * trust boundary, and the daemon NEITHER BOUNDS NOR SANITIZES them (nothing on the path strips
 * control characters or terminal escape sequences). They stay untrusted text all the way here, so
 * the render boundary that owes the sanitization is THIS CLIENT'S. They are safe to render as inert,
 * escaped, length-bounded text and must never reach a raw-markup sink (no `innerHTML`, no
 * `dangerouslySetInnerHTML`), an attribute, a URL, a filename, a cache key, a lookup path, or a log
 * (CLAUDE.md's daemon-text ruling in full — the last three are the ones a paraphrase drops and the
 * ones a question panel reaches for first, keying a tab by `header` or memoising by `label`).
 *
 * `conversation_id` is an OUTBOUND routing/scoping key only, exactly as `modal_shown`'s is
 * (pyrycode#1065): it is what lets a client with several open conversations avoid rendering one
 * conversation's question in another. It grants no inbound capability.
 *
 * `question_batch_id` is a one-time, opaque, UNGUESSABLE nonce minted per surfaced batch — `modal_id`'s
 * role exactly, with all four of those properties. An inbound answer would be resolved against it
 * SERVER-SIDE rather than trusting anything a client asserts. Being unguessable, it must never reach
 * a log. It is `question_batch_id` and not `question_id` because this payload also declares a nested
 * question type carrying NO id at all, so a `question_id` beside a `questions` array would misread as
 * that type's key. **The upstream fixtures' ids are placeholders** — neither their length nor their
 * shape is a contract, and nothing about a real nonce may be sized from them.
 *
 * `questions` is a plain non-optional array for `WireQuestion.options`' reason (nil normalises to
 * `[]`). Unlike `model_list`'s `models`, an empty array here is NOT a positive statement: it is out
 * of contract and means a producer bug, not "claude asked nothing".
 *
 * **BOUNDS ARE DELIBERATELY NOT MODELLED, because nothing enforces them.** claude's contract states
 * 1–4 questions per batch and 2–4 options per question; checked against the daemon tree at
 * 2026-09-01, no bound is enforced anywhere, and neither is any maximum length for the four strings.
 * A bound in the type system here would be stricter-than-wire in a family whose enforcement is still
 * unwritten, so there are no tuple types, no branded numbers and no max constants.
 *
 * **This family ships NO `truncated_fields`**, unlike `SlashCommand` and `ModelOption`. A cut can
 * therefore never be reported, which makes an over-long field a fail-closed REJECT for the decode
 * slice rather than a silent trim — trimming would present claude's truncated text to a client as
 * complete.
 *
 * Every field being required is load-bearing: it leaves a fail-closed narrower no optional key to
 * wave through, so a missing field is a reject by construction. **A required field is still only a
 * promise the wire has not kept until it is checked** — reach this type through a validating
 * narrower, never a bare `as QuestionShownPayload` on `Envelope.payload`, which would hand a `.map`
 * a non-array from a malformed frame. The cost of the all-required mirror is named rather than
 * implicit: it holds while the daemon keeps its no-`omitempty` commitment, and widening is a
 * coordinated change with the daemon (a dropped batch parks the session — claude waits on an answer
 * the operator never sees), the same posture `WireModalClass` records for an unknown class.
 */
export interface QuestionShownPayload {
  conversation_id: string
  question_batch_id: string
  questions: WireQuestion[]
}

/**
 * Inbound `question_dismissed` event (daemon → client). Mirrors the daemon's QuestionDismissedPayload
 * field-for-field (SSOT pyrycode docs/protocol-mobile.md § Question (v2), shape pyrycode#1974, producer
 * #1973), wire order `question_batch_id, outcome, source` — all always present (no `omitempty`). It
 * retires the `question_shown` batch above, so a client takes the panel down rather than rendering an
 * ask that is already dead.
 *
 * **Field for field with `ModalDismissedPayload`, INCLUDING THE ABSENCE.** There is no
 * `conversation_id`, though `question_shown` carries one: the batch nonce is the sole correlation key,
 * and a shape carrying both would admit a disagreeing pair someone has to adjudicate. A client holding
 * the batch already knows its conversation. Do not add one "for symmetry with the batch".
 *
 * **`source` is a PLAIN string and NOT `WireModalSource`, and that is the single most likely mistake
 * in this family.** Of the modal frame's closed `{remote, local, timeout}`, nothing emits any member
 * here: `remote` and `local` are ANSWERED outcomes belonging to the not-yet-landed answer half
 * (pyrycode#1907), and `timeout` is not emitted either — the producer's dismissal arbiter is a single
 * closure the control server defers on every `Await` return, so it cannot tell the approval window
 * elapsing from a caller disconnect or a daemon shutdown, and naming `timeout` would state a cause
 * that is wrong on two paths out of three. Two of those three paths have no member in that set AT ALL.
 * Closing the enum here would reject the only traffic that exists.
 *
 * **The fail-closed reading rule that makes the open type safe: an unrecognised `source` means
 * *resolved, cause unknown*, and NEVER an answer.** Getting it backwards renders a daemon safe-deny as
 * the operator's own choice. The values a client written today will not recognise are precisely the
 * ones the producer has yet to name.
 *
 * The producer's landed vocabulary is ONE PAIR — `outcome: "unanswered"` with `source: "no_answer"`,
 * for the whole no-answer class. **Recognise it; do not enforce it.** The upstream fixture
 * `internal/protocol/testdata/question_dismissed.json` carries `source: "timeout"` and is a SHAPE
 * fixture minted by the declaring slice before the producer existed — not evidence of the live
 * vocabulary, and not a value to copy.
 *
 * `outcome` is an opaque producer-defined sentinel carried verbatim and never enum-checked, exactly as
 * `ModalDismissedPayload.outcome` is. **It never carries a claude-authored option label** — a published
 * contract rather than a coincidence, and the reason this frame, unlike the batch, carries no
 * claude-authored byte at all and therefore sits at a different trust tier from its sibling. The rule is
 * stated positively because the natural implementation violates it: `WireQuestionOption` carries no
 * `id` and claude's answer protocol selects by `label`, so a producer reporting the chosen option
 * reaches for that subprocess-authored string first. A consumer needing the label reads it from the
 * batch it already holds, keyed on `question_batch_id`.
 *
 * **That provenance is the producer's promise, not a property a decoder verifies.** All three fields
 * are published as daemon-asserted, but the only thing checked at the transport boundary is that each
 * is a string; a compromised daemon puts whatever it likes in `outcome` and `source`, at whatever
 * length the frame cap allows. Do not read "daemon-asserted" as "safe to render as trusted chrome" —
 * the escaping and length-bounding boundary is still this client's.
 *
 * `question_batch_id` is the batch's own one-time unguessable nonce echoed back. It must never reach a
 * log. It is DEAD once this frame lands, and receiving it is NOT a capability: a retired batch resolves
 * nothing server-side, the way a stale `modal_id` resolves nothing under first-answer-wins. Matching it
 * against a held batch wants plain `===`, not `crypto.timingSafeEqual` — a local routing decision
 * between two values the client already holds, not a secret compared against an attacker's guess.
 *
 * Every field being required is load-bearing for the same reason `QuestionShownPayload`'s are: it
 * leaves a fail-closed narrower no optional key to wave through. **A required field is still only a
 * promise the wire has not kept until it is checked** — reach this type through a validating narrower
 * (`parseQuestionDismissedPayload`), never a bare cast on `Envelope.payload`.
 */
export interface QuestionDismissedPayload {
  question_batch_id: string
  outcome: string
  source: string
}

/**
 * One question's answer inside a `question_answer` — which question, and the values chosen for it.
 * Mirrors the daemon `QuestionAnswerEntry` field-for-field (SSOT pyrycode docs/protocol-mobile.md
 * § Question (v2), `internal/protocol` questions.go), both fields always present (no `omitempty`).
 *
 * **`question_index` names the question by INDEX into the batch's `questions` array — never by text,
 * and that is the security property this whole shape exists for.** `WireQuestionOption` carries no
 * `id` because claude's answer protocol selects an option by its `label`, so the reflex design echoes
 * a claude-authored string back across the trust boundary; `QuestionShownPayload`'s provenance note
 * states the rule this discharges — publishing a string outbound does not make it trusted when it
 * returns. Keying by index means no claude-authored byte travels inbound at all, and the daemon
 * builds the text-keyed map claude actually receives from its own parked copy of the batch.
 *
 * The wire key is `question_index` and not `index` because an entry quoted on its own must not read
 * as "the index of this answer".
 *
 * **The index is carried, NEVER range-checked here or by the builder.** The bound is the daemon
 * resolver's — upstream's `answerVerdict` range-checks every index before it subscripts (subscripting
 * a parked batch out of range PANICS) and rejects a bad answer totally rather than partially. A
 * second copy client-side would be a second bound to keep in agreement, the same reason
 * `DequeueMessagePayload` polices no `queued_msg_id`. It is a plain signed `number` for upstream's
 * reason: a uint would reject -1 at decode and still accept 1<<62, half-closing the door while
 * turning a range problem into a decode-error surprise.
 *
 * `values` is a plain non-optional array (never `| null`): the daemon normalises a nil slice to `[]`
 * in the entry's own `MarshalJSON` precisely so a client's array type can be non-optional. More than
 * one value is the `multi_select` case; one is the ordinary one. They are OPERATOR-TYPED FREE TEXT
 * and are never checked against the batch's offered labels — claude's contract permits free text
 * anywhere and requires no value to be one of the labels, so a validator rejecting an unlisted value
 * would reject a legal answer. An empty `values` selects nothing and is out of contract.
 */
export interface QuestionAnswerEntry {
  question_index: number
  values: string[]
}

/**
 * Outbound `question_answer` request body (client → daemon) — the operator's selections resolving an
 * outstanding `question_shown` batch. Mirrors the daemon's QuestionAnswerPayload field-for-field
 * (same SSOT, declared pyrycode#1983, resolved #1991), wire order
 * `question_batch_id, answer_token, answers` — all always present (no `omitempty`). The OUTBOUND
 * counterpart to the inbound `question_shown`/`question_dismissed` above.
 *
 * **There is NO `conversation_id`, though `question_shown` carries one**, and here that absence is
 * also the SECURITY property — `ModalAnswerPayload`'s, unchanged: the daemon resolves
 * `question_batch_id` against its own outstanding-batch state and never trusts a client-asserted
 * conversation. A shape carrying both would additionally admit a disagreeing pair someone has to
 * adjudicate. Do not add one "for symmetry with the batch".
 *
 * `answer_token` is `ModalAnswerPayload`'s field verbatim, reasons included: a CLIENT-MINTED
 * IDEMPOTENCY KEY whose uniqueness and stability matter and whose secrecy does NOT — it is not a
 * credential and not the authorization, and the daemon's real dedup is the one-shot consume of
 * `question_batch_id`. **The daemon never reads it on this path** — `modalResolverV2.AnswerQuestion`
 * takes the batch id and the entries rather than the whole payload, expressly so it never holds a
 * token it has no business reading. It is still a modelled, always-present field, minted main-side by
 * the command slice and not here. Contrast `question_batch_id`, which IS a one-time unguessable
 * nonce and must never reach a log.
 *
 * `answers` is ordered and is a plain non-optional array for `QuestionAnswerEntry.values`' reason (a
 * nil slice normalises to `[]`). **ARRAY ORDER IS NOT THE CORRELATION**: a client emits entries in
 * batch order, but `question_index` is what selects, so nothing may infer the question from an
 * entry's array position. An empty `answers` is out of contract — it says nothing a refusal does not
 * say better, which is why `question_refused` is its own type.
 *
 * **No bound is modelled on entry count or value length, because nothing enforces one.** The only
 * operative limit is the transport's `MAX_PLAINTEXT_BYTES`, which bounds total bytes and not entry
 * count; a payload over it is a fail-closed `WireEncodeError` out of `buildQuestionAnswer`, never a
 * truncation — trimming would send the operator a different answer than the one they chose.
 */
export interface QuestionAnswerPayload {
  question_batch_id: string
  answer_token: string
  answers: QuestionAnswerEntry[]
}

/**
 * Outbound `question_refused` request body (client → daemon) — the operator declined to choose, so
 * the batch resolves without any selection. Mirrors the daemon's QuestionRefusedPayload
 * field-for-field (same SSOT, resolved pyrycode#1990), wire order `question_batch_id, answer_token`,
 * both always present (no `omitempty`).
 *
 * Its OWN TYPE rather than a `QuestionAnswerPayload` with an empty `answers` or a nullable flag,
 * mirroring `modal_cancel` beside `modal_answer`: a distinct meaning gets a distinct type, so a
 * reader routes on the frame's name rather than on a value's shape, and nobody has to adjudicate
 * "answered with nothing" against a genuine refusal.
 *
 * **It carries `answer_token`, UNLIKE `ModalCancelPayload`, which carries `modal_id` alone — do not
 * size this pair from the modal pair's asymmetry.** A refusal is as replayable as an answer, and the
 * daemon's dedup is the same one-shot consume of `question_batch_id`. Field for field with
 * `QuestionAnswerPayload` minus `answers`, INCLUDING THE ABSENCE of `conversation_id`, for that
 * type's reasons.
 *
 * **This frame carries NO FREE TEXT AT ALL**, which makes it the narrowest surface in the family:
 * both fields are ids the client echoes back.
 */
export interface QuestionRefusedPayload {
  question_batch_id: string
  answer_token: string
}

/**
 * ONE ROW of a `model_list` (daemon → client). Mirrors the daemon's `ModelOption` field-for-field
 * (SSOT pyrycode docs/protocol-mobile.md § model_list, internal/protocol/interactive.go), wire order
 * `resolved_model, value, display_name, effort_levels, supports_auto_mode, truncated_fields` — all
 * always present (no `omitempty` on any of them). The key set is a deliberate SUBSET of claude's
 * per-entry vocabulary and nothing invented: `description` and `supportsFastMode` are not carried
 * because neither has a named consumer, and `supportsEffort` is subsumed by `effort_levels`.
 *
 * NAMED `WireModelOption`, NOT `ModelOption`, deliberately. `Wire` is this cluster's prefix for a
 * nested row whose bare name is generic enough to be wanted again downstream (`WireQuestion`,
 * `WireQuestionOption`, `WireModalOption`, `WireSlashCommand`), and the bare `ModelOption` is ALREADY
 * USED across this repo's prose to mean the DAEMON's Go type — in `QuestionShownPayload`'s doc comment
 * below, in this file's test suite, and in two package overviews. Leaving it unclaimed keeps every one
 * of those references pointing where it always did.
 *
 * `value` IS THE ARGUMENT YOU PASS (`claude --model <value>`). It is NOT a dated identifier, and it is
 * NOT PARSEABLE FOR MATCHING, INDEXING OR KEYING: the measured entries are `default`, `opus[1m]`,
 * `claude-fable-5[1m]`, `sonnet` and `haiku` — a literal, a bare alias, or a bracketed variant — so no
 * join may split it, no index may be built from a piece of it, and it may never be presented as a
 * version. #1095 re-scoped that from the absolute it used to state. Deriving a DISPLAY LABEL is none of
 * the three: the input footer's model control shows a FAMILY, taking the leading run of ASCII letters
 * after one optional `claude-` (so `default` reads `Default` and `claude-fable-5[1m]` reads `Fable`).
 * That is a view-side transform on a held-verbatim value, it is downstream of every lookup, and no
 * derived label is ever fed back into one — the join here is still exact equality on the whole string.
 * A consumer deriving a family for any purpose OTHER than display is still doing the forbidden thing.
 *
 * `resolved_model` is what `value` resolves to RIGHT NOW: the concrete identifier, published BEFORE
 * the first turn, which is what lets a client show what an alias currently means instead of inferring
 * it from an announcement after the fact. It is NOT reliably populated — four of the populated
 * fixture's five rows carry the literal `<unmeasured>`, angle brackets included — so it is not an
 * identifier merely because one row makes it look like one.
 *
 * `display_name` is claude's human label and THE INTENDED JOIN against a per-turn `model_announced`
 * identifier — NOT `resolved_model`, because the announcement names a concrete dated identifier while
 * these rows are alias families. A LOOKUP MAY MISS, and that is ordinary rather than an error;
 * `ModelAnnouncedPayload` above states the same rule from the other side, and resolution is an EXACT
 * EQUALITY LOOKUP, never inference. **If a consumer indexes rows by this field, the index is a `Map`,
 * never a plain object** — `display_name` is claude-authored text, and `index[row.display_name] = row`
 * with a `__proto__` label writes through to `Object.prototype`. That is the join's own instance of
 * the never-a-lookup-path clause below, not a separate rule.
 *
 * `supports_auto_mode` is whether claude accepts `auto` permission mode for this model. claude refuses
 * per model, so a client HIDES the option when this is `false` (#1022 — the operator ruled against
 * greying it, since the shared options panel has no unavailable row and inventing one would have cost
 * both a visual and a prop on a surface four menus share). It names the SAME `auto`
 * the daemon's own vocabulary carries — the field is `set_session_settings.permission_mode`, whose
 * write half accepts a closed five of default / acceptEdits / plan / auto / dontAsk, and whose read
 * half (`SessionSettingsPayload.permission_mode`, #1020) additionally reports `bypassPermissions`.
 * This flag says whether the model accepts that mode, not whether the mode exists. Absent in claude's
 * reply decodes to
 * `false`, which is the CORRECT reading rather than a missing one, so `false` is a value.
 *
 * `effort_levels` are the reasoning-effort levels this model supports. IT IS A PLAIN ARRAY AND NEVER
 * `string[] | null`, but NOT for `models`' reason, and the asymmetry is upstream's rather than an
 * accident (both normalisations live in interactive.go, each with its own argument). For `models`,
 * `[]` is a POSITIVE STATEMENT. Here `[]` is a COLLAPSE: Haiku's live entry omits
 * `supportedEffortLevels` entirely, and a client's behaviour is identical for absent, `null` and `[]`
 * (no effort control), so the wire states ONE position for all three rather than making every row
 * branch on absent-versus-empty. Do not model it optional and do not invent a distinction the wire
 * does not carry.
 *
 * **A CUT `effort_levels` IS UNKNOWABLE FROM `effort_levels` ALONE — the one place that collapse costs
 * a reader.** Because absent and empty arrive as the same `[]`, a `truncated_fields` NAMING
 * `effort_levels` is the ONLY signal separating "cut to nothing, or shortened" from "this model
 * exposes no effort control", and it must be read as UNKNOWN, never as *none*. Read as *none*, a cut
 * list silently removes an effort control the model actually supports. **That rule is only sound on a
 * VALIDATED frame**, which is the trap this type cannot close on its own: reached through a bare `as`
 * on `Envelope.payload`, a frame whose `truncated_fields` key is absent yields `undefined`, and
 * `row.truncated_fields?.includes('effort_levels')` is then falsy for exactly the reason `null` is —
 * the reader concludes nothing was cut. NULLABLE IS NOT OPTIONAL; go through the decode slice's
 * narrower. This is `WireSlashCommand`'s cut-`aliases` hazard transposed onto a different field.
 *
 * `effort_levels` also carries a DIRECTION HAZARD, and it is upstream's rather than this repo's to
 * fix. The daemon's inbound `validEffort` enum is CLOSED at the five levels claude returns today
 * (`low`, `medium`, `high`, `xhigh`, `max`), while `validModel` was WIDENED (pyrycode#1838) for
 * exactly these rows — so a level claude adds in future would be published here and REFUSED INBOUND.
 * A consumer must read a published level as a candidate rather than a guarantee, and handle the
 * refusal.
 *
 * `truncated_fields` names THIS ROW'S OWN cut fields, in producer order `resolved_model`, `value`,
 * `display_name`, `effort_levels`, and `null` means NOTHING WAS CUT for this row. It is deliberately
 * NOT normalised the way `effort_levels` is, and that exemption is upstream's too: `nil` and `[]` say
 * the identical thing here and no consumer branches on the difference. Each row reports its own —
 * there is no hoisted or flattened list on the payload. `effort_levels` is the one name reporting on a
 * LIST rather than a scalar, and it covers an element cut to fit, the list shortened to fit, or both,
 * appearing at most once per row in every case, because the report names FIELDS and a list is one
 * field. The element vocabulary is a plain `string[]` and is NOT narrowed to those four names, for the
 * reason `WireSlashCommand` records: each frame's set is its own, and a closed one would fail-close a
 * valid future frame.
 *
 * **A CUT `value` IS LOAD-BEARING, NOT DECORATION, and it bites harder here than the same field does
 * on any sibling** — because `value` is the one field a client sends BACK. `validModel` is a
 * CHARSET-AND-LENGTH rule, not a membership check against the published list: a `value` cut mid-token
 * (`claude-fable-5[1m]` → `claude-fable-5`, `opus[1m]` → `opus`) stays alphanumeric, stays inside 64
 * bytes, and is ACCEPTED. The operator picks one row and gets a different model, with no error frame
 * anywhere on the path. A row that ignored this field would also present claude's cut text as
 * complete.
 *
 * The BOUND is the PRODUCER's, decided at construction. This type re-decides no maximum and declares
 * no charset check: a second cap here would be a second place the limit is decided and the two could
 * disagree silently, and stricter-than-wire would fail-close a valid frame.
 *
 * SECURITY — `resolved_model`, `value`, `display_name` and EVERY STRING IN `effort_levels` are
 * CLAUDE-AUTHORED strings that crossed the subprocess trust boundary. That is a HIGHER trust tier than
 * `WireSlashCommand`'s workspace-authored strings, and it is the tier the `model_list` references
 * elsewhere in this file anchor against. The daemon BOUNDS THEM AND DOES NOT SANITIZE THEM — nothing
 * on this path strips control characters or terminal escape sequences — so they stay untrusted,
 * model-influenced text all the way here and THE RENDER BOUNDARY THAT OWES THE SANITIZATION IS THIS
 * CLIENT'S. Safe to render as inert, escaped, length-bounded text; never into a raw-markup sink (no
 * `innerHTML`, no `dangerouslySetInnerHTML`), an attribute, a URL, a filename, a cache key, a lookup
 * path, or a log (CLAUDE.md's daemon-text ruling in full). Note that the never-a-log clause rests on a
 * DIFFERENT footing here than in `WireSlashCommand`, whose argument is a measured `0x0a` across 51
 * workspace-authored entries: no control byte is measured in these short labels, so the clause holds
 * on the contract rather than on a measurement — the daemon bounds and does not sanitize, so a control
 * byte is PERMITTED by the contract rather than excluded by it. Do not transcribe the sibling's
 * measurement here; it would be a false claim about this frame.
 */
export interface WireModelOption {
  resolved_model: string
  value: string
  display_name: string
  effort_levels: string[]
  supports_auto_mode: boolean
  truncated_fields: string[] | null
  /** Which agent offers this row (#1649), held through `agentFromWire`; absent counts as Claude. */
  agent?: WireAgent
  /** The model family as the daemon sent it (#1649): daemon text, compared by equality only — never an
   *  object key, a lookup path or a log. */
  family?: string
}

/**
 * Inbound `model_list` event (daemon → client). Mirrors the daemon's ModelListPayload field-for-field
 * (same SSOT), wire order `conversation_id, models, dropped_models` — all always present (no
 * `omitempty`). The models claude will accept for this conversation, in claude's own order, drawn from
 * the same `initialize` control reply `slash_command_list` comes from: this one inventories the
 * IDENTITIES claude will run as, that one the VERBS the working directory will accept.
 *
 * **Decoded, held and rendered.** #972 narrows it fail-closed, #973 carries it as a typed daemon event,
 * #974 holds it per conversation, and the run-configuration sheet builds both its model rows (#975) and
 * its effort segments (#976) from these rows — the hardcoded `MODEL_CATALOG` array and `EFFORT_LEVELS`
 * constant that stood in `RunConfigSections.tsx` are gone, and the sheet no longer guesses. Upstream's
 * producer landed ahead of all of them (pyrycode#1848 maps it, #1849 emits it, #1845 proves it end to
 * end), so like `slash_command_list` and unlike `question_shown` this shape arrived to traffic that
 * already existed.
 *
 * `models` IS A PLAIN ARRAY AND NEVER `WireModelOption[] | null`: the daemon's `MarshalJSON`
 * normalises a nil slice to `[]`, and `omitempty` is deliberately out because eliding the key would
 * erase the frame's point. AN EMPTY `[]` IS A POSITIVE STATEMENT THAT CLAUDE OFFERED NOTHING, so a
 * client decoding into a non-optional array type never has to branch on null. Note that this is NOT
 * the argument behind `WireModelOption.effort_levels`' identical posture — that one is a collapse, not
 * a positive statement — so ONE FRAME STATES THREE DIFFERENT POSITIONS ON EMPTY, and a reader who
 * assumes one rule gets two of them wrong. The third is `truncated_fields`, exempt from normalisation
 * entirely.
 *
 * **`dropped_models` IS COUNTED AND CARRIED, so `models.length + dropped_models` IS THE MENU'S TRUE
 * SIZE**, and a client can render "10 of 40" rather than presenting a shortened menu as complete. The
 * number reaches the wire intact: the mapping carries it VERBATIM rather than recomputing it from
 * `len(models)`. `dropped_models: 0` is a VALUE, never consulted for truthiness — the key is always
 * written, so an absent one is a real defect rather than a valid zero. A COUNT is carried rather than
 * a name because a name-only report loses HOW MANY were lost; per-row text cuts are a property of one
 * row and ride that row's own `truncated_fields`, so there is deliberately no hoisted one here.
 *
 * **THE PRODUCER'S TEN-ENTRY CAP IS A DAEMON-SIDE PRODUCER CAP, NOT A WIRE CONSTANT.** It may change
 * without any change to this contract, so a client must never hardcode it, treat a list of exactly ten
 * as a signal, or derive it from anything but `dropped_models`. Upstream states that the producer cuts
 * only the overflow, so a non-zero `dropped_models` arrives beside exactly ten entries and a shorter
 * list is a complete one — but THE COMMITTED FIXTURE DOES NOT SATISFY THAT INVARIANT (five rows beside
 * `dropped_models: 2`), because it pins SHAPE rather than capturing live traffic. Trust the field, not
 * the length. The list is truncated FROM THE TAIL, so the entries received are claude's first N in
 * claude's own order. No bound is modelled here for `SlashCommandListPayload`'s reason, and the frame
 * cannot arrive unbounded regardless: `MAX_PLAINTEXT_BYTES` caps the decrypted envelope before any
 * parse, in `parseInboundMessage`, ahead of `decodeEnvelope` and ahead of every narrower.
 *
 * NOT A TURN-STREAM ITEM: it rides a `control_response`, opens and closes no turn, and carries no
 * `turn_id`. It is a SNAPSHOT that REPLACES a reader's view of the menu, never a delta amending it.
 * Hence it keeps `conversation_id` — daemon state keyed by id — which is an OUTBOUND routing/scoping
 * key only, exactly as `slash_command_list`'s and `modal_shown`'s are, granting no inbound capability.
 * It is not a nonce: nothing here is unguessable and nothing here is a secret. **A client must never
 * block a model menu on this frame** — the delivery window is narrow and lossy, and the `EnvelopeType`
 * member comment above states the three ways it goes missing.
 *
 * THE FRAME IS A REPORT, NEVER A CONTROL INPUT — with one amendment a client needs, because the
 * unqualified rule reads as forbidding the feature. A client IS meant to send a `value` BACK, on
 * `set_session_settings`; it is the first field in this family that travels in that direction.
 * Publishing it does not make it trusted: it is still claude's text arriving on an inbound path, and
 * the daemon re-validates it at internal/relay's `validModel` rather than trusting that it came from a
 * list the daemon itself published. That rule is pyrycode#845's argv-injection defense and is shaped
 * the way it is because an accepted value reaches TWO sinks — the claude argv, where `--model` and the
 * value are separate `execve` elements no shell parses, and the live child's TURN TEXT, since a model
 * change on a running session is written as `/model <value>` on one line, so an accepted value must
 * stay a single whitespace-free token.
 *
 * Every field being required is load-bearing: it leaves the decode slice's fail-closed narrower no
 * optional key to wave through, so a missing field is a reject by construction. **A required field is
 * still only a promise the wire has not kept until it is checked** — reach this type through that
 * narrower, never a bare `as ModelListPayload` on `Envelope.payload`, which would hand a `.map` a
 * non-array from a malformed frame and would silently invert `WireModelOption`'s cut-`effort_levels`
 * rule above.
 */
export interface ModelListPayload {
  conversation_id: string
  models: WireModelOption[]
  dropped_models: number
}

/**
 * Outbound `request_model_list` payload (client → daemon, #1165). Mirrors the daemon's
 * internal/protocol/interactive.go RequestModelListPayload field-for-field: one `conversation_id`,
 * no `omitempty`, so the key is always on the wire. The frame it asks for is `ModelListPayload`
 * above; the delivery-window rationale is on the `'request_model_list'` `EnvelopeType` member.
 *
 * `conversation_id` is REQUIRED, and that is the one divergence from `RequestSessionSettingsPayload`
 * worth stating: THAT verb's id is optional end to end because an unnamed request draws a
 * zero-valued reply, which is a real answer. There is no zero answer to "what models does nothing
 * offer" — an unnamed request here has nothing to ask about, so `''` is not a meaningful request and
 * the whole chain (command member, boundary guard, connection method, builder input) types the id as
 * required. `''` still PASSES the boundary guard, which checks type rather than emptiness; the daemon
 * polices ids, and it answers an unresolvable one with `conversation.not_found` rather than another
 * conversation's list.
 *
 * The id is a routing id, NEVER a secret (the `SetSessionSettingsPayload.session_id` /
 * `conversation_id` convention), and it is CLIENT-OWNED — read from this app's own conversation
 * state, never off the network. It is an object value in a payload the main process rebuilds from
 * scratch: never a key, a path, a log field, or an attribute.
 */
export interface RequestModelListPayload {
  conversation_id: string
}

/** Request one conversation's context reading. Mirrors the daemon's required field. */
export interface RequestContextUsagePayload {
  conversation_id: string
}

/** Request one conversation's MCP status (#1578). The daemon's payload has exactly this field and no
 *  request id; the reply correlates by the envelope's `in_reply_to`. */
export interface MCPStatusRequestPayload {
  conversation_id: string
}

/** Ask the daemon to reconnect one MCP server (#1582). Exactly these two fields, field-for-field with the
 *  daemon's `MCPReconnectPayload`. `server_name` is the status row's untrusted claude-authored name, sent
 *  back unchanged; on this side it is never a log field, a map key, a path or an authorization input. */
export interface MCPReconnectPayload {
  conversation_id: string
  server_name: string
}

/** Ask the daemon to turn one MCP server on or off (#1586), field-for-field with the daemon's
 *  `MCPTogglePayload`. `enabled` is required here even though the daemon decodes an omitted key as
 *  `false`: the operator's requested state always rides the wire. `server_name` carries the same
 *  untrusted-name rules as `MCPReconnectPayload`. */
export interface MCPTogglePayload {
  conversation_id: string
  server_name: string
  enabled: boolean
}

/** Ask the daemon to stop one background task (#1770), field-for-field with the daemon's payload. Both ids
 *  are opaque daemon strings, required and non-empty; `task_id` is the one the roster rows carry. Never a
 *  log field, a map key, a path or markup on this side. */
export interface StopBackgroundTaskPayload {
  conversation_id: string
  task_id: string
}

/**
 * Outbound `request_history` payload (client → daemon, #1222). Mirrors the daemon's published shape
 * field-for-field (SSOT pyrycode docs/protocol-mobile.md § Conversation history (v2) → `request_history`,
 * internal/protocol). ALL THREE KEYS ARE ALWAYS PRESENT — the daemon declares no `omitempty` on any of
 * them, so a decoder on either side may rely on all three, and this client emits all three.
 *
 * `conversation_id` is a routing id and NEVER a secret, client-owned exactly as its two neighbours
 * above are: read from this app's own conversation state, never off the network. Naming a conversation
 * here IS NOT AUTHORIZATION — the daemon validates it against its own registry before resolving
 * anything and serves only what the authenticated session is entitled to; the name says WHICH, never
 * WHETHER. Authorization is pairing, enforced structurally at the Noise IK handshake.
 *
 * `cursor` is the position handed back by the previous page, echoed VERBATIM. **A client MUST NOT
 * PARSE ONE.** It names a position in an append-only file rather than an offset or a page number, both
 * of which an append landing while the operator scrolls would invalidate; the daemon's own
 * `parseCursor` is the only thing anywhere that reads one. **Empty means "start at the newest"** — the
 * first ask of a walk has nothing to echo yet, so `''` is the normal opening value and NOT a missing
 * one. A decoder or a guard that required a non-empty cursor would break the first ask of every walk.
 *
 * IT IS ALSO NOT A SECRET AND NOT A CAPABILITY, and reading it as one is the mistake to avoid on this
 * side: the encoding is trivially reversible, what it carries is the conversation id the client already
 * knows, and it is deliberately UNSIGNED because a MAC would imply an authorization it does not carry.
 * So it is stored and echoed, never compared against anything, never validated, and never treated as
 * proving anything.
 *
 * `limit` is a REQUEST, NOT A GUARANTEE, and three published rules narrow it. **`0` — sent as zero, or
 * omitted — asks the daemon to choose**, and never means zero entries. A large ask is CLAMPED, not
 * refused (the ceiling is the daemon's `history.MaxPageEntries`, 4096), so this client invents no
 * ceiling of its own. A NEGATIVE limit is a reject (`history.invalid_page_size`), so
 * `buildRequestHistory` normalises an absent or non-positive ask to `0` rather than emitting one. The
 * consequence that binds every consumer: a page may come back SHORTER than asked because the daemon
 * budgets bytes, so a client reads the reply's actual entry count and never infers "short page ⇒ start
 * of log".
 */
export interface RequestHistoryPayload {
  conversation_id: string
  cursor: string
  limit: number
}

/**
 * ONE ENTRY of a `history_page` (daemon → client, #1222). Mirrors the daemon's published shape
 * field-for-field (SSOT pyrycode docs/protocol-mobile.md § Conversation history (v2) → § A history
 * entry). One entry is ONE STORED WIRE ENVELOPE'S WORTH — a wire type, its payload, a timestamp and a
 * durable entry id — which is what makes history renderable without a second mapping: a client
 * re-reduces a loaded page oldest-first through the same timeline reducer it runs for the live stream.
 *
 * `id` IS NOT AN `event_id`, AND THE TWO MUST NEVER BE JOINED. This one is the durable, per-conversation
 * on-disk log id: monotonic within one conversation's log and stable across daemon restarts.
 * `event_id` is the IN-MEMORY replay ring's — per-process, reset by a restart, and meaningful only to
 * Mode A. They are different sequences that both look like small integers, which is exactly why a join
 * would typecheck and be wrong.
 *
 * `type` IS A STORED STRING THAT NOTHING RE-VALIDATES against the daemon's type table, so it is
 * deliberately NOT narrowed to `EnvelopeType` or to any closed set here, and a client MUST TOLERATE a
 * type it does not recognise rather than treating one as a protocol violation. The set it spans is the
 * whole live-lane vocabulary — every interactive-stream frame the daemon emits, plus
 * `session_transition`, plus the operator's own `message` — and enumerating it in a type would
 * fail-close a valid future frame.
 *
 * DECODING MAKES THE SHAPE TRUSTED AND NEVER THE CONTENT, and the type system carries no signal for
 * that — the `RetrievedAttachmentChunk` warning, and it lands harder here. `type` and `payload` are
 * REPLAYED CONTENT: operator-authored for a stored `message`, `claude`-authored for a stored
 * assistant frame. An entry carries EXACTLY the trust class of the live frame it mirrors, so the
 * daemon's § Security model threat 1 lands on this shape and a client applies exactly the sanitisation
 * it applies on the live lane. NOTHING ABOUT AN ENTRY IS MORE TRUSTED FOR HAVING BEEN STORED.
 *
 * THE OPERATOR'S OWN STORED MESSAGE IS TYPED `message`, NOT `send_message`, and the SSOT prose is stale
 * on exactly this point: its § A history entry says "operator-authored for a stored `send_message`" and
 * its worked example shows `"type": "send_message"`, but the daemon's third history producer
 * (`cmd/pyry/operator_message_history.go`, pyrycode#2115) appends `protocol.TypeMessage` carrying a
 * `MessagePayload`. `message` is the string a client matches on; the two sentences above and below that
 * say so are the correct ones. This type appears only in history — the daemon pushes no `message` frame
 * on the interactive lane.
 *
 * `payload` crosses VERBATIM as opaque data AT THIS TYPE, which is the pre-decode wire shape. #1227
 * added the background-process stage that reads it: `decodeHistoryEvent` narrows each entry against the
 * same payload parser the live lane uses, so what crosses IPC is `HistoryTimelineEntry`
 * (shared/ipc/events.ts) and not this. Nothing in the window ever holds one of these. It is typed as an
 * open record rather than a union of the wire payloads because it can hold a type this client does not
 * recognise — which the decode SKIPS rather than rejecting, so the tolerance this docblock demands is
 * still exactly what happens. Two rules bind the consumer that reads it, and after #1227 that consumer
 * is the decoder alone. It is
 * held BY REFERENCE off the `JSON.parse` result, so a `__proto__` key is present as an ORDINARY OWN DATA
 * PROPERTY: reading it, spreading it (`{...payload}` uses CreateDataProperty and triggers no setter) and
 * `structuredClone`-ing it across IPC are all inert, while `Object.assign(target, payload)` and a
 * `target[k] = v` copy loop are NOT — those reach the prototype setter and must never be written against
 * this field. And no field of it may become a filesystem path, a filename, a cache key, a lookup path or
 * a raw-markup sink. `MessagePayload` above is the shape a stored operator `message` carries and needs no
 * duplicate; this type deliberately does not narrow into it.
 */
export interface HistoryEntry {
  id: number
  type: string
  payload: Record<string, unknown>
  ts: string
}

/**
 * Inbound `history_page` payload (daemon → client, #1222) — the answer to one `request_history`, and
 * one backward step of a walk. Mirrors the daemon's published shape field-for-field (SSOT pyrycode
 * docs/protocol-mobile.md § Conversation history (v2) → `history_page`).
 *
 * IT NAMES NO CONVERSATION, deliberately — see the `'history_page'` `EnvelopeType` member. The
 * conversation a page describes is resolved in the background process from the envelope it answers, and
 * what crosses to the window is therefore a CLIENT-OWNED id rather than a field of this payload.
 *
 * `entries` are NEWEST-FIRST. Always present: an empty page carries `[]` and never `null` or an omitted
 * key, so a decoder requires the array and admits the empty one.
 *
 * `cursor` is the opaque position to ask again with, EMPTY whenever `at_start` is true — so `''` is a
 * valid value on this side too, and a decoder that required a non-empty one would fail-close every
 * terminal page. The MUST-NOT-PARSE and not-a-capability rules are the request payload's; they bind
 * identically on the value coming back.
 *
 * `at_start` IS THE ONLY TERMINATION SIGNAL. A page that fills EXACTLY at the log's first entry reports
 * `at_start` false with a usable cursor, and the call after it returns no entries with `at_start` true —
 * so a client that stops on an empty page is usually right and is wrong precisely at the boundary. A
 * SHORT PAGE SAYS NOTHING EITHER: the daemon may serve fewer entries than asked for to fit the envelope
 * cap, and `at_start` still reports what the log said for the size actually served. Both fields are
 * therefore carried AS SENT and never normalised into each other. The walk that acts on them is #1224.
 */
export interface HistoryPagePayload {
  entries: HistoryEntry[]
  cursor: string
  at_start: boolean
}

/**
 * Outbound `request_system_prompt` payload (client → daemon, #1230). Mirrors the daemon's
 * internal/protocol/system_prompt.go RequestSystemPromptPayload field-for-field: one
 * `conversation_id`, no `omitempty`, so the key is always on the wire.
 *
 * `conversation_id` is REQUIRED, `RequestModelListPayload`'s rule rather than
 * `RequestSessionSettingsPayload`'s — an unnamed request has nothing to ask about. It is CLIENT-OWNED,
 * read from this app's own conversation state and never off the network, and it is a routing id, NEVER
 * a secret: naming a conversation is not authorization, which is pairing, enforced structurally at the
 * Noise IK handshake. It is an object value in a payload the background process rebuilds from scratch —
 * never a key, a path, a log field, or an attribute.
 *
 * WHERE THIS VERB DIVERGES FROM `request_model_list`, AND WHY IT MATTERS MORE HERE: an unresolvable id
 * on that verb draws a visible `error` frame. This one has NO error path, so an empty id that reached
 * the wire would draw an ordinary-looking `no_session` reply with an absent prompt, and a client's
 * correlation map would file that false "no prompt, no session" reading against a real conversation.
 * Nothing downstream can tell it from a true one. The refusal that keeps such a frame off the wire is
 * the ROUTING LOOKUP at the IPC arm (`router.route(id)?.…`) — deliberately not an emptiness check in
 * the boundary guard or the builder, which check type and shape, as their siblings do.
 */
export interface RequestSystemPromptPayload {
  conversation_id: string
}

/**
 * The three verdicts `system_prompt.session_prompt_status` can carry (#1230), mirroring the daemon's
 * `SystemPromptStatus*` constants. Exactly one is ALWAYS present — the handler sets one on every path,
 * including every unresolvable one, so `''` is not among them and a client has no fourth case to guess
 * at.
 *
 * `no_session` DELIBERATELY MERGES FIVE DAEMON STATES, among them *a conversation this daemon does not
 * host* and *a request that named nothing*. That merge is the verb's entire error handling and it is
 * what stops the verb being a conversation-membership probe: an unhosted conversation's reply is
 * byte-identical to a hosted one holding no prompt and running nothing. READ IT AS ONE READING, never
 * as a failure to repair — a client that tried to separate the merged states back out would rebuild
 * the oracle upstream removed.
 *
 * A CLOSED UNION HERE, which diverges from the deliberately un-allowlisted `SessionSettingsPayload`
 * `permission_mode`, and the divergence is upstream's rather than a style choice. That field's read
 * half carries one mode its write half refuses, so narrowing it client-side would fail-close valid
 * traffic; this one is a published three-value enum with no fourth member and no zero value, so a
 * value outside the set is an off-contract frame and is rejected at the decode rather than folded into
 * one of the three.
 */
export type SessionPromptStatus = 'matches' | 'differs' | 'no_session'

/**
 * Inbound `system_prompt` payload (daemon → client, #1230) — what a conversation's system prompt holds
 * and whether the running session was started with a different one. Mirrors the daemon's
 * internal/protocol/system_prompt.go SystemPromptPayload field-for-field. It names NO conversation; see
 * the `'system_prompt'` `EnvelopeType` member for why that omission is load-bearing.
 *
 * `system_prompt` IS A TRI-STATE AND ALL THREE STATES MUST SURVIVE A ROUND TRIP. The daemon encodes it
 * `*string` with `omitempty`, which tests the POINTER rather than the pointee, so:
 *
 *   key omitted  → no prompt is stored
 *   `""`         → an explicitly empty prompt IS stored
 *   any string   → the stored text
 *
 * Optional here for exactly that reason, and the empty string is the case worth stating twice: a
 * client must be able to read this value and write it straight back through `set_system_prompt`
 * without collapsing "explicitly empty" into "no prompt". A `?? ''`, a `|| undefined`, or any
 * truthiness read anywhere on this path is that collapse. An explicit `system_prompt: null` is
 * OFF-CONTRACT — the daemon's encoding never emits one — and is rejected at the decode rather than
 * read as either absence or emptiness.
 *
 * THE TWO FIELDS ARE INDEPENDENT AND NEITHER MAY BE DERIVED FROM THE OTHER. Text beside `no_session`
 * is the ordinary "configured, applies at the next session start" reading. An ABSENT key beside
 * `matches` is a conversation holding no prompt whose live session spawned with none — the daemon
 * compares the COLLAPSED stored value (`Pool.SystemPromptFor` returns `""` for both no-bytes states by
 * design), so both of them read as `matches` against a session spawned with nothing. Inferring "has
 * bytes" from the key's presence would report a conversation storing an explicitly empty prompt, whose
 * session spawned with none, as *differing* — telling an operator a session is stale that is running
 * exactly what they stored.
 *
 * THE SPAWNED-WITH TEXT IS DELIBERATELY NOT CARRIED. `differs` says the two disagree and stops there,
 * rather than echoing up to another 8192 bytes of operator text back over the wire to prove it.
 *
 * SECURITY: `system_prompt` is UNTRUSTED OPERATOR TEXT arriving over the network. It is a value to be
 * rendered later — never a lookup path, a cache key, a filename, an attribute or a URL, never into a
 * raw-markup sink (no innerHTML / dangerouslySetInnerHTML), and never into a log line or an error
 * message on ANY path, the decode-failure path included. ITS LENGTH IS NOT A CLIENT BRANCH: the daemon
 * caps it write-side at 8192 bytes and this client relies on that bound the way it relies on the
 * daemon's 256-byte bound for `model`; `MAX_PLAINTEXT_BYTES` on the envelope is the only size gate on
 * this path, and a second one invented here would only fail-close a valid future frame.
 */
export interface SystemPromptPayload {
  system_prompt?: string
  session_prompt_status: SessionPromptStatus
}

/**
 * ONE ROW of a `slash_command_list` (daemon → client). Mirrors the daemon's `SlashCommand`
 * field-for-field (SSOT pyrycode docs/protocol-mobile.md § slash_command_list,
 * internal/protocol/interactive.go), wire order `name, argument_hint, description, aliases,
 * truncated_fields` — all always present (no `omitempty` on any of them). The per-entry key set is
 * COMPLETE and measured, not assumed: against the capture
 * internal/e2e/realclaude/testdata/initialize_control_v2.1.239.json those four are claude's entire
 * per-entry vocabulary, 42 of the 51 entries carrying the first three and the other 9 all four.
 *
 * NAMED `WireSlashCommand`, NOT `SlashCommand`, deliberately — twice over, so the prefix is not read
 * as decoration. `Wire` is this cluster's prefix for a nested row whose bare name is generic enough to
 * be wanted again downstream (`WireQuestion`, `WireQuestionOption`, `WireModalOption`), and both
 * consumers will want one: #936's decode and #681's Actions-menu match. And `QuestionShownPayload`'s
 * doc comment above names `SlashCommand` as the DAEMON's Go type; leaving the bare name unclaimed here
 * keeps that reference — and the identical one in
 * docs/knowledge/features/question-shown-wire-types.md — pointing where it always did.
 *
 * `argument_hint` is ALWAYS PRESENT and EMPTY ON 33 OF THE CAPTURE'S 51 ENTRIES, so an empty hint is
 * the ordinary case rather than missing data. `name` carries no leading `/` and is NOT AN IDENTIFIER —
 * one measured name is `__remote-workflow` — so no charset assumption belongs in a client and nothing
 * may key a cache, a memo or a lookup path by it. `description` is a one-line summary except when it
 * is not one line; see the security note below.
 *
 * `aliases` IS A PLAIN ARRAY AND NEVER `string[] | null`, but NOT for `commands`' reason, and the
 * asymmetry is upstream's rather than an accident (both normalisations live in interactive.go, each
 * with its own argument). For `commands`, `[]` is a POSITIVE STATEMENT. Here `[]` is a COLLAPSE, and
 * that is measured: claude never sends `"aliases": []` — zero of the 51 entries carry an empty array,
 * 42 omit the key and 9 carry a non-empty one — so an entry with no aliases and an entry with the key
 * absent are the same statement, and the wire states ONE position for both rather than making every
 * row branch on absent-versus-empty to match an alias.
 *
 * **A CUT `aliases` IS UNKNOWABLE FROM `aliases` ALONE — the one place that collapse costs a reader.**
 * Because absent and empty arrive as the same `[]`, a `truncated_fields` NAMING `aliases` is the ONLY
 * signal separating "cut to nothing" from "none", and it must be read as UNKNOWN, never as *no
 * aliases*. Reading it as "none" greys out a working command: the desktop Actions menu's own `reset`
 * entry is an ALIAS of `clear` and not a command name (#681), and 11 aliases span 9 of the 51 entries.
 * **That rule is only sound on a VALIDATED frame**, which is the trap this type cannot close on its
 * own: reached through a bare `as` on `Envelope.payload`, a frame whose `truncated_fields` key is
 * absent yields `undefined`, and `row.truncated_fields?.includes('aliases')` is then falsy for exactly
 * the reason `null` is — the reader concludes nothing was cut and reads `[]` as "none", the one wrong
 * answer this paragraph exists to prevent. NULLABLE IS NOT OPTIONAL; go through #936's narrower.
 *
 * `truncated_fields` names THIS ROW'S OWN cut fields (`name`, `argument_hint`, `description`,
 * `aliases` — the wire names), and `null` means NOTHING WAS CUT for this row, a distinct value from
 * `[]` and never to be collapsed into it. Each row reports its own: there is no hoisted or flattened
 * list anywhere on this frame. This is `BackgroundTask.truncated_fields` exactly, including the trap
 * that within one payload `commands: null` is out of contract while a row's `truncated_fields: null`
 * is a valid value — the daemon's marshaller normalises the first and deliberately not the second. The
 * element vocabulary is a plain `string[]` and is NOT narrowed to those four names, for the reason
 * `BackgroundTask` records: each frame's set is its own, and a closed one would fail-close a valid
 * future frame. A cut here is real rather than theoretical — the longest measured description is 1,145
 * bytes against a mean of 207, and 10 of 51 exceed 256.
 *
 * SECURITY — `name`, `argument_hint`, `description` and EVERY STRING IN `aliases` are
 * WORKSPACE-AUTHORED: whoever wrote the repository wrote them. That is a LOWER trust tier than the
 * claude-authored strings `model_list` and `QuestionShownPayload` carry, not a restatement of it. The
 * daemon BOUNDS THEM AND DOES NOT SANITIZE THEM — nothing on the path strips control characters or
 * terminal escape sequences — so they stay untrusted text all the way here and THE RENDER BOUNDARY
 * THAT OWES THE SANITIZATION IS THIS CLIENT'S. Safe to render as inert, escaped, length-bounded text;
 * never into a raw-markup sink (no `innerHTML`, no `dangerouslySetInnerHTML`), an attribute, a URL, a
 * filename, a cache key, a lookup path, or a log (CLAUDE.md's daemon-text ruling in full). The log
 * clause bites harder on THIS path than on its neighbours and the reason is measured: `0x0a` is the
 * ONLY sub-`0x20` byte anywhere across the 51 entries' four string fields, so the control character
 * that actually occurs is the one that splits a log line — logging a description would let a workspace
 * author forge log records, and a type-ahead row assuming one line per description will not get one.
 */
export interface WireSlashCommand {
  name: string
  argument_hint: string
  description: string
  aliases: string[]
  truncated_fields: string[] | null
}

/**
 * Inbound `slash_command_list` event (daemon → client). Mirrors the daemon's SlashCommandListPayload
 * field-for-field (same SSOT), wire order `conversation_id, commands, dropped_commands` — all always
 * present (no `omitempty`). The slash commands claude will accept for this conversation IN THIS
 * WORKING DIRECTORY, drawn from the `commands` array of the same `initialize` control reply
 * `model_list` comes from: that one inventories the IDENTITIES claude will run as, this one the VERBS.
 *
 * **Wire vocabulary only.** Nothing decodes, narrows, stores or renders this yet — the fail-closed
 * parse is #936, the Actions-menu alias match #681. Upstream's producer landed ahead of both (#2001
 * maps it, #2002 bounds it, #2003 emits it on the live interactive lane, #2004–#2007 retain and
 * reconcile it on connect), so unlike `question_shown` this shape arrives to traffic that already
 * exists.
 *
 * `commands` IS A PLAIN ARRAY AND NEVER `WireSlashCommand[] | null`: the daemon's `MarshalJSON`
 * normalises a nil slice to `[]`, and `omitempty` is deliberately out because eliding the key would
 * erase the frame's point. AN EMPTY `[]` IS A POSITIVE STATEMENT THAT CLAUDE OFFERED NOTHING, so a
 * client decoding into a non-optional array type never has to branch on null. Note the contrast with
 * `QuestionShownPayload.questions`, whose empty array is OUT OF CONTRACT and means a producer bug —
 * the two read alike and say opposite things.
 *
 * **`dropped_commands` IS COUNTED AND CARRIED, so `commands.length + dropped_commands` IS THE MENU'S
 * TRUE SIZE.** The published section still states the opposite twice — "nothing counts it", and an
 * explicit instruction not to read that sum — and that prose is STALE: the decode's entry cap and its
 * count landed upstream in #1826, and #2002 adds its own frame-level cut to the same field rather than
 * recomputing it, so the number arrives already summed over both. The doc correction is pyrycode#2010,
 * still open at 2026-09-02; the section's two FIELD TABLES remain SSOT throughout, its status prose is
 * not. A COUNT is carried rather than a name because a name-only report loses HOW MANY were lost;
 * per-row text cuts are a property of one row and ride that row's own `truncated_fields`, so there is
 * deliberately no hoisted `truncated_fields` here. `dropped_commands: 0` is a VALUE, never consulted
 * for truthiness — the key is always written, so an absent one is a real defect rather than a valid
 * zero.
 *
 * **THE COUNT IS WORKSPACE- AND VERSION-DEPENDENT, so no client may cache one**, assume a floor, or
 * treat a small list as an error: 51 entries against claude 2.1.239 in one repository, 74 hand-counted
 * against 2.1.220 in another. That variation is the feature's whole point. No bound is modelled here
 * for `BackgroundTaskRosterPayload`'s reason — the enforcement is the daemon's, and a second copy
 * would be a second bound to keep in agreement — and the frame cannot arrive unbounded regardless:
 * MAX_PLAINTEXT_BYTES caps the decrypted envelope before any parse, against 14,277 bytes of compact
 * UTF-8 for the whole measured 51.
 *
 * NOT A TURN-STREAM ITEM: it rides a `control_response`, opens and closes no turn, and carries no
 * `turn_id`. It is a SNAPSHOT that REPLACES a reader's view of the menu, never a delta amending it.
 * Hence it keeps `conversation_id` — daemon state keyed by id — which is an OUTBOUND routing/scoping
 * key only, exactly as `modal_shown`'s and `question_shown`'s are, granting no inbound capability. It
 * is not a nonce: nothing here is unguessable and nothing here is a secret.
 *
 * THE FRAME IS A REPORT, NEVER A CONTROL INPUT — with one amendment a client needs, because the
 * unqualified rule reads as forbidding the feature. A client IS meant to send a `name` BACK, as the
 * text of an ordinary message, since sending the slash command is the point. Publishing a name does
 * not make it trusted: it arrives inbound as ordinary message text, on a path that does not treat it
 * as a command vocabulary and does not consult this list, and no field here reaches a child process as
 * an argv element. This frame DECLARES NO INBOUND VERB.
 *
 * Every field being required is load-bearing: it leaves #936's fail-closed narrower no optional key to
 * wave through, so a missing field is a reject by construction. **A required field is still only a
 * promise the wire has not kept until it is checked** — reach this type through that narrower, never a
 * bare `as SlashCommandListPayload` on `Envelope.payload`, which would hand a `.map` a non-array from
 * a malformed frame and would silently invert `WireSlashCommand`'s cut-aliases rule above.
 */
export interface SlashCommandListPayload {
  conversation_id: string
  commands: WireSlashCommand[]
  dropped_commands: number
}

/**
 * Outbound `list_conversations` request body (client → daemon). Empty by spec — mirrors the daemon's
 * ListConversationsPayload `struct{}` (pyrycode internal/protocol/conversations_read.go). Documentary:
 * the bare builder (listConversationsEnvelope.ts) emits `payload: {}` directly and does not import
 * this type; it exists to name the wire contract, exactly as `request_debug_bundle` has no payload
 * struct. See #139.
 */
export type ListConversationsPayload = Record<string, never>

/**
 * One row of a `conversations` reply. Mirrors the daemon ConversationSummary field-for-field
 * (conversations_read.go, post-#880), wire order below — all always present, no `omitempty`.
 * `name` is `string | null`: a literal `null` (never absent) is a distinct "unnamed scratch
 * conversation", NOT an empty string. `is_promoted` (`true` = a saved channel, `false` = an ad-hoc
 * discussion) and `is_archived` are booleans (`false` is a value, not an absence). "Discussion vs
 * channel" is DERIVED from `is_promoted` downstream — there is no `kind` enum on the wire.
 * `last_message_ts` is a TIMESTAMP (RFC3339), not preview text — there is no message text on this
 * wire. `cwd` is an untrusted daemon-supplied string carried as opaque display text; this ticket
 * never resolves it into a filesystem path. See #139.
 *
 * `workspace_label` (#1287, daemon pyrycode#2208) is the name the workspace has been GIVEN on the
 * daemon, stored against the exact `cwd` string — so every row sharing a `cwd` carries the same value.
 * `string | null` with NO `omitempty`, the `name` contract exactly: a literal `null` is the VALUE
 * "this workspace has no label, use the folder name", and an ABSENT key is a contract violation that
 * fails the decode closed. It shares `cwd`'s untrusted-opaque-display-text posture and differs from it
 * in one way worth stating: `cwd` is a PATH and this is a NAME, so it has no segment structure and
 * nothing may parse it — it is neither split, resolved, nor used as a lookup key.
 *
 * `is_muted` (#1594) is whether the host has muted this conversation's notifications. The daemon
 * always writes it, but a daemon predating the field omits it, and such a row must keep notifying,
 * so absence means NOT muted. The decoder normalises an absent key to `false`; the field is optional
 * in this type so a row built elsewhere (the saved-list cache of an older build, a test fixture)
 * carries the same meaning by omission. Read it as `row.is_muted === true`.
 *
 * `agent` (#1649, daemon pyrycode#2643) is which agent runs this conversation, sent only to a client
 * that advertised `multi_agent` — so absent for this app today and for an old daemon. Held through
 * `agentFromWire`, never as the daemon's own string; read it through `agentFromWire` too, so an absent
 * key counts as Claude.
 */
export interface ConversationSummary {
  id: string
  name: string | null
  is_promoted: boolean
  is_archived: boolean
  is_muted?: boolean
  agent?: WireAgent
  cwd: string
  last_message_ts: string
  last_used_at: string
  /** Archive instant from daemon PR #2700; optional for legacy snapshots and fixtures. */
  archived_at?: string | null
  workspace_label: string | null
}

/** Inbound list reply: decoding preserves wire order; individual views derive their own order. */
export interface ConversationsPayload {
  conversations: ConversationSummary[]
}

/**
 * One row of a `recent_workspaces_list` reply (daemon → client). Mirrors the daemon's recent-workspace
 * row field-for-field (pyrycode #888), wire order `path, last_used_at` — both always present, no
 * `omitempty`. `path` is an untrusted daemon-supplied workspace path carried as OPAQUE DISPLAY TEXT:
 * this client never resolves it into a filesystem path (the ConversationSummary.cwd #139 posture).
 * `last_used_at` is an OPAQUE RFC3339 string left UNPARSED — relative-time formatting is a downstream
 * (#382) UI concern, so no parser is ever fed this untrusted value here. See #380. */
export interface RecentWorkspace {
  path: string
  last_used_at: string
}

/** Inbound `recent_workspaces_list` reply body (daemon → client). `workspaces` is ALWAYS present
 *  (empty → `[]`, never absent, never null). Order preserved from the wire — the daemon is the source
 *  of truth for ordering (distinct paths, most-recent-first). See #380. */
export interface RecentWorkspacesPayload {
  workspaces: RecentWorkspace[]
}

/**
 * Outbound `create_conversation` request body (client → daemon). Mirrors the daemon's
 * CreateConversationPayload field-for-field (internal/protocol/conversations_write.go, spec #274),
 * wire order `is_promoted, name, cwd` — all three server-defaultable.
 *
 * **Nullable-and-PRESENT, not optional.** The daemon's struct uses `*T` WITHOUT `omitempty`, so each
 * key is always on the wire with an explicit `null` (its "take the server default — let the daemon
 * choose" signal). These fields are therefore `T | null` (present, nullable), NOT `T | undefined`
 * (optional/omitted). This is the deliberate OPPOSITE of the `Envelope.in_reply_to?` convention above
 * ("never emit null"): here the daemon contract REQUIRES `null` on the wire, and CLAUDE.md no-drift
 * wins. Do NOT "fix" these to `?:` — an omission would drop the key and change the wire meaning.
 *
 * `agent` (pyrycode#2647), `model` and `effort` (pyrycode#2665) are the opposite: OPTIONAL, because
 * the daemon's pointers carry `omitempty`. An absent key keeps the daemon's choice, and a request
 * without them encodes byte-identically to one sent before they existed (#1652). The daemon checks
 * `model` and `effort` against the resolved agent's vocabulary, so the client only checks their type.
 */
export interface CreateConversationPayload {
  is_promoted: boolean | null
  name: string | null
  cwd: string | null
  agent?: WireAgent
  model?: string
  effort?: string
}

/**
 * Inbound `conversation_created` reply body (daemon → client). Mirrors the daemon's
 * ConversationCreatedPayload field-for-field (conversations_write.go, spec #274), wire order
 * `id, is_promoted, cwd, name, last_used_at` — all always present (no `omitempty`).
 *
 * Its OWN 5-field shape — deliberately NOT `ConversationSummary` (7 fields): the daemon does NOT send
 * `is_archived` or `last_message_ts` on a create reply (spec #274 excludes the reuse). `name` is
 * `string | null` exactly like `ConversationSummary.name`: a literal `null` (never absent) is a distinct
 * "unnamed scratch conversation", NOT an empty string. `is_promoted` is a boolean (`false` = an ad-hoc
 * discussion, a value, not an absence). `cwd` is an untrusted daemon-supplied string carried as opaque
 * display text; this ticket never resolves it into a filesystem path. `last_used_at` is RFC3339. See #241.
 *
 * `workspace_label` (#1287) joins the shape with ConversationSummary's contract verbatim — required,
 * nullable, no `omitempty`, untrusted opaque display text that nothing parses. A created row lands in a
 * workspace group like any other, so it has to carry the group's name for that group to keep it.
 *
 * `agent` (#1649) is `ConversationSummary.agent`'s contract verbatim: optional, held through
 * `agentFromWire`.
 */
export interface ConversationCreatedPayload {
  id: string
  is_promoted: boolean
  cwd: string
  name: string | null
  last_used_at: string
  workspace_label: string | null
  agent?: WireAgent
}

/**
 * Outbound `promote_conversation` request body (client → daemon). Mirrors the daemon's
 * PromoteConversationPayload field-for-field (internal/protocol/conversations_write.go, spec #274),
 * wire order `conversation_id, name, cwd`.
 *
 * **REQUIRED value-strings — the deliberate OPPOSITE of CreateConversationPayload.** Where create's
 * three fields are `T | null` (nullable-and-present — "take the server default"), promote's three are
 * plain `string`: a promoted conversation MUST carry a real name and an effective cwd, and the id MUST
 * resolve to an existing row, so the daemon's struct uses value-strings (no pointers, no `omitempty`).
 * Do NOT "helpfully" relax these to nullable — that would drift the wire from the daemon contract
 * (CLAUDE.md no-drift). `cwd` is a renderer-supplied string that becomes a working directory
 * SERVER-side; the desktop never resolves it into a filesystem path. See #273.
 */
export interface PromoteConversationPayload {
  conversation_id: string
  name: string
  cwd: string
}

/**
 * Outbound `archive_conversation` request body (client → daemon). The mirror-image twin of
 * UnarchiveConversationPayload (archive SETS the durable archived flag; unarchive clears it). Mirrors the
 * daemon's shared ArchiveConversationPayload{ConversationID string} field-for-field (pyrycode#881) — the
 * one struct serving BOTH verbs — so this is its direct name-mirror. Kept a DISTINCT type (not an alias of
 * UnarchiveConversationPayload) so each verb owns its own five-site wire surface and the two can evolve
 * independently if the daemon ever forks them.
 *
 * **A single REQUIRED value-string.** JSON key `conversation_id`, a plain `string` (no pointer, no
 * `omitempty`) — the id of an existing conversation row whose durable archived flag the daemon SETS (the
 * opposite of unarchive's clear), persisting eagerly and confirming with a `conversation_updated` record
 * reflecting the archived state. One required string, so no explicit-`null` concern. `conversation_id` is
 * a routing id (an existing row's id), not a secret; the desktop never resolves it into a filesystem path.
 * Do NOT drift it (CLAUDE.md no-drift): change only alongside a daemon/mobile change. See #363.
 */
export interface ArchiveConversationPayload {
  conversation_id: string
}

/**
 * Outbound `unarchive_conversation` request body (client → daemon). Mirrors the daemon's shared
 * ArchiveConversationPayload{ConversationID string} field-for-field (pyrycode#881) — the one struct
 * serving BOTH the archive and unarchive verbs; desktop wires only unarchive here (#346), so a single
 * UnarchiveConversationPayload is the right desktop surface.
 *
 * **A single REQUIRED value-string.** JSON key `conversation_id`, a plain `string` (no pointer, no
 * `omitempty`) — the id of an existing conversation row whose durable archived flag the daemon clears,
 * persisting eagerly and confirming with a `conversation_updated` record reflecting the restored (active)
 * state. Simpler than PromoteConversationPayload's three fields — one required string, so no explicit-`null`
 * concern. `conversation_id` is a routing id (an existing row's id), not a secret; the desktop never
 * resolves it into a filesystem path. Do NOT drift it (CLAUDE.md no-drift): change only alongside a
 * daemon/mobile change. See #346.
 */
export interface UnarchiveConversationPayload {
  conversation_id: string
}

/**
 * Outbound `delete_conversation` request body (client → daemon). The PERMANENT hard-delete verb
 * (pyrycode#822): unlike archive/unarchive — which flip a durable soft-state flag on a row that
 * survives — delete removes the conversation row outright. Independent of the archive/unarchive pair.
 * Kept a DISTINCT type (not an alias of UnarchiveConversationPayload) so the verb owns its own
 * five-site wire surface and the two can evolve independently — the same rationale the archive/unarchive
 * doc-comments already state.
 *
 * **A single REQUIRED value-string.** JSON key `conversation_id`, a plain `string` (no pointer, no
 * `omitempty`) — the id of an existing conversation row the daemon **permanently deletes**. One required
 * string, so no explicit-`null` concern. `conversation_id` is a routing id (an existing row's id), not a
 * secret; the desktop never resolves it into a filesystem path. The daemon does NOT reply
 * `conversation_updated`; it replies with a distinct `conversation_deleted { id }` record correlated to
 * the requester (`in_reply_to`), with no broadcast — decoding that reply and reflecting the removal via
 * an explicit re-list are owned by the Delete-action caller (#367), NOT here. Do NOT drift it (CLAUDE.md
 * no-drift): change only alongside a daemon/mobile change. See #364.
 */
export interface DeleteConversationPayload {
  conversation_id: string
}

/**
 * Outbound `rename_conversation` request body (client → daemon). Mirrors the daemon's
 * RenameConversationPayload{ConversationID, Name string} field-for-field (pyrycode#820), wire order
 * `conversation_id, name`.
 *
 * **Two REQUIRED value-strings** — the same posture as PromoteConversationPayload (plain `string`, no
 * pointer, no `omitempty`), but with **no `cwd`**: rename is a DELIBERATE non-reuse of
 * PromoteConversationPayload (promote carries a third required `cwd`, which a rename neither has nor
 * means; #820). Do NOT fold rename into the promote payload. `conversation_id` is a routing id (an
 * existing row's id), not a secret, never resolved into a filesystem path; `name` is renderer-supplied
 * display text that becomes the conversation's stored name SERVER-side — the desktop never resolves it
 * anywhere. An empty/whitespace `name` is a valid string on the wire (the daemon's own trim-guard leaves
 * a blank rename's stored name untouched); do NOT add a client-side emptiness check. Two required
 * strings, so no explicit-`null` concern. Do NOT drift it (CLAUDE.md no-drift): change only alongside a
 * daemon/mobile change. See #359.
 */
export interface RenameConversationPayload {
  conversation_id: string
  name: string
}

/**
 * Outbound `change_workspace` request body (client → daemon). Mirrors the daemon's
 * ChangeWorkspacePayload{ConversationID, Cwd string} field-for-field (pyrycode #823), wire order
 * `conversation_id, cwd`.
 *
 * **Two REQUIRED value-strings** — the same posture as RenameConversationPayload (plain `string`, no
 * pointer, no `omitempty`), but the second field is `cwd` (the target workspace path), NOT `name`. The
 * field tag is **`cwd`, not `workspace`** — the daemon flagged this as the single `cwd`-vs-`workspace`
 * reconcile point and the merged daemon uses `cwd`, matching PromoteConversationPayload /
 * ConversationCreatedPayload. Do NOT drift it (CLAUDE.md no-drift): change only alongside a daemon/mobile
 * change. `conversation_id` is a routing id (an existing row's id), not a secret. `cwd` is a
 * renderer-supplied string that becomes a working directory SERVER-side — the desktop never resolves it
 * into a filesystem path (reuses the PromoteConversationPayload.cwd posture). An empty `cwd` is a valid
 * string on the wire (the daemon polices the path server-side); do NOT add a client-side emptiness check.
 * Two required strings, so no explicit-`null` concern. Kept a DISTINCT type (not an alias of any sibling)
 * so the verb owns its own wire surface. The daemon confirms with the existing `conversation_updated`
 * record (already decoded — no new inbound type here). See #379.
 */
export interface ChangeWorkspacePayload {
  conversation_id: string
  cwd: string
}

/**
 * Outbound `set_system_prompt` request body (client → daemon, #1249). Mirrors the daemon's
 * SetSystemPromptPayload{ConversationID string, SystemPrompt *string} field-for-field
 * (pyrycode#2151), wire order `conversation_id, system_prompt`. Kept a DISTINCT type — not an alias of
 * ChangeWorkspacePayload or ArchiveConversationPayload despite the shared first field — so the verb
 * owns its own wire surface, the daemon's own standing rule in this neighbourhood.
 *
 * `conversation_id` is a REQUIRED value-string, the sibling posture: a routing id (an existing row's
 * id), not a secret, and not emptiness-checked here — an id no server hosts is refused by the routing
 * lookup at the IPC arm before any frame is built.
 *
 * **`system_prompt` IS A TRI-STATE, AND IT IS `string | null` RATHER THAN `string | undefined`.** The
 * daemon declares it `*string` with **no** `omitempty`, so a nil pointer serializes as a literal
 * `null` and never as an absent key — exactly the mirroring ConversationUpdatedPayload.name already
 * uses in this file. The three states, and all three must survive the whole chain intact:
 *
 * | Value | Meaning |
 * |---|---|
 * | `null` | CLEAR. The conversation returns to spawning with the daemon's own prompt alone. |
 * | `''` | Explicitly empty — a DISTINCT stored state, which spawns identically to cleared. |
 * | any string | Stored verbatim, up to MAX_SYSTEM_PROMPT_BYTES inclusive. |
 *
 * DECLARED AS A REQUIRED KEY, not an optional property, and that is load-bearing rather than
 * stylistic. An optional property would give the tri-state a fourth inhabitant (`undefined`) with no
 * defined reading, and it invites the `?? ''` / `|| undefined` collapse that would fold "clear" into
 * "explicitly empty" — the exact collapse SystemPromptPayload's read-half contract forbids, and the
 * reason a value read back through `system_prompt` can be written straight back through this one
 * unchanged. A plain `string` at ANY hop on this path makes the clear path unreachable.
 *
 * SECURITY: `system_prompt` is UNTRUSTED OPERATOR TEXT on its way to the network — the mirror of the
 * read half's inbound rule, and it binds just as hard outbound. It is never a log argument (nor is its
 * length), never a path component, never a filename or a cache key, and the envelope payload is a
 * FRESH LITERAL naming exactly these two fields rather than a spread of a caller's object. Do NOT
 * drift it (CLAUDE.md no-drift): change only alongside a daemon/mobile change. See #1249.
 */
export interface SetSystemPromptPayload {
  conversation_id: string
  system_prompt: string | null
}

/**
 * Outbound `set_conversation_muted` request body (client → daemon, #1595). Mirrors the daemon's
 * payload `{conversation_id, muted}` field-for-field (pyrycode#2572). Both keys are REQUIRED: the daemon
 * refuses a payload without `muted`, so `false` must reach the wire as a present key. A distinct type
 * so the verb owns its wire surface. Do NOT drift it without a daemon/mobile change.
 */
export interface SetConversationMutedPayload {
  conversation_id: string
  muted: boolean
}

/**
 * Outbound `create_workspace_folder` request body (client → daemon). Mirrors the daemon's
 * CreateWorkspaceFolderPayload{Parent, Name string} field-for-field (pyrycode #887), wire order
 * `parent, name`.
 *
 * **Two REQUIRED value-strings** — the same posture as ChangeWorkspacePayload (plain `string`, no
 * pointer, no `omitempty`), rekeyed to `parent` (the containing directory) + `name` (a single folder
 * name). `parent`/`name` are renderer-supplied strings the daemon polices SERVER-side ($HOME
 * confinement + a single-clean-element name guard — #887's two deterministic gates); the desktop
 * NEVER resolves them into a local filesystem path (they are serialized to wire bytes only). An empty
 * `parent` / a bad `name` (a separator, `..`, an absolute path, or empty) is a valid string on the
 * wire — the daemon rejects it as `malformed`; do NOT add a client-side check. Kept a DISTINCT type
 * (not an alias of any sibling) so the verb owns its own wire surface. Do NOT drift it (CLAUDE.md
 * no-drift): change only alongside a daemon/mobile change. See #381.
 */
export interface CreateWorkspaceFolderPayload {
  parent: string
  name: string
}

/**
 * Inbound `workspace_folder_created` reply body (daemon → client). Mirrors the daemon's
 * WorkspaceFolderCreatedPayload{Path string} field-for-field (pyrycode #887).
 *
 * ITS OWN single-field shape — deliberately NOT RecentWorkspace (which adds `last_used_at`) nor a
 * conversation type: the created reply is `path`-only. `path` is the created folder's canonical
 * daemon-side path, an untrusted REMOTE path carried as OPAQUE DISPLAY TEXT: this client never
 * `fs`- / `path.resolve`-s it and never logs its value (the RecentWorkspace #380 /
 * ConversationSummary.cwd #139 posture). A DIRECT reply to the requester (correlated by
 * `Envelope.in_reply_to`), no broadcast, no `conversation_id`. Do NOT drift it (CLAUDE.md no-drift):
 * change only alongside a daemon/mobile change. See #381.
 */
export interface WorkspaceFolderCreatedPayload {
  path: string
}

/**
 * Inbound `workspace_updated` body (daemon → client). Mirrors the daemon's
 * WorkspaceUpdatedPayload{Path string; Label *string} field-for-field (pyrycode#2209), wire order
 * `path, label`.
 *
 * BOTH SHAPES ARE REAL TRAFFIC: the daemon correlates this frame by `in_reply_to` to the client that
 * asked for the rename, and pushes it UNSOLICITED to every other connected interactive client. A client
 * that never asked still receives it, which is the whole point — a rename from anywhere lands everywhere.
 *
 * ITS OWN two-field shape, deliberately not an alias of any sibling: the verb owns its wire surface (the
 * standing rule in this neighbourhood). `path` takes WorkspaceFolderCreatedPayload.path's posture — the
 * workspace's canonical daemon-side path, an untrusted REMOTE path carried as OPAQUE DISPLAY TEXT that
 * this client never `fs`- / `path.resolve`-s, never keys a lookup on, and never logs the value of.
 * `label` takes ConversationUpdatedPayload.workspace_label's contract verbatim — `string | null` (the
 * daemon uses `*string` WITHOUT `omitempty`, so a cleared label is a literal `null` and NEVER an absent
 * key), untrusted opaque display text that nothing parses. An EMPTY string is a value, not an absence.
 *
 * NOTHING IN THIS CLIENT READS EITHER FIELD, and that is by design rather than by omission. The frame is
 * a REFRESH TRIGGER: it re-requests the conversation list, and the label that reaches the sidebar rides
 * the authoritative `conversations` reply on `ConversationSummary.workspace_label`. Do NOT patch a row
 * from these fields — that would put untrusted daemon text on screen bypassing the list decode path.
 * Do NOT drift it (CLAUDE.md no-drift): change only alongside a daemon/mobile change. See #1288.
 */
export interface WorkspaceUpdatedPayload {
  path: string
  label: string | null
}

/**
 * Outbound `rename_workspace` request body (client → daemon, #1289). Mirrors the daemon's
 * RenameWorkspacePayload{Path string; Label *string} field-for-field (pyrycode#2209), wire order
 * `path, label`.
 *
 * ITS OWN TYPE, NOT AN ALIAS OF `WorkspaceUpdatedPayload` above, whose field set is identical. That is
 * the standing rule in this neighbourhood — the verb owns its wire surface — and it is load-bearing
 * rather than stylistic here: an alias would couple an outbound REQUEST to an inbound RECORD that is
 * free to drift, and the two are read by opposite halves of the client (this one is only ever written,
 * that one only ever decoded).
 *
 * `path` is the workspace to rename, and the daemon requires it to equal a stored conversation's `cwd`
 * BYTE FOR BYTE — an exact-equality lookup, never a path join — so a `../`-laden value is answered
 * `workspace.not_found` rather than traversing anything. `label` is the new name, `string | null` with
 * NO `omitempty`: a literal `null` is the VALUE "clear this workspace's label" and an ABSENT key is a
 * contract violation the daemon rejects as malformed, so the sender must name the key unconditionally.
 *
 * BOTH ARE RENDERER-SUPPLIED STRINGS SERIALIZED TO WIRE BYTES ONLY. This client never resolves `path`
 * into a local filesystem path, never keys a lookup on either field, and never logs either value. The
 * daemon polices the whole contract server-side — exact-`cwd` match, a non-empty-after-trim label of at
 * most 128 characters — and this client adds NO path or length check of its own: re-implementing a
 * daemon rule here is how the two drift (the `CreateWorkspaceFolderPayload` #887 posture verbatim).
 *
 * Do NOT drift it (CLAUDE.md no-drift): change only alongside a daemon/mobile change. See #1289.
 */
export interface RenameWorkspacePayload {
  path: string
  label: string | null
}

/**
 * Inbound `conversation_updated` reply body (daemon → client, BROADCAST). Mirrors the daemon's
 * ConversationUpdatedPayload field-for-field (conversations_write.go, spec #274), wire order
 * `id, is_promoted, name, cwd, last_used_at` — note `name` comes BEFORE `cwd` here (the intentional
 * reordering vs. ConversationCreatedPayload's `cwd, name`; spec #274 flags it — mirror it).
 *
 * NOT correlated to its `promote_conversation` via `in_reply_to`: the daemon fans this out to every
 * client on the server-id (the `assistant_delta` pattern, an unsolicited event). `is_promoted` is
 * `true` after a promote (a boolean value, never an absence). `name` is `string | null` (a literal
 * `null`, never absent — the daemon uses `*string` WITHOUT `omitempty`), exactly like
 * ConversationSummary.name — NOT `string | undefined`. `cwd` is an untrusted daemon-supplied string
 * carried as opaque display text; this ticket never resolves it into a filesystem path. `last_used_at`
 * is RFC3339. See #273.
 *
 * `workspace_label` (#1287) joins the shape with ConversationSummary's contract verbatim — required,
 * nullable, no `omitempty`, untrusted opaque display text that nothing parses. This arm is the LIVE path
 * for a label change: it is an unsolicited broadcast, so a label set from another client reaches the
 * sidebar here without a fresh list request.
 */
export interface ConversationUpdatedPayload {
  id: string
  is_promoted: boolean
  name: string | null
  cwd: string
  last_used_at: string
  workspace_label: string | null
}

/**
 * Inbound `conversation_deleted` reply body (daemon → client). The permanent-delete confirmation
 * (pyrycode#822): unlike `conversation_updated` — an UNSOLICITED BROADCAST the daemon fans out on
 * archive/unarchive/promote — a delete is confirmed with a distinct, CORRELATED record (matched to the
 * requester by `Envelope.in_reply_to`, with NO broadcast). The deliberate contrast with
 * ConversationUpdatedPayload above; do not conflate the two.
 *
 * **A single REQUIRED value-string.** JSON key `id` — the id of the row the daemon deleted. Note the
 * reply field is **`id`**, distinct from the request's `conversation_id` (DeleteConversationPayload):
 * do NOT drift it to match the request (CLAUDE.md no-drift; pyrycode#822). Exactly one field — this is
 * NOT ConversationUpdatedPayload's five-field / nullable-`name` shape. `id` is a routing id (an existing
 * row's id), not a secret; the desktop never resolves it into a filesystem path. Do NOT drift it: change
 * only alongside a daemon/mobile change. See #375.
 */
export interface ConversationDeletedPayload {
  id: string
}

/**
 * One ordered slice of a streamed debug bundle (daemon → client). Mirrors the daemon's
 * DebugBundleChunkPayload{Seq int; Data []byte} field-for-field: `seq` is 0-based, contiguous,
 * ascending, and `data` is the raw bundle slice as standard base64 on the wire (Go's `[]byte`
 * auto-encodes std base64 via encoding/json). The archive is an opaque `.tar.gz`; the receiver
 * concatenates the decoded `data` in `seq` order and never inspects it. See ADR 0002.
 */
export interface DebugBundleChunkPayload {
  seq: number
  data: string
}

/**
 * The completion marker sent after the last debug_bundle_chunk (daemon → client). Mirrors the
 * daemon's DebugBundleDonePayload{Total int}: `total` is the exact number of chunk frames in the
 * stream, so a `total` that does not equal the count actually received is a truncation error,
 * never accepted as complete. See ADR 0002.
 */
export interface DebugBundleDonePayload {
  total: number
}

/**
 * The MANDATED per-chunk stride: 45000 RAW bytes of `data` BEFORE base64 — not base64 characters,
 * not payload bytes, not envelope bytes. A sender that reads it as base64 characters emits frames
 * that fit and wastes a quarter of every one.
 *
 * It is a stride, not a ceiling to fit under. The receiver never inspects the stride: it checks the
 * two declared numbers against each other and refuses any transfer where
 * `total_chunks != max(1, ceil(size / 45000))` (pyrycode #1776). So a sender that chunks at its own
 * buffer size and declares the count that follows from THAT stride is refused at admission, while
 * one that declares the formula's count but emits a different stride clears admission and then fails
 * on the assembled length. Neither is a frame-size problem — every such frame fits comfortably.
 *
 * 45000 is chosen so a chunk's serialized envelope (base64 x4/3 = exactly 60000 characters, since
 * 45000 divides by 3, plus every metadata field at its bound with worst-case JSON escaping) stays
 * under MAX_PLAINTEXT_BYTES. That cap is a producer-side contract with no validator: an over-cap
 * envelope is rejected by the transport with `message.too_long`, never with an `attachment.*` code.
 */
export const ATTACHMENT_CHUNK_DATA_BYTES = 45000

/** Ceiling on `attachment_id`, in BYTES of encoded UTF-8 — not runes. Documented, not validated. */
export const ATTACHMENT_ID_MAX_BYTES = 64

/** Ceiling on `filename`, in BYTES of encoded UTF-8 — not runes. Documented, not validated. */
export const ATTACHMENT_FILENAME_MAX_BYTES = 255

/** Ceiling on `mime_type`, in BYTES of encoded UTF-8 — not runes. Documented, not validated. */
export const ATTACHMENT_MIME_TYPE_MAX_BYTES = 255

/**
 * One slice of an attachment transfer. The CONTRAST with DebugBundleChunkPayload above is the thing
 * to hold onto: bundle chunks demand contiguous ascending `seq` and are APPENDED, attachment chunks
 * are INDEX-ADDRESSED and may arrive in any order — the receiver addresses by `index` and never
 * appends. The neighbouring rule is the obvious one to copy and it is the wrong one here.
 *
 * All nine fields are always present in both directions (no `omitempty`), so a decoder may rely on
 * all nine. Because `total_chunks` rides every chunk, the stream needs NO completion frame — the
 * DebugBundleDonePayload analogue does not exist. Mirrors the daemon field-for-field
 * (pyrycode #1752, `conversation_id` added by pyrycode #2142); do not drift it without a matching
 * daemon change. See ADR 0002.
 *
 * `conversation_id` IS THE UPLOAD'S DESTINATION, AND IT USED TO BE ABSENT ON PURPOSE. Until pyrycode
 * #2143 the daemon filed an upload under its follow-active cursor — the conversation the last routed
 * `send_message` named — and this type documented the omission as a security property: a client could
 * not steer bytes into another conversation's directory by naming one. That cursor is gone. The daemon
 * now REQUIRES the field on every chunk and refuses an absent, empty or unknown one with
 * `attachment.invalid_chunk` on the first chunk carrying it (#2143), and refuses a chunk naming a
 * different conversation than its transfer was admitted under (#2146). The property the omission
 * bought is kept daemon-side, by different fabric: the id is a lookup key VALIDATED AGAINST THE
 * DAEMON'S REGISTRY before it becomes a path component, never a value trusted as sent, and naming a
 * conversation is not authorization — the rule `request_attachment` already publishes. Client-side
 * (pyrycode-desktop #1205) the value is the open conversation's daemon-minted id, latched once per
 * transfer and spread onto every chunk, so #2146's mid-upload switch refusal is unreachable from here.
 */
export interface AttachmentChunkPayload {
  /** UPLOAD: the conversation the bytes belong to — the destination, validated by the daemon against its
   *  registry, identical on every chunk of one transfer. RETRIEVAL: emitted empty and ignored, since a
   *  retrieval chunk is correlated by `in_reply_to` to a request that already named the conversation.
   *  Same shape and budget as `attachment_id`; <= ATTACHMENT_ID_MAX_BYTES. */
  conversation_id: string
  /** The transfer this chunk belongs to, identical on every chunk; <= ATTACHMENT_ID_MAX_BYTES.
   *  NOT a capability — not secret, not unguessable, and never resolved into a filesystem path. */
  attachment_id: string
  /** 0-based position within the attachment, in [0, total_chunks). It decides where the bytes land. */
  index: number
  /** How many chunks the attachment splits into, >= 1, identical on every chunk. */
  total_chunks: number
  /** INBOUND, the client's own name for the file. OUTBOUND, the SANITISED single path component the
   *  daemon stored the bytes under — `Intake.Receive` keeps only the bytes, so the client's own string
   *  is never echoed back. Either way a display string and a sanitiser input, NEVER a path;
   *  <= ATTACHMENT_FILENAME_MAX_BYTES. Often private in itself — never log it. */
  filename: string
  /** INBOUND, the client's DECLARED media type. OUTBOUND, one the daemon SNIFFS FROM THE STORED BYTES
   *  — the declared type is discarded outright at admission, so there is nothing to echo, and a file
   *  whose name and declared type disagree with its content is described by its content. Either way a
   *  hint, not a verified property of the bytes: a SNIFFED `text/html` is exactly as dangerous to
   *  render as a declared one, because both are computed from bytes an attacker chose. Never dispatch
   *  on it in a way that grants the content privileges; <= ATTACHMENT_MIME_TYPE_MAX_BYTES. */
  mime_type: string
  /** Declared byte length of the WHOLE file — not of this chunk. */
  size: number
  /** Lowercase hex sha256 of the WHOLE file — not of this chunk. Always 64 characters. INTEGRITY,
   *  not authenticity (the same party supplies the bytes and the digest), and NOT a fetch key:
   *  retrieval names a conversation and an attachment, never a hash. */
  sha256: string
  /** This chunk's raw bytes as standard PADDED base64 (Go base64.StdEncoding). */
  data: string
}

/**
 * The upload leg's SUCCESS REPLY (daemon → client, #964). Mirrors the daemon's AttachmentStoredPayload
 * field-for-field (SSOT pyrycode docs/protocol-mobile.md § Attachments, internal/protocol/attachments.go);
 * no `omitempty` and no MarshalJSON there, so the single key is always present in the one direction this
 * frame travels. Do not drift it without a matching daemon change. See ADR 0002.
 *
 * ONE FIELD, AND THE ID IS THE CLIENT'S OWN, echoed back. Nothing daemon-side mints an attachment id —
 * the client supplies it on every chunk and storage keys by it — so "tie the reply to the upload" and
 * "name the attachment that was stored" are the same value, carried once.
 *
 * WHAT IS DELIBERATELY ABSENT, since every omission is a decision and the daemon pins the key set with a
 * two-sided wire-key test (`TestAttachmentStoredPayload_WireKeys`) so this is checked rather than reviewed:
 *
 *   - NO `size`, `sha256` or `total_chunks`. The client sent all three and they were checked against the
 *     assembled bytes before this frame could be emitted; echoing them back confirms nothing a client
 *     could act on.
 *   - NO host path, directory component or on-disk filename. § Error codes already forbids
 *     `attachment.storage_failed` from carrying the host path or the underlying filesystem error, either
 *     of which discloses the daemon's layout — a SUCCESS frame leaking what the FAILURE frame is guarded
 *     against would undo that mitigation from the other side. The stored filename is out for its own
 *     reason too: the daemon's sanitiser produces a name that is neither unique nor an identifier
 *     (distinct client names collide, and a case-insensitive host folds them further), so echoing it
 *     would hand a client something it cannot rely on.
 *   - NO `conversation_id`, for AttachmentChunkPayload's reason: the upload landed in the conversation
 *     the authenticated session is already on, and a client holding the transfer already knows it.
 *
 * Do NOT add any of them "for clarity".
 *
 * CORRELATION IS THE SUBTLE PART. This is a reply carried by the envelope's `in_reply_to`, which names
 * the chunk WHOSE ARRIVAL COMPLETED THE TRANSFER — not the highest index, and not predictable, since
 * chunks may be reassembled in any order. A consumer that matches only on a guessed envelope id NEVER
 * RESOLVES. Match on `attachment_id`; see the EnvelopeType member's comment for the full rule.
 *
 * SECURITY — receiving this frame IS NOT A CAPABILITY. The id is not secret, not unguessable, and never
 * the only thing between a caller and a file; it is echoed to exactly the authenticated session that
 * uploaded the bytes, so disclosure widens nothing. Carrying none of `filename` / `sha256` / `data`, this
 * payload is — unlike `attachment_chunk` — safe to log whole. That is a statement about THE FRAME, not a
 * licence: this client keeps the id out of its own diagnostic log anyway (see inboundMessage's arm).
 *
 * TWO CONSUMER OBLIGATIONS, because decoding makes the SHAPE trusted and never the CONTENT — a
 * compromised daemon inside the session picks this string:
 *
 *   - A client receiving an id it does not recognise IGNORES THE FRAME and concludes nothing. Recognition
 *     means a lookup against ids THIS CLIENT MINTED — in a `Map`, NEVER as an index into a plain object.
 *     `attachment_id: "__proto__"` read back as `pending[id]` yields Object.prototype, which is truthy,
 *     resolving a transfer that does not exist.
 *   - NOT A CAPABILITY and NEVER RESOLVED INTO A FILESYSTEM PATH (AttachmentChunkPayload's rule verbatim,
 *     and it binds harder here: the id is a directory name on the DAEMON side, so the natural mistake is
 *     to treat it as one on this side too). The canonical lowercase-UUIDv4 shape upstream publishes binds
 *     the side that MINTS ids — the outbound leg — not this one; the decode deliberately does not
 *     re-validate the shape of a value this client originated.
 */
export interface AttachmentStoredPayload {
  /** The attachment that was stored: the client's own id, repeated on every chunk of the upload and
   *  echoed back here; <= ATTACHMENT_ID_MAX_BYTES. A client matches on it and concludes nothing when it
   *  does not recognise the value. NOT a capability — not secret, not unguessable, and never resolved
   *  into a filesystem path. */
  attachment_id: string
}

/**
 * The retrieval leg's REQUEST (client → daemon, #993). Mirrors the daemon's RequestAttachmentPayload
 * field-for-field (SSOT pyrycode internal/protocol/attachments.go, published by pyrycode#2052 and
 * answered by #2054; docs/protocol-mobile.md § Attachments); no `omitempty` and no MarshalJSON there,
 * so both keys are always present in the one direction this frame travels. Do not drift it without a
 * matching daemon change. See ADR 0002.
 *
 * TWO FIELDS, AND NO THIRD. It names a conversation and an attachment. There is NO request-id key of
 * any spelling, because CORRELATION RIDES THE ENVELOPE: the answering `attachment_chunk` frames and
 * the `attachment.not_found` reject both name this request through `Envelope.in_reply_to`, which is
 * already declared and already surfaced by the decoder. The daemon's committed retrieval-chunk
 * fixture rides `in_reply_to: 91` against request_attachment.json's `id: 91`, so a request-id key
 * added here would put this client at odds with a scheme upstream has golden fixtures for.
 *
 * WHY THERE IS A `conversation_id` HERE when AttachmentChunkPayload deliberately has none: an upload
 * lands in the conversation the authenticated session is already on, so naming one THERE would only
 * let a client steer bytes into another conversation's directory; a RETRIEVAL has to be able to say
 * which conversation's file it wants. The asymmetry is deliberate on the daemon's side — do not
 * "harmonise" the two frames in either direction.
 *
 * NAMING A CONVERSATION IS NOT AUTHORIZATION, and this is the security property the whole frame
 * rests on. Authorization on this wire is PAIRING, enforced structurally at the Noise IK handshake;
 * there is no per-verb gate on this frame and none is invented here. What bounds a paired but
 * hostile client is that the daemon validates the id against its own registry BEFORE IT BECOMES A
 * PATH COMPONENT and confines resolution to that conversation's directory — CONFINEMENT, never the
 * secrecy or the shape of an id. A reader who takes this field for a free-form selector has been
 * handed exactly the capability the rest of the attachment contract spends pages denying, and the
 * canonical shape below must not be read as a claim of unguessability.
 *
 * BOTH IDS OBEY THE SAME CANONICAL SHAPE, the lowercase UUIDv4 upstream publishes under
 * § The `attachment_id` shape: 36 bytes exactly; `-` at offsets 8, 13, 18 and 23; `4` at offset 14;
 * one of `8` `9` `a` `b` at offset 19; lowercase hex everywhere else. LOWERCASE IS LOAD-BEARING
 * RATHER THAN COSMETIC: the id becomes a directory name on the host, and the lowercase-only alphabet
 * is what keeps the id-to-directory mapping injective on a case-insensitive filesystem (APFS by
 * default), so uppercase ids would give two attachments one directory on macOS. Containment follows
 * from that shape and NEVER from a length ceiling, which is also why this type adds no `Max*`
 * constant of its own: ATTACHMENT_ID_MAX_BYTES exists for `attachment_chunk`'s envelope arithmetic,
 * a ceiling there has been read as the shape once already, and a second one here would enforce
 * nothing while inviting the same mistake.
 *
 * DOCUMENTED, NOT VALIDATED — nothing in this repo checks either id against that shape. This wire
 * layer declares shapes and validates none, the posture both sibling payload types already ship
 * with; enforcement is the daemon's, which owns the reject path and the merged
 * `attachment.not_found` code whose message is static and never echoes the requested id or the
 * resolved path, since two distinguishable answers would make this verb a path-existence oracle.
 *
 * THE ZERO VALUE IS THE HAZARD TO KNOW ABOUT. Two empty strings are not a valid request under any
 * published shape, and the failure they cause on the far side is silent rather than loud: joining
 * the empty string onto a directory yields that directory, so a receiver that skips the shape check
 * addresses the conversation directory root instead of erroring. This side cannot enforce the
 * daemon's check, but it declines to ORIGINATE the value — both fields are required here and
 * `buildRequestAttachment` mints no default, unlike the `?? ''` normalisation
 * `buildRequestSessionSettings` needs for its optional chain.
 *
 * SENDING THIS FRAME IS NOT A CAPABILITY and it carries no content-bearing bytes — no filename, no
 * digest, no file data — so AttachmentChunkPayload's never-log argument, which rests on `filename`
 * being frequently private in itself and `data` being the file, does NOT transfer here and is not
 * transcribed. The rule that does apply is narrower and rests on this frame's own ground: upstream
 * permits logging these ids only AFTER their shape has been validated, because raw they are the
 * log-injection shape § Attachments already forbids for `filename` — and since nothing on this side
 * validates, nothing on this side may log them. AttachmentChunkPayload's allocation warning does not
 * transfer either: there is no count and no length field here for "never allocate from a claim" to
 * bite on, an absence that is a property of the shape rather than an omission.
 */
export interface RequestAttachmentPayload {
  /** The conversation whose attachment is wanted. A LOOKUP KEY the daemon validates against its own
   *  registry before it resolves anything, and NOT authorization; the empty string names nothing. */
  conversation_id: string
  /** The attachment wanted within that conversation: the client's own id, the one it repeated on
   *  every chunk of the upload. NOT a capability — not secret, not unguessable, and never resolved
   *  into a filesystem path on this side. */
  attachment_id: string
}

/**
 * Outbound `read_workspace_file` payload (client → daemon, #1626). Mirrors pyrycode
 * `ReadWorkspaceFilePayload` field-for-field, wire order `conversation_id, path`. Both keys are
 * always present (no `omitempty` upstream).
 *
 * THE PATH IS A FILESYSTEM PATH ON THE HOST, relative to the conversation's workspace or absolute,
 * and every field is an unverified claim to the daemon. The daemon confines it to that workspace
 * (symlinks resolved) and serves only `.md` / `.markdown`; every refusal is the one static
 * `attachment.not_found`. On this side the path is never resolved, never used as a local path, and
 * never logged or echoed: it names host layout, and its leaf is a filename.
 */
export interface ReadWorkspaceFilePayload {
  /** The conversation whose workspace is read. A lookup key, not authorization. */
  conversation_id: string
  /** The file, relative to the conversation's workspace or absolute. Sent unchanged. */
  path: string
}

/**
 * Inbound `attachment_offered` event (daemon → client, #1619) — the assistant sent the operator a file.
 * Mirrors the daemon's payload field-for-field, wire order `conversation_id, attachment_id, filename`,
 * all three ALWAYS PRESENT. SSOT pyrycode docs/protocol-mobile.md § Attachments, heading
 * `attachment_offered`. A truncated or hostile payload arrives as three empty strings, so the decoder
 * rejects an empty value in any of them.
 *
 * SECURITY: NARROWED IS NOT TRUSTED. Every field is a claim by the peer. `conversation_id` is a
 * daemon-asserted ROUTING KEY a consumer filters on, never authorization. `attachment_id` is
 * daemon-minted and must match the lowercase-UUIDv4 rule of that doc's "The `attachment_id` shape"
 * section; passing it is not proof the bytes exist, and any path built from it still goes through the
 * path guard in attachmentPath. `filename` is CLAUDE-AUTHORED display text of at most
 * ATTACHMENT_FILENAME_MAX_BYTES UTF-8 bytes, which may carry control or bidi characters: it is never a
 * path, never an attribute, URL or cache key, and never logged. Neither it nor the conversation id
 * reaches a log.
 */
export interface AttachmentOfferedPayload {
  conversation_id: string
  attachment_id: string
  filename: string
}

export interface BackfillSincePayload {
  since_ts: string
  conversation_id: string
  max_messages: number
}

/**
 * A terminal refusal, correlated to the request it answers by `Envelope.in_reply_to`.
 *
 * MODELLED SINCE #116, READ SINCE #965 — and only ONE of its four fields is read, `code`, by
 * `narrowDaemonErrorOutcome` in the main-process decoder. What the other three do is stated here so a
 * later reader does not mistake "modelled" for "available".
 *
 * The argument is on CONTRACT ground, not on a measurement. Neighbouring payload interfaces in this
 * file carry long security sections that reason from measurements taken on their own frames — a byte
 * observed in a real value, a survey of who authors a string. None of those transfer to this type, and
 * transcribing one would ship a claim nothing here has established.
 *
 * - **`code` is untrusted daemon-supplied text**, so per CLAUDE.md it may never become a lookup path, a
 *   filename or a cache key. The decoder therefore COMPARES it against client-owned literals and drops
 *   it, converting it to a client-owned outcome at that boundary; the raw string goes no further and is
 *   never logged. An unrecognised code lands on a distinct catch-all rather than passing through.
 * - **`message` is not surfaced at any code.** The daemon promises specific messages are static — the
 *   attachment `storage_failed` message names no path and no filesystem error — but that is the
 *   daemon's promise about its own behaviour, not a property a client can rely on for a value an
 *   untrusted peer chooses.
 * - **`retryable` is not read.** It is a per-code constant in the daemon's own reject table, so it
 *   carries nothing a client-owned outcome does not already encode, and it is a value an untrusted
 *   daemon picks. Retryability is derived from the outcome, never taken from the wire.
 * - **`retry_after_s` is absent on the attachment upload leg entirely.** That leg's emitter marshals a
 *   closed `{Code, Message, Retryable}` literal and the field is `*int,omitempty`, so no reject carries
 *   it. A client cannot learn a backoff duration from the wire there; the delay is client-owned policy.
 */
export interface ErrorPayload {
  code: string
  message: string
  retryable: boolean
  // Advisory retry delay in seconds. Meaningful only when `retryable` is true; omitted
  // otherwise (daemon ErrorPayload.RetryAfterS, *int,omitempty).
  retry_after_s?: number
  // The host's minimum app version, carried by `client.update_required` alone (daemon
  // ErrorPayload.MinClientVersion, string,omitempty; pyrycode#2576). Daemon-authored and untrusted:
  // read only by the update-required narrowing in parseInboundMessage, which keeps it solely when it
  // is a digits-only MAJOR.MINOR.PATCH. On the window's `failed` event it is that validated value.
  min_client_version?: string
}

/** QR pairing payload: relay address, server id, pairing token, server static key. */
export interface QrPayload {
  server: string
  relay: string
  token: string
  server_static_pubkey: string
}

/** Claude-authored report; bounds/truncation are producer-owned, stops_turn is not an instruction. */
export interface BannerPayload {
  conversation_id: string
  level: string
  text: string
  stops_turn: boolean
  truncated: boolean
}

/** Explicit permission denial; open source tokens and nullable reports mirror the daemon. */
export interface ToolDeniedPayload {
  conversation_id: string
  turn_id: string
  tool_use_id: string
  tool_name: string
  decision_reason_type: string
  decision_reason: string
  message: string
  truncated_fields: string[] | null
  dropped_fields: string[] | null
}

/** Claude-authored refusal prose. Required reports retain wire-key order and null. */
export interface ModelRefusalNoFallbackPayload {
  conversation_id: string
  original_model: string
  refusal_category: string
  banner: string
  truncated_fields: readonly string[] | null
  dropped_fields: readonly string[] | null
}

export interface ModelRefusalFallbackPayload extends ModelRefusalNoFallbackPayload {
  fallback_model: string
  scope: string
}

/** Daemon-wide instructions; only the empty string clears, never null. */
export interface SetHostSystemPromptPayload { system_prompt: string }
export interface HostSystemPromptPayload {
  system_prompt: string
  default_system_prompt: string
}
