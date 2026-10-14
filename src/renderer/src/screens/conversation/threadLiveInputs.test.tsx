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
function populated() {
  const store = createThreadLiveState({ sendResponse: vi.fn(), isConnected: () => true })
  store.getState().dispatch({ type: 'summary', serverId: 'host', summary: { id: 'chat', current_session_id: 'session' } })
  for (const [, event] of readings) {
    const supplied = { ...event, serverId: 'host', envelopeSessionId: 'session' }
    store.getState().dispatch({ type: 'daemon', event: supplied })
  }
  return store
}

it.each(readings)('keeps %s available and clears only that family', (family, event) => {
  const store = populated(), before = store.getState().readings
  expect(before.size).toBe(20)
  expect([...before.get(family)!.values()].some(held => held.type === event.type)).toBe(true)
  store.getState().dispatch({ type: 'request', serverId: 'host', conversationId: 'chat', requestId: 5 })
  store.getState().dispatch({ type: 'daemon', event: { type: 'sessionStateCleared', family,
    envelopeSessionId: 'session', inReplyTo: 5, serverId: 'host', correlation: { id: 6, ts: '' } } as DaemonEvent })
  const after = store.getState().readings
  expect(after.size).toBe(19); expect(after.has(family)).toBe(false)
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
  expect(input.sessionError?.code).toBe('session.failed')
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
