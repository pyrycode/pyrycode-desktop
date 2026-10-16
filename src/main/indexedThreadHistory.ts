import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { createHistoryDatabase } from './historyDatabase'
import { EncryptionUnavailableError, type SecretEncryption } from './secureStore'
import type { DiagnosticLog } from './diagnosticLog'
import { parseChatHistoryRequest, parseChatHistorySnapshot, threadHistoryCodec, INVALID_CHAT_HISTORY,
  UNSUPPORTED_CHAT_HISTORY_VERSION, MAX_CHAT_HISTORY_ITEMS, type ChatHistoryResult, type ChatHistorySnapshot, type ThreadSnapshot } from '../shared/chatHistory'

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
const MAX_CONTINUATION_LENGTH = 65536
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
function records(thread: ThreadSnapshot, generation?: string): Row[] {
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
  return [row('header', 0, { metadata, itemCount: items.length, rangeCount: ranges.length, hasArrival: arrivalOrder !== undefined,
    ...(generation === undefined ? {} : { generation }) }),
    ...items.map((item, i) => row('item', i, item, { arrival: arrivals.get(item.id) ?? null, item_order: order(item.order), range_ordinal: rangeFor(item.order) })),
    ...ranges.map((r, i) => row('range', i, r, { range_start: r.start, range_end: r.end }))]
}
function header(value: unknown, server: string, conversation: string, legacy = false) {
  const v = object(value), metadata = threadHistoryCodec.metadata(v.metadata, server, conversation)
  const itemCount = natural(v.itemCount), rangeCount = natural(v.rangeCount)
  if (itemCount > MAX_CHAT_HISTORY_ITEMS || rangeCount > MAX_CHAT_HISTORY_ITEMS || typeof v.hasArrival !== 'boolean') throw INVALID_CHAT_HISTORY
  if (!legacy && (typeof v.generation !== 'string' || !/^[0-9a-f-]{36}$/.test(v.generation))) throw INVALID_CHAT_HISTORY
  const parsed = { metadata, itemCount, rangeCount, hasArrival: v.hasArrival,
    ...(!legacy && typeof v.generation === 'string' ? { generation: v.generation } : {}) }
  if (!same(parsed, value)) throw INVALID_CHAT_HISTORY
  return parsed
}

/** Callable main-process family; connection ownership and authorization remain with the caller. */
export function createIndexedThreadHistory(deps: {
  database: ReturnType<typeof createHistoryDatabase>; encryption: SecretEncryption; log: DiagnosticLog
}) {
  const { database, encryption, log } = deps
  function decode(row: Row, identity: string, generation = identity): unknown {
    if (!(row.payload instanceof Uint8Array)) throw INVALID_CHAT_HISTORY
    const envelope = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(encryption.decrypt(row.payload))))
    const { payload: ignored, ...indexes } = row
    void ignored
    if (!same(envelope, { scope: row.kind === 'header' ? identity : generation, ...indexes, value: envelope.value })) throw INVALID_CHAT_HISTORY
    return envelope.value
  }
  function item(db: Database.Database, row: Row, identity: string, h: ReturnType<typeof header>): unknown {
    const binding = object(decode(row, identity, h.generation)), id = natural(binding.id), rev = natural(binding.rev)
    const stored = db.prepare<[string, number], { revision: unknown; payload: unknown }>(
      'SELECT revision, payload FROM thread_payloads WHERE scope = ? AND item_id = ?').get(identity, id)
    if (!stored || stored.revision !== rev || !(stored.payload instanceof Uint8Array) ||
      !same(binding, { id, rev, digest: createHash('sha256').update(stored.payload).digest('hex') })) throw INVALID_CHAT_HISTORY
    const envelope = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(encryption.decrypt(stored.payload))))
    const value = object(envelope.value)
    if (value.id !== id || value.rev !== rev ||
      !same(envelope, { scope: identity, epoch: h.metadata.epoch, id, rev, value })) throw INVALID_CHAT_HISTORY
    return value
  }
  function scope(db: Database.Database, server: string, conversation: string): string | null {
    const row = db.prepare<[Buffer, Buffer], { identity: unknown }>(
      'SELECT identity FROM thread_scopes WHERE server = ? AND conversation = ?')
      .get(Buffer.from(server, 'utf16le'), Buffer.from(conversation, 'utf16le'))
    if (!row) return null
    if (typeof row.identity !== 'string' || !/^[0-9a-f-]{36}$/.test(row.identity)) throw INVALID_CHAT_HISTORY
    return row.identity
  }
  function load(db: Database.Database, server: string, conversation: string, legacy = false) {
    const identity = scope(db, server, conversation)
    if (identity === null) return null
    const rows = db.prepare<[string], Row>(`SELECT ${columns} FROM thread_records WHERE scope = ? ORDER BY kind, ordinal`).all(identity)
    const first = rows.find(r => r.kind === 'header')
    if (!first) throw INVALID_CHAT_HISTORY
    const h = header(decode(first, identity), server, conversation, legacy)
    const decoded = rows.map(row => ({ ...row, payload: row.kind === 'item' && !legacy ? item(db, row, identity, h)
      : decode(row, identity, h.generation) }))
    const items = decoded.filter(r => r.kind === 'item'), ranges = decoded.filter(r => r.kind === 'range')
    const snapshot = parseChatHistorySnapshot({ version: 1, kind: 'daemon-items', serverId: server, conversationId: conversation,
      thread: { ...h.metadata, items: items.map(r => r.payload), ranges: ranges.map(r => r.payload),
        ...(h.hasArrival ? { arrivalOrder: [...items].sort((a, b) => (a.arrival ?? -1) - (b.arrival ?? -1)).map(r => object(r.payload).id) } : {}) } })
    if (snapshot.kind !== 'daemon-items' || !same(records(snapshot.thread, h.generation), decoded)) throw INVALID_CHAT_HISTORY
    if (!legacy && db.prepare<[string], { n: number }>('SELECT count(*) AS n FROM thread_payloads WHERE scope = ?').get(identity)?.n !== items.length) throw INVALID_CHAT_HISTORY
    return snapshot
  }
  function save(db: Database.Database, snapshot: Extract<ChatHistorySnapshot, { kind: 'daemon-items' }>,
    identity: string, generation: string, previous: ThreadSnapshot | null = null) {
    const retained = new Map(db.prepare<[string], { item_id: number; payload: Buffer }>(
      'SELECT item_id, payload FROM thread_payloads WHERE scope = ?').all(identity).map(r => [r.item_id, r.payload]))
    const old = new Map(previous?.epoch === snapshot.thread.epoch ? previous.items.map(i => [i.id, i]) : [])
    db.prepare('DELETE FROM thread_scopes WHERE identity = ?').run(identity)
    db.prepare('INSERT INTO thread_scopes VALUES (?, ?, ?)').run(identity, Buffer.from(snapshot.serverId, 'utf16le'), Buffer.from(snapshot.conversationId, 'utf16le'))
    const insert = db.prepare('INSERT INTO thread_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    const payloadInsert = db.prepare('INSERT INTO thread_payloads VALUES (?, ?, ?, ?)')
    for (const { payload, ...indexes } of records(snapshot.thread, generation)) {
      let value = payload
      if (indexes.kind === 'item') {
        const i = object(payload), id = natural(i.id), rev = natural(i.rev)
        const cipher = same(old.get(id), payload) ? retained.get(id) : undefined
        const bytes = cipher ?? encryption.encrypt(Buffer.from(JSON.stringify({ scope: identity, epoch: snapshot.thread.epoch, id, rev, value: payload })))
        payloadInsert.run(identity, id, rev, Buffer.from(bytes))
        value = { id, rev, digest: createHash('sha256').update(bytes).digest('hex') }
      }
      const bytes = encryption.encrypt(Buffer.from(JSON.stringify({ scope: indexes.kind === 'header' ? identity : generation, ...indexes, value })))
      insert.run(identity, indexes.kind, indexes.ordinal, indexes.arrival, indexes.item_order, indexes.range_ordinal, indexes.range_start, indexes.range_end, Buffer.from(bytes))
    }
  }
  function migrate(db: Database.Database): void {
    if (db.pragma('user_version', { simple: true }) !== 5) return
    log.event({ event: 'history-storage-operation', code: 'thread-migration' })
    const snapshots = db.prepare<[], { identity: unknown; server: unknown; conversation: unknown }>('SELECT * FROM thread_scopes').all().map(s => {
      if (typeof s.identity !== 'string' || !Buffer.isBuffer(s.server) || !Buffer.isBuffer(s.conversation) ||
        s.server.length % 2 !== 0 || s.conversation.length % 2 !== 0) throw INVALID_CHAT_HISTORY
      const snapshot = load(db, s.server.toString('utf16le'), s.conversation.toString('utf16le'), true)
      if (!snapshot) throw INVALID_CHAT_HISTORY
      return { identity: s.identity, snapshot }
    })
    db.exec(`CREATE TABLE thread_payloads (
      scope TEXT NOT NULL REFERENCES thread_scopes(identity) ON DELETE CASCADE,
      item_id INTEGER NOT NULL, revision INTEGER NOT NULL, payload BLOB NOT NULL, PRIMARY KEY(scope, item_id))`)
    for (const s of snapshots) save(db, s.snapshot, s.identity, s.identity)
    db.pragma('user_version = 6')
  }
  function readPage(db: Database.Database, server: string, conversation: string, limit: number, token: Record<string, unknown> | null): ThreadHistoryResult {
    const identity = scope(db, server, conversation)
    if (identity === null) { if (token) throw INVALID_CONTINUATION; return { status: 'missing' } }
    const row = db.prepare<[string], Row>(`SELECT ${columns} FROM thread_records WHERE scope = ? AND kind = 'header' AND ordinal = 0`).get(identity)
    if (!row) throw INVALID_CHAT_HISTORY
    const h = header(decode(row, identity), server, conversation)
    if (row.arrival !== null || row.item_order !== null || row.range_ordinal !== null || row.range_start !== null || row.range_end !== null) throw INVALID_CHAT_HISTORY
    if (token && (token.identity !== h.generation || typeof token.before !== 'number' || token.before > h.itemCount)) throw INVALID_CONTINUATION
    const end = token ? natural(token.before) : h.itemCount, start = Math.max(0, end - limit)
    const selected = db.prepare<[string, number, number], Row>(`SELECT ${columns} FROM thread_records
      WHERE scope = ? AND kind = 'item' AND ordinal >= ? AND ordinal < ? ORDER BY ordinal`).all(identity, start, end)
    if (selected.length !== end - start) throw INVALID_CHAT_HISTORY
    const items = threadHistoryCodec.items(selected.map(r => item(db, r, identity, h)))
    if (new Set(items.map(i => i.id)).size !== items.length) throw INVALID_CHAT_HISTORY
    selected.forEach((r, i) => {
      if (r.ordinal !== start + i || r.item_order !== order(items[i].order) || r.range_start !== null || r.range_end !== null ||
        (h.hasArrival ? r.arrival === null || natural(r.arrival) >= h.itemCount : r.arrival !== null)) throw INVALID_CHAT_HISTORY
    })
    // Protected per-item membership prevents a damaged numeric range index from hiding evidence.
    const ordinals = [...new Set([...(h.rangeCount ? [h.rangeCount - 1] : []), ...selected.flatMap(r => r.range_ordinal === null ? [] : [natural(r.range_ordinal)])])]
    const evidence = db.prepare<(string | number)[], Row>(`SELECT ${columns} FROM thread_records
      WHERE scope = ? AND kind = 'range' AND ordinal IN (${ordinals.map(() => '?').join(',')}) ORDER BY ordinal`).all(identity, ...ordinals)
    const ranges = threadHistoryCodec.ranges(evidence.map(r => decode(r, identity, h.generation)))
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
      format: 'daemon-items', identity: h.generation, before: start
    })))).toString('base64url')
    if (continuation !== null && (continuation.length === 0 || continuation.length > MAX_CONTINUATION_LENGTH)) throw INVALID_CHAT_HISTORY
    return { status: 'page', page: { partial: true, metadata: h.metadata, items, ranges,
      ...(h.hasArrival ? { arrivalPositions: selected.map(r => natural(r.arrival)) } : {}), continuation } }
  }
  const api = {
    async execute(value: unknown): Promise<ThreadHistoryResult> { return api.executeSync(value) },
    /** Main-only synchronous seam for atomic multi-family import and removal. */
    executeSync(value: unknown): ThreadHistoryResult {
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
            before && (typeof v.continuation !== 'string' || v.continuation.length === 0 || v.continuation.length > MAX_CONTINUATION_LENGTH || !/^[A-Za-z0-9_-]+$/.test(v.continuation))) throw INVALID_CHAT_HISTORY
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
            if (token.format !== 'daemon-items' || Object.keys(token).length !== 3 ||
              typeof token.identity !== 'string' || !/^[0-9a-f-]{36}$/.test(token.identity) || natural(token.before) === 0) throw INVALID_CHAT_HISTORY
          } catch { return report({ status: 'error', code: 'invalid-request' }) }
        }
        return report(database.transaction((db): ThreadHistoryResult => {
          migrate(db)
          const server = Buffer.from(request.serverId, 'utf16le')
          let previous: ThreadSnapshot | null = null
          if (request.operation === 'removeServer') {
            for (const s of db.prepare<[Buffer], { conversation: unknown }>('SELECT conversation FROM thread_scopes WHERE server = ?').all(server)) {
              if (!Buffer.isBuffer(s.conversation) || s.conversation.length % 2 !== 0) throw INVALID_CHAT_HISTORY
              load(db, request.serverId, s.conversation.toString('utf16le'))
            }
          } else if ('conversationId' in request) {
            if (paging) return readPage(db, request.serverId, request.conversationId, paging.limit, token)
            const snapshot = load(db, request.serverId, request.conversationId)
            previous = snapshot?.thread ?? null
            if (request.operation === 'readThread') return snapshot ? { status: 'stored', snapshot } : { status: 'missing' }
          }
          reading = false
          if (request.operation === 'removeServer') db.prepare('DELETE FROM thread_scopes WHERE server = ?').run(server)
          else if (request.operation === 'removeConversation' || request.operation === 'replaceThread') {
            const conversation = Buffer.from(request.conversationId, 'utf16le')
            if (request.operation === 'replaceThread') {
              save(db, request.snapshot, scope(db, request.serverId, request.conversationId) ?? randomUUID(), randomUUID(), previous)
            } else db.prepare('DELETE FROM thread_scopes WHERE server = ? AND conversation = ?').run(server, conversation)
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
  return api
}
