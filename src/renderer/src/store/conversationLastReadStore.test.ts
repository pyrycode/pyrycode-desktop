import { describe, it, expect, vi } from 'vitest'
import {
  createConversationLastReadStore,
  decodeLastReadMarks,
  encodeLastReadMarks,
  initialConversationLastReadState,
  localStorageConversationLastRead,
  selectLastReadFor,
  CONVERSATION_LAST_READ_KEY,
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
//
// #776 adds the persistence port and its codec. The port fake below is the pushNotificationPrefStore.test
// idiom; every test that used to seed the factory with a state object now seeds the fake instead, because
// the port is the store's ONE hydration source. Two further properties are invisible to `tsc` and get
// named tests of their own:
//
//   - The write-through must sit BEHIND the same-value guard. Persisting ahead of it — the ordering both
//     scalar precedents use, because their setters have no guard — compiles clean, passes every
//     read-back assertion, and fires one synchronous localStorage write per no-op record. Only a
//     `write` CALL-COUNT assertion catches it.
//   - The persisted format is an ARRAY OF ENTRIES, never an object. `Object.fromEntries` /
//     `JSON.stringify(map)` / an `obj[id] = mark` loop all typecheck, and with a NUMERIC value the
//     `__proto__` setter silently no-ops, so the entry vanishes with no prototype touched. The exact
//     encoded string is pinned below so that rewrite fails a test rather than compiling.

type Store = ReturnType<typeof createConversationLastReadStore>

const lastReadFor = (store: Store, conversationId: string): LastReadMark | null =>
  selectLastReadFor(conversationId)(store.getState())

/** The three keys AC4 names. `''` is in the set because it is a legal `Map` key and an illegal
 *  conversation id, so it must behave like any other unremarkable key rather than aliasing anything. */
const hostileKeys = ['__proto__', 'constructor', ''] as const

/** A closure over a mutable map, exposing read/write as `vi` spies — the in-memory fake port
 *  (pushNotificationPrefStore.test.ts:23-31). `write` replaces the backing value, so a SECOND store over
 *  the same fake is a simulated restart. It stores the DECODED map directly, modelling the port's output
 *  contract, so store tests never touch the codec — that is unit-tested separately below. */
function fakeStorage(seed: ReadonlyMap<string, LastReadMark> = new Map()) {
  let value: ReadonlyMap<string, LastReadMark> = seed
  return {
    read: vi.fn((): ReadonlyMap<string, LastReadMark> => value),
    write: vi.fn((next: ReadonlyMap<string, LastReadMark>): void => {
      value = next
    })
  }
}

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
    const store = createConversationLastReadStore(
      fakeStorage(
        new Map([
          ['c1', 4],
          ['c2', 9]
        ])
      )
    )
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

  it('the factory yields independent stores, and honours a seeded port', () => {
    const one = createConversationLastReadStore(fakeStorage())
    const two = createConversationLastReadStore(fakeStorage())
    one.getState().recordLastRead('c1', 5)

    expect(lastReadFor(two, 'c1')).toBeNull()
    expect(initialConversationLastReadState.marks.size).toBe(0)

    const seeded = createConversationLastReadStore(fakeStorage(new Map([['c1', 11]])))
    expect(lastReadFor(seeded, 'c1')).toBe(11)
  })
})

describe('conversationLastReadStore persistence (#776)', () => {
  it('hydrates a persisted mark at construction, with no explicit load step (AC1)', () => {
    const storage = fakeStorage(new Map([['c1', 4]]))
    const store = createConversationLastReadStore(storage)

    // No call site loads anything: constructing the store IS the hydration.
    expect(lastReadFor(store, 'c1')).toBe(4)
    expect(store.getState().marks.size).toBe(1)
    expect(storage.read).toHaveBeenCalledTimes(1)
  })

  it('hydrates empty from an empty port — "starts with nothing read" survives (AC1)', () => {
    const store = createConversationLastReadStore(fakeStorage())

    expect(store.getState().marks.size).toBe(0)
    expect(lastReadFor(store, 'c1')).toBeNull()
  })

  it('a mark recorded in one run is readable in the next — the simulated restart (AC1/AC2)', () => {
    const storage = fakeStorage()
    const a = createConversationLastReadStore(storage)
    a.getState().recordLastRead('c1', 12)

    // A fresh store over the SAME backend is a restart: it reads back what `a` persisted, with no
    // explicit save step at `a`'s call site and no explicit load step at `b`'s.
    const b = createConversationLastReadStore(storage)
    expect(lastReadFor(b, 'c1')).toBe(12)
  })

  it('a changed record writes through the port exactly once, carrying every held mark (AC2)', () => {
    const storage = fakeStorage(new Map([['c1', 4]]))
    const store = createConversationLastReadStore(storage)

    store.getState().recordLastRead('c2', 9)

    // Exactly once also pins that the zustand updater the write lives inside runs once per `set`.
    expect(storage.write).toHaveBeenCalledTimes(1)
    const persisted = storage.write.mock.calls[0][0]
    expect(persisted.get('c1')).toBe(4)
    expect(persisted.get('c2')).toBe(9)
    expect(persisted.size).toBe(2)
  })

  it('a verbatim repeat writes NOTHING through the port (AC3)', () => {
    const storage = fakeStorage()
    const store = createConversationLastReadStore(storage)

    store.getState().recordLastRead('c1', 5)
    store.getState().recordLastRead('c1', 5)

    // ONE write in total, not two. Persisting AHEAD of the same-value guard — the ordering both scalar
    // precedents use, because their setters have no guard — passes every read-back assertion in this
    // file and fires a synchronous localStorage write per no-op record. #777 stamps the open
    // conversation on every arriving delta while `items.length` does not move (threadTimeline.ts:239-250
    // grows the tail item in place), so the no-op record is the COMMON case, not an edge one.
    expect(storage.write).toHaveBeenCalledTimes(1)
  })

  it('a FIRST record of 0 on an absent key does write through (AC2)', () => {
    const storage = fakeStorage()
    const store = createConversationLastReadStore(storage)

    store.getState().recordLastRead('c1', 0)

    // The #775 numeric-guard trap, now on the persistence path: `undefined === 0` is false, so the
    // create path AND the persist both run. A falsy-shaped guard skips both.
    expect(storage.write).toHaveBeenCalledTimes(1)
    expect(storage.write.mock.calls[0][0].get('c1')).toBe(0)
  })

  it('a LOWER value than the held one writes through — replacement, never Math.max (AC2)', () => {
    const storage = fakeStorage(new Map([['c1', 9]]))
    const store = createConversationLastReadStore(storage)

    store.getState().recordLastRead('c1', 2)

    expect(storage.write).toHaveBeenCalledTimes(1)
    expect(storage.write.mock.calls[0][0].get('c1')).toBe(2)
  })

  it('persists the very map the state then holds, leaving the previously held one untouched', () => {
    const storage = fakeStorage()
    const store = createConversationLastReadStore(storage)
    store.getState().recordLastRead('c1', 2)
    const marksBefore = store.getState().marks

    store.getState().recordLastRead('c2', 8)

    expect(storage.write.mock.calls[1][0]).toBe(store.getState().marks)
    expect(marksBefore.has('c2')).toBe(false)
    expect(marksBefore.size).toBe(1)
  })
})

describe('encodeLastReadMarks / decodeLastReadMarks (#776)', () => {
  // The codec is unit-tested directly: the `node` runtime cannot reach it through the window-guarded real
  // port (pushNotificationPrefStore.test.ts:99-102). This is also the untrusted-input boundary — the blob
  // is hand-editable on disk and its keys are daemon-asserted conversation ids.

  it('decodes an absent blob to an empty map (AC4)', () => {
    expect(decodeLastReadMarks(null).size).toBe(0)
  })

  it('decodes malformed JSON to an empty map rather than throwing (AC4)', () => {
    expect(() => decodeLastReadMarks('{')).not.toThrow()
    expect(decodeLastReadMarks('{').size).toBe(0)
    expect(decodeLastReadMarks('not json').size).toBe(0)
  })

  it('decodes valid JSON of the wrong top-level shape to an empty map (AC4)', () => {
    for (const raw of ['{}', '3', 'null', '"x"', '{"c1":4}']) {
      expect(decodeLastReadMarks(raw).size).toBe(0)
    }
  })

  it('rejects elements that are not 2-tuples (AC4)', () => {
    for (const raw of ['[1]', '[["a"]]', '[["a",1,2]]', '[[]]', '[null]', '[{"0":"a","1":1}]']) {
      expect(decodeLastReadMarks(raw).size).toBe(0)
    }
  })

  it('rejects a non-string key (AC4)', () => {
    expect(decodeLastReadMarks('[[1,2]]').size).toBe(0)
    expect(decodeLastReadMarks('[[null,2]]').size).toBe(0)
  })

  it('rejects a value that is not a non-negative integer (AC4)', () => {
    // `[["a",null]]` is the case reachable through the app's OWN encoder: JSON.stringify turns NaN and
    // Infinity into `null`, and `typeof null === 'object'` fails the check.
    for (const raw of ['[["a","1"]]', '[["a",1.5]]', '[["a",-1]]', '[["a",null]]', '[["a",true]]']) {
      expect(decodeLastReadMarks(raw).size).toBe(0)
    }
  })

  it('rejects a corrupt blob WHOLE, dropping the entries that parsed (AC4)', () => {
    // The AC4 trade made explicit: one malformed entry costs every mark for that run. A per-entry-salvage
    // implementation passes every other decode test in this file and fails only this one.
    expect(decodeLastReadMarks('[["a",1],["b",-1]]').size).toBe(0)
  })

  it('encodes an empty map to "[]", which decodes back to empty — the #779 clear path', () => {
    expect(encodeLastReadMarks(new Map())).toBe('[]')
    expect(decodeLastReadMarks('[]').size).toBe(0)
  })

  it('round-trips a multi-entry map', () => {
    const marks = new Map([
      ['c1', 0],
      ['c2', 4],
      ['c3', 91]
    ])
    const back = decodeLastReadMarks(encodeLastReadMarks(marks))

    expect(back.size).toBe(3)
    expect(back.get('c1')).toBe(0)
    expect(back.get('c2')).toBe(4)
    expect(back.get('c3')).toBe(91)
  })

  it('round-trips all three hostile keys under their exact keys, altering no prototype (AC5)', () => {
    const marks = new Map(hostileKeys.map((key, i) => [key, i + 1]))
    const back = decodeLastReadMarks(encodeLastReadMarks(marks))

    // Distinct values on purpose: an aliasing implementation reads one of these back for another.
    expect(back.size).toBe(3)
    expect(back.get('__proto__')).toBe(1)
    expect(back.get('constructor')).toBe(2)
    expect(back.get('')).toBe(3)
    expect(Object.getPrototypeOf({})).toBe(Object.prototype)
    // `Object.prototype` OWNS a `__proto__` accessor by spec, so `hasOwnProperty` is not the probe —
    // it is `true` on a pristine realm. What a pollution would do is replace that accessor pair with a
    // data property, so the descriptor still carrying a getter is the assertion that means something.
    expect(Object.getOwnPropertyDescriptor(Object.prototype, '__proto__')?.get).toBeTypeOf('function')
  })

  it('decodes a HAND-AUTHORED __proto__ entry as an ordinary mark (AC5)', () => {
    // The untrusted-input direction, which the round-trip test alone does not cover: this blob was never
    // produced by `encodeLastReadMarks`.
    const back = decodeLastReadMarks('[["__proto__",7],["constructor",8]]')

    expect(back.get('__proto__')).toBe(7)
    expect(back.get('constructor')).toBe(8)
    expect(back.size).toBe(2)
    expect(Object.getPrototypeOf({})).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('pins the persisted format as an ARRAY OF ENTRIES, never an object', () => {
    // THIS is the assertion that fails when someone "tidies" the encoder into `Object.fromEntries` or
    // `JSON.stringify(map)`. The first drops this entry silently (the `__proto__` setter no-ops for a
    // NUMERIC value, so nothing is polluted and nothing throws); the second yields `{}` — total data
    // loss for every key at once.
    expect(encodeLastReadMarks(new Map([['__proto__', 7]]))).toBe('[["__proto__",7]]')
    expect(
      encodeLastReadMarks(
        new Map([
          ['c1', 4],
          ['c2', 9]
        ])
      )
    ).toBe('[["c1",4],["c2",9]]')
  })
})

describe('localStorageConversationLastRead (#776)', () => {
  it('uses the namespaced storage key', () => {
    expect(CONVERSATION_LAST_READ_KEY).toBe('pyry.conversationLastRead')
  })

  // Under the `node` test runtime there is no `window`; the import-safety guard makes read() an empty map
  // and write() a no-op, which is also what makes the real port safe as the factory's DEFAULT argument.
  it('is a safe no-op when window is absent (import-safety guard)', () => {
    const port = localStorageConversationLastRead()

    expect(port.read().size).toBe(0)
    expect(() => port.write(new Map([['c1', 1]]))).not.toThrow()
  })

  it('the default-argument factory is inert under node — no hydration, no throw', () => {
    const store = createConversationLastReadStore()
    store.getState().recordLastRead('c1', 3)

    expect(store.getState().marks.size).toBe(1)
    expect(lastReadFor(store, 'c1')).toBe(3)
  })
})
