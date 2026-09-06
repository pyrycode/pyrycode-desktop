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

  // #197's reset-on-reconnect, scoped to the reconnecting server by #1138. The caller resolves "which
  // conversations belong to this server" from the server-keyed conversation list (#1086) and hands the
  // ids across; this setter drops exactly those keys and leaves every other server's held backlog
  // alone. After it, dropped keys read empty via EMPTY_BACKLOG (AC3) and that server's connect-time
  // re-sends repopulate through setBacklog unchanged.
  it('drops exactly the listed conversations and leaves the rest held (AC1)', () => {
    const store = createQueueStore()
    store.getState().setBacklog({ conversationId: 'a1', queued: [a, b] })
    store.getState().setBacklog({ conversationId: 'b1', queued: [b] })
    store.getState().resetBacklogsFor(new Set(['b1']))
    // Absent == empty: the dropped key reads the stable EMPTY_BACKLOG reference (AC3).
    expect(selectBacklogFor('b1')(store.getState())).toBe(EMPTY_BACKLOG)
    expect(selectBacklogFor('a1')(store.getState())).toEqual([a, b])
  })

  it('keeps a surviving backlog BY REFERENCE, so a component watching it does not re-render', () => {
    const store = createQueueStore()
    const held: readonly QueuedItem[] = [a, b]
    store.getState().setBacklog({ conversationId: 'a1', queued: held })
    store.getState().setBacklog({ conversationId: 'b1', queued: [b] })
    store.getState().resetBacklogsFor(new Set(['b1']))
    expect(selectBacklogFor('a1')(store.getState())).toBe(held)
  })

  it('is a same-reference no-op when no held key is listed (the size === 0 property, generalised)', () => {
    const store = createQueueStore()
    store.getState().setBacklog({ conversationId: 'a1', queued: [a] })
    const before = store.getState()
    // A reconnecting server whose conversations hold nothing here. Returning the identical state lets
    // zustand's Object.is short-circuit — no churn, no re-render.
    store.getState().resetBacklogsFor(new Set(['b1', 'b2']))
    expect(store.getState()).toBe(before)
  })

  it('is a same-reference no-op for an empty id set and for an empty store', () => {
    const store = createQueueStore()
    const empty = store.getState()
    // First connect: nothing held, and the reconnecting server's list has not loaded either.
    store.getState().resetBacklogsFor(new Set())
    expect(store.getState()).toBe(empty)
    store.getState().setBacklog({ conversationId: 'a1', queued: [a] })
    const held = store.getState()
    store.getState().resetBacklogsFor(new Set())
    expect(store.getState()).toBe(held)
  })

  it('does not mutate the map it was handed out — copy-on-write like setBacklog', () => {
    const store = createQueueStore()
    store.getState().setBacklog({ conversationId: 'a1', queued: [a] })
    store.getState().setBacklog({ conversationId: 'b1', queued: [b] })
    const beforeMap = store.getState().backlogs
    store.getState().resetBacklogsFor(new Set(['b1']))
    expect(beforeMap.size).toBe(2)
    expect(beforeMap.get('b1')).toEqual([b])
  })

  it('drop then setBacklog repopulates one conversation — replacement truth unchanged (AC2)', () => {
    const store = createQueueStore()
    store.getState().setBacklog({ conversationId: 'c1', queued: [a, b] })
    store.getState().resetBacklogsFor(new Set(['c1']))
    store.getState().setBacklog({ conversationId: 'c1', queued: [a] })
    expect(selectBacklogFor('c1')(store.getState())).toEqual([a])
  })

  it('keeps the resetBacklogsFor reference stable across updates', () => {
    const store = createQueueStore()
    const before = store.getState().resetBacklogsFor
    store.getState().setBacklog({ conversationId: 'c1', queued: [a] })
    expect(store.getState().resetBacklogsFor).toBe(before)
  })
})

// clearAllBacklogs (#1138) — the pairing-boundary drop that replaces the self-heal scoping the
// reconnect reset removed. Nullary by design: no daemon-supplied id may steer which backlogs survive.
describe('clearAllBacklogs', () => {
  it('drops EVERY server’s backlogs, whatever the conversation list says (AC3’s complement)', () => {
    const store = createQueueStore()
    store.getState().setBacklog({ conversationId: 'a1', queued: [a] })
    store.getState().setBacklog({ conversationId: 'b1', queued: [b] })
    // Deliberately including the case resetBacklogsFor is DEFINED to leave alone: a backlog whose
    // conversation appears in no server's list. The scoped reset must not reach it (AC3); the pairing
    // boundary must, because nothing on the next pairing re-asserts it.
    store.getState().setBacklog({ conversationId: 'orphan', queued: [a, b] })
    store.getState().clearAllBacklogs()
    expect(store.getState().backlogs.size).toBe(0)
    expect(selectBacklogFor('a1')(store.getState())).toBe(EMPTY_BACKLOG)
    expect(selectBacklogFor('b1')(store.getState())).toBe(EMPTY_BACKLOG)
    expect(selectBacklogFor('orphan')(store.getState())).toBe(EMPTY_BACKLOG)
  })

  it('returns initialQueueState BY REFERENCE and is a same-reference no-op when already clear', () => {
    // THE SUBSCRIBER SHORT-CIRCUIT, the `clearAllModelLists` shape: handing the state OBJECT straight
    // back on an already-clear store makes zustand's Object.is fire, so a redundant clear — a second
    // pairing change with nothing queued — wakes NO listener rather than only sparing the selectors.
    const store = createQueueStore()
    const empty = store.getState()
    store.getState().clearAllBacklogs()
    expect(store.getState()).toBe(empty)
    store.getState().setBacklog({ conversationId: 'a1', queued: [a] })
    store.getState().clearAllBacklogs()
    expect(store.getState().backlogs).toBe(initialQueueState.backlogs)
    const cleared = store.getState()
    store.getState().clearAllBacklogs()
    expect(store.getState()).toBe(cleared)
  })

  it('does not mutate the map it was handed out — copy-on-write like the two setters', () => {
    const store = createQueueStore()
    store.getState().setBacklog({ conversationId: 'a1', queued: [a] })
    const beforeMap = store.getState().backlogs
    store.getState().clearAllBacklogs()
    expect(beforeMap.size).toBe(1)
    expect(beforeMap.get('a1')).toEqual([a])
  })

  it('takes no arguments, so no daemon-supplied id can steer which backlogs survive', () => {
    // The call-side half of the nullary property (`tsc` enforces the other half). A queued item's
    // `text` is untrusted daemon-relayed content, so an id-taking clear would let the DEPARTING daemon
    // choose which of its own messages outlive the pairing.
    const store = createQueueStore()
    expect(store.getState().clearAllBacklogs).toHaveLength(0)
  })

  it('keeps the clearAllBacklogs reference stable across updates', () => {
    const store = createQueueStore()
    const before = store.getState().clearAllBacklogs
    store.getState().setBacklog({ conversationId: 'c1', queued: [a] })
    expect(store.getState().clearAllBacklogs).toBe(before)
  })
})
