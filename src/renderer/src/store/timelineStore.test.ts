import { describe, it, expect } from 'vitest'
import type { ThreadItem } from './threadTimeline'
import { createTimelineStore, selectItems, selectPhase } from './timelineStore'

// The store wrapper only threads the (already-covered) reduceTimeline — these tests assert the
// wiring (initial state, dispatch → reduce, selectors, DI isolation), NOT the reducer's branches,
// which threadTimeline.test.ts owns.

describe('createTimelineStore', () => {
  it('starts at the initial, idle, empty timeline', () => {
    const store = createTimelineStore()
    expect(selectItems(store.getState())).toEqual([])
    expect(selectPhase(store.getState())).toBe('idle')
  })

  it('dispatch threads the reducer: two same-turn deltas coalesce into one growing item', () => {
    const store = createTimelineStore()
    store.getState().dispatch({ type: 'assistantDelta', turnId: 'A', seq: 0, text: 'Hel' })
    store.getState().dispatch({ type: 'assistantDelta', turnId: 'A', seq: 1, text: 'lo' })

    const items = selectItems(store.getState())
    expect(items).toHaveLength(1)
    const item = items[0] as Extract<ThreadItem, { kind: 'assistantText' }>
    expect(item.kind).toBe('assistantText')
    expect(item.text).toBe('Hello')
    expect(item.turnId).toBe('A')
  })

  it('dispatching a turnEnd appends a turnBoundary and leaves phase untouched', () => {
    const store = createTimelineStore()
    store.getState().dispatch({ type: 'turnEnd', turnId: 'A', stopReason: 'end_turn' })

    const items = selectItems(store.getState())
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('turnBoundary')
    expect(selectPhase(store.getState())).toBe('idle')
  })

  it('two instances are isolated — dispatching into one leaves the other at initial state', () => {
    const a = createTimelineStore()
    const b = createTimelineStore()
    a.getState().dispatch({ type: 'assistantDelta', turnId: 'A', seq: 0, text: 'hi' })

    expect(selectItems(a.getState())).toHaveLength(1)
    expect(selectItems(b.getState())).toEqual([])
  })
})
