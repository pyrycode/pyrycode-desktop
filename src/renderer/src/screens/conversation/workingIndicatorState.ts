import type { ApiRetryStatus, LocalSendPending, ResettingStatus, TurnPhase } from '../../store/threadTimeline'

export interface ThreadStatus {
  phase: TurnPhase
  apiRetry: ApiRetryStatus | null
  compacting: boolean
  stalled: boolean
  resetting: ResettingStatus | null
}
export type WorkingIndicatorState = 'thinking' | 'working' | 'retrying' | 'compacting' | 'stalled' | 'resetting' | 'sending' | 'waiting'

/** Asset-free derivation shared by the runtime adapter and conversation view. */
export function workingIndicatorState(status: ThreadStatus): WorkingIndicatorState | null {
  if (status.resetting !== null) return 'resetting'
  if (status.apiRetry !== null) return 'retrying'
  if (status.compacting) return 'compacting'
  if (status.stalled) return 'stalled'
  if (status.phase === 'idle') return null
  return status.phase === 'thinking' ? 'thinking' : 'working'
}
export function workingIndicatorStateWithLocalSend(status: ThreadStatus, pending: LocalSendPending | null): WorkingIndicatorState | null {
  return workingIndicatorState(status) ?? (pending === null ? null : pending.queued ? 'waiting' : 'sending')
}
