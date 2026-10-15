import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { createHistoryDatabase } from './historyDatabase'
import type { SecretEncryption } from './secureStore'
import { EncryptionUnavailableError } from './secureStore'
import type { DiagnosticLog } from './diagnosticLog'
import { parseChatHistoryRequest, parseChatHistorySnapshot, INVALID_CHAT_HISTORY,
  UNSUPPORTED_CHAT_HISTORY_VERSION, type ChatHistorySnapshot, type ChatHistoryResult } from '../shared/chatHistory'

type Timeline = Extract<ChatHistorySnapshot, { kind: 'timeline' }>
type RecordRow = { kind: string; ordinal: number; parent: number; entry_id: number | null;
  last_id: number | null; row_key: number | null; older_id: number | null; newer_id: number | null; payload: unknown }
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function object(value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw INVALID_CHAT_HISTORY
  return value
}

/** One record per selectable entity; memberships never hide inside a parent payload. */
function records(s: Timeline): RecordRow[] {
  const rows: RecordRow[] = []
  function add(kind: string, ordinal: number, payload: unknown, indexes: Partial<RecordRow> = {}, parent = 0): void {
    rows.push({ kind, ordinal, parent, entry_id: null, last_id: null, row_key: null,
      older_id: null, newer_id: null, ...indexes, payload })
  }
  add('header', 0, { prependedRows: s.prependedRows, coverage: s.coverage,
    ...(s.newestCursor === undefined ? {} : { newestCursor: s.newestCursor }),
    ...(s.rowIdentity === undefined ? {} : { nextRowKey: s.rowIdentity.nextRowKey }),
    served: s.served !== undefined, display: s.display !== undefined, gaps: s.gaps !== undefined })
  s.items.forEach((item, i) => add('row', i, item, { row_key: s.rowIdentity?.rowKeys[i] ?? i - s.prependedRows }))
  s.served?.ids.forEach((id, i) => add('served', i, id, { entry_id: id }))
  s.served?.receipts.forEach((r, i) => {
    add('receipt', i, { cursor: r.cursor, atStart: r.atStart })
    r.ids.forEach((id, j) => add('receipt-id', j, id, { entry_id: id }, i))
  })
  s.display?.forEach((d, i) => add('display', i, d, { entry_id: d.id, last_id: d.lastId ?? d.id, row_key: d.rowKey ?? null }))
  s.gaps?.forEach((g, i) => {
    const { legacyRowKeys, refusedCursors, ...payload } = g
    add('gap', i, { ...payload, legacy: legacyRowKeys !== undefined, refused: refusedCursors !== undefined },
      { older_id: g.olderId ?? null, newer_id: g.newerId })
    legacyRowKeys?.forEach((key, j) => add('gap-key', j, key, { row_key: key }, i))
    refusedCursors?.forEach((cursor, j) => add('gap-refused', j, cursor, {}, i))
  })
  return rows
}

export function createIndexedLegacyHistory(deps: {
  database: ReturnType<typeof createHistoryDatabase>; encryption: SecretEncryption; log: DiagnosticLog
}) {
  const { database, encryption, log } = deps
  function load(db: Database.Database, serverId: string, conversationId: string): Timeline | null {
    const scope = db.prepare<[Buffer, Buffer], { identity: string }>(
      'SELECT identity FROM legacy_scopes WHERE server = ? AND conversation = ?')
      .get(Buffer.from(serverId, 'utf16le'), Buffer.from(conversationId, 'utf16le'))
    if (!scope) return null
    const stored = db.prepare<[string], RecordRow>('SELECT kind, ordinal, parent, entry_id, last_id, row_key, older_id, newer_id, payload FROM legacy_records WHERE scope = ? ORDER BY kind, parent, ordinal').all(scope.identity)
    const decoded = stored.map(row => {
      if (!(row.payload instanceof Uint8Array)) throw INVALID_CHAT_HISTORY
      return { ...row, payload: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(encryption.decrypt(row.payload))) as unknown }
    })
    const groups = new Map<string, typeof decoded>()
    for (const row of decoded) {
      const key = `${row.kind}:${row.parent}`
      const group = groups.get(key) ?? []
      group.push(row); groups.set(key, group)
    }
    const selected = (kind: string, parent = 0) => groups.get(`${kind}:${parent}`) ?? []
    const values = (kind: string, parent = 0) => selected(kind, parent).map(r => r.payload)
    const header = object(values('header')[0])
    const held = selected('row')
    const ids = values('served')
    const snapshot = parseChatHistorySnapshot({ version: 1, kind: 'timeline', serverId, conversationId,
      items: held.map(r => r.payload), prependedRows: header.prependedRows, coverage: header.coverage,
      ...('newestCursor' in header ? { newestCursor: header.newestCursor } : {}),
      ...('nextRowKey' in header ? { rowIdentity: { rowKeys: held.map(r => r.row_key), nextRowKey: header.nextRowKey } } : {}),
      ...(header.served ? { served: { ids, ...(ids.length ? { highestId: ids.at(-1) } : {}),
        receipts: selected('receipt').map(r => ({ ...object(r.payload), ids: values('receipt-id', r.ordinal) })) } } : {}),
      ...(header.display ? { display: values('display') } : {}),
      ...(header.gaps ? { gaps: selected('gap').map(r => {
        const { legacy, refused, ...payload } = object(r.payload)
        return { ...payload, ...(legacy ? { legacyRowKeys: values('gap-key', r.ordinal) } : {}),
          ...(refused ? { refusedCursors: values('gap-refused', r.ordinal) } : {}) }
      }) } : {}) })
    if (snapshot.kind !== 'timeline') throw INVALID_CHAT_HISTORY
    // Reject orphan records, altered indexes, absent records and malformed headers as unreadable.
    const canonical = records(snapshot).sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || a.parent - b.parent || a.ordinal - b.ordinal)
    const comparable = (rows: RecordRow[]) => rows.map(r => JSON.stringify([
      r.kind, r.ordinal, r.parent, r.entry_id, r.last_id, r.row_key, r.older_id, r.newer_id, r.payload]))
    if (JSON.stringify(comparable(canonical)) !== JSON.stringify(comparable(decoded))) throw INVALID_CHAT_HISTORY
    return snapshot
  }
  return {
    async execute(value: unknown): Promise<ChatHistoryResult> {
      const report = (result: ChatHistoryResult): ChatHistoryResult => {
        log.event({ event: 'history-storage-result', code: result.status === 'error' ? result.code : result.status })
        return result
      }
      let request
      try {
        request = parseChatHistoryRequest(value)
        if (!['readTimeline', 'replaceTimeline', 'removeConversation', 'removeServer'].includes(request.operation)) throw INVALID_CHAT_HISTORY
      } catch { return report({ status: 'error', code: 'invalid-request' }) }
      log.event({ event: 'history-storage-operation', code: request.operation })
      const removing = request.operation === 'removeServer' || request.operation === 'removeConversation'
      let reading = true
      try {
        if (!encryption.isAvailable()) return report({ status: 'error', code: 'encryption-unavailable' })
        const result = database.transaction((db): ChatHistoryResult => {
          // SQLite TEXT binding replaces lone surrogates; ownership must retain every JS code unit.
          const server = Buffer.from(request.serverId, 'utf16le')
          if (request.operation === 'removeServer') {
            for (const scope of db.prepare<[Buffer], { conversation: unknown }>('SELECT conversation FROM legacy_scopes WHERE server = ?').all(server)) {
              if (!Buffer.isBuffer(scope.conversation) || scope.conversation.length % 2 !== 0) throw INVALID_CHAT_HISTORY
              load(db, request.serverId, scope.conversation.toString('utf16le'))
            }
          } else if ('conversationId' in request) {
            const snapshot = load(db, request.serverId, request.conversationId)
            if (request.operation === 'readTimeline') return snapshot ? { status: 'stored', snapshot } : { status: 'missing' }
          }
          reading = false
          if (request.operation === 'removeServer') db.prepare('DELETE FROM legacy_scopes WHERE server = ?').run(server)
          else if (request.operation === 'removeConversation' || request.operation === 'replaceTimeline') {
            const conversation = Buffer.from(request.conversationId, 'utf16le')
            db.prepare('DELETE FROM legacy_scopes WHERE server = ? AND conversation = ?').run(server, conversation)
            if (request.operation === 'replaceTimeline') {
              const identity = randomUUID()
              db.prepare('INSERT INTO legacy_scopes VALUES (?, ?, ?)').run(identity, server, conversation)
              const insert = db.prepare('INSERT INTO legacy_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
              for (const r of records(request.snapshot)) {
                if (!encryption.isAvailable()) throw new EncryptionUnavailableError()
                const payload = encryption.encrypt(new TextEncoder().encode(JSON.stringify(r.payload)))
                insert.run(identity, r.kind, r.ordinal, r.parent, r.entry_id, r.last_id, r.row_key, r.older_id, r.newer_id, Buffer.from(payload))
              }
            }
          }
          return { status: 'ok' }
        })
        return report(result)
      } catch (error) {
        return report({ status: 'error', code: error === UNSUPPORTED_CHAT_HISTORY_VERSION ? 'unsupported-version'
          : error instanceof EncryptionUnavailableError ? 'encryption-unavailable'
          : reading ? 'unreadable' : removing ? 'remove-failed' : 'write-failed' })
      }
    }
  }
}
