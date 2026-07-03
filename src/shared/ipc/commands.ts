// The typed command pipe from the renderer window to the background process: one sealed
// discriminated union, the channel it travels on, a pure constructor, and a runtime boundary
// guard. This is the command half of the background↔window bridge (#17); the event half is
// #18 (events.ts), which flows the other direction.
//
// The producer here is the UNTRUSTED renderer (unlike #18, whose producer is trusted main).
// So this module ships isRendererCommand — the runtime guard the main receiver applies at the
// renderer→main boundary. Downstream consumers (#11/transport) receive only validated commands.
//
// Every member reuses a wire payload type from ../wire/types verbatim — never a token, key,
// or raw frame. AC5 is enforced by construction: no member has a field that could hold a
// secret (QrPayload/HelloClientPayload tokens, InnerFrameV2 bytes are not referenced here),
// so a developer cannot serialize one onto this channel.
//
// Imported by src/main and src/preload, which have no @shared path alias — hence the
// relative import here and in those callers (see tsconfig.node.json).
import type { SendMessagePayload } from '../wire/types'

/** The IPC channel every typed renderer command travels on, renderer → main.
 *  Single source of truth: the preload sender ships on it, the main receiver listens on it.
 *  A mismatch would silently drop every command, so both sides reference this constant. */
export const COMMAND_CHANNEL = 'pyry:command' as const

/**
 * A single typed command from the renderer window to the background process. Sealed
 * discriminated union on `type`. First (and, per #17, only) member: send-message, whose
 * `payload` reuses the wire SendMessagePayload verbatim so no field is remapped between
 * layers. Carries ONLY wire payload types — never a token, key, or raw frame (AC5).
 *
 * Extend additively (connect/disconnect) when their transport tickets land — and add a
 * matching case to isRendererCommand in lockstep, or the new member is silently dropped at
 * the boundary.
 */
export type RendererCommand = { type: 'sendMessage'; payload: SendMessagePayload }

/**
 * Wrap already-assembled send-message fields into a well-formed command. Pure: it does NOT
 * generate the message_id (that needs randomness — #11's composer mints it and passes the
 * assembled SendMessagePayload in). The RendererCommand return type is the compile-time
 * guarantee AC4 requires: a member with an unmodelled `type` cannot type-check.
 */
export function sendMessageCommand(fields: SendMessagePayload): RendererCommand {
  return { type: 'sendMessage', payload: fields }
}

/**
 * Runtime type guard for the untrusted renderer→main boundary. True iff `value` is a
 * structurally valid RendererCommand. Accepts extra/unknown fields (structural minimum);
 * rejects everything else. Pure; never throws. Co-located with the union so the two evolve
 * in lockstep — grow the switch as the union grows.
 */
export function isRendererCommand(value: unknown): value is RendererCommand {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false
  switch (value.type) {
    case 'sendMessage':
      return 'payload' in value && isSendMessagePayload(value.payload)
    default:
      return false
  }
}

function isSendMessagePayload(value: unknown): value is SendMessagePayload {
  if (typeof value !== 'object' || value === null) return false
  return (
    'conversation_id' in value &&
    typeof value.conversation_id === 'string' &&
    'message_id' in value &&
    typeof value.message_id === 'string' &&
    'text' in value &&
    typeof value.text === 'string'
  )
}
