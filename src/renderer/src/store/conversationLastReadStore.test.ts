import { describe, it, expect } from 'vitest'
import {
  createConversationLastReadStore,
  initialConversationLastReadState,
  selectLastReadFor,
  type LastReadMark
} from './conversationLastReadStore'

// Plain-function store tests over isolated createConversationLastReadStore() instances — the
// conversationActivityStore.test / conversationTimelineStore.test idiom. No React, no DOM, no bridge:
// this store is pure renderer state with one write path and one selector, and `environment: 'node'` is
// already global at vitest.config.ts:27, so this file adds no environment pragma.
//
// Four properties here are invisible to `tsc` and break no other assertion in this file, which is why
// each gets a named test of its own. The first two are specific to holding a NUMBER where the two keyed
// precedents hold objects, and both compile clean:
//
//   - `s.marks.get(id) || null` in the selector yields `null` for a REAL mark of `0`, with the same
//     `LastReadMark | null` return type. `0` is producible: opening a conversation whose timeline is
//     empty stamps it. `??` is the mechanism that keeps "never read" its own state.
//   - A falsy-shaped write guard — `!s.marks.get(id)`, or `(s.marks.get(id) ?? -1) === itemsSeen` —
//     drops a first record of `0`. The guard has to be `===` against the RAW `get` result, so
//     `undefined === 0` is `false` and the create path runs. This is the numeric analogue of the
//     first-write-of-`false` property conversationActivityStore.ts:148-152 documents.
//   - The keyspace must be a `ReadonlyMap`, never a `Record`. Swapping one for the other is not a type
//     error; the hostile-key assertions below are the whole defence. On a `Record`, a read of
//     `'__proto__'` or `'constructor'` BEFORE ANY WRITE walks the prototype chain and hands back
//     `Object.prototype` / the `Object` constructor rather than `null`.
//   - The write must CLONE the outer map, never write into the held one. The referential-identity
//     assertion the object-holding precedents use for this (backgroundTaskRosterStore.ts:415-417) is
//     degenerate here, because `Object.is(5, 5)` holds however the map was built; the load-bearing form
//     is asserting the PREVIOUSLY HELD map still reads as it did.

type Store = ReturnType<typeof createConversationLastReadStore>

const lastReadFor = (store: Store, conversationId: string): LastReadMark | null =>
  selectLastReadFor(conversationId)(store.getState())

/** The three keys AC4 names. `''` is in the set because it is a legal `Map` key and an illegal
 *  conversation id, so it must behave like any other unremarkable key rather than aliasing anything. */
const hostileKeys = ['__proto__', 'constructor', ''] as const

describe('conversationLastReadStore', () => {
  it('starts with nothing read — selectLastReadFor returns null, not 0 (#775 AC3)', () => {
    const store = createConversationLastReadStore()

    expect(store.getState().marks.size).toBe(0)
    expect(lastReadFor(store, 'c1')).toBeNull()
    expect(lastReadFor(store, 'c2')).toBeNull()
  })

  it('records a mark for a conversation the client has never opened (#775 AC1)', () => {
    const store = createConversationLastReadStore()
    store.getState().recordLastRead('c1', 12)

    // The id was never opened by this client and no other write preceded this one; the entry is
    // CREATED rather than the write being dropped.
    expect(lastReadFor(store, 'c1')).toBe(12)
    expect(store.getState().marks.size).toBe(1)
  })

  it('a FIRST record of 0 still creates the entry (#775 AC1)', () => {
    const store = createConversationLastReadStore()
    store.getState().recordLastRead('c1', 0)

    // The guard compares against `undefined` on an absent key, and `undefined` is never `=== 0`. A
    // guard that treats `0` as absent would leave the conversation reading as never-read. Not
    // hypothetical: opening a conversation whose timeline holds no items stamps exactly this mark.
    expect(lastReadFor(store, 'c1')).not.toBeNull()
    expect(lastReadFor(store, 'c1')).toBe(0)
    expect(store.getState().marks.size).toBe(1)
  })

  it('records into a store already holding other ids without disturbing them (#775 AC1)', () => {
    const store = createConversationLastReadStore({
      marks: new Map([
        ['c1', 4],
        ['c2', 9]
      ])
    })
    store.getState().recordLastRead('c3', 1)

    expect(lastReadFor(store, 'c1')).toBe(4)
    expect(lastReadFor(store, 'c2')).toBe(9)
    expect(lastReadFor(store, 'c3')).toBe(1)
    expect(store.getState().marks.size).toBe(3)
  })

  it("a record for one conversation never mutates another's entry (#775 AC2)", () => {
    const store = createConversationLastReadStore()
    store.getState().recordLastRead('c1', 3)
    const c1Before = lastReadFor(store, 'c1')

    store.getState().recordLastRead('c2', 7)

    expect(lastReadFor(store, 'c1')).toBe(c1Before)
    expect(lastReadFor(store, 'c1')).toBe(3)
    expect(lastReadFor(store, 'c2')).toBe(7)
    expect(store.getState().marks.size).toBe(2)
  })

  it('re-recording the same id REPLACES its value rather than accumulating (#775 AC2)', () => {
    const store = createConversationLastReadStore()
    store.getState().recordLastRead('c1', 3)
    store.getState().recordLastRead('c1', 7)

    // Not a sum, not an array, and not a second entry.
    expect(lastReadFor(store, 'c1')).toBe(7)
    expect(store.getState().marks.size).toBe(1)
  })

  it('a LOWER value replaces a higher one — replacement, never Math.max (#775 AC2)', () => {
    const store = createConversationLastReadStore()
    store.getState().recordLastRead('c1', 9)
    store.getState().recordLastRead('c1', 2)

    // A monotonic max-guard would make a legitimate lower mark unrecordable, and AC2 says the value is
    // REPLACED. `Math.max(held, incoming)` passes every other test in this file.
    expect(lastReadFor(store, 'c1')).toBe(2)
  })

  it('re-recording the SAME value churns no listener (#775 AC2)', () => {
    const store = createConversationLastReadStore()
    store.getState().recordLastRead('c1', 5)
    const stateBefore = store.getState()

    let notifications = 0
    const unsubscribe = store.subscribe(() => {
      notifications += 1
    })
    store.getState().recordLastRead('c1', 5)
    unsubscribe()

    // Returning the state OBJECT makes zustand's `Object.is` short-circuit fire, so no subscriber
    // wakes — the conversationActivityStore.ts:148-157 doctrine.
    expect(notifications).toBe(0)
    expect(store.getState()).toBe(stateBefore)
    expect(lastReadFor(store, 'c1')).toBe(5)
  })

  it('a CHANGING record does build a new state object — the guard negative control (#775 AC2)', () => {
    const store = createConversationLastReadStore()
    store.getState().recordLastRead('c1', 5)
    const stateBefore = store.getState()

    let notifications = 0
    const unsubscribe = store.subscribe(() => {
      notifications += 1
    })
    // Without this, "a repeat record churns nothing" would also pass for a store that never writes.
    store.getState().recordLastRead('c1', 6)
    unsubscribe()

    expect(notifications).toBe(1)
    expect(store.getState()).not.toBe(stateBefore)
    expect(lastReadFor(store, 'c1')).toBe(6)
  })

  it('a record clones the outer map rather than writing into the held one (#775 AC2)', () => {
    const store = createConversationLastReadStore()
    store.getState().recordLastRead('c1', 2)
    const marksBefore = store.getState().marks

    store.getState().recordLastRead('c2', 8)

    // THIS is the assertion that catches an in-place `s.marks.set(...)`. Comparing the untouched
    // conversation's READING cannot: `Object.is(2, 2)` holds however the map was built, because the
    // values here are numbers rather than the entry objects the precedents hold.
    expect(store.getState().marks).not.toBe(marksBefore)
    expect(marksBefore.get('c1')).toBe(2)
    expect(marksBefore.has('c2')).toBe(false)
    expect(marksBefore.size).toBe(1)
  })

  it('a recorded 0 and a never-recorded id are DIFFERENT readings in one store (#775 AC3)', () => {
    const store = createConversationLastReadStore()
    store.getState().recordLastRead('cRead', 0)

    // The distinction itself is what this pins: "never read" is its own state, not a zero a real mark
    // could also produce.
    expect(lastReadFor(store, 'cRead')).toBe(0)
    expect(lastReadFor(store, 'cNever')).toBeNull()
  })

  it('a mark of 0 reads as non-null — the || versus ?? trap (#775 AC3)', () => {
    const store = createConversationLastReadStore()
    store.getState().recordLastRead('c1', 0)

    // A selector written `s.marks.get(id) || null` hands back `null` here, with the same
    // `LastReadMark | null` return type and no type error. `??` is what keeps the two readings apart.
    expect(lastReadFor(store, 'c1')).not.toBeNull()
    expect(typeof lastReadFor(store, 'c1')).toBe('number')
  })

  it('an unrecorded id reads null even while other conversations hold marks (#775 AC3)', () => {
    const store = createConversationLastReadStore()
    store.getState().recordLastRead('c1', 4)
    store.getState().recordLastRead('c2', 0)

    // No fallback onto the open conversation exists on any read path — this module imports nothing
    // that could name one — so an unknown id is an explicit no-match and can never resolve onto a
    // neighbour's mark.
    expect(lastReadFor(store, 'c3')).toBeNull()
  })

  for (const key of hostileKeys) {
    it(`treats ${JSON.stringify(key)} as an ordinary key — no prototype lookup (#775 AC4)`, () => {
      const store = createConversationLastReadStore()

      // READ BEFORE WRITE. On a `Record` this read walks the prototype chain: `'__proto__'` yields
      // `Object.prototype` and `'constructor'` yields the `Object` function, neither of which is
      // nullish, so `?? null` never fires. `Map.prototype.get` performs no such lookup.
      expect(lastReadFor(store, key)).toBeNull()

      store.getState().recordLastRead(key, 6)

      expect(lastReadFor(store, key)).toBe(6)
      // Readable under that exact key only — no neighbour, and no other hostile key, was reached.
      expect(lastReadFor(store, 'c1')).toBeNull()
      expect(store.getState().marks.size).toBe(1)
    })
  }

  it('the three hostile keys hold independent marks and count as ordinary entries (#775 AC4)', () => {
    const store = createConversationLastReadStore()
    store.getState().recordLastRead('__proto__', 1)
    store.getState().recordLastRead('constructor', 2)
    store.getState().recordLastRead('', 3)

    // Distinct values on purpose: an aliasing implementation would read one of these back for another.
    expect(lastReadFor(store, '__proto__')).toBe(1)
    expect(lastReadFor(store, 'constructor')).toBe(2)
    expect(lastReadFor(store, '')).toBe(3)
    expect(store.getState().marks.size).toBe(3)
  })

  it('a record under __proto__ reaches nothing outside the store keyspace (#775 AC4)', () => {
    const store = createConversationLastReadStore()
    store.getState().recordLastRead('__proto__', 42)

    // `Map.prototype.set('__proto__', v)` creates an ordinary own entry rather than reassigning a
    // prototype, so nothing here can have leaked onto Object.prototype.
    expect(Object.getPrototypeOf({})).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).someKey).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'someKey')).toBe(false)
    expect(lastReadFor(store, 'cNever')).toBeNull()
  })

  it('the factory yields independent stores, and honours an injected initial state', () => {
    const one = createConversationLastReadStore()
    const two = createConversationLastReadStore()
    one.getState().recordLastRead('c1', 5)

    expect(lastReadFor(two, 'c1')).toBeNull()
    expect(initialConversationLastReadState.marks.size).toBe(0)

    const seeded = createConversationLastReadStore({ marks: new Map([['c1', 11]]) })
    expect(lastReadFor(seeded, 'c1')).toBe(11)
  })
})
