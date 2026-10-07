import type { StoreApi } from 'zustand/vanilla'
import { afterEach, expect, it, vi } from 'vitest'
import type { DaemonEvent, StampedDaemonEvent } from '@shared/ipc/events'
import type { WireAgent } from '@shared/wire/types'
import { agentSwitchStore, openAgentSwitch } from './agentSwitchStore'
import { subscribeAgentSwitchData } from './AgentSwitchData'
import { activeConversationStore } from './activeConversationStore'
import { conversationListStore } from './conversationListStore'
import { subscribeConversations } from './conversationListBridge'
import { sessionStore } from './sessionStore'
import { runConfigStore } from './runConfigStore'
import { runSettingsWriteStore, selectEffectiveSettings, type SettingsChange } from './runSettingsWriteStore'
import { foldWriteEvent, subscribeRunSettingsWrite } from './runSettingsWriteBridge'
import { subscribeConfirmedRunConfig } from '../screens/conversation/confirmedRunConfig'

const cleanups: (() => void)[] = []
afterEach(() => { for (const off of cleanups.splice(0).reverse()) off(); vi.unstubAllGlobals(); vi.useRealTimers() })
const fields: SettingsChange[] = [
  { field: 'model', value: 'sonnet' }, { field: 'effort', value: 'high' },
  { field: 'permissionMode', value: 'plan' }, { field: 'yolo', value: true }
]
function setup(outgoing: WireAgent = 'claude') {
  vi.useFakeTimers()
  const preserve = <T,>(store: StoreApi<T>) => {
    const old = store.getState()
    cleanups.push(() => store.setState(old))
  }
  preserve(agentSwitchStore); preserve(activeConversationStore); preserve(conversationListStore)
  preserve(sessionStore); preserve(runSettingsWriteStore); preserve(runConfigStore)
  agentSwitchStore.setState({ pane: null, dialog: null, statuses: new Map() })
  conversationListStore.getState().clearAllConversations()
  runSettingsWriteStore.getState().dispatch({ type: 'conversationSwitched' })
  runConfigStore.getState().clearSnapshot()
  const listeners = new Set<(event: StampedDaemonEvent) => void>()
  const onDaemonEvent = (fn: (event: StampedDaemonEvent) => void) => {
    listeners.add(fn); return () => { listeners.delete(fn) }
  }
  const send = vi.fn(), log = vi.fn(), rememberModel = vi.fn(), rememberEffort = vi.fn(), refresh = vi.fn()
  vi.stubGlobal('window', { pyry: { onDaemonEvent, sendCommand: send, sendDiagnostic: log } })
  const emit = (event: DaemonEvent, serverId = 'host-a') => {
    for (const listener of listeners) listener({ ...event, serverId })
  }
  const listed = (agent = outgoing, id = 'chat'): Extract<DaemonEvent, { type: 'conversationsReceived' }> => ({
    type: 'conversationsReceived', conversations: [{ id, agent, name: 'Chat', cwd: '',
      workspace_label: null, is_promoted: true, is_archived: false, last_message_ts: '', last_used_at: '' }]
  })
  cleanups.push(subscribeConversations(onDaemonEvent,
    (rows, host) => conversationListStore.getState().setConversations(rows, host), () => {}))
  for (const serverId of ['host-a', 'host-b']) sessionStore.getState().dispatch({ type: 'connected', serverId,
    ack: { protocol_version: 'v2', server_id: serverId, conn_id: 'c', capabilities: [] } })
  emit(listed())
  const pane = (conversationId = 'chat', serverId = 'host-a') => {
    activeConversationStore.getState().setActiveConversation(listed(outgoing, conversationId).conversations[0])
    agentSwitchStore.getState().dispatch({ type: 'paneChanged', pane: { conversationId, serverId } })
  }
  pane()
  // Match production ordering: write fold, live settings admission, then switch outcomes.
  cleanups.push(subscribeRunSettingsWrite(onDaemonEvent, event => foldWriteEvent({
    getPending: () => runSettingsWriteStore.getState().pending, dispatch: runSettingsWriteStore.getState().dispatch,
    rememberModel, rememberEffort
  }, event)))
  cleanups.push(subscribeConfirmedRunConfig({ onDaemonEvent,
    getContext: () => ({ conversationId: activeConversationStore.getState().activeConversation?.id ?? null,
      serverId: agentSwitchStore.getState().pane?.serverId ?? null }),
    subscribeContext: fn => agentSwitchStore.subscribe(fn), writes: runSettingsWriteStore, config: runConfigStore,
    setSessionId: () => {}, refresh, log
  }))
  cleanups.push(subscribeAgentSwitchData())
  const target: WireAgent = outgoing === 'claude' ? 'codex' : 'claude'
  const open = () => openAgentSwitch('chat', { agent: target, value: 'shared', display_name: 'Target',
    resolved_model: 'shared', effort_levels: ['low'], supports_auto_mode: false, truncated_fields: null })
  const confirm = () => agentSwitchStore.getState().dispatch({ type: 'confirm' })
  const pick = (change: SettingsChange, id: string = change.field) => runSettingsWriteStore.getState().dispatch({
    type: 'changeDispatched', changeId: id, change
  })
  const settle = (id: string, rejected = false) => emit({
    type: rejected ? 'sessionSettingsRejected' : 'sessionSettingsUpdated', changeId: id, sessionId: 'session'
  })
  const report = (model = 'shared', permissionMode = 'default', sessionId = 'session') => emit({
    type: 'runConfigReceived', conversationId: 'chat', sessionId, model, effort: 'low', effectiveEffort: 'low',
    yolo: false, permissionMode, used_tokens: 0, window_tokens: 0
  })
  const success = () => emit(listed(target))
  const effective = () => selectEffectiveSettings(runConfigStore.getState().snapshot, runSettingsWriteStore.getState())
  return { emit, listed, pane, send, log, rememberModel, rememberEffort, refresh, target,
    open, confirm, pick, settle, report, success, effective }
}

it.each(['claude', 'codex'] as const)('clears every outgoing layer only on authoritative %s switch success, including equal raw models', agent => {
  const h = setup(agent)
  h.report('shared')
  for (const change of fields) { h.pick(change); h.settle(change.field) }
  h.pick({ field: 'model', value: 'rejected' }, 'error'); h.settle('error', true)
  h.open(); h.confirm()
  h.report('shared') // Ordinary refresh must keep confirmed settings while the switch is pending.
  expect(h.effective()).toEqual({ model: 'sonnet', effort: 'high', permissionMode: 'plan', yolo: true })
  expect(runSettingsWriteStore.getState().error).toBe('model')
  // A same raw value across agents still ends the outgoing lifecycle.
  h.pick({ field: 'model', value: 'shared' }, 'equal'); h.settle('equal')
  for (const change of fields) h.pick(change, `late-${change.field}`)
  h.success()
  expect(runSettingsWriteStore.getState().confirmed).toEqual({})
  expect(runSettingsWriteStore.getState().error).toBeNull()
  expect(runSettingsWriteStore.getState().pending.size).toBe(0)
  expect(runConfigStore.getState().snapshot).toBeNull()
  expect(h.send).toHaveBeenLastCalledWith({ type: 'requestSessionSettings', payload: { conversation_id: 'chat' } })
  h.report('shared', 'acceptEdits')
  expect(h.effective()).toEqual({ model: 'shared', effort: 'low', permissionMode: 'acceptEdits', yolo: false })
  const models = h.rememberModel.mock.calls.length, efforts = h.rememberEffort.mock.calls.length
  const reads = h.refresh.mock.calls.length
  for (const change of fields) { h.settle(`late-${change.field}`); h.settle(`late-${change.field}`, true) }
  vi.advanceTimersByTime(20_000)
  expect(h.refresh).toHaveBeenCalledTimes(reads)
  expect(h.rememberModel).toHaveBeenCalledTimes(models)
  expect(h.rememberEffort).toHaveBeenCalledTimes(efforts)
  expect(runSettingsWriteStore.getState().error).toBeNull()
  expect(h.effective()).toEqual({ model: 'shared', effort: 'low', permissionMode: 'acceptEdits', yolo: false })
  for (const change of fields) { h.pick(change, `new-${change.field}`); h.settle(`new-${change.field}`) }
  expect(h.effective()).toEqual({ model: 'sonnet', effort: 'high', permissionMode: 'plan', yolo: true })
  h.report('different')
  expect(h.effective().model).toBe('sonnet')
})

it.each(['cancel', 'refused', 'removed', 'disconnected'] as const)('retains outgoing settings on %s', ending => {
  const h = setup()
  h.pick(fields[0]); h.settle('model'); h.open()
  if (ending === 'cancel') agentSwitchStore.getState().dispatch({ type: 'cancel' })
  else {
    h.confirm()
    if (ending === 'refused') h.emit({ type: 'switchAgentRejected', conversationId: 'chat', retryable: true })
    if (ending === 'removed') h.emit({ type: 'conversationsReceived', conversations: [] })
    if (ending === 'disconnected') sessionStore.getState().dispatch({ type: 'disconnected', serverId: 'host-a' })
  }
  expect(h.effective().model).toBe('sonnet')
  expect(h.send.mock.calls.filter(([e]) => e.type === 'requestSessionSettings')).toHaveLength(0)
})

it('ignores progress, replacement alone, unchanged/foreign/unrelated/unstamped lists', () => {
  const h = setup()
  for (const change of fields) { h.pick(change); h.settle(change.field) }
  h.open(); h.confirm()
  h.emit({ type: 'resetting', conversationId: 'chat', active: true, phase: 'restarting', handoff: 'pending' })
  h.emit({ type: 'sessionTransition', conversationId: 'chat', newSessionId: 'replacement', reason: 'clear', occurredAt: '', workspaceCwd: null })
  h.emit(h.listed())
  h.emit({ type: 'conversationsReceived', conversations: [...h.listed().conversations, ...h.listed('codex', 'other').conversations] })
  h.emit(h.listed('codex'), 'host-b')
  h.emit(h.listed('codex'), '')
  agentSwitchStore.getState().dispatch({ type: 'outcome', event: h.listed('codex') as StampedDaemonEvent })
  expect(runSettingsWriteStore.getState().confirmed).toEqual({ model: 'sonnet', effort: 'high', permissionMode: 'plan', yolo: true })
  h.success()
  h.report('incoming', 'default', 'replacement')
  expect(h.effective().model).toBe('incoming')
})

it.each([['other', 'host-a'], ['chat', 'host-b']])('completion after navigation cannot clear %s on %s', (id, host) => {
  const h = setup(); h.open(); h.confirm()
  h.pane(id, host)
  runSettingsWriteStore.getState().dispatch({ type: 'conversationSwitched' })
  h.pick(fields[0]); h.settle('model')
  h.pick(fields[1], 'current-pending')
  h.pick(fields[3], 'current-reject'); h.settle('current-reject', true)
  const held = runSettingsWriteStore.getState()
  h.success()
  expect(runSettingsWriteStore.getState()).toBe(held)
  expect(h.send.mock.calls.filter(([e]) => e.type === 'requestSessionSettings')).toHaveLength(0)
  expect(agentSwitchStore.getState().statuses.has('chat')).toBe(false)
})

it.each([false, true])('invalidates private permission confirmation even with no pending writes (standing error=%s)', error => {
  const h = setup(); h.report()
  h.pick(fields[2]); h.settle('permissionMode')
  if (error) { h.pick(fields[0]); h.settle('model', true) }
  expect(runSettingsWriteStore.getState().pending.size).toBe(0)
  h.open(); h.confirm(); h.success()
  expect(runSettingsWriteStore.getState().confirmed).toEqual({})
  expect(runSettingsWriteStore.getState().error).toBeNull()
  const reads = h.refresh.mock.calls.length
  h.report('incoming', 'acceptEdits')
  vi.advanceTimersByTime(20_000)
  expect(h.refresh).toHaveBeenCalledTimes(reads)
})

it('publishes an explicit agent lifetime edge even when the visible write state is empty', () => {
  const h = setup()
  const before = runSettingsWriteStore.getState()
  h.open(); h.confirm(); h.success()
  expect(runSettingsWriteStore.getState()).not.toBe(before)
  expect(runConfigStore.getState().snapshot).toBeNull()
  expect(h.send).toHaveBeenLastCalledWith({ type: 'requestSessionSettings', payload: { conversation_id: 'chat' } })
  h.pick(fields[0]); h.settle('model')
  h.success() // A repeated target-agent row with no pending attempt is not another switch.
  expect(h.effective().model).toBe('sonnet')
  expect(h.send.mock.calls.filter(([e]) => e.type === 'requestSessionSettings')).toHaveLength(1)
})

it('requests the incoming agent even when the outgoing session had a previous replacement guard', () => {
  const h = setup()
  h.emit({ type: 'sessionTransition', conversationId: 'chat', newSessionId: 'outgoing-replacement',
    reason: 'clear', occurredAt: '', workspaceCwd: null })
  h.report('sonnet', 'plan', 'outgoing-replacement')
  h.open(); h.confirm(); h.success()
  h.report('incoming', 'acceptEdits', 'incoming-session')
  expect(h.effective().model).toBe('incoming')
})
