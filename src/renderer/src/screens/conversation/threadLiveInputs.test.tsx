import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { DaemonEvent } from '@shared/ipc/events'
import type { SessionStateFamily } from '@shared/wire/types'
import { createThreadLiveState } from '../../store/threadLiveState'
import { resolveConversationStatus } from '../../store/conversationStatus'
import { threadLiveInputs } from './threadLiveInputs'
import { ThinkingIndicator } from './ConversationScreen'
import { PermissionModalView } from './PermissionModal'
import { QuestionPanelView } from './QuestionPanel'
import { RunConfigView } from './RunConfigSections'

const readings: [SessionStateFamily, DaemonEvent][] = [
  ['turn_state', { type: 'turnState', conversationId: 'chat', state: 'thinking' }],
  ['stall', { type: 'stallDetected', conversationId: 'chat' }],
  ['api_retry', { type: 'apiRetry', conversationId: 'chat', active: true, current: 2, total: 4 }],
  ['compacting', { type: 'compacting', conversationId: 'chat', active: true }],
  ['thinking_progress', { type: 'thinkingProgress', conversationId: 'chat', estimatedTokens: 1234 }],
  ['tool_progress', { type: 'toolProgress', conversationId: 'chat', turnId: 'turn', toolUseId: 'tool', elapsedSeconds: 7 }],
  ['background_task_progress', { type: 'backgroundTaskProgress', conversationId: 'chat', taskId: 'task', currentActivity: 'Building',
    subagentType: 'general', lastToolName: 'Read', totalTokens: 12, toolUses: 2, durationMs: 10, truncatedFields: null }],
  ['resetting', { type: 'resetting', conversationId: 'chat', active: true, phase: 'wrapping_up', handoff: 'pending' }],
  ['rate_limited', { type: 'rateLimited', conversationId: 'chat', status: 'allowed_warning', limitType: 'five_hour', resetsAt: 1000 }],
  ['context_usage', { type: 'contextUsage', conversationId: 'chat', model: 'current', totalTokens: 50, maxTokens: 100, percentage: 50,
    categories: [], droppedCategories: 0, mcpTools: [], droppedMcpTools: 0, memoryFiles: [], droppedMemoryFiles: 0 }],
  ['model_announced', { type: 'modelAnnounced', conversationId: 'chat', model: 'current', truncated: false }],
  ['session_facts', { type: 'sessionFacts', conversationId: 'chat', claudeCodeVersion: '2.1', permissionMode: 'default', truncatedFields: null }],
  ['session_settings', { type: 'runConfigReceived', conversationId: 'chat', sessionId: 'payload-session', model: 'saved', effort: 'high',
    yolo: false, permissionMode: 'default', used_tokens: 30, window_tokens: 100 }],
  ['mcp_status', { type: 'mcpStatus', conversationId: 'chat', servers: [], droppedServers: 0 }],
  ['slash_command_list', { type: 'slashCommandList', conversationId: 'chat', commands: [], droppedCommands: 0 }],
  ['model_list', { type: 'modelList', conversationId: 'chat', models: [], droppedModels: 0 }],
  ['reply_suggestion', { type: 'replySuggestion', conversationId: 'chat', sessionId: 'payload-session', revision: 1, suggestedReply: 'Try this' }],
  ['session_error', { type: 'sessionError', conversationId: 'chat', code: 'session.failed' }],
  ['modal_shown', { type: 'modalShown', conversationId: 'chat', modalId: 'permission', class: 'permission', title: 'Permission',
    prompt: '<script>Run?</script>', options: [{ id: 'deny', label: 'Deny' }], defaultOptionId: 'deny' }],
  ['question_shown', { type: 'questionShown', conversationId: 'chat', questionBatchId: 'question', questions: [
    { question: 'Choose?', header: 'Choice', options: [{ label: 'First', description: '' }], multi_select: false } ] }]
]
function populated(includeError = false) {
  const store = createThreadLiveState({ sendResponse: vi.fn(), isConnected: () => true })
  store.getState().dispatch({ type: 'summary', serverId: 'host', summary: { id: 'chat', current_session_id: 'session' } })
  for (const [, event] of readings) {
    if (event.type === 'sessionError' && !includeError) continue
    const supplied = { ...event, serverId: 'host', envelopeSessionId: 'session' }
    store.getState().dispatch({ type: 'daemon', event: supplied })
  }
  return store
}

it.each(readings)('keeps %s available and clears only that family', (family, event) => {
  const store = populated(family === 'session_error')
  if (family === 'session_settings') {
    store.getState().dispatch({ type: 'daemon', event: { type: 'resetting', conversationId: 'chat', active: false, phase: '', handoff: '', serverId: 'host', envelopeSessionId: 'session' } as DaemonEvent })
    const supplied = { ...event, serverId: 'host', envelopeSessionId: 'session' }
    store.getState().dispatch({ type: 'daemon', event: supplied })
  }
  const before = store.getState().readings
  expect([...before.get(family)!.values()].some(held => held.type === event.type)).toBe(true)
  store.getState().dispatch({ type: 'request', serverId: 'host', conversationId: 'chat', requestId: 5 })
  store.getState().dispatch({ type: 'daemon', event: { type: 'sessionStateCleared', family,
    envelopeSessionId: 'session', inReplyTo: 5, serverId: 'host', correlation: { id: 6, ts: '' } } as DaemonEvent })
  const after = store.getState().readings
  expect(after.size).toBe(before.size - 1); expect(after.has(family)).toBe(false)
  for (const [otherFamily, entries] of before) if (otherFamily !== family) expect(after.get(otherFamily)).toBe(entries)
})

it('feeds existing views, status ranking and attention with no content items', () => {
  const store = populated(), input = threadLiveInputs(store.getState())
  expect(input.sessionId).toBe('session')
  expect(input.indicator).toBe('resetting')
  expect(resolveConversationStatus(input.hasOutstanding, input.activity, true)).toBe('input-required')
  const status = renderToStaticMarkup(createElement(ThinkingIndicator, { state: input.indicator, toolName: null,
    retry: input.status.apiRetry, resetting: input.status.resetting, thinkingTokens: input.thinkingTokens }))
  expect(status).toContain('Resetting: writing the handoff note')
  const sheet = renderToStaticMarkup(createElement(RunConfigView, { model: input.runConfig?.model ?? '', effort: input.runConfig?.effort,
    yolo: input.runConfig?.yolo ?? false, usedTokens: input.contextUsage?.totalTokens ?? 0, windowTokens: input.contextUsage?.maxTokens ?? 0,
    announced: input.announcedModel, models: input.modelList }))
  expect(sheet).toContain('current'); expect(sheet).toContain('50% used')
  const permission = renderToStaticMarkup(createElement(PermissionModalView, { prompt: input.permissions[0], armedOption: null,
    responseAvailable: true, sessionPermissionChecked: false, onSessionPermissionChange() {}, onActivate() {}, onCancel() {} }))
  expect(permission).toContain('&lt;script&gt;Run?&lt;/script&gt;'); expect(permission).toContain('Deny')
  const questions = renderToStaticMarkup(createElement(QuestionPanelView, { questions: input.questions[0].questions, selections: new Map(),
    canAnswer: false, responseAvailable: true, onCancel() {}, onAnswer() {}, onOptionChosen() {}, onOtherChosen() {}, onOtherTextChanged() {} }))
  expect(questions).toContain('Choose?'); expect(questions).toContain('First')
  expect(input.thinkingTokens).toBe(1234); expect(input.toolProgress[0].elapsedSeconds).toBe(7)
  expect(input.taskProgress[0].currentActivity).toBe('Building'); expect(input.rateLimit?.status).toBe('allowed_warning')
  expect(input.sessionFacts?.claudeCodeVersion).toBe('2.1'); expect(input.mcpStatus?.servers).toEqual([])
  expect(input.slashCommands?.commands).toEqual([]); expect(input.suggestion?.suggestedReply).toBe('Try this')
  expect(input.sessionError).toBeNull()
  store.getState().dispatch({ type: 'summary', serverId: 'host', summary: { id: 'chat', current_session_id: 'next' } })
  const local = { messageId: 'pending', queued: true }
  const cleared = threadLiveInputs(store.getState(), local)
  expect(cleared.indicator).toBe('waiting')
  expect(local).toEqual({ messageId: 'pending', queued: true })
  expect(resolveConversationStatus(cleared.hasOutstanding, cleared.activity, true)).toBe('new-messages')
})

it('does not surface unanswerable empty question readings', () => {
  const store = populated()
  store.getState().dispatch({ type: 'daemon', event: { type: 'questionShown', conversationId: 'chat', questionBatchId: 'empty',
    questions: [], serverId: 'host', envelopeSessionId: 'session' } as DaemonEvent })
  expect(threadLiveInputs(store.getState()).questions).toHaveLength(1)
})

it.each(['thinking', 'responding', 'idle'] as const)('clears stalls atomically on admitted %s activity', state => {
  const store = createThreadLiveState({ sendResponse: vi.fn(), isConnected: () => true })
  store.getState().dispatch({ type: 'summary', serverId: 'host', summary: { id: 'chat', current_session_id: 'B' } })
  const emit = (event: DaemonEvent, session = 'B') => {
    const supplied = { ...event, serverId: 'host', envelopeSessionId: session }
    store.getState().dispatch({ type: 'daemon', event: supplied })
  }
  emit({ type: 'stallDetected', conversationId: 'chat' })
  let input = threadLiveInputs(store.getState())
  expect(input.status.stalled).toBe(true)
  expect(input.indicator).toBe('stalled')
  expect(resolveConversationStatus(input.hasOutstanding, input.activity, false)).toBe('working')
  const retry: DaemonEvent = { type: 'apiRetry', conversationId: 'chat', active: true, current: 2, total: 4 }
  const compact: DaemonEvent = { type: 'compacting', conversationId: 'chat', active: true }
  emit(retry); emit(compact)
  const before = store.getState()
  const observed = vi.fn((next: typeof before) => threadLiveInputs(next))
  const off = store.subscribe(observed)
  const turn: DaemonEvent = { type: 'turnState', conversationId: 'chat', state }
  emit(turn, 'A')
  expect(store.getState()).toBe(before)
  expect(observed).not.toHaveBeenCalled()
  emit(turn)
  off()
  expect(observed).toHaveBeenCalledTimes(1)
  input = observed.mock.results[0].value
  expect(input.status).toMatchObject({ phase: state, stalled: false, apiRetry: { current: 2, total: 4 }, compacting: true })
  expect(input.activity).toMatchObject({ stalled: false, apiRetrying: true, compacting: true })
  expect(input.indicator).toBe('retrying')
  expect(store.getState().readings.get('api_retry')).toBe(before.readings.get('api_retry'))
  expect(store.getState().readings.get('compacting')).toBe(before.readings.get('compacting'))
  emit({ ...retry, active: false })
  expect(threadLiveInputs(store.getState()).indicator).toBe('compacting')
  emit({ ...compact, active: false })
  input = threadLiveInputs(store.getState())
  expect(input.indicator).toBe(state === 'idle' ? null : state === 'thinking' ? 'thinking' : 'working')
  expect(resolveConversationStatus(input.hasOutstanding, input.activity, false)).toBe(state === 'idle' ? 'idle' : 'working')
})

it.each(['responding', 'idle'] as const)('ends thinking progress atomically on %s and starts the next think fresh', state => {
  const store = createThreadLiveState({ sendResponse: vi.fn(), isConnected: () => true })
  store.getState().dispatch({ type: 'summary', serverId: 'host', summary: { id: 'chat', current_session_id: 'B' } })
  const emit = (event: DaemonEvent, session = 'B') => {
    const supplied = { ...event, serverId: 'host', envelopeSessionId: session }
    store.getState().dispatch({ type: 'daemon', event: supplied })
  }
  const thinking: DaemonEvent = { type: 'turnState', conversationId: 'chat', state: 'thinking' }
  emit({ type: 'thinkingProgress', conversationId: 'chat', estimatedTokens: 1234 })
  emit(thinking); emit(thinking)
  expect(threadLiveInputs(store.getState()).thinkingTokens).toBe(1234)
  const before = store.getState()
  const observed = vi.fn((next: typeof before) => threadLiveInputs(next))
  const off = store.subscribe(observed)
  const end: DaemonEvent = { type: 'turnState', conversationId: 'chat', state }
  emit(end, 'A')
  expect(store.getState()).toBe(before)
  expect(observed).not.toHaveBeenCalled()
  emit(end)
  off()
  expect(observed).toHaveBeenCalledTimes(1)
  expect(observed.mock.results[0].value).toMatchObject({ status: { phase: state }, thinkingTokens: null })
  emit({ type: 'turnState', conversationId: 'chat', state: 'idle' }); emit(thinking)
  const input = threadLiveInputs(store.getState())
  const markup = renderToStaticMarkup(createElement(ThinkingIndicator, { state: input.indicator, toolName: null,
    retry: input.status.apiRetry, resetting: input.status.resetting, thinkingTokens: input.thinkingTokens }))
  expect(input.thinkingTokens).toBeNull()
  expect(markup).toContain('Thinking…')
  expect(markup).not.toContain('tokens')
  emit({ type: 'thinkingProgress', conversationId: 'chat', estimatedTokens: 4321 }); emit(thinking)
  expect(threadLiveInputs(store.getState()).thinkingTokens).toBe(4321)
})

it.each(['thinking', 'responding', 'idle'] as const)('reconciles session errors atomically on admitted %s activity', state => {
  const store = populated(true)
  const before = store.getState()
  expect(threadLiveInputs(before).sessionError?.code).toBe('session.failed')
  const observed = vi.fn((next: typeof before) => threadLiveInputs(next))
  const off = store.subscribe(observed)
  const event = { type: 'turnState' as const, conversationId: 'chat', state, serverId: 'host', envelopeSessionId: 'old' }
  store.getState().dispatch({ type: 'daemon', event })
  expect(store.getState()).toBe(before)
  expect(observed).not.toHaveBeenCalled()
  store.getState().dispatch({ type: 'daemon', event: { ...event, envelopeSessionId: 'session' } })
  off()
  expect(observed).toHaveBeenCalledTimes(1)
  const input = observed.mock.results[0].value
  expect(input.status.phase).toBe(state)
  expect(input.activity.turnRunning).toBe(state !== 'idle')
  expect(input.sessionError).toEqual(state === 'idle' ? threadLiveInputs(before).sessionError : null)
  expect(input.hasOutstanding).toBe(true)
  expect(resolveConversationStatus(input.hasOutstanding, input.activity, false)).toBe('input-required')
  for (const [family, entries] of before.readings) {
    if (!['turn_state', 'stall', 'thinking_progress', 'session_error'].includes(family)) expect(store.getState().readings.get(family)).toBe(entries)
  }
})

it.each([null, { messageId: 'pending', queued: false }, { messageId: 'queued', queued: true }])(
  'ends stale turn feedback atomically on a current session error with local input %j', local => {
    const store = populated()
    store.getState().dispatch({ type: 'daemon', event: { type: 'resetting', conversationId: 'chat', active: false, phase: 'wrapping_up', handoff: 'pending', serverId: 'host', envelopeSessionId: 'session' } as DaemonEvent })
    const before = store.getState(), pending = local === null ? null : { ...local }
    const inputBefore = threadLiveInputs(before, local)
    expect(inputBefore).toMatchObject({ status: { phase: 'thinking', stalled: true, apiRetry: { current: 2, total: 4 }, compacting: true }, thinkingTokens: 1234 })
    expect(inputBefore.indicator).toBe('retrying')
    const observed = vi.fn((next: typeof before) => threadLiveInputs(next, local))
    const off = store.subscribe(observed)
    const error = { type: 'sessionError' as const, conversationId: 'chat', code: 'session.failed', serverId: 'host', envelopeSessionId: 'old' }
    store.getState().dispatch({ type: 'daemon', event: error })
    expect(store.getState()).toBe(before)
    expect(observed).not.toHaveBeenCalled()
    store.getState().dispatch({ type: 'daemon', event: { ...error, envelopeSessionId: 'session' } })
    off()
    expect(observed).toHaveBeenCalledTimes(1)
    const input = observed.mock.results[0].value
    expect(input).toMatchObject({ status: { phase: 'idle', stalled: false, apiRetry: null, compacting: false }, thinkingTokens: null, sessionError: { code: 'session.failed' } })
    expect(input.activity).toEqual({ turnRunning: false, stalled: false, apiRetrying: false, compacting: false, resetting: false })
    expect(input.hasOutstanding).toBe(true)
    expect(resolveConversationStatus(input.hasOutstanding, input.activity, false)).toBe('input-required')
    for (const [family, entries] of before.readings) {
      if (!['turn_state', 'stall', 'thinking_progress', 'api_retry', 'compacting'].includes(family)) expect(store.getState().readings.get(family)).toBe(entries)
    }
    store.getState().dispatch({ type: 'request', serverId: 'host', conversationId: 'chat', requestId: 5 })
    for (const family of ['modal_shown', 'question_shown'] as const) {
      store.getState().dispatch({ type: 'daemon', event: { type: 'sessionStateCleared', family, serverId: 'host', envelopeSessionId: 'session', inReplyTo: 5, correlation: { id: 6, ts: '' } } as DaemonEvent })
    }
    const ended = threadLiveInputs(store.getState(), local)
    expect(ended.indicator).toBe(local === null ? null : local.queued ? 'waiting' : 'sending')
    expect(resolveConversationStatus(ended.hasOutstanding, ended.activity, false)).toBe('idle')
    expect(ended.sessionError?.code).toBe('session.failed')
    expect(local).toEqual(pending)
  }
)
