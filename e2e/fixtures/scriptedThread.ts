import { decodeEnvelope, encodeEnvelope } from '../../src/main/transport/codec'
import type { Envelope } from '../../src/shared/wire/types'
import type { ThreadItem } from '../../src/shared/wire/thread'

// Test scripts describe daemon events. This test-only publisher supplies the folded protocol that
// the real daemon now sends. It never uses the retired renderer reducer or changes native thread
// fixtures. Each instance belongs to one daemon; conversations retain independent epochs/versions.
type Fields = Record<string, any>
type ScriptEnvelope = Envelope & { payload: Fields }
type Scope = { session: string; version: number; next: number; items: Map<string, ThreadItem>;
  deltas: Set<string>; streams: Map<string, string>; lastStream?: string; compacting: boolean; pendingCompact?: string;
  cursor: string; history: Set<number>; phase: string; live: Map<string, Uint8Array> }
const live = new Set(['turn_state', 'stall', 'api_retry', 'compacting', 'thinking_progress', 'tool_progress',
  'background_task_progress', 'resetting', 'rate_limited', 'context_usage', 'model_announced', 'session_facts',
  'session_settings', 'session_settings_updated', 'mcp_status', 'slash_command_list', 'model_list',
  'reply_suggestion', 'session_error', 'modal_shown', 'modal_dismissed', 'question_shown', 'question_dismissed'])
const stamp = '2026-10-15T00:00:00Z'

export function createScriptedThread(options: { history?: boolean } = {}) {
  const scopes = new Map<string, Scope>(), summaries = new Map<string, Fields>()
  const requests = new Map<number, ScriptEnvelope>()
  let context: ScriptEnvelope | undefined
  let deviceId: string | undefined
  const pending = new Map<string, ScriptEnvelope[]>()
  const sentMessages = new Map<string, Fields>()
  const queueActions = new Map<string, string>()
  const messageReceipts = new Set<string>()
  const toolIds = new Map<string, number>()
  let historicalOrder: number | undefined
  function scope(chat: string): Scope {
    let s = scopes.get(chat)
    if (!s) { s = { session: 'session', version: 0, next: 0, items: new Map(), deltas: new Set(), streams: new Map(), compacting: false,
      cursor: '', history: new Set(), phase: 'idle', live: new Map() }; scopes.set(chat, s) }
    return s
  }
  const epoch = (chat: string) => `scripted-thread:${chat}`
  const envelope = (type: string, payload: Fields, source?: Envelope) => encodeEnvelope({
    id: source?.id ?? 1, type, ts: source?.ts ?? stamp, payload,
    ...(source?.in_reply_to === undefined ? {} : { in_reply_to: source.in_reply_to })
  } as Envelope)
  function publish(bytes: Uint8Array): Uint8Array[] {
    let e: Envelope
    try { e = decodeEnvelope(bytes) } catch { return [bytes] }
    const p = e.payload as Fields
    if (e.type.startsWith('thread_')) return [bytes]
    if (e.type === 'conversations') {
      const readings: Uint8Array[] = []
      const rows = p.conversations.map((row: Fields) => {
        const s = scope(row.id)
        const previous = summaries.get(row.id)
        if (typeof row.current_session_id === 'string' && row.current_session_id) s.session = row.current_session_id
        const enriched = { ...row, ...(row.last_shown_version === undefined && row.latest_entry_id !== undefined
          ? { last_shown_version: row.latest_entry_id } : {}), current_session_id: row.current_session_id === undefined ? s.session : row.current_session_id }
        summaries.set(row.id, enriched)
        if (!previous || previous.current_session_id !== enriched.current_session_id) readings.push(...s.live.values())
        return enriched
      })
      return [envelope(e.type, { ...p, conversations: rows }, e), ...readings]
    }
    if (e.type === 'conversation_created') {
      const row = { ...p, current_session_id: p.current_session_id ?? scope(p.id).session }
      summaries.set(p.id, row)
      return [envelope(e.type, row, e)]
    }
    const request = requests.get(e.in_reply_to ?? -1) ?? context
    const identity = p.modal_id ? `modal_shown:${p.modal_id}` : p.question_batch_id ? `question_shown:${p.question_batch_id}` : undefined
    const owners = identity ? [...scopes].filter(([, scope]) => scope.live.has(identity)) : []
    const chat = p.conversation_id ?? request?.payload.conversation_id ?? (owners.length === 1 ? owners[0][0] : undefined)
      ?? (scopes.size === 1 ? scopes.keys().next().value : undefined)
    if (typeof chat !== 'string') return [bytes]
    const s = scope(chat), out: Uint8Array[] = []
    const acceptsSend = ['assistant_delta', 'tool_use', 'turn_end'].includes(e.type) || e.type === 'turn_state' && p.state !== 'idle'
    if (historicalOrder === undefined && acceptsSend && deviceId && pending.get(chat)?.length) {
      const sent = pending.get(chat)!.shift()!
      out.push(...publish(envelope('message', { ...sent.payload, role: 'user', device_id: deviceId }, e)))
    }
    const declared = historicalOrder ?? e.history_entry_id
    const historicalVersion = historicalOrder === undefined ? undefined : Math.max(s.version + 1, declared ?? 0)
    const revision = () => historicalVersion ?? (typeof declared === 'number' && declared > 0 ? Math.max(s.version, declared) : s.version + 1)
    const route = () => ({ conversation_id: chat, epoch: epoch(chat), version: (s.version = revision()) })
    function shown(item: ThreadItem) {
      const row = summaries.get(chat)
      if (!row || !item.shown || item.order === 0 || historicalOrder !== undefined || typeof e.history_entry_id !== 'number') return
      row.last_shown_version = Math.max(row.last_shown_version ?? 0, s.version)
      out.push(envelope('conversations', { conversations: [...summaries.values()] }, e))
    }
    const phase = (state: string) => {
      if (s.phase === state || p.parent_tool_use_id) return
      s.phase = state
      const tagged = encodeEnvelope({ id: e.id, type: 'turn_state', ts: e.ts, session_id: s.session,
        payload: { conversation_id: chat, state } })
      s.live.set('turn_state:', tagged)
      if (summaries.has(chat)) out.push(tagged)
    }
    function add(key: string, kind: string, content: Fields, fields: Partial<ThreadItem> = {}) {
      const held = s.items.get(key)
      if (held && historicalOrder !== undefined) return
      if (held) return change(key, { content: { ...(held.content as Fields), ...content }, ...fields })
      const toolKey = key.startsWith('tool:') ? JSON.stringify([chat, key.slice(5)]) : undefined
      const id = toolKey && toolIds.get(toolKey) || Math.max(s.next + 1, revision())
      if (toolKey) toolIds.set(toolKey, id)
      s.next = Math.max(s.next, id)
      const item: ThreadItem = { id, rev: revision(), order: historicalOrder !== undefined || declared !== undefined ? 2 * Number(historicalOrder ?? declared) : 1000000 + id, kind, status: 'done', active: false, shown: true,
        summary: content.text ?? content.input_summary ?? content.description ?? '', content: { ...content, ts: content.ts ?? e.ts },
        session: s.session, agent: 'claude', ...(p.turn_id ? { turn: p.turn_id } : {}), ...fields }
      s.items.set(key, item)
      out.push(envelope('thread_item_added', { ...route(), item: structuredClone(item) }, e)); shown(item)
    }
    function change(key: string, changes: Fields) {
      const item = s.items.get(key)
      if (!item) return
      const base_rev = item.rev
      Object.assign(item, changes, { rev: revision() })
      out.push(envelope('thread_item_changed', { ...route(), item_id: item.id, base_rev, rev: item.rev, changes }, e)); shown(item)
    }
    let parent: number | undefined
    if (p.parent_tool_use_id) {
      const parentKey = JSON.stringify([chat, p.parent_tool_use_id])
      parent = toolIds.get(parentKey)
      if (parent === undefined) { parent = ++s.next; toolIds.set(parentKey, parent) }
    }
    const ownership = parent === undefined ? {} : { parent }
    if (e.type === 'history_page' && request && ['thread_catch_up', 'thread_page'].includes(request.type)) {
      s.cursor = p.cursor
      const before = s.phase
      for (const entry of [...p.entries].sort((a, b) => a.id - b.id)) {
        if (s.history.has(entry.id)) continue
        s.history.add(entry.id)
        historicalOrder = Math.max(1, entry.id)
        try { publish(encodeEnvelope({ ...entry, session_id: entry.session_id ?? s.session,
          payload: { ...entry.payload, conversation_id: entry.payload.conversation_id ?? chat } })) }
        finally { historicalOrder = undefined }
      }
      s.phase = before
      return windowReply(request, !p.at_start)
    }
    if (e.type === 'assistant_delta') {
      // Old presentation scripts reuse seq=0 for every fragment. Only an explicit durable event id
      // identifies a replay; a fragment counter cannot identify a history entry.
      const receipt = e.history_entry_id
      if (receipt !== undefined && s.deltas.has(String(receipt))) return []
      if (receipt !== undefined) s.deltas.add(String(receipt))
      const stream = `${p.turn_id}:${p.parent_tool_use_id ?? ''}`
      if (s.lastStream !== stream) s.streams.delete(stream)
      s.lastStream = stream
      const key = s.streams.get(stream) ?? `assistant:${stream}:${s.version}`
      s.streams.set(stream, key)
      const item = s.items.get(key)
      if (!item) add(key, 'assistant_message', { text: p.text }, { status: 'running', active: true, ...ownership })
      else {
        const base_rev = item.rev
        item.rev = revision()
        ;(item.content as Fields).text += p.text
        out.push(envelope('thread_text_append', { ...route(), item_id: item.id, base_rev, rev: item.rev, text: p.text }, e)); shown(item)
      }
      phase('streaming')
      return out
    }
    if (e.type === 'message') {
      const held = pending.get(chat) ?? []
      const sendIndex = held.findIndex(send => send.payload.message_id === p.message_id)
      if (sendIndex >= 0) held.splice(sendIndex, 1)
      const sent = !p.device_id || p.device_id === deviceId ? sentMessages.get(JSON.stringify([chat, p.message_id])) ?? {} : {}
      const queued = [...s.items.entries()].find(([, item]) => item.kind === 'user_message' &&
        ((p.queued_msg_id && (item.content as Fields).queued_msg_id === p.queued_msg_id) ||
          (item.content as Fields).message_id === p.message_id && (item.content as Fields).device_id === (p.device_id ?? deviceId)))?.[0]
      const key = queued ?? `message:${p.device_id ?? deviceId ?? ''}:${p.message_id}`
      const receipt = JSON.stringify([chat, key])
      if (messageReceipts.has(receipt)) return out
      messageReceipts.add(receipt)
      if (p.role === 'user') s.streams.clear()
      add(queued ?? `message:${p.device_id ?? deviceId ?? ''}:${p.message_id}`, p.role === 'user' ? 'user_message' : 'assistant_message',
        { ...sent, ...p, text: sent.text ?? p.text, device_id: p.device_id ?? sent.device_id ?? deviceId }, { status: 'delivered', active: false, order: historicalOrder !== undefined || declared !== undefined ? 2 * Number(historicalOrder ?? declared) : 1000000 + s.version + 1, ...ownership })
      return out
    }
    if (e.type === 'tool_use') {
      for (const [key, item] of s.items) if (item.kind === 'assistant_message' && item.turn === p.turn_id && item.active && item.parent === parent)
        change(key, { status: 'done', active: false })
      s.streams.clear()
      add(`tool:${p.tool_use_id}`, ['Agent', 'Task'].includes(p.name) ? 'agent' : 'tool_call', p,
        { status: 'running', active: true, ...ownership })
      const owner = s.items.get(`tool:${p.tool_use_id}`)
      if (owner) for (const [childKey, child] of s.items) if (child.id !== owner.id &&
        (child.content as Fields).parent_tool_use_id === p.tool_use_id && child.parent !== owner.id) change(childKey, { parent: owner.id })
      return out
    }
    if (e.type === 'tool_result') {
      const item = s.items.get(`tool:${p.tool_use_id}`)
      if (item) change(`tool:${p.tool_use_id}`, { status: p.is_error ? 'failed' : item.kind === 'agent' ? 'finished' : 'done',
        active: false, content: { ...(item.content as Fields), result: p } })
      return out
    }
    if (e.type === 'tool_denied') {
      const item = s.items.get(`tool:${p.tool_use_id}`)
      if (item) change(`tool:${p.tool_use_id}`, { status: 'denied', active: false,
        content: { ...(item.content as Fields), denial: p } })
      return out
    }
    if (e.type === 'turn_end') {
      s.streams.delete(`${p.turn_id}:${p.parent_tool_use_id ?? ''}`)
      for (const [key, item] of s.items) if (item.turn === p.turn_id && item.kind === 'assistant_message' && item.active)
        change(key, { status: 'done', active: false })
      add(`end:${p.turn_id}`, 'turn_end', p, { shown: p.stop_reason !== 'cancelled' &&
        (p.is_error === true || Boolean(p.outcome && p.outcome !== 'success') || ['max_turns', 'max_tokens'].includes(p.stop_reason)) })
      phase('idle')
      return out
    }
    if (e.type === 'queue_state') {
      const queued = new Set<number>()
      for (const q of p.queued) {
        queued.add(q.queued_msg_id)
        const sent = !q.device_id || q.device_id === deviceId ? sentMessages.get(JSON.stringify([chat, q.message_id])) : undefined
        const held = pending.get(chat) ?? []
        const at = held.findIndex(send => send.payload.message_id === q.message_id)
        if (at >= 0) held.splice(at, 1)
        add(`queue:${q.queued_msg_id}`, 'user_message', { ...q, device_id: q.device_id ?? (sent ? deviceId : undefined) }, { status: 'queued', active: true, order: 0 })
      }
      for (const [key, item] of s.items) if (item.status === 'queued' && !queued.has((item.content as Fields).queued_msg_id))
        change(key, { status: queueActions.get(JSON.stringify([chat, (item.content as Fields).queued_msg_id])) === 'dequeue_message' ? 'dropped' : 'delivered',
          shown: queueActions.get(JSON.stringify([chat, (item.content as Fields).queued_msg_id])) !== 'dequeue_message', active: false, order: 1000000 + s.version + 1 })
      return out
    }
    if (e.type === 'background_task_roster') {
      const present = new Set<string>()
      for (const task of p.tasks) {
        present.add(task.task_id)
        const existing = [...s.items.entries()].find(([, item]) => (item.content as Fields).task_id === task.task_id)
        const call = task.tool_call_id ?? (existing?.[1].content as Fields)?.tool_use_id ?? `fixture-task:${task.task_id}`
        const key = existing?.[0] ?? `tool:${call}`
        const link = { ...task, tool_call_id: call }
        if (existing) change(key, { ...(existing[1].status === 'gone' ? { status: 'running', active: true } : {}), content: { ...(existing[1].content as Fields), task_link: link } })
        else add(key, task.task_type === 'local_agent' ? 'agent' : 'tool_call', {
          name: task.task_type === 'local_agent' ? 'Agent' : 'Bash', input_summary: task.description,
          tool_use_id: call, task_id: task.task_id, task_link: link }, { status: 'running', active: true })
      }
      for (const [key, item] of s.items) if (item.active && (item.content as Fields).task_id && !present.has((item.content as Fields).task_id))
        change(key, { status: 'gone', active: false, ended_order: s.version + 1 })
      return out
    }
    if (e.type === 'background_task_started' || e.type === 'background_task_updated') {
      const key = e.type === 'background_task_started' ? `tool:${p.tool_call_id}`
        : [...s.items.keys()].find(key => (s.items.get(key)?.content as Fields)?.task_id === p.task_id)
      const item = key === undefined ? undefined : s.items.get(key)
      if (item && key && !(e.type === 'background_task_started' && (item.content as Fields).task_update?.status)) change(key, { status: e.type === 'background_task_started' ? 'running'
        : p.status === 'completed' ? 'finished' : p.status || item.status,
        active: e.type === 'background_task_started' || !p.status && item.active,
        ...(e.type === 'background_task_updated' ? { ended_order: (item.content as Fields).task_update?.status
          ? item.ended_order : 1000000 + s.version + 1 } : {}),
        content: { ...(item.content as Fields), task_id: p.task_id,
          ...(e.type === 'background_task_updated' ? { task_update: p } : {}),
          task_link: { ...((item.content as Fields).task_link ?? {}), ...p, tool_call_id: (item.content as Fields).tool_use_id } } })
      return out
    }
    if (e.type === 'session_transition') {
      s.streams.clear()
      s.session = p.new_session_id
      add(`session:${e.id}:${s.version}`, 'session_divider', p)
      const row = summaries.get(chat)
      if (row) {
        row.current_session_id = s.session
        out.push(envelope('conversations', { conversations: [...summaries.values()] }, e))
      }
      return out
    }
    if (e.type === 'compaction_boundary') {
      if (s.pendingCompact) {
        const item = s.items.get(s.pendingCompact)!
        change(s.pendingCompact, { content: { ...(item.content as Fields), ...p } })
        s.pendingCompact = undefined
      } else add(`compact:${e.id}:${s.version}`, 'compaction', p)
      return out
    }
    if (e.type === 'banner' || e.type === 'attachment_offered' || e.type === 'unrecognized_message' || e.type.startsWith('model_refusal_')) {
      add(`notice:${e.type}:${e.id}:${s.version}`, 'notice', p, { subtype: e.type })
      return out
    }
    if (live.has(e.type)) {
      if (e.type === 'turn_state') s.phase = p.state
      if (e.type === 'thinking_progress') phase('thinking')
      if (!e.session_id && e.type === 'session_settings' && typeof p.session_id === 'string' && p.session_id) {
        s.session = p.session_id
        const row = summaries.get(chat)
        if (row && row.current_session_id !== s.session) {
          row.current_session_id = s.session
          out.push(envelope('conversations', { conversations: [...summaries.values()] }, e))
        }
      }
      if (e.type === 'tool_progress') {
        const item = s.items.get(`tool:${p.tool_use_id}`)
        if (item) change(`tool:${p.tool_use_id}`, { content: { ...(item.content as Fields), elapsed_seconds: p.elapsed_seconds } })
      }
      if (e.type === 'compacting') {
        if (s.compacting && !p.active) {
          const key = `compact:${e.id}:${s.version}`
          add(key, 'compaction', { trigger: p.compact_result === 'failed' ? 'failed' : 'auto' })
          s.pendingCompact = p.compact_result === 'failed' ? undefined : key
        }
        s.compacting = p.active
      }
      if (e.type === 'question_shown') for (const [key, previous] of s.live) {
        if (!key.startsWith('question_shown:') || key === `question_shown:${p.question_batch_id}`) continue
        const old = decodeEnvelope(previous).payload as Fields
        out.push(encodeEnvelope({ id: e.id, type: 'question_dismissed', ts: e.ts, session_id: s.session,
          payload: { question_batch_id: old.question_batch_id, outcome: 'unanswered', source: 'no_answer' } }))
        s.live.delete(key)
      }
      const tagged = encodeEnvelope({ ...e, session_id: e.session_id ?? s.session })
      const liveKey = `${e.type}:${p.modal_id ?? p.question_batch_id ?? p.task_id ?? p.tool_use_id ?? ''}`
      if (e.type === 'modal_dismissed') s.live.delete(`modal_shown:${p.modal_id}`)
      else if (e.type === 'question_dismissed') s.live.delete(`question_shown:${p.question_batch_id}`)
      else s.live.set(liveKey, tagged)
      return [...out, ...(summaries.has(chat) || e.type.endsWith('_dismissed') ? [tagged] : [])]
    }
    return [bytes]
  }
  function windowReply(request: ScriptEnvelope, older = false): Uint8Array[] {
    const p = request.payload, chat = String(p.conversation_id), s = scope(chat)
    const all = [...s.items.values()]
    const items = all.filter(item => request.type !== 'thread_page' || (item.order ?? 0) < Number(p.before_order))
    const increment = request.type === 'thread_catch_up' && p.epoch === epoch(chat) && Number(p.version) > 0
    const selected = increment && Number(p.version) === s.version ? [] : items
    const route = { conversation_id: chat, epoch: epoch(chat), version: s.version }
    const source = { ...request, in_reply_to: request.id }
    const orders = items.map(item => item.order ?? 0).filter(order => order > 0)
    const lower = older ? orders.length ? Math.min(...orders)
      : request.type === 'thread_page' ? Math.max(0, Number(p.before_order) - 1) : 1000000 : 0
    const batches: Uint8Array[] = []
    let batch: ThreadItem[] = []
    for (const item of selected) {
      if (batch.length && Buffer.byteLength(JSON.stringify([...batch, item]), 'utf8') > 32768) {
        batches.push(envelope('thread_items', { ...route, items: batch, final: false }, source)); batch = []
      }
      batch.push(item)
    }
    if (batch.length) batches.push(envelope('thread_items', { ...route, items: batch, final: false }, source))
    return [...batches,
      envelope('thread_items', { ...route, items: [], final: true, ...(increment ? { from_version: p.version }
        : { lower_order: lower, upper_order: request.type === 'thread_page' ? p.before_order : Math.max(lower, ...orders) + 1,
          continuation: lower, older_exists: older }) }, source)]
  }
  function reply(bytes: Uint8Array, frames: Uint8Array[]): Uint8Array[] {
    const request = decodeEnvelope(bytes) as ScriptEnvelope
    requests.set(request.id, request)
    if (request.type === 'send_message') {
      const chat = String(request.payload.conversation_id)
      pending.set(chat, [...pending.get(chat) ?? [], request])
      sentMessages.set(JSON.stringify([chat, request.payload.message_id]), request.payload)
    }
    if (request.type === 'dequeue_message' || request.type === 'send_queued_now')
      queueActions.set(JSON.stringify([request.payload.conversation_id, Number(request.payload.queued_msg_id)]), request.type)
    context = request
    try {
      const result = frames.flatMap(publish)
      if (!['thread_catch_up', 'thread_page'].includes(request.type) || options.history ||
        frames.some(frame => decodeEnvelope(frame).type.startsWith('thread_'))) return result
      return [...result, ...windowReply(request)]
    } finally { context = undefined }
  }
  function historyRequest(bytes: Uint8Array): Uint8Array | null {
    const request = decodeEnvelope(bytes) as ScriptEnvelope
    if (!options.history || !['thread_catch_up', 'thread_page'].includes(request.type)) return null
    return encodeEnvelope({ ...request, type: 'request_history', payload: { conversation_id: request.payload.conversation_id,
      cursor: request.type === 'thread_page' ? scope(String(request.payload.conversation_id)).cursor : '', limit: 200 } })
  }
  return { publish, reply, historyRequest, setDeviceId: (identity: string) => { deviceId = identity } }
}
