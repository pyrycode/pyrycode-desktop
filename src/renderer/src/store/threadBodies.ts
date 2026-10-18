import type { RendererCommand } from '../../../shared/ipc/commands'
import { isRendererCommand } from '../../../shared/ipc/commands'
import type { StampedDaemonEvent } from '../../../shared/ipc/events'

type Request = { serverId: string; conversationId: string; epoch: string; itemId: number; revision: number; kind: 'tool_call' | 'agent' }
export type ThreadBodyState =
  | { type: 'ready'; content: Record<string, unknown>; stale: boolean }
  | { type: 'missing' | 'loading' | 'failed'; reason: string; content?: Record<string, unknown>; stale: true }
type Lease = { active: boolean; listener?: (state: ThreadBodyState) => void }
type Entry = { request: Request; generation: symbol | undefined; leases: Set<Lease>; state: ThreadBodyState;
  connection?: symbol; requestId?: string; staged?: Record<string, unknown>; bytes: number;
  timer?: ReturnType<typeof setTimeout>; queued: boolean }
const missing = (reason: string): ThreadBodyState => ({ type: 'missing', reason, stale: true })

/** Session-only bodies. This writer never receives a canonical store mutation capability. */
export function createThreadBodies(deps: {
  send: (command: RendererCommand) => void
  scope: (host: string, chat: string) => { epoch: string; generation: symbol | undefined; selected: boolean } | undefined
  log: (event: { event: string; code: string }) => void
}, limits = { active: 4, queued: 28, entries: 64, bytes: 16 * 1024 * 1024, leases: 128 }) {
  const entries = new Map<string, Entry>(), connections = new Map<string, { token: symbol; supported: boolean }>()
  let leaseCount = 0, disposed = false, retiring = 0
  const key = (r: Request) => JSON.stringify([r.serverId, r.conversationId, r.epoch, r.itemId, r.revision, r.kind])
  const retained = (e: Entry) => e.state.content
  const notify = (e: Entry) => { for (const lease of [...e.leases]) if (lease.active) lease.listener?.(e.state) }
  function cancel(e: Entry): void {
    const id = e.requestId
    e.requestId = undefined; e.queued = false; e.staged = undefined; clearTimeout(e.timer); e.timer = undefined
    if (id) {
      deps.log({ event: 'thread-body', code: 'cancelled' })
      deps.send({ type: 'cancelThreadQuery', serverId: e.request.serverId, requestId: id })
    }
  }
  function fail(e: Entry, reason: string): void {
    const content = retained(e)
    cancel(e); e.state = { type: 'failed', reason, stale: true, ...(content ? { content } : {}) }
    deps.log({ event: 'thread-body', code: reason }); notify(e); pump()
  }
  function trim(): void {
    let bytes = [...entries.values()].reduce((n, e) => n + e.bytes, 0)
    for (const e of entries.values()) {
      if (bytes <= limits.bytes) break
      if (!e.bytes || e.requestId || e.queued) continue
      bytes -= e.bytes; e.bytes = 0; e.connection = undefined
      // Content is disposable; failed admission still requires an explicit retry.
      e.state = e.state.type === 'failed' ? { type: 'failed', reason: e.state.reason, stale: true } : missing('evicted')
      notify(e)
    }
  }
  function pump(): void {
    if (disposed || retiring > 0) return
    for (const e of entries.values()) {
      if (!e.queued) continue
      if ([...entries.values()].filter(x => x.requestId).length >= limits.active) break
      const c = connections.get(e.request.serverId)
      if (!c?.supported || !e.leases.size) continue
      e.queued = false; e.connection = c.token; e.requestId = crypto.randomUUID()
      e.timer = setTimeout(() => fail(e, 'expired'), 30000)
      deps.log({ event: 'thread-body', code: 'requested' })
      try { deps.send({ type: 'queryThread', serverId: e.request.serverId, requestId: e.requestId,
        query: { type: 'thread_read_tool_body', payload: { conversation_id: e.request.conversationId,
          epoch: e.request.epoch, item_id: e.request.itemId, expected_rev: e.request.revision } } }) }
      catch { fail(e, 'send-failed') }
    }
  }
  function start(e: Entry): void {
    if (disposed || retiring > 0 || !e.leases.size) return
    const c = connections.get(e.request.serverId), content = retained(e)
    if (!c) { e.state = content ? { type: 'ready', content, stale: true } : missing('offline'); return }
    if (!c.supported) {
      e.state = { type: 'failed', reason: 'unsupported', stale: true, ...(content ? { content } : {}) }
      deps.log({ event: 'thread-body', code: 'unsupported' }); return
    }
    const outstanding = [...entries.values()].filter(x => x.requestId || x.queued).length
    if (outstanding >= limits.active + limits.queued) { fail(e, 'limit'); return }
    e.state = { type: 'loading', reason: 'demand', stale: true, ...(content ? { content } : {}) }; e.queued = true
    pump()
  }
  function retire(host?: string, chat?: string, clear = false): void {
    retiring++
    try {
      const affected = [...entries].filter(([, e]) => (host === undefined || e.request.serverId === host) &&
        (chat === undefined || e.request.conversationId === chat))
      const listeners: Array<(state: ThreadBodyState) => void> = []
      // Revoke every affected lease before cancellation or notifications can call back into this writer.
      for (const [, e] of affected) {
        for (const lease of e.leases) {
          lease.active = false; leaseCount--
          if (lease.listener) listeners.push(lease.listener)
          lease.listener = undefined
        }
        e.leases.clear()
      }
      for (const [id, e] of affected) {
        const content = retained(e)
        cancel(e)
        if (clear) e.state = missing('retired')
        else if (e.state.type !== 'failed') e.state = content ? { type: 'ready', content,
          stale: e.state.stale || e.connection !== connections.get(e.request.serverId)?.token } : missing('retired')
        if (clear) entries.delete(id)
      }
      for (const listener of listeners) listener(missing('retired'))
    } finally { retiring-- }
    pump()
  }
  return {
    demand(request: Request, listener?: (state: ThreadBodyState) => void) {
      const scope = deps.scope(request.serverId, request.conversationId)
      const valid = isRendererCommand({ type: 'queryThread', serverId: request.serverId, requestId: 'admission', query: {
        type: 'thread_read_tool_body', payload: { conversation_id: request.conversationId, epoch: request.epoch,
          item_id: request.itemId, expected_rev: request.revision } } }) && (request.kind === 'tool_call' || request.kind === 'agent')
      const rejected = disposed || retiring > 0 || !valid || !scope?.selected || scope.epoch !== request.epoch ? 'invalid' : leaseCount >= limits.leases ? 'limit' : undefined
      if (rejected) {
        deps.log({ event: 'thread-body', code: rejected })
        return { getState: (): ThreadBodyState => rejected === 'invalid'
          ? { type: 'failed', reason: rejected, stale: true } : missing(rejected), release() {}, retry() {} }
      }
      const id = key(request)
      let e = entries.get(id)
      if (e && e.generation !== scope?.generation) { retire(request.serverId, request.conversationId, true); e = undefined }
      if (!e) {
        if (entries.size >= limits.entries) {
          const victim = [...entries].find(([, value]) => value.state.type !== 'failed' && !value.leases.size && !value.requestId && !value.queued)
          if (!victim) {
            deps.log({ event: 'thread-body', code: 'limit' })
            return { getState: () => missing('limit'), release() {}, retry() {} }
          }
          victim[1].state = missing('evicted'); victim[1].bytes = 0
          entries.delete(victim[0])
        }
        e = { request: { ...request }, generation: scope?.generation, leases: new Set(), state: missing('unfetched'), bytes: 0, queued: false }
        entries.set(id, e)
      }
      // Map order is the cache's bounded LRU list; touching never changes canonical item order.
      entries.delete(id); entries.set(id, e)
      const entry = e, lease: Lease = { active: true, listener }
      entry.leases.add(lease); leaseCount++
      if (!entry.requestId && !entry.queued && entry.state.type !== 'failed' &&
          (entry.state.type !== 'ready' || entry.state.stale || entry.connection !== connections.get(request.serverId)?.token)) start(entry)
      listener?.(entry.state)
      return {
        getState: (): ThreadBodyState => lease.active ? entry.state : missing('retired'),
        release() {
          if (!lease.active) return
          lease.active = false; lease.listener = undefined; entry.leases.delete(lease); leaseCount--
          if (!entry.leases.size && (entry.requestId || entry.queued)) {
            const content = retained(entry); cancel(entry)
            entry.state = content ? { type: 'ready', content, stale: true } : missing('released')
            pump()
          }
        },
        retry() { if (!disposed && retiring === 0 && lease.active && entry.state.type === 'failed') { start(entry); notify(entry) } }
      }
    },
    retire,
    reconcile() {
      for (const e of entries.values()) {
        const scope = deps.scope(e.request.serverId, e.request.conversationId)
        if (!scope || scope.epoch !== e.request.epoch || scope.generation !== e.generation) retire(e.request.serverId, e.request.conversationId, true)
      }
    },
    event(event: StampedDaemonEvent): boolean {
      const host = event.serverId
      if (disposed || host === null) return false
      if (event.type === 'connected') {
        connections.delete(host); retire(host)
        connections.set(host, { token: Symbol(), supported: event.ack.server_id === host &&
          ['interactive', 'thread', 'thread_expansion'].every(c => event.ack.capabilities.includes(c)) })
        return false
      }
      if (event.type === 'connecting' || event.type === 'disconnected' || event.type === 'failed') {
        connections.delete(host); retire(host); return false
      }
      if (event.type !== 'threadQueryFailed' && event.type !== 'threadReply') return false
      const e = [...entries.values()].find(e => e.request.serverId === host && e.requestId === event.requestId)
      if (!e) return event.type === 'threadReply' && event.reply.type === 'thread_tool_body'
      if (event.conversationId !== e.request.conversationId || e.connection !== connections.get(host)?.token) return true
      if (event.type === 'threadQueryFailed') { fail(e, event.reason); return true }
      const reply = event.reply
      if (reply.type !== 'thread_tool_body') { fail(e, 'metadata'); return true }
      const p = reply.payload
      if (p.conversation_id !== e.request.conversationId || p.epoch !== e.request.epoch || p.item_id !== e.request.itemId ||
          p.rev !== e.request.revision || p.kind !== e.request.kind) { fail(e, 'metadata'); return true }
      if (!p.final) { e.staged = p.content; return true }
      if (!e.staged) { fail(e, 'metadata'); return true }
      const content = e.staged
      clearTimeout(e.timer); e.timer = undefined; e.requestId = undefined; e.staged = undefined
      e.bytes = new TextEncoder().encode(JSON.stringify(content)).length
      e.state = { type: 'ready', content, stale: false }; trim()
      deps.log({ event: 'thread-body', code: 'ready' }); notify(e); pump(); return true
    },
    suspend() { connections.clear(); retire() },
    dispose() { disposed = true; connections.clear(); retire(undefined, undefined, true) }
  }
}
