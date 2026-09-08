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

  it('dropConversation removes only the named entry, leaving the rest Object.is-identical (AC1)', () => {
    const store = createConversationActivityStore()
    store.getState().setTurnRunning('c1', true)
    store.getState().setStalled('c2', true)
    store.getState().setCompacting('c3', true)
    const c1Before = activityFor(store, 'c1')
    const c3Before = activityFor(store, 'c3')

    store.getState().dropConversation('c2')

    expect(activityFor(store, 'c2')).toBeNull()
    // `new Map(s.entries)` copies REFERENCES, so the survivors are the SAME objects rather than
    // merely deep-equal ones, and a subscriber selecting either is not woken by the removal.
    expect(activityFor(store, 'c1')).toBe(c1Before)
    expect(activityFor(store, 'c3')).toBe(c3Before)
    expect(store.getState().entries.size).toBe(2)
  })

  it('dropConversation clones the outer map rather than deleting in place (AC1)', () => {
    const store = createConversationActivityStore()
    store.getState().setApiRetrying('c1', true)
    store.getState().setCompacting('c2', true)
    const entriesBefore = store.getState().entries

    store.getState().dropConversation('c1')

    // THIS is the assertion that catches an in-place `s.entries.delete(id)`. The identity assertion
    // above does not: an in-place delete leaves the survivors trivially identical, because there is
    // only ever one map.
    expect(entriesBefore.has('c1')).toBe(true)
    expect(store.getState().entries).not.toBe(entriesBefore)
    expect(store.getState().entries.has('c1')).toBe(false)
  })

  it('dropConversation for an id the store never held notifies nobody (AC2)', () => {
    const store = createConversationActivityStore()
    store.getState().setStalled('c1', true)
    const stateBefore = store.getState()

    let notifications = 0
    const unsubscribe = store.subscribe(() => {
      notifications += 1
    })
    // The COMMON case, not an edge one: the bridge fires for every deletion and most conversations
    // have never produced an activity frame. The guard returns the state object itself, so zustand's
    // `Object.is` short-circuit fires before the merge.
    store.getState().dropConversation('cNever')
    unsubscribe()

    expect(notifications).toBe(0)
    expect(store.getState()).toBe(stateBefore)
    expect(activityFor(store, 'c1')).toEqual({ ...idle, stalled: true })
  })

  it('dropConversation for a HELD id does notify — the negative control for the guard (AC2)', () => {
    const store = createConversationActivityStore()
    store.getState().setStalled('c1', true)

    let notifications = 0
    const unsubscribe = store.subscribe(() => {
      notifications += 1
    })
    // Without this, "an absent-key drop churns nothing" would also pass for a store whose drop path
    // never writes at all.
    store.getState().dropConversation('c1')
    unsubscribe()

    expect(notifications).toBe(1)
    expect(activityFor(store, 'c1')).toBeNull()
  })

  it('dropConversation removes rather than zeroes, and does not latch the id', () => {
    const store = createConversationActivityStore()
    store.getState().setTurnRunning('c1', true)

    store.getState().dropConversation('c1')

    // Back to "no frame has ever arrived", NOT to a present all-false entry — the distinction
    // `selectActivityFor` preserves.
    expect(activityFor(store, 'c1')).toBeNull()

    // And a later frame for that id — a recreated conversation reusing it, say — creates a fresh
    // entry normally.
    store.getState().setStalled('c1', false)
    expect(activityFor(store, 'c1')).toEqual(idle)
  })

  for (const key of hostileKeys) {
    it(`dropConversation treats ${JSON.stringify(key)} as an ordinary key (AC4)`, () => {
      const store = createConversationActivityStore()

      // READ BEFORE WRITE, the same ordering as the block above and for the same reason: on a
      // `Record` this read walks the prototype chain and hands back `Object.prototype` / the
      // `Object` function, neither nullish, so `?? null` never fires. A post-drop read alone could
      // not distinguish the `Map` from a `Record`.
      expect(activityFor(store, key)).toBeNull()

      store.getState().setStalled(key, true)
      store.getState().dropConversation(key)

      // `Map.prototype.delete('__proto__')` removes an ordinary own entry rather than touching a
      // prototype, so nothing here can have reached outside the store keyspace.
      expect(activityFor(store, key)).toBeNull()
      expect(store.getState().entries.size).toBe(0)
      expect(({} as Record<string, unknown>).stalled).toBeUndefined()
      expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'stalled')).toBe(false)
    })
  }

  it('clearAllActivity drops every entry, hostile keys included (AC3)', () => {
    const store = createConversationActivityStore()
    store.getState().setTurnRunning('c1', true)
    store.getState().setStalled('c2', true)
    store.getState().setCompacting('__proto__', true)

    store.getState().clearAllActivity()

    expect(store.getState().entries.size).toBe(0)
    for (const id of ['c1', 'c2', '__proto__']) {
      expect(activityFor(store, id)).toBeNull()
    }
  })

  it('clearAllActivity on an already-empty store notifies nobody (AC3)', () => {
    const store = createConversationActivityStore()
    const stateBefore = store.getState()

    let notifications = 0
    const unsubscribe = store.subscribe(() => {
      notifications += 1
    })
    store.getState().clearAllActivity()
    unsubscribe()

    expect(notifications).toBe(0)
    expect(store.getState()).toBe(stateBefore)
  })

  it('clearAllActivity hands back a FRESH map and does not latch the store (AC3)', () => {
    const store = createConversationActivityStore()
    store.getState().setCompacting('c1', true)

    store.getState().clearAllActivity()

    // Never `initialConversationActivityState`: that exported constant holds a module-shared MUTABLE
    // map, so returning it as live state would make every store instance that clears share one
    // object. The `size === 0` guard buys the idempotence that returning the constant would.
    expect(store.getState().entries).not.toBe(initialConversationActivityState.entries)

    store.getState().setTurnRunning('c2', true)
    expect(activityFor(store, 'c2')).toEqual({ ...idle, turnRunning: true })
    expect(activityFor(store, 'c1')).toBeNull()
  })

  describe('resetActivityFor (scoped reconnect reset, #1145)', () => {
    it('drops exactly the listed held entries and leaves the rest Object.is-identical (AC1)', () => {
      const store = createConversationActivityStore()
      store.getState().setTurnRunning('a1', true)
      store.getState().setStalled('b1', true)
      store.getState().setCompacting('b2', true)
      const a1Before = activityFor(store, 'a1')

      store.getState().resetActivityFor(new Set(['b1', 'b2']))

      expect(activityFor(store, 'b1')).toBeNull()
      expect(activityFor(store, 'b2')).toBeNull()
      // The survivor is the SAME entry object, not merely a deep-equal one — `new Map(s.entries)`
      // copies references — so a component watching another server's conversation is not woken.
      expect(activityFor(store, 'a1')).toBe(a1Before)
      expect(store.getState().entries.size).toBe(1)
    })

    it('drops all four facts of a listed entry, not merely the running one (AC3)', () => {
      // The reconnect guarantee is about LIVENESS as a whole: a socket that dropped mid-turn can
      // leave any of the four latched, so a reset that zeroed only `turnRunning` would still show a
      // stalled or compacting dot from the previous connection.
      const store = createConversationActivityStore()
      store.getState().setTurnRunning('b1', true)
      store.getState().setStalled('b1', true)
      store.getState().setApiRetrying('b1', true)
      store.getState().setCompacting('b1', true)

      store.getState().resetActivityFor(new Set(['b1']))

      // Back to "no frame has ever arrived", NOT to a present all-false entry — the same
      // remove-rather-than-zero reading `dropConversation` carries.
      expect(activityFor(store, 'b1')).toBeNull()
    })

    it('clones the outer map rather than deleting in place (AC1)', () => {
      const store = createConversationActivityStore()
      store.getState().setApiRetrying('b1', true)
      store.getState().setCompacting('a1', true)
      const entriesBefore = store.getState().entries

      store.getState().resetActivityFor(new Set(['b1']))

      // The identity assertion above cannot catch an in-place `s.entries.delete(id)`: with one map
      // the survivors are trivially identical. This can.
      expect(entriesBefore.has('b1')).toBe(true)
      expect(store.getState().entries).not.toBe(entriesBefore)
      expect(store.getState().entries.has('b1')).toBe(false)
    })

    it('is RE-ARMABLE rather than one-shot — each reconnect resets again (AC3)', () => {
      const store = createConversationActivityStore()
      store.getState().setTurnRunning('b1', true)
      store.getState().resetActivityFor(new Set(['b1']))
      expect(activityFor(store, 'b1')).toBeNull()

      store.getState().setStalled('b1', true)
      store.getState().resetActivityFor(new Set(['b1']))
      expect(activityFor(store, 'b1')).toBeNull()
    })

    it('an EMPTY id set notifies nobody and hands the state object back (AC2)', () => {
      // The first-connect case: the reconnecting server's slot holds no list yet, so the shared
      // resolution answers `EMPTY_CONVERSATION_IDS` and this must drop nothing at all.
      const store = createConversationActivityStore()
      store.getState().setTurnRunning('a1', true)
      const stateBefore = store.getState()

      let notifications = 0
      const unsubscribe = store.subscribe(() => {
        notifications += 1
      })
      store.getState().resetActivityFor(new Set())
      unsubscribe()

      expect(notifications).toBe(0)
      expect(store.getState()).toBe(stateBefore)
      expect(activityFor(store, 'a1')).toEqual({ ...idle, turnRunning: true })
    })

    it('a set naming only ids the store never held notifies nobody (AC2)', () => {
      // The reconnect of a server whose conversations have produced no activity frame — the common
      // case rather than an edge one, and the generalisation of `dropConversation`'s absent-key
      // guard: the state OBJECT comes back, so zustand's `Object.is` fires before the merge.
      const store = createConversationActivityStore()
      store.getState().setStalled('a1', true)
      const stateBefore = store.getState()

      let notifications = 0
      const unsubscribe = store.subscribe(() => {
        notifications += 1
      })
      store.getState().resetActivityFor(new Set(['b1', 'b2']))
      unsubscribe()

      expect(notifications).toBe(0)
      expect(store.getState()).toBe(stateBefore)
    })

    it('on an already-empty store notifies nobody (AC2)', () => {
      const store = createConversationActivityStore()
      const stateBefore = store.getState()

      let notifications = 0
      const unsubscribe = store.subscribe(() => {
        notifications += 1
      })
      store.getState().resetActivityFor(new Set(['b1']))
      unsubscribe()

      expect(notifications).toBe(0)
      expect(store.getState()).toBe(stateBefore)
    })

    it('a set naming a HELD id does notify — the negative control for the guard (AC1)', () => {
      // Without this, "an unlisted reset churns nothing" would also pass for a reset path that never
      // writes at all.
      const store = createConversationActivityStore()
      store.getState().setStalled('b1', true)

      let notifications = 0
      const unsubscribe = store.subscribe(() => {
        notifications += 1
      })
      store.getState().resetActivityFor(new Set(['b1']))
      unsubscribe()

      expect(notifications).toBe(1)
      expect(activityFor(store, 'b1')).toBeNull()
    })

    it('leaves an entry no id set names alone, and does not latch a reset id', () => {
      const store = createConversationActivityStore()
      store.getState().setCompacting('orphan', true)
      store.getState().setTurnRunning('b1', true)

      store.getState().resetActivityFor(new Set(['b1']))

      // The accepted consequence of scoping by the conversation list: an entry held for a
      // conversation in no server's list survives every scoped reset, and `clearAllActivity` at the
      // pairing boundary is the only thing that ever collects it.
      expect(activityFor(store, 'orphan')).toEqual({ ...idle, compacting: true })

      // And a later frame for a reset id creates a fresh entry normally.
      store.getState().setStalled('b1', false)
      expect(activityFor(store, 'b1')).toEqual(idle)
    })

    for (const key of hostileKeys) {
      it(`treats ${JSON.stringify(key)} as an ordinary key on BOTH sides of the test (AC4)`, () => {
        const store = createConversationActivityStore()

        // READ BEFORE WRITE, the same ordering as the two blocks above and for the same reason: on a
        // `Record` this read walks the prototype chain and hands back a non-nullish value, so a
        // post-reset read alone could not distinguish the `Map` from a `Record`.
        expect(activityFor(store, key)).toBeNull()

        store.getState().setStalled(key, true)
        // BOTH sides are daemon-supplied: the held key came from an event's `conversationId`, the
        // set from a `list_conversations` reply's row id. `Set.prototype.has('__proto__')` performs
        // no prototype-chain lookup, so a hostile id matches itself and nothing else.
        store.getState().resetActivityFor(new Set([key]))

        expect(activityFor(store, key)).toBeNull()
        expect(store.getState().entries.size).toBe(0)
        expect(({} as Record<string, unknown>).stalled).toBeUndefined()
        expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'stalled')).toBe(false)
      })
    }

    it("'' and '__proto__' reset independently — neither aliases the other (AC4)", () => {
      const store = createConversationActivityStore()
      store.getState().setTurnRunning('', true)
      store.getState().setCompacting('__proto__', true)

      store.getState().resetActivityFor(new Set(['']))

      expect(activityFor(store, '')).toBeNull()
      expect(activityFor(store, '__proto__')).toEqual({ ...idle, compacting: true })
    })
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
