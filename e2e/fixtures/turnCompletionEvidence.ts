import type { DaemonEvent } from '../../src/shared/ipc/events'

/** Positive completion evidence shared by live and replay; reconnect snapshots deduplicate. */
export function installTurnCompletionEvidence(): void {
  const completed = new Set<string>()
  const off = window.pyry.onDaemonEvent((event: DaemonEvent) => {
    if (event.type !== 'threadUpdate' && event.type !== 'threadReply') return
    const update = event.type === 'threadUpdate' ? event.update : event.reply
    const items = update.type === 'thread_item_added' ? [update.payload.item]
      : update.type === 'thread_items' ? update.payload.items : []
    for (const item of items) {
      const c = item.content
      if (item.kind !== 'turn_end' || item.parent !== undefined || !c || typeof c !== 'object' || Array.isArray(c)) continue
      if (c.stop_reason !== 'end_turn' || c.is_error === true || c.outcome && c.outcome !== 'success' ||
          c.terminal_reason && c.terminal_reason !== 'completed' || c.error_category) continue
      completed.add(JSON.stringify([event.serverId, event.conversationId, update.payload.epoch, item.id]))
    }
  })
  ;(window as typeof window & { turnCompletionEvidence: { count: () => number; stop: () => void } })
    .turnCompletionEvidence = { count: () => completed.size, stop: off }
}
