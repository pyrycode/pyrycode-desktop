import { describe, it, expect } from 'vitest'
import type { ConversationSummary } from '@shared/wire/types'
import {
  createConversationListStore,
  initialConversationListState,
  selectConversations
} from './conversationListStore'

// Plain-function store tests over isolated createConversationListStore() instances — the
// runConfigStore.test idiom. No React, no bridge: the store is pure renderer state with a single
// set-on-event mutation. Rows are held verbatim in wire snake_case (no camelCase remap, unlike
// runConfigStore) — the whole point is drift-free reuse of ConversationSummary.

const row = (over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id: 'c1',
  name: 'Design review',
  is_promoted: true,
  is_archived: false,
  cwd: '/home/pyry/project',
  last_message_ts: '2026-07-10T12:00:00Z',
  last_used_at: '2026-07-10T12:05:00Z',
  ...over
})

describe('conversationListStore', () => {
  it('starts not-loaded — conversations is null (AC1)', () => {
    const store = createConversationListStore()
    expect(store.getState().conversations).toBeNull()
    expect(selectConversations(store.getState())).toBeNull()
  })

  it('setConversations records the list; selectConversations returns it (AC2)', () => {
    const store = createConversationListStore()
    const list = [row({ id: 'a' }), row({ id: 'b' })]
    store.getState().setConversations(list)
    expect(selectConversations(store.getState())).toEqual(list)
  })

  it('a later setConversations replaces the held list — most recent wins, no merge, no dedupe (AC2)', () => {
    const store = createConversationListStore()
    store.getState().setConversations([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })])
    store.getState().setConversations([row({ id: 'z' })])
    expect(selectConversations(store.getState())).toEqual([row({ id: 'z' })])
  })

  it('holds an empty list verbatim — [] is loaded-zero, NOT null (AC1)', () => {
    const store = createConversationListStore()
    store.getState().setConversations([])
    const held = selectConversations(store.getState())
    expect(held).not.toBeNull()
    expect(held).toEqual([])
  })

  it('holds a row verbatim in snake_case, including name: null (AC3)', () => {
    const store = createConversationListStore()
    const unnamed = row({ id: 'u', name: null, is_promoted: false, is_archived: true })
    store.getState().setConversations([unnamed])
    const held = selectConversations(store.getState())
    expect(held).toEqual([
      {
        id: 'u',
        name: null,
        is_promoted: false,
        is_archived: true,
        cwd: '/home/pyry/project',
        last_message_ts: '2026-07-10T12:00:00Z',
        last_used_at: '2026-07-10T12:05:00Z'
      }
    ])
  })

  it('keeps two stores independent (DI)', () => {
    const a = createConversationListStore()
    const b = createConversationListStore()
    a.getState().setConversations([row()])
    expect(selectConversations(a.getState())).not.toBeNull()
    expect(selectConversations(b.getState())).toBeNull()
  })

  it('starts from an injected initial state (DI)', () => {
    const list = [row({ id: 'seed' })]
    const store = createConversationListStore({ conversations: list })
    expect(selectConversations(store.getState())).toEqual(list)
  })

  it('initialConversationListState is a null list', () => {
    expect(initialConversationListState).toEqual({ conversations: null })
  })

  it('keeps the setConversations reference stable across updates', () => {
    const store = createConversationListStore()
    const before = store.getState().setConversations
    store.getState().setConversations([row()])
    expect(store.getState().setConversations).toBe(before)
  })
})
