import type { StoreApi } from 'zustand/vanilla'
import type { ChatHistoryRequest, ChatHistoryResult } from '@shared/chatHistory'
import type { RendererDiagnosticEvent } from '@shared/ipc/diagnostics'
import type { ThreadItemStore } from './threadItemStore'

/** The caller owns cancellation; this reader cannot navigate, write or send transport commands. */
export function readSavedTimeline(deps: {
  threads: Pick<StoreApi<ThreadItemStore>, 'getState'>
  read: (request: ChatHistoryRequest) => Promise<ChatHistoryResult>
  log: (event: RendererDiagnosticEvent) => void
}, serverId: string, conversationId: string,
  demand?: { operation: 'newestThreadPage' } | { operation: 'beforeThreadPage'; continuation: string; recovery?: string }
): { done: Promise<string | undefined>; cancel: () => void } {
  const handle = deps.threads.getState().beginLocalRead(serverId, conversationId, demand !== undefined)
  const report = (code: string): void => deps.log({ event: 'history-timeline-restore', code })
  async function run(): Promise<string | undefined> {
    if (handle === null) return
    report('started')
    try {
      const result = await deps.read({ ...(demand ?? { operation: 'openThreadPage' }), serverId, conversationId, limit: 200 })
      if (result.status === 'missing' && !demand) { handle.complete(null); report('missing'); return 'missing' }
      else if (result.status === 'page' && result.page.metadata.hostId === serverId &&
          result.page.metadata.conversationId === conversationId) {
        handle.complete(result.page); report('stored'); return 'stored'
      } else {
        handle.fail(); const code = result.status === 'error' ? result.code : 'invalid-result'; report(code); return code
      }
    } catch { handle.fail(); report('ipc-failed'); return 'ipc-failed' }
  }
  return { done: run(), cancel: () => { handle?.cancel(); report('stopped') } }
}
