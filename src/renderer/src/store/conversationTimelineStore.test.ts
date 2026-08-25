import { describe, it, expect } from 'vitest'
import {
  MAX_RETAINED_TIMELINES,
  createConversationTimelineStore,
  initialConversationTimelineState,
  selectTimelineFor
} from './conversationTimelineStore'
import type { ThreadEvent, TimelineState } from './threadTimeline'

// Plain-function store tests over isolated createConversationTimelineStore() instances — the
// conversationActivityStore.test idiom. No React, no DOM, no bridge: this store is pure renderer state
// with two write paths and one selector, and `environment: 'node'` is already global at
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
  items: [],
  phase: 'idle',
  stalled: false,
  apiRetry: null,
  compacting: false,
  localSendPending: false
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
    store.getState().dispatchFor('c2', delta('t2', 'quiet'))

    expect(timelineFor(store, 'c1')).toEqual({
      items: [{ kind: 'userText', text: 'hi' }],
      phase: 'thinking',
      stalled: true,
      apiRetry: { current: 1, total: 3 },
      compacting: true,
      localSendPending: true
    })
    // The payload is the whole flat timeline, so none of the five scalars leaks across the key.
    expect(timelineFor(store, 'c2')).toEqual({
      items: [{ kind: 'assistantText', turnId: 't2', text: 'quiet' }],
      phase: 'idle',
      stalled: false,
      apiRetry: null,
      compacting: false,
      localSendPending: false
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

    // The #758 seam: the operator opens a conversation BEFORE any event for it has arrived. A no-op
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

  it('the factory yields independent stores, and honours an injected initial state', () => {
    const one = createConversationTimelineStore()
    const two = createConversationTimelineStore()
    one.getState().dispatchFor('c1', delta('t1', 'one'))

    expect(timelineFor(two, 'c1')).toBeNull()
    expect(initialConversationTimelineState.timelines.size).toBe(0)

    const seeded = createConversationTimelineStore({
      timelines: new Map([['c1', { ...emptyTimeline, compacting: true }]])
    })
    expect(timelineFor(seeded, 'c1')).toEqual({ ...emptyTimeline, compacting: true })
  })
})
