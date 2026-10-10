import { createStore } from 'zustand/vanilla'
import type { ThreadItem, ThreadUpdate } from '../../../shared/wire/thread'
import { parseChatHistorySnapshot, type ThreadSnapshot } from '../../../shared/chatHistory'
export type { ThreadSnapshot } from '../../../shared/chatHistory'

type HeldItem = Readonly<Pick<ThreadItem, 'id' | 'kind' | 'rev'> & Record<string, unknown>>
type Range = Readonly<{ start: number; end: number }>
/** Client-owned certification, supplied only after the sync coordinator proves completion. */
export interface ThreadBatchCertificate {
  fromVersion: number
  version: number
  ranges: readonly Range[]
  olderAvailable?: boolean
}
export type ThreadApplyResult =
  | { type: 'applied' | 'ignored' | 'stale' }
  | { type: 'repair'; hostId: string; conversationId: string; epoch: string; throughVersion: number;
      reason: 'missing' | 'base' | 'incompatible' | 'kind' | 'coverage' }
type Slice = { snapshot: ThreadSnapshot; restored?: ThreadSnapshot; generation: symbol; uncommittedVersion: number; byId: ReadonlyMap<number, HeldItem> }
type Batch = {
  applyItems: (items: readonly ThreadItem[], version: number) => readonly ThreadApplyResult[]
  commit: (certificate: ThreadBatchCertificate) => ThreadApplyResult
  abandon: () => void
}
export interface ThreadItemStore {
  hosts: ReadonlyMap<string, ReadonlyMap<string, Slice>>
  snapshot: (hostId: string, conversationId: string) => ThreadSnapshot | null
  beginLocalRead: (hostId: string, conversationId: string) => {
    complete: (snapshot: ThreadSnapshot | null) => void
    fail: () => void
    cancel: () => void
  } | null
  acceptEpoch: (hostId: string, conversationId: string, epoch: string) => void
  applyUpdate: (hostId: string, update: ThreadUpdate) => ThreadApplyResult
  requireRepair: (hostId: string, conversationId: string, epoch: string, version: number) => ThreadApplyResult
  beginBatch: (hostId: string, conversationId: string, epoch: string) => Batch | null
  deleteConversation: (hostId: string, conversationId: string) => void
  removeHost: (hostId: string) => void
  clearAll: () => void
}
const own = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key)
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const number = (value: number): boolean => Number.isSafeInteger(value) && value >= 0
function freeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}
function detach<T>(value: T): T { return freeze(structuredClone(value)) }
function ordered(byId: ReadonlyMap<number, HeldItem>): readonly HeldItem[] {
  return Object.freeze([...byId.values()].sort((a, b) => {
    const ao = typeof a.order === 'number' ? a.order : Infinity
    const bo = typeof b.order === 'number' ? b.order : Infinity
    return ao === bo ? 0 : ao - bo
  }))
}
function rangesUnion(ranges: readonly Range[]): readonly Range[] {
  const merged: { start: number; end: number }[] = []
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    const tail = merged.at(-1)
    if (tail && r.start <= tail.end) tail.end = Math.max(tail.end, r.end)
    else merged.push({ ...r })
  }
  return freeze(merged)
}

/** No production singleton or subscriptions: callers explicitly own epochs and completed replies. */
export function createThreadItemStore(log?: { event: (fields: { event: string; code?: string }) => void }) {
  return createStore<ThreadItemStore>((set, get) => {
    const reads = new Map<string, Map<string, symbol>>()
    const read = (host: string, conversation: string): Slice | undefined => get().hosts.get(host)?.get(conversation)
    function publish(host: string, conversation: string, slice: Slice): void {
      reads.get(host)?.delete(conversation)
      const hosts = new Map(get().hosts), conversations = new Map(hosts.get(host))
      conversations.set(conversation, slice)
      hosts.set(host, conversations)
      set({ hosts })
    }
    function repair(host: string, conversation: string, slice: Slice, version: number,
      reason: Extract<ThreadApplyResult, { type: 'repair' }>['reason']): ThreadApplyResult {
      const s = slice.snapshot
      const fence = { fromVersion: s.repair?.fromVersion ?? s.checkpoint,
        throughVersion: Math.max(s.repair?.throughVersion ?? s.checkpoint, version) }
      publish(host, conversation, { ...slice, snapshot: Object.freeze({ ...s, repair: Object.freeze(fence) }) })
      log?.event({ event: 'thread-items-repair', code: reason })
      return { type: 'repair', hostId: host, conversationId: conversation, epoch: s.epoch,
        throughVersion: fence.throughVersion, reason }
    }
    function applyFull(host: string, conversation: string, slice: Slice, item: ThreadItem, version: number, live: boolean): ThreadApplyResult {
      const held = slice.byId.get(item.id)
      if (held && held.kind !== item.kind) return repair(host, conversation, slice, version, 'kind')
      const newer = !held || item.rev > held.rev
      const byId = new Map(slice.byId)
      if (newer) byId.set(item.id, detach(item))
      success(host, conversation, slice, byId, version, live, newer)
      return { type: newer ? 'applied' : 'ignored' }
    }
    function success(host: string, conversation: string, slice: Slice, byId: ReadonlyMap<number, HeldItem>,
      version: number, live: boolean, changed: boolean): void {
      const s = slice.snapshot
      const nextVersion = Math.max(s.version, version)
      const checkpoint = live && !s.repair && slice.uncommittedVersion <= s.checkpoint ? Math.max(s.checkpoint, version) : s.checkpoint
      const uncommittedVersion = live ? slice.uncommittedVersion : Math.max(slice.uncommittedVersion, version)
      if (!changed && nextVersion === s.version && checkpoint === s.checkpoint && uncommittedVersion === slice.uncommittedVersion) return
      publish(host, conversation, { ...slice, byId,
        uncommittedVersion, snapshot: Object.freeze({ ...s,
        items: changed ? ordered(byId) : s.items, version: nextVersion, checkpoint, uncommittedVersion }) })
      log?.event({ event: 'thread-items-applied', code: live ? 'live' : 'batch' })
    }
    return {
      hosts: new Map(),
      snapshot: (host, conversation) => read(host, conversation)?.snapshot ?? null,
      beginLocalRead(host, conversation) {
        if (read(host, conversation)) return null
        const token = Symbol(), scopes = reads.get(host) ?? new Map<string, symbol>()
        scopes.set(conversation, token); reads.set(host, scopes)
        const current = (): boolean => reads.get(host)?.get(conversation) === token && !read(host, conversation)
        const end = (): void => { if (reads.get(host)?.get(conversation) === token) reads.get(host)?.delete(conversation) }
        return {
          complete(value) {
            if (!current()) return
            end()
            if (value === null) return
            const parsed = parseChatHistorySnapshot({ version: 1, kind: 'daemon-items', serverId: host,
              conversationId: conversation, thread: value })
            if (parsed.kind !== 'daemon-items') return
            const snapshot = detach(parsed.thread)
            publish(host, conversation, { snapshot, restored: snapshot, generation: Symbol(),
              uncommittedVersion: snapshot.uncommittedVersion ?? 0,
              byId: new Map(snapshot.items.map(item => [item.id, item])) })
            log?.event({ event: 'thread-items-restored', code: 'stored' })
          },
          fail: end, cancel: end
        }
      },
      acceptEpoch(host, conversation, epoch) {
        if (read(host, conversation)?.snapshot.epoch === epoch) return
        publish(host, conversation, { generation: Symbol(), uncommittedVersion: 0, byId: new Map(), snapshot: Object.freeze({
          hostId: host, conversationId: conversation, epoch, items: Object.freeze([]),
          version: 0, checkpoint: 0, uncommittedVersion: 0, ranges: Object.freeze([]), repair: null
        }) })
        log?.event({ event: 'thread-items-epoch' })
      },
      requireRepair(host, conversation, epoch, version) {
        const slice = read(host, conversation)
        return !slice || slice.snapshot.epoch !== epoch ? { type: 'stale' } : repair(host, conversation, slice, version, 'base')
      },
      applyUpdate(host, update) {
        const p = update.payload, conversation = p.conversation_id
        const slice = read(host, conversation)
        if (!slice || slice.snapshot.epoch !== p.epoch) return { type: 'stale' }
        if (update.type === 'thread_item_added') return applyFull(host, conversation, slice, update.payload.item, p.version, true)
        const u = update.payload, held = slice.byId.get(u.item_id)
        if (!held) return repair(host, conversation, slice, u.version, 'missing')
        if (held.rev !== u.base_rev) return repair(host, conversation, slice, u.version, 'base')
        let next: HeldItem
        if (u.rev <= u.base_rev || (update.type === 'thread_item_changed' &&
          (own(update.payload.changes, 'id') || own(update.payload.changes, 'kind')))) {
          return repair(host, conversation, slice, u.version, 'incompatible')
        }
        if (update.type === 'thread_item_changed') {
          // Spread copies own data properties into an inert item, never an application state object.
          next = detach({ ...held, ...update.payload.changes, rev: u.rev })
        } else {
          const content = held.content
          if ((held.kind !== 'user_message' && held.kind !== 'assistant_message') ||
            !record(content) || !own(content, 'text') || typeof content.text !== 'string') {
            return repair(host, conversation, slice, u.version, 'incompatible')
          }
          next = detach({ ...held, content: { ...content, text: content.text + update.payload.text }, rev: u.rev })
        }
        const byId = new Map(slice.byId)
        byId.set(held.id, next)
        success(host, conversation, slice, byId, u.version, true, true)
        return { type: 'applied' }
      },
      beginBatch(host, conversation, epoch) {
        const initial = read(host, conversation)
        if (!initial || initial.snapshot.epoch !== epoch) return null
        const generation = initial.generation
        let ended = false, failed = false
        const current = (): Slice | undefined => {
          const slice = read(host, conversation)
          return !ended && slice?.generation === generation ? slice : undefined
        }
        log?.event({ event: 'thread-items-batch', code: 'begun' })
        return {
          applyItems(items, version) {
            if (!current()) return [{ type: 'stale' }]
            const results: ThreadApplyResult[] = []
            for (const item of items) {
              const slice = current()
              if (!slice) { results.push({ type: 'stale' }); break }
              const result = applyFull(host, conversation, slice, item, version, false)
              if (result.type === 'repair') failed = true
              results.push(result)
            }
            return results
          },
          commit(certificate) {
            const slice = current()
            ended = true
            if (!slice || failed) return { type: 'stale' }
            const c = certificate, s = slice.snapshot
            if (!number(c.fromVersion) || !number(c.version) || c.fromVersion > c.version || c.fromVersion > s.checkpoint ||
              c.ranges.some(r => !number(r.start) || !number(r.end) || r.start > r.end) ||
              (s.repair && (c.fromVersion > s.repair.fromVersion || c.version < s.repair.throughVersion))) {
              log?.event({ event: 'thread-items-repair', code: 'coverage' })
              return { type: 'repair', hostId: host, conversationId: conversation, epoch,
                throughVersion: s.repair?.throughVersion ?? s.checkpoint, reason: 'coverage' }
            }
            const ranges = rangesUnion([...s.ranges, ...c.ranges])
            const oldest = s.ranges[0]?.start ?? Infinity, suppliedOldest = Math.min(...c.ranges.map(r => r.start))
            const olderAvailable = c.olderAvailable !== undefined &&
              (suppliedOldest < oldest || (suppliedOldest === oldest && s.olderAvailable !== false))
              ? c.olderAvailable : s.olderAvailable
            publish(host, conversation, { ...slice,
              uncommittedVersion: c.version >= slice.uncommittedVersion ? 0 : slice.uncommittedVersion,
              snapshot: Object.freeze({ ...s, ranges, olderAvailable,
              uncommittedVersion: c.version >= slice.uncommittedVersion ? 0 : slice.uncommittedVersion,
              version: Math.max(s.version, c.version), checkpoint: Math.max(s.checkpoint, c.version), repair: null }) })
            log?.event({ event: 'thread-items-batch', code: 'committed' })
            return { type: 'applied' }
          },
          abandon() { ended = true; log?.event({ event: 'thread-items-batch', code: 'abandoned' }) }
        }
      },
      deleteConversation(host, conversation) {
        reads.get(host)?.delete(conversation)
        if (!read(host, conversation)) return
        const hosts = new Map(get().hosts), conversations = new Map(hosts.get(host))
        conversations.delete(conversation)
        if (conversations.size) hosts.set(host, conversations)
        else hosts.delete(host)
        set({ hosts })
        log?.event({ event: 'thread-items-cleared', code: 'conversation' })
      },
      removeHost(host) {
        reads.delete(host)
        const hosts = new Map(get().hosts)
        if (!hosts.delete(host)) return
        set({ hosts })
        log?.event({ event: 'thread-items-cleared', code: 'host' })
      },
      clearAll() {
        reads.clear()
        if (!get().hosts.size) return
        set({ hosts: new Map() })
        log?.event({ event: 'thread-items-cleared', code: 'pairing' })
      }
    }
  })
}
