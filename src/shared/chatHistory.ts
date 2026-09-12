import type { ConversationSummary } from './wire/types'
import type { ModelRefusalEvent } from './ipc/events'
import { MAX_SERVER_ID_LENGTH } from './ipc/unpair'

export const CHAT_HISTORY_CHANNEL = 'pyry:chat-history'
export const CHAT_HISTORY_FLUSH_CHANNEL = 'pyry:chat-history-flush'

/** Display records only: no running state, permissions, retry offers or attachment bodies. */
export type DurableThreadItem =
  | { kind: 'assistantText'; turnId: string; text: string; createdAt?: number }
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
      kind: 'unrecognizedMessage'; site: 'line_type' | 'assistant_block' | 'user_block' | 'undecodable'
      messageType: string; raw: string; truncated: boolean
    }
  | {
      kind: 'compactionBoundary'; failed: boolean; manual: boolean
      preTokens?: number | null; postTokens?: number | null
    }
  | { kind: 'banner'; level: string; text: string; stopsTurn: boolean; truncated: boolean }
  | { kind: 'modelRefusal'; refusal: ModelRefusalEvent }

export type ChatHistorySnapshot = { version: 1; serverId: string } & (
  | { kind: 'list'; conversations: ConversationSummary[] }
  | {
      kind: 'timeline'; conversationId: string; items: DurableThreadItem[]; prependedRows: number
      coverage: { status: 'unknown' } | { status: 'received'; cursor: string; atStart: boolean }
    }
)
export type ChatHistoryRequest = { serverId: string } & (
  | { operation: 'readList' }
  | { operation: 'removeServer' }
  | { operation: 'readTimeline'; conversationId: string }
  | { operation: 'removeConversation'; conversationId: string }
  | { operation: 'replaceList'; snapshot: Extract<ChatHistorySnapshot, { kind: 'list' }> }
  | { operation: 'replaceTimeline'; conversationId: string; snapshot: Extract<ChatHistorySnapshot, { kind: 'timeline' }> }
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
  if (!Array.isArray(v) || v.length > 100_000) return invalid()
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
    case 'assistantText': return { kind: v.kind, turnId: id(v.turnId), text: string(v.text), createdAt: optional(v.createdAt, number) }
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
      kind: v.kind, site: choice(v.site, ['line_type', 'assistant_block', 'user_block', 'undecodable']),
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
        last_used_at: string(c.last_used_at), workspace_label: nullable(c.workspace_label, string)
      }
    })
    if (new Set(conversations.map((c) => c.id)).size !== conversations.length) return invalid()
    return { version: 1, kind: 'list', serverId, conversations }
  }
  if (v.kind !== 'timeline') return invalid()
  const c = record(v.coverage)
  const status = choice(c.status, ['unknown', 'received'])
  const coverage = status === 'unknown' ? { status } : { status, cursor: string(c.cursor), atStart: bool(c.atStart) }
  const prependedRows = number(v.prependedRows)
  if (!Number.isSafeInteger(prependedRows) || prependedRows < 0) return invalid()
  return {
    version: 1, kind: 'timeline', serverId, conversationId: id(v.conversationId),
    items: array(v.items, threadItem), prependedRows, coverage
  }
}

export function parseChatHistoryRequest(value: unknown): ChatHistoryRequest {
  const v = record(value)
  const serverId = id(v.serverId)
  const operation = choice(v.operation, ['readList', 'replaceList', 'readTimeline', 'replaceTimeline', 'removeConversation', 'removeServer'])
  const hasConversation = operation === 'readTimeline' || operation === 'replaceTimeline' || operation === 'removeConversation'
  const replacing = operation === 'replaceList' || operation === 'replaceTimeline'
  const keys = ['operation', 'serverId', ...(hasConversation ? ['conversationId'] : []), ...(replacing ? ['snapshot'] : [])]
  if (Object.keys(v).some((key) => !keys.includes(key))) return invalid()
  if (operation === 'readList' || operation === 'removeServer') return { operation, serverId }
  if (operation === 'readTimeline' || operation === 'removeConversation') return { operation, serverId, conversationId: id(v.conversationId) }
  const snapshot = parseChatHistorySnapshot(v.snapshot)
  if (snapshot.serverId !== serverId) return invalid()
  if (operation === 'replaceList' && snapshot.kind === 'list') return { operation, serverId, snapshot }
  if (operation === 'replaceTimeline' && snapshot.kind === 'timeline' && snapshot.conversationId === id(v.conversationId)) {
    return { operation, serverId, conversationId: snapshot.conversationId, snapshot }
  }
  return invalid()
}
