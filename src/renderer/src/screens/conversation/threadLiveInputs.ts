import { selectThreadReadings, type ThreadLiveState } from '../../store/threadLiveState'
import { translateModalEvent } from '../../store/modalBridge'
import { translateQuestionEvent } from '../../store/questionBridge'
import { translateModelAnnounced } from '../../store/announcedModelBridge'
import { toRunConfigSnapshot } from './runConfigSnapshot'
import type { LocalSendPending } from '../../store/threadTimeline'
import { workingIndicatorStateWithLocalSend, type ThreadStatus } from './workingIndicatorState'
import type { DaemonEvent } from '@shared/ipc/events'

type Reading<T extends DaemonEvent['type']> = Extract<DaemonEvent, { type: T }>
export interface ThreadLiveInputs {
  sessionId: string | null
  status: ThreadStatus
  indicator: ReturnType<typeof workingIndicatorStateWithLocalSend>
  thinkingTokens: number | null
  runConfig: ReturnType<typeof toRunConfigSnapshot>
  announcedModel: ReturnType<typeof translateModelAnnounced>
  permissions: Extract<NonNullable<ReturnType<typeof translateModalEvent>>, { type: 'shown' }>[]
  questions: Extract<NonNullable<ReturnType<typeof translateQuestionEvent>>, { type: 'shown' }>[]
  activity: { turnRunning: boolean; stalled: boolean; apiRetrying: boolean; compacting: boolean; resetting: boolean }
  hasOutstanding: boolean
  toolProgress: Reading<'toolProgress'>[]
  taskProgress: Reading<'backgroundTaskProgress'>[]
  rateLimit: Reading<'rateLimited'> | null
  contextUsage: Reading<'contextUsage'> | null
  sessionFacts: Reading<'sessionFacts'> | null
  settingsUpdated: Reading<'sessionSettingsUpdated'> | null
  mcpStatus: Reading<'mcpStatus'> | null
  slashCommands: Reading<'slashCommandList'> | null
  modelList: Reading<'modelList'> | null
  suggestion: Reading<'replySuggestion'> | null
  sessionError: Reading<'sessionError'> | null
}

/** Existing view inputs; caller-owned queue, account and connection state stays outside this adapter. */
export function threadLiveInputs(state: ThreadLiveState, localSendPending: LocalSendPending | null = null): ThreadLiveInputs {
  const phase = selectThreadReadings(state, 'turnState')[0]?.state ?? 'idle'
  const retry = selectThreadReadings(state, 'apiRetry')[0]
  const reset = selectThreadReadings(state, 'resetting')[0]
  const status: ThreadStatus = {
    phase, apiRetry: retry?.active ? { current: retry.current, total: retry.total } : null,
    compacting: selectThreadReadings(state, 'compacting')[0]?.active ?? false,
    stalled: selectThreadReadings(state, 'stallDetected').length > 0,
    resetting: reset?.active ? { phase: reset.phase, handoff: reset.handoff } : null
  }
  const permissions = selectThreadReadings(state, 'modalShown').flatMap(event => {
    const shown = translateModalEvent(event, () => new Set())
    return shown?.type === 'shown' ? [shown] : []
  })
  const questions = selectThreadReadings(state, 'questionShown').flatMap(event => {
    const shown = translateQuestionEvent(event)
    return shown?.type === 'shown' ? [shown] : []
  })
  const settings = selectThreadReadings(state, 'runConfigReceived')[0]
  const model = selectThreadReadings(state, 'modelAnnounced')[0]
  return {
    sessionId: state.binding?.sessionId ?? null, status,
    indicator: workingIndicatorStateWithLocalSend(status, localSendPending),
    thinkingTokens: selectThreadReadings(state, 'thinkingProgress')[0]?.estimatedTokens ?? null,
    runConfig: settings ? toRunConfigSnapshot(settings) : null,
    announcedModel: model ? translateModelAnnounced(model) : null,
    permissions, questions,
    activity: { turnRunning: phase !== 'idle', stalled: status.stalled, apiRetrying: status.apiRetry !== null,
      compacting: status.compacting, resetting: status.resetting !== null },
    hasOutstanding: permissions.length > 0 || questions.length > 0,
    toolProgress: selectThreadReadings(state, 'toolProgress'),
    taskProgress: selectThreadReadings(state, 'backgroundTaskProgress'),
    rateLimit: selectThreadReadings(state, 'rateLimited')[0] ?? null,
    contextUsage: selectThreadReadings(state, 'contextUsage')[0] ?? null,
    sessionFacts: selectThreadReadings(state, 'sessionFacts')[0] ?? null,
    settingsUpdated: selectThreadReadings(state, 'sessionSettingsUpdated')[0] ?? null,
    mcpStatus: selectThreadReadings(state, 'mcpStatus')[0] ?? null,
    slashCommands: selectThreadReadings(state, 'slashCommandList')[0] ?? null,
    modelList: selectThreadReadings(state, 'modelList')[0] ?? null,
    suggestion: selectThreadReadings(state, 'replySuggestion')[0] ?? null,
    sessionError: selectThreadReadings(state, 'sessionError')[0] ?? null
  }
}
