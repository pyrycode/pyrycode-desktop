import { agentFromWire, type ConversationSummary } from './wire/types'
import type { ModelRefusalEvent } from './ipc/events'
import { MAX_SERVER_ID_LENGTH } from './ipc/unpair'

export const CHAT_HISTORY_CHANNEL = 'pyry:chat-history'
export const CHAT_HISTORY_FLUSH_CHANNEL = 'pyry:chat-history-flush'
export const MAX_CHAT_HISTORY_ITEMS = 100_000

/** Display records only: no running state, permissions, retry offers or attachment bodies. */
export type DurableThreadItem =
  | { kind: 'assistantText'; turnId: string; text: string; createdAt?: number; parentToolUseId?: string }
  | {
      kind: 'userText'; text: string; createdAt?: number; messageId?: string
      attachments?: readonly { attachmentId: string; filename: string }[]
    }
  | {
      kind: 'toolCall'; turnId: string; toolUseId: string; parentToolUseId?: string
      name: string; inputSummary: string; input?: Readonly<Record<string, string>>
      result: { isError: boolean; resultSummary: string; resultDetail?: string } | null
      denial?: {
        toolName: string; decisionReasonType: string; decisionReason: string; message: string
        truncatedFields: readonly string[] | null; droppedFields: readonly string[] | null
      }
      elapsedSeconds?: number
    }
  | {
      kind: 'turnBoundary'; turnId: string; stopReason: string; outcome?: string
      isError?: boolean; terminalReason?: string; errorCategory?: string
    }
  | {
      kind: 'sessionBoundary'; reason: 'clear' | 'idle_evict' | 'workspace_change'
      workspaceCwd: string | null; occurredAt: string
    }
  | {
      kind: 'unrecognizedMessage'
      site: 'line_type' | 'assistant_block' | 'user_block' | 'undecodable' | 'codex_method' | 'codex_item'
      messageType: string; raw: string; truncated: boolean
    }
  | {
      kind: 'compactionBoundary'; failed: boolean; manual: boolean
      preTokens?: number | null; postTokens?: number | null
    }
  | { kind: 'banner'; level: string; text: string; stopsTurn: boolean; truncated: boolean }
  | { kind: 'modelRefusal'; refusal: ModelRefusalEvent }

/** Unresolved served or display-only boundaries, separate from exact coverage. */
export type HistoryGap = { newerId: number; cursor?: string; refusedCursors?: readonly string[] } & (
  | { olderId: number; legacyRowKeys?: never }
  | { olderId?: never; legacyRowKeys: readonly number[] }
)

/** Client-owned targeting identity; legacy keys never claim envelope provenance. */
export function historyGapId(gap: HistoryGap): number | string {
  return gap.olderId ?? `legacy:${gap.legacyRowKeys?.[0]}`
}

export type ServedHistory = {
  ids: readonly number[]
  highestId?: number
  receipts: readonly { ids: readonly number[]; cursor: string; atStart: boolean }[]
}

/** Allowlisted display operations; envelope coverage is independent. */
export type HistoryContribution = {
  id: number
  lastId?: number
  joinKey?: string
  rowKey?: number
} & (
  | { kind: 'row'; item: DurableThreadItem }
  | { kind: 'patch'; toolUseId: string; turnId?: string; parentToolUseId?: string;
      result?: Extract<DurableThreadItem, { kind: 'toolCall' }>['result'];
      denial?: Extract<DurableThreadItem, { kind: 'toolCall' }>['denial'] }
  | { kind: 'suppressed' }
)

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
  | {
      kind: 'timeline'; conversationId: string; items: DurableThreadItem[]; prependedRows: number
      served?: ServedHistory
      gaps?: readonly HistoryGap[]
      newestCursor?: string
      display?: readonly HistoryContribution[]
      rowIdentity?: { rowKeys: readonly number[]; nextRowKey: number }
      coverage: { status: 'unknown' } | { status: 'received'; cursor: string; atStart: boolean }
    }
)
export type ChatHistoryRequest = { serverId: string } & (
  | { operation: 'readList' }
  | { operation: 'removeServer' }
  | { operation: 'readTimeline'; conversationId: string }
  | { operation: 'readThread'; conversationId: string }
  | { operation: 'removeConversation'; conversationId: string }
  | { operation: 'replaceList'; snapshot: Extract<ChatHistorySnapshot, { kind: 'list' }> }
  | { operation: 'replaceTimeline'; conversationId: string; snapshot: Extract<ChatHistorySnapshot, { kind: 'timeline' }> }
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
function stringMap(value: unknown): Record<string, string> {
  const entries = Object.entries(record(value))
  if (entries.length > 100_000) return invalid()
  return Object.fromEntries(entries.map(([key, val]) => [string(key), string(val)]))
}
function reportFields(v: Record<string, unknown>) {
  return {
    truncatedFields: nullable(v.truncatedFields, (x) => array(x, string)),
    droppedFields: nullable(v.droppedFields, (x) => array(x, string))
  }
}
function refusal(value: unknown): ModelRefusalEvent {
  const v = record(value)
  const fields = {
    originalModel: string(v.originalModel), refusalCategory: string(v.refusalCategory),
    banner: string(v.banner), ...reportFields(v)
  }
  switch (v.type) {
    case 'modelRefusalFallback': return { type: v.type, ...fields, fallbackModel: string(v.fallbackModel), scope: string(v.scope) }
    case 'modelRefusalNoFallback': return { type: v.type, ...fields }
    default: return invalid()
  }
}
function threadItem(value: unknown): DurableThreadItem {
  const v = record(value)
  switch (v.kind) {
    case 'assistantText': return { kind: v.kind, turnId: id(v.turnId), text: string(v.text), createdAt: optional(v.createdAt, number), parentToolUseId: optional(v.parentToolUseId, id) }
    case 'userText': return {
      kind: v.kind, text: string(v.text), createdAt: optional(v.createdAt, number),
      messageId: optional(v.messageId, id),
      attachments: optional(v.attachments, (x) => array(x, (a) => {
        const r = record(a)
        return { attachmentId: id(r.attachmentId), filename: string(r.filename) }
      }))
    }
    case 'toolCall': return {
      kind: v.kind, turnId: id(v.turnId), toolUseId: id(v.toolUseId),
      parentToolUseId: optional(v.parentToolUseId, id), name: string(v.name),
      inputSummary: string(v.inputSummary), elapsedSeconds: optional(v.elapsedSeconds, number),
      input: optional(v.input, stringMap),
      result: nullable(v.result, (x) => {
        const r = record(x)
        return {
          isError: bool(r.isError), resultSummary: string(r.resultSummary),
          resultDetail: optional(r.resultDetail, string)
        }
      }),
      denial: optional(v.denial, (x) => {
        const d = record(x)
        return {
          toolName: string(d.toolName), decisionReasonType: string(d.decisionReasonType),
          decisionReason: string(d.decisionReason), message: string(d.message), ...reportFields(d)
        }
      })
    }
    case 'turnBoundary': return {
      kind: v.kind, turnId: id(v.turnId), stopReason: string(v.stopReason), outcome: optional(v.outcome, string),
      isError: optional(v.isError, bool), terminalReason: optional(v.terminalReason, string),
      errorCategory: optional(v.errorCategory, string)
    }
    case 'sessionBoundary': return {
      kind: v.kind, reason: choice(v.reason, ['clear', 'idle_evict', 'workspace_change']),
      workspaceCwd: nullable(v.workspaceCwd, string), occurredAt: string(v.occurredAt)
    }
    case 'unrecognizedMessage': return {
      kind: v.kind, site: choice(v.site, ['line_type', 'assistant_block', 'user_block', 'undecodable', 'codex_method', 'codex_item']),
      messageType: string(v.messageType), raw: string(v.raw), truncated: bool(v.truncated)
    }
    case 'compactionBoundary': return {
      kind: v.kind, failed: bool(v.failed), manual: bool(v.manual),
      preTokens: optional(v.preTokens, (x) => nullable(x, number)),
      postTokens: optional(v.postTokens, (x) => nullable(x, number))
    }
    case 'banner': return {
      kind: v.kind, level: string(v.level), text: string(v.text),
      stopsTurn: bool(v.stopsTurn), truncated: bool(v.truncated)
    }
    case 'modelRefusal': return { kind: v.kind, refusal: refusal(v.refusal) }
    default: return invalid()
  }
}

function readId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return invalid()
  return value
}

function orderedIds(value: unknown): number[] {
  const ids = array(value, readId)
  if (ids.some((id, index) => index > 0 && id <= ids[index - 1])) return invalid()
  return ids
}
function servedHistory(value: unknown): ServedHistory {
  const v = record(value)
  const ids = orderedIds(v.ids)
  let total = 0
  const receipts = array(v.receipts, value => {
    const r = record(value)
    const ids = orderedIds(r.ids)
    total += ids.length
    if (total > MAX_CHAT_HISTORY_ITEMS) return invalid()
    return { ids, cursor: string(r.cursor), atStart: bool(r.atStart) }
  })
  const union = [...new Set(receipts.flatMap(r => r.ids))].sort((a, b) => a - b)
  const highestId = optional(v.highestId, readId)
  if (receipts.length === 0 || ids.length !== union.length ||
    ids.some((id, index) => id !== union[index]) || highestId !== ids[ids.length - 1]) return invalid()
  return { ids, receipts, ...(highestId === undefined ? {} : { highestId }) }
}
function signedSafe(value: unknown): number {
  const n = number(value)
  return Number.isSafeInteger(n) ? n : invalid()
}

function retainedThread(value: unknown, hostId: string, conversationId: string): ThreadSnapshot {
  const v = record(value)
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
  const items = array(v.items, value => {
    const item = record(json(value))
    return { ...item, id: readId(item.id), kind: string(item.kind), rev: readId(item.rev) }
  })
  const itemIds = new Set(items.map(item => item.id))
  const arrivalOrder = optional(v.arrivalOrder, value => array(value, readId))
  const version = readId(v.version), checkpoint = readId(v.checkpoint)
  const uncommittedVersion = v.uncommittedVersion === undefined ? (version > checkpoint ? version : 0) : readId(v.uncommittedVersion)
  const ranges = array(v.ranges, value => {
    const r = record(value), start = readId(r.start), end = readId(r.end)
    return start <= end ? { start, end } : invalid()
  })
  const repair = nullable(v.repair, value => {
    const r = record(value), fromVersion = readId(r.fromVersion), throughVersion = readId(r.throughVersion)
    return fromVersion === checkpoint && throughVersion >= fromVersion ? { fromVersion, throughVersion } : invalid()
  })
  if (id(v.hostId) !== hostId || id(v.conversationId) !== conversationId || checkpoint > version ||
      uncommittedVersion > version || itemIds.size !== items.length ||
      (arrivalOrder !== undefined && (arrivalOrder.length !== items.length ||
        new Set(arrivalOrder).size !== items.length || arrivalOrder.some(id => !itemIds.has(id)))) ||
      ranges.some((r, i) => i > 0 && r.start <= ranges[i - 1].end)) return invalid()
  return { hostId, conversationId, epoch: id(v.epoch), items, version, checkpoint, uncommittedVersion, ranges, repair,
    ...(arrivalOrder === undefined ? {} : { arrivalOrder }),
    ...(v.olderAvailable === undefined ? {} : { olderAvailable: bool(v.olderAvailable) }) }
}

/** Parsers return detached, allowlisted data; callers contain the static validation failures. */
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
  if (v.kind !== 'timeline') return invalid()
  const c = record(v.coverage)
  const status = choice(c.status, ['unknown', 'received'])
  const coverage = status === 'unknown' ? { status } : { status, cursor: string(c.cursor), atStart: bool(c.atStart) }
  const prependedRows = number(v.prependedRows)
  if (!Number.isSafeInteger(prependedRows) || prependedRows < 0) return invalid()
  const items = array(v.items, threadItem)
  const served = optional(v.served, servedHistory)
  const newestCursor = optional(v.newestCursor, string)
  const gaps = optional(v.gaps, value => array(value, (value): HistoryGap => {
    const g = record(value)
    const newerId = readId(g.newerId)
    const cursor = 'cursor' in g ? string(g.cursor) : undefined
    const refusedCursors = optional(g.refusedCursors, value => array(value, string))
    if (refusedCursors !== undefined && (new Set(refusedCursors).size !== refusedCursors.length ||
        cursor !== undefined && refusedCursors.includes(cursor))) return invalid()
    const resume = { ...(cursor === undefined ? {} : { cursor }),
      ...(refusedCursors === undefined ? {} : { refusedCursors }) }
    if ('legacyRowKeys' in g) {
      const legacyRowKeys = array(g.legacyRowKeys, signedSafe)
      const keys = isRecord(v.rowIdentity) ? array(v.rowIdentity.rowKeys, signedSafe)
        : items.map((_, index) => index - prependedRows)
      const positions = new Map(keys.map((key, index) => [key, index]))
      if ('olderId' in g || legacyRowKeys.length === 0 || new Set(legacyRowKeys).size !== legacyRowKeys.length ||
          legacyRowKeys.some((key, index) => !positions.has(key) || index > 0 &&
            (positions.get(key) ?? -1) <= (positions.get(legacyRowKeys[index - 1]) ?? -1))) return invalid()
      return { legacyRowKeys, newerId, ...resume }
    }
    const olderId = readId(g.olderId)
    if (newerId - olderId <= 1) return invalid()
    return { olderId, newerId, ...resume }
  }))
  const numericGaps = gaps?.filter(g => g.olderId !== undefined)
  if ((gaps !== undefined || newestCursor !== undefined) && coverage.status !== 'received') return invalid()
  if (numericGaps?.some((g, index) => index > 0 && g.olderId < numericGaps[index - 1].newerId) ||
      gaps !== undefined && new Set(gaps.map(historyGapId)).size !== gaps.length) return invalid()
  if (served !== undefined) {
    // Narrow legacy events can advance the pager without declaring served provenance.
    if (coverage.status !== 'received') return invalid()
  }
  const rowIdentity = optional(v.rowIdentity, value => {
    const r = record(value)
    const rowKeys = array(r.rowKeys, signedSafe)
    const nextRowKey = signedSafe(r.nextRowKey)
    if (rowKeys.length !== items.length || new Set(rowKeys).size !== rowKeys.length ||
      // Leave room for a maximally bounded prepend and its reserved placement boundary.
      nextRowKey > Number.MAX_SAFE_INTEGER - 100_001 || rowKeys.some(key => key >= nextRowKey)) return invalid()
    return { rowKeys, nextRowKey }
  })
  const display = optional(v.display, value => {
    const keys = new Map(rowIdentity?.rowKeys.map((key, index) => [key, items[index]]))
    const contributions = array(value, value => {
      const d = record(value)
      const fields = { id: readId(d.id), lastId: optional(d.lastId, readId), rowKey: optional(d.rowKey, signedSafe),
        joinKey: optional(d.joinKey, value => {
          const key = string(value)
          const separator = key.indexOf(' ')
          const type = key.slice(0, separator)
          return separator > 0 && key.length - separator - 1 > 0 && key.length - separator - 1 <= 64 &&
            ['assistantDelta', 'toolUse', 'toolResult', 'toolDenied', 'turnEnd', 'sessionTransition',
              'unrecognizedMessage', 'apiRetry', 'compacting', 'modelRefusalFallback', 'modelRefusalNoFallback'].includes(type)
            ? key : invalid()
        }) }
      const held = fields.rowKey === undefined ? undefined : keys.get(fields.rowKey)
      if (fields.rowKey !== undefined && held === undefined) return invalid()
      const kind = choice(d.kind, ['row', 'patch', 'suppressed'])
      if (fields.lastId !== undefined && (fields.lastId < fields.id || kind !== 'row' || d.joinKey !== undefined)) return invalid()
      const source = fields.joinKey?.split(' ', 1)[0]
      if (kind === 'suppressed') {
        if (held !== undefined && !((source === 'assistantDelta' && held.kind === 'assistantText') ||
          (source === 'toolUse' && held.kind === 'toolCall') || (source === 'turnEnd' && held.kind === 'turnBoundary') ||
          (source === undefined && held.kind === 'userText'))) return invalid()
        return { ...fields, kind }
      }
      if (kind === 'row') {
        const item = threadItem(d.item)
        if (fields.lastId !== undefined && item.kind !== 'assistantText') return invalid()
        if (source !== undefined && !((source === 'assistantDelta' && item.kind === 'assistantText') ||
          (source === 'toolUse' && item.kind === 'toolCall') || (source === 'turnEnd' && item.kind === 'turnBoundary') ||
          (source === 'sessionTransition' && item.kind === 'sessionBoundary') ||
          (source === 'unrecognizedMessage' && item.kind === 'unrecognizedMessage') ||
          (source === 'apiRetry' && item.kind === 'banner') ||
          (source === 'compacting' && item.kind === 'compactionBoundary') ||
          (['modelRefusalFallback', 'modelRefusalNoFallback'].includes(source) && item.kind === 'modelRefusal'))) return invalid()
        if (held === undefined || held.kind !== item.kind ||
          ('turnId' in item && (!('turnId' in held) || item.turnId !== held.turnId)) ||
          (item.kind === 'toolCall' && (held.kind !== 'toolCall' || item.toolUseId !== held.toolUseId)) ||
          (item.kind === 'assistantText' && (held.kind !== 'assistantText' || item.parentToolUseId !== held.parentToolUseId)) ||
          (item.kind === 'userText' && (held.kind !== 'userText' || item.messageId !== held.messageId))) return invalid()
        return { ...fields, kind, item }
      }
      if (source !== undefined && source !== 'toolResult' && source !== 'toolDenied') return invalid()
      const toolUseId = id(d.toolUseId)
      const parsed = threadItem({ kind: 'toolCall', turnId: '', toolUseId, name: '', inputSummary: '',
        result: d.result === undefined ? null : d.result, denial: d.denial })
      const turnId = parsed.kind === 'toolCall' && parsed.denial !== undefined ? id(d.turnId) : undefined
      if (parsed.kind !== 'toolCall' || (parsed.result === null && parsed.denial === undefined) ||
        (source !== undefined && source !== (parsed.denial === undefined ? 'toolResult' : 'toolDenied')) ||
        (parsed.denial !== undefined && (turnId === '' || toolUseId === '' || d.result !== undefined ||
          (held !== undefined && (held.kind !== 'toolCall' || held.turnId !== turnId)))) ||
        (held !== undefined && (held.kind !== 'toolCall' || held.toolUseId !== toolUseId))) return invalid()
      return { ...fields, kind, toolUseId, ...(turnId === undefined ? {} : { turnId }), parentToolUseId: optional(d.parentToolUseId, id),
        ...(d.result === undefined ? {} : { result: parsed.result }),
        ...(parsed.denial === undefined ? {} : { denial: parsed.denial }) }
    })
    if (contributions.some((d, index) => index > 0 && d.id <= (contributions[index - 1].lastId ?? contributions[index - 1].id))) return invalid()
    return contributions
  })
  return {
    version: 1, kind: 'timeline', serverId, conversationId: id(v.conversationId),
    items, prependedRows, coverage,
    ...(display === undefined ? {} : { display }), ...(gaps === undefined ? {} : { gaps }),
    ...(newestCursor === undefined ? {} : { newestCursor }),
    ...(served === undefined ? {} : { served }), ...(rowIdentity === undefined ? {} : { rowIdentity })
  }
}

export function parseChatHistoryRequest(value: unknown): ChatHistoryRequest {
  const v = record(value)
  const serverId = id(v.serverId)
  const operation = choice(v.operation, ['readList', 'replaceList', 'readTimeline', 'replaceTimeline', 'readThread', 'replaceThread', 'removeConversation', 'removeServer'])
  const hasConversation = operation === 'readTimeline' || operation === 'replaceTimeline' || operation === 'readThread' || operation === 'replaceThread' || operation === 'removeConversation'
  const replacing = operation === 'replaceList' || operation === 'replaceTimeline' || operation === 'replaceThread'
  const keys = ['operation', 'serverId', ...(hasConversation ? ['conversationId'] : []), ...(replacing ? ['snapshot'] : [])]
  if (Object.keys(v).some((key) => !keys.includes(key))) return invalid()
  if (operation === 'readList' || operation === 'removeServer') return { operation, serverId }
  if (operation === 'readTimeline' || operation === 'readThread' || operation === 'removeConversation') return { operation, serverId, conversationId: id(v.conversationId) }
  const snapshot = parseChatHistorySnapshot(v.snapshot)
  if (snapshot.serverId !== serverId) return invalid()
  if (operation === 'replaceList' && snapshot.kind === 'list') return { operation, serverId, snapshot }
  if (operation === 'replaceTimeline' && snapshot.kind === 'timeline' && snapshot.conversationId === id(v.conversationId)) {
    return { operation, serverId, conversationId: snapshot.conversationId, snapshot }
  }
  if (operation === 'replaceThread' && snapshot.kind === 'daemon-items' && snapshot.conversationId === id(v.conversationId)) {
    return { operation, serverId, conversationId: snapshot.conversationId, snapshot }
  }
  return invalid()
}
