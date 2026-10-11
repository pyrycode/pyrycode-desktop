import type { ThreadSnapshot } from '../../store/threadItemStore'
import type { ConnectionStatus } from '../../store/sessionStore'
import type { HeldBackgroundTaskProgress } from '../../store/backgroundTaskRosterStore'
import { backgroundTaskStopSupported, type SuppliedBackgroundTask } from './BackgroundTaskPanel'
import { taskLinked, usable } from './threadItemPresentation'

type TaskScope = { hostId: string; conversationId: string; epoch: string; session?: string; agent?: string;
  taskId: string; creatingItemId?: number }
export interface ThreadTaskInputs {
  connection?: { hostId: string; status: ConnectionStatus }
  progress?: readonly (TaskScope & { progress: HeldBackgroundTaskProgress })[]
  stops?: readonly (TaskScope & { pending: boolean; refused?: boolean })[]
  onStopTask?: (hostId: string, conversationId: string, taskId: string) => void
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const record = (v: unknown): Record<string, unknown> | null => isRecord(v) ? v : null
const text = (v: unknown): string | undefined => typeof v === 'string' ? v.slice(0, 4096) : undefined
const attribution = (v: unknown): string | undefined => typeof v === 'string' && v !== '' ? v : undefined
const key = (scope: TaskScope): string => JSON.stringify([scope.hostId, scope.conversationId, scope.epoch,
  scope.session ?? null, scope.agent ?? null, scope.taskId,
  scope.session === undefined || scope.agent === undefined ? scope.creatingItemId ?? null : null])

/** Availability belongs to the selected field and every enclosing saved record. */
function savedText(content: Record<string, unknown>, ...path: (string | number)[]): { text: string; cut: boolean } | undefined {
  let value: unknown = content, cut = false
  for (const [index, field] of path.entries()) {
    if (typeof field === 'number') {
      if (!Array.isArray(value)) return undefined
      value = value[field]
      continue
    }
    const owner = record(value)
    if (!owner) return undefined
    for (const marker of ['dropped_fields', 'truncated_fields']) {
      const fields = owner[marker]
      if (fields == null) continue
      if (!Array.isArray(fields) || !fields.every(entry => typeof entry === 'string')) return undefined
      if (!fields.includes(field) && !fields.includes(path.slice(index).join('.'))) continue
      if (marker === 'dropped_fields') return undefined
      cut = true
    }
    value = owner[field]
  }
  const displayed = text(value)
  return displayed === undefined ? undefined : { text: displayed, cut }
}

/** Item membership and lifecycle are supplied facts; live readings only decorate matching rows. */
export function threadTaskPresentations(snapshot: ThreadSnapshot, inputs: ThreadTaskInputs = {}): SuppliedBackgroundTask[] {
  const rows = new Map<string, SuppliedBackgroundTask>()
  for (const source of snapshot.items) {
    const c = record(source.content)
    if (source.shown !== true || (source.kind !== 'agent' && source.kind !== 'tool_call') || !c || !taskLinked(source)) continue
    const taskId = usable(c, 'task_id'), callId = usable(c, 'tool_use_id')
    if (taskId === undefined || callId === undefined) continue
    // Missing attribution is legal; damaged declared attribution cannot establish an identity.
    if (['session', 'agent'].some(field => source[field] != null &&
        (typeof source[field] !== 'string' || usable(source, field) === undefined)) ||
        ['session', 'agent'].some(field => Array.isArray(c.truncated_fields) && c.truncated_fields.includes(field) ||
          Array.isArray(c.dropped_fields) && c.dropped_fields.includes(field))) continue
    const session = attribution(source.session), agent = attribution(source.agent)
    const rowKey = key({ ...snapshot, session, agent, taskId, creatingItemId: source.id })
    if (rows.has(rowKey)) continue
    const active = source.active === true, status = source.status
    const labels: Record<string, string> = { running: 'Running', finished: 'Completed', failed: 'Failed', denied: 'Denied',
      stopped: 'Stopped', stopping: 'Stopping', ended_with_session: 'Ended with session', gone: 'Outcome unknown' }
    const known = typeof status === 'string' && Object.prototype.hasOwnProperty.call(labels, status)
    const link = record(c.task_link)
    const linkedIndex = Array.isArray(link?.tasks) ? link.tasks.findIndex(value => {
      const row = record(value)
      return row && usable(row, 'task_id') === taskId && usable(row, 'tool_call_id') === callId
    }) : -1
    const linkedDescription = linkedIndex >= 0 ? savedText(c, 'task_link', 'tasks', linkedIndex, 'description') :
      link && usable(link, 'task_id') === taskId && usable(link, 'tool_call_id') === callId ? savedText(c, 'task_link', 'description') : undefined
    const description = linkedDescription ?? savedText(c, 'input', 'description') ?? savedText(c, 'input', 'command') ?? savedText(c, 'input_summary')
    const fallback = text(source.summary) ?? 'Unsupported item'
    const summary = savedText(c, 'task_report', 'summary') ?? savedText(c, 'task_update', 'summary')
    const patch = savedText(c, record(c.task_update) ? 'task_update' : 'task_report', 'patch')
    const cause = status === 'ended_with_session' ? savedText(c, 'ending', 'cause') : undefined
    const outcomeLabel = known ? labels[String(status)] + (cause?.text ? ' · ' + cause.text : '') : 'Outcome unknown'
    const matches = (reading: TaskScope) => key(reading) === rowKey
    const liveProgress = active ? inputs.progress?.find(matches)?.progress : undefined
    const stop = inputs.stops?.find(matches)
    rows.set(rowKey, {
      rowKey, taskId, toolCallId: callId, taskType: source.kind === 'agent' ? 'local_agent' : 'local_bash',
      description: known && description !== undefined ? description.text : fallback,
      truncatedFields: [...(known && description?.cut ? ['description'] : []), ...(known && cause?.text && cause.cut ? ['ending.cause'] : [])],
      active, pending: stop?.pending === true && stop.refused !== true,
      canStop: active && agent === 'claude' && inputs.onStopTask !== undefined &&
        inputs.connection?.hostId === snapshot.hostId && backgroundTaskStopSupported(inputs.connection.status, agent),
      status: status === 'finished' ? 'completed' : status === 'failed' || status === 'denied' ? 'failed' :
        status === 'running' || status === 'stopping' ? null : 'stopped', outcomeLabel,
      summary: summary === undefined ? null : { text: summary.text, truncatedFields: summary.cut ? ['summary'] : null },
      latestUpdate: patch === undefined ? null : { patch: patch.text, truncatedFields: patch.cut ? ['patch'] : null },
      progress: liveProgress ? { ...liveProgress, currentActivity: liveProgress.currentActivity.slice(0, 4096),
        subagentType: liveProgress.subagentType.slice(0, 4096), lastToolName: liveProgress.lastToolName.slice(0, 4096) } : null
    })
  }
  return [...rows.values()]
}
