import {
  parseChatHistoryRequest, parseChatHistorySnapshot, INVALID_CHAT_HISTORY, UNSUPPORTED_CHAT_HISTORY_VERSION,
  type ChatHistoryRequest, type ChatHistoryResult, type ChatHistorySnapshot
} from '../shared/chatHistory'
import { EncryptionUnavailableError, type SecureStore } from './secureStore'
import type { DiagnosticLog } from './diagnosticLog'

// IDs are record values, never blob names. One collection also makes scoped removal atomic.
const NAME = 'chat-history'
function sameRecord(a: ChatHistorySnapshot, b: ChatHistorySnapshot): boolean {
  return a.serverId === b.serverId && a.kind === b.kind &&
    (a.kind === 'list' || (b.kind === 'timeline' && a.conversationId === b.conversationId))
}
function decode(bytes: Uint8Array): ChatHistorySnapshot[] {
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (typeof value !== 'object' || value === null || !('version' in value) ||
      typeof value.version !== 'number' || !Number.isSafeInteger(value.version)) {
    throw INVALID_CHAT_HISTORY
  }
  if (value.version !== 1) throw UNSUPPORTED_CHAT_HISTORY_VERSION
  if (!('snapshots' in value) || !Array.isArray(value.snapshots)) throw INVALID_CHAT_HISTORY
  const snapshots = value.snapshots.map(parseChatHistorySnapshot)
  if (snapshots.some((snapshot, i) => snapshots.slice(0, i).some((other) => sameRecord(snapshot, other)))) {
    throw INVALID_CHAT_HISTORY
  }
  return snapshots
}

/** One main-process instance owns the collection. Never construct one service per request. */
export function createChatHistoryStore(deps: { secureStore: SecureStore; log: DiagnosticLog }) {
  const { secureStore, log } = deps
  let queue: Promise<unknown> = Promise.resolve()
  function report(result: ChatHistoryResult): ChatHistoryResult {
    log.event({ event: 'history-storage-result', code: result.status === 'error' ? result.code : result.status })
    return result
  }
  async function run(request: ChatHistoryRequest): Promise<ChatHistoryResult> {
    log.event({ event: 'history-storage-operation', code: request.operation })
    let snapshots: ChatHistorySnapshot[]
    try {
      const bytes = await secureStore.get(NAME)
      snapshots = bytes === null ? [] : decode(bytes)
    } catch (error) {
      return {
        status: 'error', code: error === UNSUPPORTED_CHAT_HISTORY_VERSION ? 'unsupported-version' : 'unreadable'
      }
    }
    const { operation, serverId } = request
    if (operation === 'readList' || operation === 'readTimeline') {
      const snapshot = snapshots.find((s) => s.serverId === serverId && (operation === 'readList'
        ? s.kind === 'list' : s.kind === 'timeline' && s.conversationId === request.conversationId))
      return snapshot === undefined ? { status: 'missing' } : { status: 'stored', snapshot }
    }
    let next: ChatHistorySnapshot[]
    if (operation === 'replaceList' || operation === 'replaceTimeline') {
      const index = snapshots.findIndex((s) => sameRecord(s, request.snapshot))
      next = snapshots.slice()
      if (index < 0) next.push(request.snapshot)
      else next[index] = request.snapshot
    } else if (operation === 'removeServer') {
      next = snapshots.filter((s) => s.serverId !== serverId)
    } else {
      next = snapshots.filter((s) => !(s.serverId === serverId && s.kind === 'timeline' &&
          s.conversationId === request.conversationId))
        .map((s) => s.serverId === serverId && s.kind === 'list'
          ? { ...s, conversations: s.conversations.filter((c) => c.id !== request.conversationId) } : s)
    }
    try {
      if (JSON.stringify(next) === JSON.stringify(snapshots)) return { status: 'ok' }
      if (next.length === 0) await secureStore.delete(NAME)
      else await secureStore.set(NAME, new TextEncoder().encode(JSON.stringify({ version: 1, snapshots: next })))
      return { status: 'ok' }
    } catch (error) {
      return {
        status: 'error', code: error instanceof EncryptionUnavailableError ? 'encryption-unavailable'
          : operation === 'removeServer' || operation === 'removeConversation' ? 'remove-failed' : 'write-failed'
      }
    }
  }
  return {
    execute(value: unknown): Promise<ChatHistoryResult> {
      let request: ChatHistoryRequest
      try {
        request = parseChatHistoryRequest(value)
      } catch {
        return Promise.resolve(report({ status: 'error', code: 'invalid-request' }))
      }
      // Capture validated copies before the first await; queue reads as well as mutations.
      const operation = queue.then(() => run(request), () => run(request)).then(report)
      queue = operation.then(() => undefined, () => undefined)
      return operation
    }
  }
}
