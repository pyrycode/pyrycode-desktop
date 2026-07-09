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
