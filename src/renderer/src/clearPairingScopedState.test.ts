import { describe, it, expect, vi } from 'vitest'
import {
  clearPairingScopedState,
  type ClearPairingScopedStateDeps
} from './clearPairingScopedState'
import { createTimelineStore } from './store/timelineStore'
import { createSessionIdStore } from './store/sessionIdStore'
import { createActiveConversationStore } from './store/activeConversationStore'
import { createSessionStore, initialSessionState } from './store/sessionStore'
import { initialTimelineState, type ThreadItem } from './store/threadTimeline'
import type { ConversationCreatedPayload, MessagePayload } from '@shared/wire/types'

// clearPairingScopedState is a pure, React-free helper (the activateConversation / unpairAction /
// composerSend precedent): its four effects are injected, so the wiring is exercised here with plain
// spies. The integration cases wire the real isolated store instances instead, proving the actions the
// helper dispatches actually land where they must. No React, no DOM, no Electron bridge.

const conversation: ConversationCreatedPayload = {
  id: 'a1',
  is_promoted: false,
  cwd: '/home/pyry/work',
  name: 'Server A channel',
  last_used_at: '2026-07-30T09:00:00Z'
}

const seededItems: readonly ThreadItem[] = [{ kind: 'userText', text: 'a message on server A' }]

const seededMessages: readonly MessagePayload[] = [
  { conversation_id: 'a1', message_id: 'm1', role: 'user', text: 'hello server A' }
]

function spyDeps(): {
  deps: ClearPairingScopedStateDeps
  dispatchTimeline: ReturnType<typeof vi.fn>
  clearActiveConversation: ReturnType<typeof vi.fn>
  clearSessionId: ReturnType<typeof vi.fn>
  dispatchSession: ReturnType<typeof vi.fn>
} {
  const dispatchTimeline = vi.fn()
  const clearActiveConversation = vi.fn()
  const clearSessionId = vi.fn()
  const dispatchSession = vi.fn()
  return {
    deps: { dispatchTimeline, clearActiveConversation, clearSessionId, dispatchSession },
    dispatchTimeline,
    clearActiveConversation,
    clearSessionId,
    dispatchSession
  }
}

describe('clearPairingScopedState', () => {
  it('performs all four clears exactly once, with the exact reset actions (AC1, AC2)', () => {
    const { deps, dispatchTimeline, clearActiveConversation, clearSessionId, dispatchSession } =
      spyDeps()

    clearPairingScopedState(deps)

    expect(dispatchTimeline).toHaveBeenCalledTimes(1)
    expect(dispatchTimeline).toHaveBeenCalledWith({ type: 'reset' })
    expect(clearActiveConversation).toHaveBeenCalledTimes(1)
    expect(clearSessionId).toHaveBeenCalledTimes(1)
    expect(dispatchSession).toHaveBeenCalledTimes(1)
    expect(dispatchSession).toHaveBeenCalledWith({ type: 'reset' })
  })

  it('the pairing-scoped set is exactly these four stores', () => {
    // The tripwire the no-divergence design rests on: both switch paths clear whatever this interface
    // names, so a fifth pairing-scoped store added to `ClearPairingScopedStateDeps` fails to compile
    // here until it is added to the literal, and then fails this assertion until it is also asserted
    // called above — rather than being silently declared and never invoked.
    const { deps } = spyDeps()

    expect(Object.keys(deps).sort()).toEqual([
      'clearActiveConversation',
      'clearSessionId',
      'dispatchSession',
      'dispatchTimeline'
    ])
  })

  it('real stores: the ended pairing leaves behind no rows, conversation id or session id (AC1, AC2)', () => {
    const timeline = createTimelineStore({
      ...initialTimelineState,
      items: seededItems,
      phase: 'thinking'
    })
    const sessionId = createSessionIdStore({ sessionId: 'session-on-A' })
    const active = createActiveConversationStore({ activeConversation: conversation })
    const session = createSessionStore({
      status: {
        type: 'connected',
        ack: {
          protocol_version: '1',
          server_id: 'server-A',
          conn_id: 'c1',
          capabilities: []
        }
      },
      messages: seededMessages
    })

    clearPairingScopedState(realDeps(timeline, sessionId, active, session))

    // toMatchObject, not toEqual: the store state objects also carry dispatch / the setters.
    expect(timeline.getState()).toMatchObject(initialTimelineState)
    expect(timeline.getState().items).toHaveLength(0)
    expect(active.getState().activeConversation).toBeNull()
    expect(sessionId.getState().sessionId).toBeNull()
    expect(session.getState()).toMatchObject(initialSessionState)
  })

  it('real stores: clearing an already-clear set is a no-op, timeline items by reference', () => {
    // The idempotence the no-guard design rests on — every clear returns its shared initial* const, so
    // a redundant clear churns no subscriber (notably no selectItems re-render from a fresh []).
    const timeline = createTimelineStore()
    const sessionId = createSessionIdStore()
    const active = createActiveConversationStore()
    const session = createSessionStore()
    const itemsBefore = timeline.getState().items

    clearPairingScopedState(realDeps(timeline, sessionId, active, session))

    expect(timeline.getState()).toMatchObject(initialTimelineState)
    expect(timeline.getState().items).toBe(itemsBefore)
    expect(active.getState().activeConversation).toBeNull()
    expect(sessionId.getState().sessionId).toBeNull()
    expect(session.getState()).toMatchObject(initialSessionState)
  })
})

function realDeps(
  timeline: ReturnType<typeof createTimelineStore>,
  sessionId: ReturnType<typeof createSessionIdStore>,
  active: ReturnType<typeof createActiveConversationStore>,
  session: ReturnType<typeof createSessionStore>
): ClearPairingScopedStateDeps {
  return {
    dispatchTimeline: (event) => timeline.getState().dispatch(event),
    clearActiveConversation: () => active.getState().clearActiveConversation(),
    clearSessionId: () => sessionId.getState().clearSessionId(),
    dispatchSession: (action) => session.getState().dispatch(action)
  }
}
