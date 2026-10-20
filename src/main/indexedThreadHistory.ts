import { isSameRevisionTextExtension } from '../shared/threadTextExtension'
import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { createHistoryDatabase } from './historyDatabase'
import { EncryptionUnavailableError, type SecretEncryption } from './secureStore'
import type { DiagnosticLog } from './diagnosticLog'
import { MAX_SERVER_ID_LENGTH } from '../shared/ipc/unpair'
import { parseChatHistoryRequest, parseChatHistorySnapshot, threadHistoryCodec, INVALID_CHAT_HISTORY,
  UNSUPPORTED_CHAT_HISTORY_VERSION, MAX_CHAT_HISTORY_ITEMS, type ChatHistoryRequest, type ChatHistoryResult, type ChatHistorySnapshot, type ThreadSnapshot } from '../shared/chatHistory'

export type { ThreadHistoryPage } from '../shared/chatHistory'
export type ThreadHistoryResult = ChatHistoryResult
type Row = { kind: string; ordinal: number; arrival: number | null; item_order: number | null;
  range_ordinal: number | null; range_start: number | null; range_end: number | null; payload: unknown }
const columns = 'kind, ordinal, arrival, item_order, range_ordinal, range_start, range_end, payload'
const INVALID_CONTINUATION = new Error('invalid local history continuation')
const MAX_CONTINUATION_LENGTH = 65536
type Ref = { hash: string; count: number }
type SequenceRef = Ref & { key: string; height: number; shown?: number; active?: number }
type Leaf = { ordinal: number; digest: string; position: string | null; id: number | null; flags?: number }
type Roots = { ids: Ref; order: Ref; ranges: Ref; sort: Ref; endings?: Ref }
type Mutable = { roots: Roots; nextOrdinal: number; nextArrival: number; sequence?: SequenceRef; nodes?: number }
const empty = (): Ref => ({ hash: '', count: 0 })
const emptySequence = (): SequenceRef => ({ ...empty(), key: '', height: 0 })
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
function sequenceReference(value: unknown): SequenceRef {
  const v = object(value), key = v.key, height = natural(v.height)
  const ref = reference({ hash: v.hash, count: v.count })
  if (typeof key !== 'string' || !/^(?:[0-9a-f]{14})?$/.test(key) || height > 64 ||
    (ref.count === 0) !== (key === '') || (ref.count === 0) !== (height === 0)) throw INVALID_CHAT_HISTORY
  const parsed = { ...ref, key, height, ...(v.shown === undefined ? {} : { shown: natural(v.shown), active: natural(v.active) }) }
  if ((parsed.shown ?? 0) > ref.count || (parsed.active ?? 0) > ref.count) throw INVALID_CHAT_HISTORY
  if (!same(parsed, value)) throw INVALID_CHAT_HISTORY
  return parsed
}
function reference(value: unknown): Ref {
  const r = object(value), hash = r.hash, count = natural(r.count)
  if (typeof hash !== 'string' || !/^(?:[0-9a-f]{64})?$/.test(hash) || (hash === '') !== (count === 0) ||
    !same(r, { hash, count })) throw INVALID_CHAT_HISTORY
  return { hash, count }
}
function mutable(value: unknown): Mutable {
  const v = object(value), r = object(v.roots)
  const roots = { ids: reference(r.ids), order: reference(r.order), ranges: reference(r.ranges), sort: reference(r.sort),
    ...(r.endings === undefined ? {} : { endings: reference(r.endings) }) }
  const parsed = { roots, nextOrdinal: natural(v.nextOrdinal), nextArrival: natural(v.nextArrival),
    ...(v.sequence === undefined ? {} : { sequence: sequenceReference(v.sequence) }),
    ...(v.nodes === undefined ? {} : { nodes: natural(v.nodes) }) }
  if (!same(parsed, value) || roots.ids.count !== (parsed.sequence ?? roots.order).count || roots.ids.count !== roots.sort.count ||
    (parsed.nodes ?? 0) > MAX_CHAT_HISTORY_ITEMS) throw INVALID_CHAT_HISTORY
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
function resetIdentity(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_SERVER_ID_LENGTH) throw INVALID_CHAT_HISTORY
  return value
}
function order(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b) }
const flags = (item: ThreadSnapshot['items'][number]): number => Number(item.shown === true) + 2 * Number(item.active === true)
function attribution(item: Readonly<Record<string, unknown>>): string | null {
  return typeof item.session === 'string' && item.session !== '' && typeof item.turn === 'string' && item.turn !== ''
    ? digest(JSON.stringify([item.session, item.agent, item.turn, item.parent ?? null])) : null
}
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
    ...(v.persistenceOwner === undefined ? {} : { persistenceOwner: resetIdentity(v.persistenceOwner) }),
    ...(v.persistence === undefined ? {} : { persistence: pendingSave(v.persistence) }),
    ...(v.resetId === undefined ? {} : { resetId: resetIdentity(v.resetId) }),
    ...(v.availabilityStart === undefined ? {} : { availabilityStart: natural(v.availabilityStart) }),
    ...(v.mutable === undefined ? {} : { mutable: mutable(v.mutable) }),
    ...(!legacy && typeof v.generation === 'string' ? { generation: v.generation } : {}) }
  if (!same(parsed, value)) throw INVALID_CHAT_HISTORY
  return parsed
}
function pendingSave(value: unknown): { id: string; next: number; parts: number } {
  const v = object(value), parsed = { id: resetIdentity(v.id), next: natural(v.next), parts: natural(v.parts) }
  if (!same(parsed, value) || !parsed.id || parsed.parts < 2 || parsed.next < 1 || parsed.next >= parsed.parts)
    throw INVALID_CHAT_HISTORY
  return parsed
}

/** Callable main-process family; connection ownership and authorization remain with the caller. */
export function createIndexedThreadHistory(deps: {
  database: ReturnType<typeof createHistoryDatabase>; encryption: SecretEncryption; log: DiagnosticLog
}) {
  const { database, encryption, log } = deps
  function protectToken(value: unknown): string {
    const token = Buffer.from(encryption.encrypt(Buffer.from(JSON.stringify(value)))).toString('base64url')
    if (!token || token.length > MAX_CONTINUATION_LENGTH) throw INVALID_CHAT_HISTORY
    return token
  }
  function unprotectToken(value: string): Record<string, unknown> {
    return object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(encryption.decrypt(Buffer.from(value, 'base64url')))))
  }
  function ring(value: unknown): { boundary: number; cursor: number | null; wrapped: boolean } {
    const v = object(value), boundary = natural(v.boundary), cursor = v.cursor === null ? null : natural(v.cursor)
    if (typeof v.wrapped !== 'boolean' || Object.keys(v).length !== 3 || !v.wrapped && cursor === null) throw INVALID_CONTINUATION
    return { boundary, cursor, wrapped: v.wrapped }
  }
  // An AVL sequence preserves arbitrary admitted held order without fractional labels.
  // Parent rows are hints only: rank authenticates the hinted route from the current root.
  function sequence(db: Database.Database, identity: string) {
    type Node = { left: SequenceRef; right: SequenceRef; value: Leaf }
    const pending = new Map<string, string | null>()
    const verified = new Map<string, Node>()
    const readText = (name: string, key: string): unknown => pending.has(name + ':' + key) ? pending.get(name + ':' + key)
      : db.prepare<[string, string, string], { payload: unknown }>('SELECT payload FROM thread_auth WHERE scope = ? AND tree = ? AND path = ?')
        .get(identity, name, key)?.payload
    function read(ref: SequenceRef, balanced = true): Node {
      const proof = JSON.stringify([ref, balanced]), cached = verified.get(proof)
      if (cached) return { ...cached }
      const text = readText('sequence', ref.key)
      if (!ref.count || typeof text !== 'string' || digest(ref.key + text) !== ref.hash) throw INVALID_CHAT_HISTORY
      const v = object(JSON.parse(text)), left = sequenceReference(v.left), right = sequenceReference(v.right), l = object(v.value)
      const value: Leaf = { ordinal: natural(l.ordinal), digest: String(l.digest), position: String(l.position), id: natural(l.id),
        ...(l.flags === undefined ? {} : { flags: natural(l.flags) }) }
      if (!/^[0-9a-f]{64}$/.test(value.digest) || value.position !== numericKey(value.ordinal) ||
        ref.key !== value.position || ref.count !== left.count + right.count + 1 ||
        ref.height !== Math.max(left.height, right.height) + 1 || balanced && Math.abs(left.height - right.height) > 1 ||
        (value.flags ?? 0) > 3 || ref.shown !== undefined && (ref.shown !== (left.shown ?? 0) + (right.shown ?? 0) + Number(Boolean((value.flags ?? 0) & 1)) ||
          ref.active !== (left.active ?? 0) + (right.active ?? 0) + Number(Boolean((value.flags ?? 0) & 2))) ||
        !same(v, { left, right, value })) throw INVALID_CHAT_HISTORY
      const result = { left, right, value }; verified.set(proof, result); return { ...result }
    }
    function write(n: Node): SequenceRef {
      const key = numericKey(n.value.ordinal), payload = JSON.stringify(n)
      pending.set('sequence:' + key, payload)
      for (const child of [n.left, n.right]) if (child.count) pending.set('parent:' + child.key, key)
      const ref = { hash: digest(key + payload), count: n.left.count + n.right.count + 1, key,
        height: Math.max(n.left.height, n.right.height) + 1,
        shown: (n.left.shown ?? 0) + (n.right.shown ?? 0) + Number(Boolean((n.value.flags ?? 0) & 1)),
        active: (n.left.active ?? 0) + (n.right.active ?? 0) + Number(Boolean((n.value.flags ?? 0) & 2)) }
      // Reuse our own construction under its exact proof, within this operation only.
      // Rotations may construct a temporary unbalanced node; it has no strict proof yet.
      verified.set(JSON.stringify([ref, false]), n)
      if (Math.abs(n.left.height - n.right.height) <= 1) verified.set(JSON.stringify([ref, true]), n)
      return ref
    }
    function balance(n: Node): SequenceRef {
      if (n.left.height > n.right.height + 1) {
        let left = read(n.left)
        if (left.right.height > left.left.height) {
          const pivot = read(left.right)
          n.left = write({ ...pivot, left: write({ ...left, right: pivot.left }) }); left = read(n.left, false)
        }
        return write({ ...left, right: write({ ...n, left: left.right }) })
      }
      if (n.right.height > n.left.height + 1) {
        let right = read(n.right)
        if (right.left.height > right.right.height) {
          const pivot = read(right.left)
          n.right = write({ ...pivot, right: write({ ...right, left: pivot.right }) }); right = read(n.right, false)
        }
        return write({ ...right, left: write({ ...n, right: right.left }) })
      }
      return write(n)
    }
    function rank(root: SequenceRef, key: string): number {
      const route = [key]
      while (route.at(-1) !== root.key) {
        const parent = readText('parent', route[route.length - 1])
        if (typeof parent !== 'string' || !parent || route.includes(parent) || route.length > 64) throw INVALID_CHAT_HISTORY
        route.push(parent)
      }
      let ref = root, rank = 0
      for (let i = route.length - 1; i >= 0; i--) {
        if (ref.key !== route[i]) throw INVALID_CHAT_HISTORY
        const n = read(ref)
        if (i === 0) return rank + n.left.count
        if (n.left.key === route[i - 1]) ref = n.left
        else if (n.right.key === route[i - 1]) { rank += n.left.count + 1; ref = n.right }
        else throw INVALID_CHAT_HISTORY
      }
      throw INVALID_CHAT_HISTORY
    }
    function window(root: SequenceRef, start: number, end: number, filter?: 'shown' | 'active'): Leaf[] {
      const result: Leaf[] = []
      const count = (ref: SequenceRef): number => filter ? ref[filter] ?? 0 : ref.count
      function visit(ref: SequenceRef, offset: number): void {
        if (!count(ref) || offset >= end || offset + count(ref) <= start) return
        const n = read(ref), at = offset + count(n.left), include = !filter || Boolean((n.value.flags ?? 0) & (filter === 'shown' ? 1 : 2))
        visit(n.left, offset)
        if (include && at >= start && at < end) result.push(n.value)
        visit(n.right, at + Number(include))
      }
      visit(root, 0); return result
    }
    function set(root: SequenceRef, at: number, value: Leaf | null, insert = false): SequenceRef {
      function update(ref: SequenceRef, index: number): SequenceRef {
        if (!ref.count) {
          if (!value || !insert || index !== 0) throw INVALID_CHAT_HISTORY
          return write({ left: emptySequence(), right: emptySequence(), value })
        }
        const n = read(ref)
        if (index < n.left.count || insert && index === n.left.count) n.left = update(n.left, index)
        else if (index > n.left.count) n.right = update(n.right, index - n.left.count - 1)
        else if (value) n.value = value
        else {
          pending.set('sequence:' + ref.key, null); pending.set('parent:' + ref.key, null)
          if (!n.left.count) return n.right
          if (!n.right.count) return n.left
          const successor = window(n.right, 0, 1)[0]
          n.right = set(n.right, 0, null); n.value = successor
        }
        return balance(n)
      }
      const result = update(root, at)
      if (result.count) pending.set('parent:' + result.key, '')
      return result
    }
    function* flushSteps(): Generator<void> {
      for (const [address, payload] of pending) {
        const [name, key] = address.split(':')
        if (payload === null) db.prepare('DELETE FROM thread_auth WHERE scope = ? AND tree = ? AND path = ?').run(identity, name, key)
        else db.prepare('INSERT OR REPLACE INTO thread_auth VALUES (?, ?, ?, ?)').run(identity, name, key, payload)
        yield
      }
      pending.clear()
    }
    function flush(): void { for (const ignored of flushSteps()) void ignored }
    return { rank, window, set, flush, flushSteps }
  }
  // The protected header authenticates these content-free paths. Replaying any old
  // leaf or branch fails against its parent's current digest, including after reopen.
  function tree(db: Database.Database, identity: string, name: keyof Roots) {
    const pending = new Map<string, string | null>()
    const verified = new Map<string, { left: Ref; right: Ref; value: Leaf | null }>()
    function read(ref: Ref, path: string): { left: Ref; right: Ref; value: Leaf | null } {
      if (!ref.count) return { left: empty(), right: empty(), value: null }
      const proof = JSON.stringify([ref, path]), cached = verified.get(proof)
      if (cached) return { ...cached }
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
          position: typeof l.position === 'string' ? l.position : null, id: l.id === null ? null : natural(l.id),
          ...(l.flags === undefined ? {} : { flags: natural(l.flags) }) }
        if (!same(value, l)) throw INVALID_CHAT_HISTORY
      }
      if (!same(v, { left, right, value }) || left.count + right.count + (value ? 1 : 0) !== ref.count) throw INVALID_CHAT_HISTORY
      const result = { left, right, value }; verified.set(proof, result); return { ...result }
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
        const result = { hash, count }
        verified.set(JSON.stringify([result, path]), n)
        return result
      }
      return update(ref, '')
    }
    function* windowSteps(ref: Ref, start: number, end: number): Generator<Leaf> {
      function* visit(ref: Ref, path: string, offset: number): Generator<Leaf> {
        if (!ref.count || offset >= end || offset + ref.count <= start) return
        const n = read(ref, path), at = offset + (n.value ? 1 : 0)
        if (n.value && offset >= start) yield n.value
        yield* visit(n.left, path + '0', at); yield* visit(n.right, path + '1', at + n.left.count)
      }
      yield* visit(ref, '', 0)
    }
    function window(ref: Ref, start: number, end: number): Leaf[] { return Array.from(windowSteps(ref, start, end)) }
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
    function* flushSteps(): Generator<void> {
      for (const [path, payload] of pending) {
        if (payload === null) db.prepare('DELETE FROM thread_auth WHERE scope = ? AND tree = ? AND path = ?').run(identity, name, path)
        else db.prepare('INSERT OR REPLACE INTO thread_auth VALUES (?, ?, ?, ?)').run(identity, name, path, payload)
        yield
      }
      pending.clear()
    }
    function flush(): void { for (const ignored of flushSteps()) void ignored }
    return { get, set, window, windowSteps, rank, flush, flushSteps }
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
      ...(h.persistenceOwner === undefined ? {} : { persistenceOwner: h.persistenceOwner }),
      ...(h.persistence === undefined ? {} : { persistence: h.persistence }),
      ...(h.resetId === undefined ? {} : { resetId: h.resetId }),
      ...(h.availabilityStart === undefined ? {} : { availabilityStart: h.availabilityStart }),
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
  function load(db: Database.Database, server: string, conversation: string, legacy = false, allowPending = false) {
    const identity = scope(db, server, conversation)
    if (identity === null) return null
    const rows = db.prepare<[string], Row>(`SELECT ${columns} FROM thread_records WHERE scope = ? ORDER BY kind, ordinal`).all(identity)
    const first = rows.find(r => r.kind === 'header')
    if (!first) throw INVALID_CHAT_HISTORY
    const h = header(decode(first, identity), server, conversation, legacy)
    if (h.persistence && !allowPending) throw INVALID_CHAT_HISTORY
    if (h.mutable) {
      const m = h.mutable
      if ((m.sequence ?? m.roots.order).count !== h.itemCount || m.roots.ranges.count !== h.rangeCount) throw INVALID_CHAT_HISTORY
      const placements = (m.sequence ? sequence(db, identity).window(m.sequence, 0, h.itemCount)
        : tree(db, identity, 'order').window(m.roots.order, 0, h.itemCount))
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
    const previousHeader = previous === null ? undefined : db.prepare<[string], Row>(`SELECT ${columns} FROM thread_records WHERE scope = ? AND kind = 'header' AND ordinal = 0`).get(identity)
    const keepIndexes = previousHeader && header(decode(previousHeader, identity), snapshot.serverId, snapshot.conversationId).mutable !== undefined
    const retained = new Map(db.prepare<[string], { item_id: number; payload: Buffer }>(
      'SELECT item_id, payload FROM thread_payloads WHERE scope = ?').all(identity).map(r => [r.item_id, r.payload]))
    const old = new Map(previous?.epoch === snapshot.thread.epoch ? previous.items.map(i => [i.id, i]) : [])
    db.prepare('DELETE FROM thread_scopes WHERE identity = ?').run(identity)
    db.prepare('INSERT INTO thread_scopes VALUES (?, ?, ?)').run(identity, Buffer.from(snapshot.serverId, 'utf16le'), Buffer.from(snapshot.conversationId, 'utf16le'))
    const insert = db.prepare('INSERT INTO thread_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    const payloadInsert = db.prepare('INSERT INTO thread_payloads VALUES (?, ?, ?, ?)')
    const nextRows = records(snapshot.thread, generation)
    for (const { payload, ...indexes } of nextRows) {
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
    // Replacement already owns full-snapshot work; keep later recovery reads bounded.
    if (keepIndexes) {
      const h = header(nextRows[0].payload, snapshot.serverId, snapshot.conversationId)
      h.mutable = activate(db, identity, h, snapshot.thread)
      h.availabilityStart = snapshot.thread.ranges[0]?.start
      writeHeader(db, identity, h)
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
    const m: Mutable = { roots: { ids: empty(), order: empty(), ranges: empty(), sort: empty(), endings: empty() },
      nextOrdinal: h.mutable?.nextOrdinal ?? Math.max(snapshot.items.length, snapshot.ranges.length), nextArrival: h.mutable?.nextArrival ?? snapshot.items.length,
      sequence: emptySequence(), nodes: snapshot.items.reduce((n, item) => n + threadHistoryCodec.nodes(item), 0) }
    const placements = db.prepare<[string], Row>(`SELECT ${columns} FROM thread_records WHERE scope = ? AND kind != 'header' ORDER BY kind, ordinal`).all(identity)
    const held = new Map(snapshot.items.map((item, rank) => [item.id, { item, rank }]))
    const decoded = placements.map(r => ({ r, value: decode(r, identity, h.mutable ? identity : h.generation) }))
      .sort((a, b) => (a.r.kind === 'item' ? held.get(natural(object(a.value).id))?.rank ?? Infinity : Infinity) -
        (b.r.kind === 'item' ? held.get(natural(object(b.value).id))?.rank ?? Infinity : Infinity))
    const ids = tree(db, identity, 'ids'), ordered = sequence(db, identity), ranges = tree(db, identity, 'ranges'), sorted = tree(db, identity, 'sort'), endings = tree(db, identity, 'endings')
    for (const { r, value } of decoded) {
      const { payload: ignored, ...indexes } = r
      void ignored
      if (r.kind === 'item' && !h.hasArrival) indexes.arrival = r.ordinal
      const rewritten = h.mutable ? r : protect(db, identity, indexes, value)
      if (!(rewritten.payload instanceof Uint8Array)) throw INVALID_CHAT_HISTORY
      const position = numericKey(r.ordinal)
      const leaf = { ordinal: r.ordinal, digest: digest(rewritten.payload), position: r.kind === 'item' ? position : null,
        id: r.kind === 'item' ? natural(object(value).id) : null }
      if (r.kind === 'item') {
        const entry = held.get(natural(leaf.id))?.item
        if (!entry) throw INVALID_CHAT_HISTORY
        const selected = { ...leaf, flags: flags(entry) }
        m.roots.ids = ids.set(m.roots.ids, numericKey(natural(leaf.id)), leaf)
        m.sequence = ordered.set(m.sequence ?? emptySequence(), m.sequence?.count ?? 0, selected, true)
        m.roots.sort = sorted.set(m.roots.sort, sortKey(entry.order, indexes.arrival ?? r.ordinal), leaf)
        const key = attribution(entry)
        if (entry.kind === 'turn_end' && key !== null) m.roots.endings = endings.set(m.roots.endings ?? empty(), key + numericKey(r.ordinal), leaf)
      } else m.roots.ranges = ranges.set(m.roots.ranges, numericKey(natural(r.range_start)), leaf)
    }
    ids.flush(); ordered.flush(); ranges.flush(); sorted.flush(); endings.flush()
    return m
  }
  function* mutateThread(db: Database.Database, request: Extract<ChatHistoryRequest, { operation: 'mutateThread' }>): Generator<void> {
    if (db.pragma('user_version', { simple: true }) === 6) db.exec(`CREATE TABLE IF NOT EXISTS thread_auth (
      scope TEXT NOT NULL REFERENCES thread_scopes(identity) ON DELETE CASCADE,
      tree TEXT NOT NULL, path TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(scope, tree, path)); PRAGMA user_version = 7`)
    const c = request.change, metadata = c.metadata
    const p = c.persistence
    if (p && db.pragma('user_version', { simple: true }) === 7) db.exec(`CREATE TABLE history_save_parts (
      id TEXT NOT NULL, part INTEGER NOT NULL, payload BLOB NOT NULL, PRIMARY KEY(id, part)); PRAGMA user_version = 8`)
    function receipt(part: number): unknown {
      if (!p) return undefined
      const row = db.prepare<[string, number], { payload: unknown }>('SELECT payload FROM history_save_parts WHERE id = ? AND part = ?').get(p.id, part)
      if (!row) return undefined
      if (!(row.payload instanceof Uint8Array)) throw INVALID_CHAT_HISTORY
      const value = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(encryption.decrypt(row.payload))))
      if (!same(value, { id: p.id, part, value: value.value })) throw INVALID_CHAT_HISTORY
      return value.value
    }
    function acknowledge(part: number, value: unknown): void {
      if (!p) return
      db.prepare('INSERT INTO history_save_parts VALUES (?, ?, ?)').run(p.id, part,
        Buffer.from(encryption.encrypt(Buffer.from(JSON.stringify({ id: p.id, part, value })))))
    }
    let identity = scope(db, request.serverId, request.conversationId)
    let h: ReturnType<typeof header> | undefined
    if (identity !== null) {
      const row = db.prepare<[string], Row>(`SELECT ${columns} FROM thread_records WHERE scope = ? AND kind = 'header' AND ordinal = 0`).get(identity)
      if (!row) throw INVALID_CHAT_HISTORY
      h = header(decode(row, identity), request.serverId, request.conversationId)
      yield
    }
    const known = receipt(-1)
    const binding = () => ({ scope: identity, owner: h?.persistenceOwner, serverId: request.serverId,
      conversationId: request.conversationId, epoch: metadata.epoch, resetId: c.resetId ?? null, parts: p?.parts })
    if (known !== undefined) {
      // Check the exact protected lifecycle before a replay can exercise acceptEpoch/reset.
      if (!h || !same(known, binding())) throw INVALID_CHAT_HISTORY
      const accepted = p && receipt(p.part)
      if (accepted !== undefined) {
        if (accepted !== digest(JSON.stringify(request))) throw INVALID_CHAT_HISTORY
        return
      }
    }
    if (h && identity !== null) {
      if (h.metadata.epoch !== metadata.epoch || c.resetId !== undefined && c.resetId !== h.resetId) {
        if (!c.acceptEpoch) throw INVALID_CHAT_HISTORY
        // Empty the old owner's children incrementally so FK cascades cannot hide a backlog.
        for (const table of ['thread_records', 'thread_payloads', 'thread_auth']) {
          const next = db.prepare<[string], { id: number }>(`SELECT rowid AS id FROM ${table} WHERE scope = ? LIMIT 1`)
          const remove = db.prepare(`DELETE FROM ${table} WHERE scope = ? AND rowid = ?`)
          for (let child = next.get(identity); child; child = next.get(identity)) {
            remove.run(identity, child.id)
            yield
          }
        }
        db.prepare('DELETE FROM thread_scopes WHERE identity = ?').run(identity)
        identity = null; h = undefined
      }
    }
    if (identity === null) {
      if (!c.acceptEpoch) throw INVALID_CHAT_HISTORY
      identity = randomUUID()
      db.prepare('INSERT INTO thread_scopes VALUES (?, ?, ?)').run(identity, Buffer.from(request.serverId, 'utf16le'), Buffer.from(request.conversationId, 'utf16le'))
      h = { metadata: { hostId: request.serverId, conversationId: request.conversationId, epoch: metadata.epoch,
        version: 0, checkpoint: 0, uncommittedVersion: 0, repair: null },
        itemCount: 0, rangeCount: 0, hasArrival: true, generation: randomUUID(),
        ...(c.resetId === undefined ? {} : { resetId: c.resetId }),
        mutable: { roots: { ids: empty(), order: empty(), ranges: empty(), sort: empty(), endings: empty() }, nextOrdinal: 0, nextArrival: 0,
          sequence: emptySequence(), nodes: 0 } }
    }
    if (!h) throw INVALID_CHAT_HISTORY
    if (h.persistence && (!p || h.persistence.id !== p.id || h.persistence.parts !== p.parts || h.persistence.next !== p.part))
      throw INVALID_CHAT_HISTORY
    if (p) {
      if (known === undefined) {
        if (p.part !== 0 || h.persistence) throw INVALID_CHAT_HISTORY
        h.persistenceOwner ??= randomUUID()
        acknowledge(-1, binding())
      } else if (!h.persistence) throw INVALID_CHAT_HISTORY
    }
    let m = h.mutable
    if (!m || m.roots.endings === undefined) {
      const snapshot = load(db, request.serverId, request.conversationId)
      if (!snapshot) throw INVALID_CHAT_HISTORY
      m = activate(db, identity, h, snapshot.thread)
      h.hasArrival = true
    }
    const ids = tree(db, identity, 'ids'), ordered = sequence(db, identity), ranges = tree(db, identity, 'ranges'), sorted = tree(db, identity, 'sort'), endings = tree(db, identity, 'endings')
    if (m.sequence === undefined || m.nodes === undefined) {
      // One-time transactional conversion authenticates all retained facts first.
      const saved = load(db, request.serverId, request.conversationId)
      if (!saved) throw INVALID_CHAT_HISTORY
      const leaves = tree(db, identity, 'order').window(m.roots.order, 0, h.itemCount)
      m.sequence = emptySequence(); m.nodes = 0
      for (let i = 0; i < leaves.length; i++) {
        const value = saved.thread.items[i], row = selectedRow(db, identity, 'item', leaves[i])
        const leaf = { ...leaves[i], position: numericKey(row.ordinal) }
        m.sequence = ordered.set(m.sequence, i, { ...leaf, flags: flags(value) }, true)
        m.roots.ids = ids.set(m.roots.ids, numericKey(value.id), leaf)
        m.roots.sort = sorted.set(m.roots.sort, sortKey(value.order, natural(row.arrival)), leaf)
        m.nodes += threadHistoryCodec.nodes(value)
      }
      m.roots.order = empty()
    }
    let sequenceRoot = m.sequence, nodes = m.nodes
    if (h.availabilityStart === undefined && h.rangeCount) {
      const oldest = ranges.window(m.roots.ranges, 0, 1)[0]
      const row = selectedRow(db, identity, 'range', oldest)
      h.availabilityStart = threadHistoryCodec.ranges([decode(row, identity)])[0].start
    }
    function erase(id: number): void {
      const leaf = ids.get(mutableState.roots.ids, numericKey(id))
      if (!leaf) return
      const row = selectedRow(db, owner, 'item', leaf), value = object(item(db, row, owner, { ...currentHeader, mutable: mutableState }))
      if (value.id !== id || leaf.position === null) throw INVALID_CHAT_HISTORY
      mutableState.roots.ids = ids.set(mutableState.roots.ids, numericKey(id), null)
      sequenceRoot = ordered.set(sequenceRoot, ordered.rank(sequenceRoot, leaf.position), null)
      nodes -= threadHistoryCodec.nodes(value)
      mutableState.roots.sort = sorted.set(mutableState.roots.sort, sortKey(value.order, natural(row.arrival)), null)
      const key = attribution(value)
      if (value.kind === 'turn_end' && key !== null) mutableState.roots.endings = endings.set(mutableState.roots.endings ?? empty(), key + numericKey(row.ordinal), null)
      db.prepare("DELETE FROM thread_records WHERE scope = ? AND kind = 'item' AND ordinal = ?").run(owner, leaf.ordinal)
      db.prepare('DELETE FROM thread_payloads WHERE scope = ? AND item_id = ?').run(owner, id)
    }
    // Captured constants keep nested work on this exact protected owner/header.
    const owner = identity, currentHeader = h, mutableState = m
    yield
    for (const id of c.removeIds) { erase(id); yield }
    const pending = new Map<number, ThreadSnapshot['items'][number]>()
    for (const entry of c.items) { pending.set(entry.id, entry); yield }
    function upsert(id: number): void {
      const entry = pending.get(id)
      if (!entry) return
      const value = entry, previous = ids.get(mutableState.roots.ids, numericKey(id))
      let arrival: number, ordinal: number, retainedRank: number | null = null
      if (previous) {
        const row = selectedRow(db, owner, 'item', previous), held = object(item(db, row, owner, { ...currentHeader, mutable: mutableState }))
        if (held.id !== id || held.kind !== value.kind || previous.position === null) throw INVALID_CHAT_HISTORY
        if (natural(held.rev) > value.rev || (held.rev === value.rev && !isSameRevisionTextExtension(held, value))) { pending.delete(id); return }
        const key = attribution(held)
        if (held.kind === 'turn_end' && key !== null) mutableState.roots.endings = endings.set(mutableState.roots.endings ?? empty(), key + numericKey(row.ordinal), null)
        arrival = natural(row.arrival); ordinal = row.ordinal
        nodes -= threadHistoryCodec.nodes(held)
        if (same(held.order, value.order)) retainedRank = ordered.rank(sequenceRoot, previous.position)
        if (retainedRank === null) {
          sequenceRoot = ordered.set(sequenceRoot, ordered.rank(sequenceRoot, previous.position), null)
          mutableState.roots.sort = sorted.set(mutableState.roots.sort, sortKey(held.order, arrival), null)
        }
      } else {
        arrival = natural(mutableState.nextArrival++); ordinal = natural(mutableState.nextOrdinal++)
      }
      const sort = sortKey(value.order, arrival)
      let rank = retainedRank
      if (rank === null) {
        const nextRank = sorted.rank(mutableState.roots.sort, sort)
        const next = sorted.window(mutableState.roots.sort, nextRank, nextRank + 1)[0]
        rank = next?.position === null || next?.position === undefined ? sequenceRoot.count : ordered.rank(sequenceRoot, next.position)
      }
      nodes += threadHistoryCodec.nodes(value)
      if (nodes > MAX_CHAT_HISTORY_ITEMS) throw INVALID_CHAT_HISTORY
      const payload = Buffer.from(encryption.encrypt(Buffer.from(JSON.stringify({ scope: owner, epoch: metadata.epoch,
        id, rev: value.rev, value }))))
      db.prepare('INSERT OR REPLACE INTO thread_payloads VALUES (?, ?, ?, ?)').run(owner, id, value.rev, payload)
      const row = protect(db, owner, { kind: 'item', ordinal, arrival, item_order: order(value.order),
        range_ordinal: null, range_start: null, range_end: null }, { id, rev: value.rev, digest: digest(payload) })
      if (!(row.payload instanceof Uint8Array)) throw INVALID_CHAT_HISTORY
      const leaf = { ordinal, digest: digest(row.payload), position: numericKey(ordinal), id }
      mutableState.roots.ids = ids.set(mutableState.roots.ids, numericKey(id), leaf)
      sequenceRoot = ordered.set(sequenceRoot, rank, { ...leaf, flags: flags(value) }, retainedRank === null)
      mutableState.roots.sort = sorted.set(mutableState.roots.sort, sort, leaf)
      const key = attribution(value)
      if (value.kind === 'turn_end' && key !== null) mutableState.roots.endings = endings.set(mutableState.roots.endings ?? empty(), key + numericKey(ordinal), leaf)
      pending.delete(id)
    }
    for (const id of pending.keys()) { upsert(id); yield }
    for (const range of c.ranges) {
      let start = range.start, end = range.end
      const first = ranges.rank(m.roots.ranges, numericKey(start)), last = ranges.rank(m.roots.ranges, numericKey(end))
        + (ranges.get(m.roots.ranges, numericKey(end)) ? 1 : 0)
      yield
      for (const leaf of ranges.windowSteps(m.roots.ranges, Math.max(0, first - 1), last)) {
        const row = selectedRow(db, owner, 'range', leaf), r = threadHistoryCodec.ranges([decode(row, owner)])[0]
        if (r.end < start || r.start > end) { yield; continue }
        start = Math.min(start, r.start); end = Math.max(end, r.end)
        m.roots.ranges = ranges.set(m.roots.ranges, numericKey(r.start), null)
        db.prepare("DELETE FROM thread_records WHERE scope = ? AND kind = 'range' AND ordinal = ?").run(owner, row.ordinal)
        yield
      }
      const ordinal = natural(m.nextOrdinal++), row = protect(db, owner, { kind: 'range', ordinal, arrival: null,
        item_order: null, range_ordinal: null, range_start: start, range_end: end }, { start, end })
      if (!(row.payload instanceof Uint8Array)) throw INVALID_CHAT_HISTORY
      m.roots.ranges = ranges.set(m.roots.ranges, numericKey(start), { ordinal, digest: digest(row.payload), position: null, id: null })
      yield
    }
    // Replay owned progress in admission order. Certificates cannot acquire the version of a later
    // live observation or erase obligations lost when a same-epoch holder was recreated.
    const observations = c.priorProgress ?? []
    for (let index = 0; index <= observations.length; index++) {
      const progress = index < observations.length ? observations[index] : c
      const old = h.metadata, next = progress.metadata, completion = progress.completion
      const certified = completion !== undefined && completion.fromVersion <= old.checkpoint
      const fenced = old.repair !== null || (old.uncommittedVersion ?? 0) > old.checkpoint
      const bound = completion || fenced ? certified ? completion.version : old.checkpoint : next.checkpoint
      const checkpoint = Math.max(old.checkpoint, Math.min(next.checkpoint, bound))
      const oldRepair = old.repair !== null && !(certified && completion.version >= old.repair.throughVersion) ? old.repair : null
      // A lost acknowledgement can replay an observation already covered by the saved checkpoint.
      // A new repair raised at that checkpoint still owns an obligation, even with equal bounds.
      const nextRepair = next.repair !== null && (next.repair.fromVersion >= old.checkpoint ||
        next.repair.throughVersion > old.checkpoint) ? next.repair : null
      const missingCoverage = completion !== undefined && !certified
      const repairThrough = Math.max(oldRepair?.throughVersion ?? 0, nextRepair?.throughVersion ?? 0,
        missingCoverage ? completion.version : 0, checkpoint)
      const repair = oldRepair || nextRepair || missingCoverage ? { fromVersion: checkpoint, throughVersion: repairThrough } : null
      const unfinished = old.uncommittedVersion ?? 0
      const retainUnfinished = !(certified && completion.version >= unfinished)
      const uncommittedVersion = Math.max(next.uncommittedVersion ?? 0,
        retainUnfinished && (unfinished > next.checkpoint || fenced) ? unfinished : 0)
      let olderAvailable = old.olderAvailable ?? (h.availabilityStart === undefined ? next.olderAvailable : undefined)
      const boundary = progress.availability
      if (boundary && (h.availabilityStart === undefined || boundary.start < h.availabilityStart ||
        boundary.start === h.availabilityStart && olderAvailable !== false)) {
        h.availabilityStart = boundary.start; olderAvailable = boundary.available
      }
      h.metadata = threadHistoryCodec.metadata({ ...old, ...next, olderAvailable, version: Math.max(old.version, next.version), checkpoint,
        uncommittedVersion, repair }, request.serverId, request.conversationId)
      yield
    }
    m.sequence = sequenceRoot; m.nodes = nodes
    h.mutable = m; h.hasArrival = true; h.generation = randomUUID(); h.itemCount = m.roots.ids.count; h.rangeCount = m.roots.ranges.count
    if (h.itemCount > MAX_CHAT_HISTORY_ITEMS || h.rangeCount > MAX_CHAT_HISTORY_ITEMS) throw INVALID_CHAT_HISTORY
    yield* ids.flushSteps(); yield* ordered.flushSteps(); yield* ranges.flushSteps(); yield* sorted.flushSteps(); yield* endings.flushSteps()
    if (p) {
      acknowledge(p.part, digest(JSON.stringify(request)))
      h.persistence = p.part + 1 === p.parts ? undefined : { id: p.id, next: p.part + 1, parts: p.parts }
    }
    writeHeader(db, owner, h)
    yield
  }
  function mutablePage(db: Database.Database, identity: string, h: ReturnType<typeof header>, limit: number,
    token: Record<string, unknown> | null, opening = false): ThreadHistoryResult {
    const m = h.mutable
    if (!m || h.itemCount !== (m.sequence ?? m.roots.order).count || h.rangeCount !== m.roots.ranges.count) throw INVALID_CHAT_HISTORY
    if (token && (token.identity !== h.generation || typeof token.before !== 'number' || token.ring === undefined && token.before > h.itemCount)) throw INVALID_CONTINUATION
    const end = token ? natural(token.before) : h.itemCount
    let start = Math.max(0, end - limit), nextRing: ReturnType<typeof ring> | null | undefined
    let leaves = opening || token?.ring !== undefined ? [] : m.sequence ? sequence(db, identity).window(m.sequence, start, end)
      : tree(db, identity, 'order').window(m.roots.order, start, end)
    if (token?.ring !== undefined) {
      const current = ring(token.ring), ids = tree(db, identity, 'ids'), root = m.roots.ids
      const lower = current.wrapped ? ids.rank(root, numericKey(current.boundary)) : 0
      const upper = current.cursor === null ? root.count : ids.rank(root, numericKey(current.cursor))
      start = Math.max(lower, upper - limit)
      leaves = ids.window(root, start, upper)
      const cursor = leaves[0]?.id
      nextRing = start > lower && cursor !== null && cursor !== undefined ? { ...current, cursor }
        : current.wrapped || ids.rank(root, numericKey(current.boundary)) === root.count ? null
        : { ...current, wrapped: true, cursor: null }
      if (!m.sequence) throw INVALID_CHAT_HISTORY
      const ordered = sequence(db, identity), rootSequence = m.sequence
      leaves = leaves.map(leaf => {
        if (leaf.position === null) throw INVALID_CHAT_HISTORY
        return { leaf, rank: ordered.rank(rootSequence, leaf.position) }
      }).sort((a, b) => a.rank - b.rank).map(v => v.leaf)
    }
    const cached = new Map<number, { row: Row; value: ThreadSnapshot['items'][number] }>()
    function entry(leaf: Leaf) {
      const previous = cached.get(leaf.ordinal)
      if (previous) return previous
      const row = selectedRow(db, identity, 'item', leaf), value = threadHistoryCodec.items([item(db, row, identity, h)])[0]
      const result = { row, value }; cached.set(leaf.ordinal, result); return result
    }
    if (opening) {
      const root = m.sequence
      if (!root || m.roots.endings === undefined) throw INVALID_CHAT_HISTORY
      const ordered = sequence(db, identity), ids = tree(db, identity, 'ids'), endings = tree(db, identity, 'endings')
      const shown = root.shown ?? 0, base = ordered.window(root, Math.max(0, shown - limit), shown, 'shown')
      start = shown > limit && base[0]?.position ? ordered.rank(root, base[0].position) : 0
      const selected = new Map<number, Leaf>(), joins = new Set<string>(), parents = new Set<number>()
      const add = (leaf: Leaf): void => { if (!selected.has(leaf.ordinal)) selected.set(leaf.ordinal, leaf) }
      base.forEach(add); ordered.window(root, 0, root.active ?? 0, 'active').forEach(add)
      for (const leaf of selected.values()) {
        const value = entry(leaf).value, parent = order(value.parent)
        if (parent !== null && !parents.has(parent)) {
          parents.add(parent)
          const ancestor = ids.get(m.roots.ids, numericKey(parent))
          if (ancestor && entry(ancestor).value.kind === 'agent') add(ancestor)
        }
        const key = value.kind === 'assistant_message' ? attribution(value) : null
        if (key !== null && !joins.has(key)) {
          joins.add(key)
          const first = endings.rank(m.roots.endings, key + '00000000000000')
          const last = endings.rank(m.roots.endings, key + 'ffffffffffffff')
          endings.window(m.roots.endings, first, last).forEach(add)
        }
      }
      leaves = [...selected.values()].map(leaf => {
        if (leaf.position === null) throw INVALID_CHAT_HISTORY
        return { leaf, rank: ordered.rank(root, leaf.position) }
      }).sort((a, b) => a.rank - b.rank).map(e => e.leaf)
    }
    const selected = leaves.map(l => entry(l).row)
    const items = threadHistoryCodec.items(leaves.map(l => entry(l).value))
    const rt = tree(db, identity, 'ranges'), evidence = new Map<number, { start: number; end: number }>()
    const decodedRanges = new Map<number, { start: number; end: number }>()
    function range(leaf: Leaf) {
      const cached = decodedRanges.get(leaf.ordinal)
      if (cached) return cached
      const value = threadHistoryCodec.ranges([decode(selectedRow(db, identity, 'range', leaf), identity)])[0]
      decodedRanges.set(leaf.ordinal, value); return value
    }
    function add(leaf: Leaf | undefined): void {
      if (leaf) evidence.set(leaf.ordinal, range(leaf))
    }
    add(rt.window(m.roots.ranges, h.rangeCount - 1, h.rangeCount)[0])
    for (const value of items) {
      const n = order(value.order)
      if (n === null) continue
      const key = numericKey(n), exact = rt.get(m.roots.ranges, key), rank = rt.rank(m.roots.ranges, key)
      const leaf = exact ?? rt.window(m.roots.ranges, rank - 1, rank)[0]
      if (leaf) {
        const value = range(leaf)
        if (value.start <= n && n < value.end) add(leaf)
      }
    }
    const ranges = threadHistoryCodec.ranges([...evidence.values()].sort((a, b) => a.start - b.start))
    const next = nextRing === undefined ? start === 0 ? null : { format: 'daemon-items', identity: h.generation, before: start }
      : nextRing === null ? null : { format: 'daemon-items', identity: h.generation, before: 1, ring: nextRing }
    const continuation = next === null ? null : protectToken(next)
    const boundary = nextRing?.cursor ?? nextRing?.boundary ?? items[0]?.id
    const recovery = opening || next === null || boundary === undefined ? undefined : protectToken({ format: 'daemon-items-rebase',
      owner: identity, epoch: digest(h.metadata.epoch), token: digest(JSON.stringify(next)), boundary })
    return { status: 'page', page: { partial: true, metadata: h.metadata, items, ranges,
      arrivalPositions: selected.map(r => natural(r.arrival)),
      ...(h.availabilityStart === undefined ? {} : { availabilityStart: h.availabilityStart }), continuation,
      ...(recovery === undefined ? {} : { recovery }) } }
  }
  function readPage(db: Database.Database, server: string, conversation: string, limit: number, token: Record<string, unknown> | null,
    opening = false, recovery?: Record<string, unknown>): ThreadHistoryResult {
    const identity = scope(db, server, conversation)
    if (identity === null) { if (token) throw INVALID_CONTINUATION; return { status: 'missing' } }
    const row = db.prepare<[string], Row>(`SELECT ${columns} FROM thread_records WHERE scope = ? AND kind = 'header' AND ordinal = 0`).get(identity)
    if (!row) throw INVALID_CHAT_HISTORY
    const h = header(decode(row, identity), server, conversation)
    if (h.persistence) throw INVALID_CHAT_HISTORY
    if (recovery && (!token || recovery.format !== 'daemon-items-rebase' || Object.keys(recovery).length !== 5 ||
      recovery.owner !== identity || recovery.epoch !== digest(h.metadata.epoch) ||
      recovery.token !== digest(JSON.stringify(token)))) throw INVALID_CONTINUATION
    if (token && token.identity !== h.generation) {
      if (!recovery) throw INVALID_CONTINUATION
      const boundary = natural(recovery.boundary)
      token = { format: 'daemon-items', identity: h.generation, before: 1, ring: { boundary, cursor: boundary, wrapped: false } }
      log.event({ event: 'history-storage-operation', code: 'thread-page-rebase' })
    }
    if ((opening || token?.ring !== undefined) && h.mutable?.roots.endings === undefined) {
      // A retained scope converts once, transactionally, without progress or owned-save authority.
      const saved = load(db, server, conversation)
      if (!saved) throw INVALID_CHAT_HISTORY
      if (db.pragma('user_version', { simple: true }) === 6) db.exec(`CREATE TABLE IF NOT EXISTS thread_auth (scope TEXT NOT NULL REFERENCES thread_scopes(identity) ON DELETE CASCADE,
        tree TEXT NOT NULL, path TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(scope, tree, path)); PRAGMA user_version = 7`)
      h.mutable = activate(db, identity, h, saved.thread); h.hasArrival = true
      h.availabilityStart ??= saved.thread.ranges[0]?.start
      writeHeader(db, identity, h)
      log.event({ event: 'history-storage-operation', code: 'opening-conversion' })
    }
    if (h.mutable) return mutablePage(db, identity, h, limit, token, opening)
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
      let request, paging: { limit: number; continuation?: string; recovery?: string; opening?: boolean } | undefined
      try {
        const v = parseChatHistoryRequest(value)
        if (v.operation === 'openThreadPage' || v.operation === 'newestThreadPage' || v.operation === 'beforeThreadPage') {
          paging = { limit: v.limit, opening: v.operation === 'openThreadPage',
            ...(v.operation === 'beforeThreadPage' ? { continuation: v.continuation, recovery: v.recovery } : {}) }
          request = parseChatHistoryRequest({ operation: 'readThread', serverId: v.serverId, conversationId: v.conversationId })
        } else request = v
        if (!['readThread', 'replaceThread', 'mutateThread', 'removeConversation', 'removeServer'].includes(request.operation)) throw INVALID_CHAT_HISTORY
      } catch { return report({ status: 'error', code: 'invalid-request' }) }
      log.event({ event: 'history-storage-operation', code: paging ? 'thread-page' : request.operation })
      let reading = true
      const removing = request.operation === 'removeConversation' || request.operation === 'removeServer'
      try {
        if (!encryption.isAvailable()) return report({ status: 'error', code: 'encryption-unavailable' })
        let token: Record<string, unknown> | null = null, recovery: Record<string, unknown> | undefined
        if (paging?.continuation !== undefined) {
          try {
            token = unprotectToken(paging.continuation)
            if (token.format !== 'daemon-items' || Object.keys(token).length !== (token.ring === undefined ? 3 : 4) ||
              typeof token.identity !== 'string' || !/^[0-9a-f-]{36}$/.test(token.identity) || natural(token.before) === 0) throw INVALID_CHAT_HISTORY
            if (token.ring !== undefined) ring(token.ring)
            if (paging.recovery !== undefined) {
              recovery = unprotectToken(paging.recovery)
              natural(recovery.boundary)
            }
          } catch { return report({ status: 'error', code: 'invalid-request' }) }
        }
        return report(database.transaction((db): ThreadHistoryResult => {
          migrate(db)
          if (request.operation === 'mutateThread') {
            reading = false
            for (const ignored of mutateThread(db, request)) void ignored
            return { status: 'ok' }
          }
          const server = Buffer.from(request.serverId, 'utf16le')
          let previous: ThreadSnapshot | null = null
          if (request.operation === 'removeServer') {
            for (const s of db.prepare<[Buffer], { conversation: unknown }>('SELECT conversation FROM thread_scopes WHERE server = ?').all(server)) {
              if (!Buffer.isBuffer(s.conversation) || s.conversation.length % 2 !== 0) throw INVALID_CHAT_HISTORY
              load(db, request.serverId, s.conversation.toString('utf16le'), false, true)
            }
          } else if ('conversationId' in request) {
            if (paging) return readPage(db, request.serverId, request.conversationId, paging.limit, token, paging.opening, recovery)
            const snapshot = load(db, request.serverId, request.conversationId, false, request.operation !== 'readThread')
            previous = snapshot?.thread ?? null
            if (request.operation === 'readThread') return snapshot ? { status: 'stored', snapshot } : { status: 'missing' }
          }
          reading = false
          if (request.operation === 'removeServer') db.prepare('DELETE FROM thread_scopes WHERE server = ?').run(server)
          else if (request.operation === 'removeConversation' || request.operation === 'replaceThread') {
            const conversation = Buffer.from(request.conversationId, 'utf16le')
            if (request.operation === 'replaceThread') {
              let owner = scope(db, request.serverId, request.conversationId)
              if (owner !== null && previous?.epoch !== request.snapshot.thread.epoch) {
                db.prepare('DELETE FROM thread_scopes WHERE identity = ?').run(owner); owner = null
              }
              save(db, request.snapshot, owner ?? randomUUID(), randomUUID(), previous)
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
  return { ...api,
    /** Internal admitted request; the application store retains queue ownership across turns. */
    async executeMutation(request: Extract<ChatHistoryRequest, { operation: 'mutateThread' }>,
      onTurn?: (units: number) => Promise<void>): Promise<ChatHistoryResult> {
      try {
        if (!encryption.isAvailable()) throw new EncryptionUnavailableError()
        database.transaction(migrate)
        await database.transactionSteps(db => mutateThread(db, request), onTurn)
        return { status: 'ok' }
      } catch (caught) {
        return { status: 'error', code: caught === UNSUPPORTED_CHAT_HISTORY_VERSION ? 'unsupported-version'
          : caught instanceof EncryptionUnavailableError ? 'encryption-unavailable' : 'write-failed' }
      }
    }
  }
}
