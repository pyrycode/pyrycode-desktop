import { isSameRevisionTextExtension } from '../../../shared/threadTextExtension'
import { createStore } from 'zustand/vanilla'
import type { ThreadItem, ThreadUpdate } from '../../../shared/wire/thread'
import { parseChatHistorySnapshot, threadHistoryCodec, type ThreadHistoryPage, type ThreadSnapshot, type OwnedThreadChanges } from '../../../shared/chatHistory'
export type { ThreadSnapshot } from '../../../shared/chatHistory'

type HeldItem = Readonly<Pick<ThreadItem, 'id' | 'kind' | 'rev'> & Record<string, unknown>>
type Range = Readonly<{ start: number; end: number }>
type RestoreProgress = Pick<OwnedThreadChanges, 'metadata' | 'completion' | 'availability' | 'ranges'>
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
type Slice = { appendCompanion?: { id: number; rev: number; version: number }; snapshot: ThreadSnapshot; restored?: ThreadSnapshot; owned?: OwnedThreadChanges; generation: symbol; uncommittedVersion: number; byId: ReadonlyMap<number, HeldItem>;
  availabilityStart?: number; residency?: { continuation: string | null; traversal?: string | null; arrivalPositions: ReadonlyMap<number, number> } }
type Batch = {
  applyItems: (items: readonly ThreadItem[], version: number) => readonly ThreadApplyResult[]
  commit: (certificate: ThreadBatchCertificate) => ThreadApplyResult
  abandon: () => void
}
export interface ThreadItemStore {
  hosts: ReadonlyMap<string, ReadonlyMap<string, Slice>>
  snapshot: (hostId: string, conversationId: string) => ThreadSnapshot | null
  beginLocalRead: (hostId: string, conversationId: string, heldPage?: boolean) => {
    complete: (snapshot: ThreadSnapshot | ThreadHistoryPage | null) => void
    fail: () => void
    cancel: () => void
  } | null
  acceptEpoch: (hostId: string, conversationId: string, epoch: string, reset?: boolean) => void
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

/** Replay received progress against saved obligations, as the owned writer does on disk. */
function restoredProgress(saved: ThreadSnapshot, progress: readonly RestoreProgress[], boundary?: number) {
  let old = saved, oldest = boundary ?? saved.ranges[0]?.start ?? Infinity
  for (const p of progress) {
    const next = p.metadata, completion = p.completion
    const certified = completion !== undefined && completion.fromVersion <= old.checkpoint
    const fenced = old.repair !== null || (old.uncommittedVersion ?? 0) > old.checkpoint
    const bound = completion || fenced ? certified ? completion.version : old.checkpoint : next.checkpoint
    const checkpoint = Math.max(old.checkpoint, Math.min(next.checkpoint, bound))
    const oldRepair = old.repair && !(certified && completion.version >= old.repair.throughVersion) ? old.repair : null
    const nextRepair = next.repair && (next.repair.fromVersion >= old.checkpoint || next.repair.throughVersion > old.checkpoint)
      ? next.repair : null
    const missing = completion !== undefined && !certified
    const repair = oldRepair || nextRepair || missing ? { fromVersion: checkpoint,
      throughVersion: Math.max(checkpoint, oldRepair?.throughVersion ?? 0, nextRepair?.throughVersion ?? 0,
        missing ? completion.version : 0) } : null
    const unfinished = old.uncommittedVersion ?? 0
    const retain = !(certified && completion.version >= unfinished)
    const uncommittedVersion = Math.max(next.uncommittedVersion ?? 0,
      retain && (unfinished > next.checkpoint || fenced) ? unfinished : 0)
    let olderAvailable = old.olderAvailable
    const boundary = p.availability
    if (boundary && (boundary.start < oldest || boundary.start === oldest && olderAvailable !== false)) {
      oldest = boundary.start; olderAvailable = boundary.available
    }
    old = { ...old, version: Math.max(old.version, next.version), checkpoint, repair, uncommittedVersion,
      olderAvailable, ranges: rangesUnion([...old.ranges, ...p.ranges]) }
  }
  return { snapshot: old, availabilityStart: Number.isFinite(oldest) ? oldest : undefined }
}

/** No production singleton or subscriptions: callers explicitly own epochs and completed replies. */
export function createThreadItemStore(log?: { event: (fields: { event: string; code?: string }) => void }) {
  return createStore<ThreadItemStore>((set, get) => {
    const reads = new Map<string, Map<string, { progress: RestoreProgress[] }>>()
    const read = (host: string, conversation: string): Slice | undefined => get().hosts.get(host)?.get(conversation)
    function publish(host: string, conversation: string, slice: Slice,
      change: { item?: HeldItem; ranges?: readonly Range[]; acceptEpoch?: boolean; resetId?: string;
        availability?: OwnedThreadChanges['availability']; completion?: OwnedThreadChanges['completion'] } = {}): void {
      if (slice.snapshot !== slice.restored) {
        const { items: ignoredItems, ranges: ignoredRanges, arrivalOrder: ignoredArrival, ...metadata } = slice.snapshot
        void ignoredItems; void ignoredRanges; void ignoredArrival
        const owned: OwnedThreadChanges = { metadata, acceptEpoch: change.acceptEpoch ?? false,
          ...(change.resetId === undefined ? {} : { resetId: change.resetId }),
          ...(change.availability === undefined ? {} : { availability: change.availability }),
          ...(change.completion === undefined ? {} : { completion: change.completion }),
          items: change.item === undefined ? [] : [change.item],
          removeIds: [], ranges: change.ranges ?? [] }
        slice = { ...slice, owned }
        reads.get(host)?.get(conversation)?.progress.push({ metadata, ranges: owned.ranges,
          completion: owned.completion, availability: owned.availability })
      }
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
      publish(host, conversation, { ...slice, appendCompanion: undefined, snapshot: Object.freeze({ ...s, repair: Object.freeze(fence) }) })
      log?.event({ event: 'thread-items-repair', code: reason })
      return { type: 'repair', hostId: host, conversationId: conversation, epoch: s.epoch,
        throughVersion: fence.throughVersion, reason }
    }
    function applyFull(host: string, conversation: string, slice: Slice, item: ThreadItem, version: number, live: boolean): ThreadApplyResult {
      const held = slice.byId.get(item.id)
      if (held && held.kind !== item.kind) return repair(host, conversation, slice, version, 'kind')
      const newer = !held || item.rev > held.rev || isSameRevisionTextExtension(held, item)
      const byId = new Map(slice.byId)
      if (newer) byId.set(item.id, detach(item))
      success(host, conversation, slice, byId, version, live, newer, newer ? byId.get(item.id) : undefined)
      return { type: newer ? 'applied' : 'ignored' }
    }
    function success(host: string, conversation: string, slice: Slice, byId: ReadonlyMap<number, HeldItem>,
      version: number, live: boolean, changed: boolean, item?: HeldItem, appendCompanion?: Slice['appendCompanion']): void {
      const s = slice.snapshot
      const nextVersion = Math.max(s.version, version)
      const checkpoint = live && !s.repair && slice.uncommittedVersion <= s.checkpoint ? Math.max(s.checkpoint, version) : s.checkpoint
      const uncommittedVersion = live ? slice.uncommittedVersion : Math.max(slice.uncommittedVersion, version)
      if (!slice.appendCompanion && !appendCompanion && !changed && nextVersion === s.version && checkpoint === s.checkpoint && uncommittedVersion === slice.uncommittedVersion) return
      publish(host, conversation, { ...slice, byId, appendCompanion,
        uncommittedVersion, snapshot: Object.freeze({ ...s,
        items: changed ? ordered(byId) : s.items,
        arrivalOrder: changed ? Object.freeze([...byId.keys()]) : s.arrivalOrder,
        version: nextVersion, checkpoint, uncommittedVersion }) }, { item })
      log?.event({ event: 'thread-items-applied', code: live ? 'live' : 'batch' })
    }
    return {
      hosts: new Map(),
      snapshot: (host, conversation) => read(host, conversation)?.snapshot ?? null,
      beginLocalRead(host, conversation, heldPage = false) {
        const initial = read(host, conversation)
        if (heldPage ? !initial || reads.get(host)?.has(conversation) : initial) return null
        const token: { progress: RestoreProgress[] } = { progress: [] }, scopes = reads.get(host) ?? new Map()
        scopes.set(conversation, token); reads.set(host, scopes)
        const current = (): boolean => reads.get(host)?.get(conversation) === token
        const end = (): void => { if (reads.get(host)?.get(conversation) === token) reads.get(host)?.delete(conversation) }
        return {
          complete(value) {
            if (!current()) return
            end()
            if (value === null) return
            const page = 'partial' in value ? threadHistoryCodec.page(value, host, conversation) : undefined
            const arrivals = page?.arrivalPositions
            const parsed = parseChatHistorySnapshot({ version: 1, kind: 'daemon-items', serverId: host,
              conversationId: conversation, thread: page ? { ...page.metadata, items: page.items, ranges: page.ranges,
                ...(arrivals === undefined ? {} : { arrivalOrder: page.items.map((item, index) => ({ id: item.id, at: arrivals[index] }))
                  .sort((a, b) => a.at - b.at).map(item => item.id) }) } : value })
            if (parsed.kind !== 'daemon-items') return
            let snapshot = detach(parsed.thread)
            let availabilityStart: number | undefined = page?.availabilityStart ?? snapshot.ranges[0]?.start
            const admitted = read(host, conversation)
            if (admitted && admitted.snapshot.epoch !== snapshot.epoch) return
            const items = new Map(snapshot.items.map(item => [item.id, item])), byId = new Map<number, HeldItem>()
            // Older snapshots have only display order; new ones retain the original arrival order.
            for (const id of snapshot.arrivalOrder ?? items.keys()) {
              const item = items.get(id)
              if (item !== undefined) byId.set(id, item)
            }
            if (admitted) {
              let incompatible = false
              for (const [id, item] of admitted.byId) {
                const stored = byId.get(id)
                if (stored && stored.kind !== item.kind) incompatible = true
                if (!stored || stored.kind !== item.kind || item.rev >= stored.rev) byId.set(id, item)
              }
              if (heldPage) {
                snapshot = { ...admitted.snapshot, ranges: rangesUnion([...admitted.snapshot.ranges, ...snapshot.ranges]) }
                availabilityStart = admitted.availabilityStart
                // Saved positions can be sparse, and opening's closure may precede unvisited content.
                const positions = new Map(admitted.residency?.arrivalPositions)
                page?.items.forEach((item, index) => positions.set(item.id, arrivals?.[index] ?? index))
                const stable = [...byId].sort(([a], [b]) => (positions.get(a) ?? Infinity) - (positions.get(b) ?? Infinity))
                byId.clear(); stable.forEach(([id, item]) => byId.set(id, item))
              } else {
                const progress = restoredProgress(snapshot, token.progress, availabilityStart)
                snapshot = progress.snapshot; availabilityStart = progress.availabilityStart
              }
              snapshot = detach({ ...snapshot, items: ordered(byId), arrivalOrder: [...byId.keys()],
                ...(incompatible ? { repair: { fromVersion: snapshot.checkpoint,
                  throughVersion: Math.max(snapshot.version, snapshot.repair?.throughVersion ?? 0) } } : {}) })
              if (incompatible) log?.event({ event: 'thread-items-repair', code: 'kind' })
            }
            // Saved restoration does not consume a live pair. Retain it only
            // when that exact admitted item wins the same-owner merge.
            const companion = admitted?.appendCompanion
            const appendCompanion = companion && byId.get(companion.id) === admitted.byId.get(companion.id) ? companion : undefined
            publish(host, conversation, { snapshot, restored: snapshot, appendCompanion, generation: admitted?.generation ?? Symbol(),
              uncommittedVersion: snapshot.uncommittedVersion ?? 0, byId, availabilityStart,
              ...(page ? { residency: { continuation: page.continuation,
                ...(heldPage ? { traversal: page.continuation } : {}),
                arrivalPositions: new Map([...(admitted?.residency?.arrivalPositions ?? []),
                  ...page.items.map((item, index): [number, number] => [item.id, arrivals?.[index] ?? index])]) } } : {}) })
            log?.event({ event: 'thread-items-restored', code: 'stored' })
          },
          fail: end, cancel: end
        }
      },
      acceptEpoch(host, conversation, epoch, reset = false) {
        const held = read(host, conversation)
        if (!reset && held?.snapshot.epoch === epoch) return
        if (reset || held) reads.get(host)?.delete(conversation)
        publish(host, conversation, { generation: Symbol(), uncommittedVersion: 0, byId: new Map(), snapshot: Object.freeze({
          hostId: host, conversationId: conversation, epoch, items: Object.freeze([]), arrivalOrder: Object.freeze([]),
          version: 0, checkpoint: 0, uncommittedVersion: 0, ranges: Object.freeze([]), repair: null
        }) }, { acceptEpoch: true, ...(reset ? { resetId: crypto.randomUUID() } : {}) })
        log?.event({ event: 'thread-items-epoch' })
      },
      requireRepair(host, conversation, epoch, version) {
        const slice = read(host, conversation)
        return !slice || slice.snapshot.epoch !== epoch ? { type: 'stale' } : repair(host, conversation, slice, version, 'base')
      },
      applyUpdate(host, update) {
        const p = update.payload, conversation = p.conversation_id
        if (!read(host, conversation) && reads.get(host)?.has(conversation) && update.type === 'thread_item_added')
          get().acceptEpoch(host, conversation, p.epoch)
        const slice = read(host, conversation)
        if (!slice || slice.snapshot.epoch !== p.epoch) return { type: 'stale' }
        if (update.type === 'thread_item_added') return applyFull(host, conversation, slice, update.payload.item, p.version, true)
        const u = update.payload, held = slice.byId.get(u.item_id)
        if (!held) return repair(host, conversation, slice, u.version, 'missing')
        if (held.rev !== u.base_rev) return repair(host, conversation, slice, u.version, 'base')
        let next: HeldItem
        const companion = update.type === 'thread_text_append' && u.rev === u.base_rev &&
          slice.appendCompanion?.id === u.item_id && slice.appendCompanion.rev === u.rev &&
          slice.appendCompanion.version === u.version
        if (u.rev < u.base_rev || (u.rev === u.base_rev && !companion) || (update.type === 'thread_item_changed' &&
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
        success(host, conversation, slice, byId, u.version, true, true, next,
          update.type === 'thread_item_changed' ? { id: u.item_id, rev: u.rev, version: u.version } : undefined)
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
            const oldest = slice.availabilityStart ?? s.ranges[0]?.start ?? Infinity, suppliedOldest = Math.min(...c.ranges.map(r => r.start))
            const olderAvailable = c.olderAvailable !== undefined &&
              (suppliedOldest < oldest || (suppliedOldest === oldest && s.olderAvailable !== false))
              ? c.olderAvailable : s.olderAvailable
            publish(host, conversation, { ...slice, appendCompanion: undefined,
              availabilityStart: c.olderAvailable !== undefined && suppliedOldest <= oldest && Number.isFinite(suppliedOldest)
                ? suppliedOldest : slice.availabilityStart,
              uncommittedVersion: c.version >= slice.uncommittedVersion ? 0 : slice.uncommittedVersion,
              snapshot: Object.freeze({ ...s, ranges, olderAvailable,
              uncommittedVersion: c.version >= slice.uncommittedVersion ? 0 : slice.uncommittedVersion,
              version: Math.max(s.version, c.version), checkpoint: Math.max(s.checkpoint, c.version), repair: null }) },
              { ranges: c.ranges, completion: { fromVersion: c.fromVersion, version: c.version },
                ...(c.olderAvailable === undefined || c.ranges.length === 0 ? {} : {
                  availability: { start: Math.min(...c.ranges.map(r => r.start)), available: c.olderAvailable }
                }) })
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
