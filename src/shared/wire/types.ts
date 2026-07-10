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
