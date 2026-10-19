import type { StampedDaemonEvent } from '../../src/shared/ipc/events'
import type { RendererCommand } from '../../src/shared/ipc/commands'
import type { ThreadItem } from '../../src/shared/wire/thread'
import type { ThreadSnapshot } from '../../src/shared/chatHistory'

export type RecordedReply = {
  host: string; conversation: string; epoch: string; id: number
  session: string; agent: string; turn: string; text: string
}

/** Self-contained: the scenario evaluates exactly this tested collector in its page. */
export function createThreadReplyEvidence(options: { host: string; conversation: string; subscribe?: boolean }) {
  type Held = { epoch: string; item: ThreadItem }
  const items = new Map<string, Held>()
  const key = (epoch: string, id: number) => JSON.stringify([epoch, id])
  const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
  const top = (i: ThreadItem) => i.parent === undefined && !object(i.content).parent_tool_use_id
  let baseline = new Set<string>(), oldTurns = new Set<string>()
  let sent: Extract<RendererCommand, { type: 'sendMessage' }> | undefined
  let capabilities: string[] = []
  let companion: { key: string; rev: number; version: number } | undefined
  function observe(event: StampedDaemonEvent) {
    if (event.type === 'connected' && event.serverId === options.host) capabilities = [...event.ack.capabilities]
    if (event.serverId !== options.host || !('conversationId' in event) || event.conversationId !== options.conversation ||
        (event.type !== 'threadUpdate' && event.type !== 'threadReply')) return
    const u = event.type === 'threadUpdate' ? event.update : event.reply
    if (u.payload.conversation_id !== options.conversation || u.type === 'thread_tool_body' || u.type === 'thread_children') return
    const prior = companion
    companion = undefined
    const put = (i: ThreadItem) => {
      const k = key(u.payload.epoch, i.id), held = items.get(k)
      if (!held || i.rev > held.item.rev) items.set(k, { epoch: u.payload.epoch, item: i })
    }
    if (u.type === 'thread_item_added') put(u.payload.item)
    else if (u.type === 'thread_items') u.payload.items.forEach(put)
    else if (u.type === 'thread_item_changed' || u.type === 'thread_text_append') {
      const p = u.payload, k = key(p.epoch, p.item_id), held = items.get(k)
      const paired = u.type === 'thread_text_append' && p.rev === p.base_rev && prior?.key === k && prior.rev === p.rev && prior.version === p.version
      if (!held || held.item.rev !== p.base_rev || p.rev <= held.item.rev && !paired) return
      if (u.type === 'thread_item_changed') {
        put({ ...held.item, ...u.payload.changes, rev: p.rev })
        companion = { key: k, rev: p.rev, version: p.version }
      } else {
        const content = object(held.item.content)
        if (typeof content.text === 'string') items.set(k, { ...held, item: { ...held.item, rev: p.rev,
          content: { ...content, text: content.text + u.payload.text } } })
      }
    }
  }
  function mark() {
    baseline = new Set(items.keys())
    oldTurns = new Set([...items.values()].map(h => JSON.stringify([h.epoch, h.item.session, h.item.turn])))
    sent = undefined
  }
  function send(command: RendererCommand) {
    if (command.type === 'sendMessage' && command.payload.conversation_id === options.conversation &&
        (command.serverId === undefined || command.serverId === options.host)) sent = command
  }
  function reply(): RecordedReply | null {
    if (!sent) return null
    const fresh = [...items.entries()].filter(([k]) => !baseline.has(k)).map(([, h]) => h)
    const user = fresh.find(h => h.item.kind === 'user_message' && top(h.item) && h.item.status === 'delivered' &&
      object(h.item.content).message_id === sent?.payload.message_id)
    if (!user || typeof user.item.order !== 'number' || !user.item.session || !user.item.agent) return null
    const ordered = fresh.filter(h => h.epoch === user.epoch && h.item.session === user.item.session &&
      h.item.agent === user.item.agent && top(h.item) && typeof h.item.order === 'number' && h.item.order > user.item.order!)
      .sort((a, b) => a.item.order! - b.item.order!)
    // The native user item has no turn field: the next top-level work starts its turn.
    const work = ordered.find(h => ['agent', 'tool_call', 'assistant_message', 'turn_end', 'user_message'].includes(h.item.kind))
    if (!work?.item.turn || oldTurns.has(JSON.stringify([work.epoch, work.item.session, work.item.turn]))) return null
    const nextUser = ordered.find(h => h.item.kind === 'user_message')?.item.order ?? Infinity
    const sameTurn = ordered.filter(h => h.item.turn === work.item.turn && h.item.order! < nextUser)
    const terminal = sameTurn.find(h => {
      const c = object(h.item.content)
      return h.item.kind === 'turn_end' && h.item.status === 'done' && !h.item.active && c.stop_reason === 'end_turn' &&
        c.is_error !== true && (!c.outcome || c.outcome === 'success') && (!c.terminal_reason || c.terminal_reason === 'completed') && !c.error_category
    })
    const answer = sameTurn.findLast(h => h.item.kind === 'assistant_message' && h.item.status === 'done' && !h.item.active &&
      typeof object(h.item.content).text === 'string' && String(object(h.item.content).text).trim() !== '')
    if (!terminal || !answer || answer.item.order! >= terminal.item.order!) return null
    return { host: options.host, conversation: options.conversation, epoch: answer.epoch, id: answer.item.id,
      session: user.item.session, agent: user.item.agent, turn: work.item.turn, text: String(object(answer.item.content).text) }
  }
  function retained(recorded: RecordedReply): boolean {
    const held = items.get(key(recorded.epoch, recorded.id))?.item
    return !!held && held.kind === 'assistant_message' && held.session === recorded.session && held.agent === recorded.agent &&
      held.turn === recorded.turn && held.status === 'done' && !held.active && top(held) && object(held.content).text === recorded.text
  }
  const stop = options.subscribe ? window.pyry.onDaemonEvent(observe) : () => {}
  const proof = { observe, mark, send, reply, retained, stop, capabilities: () => capabilities }
  if (options.subscribe) (window as typeof window & { threadReplyEvidence: typeof proof }).threadReplyEvidence = proof
  return proof
}

export function renderedRepliesMatch(
  rows: { id: string | null; text: string }[], replies: Pick<RecordedReply, 'id' | 'text'>[]
): boolean {
  return replies.every(reply => rows.some(row => row.id === String(reply.id) &&
    row.text.replace(/\s/g, '') === reply.text.replace(/\s/g, '')))
}

export function savedRepliesMatch(
  saved: Pick<ThreadSnapshot, 'hostId' | 'conversationId' | 'epoch' | 'items'> | null, replies: RecordedReply[]
): boolean {
  return saved !== null && replies.length > 0 && new Set(replies.map(r => JSON.stringify([r.host, r.conversation, r.epoch, r.id]))).size === replies.length &&
    replies.every(r => saved.hostId === r.host && saved.conversationId === r.conversation && saved.epoch === r.epoch && saved.items.some(i => {
      const c = i.content as Record<string, unknown> | null
      return i.id === r.id && i.kind === 'assistant_message' && i.session === r.session && i.agent === r.agent && i.turn === r.turn &&
        i.parent === undefined && c !== null && typeof c === 'object' && !c.parent_tool_use_id && c.text === r.text
    }))
}
