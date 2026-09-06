import { describe, it, expect, vi } from 'vitest'
import { activateConversation, type ActivateConversationDeps } from './activateConversation'
import { createTimelineStore } from './store/timelineStore'
import { createSessionIdStore } from './store/sessionIdStore'
import { createActiveConversationStore } from './store/activeConversationStore'
import {
  MAX_RETAINED_TIMELINES,
  createConversationTimelineStore,
  selectTimelineFor
} from './store/conversationTimelineStore'
import {
  createConversationLastReadStore,
  selectLastReadFor
} from './store/conversationLastReadStore'
import { stampLastReadFor } from './store/conversationLastReadBridge'
import { initialTimelineState, type ThreadItem } from './store/threadTimeline'
import type { ConversationCreatedPayload, ConversationSummary } from '@shared/wire/types'

// activateConversation is a pure, React-free helper (the unpairAction / composerSend precedent): its
// six effects — the previous-conversation read, the two clears, the set, #777's last-read stamp and
// #786's view stamp — are injected, so the decision logic is exercised here with plain spies. The
// integration cases wire the real isolated store instances instead, proving the arguments the helper
// passes actually land where they must. No React, no DOM, no Electron bridge.
//
// #777's `stampLastRead` and #786's `markViewed` assertions are always
// `toHaveBeenCalledWith(conversation.id)` and never a bare `toHaveBeenCalled()`, deliberately:
// `clearSessionId: () => void` is assignable to the `(conversationId: string) => void` slot (TypeScript
// permits fewer parameters), so a cross-wire of those members compiles. The argument is what catches it.
//
// A `stampLastRead` ⇄ `markViewed` swap is the sharper case, because the two have IDENTICAL signatures
// and every spy-level argument assertion passes for both. What catches it is the `realDeps` cases: the
// two land in DIFFERENT stores, so a swap leaves the last-read store unmarked and the timeline store
// unpromoted, and the #777 mark tests and the #786 order tests below fail together.
//
// EVERY #786 case here drives through `activateConversation(deps, conversation)` and never calls
// `markViewed` on the store directly. The store's eviction policy is already proven at store level and
// those tests pass on `main`; what is unproven — and what each case below fails on `main` for — is that
// opening a conversation reaches that write path at all.

const conversation = (id: string): ConversationCreatedPayload => ({
  id,
  is_promoted: false,
  cwd: '/home/pyry/work',
  name: null,
  last_used_at: '2026-07-30T09:00:00Z'
})

const seededItems: readonly ThreadItem[] = [{ kind: 'userText', text: 'a message from A' }]

function spyDeps(previous: ConversationCreatedPayload | null): {
  deps: ActivateConversationDeps
  dispatchTimeline: ReturnType<typeof vi.fn>
  clearSessionId: ReturnType<typeof vi.fn>
  setActiveConversation: ReturnType<typeof vi.fn>
  stampLastRead: ReturnType<typeof vi.fn>
  markViewed: ReturnType<typeof vi.fn>
  requestConversationConfig: ReturnType<typeof vi.fn>
} {
  const dispatchTimeline = vi.fn()
  const clearSessionId = vi.fn()
  const setActiveConversation = vi.fn()
  const stampLastRead = vi.fn()
  const markViewed = vi.fn()
  const requestConversationConfig = vi.fn()
  return {
    deps: {
      getActiveConversation: () => previous,
      setActiveConversation,
      dispatchTimeline,
      clearSessionId,
      stampLastRead,
      markViewed,
      requestConversationConfig
    },
    dispatchTimeline,
    clearSessionId,
    setActiveConversation,
    stampLastRead,
    markViewed,
    requestConversationConfig
  }
}

describe('activateConversation', () => {
  it('a different id clears the timeline and the session id, then records the new conversation (AC1)', () => {
    const next = conversation('b')
    const { deps, dispatchTimeline, clearSessionId, setActiveConversation } = spyDeps(
      conversation('a')
    )

    activateConversation(deps, next)

    expect(dispatchTimeline).toHaveBeenCalledTimes(1)
    expect(dispatchTimeline).toHaveBeenCalledWith({ type: 'reset' })
    expect(clearSessionId).toHaveBeenCalledTimes(1)
    expect(setActiveConversation).toHaveBeenCalledTimes(1)
    expect(setActiveConversation).toHaveBeenCalledWith(next)
  })

  it('no previous conversation takes the clear branch — a newly created discussion starts empty (AC2)', () => {
    const next = conversation('b')
    const { deps, dispatchTimeline, clearSessionId, setActiveConversation } = spyDeps(null)

    activateConversation(deps, next)

    expect(dispatchTimeline).toHaveBeenCalledWith({ type: 'reset' })
    expect(clearSessionId).toHaveBeenCalledTimes(1)
    expect(setActiveConversation).toHaveBeenCalledWith(next)
  })

  it('the same id clears nothing but still records the fresher payload (AC3)', () => {
    // A DIFFERENT object carrying the same id — a re-click of the already-active row hands over a
    // fresher ConversationSummary, so the decision must key off `id`, not object identity.
    const next = conversation('a')
    const { deps, dispatchTimeline, clearSessionId, setActiveConversation, stampLastRead, markViewed } =
      spyDeps(conversation('a'))

    activateConversation(deps, next)

    expect(dispatchTimeline).not.toHaveBeenCalled()
    expect(clearSessionId).not.toHaveBeenCalled()
    expect(setActiveConversation).toHaveBeenCalledTimes(1)
    expect(setActiveConversation).toHaveBeenCalledWith(next)
    // #777 AC2: the stamp is the one effect that does NOT sit behind the id-change gate. A re-open of
    // the conversation already on screen is exactly when a fresh mark is owed.
    expect(stampLastRead).toHaveBeenCalledTimes(1)
    expect(stampLastRead).toHaveBeenCalledWith(next.id)
    // #786 AC1: the view stamp sits outside the gate too, and for the store's own reason — `markViewed`'s
    // already-the-tail branch is documented as the COMMON case, which only holds if a re-open reaches it.
    expect(markViewed).toHaveBeenCalledTimes(1)
    expect(markViewed).toHaveBeenCalledWith(next.id)
  })

  it('every activation asks the daemon for that conversation, switch or re-open (#1166 AC1)', () => {
    // Outside the id gate, and that placement IS the AC: "on every activation — including a re-open of
    // the chat that is already open". Both replies replace whole values, so a duplicate costs nothing.
    const switched = spyDeps(conversation('a'))
    activateConversation(switched.deps, conversation('b'))
    expect(switched.requestConversationConfig).toHaveBeenCalledTimes(1)
    expect(switched.requestConversationConfig).toHaveBeenCalledWith('b')

    const reopened = spyDeps(conversation('a'))
    activateConversation(reopened.deps, conversation('a'))
    expect(reopened.requestConversationConfig).toHaveBeenCalledTimes(1)
    expect(reopened.requestConversationConfig).toHaveBeenCalledWith('a')

    const first = spyDeps(null)
    activateConversation(first.deps, conversation('b'))
    expect(first.requestConversationConfig).toHaveBeenCalledTimes(1)
    expect(first.requestConversationConfig).toHaveBeenCalledWith('b')
  })

  it('compares against the PREVIOUS active conversation — both clears run before the set', () => {
    // The ordering constraint AC3 rests on: a re-read after the write would see 'b' === 'b' and clear
    // nothing. The real store is wired in so the read genuinely observes the write.
    const active = createActiveConversationStore({ activeConversation: conversation('a') })
    const order: string[] = []
    const deps: ActivateConversationDeps = {
      getActiveConversation: () => active.getState().activeConversation,
      setActiveConversation: (c) => {
        order.push('set')
        active.getState().setActiveConversation(c)
      },
      dispatchTimeline: () => void order.push('reset'),
      clearSessionId: () => void order.push('clearSessionId'),
      stampLastRead: () => void order.push('stamp'),
      markViewed: () => void order.push('markViewed'),
      // #1166: LAST, and the position is load-bearing. `clearSessionId` wipes the very value the reply
      // refills, so a request placed ahead of it could be answered into a store the clear then blanks.
      requestConversationConfig: () => void order.push('requestConfig')
    }

    activateConversation(deps, conversation('b'))

    expect(order).toEqual([
      'reset',
      'clearSessionId',
      'set',
      'stamp',
      'markViewed',
      'requestConfig'
    ])
    expect(active.getState().activeConversation?.id).toBe('b')
  })

  it('real stores: a switch empties the timeline and drops the daemon session id (AC1, AC4)', () => {
    const timeline = createTimelineStore({ ...initialTimelineState, items: seededItems })
    const sessionId = createSessionIdStore({ sessionId: 's1' })
    const active = createActiveConversationStore({ activeConversation: conversation('a') })
    const next = conversation('b')

    activateConversation(realDeps(timeline, sessionId, active), next)

    // toMatchObject, not toEqual: the store state object also carries `dispatch`.
    expect(timeline.getState()).toMatchObject(initialTimelineState)
    expect(timeline.getState().items).toHaveLength(0)
    expect(sessionId.getState().sessionId).toBeNull()
    expect(active.getState().activeConversation).toEqual(next)
  })

  it('real stores: re-opening the active conversation keeps its rows and its session id (AC3, AC4)', () => {
    const timeline = createTimelineStore({ ...initialTimelineState, items: seededItems })
    const sessionId = createSessionIdStore({ sessionId: 's1' })
    const active = createActiveConversationStore({ activeConversation: conversation('a') })

    activateConversation(realDeps(timeline, sessionId, active), conversation('a'))

    // By reference: a redundant reset would still churn every selectItems subscriber.
    expect(timeline.getState().items).toBe(seededItems)
    expect(sessionId.getState().sessionId).toBe('s1')
  })

  it('accepts a ConversationSummary and records it verbatim (the structural-superset seam)', () => {
    const summary: ConversationSummary = {
      id: 'b',
      name: 'Channel B',
      is_promoted: true,
      is_archived: false,
      cwd: '/home/pyry/work',
      last_message_ts: '2026-07-30T09:05:00Z',
      last_used_at: '2026-07-30T09:00:00Z'
    }
    const active = createActiveConversationStore({ activeConversation: conversation('a') })
    const timeline = createTimelineStore()
    const sessionId = createSessionIdStore()

    activateConversation(realDeps(timeline, sessionId, active), summary)

    expect(active.getState().activeConversation).toEqual(summary)
  })

  it('real stores: opening a conversation with NO held slice records a mark of 0 (#777 AC1)', () => {
    const timelines = createConversationTimelineStore()
    const lastRead = createConversationLastReadStore({ read: () => new Map(), write: () => {} })
    const deps = realDeps(
      createTimelineStore(),
      createSessionIdStore(),
      createActiveConversationStore(),
      timelines,
      lastRead
    )

    activateConversation(deps, conversation('b'))

    // `0` is a REAL, producible mark and is distinct from the absent entry that means "never read".
    expect(selectLastReadFor('b')(lastRead.getState())).toBe(0)
  })

  it("real stores: opening a conversation records its slice's own item count (#777 AC1)", () => {
    const timelines = createConversationTimelineStore()
    const lastRead = createConversationLastReadStore({ read: () => new Map(), write: () => {} })
    timelines.getState().dispatchFor('b', { type: 'userText', text: 'one' })
    timelines.getState().dispatchFor('b', { type: 'turnEnd', turnId: 't1', stopReason: 'end_turn' })
    const deps = realDeps(
      createTimelineStore(),
      createSessionIdStore(),
      createActiveConversationStore(),
      timelines,
      lastRead
    )

    activateConversation(deps, conversation('b'))

    expect(selectLastReadFor('b')(lastRead.getState())).toBe(2)
  })

  it('real stores: opening a conversation with NO retained timeline leaves a slice held (#786 AC1)', () => {
    const timelines = createConversationTimelineStore()
    const deps = realDeps(
      createTimelineStore(),
      createSessionIdStore(),
      createActiveConversationStore(),
      timelines
    )

    activateConversation(deps, conversation('b'))

    // Present and EMPTY — "observed; nothing in the thread" — not the `null` that means nothing is held.
    const slice = selectTimelineFor('b')(timelines.getState())
    expect(slice).not.toBeNull()
    expect(slice?.items).toHaveLength(0)
  })

  it('real stores: opening a RETAINED conversation moves it to the tail of the eviction order (#786 AC1)', () => {
    const timelines = createConversationTimelineStore()
    timelines.getState().dispatchFor('b', { type: 'userText', text: 'in b' })
    timelines.getState().dispatchFor('a', { type: 'userText', text: 'in a' })
    // A fold that CREATES a key inserts at the head, so the newest write leads the eviction order.
    expect([...timelines.getState().timelines.keys()]).toEqual(['a', 'b'])
    const deps = realDeps(
      createTimelineStore(),
      createSessionIdStore(),
      createActiveConversationStore(),
      timelines
    )

    activateConversation(deps, conversation('a'))

    // The criterion says "whether or not a timeline is already retained", so the assertion is the key
    // ORDER itself rather than an eviction: the opened conversation is now the most recently viewed.
    expect([...timelines.getState().timelines.keys()]).toEqual(['b', 'a'])
  })

  it('real stores: the next event for the opened conversation folds into the slice already held (#786 AC2)', () => {
    const timelines = createConversationTimelineStore()
    const deps = realDeps(
      createTimelineStore(),
      createSessionIdStore(),
      createActiveConversationStore(),
      timelines
    )

    activateConversation(deps, conversation('b'))
    expect(selectTimelineFor('b')(timelines.getState())).not.toBeNull()

    timelines.getState().dispatchFor('b', { type: 'userText', text: 'the first event for b' })

    // One slice, carrying the event — not a second one minted at the head, which is what would make the
    // conversation currently on screen the next eviction victim.
    expect(timelines.getState().timelines.size).toBe(1)
    expect(selectTimelineFor('b')(timelines.getState())?.items).toHaveLength(1)
  })

  it('real stores: re-opening the conversation already open churns no retained timeline (#786 AC3)', () => {
    const timelines = createConversationTimelineStore()
    // The active store is genuinely wired, so the second activation sees `previous?.id === 'b'`.
    const deps = realDeps(
      createTimelineStore(),
      createSessionIdStore(),
      createActiveConversationStore(),
      timelines
    )
    let notifications = 0
    const unsubscribe = timelines.subscribe(() => {
      notifications += 1
    })

    activateConversation(deps, conversation('b'))

    // The positive precondition, and the assertion that fails on `main`: opening reached the store once.
    expect(notifications).toBe(1)
    const stateAfterOpen = timelines.getState()

    activateConversation(deps, conversation('b'))
    unsubscribe()

    // Already the tail, so the state OBJECT comes straight back: no new slice, no re-ordering, and
    // zustand's `Object.is` short-circuit means no subscriber woke.
    expect(notifications).toBe(1)
    expect(timelines.getState()).toBe(stateAfterOpen)
  })

  it('real stores: at the bound, an opened chat survives a never-opened one receiving events (#786 AC4)', () => {
    const timelines = createConversationTimelineStore()
    const filled = Array.from({ length: MAX_RETAINED_TIMELINES }, (_, n) => `c${n + 1}`)
    for (const id of filled)
      timelines.getState().dispatchFor(id, { type: 'userText', text: 'background traffic' })
    // All never-viewed, so head-insert leaves the NEWEST as the standing eviction victim.
    const opened = filled[filled.length - 1]
    const neighbour = filled[filled.length - 2]
    expect([...timelines.getState().timelines.keys()][0]).toBe(opened)
    const deps = realDeps(
      createTimelineStore(),
      createSessionIdStore(),
      createActiveConversationStore(),
      timelines
    )

    activateConversation(deps, conversation(opened))
    timelines.getState().dispatchFor('cNoise', { type: 'userText', text: 'a chat never opened' })

    expect(selectTimelineFor(opened)(timelines.getState())).not.toBeNull()
    expect(selectTimelineFor(neighbour)(timelines.getState())).toBeNull()
  })
})

// The two #777/#786 stores are DEFAULTED rather than threaded through the three older call sites, which
// assert nothing about marks or about eviction order: only the cases that read them back pass their own
// instances in. `stampLastRead` is wired through the real `stampLastReadFor` and `markViewed` through the
// real store method, so what these tests exercise is the whole seam — the sampling branch included —
// rather than a spy standing in for it. The two reach DIFFERENT stores, which is what makes a cross-wire
// of the identically-typed pair fail here rather than compile silently.
function realDeps(
  timeline: ReturnType<typeof createTimelineStore>,
  sessionId: ReturnType<typeof createSessionIdStore>,
  active: ReturnType<typeof createActiveConversationStore>,
  timelines: ReturnType<typeof createConversationTimelineStore> = createConversationTimelineStore(),
  lastRead: ReturnType<typeof createConversationLastReadStore> = createConversationLastReadStore({
    read: () => new Map(),
    write: () => {}
  })
): ActivateConversationDeps {
  return {
    getActiveConversation: () => active.getState().activeConversation,
    setActiveConversation: (c) => active.getState().setActiveConversation(c),
    dispatchTimeline: (event) => timeline.getState().dispatch(event),
    clearSessionId: () => sessionId.getState().clearSessionId(),
    stampLastRead: (conversationId) =>
      stampLastReadFor(
        {
          // The activate seam deliberately never consults the open conversation — it stamps the id it
          // is handed, which is what makes it independent of whether `setActiveConversation` has run.
          getOpenConversationId: () => null,
          getTimelineFor: (id) => selectTimelineFor(id)(timelines.getState()),
          recordLastRead: (id, itemsSeen) => lastRead.getState().recordLastRead(id, itemsSeen)
        },
        conversationId
      ),
    markViewed: (conversationId) => timelines.getState().markViewed(conversationId),
    // #1166: inert in these store-level cases — they assert what the two stamps landed WHERE, and no
    // store observes the request. A cross-wire of this member with either stamp still fails them, which
    // is the defence the interface's CROSS-WIRE NOTE names.
    requestConversationConfig: () => {}
  }
}
