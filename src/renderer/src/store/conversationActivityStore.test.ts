import { describe, it, expect } from 'vitest'
import {
  createConversationActivityStore,
  initialConversationActivityState,
  selectActivityFor,
  type ConversationActivityEntry
} from './conversationActivityStore'

// Plain-function store tests over isolated createConversationActivityStore() instances — the
// backgroundTaskRosterStore.test idiom. No React, no DOM, no bridge: this store is pure renderer state
// with four whole-value setters and one selector, and `environment: 'node'` is already global at
// vitest.config.ts:27, so this file adds no environment pragma.
//
// Three properties here are invisible to `tsc` and break no other assertion in this file, which is why
// each gets a named test of its own:
//
//   - A FIRST write of `false` must still CREATE the entry. `undefined` is never `=== false`, so the
//     same-value guard's create path runs; a guard written any other way conflates "never observed"
//     with "observed idle" silently. Not hypothetical: `apiRetry` and `compacting` both carry explicit
//     falling edges, so `active: false` can be a conversation's very first frame.
//   - `selectActivityFor` must return `null` for an absent key, distinctly from a present all-false
//     entry. queueStore's `?? EMPTY_BACKLOG` is exactly the collapse that would erase the difference
//     with no type error.
//   - The keyspace must be a `ReadonlyMap`, never a `Record`. Swapping one for the other is not a type
//     error; the hostile-key reads below are the whole defence. On a `Record`, a read of `'__proto__'`
//     or `'constructor'` before any write walks the prototype chain and hands back `Object.prototype` /
//     the `Object` constructor rather than `null` — those two assertions are what fail.
//
// Tests construct their own entry literals rather than importing a default: the store deliberately
// exports none, because an exported one invites `selectActivityFor(id) ?? idleActivity` at the read
// site and that collapses the absent-vs-observed-idle distinction back again.

type Store = ReturnType<typeof createConversationActivityStore>

const activityFor = (store: Store, conversationId: string): ConversationActivityEntry | null =>
  selectActivityFor(conversationId)(store.getState())

/** "Observed; nothing is happening" — a PRESENT entry, and a different reading from `null`. */
const idle: ConversationActivityEntry = {
  turnRunning: false,
  stalled: false,
  apiRetrying: false,
  compacting: false
}

interface FactCase {
  /** The one field this setter owns. */
  field: string
  write: (store: Store, conversationId: string, value: boolean) => void
  /** The whole entry expected after writing `true` through `write` on a fresh store — spelled out
   *  rather than built with a computed key, so this file stays free of the `{ [x]: v }` construct the
   *  store forbids and a reviewer's grep for it stays a true signal. */
  live: ConversationActivityEntry
}

const facts: readonly FactCase[] = [
  {
    field: 'turnRunning',
    write: (store, id, value) => store.getState().setTurnRunning(id, value),
    live: { turnRunning: true, stalled: false, apiRetrying: false, compacting: false }
  },
  {
    field: 'stalled',
    write: (store, id, value) => store.getState().setStalled(id, value),
    live: { turnRunning: false, stalled: true, apiRetrying: false, compacting: false }
  },
  {
    field: 'apiRetrying',
    write: (store, id, value) => store.getState().setApiRetrying(id, value),
    live: { turnRunning: false, stalled: false, apiRetrying: true, compacting: false }
  },
  {
    field: 'compacting',
    write: (store, id, value) => store.getState().setCompacting(id, value),
    live: { turnRunning: false, stalled: false, apiRetrying: false, compacting: true }
  }
]

/** The three keys AC4 names. `''` is in the set because it is a legal `Map` key and an illegal
 *  conversation id, so it must behave like any other unremarkable key rather than aliasing anything. */
const hostileKeys = ['__proto__', 'constructor', ''] as const

describe('conversationActivityStore', () => {
  it('starts with nothing observed — selectActivityFor returns null, not an idle entry (AC3)', () => {
    const store = createConversationActivityStore()
    expect(store.getState().entries.size).toBe(0)
    expect(activityFor(store, 'c1')).toBeNull()
    expect(activityFor(store, 'c2')).toBeNull()
  })

  for (const { field, write, live } of facts) {
    it(`set${field}: creates the entry and writes only its own fact (AC1)`, () => {
      const store = createConversationActivityStore()
      write(store, 'c1', true)

      // The id was never opened by this client and no other write preceded this one; the entry is
      // created rather than the write being dropped, and the other three facts read false.
      expect(activityFor(store, 'c1')).toEqual(live)
    })

    it(`set${field}: a FIRST write of false still creates the entry (AC1)`, () => {
      const store = createConversationActivityStore()
      write(store, 'c1', false)

      // The guard compares against `undefined` on an absent key, and `undefined` is never `=== false`.
      // A guard that short-circuits here would leave the conversation reading as never-observed.
      expect(activityFor(store, 'c1')).not.toBeNull()
      expect(activityFor(store, 'c1')).toEqual(idle)
    })
  }

  it('the four facts are independent — a later setter leaves the earlier ones held (AC1)', () => {
    const store = createConversationActivityStore()
    store.getState().setTurnRunning('c1', true)
    store.getState().setCompacting('c1', true)
    store.getState().setStalled('c1', true)
    store.getState().setApiRetrying('c1', true)
    store.getState().setCompacting('c1', false)

    expect(activityFor(store, 'c1')).toEqual({
      turnRunning: true,
      stalled: true,
      apiRetrying: true,
      compacting: false
    })
  })

  it("a write for one conversation leaves another's entry referentially unchanged (AC2)", () => {
    const store = createConversationActivityStore()
    store.getState().setTurnRunning('c1', true)
    const before = activityFor(store, 'c1')

    store.getState().setCompacting('c2', true)

    // `new Map(previous)` copies REFERENCES, so the untouched entry is the same object — `Object.is`
    // true — and a subscriber selecting c1 is not woken by a write to c2.
    expect(activityFor(store, 'c1')).toBe(before)
  })

  it('two conversations hold independent facts (AC2)', () => {
    const store = createConversationActivityStore()
    store.getState().setStalled('c1', true)
    store.getState().setApiRetrying('c2', true)

    expect(activityFor(store, 'c1')).toEqual({ ...idle, stalled: true })
    expect(activityFor(store, 'c2')).toEqual({ ...idle, apiRetrying: true })
  })

  it('a repeat write of the same value churns no listener (AC2)', () => {
    const store = createConversationActivityStore()
    store.getState().setCompacting('c1', true)
    const stateBefore = store.getState()
    const entryBefore = activityFor(store, 'c1')

    let notifications = 0
    const unsubscribe = store.subscribe(() => {
      notifications += 1
    })
    // The upstream arms are explicitly NOT deduped — the transport holds no state, so a consumer sees
    // one event per daemon frame, verbatim repeats included (events.ts:165-167, :195-197).
    store.getState().setCompacting('c1', true)
    unsubscribe()

    expect(notifications).toBe(0)
    expect(store.getState()).toBe(stateBefore)
    expect(activityFor(store, 'c1')).toBe(entryBefore)
  })

  it('a CHANGING write does build a new state object and a new entry (AC2)', () => {
    const store = createConversationActivityStore()
    store.getState().setCompacting('c1', true)
    const stateBefore = store.getState()
    const entryBefore = activityFor(store, 'c1')

    // The negative control for the guard above: without it, "the same-value guard works" would also
    // pass for a store that never writes at all.
    store.getState().setCompacting('c1', false)

    expect(store.getState()).not.toBe(stateBefore)
    expect(activityFor(store, 'c1')).not.toBe(entryBefore)
    expect(activityFor(store, 'c1')).toEqual(idle)
  })

  it('an unwritten id reads null even while other conversations hold live facts (AC3)', () => {
    const store = createConversationActivityStore()
    store.getState().setTurnRunning('c1', true)
    store.getState().setCompacting('c2', true)

    // No fallback onto the open conversation exists on any read path, so an unknown id is an explicit
    // no-match and can never resolve onto a neighbour's entry.
    expect(activityFor(store, 'c3')).toBeNull()
  })

  it('an observed-idle entry is present and all-false — distinct from a null read (AC3)', () => {
    const store = createConversationActivityStore()
    store.getState().setCompacting('c1', true)
    store.getState().setCompacting('c1', false)

    expect(activityFor(store, 'c1')).not.toBeNull()
    expect(activityFor(store, 'c1')).toEqual(idle)
    expect(activityFor(store, 'cNever')).toBeNull()
  })

  for (const key of hostileKeys) {
    it(`treats ${JSON.stringify(key)} as an ordinary key — no prototype lookup, no aliasing (AC4)`, () => {
      const store = createConversationActivityStore()

      // On a `Record` this read walks the prototype chain: `'__proto__'` yields `Object.prototype` and
      // `'constructor'` yields the `Object` function, neither of which is nullish, so `?? null` never
      // fires. `Map.prototype.get` performs no such lookup.
      expect(activityFor(store, key)).toBeNull()

      store.getState().setStalled(key, true)

      expect(activityFor(store, key)).toEqual({ ...idle, stalled: true })
      // Readable under that exact key only — no neighbour, and no other hostile key, was reached.
      expect(activityFor(store, 'c1')).toBeNull()
      expect(store.getState().entries.size).toBe(1)
    })
  }

  it('a write under __proto__ reaches nothing outside the store keyspace (AC4)', () => {
    const store = createConversationActivityStore()
    store.getState().setCompacting('__proto__', true)

    // `Map.prototype.set('__proto__', v)` creates an ordinary own entry rather than reassigning a
    // prototype, so nothing here can have leaked onto Object.prototype.
    expect(({} as Record<string, unknown>).someKey).toBeUndefined()
    expect(({} as Record<string, unknown>).compacting).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'compacting')).toBe(false)
    expect(activityFor(store, 'cNever')).toBeNull()
  })

  it("'' and '__proto__' hold independent entries — neither aliases the other (AC4)", () => {
    const store = createConversationActivityStore()
    store.getState().setTurnRunning('', true)
    store.getState().setCompacting('__proto__', true)

    expect(activityFor(store, '')).toEqual({ ...idle, turnRunning: true })
    expect(activityFor(store, '__proto__')).toEqual({ ...idle, compacting: true })
  })

  it('the factory yields independent stores, and honours an injected initial state', () => {
    const one = createConversationActivityStore()
    const two = createConversationActivityStore()
    one.getState().setStalled('c1', true)

    expect(activityFor(two, 'c1')).toBeNull()
    expect(initialConversationActivityState.entries.size).toBe(0)

    const seeded = createConversationActivityStore({
      entries: new Map([['c1', { ...idle, apiRetrying: true }]])
    })
    expect(activityFor(seeded, 'c1')).toEqual({ ...idle, apiRetrying: true })
  })
})
