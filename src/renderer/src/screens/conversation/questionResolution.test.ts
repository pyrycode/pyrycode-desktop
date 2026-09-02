import { describe, it, expect, vi } from 'vitest'
import {
  refuseQuestionBatch,
  QUESTION_REFUSAL_OUTCOME,
  QUESTION_REFUSAL_SOURCE,
  type QuestionRefuseDeps
} from './questionResolution'
import type { RendererCommand } from '@shared/ipc/commands'
import { createQuestionBatchStore } from '../../store/questionBatchStore'
import { createQuestionPicksStore, type QuestionSelection } from '../../store/questionPicksStore'
import type { Question } from '../../store/questionBatches'

// The modalResolution.test.ts idiom (#237): the helper is framework-free, so every case here is plain
// spies — no React, no DOM, no Electron, no preload bridge. That is what makes AC3 provable at all
// under `environment: 'node'`, where the view cannot be driven.
//
// SECRET HYGIENE. The batch id below is a spec-local literal, and `answer_token` appears NOWHERE in
// this file — the renderer never holds one (RefuseQuestionsCommandPayload Omit-excludes it and
// daemonConnection.refuseQuestions mints it main-side), so an assertion about a token here would be
// asserting against the wrong layer as well as putting a secret's shape in a spec.

const BATCH_ID = 'question-batch-refusal'
const OTHER_BATCH_ID = 'question-batch-untouched'

/** One recorded effect, so ORDER across the two stores is observable rather than inferred from two
 *  separate spies' call counts. */
type Recorded = { effect: 'send'; command: RendererCommand } | { effect: 'picks' | 'batch'; event: unknown }

/** Deps writing into one shared log. `throwOnSend` is AC3's whole fixture: the send fails, the two
 *  clears must still post. */
function recordingDeps(
  log: Recorded[],
  options: { throwOnSend?: boolean } = {}
): QuestionRefuseDeps {
  return {
    sendCommand: (command) => {
      log.push({ effect: 'send', command })
      if (options.throwOnSend) throw new Error('bridge gone')
    },
    dispatchPicks: (event) => log.push({ effect: 'picks', event }),
    dispatchBatch: (event) => log.push({ effect: 'batch', event })
  }
}

const question = (): Question => ({
  question: 'Which of these three programming languages should you learn next?',
  header: 'Language',
  options: [{ label: 'Rust', description: 'systems' }],
  multiSelect: false
})

describe('refuseQuestionBatch (#921)', () => {
  it('sends exactly one refuseQuestions command carrying the batch id and nothing else', () => {
    const log: Recorded[] = []

    refuseQuestionBatch(BATCH_ID, recordingDeps(log))

    const sends = log.filter((entry) => entry.effect === 'send')
    expect(sends).toHaveLength(1)
    // AC1, asserted on the COMMAND rather than on the wire frame: the payload's whole key set is the
    // batch id. `toEqual` on the command object is what makes "nothing else the client composed"
    // structural — a smuggled second field fails here. The frame the main side then builds carries the
    // token it mints beside this id, which is why this assertion lives at this layer and not at e2e's.
    expect(sends[0]).toEqual({
      effect: 'send',
      command: { type: 'refuseQuestions', payload: { question_batch_id: BATCH_ID } }
    })
  })

  it('clears both stores, picks-first, with the picks event carrying the id alone', () => {
    const log: Recorded[] = []

    refuseQuestionBatch(BATCH_ID, recordingDeps(log))

    // THE ORDER IS THE ASSERTION, and it is load-bearing rather than tidiness: zustand notifies
    // subscribers synchronously inside `setState`, so the store written first has already woken every
    // subscriber before the second write happens. Picks-first leaves the intermediate state "batch
    // still held, picks already cleared" — indistinguishable from an untouched batch. Batch-first
    // would expose a stale pick outliving its batch at an observable instant. Matches
    // subscribeQuestionBatches' fan-out order, so the local and daemon-driven paths cannot drift.
    expect(log.map((entry) => entry.effect)).toEqual(['send', 'picks', 'batch'])

    // THE PICKS EVENT'S KEY SET IS THE GUARD, and `toEqual` is the only thing that catches it: the
    // batch store's dismissed arm is structurally ASSIGNABLE to the picks store's, so forwarding the
    // richer event would compile clean while carrying `outcome`/`source` into a store that must never
    // hold them (the exact trap translateQuestionPickEvent's docblock records).
    expect(log[1]).toEqual({
      effect: 'picks',
      event: { type: 'dismissed', questionBatchId: BATCH_ID }
    })
    // The batch arm requires both, and both are CLIENT-OWNED constants — outside the producer's one
    // landed pair ('unanswered' / 'no_answer') AND outside WireModalSource's closed
    // {remote, local, timeout} set, so no later reader can take either for a daemon answer.
    expect(log[2]).toEqual({
      effect: 'batch',
      event: {
        type: 'dismissed',
        questionBatchId: BATCH_ID,
        outcome: QUESTION_REFUSAL_OUTCOME,
        source: QUESTION_REFUSAL_SOURCE
      }
    })
  })

  it('keeps both constants out of every daemon vocabulary', () => {
    // Asserted as VALUES rather than as a comment, because the reflex substitution — copying
    // modalResolution's `source: 'local'` — compiles clean and reads as an ANSWERED outcome in the
    // modal vocabulary. That is the misreading the store's fail-closed rule exists to prevent.
    expect(['unanswered', 'no_answer', 'remote', 'local', 'timeout']).not.toContain(
      QUESTION_REFUSAL_OUTCOME
    )
    expect(['unanswered', 'no_answer', 'remote', 'local', 'timeout']).not.toContain(
      QUESTION_REFUSAL_SOURCE
    )
  })

  it('AC3: a throwing send bridge does not propagate, and both clears still post', () => {
    const log: Recorded[] = []
    // The catch logs a static, content-free string and DROPS the error object (unlike
    // modalResolution's `console.error(msg, error)`): an Error raised by a failing bridge send can
    // stringify the payload it choked on, which carries the one-time nonce. Silenced here so a
    // deliberate failure case does not print during a green run.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => refuseQuestionBatch(BATCH_ID, recordingDeps(log, { throwOnSend: true }))).not.toThrow()

    expect(log.map((entry) => entry.effect)).toEqual(['send', 'picks', 'batch'])
    expect(log[1]).toEqual({
      effect: 'picks',
      event: { type: 'dismissed', questionBatchId: BATCH_ID }
    })
    // NO INTERPOLATION AND NO SECOND ARGUMENT — the content-free-log rule, asserted rather than
    // trusted: the exact argument list is pinned, so adding the caught error (or the batch id) to the
    // call fails here.
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError.mock.calls[0]).toEqual(['question refusal send failed'])
    expect(consoleError.mock.calls[0][0]).not.toContain(BATCH_ID)
    consoleError.mockRestore()
  })

  it('AC2: the batch leaves both real stores, and the daemon’s own dismissal afterwards changes nothing', () => {
    // Real store instances rather than spies, because AC2's second half is a claim about the STORES'
    // behaviour under a second dismissal — a spy could only prove the helper was called.
    const batches = createQuestionBatchStore({
      outstanding: [
        { conversationId: 'conv-1', questionBatchId: BATCH_ID, questions: [question()] },
        { conversationId: 'conv-2', questionBatchId: OTHER_BATCH_ID, questions: [question()] }
      ]
    })
    // ANNOTATED, not inferred: from a bare literal `tsc` narrows `otherTicked` to the FIRST entry's
    // `false` and then rejects the second entry's `true` — the map's own value type is what the store
    // holds, so it is stated rather than derived from the seed.
    const picks = createQuestionPicksStore({
      picks: new Map<string, ReadonlyMap<number, QuestionSelection>>([
        [BATCH_ID, new Map([[0, { optionIndices: [0], otherText: 'Zig', otherTicked: false }]])],
        [OTHER_BATCH_ID, new Map([[0, { optionIndices: [1], otherText: '', otherTicked: true }]])]
      ])
    })

    refuseQuestionBatch(BATCH_ID, {
      sendCommand: () => {},
      dispatchPicks: (event) => picks.getState().dispatch(event),
      dispatchBatch: (event) => batches.getState().dispatch(event)
    })

    // Gone from both — and the sibling batch, which the operator did not refuse, is untouched in both.
    expect(batches.getState().outstanding.map((b) => b.questionBatchId)).toEqual([OTHER_BATCH_ID])
    expect(picks.getState().picks.has(BATCH_ID)).toBe(false)
    expect(picks.getState().picks.has(OTHER_BATCH_ID)).toBe(true)

    const batchesAfterRefusal = batches.getState()
    const picksAfterRefusal = picks.getState()

    // The daemon's own question_dismissed for the SAME batch, arriving after the optimistic clear —
    // the ordinary case, since pyrycode#1990 broadcasts one on consuming the batch. REFERENCE
    // IDENTITY is the assertion, not shape equality: both reducers return the same state object on an
    // unknown id, so "changes nothing further" means no subscriber wakes at all. A shape-equal-but-new
    // object would pass a toEqual and still re-render every bound component.
    batches.getState().dispatch({
      type: 'dismissed',
      questionBatchId: BATCH_ID,
      outcome: 'unanswered',
      source: 'no_answer'
    })
    picks.getState().dispatch({ type: 'dismissed', questionBatchId: BATCH_ID })

    expect(batches.getState()).toBe(batchesAfterRefusal)
    expect(picks.getState()).toBe(picksAfterRefusal)
  })
})
