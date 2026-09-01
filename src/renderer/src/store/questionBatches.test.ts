import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  reduceQuestionBatches,
  initialQuestionBatchState,
  selectBatchFor,
  selectOutstandingBatches,
  type Question,
  type QuestionBatchEvent,
  type QuestionBatchState,
  type QuestionOption
} from './questionBatches'

// Fixture builders — plain renderer-local events, no transport/wire involved. Mirror
// modalPrompts.test.ts's `shown(...)` idiom: sensible defaults, override only what a case asserts.
// Every default is supplied BEFORE the spread, which is what keeps `overrides` optional.
function option(label: string): QuestionOption {
  return { label, description: `Why ${label}` }
}

function question(header: string, overrides: Partial<Question> = {}): Question {
  return {
    // Derived from, but never equal to, the header: all four strings are `string`, so only distinct
    // values can catch a transposition between two of them.
    question: `Which ${header}?`,
    header,
    options: [option('First'), option('Second')],
    multiSelect: false,
    ...overrides
  }
}

function shown(
  questionBatchId: string,
  overrides: Partial<
    Omit<Extract<QuestionBatchEvent, { type: 'shown' }>, 'type' | 'questionBatchId'>
  > = {}
): QuestionBatchEvent {
  return {
    type: 'shown',
    conversationId: `conv-${questionBatchId}`,
    questionBatchId,
    questions: [question('Strategy')],
    ...overrides
  }
}

// The producer's ONE landed pair for the whole no-answer class. Deliberately NOT `source: 'timeout'`
// — that value lives only in upstream's `testdata/question_dismissed.json`, a shape fixture minted by
// the declaring slice before any producer existed. Copying it would read as coverage of vocabulary
// nothing emits.
function dismissed(
  questionBatchId: string,
  outcome = 'unanswered',
  source = 'no_answer'
): QuestionBatchEvent {
  return { type: 'dismissed', questionBatchId, outcome, source }
}

function reconnected(): QuestionBatchEvent {
  return { type: 'reconnected' }
}

/** Fold a sequence of events over the initial state — the reducer's natural exercise shape. */
function run(events: readonly QuestionBatchEvent[]): QuestionBatchState {
  return events.reduce(reduceQuestionBatches, initialQuestionBatchState)
}

describe('questionBatches — framework-free (AC1)', () => {
  it('imports no React, Zustand, IPC or transport module', () => {
    const source = readFileSync(new URL('./questionBatches.ts', import.meta.url), 'utf8')
    const imports = [...source.matchAll(/^\s*import\s[^\n]*?from\s+'([^']+)'/gm)].map((m) => m[1])
    // The module is a leaf: it imports NOTHING. Asserting the empty set rather than a denylist means
    // a future import of any kind reddens here and gets read on purpose.
    expect(imports).toEqual([])
  })
})

describe('reduceQuestionBatches — install (AC1/AC2)', () => {
  it('holds a shown batch addressed by questionBatchId, carrying both nesting levels verbatim', () => {
    const state = run([shown('batch-1')])
    expect(state.outstanding).toEqual([
      {
        conversationId: 'conv-batch-1',
        questionBatchId: 'batch-1',
        questions: [
          {
            question: 'Which Strategy?',
            header: 'Strategy',
            options: [
              { label: 'First', description: 'Why First' },
              { label: 'Second', description: 'Why Second' }
            ],
            multiSelect: false
          }
        ]
      }
    ])
  })

  it('COPIES the event conversation id, never derives one from the batch nonce', () => {
    const state = run([shown('batch-1', { conversationId: 'conv-elsewhere' })])
    expect(state.outstanding[0]?.conversationId).toBe('conv-elsewhere')
    expect(state.outstanding[0]?.questionBatchId).toBe('batch-1')
  })

  it('carries a multi-select question through as a stated position, not an absent key', () => {
    const state = run([shown('batch-1', { questions: [question('Pick', { multiSelect: true })] })])
    expect(state.outstanding[0]?.questions[0]?.multiSelect).toBe(true)
  })

  it('holds two distinct-id batches in arrival (oldest-first) order', () => {
    const state = run([shown('batch-1'), shown('batch-2')])
    expect(state.outstanding.map((b) => b.questionBatchId)).toEqual(['batch-1', 'batch-2'])
  })
})

describe('reduceQuestionBatches — re-delivery idempotency (AC2, the #195 finding)', () => {
  it('a re-delivered shown for a live id replaces in place — no duplicate, position preserved', () => {
    const state = run([
      shown('batch-1'),
      shown('batch-2'),
      shown('batch-1', { questions: [question('Revised')] })
    ])
    expect(state.outstanding).toHaveLength(2)
    expect(state.outstanding.map((b) => b.questionBatchId)).toEqual(['batch-1', 'batch-2'])
    expect(state.outstanding[0]?.questions[0]?.header).toBe('Revised')
  })

  it('the replacement takes the RE-DELIVERED conversation id, not the stale one', () => {
    const state = run([shown('batch-1'), shown('batch-1', { conversationId: 'conv-moved' })])
    expect(state.outstanding).toHaveLength(1)
    expect(state.outstanding[0]?.conversationId).toBe('conv-moved')
  })

  it('does not mutate the input state or its outstanding array on a replace in place', () => {
    const before = run([shown('batch-1')])
    const snapshot = before.outstanding[0]
    const after = reduceQuestionBatches(before, shown('batch-1', { questions: [question('New')] }))
    expect(before.outstanding).toHaveLength(1)
    expect(before.outstanding[0]).toBe(snapshot)
    expect(before.outstanding[0]?.questions[0]?.header).toBe('Strategy')
    expect(after.outstanding[0]).not.toBe(snapshot)
  })
})

describe('reduceQuestionBatches — an empty question list installs nothing (AC2)', () => {
  it('returns the same state reference against the initial state', () => {
    const next = reduceQuestionBatches(initialQuestionBatchState, shown('batch-1', { questions: [] }))
    expect(next).toBe(initialQuestionBatchState)
  })

  it('returns the same state reference with batches already held, installing nothing', () => {
    const before = run([shown('batch-1')])
    const after = reduceQuestionBatches(before, shown('batch-2', { questions: [] }))
    expect(after).toBe(before)
    expect(after.outstanding.map((b) => b.questionBatchId)).toEqual(['batch-1'])
  })

  it('does NOT replace a live batch when the re-delivery is empty', () => {
    const before = run([shown('batch-1')])
    const after = reduceQuestionBatches(before, shown('batch-1', { questions: [] }))
    expect(after).toBe(before)
    expect(after.outstanding[0]?.questions).toHaveLength(1)
  })

  it('a later dismissal for the never-installed id is an unknown-id no-op, which stays consistent', () => {
    const before = reduceQuestionBatches(initialQuestionBatchState, shown('batch-1', { questions: [] }))
    expect(reduceQuestionBatches(before, dismissed('batch-1'))).toBe(before)
  })
})

describe('reduceQuestionBatches — clear by id (AC3)', () => {
  it('removes exactly the matching batch, leaving the others', () => {
    const state = run([shown('batch-1'), shown('batch-2'), dismissed('batch-1')])
    expect(state.outstanding.map((b) => b.questionBatchId)).toEqual(['batch-2'])
  })

  it('returns the same state reference when dismissing against an empty set', () => {
    expect(reduceQuestionBatches(initialQuestionBatchState, dismissed('batch-1'))).toBe(
      initialQuestionBatchState
    )
  })

  it('returns the same state reference when no held id matches, never throwing', () => {
    const before = run([shown('batch-1')])
    expect(reduceQuestionBatches(before, dismissed('batch-unknown'))).toBe(before)
  })

  it('a dismissed id does NOT suppress a later legitimate shown of that id (no resolved memory)', () => {
    const state = run([shown('batch-1'), dismissed('batch-1'), shown('batch-1')])
    expect(state.outstanding.map((b) => b.questionBatchId)).toEqual(['batch-1'])
  })
})

describe('reduceQuestionBatches — dismissal keys only on questionBatchId (AC3)', () => {
  it('clears identically across the landed producer pair and an unrecognised source', () => {
    const held = run([shown('batch-1')])
    // An unrecognised `source` means RESOLVED, CAUSE UNKNOWN — never an answer. Clearing on any
    // source is what satisfies that rule at this layer; nothing here reads `source` at all.
    for (const event of [
      dismissed('batch-1'),
      dismissed('batch-1', 'unanswered', 'a-source-this-client-does-not-know'),
      dismissed('batch-1', 'some-producer-sentinel', '')
    ]) {
      expect(reduceQuestionBatches(held, event).outstanding).toEqual([])
    }
  })
})

describe('reduceQuestionBatches — reconnect reconcile (AC4, the #415 finding)', () => {
  it('clears every held batch, leaving the daemon re-send as the sole repopulation truth', () => {
    const state = run([shown('batch-1'), shown('batch-2'), reconnected()])
    expect(state.outstanding).toEqual([])
  })

  it('returns the same state reference when nothing is held — the first connect', () => {
    expect(reduceQuestionBatches(initialQuestionBatchState, reconnected())).toBe(
      initialQuestionBatchState
    )
  })

  it('a still-held batch re-sent after the reset surfaces exactly once', () => {
    const state = run([shown('batch-1'), reconnected(), shown('batch-1')])
    expect(state.outstanding).toHaveLength(1)
    expect(state.outstanding[0]?.questionBatchId).toBe('batch-1')
  })

  it('does not mutate the input state or its outstanding array on the reset', () => {
    const before = run([shown('batch-1')])
    reduceQuestionBatches(before, reconnected())
    expect(before.outstanding).toHaveLength(1)
  })
})

describe('selectOutstandingBatches (AC5)', () => {
  it('returns the current slice by reference', () => {
    const state = run([shown('batch-1')])
    expect(selectOutstandingBatches(state)).toBe(state.outstanding)
  })

  it('initialQuestionBatchState holds nothing outstanding', () => {
    expect(selectOutstandingBatches(initialQuestionBatchState)).toEqual([])
  })
})

describe('selectBatchFor — the per-conversation read (AC5)', () => {
  it("answers with the conversation's batch, both orders intact", () => {
    const questions = [
      question('Alpha', { options: [option('A1'), option('A2'), option('A3')] }),
      question('Beta')
    ]
    const state = run([shown('batch-1', { conversationId: 'conv-x', questions })])
    const batch = selectBatchFor('conv-x')(state)
    expect(batch?.questions.map((q) => q.header)).toEqual(['Alpha', 'Beta'])
    expect(batch?.questions[0]?.options.map((o) => o.label)).toEqual(['A1', 'A2', 'A3'])
  })

  it('answers with undefined for a conversation holding no batch', () => {
    const state = run([shown('batch-1', { conversationId: 'conv-x' })])
    expect(selectBatchFor('conv-y')(state)).toBeUndefined()
  })

  it('answers an unknown conversation id with undefined, never an error', () => {
    expect(selectBatchFor('conv-never-seen')(initialQuestionBatchState)).toBeUndefined()
    // A prototype-named query is an ordinary miss: the scan compares own field VALUES and never
    // resolves a key onto Object.prototype.
    expect(selectBatchFor('__proto__')(initialQuestionBatchState)).toBeUndefined()
    expect(selectBatchFor('constructor')(run([shown('batch-1')]))).toBeUndefined()
  })

  it('answers with the FIRST in insertion order when two batches share a conversation', () => {
    const state = run([
      shown('batch-1', { conversationId: 'conv-x' }),
      shown('batch-2', { conversationId: 'conv-x' })
    ])
    expect(selectBatchFor('conv-x')(state)?.questionBatchId).toBe('batch-1')
  })

  it('scopes to the asking conversation, leaving another conversation answered separately', () => {
    const state = run([
      shown('batch-1', { conversationId: 'conv-x' }),
      shown('batch-2', { conversationId: 'conv-y' })
    ])
    expect(selectBatchFor('conv-x')(state)?.questionBatchId).toBe('batch-1')
    expect(selectBatchFor('conv-y')(state)?.questionBatchId).toBe('batch-2')
  })

  it('answers with undefined once the conversation-bound batch is dismissed', () => {
    const state = run([shown('batch-1', { conversationId: 'conv-x' }), dismissed('batch-1')])
    expect(selectBatchFor('conv-x')(state)).toBeUndefined()
  })
})

describe('reduceQuestionBatches — purity', () => {
  it('does not mutate the input state or its outstanding array on shown', () => {
    const before: QuestionBatchState = initialQuestionBatchState
    const after = reduceQuestionBatches(before, shown('batch-1'))
    expect(before.outstanding).toEqual([])
    expect(after.outstanding).not.toBe(before.outstanding)
  })

  it('does not mutate the surviving batch when dismissing another', () => {
    const before = run([shown('batch-1'), shown('batch-2')])
    const survivor = before.outstanding[1]
    const after = reduceQuestionBatches(before, dismissed('batch-1'))
    expect(after.outstanding[0]).toBe(survivor)
    expect(before.outstanding).toHaveLength(2)
  })

  it('holds the questions array the event carried, without copying it per question', () => {
    const questions = [question('Alpha')]
    const state = run([shown('batch-1', { questions })])
    expect(state.outstanding[0]?.questions).toBe(questions)
  })
})
