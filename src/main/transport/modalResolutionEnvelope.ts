// The outbound modal-resolution builders: they serialize a caller-supplied ModalAnswerPayload /
// ModalCancelPayload into the `modal_answer` / `modal_cancel` early-data bytes the Noise session (#7) /
// relay driver (#50) carry as an opaque Uint8Array — the desktop's answer to (or cancel of) an
// outstanding permission/trust modal the daemon raised via `modal_shown` (#201, rendered by #224).
// Two halves of one concern — resolving an outstanding modal, keyed solely by `modal_id` (no
// `conversation_id`, ADR 0009) — so they share this file, following the same one-concern-per-file
// split the module already uses (sendMessageEnvelope.ts / requestSnapshotEnvelope.ts). Both are
// PAYLOAD-carrying builders (a `modal_id` correlates the frame), NOT bare control frames. This slice
// ships the builders in isolation: the command path that mints the `answer_token` and calls these is
// #236, the renderer buttons that trigger it are #237.
//
// MAIN-PROCESS ONLY. They import codec.ts (Node `Buffer`). Never re-export them through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope, ModalAnswerPayload, ModalCancelPayload } from '../../shared/wire/types'

/**
 * Inputs the consumer (#236 `createDaemonConnection.answerModal`) supplies — the envelope id counter,
 * the wall clock, and the already-formed payload (with the main-side-minted `answer_token`). Kept
 * explicit (not read from globals) so the builder is pure and trivially unit-testable, exactly like
 * buildRequestSnapshot.
 */
export interface ModalAnswerInput {
  /** The modal_answer Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  /** The formed command payload (modal_id, option_id, answer_token), serialized verbatim. */
  payload: ModalAnswerPayload
}

/**
 * Build the `modal_answer` early-data bytes: a `modal_answer` Envelope wrapping the payload,
 * serialized to UTF-8 via encodeEnvelope. Same shape as buildRequestSnapshot — a real payload, keyed
 * by `modal_id`.
 *
 * MAY throw WireEncodeError when the serialized envelope exceeds MAX_PLAINTEXT_BYTES; the sole caller
 * (#236 connection.answerModal) catches it and drops the send.
 */
export function buildModalAnswer(input: ModalAnswerInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'modal_answer',
    ts: input.ts,
    payload: input.payload
  }
  return encodeEnvelope(envelope)
}

/**
 * Inputs the consumer (#236 `createDaemonConnection.cancelModal`) supplies — the envelope id counter,
 * the wall clock, and the `{ modal_id }` payload. Kept explicit so the builder is pure, exactly like
 * buildRequestSnapshot.
 */
export interface ModalCancelInput {
  /** The modal_cancel Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  /** The formed command payload (modal_id — the sole correlation key), serialized verbatim. */
  payload: ModalCancelPayload
}

/**
 * Build the `modal_cancel` early-data bytes: a `modal_cancel` Envelope wrapping the `{ modal_id }`
 * payload, serialized to UTF-8 via encodeEnvelope.
 *
 * MAY throw WireEncodeError when the serialized envelope exceeds MAX_PLAINTEXT_BYTES; the sole caller
 * (#236 connection.cancelModal) catches it and drops the send.
 */
export function buildModalCancel(input: ModalCancelInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'modal_cancel',
    ts: input.ts,
    payload: input.payload
  }
  return encodeEnvelope(envelope)
}
