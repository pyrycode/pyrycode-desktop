// The typed command pipe from the renderer window to the background process: one sealed
// discriminated union, the channel it travels on, a pure constructor, and a runtime boundary
// guard. This is the command half of the background↔window bridge (#17); the event half is
// #18 (events.ts), which flows the other direction.
//
// The producer here is the UNTRUSTED renderer (unlike #18, whose producer is trusted main).
// So this module ships isRendererCommand — the runtime guard the main receiver applies at the
// renderer→main boundary. Downstream consumers (#11/transport) receive only validated commands.
//
// The payload-bearing members (sendMessage, requestSnapshot) reuse wire payload types from
// ../wire/types verbatim; the bare member (requestDebugBundle) carries no payload at all — never a
// token, key, or raw frame in any case. AC5 is enforced by construction: no member has a field that
// could hold a secret (QrPayload/HelloClientPayload tokens, InnerFrameV2 bytes are not
// referenced here), so a developer cannot serialize one onto this channel.
//
// Imported by src/main and src/preload, which have no @shared path alias — hence the
// relative import here and in those callers (see tsconfig.node.json).
import type {
  SendMessagePayload,
  RequestSnapshotPayload,
  ModalAnswerPayload,
  ModalCancelPayload
} from '../wire/types'

/**
 * The fields the renderer supplies to resolve a modal with an answer (#236): the `modal_id` +
 * chosen `option_id`, DERIVED from the wire `ModalAnswerPayload` with `answer_token` excluded —
 * `Omit` ties the field names to the wire contract while making the token-exclusion a compile-time
 * guarantee (AC1: no member carries a token). The `answer_token` is minted MAIN-side by
 * daemonConnection.answerModal, exactly as `sendMessageCommand` leaves `message_id` minting to the
 * main-side composer.
 */
export type AnswerModalCommandPayload = Omit<ModalAnswerPayload, 'answer_token'>

/** The IPC channel every typed renderer command travels on, renderer → main.
 *  Single source of truth: the preload sender ships on it, the main receiver listens on it.
 *  A mismatch would silently drop every command, so both sides reference this constant. */
export const COMMAND_CHANNEL = 'pyry:command' as const

/**
 * A single typed command from the renderer window to the background process. Sealed
 * discriminated union on `type`. Six members today: `sendMessage`, whose `payload` reuses the
 * wire SendMessagePayload verbatim so no field is remapped between layers; the bare
 * `requestDebugBundle` (#168), which carries NO payload because the bundle is daemon-global;
 * `requestSnapshot` (#180), whose `payload` reuses the wire RequestSnapshotPayload (a
 * `conversation_id` routing id, not a secret) to ask the daemon for the current screen_snapshot;
 * the bare `requestConversations` (#139), which carries NO payload — the daemon returns every
 * conversation; `answerModal` (#236), whose `payload` is AnswerModalCommandPayload (`modal_id` +
 * `option_id`, the token Omit-excluded — minted main-side); and `cancelModal` (#236), whose
 * `payload` reuses the wire ModalCancelPayload (`modal_id` only). No member exposes a field that
 * could hold a token, key, or raw frame (AC5) — the payload-bearing ones reuse only wire types (or
 * a token-excluded derivative), the bare ones carry nothing.
 *
 * Extend additively (connect/disconnect) when their transport tickets land — and add a
 * matching case to isRendererCommand in lockstep, or the new member is silently dropped at
 * the boundary.
 */
export type RendererCommand =
  | { type: 'sendMessage'; payload: SendMessagePayload }
  | { type: 'requestDebugBundle' }
  | { type: 'requestSnapshot'; payload: RequestSnapshotPayload }
  | { type: 'requestConversations' }
  | { type: 'answerModal'; payload: AnswerModalCommandPayload }
  | { type: 'cancelModal'; payload: ModalCancelPayload }

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
 * Wrap the user's modal answer (`modal_id` + chosen `option_id`) into a well-formed command (#236).
 * Pure: it does NOT mint the `answer_token` — that needs randomness and lives main-side
 * (daemonConnection.answerModal), exactly as sendMessageCommand leaves message_id minting to the
 * composer. The `fields` type (AnswerModalCommandPayload) Omit-excludes the token, so a caller
 * cannot even supply one here (AC1: no member carries a token).
 */
export function answerModalCommand(fields: AnswerModalCommandPayload): RendererCommand {
  return { type: 'answerModal', payload: fields }
}

/**
 * Wrap a modal cancel (`modal_id` only) into a well-formed command (#236). Pure; reuses the wire
 * ModalCancelPayload verbatim (the sendMessage / requestSnapshot "reuse wire types, no remapping"
 * convention). No token, no secret — `modal_id` is the sole correlation key (ADR 0009).
 */
export function cancelModalCommand(fields: ModalCancelPayload): RendererCommand {
  return { type: 'cancelModal', payload: fields }
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
    case 'requestDebugBundle':
      // Bare member: no payload to validate, so a well-formed `type` is complete acceptance.
      return true
    case 'requestSnapshot':
      return 'payload' in value && isRequestSnapshotPayload(value.payload)
    case 'requestConversations':
      // Bare member (#139): no payload to validate, so a well-formed `type` is complete acceptance.
      return true
    case 'answerModal':
      return 'payload' in value && isAnswerModalPayload(value.payload)
    case 'cancelModal':
      return 'payload' in value && isCancelModalPayload(value.payload)
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

/** The untrusted renderer→main boundary guard for the requestSnapshot payload (#180) — the reason
 *  this ticket is security-sensitive. Mirrors isSendMessagePayload: one `conversation_id` string
 *  check (a routing id, not a secret). Pure; never throws. */
function isRequestSnapshotPayload(value: unknown): value is RequestSnapshotPayload {
  if (typeof value !== 'object' || value === null) return false
  return 'conversation_id' in value && typeof value.conversation_id === 'string'
}

/** The untrusted renderer→main boundary guard for the answerModal payload (#236) — the modal
 *  resolution's boundary check (why the command half is security-sensitive). Mirrors
 *  isSendMessagePayload: `modal_id` AND `option_id` string. Structural minimum — a smuggled
 *  `answer_token` is not rejected here (the main-side sender's fresh-literal construction ignores
 *  it), so this guard need not know about the token. Pure; never throws. */
function isAnswerModalPayload(value: unknown): value is AnswerModalCommandPayload {
  if (typeof value !== 'object' || value === null) return false
  return (
    'modal_id' in value &&
    typeof value.modal_id === 'string' &&
    'option_id' in value &&
    typeof value.option_id === 'string'
  )
}

/** The untrusted renderer→main boundary guard for the cancelModal payload (#236). Mirrors
 *  isRequestSnapshotPayload: one `modal_id` string check (the sole correlation key, not a secret).
 *  Pure; never throws. */
function isCancelModalPayload(value: unknown): value is ModalCancelPayload {
  if (typeof value !== 'object' || value === null) return false
  return 'modal_id' in value && typeof value.modal_id === 'string'
}
