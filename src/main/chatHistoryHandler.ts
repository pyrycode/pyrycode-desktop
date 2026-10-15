import { parseChatHistoryRequest, type ChatHistoryRequest, type ChatHistoryResult } from '../shared/chatHistory'
import type { MultiPairedServerStore } from './pairedServerStore'
import type { DiagnosticLog } from './diagnosticLog'

/** Injected listener only. Registration and preload exposure belong to the composition root. */
export function createChatHistoryHandler(deps: {
  store: { execute(request: ChatHistoryRequest): Promise<ChatHistoryResult> }
  pairedServers: Pick<MultiPairedServerStore, 'loadById'>
  log: DiagnosticLog
}) {
  let queue: Promise<unknown> = Promise.resolve()
  const generations = new Map<string, number>()
  const conversations = new Map<string, Map<string, number>>()
  function enqueue<T>(run: () => Promise<T>): Promise<T> {
    const operation = queue.then(run, run)
    queue = operation.then(() => undefined, () => undefined)
    return operation
  }
  const failure = (code: Extract<ChatHistoryResult, { status: 'error' }>['code']): ChatHistoryResult => {
    deps.log.event({ event: 'history-handler-result', code })
    return { status: 'error', code }
  }
  const handle = (_event: unknown, value: unknown): Promise<ChatHistoryResult> => {
    let request: ChatHistoryRequest
    try {
      request = parseChatHistoryRequest(value)
    } catch {
      return Promise.resolve(failure('invalid-request'))
    }
    const generation = generations.get(request.serverId)
    const conversationId = 'conversationId' in request ? request.conversationId : undefined
    const conversationGeneration = conversationId === undefined ? undefined : conversations.get(request.serverId)?.get(conversationId)
    const listGenerations = request.operation === 'replaceList'
      ? request.snapshot.conversations.map(c => ({ id: c.id, generation: conversations.get(request.serverId)?.get(c.id) })) : []
    const run = async (): Promise<ChatHistoryResult> => {
      if (generation !== generations.get(request.serverId)) return failure('unknown-host')
      if (conversationId !== undefined && conversationGeneration !== conversations.get(request.serverId)?.get(conversationId)) return failure('unknown-host')
      if (listGenerations.some(c => c.generation !== conversations.get(request.serverId)?.get(c.id))) return failure('unknown-host')
      try {
        if ((await deps.pairedServers.loadById(request.serverId)) === null) return failure('unknown-host')
      } catch {
        return failure('membership-unavailable')
      }
      try {
        const result = await deps.store.execute(request)
        if (request.operation === 'removeConversation') {
          const host = conversations.get(request.serverId) ?? new Map<string, number>()
          host.set(request.conversationId, (host.get(request.conversationId) ?? 0) + 1)
          conversations.set(request.serverId, host)
        }
        if (request.operation === 'removeServer') {
          generations.set(request.serverId, (generations.get(request.serverId) ?? 0) + 1)
          conversations.delete(request.serverId)
        }
        deps.log.event({ event: 'history-handler-result', code: result.status === 'error' ? result.code : result.status })
        return result
      } catch {
        return failure(request.operation.startsWith('remove') ? 'remove-failed'
          : request.operation.startsWith('replace') ? 'write-failed' : 'unreadable')
      }
    }
    // Membership checks join the queue too: a slow earlier check cannot resurrect removed data.
    return enqueue(run)
  }
  return Object.assign(handle, {
    async drain(): Promise<void> { await queue },
    /** Main-only capability: credential erasure and history deletion share the admission queue. */
    clearServer(serverId: string, clearCredentials: MultiPairedServerStore['clearServer']) {
      return enqueue(async () => {
        const outcome = await clearCredentials(serverId)
        if (!outcome.matched) return outcome
        let code = 'failed'
        try {
          const result = await deps.store.execute({ operation: 'removeServer', serverId })
          if (result.status === 'ok') code = 'ok'
        } catch { /* Credential erasure remains authoritative; never expose the caught value. */ }
        generations.set(serverId, (generations.get(serverId) ?? 0) + 1)
        conversations.delete(serverId)
        deps.log.event({ event: 'history-unpair-cleanup', code })
        return outcome
      })
    }
  })
}
