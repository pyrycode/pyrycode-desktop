// The outbound question-resolution builders: they serialize a caller-supplied QuestionAnswerPayload /
// QuestionRefusedPayload into the `question_answer` / `question_refused` early-data bytes the Noise
// session / relay driver carry as an opaque Uint8Array — the desktop's answer to (or refusal of) an
// outstanding batch of clarifying questions the daemon raised via `question_shown` (#883, rendered by
// the question panel). Two halves of one concern — resolving an outstanding batch, keyed solely by
// `question_batch_id` — so they share this file, following modalResolutionEnvelope.ts's
// one-concern-per-file split exactly. This slice ships the builders in isolation: the command path
// that mints the `answer_token` and calls these, and the renderer controls that trigger it, are later
// slices.
//
// NOTHING HERE LOGS, and that is required rather than incidental: `values` are operator-typed text
// and `question_batch_id` is a one-time unguessable nonce. The only error that escapes is
// encodeEnvelope's category-only WireEncodeError, which never echoes the payload.
//
// MAIN-PROCESS ONLY. They import codec.ts (Node `Buffer`). Never re-export them through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type {
  Envelope,
  QuestionAnswerPayload,
  QuestionRefusedPayload
} from '../../shared/wire/types'

/**
 * Inputs the consumer supplies — the envelope id counter, the wall clock, and the already-formed
 * payload (with the main-side-minted `answer_token`). Kept explicit (not read from globals) so the
 * builder is pure and trivially unit-testable, exactly like buildModalAnswer.
 *
 * **The payload is serialized VERBATIM, and every own enumerable key on it ships on the wire** —
 * `Envelope.payload` is `unknown` and encodeEnvelope is a bare JSON.stringify. So the consumer owes
 * the same discipline `daemonConnection.answerModal` already applies for `modal_answer`: build this
 * object as a fresh literal from validated scalars, never as a spread of a renderer-supplied object,
 * or a renderer could smuggle an extra key (a `conversation_id`, say) into the frame. The net belongs
 * there, at the trust boundary, rather than as a deep rebuild inside a pure serializer.
 */
export interface QuestionAnswerInput {
  /** The question_answer Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  /** The formed command payload (question_batch_id, answer_token, answers), serialized verbatim. */
  payload: QuestionAnswerPayload
}

/**
 * Build the `question_answer` early-data bytes: a `question_answer` Envelope wrapping the payload,
 * serialized to UTF-8 via encodeEnvelope. Same shape as buildModalAnswer.
 *
 * Order-preserving and sort-free: `answers` and each entry's `values` ride in the order given. It
 * range-checks no `question_index` — that bound is the daemon resolver's, see QuestionAnswerEntry —
 * and it never mutates `input.payload`, so there is no in-place normalisation reaching through a
 * caller's backing array.
 *
 * MAY throw WireEncodeError when the serialized envelope exceeds MAX_PLAINTEXT_BYTES — reachable in
 * ordinary use here, since `values` are operator-typed free text and upstream bounds neither entry
 * count nor value length. It propagates rather than truncating (a trimmed answer would send a
 * different choice than the operator made); the eventual caller catches it and drops the send.
 */
export function buildQuestionAnswer(input: QuestionAnswerInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'question_answer',
    ts: input.ts,
    payload: input.payload
  }
  return encodeEnvelope(envelope)
}

/**
 * Inputs the consumer supplies — the envelope id counter, the wall clock, and the
 * `{ question_batch_id, answer_token }` payload. Kept explicit so the builder is pure, exactly like
 * buildModalCancel. QuestionAnswerInput's verbatim-serialization note applies here too.
 */
export interface QuestionRefusedInput {
  /** The question_refused Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  /**
   * The formed command payload, serialized verbatim. It carries `answer_token` as well as the batch
   * id — unlike ModalCancelPayload, which carries `modal_id` alone.
   */
  payload: QuestionRefusedPayload
}

/**
 * Build the `question_refused` early-data bytes: a `question_refused` Envelope wrapping the
 * `{ question_batch_id, answer_token }` payload, serialized to UTF-8 via encodeEnvelope.
 *
 * MAY throw WireEncodeError when the serialized envelope exceeds MAX_PLAINTEXT_BYTES; the eventual
 * caller catches it and drops the send. Unreachable in ordinary use here — this frame carries no free
 * text at all, both fields being ids the client echoes back.
 */
export function buildQuestionRefused(input: QuestionRefusedInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'question_refused',
    ts: input.ts,
    payload: input.payload
  }
  return encodeEnvelope(envelope)
}
