import type { StoreApi } from 'zustand/vanilla'
import type { ChatHistoryRequest, ChatHistoryResult } from '@shared/chatHistory'
import type { RendererDiagnosticEvent } from '@shared/ipc/diagnostics'
import type { ConversationListStore } from './conversationListStore'
import type { ServerInfoStore } from './serverInfoStore'

/** Read saved display lists once per held identity, independently of connection and navigation. */
export function createSavedListRestorer(deps: {
  lists: Pick<StoreApi<ConversationListStore>, 'getState'>
  servers: Pick<StoreApi<ServerInfoStore>, 'getState' | 'subscribe'>
  read: (request: ChatHistoryRequest) => Promise<ChatHistoryResult>
  log: (event: RendererDiagnosticEvent) => void
}): () => void {
  const attempts = new Map<string, ReturnType<ConversationListStore['beginLocalListRead']>>()
  const report = (code: string) => deps.log({ event: 'history-list-restore', code })
  async function read(serverId: string, handle: NonNullable<ReturnType<ConversationListStore['beginLocalListRead']>>): Promise<void> {
    report('started')
    try {
      const result = await deps.read({ operation: 'readList', serverId })
      if (result.status === 'missing') {
        handle.complete([])
        report('missing')
      } else if (result.status === 'stored' && result.snapshot.kind === 'list' && result.snapshot.serverId === serverId) {
        handle.complete(result.snapshot.conversations)
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
  function sync(): void {
    const saved = new Set(deps.servers.getState().servers.map(s => s.serverId))
    for (const [id, handle] of attempts) {
      if (!saved.has(id)) { handle?.cancel(); attempts.delete(id) }
    }
    for (const id of saved) {
      if (attempts.has(id)) continue
      const handle = deps.lists.getState().beginLocalListRead(id)
      attempts.set(id, handle)
      // The read contains IPC rejection and owns no navigation or transport callback.
      if (handle !== null) void read(id, handle)
    }
  }
  const off = deps.servers.subscribe(sync)
  sync()
  return () => {
    off()
    for (const handle of attempts.values()) handle?.cancel()
    attempts.clear()
    report('stopped')
  }
}
