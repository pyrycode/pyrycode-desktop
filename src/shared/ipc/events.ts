// The typed event pipe from the background process to the renderer window: one sealed
// discriminated union plus the channel it travels on, imported by both process sides. This
// is the event-pipe half of the background↔window bridge (#18); the command half is #17.
//
// Every member reuses a wire payload type from ../wire/types verbatim — never a token, key,
// or raw frame. AC4 is enforced by construction: no member has a field that could hold a
// secret (QrPayload/HelloClientPayload tokens, InnerFrameV2 bytes are not referenced here),
// so a developer cannot serialize one onto this channel.
//
// Imported by src/main and src/preload, which have no @shared path alias — hence the
// relative import here and in those callers (see tsconfig.node.json).
import type { HelloAckPayload, MessagePayload, ErrorPayload } from '../wire/types'

/** The IPC channel every typed daemon event travels on, main → renderer.
 *  Single source of truth: the emit helper sends on it, the preload subscribes to it.
 *  A mismatch would silently drop every event, so both sides reference this constant. */
export const DAEMON_EVENT_CHANNEL = 'pyry:daemon-event' as const

/**
 * A single typed event from the background process to the renderer window. Sealed
 * discriminated union on `type`, with exactly one member per session-store SessionAction
 * arm (connecting | connected | disconnected | failed | messageReceived | messagesReceived),
 * so #19 maps it onto SessionAction with no gaps and no spares.
 *
 * Spans transport-lifecycle events (`connecting`/`disconnected`, from the transport
 * supervisor) and daemon-originated events (`connected`/`failed`/messages, derived from
 * validated wire envelopes upstream). Carries ONLY wire payload types — never a token, key,
 * or raw frame (AC4). Member and field names mirror SessionAction's so #19's mapping is
 * near-identity, while the two unions stay separately declared per layer.
 */
export type DaemonEvent =
  | { type: 'connecting' }
  | { type: 'connected'; ack: HelloAckPayload }
  | { type: 'disconnected' }
  | { type: 'failed'; error: ErrorPayload }
  | { type: 'messageReceived'; message: MessagePayload }
  | { type: 'messagesReceived'; messages: readonly MessagePayload[] }
