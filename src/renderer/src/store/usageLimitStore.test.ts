import { describe, it, expect, vi } from 'vitest'
import {
  createUsageLimitStore,
  initialUsageLimitState,
  selectUsageLimitFor,
  type UsageLimitReading,
  type UsageLimitSnapshot
} from './usageLimitStore'

// Plain-function store tests over isolated createUsageLimitStore() instances — the
// announcedModelStore.test idiom. No React, no bridge: the store is pure renderer state with three
// whole-key or whole-map mutations and no reject branch at all. `status` and `limitType` are held
// VERBATIM (claude-authored text that crossed the subprocess trust boundary; the daemon bounds them and
// does not sanitize them) — no normalising, no lowercasing, no allow-list, no shape check. This slice
// has no DOM sink, so the inert-text rendering discipline is inherited here and discharged by #1321.
//
// Three groups of cases carry the weight of the design rather than merely covering it:
//
//   - THE EXPIRY reads a `nowSeconds` VALUE rather than a clock, which is what makes it testable at all
//     under this repo's `node` environment (no timers, no DOM). `resetsAt: 0` is tested first and
//     separately, because reading it as an epoch timestamp would make every unreported reading invisible
//     the moment it lands.
//   - THE HOSTILE KEYS near the bottom are the whole defence for the `ReadonlyMap` mandate: a swap to
//     `Record<string, …>` produces no type error and breaks no other assertion in this file. The
//     PRE-WRITE reads are the half that matters — a `Record` hands a reader `Object.prototype` where
//     `?? null` should have fired.
//   - THE BY-REFERENCE returns pin what makes copy-on-write load-bearing rather than stylistic:
//     `initialUsageLimitState` is module-shared, so a mutation in place anywhere would poison it and
//     hand one pairing's readings to the next with no type error.

const CONV = 'conv-1'
const OTHER = 'conv-2'

const snapshot = (over: Partial<UsageLimitSnapshot> = {}): UsageLimitSnapshot => ({
  conversationId: CONV,
  status: 'allowed_warning',
  limitType: 'seven_day',
  resetsAt: 1_800_000_000,
  ...over
})

/** Read one conversation's reading at one instant — the only read surface. */
const readingFor = (
  store: ReturnType<typeof createUsageLimitStore>,
  conversationId: string,
  nowSeconds: number
): UsageLimitReading | null =>
  selectUsageLimitFor(conversationId, nowSeconds)(store.getState())

/** Comfortably inside the window `snapshot()` reports. */
const BEFORE_RESET = 1_799_999_999

describe('usageLimitStore', () => {
  it('starts empty — every conversation reads null (AC5)', () => {
    const store = createUsageLimitStore()
    expect(store.getState().readings.size).toBe(0)
    expect(readingFor(store, CONV, BEFORE_RESET)).toBeNull()
  })

  it('setUsageLimit records the reading; the selector returns it (AC1)', () => {
    const store = createUsageLimitStore()
    store.getState().setUsageLimit(snapshot())
    expect(readingFor(store, CONV, BEFORE_RESET)).toEqual({
      status: 'allowed_warning',
      limitType: 'seven_day',
      resetsAt: 1_800_000_000
    })
  })

  it('the held record carries no conversationId — the routing key stops at the map key', () => {
    // The split is load-bearing twice over: the selector's caller already knows which conversation it
    // asked about, so carrying the key in the value would be a second copy to keep in agreement with
    // the map key — and it would put a daemon-asserted string inside the very object #1321 renders from.
    const store = createUsageLimitStore()
    store.getState().setUsageLimit(snapshot())
    expect(readingFor(store, CONV, BEFORE_RESET)).not.toHaveProperty('conversationId')
  })

  it('a second reading for the same conversation wholly replaces the first — no merge (AC1)', () => {
    const store = createUsageLimitStore()
    store.getState().setUsageLimit(snapshot({ status: 'old_status', limitType: 'five_hour' }))
    store.getState().setUsageLimit(snapshot({ status: 'new_status', limitType: 'seven_day' }))
    expect(readingFor(store, CONV, BEFORE_RESET)).toEqual({
      status: 'new_status',
      limitType: 'seven_day',
      resetsAt: 1_800_000_000
    })
    expect(store.getState().readings.size).toBe(1)
  })

  it('a verbatim repeat is written again rather than deduped (AC1)', () => {
    // The arm is not deduped upstream — the daemon re-reports the window once per run whatever its
    // state and the transport holds no coalescing — so a repeat is the signal that the reading is still
    // current. Suppressing it would discard information. One consequence, stated rather than
    // discovered: each write produces a fresh record identity, so a repeat does re-notify a subscriber
    // watching that conversation.
    const store = createUsageLimitStore()
    store.getState().setUsageLimit(snapshot())
    const first = readingFor(store, CONV, BEFORE_RESET)
    store.getState().setUsageLimit(snapshot())
    const second = readingFor(store, CONV, BEFORE_RESET)
    expect(second).toEqual(first)
    expect(second).not.toBe(first)
  })

  it('a write for one conversation leaves every other record identical (AC1)', () => {
    // Narrow-slice correctness: a write for a DIFFERENT conversation produces a new map, but
    // `newMap.get(openId)` returns the SAME record object → `Object.is` true → no re-render of a
    // component watching `openId`.
    const store = createUsageLimitStore()
    store.getState().setUsageLimit(snapshot({ conversationId: OTHER, status: 'other_status' }))
    const before = readingFor(store, OTHER, BEFORE_RESET)
    store.getState().setUsageLimit(snapshot())
    expect(readingFor(store, OTHER, BEFORE_RESET)).toBe(before)
    expect(readingFor(store, CONV, BEFORE_RESET)).not.toBeNull()
  })

  it('holds a degenerate all-empty reading verbatim rather than collapsing it to absence', () => {
    // A present record is a REAL (if degenerate) reading the daemon emitted, held verbatim and NOT
    // collapsed to an absent key — the sessionIdStore `null`-vs-`''` contract. Reachable rather than
    // hypothetical: the daemon's producer emits on any non-empty status, but #1318 declined a second
    // client-side narrowing, so a non-conforming or hostile daemon can deliver one.
    const store = createUsageLimitStore()
    store.getState().setUsageLimit(snapshot({ status: '', limitType: '', resetsAt: 0 }))
    expect(readingFor(store, CONV, BEFORE_RESET)).toEqual({
      status: '',
      limitType: '',
      resetsAt: 0
    })
  })

  it('holds both strings verbatim — control bytes and terminal escapes included', () => {
    // The daemon BOUNDS these strings but does NOT SANITIZE them, so nothing here may normalise,
    // trim, lowercase or shape-check one. `0x1b` and `0x0a` are the two that would matter downstream:
    // one is a terminal escape, the other splits a log line — which is a second reason nothing on this
    // path is ever logged.
    const store = createUsageLimitStore()
    store.getState().setUsageLimit(
      snapshot({ status: '  Allowed_Warning[31m\n', limitType: '\tSEVEN_DAY ' })
    )
    expect(readingFor(store, CONV, BEFORE_RESET)).toEqual({
      status: '  Allowed_Warning[31m\n',
      limitType: '\tSEVEN_DAY ',
      resetsAt: 1_800_000_000
    })
  })

  it('the selector returns the HELD record itself, never a fresh object', () => {
    const store = createUsageLimitStore()
    store.getState().setUsageLimit(snapshot())
    expect(readingFor(store, CONV, BEFORE_RESET)).toBe(store.getState().readings.get(CONV))
  })

  // ---- the expiry (AC3) ----

  it('a reading stays readable strictly BEFORE its resetsAt (AC3)', () => {
    const store = createUsageLimitStore()
    store.getState().setUsageLimit(snapshot())
    expect(readingFor(store, CONV, 1_799_999_999)).not.toBeNull()
  })

  it('a reading yields nothing AT its resetsAt, not only after it (AC3)', () => {
    // The boundary is `>=`: the reset instant is when the window is fresh again, not the last instant
    // it was stale. A `>` boundary would keep one second of a lapsed reading readable.
    const store = createUsageLimitStore()
    store.getState().setUsageLimit(snapshot())
    expect(readingFor(store, CONV, 1_800_000_000)).toBeNull()
    expect(readingFor(store, CONV, 1_800_000_001)).toBeNull()
  })

  it('an expired reading is still HELD — the expiry is a read-time rule, not an eviction (AC3)', () => {
    // Keeping the entry is what keeps this store free of a timer it would otherwise need to evict on
    // schedule, and no consumer can observe the difference: the selector is the only read surface. It
    // also means `resetsAt` drives no scheduling, allocation or iteration anywhere on this path.
    const store = createUsageLimitStore()
    store.getState().setUsageLimit(snapshot())
    expect(readingFor(store, CONV, 1_800_000_001)).toBeNull()
    expect(store.getState().readings.size).toBe(1)
    expect(readingFor(store, CONV, BEFORE_RESET)).not.toBeNull()
  })

  it('resetsAt 0 stays readable indefinitely — it is NOT the epoch (AC3)', () => {
    // `0` means claude reported no reset, so there is no instant to expire at. Read as an epoch
    // timestamp it would make every unreported reading invisible the moment it lands, which is the
    // failure the zero test's placement ahead of the comparison forecloses.
    const store = createUsageLimitStore()
    store.getState().setUsageLimit(snapshot({ resetsAt: 0 }))
    expect(readingFor(store, CONV, 0)).not.toBeNull()
    expect(readingFor(store, CONV, 1_800_000_000)).not.toBeNull()
    expect(readingFor(store, CONV, Number.MAX_SAFE_INTEGER)).not.toBeNull()
  })

  it('a negative resetsAt is a past instant and expires immediately', () => {
    // An unvalidated claude number: negative, zero and year-40000 values are all representable and the
    // wire rejects none of them. Expiring a past instant is the honest reading, not a rejection — and
    // emphatically not the `0` case, which means something different.
    const store = createUsageLimitStore()
    store.getState().setUsageLimit(snapshot({ resetsAt: -1 }))
    expect(readingFor(store, CONV, 0)).toBeNull()
    expect(readingFor(store, CONV, 1_800_000_000)).toBeNull()
  })

  it('a far-future resetsAt stays readable — no range check, no clamp', () => {
    const store = createUsageLimitStore()
    store.getState().setUsageLimit(snapshot({ resetsAt: 1_000_000_000_000 }))
    expect(readingFor(store, CONV, 1_800_000_000)).not.toBeNull()
  })

  it('a MILLISECOND clock value expires a live reading — why the parameter is nowSeconds', () => {
    // The unit is the whole defence. `resetsAt` is unix SECONDS, so a caller passing a millisecond
    // `Date.now()` supplies a value roughly a thousand times larger than any real `resetsAt` and every
    // reading expires the instant it lands — with no type error, no red test outside this one, and a
    // symptom ("nothing ever shows") identical to the daemon having sent nothing. #1321 must pass
    // `Math.floor(Date.now() / 1000)`.
    const store = createUsageLimitStore()
    store.getState().setUsageLimit(snapshot())
    expect(readingFor(store, CONV, 1_799_999_999)).not.toBeNull()
    expect(readingFor(store, CONV, 1_799_999_999 * 1000)).toBeNull()
  })

  it('expiry is per entry — one lapsed reading does not hide a live sibling (AC1, AC3)', () => {
    const store = createUsageLimitStore()
    store.getState().setUsageLimit(snapshot({ resetsAt: 100 }))
    store.getState().setUsageLimit(snapshot({ conversationId: OTHER, resetsAt: 0 }))
    expect(readingFor(store, CONV, 200)).toBeNull()
    expect(readingFor(store, OTHER, 200)).not.toBeNull()
  })

  // ---- the allowed clear (AC2, store half) ----

  it('clearUsageLimitFor removes exactly one conversation’s entry (AC2)', () => {
    const store = createUsageLimitStore()
    store.getState().setUsageLimit(snapshot())
    store.getState().setUsageLimit(snapshot({ conversationId: OTHER }))
    const survivor = readingFor(store, OTHER, BEFORE_RESET)

    store.getState().clearUsageLimitFor(CONV)

    expect(readingFor(store, CONV, BEFORE_RESET)).toBeNull()
    expect(readingFor(store, OTHER, BEFORE_RESET)).toBe(survivor)
    expect(store.getState().readings.size).toBe(1)
  })

  it('clearUsageLimitFor clones the map rather than mutating the held one', () => {
    const store = createUsageLimitStore()
    store.getState().setUsageLimit(snapshot())
    const before = store.getState().readings
    store.getState().clearUsageLimitFor(CONV)
    expect(store.getState().readings).not.toBe(before)
    expect(before.has(CONV)).toBe(true)
  })

  it('clearUsageLimitFor on an absent key wakes no subscriber (AC2)', () => {
    // The absent-key guard returns the state OBJECT, so zustand's `Object.is(next, state)`
    // short-circuit fires. That is the COMMON case rather than an edge one — the bridge fires this for
    // any conversation that has never produced a reading — and it is a no-op BY DESIGN, not a
    // swallowed error.
    const store = createUsageLimitStore()
    store.getState().setUsageLimit(snapshot({ conversationId: OTHER }))
    const listener = vi.fn()
    store.subscribe(listener)

    store.getState().clearUsageLimitFor(CONV)

    expect(listener).not.toHaveBeenCalled()
    expect(readingFor(store, OTHER, BEFORE_RESET)).not.toBeNull()
  })

  it('clearUsageLimitFor drops an entry whose resetsAt is 0 — the only exit that one has', () => {
    // A `resetsAt: 0` reading never expires, so an `allowed` reading and the pairing clear are its two
    // exits. This is the first of them.
    const store = createUsageLimitStore()
    store.getState().setUsageLimit(snapshot({ resetsAt: 0 }))
    store.getState().clearUsageLimitFor(CONV)
    expect(readingFor(store, CONV, 0)).toBeNull()
  })

  // ---- the pairing clear (AC4) ----

  it('clearAllUsageLimits drops every conversation’s reading (AC4)', () => {
    const store = createUsageLimitStore()
    store.getState().setUsageLimit(snapshot())
    store.getState().setUsageLimit(snapshot({ conversationId: OTHER, resetsAt: 0 }))

    store.getState().clearAllUsageLimits()

    expect(store.getState().readings.size).toBe(0)
    expect(readingFor(store, CONV, BEFORE_RESET)).toBeNull()
    expect(readingFor(store, OTHER, 0)).toBeNull()
  })

  it('clearAllUsageLimits restores initialUsageLimitState BY REFERENCE (AC4)', () => {
    const store = createUsageLimitStore()
    store.getState().setUsageLimit(snapshot())
    store.getState().clearAllUsageLimits()
    expect(store.getState().readings).toBe(initialUsageLimitState.readings)
  })

  it('a redundant clearAllUsageLimits wakes no subscriber (AC4)', () => {
    // The `size === 0` guard hands the state OBJECT back, so zustand's `Object.is` short-circuit fires
    // and a redundant clear wakes NO listener at all. Unguarded `set(initialUsageLimitState)` would
    // still allocate a fresh state object and only the selectors would short-circuit.
    const store = createUsageLimitStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.getState().clearAllUsageLimits()
    expect(listener).not.toHaveBeenCalled()
  })

  it('clearAllUsageLimits never branches on held content — a hostile reading cannot survive it', () => {
    // A clear gated on a status (recognised, non-empty, or otherwise) would let a hostile daemon craft
    // a value that outlives a pairing switch and is then attributed to the next account.
    const store = createUsageLimitStore()
    store.getState().setUsageLimit(snapshot({ status: '', limitType: '', resetsAt: 0 }))
    store.getState().setUsageLimit(snapshot({ conversationId: '__proto__', status: 'allowed' }))
    store.getState().clearAllUsageLimits()
    expect(store.getState().readings.size).toBe(0)
  })

  it('the module-shared initial state is never poisoned by a later write', () => {
    // Returning `initialUsageLimitState` by reference is what makes the copy-on-write above
    // LOAD-BEARING: a writer that ever mutated `s.readings` in place would poison the constant and
    // every instance that had cleared would then hand ONE PAIRING'S readings to the next, with no type
    // error. Pinned here rather than by a guard.
    const cleared = createUsageLimitStore()
    cleared.getState().setUsageLimit(snapshot())
    cleared.getState().clearAllUsageLimits()
    cleared.getState().setUsageLimit(snapshot({ status: 'after_the_clear' }))

    expect(initialUsageLimitState.readings.size).toBe(0)
    expect(createUsageLimitStore().getState().readings.size).toBe(0)
  })

  // ---- hostile conversation ids (AC5) ----

  it.each(['__proto__', 'constructor', 'prototype', ''])(
    '%j is an ordinary conversation id — absent before any write (AC5)',
    (hostileId) => {
      // The PRE-WRITE half is the one that matters: a `Record<string, …>` would hand back
      // `Object.prototype` (or the `Object` constructor) where `?? null` should have fired, with no
      // type error and no other assertion in this file reddening.
      const store = createUsageLimitStore()
      expect(readingFor(store, hostileId, BEFORE_RESET)).toBeNull()
      store.getState().setUsageLimit(snapshot({ conversationId: OTHER }))
      expect(readingFor(store, hostileId, BEFORE_RESET)).toBeNull()
    }
  )

  it.each(['__proto__', 'constructor', 'prototype', ''])(
    '%j holds and returns its own reading like any other id (AC5)',
    (hostileId) => {
      const store = createUsageLimitStore()
      store
        .getState()
        .setUsageLimit(snapshot({ conversationId: hostileId, status: 'hostile_key_status' }))
      expect(readingFor(store, hostileId, BEFORE_RESET)).toEqual({
        status: 'hostile_key_status',
        limitType: 'seven_day',
        resetsAt: 1_800_000_000
      })
      expect(readingFor(store, CONV, BEFORE_RESET)).toBeNull()
    }
  )

  it('the four hostile ids are four independent entries, cleared one at a time (AC5)', () => {
    // `Map.prototype.set`/`get`/`delete` create, read and remove ordinary own entries for each of
    // these, so nothing collides and nothing walks a prototype chain.
    const store = createUsageLimitStore()
    const ids = ['__proto__', 'constructor', 'prototype', '']
    for (const id of ids) store.getState().setUsageLimit(snapshot({ conversationId: id }))
    expect(store.getState().readings.size).toBe(4)

    store.getState().clearUsageLimitFor('__proto__')

    expect(readingFor(store, '__proto__', BEFORE_RESET)).toBeNull()
    expect(readingFor(store, 'constructor', BEFORE_RESET)).not.toBeNull()
    expect(readingFor(store, 'prototype', BEFORE_RESET)).not.toBeNull()
    expect(readingFor(store, '', BEFORE_RESET)).not.toBeNull()
  })

  it('the state is a Map, not a Record — the mandate the hostile-key cases defend', () => {
    const store = createUsageLimitStore()
    store.getState().setUsageLimit(snapshot())
    expect(store.getState().readings).toBeInstanceOf(Map)
  })

  it('a seeded initial state is honoured — the DI seam for a per-test instance', () => {
    const store = createUsageLimitStore({
      readings: new Map([[CONV, { status: 'seeded', limitType: 'five_hour', resetsAt: 0 }]])
    })
    expect(readingFor(store, CONV, 1_800_000_000)).toEqual({
      status: 'seeded',
      limitType: 'five_hour',
      resetsAt: 0
    })
  })
})
