import { describe, it, expect } from 'vitest'
import { buildQuestionAnswer, buildQuestionRefused } from './questionResolutionEnvelope'
import { decodeEnvelope, WireEncodeError } from './codec'
import {
  MAX_PLAINTEXT_BYTES,
  type QuestionAnswerPayload,
  type QuestionRefusedPayload
} from '../../shared/wire/types'

// The pure builders mirror buildModalAnswer/buildModalCancel: (id, ts, payload) → serialized bytes,
// no clock/counter/side-effects. They use the REAL codec so the assertions pin actual wire bytes.
// Both are outbound-only (client → daemon) — there is no decode path for these question-resolution
// frames, so the round-trip only proves the encode side is byte-faithful.
describe('buildQuestionAnswer', () => {
  const FIXED_TS = '2026-09-02T10:00:00Z'
  // Lifted verbatim from the daemon's committed fixture
  // (internal/protocol/testdata/question_answer.json), which is already the mixed batch this slice
  // owes: entry 0 single-value, entry 1 multi-value (the multi_select case).
  const PAYLOAD: QuestionAnswerPayload = {
    question_batch_id: 'qb-4c19',
    answer_token: 'at-7f3d',
    answers: [
      { question_index: 0, values: ['Rewrite the parser'] },
      { question_index: 1, values: ['Add a benchmark', 'Add a fuzz target'] }
    ]
  }

  it('round-trips to a question_answer envelope carrying the exact id, ts, and payload', () => {
    const bytes = buildQuestionAnswer({ id: 905, ts: FIXED_TS, payload: PAYLOAD })

    const envelope = decodeEnvelope(bytes)
    expect(envelope.type).toBe('question_answer')
    expect(envelope.id).toBe(905)
    expect(envelope.ts).toBe(FIXED_TS)
    // toEqual the whole payload confirms all three fields present, nothing dropped or added — and
    // that `answers` rode as an array of objects rather than being flattened or stringified.
    expect(envelope.payload).toEqual(PAYLOAD)
  })

  it('preserves the order of answers and of the values within an entry', () => {
    // Array order is not the correlation — `question_index` selects — but a client emits entries in
    // batch order, and `values` order IS meaningful for a multi-select answer. Asserted separately
    // from the toEqual above because toEqual on the whole payload would still pass if a builder
    // re-sorted BOTH the entries and their values consistently with the fixture.
    const reversed: QuestionAnswerPayload = {
      question_batch_id: 'qb-4c19',
      answer_token: 'at-7f3d',
      answers: [
        { question_index: 1, values: ['Add a fuzz target', 'Add a benchmark'] },
        { question_index: 0, values: ['Rewrite the parser'] }
      ]
    }

    const decoded = decodeEnvelope(buildQuestionAnswer({ id: 905, ts: FIXED_TS, payload: reversed }))

    // Descending indices and swapped values survive: the builder sorts nothing.
    expect(decoded.payload).toEqual(reversed)
  })

  it('throws WireEncodeError when the envelope exceeds the plaintext cap', () => {
    // The over-cap value is operator-typed free text, the field most likely to reach the cap in
    // ordinary use: upstream bounds neither entry count nor value length.
    const overCap: QuestionAnswerPayload = {
      question_batch_id: 'qb-4c19',
      answer_token: 'at-7f3d',
      answers: [{ question_index: 0, values: ['x'.repeat(MAX_PLAINTEXT_BYTES + 1)] }]
    }

    expect(() => buildQuestionAnswer({ id: 905, ts: FIXED_TS, payload: overCap })).toThrow(
      WireEncodeError
    )
  })
})

describe('buildQuestionRefused', () => {
  const FIXED_TS = '2026-09-02T10:00:01Z'
  // The daemon's second fixture (question_refused.json).
  const PAYLOAD: QuestionRefusedPayload = {
    question_batch_id: 'qb-91ae',
    answer_token: 'at-2c60'
  }

  it('round-trips to a question_refused envelope carrying the exact id, ts, and no answers', () => {
    const bytes = buildQuestionRefused({ id: 906, ts: FIXED_TS, payload: PAYLOAD })

    const envelope = decodeEnvelope(bytes)
    expect(envelope.type).toBe('question_refused')
    expect(envelope.id).toBe(906)
    expect(envelope.ts).toBe(FIXED_TS)
    // Exact toEqual over the two fields proves no `answers` key rode along: a refusal is its own
    // type precisely so it cannot express "answered with nothing".
    expect(envelope.payload).toEqual({ question_batch_id: 'qb-91ae', answer_token: 'at-2c60' })
  })

  it('throws WireEncodeError when the envelope exceeds the plaintext cap', () => {
    const overCap: QuestionRefusedPayload = {
      question_batch_id: 'x'.repeat(MAX_PLAINTEXT_BYTES + 1),
      answer_token: 'at-2c60'
    }

    expect(() => buildQuestionRefused({ id: 906, ts: FIXED_TS, payload: overCap })).toThrow(
      WireEncodeError
    )
  })
})
