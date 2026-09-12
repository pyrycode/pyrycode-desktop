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
  const failure = (code: Extract<ChatHistoryResult, { status: 'error' }>['code']): ChatHistoryResult => {
    deps.log.event({ event: 'history-handler-result', code })
    return { status: 'error', code }
  }
  return (_event: unknown, value: unknown): Promise<ChatHistoryResult> => {
    let request: ChatHistoryRequest
    try {
      request = parseChatHistoryRequest(value)
    } catch {
      return Promise.resolve(failure('invalid-request'))
    }
    const run = async (): Promise<ChatHistoryResult> => {
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
    const operation = queue.then(run, run)
    queue = operation.then(() => undefined, () => undefined)
    return operation
  }
}
