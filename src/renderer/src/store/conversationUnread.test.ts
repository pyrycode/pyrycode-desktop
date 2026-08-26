import { describe, it, expect } from 'vitest'
import { isConversationUnread } from './conversationUnread'
import { initialTimelineState, reduceTimeline, type TimelineState } from './threadTimeline'
import {
  createConversationTimelineStore,
  selectTimelineFor
} from './conversationTimelineStore'
import {
  createConversationLastReadStore,
  selectLastReadFor,
  type LastReadMark
} from './conversationLastReadStore'

// The read boundary between the two keyed stores (#778). Scenarios 1-8 call the predicate directly with
// no store, no port and no singleton in scope — which is only possible because the module under test has
// ZERO runtime imports (both of its imports are `import type`). Scenarios 9-10 construct two real stores,
// because liveness and hostile-key resolution are properties of the pair, not of the predicate alone.
// `environment: 'node'` is already global at vitest.config.ts, so this file adds no environment pragma.
//
// Four properties here are invisible to `tsc` and break no other assertion, which is why each has a named
// test of its own:
//
//   - THE BRANCH ORDER. `timeline === null` must be checked BEFORE `lastRead === null`. Swapping the two
//     compiles clean and fails exactly one test below (the launch-state one), because it is the only
//     input where the two absent-readings disagree.
//   - A `?? 0` COLLAPSE. `timeline.items.length > (lastRead ?? 0)` typechecks identically and passes every
//     populated-slice assertion. It is caught only by the pair of empty-slice tests: a present empty slice
//     with NO mark must read unread, while the same slice with a mark of `0` must read read. A collapse
//     makes those two agree, which is the bug.
//   - A `>=` FOR THE `>`. Equal counts must read as READ; only the exactly-at-the-mark test catches it.
//   - A `Record`-backed keyspace in either source store. Caught only by the hostile-key reads BEFORE ANY
//     WRITE, where `'__proto__'` and `'constructor'` walk the prototype chain and resolve non-nullish.

/** Fold `count` row-adding events through the REAL reducer rather than hand-writing a `TimelineState`
 *  literal, which would drift from the real shape as `TimelineState` grows chrome scalars. `userText`
 *  always appends a fresh item (threadTimeline.ts:397), so `items.length === count`. */
function timelineWith(count: number): TimelineState {
  let state = initialTimelineState
  for (let i = 0; i < count; i++) {
    state = reduceTimeline(state, { type: 'userText', text: `m${i}` })
  }
  return state
}

/** In-memory port so scenario 9-10's last-read store never reaches for real storage — the
 *  conversationLastReadStore.test.ts fake, minus the spies nothing here asserts on. */
function fakeStorage() {
  let value: ReadonlyMap<string, LastReadMark> = new Map()
  return {
    read: (): ReadonlyMap<string, LastReadMark> => value,
    write: (next: ReadonlyMap<string, LastReadMark>): void => {
      value = next
    }
  }
}

describe('isConversationUnread', () => {
  it('reads unread when the held timeline has more items than the mark (AC1)', () => {
    expect(isConversationUnread(timelineWith(3), 1)).toBe(true)
  })

  it('reads read when the held timeline has exactly as many items as the mark (AC2)', () => {
    // Pins the strict `>`. A `>=` passes every other test in this file and fails only here.
    expect(isConversationUnread(timelineWith(3), 3)).toBe(false)
  })

  it('reads read when a recreated slice restarts below a stale mark (AC2, the eviction discontinuity)', () => {
    // A slice evicted at MAX_RETAINED_TIMELINES and later recreated restarts near zero, so a mark of 47
    // survives against a count of 1. DECIDED, not a bug: a missed mark beats a stuck one, which is the
    // direction the open question at conversation-last-read-store.md:113-118 is answered in.
    expect(isConversationUnread(timelineWith(1), 47)).toBe(false)
  })

  it('reads read when no timeline is held at all, whatever mark it carries (AC4)', () => {
    // Never fed, or evicted at the ten-slice cap. No content this client can see ⇒ nothing to be unread
    // about, and a stuck mark nobody can clear is worse than a missed one.
    expect(isConversationUnread(null, 5)).toBe(false)
  })

  it('reads read at launch — no timeline held AND no mark recorded (AC4 beats AC5)', () => {
    // THE BRANCH-ORDERING TEST, and the only input where AC4 and AC5 disagree. At launch no slices are
    // held and no marks exist for conversations never opened; a mark-first reading would light the entire
    // sidebar on every start, the exact failure #776's persistence was built to prevent.
    expect(isConversationUnread(null, null)).toBe(false)
  })

  it('reads unread when a populated timeline is held but no mark was ever recorded (AC5)', () => {
    // A chat another client has driven is never invisible; opening it clears the mark by the ordinary
    // path (`stampLastReadFor`) — nothing in this module writes.
    expect(isConversationUnread(timelineWith(2), null)).toBe(true)
  })

  it('reads unread for a present but EMPTY slice with no mark — deliberate, not an oversight (AC5)', () => {
    // Reachable: `dispatchFor` creates a slice on an absent key unconditionally
    // (conversationTimelineStore.ts:279-282), including for arms that never touch `items` — `turnState`,
    // `stallDetected`, `apiRetry`, `compacting`, `reconnected`. A turn running in a conversation the
    // operator has never opened therefore mints an empty slice with no mark, and reading that as unread
    // is the honest answer: a slice minted by a non-row-adding arm is still activity in a conversation
    // this client has never read. The alternative reading (`0 > 0` ⇒ read) requires exactly the `?? 0`
    // collapse the ticket bans.
    expect(isConversationUnread(initialTimelineState, null)).toBe(true)
  })

  it('treats a mark of 0 as a real mark, not as "never read"', () => {
    // The other direction of the same distinction: opening a conversation whose timeline is empty stamps
    // `0`, and that conversation is READ. Together with the test above, this is what a `?? 0` collapse or
    // a `||`-based selector cannot satisfy — it makes the two agree.
    expect(isConversationUnread(initialTimelineState, 0)).toBe(false)
  })

  it('reads unread the moment content arrives, with no conversation-list re-request (AC3)', () => {
    const timelines = createConversationTimelineStore()
    const lastRead = createConversationLastReadStore(fakeStorage())

    // `A` is a conversation the operator has read to the end of; `B` is one he is not looking at.
    timelines.getState().dispatchFor('A', { type: 'userText', text: 'hello' })
    lastRead.getState().recordLastRead('A', 1)

    timelines.getState().dispatchFor('B', { type: 'userText', text: 'from another client' })

    // WHAT THIS TEST DOES NOT DO IS THE CRITERION: no `list_conversations` reply, no `conversationUpdated`
    // / `conversationDeleted` / `conversationCreated`, no reconnect, no restart, no `markViewed`, and no
    // mounted `useConversationLastRead()` (whose store→store subscription this test has nowhere to tear
    // down, and whose write path is #777's, already covered by conversationLastReadBridge.test.ts). One
    // `dispatchFor` and two direct writes is the whole fixture.
    const unreadFor = (id: string): boolean =>
      isConversationUnread(
        selectTimelineFor(id)(timelines.getState()),
        selectLastReadFor(id)(lastRead.getState())
      )

    expect(unreadFor('B')).toBe(true)
    expect(unreadFor('A')).toBe(false)
  })

  it('resolves a hostile conversation id to its own conversation and no neighbour', () => {
    const timelines = createConversationTimelineStore()
    const lastRead = createConversationLastReadStore(fakeStorage())

    const unreadFor = (id: string): boolean =>
      isConversationUnread(
        selectTimelineFor(id)(timelines.getState()),
        selectLastReadFor(id)(lastRead.getState())
      )

    // The diagnostic half — reads BEFORE ANY WRITE. On a `Record`-backed store `'__proto__'` and
    // `'constructor'` walk the prototype chain and hand back non-nullish values, so the timeline read
    // would be a present slice rather than `null` and these would read unread.
    for (const id of ['__proto__', 'constructor', '']) {
      expect(unreadFor(id)).toBe(false)
    }

    timelines.getState().dispatchFor('__proto__', { type: 'userText', text: 'hostile' })

    expect(unreadFor('__proto__')).toBe(true)
    expect(unreadFor('constructor')).toBe(false)
    expect(unreadFor('')).toBe(false)
  })
})
