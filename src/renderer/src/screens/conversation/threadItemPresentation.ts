import type { ThreadSnapshot } from '../../store/threadItemStore'
import type { MessageAttachment, ThreadItem } from '../../store/threadTimeline'
import { formatTurnStats } from './turnStats'

type Held = ThreadSnapshot['items'][number]
export interface ItemPresentation {
  source: Held
  item: ThreadItem | null
  stats?: string
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
function presentation(s: Held): ThreadItem | null {
  const c = record(s.content)
  if (!c || typeof s.status !== 'string' || !['running', 'done', 'failed', 'denied', 'interrupted', 'queued', 'delivered', 'lost', 'dropped',
    'finished', 'stopped', 'stopping', 'ended_with_session', 'gone'].includes(s.status)) return null
  const turnId = text(s.turn) ?? ''
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
    case 'tool_call': {
      if (typeof c.name !== 'string') return null
      const r = record(c.result), d = record(c.denial)
      if (c.result != null && (!r || typeof r.result_summary !== 'string' || typeof r.is_error !== 'boolean')) return null
      if (c.denial != null && (!d || typeof d.tool_name !== 'string' || typeof d.decision_reason_type !== 'string' ||
          typeof d.decision_reason !== 'string' || typeof d.message !== 'string')) return null
      const input = record(c.input)
      return { kind: 'toolCall', turnId, toolUseId: text(c.tool_use_id) ?? '', name: c.name,
        inputSummary: text(c.input_summary) ?? '',
        input: input ? Object.fromEntries(Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : undefined,
        elapsedSeconds: numeric(c.elapsed_seconds),
        result: r && typeof r.result_summary === 'string' && typeof r.is_error === 'boolean'
          ? { isError: r.is_error, resultSummary: r.result_summary, resultDetail: text(r.result_detail) } : null,
        denial: d && typeof d.tool_name === 'string' && typeof d.decision_reason_type === 'string' &&
          typeof d.decision_reason === 'string' && typeof d.message === 'string'
          ? { toolName: d.tool_name, decisionReasonType: d.decision_reason_type, decisionReason: d.decision_reason,
            message: d.message, truncatedFields: strings(d.truncated_fields), droppedFields: strings(d.dropped_fields) } : undefined }
    }
    case 'session_divider':
      return c.reason === 'clear' || c.reason === 'idle_evict' || c.reason === 'workspace_change'
        ? { kind: 'sessionBoundary', reason: c.reason, workspaceCwd: text(c.workspace_cwd) ?? null,
          occurredAt: text(c.occurred_at) ?? '' } : null
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
function identity(s: Held): string | null {
  return typeof s.session === 'string' && s.session !== '' && typeof s.turn === 'string' && s.turn !== ''
    ? JSON.stringify([s.session, s.agent, s.turn]) : null
}
/** Adapt display facts only; every join uses the recorded attribution, including hidden endings. */
export function threadItemPresentations(snapshot: ThreadSnapshot): ItemPresentation[] {
  const endings = new Map<string, string>(), last = new Map<string, ItemPresentation>()
  const rows: ItemPresentation[] = snapshot.items.filter(s => s.shown === true).map(source => ({ source, item: presentation(source) }))
  for (const source of snapshot.items) {
    const key = identity(source), c = record(source.content)
    if (key !== null && source.kind === 'turn_end' && c) {
      const stats = formatTurnStats(metrics(c))
      if (stats !== null) endings.set(key, stats)
    }
  }
  for (const row of rows) {
    const key = identity(row.source)
    if (key !== null && row.item?.kind === 'assistantText') last.set(key, row)
  }
  for (const [key, row] of last) row.stats = endings.get(key)
  return rows
}
