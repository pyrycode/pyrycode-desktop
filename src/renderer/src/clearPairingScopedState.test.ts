import { describe, it, expect, vi } from 'vitest'
import {
  clearPairingScopedState,
  type ClearPairingScopedStateDeps
} from './clearPairingScopedState'
import { createTimelineStore } from './store/timelineStore'
import { createSessionIdStore } from './store/sessionIdStore'
import { createAnnouncedModelStore } from './store/announcedModelStore'
import { createActiveConversationStore } from './store/activeConversationStore'
import { createSessionStore, initialSessionState } from './store/sessionStore'
import { createConversationTimelineStore, selectTimelineFor } from './store/conversationTimelineStore'
import { initialTimelineState, type ThreadItem } from './store/threadTimeline'
import type { ConversationCreatedPayload, MessagePayload } from '@shared/wire/types'

// clearPairingScopedState is a pure, React-free helper (the activateConversation / unpairAction /
// composerSend precedent): its six effects are injected, so the wiring is exercised here with plain
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
  clearAllTimelines: ReturnType<typeof vi.fn>
  clearActiveConversation: ReturnType<typeof vi.fn>
  clearSessionId: ReturnType<typeof vi.fn>
  clearAnnouncedModel: ReturnType<typeof vi.fn>
  dispatchSession: ReturnType<typeof vi.fn>
} {
  const dispatchTimeline = vi.fn()
  const clearAllTimelines = vi.fn()
  const clearActiveConversation = vi.fn()
  const clearSessionId = vi.fn()
  const clearAnnouncedModel = vi.fn()
  const dispatchSession = vi.fn()
  return {
    deps: {
      dispatchTimeline,
      clearAllTimelines,
      clearActiveConversation,
      clearSessionId,
      clearAnnouncedModel,
      dispatchSession
    },
    dispatchTimeline,
    clearAllTimelines,
    clearActiveConversation,
    clearSessionId,
    clearAnnouncedModel,
    dispatchSession
  }
}

describe('clearPairingScopedState', () => {
  it('performs all six clears exactly once, with the exact reset actions (AC1, AC2)', () => {
    const {
      deps,
      dispatchTimeline,
      clearAllTimelines,
      clearActiveConversation,
      clearSessionId,
      clearAnnouncedModel,
      dispatchSession
    } = spyDeps()

    clearPairingScopedState(deps)

    expect(dispatchTimeline).toHaveBeenCalledTimes(1)
    expect(dispatchTimeline).toHaveBeenCalledWith({ type: 'reset' })
    expect(clearAllTimelines).toHaveBeenCalledTimes(1)
    // #757 AC3: the pairing-end clear takes no conversation id at all, so no daemon-supplied id can
    // steer which slices survive the boundary. The nullary signature is the `tsc`-side half of that;
    // this is the call-side half.
    expect(clearAllTimelines).toHaveBeenCalledWith()
    expect(clearActiveConversation).toHaveBeenCalledTimes(1)
    expect(clearSessionId).toHaveBeenCalledTimes(1)
    expect(clearAnnouncedModel).toHaveBeenCalledTimes(1)
    expect(dispatchSession).toHaveBeenCalledTimes(1)
    expect(dispatchSession).toHaveBeenCalledWith({ type: 'reset' })
  })

  it('the pairing-scoped set is exactly these six stores', () => {
    // The tripwire the no-divergence design rests on: both switch paths clear whatever this interface
    // names, so a seventh pairing-scoped store added to `ClearPairingScopedStateDeps` fails to compile
    // here until it is added to the literal, and then fails this assertion until it is also asserted
    // called above — rather than being silently declared and never invoked.
    const { deps } = spyDeps()

    expect(Object.keys(deps).sort()).toEqual([
      'clearActiveConversation',
      'clearAllTimelines',
      'clearAnnouncedModel',
      'clearSessionId',
      'dispatchSession',
      'dispatchTimeline'
    ])
  })

  it('real stores: the ended pairing leaves behind no rows, conversation id, session id or announced model (AC1, AC2)', () => {
    const timeline = createTimelineStore({
      ...initialTimelineState,
      items: seededItems,
      phase: 'thinking'
    })
    const keyedTimelines = createConversationTimelineStore()
    keyedTimelines.getState().dispatchFor('a1', { type: 'userText', text: 'a message on server A' })
    keyedTimelines.getState().dispatchFor('a2', { type: 'userText', text: 'another on server A' })
    const sessionId = createSessionIdStore({ sessionId: 'session-on-A' })
    const announcedModel = createAnnouncedModelStore({
      announced: { model: 'model-on-A', truncated: false }
    })
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

    clearPairingScopedState(
      realDeps(timeline, keyedTimelines, sessionId, announcedModel, active, session)
    )

    // toMatchObject, not toEqual: the store state objects also carry dispatch / the setters.
    expect(timeline.getState()).toMatchObject(initialTimelineState)
    expect(timeline.getState().items).toHaveLength(0)
    // #757 AC1: EVERY conversation's retained thread goes, not just the one that was open, and each
    // reads as absent rather than as an observed-empty slice. Conversation ids are scoped to the server
    // that issued them, so a slice surviving the boundary could be keyed under an id server B reuses.
    expect(keyedTimelines.getState().timelines.size).toBe(0)
    expect(selectTimelineFor('a1')(keyedTimelines.getState())).toBeNull()
    expect(selectTimelineFor('a2')(keyedTimelines.getState())).toBeNull()
    expect(active.getState().activeConversation).toBeNull()
    expect(sessionId.getState().sessionId).toBeNull()
    // Server A's identifier — and its `truncated` cut report with it — cannot be attributed to server B.
    expect(announcedModel.getState().announced).toBeNull()
    expect(session.getState()).toMatchObject(initialSessionState)
  })

  it('real stores: clearing an already-clear set is a no-op, timeline items by reference', () => {
    // The idempotence the no-guard design rests on — every clear returns its shared initial* const, so
    // a redundant clear churns no subscriber (notably no selectItems re-render from a fresh []). For
    // the announced model the cleared value IS the `null` sentinel, so the by-reference property is
    // structural: a selector's Object.is(null, null) short-circuits the re-render.
    const timeline = createTimelineStore()
    const keyedTimelines = createConversationTimelineStore()
    const sessionId = createSessionIdStore()
    const announcedModel = createAnnouncedModelStore()
    const active = createActiveConversationStore()
    const session = createSessionStore()
    const itemsBefore = timeline.getState().items
    const keyedStateBefore = keyedTimelines.getState()

    clearPairingScopedState(
      realDeps(timeline, keyedTimelines, sessionId, announcedModel, active, session)
    )

    expect(timeline.getState()).toMatchObject(initialTimelineState)
    expect(timeline.getState().items).toBe(itemsBefore)
    // The keyed holder's contribution to the same claim: an empty map short-circuits on `size === 0`
    // and the state OBJECT comes straight back, so zustand wakes no subscriber.
    expect(keyedTimelines.getState()).toBe(keyedStateBefore)
    expect(active.getState().activeConversation).toBeNull()
    expect(sessionId.getState().sessionId).toBeNull()
    expect(announcedModel.getState().announced).toBeNull()
    expect(session.getState()).toMatchObject(initialSessionState)
  })
})

function realDeps(
  timeline: ReturnType<typeof createTimelineStore>,
  keyedTimelines: ReturnType<typeof createConversationTimelineStore>,
  sessionId: ReturnType<typeof createSessionIdStore>,
  announcedModel: ReturnType<typeof createAnnouncedModelStore>,
  active: ReturnType<typeof createActiveConversationStore>,
  session: ReturnType<typeof createSessionStore>
): ClearPairingScopedStateDeps {
  return {
    dispatchTimeline: (event) => timeline.getState().dispatch(event),
    clearAllTimelines: () => keyedTimelines.getState().clearAllTimelines(),
    clearActiveConversation: () => active.getState().clearActiveConversation(),
    clearSessionId: () => sessionId.getState().clearSessionId(),
    clearAnnouncedModel: () => announcedModel.getState().clearAnnouncedModel(),
    dispatchSession: (action) => session.getState().dispatch(action)
  }
}
