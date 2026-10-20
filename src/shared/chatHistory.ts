import { agentFromWire, type ConversationSummary } from './wire/types'
import { MAX_SERVER_ID_LENGTH } from './ipc/unpair'

export const CHAT_HISTORY_CHANNEL = 'pyry:chat-history'
export const CHAT_HISTORY_FLUSH_CHANNEL = 'pyry:chat-history-flush'
export const MAX_CHAT_HISTORY_ITEMS = 100_000

/** Retained daemon facts; optional fields may have been explicitly cleared by patches. */
export interface ThreadSnapshot {
  readonly hostId: string
  readonly conversationId: string
  readonly epoch: string
  readonly items: readonly Readonly<{ id: number; kind: string; rev: number } & Record<string, unknown>>[]
  /** Held item ids in first-arrival order, independent of display placement. */
  readonly arrivalOrder?: readonly number[]
  readonly version: number
  readonly checkpoint: number
  /** Highest unfinished batch version; only progress above checkpoint fences live success. */
  readonly uncommittedVersion?: number
  readonly ranges: readonly Readonly<{ start: number; end: number }>[]
  readonly olderAvailable?: boolean
  readonly repair: Readonly<{ fromVersion: number; throughVersion: number }> | null
}

export type ChatHistorySnapshot = { version: 1; serverId: string } & (
  | { kind: 'list'; conversations: ConversationSummary[] }
  | { kind: 'daemon-items'; conversationId: string; thread: ThreadSnapshot }
)
type ThreadProgress = {
  metadata: Omit<ThreadSnapshot, 'items' | 'ranges' | 'arrivalOrder'>
  /** Exact completed version interval, never inferred from a later live checkpoint. */
  completion?: { fromVersion: number; version: number }
  availability?: { start: number; available: boolean }
}
export type OwnedThreadChanges = ThreadProgress & {
  acceptEpoch: boolean
  resetId?: string
  /** Local ordered persistence only; grants no daemon progress or owner authority. */
  persistence?: { id: string; part: number; parts: number }
  /** Earlier owned observations, in admission order, retained through coalescing/retry. */
  priorProgress?: readonly ThreadProgress[]
  items: ThreadSnapshot['items']
  removeIds: readonly number[]
  ranges: ThreadSnapshot['ranges']
}
export type ThreadHistoryPage = {
  partial: true
  metadata: Omit<ThreadSnapshot, 'items' | 'ranges' | 'arrivalOrder'>
  items: ThreadSnapshot['items']; ranges: ThreadSnapshot['ranges']
  arrivalPositions?: readonly number[]
  availabilityStart?: number
  continuation: string | null
  recovery?: string
}
export type ChatHistoryRequest = { serverId: string } & (
  | { operation: 'openThreadPage' | 'newestThreadPage'; conversationId: string; limit: number }
  | { operation: 'beforeThreadPage'; conversationId: string; limit: number; continuation: string; recovery?: string }
  | { operation: 'mutateThread'; conversationId: string; change: OwnedThreadChanges }
  | { operation: 'readList' }
  | { operation: 'removeServer' }
  | { operation: 'readThread'; conversationId: string }
  | { operation: 'removeConversation'; conversationId: string }
  | { operation: 'replaceList'; snapshot: Extract<ChatHistorySnapshot, { kind: 'list' }> }
  | { operation: 'replaceThread'; conversationId: string; snapshot: Extract<ChatHistorySnapshot, { kind: 'daemon-items' }> }
)
export type ChatHistoryResult =
  | { status: 'page'; page: ThreadHistoryPage }
  | { status: 'missing' }
  | { status: 'stored'; snapshot: ChatHistorySnapshot }
  | { status: 'ok' }
  | { status: 'error'; code: 'invalid-request' | 'unknown-host' | 'membership-unavailable' | 'unreadable' |
      'unsupported-version' | 'encryption-unavailable' | 'write-failed' | 'remove-failed' }

// Static sentinels are compared by identity; never forward a caught Error.
export const INVALID_CHAT_HISTORY = new Error('invalid chat history')
export const UNSUPPORTED_CHAT_HISTORY_VERSION = new Error('unsupported chat history version')
function invalid(): never { throw INVALID_CHAT_HISTORY }
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function record(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : invalid()
}
function string(v: unknown): string {
  return typeof v === 'string' && v.length <= 16 * 1024 * 1024 ? v : invalid()
}
function id(v: unknown): string {
  const s = string(v)
  return s.length <= MAX_SERVER_ID_LENGTH ? s : invalid()
}
function bool(v: unknown): boolean {
  return typeof v === 'boolean' ? v : invalid()
}
function number(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : invalid()
}
function optional<T>(v: unknown, parse: (v: unknown) => T): T | undefined {
  return v === undefined ? undefined : parse(v)
}
function nullable<T>(v: unknown, parse: (v: unknown) => T): T | null {
  return v === null ? null : parse(v)
}
function array<T>(v: unknown, parse: (v: unknown) => T): T[] {
  if (!Array.isArray(v) || v.length > MAX_CHAT_HISTORY_ITEMS) return invalid()
  return Array.from(v, parse)
}
function choice<T extends string>(v: unknown, choices: readonly T[]): T {
  return choices.find((candidate) => candidate === v) ?? invalid()
}
function readId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return invalid()
  return value
}

function retainedItems(value: unknown): ThreadSnapshot['items'] {
  let nodes = 0
  function json(value: unknown, depth = 0): unknown {
    if (++nodes > MAX_CHAT_HISTORY_ITEMS || depth > 64) return invalid()
    if (value === null || typeof value === 'boolean') return value
    if (typeof value === 'string') return string(value)
    if (typeof value === 'number') return number(value)
    if (Array.isArray(value)) return array(value, child => json(child, depth + 1))
    const entries = Object.entries(record(value))
    if (entries.length > MAX_CHAT_HISTORY_ITEMS ||
        (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return invalid()
    // fromEntries creates own data properties, including __proto__, without invoking setters.
    return Object.fromEntries(entries.map(([key, child]) => [string(key), json(child, depth + 1)]))
  }
  return array(value, value => {
    const item = record(json(value))
    return { ...item, id: readId(item.id), kind: string(item.kind), rev: readId(item.rev) }
  })
}
function retainedRanges(value: unknown): ThreadSnapshot['ranges'] {
  const ranges = array(value, value => {
    const r = record(value), start = readId(r.start), end = readId(r.end)
    return start <= end ? { start, end } : invalid()
  })
  if (ranges.some((r, i) => i > 0 && r.start <= ranges[i - 1].end)) return invalid()
  return ranges
}
function retainedMetadata(value: unknown, hostId: string, conversationId: string): Omit<ThreadSnapshot, 'items' | 'ranges' | 'arrivalOrder'> {
  const v = record(value)
  const version = readId(v.version), checkpoint = readId(v.checkpoint)
  const uncommittedVersion = v.uncommittedVersion === undefined ? (version > checkpoint ? version : 0) : readId(v.uncommittedVersion)
  const repair = nullable(v.repair, value => {
    const r = record(value), fromVersion = readId(r.fromVersion), throughVersion = readId(r.throughVersion)
    return fromVersion === checkpoint && throughVersion >= fromVersion ? { fromVersion, throughVersion } : invalid()
  })
  if (id(v.hostId) !== hostId || id(v.conversationId) !== conversationId || checkpoint > version ||
      uncommittedVersion > version) return invalid()
  return { hostId, conversationId, epoch: id(v.epoch), version, checkpoint, uncommittedVersion, repair,
    ...(v.olderAvailable === undefined ? {} : { olderAvailable: bool(v.olderAvailable) }) }
}
/** Selected facts share admission with full snapshots, without claiming complete membership. */
export const threadHistoryCodec = { items: retainedItems, ranges: retainedRanges, metadata: retainedMetadata,
  page(value: unknown, hostId: string, conversationId: string): ThreadHistoryPage {
    const v = record(value), items = retainedItems(v.items), ranges = retainedRanges(v.ranges)
    const arrivalPositions = optional(v.arrivalPositions, value => array(value, readId))
    const continuation = v.continuation === null ? null : string(v.continuation)
    const recovery = optional(v.recovery, localToken)
    if (v.partial !== true || new Set(items.map(i => i.id)).size !== items.length ||
        arrivalPositions !== undefined && (arrivalPositions.length !== items.length || new Set(arrivalPositions).size !== items.length) ||
        continuation !== null && (continuation.length === 0 || continuation.length > 65536 || !/^[A-Za-z0-9_-]+$/.test(continuation))) return invalid()
    return { partial: true, metadata: retainedMetadata(v.metadata, hostId, conversationId), items, ranges,
      ...(arrivalPositions === undefined ? {} : { arrivalPositions }),
      ...(v.availabilityStart === undefined ? {} : { availabilityStart: readId(v.availabilityStart) }), continuation,
      ...(recovery === undefined ? {} : { recovery }) }
  },
  nodes(value: unknown): number {
    if (typeof value !== 'object' || value === null) return 1
    return 1 + Object.values(value).reduce<number>((n, child) => n + threadHistoryCodec.nodes(child), 0)
  } }

function retainedThread(value: unknown, hostId: string, conversationId: string): ThreadSnapshot {
  const v = record(value), items = retainedItems(v.items), ranges = retainedRanges(v.ranges)
  const itemIds = new Set(items.map(item => item.id))
  const arrivalOrder = optional(v.arrivalOrder, value => array(value, readId))
  if (itemIds.size !== items.length ||
      (arrivalOrder !== undefined && (arrivalOrder.length !== items.length ||
        new Set(arrivalOrder).size !== items.length || arrivalOrder.some(id => !itemIds.has(id))))) return invalid()
  return { ...retainedMetadata(v, hostId, conversationId), items, ranges,
    ...(arrivalOrder === undefined ? {} : { arrivalOrder }) }
}

export function parseChatHistorySnapshot(value: unknown): ChatHistorySnapshot {
  const v = record(value)
  if (typeof v.version !== 'number' || !Number.isSafeInteger(v.version)) return invalid()
  if (v.version !== 1) throw UNSUPPORTED_CHAT_HISTORY_VERSION
  const serverId = id(v.serverId)
  if (v.kind === 'list') {
    const conversations = array(v.conversations, (x): ConversationSummary => {
      const c = record(x)
      return {
        id: id(c.id), name: nullable(c.name, string), is_promoted: bool(c.is_promoted),
        is_archived: bool(c.is_archived), cwd: string(c.cwd), last_message_ts: string(c.last_message_ts),
        last_used_at: string(c.last_used_at), workspace_label: nullable(c.workspace_label, string),
        is_muted: optional(c.is_muted, bool),
        ...(c.read_up_to === undefined ? {} : { read_up_to: readId(c.read_up_to) }),
        ...(c.latest_entry_id === undefined ? {} : { latest_entry_id: readId(c.latest_entry_id) }),
        ...(c.archived_at === undefined ? {} : { archived_at: nullable(c.archived_at, string) }),
        ...(c.pinned_at === undefined ? {} : { pinned_at: nullable(c.pinned_at, string) }),
        // An untagged row restores with no key at all, as before #1649.
        ...(c.agent === undefined ? {} : { agent: agentFromWire(string(c.agent)) })
      }
    })
    if (new Set(conversations.map((c) => c.id)).size !== conversations.length) return invalid()
    return { version: 1, kind: 'list', serverId, conversations }
  }
  if (v.kind === 'daemon-items') {
    const conversationId = id(v.conversationId)
    return { version: 1, kind: v.kind, serverId, conversationId, thread: retainedThread(v.thread, serverId, conversationId) }
  }
  return invalid()
}

function localToken(value: unknown): string {
  const token = string(value)
  return token.length > 0 && token.length <= 65536 && /^[A-Za-z0-9_-]+$/.test(token) ? token : invalid()
}
export function parseChatHistoryRequest(value: unknown): ChatHistoryRequest {
  const v = record(value)
  const serverId = id(v.serverId)
  if (v.operation === 'openThreadPage' || v.operation === 'newestThreadPage' || v.operation === 'beforeThreadPage') {
    const limit = readId(v.limit), conversationId = id(v.conversationId), before = v.operation === 'beforeThreadPage'
    if (limit < 1 || limit > 200 || Object.keys(v).some(k =>
      !['operation', 'serverId', 'conversationId', 'limit', ...(before ? ['continuation', 'recovery'] : [])].includes(k))) return invalid()
    if (v.operation !== 'beforeThreadPage') return { operation: v.operation, serverId, conversationId, limit }
    const continuation = localToken(v.continuation), recovery = optional(v.recovery, localToken)
    return { operation: 'beforeThreadPage', serverId, conversationId, limit, continuation,
      ...(recovery === undefined ? {} : { recovery }) }
  }
  if (v.operation === 'mutateThread') {
    if (Object.keys(v).some(k => !['operation', 'serverId', 'conversationId', 'change'].includes(k))) return invalid()
    const conversationId = id(v.conversationId), c = record(v.change)
    if (Object.keys(c).some(k => !['metadata', 'acceptEpoch', 'resetId', 'persistence', 'completion', 'availability', 'priorProgress', 'items', 'removeIds', 'ranges'].includes(k))) return invalid()
    const persistence = optional(c.persistence, value => {
      const p = record(value), token = id(p.id), part = readId(p.part), parts = readId(p.parts)
      if (Object.keys(p).some(k => !['id', 'part', 'parts'].includes(k)) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token) ||
        parts < 2 || parts > MAX_CHAT_HISTORY_ITEMS || part >= parts ||
        !Array.isArray(c.items) || !Array.isArray(c.removeIds) || !Array.isArray(c.ranges) ||
        c.priorProgress !== undefined && !Array.isArray(c.priorProgress) ||
        c.items.length + c.removeIds.length + c.ranges.length +
          (Array.isArray(c.priorProgress) ? c.priorProgress.length : 0) + 1 > 32) return invalid()
      return { id: token, part, parts }
    })
    const metadata = retainedMetadata(c.metadata, serverId, conversationId)
    const progress = (value: unknown): ThreadProgress => {
      const p = record(value)
      const held = retainedMetadata(p.metadata, serverId, conversationId)
      if (held.epoch !== metadata.epoch) return invalid()
      const completion = optional(p.completion, value => {
        const c = record(value), fromVersion = readId(c.fromVersion), version = readId(c.version)
        if (Object.keys(c).some(k => !['fromVersion', 'version'].includes(k)) ||
          fromVersion > version || version > held.checkpoint) return invalid()
        return { fromVersion, version }
      })
      const availability = optional(p.availability, value => {
        const a = record(value)
        if (Object.keys(a).some(k => !['start', 'available'].includes(k)) || completion === undefined) return invalid()
        return { start: readId(a.start), available: bool(a.available) }
      })
      return { metadata: held, ...(completion === undefined ? {} : { completion }),
        ...(availability === undefined ? {} : { availability }) }
    }
    const priorProgress = optional(c.priorProgress, value => array(value, value => {
      const p = record(value)
      if (Object.keys(p).some(k => !['metadata', 'completion', 'availability'].includes(k))) return invalid()
      return progress(p)
    }))
    const items = retainedItems(c.items)
    const removeIds = array(c.removeIds, readId), ids = new Set(items.map(i => i.id))
    if (ids.size !== items.length || new Set(removeIds).size !== removeIds.length || removeIds.some(id => ids.has(id))) return invalid()
    const ranges = retainedRanges(c.ranges)
    return { operation: 'mutateThread', serverId, conversationId, change: {
      ...progress(c), acceptEpoch: bool(c.acceptEpoch),
      ...(c.resetId === undefined ? {} : { resetId: id(c.resetId) }),
      ...(persistence === undefined ? {} : { persistence }),
      ...(priorProgress === undefined ? {} : { priorProgress }),
      items, removeIds, ranges
    } }
  }
  const operation = choice(v.operation, ['readList', 'replaceList', 'readThread', 'replaceThread', 'removeConversation', 'removeServer'])
  const hasConversation = operation === 'readThread' || operation === 'replaceThread' || operation === 'removeConversation'
  const replacing = operation === 'replaceList' || operation === 'replaceThread'
  const keys = ['operation', 'serverId', ...(hasConversation ? ['conversationId'] : []), ...(replacing ? ['snapshot'] : [])]
  if (Object.keys(v).some((key) => !keys.includes(key))) return invalid()
  if (operation === 'readList' || operation === 'removeServer') return { operation, serverId }
  if (operation === 'readThread' || operation === 'removeConversation') return { operation, serverId, conversationId: id(v.conversationId) }
  const snapshot = parseChatHistorySnapshot(v.snapshot)
  if (snapshot.serverId !== serverId) return invalid()
  if (operation === 'replaceList' && snapshot.kind === 'list') return { operation, serverId, snapshot }
  if (operation === 'replaceThread' && snapshot.kind === 'daemon-items' && snapshot.conversationId === id(v.conversationId)) {
    return { operation, serverId, conversationId: snapshot.conversationId, snapshot }
  }
  return invalid()
}
