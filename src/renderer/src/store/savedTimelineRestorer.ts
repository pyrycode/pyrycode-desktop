import type { StoreApi } from 'zustand/vanilla'
import type { ChatHistoryRequest, ChatHistoryResult } from '@shared/chatHistory'
import type { RendererDiagnosticEvent } from '@shared/ipc/diagnostics'
import type { ConversationTimelineStore } from './conversationTimelineStore'

/** The caller owns cancellation; this reader cannot navigate, write or send transport commands. */
export function readSavedTimeline(deps: {
  timelines: Pick<StoreApi<ConversationTimelineStore>, 'getState'>
  read: (request: ChatHistoryRequest) => Promise<ChatHistoryResult>
  log: (event: RendererDiagnosticEvent) => void
}, serverId: string, conversationId: string): { done: Promise<void>; cancel: () => void } {
  const handle = deps.timelines.getState().beginLocalTimelineRead(serverId, conversationId)
  const report = (code: string): void => deps.log({ event: 'history-timeline-restore', code })
  async function run(): Promise<void> {
    if (handle === null) return
    report('started')
    try {
      const result = await deps.read({ operation: 'readTimeline', serverId, conversationId })
      if (result.status === 'missing') {
        handle.complete(null)
        report('missing')
      } else if (result.status === 'stored' && result.snapshot.kind === 'timeline' &&
        result.snapshot.serverId === serverId && result.snapshot.conversationId === conversationId) {
        handle.complete(result.snapshot)
        report('stored')
      } else {
        handle.fail()
        report(result.status === 'error' ? result.code : 'invalid-result')
      }
    } catch {
      handle.fail()
      report('ipc-failed')
    }
  }
  return { done: run(), cancel: () => { handle?.cancel(); report('stopped') } }
}
