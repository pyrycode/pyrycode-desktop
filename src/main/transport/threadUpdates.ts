import { createHash } from 'node:crypto'
import type { DiagnosticLog } from '../diagnosticLog'
import type { Envelope } from '../../shared/wire/types'
import type { ThreadItem, ThreadUpdate, ThreadRepairReason } from '../../shared/wire/thread'

export type ThreadDelivery =
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
function logical(type: string, p: unknown): ThreadUpdate | null {
  if (!record(p) || !routing(p)) return null
  const { conversation_id, epoch, version } = p
  if (typeof conversation_id !== 'string' || typeof epoch !== 'string' || !number(version)) return null
  if (type === 'thread_item_added' && fullItem(p.item)) {
    return { type, payload: { conversation_id, epoch, version, item: p.item } }
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
    (type === 'thread_item_added' ? own(p, 'base_rev') : !number(p.base_rev)) ||
    typeof p.data !== 'string' || p.data === '' || Buffer.from(p.data).toString('utf8') !== p.data ||
    !record(p.continuation)) return false
  const c = p.continuation
  return typeof c.update_id === 'string' && /^[a-f0-9]{64}$/.test(c.update_id) &&
    number(c.index) && number(c.offset) && number(c.total_bytes) && c.total_bytes > 0 && typeof c.final === 'boolean'
}
function metadata(type: string, p: Part): string {
  return JSON.stringify([type, p.conversation_id, p.epoch, p.version, p.item_id, p.rev,
    own(p, 'base_rev'), p.base_rev, p.continuation.total_bytes])
}
function matches(update: ThreadUpdate, p: Part): boolean {
  const u = update.payload
  return u.conversation_id === p.conversation_id && u.epoch === p.epoch && u.version === p.version &&
    (update.type === 'thread_item_added' ? update.payload.item.id === p.item_id && update.payload.item.rev === p.rev :
      update.payload.item_id === p.item_id && update.payload.rev === p.rev && update.payload.base_rev === p.base_rev)
}

/** Main-only single writer. Delivery callbacks see complete DTOs or static repair reasons. */
export function createThreadUpdateReceiver(deliver: (event: ThreadDelivery) => void, log?: DiagnosticLog) {
  type Assembly = { metadata: string; index: number; bytes: number; data: Buffer; timer: ReturnType<typeof setTimeout> | undefined }
  const pending = new Map<string, Assembly>()
  let buffered = 0
  function release(key: string): void {
    const a = pending.get(key)
    if (!a) return
    clearTimeout(a.timer)
    buffered -= a.bytes
    pending.delete(key)
  }
  function reject(conversationId: string, key: string | undefined, reason: ThreadRepairReason): void {
    if (key !== undefined) release(key)
    log?.event({ event: 'thread-update-rejected', code: reason })
    deliver({ kind: 'thread-repair', conversationId, reason })
  }
  return {
    reset(): void {
      if (pending.size) log?.event({ event: 'thread-assembly-reset' })
      for (const key of pending.keys()) release(key)
    },
    receive(envelope: Envelope): void {
      const p = envelope.payload
      if (!record(p) || typeof p.conversation_id !== 'string') return
      const conversationId = p.conversation_id
      const c = record(p.continuation) ? p.continuation : undefined
      const key = typeof c?.update_id === 'string' ? JSON.stringify([conversationId, c.update_id]) : undefined
      if (!own(p, 'continuation')) {
        const update = logical(envelope.type, p)
        if (update) {
          log?.event({ event: 'thread-update-delivered', code: update.type })
          deliver({ kind: 'thread-update', update, envelope })
        } else reject(conversationId, undefined, 'malformed')
        return
      }
      if (!part(envelope.type, p) || key === undefined) { reject(conversationId, key, 'malformed'); return }
      const progress = p.continuation, bytes = Buffer.from(p.data)
      let a = pending.get(key)
      if ((a ? progress.index !== a.index || progress.offset !== a.bytes : progress.index !== 0 || progress.offset !== 0)) {
        reject(conversationId, key, 'sequence'); return
      }
      if (a && a.metadata !== metadata(envelope.type, p)) { reject(conversationId, key, 'metadata'); return }
      if (progress.total_bytes > MAX_UPDATE || buffered + bytes.length > MAX_BUFFER ||
        (!a && !progress.final && pending.size >= MAX_PENDING) || (a?.bytes ?? 0) + bytes.length > progress.total_bytes) {
        reject(conversationId, key, 'limit'); return
      }
      if (!a) {
        a = { metadata: metadata(envelope.type, p), index: 0, bytes: 0, data: Buffer.alloc(0), timer: undefined }
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
        a.timer = setTimeout(() => reject(conversationId, key, 'expired'), 30000)
        return
      }
      const data = a.data.subarray(0, a.bytes)
      release(key)
      if (data.length !== progress.total_bytes) { reject(conversationId, undefined, 'final-length'); return }
      if (createHash('sha256').update(envelope.type).update('\0').update(data).digest('hex') !== progress.update_id) {
        reject(conversationId, undefined, 'digest'); return
      }
      let update: ThreadUpdate | null = null
      try { update = logical(envelope.type, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data))) } catch { /* Static repair below. */ }
      if (!update || !matches(update, p)) { reject(conversationId, undefined, 'reconstructed'); return }
      log?.event({ event: 'thread-update-delivered', code: update.type })
      deliver({ kind: 'thread-update', update, envelope: { ...envelope, payload: update.payload } })
    }
  }
}
