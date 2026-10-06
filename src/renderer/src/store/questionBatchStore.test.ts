import { describe, it, expect } from 'vitest'
import type { QuestionBatch, QuestionBatchEvent } from './questionBatches'
import {
  createQuestionBatchStore,
  questionBatchStore,
  selectBatchFor,
  selectOutstandingBatches
} from './questionBatchStore'

// The container only threads the (already-covered) `reduceQuestionBatches` — these tests assert the
// WIRING (initial state, dispatch → reduce, same-reference no-op, DI isolation), not the reducer's
// branches, which `questionBatches.test.ts` owns.

const shown: QuestionBatchEvent = {
  type: 'shown',
  conversationId: 'conv-7f3a',
  questionBatchId: 'qb-91c4',
  questions: [
    {
      question: 'Which database should the migration target?',
      header: 'Database',
      options: [
        { label: 'Postgres', description: 'The existing primary' },
        { label: 'SQLite', description: 'Local only' }
      ],
      multiSelect: false
    },
    {
      question: 'Which environments should it run against?',
      header: 'Environments',
      options: [
        { label: 'staging', description: 'Safe to break' },
        { label: 'production', description: 'Not safe to break' }
      ],
      // `true` on the second question deliberately: the family's one renamed field is nested two
      // levels deep, so a container or bridge that dropped it would still pass against an
      // all-`false` fixture.
      multiSelect: true
    }
  ]
}

// The producer's ONE real terminal pair. Never `source: 'timeout'` — that value sits in upstream's
// `question_dismissed.json`, a shape fixture minted before any producer existed; it reads as coverage
// while pinning traffic that does not exist.
const dismissed: QuestionBatchEvent = {
  type: 'dismissed',
  questionBatchId: 'qb-91c4',
  outcome: 'unanswered',
  source: 'no_answer'
}

describe('createQuestionBatchStore', () => {
  it('starts at the initial, empty outstanding set', () => {
    const store = createQuestionBatchStore()
    expect(selectOutstandingBatches(store.getState())).toEqual([])
  })

  it('dispatch threads the reducer: a shown appends one batch with the copied fields', () => {
    const store = createQuestionBatchStore()
    store.getState().dispatch(shown)

    const outstanding = selectOutstandingBatches(store.getState())
    expect(outstanding).toHaveLength(1)
    const batch = outstanding[0] as QuestionBatch
    expect(batch).toEqual({
      // Distinct values on the two adjacent `string` id fields, so this exact-match expectation
      // catches a transposition — which `tsc` cannot see through, both being `string`.
      conversationId: 'conv-7f3a',
      questionBatchId: 'qb-91c4',
      questions: shown.type === 'shown' ? shown.questions : []
    })
  })

  it('dispatching a dismissed for that questionBatchId empties outstanding', () => {
    const store = createQuestionBatchStore()
    store.getState().dispatch(shown)
    store.getState().dispatch(dismissed)

    expect(selectOutstandingBatches(store.getState())).toEqual([])
  })

  it('dispatching a dismissed for an unknown id is a no-op — same state reference', () => {
    const store = createQuestionBatchStore()
    store.getState().dispatch(shown)
    const afterShown = store.getState()

    store.getState().dispatch({ ...dismissed, questionBatchId: 'qb-unknown' })
    // Referential identity, not equality: pins both the reducer's same-reference no-op and zustand's
    // `Object.is` short-circuit, which together cost a subscribed component zero re-renders.
    expect(store.getState()).toBe(afterShown)
  })

  it('dispatching a reconnected clears a populated set', () => {
    const store = createQuestionBatchStore()
    store.getState().dispatch(shown)
    store.getState().dispatch({ type: 'reconnected' })

    // The third arm: proves the single `reduceQuestionBatches` call carries the whole union, with no
    // per-arm handling in the container.
    expect(selectOutstandingBatches(store.getState())).toEqual([])
  })

  it('seeds from a passed initial state — the DI seam the render slices need', () => {
    const seeded: QuestionBatch = {
      conversationId: 'conv-other',
      questionBatchId: 'qb-seeded',
      questions: shown.type === 'shown' ? shown.questions : []
    }
    const store = createQuestionBatchStore({ outstanding: [seeded] })

    expect(selectBatchFor('conv-other')(store.getState())).toBe(seeded)
    expect(selectBatchFor('conv-7f3a')(store.getState())).toBeUndefined()
  })

  it('two instances are isolated — dispatching into one leaves the other at initial state', () => {
    const a = createQuestionBatchStore()
    const b = createQuestionBatchStore()
    a.getState().dispatch(shown)

    expect(selectOutstandingBatches(a.getState())).toHaveLength(1)
    expect(selectOutstandingBatches(b.getState())).toEqual([])
  })
})

describe('questionBatchStore (the app singleton)', () => {
  // Read-only on purpose: dispatching into the module-level instance would leak state into any later
  // test in this file. The wiring itself is covered by the factory tests above.
  it('exists, starts empty, and exposes dispatch as the write path', () => {
    expect(selectOutstandingBatches(questionBatchStore.getState())).toEqual([])
    expect(typeof questionBatchStore.getState().dispatch).toBe('function')
  })
})

it('retires picks before publishing a replacement while same-request redelivery preserves them', () => {
  const retired: string[] = []
  const store = createQuestionBatchStore(undefined, id => {
    retired.push(id)
    expect(selectBatchFor(shown.conversationId)(store.getState())?.questionBatchId).toBe(shown.questionBatchId)
  })
  store.getState().dispatch(shown)
  store.getState().dispatch(shown)
  expect(retired).toEqual([])
  store.getState().dispatch({ ...shown, questionBatchId: 'replacement' })
  expect(retired).toEqual([shown.questionBatchId])
})
