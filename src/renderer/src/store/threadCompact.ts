import { createStore } from 'zustand/vanilla'
import type { RendererCommand } from '../../../shared/ipc/commands'
import type { StampedDaemonEvent } from '../../../shared/ipc/events'
import type { ThreadItem, ThreadSummary, ThreadQuery } from '../../../shared/wire/thread'

type Row = ThreadItem | ThreadSummary
type Snapshot = { epoch: string; generation: symbol; rows: readonly Row[]; checkpoint: number; consumed: number;
  ranges: readonly { start: number; end: number }[]; older?: boolean; failed?: string; repairThrough?: number;
  versions?: ReadonlyMap<number, number> }
type Pending = { requestId: string; query: ThreadQuery; generation?: symbol; captured?: { epoch: string; version: number }; recovery: boolean }
type Work = Extract<RendererCommand, { type: 'queryThread' }>
const key = (host: string, chat: string) => JSON.stringify([host, chat])

/** Session-only projection evidence. Never receives complete-store, disk or receipt capabilities. */
export function createThreadCompact(deps: {
  send: (command: RendererCommand) => void
  invalidate: (host: string, chat: string, row: Row) => void
  changed: () => void
  failure: (event: Extract<StampedDaemonEvent, { type: 'threadQueryFailed' }>) => void
  log: (event: { event: string; code: string }) => void
}) {
  const state = createStore<{ snapshots: ReadonlyMap<string, Snapshot> }>(() => ({ snapshots: new Map() }))
  const connections = new Map<string, boolean>(), lanes = new Map<string, { active?: Work; queue: Work[]; timer?: ReturnType<typeof setTimeout> }>()
  const pendings = new Map<string, Pending>()
  const incompatible = new Set<string>()
  let selected: { host: string; chat: string } | undefined, disposed = false
  const snapshot = (host: string, chat: string) => state.getState().snapshots.get(key(host, chat))
  function publish(host: string, chat: string, value: Snapshot): void {
    state.setState(s => ({ snapshots: new Map(s.snapshots).set(key(host, chat), value) })); deps.changed()
  }
  function pump(host: string): void {
    const lane = lanes.get(host)
    if (disposed || !lane || lane.active || !connections.has(host)) return
    const next = lane.queue.shift()
    if (!next) return
    lane.active = next
    lane.timer = setTimeout(() => {
      if (lane.active !== next) return
      lane.active = undefined
      deps.failure({ type: 'threadQueryFailed', serverId: host, conversationId: next.query.payload.conversation_id,
        requestId: next.requestId, inReplyTo: 0, reason: 'expired' }); pump(host)
    }, 30000)
    try { deps.send(next) } catch {
      deps.failure({ type: 'threadQueryFailed', serverId: host, conversationId: next.query.payload.conversation_id,
        requestId: next.requestId, inReplyTo: 0, reason: 'send-failed' })
    }
  }
  function send(command: RendererCommand): void {
    const host = command.serverId
    if (typeof host !== 'string') { deps.send(command); return }
    let lane = lanes.get(host)
    if (!lane) { deps.send(command); return }
    if (command.type === 'cancelThreadQuery') {
      // A sent query retains its slot until terminal receipt. Local cancellation cannot stop Core.
      lane.queue = lane.queue.filter(q => q.requestId !== command.requestId); return
    }
    if (command.type !== 'queryThread') { deps.send(command); return }
    if (lane.queue.length >= 32) {
      deps.failure({ type: 'threadQueryFailed', serverId: host, conversationId: command.query.payload.conversation_id,
        requestId: command.requestId, inReplyTo: 0, reason: 'limit' }); return
    }
    lane.queue.push(command); pump(host)
  }
  function settle(e: StampedDaemonEvent): void {
    if (e.serverId === null || (e.type !== 'threadReply' && e.type !== 'threadQueryFailed')) return
    const lane = lanes.get(e.serverId)
    if (lane?.active?.requestId !== e.requestId) return
    if (e.type === 'threadQueryFailed' || e.reply.type === 'thread_reset' || e.reply.payload.final) {
      clearTimeout(lane.timer); lane.active = undefined
    } else {
      // Logical delivery renews the existing finite lane deadline through the next dispatch only.
      return
    }
  }
  function query(host: string, chat: string, older = false, recovery = false): void {
    if (disposed || selected?.host !== host || selected.chat !== chat || !connections.has(host) || pendings.has(host)) return
    const s = snapshot(host, chat)
    if (connections.get(host) !== true) {
      publish(host, chat, { ...(s ?? { epoch: '', generation: Symbol(), rows: [], checkpoint: 0, consumed: 0, ranges: [] }), failed: 'unsupported' })
      deps.log({ event: 'thread-compact', code: 'unsupported' }); return
    }
    if (older && (!s?.ranges.length || s.older === false)) return
    const q: ThreadQuery = older && s ? { type: 'thread_page', payload: { projection: 'compact-v1', conversation_id: chat,
      epoch: s.epoch, before_order: s.ranges.at(-1)?.start ?? 0 } } :
      { type: 'thread_catch_up', payload: { projection: 'compact-v1', conversation_id: chat, epoch: s?.epoch ?? '',
        version: incompatible.has(key(host, chat)) ? 0 : s?.checkpoint ?? 0 } }
    const requestId = crypto.randomUUID()
    pendings.set(host, { requestId, query: q, generation: s?.generation, recovery })
    deps.log({ event: 'thread-compact', code: q.type })
    if (s?.failed) publish(host, chat, { ...s, failed: undefined })
    send({ type: 'queryThread', serverId: host, requestId, query: q })
  }
  function admit(host: string, chat: string, s: Snapshot, rows: readonly Row[], version: number): Snapshot {
    const held = new Map(s.rows.map(row => [row.id, row]))
    const versions = new Map(s.versions)
    for (const row of rows) {
      const before = held.get(row.id)
      if (before && (before.rev > row.rev || before.rev === row.rev && (version < (versions.get(row.id) ?? 0) ||
          typeof before.subtree_version === 'number' && typeof row.subtree_version === 'number' && before.subtree_version > row.subtree_version))) continue
      held.set(row.id, row)
      versions.set(row.id, version)
      if (!before || before.rev !== row.rev || before.subtree_version !== row.subtree_version || row.subtree_version === undefined)
        deps.invalidate(host, chat, row)
    }
    return { ...s, versions, rows: [...held.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id) }
  }
  function event(e: StampedDaemonEvent): boolean {
    const host = e.serverId
    if (disposed || host === null) return false
    if (e.type === 'connected') {
      retire(host); connections.set(host, e.ack.server_id === host && ['thread', 'interactive', 'thread_expansion', 'thread_compact'].every(c => e.ack.capabilities.includes(c)))
      if (selected?.host === host) { lanes.set(host, { queue: [] }); query(host, selected.chat) }
      return false
    }
    if (e.type === 'connecting' || e.type === 'disconnected' || e.type === 'failed') { retire(host); connections.delete(host); return false }
    if (e.type === 'threadRepairNeeded' && selected?.host === host && selected.chat === e.conversationId) {
      const s = snapshot(host, e.conversationId)
      if (s && !s.failed) query(host, e.conversationId, false, true)
      return true
    }
    if (e.type === 'threadCompactUpdate') {
      const p = e.update.payload, s = snapshot(host, e.conversationId)
      if (!s || s.epoch !== p.epoch || e.conversationId !== p.conversation_id || !connections.has(host) || selected?.host !== host || selected.chat !== e.conversationId) return true
      const gap = p.from_version > s.consumed
      const next = admit(host, e.conversationId, s, p.item ? [p.item] : p.header ? [p.header] : [], p.version)
      publish(host, e.conversationId, { ...next, consumed: Math.max(s.consumed, p.version),
        ...(gap ? { repairThrough: Math.max(s.repairThrough ?? 0, p.version) } : {}) })
      if (gap && !s.failed) query(host, e.conversationId, false, true)
      return true
    }
    if (e.type !== 'threadReply' && e.type !== 'threadQueryFailed') return false
    settle(e)
    const p = pendings.get(host)
    const compactReply = e.type === 'threadReply' && 'projection' in e.reply.payload && e.reply.payload.projection === 'compact-v1'
    if (!p || e.requestId !== p.requestId || e.conversationId !== p.query.payload.conversation_id) { pump(host); return compactReply }
    const chat = e.conversationId, s = snapshot(host, chat)
    if (e.type === 'threadQueryFailed') {
      pendings.delete(host)
      deps.log({ event: 'thread-compact', code: e.reason })
      publish(host, chat, { ...(s ?? { epoch: '', generation: Symbol(), rows: [], checkpoint: 0, consumed: 0, ranges: [] }), failed: e.reason })
      // A single query/live cancellation can recover; a failed recovery needs explicit retry.
      if (e.reason === 'daemon-error' && !p.recovery && s && s.consumed > (p.captured?.version ?? s.checkpoint)) query(host, chat, false, true)
      pump(host); return true
    }
    const reply = e.reply, v = reply.payload
    if (!compactReply || reply.type === 'thread_tool_body' || reply.type === 'thread_children' ||
        s?.generation !== p.generation || selected?.host !== host || selected.chat !== chat) { pendings.delete(host); pump(host); return true }
    if (reply.type === 'thread_reset') {
      pendings.delete(host)
      publish(host, chat, { epoch: v.epoch, generation: Symbol(), rows: [], checkpoint: 0, consumed: 0, ranges: [], ...(p.recovery ? { failed: 'recovery' } : {}) })
      if (!p.recovery) query(host, chat, false, true)
      pump(host); return true
    }
    if (!p.captured) {
      if (s && s.epoch !== v.epoch && (p.query.type === 'thread_page' || p.query.type === 'thread_catch_up' && p.query.payload.version > 0)) return true
      p.captured = { epoch: v.epoch, version: v.version }
      if (!s || s.epoch !== v.epoch) {
        publish(host, chat, { epoch: v.epoch, generation: Symbol(), rows: [], checkpoint: 0, consumed: 0, ranges: [] })
        p.generation = snapshot(host, chat)?.generation
      }
    }
    const current = snapshot(host, chat)
    if (!current || p.captured.epoch !== v.epoch || p.captured.version !== v.version) return true
    if (!reply.payload.final) {
      publish(host, chat, admit(host, chat, current, [...reply.payload.items, ...reply.payload.headers ?? []], v.version)); return true
    }
    const marker = reply.payload
    for (const row of current.rows) if (row.subtree_version === undefined && (row.kind === 'tool_call' || row.kind === 'agent'))
      deps.invalidate(host, chat, row)
    if (p.query.type === 'thread_page' && (!('upper_order' in marker) || marker.upper_order !== p.query.payload.before_order)) {
      pendings.delete(host); publish(host, chat, { ...current, failed: 'metadata' }); pump(host); return true
    }
    incompatible.delete(key(host, chat))
    const ranges = current.ranges.map(range => ({ ...range }))
    if ('lower_order' in marker) {
      ranges.push({ start: marker.lower_order, end: marker.upper_order }); ranges.sort((a, b) => a.start - b.start)
      for (let i = 1; i < ranges.length;) {
        if (ranges[i].start <= ranges[i - 1].end) { ranges[i - 1].end = Math.max(ranges[i].end, ranges[i - 1].end); ranges.splice(i, 1) } else i++
      }
    }
    const page = p.query.type === 'thread_page'
    const repairThrough = page || current.repairThrough !== undefined && current.repairThrough > v.version ? current.repairThrough : undefined
    publish(host, chat, { ...current, repairThrough, checkpoint: page ? current.checkpoint : Math.max(current.checkpoint, v.version),
      consumed: page ? current.consumed : Math.max(current.consumed, v.version),
      ranges, ...('older_exists' in marker ? { older: marker.older_exists } : {}) })
    pendings.delete(host)
    if (repairThrough !== undefined) {
      if (p.recovery) publish(host, chat, { ...(snapshot(host, chat) ?? current), failed: 'recovery' })
      else query(host, chat, false, true)
    }
    pump(host); return true
  }
  function retire(host: string, chat?: string, clear = false): void {
    const lane = lanes.get(host), active = lane?.active
    if (chat === undefined || pendings.get(host)?.query.payload.conversation_id === chat) pendings.delete(host)
    if (lane) lane.queue = lane.queue.filter(work => chat !== undefined && work.query.payload.conversation_id !== chat)
    if (chat === undefined || active?.query.payload.conversation_id === chat) {
      clearTimeout(lane?.timer)
      if (lane) lane.active = undefined
      if (chat === undefined) lanes.delete(host)
    }
    if (active && (chat === undefined || active.query.payload.conversation_id === chat)) {
      try { deps.send({ type: 'cancelThreadQuery', serverId: host, requestId: active.requestId }) }
      catch { deps.log({ event: 'thread-compact', code: 'send-failed' }) }
    }
    if (clear) state.setState(s => ({ snapshots: new Map([...s.snapshots].filter(([id]) => chat ? id !== key(host, chat) : !id.startsWith('[' + JSON.stringify(host) + ','))) }))
    if (clear && selected?.host === host && (chat === undefined || selected.chat === chat)) selected = undefined
    if (clear && chat === undefined) connections.delete(host)
    if (clear) for (const id of incompatible) if (chat ? id === key(host, chat) : id.startsWith('[' + JSON.stringify(host) + ',')) incompatible.delete(id)
  }
  return { state, snapshot, send, event,
    open(host: string, chat: string) {
      selected = { host, chat }
      const s = snapshot(host, chat)
      if (s && incompatible.has(key(host, chat))) {
        for (const row of s.rows) deps.invalidate(host, chat, row)
        publish(host, chat, { ...s, checkpoint: 0, consumed: 0, ranges: [], older: undefined, failed: undefined, repairThrough: undefined })
      }
      if (!lanes.has(host)) lanes.set(host, { queue: [] }); query(host, chat)
    },
    query(type: 'older' | 'retry', host: string) { if (selected?.host !== host) return false; query(host, selected.chat, type === 'older'); return true },
    close() { if (selected) { const p = pendings.get(selected.host); if (p) send({ type: 'cancelThreadQuery', serverId: selected.host, requestId: p.requestId }); pendings.delete(selected.host) }; selected = undefined },
    retire,
    complete(host: string, chat: string) {
      const initialize = Boolean(snapshot(host, chat)) && !incompatible.has(key(host, chat))
      if (snapshot(host, chat)) incompatible.add(key(host, chat))
      return initialize
    },
    suspend() { selected = undefined; connections.clear(); for (const host of lanes.keys()) retire(host) },
    dispose() { disposed = true; selected = undefined; for (const host of lanes.keys()) retire(host); connections.clear(); state.setState({ snapshots: new Map() }) }
  }
}
