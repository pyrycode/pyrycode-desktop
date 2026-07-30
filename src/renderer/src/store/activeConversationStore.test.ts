import { describe, it, expect } from 'vitest'
import {
  createActiveConversationStore,
  initialActiveConversationState,
  selectActiveConversation
} from './activeConversationStore'
import type { ConversationCreatedPayload } from '@shared/wire/types'

// Plain-function store tests over isolated createActiveConversationStore() instances — the
// sessionIdStore.test idiom. No React, no bridge: the store is pure renderer state with two
// independent whole-value writes — set-on-create and clear-on-context-end (#529). The held value is
// the daemon's ConversationCreatedPayload verbatim (snake_case, no camelCase remap — the
// conversationListStore doctrine), superseded whole-value by each later conversation_created and
// returned to the exported initial state by the clear.

function payload(overrides: Partial<ConversationCreatedPayload> = {}): ConversationCreatedPayload {
  return {
    id: 'c1',
    is_promoted: false,
    cwd: '/home/pyry/scratch',
    name: null,
    last_used_at: '2026-07-12T00:00:00Z',
    ...overrides
  }
}

describe('activeConversationStore', () => {
  it('starts with no active conversation — activeConversation is null', () => {
    const store = createActiveConversationStore()
    expect(store.getState().activeConversation).toBeNull()
    expect(selectActiveConversation(store.getState())).toBeNull()
  })

  it('setActiveConversation records the payload verbatim; the selector returns it', () => {
    const store = createActiveConversationStore()
    const created = payload({ cwd: '/home/pyry/proj' })
    store.getState().setActiveConversation(created)
    // Held verbatim — same reference, no projection or remap.
    expect(selectActiveConversation(store.getState())).toBe(created)
  })

  it('a later setActiveConversation replaces the held payload — most recent wins, whole-value replace', () => {
    const store = createActiveConversationStore()
    const first = payload({ id: 'c1' })
    const second = payload({ id: 'c2' })
    store.getState().setActiveConversation(first)
    store.getState().setActiveConversation(second)
    expect(selectActiveConversation(store.getState())).toBe(second)
  })

  it('keeps two stores independent (DI)', () => {
    const a = createActiveConversationStore()
    const b = createActiveConversationStore()
    const created = payload()
    a.getState().setActiveConversation(created)
    expect(selectActiveConversation(a.getState())).toBe(created)
    expect(selectActiveConversation(b.getState())).toBeNull()
  })

  it('starts from an injected initial state (DI)', () => {
    const seed = payload({ id: 'seed' })
    const store = createActiveConversationStore({ activeConversation: seed })
    expect(selectActiveConversation(store.getState())).toBe(seed)
  })

  it('initialActiveConversationState is a null conversation', () => {
    expect(initialActiveConversationState).toEqual({ activeConversation: null })
  })

  it('keeps the setActiveConversation reference stable across updates', () => {
    const store = createActiveConversationStore()
    const before = store.getState().setActiveConversation
    store.getState().setActiveConversation(payload())
    expect(store.getState().setActiveConversation).toBe(before)
  })

  it('clearActiveConversation after a set yields the exported initial state (#529)', () => {
    const store = createActiveConversationStore()
    store.getState().setActiveConversation(payload())
    store.getState().clearActiveConversation()
    // Asserted against the exported constant, not a literal — so this survives a second field.
    expect(store.getState()).toMatchObject(initialActiveConversationState)
    expect(selectActiveConversation(store.getState())).toBeNull()
  })

  it('clearActiveConversation from the initial state is a no-op, not an error (#529)', () => {
    const store = createActiveConversationStore()
    expect(() => store.getState().clearActiveConversation()).not.toThrow()
    expect(store.getState()).toMatchObject(initialActiveConversationState)
    // A second consecutive clear is equally inert.
    store.getState().clearActiveConversation()
    expect(store.getState()).toMatchObject(initialActiveConversationState)
  })

  it('setActiveConversation still records after a clear — the clear does not damage the setter (#529)', () => {
    const store = createActiveConversationStore()
    const first = payload({ id: 'c1' })
    const second = payload({ id: 'c2' })
    store.getState().setActiveConversation(first)
    store.getState().clearActiveConversation()
    store.getState().setActiveConversation(second)
    expect(selectActiveConversation(store.getState())).toBe(second)
  })

  it('keeps two stores independent across a clear (DI, #529)', () => {
    const a = createActiveConversationStore()
    const b = createActiveConversationStore()
    const held = payload({ id: 'b1' })
    a.getState().setActiveConversation(payload({ id: 'a1' }))
    b.getState().setActiveConversation(held)
    a.getState().clearActiveConversation()
    expect(selectActiveConversation(a.getState())).toBeNull()
    expect(selectActiveConversation(b.getState())).toBe(held)
  })

  it('keeps the clearActiveConversation reference stable across updates (#529)', () => {
    const store = createActiveConversationStore()
    const before = store.getState().clearActiveConversation
    store.getState().setActiveConversation(payload())
    store.getState().clearActiveConversation()
    expect(store.getState().clearActiveConversation).toBe(before)
  })
})
