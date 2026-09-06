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
import {
  createSlashCommandListStore,
  selectSlashCommandListFor
} from './store/slashCommandListStore'
import { createModelListStore, selectModelListFor } from './store/modelListStore'
import {
  createConversationListStore,
  selectConversations,
  selectConversationsFor
} from './store/conversationListStore'
import { initialTimelineState, type ThreadItem } from './store/threadTimeline'
import type {
  ConversationCreatedPayload,
  MessagePayload,
  WireModelOption,
  WireSlashCommand
} from '@shared/wire/types'

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

/** One published verb from server A's workspace. WORKSPACE-AUTHORED text — the leading underscore is
 *  deliberate (`name` is not an identifier), so nothing may key or shape-check off it. */
const serverACommand: WireSlashCommand = {
  name: '__server-a-deploy',
  argument_hint: '<target>',
  description: 'Deploy from server A’s working directory',
  aliases: [],
  truncated_fields: null
}

/** One model server A's daemon published. CLAUDE-AUTHORED text, a HIGHER trust tier than the
 *  workspace-authored verb above — and the reason a retained row is not merely stale: picking it on
 *  server B sends a model argument server B validates and rejects. */
const serverAModel: WireModelOption = {
  resolved_model: '<unmeasured>',
  value: 'opus[1m]',
  display_name: 'Opus (server A only)',
  effort_levels: ['low', 'medium', 'high'],
  supports_auto_mode: true,
  truncated_fields: null
}

function spyDeps(): {
  deps: ClearPairingScopedStateDeps
  dispatchTimeline: ReturnType<typeof vi.fn>
  clearAllTimelines: ReturnType<typeof vi.fn>
  clearActiveConversation: ReturnType<typeof vi.fn>
  clearSessionId: ReturnType<typeof vi.fn>
  clearAnnouncedModel: ReturnType<typeof vi.fn>
  clearAllSlashCommandLists: ReturnType<typeof vi.fn>
  clearAllModelLists: ReturnType<typeof vi.fn>
  clearAllConversations: ReturnType<typeof vi.fn>
  dispatchSession: ReturnType<typeof vi.fn>
  clearAllLastRead: ReturnType<typeof vi.fn>
} {
  const dispatchTimeline = vi.fn()
  const clearAllTimelines = vi.fn()
  const clearActiveConversation = vi.fn()
  const clearSessionId = vi.fn()
  const clearAnnouncedModel = vi.fn()
  const clearAllSlashCommandLists = vi.fn()
  const clearAllModelLists = vi.fn()
  const clearAllConversations = vi.fn()
  const dispatchSession = vi.fn()
  const clearAllLastRead = vi.fn()
  return {
    deps: {
      dispatchTimeline,
      clearAllTimelines,
      clearActiveConversation,
      clearSessionId,
      clearAnnouncedModel,
      clearAllSlashCommandLists,
      clearAllModelLists,
      clearAllConversations,
      dispatchSession,
      clearAllLastRead
    },
    dispatchTimeline,
    clearAllTimelines,
    clearActiveConversation,
    clearSessionId,
    clearAnnouncedModel,
    clearAllSlashCommandLists,
    clearAllModelLists,
    clearAllConversations,
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
  it('performs all ten clears exactly once, with the exact reset actions (AC1, AC2)', () => {
    const {
      deps,
      dispatchTimeline,
      clearAllTimelines,
      clearActiveConversation,
      clearSessionId,
      clearAnnouncedModel,
      clearAllSlashCommandLists,
      clearAllModelLists,
      clearAllConversations,
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
    expect(clearAllSlashCommandLists).toHaveBeenCalledTimes(1)
    // #955, the same nullary property as the two whole-map clears around it: the published menus are
    // dropped for every conversation at once, so no daemon-supplied conversation id can steer which
    // workspace's verbs survive the boundary.
    expect(clearAllSlashCommandLists).toHaveBeenCalledWith()
    expect(clearAllModelLists).toHaveBeenCalledTimes(1)
    // #977, the same nullary property as the three whole-map clears around it, and the sharpest case
    // for it: the rows are CLAUDE-AUTHORED text, so a clear taking an id would let a daemon-supplied
    // conversation id steer which machine's model menu survives the pairing boundary.
    expect(clearAllModelLists).toHaveBeenCalledWith()
    expect(clearAllConversations).toHaveBeenCalledTimes(1)
    // #1086, the same nullary property as the three whole-map clears above. It is the newest member
    // and the only one that is here because a DIFFERENT ticket removed its self-heal: keying the list
    // by server means the departed server's slot is simply never written again, so the union would go
    // on rendering its rows under the new pairing.
    expect(clearAllConversations).toHaveBeenCalledWith()
    expect(dispatchSession).toHaveBeenCalledTimes(1)
    expect(dispatchSession).toHaveBeenCalledWith({ type: 'reset' })
    expect(clearAllLastRead).toHaveBeenCalledTimes(1)
    // #779, the same nullary property as `clearAllTimelines` above: the marks clear takes no conversation
    // id at all, so no daemon-supplied id can steer which marks survive the boundary. The signature is the
    // `tsc`-side half; this is the call-side half.
    expect(clearAllLastRead).toHaveBeenCalledWith()
  })

  it('the pairing-scoped set is exactly these ten stores', () => {
    // The tripwire the no-divergence design rests on: both switch paths clear whatever this interface
    // names, so a TENTH pairing-scoped store added to `ClearPairingScopedStateDeps` fails to compile
    // here until it is added to the literal, and then fails this assertion until it is also asserted
    // called above — rather than being silently declared and never invoked. #779 was the seventh,
    // #955 the eighth, #977 the ninth and #1086 the tenth, and each updated this pin, which is the
    // intended cost of adding one; loosening it is not.
    const { deps } = spyDeps()

    expect(Object.keys(deps).sort()).toEqual([
      'clearActiveConversation',
      'clearAllConversations',
      'clearAllLastRead',
      'clearAllModelLists',
      'clearAllSlashCommandLists',
      'clearAllTimelines',
      'clearAnnouncedModel',
      'clearSessionId',
      'dispatchSession',
      'dispatchTimeline'
    ])
  })

  it('the slash-command clear runs BEFORE the one effect that can throw (#955)', () => {
    // `clearAllLastRead` is the only effect here with an external side effect and so the only one
    // that can throw. Placed last, a throw from it aborts nothing. Placed BEFORE the slash-command
    // clear, a `localStorage` throw would abort it — leaving the ended pairing's workspace-authored
    // verb menu live and readable while the operator is on the next server. Pinned by call order
    // rather than left to the reading of a comment.
    const { deps, clearAllSlashCommandLists, clearAllLastRead } = spyDeps()

    clearPairingScopedState(deps)

    expect(clearAllSlashCommandLists.mock.invocationCallOrder[0]).toBeLessThan(
      clearAllLastRead.mock.invocationCallOrder[0]
    )
  })

  it('the model-list clear runs BEFORE the one effect that can throw (#977)', () => {
    // The same constraint as the case above, for the same reason and against a higher trust tier.
    // `clearAllLastRead` is the only effect here with an external side effect (`localStorage`) and so
    // the only one that can throw; placed last, a throw from it aborts nothing. Placed BEFORE the
    // model-list clear, such a throw would abort it — leaving the ended pairing's CLAUDE-AUTHORED
    // model menu live for #975's sheet to offer, so the operator picks a row the machine they are now
    // talking to will reject. Position is otherwise free among the in-memory clears; this is the half
    // that is not, and it is pinned by call order rather than left to the reading of a comment.
    const { deps, clearAllModelLists, clearAllLastRead } = spyDeps()

    clearPairingScopedState(deps)

    expect(clearAllModelLists.mock.invocationCallOrder[0]).toBeLessThan(
      clearAllLastRead.mock.invocationCallOrder[0]
    )
  })

  it('real stores: the ended pairing leaves behind no rows, conversation id, session id, announced model, published menus or read marks (AC1, AC2)', () => {
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
      statuses: new Map(),
      messages: seededMessages
    })
    const lastReadStorage = fakeLastReadStorage(
      new Map([
        ['a1', 4],
        ['a2', 9]
      ])
    )
    const lastRead = createConversationLastReadStore(lastReadStorage.storage)
    // #955: server A published a verb menu for MORE THAN ONE conversation, which is the case a
    // per-conversation clear would half-solve — the daemon pushes a menu from every conversation's
    // `initialize` reply, including conversations the operator never opened.
    const slashCommands = createSlashCommandListStore()
    slashCommands
      .getState()
      .setSlashCommandList({ conversationId: 'a1', commands: [serverACommand], droppedCommands: 2 })
    slashCommands
      .getState()
      .setSlashCommandList({ conversationId: 'a2', commands: [], droppedCommands: 0 })
    // #977: and server A published a MODEL menu for more than one conversation too, from the same
    // `initialize` replies — including conversations the operator never opened. The empty one is
    // seeded deliberately: "claude offered nothing here" was a statement about server A, so it must
    // not survive as a statement about server B.
    const modelLists = createModelListStore()
    modelLists
      .getState()
      .setModelList({ conversationId: 'a1', models: [serverAModel], droppedModels: 3 })
    modelLists.getState().setModelList({ conversationId: 'a2', models: [], droppedModels: 0 })

    clearPairingScopedState(
      realDeps(
        timeline,
        keyedTimelines,
        sessionId,
        announcedModel,
        active,
        session,
        lastRead,
        slashCommands,
        modelLists
      )
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
    // #955: NO entry survives — not the populated menu and not the deliberately empty one, whose
    // "claude offered nothing here" was a statement about server A's working directory. Each reads
    // back as ABSENT, so #681's grey-out and #940's type-ahead see UNKNOWN rather than inheriting
    // one workspace's verbs into another.
    expect(slashCommands.getState().menus.size).toBe(0)
    expect(selectSlashCommandListFor('a1')(slashCommands.getState())).toBeNull()
    expect(selectSlashCommandListFor('a2')(slashCommands.getState())).toBeNull()
    // #977, the same claim against the higher trust tier: NO entry survives — not the populated menu
    // and not the deliberately empty one. Each reads back as ABSENT, so #975's Model rows and #976's
    // Effort segments see UNKNOWN rather than offering server A's identities against server B, where
    // picking one sends a model argument server B rejects.
    expect(modelLists.getState().lists.size).toBe(0)
    expect(selectModelListFor('a1')(modelLists.getState())).toBeNull()
    expect(selectModelListFor('a2')(modelLists.getState())).toBeNull()
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
    const slashCommands = createSlashCommandListStore()
    const modelLists = createModelListStore()
    const itemsBefore = timeline.getState().items
    const keyedStateBefore = keyedTimelines.getState()
    const lastReadStateBefore = lastRead.getState()
    const slashCommandStateBefore = slashCommands.getState()
    const modelListStateBefore = modelLists.getState()

    clearPairingScopedState(
      realDeps(
        timeline,
        keyedTimelines,
        sessionId,
        announcedModel,
        active,
        session,
        lastRead,
        slashCommands,
        modelLists
      )
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
    // #955's contribution to the same claim, and the reason its clear carries a `size === 0` guard
    // despite having no side effect to suppress: the state OBJECT comes straight back, so zustand
    // wakes no subscriber at all rather than only sparing the selectors.
    expect(slashCommands.getState()).toBe(slashCommandStateBefore)
    // #977's contribution to the same claim, and the reason its clear carries the same `size === 0`
    // guard: the state OBJECT comes straight back, so zustand wakes no subscriber at all rather than
    // only sparing the selectors.
    expect(modelLists.getState()).toBe(modelListStateBefore)
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
      realDeps(
        timeline,
        keyedTimelines,
        sessionId,
        announcedModel,
        active,
        session,
        lastRead,
        createSlashCommandListStore(),
        createModelListStore()
      )
    )
    unsubscribe()

    expect(lastRead.getState().marks.size).toBe(0)
    expect(selectLastReadFor('a1')(lastRead.getState())).toBeNull()
    // The half that survives a restart, and the half an in-memory-only assertion would miss.
    expect(lastReadStorage.persisted().size).toBe(0)
  })

  it('real stores: a departed server’s conversations cannot appear under the new pairing (#1086 AC5)', () => {
    const conversations = createConversationListStore()
    const summary = {
      id: 'c-old',
      name: 'On the machine we just left',
      is_promoted: true,
      is_archived: false,
      cwd: '/home/pyry/old',
      last_message_ts: '2026-09-01T12:00:00Z',
      last_used_at: '2026-09-01T12:05:00Z'
    }
    conversations.getState().setConversations([summary], 'srv-old')
    conversations.getState().setConversations([{ ...summary, id: 'c-other' }], 'srv-other')

    clearPairingScopedState(
      realDeps(
        createTimelineStore(),
        createConversationTimelineStore(),
        createSessionIdStore(),
        createAnnouncedModelStore(),
        createActiveConversationStore(),
        createSessionStore(),
        createConversationLastReadStore(),
        createSlashCommandListStore(),
        createModelListStore(),
        conversations
      )
    )

    // Back to not-loaded, not to a loaded-empty `[]`: the next pairing's own reply is what fills it.
    // Both servers go, because no per-server unpair exists in the renderer — the boundary is whole-app.
    expect(selectConversations(conversations.getState())).toBeNull()
    expect(selectConversationsFor('srv-old')(conversations.getState())).toBeNull()
    expect(selectConversationsFor('srv-other')(conversations.getState())).toBeNull()
  })
})

function realDeps(
  timeline: ReturnType<typeof createTimelineStore>,
  keyedTimelines: ReturnType<typeof createConversationTimelineStore>,
  sessionId: ReturnType<typeof createSessionIdStore>,
  announcedModel: ReturnType<typeof createAnnouncedModelStore>,
  active: ReturnType<typeof createActiveConversationStore>,
  session: ReturnType<typeof createSessionStore>,
  lastRead: ReturnType<typeof createConversationLastReadStore>,
  slashCommands: ReturnType<typeof createSlashCommandListStore>,
  modelLists: ReturnType<typeof createModelListStore>,
  // #1086's tenth store. Defaulted rather than threaded through every call site: only the case that
  // asserts on the conversation rows needs to hold a reference to the store being cleared.
  conversations: ReturnType<typeof createConversationListStore> = createConversationListStore()
): ClearPairingScopedStateDeps {
  return {
    dispatchTimeline: (event) => timeline.getState().dispatch(event),
    clearAllTimelines: () => keyedTimelines.getState().clearAllTimelines(),
    clearActiveConversation: () => active.getState().clearActiveConversation(),
    clearSessionId: () => sessionId.getState().clearSessionId(),
    clearAnnouncedModel: () => announcedModel.getState().clearAnnouncedModel(),
    clearAllSlashCommandLists: () => slashCommands.getState().clearAllSlashCommandLists(),
    clearAllModelLists: () => modelLists.getState().clearAllModelLists(),
    clearAllConversations: () => conversations.getState().clearAllConversations(),
    dispatchSession: (action) => session.getState().dispatch(action),
    clearAllLastRead: () => lastRead.getState().clearAllLastRead()
  }
}
