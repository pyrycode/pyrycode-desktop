import { createStore } from 'zustand/vanilla'
import type { DaemonEvent } from '@shared/ipc/events'
import type { RendererCommand } from '@shared/ipc/commands'
import type { ConversationSummary, SessionStateFamily } from '@shared/wire/types'

type Binding = { serverId: string; conversationId: string; sessionId: string | null }
type Response = Extract<RendererCommand, { type: 'answerModal' | 'cancelModal' | 'answerQuestions' | 'refuseQuestions' }>
export type ThreadLiveInput =
  | { type: 'summary'; serverId: string; summary: Pick<ConversationSummary, 'id' | 'current_session_id'> | null }
  | { type: 'daemon'; event: DaemonEvent }
  | { type: 'request'; serverId: string; conversationId: string; requestId: number }
  | { type: 'requestEnded'; requestId: number }
  | { type: 'dispose' }
export interface ThreadLiveState {
  binding: Binding | null
  readings: ReadonlyMap<SessionStateFamily, ReadonlyMap<string, DaemonEvent>>
  dispatch: (input: ThreadLiveInput) => void
  respond: (displayed: DaemonEvent, command: Response) => boolean
}
export interface ThreadLiveDeps {
  /** Supplied composition must address this host explicitly; never substitute the active host. */
  sendResponse: (serverId: string, command: Response) => void
  isConnected: (serverId: string) => boolean
  log?: { event: (fields: { event: string; code: string }) => void }
}

function familyOf(event: DaemonEvent): SessionStateFamily | null {
  switch (event.type) {
    case 'sessionStateCleared': return event.family
    case 'modalShown': case 'modalDismissed': return 'modal_shown'
    case 'questionShown': case 'questionDismissed': return 'question_shown'
    case 'turnState': return 'turn_state'
    case 'stallDetected': return 'stall'
    case 'apiRetry': return 'api_retry'
    case 'compacting': return 'compacting'
    case 'thinkingProgress': return 'thinking_progress'
    case 'toolProgress': return 'tool_progress'
    case 'backgroundTaskProgress': return 'background_task_progress'
    case 'resetting': return 'resetting'
    case 'rateLimited': return 'rate_limited'
    case 'contextUsage': return 'context_usage'
    case 'modelAnnounced': return 'model_announced'
    case 'sessionFacts': return 'session_facts'
    case 'runConfigReceived': case 'sessionSettingsUpdated': return 'session_settings'
    case 'mcpStatus': return 'mcp_status'
    case 'slashCommandList': return 'slash_command_list'
    case 'modelList': return 'model_list'
    case 'replySuggestion': return 'reply_suggestion'
    case 'sessionError': return 'session_error'
    default: return null
  }
}
function identity(event: DaemonEvent): string {
  switch (event.type) {
    case 'modalShown': case 'modalDismissed': return event.modalId
    case 'questionShown': case 'questionDismissed': return event.questionBatchId
    case 'toolProgress': return event.toolUseId
    case 'backgroundTaskProgress': return event.taskId
    default: return event.type
  }
}
const sameBinding = (a: Binding | null, b: Binding | null): boolean => a === b ||
  (a !== null && b !== null && a.serverId === b.serverId && a.conversationId === b.conversationId && a.sessionId === b.sessionId)

/** Inactive adaptation: no singleton, subscription, content reducer or queue mutation. */
export function createThreadLiveState(deps: ThreadLiveDeps) {
  return createStore<ThreadLiveState>((set, get) => {
    const requests = new Map<number, Binding>()
    let disposed = false
    const report = (code: string) => deps.log?.event({ event: 'thread-live-state', code })
    function owned(event: DaemonEvent, family: SessionStateFamily, binding: Binding): boolean {
      if ('conversationId' in event) return event.conversationId !== '' && event.conversationId === binding.conversationId
      const held = get().readings.get(family)?.get(identity(event))
      if ((event.type === 'modalDismissed' || event.type === 'questionDismissed') && held !== undefined) return true
      const request = event.inReplyTo === undefined ? undefined : requests.get(event.inReplyTo)
      return request !== undefined && sameBinding(request, binding)
    }
    function remove(family: SessionStateFamily, id?: string): void {
      const readings = new Map(get().readings)
      if (id === undefined) readings.delete(family)
      else {
        const entries = new Map(readings.get(family))
        entries.delete(id)
        if (entries.size === 0) readings.delete(family); else readings.set(family, entries)
      }
      set({ readings })
    }
    return {
      binding: null, readings: new Map(),
      dispatch(input) {
        if (disposed) return
        if (input.type === 'dispose') {
          disposed = true; requests.clear(); set({ binding: null, readings: new Map() }); report('disposed'); return
        }
        if (input.type === 'summary') {
          const summary = input.summary
          const binding = summary === null || summary.id === '' || input.serverId === '' ? null : {
            serverId: input.serverId, conversationId: summary.id, sessionId: summary.current_session_id ?? null
          }
          if (!sameBinding(get().binding, binding)) {
            requests.clear(); set({ binding, readings: new Map() }); report('binding-changed')
          }
          return
        }
        if (input.type === 'requestEnded') { requests.delete(input.requestId); return }
        const binding = get().binding
        if (input.type === 'request') {
          if (binding && input.serverId === binding.serverId && input.conversationId === binding.conversationId) requests.set(input.requestId, binding)
          return
        }
        const event = input.event
        if (event.type === 'connected' && binding && 'serverId' in event && event.serverId === binding.serverId) {
          const readings = new Map(get().readings)
          readings.delete('modal_shown'); readings.delete('question_shown'); requests.clear()
          set({ readings }); report('prompts-reconnected'); return
        }
        const family = familyOf(event)
        if (family === null) return
        if (!binding || !binding.sessionId || !('serverId' in event) || event.serverId !== binding.serverId) { report('scope-refused'); return }
        if (typeof event.envelopeSessionId !== 'string' || event.envelopeSessionId === '' || event.envelopeSessionId !== binding.sessionId) { report('provenance-refused'); return }
        if (!owned(event, family, binding)) { report('ownership-refused'); return }
        if (event.type === 'sessionStateCleared') { remove(family); report('family-cleared'); return }
        if (event.type === 'modalDismissed' || event.type === 'questionDismissed') { remove(family, identity(event)); return }
        if (event.type === 'questionShown' && event.questions.length === 0) { report('reading-ineligible'); return }
        const readings = new Map(get().readings), entries = new Map(readings.get(family))
        entries.set(identity(event), event); readings.set(family, entries); set({ readings }); report('reading-admitted')
      },
      respond(displayed, command) {
        const binding = get().binding, family = familyOf(displayed)
        if (disposed || !binding || !binding.sessionId || family === null ||
          get().readings.get(family)?.get(identity(displayed)) !== displayed || !deps.isConnected(binding.serverId)) return false
        const matches = displayed.type === 'modalShown'
          ? (command.type === 'answerModal' || command.type === 'cancelModal') && command.payload.modal_id === displayed.modalId
          : displayed.type === 'questionShown' && (command.type === 'answerQuestions' || command.type === 'refuseQuestions') && command.payload.question_batch_id === displayed.questionBatchId
        if (!matches) return false
        try { deps.sendResponse(binding.serverId, command) }
        catch { report('response-failed'); return false }
        // A synchronous response sink may itself invalidate the scope or replace this prompt.
        if (get().readings.get(family)?.get(identity(displayed)) === displayed) remove(family, identity(displayed))
        report('response-sent'); return true
      }
    }
  })
}

/** Typed readings remain independently available to inventory/progress/error presentation. */
export function selectThreadReadings<T extends DaemonEvent['type']>(state: ThreadLiveState, type: T): Extract<DaemonEvent, { type: T }>[] {
  return [...state.readings.values()].flatMap(entries => [...entries.values()])
    .filter((event): event is Extract<DaemonEvent, { type: T }> => event.type === type)
}
