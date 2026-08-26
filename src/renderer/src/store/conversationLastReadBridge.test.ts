import { describe, it, expect, vi } from 'vitest'
import {
  stampLastReadFor,
  subscribeConversationLastRead,
  type ConversationLastReadDeps
} from './conversationLastReadBridge'
import {
  createConversationLastReadStore,
  selectLastReadFor,
  type ConversationLastReadStorage,
  type LastReadMark
} from './conversationLastReadStore'
import { createConversationTimelineStore, selectTimelineFor } from './conversationTimelineStore'
import { createActiveConversationStore, selectActiveConversation } from './activeConversationStore'
import { initialTimelineState, type ThreadItem, type TimelineState } from './threadTimeline'
import type { ConversationCreatedPayload } from '@shared/wire/types'

// The write path feeding conversationLastReadStore (#777). Both halves are React-free with injected
// effects — the conversationActivityBridge idiom — so the whole decision surface is exercised here with
// plain spies under `environment: 'node'`. No React, no DOM, no Electron bridge, and no daemon-event
// listener at all: the feed is a STORE subscription, which is what makes the count observed after it has
// already moved rather than sampled from a second listener whose registration order decides the answer.
//
// Three properties here are invisible to `tsc` and break no other assertion, which is why each has a
// named test:
//
//   - An ABSENT timeline slice must stamp `0`, not skip the write. `selectTimelineFor(id) ??
//     initialTimelineState` is banned at every read site (conversationTimelineStore.ts:44-49), so the
//     branch is written out — and a branch that returned early instead would compile clean and leave a
//     freshly opened conversation reading as never-read.
//   - The count is RE-SAMPLED at fire time. Capturing it at subscribe time typechecks identically and
//     only ever records the count the conversation held when the listener was installed.
//   - The write is an ASSIGNMENT of the sampled count, never an increment. Most emissions leave the open
//     conversation's `items.length` alone (a continuing delta coalesces into the tail bubble, a
//     `toolResult` fills a held row in place), so "an arm arrived, therefore the mark went up" is false
//     on most arms and only an equality assertion catches it.

const conversation = (id: string): ConversationCreatedPayload => ({
  id,
  is_promoted: false,
  cwd: '/home/pyry/work',
  name: null,
  last_used_at: '2026-07-30T09:00:00Z'
})

/** A slice holding exactly `count` rows — the quantity a mark is a sample of. */
const sliceHolding = (count: number): TimelineState => ({
  ...initialTimelineState,
  items: Array.from(
    { length: count },
    (_unused, index): ThreadItem => ({ kind: 'userText', text: `row ${index}` })
  )
})

/** An in-memory port so the last-read store's persistence never depends on `window` being absent. */
function memoryStorage(): ConversationLastReadStorage {
  let held: ReadonlyMap<string, LastReadMark> = new Map()
  return {
    read: () => held,
    write: (marks) => {
      held = marks
    }
  }
}

describe('stampLastReadFor', () => {
  it('an ABSENT slice and an EMPTY slice both stamp a mark of 0 (#777 AC1)', () => {
    const recordLastRead = vi.fn()
    const absent: ConversationLastReadDeps = {
      getOpenConversationId: vi.fn(),
      getTimelineFor: () => null,
      recordLastRead
    }

    stampLastReadFor(absent, 'a')

    expect(recordLastRead).toHaveBeenCalledTimes(1)
    expect(recordLastRead).toHaveBeenCalledWith('a', 0)

    const empty: ConversationLastReadDeps = {
      getOpenConversationId: vi.fn(),
      getTimelineFor: () => initialTimelineState,
      recordLastRead
    }

    stampLastReadFor(empty, 'a')

    // The two readings stay DISTINCT states in the timeline store and map onto the same honest count
    // here: a conversation with no slice held holds zero items, and so does an empty slice.
    expect(recordLastRead).toHaveBeenCalledTimes(2)
    expect(recordLastRead).toHaveBeenNthCalledWith(2, 'a', 0)
  })

  it("stamps a populated slice's own item count (#777 AC1)", () => {
    const recordLastRead = vi.fn()
    const deps: ConversationLastReadDeps = {
      getOpenConversationId: vi.fn(),
      getTimelineFor: () => sliceHolding(3),
      recordLastRead
    }

    stampLastReadFor(deps, 'a')

    expect(recordLastRead).toHaveBeenCalledWith('a', 3)
  })

  it('never reads the open conversation — it stamps the id it was handed (#777 AC2)', () => {
    // This is what makes the helper correct at the activate seam, where the conversation being stamped
    // is not yet the open one, and independent of whether `setActiveConversation` has run.
    const getOpenConversationId = vi.fn()
    const recordLastRead = vi.fn()
    const deps: ConversationLastReadDeps = {
      getOpenConversationId,
      getTimelineFor: () => sliceHolding(2),
      recordLastRead
    }

    stampLastReadFor(deps, 'b')

    expect(getOpenConversationId).not.toHaveBeenCalled()
    expect(recordLastRead).toHaveBeenCalledWith('b', 2)
  })

  it('passes the id through verbatim, hostile keys included', () => {
    // No normalisation, trimming, length check or truthiness test anywhere on this path: `''` is an
    // illegal conversation id and a legal `Map` key, and `'__proto__'` is an unremarkable key by
    // construction. Both must reach the store exactly as handed in.
    for (const id of ['__proto__', '']) {
      const recordLastRead = vi.fn()
      const lookedUp: string[] = []
      const deps: ConversationLastReadDeps = {
        getOpenConversationId: vi.fn(),
        getTimelineFor: (conversationId) => {
          lookedUp.push(conversationId)
          return null
        },
        recordLastRead
      }

      stampLastReadFor(deps, id)

      expect(lookedUp).toEqual([id])
      expect(recordLastRead).toHaveBeenCalledTimes(1)
      expect(recordLastRead.mock.calls[0][0]).toBe(id)
    }
  })
})

describe('subscribeConversationLastRead', () => {
  it("hands back the subscribe seam's own unsubscribe handle", () => {
    const off = (): void => {}
    const subscribeTimelines = vi.fn(() => off)

    const returned = subscribeConversationLastRead(subscribeTimelines, {
      getOpenConversationId: () => null,
      getTimelineFor: () => null,
      recordLastRead: vi.fn()
    })

    // toBe, not toEqual: the React binding returns this as its effect cleanup, so a re-wrapped handle
    // would tear down nothing.
    expect(returned).toBe(off)
  })

  it("re-stamps the OPEN conversation with its own count on an emission (#777 AC3)", () => {
    let listener = (): void => {}
    const recordLastRead = vi.fn()

    subscribeConversationLastRead(
      (fired) => {
        listener = fired
        return () => {}
      },
      {
        getOpenConversationId: () => 'a',
        getTimelineFor: (id) => (id === 'a' ? sliceHolding(4) : null),
        recordLastRead
      }
    )

    listener()

    expect(recordLastRead).toHaveBeenCalledTimes(1)
    expect(recordLastRead).toHaveBeenCalledWith('a', 4)
  })

  it('records NOTHING when no conversation is open (#777 AC4)', () => {
    let listener = (): void => {}
    const recordLastRead = vi.fn()

    subscribeConversationLastRead(
      (fired) => {
        listener = fired
        return () => {}
      },
      {
        getOpenConversationId: () => null,
        getTimelineFor: () => sliceHolding(9),
        recordLastRead
      }
    )

    listener()

    // Not a mark of `0` for anybody — nothing open means nothing is minted.
    expect(recordLastRead).not.toHaveBeenCalled()
  })

  it('re-samples the count at FIRE time, not at subscribe time (#777 AC3)', () => {
    let listener = (): void => {}
    let held: TimelineState | null = sliceHolding(1)
    const recordLastRead = vi.fn()

    subscribeConversationLastRead(
      (fired) => {
        listener = fired
        return () => {}
      },
      {
        getOpenConversationId: () => 'a',
        getTimelineFor: () => held,
        recordLastRead
      }
    )

    listener()
    held = sliceHolding(5)
    listener()

    expect(recordLastRead.mock.calls).toEqual([
      ['a', 1],
      ['a', 5]
    ])
  })

  it('never names a conversation other than the open one, however the others grow (#777 AC4)', () => {
    let listener = (): void => {}
    let backgroundRows = 1
    const recordLastRead = vi.fn()

    subscribeConversationLastRead(
      (fired) => {
        listener = fired
        return () => {}
      },
      {
        getOpenConversationId: () => 'a',
        getTimelineFor: (id) => (id === 'a' ? sliceHolding(2) : sliceHolding(backgroundRows)),
        recordLastRead
      }
    )

    for (let i = 0; i < 3; i += 1) {
      backgroundRows += 1
      listener()
    }

    // AC4 as a property over the whole call list: 'b' is not merely unmarked, it is never an argument.
    expect(recordLastRead.mock.calls.every((call) => call[0] === 'a')).toBe(true)
    expect(recordLastRead.mock.calls.some((call) => call[0] === 'b')).toBe(false)
  })
})

describe('conversationLastReadBridge over real stores', () => {
  function wire(open: string | null): {
    timelines: ReturnType<typeof createConversationTimelineStore>
    lastRead: ReturnType<typeof createConversationLastReadStore>
    off: () => void
    markFor: (conversationId: string) => LastReadMark | null
    countFor: (conversationId: string) => number
  } {
    const timelines = createConversationTimelineStore()
    const lastRead = createConversationLastReadStore(memoryStorage())
    const active = createActiveConversationStore(
      open === null ? undefined : { activeConversation: conversation(open) }
    )
    const deps: ConversationLastReadDeps = {
      getOpenConversationId: () => {
        const held = selectActiveConversation(active.getState())
        return held === null ? null : held.id
      },
      getTimelineFor: (id) => selectTimelineFor(id)(timelines.getState()),
      recordLastRead: (id, itemsSeen) => lastRead.getState().recordLastRead(id, itemsSeen)
    }
    const off = subscribeConversationLastRead((fired) => timelines.subscribe(fired), deps)
    return {
      timelines,
      lastRead,
      off,
      markFor: (id) => selectLastReadFor(id)(lastRead.getState()),
      countFor: (id) => {
        // The same explicit branch the bridge itself takes — never `?? initialTimelineState`.
        const slice = selectTimelineFor(id)(timelines.getState())
        return slice === null ? 0 : slice.items.length
      }
    }
  }

  it("keeps the open conversation's mark level with its own count as rows land (#777 AC3)", () => {
    const { timelines, markFor } = wire('a')

    timelines.getState().dispatchFor('a', { type: 'userText', text: 'first' })
    expect(markFor('a')).toBe(1)

    timelines.getState().dispatchFor('a', { type: 'turnEnd', turnId: 't1', stopReason: 'end_turn' })
    expect(markFor('a')).toBe(2)
  })

  it('is an EQUALITY, not a bump — a continuing delta moves neither count nor mark (#777 AC3)', () => {
    const { timelines, markFor, countFor } = wire('a')

    timelines.getState().dispatchFor('a', { type: 'assistantDelta', turnId: 't1', seq: 1, text: 'he' })
    expect(countFor('a')).toBe(1)

    // `appendDelta` coalesces into the tail bubble, so `items.length` does not move — and neither may
    // the mark. An implementation that incremented a counter per arrival would read 2 here.
    timelines.getState().dispatchFor('a', { type: 'assistantDelta', turnId: 't1', seq: 2, text: 'llo' })
    expect(countFor('a')).toBe(1)
    expect(markFor('a')).toBe(countFor('a'))
  })

  it('leaves a background conversation entirely unmarked (#777 AC4)', () => {
    const { timelines, markFor } = wire('a')

    timelines.getState().dispatchFor('b', { type: 'userText', text: 'not on screen' })

    // ABSENT, not a mark of `0` — 'b' has never been read and must keep reading that way.
    expect(markFor('b')).toBeNull()
    // 'a' holds no slice at all, so its own honest count is 0 and that is what it is stamped with.
    expect(markFor('a')).toBe(0)
  })

  it('mints nothing at all while no conversation is open (#777 AC4)', () => {
    const { timelines, markFor } = wire(null)

    timelines.getState().dispatchFor('b', { type: 'userText', text: 'nobody is reading' })

    expect(markFor('b')).toBeNull()
  })

  it('stops stamping once the returned handle is called', () => {
    const { timelines, lastRead, off, markFor } = wire('a')

    timelines.getState().dispatchFor('a', { type: 'userText', text: 'first' })
    expect(markFor('a')).toBe(1)

    off()
    timelines.getState().dispatchFor('a', { type: 'userText', text: 'second' })

    expect(selectLastReadFor('a')(lastRead.getState())).toBe(1)
  })
})
