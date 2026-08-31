import { describe, it, expect } from 'vitest'
import type { ModalEvent, ModalPrompt } from './modalPrompts'
import { createModalStore, selectOutstanding } from './modalStore'

// The store wrapper only threads the (already-covered) reduceModal — these tests assert the wiring
// (initial state, dispatch → reduce, DI isolation), NOT the reducer's branches, which
// modalPrompts.test.ts owns.

const shown: ModalEvent = {
  type: 'shown',
  conversationId: 'conv-7f3a',
  modalId: 'mdl-7f3a',
  class: 'permission',
  title: 'Allow Bash?',
  prompt: 'run rm -rf',
  options: [
    { id: 'allow', label: 'Allow' },
    { id: 'deny', label: 'Deny' }
  ],
  defaultOptionId: 'deny'
}

describe('createModalStore', () => {
  it('starts at the initial, empty outstanding set', () => {
    const store = createModalStore()
    expect(selectOutstanding(store.getState())).toEqual([])
  })

  it('dispatch threads the reducer: a shown appends one prompt with the copied fields', () => {
    const store = createModalStore()
    store.getState().dispatch(shown)

    const outstanding = selectOutstanding(store.getState())
    expect(outstanding).toHaveLength(1)
    const prompt = outstanding[0] as ModalPrompt
    expect(prompt).toEqual({
      // #878: distinct from the modal id, so this exact-match expectation catches a transposition of
      // the two adjacent `string` fields — which `tsc` cannot see through the cast above.
      conversationId: 'conv-7f3a',
      modalId: 'mdl-7f3a',
      class: 'permission',
      title: 'Allow Bash?',
      prompt: 'run rm -rf',
      options: [
        { id: 'allow', label: 'Allow' },
        { id: 'deny', label: 'Deny' }
      ],
      defaultOptionId: 'deny'
    })
  })

  it('dispatching a dismissed for that modalId empties outstanding', () => {
    const store = createModalStore()
    store.getState().dispatch(shown)
    store.getState().dispatch({ type: 'dismissed', modalId: 'mdl-7f3a', outcome: 'allow', source: 'remote' })

    expect(selectOutstanding(store.getState())).toEqual([])
  })

  it('dispatching a dismissed for an unknown modalId is a no-op — same state reference', () => {
    const store = createModalStore()
    store.getState().dispatch(shown)
    const afterShown = store.getState()

    store.getState().dispatch({ type: 'dismissed', modalId: 'unknown', outcome: 'allow', source: 'remote' })
    expect(store.getState()).toBe(afterShown)
  })

  it('two instances are isolated — dispatching into one leaves the other at initial state', () => {
    const a = createModalStore()
    const b = createModalStore()
    a.getState().dispatch(shown)

    expect(selectOutstanding(a.getState())).toHaveLength(1)
    expect(selectOutstanding(b.getState())).toEqual([])
  })
})
