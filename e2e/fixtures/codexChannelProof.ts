import type { StampedDaemonEvent } from '../../src/shared/ipc/events'
import type { ThreadItem } from '../../src/shared/wire/thread'

export type ProofEvent = Extract<StampedDaemonEvent, { type: 'runConfigReceived' | 'modelList' |
  'sessionSettingsUpdated' | 'conversationCreated' | 'assistantDelta' | 'turnEnd' | 'threadUpdate' | 'threadReply' }>

/** The channel scenario and unit regressions use this same synchronous collector. */
export function createCodexChannelProof() {
  const events: ProofEvent[] = []
  const facts = new Map<string, { serverId: string | null; conversationId: string; item: ThreadItem }>()
  function record(event: ProofEvent): void {
    events.push(event)
    if (event.type !== 'threadUpdate' && event.type !== 'threadReply') return
    const update = event.type === 'threadUpdate' ? event.update : event.reply
    const prefix = JSON.stringify([event.serverId, event.conversationId, update.payload.epoch])
    const put = (item: ThreadItem) => {
      const key = `${prefix}:${item.id}`, held = facts.get(key)
      if (!held || held.item.rev < item.rev) facts.set(key, { serverId: event.serverId, conversationId: event.conversationId, item })
    }
    if (update.type === 'thread_item_added') put(update.payload.item)
    else if (update.type === 'thread_items') update.payload.items.forEach(put)
    else if (update.type === 'thread_item_changed' || update.type === 'thread_text_append') {
      const held = facts.get(`${prefix}:${update.payload.item_id}`)?.item
      if (!held || held.rev !== update.payload.base_rev) return
      if (update.type === 'thread_item_changed') put({ ...held, ...update.payload.changes, rev: update.payload.rev })
      else if (held.content && typeof held.content === 'object' && 'text' in held.content && typeof held.content.text === 'string')
        put({ ...held, rev: update.payload.rev, content: { ...held.content, text: held.content.text + update.payload.text } })
    }
  }
  return {
    record,
    settings: () => events.filter((e): e is Extract<ProofEvent, { type: 'runConfigReceived' }> => e.type === 'runConfigReceived'),
    models: () => events.filter((e): e is Extract<ProofEvent, { type: 'modelList' }> => e.type === 'modelList'),
    acks: () => events.filter((e): e is Extract<ProofEvent, { type: 'sessionSettingsUpdated' }> => e.type === 'sessionSettingsUpdated'),
    created: () => events.filter((e): e is Extract<ProofEvent, { type: 'conversationCreated' }> => e.type === 'conversationCreated'),
    deltas: () => [...events.filter((e): e is Extract<ProofEvent, { type: 'assistantDelta' }> => e.type === 'assistantDelta'),
      ...[...facts.values()].filter(f => f.item.kind === 'assistant_message' && f.item.parent === undefined).map(f => ({
        serverId: f.serverId, conversationId: f.conversationId, turnId: f.item.turn,
        text: typeof (f.item.content as any)?.text === 'string' ? (f.item.content as any).text as string : '' }))],
    ends: () => [...events.filter((e): e is Extract<ProofEvent, { type: 'turnEnd' }> => e.type === 'turnEnd'),
      ...[...facts.values()].filter(f => f.item.kind === 'turn_end' && f.item.parent === undefined).map(f => ({
        serverId: f.serverId, conversationId: f.conversationId, turnId: f.item.turn,
        stopReason: (f.item.content as any)?.stop_reason, isError: (f.item.content as any)?.is_error,
        outcome: (f.item.content as any)?.outcome, terminalReason: (f.item.content as any)?.terminal_reason,
        errorCategory: (f.item.content as any)?.error_category }))]
  }
}
