import type { StampedDaemonEvent } from '../../src/shared/ipc/events'
import type { RendererCommand } from '../../src/shared/ipc/commands'
import type { ThreadItem } from '../../src/shared/wire/thread'

type Owner = { serverId: string; conversationId: string; sessionId: string; agent: 'claude' | 'codex' }
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const optionalSuccess = (value: unknown, expected: string) => value === undefined || value === '' || value === expected
const successful = (stop: unknown, error: unknown, outcome: unknown, reason: unknown, category: unknown) =>
  stop === 'end_turn' && error !== true && optionalSuccess(outcome, 'success') &&
  optionalSuccess(reason, 'completed') && !category

/** Test-only proof: history may repair a live item, but cannot establish a fresh assistant turn. */
export function completedHandoverReply(events: readonly (StampedDaemonEvent | RendererCommand)[],
  after: number, owner: Owner) {
  const held = new Map<number, { item: ThreadItem; liveAt: number; receivedAt: number }>()
  let epoch: string | undefined
  for (const [index, event] of events.entries()) {
    if ((event.type !== 'threadUpdate' && event.type !== 'threadReply') ||
        event.serverId !== owner.serverId || event.conversationId !== owner.conversationId) continue
    const update = event.type === 'threadUpdate' ? event.update : event.reply
    if (update.payload.conversation_id !== owner.conversationId) continue
    if (update.type === 'thread_reset' || event.type === 'threadUpdate' && epoch !== update.payload.epoch) {
      held.clear()
      epoch = update.payload.epoch
    }
    epoch ??= update.payload.epoch
    if (update.payload.epoch !== epoch) continue
    const put = (item: ThreadItem) => {
      const previous = held.get(item.id)
      if (previous && previous.item.rev >= item.rev) return
      held.set(item.id, { item, receivedAt: index,
        liveAt: event.type === 'threadUpdate' ? index : previous?.liveAt ?? -1 })
    }
    if (update.type === 'thread_item_added') put(update.payload.item)
    else if (update.type === 'thread_items') update.payload.items.forEach(put)
    else if (update.type !== 'thread_reset') {
      const item = held.get(update.payload.item_id)?.item
      if (!item || item.rev !== update.payload.base_rev || update.payload.rev <= item.rev) continue
      if (update.type === 'thread_item_changed') put({ ...item, ...update.payload.changes, rev: update.payload.rev })
      else if (record(item.content) && typeof item.content.text === 'string') {
        put({ ...item, rev: update.payload.rev, content: { ...item.content, text: item.content.text + update.payload.text } })
      }
    }
  }
  const owned = (item: ThreadItem) => item.parent === undefined && item.session === owner.sessionId &&
    item.agent === owner.agent && typeof item.turn === 'string' && item.turn !== ''
  const terminal = [...held.values()].filter(f => f.item.kind === 'turn_end' && owned(f.item) && f.receivedAt >= after)
    .sort((a, b) => b.receivedAt - a.receivedAt)[0]?.item
  if (terminal) {
    const c = terminal.content
    if (!record(c) || !successful(c.stop_reason, c.is_error, c.outcome, c.terminal_reason, c.error_category)) return undefined
    const text = [...held.values()].filter(f => f.item.kind === 'assistant_message' && owned(f.item) &&
      f.item.turn === terminal.turn && f.liveAt >= after).sort((a, b) => a.item.id - b.item.id)
      .map(f => record(f.item.content) && typeof f.item.content.text === 'string' ? f.item.content.text : '').join('')
    return text.trim() ? { text, terminal, epoch } : undefined
  }
  const fresh = events.slice(after)
  const end = fresh.findLast(event => event.type === 'turnEnd' && event.serverId === owner.serverId &&
    event.conversationId === owner.conversationId && event.envelopeSessionId === owner.sessionId)
  if (end?.type !== 'turnEnd' || !end.turnId ||
      !successful(end.stopReason, end.isError, end.outcome, end.terminalReason, end.errorCategory)) return undefined
  const text = fresh.filter((event): event is Extract<StampedDaemonEvent, { type: 'assistantDelta' }> =>
    event.type === 'assistantDelta' && event.serverId === owner.serverId &&
    event.conversationId === owner.conversationId && event.turnId === end.turnId && event.envelopeSessionId === owner.sessionId)
    .map(event => event.text).join('')
  return text.trim() ? { text, terminal: end } : undefined
}
