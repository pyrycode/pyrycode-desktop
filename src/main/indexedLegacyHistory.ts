import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { createHistoryDatabase } from './historyDatabase'
import type { SecretEncryption } from './secureStore'
import { EncryptionUnavailableError } from './secureStore'
import type { DiagnosticLog } from './diagnosticLog'
import { parseChatHistoryRequest, parseChatHistorySnapshot, legacyHistoryCodec as codec, INVALID_CHAT_HISTORY,
  UNSUPPORTED_CHAT_HISTORY_VERSION, type ChatHistorySnapshot, type ChatHistoryResult } from '../shared/chatHistory'

type Timeline = Extract<ChatHistorySnapshot, { kind: 'timeline' }>
export type LegacyHistoryContinuation = { format: 'legacy-v1'; serverId: string; conversationId: string; snapshotId: string; before: number }
export type LegacyHistoryPageResult = Exclude<ChatHistoryResult, { status: 'stored' } | { status: 'ok' }> | {
  status: 'newest-page' | 'before-page'; items: Timeline['items']; rowKeys: number[];
  savedCoverage: Timeline['coverage']; newestCursor?: string; display?: Timeline['display']; servedIds?: number[];
  receipts?: ({ identity: number; partial: true; ids: number[]; cursor: string; atStart: boolean })[];
  cursorAnchors?: { receiptIdentity: number; id: number; cursor: string; atStart: boolean }[];
  gaps?: (NonNullable<Timeline['gaps']>[number] & { identity: number; partial: true })[];
  continuation: LegacyHistoryContinuation | null
}
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
  const columns = 'kind, ordinal, parent, entry_id, last_id, row_key, older_id, newer_id, payload'
  function decode(r: RecordRow, snapshotId: string): unknown {
    if (!(r.payload instanceof Uint8Array)) throw INVALID_CHAT_HISTORY
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(encryption.decrypt(r.payload)))
    if (isObject(value) && value.indexedLegacyRecord === 1) {
      const saved = object(value.record)
      if (value.snapshotId !== snapshotId || (['kind', 'ordinal', 'parent', 'entry_id', 'last_id', 'row_key', 'older_id', 'newer_id'] as const)
        .some(key => saved[key] !== r[key])) throw INVALID_CHAT_HISTORY
      return saved.payload
    }
    return value
  }
  function checked(r: RecordRow, payload: unknown, indexes: Partial<RecordRow> = {}, parent = 0): void {
    const expected = { entry_id: null, last_id: null, row_key: null, older_id: null, newer_id: null, ...indexes }
    if (!Number.isSafeInteger(r.ordinal) || r.ordinal < 0 || r.ordinal >= 100_000 || r.parent !== parent ||
      (['entry_id', 'last_id', 'row_key', 'older_id', 'newer_id'] as const).some(key => r[key] !== expected[key]) ||
      JSON.stringify(r.payload) !== JSON.stringify(payload)) throw INVALID_CHAT_HISTORY
  }
  async function page(value: unknown, before: boolean): Promise<LegacyHistoryPageResult> {
    const report = (r: LegacyHistoryPageResult): LegacyHistoryPageResult => {
      log.event({ event: 'history-storage-result', code: r.status === 'error' ? r.code : 'stored' }); return r
    }
    let request: { serverId: string; conversationId: string; limit: number; continuation?: LegacyHistoryContinuation }
    try {
      const v = object(value)
      if (Object.keys(v).some(k => !['serverId', 'conversationId', 'limit', ...(before ? ['continuation'] : [])].includes(k)) ||
        typeof v.limit !== 'number' || !Number.isInteger(v.limit) || v.limit < 1 || v.limit > 200) throw INVALID_CHAT_HISTORY
      const owner = parseChatHistoryRequest({ operation: 'readTimeline', serverId: v.serverId, conversationId: v.conversationId })
      if (owner.operation !== 'readTimeline') throw INVALID_CHAT_HISTORY
      request = { serverId: owner.serverId, conversationId: owner.conversationId, limit: v.limit }
      if (before) {
        const c = object(v.continuation)
        if (Object.keys(c).length !== 5 || !['format', 'serverId', 'conversationId', 'snapshotId', 'before'].every(k => k in c) ||
          c.format !== 'legacy-v1' || c.serverId !== request.serverId || c.conversationId !== request.conversationId ||
          typeof c.snapshotId !== 'string' || !/^[0-9a-f-]{36}$/.test(c.snapshotId) ||
          typeof c.before !== 'number' || !Number.isSafeInteger(c.before) || c.before <= 0) throw INVALID_CHAT_HISTORY
        request.continuation = { format: 'legacy-v1', serverId: request.serverId,
          conversationId: request.conversationId, snapshotId: c.snapshotId, before: c.before }
      }
    } catch { return report({ status: 'error', code: 'invalid-request' }) }
    log.event({ event: 'history-storage-operation', code: before ? 'readTimelineBeforePage' : 'readTimelineNewestPage' })
    try {
      if (!encryption.isAvailable()) return report({ status: 'error', code: 'encryption-unavailable' })
      return report(database.transaction((db): LegacyHistoryPageResult => {
        const scope = db.prepare<[Buffer, Buffer], { identity: string }>(
          'SELECT identity FROM legacy_scopes WHERE server = ? AND conversation = ?')
          .get(Buffer.from(request.serverId, 'utf16le'), Buffer.from(request.conversationId, 'utf16le'))
        const c = request.continuation
        if (!scope) return before ? { status: 'error', code: 'invalid-request' } : { status: 'missing' }
        if (typeof scope.identity !== 'string' || !/^[0-9a-f-]{36}$/.test(scope.identity)) throw INVALID_CHAT_HISTORY
        if (c && (c.snapshotId !== scope.identity || !db.prepare(
          "SELECT ordinal FROM legacy_records WHERE scope = ? AND kind = 'row' AND parent = 0 AND ordinal = ?").get(scope.identity, c.before)))
          return { status: 'error', code: 'invalid-request' }
        const decodeSelected = (r: RecordRow): unknown => decode(r, scope.identity)
        const select = (where: string, ...args: (number | string)[]): RecordRow[] => db.prepare<(number | string)[], RecordRow>(
          `SELECT ${columns} FROM legacy_records WHERE scope = ? AND ${where}`).all(scope.identity, ...args)
        const one = (kind: string, ordinal: number): RecordRow => {
          const rows = select('kind = ? AND parent = 0 AND ordinal = ?', kind, ordinal)
          if (rows.length !== 1) throw INVALID_CHAT_HISTORY
          const r = rows[0]; return { ...r, payload: decodeSelected(r) }
        }
        const hr = one('header', 0); const h = object(hr.payload)
        const coverage = codec.coverage(h.coverage); const prepended = codec.id(h.prependedRows)
        if (typeof h.served !== 'boolean' || typeof h.display !== 'boolean' || typeof h.gaps !== 'boolean') throw INVALID_CHAT_HISTORY
        const nextKey = h.nextRowKey === undefined ? undefined : codec.key(h.nextRowKey)
        if (nextKey !== undefined && nextKey > Number.MAX_SAFE_INTEGER - 100001) throw INVALID_CHAT_HISTORY
        const newestCursor = h.newestCursor === undefined ? undefined : codec.cursor(h.newestCursor)
        if ((h.served || h.gaps || newestCursor !== undefined) && coverage.status !== 'received') throw INVALID_CHAT_HISTORY
        checked(hr, { prependedRows: prepended, coverage, ...(newestCursor === undefined ? {} : { newestCursor }),
          ...(nextKey === undefined ? {} : { nextRowKey: nextKey }), served: h.served, display: h.display, gaps: h.gaps })
        const held = select("kind = 'row' AND parent = 0 AND ordinal < ? ORDER BY ordinal DESC LIMIT ?",
          c?.before ?? Number.MAX_SAFE_INTEGER, request.limit).reverse()
        const items = held.map(r => { r.payload = decodeSelected(r); return codec.row(r.payload) })
        const keys = held.map(r => codec.key(r.row_key))
        held.forEach((r, i) => {
          if (i > 0 && r.ordinal !== held[i - 1].ordinal + 1 || nextKey === undefined && keys[i] !== r.ordinal - prepended ||
            nextKey !== undefined && keys[i] >= nextKey) throw INVALID_CHAT_HISTORY
          checked(r, items[i], { row_key: keys[i] })
        })
        if (new Set(keys).size !== keys.length) throw INVALID_CHAT_HISTORY
        const bindings = new Map(keys.map((key, i) => [key, items[i]]))
        const displayRows = keys.length ? select(`kind = 'display' AND row_key IN (${keys.map(() => '?').join(',')}) ORDER BY ordinal`, ...keys) : []
        const display = codec.display(displayRows.map(r => { r.payload = decodeSelected(r); return r.payload }), bindings)
        displayRows.forEach((r, i) => { checked(r, display[i], {
          entry_id: display[i].id, last_id: display[i].lastId ?? display[i].id, row_key: display[i].rowKey ?? null }) })
        if (!h.display && display.length) throw INVALID_CHAT_HISTORY
        const ranges = display.map(d => [d.id, d.lastId ?? d.id])
        const selectRanges = (kind: 'served' | 'receipt-id'): RecordRow[] => {
          const rows: RecordRow[] = []
          // A held row may have many fragments; keep SQL expression/binding counts bounded too.
          for (let i = 0; i < ranges.length; i += 100) {
            const batch = ranges.slice(i, i + 100)
            rows.push(...select(`kind = ? AND (${batch.map(() => '(entry_id >= ? AND entry_id <= ?)').join(' OR ')}) ORDER BY ordinal`, kind, ...batch.flat()))
          }
          return rows
        }
        const ids = selectRanges('served'); const membership = selectRanges('receipt-id')
        const numbers = (rows: RecordRow[], kind: 'id' | 'key') => rows.map(r => {
          const n = codec[kind](decodeSelected(r)); r.payload = n
          if (!Number.isSafeInteger(r.parent) || r.parent < 0 || r.parent >= 100_000) throw INVALID_CHAT_HISTORY
          checked(r, n, kind === 'id' ? { entry_id: n } : { row_key: n }, r.kind === 'served' ? 0 : r.parent); return n
        })
        const servedIds = numbers(ids, 'id'); numbers(membership, 'id')
        const receiptIds = new Set(membership.map(r => codec.id(r.payload)))
        if (servedIds.some((id, i) => i > 0 && id <= servedIds[i - 1]) ||
          membership.some(r => !servedIds.includes(codec.id(r.payload))) || servedIds.some(id => !receiptIds.has(id))) throw INVALID_CHAT_HISTORY
        const gapRows = new Map<number, RecordRow>(); const gapKeys = new Map<number, RecordRow[]>()
        const anchors = new Map<number, RecordRow>()
        for (const [lo, hi] of ranges) for (const r of select(
          "kind = 'gap' AND older_id <= ? AND newer_id >= ?", hi, lo)) gapRows.set(r.ordinal, r)
        if (keys.length) for (const r of select(`kind = 'gap-key' AND row_key IN (${keys.map(() => '?').join(',')}) ORDER BY parent, ordinal`, ...keys)) {
          const group = gapKeys.get(r.parent) ?? []; group.push(r); gapKeys.set(r.parent, group)
        }
        for (const identity of gapKeys.keys()) gapRows.set(identity, one('gap', identity))
        const gaps = [...gapRows.values()].sort((a, b) => a.ordinal - b.ordinal).map(r => {
          if (r.payload instanceof Uint8Array) r.payload = decodeSelected(r)
          const raw = object(r.payload); const { legacy, refused, ...rest } = raw
          if (typeof legacy !== 'boolean' || typeof refused !== 'boolean') throw INVALID_CHAT_HISTORY
          const selectedKeys = numbers(gapKeys.get(r.ordinal) ?? [], 'key')
          const parsed = codec.gap({ ...rest, ...(legacy ? { legacyRowKeys: selectedKeys } : {}) }, keys)
          checked(r, { ...rest, legacy, refused }, { older_id: parsed.olderId ?? null, newer_id: parsed.newerId })
          // Only the nearest receipt start is a cursor anchor; no whole membership walk.
          const anchor = select("kind = 'receipt-id' AND ordinal = 0 AND entry_id >= ? ORDER BY entry_id, parent LIMIT 1", parsed.newerId)[0]
          if (anchor && !anchors.has(anchor.parent)) { numbers([anchor], 'id'); anchors.set(anchor.parent, anchor) }
          return { ...parsed, identity: r.ordinal, partial: true as const }
        })
        const receiptHeaders = new Map<number, ReturnType<typeof codec.receipt>>()
        for (const identity of new Set([...membership.map(r => r.parent), ...anchors.keys()])) {
          const r = one('receipt', identity); const receipt = codec.receipt(r.payload); checked(r, receipt)
          receiptHeaders.set(identity, receipt)
        }
        const receipts = [...new Set(membership.map(r => r.parent))].sort((a, b) => a - b).map(identity => {
          const ids = membership.filter(m => m.parent === identity).sort((a, b) => a.ordinal - b.ordinal).map(m => codec.id(m.payload))
          if (ids.some((id, i) => i > 0 && id <= ids[i - 1])) throw INVALID_CHAT_HISTORY
          const receipt = receiptHeaders.get(identity)
          if (!receipt) throw INVALID_CHAT_HISTORY
          return { ...receipt, identity, partial: true as const, ids }
        })
        const cursorAnchors = [...anchors].map(([receiptIdentity, r]) => {
          const receipt = receiptHeaders.get(receiptIdentity)
          if (!receipt) throw INVALID_CHAT_HISTORY
          return { ...receipt, receiptIdentity, id: codec.id(r.payload) }
        })
        if ((!h.served && (servedIds.length || receipts.length || cursorAnchors.length)) || !h.gaps && gaps.length) throw INVALID_CHAT_HISTORY
        const first = held[0]?.ordinal
        // Full replacement assigns contiguous zero-based ordinals; no extra payload probe is needed.
        const older = first !== undefined && first > 0
        return { status: before ? 'before-page' : 'newest-page', items, rowKeys: keys, savedCoverage: coverage,
          ...(newestCursor === undefined ? {} : { newestCursor }), ...(h.display ? { display } : {}),
          ...(h.served ? { servedIds, receipts, cursorAnchors } : {}), ...(h.gaps ? { gaps } : {}),
          continuation: older && first !== undefined ? { format: 'legacy-v1', serverId: request.serverId,
            conversationId: request.conversationId, snapshotId: scope.identity, before: first } : null }
      }))
    } catch (error) {
      return report({ status: 'error', code: error === UNSUPPORTED_CHAT_HISTORY_VERSION ? 'unsupported-version'
        : error instanceof EncryptionUnavailableError ? 'encryption-unavailable' : 'unreadable' })
    }
  }
  function load(db: Database.Database, serverId: string, conversationId: string): Timeline | null {
    const scope = db.prepare<[Buffer, Buffer], { identity: string }>(
      'SELECT identity FROM legacy_scopes WHERE server = ? AND conversation = ?')
      .get(Buffer.from(serverId, 'utf16le'), Buffer.from(conversationId, 'utf16le'))
    if (!scope) return null
    const stored = db.prepare<[string], RecordRow>('SELECT kind, ordinal, parent, entry_id, last_id, row_key, older_id, newer_id, payload FROM legacy_records WHERE scope = ? ORDER BY kind, parent, ordinal').all(scope.identity)
    const decoded = stored.map(row => ({ ...row, payload: decode(row, scope.identity) }))
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
  const api = {
    newestPage: (value: unknown): Promise<LegacyHistoryPageResult> => page(value, false),
    beforePage: (value: unknown): Promise<LegacyHistoryPageResult> => page(value, true),
    async execute(value: unknown): Promise<ChatHistoryResult> { return api.executeSync(value) },
    /** Main-only synchronous seam: the caller must throw classified errors to roll back its outer transaction. */
    executeSync(value: unknown): ChatHistoryResult {
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
                const payload = encryption.encrypt(new TextEncoder().encode(JSON.stringify({ indexedLegacyRecord: 1, snapshotId: identity, record: r })))
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
  return api
}
