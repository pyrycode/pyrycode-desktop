import { describe, it, expect, vi } from 'vitest'
import {
  refuseQuestionBatch,
  answerQuestionBatch,
  resolveQuestionAnswers,
  QUESTION_REFUSAL_OUTCOME,
  QUESTION_REFUSAL_SOURCE,
  QUESTION_ANSWER_OUTCOME,
  QUESTION_ANSWER_SOURCE,
  type QuestionResolveDeps
} from './questionResolution'
import type { RendererCommand } from '@shared/ipc/commands'
import type { QuestionAnswerEntry } from '@shared/wire/types'
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
): QuestionResolveDeps {
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

// ---------------------------------------------------------------------------------------------
// #922 — the answer half. `resolveQuestionAnswers` decides answerability AND builds the payload in
// one pass, so every case below is simultaneously a gate assertion and a frame assertion; that is
// the whole reason the two are one function rather than two that can disagree.

/** A question with named options, so an assertion can tell one label from another. `multiSelect` is
 *  irrelevant to resolution — the store's arms already enforce the single-select shape (optionPicked
 *  replaces, otherPicked clears the options), so nothing here re-derives it. */
const askAbout = (labels: readonly string[], over: Partial<Question> = {}): Question => ({
  question: 'Which of these should you learn next?',
  header: 'Language',
  options: labels.map((label) => ({ label, description: '' })),
  multiSelect: true,
  ...over
})

const picked = (over: Partial<QuestionSelection> = {}): QuestionSelection => ({
  optionIndices: [],
  otherText: '',
  otherTicked: false,
  ...over
})

/** The picks shape `selectBatchSelections` hands the container: one batch's question→selection map. */
const selections = (
  entries: readonly (readonly [number, QuestionSelection])[]
): ReadonlyMap<number, QuestionSelection> => new Map(entries)

describe('resolveQuestionAnswers (#922)', () => {
  it('yields one entry per question, in question order, with labels in ascending display order', () => {
    const answers = resolveQuestionAnswers(
      [askAbout(['Rust', 'Elixir', 'Zig']), askAbout(['Yes', 'No'])],
      selections([
        // Ticked third-then-first; the store holds ASCENDING display order regardless of click order,
        // so the frame reads in claude's own order rather than the operator's.
        [0, picked({ optionIndices: [0, 2] })],
        [1, picked({ optionIndices: [1] })]
      ])
    )

    // `toEqual` on the whole array rather than field-by-field: a dropped entry, a transposed index and
    // a mis-ordered `values` all fail here, and nothing else pins the array's own order.
    expect(answers).toEqual([
      { question_index: 0, values: ['Rust', 'Zig'] },
      { question_index: 1, values: ['No'] }
    ])
  })

  it('appends the operator’s trimmed Other text last, after the ticked labels', () => {
    const answers = resolveQuestionAnswers(
      [askAbout(['Rust', 'Elixir'])],
      selections([[0, picked({ optionIndices: [1], otherText: '  Zig  ', otherTicked: true })]])
    )

    // TRIMMED, and the trimmed value is what is sent — settled on the ticket rather than left open,
    // because a gate and a payload disagreeing about what the value IS would reintroduce the split
    // this one function exists to prevent. Carried as the value itself, never the word "Other". LAST,
    // after every ticked label, which is claude's own display order with the free row at the end.
    expect(answers).toEqual([{ question_index: 0, values: ['Elixir', 'Zig'] }])
  })

  it('carries an Other value that matches none of the offered labels, unchanged', () => {
    const answers = resolveQuestionAnswers(
      [askAbout(['Rust', 'Elixir'])],
      selections([[0, picked({ otherText: 'Prolog', otherTicked: true })]])
    )

    // The daemon checks no value against the offered labels, deliberately: claude's contract permits
    // free text anywhere, so an unlisted value is legal traffic and must not be validated away. A
    // ticked Other with no option pick is a COMPLETE question — the Other row is the only value source
    // a question needs.
    expect(answers).toEqual([{ question_index: 0, values: ['Prolog'] }])
  })

  it('refuses the whole batch when any one question holds no value', () => {
    const questions = [askAbout(['Rust', 'Elixir']), askAbout(['Yes', 'No'])]

    // Nothing anywhere.
    expect(resolveQuestionAnswers(questions, selections([]))).toBeNull()
    // The FIRST question answered and the second untouched — the case the gate exists for, and the one
    // an "assemble what you can" implementation would send as a partial the daemon rejects totally and
    // silently.
    expect(resolveQuestionAnswers(questions, selections([[0, picked({ optionIndices: [0] })]]))).toBeNull()
    // The second answered and the first untouched, so the refusal is not an artefact of position.
    expect(resolveQuestionAnswers(questions, selections([[1, picked({ optionIndices: [0] })]]))).toBeNull()
  })

  it('treats a ticked-but-blank Other row as no value at all', () => {
    // Whitespace-only text does not satisfy the gate — the same trim that produces the sent value
    // decides answerability, so the two cannot disagree about this row.
    expect(
      resolveQuestionAnswers(
        [askAbout(['Rust'])],
        selections([[0, picked({ otherText: '   \t\n  ', otherTicked: true })]])
      )
    ).toBeNull()
    // And typed text with the row UN-ticked contributes nothing either: the store holds `otherText`
    // independently of `otherTicked`, so typing into an un-ticked row is ordinary traffic.
    expect(
      resolveQuestionAnswers(
        [askAbout(['Rust'])],
        selections([[0, picked({ otherText: 'Zig', otherTicked: false })]])
      )
    ).toBeNull()
  })

  it('skips an option position the held batch no longer offers, rather than throwing out of the render', () => {
    // REACHABLE, NOT DEFENSIVE. `reduceQuestionBatches`' `shown` arm replaces a held batch IN PLACE
    // (latest wins) and neither store clears picks on a re-delivery, so a same-nonce question_shown
    // carrying fewer options leaves a pick pointing past the end. This function runs during render to
    // compute the gate, so `options[position].label` would throw `undefined.label` out of the render on
    // traffic the daemon controls and the reducer explicitly supports — the identical hazard the
    // container's activeIndex clamp already guards one level up.
    const shrunk = [askAbout(['Rust'])]

    // The stale position is dropped and the surviving one still answers the question.
    expect(
      resolveQuestionAnswers(shrunk, selections([[0, picked({ optionIndices: [0, 7] })]]))
    ).toEqual([{ question_index: 0, values: ['Rust'] }])
    // And when the stale position was the question's ONLY value, the batch is incomplete rather than
    // carrying a hole: Continue goes unavailable and the operator re-picks against what is on screen.
    expect(resolveQuestionAnswers(shrunk, selections([[0, picked({ optionIndices: [7] })]]))).toBeNull()
  })

  it('ignores a selection held for a question position the batch no longer has', () => {
    // The mirror of the case above at the outer level: the same re-delivery can shorten `questions`.
    // Iteration is over the QUESTIONS, so a stranded selection cannot add a phantom entry — which is
    // what would make the daemon's exact-count check fail on an otherwise complete answer.
    expect(
      resolveQuestionAnswers(
        [askAbout(['Rust'])],
        selections([
          [0, picked({ optionIndices: [0] })],
          [4, picked({ optionIndices: [0] })]
        ])
      )
    ).toEqual([{ question_index: 0, values: ['Rust'] }])
  })
})

describe('answerQuestionBatch (#922)', () => {
  const complete: QuestionAnswerEntry[] = [{ question_index: 0, values: ['Rust'] }]

  it('performs no effect at all on an incomplete batch', () => {
    const log: Recorded[] = []
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    answerQuestionBatch(BATCH_ID, null, recordingDeps(log))

    // THE GATE'S SECOND LAYER, and it is deterministic code rather than a second stochastic rule: the
    // same `null` that disables the button refuses the send, so a handler firing anyway cannot post an
    // under-filled answer the daemon would reject totally and silently. No send, no clear — the panel
    // must stay up, because nothing has been resolved.
    expect(log).toEqual([])
    // AND NOTHING IS LOGGED. An incomplete batch is the gate working, not a fault, and the debug line a
    // developer reaches for here would put the partial payload — claude's labels plus the operator's
    // typed text — into a sink.
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('sends exactly one answerQuestions command carrying the batch id and the entries', () => {
    const log: Recorded[] = []

    answerQuestionBatch(BATCH_ID, complete, recordingDeps(log))

    const sends = log.filter((entry) => entry.effect === 'send')
    expect(sends).toHaveLength(1)
    // `toEqual` on the whole command is what makes "nothing else the client composed" structural: the
    // payload's key set is exactly the two modelled fields, so a renderer-composed `answer_token` fails
    // here. The token the wire frame carries is minted main-side by daemonConnection.answerQuestions
    // and never reaches this layer.
    expect(sends[0]).toEqual({
      effect: 'send',
      command: {
        type: 'answerQuestions',
        payload: { question_batch_id: BATCH_ID, answers: complete }
      }
    })
  })

  it('clears both stores, picks-first, with the picks event carrying the id alone', () => {
    const log: Recorded[] = []

    answerQuestionBatch(BATCH_ID, complete, recordingDeps(log))

    // The refusal path's order, for the refusal path's reason: picks-first leaves the intermediate
    // state "batch still held, picks already cleared", which is indistinguishable from an untouched
    // batch, where batch-first would expose a stale pick outliving its batch at an observable instant.
    expect(log.map((entry) => entry.effect)).toEqual(['send', 'picks', 'batch'])
    expect(log[1]).toEqual({ effect: 'picks', event: { type: 'dismissed', questionBatchId: BATCH_ID } })
    expect(log[2]).toEqual({
      effect: 'batch',
      event: {
        type: 'dismissed',
        questionBatchId: BATCH_ID,
        outcome: QUESTION_ANSWER_OUTCOME,
        source: QUESTION_ANSWER_SOURCE
      }
    })
  })

  it('keeps the answer constants distinct from the refusal’s and out of every daemon vocabulary', () => {
    // The outcome must not be the refusal's: a later reader merging the two families has to be able to
    // tell an operator's answer from an operator's refusal, and both arrive through the SAME dismissed
    // arm. The source stays outside WireModalSource's closed {remote, local, timeout} set for #921's
    // reason — `local` there means an ANSWERED outcome, so borrowing it would make a client-side event
    // indistinguishable from the daemon's own.
    expect(QUESTION_ANSWER_OUTCOME).not.toBe(QUESTION_REFUSAL_OUTCOME)
    expect(['unanswered', 'no_answer', 'remote', 'local', 'timeout']).not.toContain(
      QUESTION_ANSWER_OUTCOME
    )
    expect(['unanswered', 'no_answer', 'remote', 'local', 'timeout']).not.toContain(
      QUESTION_ANSWER_SOURCE
    )
  })

  it('AC4: a throwing send bridge does not propagate, and both clears still post', () => {
    const log: Recorded[] = []
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() =>
      answerQuestionBatch(BATCH_ID, complete, recordingDeps(log, { throwOnSend: true }))
    ).not.toThrow()

    expect(log.map((entry) => entry.effect)).toEqual(['send', 'picks', 'batch'])
    // NO INTERPOLATION AND NO SECOND ARGUMENT, and the rule binds harder on this path than on the
    // refusal's: the payload this send choked on carries claude-authored option labels AND whatever the
    // operator typed into the Other row, beside the one-time batch nonce. An Error raised by a failing
    // structured clone can stringify the argument it choked on.
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError.mock.calls[0]).toEqual(['question answer send failed'])
    expect(consoleError.mock.calls[0][0]).not.toContain(BATCH_ID)
    expect(consoleError.mock.calls[0][0]).not.toContain('Rust')
    consoleError.mockRestore()
  })
})
