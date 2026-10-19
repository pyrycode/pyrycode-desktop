import type { RendererCommand } from '../../../shared/ipc/commands'
import { isRendererCommand } from '../../../shared/ipc/commands'
import type { StampedDaemonEvent } from '../../../shared/ipc/events'
import type { ThreadChildCursor, ThreadSummary, ThreadQuery } from '../../../shared/wire/thread'

type Request = { serverId: string; conversationId: string; epoch: string; itemId: number; revision: number; kind: 'tool_call' | 'agent' | 'children'; limit?: number }
type ChildPage = { children: ThreadSummary[]; version: number; complete: boolean; more?: boolean; cursor?: ThreadChildCursor;
  completedCursors?: ThreadChildCursor[] }
export type ThreadBodyState = (
  | { type: 'ready'; content: Record<string, unknown>; stale: boolean }
  | { type: 'missing' | 'loading' | 'failed'; reason: string; content?: Record<string, unknown>; stale: true }) & { page?: ChildPage }
type Lease = { active: boolean; listener?: (state: ThreadBodyState) => void }
type ChildAdmission = { failure?: { reason: string } }
type Entry = { request: Request; generation: symbol | undefined; leases: Set<Lease>; state: ThreadBodyState;
  connection?: symbol; requestId?: string; staged?: Record<string, unknown>; bytes: number;
  timer?: ReturnType<typeof setTimeout>; queued: boolean; cursor?: ThreadChildCursor; replacing?: boolean;
  admission?: ChildAdmission; acknowledgedFailure?: ChildAdmission['failure'] }
const missing = (reason: string): ThreadBodyState => ({ type: 'missing', reason, stale: true })

/** Session-only bodies. This writer never receives a canonical store mutation capability. */
export function createThreadBodies(deps: {
  send: (command: RendererCommand) => void
  scope: (host: string, chat: string) => { epoch: string; generation: symbol | undefined; selected: boolean; selection?: symbol } | undefined
  log: (event: { event: string; code: string }) => void
}, limits = { active: 4, queued: 28, entries: 64, bytes: 16 * 1024 * 1024, leases: 128 }) {
  const entries = new Map<string, Entry>(), connections = new Map<string, { token: symbol; supported: boolean }>()
  let leaseCount = 0, disposed = false, retiring = 0
  const key = (r: Request, includeLimit = true) => JSON.stringify([r.serverId, r.conversationId, r.epoch, r.itemId, r.revision, r.kind,
    ...(includeLimit && r.kind === 'children' ? [Math.min(r.limit || 50, 256)] : [])])
  const retained = (e: Entry) => e.state.content
  const page = (e: Entry) => e.state.page ? { page: { ...e.state.page, complete: false } } : {}
  const measure = (e: Entry) => {
    if (e.request.kind === 'children') e.bytes = e.state.page ? new TextEncoder().encode(JSON.stringify({
      ...e.state.page, ...(e.cursor && e.cursor !== e.state.page.cursor ? { requestedCursor: e.cursor } : {}) })).length : 0
  }
  const queryFor = (r: Request, cursor?: ThreadChildCursor): ThreadQuery => ({
    type: r.kind === 'children' ? 'thread_read_children' : 'thread_read_tool_body',
    payload: { conversation_id: r.conversationId, epoch: r.epoch, item_id: r.itemId, expected_rev: r.revision,
      ...(r.kind === 'children' ? { limit: Math.min(r.limit || 50, 256), ...(cursor ? { cursor } : {}) } : {}) } })
  const notify = (e: Entry) => { for (const lease of [...e.leases]) if (lease.active) lease.listener?.(e.state) }
  function cancel(e: Entry): void {
    const id = e.requestId
    e.requestId = undefined; e.queued = false; e.staged = undefined; clearTimeout(e.timer); e.timer = undefined
    if (id) {
      deps.log({ event: 'thread-body', code: 'cancelled' })
      deps.send({ type: 'cancelThreadQuery', serverId: e.request.serverId, requestId: id })
    }
  }
  function fail(e: Entry, reason: string, newFailure = true): void {
    if (e.admission && newFailure) e.admission.failure = { reason }
    const content = retained(e)
    cancel(e); e.state = { type: 'failed', reason, stale: true, ...(content ? { content } : {}), ...page(e) }
    measure(e); trim()
    deps.log({ event: 'thread-body', code: reason }); notify(e); pump()
  }
  function trim(): void {
    let bytes = [...entries.values()].reduce((n, e) => n + e.bytes, 0)
    for (const e of entries.values()) {
      if (bytes <= limits.bytes) break
      if (!e.bytes || e.requestId || e.queued) continue
      bytes -= e.bytes; e.bytes = 0; e.connection = undefined; e.cursor = undefined
      // Content is disposable; failed admission still requires an explicit retry.
      e.state = e.state.type === 'failed' ? { type: 'failed', reason: e.state.reason, stale: true } : missing('evicted')
      notify(e)
    }
  }
  function admit(e: Entry): boolean {
    const failure = e.admission?.failure
    if (!failure || failure === e.acknowledgedFailure) return true
    // Refusing admission must not revoke another enumeration's explicit retry.
    fail(e, failure.reason, false); return false
  }
  function pump(): void {
    if (disposed || retiring > 0) return
    for (const e of entries.values()) {
      if (!e.queued) continue
      if ([...entries.values()].filter(x => x.requestId).length >= limits.active) break
      const c = connections.get(e.request.serverId)
      if (!c?.supported || !e.leases.size || !admit(e)) continue
      e.queued = false; e.connection = c.token; e.requestId = crypto.randomUUID()
      e.timer = setTimeout(() => fail(e, 'expired'), 30000)
      deps.log({ event: 'thread-body', code: 'requested' })
      try { deps.send({ type: 'queryThread', serverId: e.request.serverId, requestId: e.requestId, query: queryFor(e.request, e.cursor) }) }
      catch { fail(e, 'send-failed') }
    }
  }
  function start(e: Entry): void {
    if (disposed || retiring > 0 || !e.leases.size || !admit(e)) return
    const c = connections.get(e.request.serverId), content = retained(e)
    if (!c) { e.state = content ? { type: 'ready', content, stale: true, ...page(e) } : missing('offline'); measure(e); trim(); return }
    if (!c.supported) {
      if (e.admission) e.admission.failure = { reason: 'unsupported' }
      e.state = { type: 'failed', reason: 'unsupported', stale: true, ...(content ? { content } : {}), ...page(e) }
      measure(e); trim()
      deps.log({ event: 'thread-body', code: 'unsupported' }); return
    }
    const outstanding = [...entries.values()].filter(x => x.requestId || x.queued).length
    if (outstanding >= limits.active + limits.queued) { fail(e, 'limit'); return }
    e.state = { type: 'loading', reason: 'demand', stale: true, ...(content ? { content } : {}), ...page(e) }; e.queued = true
    measure(e)
    trim(); pump()
  }
  function retire(host?: string, chat?: string, clear = false, superseding?: Request): void {
    retiring++
    try {
      const affected = [...entries].filter(([, e]) => (host === undefined || e.request.serverId === host) &&
        (chat === undefined || e.request.conversationId === chat) && (!superseding ||
          (e.request.kind === superseding.kind && e.request.itemId === superseding.itemId && e.request.revision !== superseding.revision)))
      const listeners: Array<(state: ThreadBodyState) => void> = []
      // Revoke every affected lease before cancellation or notifications can call back into this writer.
      for (const [, e] of affected) {
        e.acknowledgedFailure = undefined
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
          stale: e.state.stale || e.connection !== connections.get(e.request.serverId)?.token,
          ...(e.state.page ? { page: e.connection === connections.get(e.request.serverId)?.token && !e.state.stale ? e.state.page : { ...e.state.page, complete: false } } : {}) } : missing('retired')
        measure(e)
        if (clear) entries.delete(id)
      }
      for (const listener of listeners) listener(missing('retired'))
    } finally { retiring-- }
    trim(); pump()
  }
  return {
    demand(request: Request, listener?: (state: ThreadBodyState) => void) {
      const scope = deps.scope(request.serverId, request.conversationId)
      const connection = connections.get(request.serverId)
      const valid = isRendererCommand({ type: 'queryThread', serverId: request.serverId, requestId: 'admission', query: queryFor(request) }) &&
        (request.kind === 'tool_call' || request.kind === 'agent' || request.kind === 'children') &&
        (request.limit === undefined || (Number.isSafeInteger(request.limit) && request.limit >= 0))
      const rejected = disposed || retiring > 0 || !valid || !scope?.selected || scope.epoch !== request.epoch ? 'invalid' : leaseCount >= limits.leases ? 'limit' : undefined
      if (rejected) {
        deps.log({ event: 'thread-body', code: rejected })
        return { getState: (): ThreadBodyState => rejected === 'invalid'
          ? { type: 'failed', reason: rejected, stale: true } : missing(rejected), release() {}, retry() {}, continue(_cursor: ThreadChildCursor) {} }
      }
      const id = key(request)
      retire(request.serverId, request.conversationId, true, request)
      let e = entries.get(id)
      if (e && e.generation !== scope?.generation) { retire(request.serverId, request.conversationId, true); e = undefined }
      const current = deps.scope(request.serverId, request.conversationId)
      if (disposed || !current?.selected || current.epoch !== request.epoch || current.generation !== scope?.generation ||
          current.selection !== scope?.selection || connections.get(request.serverId) !== connection) {
        deps.log({ event: 'thread-body', code: 'retired' })
        return { getState: () => missing('retired'), release() {}, retry() {}, continue(_cursor: ThreadChildCursor) {} }
      }
      if (!e) {
        if (entries.size >= limits.entries) {
          const victim = [...entries].find(([, value]) => value.state.type !== 'failed' && !value.leases.size && !value.requestId && !value.queued)
          if (!victim) {
            deps.log({ event: 'thread-body', code: 'limit' })
            return { getState: () => missing('limit'), release() {}, retry() {}, continue(_cursor: ThreadChildCursor) {} }
          }
          victim[1].state = missing('evicted'); victim[1].bytes = 0
          entries.delete(victim[0])
        }
        const admission = request.kind === 'children' ? [...entries.values()].find(x => x.generation === scope?.generation &&
          key(x.request, false) === key(request, false))?.admission ?? {} : undefined
        e = { request: { ...request }, generation: scope?.generation, leases: new Set(), state: missing('unfetched'), bytes: 0,
          queued: false, admission }
        entries.set(id, e)
      }
      // Map order is the cache's bounded LRU list; touching never changes canonical item order.
      entries.delete(id); entries.set(id, e)
      const entry = e, lease: Lease = { active: true, listener }
      entry.leases.add(lease); leaseCount++
      if (!entry.requestId && !entry.queued && entry.state.type !== 'failed' &&
          (entry.state.type !== 'ready' || entry.state.stale || entry.connection !== connections.get(request.serverId)?.token)) {
        entry.cursor = undefined; entry.replacing = true; entry.acknowledgedFailure = undefined; start(entry)
      }
      listener?.(entry.state)
      return {
        getState: (): ThreadBodyState => lease.active ? entry.state : missing('retired'),
        release() {
          if (!lease.active) return
          lease.active = false; lease.listener = undefined; entry.leases.delete(lease); leaseCount--
          if (!entry.leases.size && (entry.requestId || entry.queued)) {
            const content = retained(entry); cancel(entry)
            entry.state = content ? { type: 'ready', content, stale: true, ...page(entry) } : missing('released')
            measure(entry); trim()
            pump()
          }
        },
        retry() { if (!disposed && retiring === 0 && lease.active && entry.state.type === 'failed') {
          entry.cursor = undefined; entry.replacing = true; entry.acknowledgedFailure = entry.admission?.failure
          start(entry); notify(entry)
        } },
        continue(cursor: ThreadChildCursor) {
          if (disposed || retiring > 0 || !lease.active || request.kind !== 'children' || entry.state.type === 'failed') return
          if (typeof cursor !== 'object' || cursor === null || Array.isArray(cursor) || !isRendererCommand({ type: 'queryThread', serverId: request.serverId, requestId: 'continuation',
            query: queryFor(request, cursor) })) { fail(entry, 'metadata'); return }
          const same = (a: ThreadChildCursor | undefined) => a && Object.keys(a).every(k =>
            k in cursor && Reflect.get(a, k) === Reflect.get(cursor, k)) && Object.keys(cursor).length === 7
          if (entry.state.page?.completedCursors?.some(same)) return
          if (entry.requestId || entry.queued) { if (!same(entry.cursor)) fail(entry, 'metadata'); return }
          if (entry.state.stale || !entry.state.page?.more || !same(entry.state.page.cursor)) { fail(entry, 'metadata'); return }
          entry.cursor = entry.state.page.cursor; entry.replacing = false; start(entry); notify(entry)
        }
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
      if (!e) return event.type === 'threadReply' && (event.reply.type === 'thread_tool_body' || event.reply.type === 'thread_children')
      if (event.conversationId !== e.request.conversationId || e.connection !== connections.get(host)?.token) return true
      if (event.type === 'threadQueryFailed') { fail(e, event.reason); return true }
      const reply = event.reply
      if (reply.type === 'thread_children') {
        const p = reply.payload
        if (e.request.kind !== 'children' || p.conversation_id !== e.request.conversationId || p.epoch !== e.request.epoch ||
            p.item_id !== e.request.itemId || p.rev !== e.request.revision) { fail(e, 'metadata'); return true }
        const children = e.replacing ? [] : e.state.page?.children ?? []
        const identities = new Set(children.map(c => c.id))
        if (p.children.some(c => identities.has(c.id))) { fail(e, 'metadata'); return true }
        const completedCursors = e.replacing ? [] : e.state.page?.completedCursors ?? []
        const completed = p.final && e.cursor ? [...completedCursors, e.cursor] : completedCursors
        const next: ChildPage = { children: [...children, ...p.children], version: p.version, complete: p.final && !p.more,
          ...(completed.length ? { completedCursors: completed } : {}),
          ...(p.final ? { more: p.more, ...(p.cursor ? { cursor: p.cursor } : {}) } : {}) }
        e.replacing = false
        if (p.final) e.cursor = undefined
        e.state = p.final ? { type: 'ready', content: {}, stale: false, page: next } :
          { type: 'loading', reason: 'demand', content: {}, stale: true, page: next }
        measure(e)
        if (p.final) { clearTimeout(e.timer); e.timer = undefined; e.requestId = undefined }
        if ([...entries.values()].reduce((n, x) => n + x.bytes, 0) > limits.bytes && !p.final) { fail(e, 'limit'); return true }
        trim(); deps.log({ event: 'thread-children', code: p.final ? 'ready' : 'received' }); notify(e); pump(); return true
      }
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
