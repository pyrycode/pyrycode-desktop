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
import {
  createConversationLastReadStore,
  selectLastReadFor,
  type ConversationLastReadStorage,
  type LastReadMark
} from './store/conversationLastReadStore'
import {
  subscribeConversationLastRead,
  type ConversationLastReadDeps
} from './store/conversationLastReadBridge'
import { initialTimelineState, type ThreadItem } from './store/threadTimeline'
import type { ConversationCreatedPayload, MessagePayload } from '@shared/wire/types'

// clearPairingScopedState is a pure, React-free helper (the activateConversation / unpairAction /
// composerSend precedent): its seven effects are injected, so the wiring is exercised here with plain
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
  clearAllLastRead: ReturnType<typeof vi.fn>
} {
  const dispatchTimeline = vi.fn()
  const clearAllTimelines = vi.fn()
  const clearActiveConversation = vi.fn()
  const clearSessionId = vi.fn()
  const clearAnnouncedModel = vi.fn()
  const dispatchSession = vi.fn()
  const clearAllLastRead = vi.fn()
  return {
    deps: {
      dispatchTimeline,
      clearAllTimelines,
      clearActiveConversation,
      clearSessionId,
      clearAnnouncedModel,
      dispatchSession,
      clearAllLastRead
    },
    dispatchTimeline,
    clearAllTimelines,
    clearActiveConversation,
    clearSessionId,
    clearAnnouncedModel,
    dispatchSession,
    clearAllLastRead
  }
}

/** An in-memory `ConversationLastReadStorage`, so the integration cases can read back what the clear
 *  PERSISTED rather than only what it left in memory — the on-disk half of AC2, and the half that fails
 *  silently while every in-memory assertion stays green. Deliberately a closure over a mutable value, the
 *  conversationLastReadStore.test.ts fake's shape. */
function fakeLastReadStorage(seed: ReadonlyMap<string, LastReadMark> = new Map()): {
  storage: ConversationLastReadStorage
  persisted: () => ReadonlyMap<string, LastReadMark>
} {
  let value: ReadonlyMap<string, LastReadMark> = seed
  return {
    storage: {
      read: () => value,
      write: (next) => {
        value = next
      }
    },
    persisted: () => value
  }
}

describe('clearPairingScopedState', () => {
  it('performs all seven clears exactly once, with the exact reset actions (AC1, AC2)', () => {
    const {
      deps,
      dispatchTimeline,
      clearAllTimelines,
      clearActiveConversation,
      clearSessionId,
      clearAnnouncedModel,
      dispatchSession,
      clearAllLastRead
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
    expect(clearAllLastRead).toHaveBeenCalledTimes(1)
    // #779, the same nullary property as `clearAllTimelines` above: the marks clear takes no conversation
    // id at all, so no daemon-supplied id can steer which marks survive the boundary. The signature is the
    // `tsc`-side half; this is the call-side half.
    expect(clearAllLastRead).toHaveBeenCalledWith()
  })

  it('the pairing-scoped set is exactly these seven stores', () => {
    // The tripwire the no-divergence design rests on: both switch paths clear whatever this interface
    // names, so an EIGHTH pairing-scoped store added to `ClearPairingScopedStateDeps` fails to compile
    // here until it is added to the literal, and then fails this assertion until it is also asserted
    // called above — rather than being silently declared and never invoked. #779 was the seventh and
    // updated this pin, which is the intended cost of adding one; loosening it is not.
    const { deps } = spyDeps()

    expect(Object.keys(deps).sort()).toEqual([
      'clearActiveConversation',
      'clearAllLastRead',
      'clearAllTimelines',
      'clearAnnouncedModel',
      'clearSessionId',
      'dispatchSession',
      'dispatchTimeline'
    ])
  })

  it('real stores: the ended pairing leaves behind no rows, conversation id, session id, announced model or read marks (AC1, AC2)', () => {
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
    const lastReadStorage = fakeLastReadStorage(
      new Map([
        ['a1', 4],
        ['a2', 9]
      ])
    )
    const lastRead = createConversationLastReadStore(lastReadStorage.storage)

    clearPairingScopedState(
      realDeps(timeline, keyedTimelines, sessionId, announcedModel, active, session, lastRead)
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
    // #779: how far the operator read on server A goes with the pairing, in memory AND on disk. The
    // persisted half is the one that fails silently — an in-memory-only clear leaves the marks to be
    // re-hydrated at next launch, keyed under ids server B may reuse.
    expect(lastRead.getState().marks.size).toBe(0)
    expect(selectLastReadFor('a1')(lastRead.getState())).toBeNull()
    expect(selectLastReadFor('a2')(lastRead.getState())).toBeNull()
    expect(lastReadStorage.persisted().size).toBe(0)
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
    const lastReadStorage = fakeLastReadStorage()
    const lastRead = createConversationLastReadStore(lastReadStorage.storage)
    const itemsBefore = timeline.getState().items
    const keyedStateBefore = keyedTimelines.getState()
    const lastReadStateBefore = lastRead.getState()

    clearPairingScopedState(
      realDeps(timeline, keyedTimelines, sessionId, announcedModel, active, session, lastRead)
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
    // The marks store's contribution to the same claim: an empty map short-circuits on `size === 0`, the
    // state OBJECT comes straight back, and — unlike the other six clears, which have no side effect to
    // suppress — no persistence write fires.
    expect(lastRead.getState()).toBe(lastReadStateBefore)
    expect(lastReadStorage.persisted().size).toBe(0)
  })

  it('real stores: the marks clear runs AFTER the timeline clear, so the open conversation is not re-minted (AC1, AC2)', () => {
    // THE ordering case. #777's listener is subscribed to `conversationTimelineStore` for as long as
    // PairedShell is mounted, so `clearAllTimelines()` notifies it SYNCHRONOUSLY from inside the helper —
    // at a moment when `clearActiveConversation()` has not run yet. It therefore still sees 'a1' as open,
    // finds its slice already gone, and records `(a1, 0)`, PERSISTING it. Clearing the marks last wipes
    // that re-mint in memory and on disk before the helper returns; clearing them earlier leaves server
    // A's conversation id in the blob, surviving a restart, with every other assertion here still green.
    //
    // Wired without React on purpose: `vitest.config.ts` is `environment: 'node'`, so no test in this repo
    // runs the `useEffect` that mounts this listener in production, and the hazard is reachable nowhere
    // else. Neither module can see it alone — it lives between two stores and one subscription.
    const timeline = createTimelineStore()
    const keyedTimelines = createConversationTimelineStore()
    keyedTimelines.getState().dispatchFor('a1', { type: 'userText', text: 'a message on server A' })
    const sessionId = createSessionIdStore()
    const announcedModel = createAnnouncedModelStore()
    const active = createActiveConversationStore({ activeConversation: conversation })
    const session = createSessionStore()
    const lastReadStorage = fakeLastReadStorage(new Map([['a1', 1]]))
    const lastRead = createConversationLastReadStore(lastReadStorage.storage)
    const lastReadDeps: ConversationLastReadDeps = {
      getOpenConversationId: () => {
        const open = active.getState().activeConversation
        return open === null ? null : open.id
      },
      getTimelineFor: (conversationId) =>
        selectTimelineFor(conversationId)(keyedTimelines.getState()),
      recordLastRead: (conversationId, itemsSeen) =>
        lastRead.getState().recordLastRead(conversationId, itemsSeen)
    }
    const unsubscribe = subscribeConversationLastRead(
      (listener) => keyedTimelines.subscribe(listener),
      lastReadDeps
    )

    clearPairingScopedState(
      realDeps(timeline, keyedTimelines, sessionId, announcedModel, active, session, lastRead)
    )
    unsubscribe()

    expect(lastRead.getState().marks.size).toBe(0)
    expect(selectLastReadFor('a1')(lastRead.getState())).toBeNull()
    // The half that survives a restart, and the half an in-memory-only assertion would miss.
    expect(lastReadStorage.persisted().size).toBe(0)
  })
})

function realDeps(
  timeline: ReturnType<typeof createTimelineStore>,
  keyedTimelines: ReturnType<typeof createConversationTimelineStore>,
  sessionId: ReturnType<typeof createSessionIdStore>,
  announcedModel: ReturnType<typeof createAnnouncedModelStore>,
  active: ReturnType<typeof createActiveConversationStore>,
  session: ReturnType<typeof createSessionStore>,
  lastRead: ReturnType<typeof createConversationLastReadStore>
): ClearPairingScopedStateDeps {
  return {
    dispatchTimeline: (event) => timeline.getState().dispatch(event),
    clearAllTimelines: () => keyedTimelines.getState().clearAllTimelines(),
    clearActiveConversation: () => active.getState().clearActiveConversation(),
    clearSessionId: () => sessionId.getState().clearSessionId(),
    clearAnnouncedModel: () => announcedModel.getState().clearAnnouncedModel(),
    dispatchSession: (action) => session.getState().dispatch(action),
    clearAllLastRead: () => lastRead.getState().clearAllLastRead()
  }
}
