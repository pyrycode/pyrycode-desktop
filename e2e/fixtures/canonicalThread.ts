import { decodeEnvelope, encodeEnvelope } from '../../src/main/transport/codec'
import type { ConversationSummary, Envelope, SessionStateFamily } from '../../src/shared/wire/types'
import type { ThreadItem, ThreadQuery, ThreadReply, ThreadUpdate } from '../../src/shared/wire/thread'

export type CanonicalConversation = {
  summary: ConversationSummary; epoch: string; version: number; items: ThreadItem[]
}
type Scope = CanonicalConversation & { changed: Map<number, number>; companion?: { id: number; rev: number } }
const live: SessionStateFamily[] = ['modal_shown', 'question_shown', 'turn_state', 'stall', 'api_retry',
  'compacting', 'thinking_progress', 'tool_progress', 'background_task_progress', 'resetting',
  'rate_limited', 'context_usage', 'model_announced', 'session_facts', 'session_settings',
  'mcp_status', 'slash_command_list', 'model_list', 'reply_suggestion', 'session_error']
const controls = new Set<string>([...live, 'modal_dismissed', 'question_dismissed', 'session_state_cleared',
  'session_settings_updated', 'conversations', 'conversation_created', 'conversation_renamed',
  'conversation_archived', 'conversation_promoted', 'conversation_updated', 'error', 'pong', 'thread_children', 'thread_tool_body'])
const stamp = '2026-10-21T00:00:00Z'
const encode = (type: string, payload: unknown, request?: Envelope) => encodeEnvelope({
  id: request?.id ?? 1, type, ts: stamp, payload, ...(request ? { in_reply_to: request.id } : {})
})
const ordered = (items: ThreadItem[]) => [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id)
function validateOrders(items: ThreadItem[]): void {
  const orders = items.map(i => i.order)
  // A strict before_order cursor cannot traverse ties or unordered facts within a bounded window.
  if (orders.some(order => typeof order !== 'number' || !Number.isSafeInteger(order) ||
    order < 0 || order >= Number.MAX_SAFE_INTEGER) || new Set(orders).size !== orders.length)
    throw Error('canonical order must be unique, nonnegative and safely bounded')
}

/** One host's authored daemon facts. No legacy input, acceptance or session inference. */
export function createCanonicalThread(options: { conversations: CanonicalConversation[]; windowSize?: number }) {
  const scopes = new Map<string, Scope>()
  function setConversation(facts: CanonicalConversation): void {
    const copy = structuredClone(facts)
    if (new Set(copy.items.map(i => i.id)).size !== copy.items.length)
      throw Error('canonical duplicate item identity')
    validateOrders(copy.items)
    scopes.set(copy.summary.id, { ...copy, changed: new Map(copy.items.map(i => [i.id, copy.version])) })
  }
  for (const facts of options.conversations) setConversation(facts)
  function scope(chat: string): Scope {
    const found = scopes.get(chat)
    if (!found) throw Error('canonical conversation ownership')
    return found
  }
  function publish(bytes: Uint8Array): Uint8Array[] {
    const e = decodeEnvelope(bytes)
    if (!['thread_item_added', 'thread_item_changed', 'thread_text_append'].includes(e.type)) {
      if (!controls.has(e.type)) throw Error(`canonical unsupported frame: ${e.type}`)
      return [bytes]
    }
    // Authored test frames use the shared wire union; malformed protocol probes use native mode.
    const update = e as Envelope & ThreadUpdate, p = update.payload
    const s = scope(p.conversation_id)
    const companion = update.type === 'thread_text_append' && p.version === s.version &&
      update.payload.base_rev === update.payload.rev && s.companion?.id === update.payload.item_id &&
      s.companion.rev === update.payload.rev
    if (p.epoch !== s.epoch || p.version < s.version || p.version === s.version && !companion)
      throw Error('canonical epoch/version ownership')
    let next: ThreadItem
    if (update.type === 'thread_item_added') {
      next = structuredClone(update.payload.item)
      if (s.items.some(i => i.id === next.id)) throw Error('canonical duplicate item identity')
    } else {
      const p = update.payload, held = s.items.find(i => i.id === p.item_id)
      if (!held || held.rev !== p.base_rev || p.rev < p.base_rev || p.rev === p.base_rev && !companion)
        throw Error('canonical revision ownership')
      if (update.type === 'thread_item_changed') {
        if ('id' in update.payload.changes || 'kind' in update.payload.changes || 'rev' in update.payload.changes)
          throw Error('canonical identity change')
        next = { ...held, ...structuredClone(update.payload.changes), rev: p.rev }
      } else {
        const content = held.content as Record<string, unknown>
        if (typeof content?.text !== 'string') throw Error('canonical append requires text')
        next = { ...held, rev: p.rev, content: { ...content, text: content.text + update.payload.text } }
      }
    }
    const items = [...s.items.filter(i => i.id !== next.id), next]
    validateOrders(items)
    s.items = items
    s.companion = update.type === 'thread_item_changed' ? { id: next.id, rev: next.rev } : undefined
    s.changed.set(next.id, p.version); s.version = p.version
    return [bytes]
  }
  function window(request: Envelope): Uint8Array[] {
    const p = request.payload as Extract<ThreadQuery, { type: 'thread_catch_up' | 'thread_page' }>['payload'] &
      { version?: number; before_order?: number }, s = scope(p.conversation_id)
    const route = { conversation_id: p.conversation_id, epoch: s.epoch, version: s.version }
    if (request.type === 'thread_catch_up' && (p.version ?? 0) > 0 && p.epoch !== s.epoch)
      return [encode('thread_reset', route, request)]
    const increment = request.type === 'thread_catch_up' && p.epoch === s.epoch && (p.version ?? 0) > 0
    const all = ordered(s.items)
    const eligible = request.type === 'thread_page' ? all.filter(i => (i.order ?? 0) < (p.before_order ?? 0)) : all
    const limit = Math.max(1, Math.min(p.limit ?? 200, options.windowSize ?? 200, 200))
    const items = increment ? all.filter(i => (s.changed.get(i.id) ?? 0) > (p.version ?? 0)) : eligible.slice(-limit)
    const older = !increment && eligible.length > items.length
    const lower = older ? items[0]?.order ?? 0 : 0
    const frames: Uint8Array[] = []
    let batch: ThreadItem[] = []
    const data = () => encode('thread_items', { ...route, items: batch, final: false } satisfies ThreadReply['payload'], request)
    for (const item of items) {
      if (batch.length && Buffer.byteLength(JSON.stringify([...batch, item])) > 32768) {
        frames.push(data()); batch = []
      }
      batch.push(item)
    }
    if (batch.length) frames.push(data())
    const certificate: ThreadReply = { type: 'thread_items', payload: { ...route, items: [], final: true,
      ...(increment ? { from_version: p.version ?? 0 } : { lower_order: lower,
        upper_order: request.type === 'thread_page' ? p.before_order ?? 0 : Math.max(0, ...all.map(i => i.order ?? 0)) + 1,
        continuation: lower, older_exists: older }) } }
    frames.push(encode(certificate.type, certificate.payload, request))
    return frames
  }
  function reply(bytes: Uint8Array, frames: Uint8Array[]): Uint8Array[] {
    const request = decodeEnvelope(bytes), published = frames.flatMap(publish)
    if (request.type === 'list_conversations' && !frames.some(f => decodeEnvelope(f).type === 'conversations'))
      return [...published, encode('conversations', { conversations: [...scopes.values()].map(s => s.summary) }, request)]
    return ['thread_catch_up', 'thread_page'].includes(request.type) ? [...published, ...window(request)] : published
  }
  return { publish, reply, setConversation }
}
