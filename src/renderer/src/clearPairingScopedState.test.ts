import { createMcpStatusStore } from './store/mcpStatusStore'
import { createSessionFactsStore } from './store/sessionFactsStore'
import { describe, it, expect, vi } from 'vitest'
import {
  clearPairingScopedState,
  type ClearPairingScopedStateDeps
} from './clearPairingScopedState'
import { createSessionIdStore } from './store/sessionIdStore'
import { createAnnouncedModelStore } from './store/announcedModelStore'
import { createActiveConversationStore } from './store/activeConversationStore'
import { createSessionStore, initialSessionState } from './store/sessionStore'
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
import { createModalStore, selectOutstanding, selectRejections } from './store/modalStore'
import {
  createConversationActivityStore,
  selectActivityFor
} from './store/conversationActivityStore'
import { createUsageLimitStore, selectUsageLimitFor } from './store/usageLimitStore'
import {
  createReportedContextStore,
  selectReportedContextFor
} from './store/reportedContextStore'
import type {
  BackgroundTask,
  ConversationCreatedPayload,
  MessagePayload,
  QueuedItem,
  WireModelOption,
  WireSlashCommand
} from '@shared/wire/types'

const conversation: ConversationCreatedPayload = {
  id: 'a1',
  is_promoted: false,
  cwd: '/home/pyry/work',
  name: 'Server A channel',
  last_used_at: '2026-07-30T09:00:00Z',
  workspace_label: null
}

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
  clearActiveConversation: ReturnType<typeof vi.fn>
  clearSessionId: ReturnType<typeof vi.fn>
  clearSessionFacts: ReturnType<typeof vi.fn>
  clearMcpStatus: ReturnType<typeof vi.fn>
  clearAnnouncedModel: ReturnType<typeof vi.fn>
  clearAllSlashCommandLists: ReturnType<typeof vi.fn>
  clearAllModelLists: ReturnType<typeof vi.fn>
  clearAllConversations: ReturnType<typeof vi.fn>
  dispatchModal: ReturnType<typeof vi.fn>
  clearAllActivity: ReturnType<typeof vi.fn>
  clearAllUsageLimits: ReturnType<typeof vi.fn>
  clearAllReportedContext: ReturnType<typeof vi.fn>
  dispatchSession: ReturnType<typeof vi.fn>
} {
  const clearActiveConversation = vi.fn()
  const clearSessionId = vi.fn()
  const clearSessionFacts = vi.fn()
  const clearMcpStatus = vi.fn()
  const clearAnnouncedModel = vi.fn()
  const clearAllSlashCommandLists = vi.fn()
  const clearAllModelLists = vi.fn()
  const clearAllConversations = vi.fn()
  const dispatchModal = vi.fn()
  const clearAllActivity = vi.fn()
  const clearAllUsageLimits = vi.fn()
  const clearAllReportedContext = vi.fn()
  const dispatchSession = vi.fn()
  return {
    deps: {
      clearActiveConversation,
      clearSessionId,
      clearAnnouncedModel,
      clearSessionFacts,
      clearMcpStatus,
      clearAllSlashCommandLists,
      clearAllModelLists,
      clearAllConversations,
      dispatchModal,
      clearAllActivity,
      clearAllUsageLimits,
      clearAllReportedContext,
      dispatchSession,
    },
    clearActiveConversation,
    clearSessionId,
    clearAnnouncedModel,
    clearSessionFacts,
    clearMcpStatus,
    clearAllSlashCommandLists,
    clearAllModelLists,
    clearAllConversations,
    dispatchModal,
    clearAllActivity,
    clearAllUsageLimits,
    clearAllReportedContext,
    dispatchSession,
  }
}

describe('clearPairingScopedState', () => {
  it('performs every clear exactly once, with the exact reset actions (AC1, AC2)', () => {
    const {
      deps,
      clearActiveConversation,
      clearSessionId,
      clearAnnouncedModel,
      clearSessionFacts,
      clearMcpStatus,
      clearAllSlashCommandLists,
      clearAllModelLists,
      clearAllConversations,
      dispatchModal,
      clearAllActivity,
      clearAllUsageLimits,
      clearAllReportedContext,
      dispatchSession,
    } = spyDeps()

    clearPairingScopedState(deps)

    expect(clearActiveConversation).toHaveBeenCalledTimes(1)
    expect(clearSessionId).toHaveBeenCalledTimes(1)
    expect(clearSessionFacts).toHaveBeenCalledTimes(1)
    expect(clearSessionFacts).toHaveBeenCalledWith()
    expect(clearMcpStatus).toHaveBeenCalledTimes(1)
    expect(clearMcpStatus).toHaveBeenCalledWith()
    expect(clearAnnouncedModel).toHaveBeenCalledTimes(1)
    expect(clearAllSlashCommandLists).toHaveBeenCalledTimes(1)
    expect(clearAllSlashCommandLists).toHaveBeenCalledWith()
    expect(clearAllModelLists).toHaveBeenCalledTimes(1)
    expect(clearAllModelLists).toHaveBeenCalledWith()
    expect(clearAllConversations).toHaveBeenCalledTimes(1)
    expect(clearAllConversations).toHaveBeenCalledWith()
    expect(dispatchModal).toHaveBeenCalledTimes(1)
    expect(dispatchModal).toHaveBeenCalledWith({ type: 'reset' })
    expect(clearAllActivity).toHaveBeenCalledTimes(1)
    expect(clearAllActivity).toHaveBeenCalledWith()
    expect(clearAllUsageLimits).toHaveBeenCalledTimes(1)
    expect(clearAllUsageLimits).toHaveBeenCalledWith()
    expect(clearAllReportedContext).toHaveBeenCalledTimes(1)
    expect(clearAllReportedContext).toHaveBeenCalledWith()
    expect(dispatchSession).toHaveBeenCalledTimes(1)
    expect(dispatchSession).toHaveBeenCalledWith({ type: 'reset' })
  })

  it('the pairing-scoped set is exactly these stores', () => {
    const { deps } = spyDeps()

    expect(Object.keys(deps).sort()).toEqual([
      'clearActiveConversation',
      'clearAllActivity',
      'clearAllConversations',
      'clearAllModelLists',
      'clearAllReportedContext',
      'clearAllSlashCommandLists',
      'clearAllUsageLimits',
      'clearAnnouncedModel',
      'clearMcpStatus',
      'clearSessionFacts',
      'clearSessionId',
      'dispatchModal',
      'dispatchSession'
    ])
  })

  it('real stores: the ended pairing clears conversation, session, model and menus (AC1, AC2)', () => {
    const sessionId = createSessionIdStore({ sessionId: 'session-on-A' })
    const announcedModel = createAnnouncedModelStore({
      announced: new Map([['a1', { model: 'model-on-A', truncated: false }]])
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
    const slashCommands = createSlashCommandListStore()
    slashCommands
      .getState()
      .setSlashCommandList({ conversationId: 'a1', commands: [serverACommand], droppedCommands: 2 })
    slashCommands
      .getState()
      .setSlashCommandList({ conversationId: 'a2', commands: [], droppedCommands: 0 })
    const modelLists = createModelListStore()
    modelLists
      .getState()
      .setModelList({ conversationId: 'a1', models: [serverAModel], droppedModels: 3 })
    modelLists.getState().setModelList({ conversationId: 'a2', models: [], droppedModels: 0 })

    clearPairingScopedState(
      realDeps(sessionId,
        announcedModel,
        active,
        session,
        slashCommands,
        modelLists
      )
    )
    expect(active.getState().activeConversation).toBeNull()
    expect(sessionId.getState().sessionId).toBeNull()
    expect(announcedModel.getState().announced.size).toBe(0)
    expect(session.getState()).toMatchObject(initialSessionState)
    expect(slashCommands.getState().menus.size).toBe(0)
    expect(selectSlashCommandListFor('a1')(slashCommands.getState())).toBeNull()
    expect(selectSlashCommandListFor('a2')(slashCommands.getState())).toBeNull()
    expect(modelLists.getState().lists.size).toBe(0)
    expect(selectModelListFor('a1')(modelLists.getState())).toBeNull()
    expect(selectModelListFor('a2')(modelLists.getState())).toBeNull()
  })

  it('real stores: clearing an already-clear set preserves empty menu identities', () => {
    const sessionId = createSessionIdStore()
    const announcedModel = createAnnouncedModelStore()
    const active = createActiveConversationStore()
    const session = createSessionStore()
    const slashCommands = createSlashCommandListStore()
    const modelLists = createModelListStore()
    const slashCommandStateBefore = slashCommands.getState()
    const modelListStateBefore = modelLists.getState()

    clearPairingScopedState(
      realDeps(sessionId,
        announcedModel,
        active,
        session,
        slashCommands,
        modelLists,
        createConversationListStore()
      )
    )
    expect(active.getState().activeConversation).toBeNull()
    expect(sessionId.getState().sessionId).toBeNull()
    expect(announcedModel.getState().announced.size).toBe(0)
    expect(session.getState()).toMatchObject(initialSessionState)
    expect(slashCommands.getState()).toBe(slashCommandStateBefore)
    expect(modelLists.getState()).toBe(modelListStateBefore)
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
      last_used_at: '2026-09-01T12:05:00Z',
      workspace_label: null
    }
    conversations.getState().setConversations([summary], 'srv-old')
    conversations.getState().setConversations([{ ...summary, id: 'c-other' }], 'srv-other')

    clearPairingScopedState(
      realDeps(createSessionIdStore(),
        createAnnouncedModelStore(),
        createActiveConversationStore(),
        createSessionStore(),
        createSlashCommandListStore(),
        createModelListStore(),
        conversations
      )
    )
    expect(selectConversations(conversations.getState())).toBeNull()
    expect(selectConversationsFor('srv-old')(conversations.getState())).toBeNull()
    expect(selectConversationsFor('srv-other')(conversations.getState())).toBeNull()
  })

  it('real stores: no prompt, suppression entry or rejection from the ended pairing is readable, and the connected edge alone would NOT evict them (#1140 AC4)', () => {
    const modals = createModalStore()
    const prompt = (conversationId: string, modalId: string): void =>
      modals.getState().dispatch({
        type: 'shown',
        conversationId,
        modalId,
        class: 'permission',
        title: 'Allow Bash on server A?',
        prompt: 'rm -rf /srv/deploy/stale && ./deploy.sh',
        options: [
          { id: 'allow', label: 'Allow' },
          { id: 'deny', label: 'Deny' }
        ],
        defaultOptionId: 'deny'
      })

    prompt('c-listed', 'mdl-1')
    prompt('c-unlisted', 'mdl-2')
    modals.getState().dispatch({ type: 'dismissed', modalId: 'mdl-2', outcome: 'allow', source: 'local' })
    modals.getState().dispatch({ type: 'rejected', modalId: 'mdl-3' })
    const before = modals.getState()
    modals.getState().dispatch({ type: 'reconnected', conversationIds: new Set() })
    expect(selectOutstanding(modals.getState())).toBe(selectOutstanding(before))
    expect(selectOutstanding(modals.getState())).toHaveLength(1)

    clearPairingScopedState(
      realDeps(createSessionIdStore(),
        createAnnouncedModelStore(),
        createActiveConversationStore(),
        createSessionStore(),
        createSlashCommandListStore(),
        createModelListStore(),
        createConversationListStore(),
        modals
      )
    )
    expect(selectOutstanding(modals.getState())).toEqual([])
    expect(selectRejections(modals.getState())).toEqual([])
    expect(modals.getState().resolved).toEqual([])
    modals.getState().dispatch({
      type: 'shown',
      conversationId: 'c-unlisted',
      modalId: 'mdl-2',
      class: 'permission',
      title: 'Allow Bash on server B?',
      prompt: 'ls',
      options: [{ id: 'allow', label: 'Allow' }],
      defaultOptionId: 'allow'
    })
    expect(selectOutstanding(modals.getState()).map((p) => p.modalId)).toEqual(['mdl-2'])
  })

  it('real stores: no activity fact from the ended pairing is readable, and the connected edge alone would NOT evict them (#1145 AC4)', () => {
    const activity = createConversationActivityStore()
    activity.getState().setTurnRunning('c-listed', true)
    activity.getState().setApiRetrying('c-listed', true)
    activity.getState().setCompacting('c-unlisted', true)
    const before = activity.getState()
    activity.getState().resetActivityFor(new Set())
    expect(activity.getState()).toBe(before)
    expect(selectActivityFor('c-listed')(activity.getState())?.turnRunning).toBe(true)

    clearPairingScopedState(
      realDeps(createSessionIdStore(),
        createAnnouncedModelStore(),
        createActiveConversationStore(),
        createSessionStore(),
        createSlashCommandListStore(),
        createModelListStore(),
        createConversationListStore(),
        createModalStore(),
        activity
      )
    )
    expect(activity.getState().entries.size).toBe(0)
    expect(selectActivityFor('c-listed')(activity.getState())).toBeNull()
    expect(selectActivityFor('c-unlisted')(activity.getState())).toBeNull()
  })

  it('real stores: no usage-limit reading from the ended pairing is readable, and neither the expiry nor an allowed reading would have collected them (#1320 AC4)', () => {
    const usageLimits = createUsageLimitStore()
    usageLimits.getState().setUsageLimit({
      conversationId: 'c-never-expires',
      status: 'allowed_warning',
      limitType: 'seven_day',
      resetsAt: 0
    })
    usageLimits.getState().setUsageLimit({
      conversationId: 'c-dated',
      status: 'allowed_warning',
      limitType: 'five_hour',
      resetsAt: 1_800_000_000
    })
    expect(selectUsageLimitFor('c-never-expires', Number.MAX_SAFE_INTEGER)(usageLimits.getState()))
      .not.toBeNull()
    expect(selectUsageLimitFor('c-dated', 1_700_000_000)(usageLimits.getState())).not.toBeNull()

    clearPairingScopedState(
      realDeps(createSessionIdStore(),
        createAnnouncedModelStore(),
        createActiveConversationStore(),
        createSessionStore(),
        createSlashCommandListStore(),
        createModelListStore(),
        createConversationListStore(),
        createModalStore(),
        createConversationActivityStore(),
        usageLimits
      )
    )
    expect(usageLimits.getState().readings.size).toBe(0)
    expect(
      selectUsageLimitFor('c-never-expires', Number.MAX_SAFE_INTEGER)(usageLimits.getState())
    ).toBeNull()
    expect(selectUsageLimitFor('c-dated', 1_700_000_000)(usageLimits.getState())).toBeNull()
  })

  it('real stores: no context-window reading from the ended pairing is readable, and this store has no exit of its own that could have collected one (#1420 AC3)', () => {
    const reportedContext = createReportedContextStore()
    reportedContext.getState().setReportedContext({
      conversationId: 'c-ran-a-turn',
      model: 'claude-opus-5',
      totalTokens: 22_950,
      maxTokens: 200_000,
      percentage: 11,
      categories: [{ name: 'Messages', tokens: 18_000 }],
      droppedCategories: 0,
      mcpTools: [{ name: 'query', server_name: 'internal-infra', tokens: 900 }],
      droppedMcpTools: 0,
      memoryFiles: [{ path: '/Users/someone/Workspace/CLAUDE.md', type: 'project', tokens: 1200 }],
      droppedMemoryFiles: 0
    })
    reportedContext.getState().setReportedContext({
      conversationId: 'c-also-ran',
      model: '',
      totalTokens: 0,
      maxTokens: 0,
      percentage: 0,
      categories: [],
      droppedCategories: 0,
      mcpTools: [],
      droppedMcpTools: 0,
      memoryFiles: [],
      droppedMemoryFiles: 0
    })
    expect(selectReportedContextFor('c-ran-a-turn')(reportedContext.getState())).not.toBeNull()
    expect(selectReportedContextFor('c-also-ran')(reportedContext.getState())).not.toBeNull()

    clearPairingScopedState(
      realDeps(createSessionIdStore(),
        createAnnouncedModelStore(),
        createActiveConversationStore(),
        createSessionStore(),
        createSlashCommandListStore(),
        createModelListStore(),
        createConversationListStore(),
        createModalStore(),
        createConversationActivityStore(),
        createUsageLimitStore(),
        reportedContext
      )
    )
    expect(reportedContext.getState().readings.size).toBe(0)
    expect(selectReportedContextFor('c-ran-a-turn')(reportedContext.getState())).toBeNull()
    expect(selectReportedContextFor('c-also-ran')(reportedContext.getState())).toBeNull()
  })
})

function realDeps(
  sessionId: ReturnType<typeof createSessionIdStore>,
  announcedModel: ReturnType<typeof createAnnouncedModelStore>,
  active: ReturnType<typeof createActiveConversationStore>,
  session: ReturnType<typeof createSessionStore>,
  slashCommands: ReturnType<typeof createSlashCommandListStore>,
  modelLists: ReturnType<typeof createModelListStore>,
  conversations: ReturnType<typeof createConversationListStore> = createConversationListStore(),
  modals: ReturnType<typeof createModalStore> = createModalStore(),
  activity: ReturnType<typeof createConversationActivityStore> = createConversationActivityStore(),
  usageLimits: ReturnType<typeof createUsageLimitStore> = createUsageLimitStore(),
  reportedContext: ReturnType<typeof createReportedContextStore> = createReportedContextStore()
): ClearPairingScopedStateDeps {
  return {
    clearActiveConversation: () => active.getState().clearActiveConversation(),
    clearSessionId: () => sessionId.getState().clearSessionId(),
    clearAnnouncedModel: () => announcedModel.getState().clearAnnouncedModel(),
    clearSessionFacts: () => {},
    clearMcpStatus: () => {},
    clearAllSlashCommandLists: () => slashCommands.getState().clearAllSlashCommandLists(),
    clearAllModelLists: () => modelLists.getState().clearAllModelLists(),
    clearAllConversations: () => conversations.getState().clearAllConversations(),
    dispatchModal: (event) => modals.getState().dispatch(event),
    clearAllActivity: () => activity.getState().clearAllActivity(),
    clearAllUsageLimits: () => usageLimits.getState().clearAllUsageLimits(),
    clearAllReportedContext: () => reportedContext.getState().clearAllReportedContext(),
    dispatchSession: (action) => session.getState().dispatch(action),
  }
}

it('pairing cleanup clears retained session facts through its dependency', () => {
  const store = createSessionFactsStore()
  store.getState().setSessionFacts({ conversationId: 'a', claudeCodeVersion: 'preview', permissionMode: 'future', truncatedFields: [] })
  const { deps } = spyDeps()
  clearPairingScopedState({ ...deps, clearSessionFacts: store.getState().clearSessionFacts })
  expect(store.getState().facts.size).toBe(0)
})

it('pairing cleanup clears retained MCP reports through its dependency', () => {
  const store = createMcpStatusStore()
  store.getState().setMcpStatus({ conversationId: 'a', servers: [], droppedServers: 0 })
  const { deps } = spyDeps()
  clearPairingScopedState({ ...deps, clearMcpStatus: store.getState().clearMcpStatus })
  expect(store.getState().reports.size).toBe(0)
})
