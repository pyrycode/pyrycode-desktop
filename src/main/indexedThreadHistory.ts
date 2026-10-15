import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { createHistoryDatabase } from './historyDatabase'
import { EncryptionUnavailableError, type SecretEncryption } from './secureStore'
import type { DiagnosticLog } from './diagnosticLog'
import { parseChatHistoryRequest, parseChatHistorySnapshot, threadHistoryCodec, INVALID_CHAT_HISTORY,
  UNSUPPORTED_CHAT_HISTORY_VERSION, MAX_CHAT_HISTORY_ITEMS, type ChatHistoryResult, type ThreadSnapshot } from '../shared/chatHistory'

export type ThreadHistoryPage = {
  partial: true
  metadata: Omit<ThreadSnapshot, 'items' | 'ranges' | 'arrivalOrder'>
  items: ThreadSnapshot['items']; ranges: ThreadSnapshot['ranges']
  arrivalPositions?: readonly number[]
  continuation: string | null
}
export type ThreadHistoryResult = ChatHistoryResult | { status: 'page'; page: ThreadHistoryPage }
type Row = { kind: string; ordinal: number; arrival: number | null; item_order: number | null;
  range_ordinal: number | null; range_start: number | null; range_end: number | null; payload: unknown }
const columns = 'kind, ordinal, arrival, item_order, range_ordinal, range_start, range_end, payload'
const INVALID_CONTINUATION = new Error('invalid local history continuation')
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function object(value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw INVALID_CHAT_HISTORY
  return value
}
function natural(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw INVALID_CHAT_HISTORY
  return value
}
function order(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b) }
function records(thread: ThreadSnapshot): Row[] {
  const { items, ranges, arrivalOrder, ...metadata } = thread
  const arrivals = new Map(arrivalOrder?.map((id, i) => [id, i]))
  function rangeFor(value: unknown): number | null {
    const n = order(value)
    if (n === null) return null
    let low = 0, high = ranges.length
    while (low < high) { const mid = Math.floor((low + high) / 2); if (ranges[mid].end <= n) low = mid + 1; else high = mid }
    return low < ranges.length && ranges[low].start <= n ? low : null
  }
  const row = (kind: string, ordinal: number, payload: unknown, indexes: Partial<Row> = {}): Row =>
    ({ kind, ordinal, arrival: null, item_order: null, range_ordinal: null, range_start: null, range_end: null, ...indexes, payload })
  return [row('header', 0, { metadata, itemCount: items.length, rangeCount: ranges.length, hasArrival: arrivalOrder !== undefined }),
    ...items.map((item, i) => row('item', i, item, { arrival: arrivals.get(item.id) ?? null, item_order: order(item.order), range_ordinal: rangeFor(item.order) })),
    ...ranges.map((r, i) => row('range', i, r, { range_start: r.start, range_end: r.end }))]
}
function header(value: unknown, server: string, conversation: string) {
  const v = object(value), metadata = threadHistoryCodec.metadata(v.metadata, server, conversation)
  const itemCount = natural(v.itemCount), rangeCount = natural(v.rangeCount)
  if (itemCount > MAX_CHAT_HISTORY_ITEMS || rangeCount > MAX_CHAT_HISTORY_ITEMS || typeof v.hasArrival !== 'boolean') throw INVALID_CHAT_HISTORY
  const parsed = { metadata, itemCount, rangeCount, hasArrival: v.hasArrival }
  if (!same(parsed, value)) throw INVALID_CHAT_HISTORY
  return parsed
}

/** Callable main-process family; connection ownership and authorization remain with the caller. */
export function createIndexedThreadHistory(deps: {
  database: ReturnType<typeof createHistoryDatabase>; encryption: SecretEncryption; log: DiagnosticLog
}) {
  const { database, encryption, log } = deps
  function decode(row: Row, identity: string): unknown {
    if (!(row.payload instanceof Uint8Array)) throw INVALID_CHAT_HISTORY
    const envelope = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(encryption.decrypt(row.payload))))
    const { payload: ignored, ...indexes } = row
    void ignored
    if (!same(envelope, { scope: identity, ...indexes, value: envelope.value })) throw INVALID_CHAT_HISTORY
    return envelope.value
  }
  function scope(db: Database.Database, server: string, conversation: string): string | null {
    const row = db.prepare<[Buffer, Buffer], { identity: unknown }>(
      'SELECT identity FROM thread_scopes WHERE server = ? AND conversation = ?')
      .get(Buffer.from(server, 'utf16le'), Buffer.from(conversation, 'utf16le'))
    if (!row) return null
    if (typeof row.identity !== 'string' || !/^[0-9a-f-]{36}$/.test(row.identity)) throw INVALID_CHAT_HISTORY
    return row.identity
  }
  function load(db: Database.Database, server: string, conversation: string) {
    const identity = scope(db, server, conversation)
    if (identity === null) return null
    const decoded = db.prepare<[string], Row>(`SELECT ${columns} FROM thread_records WHERE scope = ? ORDER BY kind, ordinal`)
      .all(identity).map(row => ({ ...row, payload: decode(row, identity) }))
    const h = header(decoded.find(r => r.kind === 'header')?.payload, server, conversation)
    const items = decoded.filter(r => r.kind === 'item'), ranges = decoded.filter(r => r.kind === 'range')
    const snapshot = parseChatHistorySnapshot({ version: 1, kind: 'daemon-items', serverId: server, conversationId: conversation,
      thread: { ...h.metadata, items: items.map(r => r.payload), ranges: ranges.map(r => r.payload),
        ...(h.hasArrival ? { arrivalOrder: [...items].sort((a, b) => (a.arrival ?? -1) - (b.arrival ?? -1)).map(r => object(r.payload).id) } : {}) } })
    if (snapshot.kind !== 'daemon-items' || !same(records(snapshot.thread), decoded)) throw INVALID_CHAT_HISTORY
    return snapshot
  }
  function readPage(db: Database.Database, server: string, conversation: string, limit: number, token: Record<string, unknown> | null): ThreadHistoryResult {
    const identity = scope(db, server, conversation)
    if (identity === null) { if (token) throw INVALID_CONTINUATION; return { status: 'missing' } }
    const row = db.prepare<[string], Row>(`SELECT ${columns} FROM thread_records WHERE scope = ? AND kind = 'header' AND ordinal = 0`).get(identity)
    if (!row) throw INVALID_CHAT_HISTORY
    const h = header(decode(row, identity), server, conversation)
    if (row.arrival !== null || row.item_order !== null || row.range_ordinal !== null || row.range_start !== null || row.range_end !== null) throw INVALID_CHAT_HISTORY
    if (token && (token.identity !== identity || token.serverId !== server || token.conversationId !== conversation ||
      token.epoch !== h.metadata.epoch || typeof token.before !== 'number' || token.before > h.itemCount)) throw INVALID_CONTINUATION
    const end = token ? natural(token.before) : h.itemCount, start = Math.max(0, end - limit)
    const selected = db.prepare<[string, number, number], Row>(`SELECT ${columns} FROM thread_records
      WHERE scope = ? AND kind = 'item' AND ordinal >= ? AND ordinal < ? ORDER BY ordinal`).all(identity, start, end)
    if (selected.length !== end - start) throw INVALID_CHAT_HISTORY
    const items = threadHistoryCodec.items(selected.map(r => decode(r, identity)))
    if (new Set(items.map(i => i.id)).size !== items.length) throw INVALID_CHAT_HISTORY
    selected.forEach((r, i) => {
      if (r.ordinal !== start + i || r.item_order !== order(items[i].order) || r.range_start !== null || r.range_end !== null ||
        (h.hasArrival ? r.arrival === null || natural(r.arrival) >= h.itemCount : r.arrival !== null)) throw INVALID_CHAT_HISTORY
    })
    // Protected per-item membership prevents a damaged numeric range index from hiding evidence.
    const ordinals = [...new Set([...(h.rangeCount ? [h.rangeCount - 1] : []), ...selected.flatMap(r => r.range_ordinal === null ? [] : [natural(r.range_ordinal)])])]
    const evidence = db.prepare<(string | number)[], Row>(`SELECT ${columns} FROM thread_records
      WHERE scope = ? AND kind = 'range' AND ordinal IN (${ordinals.map(() => '?').join(',')}) ORDER BY ordinal`).all(identity, ...ordinals)
    const ranges = threadHistoryCodec.ranges(evidence.map(r => decode(r, identity)))
    if (evidence.length !== ordinals.length) throw INVALID_CHAT_HISTORY
    evidence.forEach((r, i) => {
      if (natural(r.ordinal) >= h.rangeCount || r.arrival !== null || r.item_order !== null || r.range_ordinal !== null ||
        r.range_start !== ranges[i].start || r.range_end !== ranges[i].end) throw INVALID_CHAT_HISTORY
    })
    for (const item of selected) if (item.range_ordinal !== null) {
      const range = evidence.find(r => r.ordinal === item.range_ordinal)
      if (item.item_order === null || !range || range.range_start === null || range.range_end === null ||
        range.range_start > item.item_order || item.item_order >= range.range_end) throw INVALID_CHAT_HISTORY
    }
    const continuation = start === 0 ? null : Buffer.from(encryption.encrypt(Buffer.from(JSON.stringify({
      format: 'daemon-items', serverId: server, conversationId: conversation, epoch: h.metadata.epoch, identity, before: start
    })))).toString('base64url')
    return { status: 'page', page: { partial: true, metadata: h.metadata, items, ranges,
      ...(h.hasArrival ? { arrivalPositions: selected.map(r => natural(r.arrival)) } : {}), continuation } }
  }
  return {
    async execute(value: unknown): Promise<ThreadHistoryResult> {
      const report = (result: ThreadHistoryResult): ThreadHistoryResult => {
        log.event({ event: 'history-storage-result', code: result.status === 'error' ? result.code : result.status }); return result
      }
      let request, paging: { limit: number; continuation?: string } | undefined
      try {
        const v = object(value)
        if (v.operation === 'newestThreadPage' || v.operation === 'beforeThreadPage') {
          const before = v.operation === 'beforeThreadPage'
          if (natural(v.limit) < 1 || natural(v.limit) > 200 ||
            Object.keys(v).some(k => !['operation', 'serverId', 'conversationId', 'limit', ...(before ? ['continuation'] : [])].includes(k)) ||
            before && (typeof v.continuation !== 'string' || v.continuation.length === 0 || v.continuation.length > 65536 || !/^[A-Za-z0-9_-]+$/.test(v.continuation))) throw INVALID_CHAT_HISTORY
          paging = { limit: natural(v.limit), ...(before && typeof v.continuation === 'string' ? { continuation: v.continuation } : {}) }
          request = parseChatHistoryRequest({ operation: 'readThread', serverId: v.serverId, conversationId: v.conversationId })
        } else request = parseChatHistoryRequest(value)
        if (!['readThread', 'replaceThread', 'removeConversation', 'removeServer'].includes(request.operation)) throw INVALID_CHAT_HISTORY
      } catch { return report({ status: 'error', code: 'invalid-request' }) }
      log.event({ event: 'history-storage-operation', code: paging ? 'thread-page' : request.operation })
      let reading = true
      const removing = request.operation === 'removeConversation' || request.operation === 'removeServer'
      try {
        if (!encryption.isAvailable()) return report({ status: 'error', code: 'encryption-unavailable' })
        let token: Record<string, unknown> | null = null
        if (paging?.continuation !== undefined) {
          try {
            token = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(encryption.decrypt(Buffer.from(paging.continuation, 'base64url')))))
            if (token.format !== 'daemon-items' || Object.keys(token).length !== 6 ||
              typeof token.identity !== 'string' || typeof token.epoch !== 'string' || natural(token.before) === 0 ||
              token.serverId !== request.serverId || !('conversationId' in request) || token.conversationId !== request.conversationId) throw INVALID_CHAT_HISTORY
          } catch { return report({ status: 'error', code: 'invalid-request' }) }
        }
        return report(database.transaction((db): ThreadHistoryResult => {
          const server = Buffer.from(request.serverId, 'utf16le')
          if (request.operation === 'removeServer') {
            for (const s of db.prepare<[Buffer], { conversation: unknown }>('SELECT conversation FROM thread_scopes WHERE server = ?').all(server)) {
              if (!Buffer.isBuffer(s.conversation) || s.conversation.length % 2 !== 0) throw INVALID_CHAT_HISTORY
              load(db, request.serverId, s.conversation.toString('utf16le'))
            }
          } else if ('conversationId' in request) {
            if (paging) return readPage(db, request.serverId, request.conversationId, paging.limit, token)
            const snapshot = load(db, request.serverId, request.conversationId)
            if (request.operation === 'readThread') return snapshot ? { status: 'stored', snapshot } : { status: 'missing' }
          }
          reading = false
          if (request.operation === 'removeServer') db.prepare('DELETE FROM thread_scopes WHERE server = ?').run(server)
          else if (request.operation === 'removeConversation' || request.operation === 'replaceThread') {
            const conversation = Buffer.from(request.conversationId, 'utf16le')
            db.prepare('DELETE FROM thread_scopes WHERE server = ? AND conversation = ?').run(server, conversation)
            if (request.operation === 'replaceThread') {
              const identity = randomUUID()
              db.prepare('INSERT INTO thread_scopes VALUES (?, ?, ?)').run(identity, server, conversation)
              const insert = db.prepare('INSERT INTO thread_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
              for (const { payload, ...indexes } of records(request.snapshot.thread)) {
                const protectedPayload = encryption.encrypt(Buffer.from(JSON.stringify({ scope: identity, ...indexes, value: payload })))
                insert.run(identity, indexes.kind, indexes.ordinal, indexes.arrival, indexes.item_order, indexes.range_ordinal, indexes.range_start, indexes.range_end, Buffer.from(protectedPayload))
              }
            }
          }
          return { status: 'ok' }
        }))
      } catch (caught) {
        return report({ status: 'error', code: caught === INVALID_CONTINUATION ? 'invalid-request'
          : caught === UNSUPPORTED_CHAT_HISTORY_VERSION ? 'unsupported-version'
          : caught instanceof EncryptionUnavailableError ? 'encryption-unavailable'
          : reading ? 'unreadable' : removing ? 'remove-failed' : 'write-failed' })
      }
    }
  }
}
