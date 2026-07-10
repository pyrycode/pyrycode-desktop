import { describe, it, expect } from 'vitest'
import {
  reduceModal,
  initialModalState,
  selectOutstanding,
  type ModalEvent,
  type ModalPrompt,
  type ModalState
} from './modalPrompts'

// Fixture builders — plain renderer-local events, no transport/wire involved. Mirror
// threadTimeline.test.ts's `toolUse(...)` idiom: sensible defaults, override only what a case asserts.
function shown(
  modalId: string,
  overrides: Partial<Omit<Extract<ModalEvent, { type: 'shown' }>, 'type' | 'modalId'>> = {}
): ModalEvent {
  return {
    type: 'shown',
    modalId,
    class: 'permission',
    title: `Title ${modalId}`,
    prompt: `Allow ${modalId}?`,
    options: [
      { id: 'allow', label: 'Allow' },
      { id: 'deny', label: 'Deny' }
    ],
    defaultOptionId: 'deny',
    ...overrides
  }
}

function dismissed(
  modalId: string,
  outcome = 'deny',
  source: 'remote' | 'local' | 'timeout' = 'remote'
): ModalEvent {
  return { type: 'dismissed', modalId, outcome, source }
}

/** Fold a sequence of events over the initial state — the reducer's natural exercise shape. */
function run(events: readonly ModalEvent[]): ModalState {
  return events.reduce(reduceModal, initialModalState)
}

describe('reduceModal — install', () => {
  it('holds a single shown prompt addressed by modalId, carrying its fields verbatim', () => {
    const state = run([shown('m1')])
    expect(state.outstanding).toHaveLength(1)
    const prompt: ModalPrompt = {
      modalId: 'm1',
      class: 'permission',
      title: 'Title m1',
      prompt: 'Allow m1?',
      options: [
        { id: 'allow', label: 'Allow' },
        { id: 'deny', label: 'Deny' }
      ],
      defaultOptionId: 'deny'
    }
    expect(state.outstanding[0]).toEqual(prompt)
  })

  it('carries a trust class through unchanged', () => {
    const state = run([shown('m1', { class: 'trust' })])
    expect(state.outstanding[0].class).toBe('trust')
  })
})

describe('reduceModal — multiple outstanding', () => {
  it('holds two distinct-id prompts in arrival (oldest-first) order', () => {
    const state = run([shown('m1'), shown('m2')])
    expect(state.outstanding.map((p) => p.modalId)).toEqual(['m1', 'm2'])
    expect(selectOutstanding(state)).toHaveLength(2)
  })
})

describe('reduceModal — clear by id', () => {
  it('removes exactly the matching prompt, leaving the others', () => {
    const state = run([shown('m1'), shown('m2'), shown('m3'), dismissed('m2')])
    expect(state.outstanding.map((p) => p.modalId)).toEqual(['m1', 'm3'])
  })
})

describe('reduceModal — unknown-id no-op (AC4)', () => {
  it('returns the same state reference when dismissing against an empty set', () => {
    const after = reduceModal(initialModalState, dismissed('nope'))
    expect(after).toBe(initialModalState)
    expect(() => reduceModal(initialModalState, dismissed('nope'))).not.toThrow()
  })

  it('returns the same state reference when no outstanding id matches', () => {
    const populated = run([shown('m1'), shown('m2')])
    const after = reduceModal(populated, dismissed('nope'))
    expect(after).toBe(populated)
    expect(after.outstanding).toBe(populated.outstanding)
  })
})

describe('reduceModal — options / default preserved', () => {
  it('round-trips options order and defaultOptionId into the held prompt unchanged', () => {
    const options = [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
      { id: 'always', label: 'Always' }
    ]
    const state = run([shown('m1', { options, defaultOptionId: 'no' })])
    expect(state.outstanding[0].options).toEqual(options)
    expect(state.outstanding[0].defaultOptionId).toBe('no')
  })
})

describe('reduceModal — dismissed keys only on modalId', () => {
  it('clears identically regardless of outcome/source', () => {
    const base = run([shown('m1')])
    const a = reduceModal(base, dismissed('m1', 'allow', 'remote'))
    const b = reduceModal(base, dismissed('m1', 'timeout-default', 'timeout'))
    expect(a.outstanding).toEqual([])
    expect(b.outstanding).toEqual([])
  })
})

describe('reduceModal — purity', () => {
  it('does not mutate the input state or its outstanding array on shown', () => {
    const start = run([shown('m1')])
    const startOutstanding = start.outstanding
    const startPrompt = start.outstanding[0]

    const next = reduceModal(start, shown('m2'))

    // New references where a change occurred.
    expect(next.outstanding).not.toBe(start.outstanding)
    // Old references intact and unmutated.
    expect(start.outstanding).toBe(startOutstanding)
    expect(start.outstanding).toHaveLength(1)
    expect(start.outstanding[0]).toBe(startPrompt)
  })

  it('does not mutate the surviving prompt when dismissing another', () => {
    const start = run([shown('m1'), shown('m2')])
    const survivor = start.outstanding[0]
    const next = reduceModal(start, dismissed('m2'))

    expect(next.outstanding).not.toBe(start.outstanding)
    expect(start.outstanding).toHaveLength(2)
    expect(next.outstanding[0]).toBe(survivor)
  })
})

describe('initial state + selector', () => {
  it('initialModalState is an empty outstanding set', () => {
    expect(initialModalState.outstanding).toEqual([])
  })

  it('selectOutstanding returns the current slice by reference', () => {
    const state = run([shown('m1')])
    expect(selectOutstanding(state)).toBe(state.outstanding)
  })
})
