import { describe, it, expect } from 'vitest'
import {
  createQuestionPicksStore,
  questionPicksStore,
  selectQuestionSelection,
  selectBatchSelections,
  type QuestionSelection
} from './questionPicksStore'

// Two DISTINCT batch ids and two distinct question positions throughout, so an exact expectation
// catches a transposition — `questionBatchId` is a plain `string` and both indices are plain
// `number`, so `tsc` sees through none of them. Neither id resembles a real nonce beyond its shape;
// nothing here needs one, because no assertion depends on the value.
const BATCH = 'qb-alpha'
const OTHER_BATCH = 'qb-beta'

/** Read one question's selection out of a live store — the production read surface, not a peek at
 *  `picks` directly, so every assertion below also exercises the selector. */
function selectionAt(
  store: ReturnType<typeof createQuestionPicksStore>,
  questionBatchId: string,
  questionIndex: number
): QuestionSelection {
  return selectQuestionSelection(questionBatchId, questionIndex)(store.getState())
}

const EMPTY: QuestionSelection = { optionIndices: [], otherText: '', otherTicked: false }

describe('createQuestionPicksStore — single-select arms (AC1, AC2)', () => {
  it('optionPicked records the position; a second pick on the same question REPLACES it', () => {
    const store = createQuestionPicksStore()
    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: BATCH,
      questionIndex: 0,
      optionIndex: 2
    })
    expect(selectionAt(store, BATCH, 0).optionIndices).toEqual([2])

    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: BATCH,
      questionIndex: 0,
      optionIndex: 1
    })
    // Replacement, never accumulation: a radio group holds at most one.
    expect(selectionAt(store, BATCH, 0).optionIndices).toEqual([1])
  })

  it('optionPicked clears the Other tick but LEAVES the typed text (AC2)', () => {
    const store = createQuestionPicksStore()
    store.getState().dispatch({
      type: 'otherTextChanged',
      multiSelect: false,
      questionBatchId: BATCH,
      questionIndex: 0,
      text: 'a third way'
    })
    store.getState().dispatch({ type: 'otherPicked', questionBatchId: BATCH, questionIndex: 0 })
    expect(selectionAt(store, BATCH, 0)).toEqual({
      optionIndices: [],
      otherText: 'a third way',
      otherTicked: true
    })

    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: BATCH,
      questionIndex: 0,
      optionIndex: 1
    })
    // Mutually exclusive in the single-select shape — and the text survives the tick being cleared,
    // which is the half of AC2 a naive "reset the Other row" would drop.
    expect(selectionAt(store, BATCH, 0)).toEqual({
      optionIndices: [1],
      otherText: 'a third way',
      otherTicked: false
    })
  })

  it('otherPicked clears the option pick and leaves the text (AC2, the other direction)', () => {
    const store = createQuestionPicksStore()
    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: BATCH,
      questionIndex: 0,
      optionIndex: 3
    })
    store.getState().dispatch({
      type: 'otherTextChanged',
      multiSelect: false,
      questionBatchId: BATCH,
      questionIndex: 0,
      text: 'neither'
    })
    store.getState().dispatch({ type: 'otherPicked', questionBatchId: BATCH, questionIndex: 0 })

    expect(selectionAt(store, BATCH, 0)).toEqual({
      optionIndices: [],
      otherText: 'neither',
      otherTicked: true
    })
  })
})

describe('createQuestionPicksStore — multi-select arms (AC1, AC2)', () => {
  it('optionToggled accumulates, and un-ticking one leaves the others in place', () => {
    const store = createQuestionPicksStore()
    for (const optionIndex of [2, 0, 1]) {
      store
        .getState()
        .dispatch({ type: 'optionToggled', questionBatchId: BATCH, questionIndex: 0, optionIndex })
    }
    // Held in ASCENDING display order, not click order: two tick sequences ending at the same set
    // produce the same value, which is what keeps the same-value guard honest.
    expect(selectionAt(store, BATCH, 0).optionIndices).toEqual([0, 1, 2])

    store.getState().dispatch({
      type: 'optionToggled',
      questionBatchId: BATCH,
      questionIndex: 0,
      optionIndex: 1
    })
    expect(selectionAt(store, BATCH, 0).optionIndices).toEqual([0, 2])
  })

  it('otherToggled sits ALONGSIDE ticked option picks, and un-ticking leaves the text (AC2)', () => {
    const store = createQuestionPicksStore()
    store.getState().dispatch({
      type: 'optionToggled',
      questionBatchId: BATCH,
      questionIndex: 0,
      optionIndex: 1
    })
    store.getState().dispatch({ type: 'otherToggled', questionBatchId: BATCH, questionIndex: 0 })
    store.getState().dispatch({
      type: 'otherTextChanged',
      multiSelect: true,
      questionBatchId: BATCH,
      questionIndex: 0,
      text: 'and also this'
    })

    // Beside, not instead of — the multi-select half of AC2, and the opposite of `otherPicked`.
    expect(selectionAt(store, BATCH, 0)).toEqual({
      optionIndices: [1],
      otherText: 'and also this',
      otherTicked: true
    })

    store.getState().dispatch({ type: 'otherToggled', questionBatchId: BATCH, questionIndex: 0 })
    expect(selectionAt(store, BATCH, 0)).toEqual({
      optionIndices: [1],
      otherText: 'and also this',
      otherTicked: false
    })
  })

  it('optionToggled never moves the Other tick', () => {
    const store = createQuestionPicksStore()
    store.getState().dispatch({ type: 'otherToggled', questionBatchId: BATCH, questionIndex: 0 })
    store.getState().dispatch({
      type: 'optionToggled',
      questionBatchId: BATCH,
      questionIndex: 0,
      optionIndex: 0
    })

    expect(selectionAt(store, BATCH, 0)).toEqual({
      optionIndices: [0],
      otherText: '',
      otherTicked: true
    })
  })
})

describe('createQuestionPicksStore — typing into Other ticks it, as on mobile (#1698)', () => {
  it('single-select: typing replaces the picked option with Other, and a later pick keeps the text', () => {
    const store = createQuestionPicksStore()
    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: BATCH,
      questionIndex: 0,
      optionIndex: 1
    })
    store.getState().dispatch({
      type: 'otherTextChanged',
      multiSelect: false,
      questionBatchId: BATCH,
      questionIndex: 0,
      text: 'typed'
    })
    // Radio semantics: Other and an option are mutually exclusive, so ticking one clears the other.
    expect(selectionAt(store, BATCH, 0)).toEqual({
      optionIndices: [],
      otherText: 'typed',
      otherTicked: true
    })

    // Un-ticking Other by picking an option leaves the text, which is still held apart from the tick.
    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: BATCH,
      questionIndex: 0,
      optionIndex: 0
    })
    expect(selectionAt(store, BATCH, 0)).toEqual({
      optionIndices: [0],
      otherText: 'typed',
      otherTicked: false
    })
  })

  it('multi-select: typing ticks Other beside the ticked options, and un-ticking keeps the text', () => {
    const store = createQuestionPicksStore()
    for (const optionIndex of [2, 0]) {
      store
        .getState()
        .dispatch({ type: 'optionToggled', questionBatchId: BATCH, questionIndex: 0, optionIndex })
    }
    store.getState().dispatch({
      type: 'otherTextChanged',
      multiSelect: true,
      questionBatchId: BATCH,
      questionIndex: 0,
      text: 'typed'
    })
    expect(selectionAt(store, BATCH, 0)).toEqual({
      optionIndices: [0, 2],
      otherText: 'typed',
      otherTicked: true
    })

    store.getState().dispatch({ type: 'otherToggled', questionBatchId: BATCH, questionIndex: 0 })
    expect(selectionAt(store, BATCH, 0)).toEqual({
      optionIndices: [0, 2],
      otherText: 'typed',
      otherTicked: false
    })
  })

  it('emptying the text leaves Other ticked, in both shapes', () => {
    for (const multiSelect of [false, true]) {
      const store = createQuestionPicksStore()
      for (const text of ['typed', '']) {
        store.getState().dispatch({
          type: 'otherTextChanged',
          multiSelect,
          questionBatchId: BATCH,
          questionIndex: 0,
          text
        })
      }
      expect(selectionAt(store, BATCH, 0)).toEqual({
        optionIndices: [],
        otherText: '',
        otherTicked: true
      })
    }
  })

  it('multi-select: a later otherTextChanged replaces the text and keeps the tick and the picks', () => {
    const store = createQuestionPicksStore()
    store.getState().dispatch({
      type: 'optionToggled',
      questionBatchId: BATCH,
      questionIndex: 0,
      optionIndex: 4
    })
    store.getState().dispatch({ type: 'otherToggled', questionBatchId: BATCH, questionIndex: 0 })
    store.getState().dispatch({
      type: 'otherTextChanged',
      multiSelect: true,
      questionBatchId: BATCH,
      questionIndex: 0,
      text: 'revised'
    })

    expect(selectionAt(store, BATCH, 0)).toEqual({
      optionIndices: [4],
      otherText: 'revised',
      otherTicked: true
    })
  })
})

describe('createQuestionPicksStore — keying (AC3)', () => {
  it('two questions in ONE batch hold independent picks', () => {
    const store = createQuestionPicksStore()
    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: BATCH,
      questionIndex: 0,
      optionIndex: 1
    })
    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: BATCH,
      questionIndex: 1,
      optionIndex: 0
    })

    expect(selectionAt(store, BATCH, 0).optionIndices).toEqual([1])
    expect(selectionAt(store, BATCH, 1).optionIndices).toEqual([0])
    // A third, untouched position in the same batch holds nothing.
    expect(selectionAt(store, BATCH, 2)).toEqual(EMPTY)
  })

  it('two outstanding batches do not collide', () => {
    const store = createQuestionPicksStore()
    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: BATCH,
      questionIndex: 0,
      optionIndex: 1
    })
    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: OTHER_BATCH,
      questionIndex: 0,
      optionIndex: 2
    })

    expect(selectionAt(store, BATCH, 0).optionIndices).toEqual([1])
    expect(selectionAt(store, OTHER_BATCH, 0).optionIndices).toEqual([2])
  })

  it('holds no string but the operator-typed one — no claude-authored value can be a key', () => {
    const store = createQuestionPicksStore()
    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: BATCH,
      questionIndex: 0,
      optionIndex: 1
    })
    store.getState().dispatch({
      type: 'otherTextChanged',
      multiSelect: false,
      questionBatchId: BATCH,
      questionIndex: 0,
      text: 'operator text'
    })

    // The whole state, flattened: the only strings are the batch id (a key) and the operator's own
    // typed text (a value). A selection is structurally incapable of holding a label, a description,
    // a header or a question — there is no field to put one in, which is what makes the family's
    // "never key on claude-authored text" rule hold here by construction rather than by care.
    expect(Array.from(store.getState().picks.keys())).toEqual([BATCH])
    const inner = store.getState().picks.get(BATCH)
    expect(Array.from(inner?.keys() ?? [])).toEqual([0])
    expect(Object.keys(selectionAt(store, BATCH, 0)).sort()).toEqual([
      'optionIndices',
      'otherText',
      'otherTicked'
    ])
  })

  it('a hostile-shaped batch id is an unremarkable Map key, before any write and after', () => {
    const store = createQuestionPicksStore()
    // Read BEFORE any write: on a `Record` these would resolve up the prototype chain to
    // `Object.prototype` / the `Object` function and read as present. On a `Map` they are absent.
    expect(selectionAt(store, '__proto__', 0)).toEqual(EMPTY)
    expect(selectionAt(store, 'constructor', 0)).toEqual(EMPTY)

    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: '__proto__',
      questionIndex: 0,
      optionIndex: 1
    })
    expect(selectionAt(store, '__proto__', 0).optionIndices).toEqual([1])
    // Nothing leaked onto the prototype, and a sibling key is unaffected.
    expect(({} as Record<string, unknown>).optionIndices).toBeUndefined()
    expect(selectionAt(store, BATCH, 0)).toEqual(EMPTY)
  })
})

describe('createQuestionPicksStore — the clearing arms (AC4)', () => {
  it('dismissed drops exactly the named batch and leaves the sibling standing', () => {
    const store = createQuestionPicksStore()
    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: BATCH,
      questionIndex: 0,
      optionIndex: 1
    })
    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: OTHER_BATCH,
      questionIndex: 0,
      optionIndex: 2
    })

    store.getState().dispatch({ type: 'dismissed', questionBatchId: BATCH })

    expect(selectionAt(store, BATCH, 0)).toEqual(EMPTY)
    expect(selectionAt(store, OTHER_BATCH, 0).optionIndices).toEqual([2])
  })

  it('a dismissed for an unknown id returns the SAME state reference', () => {
    const store = createQuestionPicksStore()
    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: BATCH,
      questionIndex: 0,
      optionIndex: 1
    })
    const before = store.getState()

    store.getState().dispatch({ type: 'dismissed', questionBatchId: 'qb-never-seen' })
    // Referential identity, not equality: pins both the same-reference no-op and zustand's
    // `Object.is` short-circuit, which together cost a subscribed component zero re-renders.
    expect(store.getState()).toBe(before)
  })

  it('a dismissed for an already-cleared id returns the SAME state reference', () => {
    const store = createQuestionPicksStore()
    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: BATCH,
      questionIndex: 0,
      optionIndex: 1
    })
    store.getState().dispatch({ type: 'dismissed', questionBatchId: BATCH })
    const afterFirst = store.getState()

    store.getState().dispatch({ type: 'dismissed', questionBatchId: BATCH })
    expect(store.getState()).toBe(afterFirst)
  })

  it("reconnected drops EVERY batch's picks", () => {
    const store = createQuestionPicksStore()
    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: BATCH,
      questionIndex: 0,
      optionIndex: 1
    })
    store.getState().dispatch({
      type: 'otherToggled',
      questionBatchId: OTHER_BATCH,
      questionIndex: 3
    })

    store.getState().dispatch({ type: 'reconnected' })

    expect(store.getState().picks.size).toBe(0)
    expect(selectionAt(store, BATCH, 0)).toEqual(EMPTY)
    expect(selectionAt(store, OTHER_BATCH, 3)).toEqual(EMPTY)
  })

  it('a reconnected holding nothing returns the SAME state reference', () => {
    const store = createQuestionPicksStore()
    const before = store.getState()

    store.getState().dispatch({ type: 'reconnected' })
    expect(store.getState()).toBe(before)
  })
})

describe('createQuestionPicksStore — same-value writes and copy-on-write', () => {
  it('re-picking the already-picked option returns the SAME state reference', () => {
    const store = createQuestionPicksStore()
    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: BATCH,
      questionIndex: 0,
      optionIndex: 1
    })
    const before = store.getState()

    // Clicking an already-selected radio is an ordinary operator action, not an edge case.
    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: BATCH,
      questionIndex: 0,
      optionIndex: 1
    })
    expect(store.getState()).toBe(before)
  })

  it('an unchanged otherTextChanged and a repeat otherPicked each return the SAME reference', () => {
    const store = createQuestionPicksStore()
    store.getState().dispatch({
      type: 'otherTextChanged',
      multiSelect: false,
      questionBatchId: BATCH,
      questionIndex: 0,
      text: 'same'
    })
    store.getState().dispatch({ type: 'otherPicked', questionBatchId: BATCH, questionIndex: 0 })
    const before = store.getState()

    store.getState().dispatch({
      type: 'otherTextChanged',
      multiSelect: false,
      questionBatchId: BATCH,
      questionIndex: 0,
      text: 'same'
    })
    expect(store.getState()).toBe(before)

    store.getState().dispatch({ type: 'otherPicked', questionBatchId: BATCH, questionIndex: 0 })
    expect(store.getState()).toBe(before)
  })

  it('a write leaves every previously held map and selection untouched', () => {
    const store = createQuestionPicksStore()
    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: BATCH,
      questionIndex: 0,
      optionIndex: 1
    })
    const heldOuter = store.getState().picks
    const heldInner = heldOuter.get(BATCH)
    const heldSelection = selectionAt(store, BATCH, 0)

    // A write into a DIFFERENT question of the same batch, then into a different batch: neither may
    // mutate anything already handed out. Copy-on-write is invisible to `tsc` (`ReadonlyMap` is a
    // compile-time view over a real `Map`), so only this assertion catches an in-place `set`.
    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: BATCH,
      questionIndex: 1,
      optionIndex: 0
    })
    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: OTHER_BATCH,
      questionIndex: 0,
      optionIndex: 0
    })

    expect(heldOuter.size).toBe(1)
    expect(heldInner?.size).toBe(1)
    expect(heldSelection).toEqual({ optionIndices: [1], otherText: '', otherTicked: false })
    // The untouched question's selection is handed back by REFERENCE across the sibling write, so a
    // component bound to it does not re-render.
    expect(selectionAt(store, BATCH, 0)).toBe(heldSelection)
  })
})

describe('selectQuestionSelection', () => {
  it('answers an untouched question with the empty selection, at a STABLE reference', () => {
    const store = createQuestionPicksStore()
    const first = selectionAt(store, BATCH, 0)
    const second = selectionAt(store, BATCH, 0)

    expect(first).toEqual(EMPTY)
    // `Object.is` on the selector's RESULT is what `useStore` compares. A fresh literal per call
    // would differ every render and spin a bound component forever.
    expect(first).toBe(second)
    // The same constant answers an absent batch and an absent question within a present batch.
    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: BATCH,
      questionIndex: 0,
      optionIndex: 1
    })
    expect(selectionAt(store, BATCH, 9)).toBe(first)
    expect(selectionAt(store, OTHER_BATCH, 0)).toBe(first)
  })

  it('answers a picked question with the held selection by reference', () => {
    const store = createQuestionPicksStore()
    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: BATCH,
      questionIndex: 0,
      optionIndex: 1
    })

    expect(selectionAt(store, BATCH, 0)).toBe(store.getState().picks.get(BATCH)?.get(0))
  })
})

describe('selectBatchSelections (#922)', () => {
  /** The whole-batch read, through the production surface. */
  const batchAt = (
    store: ReturnType<typeof createQuestionPicksStore>,
    questionBatchId: string
  ): ReadonlyMap<number, QuestionSelection> => selectBatchSelections(questionBatchId)(store.getState())

  it('answers an untouched batch with an empty map, at a STABLE reference', () => {
    const store = createQuestionPicksStore()
    const first = batchAt(store, BATCH)
    const second = batchAt(store, BATCH)

    expect(first.size).toBe(0)
    // The `selectQuestionSelection` mechanism, for its reason: `useStore` compares the selector's
    // RESULT under `Object.is`, so a fresh `new Map()` per call would differ on every render and spin
    // the panel forever. The container calls this inline in a render with no `useMemo`.
    expect(first).toBe(second)
    // The same constant answers a batch that exists no more and one that never existed.
    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: BATCH,
      questionIndex: 0,
      optionIndex: 1
    })
    expect(batchAt(store, OTHER_BATCH)).toBe(first)
  })

  it('answers a picked batch with the held inner map by reference, across a sibling write', () => {
    const store = createQuestionPicksStore()
    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: BATCH,
      questionIndex: 0,
      optionIndex: 1
    })
    store.getState().dispatch({
      type: 'otherTextChanged',
      multiSelect: false,
      questionBatchId: BATCH,
      questionIndex: 2,
      text: 'Zig'
    })

    // Every question the operator has touched, in one read — which is what makes the batch-wide gate
    // possible at all, since the panel draws one question at a time.
    const held = batchAt(store, BATCH)
    expect(held).toBe(store.getState().picks.get(BATCH))
    expect(held.get(0)?.optionIndices).toEqual([1])
    expect(held.get(2)?.otherText).toBe('Zig')

    // `withSelection` clones on write, so a write to ANOTHER batch carries this one across by
    // reference and the panel does not re-render for a sibling's pick.
    store.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: OTHER_BATCH,
      questionIndex: 0,
      optionIndex: 0
    })
    expect(batchAt(store, BATCH)).toBe(held)
  })

  it('treats a hostile batch id as an ordinary absent key, before any write', () => {
    const store = createQuestionPicksStore()
    // The `Map` property this read inherits from `selectQuestionSelection`: on a `Record` these would
    // resolve up the prototype chain and read as present. A swap to `Record` is no type error, so this
    // read-before-write is what catches one.
    expect(batchAt(store, '__proto__').size).toBe(0)
    expect(batchAt(store, 'constructor').size).toBe(0)
    expect(batchAt(store, '').size).toBe(0)
  })
})

describe('createQuestionPicksStore — the DI seam', () => {
  it('seeds from a passed initial state — what the panel spec needs', () => {
    const seeded: QuestionSelection = {
      optionIndices: [0, 2],
      otherText: 'seeded',
      otherTicked: true
    }
    const store = createQuestionPicksStore({ picks: new Map([[BATCH, new Map([[1, seeded]])]]) })

    expect(selectionAt(store, BATCH, 1)).toBe(seeded)
    expect(selectionAt(store, BATCH, 0)).toEqual(EMPTY)
  })

  it('two instances are isolated — dispatching into one leaves the other empty', () => {
    const a = createQuestionPicksStore()
    const b = createQuestionPicksStore()
    a.getState().dispatch({
      type: 'optionPicked',
      questionBatchId: BATCH,
      questionIndex: 0,
      optionIndex: 1
    })

    expect(selectionAt(a, BATCH, 0).optionIndices).toEqual([1])
    expect(b.getState().picks.size).toBe(0)
  })
})

describe('questionPicksStore (the app singleton)', () => {
  // Read-only on purpose: dispatching into the module-level instance would leak state into any later
  // test in this file. The wiring itself is covered by the factory tests above.
  it('exists, starts empty, and exposes dispatch as the write path', () => {
    expect(questionPicksStore.getState().picks.size).toBe(0)
    expect(typeof questionPicksStore.getState().dispatch).toBe('function')
  })
})
