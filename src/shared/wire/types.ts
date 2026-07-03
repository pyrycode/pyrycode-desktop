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
