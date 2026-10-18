import { createHash } from 'node:crypto'
import type { DiagnosticLog } from '../diagnosticLog'
import type { Envelope } from '../../shared/wire/types'
import type { ThreadItem, ThreadUpdate, ThreadRepairReason, ThreadQuery, ThreadReply, ThreadQueryFailure } from '../../shared/wire/thread'

export type ThreadDelivery =
  | { kind: 'thread-reply'; reply: ThreadReply; requestId: string; envelope: Envelope }
  | { kind: 'thread-query-failed'; conversationId: string; requestId: string; inReplyTo: number; reason: ThreadQueryFailure }
  | { kind: 'thread-update'; update: ThreadUpdate; envelope: Envelope }
  | { kind: 'thread-repair'; conversationId: string; reason: ThreadRepairReason }
const MAX_UPDATE = 8 * 1024 * 1024, MAX_BUFFER = 16 * 1024 * 1024, MAX_PENDING = 8
const own = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key)
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const number = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
function routing(p: Record<string, unknown>): boolean {
  return typeof p.conversation_id === 'string' && typeof p.epoch === 'string' && number(p.version)
}
function fullItem(p: unknown): p is ThreadItem {
  return record(p) && number(p.id) && typeof p.kind === 'string' && number(p.rev) &&
    typeof p.status === 'string' && typeof p.active === 'boolean' && typeof p.shown === 'boolean' &&
    typeof p.summary === 'string' && own(p, 'content') &&
    ['order', 'ended_order', 'parent'].every(k => !own(p, k) || number(p[k])) &&
    ['session', 'agent', 'turn', 'subtype'].every(k => !own(p, k) || typeof p[k] === 'string') &&
    (!own(p, 'no_child') || typeof p.no_child === 'boolean')
}
function logical(type: string, p: unknown): ThreadUpdate | ThreadReply | null {
  if (!record(p) || !routing(p)) return null
  const { conversation_id, epoch, version } = p
  if (typeof conversation_id !== 'string' || typeof epoch !== 'string' || !number(version)) return null
  if (type === 'thread_tool_body') {
    if (own(p, 'continuation') || own(p, 'base_rev') || !epoch || !number(p.item_id) || p.item_id === 0 || !number(p.rev) || p.rev === 0 ||
        (p.kind !== 'tool_call' && p.kind !== 'agent')) return null
    const route: { conversation_id: string; epoch: string; version: number; item_id: number; rev: number; kind: 'tool_call' | 'agent' } =
      { conversation_id, epoch, version, item_id: p.item_id, rev: p.rev, kind: p.kind }
    if (p.final === false && record(p.content)) return { type, payload: { ...route, content: p.content, final: false } }
    if (p.final === true && !own(p, 'content')) return { type, payload: { ...route, final: true } }
    return null
  }
  if (type === 'thread_item_added' && fullItem(p.item)) {
    return { type, payload: { conversation_id, epoch, version, item: p.item } }
  }
  const coverage = ['from_version', 'lower_order', 'upper_order', 'continuation', 'older_exists']
  if (type === 'thread_reset') {
    return Object.keys(p).some(k => !['conversation_id', 'epoch', 'version'].includes(k)) ? null : { type, payload: { conversation_id, epoch, version } }
  }
  if (type === 'thread_items') {
    if (!Array.isArray(p.items) || !p.items.every(fullItem)) return null
    if (p.final === false && coverage.every(k => !own(p, k))) return { type, payload: { conversation_id, epoch, version, items: p.items, final: false } }
    if (p.final !== true || p.items.length !== 0) return null
    const route: { conversation_id: string; epoch: string; version: number; items: []; final: true } =
      { conversation_id, epoch, version, items: [], final: true }
    if (number(p.from_version) && p.from_version > 0 && p.from_version <= version && coverage.slice(1).every(k => !own(p, k))) {
      return { type, payload: { ...route, from_version: p.from_version } }
    }
    if (!own(p, 'from_version') && number(p.lower_order) && number(p.upper_order) && (p.lower_order === 0 || p.lower_order < p.upper_order) &&
        number(p.continuation) && p.continuation === p.lower_order && typeof p.older_exists === 'boolean' && !(p.lower_order === 0 && p.older_exists)) {
      return { type, payload: { ...route, lower_order: p.lower_order, upper_order: p.upper_order, continuation: p.continuation, older_exists: p.older_exists } }
    }
    return null
  }
  const { item_id, base_rev, rev } = p
  if (!number(item_id) || !number(base_rev) || !number(rev)) return null
  if (type === 'thread_item_changed' && record(p.changes) && !own(p.changes, 'id') && !own(p.changes, 'kind')) {
    return { type, payload: { conversation_id, epoch, version, item_id, base_rev, rev, changes: p.changes } }
  }
  if (type === 'thread_text_append' && typeof p.text === 'string') {
    return { type, payload: { conversation_id, epoch, version, item_id, base_rev, rev, text: p.text } }
  }
  return null
}
type Part = { conversation_id: string; epoch: string; version: number; item_id: number; rev: number;
  base_rev?: number; data: string; continuation: { update_id: string; index: number; offset: number; total_bytes: number; final: boolean } }
function part(type: string, p: unknown): p is Part {
  if (!record(p) || !routing(p) || !number(p.item_id) || !number(p.rev) ||
    ((type === 'thread_item_added' || type === 'thread_items' || type === 'thread_tool_body') ? own(p, 'base_rev') : !number(p.base_rev)) ||
    typeof p.data !== 'string' || p.data === '' || Buffer.from(p.data).toString('utf8') !== p.data ||
    !record(p.continuation)) return false
  if (type === 'thread_items' && ['items', 'final', 'from_version', 'lower_order', 'upper_order', 'older_exists'].some(k => own(p, k))) return false
  if (type === 'thread_tool_body' && ['content', 'kind', 'final'].some(k => own(p, k))) return false
  const c = p.continuation
  return typeof c.update_id === 'string' && /^[a-f0-9]{64}$/.test(c.update_id) &&
    number(c.index) && number(c.offset) && number(c.total_bytes) && c.total_bytes > 0 && typeof c.final === 'boolean'
}
function metadata(type: string, p: Part, envelope: Envelope): string {
  return JSON.stringify([type, p.conversation_id, p.epoch, p.version, p.item_id, p.rev,
    own(p, 'base_rev'), p.base_rev, p.continuation.total_bytes, own(envelope, 'session_id'), envelope.session_id,
    own(envelope, 'conversation_id'), envelope.conversation_id, envelope.in_reply_to])
}
function matches(update: ThreadUpdate | ThreadReply, p: Part): boolean {
  const u = update.payload
  if (update.type === 'thread_reset') return false
  if (update.type === 'thread_tool_body') return !update.payload.final && u.conversation_id === p.conversation_id &&
    u.epoch === p.epoch && u.version === p.version && update.payload.item_id === p.item_id && update.payload.rev === p.rev
  if (update.type === 'thread_items') return update.payload.final === false && update.payload.items.length === 1 &&
    u.conversation_id === p.conversation_id && u.epoch === p.epoch && u.version === p.version &&
    update.payload.items[0].id === p.item_id && update.payload.items[0].rev === p.rev
  return u.conversation_id === p.conversation_id && u.epoch === p.epoch && u.version === p.version &&
    (update.type === 'thread_item_added' ? update.payload.item.id === p.item_id && update.payload.item.rev === p.rev :
      update.payload.item_id === p.item_id && update.payload.rev === p.rev && update.payload.base_rev === p.base_rev)
}

/** Main-only single writer. Delivery callbacks see complete DTOs or static repair reasons. */
export function createThreadUpdateReceiver(deliver: (event: ThreadDelivery) => void, log?: DiagnosticLog) {
  type Assembly = { request?: number; metadata: string; index: number; bytes: number; data: Buffer; timer: ReturnType<typeof setTimeout> | undefined }
  const pending = new Map<string, Assembly>()
  let buffered = 0
  const queries = new Map<number, { requestId: string; query: ThreadQuery; captured?: { epoch: string; version: number };
    body?: string; timer?: ReturnType<typeof setTimeout> }>()
  function fail(id: number, reason: ThreadQueryFailure): boolean {
    const q = queries.get(id)
    if (!q) return false
    queries.delete(id)
    clearTimeout(q.timer)
    for (const [key, a] of pending) if (a.request === id) release(key)
    log?.event({ event: 'thread-query-failed', code: reason })
    deliver({ kind: 'thread-query-failed', conversationId: q.query.payload.conversation_id, requestId: q.requestId, inReplyTo: id, reason })
    return true
  }
  function publish(update: ThreadUpdate | ThreadReply, envelope: Envelope): void {
    if (update.type !== 'thread_items' && update.type !== 'thread_reset' && update.type !== 'thread_tool_body') {
      deliver({ kind: 'thread-update', update, envelope }); return
    }
    const id = envelope.in_reply_to, q = id === undefined ? undefined : queries.get(id)
    if (id === undefined || !q) return
    const p = update.payload
    if (p.conversation_id !== q.query.payload.conversation_id) { fail(id, 'metadata'); return }
    if (update.type === 'thread_tool_body') {
      const v = update.payload, request = q.query
      const capture = JSON.stringify([v.epoch, v.version, v.item_id, v.rev, v.kind,
        own(envelope, 'session_id'), envelope.session_id, own(envelope, 'conversation_id'), envelope.conversation_id])
      if (request.type !== 'thread_read_tool_body' || request.payload.epoch !== v.epoch ||
          request.payload.item_id !== v.item_id || request.payload.expected_rev !== v.rev ||
          (envelope.conversation_id !== undefined && envelope.conversation_id !== v.conversation_id) ||
          (v.final ? q.body !== capture || [...pending.values()].some(a => a.request === id) : q.body !== undefined)) {
        fail(id, 'metadata'); return
      }
      if (v.final) { queries.delete(id); clearTimeout(q.timer) } else q.body = capture
    } else if (q.query.type === 'thread_read_tool_body') { fail(id, 'metadata'); return }
    if (update.type === 'thread_items') {
      if ((q.captured && (q.captured.epoch !== p.epoch || q.captured.version !== p.version)) ||
          (q.query.type === 'thread_catch_up' && q.query.payload.version > 0 && q.query.payload.epoch !== p.epoch)) {
        fail(id, 'metadata'); return
      }
      q.captured = { epoch: p.epoch, version: p.version }
      if (update.payload.final) {
        const marker = update.payload
        const checkpoint = q.query.type === 'thread_catch_up' ? q.query.payload.version : 0
        if ([...pending.values()].some(a => a.request === id) ||
            (checkpoint > 0 ? !('from_version' in marker) || marker.from_version !== checkpoint :
              !('lower_order' in marker) || (q.query.type === 'thread_page' && marker.upper_order > q.query.payload.before_order))) {
          fail(id, 'malformed'); return
        }
        queries.delete(id)
      }
    } else if (update.type === 'thread_reset') {
      queries.delete(id)
      for (const [key, a] of pending) if (a.request === id) release(key)
    }
    log?.event({ event: 'thread-query-reply', code: update.type })
    deliver({ kind: 'thread-reply', reply: update, envelope, requestId: q.requestId })
  }
  function release(key: string): void {
    const a = pending.get(key)
    if (!a) return
    clearTimeout(a.timer)
    buffered -= a.bytes
    pending.delete(key)
  }
  function reject(conversationId: string, key: string | undefined, reason: ThreadRepairReason, request?: number): void {
    if (key !== undefined) release(key)
    if (request !== undefined) { fail(request, reason); return }
    log?.event({ event: 'thread-update-rejected', code: reason })
    deliver({ kind: 'thread-repair', conversationId, reason })
  }
  return {
    register(id: number, requestId: string, query: ThreadQuery): boolean {
      queries.set(id, { requestId, query })
      if (query.type === 'thread_read_tool_body') {
        if ([...queries.values()].filter(q => q.query.type === 'thread_read_tool_body').length > 32) { fail(id, 'limit'); return false }
        const q = queries.get(id)
        if (q) q.timer = setTimeout(() => fail(id, 'expired'), 30000)
      }
      return true
    },
    cancel(requestId: string): void { for (const [id, q] of queries) if (q.requestId === requestId) fail(id, 'interrupted') },
    fail,
    reset(): void {
      for (const id of queries.keys()) fail(id, 'interrupted')
      if (pending.size) log?.event({ event: 'thread-assembly-reset' })
      for (const key of pending.keys()) release(key)
    },
    receive(envelope: Envelope): void {
      const p = envelope.payload
      const history = envelope.type === 'thread_items' || envelope.type === 'thread_reset' || envelope.type === 'thread_tool_body'
      const request = history ? envelope.in_reply_to : undefined
      if (history && (request === undefined || !queries.has(request))) return
      if (history && (!record(p) || typeof p.conversation_id !== 'string')) { if (request !== undefined) fail(request, 'malformed'); return }
      if (!record(p) || typeof p.conversation_id !== 'string') return
      const conversationId = p.conversation_id
      const c = record(p.continuation) ? p.continuation : undefined
      const key = typeof c?.update_id === 'string' ? JSON.stringify([conversationId, c.update_id, ...(history ? [request] : [])]) : undefined
      if (!history && own(p, 'continuation') && !record(p.continuation)) { reject(conversationId, key, 'malformed'); return }
      if (!record(p.continuation)) {
        const update = logical(envelope.type, p)
        if (update) {
          log?.event({ event: 'thread-update-delivered', code: update.type })
          publish(update, envelope)
        } else reject(conversationId, undefined, 'malformed', request)
        return
      }
      if (!part(envelope.type, p) || key === undefined) { reject(conversationId, key, 'malformed', request); return }
      const progress = p.continuation, bytes = Buffer.from(p.data)
      let a = pending.get(key)
      if ((a ? progress.index !== a.index || progress.offset !== a.bytes : progress.index !== 0 || progress.offset !== 0)) {
        reject(conversationId, key, 'sequence', request); return
      }
      if (a && a.metadata !== metadata(envelope.type, p, envelope)) { reject(conversationId, key, 'metadata', request); return }
      if (progress.total_bytes > MAX_UPDATE || buffered + bytes.length > MAX_BUFFER ||
        (!a && !progress.final && pending.size >= MAX_PENDING) || (a?.bytes ?? 0) + bytes.length > progress.total_bytes) {
        reject(conversationId, key, 'limit', request); return
      }
      if (!a) {
        a = { request, metadata: metadata(envelope.type, p, envelope), index: 0, bytes: 0, data: Buffer.alloc(0), timer: undefined }
        pending.set(key, a)
      }
      // Grow geometrically rather than retaining one object per tiny hostile fragment.
      const length = a.bytes + bytes.length
      if (a.data.length < length) {
        const grown = Buffer.alloc(Math.min(progress.total_bytes, Math.max(length, a.data.length * 2, 65536)))
        a.data.copy(grown, 0, 0, a.bytes)
        a.data = grown
      }
      bytes.copy(a.data, a.bytes)
      a.bytes = length; a.index++; buffered += bytes.length
      clearTimeout(a.timer)
      if (!progress.final) {
        a.timer = setTimeout(() => reject(conversationId, key, 'expired', request), 30000)
        return
      }
      const data = a.data.subarray(0, a.bytes)
      release(key)
      if (data.length !== progress.total_bytes) { reject(conversationId, undefined, 'final-length', request); return }
      if (createHash('sha256').update(envelope.type).update('\0').update(data).digest('hex') !== progress.update_id) {
        reject(conversationId, undefined, 'digest', request); return
      }
      let update: ThreadUpdate | ThreadReply | null = null
      try { update = logical(envelope.type, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data))) } catch { /* Static repair below. */ }
      if (!update || !matches(update, p)) { reject(conversationId, undefined, 'reconstructed', request); return }
      log?.event({ event: 'thread-update-delivered', code: update.type })
      publish(update, { ...envelope, payload: update.payload })
    }
  }
}
