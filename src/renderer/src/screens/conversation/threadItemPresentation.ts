import type { MessageLifecycleDiagnostic } from '@shared/ipc/diagnostics'
import type { ThreadSnapshot } from '../../store/threadItemStore'
import type { MessageAttachment, ThreadItem } from '../../store/threadTimeline'
import { formatTurnStats } from './turnStats'
import { usableThreadField, type PendingThreadSend } from '../../store/threadSendStore'
import type { LocalSendPending } from '../../store/threadTimeline'
import type { ConnectionStatus } from '../../store/sessionStore'
import { dequeueMessageCommand, sendQueuedNowCommand, type RendererCommand } from '@shared/ipc/commands'

export interface ThreadSendInputs {
  local?: { hostId: string; conversationId: string; pending: readonly PendingThreadSend[];
    localSendPending: LocalSendPending | null }
  connection?: { hostId: string; status: ConnectionStatus }
  onAction?: (hostId: string, command: Extract<RendererCommand, { type: 'dequeueMessage' | 'sendQueuedNow' }>) => void
  midTurnInput?: boolean
  diagnose?: (record: MessageLifecycleDiagnostic) => void
  log?: (event: { event: string; code: string }) => void
}
export function threadQueueHandle(snapshot: ThreadSnapshot, source: Held, inputs?: ThreadSendInputs): number | null {
  const handle = usableThreadField(source, 'content.queued_msg_id')
  return usableThreadField(source, 'kind') === 'user_message' && usableThreadField(source, 'shown') === true &&
    usableThreadField(source, 'active') === true && usableThreadField(source, 'status') === 'queued' &&
    typeof handle === 'number' && Number.isSafeInteger(handle) && handle > 0 && inputs?.onAction &&
    inputs.connection?.hostId === snapshot.hostId && inputs.connection.status.type === 'connected' ? handle : null
}
export function actOnThreadQueue(snapshot: ThreadSnapshot, source: Held, inputs: ThreadSendInputs | undefined,
  action: 'drop' | 'send-now'): void {
  const handle = threadQueueHandle(snapshot, source, inputs)
  if (handle === null || action === 'send-now' && inputs?.midTurnInput === false) return
  const payload = { conversation_id: snapshot.conversationId, queued_msg_id: handle }
  const command = action === 'drop' ? dequeueMessageCommand(payload) : sendQueuedNowCommand(payload)
  if (command.type !== 'dequeueMessage' && command.type !== 'sendQueuedNow') return
  try {
    inputs?.onAction?.(snapshot.hostId, command)
    const messageId = usableThreadField(source, 'content.message_id')
    if (action === 'drop' && typeof messageId === 'string') inputs?.diagnose?.({ event: 'message-cancel-requested', messageId, conversationId: snapshot.conversationId })
  }
  catch { try { inputs?.log?.({ event: 'thread-queue-action', code: 'bridge-failed' }) } catch { /* Observe only. */ } }
}

type Held = ThreadSnapshot['items'][number]
export interface ItemPresentation {
  source: Held
  item: ThreadItem | null
  stats?: string
  ancestors: number[]
  depth: number
  count: number
  hasChildren: boolean
  background?: boolean
  marker?: boolean
  outcome?: string
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const record = (v: unknown): Record<string, unknown> | null => isRecord(v) ? v : null
const text = (v: unknown): string | undefined => typeof v === 'string' ? v : undefined
const numeric = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) ? v : undefined
const strings = (v: unknown): readonly string[] | null =>
  Array.isArray(v) && v.every((s): s is string => typeof s === 'string') ? v : null
function attachment(value: unknown): MessageAttachment | null {
  const v = record(value)
  return v && typeof v.attachment_id === 'string' && typeof v.filename === 'string'
    ? { attachmentId: v.attachment_id, filename: v.filename } : null
}
function timestamp(c: Record<string, unknown>): number | undefined {
  const raw = text(c.ts) ?? text(c.client_sent_at) ?? text(c.accepted_at) ?? text(c.occurred_at)
  const value = raw === undefined ? NaN : Date.parse(raw)
  return Number.isFinite(value) ? value : undefined
}
function metrics(c: Record<string, unknown>) {
  return { inputTokens: numeric(c.input_tokens), outputTokens: numeric(c.output_tokens),
    cacheReadTokens: numeric(c.cache_read_tokens), cacheCreationTokens: numeric(c.cache_creation_tokens),
    durationMs: numeric(c.duration_ms) }
}
function sessionDividerReason(c: Record<string, unknown>): 'clear' | 'idle_evict' | 'workspace_change' | undefined {
  if (c.reason === 'clear' || c.reason === 'idle_evict' || c.reason === 'workspace_change') return c.reason
  // Native thread content retains the daemon's raw cause rather than a legacy
  // session_transition reason. Recognize only the documented reset causes.
  if (c.reason !== undefined) return undefined
  switch (c.cause) {
    case 'operator_reset': case 'claude_clear': case 'agent_switch': return 'clear'
    case 'capacity_eviction': case 'idle_sleep': return 'idle_evict'
    case 'workspace_change': return 'workspace_change'
    default: return undefined
  }
}
const presentationStatuses = new Set(['running', 'done', 'failed', 'denied', 'interrupted', 'queued', 'written', 'delivered', 'lost', 'dropped',
  'finished', 'stopped', 'stopping', 'ended_with_session', 'gone'])
function presentation(s: Held, scope: 'body' | 'header' | 'index' = 'body'): ThreadItem | null {
  const c = record(s.content)
  if (!c || typeof s.status !== 'string' || !presentationStatuses.has(s.status)) return null
  const turnId = text(s.turn) ?? ''
  if (scope !== 'body' && s.kind !== 'tool_call' && s.kind !== 'agent') return null
  switch (s.kind) {
    case 'user_message':
    case 'assistant_message': {
      if (typeof c.text !== 'string') return null
      const createdAt = timestamp(c)
      if (s.kind === 'assistant_message') return { kind: 'assistantText', text: c.text, turnId, createdAt }
      const attachments = Array.isArray(c.attachments)
        ? c.attachments.flatMap(value => { const a = attachment(value); return a ? [a] : [] }) : undefined
      return { kind: 'userText', text: c.text, createdAt, attachments }
    }
    case 'agent':
    case 'tool_call': {
      if (s.kind === 'agent' && ((c.name !== 'Agent' && c.name !== 'Task') || outcome(s) === undefined)) return null
      if (typeof c.name !== 'string') return null
      const r = record(c.result), d = record(c.denial)
      if (c.result != null && (!r || typeof r.result_summary !== 'string' || typeof r.is_error !== 'boolean')) return null
      if (c.denial != null && (!d || typeof d.tool_name !== 'string' || typeof d.decision_reason_type !== 'string' ||
          typeof d.decision_reason !== 'string' || typeof d.message !== 'string')) return null
      const input = scope === 'index' ? null : record(c.input)
      return { kind: 'toolCall', turnId, toolUseId: text(c.tool_use_id) ?? '', name: c.name,
        inputSummary: scope === 'index' ? '' : text(c.input_summary) ?? '',
        input: input ? Object.fromEntries(Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : undefined,
        elapsedSeconds: numeric(c.elapsed_seconds),
        result: r && typeof r.result_summary === 'string' && typeof r.is_error === 'boolean'
          ? { isError: r.is_error, resultSummary: scope === 'body' ? r.result_summary : '', resultDetail: scope === 'index' ? undefined : text(r.result_detail) } : null,
        denial: d && typeof d.tool_name === 'string' && typeof d.decision_reason_type === 'string' &&
          typeof d.decision_reason === 'string' && typeof d.message === 'string'
          ? { toolName: d.tool_name, decisionReasonType: d.decision_reason_type, decisionReason: scope === 'body' ? d.decision_reason : '',
            message: scope === 'body' ? d.message : '', truncatedFields: scope === 'body' ? strings(d.truncated_fields) : null,
            droppedFields: scope === 'body' ? strings(d.dropped_fields) : null } : undefined }
    }
    case 'session_divider': {
      const reason = sessionDividerReason(c)
      return reason ? { kind: 'sessionBoundary', reason, workspaceCwd: text(c.workspace_cwd) ?? null,
        occurredAt: text(c.occurred_at) ?? '' } : null
    }
    case 'compaction':
      return typeof c.trigger === 'string' ? { kind: 'compactionBoundary', failed: c.trigger === 'failed',
        manual: c.trigger === 'manual', preTokens: numeric(c.pre_tokens), postTokens: numeric(c.post_tokens) } : null
    case 'turn_end':
      return { kind: 'turnBoundary', turnId, stopReason: text(c.stop_reason) ?? '', outcome: text(c.outcome),
        isError: typeof c.is_error === 'boolean' ? c.is_error : undefined,
        terminalReason: text(c.terminal_reason), errorCategory: text(c.error_category), ...metrics(c) }
    case 'notice':
      switch (s.subtype) {
        case 'banner':
          return typeof c.text === 'string' && typeof c.level === 'string'
            ? { kind: 'banner', text: c.text, level: c.level, stopsTurn: c.stops_turn === true, truncated: c.truncated === true } : null
        case 'attachment_offered': {
          const a = attachment(c)
          return a ? { kind: 'attachmentOffer', attachment: a } : null
        }
        case 'unrecognized_message': {
          const site = c.site
          return (site === 'line_type' || site === 'assistant_block' || site === 'user_block' ||
              site === 'undecodable' || site === 'codex_method' || site === 'codex_item') &&
              typeof c.message_type === 'string' && typeof c.raw === 'string' && typeof c.truncated === 'boolean'
            ? { kind: 'unrecognizedMessage', site, messageType: c.message_type, raw: c.raw, truncated: c.truncated } : null
        }
        case 'model_refusal_fallback':
        case 'model_refusal_no_fallback': {
          if (typeof c.original_model !== 'string' || typeof c.refusal_category !== 'string' || typeof c.banner !== 'string') return null
          const common = { originalModel: c.original_model, refusalCategory: c.refusal_category, banner: c.banner,
            truncatedFields: strings(c.truncated_fields), droppedFields: strings(c.dropped_fields) }
          if (s.subtype === 'model_refusal_no_fallback') return { kind: 'modelRefusal', refusal: { type: 'modelRefusalNoFallback', ...common } }
          return typeof c.fallback_model === 'string' && typeof c.scope === 'string'
            ? { kind: 'modelRefusal', refusal: { type: 'modelRefusalFallback', ...common, fallbackModel: c.fallback_model, scope: c.scope } } : null
        }
      }
  }
  return null
}
function outcome(s: Held): string | undefined {
  const labels: Record<string, string> = { running: 'Outcome pending', finished: 'Finished', failed: 'Failed',
    denied: 'Denied', stopped: 'Stopped', stopping: 'Stopping', gone: 'Outcome unknown' }
  if (s.status === 'ended_with_session') {
    const cause = text(record(record(s.content)?.ending)?.cause)
    return cause ? `Session ended: ${cause.slice(0, 4096)}` : undefined
  }
  return typeof s.status === 'string' && Object.prototype.hasOwnProperty.call(labels, s.status) ? labels[s.status] : undefined
}
export function usable(c: Record<string, unknown>, key: string): string | undefined {
  const value = text(c[key])
  if (!value) return undefined
  for (const marker of ['truncated_fields', 'dropped_fields']) {
    if (c[marker] != null) {
      const fields = strings(c[marker])
      if (!fields || fields.includes(key)) return undefined
    }
  }
  return value
}
export function taskLinked(s: Held): boolean {
  const c = record(s.content), link = record(c?.task_link)
  if (!c || !link) return false
  const call = usable(c, 'tool_use_id'), task = usable(c, 'task_id')
  if (call === undefined || task === undefined) return false
  const matches = (value: unknown) => {
    const entry = record(value)
    return entry !== null && usable(entry, 'task_id') === task && usable(entry, 'tool_call_id') === call
  }
  return matches(link) || (Array.isArray(link.tasks) && link.tasks.some(matches))
}
/** Parent edges and placement are supplied facts, never inferred from tool results or names. */
function nest(rows: ItemPresentation[], arrival: ReadonlyMap<number, number>): ItemPresentation[] {
  const byId = new Map(rows.map(row => [row.source.id, row]))
  const parents = new Map<number, number>()
  for (const row of rows) {
    const parent = numeric(row.source.parent)
    if (parent !== undefined && byId.get(parent)?.source.kind === 'agent') parents.set(row.source.id, parent)
  }
  for (const id of parents.keys()) {
    const path = new Set<number>()
    let current: number | undefined = id
    while (current !== undefined && !path.has(current)) { path.add(current); current = parents.get(current) }
    if (current !== undefined) {
      const cycle = current
      do {
        const next = parents.get(current)
        parents.delete(current)
        current = next
      } while (current !== undefined && current !== cycle)
    }
  }
  const children = new Map<number | undefined, ItemPresentation[]>()
  for (const row of rows) {
    const parent = parents.get(row.source.id), lane = children.get(parent) ?? []
    lane.push(row); children.set(parent, lane)
    const linked = taskLinked(row.source)
    if (row.item !== null && (row.source.kind === 'agent' || linked)) row.outcome = outcome(row.source)
    row.background = row.source.kind === 'agent' && row.item !== null && linked
  }
  const unorderedUser = (row: ItemPresentation) => row.source.kind === 'user_message' &&
    !(typeof row.source.order === 'number' && row.source.order > 0)
  const creation = (row: ItemPresentation) => unorderedUser(row) ? Infinity : numeric(row.source.order) ?? row.source.id
  const position = (row: ItemPresentation) => {
    const ending = numeric(row.source.ended_order)
    return row.background && !row.marker && row.source.active !== true && ending !== undefined && ending > 0 ? ending : creation(row)
  }
  const lane = (parent: number | undefined): ItemPresentation[] => (children.get(parent) ?? []).flatMap(row => row.background
    ? [{ ...row, marker: true, count: 0, hasChildren: false }, row] : [row]).sort((a, b) => {
      const active = (r: ItemPresentation) => r.background && !r.marker && r.source.active === true ? 1 : 0
      return Number(unorderedUser(a)) - Number(unorderedUser(b)) || active(a) - active(b) ||
        position(a) - position(b) || creation(a) - creation(b) || Number(!a.marker) - Number(!b.marker) ||
        (arrival.get(a.source.id) ?? 0) - (arrival.get(b.source.id) ?? 0)
    })
  const result: ItemPresentation[] = []
  const stack = lane(undefined).reverse().map(row => ({ row, ancestors: new Array<number>() }))
  while (stack.length) {
    const entry = stack.pop()
    if (!entry) break
    const { row, ancestors } = entry
    row.ancestors = ancestors; row.depth = Math.min(ancestors.length, 2)
    if (!row.marker) row.hasChildren = children.has(row.source.id)
    result.push(row)
    if (!row.marker) for (const child of lane(row.source.id).reverse()) stack.push({ row: child, ancestors: [...ancestors, row.source.id] })
  }
  const counts = new Map<number, Set<number>>()
  for (const row of result) if (!row.marker && row.source.kind === 'tool_call') {
    for (const ancestor of row.ancestors) {
      const ids = counts.get(ancestor) ?? new Set<number>()
      ids.add(row.source.id); counts.set(ancestor, ids)
    }
  }
  for (const row of result) if (!row.marker) row.count = counts.get(row.source.id)?.size ?? 0
  return result
}
const retainedPresentations = new WeakMap<Held, ThreadItem | null>()
const retainedHeaders = new WeakMap<Held, ThreadItem | null>()
function retainedPresentation(source: Held, scope: 'body' | 'header' = 'body'): ThreadItem | null {
  if (!Object.isFrozen(source)) return presentation(source, scope)
  const cache = scope === 'body' ? retainedPresentations : retainedHeaders
  if (cache.has(source)) return cache.get(source) ?? null
  const item = presentation(source, scope)
  cache.set(source, item)
  return item
}
function identity(s: Held): string | null {
  return typeof s.session === 'string' && s.session !== '' && typeof s.turn === 'string' && s.turn !== ''
    ? JSON.stringify([s.session, s.agent, s.turn, s.parent ?? null]) : null
}
/** Adapt display facts only; every join uses the recorded attribution, including hidden endings. */
export function threadItemPresentations(snapshot: ThreadSnapshot): ItemPresentation[] {
  return projectThread(snapshot, false)
}
/** Lightweight placement and fold facts. No descendant message or body adaptation. */
export function threadItemIndex(snapshot: ThreadSnapshot): ItemPresentation[] {
  return projectThread(snapshot, true)
}
/** Called only for a mounted source row, with body demand owned by its expansion state. */
export function threadItemPresentation(source: Held, body: boolean): ThreadItem | null {
  return retainedPresentation(source, body ? 'body' : 'header')
}
function projectThread(snapshot: ThreadSnapshot, indexOnly: boolean): ItemPresentation[] {
  const endings = new Map<string, string>(), last = new Map<string, ItemPresentation>()
  const endingSources = new Map<string, Record<string, unknown>[]>()
  const rows: ItemPresentation[] = snapshot.items.filter(s => s.shown === true).map(source => ({ source,
    item: indexOnly ? presentation(source, 'index') : retainedPresentation(source),
    ancestors: [], depth: 0, count: 0, hasChildren: false }))
  for (const source of snapshot.items) {
    const key = identity(source), c = record(source.content)
    if (key !== null && source.kind === 'turn_end' && c) {
      if (indexOnly) {
        const sources = endingSources.get(key) ?? []
        sources.push(c); endingSources.set(key, sources); continue
      }
      const stats = formatTurnStats(metrics(c))
      if (stats !== null) endings.set(key, stats)
    }
  }
  for (const row of rows) {
    const key = identity(row.source)
    if (key !== null && (indexOnly ? row.source.kind === 'assistant_message' && typeof row.source.status === 'string' &&
      presentationStatuses.has(row.source.status) && typeof record(row.source.content)?.text === 'string'
      : row.item?.kind === 'assistantText')) last.set(key, row)
  }
  for (const [key, row] of last) {
    if (indexOnly) Object.defineProperty(row, 'stats', { enumerable: false, get: () => {
      const sources = endingSources.get(key) ?? []
      for (let at = sources.length - 1; at >= 0; at--) {
        const stats = formatTurnStats(metrics(sources[at]))
        if (stats !== null) return stats
      }
      return undefined
    } })
    else row.stats = endings.get(key)
  }
  const arrival = new Map((snapshot.arrivalOrder ?? snapshot.items.map(item => item.id)).map((id, index) => [id, index]))
  return nest(rows, arrival)
}
