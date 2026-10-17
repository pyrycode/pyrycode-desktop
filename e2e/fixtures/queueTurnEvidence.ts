import type { DaemonEvent } from '../../src/shared/ipc/events'

/** Self-contained so Playwright can evaluate this same tested function in the renderer. */
export function createQueueTurnEvidence(options: {
  conversationId: string; markers: string[]; subscribe?: boolean
}) {
  type Turn = {
    start: number; end: number; completions: number; normal: boolean; markers: number[]
    suffix: string
  }
  const turns = new Map<string, Turn>()
  let order = 0
  let conversationId = options.conversationId
  let queuedMessageIds: (string | undefined)[] = []
  let queueSnapshots = 0
  let thread = false, epoch = '', invalid = false
  const items = new Map<number, Record<string, unknown>>()
  const ended = new Set<number>()
  let appendCompanion: { id: number; rev: number; version: number } | undefined
  const record = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
  const suffixLimit = Math.max(1, ...options.markers.map(marker => marker.length)) - 1

  function observe(event: DaemonEvent): void {
    if (event.type === 'threadUpdate' || event.type === 'threadReply') thread = true
    if (event.type === 'connected') { thread = event.ack.capabilities.includes('thread'); return }
    if (event.type === 'conversationCreated' && conversationId === '') conversationId = event.conversation.id
    if (!('conversationId' in event) || event.conversationId !== conversationId) return
    order += 1
    if (thread) {
      if (event.type !== 'threadUpdate' && event.type !== 'threadReply') return
      const update = event.type === 'threadUpdate' ? event.update : event.reply
      const p = update.payload
      const companion = appendCompanion
      appendCompanion = undefined
      if (epoch !== p.epoch) { epoch = p.epoch; items.clear(); turns.clear(); ended.clear(); invalid = false }
      const publish = (item: Record<string, unknown>, pairedSuffix = false) => {
        if (typeof item.id !== 'number' || typeof item.rev !== 'number') { invalid = true; return }
        const before = items.get(item.id)
        if (before && typeof before.rev === 'number' && (before.rev > item.rev || before.rev === item.rev && !pairedSuffix)) return
        items.set(item.id, item)
        const content = record(item.content) ? item.content : {}
        if (item.kind === 'user_message') {
          queuedMessageIds = [...items.values()].filter(i => i.kind === 'user_message' && i.shown === true && i.active === true && i.status === 'queued')
            .map(i => record(i.content) && typeof i.content.message_id === 'string' ? i.content.message_id : undefined)
          queueSnapshots += 1
        }
        if (typeof item.turn !== 'string' || item.parent !== undefined) return
        if (item.kind !== 'assistant_message' && item.kind !== 'tool_call' && item.kind !== 'turn_end') return
        let turn = turns.get(item.turn)
        if (!turn) { turn = { start: order, end: 0, completions: 0, normal: false, markers: [], suffix: '' }; turns.set(item.turn, turn) }
        if (item.kind === 'assistant_message' && typeof content.text === 'string') {
          const text = content.text
          options.markers.forEach((marker, index) => {
            if (text.includes(marker) && !turn!.markers.includes(index)) turn!.markers.push(index)
          })
        }
        if (item.kind === 'turn_end' && !ended.has(item.id)) {
          ended.add(item.id); turn.end = order; turn.completions += 1
          turn.normal = content.stop_reason === 'end_turn' && content.is_error !== true &&
            (!content.outcome || content.outcome === 'success') &&
            (!content.terminal_reason || content.terminal_reason === 'completed') && !content.error_category
        }
      }
      if (update.type === 'thread_item_added') publish(update.payload.item)
      else if (update.type === 'thread_items') update.payload.items.forEach(item => publish(item))
      else if (update.type !== 'thread_reset') {
        const held = items.get(update.payload.item_id)
        const pairedSuffix = update.type === 'thread_text_append' && update.payload.rev === update.payload.base_rev &&
          companion?.id === update.payload.item_id && companion.rev === update.payload.rev && companion.version === update.payload.version
        if (held && typeof held.rev === 'number' && held.rev >= update.payload.rev && !pairedSuffix) return
        if (!held || held.rev !== update.payload.base_rev) { invalid = true; return }
        if (update.type === 'thread_item_changed') {
          publish({ ...held, ...update.payload.changes, rev: update.payload.rev })
          appendCompanion = { id: update.payload.item_id, rev: update.payload.rev, version: update.payload.version }
        }
        else if (record(held.content) && typeof held.content.text === 'string') publish({ ...held, rev: update.payload.rev,
          content: { ...held.content, text: held.content.text + update.payload.text } }, pairedSuffix)
        else invalid = true
      }
      return
    }
    if (event.type === 'queueState') {
      queuedMessageIds = event.queued.map(item => item.message_id)
      queueSnapshots += 1
      return
    }
    if (event.type !== 'assistantDelta' && event.type !== 'toolUse' && event.type !== 'turnEnd') return
    let turn = turns.get(event.turnId)
    if (!turn) {
      turn = { start: order, end: 0, completions: 0, normal: false, markers: [], suffix: '' }
      turns.set(event.turnId, turn)
    }
    if (event.type === 'assistantDelta') {
      const text = turn.suffix + event.text
      options.markers.forEach((marker, index) => {
        if (text.includes(marker) && !turn.markers.includes(index)) turn.markers.push(index)
      })
      turn.suffix = text.slice(-suffixLimit)
    }
    if (event.type === 'turnEnd') {
      turn.end = order
      turn.completions += 1
      turn.normal = event.stopReason === 'end_turn' && event.isError !== true &&
        (!event.outcome || event.outcome === 'success') &&
        (!event.terminalReason || event.terminalReason === 'completed') && !event.errorCategory
      turn.suffix = ''
    }
  }

  function snapshot(expectedMarkers: number[]) {
    const summaries = [...turns.values()].map(({ suffix: _suffix, ...summary }) => summary)
    const complete = !invalid && summaries.length === expectedMarkers.length && summaries.every((turn, index) =>
      turn.completions === 1 && turn.normal && turn.markers.length === 1 &&
      turn.markers[0] === expectedMarkers[index] &&
      (index === 0 || turn.start > summaries[index - 1].end))
    return { complete, thread, conversationId, turns: summaries, queuedMessageIds, queueSnapshots }
  }
  if (options.subscribe) {
    const target = window as unknown as { pyry: { onDaemonEvent: (listener: typeof observe, content?: boolean) => () => void };
      queueTurnEvidence: { snapshot: typeof snapshot; stop: () => void } }
    target.queueTurnEvidence = { snapshot, stop: target.pyry.onDaemonEvent(observe, true) }
  }
  return { observe, snapshot }
}
