import { describe, it, expect, vi } from 'vitest'
import { activateConversation, type ActivateConversationDeps } from './activateConversation'
import { createTimelineStore } from './store/timelineStore'
import { createSessionIdStore } from './store/sessionIdStore'
import { createActiveConversationStore } from './store/activeConversationStore'
import { initialTimelineState, type ThreadItem } from './store/threadTimeline'
import type { ConversationCreatedPayload, ConversationSummary } from '@shared/wire/types'

// activateConversation is a pure, React-free helper (the unpairAction / composerSend precedent): its
// four effects — the previous-conversation read, the two clears, and the set — are injected, so the
// decision logic is exercised here with plain spies. The integration cases wire the real isolated
// store instances instead, proving the arguments the helper passes actually land where they must.
// No React, no DOM, no Electron bridge.

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
} {
  const dispatchTimeline = vi.fn()
  const clearSessionId = vi.fn()
  const setActiveConversation = vi.fn()
  return {
    deps: {
      getActiveConversation: () => previous,
      setActiveConversation,
      dispatchTimeline,
      clearSessionId
    },
    dispatchTimeline,
    clearSessionId,
    setActiveConversation
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
    const { deps, dispatchTimeline, clearSessionId, setActiveConversation } = spyDeps(
      conversation('a')
    )

    activateConversation(deps, next)

    expect(dispatchTimeline).not.toHaveBeenCalled()
    expect(clearSessionId).not.toHaveBeenCalled()
    expect(setActiveConversation).toHaveBeenCalledTimes(1)
    expect(setActiveConversation).toHaveBeenCalledWith(next)
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
      clearSessionId: () => void order.push('clearSessionId')
    }

    activateConversation(deps, conversation('b'))

    expect(order).toEqual(['reset', 'clearSessionId', 'set'])
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
})

function realDeps(
  timeline: ReturnType<typeof createTimelineStore>,
  sessionId: ReturnType<typeof createSessionIdStore>,
  active: ReturnType<typeof createActiveConversationStore>
): ActivateConversationDeps {
  return {
    getActiveConversation: () => active.getState().activeConversation,
    setActiveConversation: (c) => active.getState().setActiveConversation(c),
    dispatchTimeline: (event) => timeline.getState().dispatch(event),
    clearSessionId: () => sessionId.getState().clearSessionId()
  }
}
