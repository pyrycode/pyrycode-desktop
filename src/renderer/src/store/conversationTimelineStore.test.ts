import { describe, it, expect } from 'vitest'
import type { ThreadItem } from './threadTimeline'
import {
  MAX_LIVE_JOIN_KEYS,
  MAX_RETAINED_TIMELINES,
  createConversationTimelineStore,
  initialConversationTimelineState,
  selectHistoryRequestFor,
  selectLiveJoinKeysFor,
  selectPrependedRowsFor,
  selectTimelineFor,
  type HistoryRequestState
} from './conversationTimelineStore'
import type { ThreadEvent, TimelineState } from './threadTimeline'

// Plain-function store tests over isolated createConversationTimelineStore() instances — the
// conversationActivityStore.test idiom. No React, no DOM, no bridge: this store is pure renderer state
// with four write paths and one selector, and `environment: 'node'` is already global at
// vitest.config.ts:27, so this file adds no environment pragma.
//
// Four properties here are invisible to `tsc` and break no other assertion in this file, which is why
// each gets a named test of its own:
//
//   - `selectTimelineFor` must return `null` for an absent key, distinctly from a PRESENT empty slice.
//     A `?? initialTimelineState` at any read site is exactly the collapse that would erase the
//     difference with no type error.
//   - The keyspace must be a `ReadonlyMap`, never a `Record`. Swapping one for the other is not a type
//     error; the hostile-key reads below are the whole defence. On a `Record`, a read of `'__proto__'`
//     or `'constructor'` BEFORE ANY WRITE walks the prototype chain and hands back `Object.prototype` /
//     the `Object` constructor rather than `null` — those two assertions are what fail.
//   - Eviction order is WRITE-and-VIEW sequence, never the key's value. An implementation that sorts
//     keys passes everything except the two victim-choice tests, and a sort would hand a hostile id
//     (`''` sorts first) the choice of which conversation dies.
//   - Least recently VIEWED, not least recently written. An implementation that promotes on `dispatchFor`
//     passes every other scenario and fails "written is not viewed".
//
// Tests construct their own empty-timeline literal rather than importing `initialTimelineState`: the
// store deliberately neither exports nor re-exports one, because a reachable constant invites
// `selectTimelineFor(id) ?? initialTimelineState` at the read site and that collapses the
// absent-vs-observed-empty distinction back again.

type Store = ReturnType<typeof createConversationTimelineStore>

const timelineFor = (store: Store, conversationId: string): TimelineState | null =>
  selectTimelineFor(conversationId)(store.getState())

/** "Observed; nothing in the thread" — a PRESENT slice, and a different reading from `null`. */
const emptyTimeline: TimelineState = {
  thinkingTokens: null,
  resetting: null,
  items: [],
  phase: 'idle',
  stalled: false,
  apiRetry: null,
  compacting: false,
  localSendPending: null
}

const delta = (turnId: string, text: string): ThreadEvent => ({
  type: 'assistantDelta',
  turnId,
  seq: 1,
  text
})

/** A `toolResult` correlating to no held `toolCall`: `reduceTimeline` resolves it to a same-reference
 *  no-op against a fresh state (threadTimeline.ts:345-346). */
const orphanResult: ThreadEvent = {
  type: 'toolResult',
  turnId: 't1',
  toolUseId: 'never-called',
  isError: false,
  resultSummary: 'orphan'
}

/** `c1`…`cN`, in order. */
const ids = (count: number): readonly string[] =>
  Array.from({ length: count }, (_, index) => `c${index + 1}`)

/** The three keys AC5 names. `''` is in the set because it is a legal `Map` key and an illegal
 *  conversation id, so it must behave like any other unremarkable key rather than aliasing anything. */
const hostileKeys = ['__proto__', 'constructor', ''] as const

describe('conversationTimelineStore', () => {
  it('settles a newly created chat under its creating host without a history response', () => {
    const store = createConversationTimelineStore()
    store.getState().markViewed('new-chat')
    store.getState().initializeCreatedTimeline('host-a', 'new-chat')
    const slice = store.getState().timelines.get('new-chat')
    expect(slice?.serverId).toBe('host-a')
    expect(slice?.timeline).toEqual(emptyTimeline)
    expect(slice?.localRead).toBeUndefined()
    expect(slice?.history).toBeNull()
    expect(slice?.restored).toBeUndefined()
  })

  it('does not adopt another host’s rows for an identically named newly created chat', () => {
    const store = createConversationTimelineStore(undefined, () => 'host-a')
    store.getState().dispatchFor('same-id', delta('old-turn', 'old host text'))
    store.getState().initializeCreatedTimeline('host-b', 'same-id')
    expect(store.getState().timelines.get('same-id')?.serverId).toBe('host-b')
    expect(timelineFor(store, 'same-id')).toEqual(emptyTimeline)
  })

  it('starts holding nothing — selectTimelineFor returns null, not an empty slice (AC1, AC4)', () => {
    const store = createConversationTimelineStore()

    expect(store.getState().timelines.size).toBe(0)
    expect(timelineFor(store, 'c1')).toBeNull()
    expect(timelineFor(store, 'c2')).toBeNull()
  })

  it('a fold for an id the client has never opened CREATES that id′s slice (AC1)', () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('c1', delta('t1', 'hello'))

    expect(timelineFor(store, 'c1')?.items).toEqual([
      { kind: 'assistantText', turnId: 't1', text: 'hello' }
    ])
  })

  it('interleaved deltas for two conversations never merge into one thread (AC1)', () => {
    const store = createConversationTimelineStore()
    // The clobber a flat slot causes, and the reason this ticket exists: the daemon fans these frames
    // out to every interactive connection, so frames for DIFFERENT conversations arrive in sequence.
    store.getState().dispatchFor('c1', delta('t1', 'one'))
    store.getState().dispatchFor('c2', delta('t2', 'two'))
    store.getState().dispatchFor('c1', delta('t1', '-more'))

    expect(timelineFor(store, 'c1')?.items).toEqual([
      { kind: 'assistantText', turnId: 't1', text: 'one-more' }
    ])
    expect(timelineFor(store, 'c2')?.items).toEqual([
      { kind: 'assistantText', turnId: 't2', text: 'two' }
    ])
  })

  it('holds the WHOLE TimelineState per id — every chrome scalar, not just items (AC1)', () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('c1', { type: 'turnState', state: 'thinking' })
    store.getState().dispatchFor('c1', { type: 'userText', text: 'hi' })
    store.getState().dispatchFor('c1', { type: 'apiRetry', active: true, current: 1, total: 3 })
    store.getState().dispatchFor('c1', { type: 'compacting', active: true })
    store.getState().dispatchFor('c1', { type: 'stallDetected' })
    store.getState().dispatchFor('c1', { type: 'thinkingProgress', estimatedTokens: 512 })
    store.getState().dispatchFor('c1', {
      type: 'resetting',
      active: true,
      phase: 'restarting',
      handoff: 'written'
    })
    store.getState().dispatchFor('c2', delta('t2', 'quiet'))

    expect(timelineFor(store, 'c1')).toEqual({
      rowKeys: [0], nextRowKey: 1, localEchoes: [],
      items: [{ kind: 'userText', text: 'hi' }],
      phase: 'thinking',
      stalled: true,
      apiRetry: { current: 1, total: 3 },
      compacting: true,
      localSendPending: { messageId: '', queued: false },
      thinkingTokens: 512,
      resetting: { phase: 'restarting', handoff: 'written' }
    })
    // The payload is the whole flat timeline, so none of the seven scalars leaks across the key. #1314's
    // reading joins them, and it is the one a leak would be most visible on: the status row would report
    // how deep a think in ANOTHER conversation had got. #1517's reset is the second of that kind — a leak
    // there would tell the operator a chat they are watching is restarting when a different one is.
    expect(timelineFor(store, 'c2')).toEqual({
      rowKeys: [0], nextRowKey: 1, localEchoes: [],
      items: [{ kind: 'assistantText', turnId: 't2', text: 'quiet' }],
      phase: 'idle',
      stalled: false,
      apiRetry: null,
      compacting: false,
      localSendPending: null,
      thinkingTokens: null,
      resetting: null
    })
  })

  it('a fold that reduces to nothing for an UNKNOWN id still creates a present-empty slice (AC1)', () => {
    const store = createConversationTimelineStore()
    // `reduceTimeline` resolves an orphan result to a same-reference no-op, but the key must still be
    // created: "creates that id's slice rather than dropping it" is unconditional.
    store.getState().dispatchFor('c1', orphanResult)

    expect(timelineFor(store, 'c1')).not.toBeNull()
    expect(timelineFor(store, 'c1')).toEqual(emptyTimeline)
  })

  it('MAX_RETAINED_TIMELINES is ten (AC2)', () => {
    expect(MAX_RETAINED_TIMELINES).toBe(10)
  })

  it('retains exactly MAX_RETAINED_TIMELINES slices — at the bound and one over (AC2)', () => {
    const store = createConversationTimelineStore()
    for (const id of ids(MAX_RETAINED_TIMELINES)) store.getState().dispatchFor(id, delta('t1', 'x'))

    // Exactly AT the bound: every one of them is still held.
    expect(store.getState().timelines.size).toBe(MAX_RETAINED_TIMELINES)
    for (const id of ids(MAX_RETAINED_TIMELINES)) expect(timelineFor(store, id)).not.toBeNull()

    // One OVER: the bound holds and the newest never-viewed slice — the standing eviction candidate —
    // is the one that goes, so a burst of unknown ids evicts only its own predecessors.
    store.getState().dispatchFor('c11', delta('t1', 'x'))

    expect(store.getState().timelines.size).toBe(MAX_RETAINED_TIMELINES)
    expect(timelineFor(store, 'c11')).not.toBeNull()
    expect(timelineFor(store, 'c1')).not.toBeNull()
  })

  it('an evicted id reads null again — absent, not a present-empty slice (AC2, AC4)', () => {
    const store = createConversationTimelineStore()
    for (const id of ids(MAX_RETAINED_TIMELINES)) store.getState().dispatchFor(id, delta('t1', 'x'))
    expect(timelineFor(store, 'c10')).not.toBeNull()

    store.getState().dispatchFor('c11', delta('t1', 'x'))

    // Eviction REMOVES the key. Reopening that conversation shows an empty thread that fills from the
    // next live event — there is no history backfill in this app (activateConversation.ts:42-45).
    expect(timelineFor(store, 'c10')).toBeNull()
  })

  it('a VIEWED slice outranks every never-viewed one (AC2)', () => {
    const store = createConversationTimelineStore()
    store.getState().markViewed('c1')
    for (const id of ids(MAX_RETAINED_TIMELINES).slice(1))
      store.getState().dispatchFor(id, delta('t1', 'x'))
    expect(store.getState().timelines.size).toBe(MAX_RETAINED_TIMELINES)

    store.getState().dispatchFor('c11', delta('t1', 'x'))

    expect(timelineFor(store, 'c1')).not.toBeNull()
    expect(timelineFor(store, 'c10')).toBeNull()
  })

  it('among viewed slices the LEAST RECENTLY viewed goes first (AC2)', () => {
    const store = createConversationTimelineStore()
    for (const id of ids(MAX_RETAINED_TIMELINES)) store.getState().markViewed(id)

    store.getState().dispatchFor('c11', delta('t1', 'x'))

    expect(timelineFor(store, 'c1')).toBeNull()
    for (const id of ids(MAX_RETAINED_TIMELINES).slice(1)) expect(timelineFor(store, id)).not.toBeNull()
  })

  it('WRITTEN is not VIEWED — a busy background thread is evicted before a quiet viewed one (AC2)', () => {
    const store = createConversationTimelineStore()
    // Nine viewed conversations, `cAway` the most recently viewed of them: the operator stepped away
    // from it and it has been silent since.
    store.getState().markViewed('cAway')
    for (const id of ids(MAX_RETAINED_TIMELINES - 2)) store.getState().markViewed(id)
    store.getState().markViewed('cAway')
    // `cBusy` is working in the background: written constantly, viewed never.
    store.getState().dispatchFor('cBusy', delta('t1', 'x'))
    for (let n = 0; n < 5; n += 1) store.getState().dispatchFor('cBusy', delta('t1', 'more'))
    expect(store.getState().timelines.size).toBe(MAX_RETAINED_TIMELINES)

    store.getState().dispatchFor('cNew', delta('t1', 'x'))

    // This is the test that pins the policy word. An implementation evicting the least recently
    // WRITTEN keeps `cBusy` — the most recently written of all — and throws away `cAway`, exactly the
    // thread the operator stepped away from.
    expect(timelineFor(store, 'cBusy')).toBeNull()
    expect(timelineFor(store, 'cAway')).not.toBeNull()
  })

  it('markViewed PROMOTES a held slice out of the eviction line (AC2)', () => {
    const store = createConversationTimelineStore()
    for (const id of ids(MAX_RETAINED_TIMELINES)) store.getState().markViewed(id)

    store.getState().markViewed('c1')
    store.getState().dispatchFor('c11', delta('t1', 'x'))

    expect(timelineFor(store, 'c1')).not.toBeNull()
    expect(timelineFor(store, 'c2')).toBeNull()
  })

  it('markViewed on an ABSENT id creates a most-recently-viewed empty slice (AC1, AC2)', () => {
    const store = createConversationTimelineStore()
    for (const id of ids(MAX_RETAINED_TIMELINES)) store.getState().dispatchFor(id, delta('t1', 'x'))

    // The #786 seam: the operator opens a conversation BEFORE any event for it has arrived. A no-op
    // here would let a later fold create the slice at the HEAD, making the conversation currently on
    // screen the next eviction victim.
    store.getState().markViewed('cJustOpened')

    expect(timelineFor(store, 'cJustOpened')).toEqual(emptyTimeline)
    expect(store.getState().timelines.size).toBe(MAX_RETAINED_TIMELINES)

    store.getState().dispatchFor('cOther', delta('t1', 'x'))

    expect(timelineFor(store, 'cJustOpened')).not.toBeNull()
  })

  it('the bound is enforced on the markViewed path too (AC2)', () => {
    const store = createConversationTimelineStore()
    for (let n = 1; n <= MAX_RETAINED_TIMELINES + 5; n += 1) store.getState().markViewed(`c${n}`)

    // Both write paths can create a key, so both evict.
    expect(store.getState().timelines.size).toBe(MAX_RETAINED_TIMELINES)
    expect(timelineFor(store, 'c1')).toBeNull()
    expect(timelineFor(store, `c${MAX_RETAINED_TIMELINES + 5}`)).not.toBeNull()
  })

  it("a fold for one conversation leaves another's slice referentially unchanged (AC3)", () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('c1', delta('t1', 'one'))
    const before = timelineFor(store, 'c1')

    store.getState().dispatchFor('c2', delta('t2', 'two'))

    // The outer map is cloned but every held slice is copied BY REFERENCE, so `Object.is` is true and
    // a subscriber selecting c1 is not woken by a write to c2.
    expect(timelineFor(store, 'c1')).toBe(before)
  })

  it('reference stability survives the insert-at-head REBUILD (AC3)', () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('c1', delta('t1', 'one'))
    store.getState().dispatchFor('c2', delta('t2', 'two'))
    const c1Before = timelineFor(store, 'c1')
    const c2Before = timelineFor(store, 'c2')

    // Creating a key rebuilds the whole map so the newcomer lands at the head. This store's one path
    // the twin never had: an implementation that reconstructs slices during the rebuild passes the
    // simple case above and fails here.
    store.getState().dispatchFor('c3', delta('t3', 'three'))

    expect(timelineFor(store, 'c1')).toBe(c1Before)
    expect(timelineFor(store, 'c2')).toBe(c2Before)
  })

  it("reference stability survives markViewed's re-order (AC3)", () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('c1', delta('t1', 'one'))
    store.getState().dispatchFor('c2', delta('t2', 'two'))
    const c1Before = timelineFor(store, 'c1')
    const c2Before = timelineFor(store, 'c2')

    store.getState().markViewed('c1')

    expect(timelineFor(store, 'c1')).toBe(c1Before)
    expect(timelineFor(store, 'c2')).toBe(c2Before)
  })

  it('a fold that reduces to nothing on a HELD key churns no listener (AC3)', () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('c1', { type: 'stallDetected' })
    const stateBefore = store.getState()
    const sliceBefore = timelineFor(store, 'c1')

    let notifications = 0
    const unsubscribe = store.subscribe(() => {
      notifications += 1
    })
    // A redundant stall onset is a same-reference no-op in `reduceTimeline`, so the state OBJECT comes
    // straight back and zustand's `Object.is` short-circuit fires. No map is cloned either.
    store.getState().dispatchFor('c1', { type: 'stallDetected' })
    unsubscribe()

    expect(notifications).toBe(0)
    expect(store.getState()).toBe(stateBefore)
    expect(timelineFor(store, 'c1')).toBe(sliceBefore)
  })

  it('markViewed for the already-most-recently-viewed id churns no listener (AC3)', () => {
    const store = createConversationTimelineStore()
    store.getState().markViewed('c1')
    const stateBefore = store.getState()

    let notifications = 0
    const unsubscribe = store.subscribe(() => {
      notifications += 1
    })
    // The COMMON case rather than an edge one: `onOpen` fires for every row click, including a
    // re-click of the already-active row (activateConversation.ts:42).
    store.getState().markViewed('c1')
    unsubscribe()

    expect(notifications).toBe(0)
    expect(store.getState()).toBe(stateBefore)
  })

  it('a CHANGING fold does build a new state object and a new slice (AC3)', () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('c1', delta('t1', 'one'))
    const stateBefore = store.getState()
    const sliceBefore = timelineFor(store, 'c1')

    // The negative control for the two guards above: without it, "a no-op churns nothing" would also
    // pass for a store that never writes at all.
    store.getState().dispatchFor('c1', delta('t1', '-more'))

    expect(store.getState()).not.toBe(stateBefore)
    expect(timelineFor(store, 'c1')).not.toBe(sliceBefore)
    expect(timelineFor(store, 'c1')?.items).toEqual([
      { kind: 'assistantText', turnId: 't1', text: 'one-more' }
    ])
  })

  it('an unwritten id reads null even while other conversations hold rows (AC4)', () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('c1', delta('t1', 'one'))
    store.getState().dispatchFor('c2', delta('t2', 'two'))

    // No fallback onto the open conversation exists on any read path — this module imports nothing
    // from `activeConversationStore`, so an unknown id is an explicit no-match that can never resolve
    // onto a neighbour's slice.
    expect(timelineFor(store, 'c3')).toBeNull()
  })

  it('a present-empty slice is distinct from a never-written id (AC4)', () => {
    const store = createConversationTimelineStore()
    store.getState().markViewed('cOpened')

    // Asserted through the read surface alone: `not.toBeNull()` for the observed-empty one, `null` for
    // the one nothing is held for. A `?? initialTimelineState` at a read site collapses the two.
    expect(timelineFor(store, 'cOpened')).not.toBeNull()
    expect(timelineFor(store, 'cOpened')).toEqual(emptyTimeline)
    expect(timelineFor(store, 'cNever')).toBeNull()
  })

  it('clearAllTimelines drops every retained slice — each id reads null, not empty (#757 AC1)', () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('c1', delta('t1', 'one'))
    store.getState().dispatchFor('c2', delta('t2', 'two'))
    store.getState().markViewed('c3')

    store.getState().clearAllTimelines()

    // DELETE, not overwrite-with-empty: `set(id, initialTimelineState)` type-checks identically and
    // passes any naive "is the thread empty?" assertion, while collapsing "nothing is held" into
    // "observed; nothing in the thread". A viewed slice goes the same way as a written one.
    expect(store.getState().timelines.size).toBe(0)
    expect(timelineFor(store, 'c1')).toBeNull()
    expect(timelineFor(store, 'c2')).toBeNull()
    expect(timelineFor(store, 'c3')).toBeNull()
  })

  it('clearAllTimelines on an already-empty store churns no listener (#757 AC1)', () => {
    const store = createConversationTimelineStore()
    const stateBefore = store.getState()

    let notifications = 0
    const unsubscribe = store.subscribe(() => {
      notifications += 1
    })
    // The `size === 0` short-circuit is load-bearing, not an optimisation: clearPairingScopedState's
    // docstring claims every one of its clears is idempotent by construction and its own test asserts it.
    store.getState().clearAllTimelines()
    unsubscribe()

    expect(notifications).toBe(0)
    expect(store.getState()).toBe(stateBefore)
  })

  it('clearAllTimelines on a NON-empty store does build a new state object (#757 AC1)', () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('c1', delta('t1', 'one'))
    const stateBefore = store.getState()

    // The negative control for the guard above: without it, "an already-clear clear churns nothing"
    // would also pass for a method that never clears at all.
    store.getState().clearAllTimelines()

    expect(store.getState()).not.toBe(stateBefore)
  })

  it('clearAllTimelines hands back a FRESH map, never the exported initial constant (#757 AC1)', () => {
    const one = createConversationTimelineStore()
    const two = createConversationTimelineStore()
    one.getState().dispatchFor('c1', delta('t1', 'one'))
    two.getState().dispatchFor('c2', delta('t2', 'two'))

    one.getState().clearAllTimelines()
    two.getState().clearAllTimelines()

    // `initialConversationTimelineState` holds a module-shared MUTABLE `Map`; returning it as live
    // state would make every store instance that clears share one object (the twin's
    // conversationActivityStore.ts:221-226 reason, copied deliberately).
    expect(one.getState().timelines).not.toBe(initialConversationTimelineState.timelines)
    expect(one.getState().timelines).not.toBe(two.getState().timelines)
    one.getState().dispatchFor('c1', delta('t1', 'again'))
    expect(timelineFor(two, 'c1')).toBeNull()
    expect(initialConversationTimelineState.timelines.size).toBe(0)
  })

  it("clearTimelineFor removes exactly one key — every other slice is the SAME object (#757 AC2)", () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('c1', delta('t1', 'one'))
    store.getState().dispatchFor('c2', delta('t2', 'two'))
    store.getState().dispatchFor('c3', delta('t3', 'three'))
    const c2Before = timelineFor(store, 'c2')
    const c3Before = timelineFor(store, 'c3')

    store.getState().clearTimelineFor('c2')

    // Not merely equal — the same held object, so a component watching c3 is not woken by c2's removal.
    expect(timelineFor(store, 'c2')).toBeNull()
    expect(timelineFor(store, 'c1')).not.toBeNull()
    expect(timelineFor(store, 'c3')).toBe(c3Before)
    expect(c2Before).not.toBeNull()
    expect(store.getState().timelines.size).toBe(2)
  })

  it('clearTimelineFor leaves the cleared id ABSENT, not present-empty (#757 AC2)', () => {
    const store = createConversationTimelineStore()
    store.getState().markViewed('cOpened')
    expect(timelineFor(store, 'cOpened')).toEqual(emptyTimeline)

    store.getState().clearTimelineFor('cOpened')

    // The delete-vs-overwrite property again, from the observed-empty direction: an overwrite would
    // leave `toEqual(emptyTimeline)` passing and this assertion is the only one that fails.
    expect(timelineFor(store, 'cOpened')).toBeNull()
  })

  it('clearTimelineFor on an ABSENT key churns no listener (#757 AC2)', () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('c1', delta('t1', 'one'))
    const stateBefore = store.getState()
    const sliceBefore = timelineFor(store, 'c1')

    let notifications = 0
    const unsubscribe = store.subscribe(() => {
      notifications += 1
    })
    // The common case rather than an edge one: most conversations the exit fires for hold no slice.
    store.getState().clearTimelineFor('cNever')
    unsubscribe()

    expect(notifications).toBe(0)
    expect(store.getState()).toBe(stateBefore)
    expect(timelineFor(store, 'c1')).toBe(sliceBefore)
  })

  it('a removal re-orders nothing — the eviction victim is unchanged by it (#757 AC3)', () => {
    const store = createConversationTimelineStore()
    for (const id of ids(MAX_RETAINED_TIMELINES)) store.getState().markViewed(id)
    // Viewed in order, so the map reads least-recently-viewed first: c1 is the standing victim.
    expect([...store.getState().timelines.keys()]).toEqual([...ids(MAX_RETAINED_TIMELINES)])

    store.getState().clearTimelineFor('c5')

    // `Map.prototype.delete` preserves the position of every remaining entry, so THE EVICTION INVARIANT
    // survives untouched: c1 is still the head and still the next to go.
    expect([...store.getState().timelines.keys()]).toEqual([
      'c1',
      'c2',
      'c3',
      'c4',
      'c6',
      'c7',
      'c8',
      'c9',
      'c10'
    ])
    store.getState().markViewed('cA')
    store.getState().markViewed('cB')

    expect(timelineFor(store, 'c1')).toBeNull()
    expect(timelineFor(store, 'c2')).not.toBeNull()
    expect(timelineFor(store, 'c6')).not.toBeNull()
  })

  it('THE EVICTION INVARIANT survives a full clear — head and tail rules unchanged (#757 AC1)', () => {
    const store = createConversationTimelineStore()
    for (const id of ids(MAX_RETAINED_TIMELINES)) store.getState().dispatchFor(id, delta('t1', 'x'))

    store.getState().clearAllTimelines()
    store.getState().markViewed('cViewed')
    store.getState().dispatchFor('cWritten', delta('t1', 'x'))

    // Exactly as on a fresh store: a fold creates at the HEAD, a view-stamp at the TAIL.
    expect([...store.getState().timelines.keys()]).toEqual(['cWritten', 'cViewed'])
  })

  for (const key of hostileKeys) {
    it(`treats ${JSON.stringify(key)} as an ordinary key — no prototype lookup, no aliasing (AC5)`, () => {
      const store = createConversationTimelineStore()

      // READ BEFORE ANY WRITE: on a `Record` this walks the prototype chain — `'__proto__'` yields
      // `Object.prototype` and `'constructor'` the `Object` function, neither nullish, so `?? null`
      // never fires. `Map.prototype.get` performs no such lookup. THIS is the assertion that catches a
      // `Map` → `Record` swap, which is not a type error and breaks nothing else here.
      expect(timelineFor(store, key)).toBeNull()

      store.getState().dispatchFor(key, delta('t1', 'hostile'))

      expect(timelineFor(store, key)?.items).toEqual([
        { kind: 'assistantText', turnId: 't1', text: 'hostile' }
      ])
      // Readable under that exact key only — no neighbour, and no other hostile key, was reached.
      expect(timelineFor(store, 'c1')).toBeNull()
      expect(store.getState().timelines.size).toBe(1)
    })
  }

  it('a fold under __proto__ reaches nothing outside the store keyspace (AC5)', () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('__proto__', delta('t1', 'hostile'))

    // `Map.prototype.set('__proto__', v)` creates an ordinary own entry rather than reassigning a
    // prototype, so nothing here can have leaked onto Object.prototype.
    expect(({} as Record<string, unknown>).someKey).toBeUndefined()
    expect(({} as Record<string, unknown>).items).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'items')).toBe(false)
    expect(timelineFor(store, 'cNever')).toBeNull()
  })

  it("'' and '__proto__' hold independent slices — neither aliases the other (AC5)", () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('', delta('t1', 'empty-key'))
    store.getState().dispatchFor('__proto__', delta('t2', 'proto-key'))

    expect(timelineFor(store, '')?.items).toEqual([
      { kind: 'assistantText', turnId: 't1', text: 'empty-key' }
    ])
    expect(timelineFor(store, '__proto__')?.items).toEqual([
      { kind: 'assistantText', turnId: 't2', text: 'proto-key' }
    ])
  })

  it('hostile keys survive the eviction rebuild (AC5)', () => {
    const store = createConversationTimelineStore()
    store.getState().markViewed('__proto__')
    store.getState().dispatchFor('__proto__', delta('t1', 'held'))
    // Rebuild and re-order the map many times over, pushing well past the bound each round.
    for (let n = 1; n <= MAX_RETAINED_TIMELINES * 2; n += 1)
      store.getState().dispatchFor(`c${n}`, delta('t1', 'x'))

    // `new Map(iterable)` uses `Map.prototype.set` semantics, so `'__proto__'` stays an ordinary own
    // entry through every rebuild — the entries → `Map` rebuild materialises no object keys.
    expect(timelineFor(store, '__proto__')?.items).toEqual([
      { kind: 'assistantText', turnId: 't1', text: 'held' }
    ])
    expect(store.getState().timelines.size).toBe(MAX_RETAINED_TIMELINES)
    expect(({} as Record<string, unknown>).items).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'items')).toBe(false)
  })

  it('a hostile id cannot choose the eviction victim (AC5)', () => {
    const store = createConversationTimelineStore()
    // `''` sorts first lexicographically, so a keyspace ordered by the id's VALUE would hand it — a
    // daemon-supplied string — the choice of which conversation dies.
    store.getState().markViewed('')
    for (const id of ids(MAX_RETAINED_TIMELINES - 1)) store.getState().dispatchFor(id, delta('t1', 'x'))

    store.getState().dispatchFor('cForcesEviction', delta('t1', 'x'))

    expect(timelineFor(store, '')).not.toBeNull()
    expect(timelineFor(store, `c${MAX_RETAINED_TIMELINES - 1}`)).toBeNull()
  })

  it('clearTimelineFor("__proto__") against a map without that key removes NOTHING (#757 AC3, AC5)', () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('c1', delta('t1', 'real'))
    const stateBefore = store.getState()

    // On a `Record` the presence check walks the prototype chain and `'__proto__'` reads as present,
    // so this would delete or churn. `Map.prototype.has` performs no such lookup.
    store.getState().clearTimelineFor('__proto__')

    expect(store.getState()).toBe(stateBefore)
    expect(timelineFor(store, 'c1')).not.toBeNull()
    expect(store.getState().timelines.size).toBe(1)
  })

  it('clearTimelineFor removes a hostile key itself and leaves its neighbour (#757 AC3, AC5)', () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('__proto__', delta('t1', 'hostile'))
    store.getState().dispatchFor('', delta('t2', 'empty-key'))
    const emptyKeyBefore = timelineFor(store, '')

    store.getState().clearTimelineFor('__proto__')

    expect(timelineFor(store, '__proto__')).toBeNull()
    expect(timelineFor(store, '')).toBe(emptyKeyBefore)
    expect(({} as Record<string, unknown>).items).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'items')).toBe(false)
  })

  // #1223 — `prependHistoryFor`, the fifth write path. It takes already-reduced ROWS rather than an
  // event, because a page is not one event and `reduceTimeline` only ever appends.
  describe('prependHistoryFor', () => {
    const userRow = (text: string, messageId?: string): ThreadItem => ({
      kind: 'userText',
      text,
      createdAt: undefined,
      messageId,
      attachments: undefined
    })

    it('lands rows AHEAD of the rows already held, leaving every chrome scalar as the live lane left it', () => {
      const store = createConversationTimelineStore()
      store.getState().dispatchFor('c1', delta('t2', 'live'))
      store.getState().dispatchFor('c1', { type: 'compacting', active: true })
      store.getState().dispatchFor('c1', { type: 'turnState', state: 'thinking' })
      store.getState().dispatchFor('c1', { type: 'stallDetected' })
      store.getState().dispatchFor('c1', { type: 'apiRetry', active: true, current: 1, total: 3 })

      store.getState().prependHistoryFor('c1', [{ kind: 'assistantText', turnId: 't1', text: 'old' }])

      const held = timelineFor(store, 'c1')
      expect(held?.items).toEqual([
        { kind: 'assistantText', turnId: 't1', text: 'old' },
        { kind: 'assistantText', turnId: 't2', text: 'live', createdAt: undefined }
      ])
      // AC3's held half: a page moves none of the five, whatever a stored chrome entry said.
      expect(held?.phase).toBe('thinking')
      expect(held?.stalled).toBe(true)
      expect(held?.apiRetry).toEqual({ current: 1, total: 3 })
      expect(held?.compacting).toBe(true)
      expect(held?.localSendPending).toBeNull()
    })

    it('adds no rows for an empty page, and churns no subscriber', () => {
      const store = createConversationTimelineStore()
      store.getState().dispatchFor('c1', delta('t1', 'live'))
      const before = store.getState()

      store.getState().prependHistoryFor('c1', [])

      // The state OBJECT itself, so zustand's Object.is short-circuit fires.
      expect(store.getState()).toBe(before)
    })

    it('creates the slice for a conversation it holds nothing for', () => {
      const store = createConversationTimelineStore()

      store.getState().prependHistoryFor('c1', [userRow('replayed')])

      expect(timelineFor(store, 'c1')).toEqual({ ...emptyTimeline, items: [userRow('replayed')] })
    })

    it('collapses a history row and a local echo sharing a message id into one row, keeping the echo', () => {
      const store = createConversationTimelineStore()
      store
        .getState()
        .dispatchFor('c1', { type: 'userText', text: 'why?', messageId: 'm1', createdAt: 111 })

      store.getState().prependHistoryFor('c1', [userRow('why?', 'm1'), userRow('earlier', 'm0')])

      // The HELD echo survives — it carries the operator's own stamp and sits at its live position;
      // the replayed twin is the one dropped. The unmatched history row still lands ahead of it.
      expect(timelineFor(store, 'c1')?.items).toEqual([
        userRow('earlier', 'm0'),
        { kind: 'userText', text: 'why?', createdAt: 111, messageId: 'm1', attachments: undefined }
      ])
    })

    it('keeps two rows with different ids and identical text, and never matches two id-less rows', () => {
      const store = createConversationTimelineStore()
      store.getState().dispatchFor('c1', { type: 'userText', text: 'same', messageId: 'm2' })
      store.getState().dispatchFor('c1', { type: 'userText', text: 'anon' })

      store.getState().prependHistoryFor('c1', [userRow('same', 'm1'), userRow('anon')])

      // Nothing dedups on text, and `undefined === undefined` must not be a match.
      expect(timelineFor(store, 'c1')?.items).toHaveLength(4)
    })

    it('is a same-reference no-op when every row of the page is a duplicate', () => {
      const store = createConversationTimelineStore()
      store.getState().dispatchFor('c1', { type: 'userText', text: 'why?', messageId: 'm1' })
      const before = store.getState()

      store.getState().prependHistoryFor('c1', [userRow('why?', 'm1')])

      expect(store.getState()).toBe(before)
    })

    it('files a page under a hostile id without walking a prototype chain', () => {
      const store = createConversationTimelineStore()

      for (const key of hostileKeys) store.getState().prependHistoryFor(key, [userRow(key)])

      for (const key of hostileKeys) expect(timelineFor(store, key)?.items).toEqual([userRow(key)])
      expect(({} as Record<string, unknown>).items).toBeUndefined()
    })
  })

  it('the factory yields independent stores, and honours an injected initial state', () => {
    const one = createConversationTimelineStore()
    const two = createConversationTimelineStore()
    one.getState().dispatchFor('c1', delta('t1', 'one'))

    expect(timelineFor(two, 'c1')).toBeNull()
    expect(initialConversationTimelineState.timelines.size).toBe(0)

    const seeded = createConversationTimelineStore({
      timelines: new Map([
        [
          'c1',
          {
            timeline: { ...emptyTimeline, compacting: true },
            history: null,
            prependedRows: 0,
            liveKeys: new Set()
          }
        ]
      ])
    })
    expect(timelineFor(seeded, 'c1')).toEqual({ ...emptyTimeline, compacting: true })
  })

  // #1259 — the opening ask's per-conversation state, held BESIDE the timeline in the same slice so it
  // dies with it. Four readings: `null` (never asked, or evicted — the two are deliberately the same
  // reading, and that identity is AC3), `requested`, `loaded`, `failed`.
  // #1260 — the prepended-row count behind `Timeline`'s row key. Nothing in the renderer tier can see a
  // React key (keys are not markup, and these specs render to a static string), so the count itself is
  // where the property is provable and `e2e/thread-scroll-pin.spec.ts` is where its effect is.
  describe('prependedRows', () => {
    const userRow = (text: string, messageId?: string): ThreadItem => ({
      kind: 'userText',
      text,
      createdAt: undefined,
      messageId,
      attachments: undefined
    })

    it('starts at zero and is left alone by the live lane', () => {
      const store = createConversationTimelineStore()
      expect(selectPrependedRowsFor('c1')(store.getState())).toBe(0)

      store.getState().dispatchFor('c1', delta('t1', 'live'))
      store.getState().dispatchFor('c1', delta('t1', ' more'))

      // An APPEND must not move it, and that is the half of the contract the key depends on most: a
      // moving count on every delta would re-key every drawn row and remount the streaming bubble.
      expect(selectPrependedRowsFor('c1')(store.getState())).toBe(0)
    })

    it('is still zero after a page that CREATES the slice', () => {
      const store = createConversationTimelineStore()
      store.getState().prependHistoryFor('c1', [userRow('a'), userRow('b')])

      // Those rows are the conversation's first, so their keys count from zero exactly as appended rows
      // would; counting them would offset a list they are the whole of.
      expect(selectPrependedRowsFor('c1')(store.getState())).toBe(0)
    })

    it('rises by the rows a page actually inserted, never by the rows it asked to', () => {
      const store = createConversationTimelineStore()
      store.getState().dispatchFor('c1', { type: 'userText', text: 'why?', messageId: 'm1' })

      store.getState().prependHistoryFor('c1', [userRow('why?', 'm1'), userRow('earlier', 'm0')])

      // Two rows served, ONE inserted — the held echo dedups its replayed twin away. Counting the ask
      // rather than the insertion would shift every drawn row's key by the number of duplicate echoes
      // the page happened to carry.
      expect(timelineFor(store, 'c1')?.items).toHaveLength(2)
      expect(selectPrependedRowsFor('c1')(store.getState())).toBe(1)

      store.getState().prependHistoryFor('c1', [userRow('older still')])
      expect(selectPrependedRowsFor('c1')(store.getState())).toBe(2)
    })

    it('does not move for a page that inserts nothing', () => {
      const store = createConversationTimelineStore()
      store.getState().dispatchFor('c1', delta('t1', 'live'))

      store.getState().prependHistoryFor('c1', [])

      expect(selectPrependedRowsFor('c1')(store.getState())).toBe(0)
    })

    it('dies with the slice it counts', () => {
      // The walk's state must not outlive the timeline it walks: a conversation whose slice was cleared
      // restarts from the newest page on reopen, and its rows restart their keys with it.
      const store = createConversationTimelineStore()
      store.getState().dispatchFor('c1', delta('t1', 'live'))
      store.getState().prependHistoryFor('c1', [userRow('older')])
      expect(selectPrependedRowsFor('c1')(store.getState())).toBe(1)

      store.getState().clearTimelineFor('c1')
      expect(selectPrependedRowsFor('c1')(store.getState())).toBe(0)
    })

    it('reads as zero for a conversation nothing is held for', () => {
      const store = createConversationTimelineStore()
      store.getState().dispatchFor('c1', delta('t1', 'live'))

      // A bare `Map.get`, so an unknown id — hostile keys included — is an explicit no-match rather than
      // a resolution onto a neighbour's count.
      for (const key of ['c2', '', '__proto__', 'constructor']) {
        expect(selectPrependedRowsFor(key)(store.getState())).toBe(0)
      }
    })
  })

  describe('the opening history request state', () => {
    const historyFor = (store: Store, conversationId: string): HistoryRequestState | null =>
      selectHistoryRequestFor(conversationId)(store.getState())

    /** Put a slice in the map the way production does — `markViewed` at the activation seam. */
    const open = (store: Store, conversationId: string): void =>
      store.getState().markViewed(conversationId)

    it('reads null for an unheld conversation, hostile keys included, before any write', () => {
      const store = createConversationTimelineStore()

      // On a `Record` keyspace the first two walk the prototype chain and hand back a truthy value.
      for (const key of ['c1', '__proto__', 'constructor', '']) {
        expect(historyFor(store, key)).toBeNull()
      }
    })

    it('no-ops on an absent key, returning the state OBJECT so no subscriber wakes', () => {
      const store = createConversationTimelineStore()
      const before = store.getState()

      store.getState().markHistoryRequested('never-opened')
      store.getState().recordHistoryPage('never-opened', 'cur', false)
      store.getState().recordHistoryFailure('never-opened', 'history-unavailable', true)

      // A history write must never MINT a slice: the state it describes has to die with the timeline,
      // and a timeline-less holder would outlive the thing it describes.
      expect(store.getState()).toBe(before)
      expect(timelineFor(store, 'never-opened')).toBeNull()
      expect(historyFor(store, 'never-opened')).toBeNull()
    })

    it('records each reading on a held conversation, leaving its timeline identical', () => {
      const store = createConversationTimelineStore()
      open(store, 'c1')
      store.getState().dispatchFor('c1', delta('t1', 'live'))
      const heldTimeline = timelineFor(store, 'c1')

      store.getState().markHistoryRequested('c1')
      expect(historyFor(store, 'c1')).toEqual({ status: 'requested' })

      store.getState().recordHistoryPage('c1', 'cur-1', true)
      expect(historyFor(store, 'c1')).toEqual({ status: 'loaded', cursor: 'cur-1', atStart: true })

      store.getState().recordHistoryFailure('c1', 'history-invalid-cursor', false)
      expect(historyFor(store, 'c1')).toEqual({
        status: 'failed',
        reason: 'history-invalid-cursor',
        retryable: false
      })

      // The rows are untouched by all three, and `Object.is`-identical, so a component reading this
      // conversation's thread is not re-rendered by a request-state write.
      expect(timelineFor(store, 'c1')).toBe(heldTimeline)
    })

    it('records the cursor verbatim, empty string included', () => {
      const store = createConversationTimelineStore()
      open(store, 'c1')
      // `cursor` is EMPTY whenever `at_start` is true, so `''` is a valid held value and must not be
      // normalised into "no cursor" — the two fields are carried as sent and never derived from each
      // other (HistoryPagePayload's contract).
      store.getState().recordHistoryPage('c1', '', true)

      expect(historyFor(store, 'c1')).toEqual({ status: 'loaded', cursor: '', atStart: true })
    })

    it('re-orders nothing and changes no size — a history write is not a view', () => {
      const store = createConversationTimelineStore()
      open(store, 'a')
      open(store, 'b')

      store.getState().markHistoryRequested('a')
      store.getState().recordHistoryPage('a', 'cur', false)

      // `a` stays ahead of `b` in eviction order. Promoting on a history write would make the daemon's
      // reply, rather than the operator's attention, decide which thread survives.
      expect([...store.getState().timelines.keys()]).toEqual(['a', 'b'])
      expect(store.getState().timelines.size).toBe(2)
    })

    it('dies with the timeline — eviction, single clear and whole-map clear all take it', () => {
      const evicting = createConversationTimelineStore()
      for (const id of ids(MAX_RETAINED_TIMELINES)) open(evicting, id)
      const victim = ids(MAX_RETAINED_TIMELINES)[0]
      evicting.getState().recordHistoryPage(victim, 'cur', true)
      expect(historyFor(evicting, victim)).not.toBeNull()

      // One more viewed conversation evicts the least recently viewed, and its reading goes with it —
      // which is what makes a re-open of an evicted conversation ask again (AC3) rather than read
      // `loaded` and stay empty forever.
      open(evicting, 'newcomer')
      expect(historyFor(evicting, victim)).toBeNull()

      const single = createConversationTimelineStore()
      open(single, 'c1')
      single.getState().recordHistoryFailure('c1', 'conversation-not-found', false)
      single.getState().clearTimelineFor('c1')
      expect(historyFor(single, 'c1')).toBeNull()

      const all = createConversationTimelineStore()
      open(all, 'c1')
      all.getState().markHistoryRequested('c1')
      all.getState().clearAllTimelines()
      expect(historyFor(all, 'c1')).toBeNull()
    })

    it('keeps the two halves of a slice independent across conversations', () => {
      const store = createConversationTimelineStore()
      open(store, 'a')
      open(store, 'b')
      store.getState().markHistoryRequested('a')

      // Writing one conversation's request state leaves the other's slice `Object.is`-identical, so a
      // component watching `b` is not woken (the by-reference survivor copy, one field deeper).
      const heldB = store.getState().timelines.get('b')
      store.getState().recordHistoryPage('a', 'cur', false)

      expect(store.getState().timelines.get('b')).toBe(heldB)
      expect(historyFor(store, 'b')).toBeNull()
    })

    it('lets a page for an unheld conversation create the slice, then settle on it', () => {
      const store = createConversationTimelineStore()
      // `prependHistoryFor`'s create-at-head branch (#1223) is unchanged and still mints the slice, so
      // the record that follows it in `useHistoryPageBridge` finds a key to write. Draw first, then
      // settle: the reverse order would drop the reading on the floor.
      const replayed: ThreadItem = {
        kind: 'userText',
        text: 'replayed',
        createdAt: undefined,
        messageId: 'm1',
        attachments: undefined
      }
      store.getState().prependHistoryFor('c1', [replayed])
      store.getState().recordHistoryPage('c1', 'cur', false)

      expect(timelineFor(store, 'c1')?.items).toEqual([replayed])
      expect(historyFor(store, 'c1')).toEqual({ status: 'loaded', cursor: 'cur', atStart: false })
    })
  })
})

// #1225 — the live half of the history join. A slice remembers the (`type`, `ts`) keys its LIVE lane has
// drawn, so a served page can drop the entries it would otherwise draw a second time. The keys live on
// the slice, beside `history` and `prependedRows`, so they die with the timeline they describe.
describe('conversationTimelineStore — the live join keys (#1225)', () => {
  const keysFor = (store: Store, conversationId: string): ReadonlySet<string> =>
    selectLiveJoinKeysFor(conversationId)(store.getState())

  it('records the key handed to a fold that CREATED the slice', () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('c1', delta('t1', 'a'), 'assistantDelta T1')

    expect([...keysFor(store, 'c1')]).toEqual(['assistantDelta T1'])
  })

  it('accumulates keys across folds, in arrival order', () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('c1', delta('t1', 'a'), 'assistantDelta T1')
    store.getState().dispatchFor('c1', delta('t1', 'b'), 'assistantDelta T2')

    expect([...keysFor(store, 'c1')]).toEqual(['assistantDelta T1', 'assistantDelta T2'])
  })

  it('records NOTHING for a fold that changed the timeline in no way', () => {
    // ⭐ The load-bearing guard. An orphan `toolResult` draws nothing, so the live lane never showed the
    // operator anything for it — and a key recorded here would let the served page's copy be suppressed,
    // dropping a row that was never drawn on either lane. A key exists only where a row does.
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('c1', delta('t1', 'a'), 'assistantDelta T1')
    store.getState().dispatchFor('c1', orphanResult, 'toolResult T2')

    expect([...keysFor(store, 'c1')]).toEqual(['assistantDelta T1'])
  })

  it('⭐ records NOTHING for a fold that changed nothing and CREATED the slice', () => {
    // The create branch's own case, and it is not the one above: that test seeds the slice with a delta
    // first, so it exercises the update branch's same-reference short-circuit only. Here the orphan
    // `toolResult` is the conversation's FIRST event — the relay resuming mid-tool-call, or the slice
    // having been evicted — so the slice is created and the timeline still draws nothing. A key here
    // would let the served page's copy of that result be suppressed and the tool row draw unfilled.
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('c1', orphanResult, 'toolResult T1')

    expect(timelineFor(store, 'c1')?.items).toEqual([])
    expect(keysFor(store, 'c1').size).toBe(0)
  })

  it('records nothing when no key is passed — every existing call site keeps its meaning', () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('c1', delta('t1', 'a'))

    expect(keysFor(store, 'c1').size).toBe(0)
  })

  it('bounds the set at MAX_LIVE_JOIN_KEYS, evicting the OLDEST first', () => {
    // Oldest-first is the correct direction: the NEWEST page — the one the opening ask draws — overlaps
    // the NEWEST live keys, and an evicted key costs a duplicate row, never a dropped one.
    const store = createConversationTimelineStore()
    for (let i = 0; i < MAX_LIVE_JOIN_KEYS + 2; i++) {
      store.getState().dispatchFor('c1', delta('t1', `x${i}`), `assistantDelta ${i}`)
    }

    const held = keysFor(store, 'c1')
    expect(held.size).toBe(MAX_LIVE_JOIN_KEYS)
    expect(held.has('assistantDelta 0')).toBe(false)
    expect(held.has('assistantDelta 1')).toBe(false)
    expect(held.has(`assistantDelta ${MAX_LIVE_JOIN_KEYS + 1}`)).toBe(true)
  })

  it('reads as EMPTY for a conversation nothing is held for, on a hostile key as on any other', () => {
    const store = createConversationTimelineStore()
    for (const key of hostileKeys) expect(keysFor(store, key).size).toBe(0)
  })

  it('dies with the timeline it describes — eviction, clearTimelineFor and clearAllTimelines', () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('c1', delta('t1', 'a'), 'assistantDelta T1')
    store.getState().clearTimelineFor('c1')
    expect(keysFor(store, 'c1').size).toBe(0)

    store.getState().dispatchFor('c2', delta('t1', 'a'), 'assistantDelta T2')
    store.getState().clearAllTimelines()
    expect(keysFor(store, 'c2').size).toBe(0)

    // Eviction. A fold-created slice enters at the HEAD and the head is the next victim (rule 2 of the
    // eviction invariant), so the slice to watch has to be created while the map is already at the bound
    // and then outlived by one more creation — not written first, which would leave it safe at the tail.
    for (const id of ids(MAX_RETAINED_TIMELINES)) {
      store.getState().dispatchFor(id, delta('t1', 'a'), `assistantDelta ${id}`)
    }
    store.getState().dispatchFor('victim', delta('t1', 'a'), 'assistantDelta victim')
    expect(keysFor(store, 'victim').size).toBe(1)

    store.getState().dispatchFor('next', delta('t1', 'a'), 'assistantDelta next')
    expect(keysFor(store, 'victim').size).toBe(0)
  })
})

// #1725: a queue snapshot advances only a held slice's open send window, and only for its own sent id.
describe('conversationTimelineStore — markLocalSendQueued (#1725)', () => {
  const queuedItem = (message_id: string) => ({ queued_msg_id: 1, text: 'typed', ts: 'ts', message_id })

  it('marks the held slice queued when the snapshot lists the sent id', () => {
    const store = createConversationTimelineStore({ timelines: new Map() })
    store.getState().dispatchFor('conv-a', { type: 'userText', text: 'typed', messageId: 'm1' })
    store.getState().markLocalSendQueued('conv-a', [queuedItem('m1')])
    expect(timelineFor(store, 'conv-a')?.localSendPending).toEqual({ messageId: 'm1', queued: true })
  })

  it('ignores another host’s colliding snapshots before binding and after removal', () => {
    let origin = 'host-a'
    const store = createConversationTimelineStore(undefined, () => origin)
    store.getState().dispatchFor('same-conversation', delta('first', 'first reply'))
    store.getState().dispatchFor('same-conversation', { type: 'userText', text: 'own', messageId: 'm' })
    const held = store.getState()
    origin = 'host-b'
    store.getState().markLocalSendQueued('same-conversation', [{ ...queuedItem('m'), queued_msg_id: 99 }])
    expect(store.getState()).toBe(held)
    origin = 'host-a'
    store.getState().markLocalSendQueued('same-conversation', [{ ...queuedItem('m'), queued_msg_id: 7 }])
    expect(timelineFor(store, 'same-conversation')?.localEchoes?.[0].queuedMsgId).toBe(7)
    const bound = store.getState()
    origin = 'host-b'
    store.getState().markLocalSendQueued('same-conversation', [])
    expect(store.getState()).toBe(bound)
    origin = 'host-a'
    store.getState().dispatchFor('same-conversation', { type: 'turnEnd', turnId: 'first', stopReason: 'end_turn' })
    store.getState().markLocalSendQueued('same-conversation', [])
    store.getState().dispatchFor('same-conversation', delta('answer', 'answer'))
    store.getState().dispatchFor('same-conversation', {
      type: 'userText', received: true, text: 'receipt', messageId: 'm', queuedMsgId: 7
    })
    const settled = timelineFor(store, 'same-conversation')!
    expect(settled.localEchoes?.[0]).toMatchObject({ queuedMsgId: 7, settled: true })
    expect(settled.items.map(item => 'text' in item ? item.text : item.kind))
      .toEqual(['first reply', 'turnBoundary', 'own', 'answer'])
  })

  it('returns the same state for an unmatched id, and never creates a slice', () => {
    const store = createConversationTimelineStore({ timelines: new Map() })
    store.getState().dispatchFor('conv-a', { type: 'userText', text: 'typed', messageId: 'm1' })
    const before = store.getState()
    store.getState().markLocalSendQueued('conv-a', [queuedItem('m2')])
    store.getState().markLocalSendQueued('conv-b', [queuedItem('m1')])
    expect(store.getState()).toBe(before)
    expect(timelineFor(store, 'conv-b')).toBeNull()
  })
})
