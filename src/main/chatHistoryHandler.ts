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
    const run = async (): Promise<ChatHistoryResult> => {
      if (generation !== generations.get(request.serverId)) return failure('unknown-host')
      try {
        if ((await deps.pairedServers.loadById(request.serverId)) === null) return failure('unknown-host')
      } catch {
        return failure('membership-unavailable')
      }
      try {
        const result = await deps.store.execute(request)
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
        deps.log.event({ event: 'history-unpair-cleanup', code })
        return outcome
      })
    }
  })
}
