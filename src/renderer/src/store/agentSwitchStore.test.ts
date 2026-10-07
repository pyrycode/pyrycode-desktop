import { describe, expect, it, vi } from 'vitest'
import type { RendererCommand } from '@shared/ipc/commands'
import type { DaemonEvent, StampedDaemonEvent } from '@shared/ipc/events'
import type { WireAgent, WireModelOption } from '@shared/wire/types'
import { agentSwitchStore, openAgentSwitch, createAgentSwitchStore } from './agentSwitchStore'

import { conversationListStore } from './conversationListStore'
import { activeConversationStore } from './activeConversationStore'
import { sessionStore } from './sessionStore'
import { runConfigStore } from './runConfigStore'
import { runSettingsWriteStore } from './runSettingsWriteStore'
import { serverInfoStore } from './serverInfoStore'
import { subscribeConversations } from './conversationListBridge'
import { subscribeAgentSwitchData } from './AgentSwitchData'

const row = (agent?: WireAgent, value = ''): WireModelOption => ({
  agent, value, display_name: '<Model>', resolved_model: 'resolved', effort_levels: ['high'],
  supports_auto_mode: false, truncated_fields: null
})

it.each(['disconnect', 'host removal', 'conversation removal'] as const)(
  'the composed singleton isolates same-ID lists and abandons only on owning %s', teardown => {
    const oldLists = conversationListStore.getState(), oldActive = activeConversationStore.getState()
    const oldSession = sessionStore.getState(), oldServers = serverInfoStore.getState()
    const oldSwitch = agentSwitchStore.getState(), send = vi.fn()
    const listeners = new Set<(event: StampedDaemonEvent) => void>()
    const onDaemonEvent = (listener: (event: StampedDaemonEvent) => void) => {
      listeners.add(listener); return () => { listeners.delete(listener) }
    }
    const emit = (event: DaemonEvent, serverId = 'host-a') => {
      for (const listener of listeners) listener({ ...event, serverId })
    }
    vi.stubGlobal('window', { pyry: { onDaemonEvent, sendCommand: send, sendDiagnostic: vi.fn() } })
    const offs = [subscribeConversations(onDaemonEvent,
      (rows, host) => conversationListStore.getState().setConversations(rows, host), () => {}),
      subscribeAgentSwitchData()]
    try {
      for (const refused of [false, true]) {
        conversationListStore.getState().clearAllConversations()
        serverInfoStore.getState().setServers(['host-a', 'host-b'].map(serverId => ({ serverId, relayUrl: '' })))
        for (const serverId of ['host-a', 'host-b']) sessionStore.getState().dispatch({ type: 'connected', serverId,
          ack: { protocol_version: 'v2', server_id: serverId, conn_id: 'conn', capabilities: [] } })
        emit(listed('claude'))
        activeConversationStore.getState().setActiveConversation(listed('claude').conversations[0])
        agentSwitchStore.getState().dispatch({ type: 'paneChanged', pane: { serverId: 'host-a', conversationId: 'chat-a' } })
        openAgentSwitch('chat-a', row('codex'))
        agentSwitchStore.getState().dispatch({ type: 'confirm' })
        const pending = agentSwitchStore.getState().statuses.get('chat-a')
        expect(pending?.type).toBe('pending')
        emit(listed('codex'), 'host-b')
        expect(agentSwitchStore.getState().statuses.get('chat-a')).toEqual(pending)
        if (refused) emit({ type: 'switchAgentRejected', conversationId: 'chat-a', retryable: true })
        const held = refused ? { type: 'refused', serverId: 'host-a', retryable: true } : pending
        expect(agentSwitchStore.getState().statuses.get('chat-a')).toEqual(held)
        emit(listed('claude'), 'host-b')
        expect(agentSwitchStore.getState().statuses.get('chat-a')).toEqual(held)
        const abandon = (serverId: string) => {
          if (teardown === 'disconnect') sessionStore.getState().dispatch({ type: 'disconnected', serverId })
          else if (teardown === 'host removal') serverInfoStore.getState().setServers(
            serverInfoStore.getState().servers.filter(s => s.serverId !== serverId))
          else emit({ type: 'conversationsReceived', conversations: [] }, serverId)
        }
        abandon('host-b')
        expect(agentSwitchStore.getState().statuses.get('chat-a')).toEqual(held)
        abandon('host-a')
        expect(agentSwitchStore.getState().statuses.get('chat-a')).toBeUndefined()
      }
      expect(send).toHaveBeenCalledTimes(2)
    } finally {
      for (const off of offs) off()
      expect(listeners.size).toBe(0)
      conversationListStore.setState(oldLists); activeConversationStore.setState(oldActive)
      sessionStore.setState(oldSession); serverInfoStore.setState(oldServers)
      agentSwitchStore.setState(oldSwitch); vi.unstubAllGlobals()
    }
  }
)
function setup(agent: WireAgent = 'claude') {
  let binding = { serverId: 'host-a', agent, connected: true, open: true, effort: 'high' as string | null | undefined }
  let removed = false
  const commands: RendererCommand[] = []
  const store = createAgentSwitchStore({
    binding: id => !removed && id === 'chat-a' ? binding : null,
    send: command => commands.push(command), log: () => {}
  })
  const dispatch = store.getState().dispatch
  const open = (picked = row('codex')) => dispatch({ type: 'open', conversationId: 'chat-a', row: picked })
  const confirm = () => dispatch({ type: 'confirm' })
  const event = (event: DaemonEvent, serverId = 'host-a') => dispatch({ type: 'outcome', event: { ...event, serverId } })
  return { store, commands, open, confirm, dispatch, event,
    remove: () => { removed = true },
    change: (change: Partial<typeof binding>) => { binding = { ...binding, ...change } } }
}
const listed = (agent?: WireAgent, id = 'chat-a'): Extract<DaemonEvent, { type: 'conversationsReceived' }> => ({
  type: 'conversationsReceived', conversations: [{
    id, agent, name: 'A', cwd: '', workspace_label: null, is_promoted: true, is_archived: false,
    last_message_ts: '', last_used_at: ''
  }]
})
const status = (s: ReturnType<typeof setup>) => s.store.getState().statuses.get('chat-a')

describe('agent switch dispatch', () => {
  it.each([['claude', 'codex'], ['codex', undefined]] as const)('switches from %s with verbatim default model and supported effort', (outgoing, target) => {
    const s = setup(outgoing)
    s.open(row(target)); s.confirm(); s.confirm(); s.open(row(target))
    expect(status(s)?.type).toBe('pending')
    expect(s.store.getState().dialog).toBeNull()
    expect(s.commands).toEqual([{ type: 'switchAgent', payload: {
      conversation_id: 'chat-a', agent: target ?? 'claude', model: '', effort: 'high'
    } }])
  })
  it.each(['low', null, undefined])('omits unsupported/absent effort %s and preserves the picked value', effort => {
    const s = setup(); s.change({ effort }); s.open(row('codex', 'opaque')); s.confirm()
    expect(s.commands).toEqual([{ type: 'switchAgent', payload: {
      conversation_id: 'chat-a', agent: 'codex', model: 'opaque'
    } }])
  })
  it('commits pending before sending a synchronous refusal', () => {
    let store: ReturnType<typeof createAgentSwitchStore>
    store = createAgentSwitchStore({
      binding: () => ({ serverId: 'host', agent: 'claude', connected: true, open: true, effort: '' }),
      log: () => {}, send: () => {
        expect(store.getState().statuses.get('chat')?.type).toBe('pending')
        store.getState().dispatch({ type: 'outcome', event: {
          type: 'switchAgentRejected', serverId: 'host', conversationId: 'chat', retryable: false
        } })
      }
    })
    store.getState().dispatch({ type: 'open', conversationId: 'chat', row: row('codex') })
    store.getState().dispatch({ type: 'confirm' })
    expect(store.getState().statuses.get('chat')).toEqual({ type: 'refused', serverId: 'host', retryable: false })
  })
  it.each([{ connected: false }, { open: false }, { agent: 'codex' as const }, { serverId: 'host-b' }])('revalidates stale confirmation %j', change => {
    const s = setup(); s.open(); s.change(change); s.confirm()
    expect(s.commands).toEqual([]); expect(s.store.getState().dialog).toBeNull()
  })
  it('Cancel sends nothing; same-agent opening is inert', () => {
    const s = setup(); s.open(row()); expect(s.store.getState().dialog).toBeNull()
    s.open(); s.dispatch({ type: 'cancel' }); s.confirm(); expect(s.commands).toEqual([])
  })
})

describe('agent switch outcomes and lifecycle', () => {
  it('keeps pending on reset, transition and unchanged lists; only a fresh target row succeeds', () => {
    const s = setup(); s.open(); s.confirm()
    s.event({ type: 'sessionTransition', conversationId: 'chat-a', newSessionId: 'new',
      reason: 'clear', occurredAt: '', workspaceCwd: null })
    s.event(listed('claude')); expect(status(s)?.type).toBe('pending')
    s.change({ agent: 'codex' }); s.dispatch({ type: 'reconcile' })
    expect(status(s)?.type).toBe('pending')
    s.event(listed('codex')); expect(status(s)).toBeUndefined()
  })
  it('requires an actual row for success back to Claude', () => {
    const s = setup('codex'); s.open(row()); s.confirm()
    s.event(listed('codex')); expect(status(s)?.type).toBe('pending')
    s.event(listed()); expect(status(s)).toBeUndefined()
    s.change({ agent: 'codex' }); s.open(row()); s.confirm()
    s.event({ type: 'conversationsReceived', conversations: [] }); expect(status(s)).toBeUndefined()
  })
  it.each([true, false])('settles matching refusal retryable=%s without resending and clears it on opening', retryable => {
    const s = setup(); s.open(); s.confirm()
    s.event({ type: 'switchAgentRejected', conversationId: 'chat-a', retryable })
    expect(status(s)).toEqual({ type: 'refused', serverId: 'host-a', retryable })
    expect(s.commands).toHaveLength(1)
    s.open(); expect(status(s)).toBeUndefined(); expect(s.store.getState().dialog).not.toBeNull()
  })
  it('isolates host/conversation and ignores refusal with no pending', () => {
    const s = setup(); s.open(); s.confirm()
    s.event(listed('codex'), 'host-b')
    s.event({ type: 'switchAgentRejected', conversationId: 'chat-a', retryable: true }, 'host-b')
    s.event({ type: 'switchAgentRejected', conversationId: 'chat-b', retryable: true })
    s.event({ type: 'switchAgentRejected', conversationId: 'chat-a', retryable: true }, '')
    expect(status(s)?.type).toBe('pending')
    s.event(listed('codex')); s.event({ type: 'switchAgentRejected', conversationId: 'chat-a', retryable: true })
    expect(status(s)).toBeUndefined()
  })
  it('navigation cancels the dialog, but retains a confirmed switch; disconnect abandons it', () => {
    const s = setup(); s.open(); s.change({ open: false }); s.dispatch({ type: 'reconcile' })
    expect(s.store.getState().dialog).toBeNull(); expect(s.commands).toEqual([])
    s.change({ open: true }); s.open(); s.confirm()
    s.change({ open: false }); s.dispatch({ type: 'reconcile' }); expect(status(s)?.type).toBe('pending')
    s.change({ connected: false }); s.dispatch({ type: 'reconcile' }); expect(status(s)).toBeUndefined()
    expect(s.commands).toHaveLength(1)
  })
  it('conversation removal blocks confirmation and abandons pending without a result', () => {
    const s = setup(); s.open(); s.remove(); s.confirm()
    expect(s.commands).toEqual([]); expect(s.store.getState().dialog).toBeNull()
    const pending = setup(); pending.open(); pending.confirm(); pending.remove()
    pending.dispatch({ type: 'reconcile' }); expect(status(pending)).toBeUndefined()
  })
  it('pane exit closes only an unconfirmed dialog', () => {
    const s = setup(); s.open(); s.dispatch({ type: 'paneChanged', pane: null }); s.confirm()
    expect(s.commands).toEqual([])
    s.open(); s.confirm(); s.dispatch({ type: 'paneChanged', pane: null })
    expect(status(s)?.type).toBe('pending')
  })
  it('host removal abandons dialog and status only on that host', () => {
    const s = setup(); s.open(); s.dispatch({ type: 'hostRemoved', serverId: 'host-b' })
    expect(s.store.getState().dialog).not.toBeNull()
    s.dispatch({ type: 'hostRemoved', serverId: 'host-a' }); expect(s.store.getState().dialog).toBeNull()
    s.open(); s.confirm(); s.dispatch({ type: 'hostRemoved', serverId: 'host-a' })
    expect(status(s)).toBeUndefined()
  })
})


it.each(['medium', null])('the exported opening carries the composer applied effort %s, not an older saved choice', effectiveEffort => {
  const oldLists = conversationListStore.getState(), oldActive = activeConversationStore.getState()
  const oldSession = sessionStore.getState(), oldConfig = runConfigStore.getState()
  const oldWrites = runSettingsWriteStore.getState(), oldSwitch = agentSwitchStore.getState()
  const send = vi.fn()
  vi.stubGlobal('window', { pyry: { sendCommand: send, sendDiagnostic: vi.fn() } })
  try {
    const ownRow = listed('claude').conversations[0]
    conversationListStore.getState().setConversations([ownRow], 'host-a')
    activeConversationStore.getState().setActiveConversation(ownRow)
    sessionStore.setState({ statuses: new Map([['host-a', { type: 'connected', ack: {
      protocol_version: 'v2', server_id: 'host-a', conn_id: 'conn', capabilities: []
    } }]]) })
    runConfigStore.getState().setSnapshot({ model: 'old', effort: 'high', effectiveEffort,
      yolo: false, permissionMode: '', usedTokens: 0, windowTokens: 0 })
    runSettingsWriteStore.setState({ pending: new Map(), confirmed: {}, error: null })
    agentSwitchStore.getState().dispatch({ type: 'paneChanged', pane: { serverId: 'host-a', conversationId: ownRow.id } })
    openAgentSwitch(ownRow.id, { ...row('codex'), effort_levels: ['high', 'medium'] })
    agentSwitchStore.getState().dispatch({ type: 'confirm' })
    expect(send).toHaveBeenCalledWith({ type: 'switchAgent', payload: { conversation_id: ownRow.id,
      agent: 'codex', model: '', ...(effectiveEffort === null ? {} : { effort: effectiveEffort }) } })
  } finally {
    conversationListStore.setState(oldLists); activeConversationStore.setState(oldActive)
    sessionStore.setState(oldSession); runConfigStore.setState(oldConfig)
    runSettingsWriteStore.setState(oldWrites); agentSwitchStore.setState(oldSwitch); vi.unstubAllGlobals()
  }
})
