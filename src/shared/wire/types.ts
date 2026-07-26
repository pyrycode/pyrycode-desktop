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
  | 'request_snapshot'
  | 'set_session_settings'
  | 'session_settings_updated'
  | 'screen_snapshot'
  | 'assistant_delta'
  | 'turn_end'
  | 'turn_state'
  | 'stall'
  | 'api_retry'
  | 'session_transition'
  | 'tool_use'
  | 'tool_result'
  | 'queue_state'
  | 'dequeue_message'
  // v2-only bare phone→binary control frame — maps to a single claude Esc (stops the current
  // turn). Carries NO conversation_id / nonce / answer_token / payload; daemon-gated on the
  // `interactive` capability; fire-and-forget (no reply). SSOT pyrycode #707.
  | 'interrupt'
  | 'modal_shown'
  | 'modal_dismissed'
  | 'modal_answer'
  | 'modal_cancel'
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
 * Outbound `request_snapshot` payload (client → daemon). Mirrors the daemon's
 * RequestSnapshotPayload{ConversationID string}: names the conversation whose current screen to
 * snapshot. Unlike `request_debug_bundle` (a bare, daemon-global control frame), this carries a real
 * payload — the daemon rejects an empty/unknown id with `conversation.not_found`. See #180.
 */
export interface RequestSnapshotPayload {
  conversation_id: string
}

/**
 * Outbound `set_session_settings` payload (client → daemon). Mirrors the daemon's
 * SetSessionSettingsPayload{SessionID string; Model, Effort *string; YOLO *bool} field-for-field
 * (pyrycode #844 wire vocab, #845 handler, both on `main`): changes one session's model / reasoning
 * effort / YOLO.
 *
 * The optional `?` fields mirror the daemon's `*T ...,omitempty` nil-pointer omission and carry a
 * PRESENCE CONTRACT: an ABSENT key means "leave unchanged"; a key PRESENT at its zero value (`''` /
 * `false`) means "set to this value" (an empty-string clear, or permissions-enforced). On the wire
 * this distinction is an absent key (omitempty) vs a present key — NEVER a literal `null`. TS has no
 * `omitempty`, so this type merely PERMITS absence; the contract is ENFORCED by the builder
 * (setSessionSettingsEnvelope.ts), which assigns a key only when its field `!== undefined`. `session_id`
 * is the addressing key (matches the daemon's Pool.UpdateSettings id), never a secret — always required.
 */
export interface SetSessionSettingsPayload {
  session_id: string
  /** *string omitempty — absent = leave unchanged; '' = clear to the daemon default. */
  model?: string
  /** *string omitempty — absent = leave unchanged; '' = clear to the daemon default. */
  effort?: string
  /** *bool omitempty — absent = leave unchanged; false = permissions enforced (never omitted-as-false). */
  yolo?: boolean
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
 * Inbound `screen_snapshot` reply (daemon → client). Mirrors the daemon's
 * internal/protocol/snapshot.go ScreenSnapshotPayload field-for-field, wire order
 * `conversation_id, text, ts, model, effort, yolo, used_tokens, window_tokens` — all always present
 * (no `omitempty`). ADR-025's always-available, parser-independent snapshot: NOT gated on the
 * `interactive` capability, so a paired non-interactive client can request it (pyrycode #847). See
 * #180; the two usage fields are #191 (pyrycode #857).
 */
export interface ScreenSnapshotPayload {
  conversation_id: string
  /** The rendered screen text. Decoded at the transport boundary but NEVER surfaced past it (#180). */
  text: string
  /** RFC3339 (the daemon's `time.Time` serialises to a string). */
  ts: string
  /** Active model; '' = inherited daemon default (never treated as absent). */
  model: string
  /** Reasoning effort; '' = inherited daemon default. */
  effort: string
  /** Permissions posture; `false` = permissions enforced. */
  yolo: boolean
  /** Current context size on the latest usage-bearing transcript entry; NOT a running total (#191). */
  used_tokens: number
  /** Context-window size (200000 today); `0` = usage seam unwired/unavailable (#191). */
  window_tokens: number
}

/**
 * Inbound `assistant_delta` event (daemon → client). Mirrors the daemon's AssistantDeltaPayload
 * field-for-field (pyrycode #607, protocol-mobile.md), wire order `conversation_id, turn_id, seq,
 * text` — all always present (no `omitempty`). One incremental slice of the assistant reply on the
 * v2 interactive stream, which REPLACES the coarse `message` fan-out (pyrycode #699): assistant text
 * arrives only here once #179 flips `interactive` on. `text` is the render payload (#203), carried
 * verbatim; unlike `screen_snapshot.text` it is NOT dropped downstream. See #199.
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
 * The reason a daemon session rotated, on the wire. Mirrors WireTurnState / MessagePayload.role: a plain
 * daemon-side string over a closed set (no named enum), closed to the three SSOT #656 values. The producer
 * (pyrycode/pyrycode#657) emits only `clear` / `idle_evict` today; `workspace_change` is kept in the closed
 * set anyway so the wire contract stays fully expressible (a consumer enum may admit a value the producer
 * cannot yet emit — SSOT #656). A future fourth reason would fail closed here (the frame drops) until this
 * decoder is widened — the correct no-drift posture for a wire enum.
 */
export type WireSessionTransitionReason = 'clear' | 'idle_evict' | 'workspace_change'

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
 */
export interface ToolUsePayload {
  conversation_id: string
  turn_id: string
  tool_use_id: string
  name: string
  input_summary: string
}

/**
 * Inbound `tool_result` event (daemon → client). Mirrors the daemon's ToolResultPayload field-for-field
 * (pyrycode #607 / ADR 025, protocol-mobile.md), wire order `conversation_id, turn_id, tool_use_id,
 * is_error, result_summary` — all always present (no `omitempty`). The outcome half of the tool-call
 * enrichment on the v2 interactive stream (ADR 0008): it resolves an existing `toolCall` timeline item
 * in place, correlated by `tool_use_id`, NOT a new row. `is_error` is a required boolean whose `false`
 * is a value (success), never an absence (the `yolo` #180 convention) — the daemon pins `is_error: false`
 * exactly (no `omitempty`). `result_summary` is an untrusted daemon-supplied string carried as opaque
 * display text (like `input_summary` #217, `stop_reason` #199, `cwd` #139) — decoded, never interpreted;
 * its DOM sink is the render slice (#230), which must render it as plain text, never HTML. `tool_use_id`
 * is the correlation key. See #229.
 */
export interface ToolResultPayload {
  conversation_id: string
  turn_id: string
  tool_use_id: string
  is_error: boolean
  result_summary: string
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
 * (SSOT #701, ADR 0009), wire order `modal_id, class, title, prompt, options, default_option_id` — all
 * always present (no `omitempty`). The permission/trust prompt `claude` raises during an interactive
 * session (surfaced once #179 flips `interactive` on). **`modal_id` is the sole correlation key — a
 * one-time nonce; NO `conversation_id` is carried on a modal** (the daemon hosts one active conversation
 * and resolves `modal_id` against its own outstanding-modal state, ADR 0009). `class` is a plain wire
 * string closed to `WireModalClass` exactly like `MessagePayload.role`. `options` is ORDERED.
 * `default_option_id` is the id of a fail-safe deny default set daemon-side (its `∈ options[].id`
 * invariant is a render concern, #224, not cross-checked at decode). `title` / `prompt` / each
 * `options[].label` are untrusted `claude`-surfaced FREE TEXT the render slice (#224) must render as
 * plain text, never HTML. See #201.
 */
export interface ModalShownPayload {
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
 * desktop sends back). **`modal_id` is the sole correlation key — NO `conversation_id` rides a modal**
 * (the daemon hosts one active conversation and resolves `modal_id` against its own outstanding-modal
 * state, ADR 0009). `option_id` is a SINGLE string referencing a `WireModalOption.id` from the inbound
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

export interface BackfillSincePayload {
  since_ts: string
  conversation_id: string
  max_messages: number
}

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
