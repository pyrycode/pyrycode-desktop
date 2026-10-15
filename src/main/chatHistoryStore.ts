import {
  parseChatHistoryRequest, parseChatHistorySnapshot, INVALID_CHAT_HISTORY, UNSUPPORTED_CHAT_HISTORY_VERSION,
  type ChatHistoryRequest, type ChatHistoryResult, type ChatHistorySnapshot
} from '../shared/chatHistory'
import { EncryptionUnavailableError, type SecureStore, type SecretEncryption } from './secureStore'
import type { DiagnosticLog } from './diagnosticLog'
import type { createHistoryDatabase } from './historyDatabase'
import { createIndexedLegacyHistory } from './indexedLegacyHistory'
import { createIndexedThreadHistory } from './indexedThreadHistory'
import type Database from 'better-sqlite3'

// Fixed migration source only; ownership ids remain record values, never blob names.
const NAME = 'chat-history'
function sameRecord(a: ChatHistorySnapshot, b: ChatHistorySnapshot): boolean {
  return a.serverId === b.serverId && a.kind === b.kind &&
    (a.kind === 'list' || (b.kind !== 'list' && a.conversationId === b.conversationId))
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

/** One main-process instance owns import and both indexed families for the app lifetime. */
export function createChatHistoryStore(deps: {
  secureStore: SecureStore; log: DiagnosticLog; encryption: SecretEncryption; database: ReturnType<typeof createHistoryDatabase>
}) {
  const { secureStore, log, encryption, database } = deps
  const legacy = createIndexedLegacyHistory(deps), threads = createIndexedThreadHistory(deps)
  let queue: Promise<unknown> = Promise.resolve()
  let closed = false
  const requireSuccess = (result: ChatHistoryResult): ChatHistoryResult => {
    if (result.status === 'error') throw result
    return result
  }
  function list(db: Database.Database, serverId: string): Extract<ChatHistorySnapshot, { kind: 'list' }> | null {
    const row = db.prepare<[Buffer], { payload: unknown }>('SELECT payload FROM history_lists WHERE server = ?').get(Buffer.from(serverId, 'utf16le'))
    if (!row) return null
    if (!(row.payload instanceof Uint8Array)) throw INVALID_CHAT_HISTORY
    const snapshot = parseChatHistorySnapshot(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(encryption.decrypt(row.payload))))
    if (snapshot.kind !== 'list' || snapshot.serverId !== serverId) throw INVALID_CHAT_HISTORY
    return snapshot
  }
  function saveList(db: Database.Database, snapshot: Extract<ChatHistorySnapshot, { kind: 'list' }>): void {
    const payload = encryption.encrypt(Buffer.from(JSON.stringify(snapshot)))
    db.prepare('INSERT OR REPLACE INTO history_lists VALUES (?, ?)').run(Buffer.from(snapshot.serverId, 'utf16le'), Buffer.from(payload))
  }
  async function importSource(): Promise<void> {
    if (database.transaction(db => db.prepare('SELECT singleton FROM history_import').get()) !== undefined) return
    const bytes = await secureStore.get(NAME)
    const snapshots = bytes === null ? [] : decode(bytes)
    database.transaction(db => {
      // A second owner may have completed while the protected read was pending.
      if (db.prepare('SELECT singleton FROM history_import').get()) return
      for (const snapshot of snapshots) {
        if (snapshot.kind === 'list') {
          if (list(db, snapshot.serverId) === null) saveList(db, snapshot)
        } else {
          const backend = snapshot.kind === 'timeline' ? legacy : threads
          const existing = backend.executeSync({ operation: snapshot.kind === 'timeline' ? 'readTimeline' : 'readThread',
            serverId: snapshot.serverId, conversationId: snapshot.conversationId })
          if (existing.status === 'page') throw INVALID_CHAT_HISTORY
          requireSuccess(existing)
          if (existing.status === 'missing') {
            const result = backend.executeSync({ operation: snapshot.kind === 'timeline' ? 'replaceTimeline' : 'replaceThread',
              serverId: snapshot.serverId, conversationId: snapshot.conversationId, snapshot })
            if (result.status === 'page') throw INVALID_CHAT_HISTORY
            requireSuccess(result)
          }
        }
      }
      db.prepare('INSERT INTO history_import VALUES (1, 0)').run()
    })
  }
  async function retireSource(): Promise<boolean> {
    if (!database.transaction(db => db.prepare('SELECT singleton FROM history_import WHERE retired = 0').get())) return true
    try {
      // Completion is already durable. Never reopen/decrypt this source, even after cleanup failure.
      await secureStore.delete(NAME)
      database.transaction(db => db.prepare('UPDATE history_import SET retired = 1 WHERE singleton = 1').run())
      log.event({ event: 'history-source-retired', code: 'ok' })
      return true
    } catch {
      log.event({ event: 'history-source-retired', code: 'remove-failed' })
      return false
    }
  }
  function report(result: ChatHistoryResult): ChatHistoryResult {
    log.event({ event: 'history-storage-result', code: result.status === 'error' ? result.code : result.status })
    return result
  }
  async function run(request: ChatHistoryRequest): Promise<ChatHistoryResult> {
    log.event({ event: 'history-storage-operation', code: request.operation })
    try {
      if (!encryption.isAvailable()) throw new EncryptionUnavailableError()
      await importSource()
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'status' in error && error.status === 'error' && 'code' in error &&
        (error.code === 'write-failed' || error.code === 'unreadable' || error.code === 'encryption-unavailable' || error.code === 'unsupported-version'))
        return { status: 'error', code: error.code }
      return {
        status: 'error', code: error === UNSUPPORTED_CHAT_HISTORY_VERSION ? 'unsupported-version'
          : error instanceof EncryptionUnavailableError ? 'encryption-unavailable' : 'unreadable'
      }
    }
    const { operation, serverId } = request
    let reading = true
    try {
      const result = database.transaction((db): ChatHistoryResult => {
        if (operation === 'readTimeline' || operation === 'replaceTimeline') {
          const result = requireSuccess(legacy.executeSync(request))
          reading = operation === 'readTimeline'
          return result
        }
        if (operation === 'readThread' || operation === 'replaceThread') {
          const result = threads.executeSync(request)
          if (result.status === 'page') throw INVALID_CHAT_HISTORY
          requireSuccess(result)
          reading = operation === 'readThread'
          return result
        }
        const saved = list(db, serverId)
        if (operation === 'readList') return saved === null ? { status: 'missing' } : { status: 'stored', snapshot: saved }
        reading = false
        if (operation === 'replaceList') saveList(db, request.snapshot)
        else {
          requireSuccess(legacy.executeSync(request))
          const result = threads.executeSync(request)
          if (result.status === 'page') throw INVALID_CHAT_HISTORY
          requireSuccess(result)
          if (operation === 'removeServer') db.prepare('DELETE FROM history_lists WHERE server = ?').run(Buffer.from(serverId, 'utf16le'))
          else if (saved) saveList(db, { ...saved, conversations: saved.conversations.filter(c => c.id !== request.conversationId) })
        }
        return { status: 'ok' }
      })
      const retired = await retireSource()
      return !retired && operation.startsWith('remove') ? { status: 'error', code: 'remove-failed' } : result
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'status' in error && error.status === 'error' && 'code' in error &&
        (error.code === 'write-failed' || error.code === 'remove-failed' || error.code === 'unreadable' || error.code === 'encryption-unavailable' || error.code === 'unsupported-version'))
        return { status: 'error', code: error.code }
      return {
        status: 'error', code: error instanceof EncryptionUnavailableError ? 'encryption-unavailable'
          : reading ? 'unreadable' : operation.startsWith('remove') ? 'remove-failed' : 'write-failed'
      }
    }
  }
  return {
    async close(): Promise<void> { closed = true; await queue; database.close() },
    execute(value: unknown): Promise<ChatHistoryResult> {
      if (closed) return Promise.resolve(report({ status: 'error', code: 'unreadable' }))
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
