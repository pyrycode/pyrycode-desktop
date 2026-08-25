import { describe, it, expect, vi } from 'vitest'
import { exitActiveConversation, type ExitActiveConversationDeps } from './exitActiveConversation'
import { createTimelineStore } from './store/timelineStore'
import { createSessionIdStore } from './store/sessionIdStore'
import { createActiveConversationStore } from './store/activeConversationStore'
import { createConversationTimelineStore, selectTimelineFor } from './store/conversationTimelineStore'
import { initialTimelineState, type ThreadItem } from './store/threadTimeline'
import type { ConversationCreatedPayload } from '@shared/wire/types'

// exitActiveConversation is a pure, React-free helper (the activateConversation / clearPairingScopedState
// precedent): its six effects — the active-conversation read, the four clears, and the nav — are
// injected, so the decision logic is exercised here with plain spies. The integration cases wire the real
// isolated store instances instead, proving the arguments the helper passes actually land where they must.
// No React, no DOM, no Electron bridge.
//
// The PairedShell glue is NOT tested here, by the precedent PairedShell.test.tsx:7-11 states: "The
// click-driven open→thread→back transition is guaranteed by composing the separately-tested
// nextPairedRoute (pairedRoute.test.ts) with PairedShellView — exactly as App.test.tsx leaves the
// onPaired→setRoute glue to composition." AC1's route leg is `back → list`, already covered by
// pairedRoute.test.ts; its end-to-end proof is the `.conversation` 1→0 delta in the two delete e2e specs.

const conversation = (id: string): ConversationCreatedPayload => ({
  id,
  is_promoted: false,
  cwd: '/home/pyry/work',
  name: null,
  last_used_at: '2026-08-20T09:00:00Z'
})

const seededItems: readonly ThreadItem[] = [{ kind: 'userText', text: 'a message from A' }]

function spyDeps(active: ConversationCreatedPayload | null): {
  deps: ExitActiveConversationDeps
  dispatchTimeline: ReturnType<typeof vi.fn>
  clearTimelineFor: ReturnType<typeof vi.fn>
  clearActiveConversation: ReturnType<typeof vi.fn>
  clearSessionId: ReturnType<typeof vi.fn>
  navigateToList: ReturnType<typeof vi.fn>
} {
  const dispatchTimeline = vi.fn()
  const clearTimelineFor = vi.fn()
  const clearActiveConversation = vi.fn()
  const clearSessionId = vi.fn()
  const navigateToList = vi.fn()
  return {
    deps: {
      getActiveConversation: () => active,
      dispatchTimeline,
      clearTimelineFor,
      clearActiveConversation,
      clearSessionId,
      navigateToList
    },
    dispatchTimeline,
    clearTimelineFor,
    clearActiveConversation,
    clearSessionId,
    navigateToList
  }
}

describe('exitActiveConversation', () => {
  it('the open conversation clears the thread state and returns to the list (AC1, AC2, AC3)', () => {
    const {
      deps,
      dispatchTimeline,
      clearTimelineFor,
      clearActiveConversation,
      clearSessionId,
      navigateToList
    } = spyDeps(conversation('a'))

    exitActiveConversation(deps, 'a')

    expect(dispatchTimeline).toHaveBeenCalledTimes(1)
    expect(dispatchTimeline).toHaveBeenCalledWith({ type: 'reset' })
    // #757 AC2: the keyed clear names the id the helper was CALLED with, not the one read back out of
    // `getActiveConversation` — past the gate they are the same string, and the argument needs no
    // second getter call and no non-null assertion.
    expect(clearTimelineFor).toHaveBeenCalledTimes(1)
    expect(clearTimelineFor).toHaveBeenCalledWith('a')
    expect(clearActiveConversation).toHaveBeenCalledTimes(1)
    expect(clearSessionId).toHaveBeenCalledTimes(1)
    expect(navigateToList).toHaveBeenCalledTimes(1)
  })

  it('clears before navigating — no observer sees the list against the deleted thread state', () => {
    // A shared recording array rather than `invocationCallOrder`: it is the idiom the nearest sibling
    // already uses for a cross-spy ordering assertion (activateConversation.test.ts:94-107).
    const order: string[] = []
    const deps: ExitActiveConversationDeps = {
      getActiveConversation: () => conversation('a'),
      dispatchTimeline: () => void order.push('reset'),
      clearTimelineFor: () => void order.push('clearTimelineFor'),
      clearActiveConversation: () => void order.push('clearActiveConversation'),
      clearSessionId: () => void order.push('clearSessionId'),
      navigateToList: () => void order.push('navigateToList')
    }

    exitActiveConversation(deps, 'a')

    expect(order).toEqual([
      'reset',
      'clearTimelineFor',
      'clearActiveConversation',
      'clearSessionId',
      'navigateToList'
    ])
  })

  it('a confirmation naming a DIFFERENT conversation changes nothing (AC4)', () => {
    const {
      deps,
      dispatchTimeline,
      clearTimelineFor,
      clearActiveConversation,
      clearSessionId,
      navigateToList
    } = spyDeps(conversation('a'))

    exitActiveConversation(deps, 'b')

    expect(dispatchTimeline).not.toHaveBeenCalled()
    // The gate covers the keyed clear too: a late confirmation for a conversation the operator has
    // already navigated away from must not drop the slice of the one now on screen.
    expect(clearTimelineFor).not.toHaveBeenCalled()
    expect(clearActiveConversation).not.toHaveBeenCalled()
    expect(clearSessionId).not.toHaveBeenCalled()
    expect(navigateToList).not.toHaveBeenCalled()
  })

  it('no active conversation changes nothing — the degenerate mismatch arm (AC4)', () => {
    const {
      deps,
      dispatchTimeline,
      clearTimelineFor,
      clearActiveConversation,
      clearSessionId,
      navigateToList
    } = spyDeps(null)

    exitActiveConversation(deps, 'a')

    expect(dispatchTimeline).not.toHaveBeenCalled()
    expect(clearTimelineFor).not.toHaveBeenCalled()
    expect(clearActiveConversation).not.toHaveBeenCalled()
    expect(clearSessionId).not.toHaveBeenCalled()
    expect(navigateToList).not.toHaveBeenCalled()
  })

  it('real stores: the exit empties the timeline, drops the session id and the active conversation (AC2, AC3)', () => {
    const timeline = createTimelineStore({ ...initialTimelineState, items: seededItems })
    const keyedTimelines = seededKeyedTimelines()
    const sessionId = createSessionIdStore({ sessionId: 's1' })
    const active = createActiveConversationStore({ activeConversation: conversation('a') })
    const navigateToList = vi.fn()
    const bBefore = selectTimelineFor('b')(keyedTimelines.getState())

    exitActiveConversation(realDeps(timeline, keyedTimelines, sessionId, active, navigateToList), 'a')

    // toMatchObject, not toEqual: the store state object also carries `dispatch`.
    expect(timeline.getState()).toMatchObject(initialTimelineState)
    expect(timeline.getState().items).toHaveLength(0)
    // #757 AC2, end to end: the deleted conversation's slice is ABSENT — not an observed-empty one —
    // while the operator's other thread is not merely equal but the same held object it was before.
    expect(selectTimelineFor('a')(keyedTimelines.getState())).toBeNull()
    expect(selectTimelineFor('b')(keyedTimelines.getState())).toBe(bBefore)
    expect(bBefore).not.toBeNull()
    expect(sessionId.getState().sessionId).toBeNull()
    expect(active.getState().activeConversation).toBeNull()
    expect(navigateToList).toHaveBeenCalledTimes(1)
  })

  it('real stores: a mismatched id leaves the live thread and its session id intact (AC4)', () => {
    const timeline = createTimelineStore({ ...initialTimelineState, items: seededItems })
    const keyedTimelines = seededKeyedTimelines()
    const sessionId = createSessionIdStore({ sessionId: 's1' })
    const active = createActiveConversationStore({ activeConversation: conversation('a') })
    const navigateToList = vi.fn()
    const keyedStateBefore = keyedTimelines.getState()

    exitActiveConversation(realDeps(timeline, keyedTimelines, sessionId, active, navigateToList), 'b')

    // By reference: a redundant reset would still churn every selectItems subscriber.
    expect(timeline.getState().items).toBe(seededItems)
    // Same for the keyed holder — the gate returns before it is touched, so not even `b`'s own slice
    // (which the mismatched confirmation names) is dropped.
    expect(keyedTimelines.getState()).toBe(keyedStateBefore)
    expect(selectTimelineFor('b')(keyedTimelines.getState())).not.toBeNull()
    expect(sessionId.getState().sessionId).toBe('s1')
    expect(active.getState().activeConversation).toEqual(conversation('a'))
    expect(navigateToList).not.toHaveBeenCalled()
  })

  it('real stores: a duplicate delivery of the same id navigates nothing — idempotent by the gate', () => {
    const timeline = createTimelineStore({ ...initialTimelineState, items: seededItems })
    const keyedTimelines = seededKeyedTimelines()
    const sessionId = createSessionIdStore({ sessionId: 's1' })
    const active = createActiveConversationStore({ activeConversation: conversation('a') })
    const navigateToList = vi.fn()
    const deps = realDeps(timeline, keyedTimelines, sessionId, active, navigateToList)

    exitActiveConversation(deps, 'a')
    exitActiveConversation(deps, 'a')

    // The first exit cleared `activeConversation`, so the second read is `null` and fails the gate —
    // no flag, no guard.
    expect(navigateToList).toHaveBeenCalledTimes(1)
  })
})

/** Two conversations' threads held at once — the operator's open one and one he is not reading. */
function seededKeyedTimelines(): ReturnType<typeof createConversationTimelineStore> {
  const store = createConversationTimelineStore()
  store.getState().dispatchFor('a', { type: 'userText', text: 'a message from A' })
  store.getState().dispatchFor('b', { type: 'userText', text: 'a message from B' })
  return store
}

function realDeps(
  timeline: ReturnType<typeof createTimelineStore>,
  keyedTimelines: ReturnType<typeof createConversationTimelineStore>,
  sessionId: ReturnType<typeof createSessionIdStore>,
  active: ReturnType<typeof createActiveConversationStore>,
  navigateToList: () => void
): ExitActiveConversationDeps {
  return {
    getActiveConversation: () => active.getState().activeConversation,
    dispatchTimeline: (event) => timeline.getState().dispatch(event),
    clearTimelineFor: (id) => keyedTimelines.getState().clearTimelineFor(id),
    clearActiveConversation: () => active.getState().clearActiveConversation(),
    clearSessionId: () => sessionId.getState().clearSessionId(),
    navigateToList
  }
}
