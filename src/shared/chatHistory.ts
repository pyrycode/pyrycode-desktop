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
export type ChatHistoryRequest = { serverId: string } & (
  | { operation: 'readList' }
  | { operation: 'removeServer' }
  | { operation: 'readThread'; conversationId: string }
  | { operation: 'removeConversation'; conversationId: string }
  | { operation: 'replaceList'; snapshot: Extract<ChatHistorySnapshot, { kind: 'list' }> }
  | { operation: 'replaceThread'; conversationId: string; snapshot: Extract<ChatHistorySnapshot, { kind: 'daemon-items' }> }
)
export type ChatHistoryResult =
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
export const threadHistoryCodec = { items: retainedItems, ranges: retainedRanges, metadata: retainedMetadata }

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

export function parseChatHistoryRequest(value: unknown): ChatHistoryRequest {
  const v = record(value)
  const serverId = id(v.serverId)
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
