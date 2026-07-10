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
  | 'screen_snapshot'
  | 'assistant_delta'
  | 'turn_end'
  | 'turn_state'
  | 'tool_use'
  | 'tool_result'
  | 'modal_shown'
  | 'modal_dismissed'
  | 'modal_answer'
  | 'modal_cancel'
  | 'list_conversations'
  | 'conversations'
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
