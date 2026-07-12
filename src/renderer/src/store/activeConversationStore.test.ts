import { describe, it, expect } from 'vitest'
import {
  createActiveConversationStore,
  initialActiveConversationState,
  selectActiveConversation
} from './activeConversationStore'
import type { ConversationCreatedPayload } from '@shared/wire/types'

// Plain-function store tests over isolated createActiveConversationStore() instances — the
// sessionIdStore.test idiom. No React, no bridge: the store is pure renderer state with a single
// set-on-create mutation. The held value is the daemon's ConversationCreatedPayload verbatim
// (snake_case, no camelCase remap — the conversationListStore doctrine), superseded whole-value by
// each later conversation_created.

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
})
