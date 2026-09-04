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

/** Inner frame carried inside the Noise-encrypted channel (InnerFrameV2). */
export interface InnerFrameV2 {
  v: 2
  type: string
  /** base64 (standard, padded) of the serialized Envelope. */
  data: string
}

export type EnvelopeType =
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
  | 'stall'
  | 'api_retry'
  | 'compacting'
  // v2-only daemon→client diagnostic — the daemon's stream parser met claude output it has no
  // mapping for. Not a claude sub-state like its neighbours above: it reports a gap in the
  // DAEMON's own mapping. SSOT pyrycode `internal/protocol` UnrecognizedMessagePayload.
  | 'unrecognized_message'
  | 'session_transition'
  | 'tool_use'
  | 'tool_result'
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
  // The announced-model report (#587). Grouped alone rather than with the status cluster above,
  // following the daemon's own rationale: it is not a turn sub-state with two edges, not
  // turn-independent work, not a periodic reading and not a condition report about a window. It is an
  // IDENTITY report — what claude says it IS, for the turn it says it about. SSOT pyrycode#1616 /
  // internal/protocol/codes.go TypeModelAnnounced; binary → phone only.
  | 'model_announced'
  | 'dequeue_message'
  // v2-only bare phone→binary control frame — maps to a single claude Esc (stops the current
  // turn). Carries NO conversation_id / nonce / answer_token / payload; daemon-gated on the
  // `interactive` capability; fire-and-forget (no reply). SSOT pyrycode #707.
  | 'interrupt'
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
  | 'rename_conversation'
  | 'change_workspace'
  | 'create_workspace_folder'
  | 'workspace_folder_created'
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
  // The last event/message timestamp this client has already seen (RFC3339). The daemon uses
  // it for backfill-on-reconnect (daemon HelloClientPayload.LastSeenTS, *time.Time,omitempty).
  // Omitted when nothing has been seen yet — that absence is the "nothing seen" signal, so the
  // daemon backfills nothing. Replaces the earlier `last_event_id`, which was not a field the
  // daemon or the mobile client speaks.
  last_seen_ts?: string
}

export interface HelloAckPayload {
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

export interface SendMessagePayload {
  conversation_id: string
  message_id: string
  text: string
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
 * `session_id, model, effort, yolo, permission_mode, used_tokens, window_tokens` — all always
 * present (no `omitempty`), so every zero value is a real answer rather than an absence.
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
  /** Reasoning effort; '' = inherited daemon default. */
  effort: string
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

/**
 * Inbound `compacting` event (daemon → client). Mirrors the daemon's CompactingPayload field-for-field
 * (pyrycode #1074; detector upstream tui-driver #298), whose two fields are always present (no
 * `omitempty`). A PTY-derived status peer of StallPayload / ApiRetryPayload, fanned out ONLY to
 * `interactive`-capable clients: claude is auto-compacting the conversation and goes silent on the
 * content channel for tens of seconds, which without this frame reads as a frozen thinking state.
 *
 * BANNER-ONLY. tui-driver streams no compaction progress, so beyond the conversation id and the edge
 * bool there is nothing to carry: no counter, no percentage, no elapsed time. The deliberate contrast
 * with ApiRetryPayload, which does carry `current` / `total`. Do not invent one client-side — a progress
 * field would be a wire change with a matching daemon peer (ADR 0002), not a client invention.
 *
 * NOT ONSET-ONLY — the contrast with `stall`. `active: true` is compaction starting, `active: false` the
 * explicit falling edge (compaction finished), so the client clears the indicator on that frame rather
 * than deriving a self-clear from turn activity. Like `stall` it is conversation-level, so there is no
 * `turn_id`, and receiving it never opens, closes, or alters a turn. See #495 (this decode) and #496
 * (the render).
 */
export interface CompactingPayload {
  conversation_id: string
  active: boolean
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
export interface ModelAnnouncedPayload {
  conversation_id: string
  model: string
  truncated: boolean
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
 * truncated_fields` — all always present (no `omitempty`). Fanned out ONLY to `interactive`-capable
 * clients.
 *
 * THE PEER of BackgroundTaskStartedPayload above, joined on `task_id`: that frame OPENS a task, this one
 * reports what CHANGED about it afterwards. FOUR fields, not six — this frame has no `tool_call_id`, no
 * `description` and no `task_type`, and gains `patch`.
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
 * `patch`, a DIFFERENT pair from the sibling's, which is itself the argument against ever narrowing the
 * element vocabulary to a client-side union (a closed set would fail-close a valid future frame — the
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
 */
export interface BackgroundTaskUpdatedPayload {
  conversation_id: string
  task_id: string
  patch: string
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
 * WHAT IT IS. The daemon's stream parser recognises three top-level message types from claude and a
 * fixed set of content blocks. Anything outside a MEASURED known-ignored list used to be dropped into a
 * debug log the production daemon does not print, so a claude version that moved something meaningful
 * into a new message type would show nothing, anywhere, with nothing saying why. This frame is that
 * drop, made visible. It is deliberately NOT emitted for the types the daemon knowingly ignores
 * (`system/*`, `rate_limit_event`), which would otherwise put a row on every turn.
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
 * The four places the daemon's stream parser can meet claude output it has no mapping for. A closed
 * wire enum like WireSessionTransitionReason, so the decoder compares against literals rather than
 * accepting any string. `line_type` is a whole top-level message; `assistant_block` / `user_block` are
 * one content block of an otherwise-fine message; `undecodable` is a line or block that would not
 * JSON-decode at all, and is the one value for which `message_type` is empty (nothing decoded, so no
 * type was ever read).
 */
export type WireUnrecognizedSite = 'line_type' | 'assistant_block' | 'user_block' | 'undecodable'

/**
 * Inbound `session_transition` marker (daemon → client). Mirrors the daemon's SessionTransitionPayload
 * field-for-field (pyrycode/pyrycode#656, internal/protocol/messaging.go), wire order
 * `previous_session_id, new_session_id, reason, occurred_at, workspace_cwd` — all always present (no
 * `omitempty`). A session-boundary event the daemon emits when a conversation's session rotates (a `/clear`,
 * an idle eviction, a workspace change); it carries `new_session_id`, the addressing key a client needs to
 * change per-session settings (model / effort / YOLO). **There is NO `conversation_id`** — a session
 * boundary is attributed by the connection it arrives on, and desktop targets the single active conversation
 * (activeConversationStore, #448). `reason` is a plain wire string like `MessagePayload.role`, closed to the
 * three WireSessionTransitionReason values. `occurred_at` is RFC3339Nano (a plain string on the wire; the
 * decoder requires a string but does not parse the timestamp). `workspace_cwd` is `string | null` (the
 * `ConversationSummary.name` valid-`null` idiom): the new workspace dir, non-null iff
 * `reason == workspace_change`, literal `null` for `clear` / `idle_evict`. Interactive-capability gated
 * (#179). See #254.
 */
export interface SessionTransitionPayload {
  previous_session_id: string
  new_session_id: string
  reason: WireSessionTransitionReason
  occurred_at: string
  workspace_cwd: string | null
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
 */
export interface QueuedItem {
  queued_msg_id: number
  text: string
  ts: string
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
 * default_option_id` — all always present (no `omitempty`). The permission/trust prompt `claude` raises
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
 * #701, ADR 0009), wire order `modal_id, option_id, answer_token` — all always present (no `omitempty`).
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
 * `value` IS THE ARGUMENT YOU PASS (`claude --model <value>`). It is NOT a dated identifier and NOT
 * PARSEABLE: the measured entries are `default`, `opus[1m]`, `claude-fable-5[1m]`, `sonnet` and
 * `haiku` — a literal, a bare alias, or a bracketed variant. Splitting it on `-` to derive a family
 * does not work and no consumer may try; nor may it be presented as a version.
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
 */
export interface ConversationSummary {
  id: string
  name: string | null
  is_promoted: boolean
  is_archived: boolean
  cwd: string
  last_message_ts: string
  last_used_at: string
}

/** Inbound `conversations` reply body (daemon → client). Order preserved from the wire — the daemon
 *  is the source of truth for ordering (e.g. most-recently-used first). See #139. */
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
 */
export interface CreateConversationPayload {
  is_promoted: boolean | null
  name: string | null
  cwd: string | null
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
 */
export interface ConversationCreatedPayload {
  id: string
  is_promoted: boolean
  cwd: string
  name: string | null
  last_used_at: string
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
 */
export interface ConversationUpdatedPayload {
  id: string
  is_promoted: boolean
  name: string | null
  cwd: string
  last_used_at: string
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
 * All eight fields are always present in both directions (no `omitempty`), so a decoder may rely on
 * all eight. Because `total_chunks` rides every chunk, the stream needs NO completion frame — the
 * DebugBundleDonePayload analogue does not exist. Mirrors the daemon field-for-field
 * (pyrycode #1752); do not drift it without a matching daemon change. See ADR 0002.
 */
export interface AttachmentChunkPayload {
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
}

/** QR pairing payload: relay address, server id, pairing token, server static key. */
export interface QrPayload {
  server: string
  relay: string
  token: string
  server_static_pubkey: string
}
