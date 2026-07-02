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
  in_reply_to?: number | null
  event_id?: number | null
}

export type WireRole = 'user' | 'assistant'

export interface HelloClientPayload {
  role: 'client'
  device_name: string
  client_version: string
  protocol_versions: string[]
  token: string
  capabilities: string[]
  last_event_id?: number | null
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
}

/** QR pairing payload: relay address, server id, pairing token, server static key. */
export interface QrPayload {
  server: string
  relay: string
  token: string
  server_static_pubkey: string
}
