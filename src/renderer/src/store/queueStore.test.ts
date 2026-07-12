import { describe, it, expect } from 'vitest'
import {
  createQueueStore,
  initialQueueState,
  selectBacklogFor,
  selectBacklogs,
  EMPTY_BACKLOG
} from './queueStore'
import type { QueuedItem } from '@shared/wire/types'

// Plain-function store tests over isolated createQueueStore() instances — the sessionIdStore.test
// idiom. No React, no bridge: the store is pure renderer state with a single set-on-snapshot
// mutation. The held value is the wire QueuedItem[] backlog held VERBATIM (snake_case, enqueue
// order), keyed by conversationId and superseded whole-value by each later queue_state snapshot
// (REPLACEMENT truth, not merge/append) — the conversationListStore posture.

const a: QueuedItem = { queued_msg_id: 1, text: 'a', ts: '2026-07-10T00:00:00Z' }
const b: QueuedItem = { queued_msg_id: 2, text: 'b', ts: '2026-07-10T00:01:00Z' }

describe('queueStore', () => {
  it('starts empty — no snapshot for any conversation (AC3)', () => {
    const store = createQueueStore()
    expect(store.getState().backlogs.size).toBe(0)
    const held = selectBacklogFor('c1')(store.getState())
    expect(held).toEqual([])
    // The empty default is the stable EMPTY_BACKLOG reference — never a fresh [] per read.
    expect(held).toBe(EMPTY_BACKLOG)
  })

  it('records a snapshot verbatim; selectBacklogFor returns it by reference (AC1)', () => {
    const store = createQueueStore()
    const items: readonly QueuedItem[] = [a, b]
    store.getState().setBacklog({ conversationId: 'c1', queued: items })
    const held = selectBacklogFor('c1')(store.getState())
    // Same reference, same order — no coercion, no copy (the conversationListStore posture).
    expect(held).toBe(items)
  })

  it('a later snapshot replaces the held backlog wholesale — most recent wins (AC2)', () => {
    const store = createQueueStore()
    store.getState().setBacklog({ conversationId: 'c1', queued: [a, b] })
    store.getState().setBacklog({ conversationId: 'c1', queued: [b] })
    // The removed entry `a` is gone, order follows the event, no merge.
    expect(selectBacklogFor('c1')(store.getState())).toEqual([b])
  })

  it('clears to empty on an empty snapshot — the daemon says this backlog is now empty (AC2)', () => {
    const store = createQueueStore()
    store.getState().setBacklog({ conversationId: 'c1', queued: [a, b] })
    store.getState().setBacklog({ conversationId: 'c1', queued: [] })
    // The key still reads empty (replacement truth); we do not require the key be deleted.
    expect(selectBacklogFor('c1')(store.getState())).toEqual([])
  })

  it('keeps each conversation independent — a snapshot for one never clobbers another (AC2)', () => {
    const store = createQueueStore()
    store.getState().setBacklog({ conversationId: 'c1', queued: [a] })
    store.getState().setBacklog({ conversationId: 'c2', queued: [b] })
    expect(selectBacklogFor('c1')(store.getState())).toEqual([a])
    expect(selectBacklogFor('c2')(store.getState())).toEqual([b])
  })

  it('leaves a foreign-key write reference-stable — a c2 write does not churn a c1 watcher', () => {
    const store = createQueueStore()
    store.getState().setBacklog({ conversationId: 'c1', queued: [a] })
    const before = selectBacklogFor('c1')(store.getState())
    store.getState().setBacklog({ conversationId: 'c2', queued: [b] })
    const after = selectBacklogFor('c1')(store.getState())
    // Object.is true — the c1 array is the same reference, so a c1 selector won't re-render.
    expect(after).toBe(before)
  })

  it('exposes the whole map via selectBacklogs (the #197 read surface)', () => {
    const store = createQueueStore()
    store.getState().setBacklog({ conversationId: 'c1', queued: [a] })
    store.getState().setBacklog({ conversationId: 'c2', queued: [b] })
    const map = selectBacklogs(store.getState())
    expect(map.size).toBe(2)
    expect(map.get('c1')).toEqual([a])
    expect(map.get('c2')).toEqual([b])
  })

  it('keeps two stores independent (DI)', () => {
    const x = createQueueStore()
    const y = createQueueStore()
    x.getState().setBacklog({ conversationId: 'c1', queued: [a] })
    expect(selectBacklogFor('c1')(x.getState())).toEqual([a])
    expect(selectBacklogFor('c1')(y.getState())).toEqual([])
    expect(y.getState().backlogs.size).toBe(0)
  })

  it('starts from an injected initial state (DI)', () => {
    const seed = new Map<string, readonly QueuedItem[]>([['c1', [a]]])
    const store = createQueueStore({ backlogs: seed })
    expect(selectBacklogFor('c1')(store.getState())).toEqual([a])
  })

  it('initialQueueState is an empty map', () => {
    expect(initialQueueState).toEqual({ backlogs: new Map() })
  })

  it('keeps the setBacklog reference stable across updates', () => {
    const store = createQueueStore()
    const before = store.getState().setBacklog
    store.getState().setBacklog({ conversationId: 'c1', queued: [a] })
    expect(store.getState().setBacklog).toBe(before)
  })
})
