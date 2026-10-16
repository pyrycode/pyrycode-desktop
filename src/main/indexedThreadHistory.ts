import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { createHistoryDatabase } from './historyDatabase'
import { EncryptionUnavailableError, type SecretEncryption } from './secureStore'
import type { DiagnosticLog } from './diagnosticLog'
import { parseChatHistoryRequest, parseChatHistorySnapshot, threadHistoryCodec, INVALID_CHAT_HISTORY,
  UNSUPPORTED_CHAT_HISTORY_VERSION, MAX_CHAT_HISTORY_ITEMS, type ChatHistoryRequest, type ChatHistoryResult, type ChatHistorySnapshot, type ThreadSnapshot } from '../shared/chatHistory'

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
type Ref = { hash: string; count: number }
type Leaf = { ordinal: number; digest: string; position: string | null; id: number | null }
type Roots = { ids: Ref; order: Ref; ranges: Ref; sort: Ref }
type Mutable = { roots: Roots; nextOrdinal: number; nextArrival: number }
const empty = (): Ref => ({ hash: '', count: 0 })
const digest = (value: Uint8Array | string): string => createHash('sha256').update(value).digest('hex')
const numericKey = (n: number): string => n.toString(16).padStart(14, '0')
const bits = (key: string): string => [...key].map(c => Number.parseInt(c, 16).toString(2).padStart(4, '0')).join('')
function sortKey(value: unknown, arrival: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'ffffffffffffffff' + numericKey(arrival)
  const bytes = Buffer.alloc(8)
  bytes.writeDoubleBE(value === 0 ? 0 : value)
  if (bytes[0] & 128) for (let i = 0; i < bytes.length; i++) bytes[i] ^= 255
  else bytes[0] ^= 128
  return bytes.toString('hex') + numericKey(arrival)
}
function between(lower: string, upper: string | null): string {
  let prefix = '', i = 0
  for (;;) {
    const a = i < lower.length ? Number.parseInt(lower[i], 16) : 0
    const b = upper !== null && i < upper.length ? Number.parseInt(upper[i], 16) : 15
    if (b - a > 1) return prefix + Math.floor((a + b) / 2).toString(16)
    prefix += a.toString(16)
    if (a !== b) upper = null
    i++
  }
}
function reference(value: unknown): Ref {
  const r = object(value), hash = r.hash, count = natural(r.count)
  if (typeof hash !== 'string' || !/^(?:[0-9a-f]{64})?$/.test(hash) || (hash === '') !== (count === 0) ||
    !same(r, { hash, count })) throw INVALID_CHAT_HISTORY
  return { hash, count }
}
function mutable(value: unknown): Mutable {
  const v = object(value), r = object(v.roots)
  const roots = { ids: reference(r.ids), order: reference(r.order), ranges: reference(r.ranges), sort: reference(r.sort) }
  const parsed = { roots, nextOrdinal: natural(v.nextOrdinal), nextArrival: natural(v.nextArrival) }
  if (!same(parsed, value) || roots.ids.count !== roots.order.count || roots.ids.count !== roots.sort.count) throw INVALID_CHAT_HISTORY
  return parsed
}
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
    ...(v.mutable === undefined ? {} : { mutable: mutable(v.mutable) }),
    ...(!legacy && typeof v.generation === 'string' ? { generation: v.generation } : {}) }
  if (!same(parsed, value)) throw INVALID_CHAT_HISTORY
  return parsed
}

/** Callable main-process family; connection ownership and authorization remain with the caller. */
export function createIndexedThreadHistory(deps: {
  database: ReturnType<typeof createHistoryDatabase>; encryption: SecretEncryption; log: DiagnosticLog
}) {
  const { database, encryption, log } = deps
  // The protected header authenticates these content-free paths. Replaying any old
  // leaf or branch fails against its parent's current digest, including after reopen.
  function tree(db: Database.Database, identity: string, name: keyof Roots) {
    const pending = new Map<string, string | null>()
    function read(ref: Ref, path: string): { left: Ref; right: Ref; value: Leaf | null } {
      if (!ref.count) return { left: empty(), right: empty(), value: null }
      const row = pending.has(path) ? { payload: pending.get(path) } : db.prepare<[string, string, string], { payload: unknown }>(
        'SELECT payload FROM thread_auth WHERE scope = ? AND tree = ? AND path = ?').get(identity, name, path)
      if (!row || typeof row.payload !== 'string' || digest(path + row.payload) !== ref.hash) throw INVALID_CHAT_HISTORY
      const v = object(JSON.parse(row.payload)), left = reference(v.left), right = reference(v.right)
      let value: Leaf | null = null
      if (v.value !== null) {
        const l = object(v.value)
        if (typeof l.digest !== 'string' || !/^[0-9a-f]{64}$/.test(l.digest) ||
          l.position !== null && (typeof l.position !== 'string' || !/^[0-9a-f]+$/.test(l.position))) throw INVALID_CHAT_HISTORY
        value = { ordinal: natural(l.ordinal), digest: l.digest,
          position: typeof l.position === 'string' ? l.position : null, id: l.id === null ? null : natural(l.id) }
        if (!same(value, l)) throw INVALID_CHAT_HISTORY
      }
      if (!same(v, { left, right, value }) || left.count + right.count + (value ? 1 : 0) !== ref.count) throw INVALID_CHAT_HISTORY
      return { left, right, value }
    }
    function get(ref: Ref, key: string): Leaf | null {
      const path = bits(key)
      for (let i = 0; ; i++) {
        const n = read(ref, path.slice(0, i))
        if (i === path.length || !ref.count) return i === path.length ? n.value : null
        ref = path[i] === '0' ? n.left : n.right
      }
    }
    function set(ref: Ref, key: string, value: Leaf | null): Ref {
      const target = bits(key)
      function update(ref: Ref, path: string): Ref {
        const n = read(ref, path)
        if (path.length === target.length) n.value = value
        else if (target[path.length] === '0') n.left = update(n.left, path + '0')
        else n.right = update(n.right, path + '1')
        const count = n.left.count + n.right.count + (n.value ? 1 : 0)
        if (!count) {
          pending.set(path, null)
          return empty()
        }
        const payload = JSON.stringify(n), hash = digest(path + payload)
        pending.set(path, payload)
        return { hash, count }
      }
      return update(ref, '')
    }
    function window(ref: Ref, start: number, end: number): Leaf[] {
      const result: Leaf[] = []
      function visit(ref: Ref, path: string, offset: number): void {
        if (!ref.count || offset >= end || offset + ref.count <= start) return
        const n = read(ref, path), at = offset + (n.value ? 1 : 0)
        if (n.value && offset >= start) result.push(n.value)
        visit(n.left, path + '0', at); visit(n.right, path + '1', at + n.left.count)
      }
      visit(ref, '', 0); return result
    }
    function rank(ref: Ref, key: string): number {
      const target = bits(key)
      let result = 0
      for (let i = 0; ref.count; i++) {
        const n = read(ref, target.slice(0, i))
        if (i === target.length) return result
        if (n.value) result++
        if (target[i] === '1') result += n.left.count
        ref = target[i] === '0' ? n.left : n.right
      }
      return result
    }
    function flush(): void {
      for (const [path, payload] of pending) {
        if (payload === null) db.prepare('DELETE FROM thread_auth WHERE scope = ? AND tree = ? AND path = ?').run(identity, name, path)
        else db.prepare('INSERT OR REPLACE INTO thread_auth VALUES (?, ?, ?, ?)').run(identity, name, path, payload)
      }
      pending.clear()
    }
    return { get, set, window, rank, flush }
  }
  function selectedRow(db: Database.Database, identity: string, kind: string, leaf: Leaf): Row {
    const row = db.prepare<[string, string, number], Row>(`SELECT ${columns} FROM thread_records WHERE scope = ? AND kind = ? AND ordinal = ?`)
      .get(identity, kind, leaf.ordinal)
    if (!row || !(row.payload instanceof Uint8Array) || digest(row.payload) !== leaf.digest) throw INVALID_CHAT_HISTORY
    return row
  }
  function protect(db: Database.Database, identity: string, indexes: Omit<Row, 'payload'>, value: unknown): Row {
    const payload = Buffer.from(encryption.encrypt(Buffer.from(JSON.stringify({ scope: identity, ...indexes, value }))))
    db.prepare('INSERT OR REPLACE INTO thread_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(identity,
      indexes.kind, indexes.ordinal, indexes.arrival, indexes.item_order, indexes.range_ordinal, indexes.range_start, indexes.range_end, payload)
    return { ...indexes, payload }
  }
  function writeHeader(db: Database.Database, identity: string, h: ReturnType<typeof header>): void {
    const value = { metadata: h.metadata, itemCount: h.itemCount, rangeCount: h.rangeCount, hasArrival: h.hasArrival,
      ...(h.mutable ? { mutable: h.mutable } : {}), generation: h.generation }
    protect(db, identity, { kind: 'header', ordinal: 0, arrival: null, item_order: null, range_ordinal: null, range_start: null, range_end: null }, value)
  }
  function decode(row: Row, identity: string, generation = identity): unknown {
    if (!(row.payload instanceof Uint8Array)) throw INVALID_CHAT_HISTORY
    const envelope = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(encryption.decrypt(row.payload))))
    const { payload: ignored, ...indexes } = row
    void ignored
    if (!same(envelope, { scope: row.kind === 'header' ? identity : generation, ...indexes, value: envelope.value })) throw INVALID_CHAT_HISTORY
    return envelope.value
  }
  function item(db: Database.Database, row: Row, identity: string, h: ReturnType<typeof header>): unknown {
    const binding = object(decode(row, identity, h.mutable ? identity : h.generation)), id = natural(binding.id), rev = natural(binding.rev)
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
    if (h.mutable) {
      const m = h.mutable
      if (m.roots.order.count !== h.itemCount || m.roots.ranges.count !== h.rangeCount) throw INVALID_CHAT_HISTORY
      const placements = tree(db, identity, 'order').window(m.roots.order, 0, h.itemCount)
        .map(l => selectedRow(db, identity, 'item', l))
      const ranges = tree(db, identity, 'ranges').window(m.roots.ranges, 0, h.rangeCount)
        .map(l => decode(selectedRow(db, identity, 'range', l), identity))
      const items = placements.map(r => item(db, r, identity, h))
      const snapshot = parseChatHistorySnapshot({ version: 1, kind: 'daemon-items', serverId: server, conversationId: conversation,
        thread: { ...h.metadata, items, ranges, ...(h.hasArrival ? {
          arrivalOrder: [...placements].sort((a, b) => natural(a.arrival) - natural(b.arrival)).map(r => object(item(db, r, identity, h)).id)
        } : {}) } })
      if (rows.length !== h.itemCount + h.rangeCount + 1 ||
        db.prepare<[string], { n: number }>('SELECT count(*) AS n FROM thread_payloads WHERE scope = ?').get(identity)?.n !== h.itemCount) throw INVALID_CHAT_HISTORY
      placements.forEach((r, i) => {
        const value = object(items[i]), leaf = tree(db, identity, 'ids').get(m.roots.ids, numericKey(natural(value.id)))
        if (!leaf || leaf.ordinal !== r.ordinal || !(r.payload instanceof Uint8Array) || leaf.digest !== digest(r.payload)) throw INVALID_CHAT_HISTORY
      })
      return snapshot.kind === 'daemon-items' ? snapshot : null
    }
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
  function activate(db: Database.Database, identity: string, h: ReturnType<typeof header>, snapshot: ThreadSnapshot): Mutable {
    const m: Mutable = { roots: { ids: empty(), order: empty(), ranges: empty(), sort: empty() },
      nextOrdinal: Math.max(snapshot.items.length, snapshot.ranges.length), nextArrival: snapshot.items.length }
    const placements = db.prepare<[string], Row>(`SELECT ${columns} FROM thread_records WHERE scope = ? AND kind != 'header' ORDER BY kind, ordinal`).all(identity)
    const ids = tree(db, identity, 'ids'), ordered = tree(db, identity, 'order'), ranges = tree(db, identity, 'ranges'), sorted = tree(db, identity, 'sort')
    for (const r of placements) {
      const value = decode(r, identity, h.generation), { payload: ignored, ...indexes } = r
      void ignored
      if (r.kind === 'item' && !h.hasArrival) indexes.arrival = r.ordinal
      const rewritten = protect(db, identity, indexes, value)
      if (!(rewritten.payload instanceof Uint8Array)) throw INVALID_CHAT_HISTORY
      const position = numericKey(r.ordinal) + '8'
      const leaf = { ordinal: r.ordinal, digest: digest(rewritten.payload), position: r.kind === 'item' ? position : null,
        id: r.kind === 'item' ? natural(object(value).id) : null }
      if (r.kind === 'item') {
        m.roots.ids = ids.set(m.roots.ids, numericKey(natural(leaf.id)), leaf)
        m.roots.order = ordered.set(m.roots.order, position, leaf)
        const held = snapshot.items[r.ordinal]
        m.roots.sort = sorted.set(m.roots.sort, sortKey(held.order, indexes.arrival ?? r.ordinal), leaf)
      } else m.roots.ranges = ranges.set(m.roots.ranges, numericKey(natural(r.range_start)), leaf)
    }
    ids.flush(); ordered.flush(); ranges.flush(); sorted.flush()
    return m
  }
  function mutateThread(db: Database.Database, request: Extract<ChatHistoryRequest, { operation: 'mutateThread' }>): void {
    if (db.pragma('user_version', { simple: true }) === 6) db.exec(`CREATE TABLE IF NOT EXISTS thread_auth (
      scope TEXT NOT NULL REFERENCES thread_scopes(identity) ON DELETE CASCADE,
      tree TEXT NOT NULL, path TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(scope, tree, path)); PRAGMA user_version = 7`)
    const c = request.change, metadata = c.metadata
    let identity = scope(db, request.serverId, request.conversationId)
    let h: ReturnType<typeof header> | undefined
    if (identity !== null) {
      const row = db.prepare<[string], Row>(`SELECT ${columns} FROM thread_records WHERE scope = ? AND kind = 'header' AND ordinal = 0`).get(identity)
      if (!row) throw INVALID_CHAT_HISTORY
      h = header(decode(row, identity), request.serverId, request.conversationId)
      if (h.metadata.epoch !== metadata.epoch) {
        if (!c.acceptEpoch) throw INVALID_CHAT_HISTORY
        db.prepare('DELETE FROM thread_scopes WHERE identity = ?').run(identity)
        identity = null; h = undefined
      }
    }
    if (identity === null) {
      if (!c.acceptEpoch) throw INVALID_CHAT_HISTORY
      identity = randomUUID()
      db.prepare('INSERT INTO thread_scopes VALUES (?, ?, ?)').run(identity, Buffer.from(request.serverId, 'utf16le'), Buffer.from(request.conversationId, 'utf16le'))
      h = { metadata, itemCount: 0, rangeCount: 0, hasArrival: true, generation: randomUUID(),
        mutable: { roots: { ids: empty(), order: empty(), ranges: empty(), sort: empty() }, nextOrdinal: 0, nextArrival: 0 } }
    }
    if (!h) throw INVALID_CHAT_HISTORY
    let m = h.mutable
    if (!m) {
      const snapshot = load(db, request.serverId, request.conversationId)
      if (!snapshot) throw INVALID_CHAT_HISTORY
      m = activate(db, identity, h, snapshot.thread)
      h.hasArrival = true
    }
    const ids = tree(db, identity, 'ids'), ordered = tree(db, identity, 'order'), ranges = tree(db, identity, 'ranges'), sorted = tree(db, identity, 'sort')
    function erase(id: number): void {
      const leaf = ids.get(mutableState.roots.ids, numericKey(id))
      if (!leaf) return
      const row = selectedRow(db, owner, 'item', leaf), value = object(item(db, row, owner, { ...currentHeader, mutable: mutableState }))
      if (value.id !== id || leaf.position === null) throw INVALID_CHAT_HISTORY
      mutableState.roots.ids = ids.set(mutableState.roots.ids, numericKey(id), null)
      mutableState.roots.order = ordered.set(mutableState.roots.order, leaf.position, null)
      mutableState.roots.sort = sorted.set(mutableState.roots.sort, sortKey(value.order, natural(row.arrival)), null)
      db.prepare("DELETE FROM thread_records WHERE scope = ? AND kind = 'item' AND ordinal = ?").run(owner, leaf.ordinal)
      db.prepare('DELETE FROM thread_payloads WHERE scope = ? AND item_id = ?').run(owner, id)
    }
    // Captured constants keep nested work on this exact protected owner/header.
    const owner = identity, currentHeader = h, mutableState = m
    for (const id of c.removeIds) erase(id)
    const pending = new Map(c.items.map(item => [item.id, item]))
    function upsert(id: number): void {
      const entry = pending.get(id)
      if (!entry) return
      const value = entry, previous = ids.get(mutableState.roots.ids, numericKey(id))
      let arrival: number, ordinal: number, retainedPosition: string | null = null
      if (previous) {
        const row = selectedRow(db, owner, 'item', previous), held = object(item(db, row, owner, { ...currentHeader, mutable: mutableState }))
        if (held.id !== id || held.kind !== value.kind || previous.position === null) throw INVALID_CHAT_HISTORY
        if (natural(held.rev) >= value.rev) { pending.delete(id); return }
        arrival = natural(row.arrival); ordinal = row.ordinal
        if (same(held.order, value.order)) retainedPosition = previous.position
        if (retainedPosition === null) {
          mutableState.roots.order = ordered.set(mutableState.roots.order, previous.position, null)
          mutableState.roots.sort = sorted.set(mutableState.roots.sort, sortKey(held.order, arrival), null)
        }
      } else {
        arrival = natural(mutableState.nextArrival++); ordinal = natural(mutableState.nextOrdinal++)
      }
      const sort = sortKey(value.order, arrival)
      let position = retainedPosition
      if (position === null) {
        const nextRank = sorted.rank(mutableState.roots.sort, sort)
        const next = sorted.window(mutableState.roots.sort, nextRank, nextRank + 1)[0]
        const upper = next?.position ?? null, rank = upper === null ? mutableState.roots.order.count : ordered.rank(mutableState.roots.order, upper)
        const lower = ordered.window(mutableState.roots.order, rank - 1, rank)[0]?.position ?? ''
        position = between(lower, upper)
      }
      const payload = Buffer.from(encryption.encrypt(Buffer.from(JSON.stringify({ scope: owner, epoch: metadata.epoch,
        id, rev: value.rev, value }))))
      db.prepare('INSERT OR REPLACE INTO thread_payloads VALUES (?, ?, ?, ?)').run(owner, id, value.rev, payload)
      const row = protect(db, owner, { kind: 'item', ordinal, arrival, item_order: order(value.order),
        range_ordinal: null, range_start: null, range_end: null }, { id, rev: value.rev, digest: digest(payload) })
      if (!(row.payload instanceof Uint8Array)) throw INVALID_CHAT_HISTORY
      const leaf = { ordinal, digest: digest(row.payload), position, id }
      mutableState.roots.ids = ids.set(mutableState.roots.ids, numericKey(id), leaf)
      mutableState.roots.order = ordered.set(mutableState.roots.order, position, leaf)
      mutableState.roots.sort = sorted.set(mutableState.roots.sort, sort, leaf)
      pending.delete(id)
    }
    for (const id of [...pending.keys()]) upsert(id)
    for (const range of c.ranges) {
      let start = range.start, end = range.end
      const first = ranges.rank(m.roots.ranges, numericKey(start)), last = ranges.rank(m.roots.ranges, numericKey(end))
        + (ranges.get(m.roots.ranges, numericKey(end)) ? 1 : 0)
      for (const leaf of ranges.window(m.roots.ranges, Math.max(0, first - 1), last)) {
        const row = selectedRow(db, owner, 'range', leaf), r = threadHistoryCodec.ranges([decode(row, owner)])[0]
        if (r.end < start || r.start > end) continue
        start = Math.min(start, r.start); end = Math.max(end, r.end)
        m.roots.ranges = ranges.set(m.roots.ranges, numericKey(r.start), null)
        db.prepare("DELETE FROM thread_records WHERE scope = ? AND kind = 'range' AND ordinal = ?").run(owner, row.ordinal)
      }
      const ordinal = natural(m.nextOrdinal++), row = protect(db, owner, { kind: 'range', ordinal, arrival: null,
        item_order: null, range_ordinal: null, range_start: start, range_end: end }, { start, end })
      if (!(row.payload instanceof Uint8Array)) throw INVALID_CHAT_HISTORY
      m.roots.ranges = ranges.set(m.roots.ranges, numericKey(start), { ordinal, digest: digest(row.payload), position: null, id: null })
    }
    const old = h.metadata, fenced = old.repair !== null || (old.uncommittedVersion ?? 0) > old.checkpoint
    const checkpoint = fenced && !c.certified ? old.checkpoint : Math.max(old.checkpoint, metadata.checkpoint)
    const oldRepair = old.repair !== null && !(c.certified && metadata.checkpoint >= old.repair.throughVersion) ? old.repair : null
    const repairThrough = Math.max(oldRepair?.throughVersion ?? 0, metadata.repair?.throughVersion ?? 0, checkpoint)
    const repair = oldRepair || metadata.repair ? { fromVersion: checkpoint, throughVersion: repairThrough } : null
    const uncommittedVersion = Math.max(metadata.uncommittedVersion ?? 0,
      (old.uncommittedVersion ?? 0) > metadata.checkpoint || fenced && !c.certified ? old.uncommittedVersion ?? 0 : 0)
    h.metadata = threadHistoryCodec.metadata({ ...old, ...metadata, version: Math.max(old.version, metadata.version), checkpoint,
      uncommittedVersion, repair }, request.serverId, request.conversationId)
    h.mutable = m; h.generation = randomUUID(); h.itemCount = m.roots.ids.count; h.rangeCount = m.roots.ranges.count
    if (h.itemCount > MAX_CHAT_HISTORY_ITEMS || h.rangeCount > MAX_CHAT_HISTORY_ITEMS) throw INVALID_CHAT_HISTORY
    ids.flush(); ordered.flush(); ranges.flush(); sorted.flush()
    writeHeader(db, owner, h)
  }
  function mutablePage(db: Database.Database, identity: string, h: ReturnType<typeof header>, limit: number,
    token: Record<string, unknown> | null): ThreadHistoryResult {
    const m = h.mutable
    if (!m || h.itemCount !== m.roots.order.count || h.rangeCount !== m.roots.ranges.count) throw INVALID_CHAT_HISTORY
    if (token && (token.identity !== h.generation || typeof token.before !== 'number' || token.before > h.itemCount)) throw INVALID_CONTINUATION
    const end = token ? natural(token.before) : h.itemCount, start = Math.max(0, end - limit)
    const leaves = tree(db, identity, 'order').window(m.roots.order, start, end)
    const selected = leaves.map(l => selectedRow(db, identity, 'item', l))
    const items = threadHistoryCodec.items(selected.map(r => item(db, r, identity, h)))
    const rt = tree(db, identity, 'ranges'), evidence = new Map<number, Row>()
    function add(leaf: Leaf | undefined): void {
      if (leaf) evidence.set(leaf.ordinal, selectedRow(db, identity, 'range', leaf))
    }
    add(rt.window(m.roots.ranges, h.rangeCount - 1, h.rangeCount)[0])
    for (const value of items) {
      const n = order(value.order)
      if (n === null) continue
      const key = numericKey(n), exact = rt.get(m.roots.ranges, key), rank = rt.rank(m.roots.ranges, key)
      const leaf = exact ?? rt.window(m.roots.ranges, rank - 1, rank)[0]
      if (leaf) {
        const r = selectedRow(db, identity, 'range', leaf), range = threadHistoryCodec.ranges([decode(r, identity)])[0]
        if (range.start <= n && n < range.end) add(leaf)
      }
    }
    const ranges = threadHistoryCodec.ranges([...evidence.values()].sort((a, b) => natural(a.range_start) - natural(b.range_start))
      .map(r => decode(r, identity)))
    const continuation = start === 0 ? null : Buffer.from(encryption.encrypt(Buffer.from(JSON.stringify({
      format: 'daemon-items', identity: h.generation, before: start
    })))).toString('base64url')
    if (continuation !== null && continuation.length > MAX_CONTINUATION_LENGTH) throw INVALID_CHAT_HISTORY
    return { status: 'page', page: { partial: true, metadata: h.metadata, items, ranges,
      ...(h.hasArrival ? { arrivalPositions: selected.map(r => natural(r.arrival)) } : {}), continuation } }
  }
  function readPage(db: Database.Database, server: string, conversation: string, limit: number, token: Record<string, unknown> | null): ThreadHistoryResult {
    const identity = scope(db, server, conversation)
    if (identity === null) { if (token) throw INVALID_CONTINUATION; return { status: 'missing' } }
    const row = db.prepare<[string], Row>(`SELECT ${columns} FROM thread_records WHERE scope = ? AND kind = 'header' AND ordinal = 0`).get(identity)
    if (!row) throw INVALID_CHAT_HISTORY
    const h = header(decode(row, identity), server, conversation)
    if (h.mutable) return mutablePage(db, identity, h, limit, token)
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
        if (!['readThread', 'replaceThread', 'mutateThread', 'removeConversation', 'removeServer'].includes(request.operation)) throw INVALID_CHAT_HISTORY
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
          if (request.operation === 'mutateThread') {
            reading = false
            mutateThread(db, request)
            return { status: 'ok' }
          }
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
