import type { StoreApi } from 'zustand/vanilla'
import type { RendererCommand } from '../../../shared/ipc/commands'
import type { StampedDaemonEvent } from '../../../shared/ipc/events'
import type { ThreadQuery } from '../../../shared/wire/thread'
import type { ThreadItemStore, ThreadBatchCertificate } from './threadItemStore'

type Purpose = 'catch-up' | 'older'
export type ThreadQueryState =
  | { type: 'idle' }
  | { type: 'loading'; purpose: Purpose }
  | { type: 'failed'; purpose: Purpose; reason: string; retryable: true }
export type ThreadQueryInput =
  | { type: 'sync'; serverId: string; conversationId: string | null; connected: boolean; restorePending?: boolean }
  | { type: 'daemon'; event: Extract<StampedDaemonEvent, { type: 'threadReply' | 'threadQueryFailed' | 'threadUpdate' | 'threadRepairNeeded' }> }
  | { type: 'older' | 'retry'; serverId: string }
export interface ThreadQueryDeps {
  store: StoreApi<ThreadItemStore>
  sendCommand: (command: Extract<RendererCommand, { type: 'queryThread' }>) => void
  /** Fresh across attempts and coordinator lifetimes, e.g. the caller's UUID factory. */
  requestId: () => string
  onState: (serverId: string, conversationId: string, state: ThreadQueryState) => void
  onComplete?: (serverId: string, conversationId: string, epoch: string, version: number) => void
  log?: { event: (fields: { event: string; code: string }) => void }
}
type Scope = { id: string; restorePending: boolean; catchUp: boolean; older: boolean; recovery: boolean; resetRecovery: boolean;
  ready: boolean; exhausted: boolean; state: ThreadQueryState }
type Pending = { scope: Scope; requestId: string; query: ThreadQuery; generation: symbol | undefined;
  recovery: boolean; resetRecovery: boolean; cancelled: boolean; sent: boolean; captured?: { epoch: string; version: number };
  batch?: NonNullable<ReturnType<ThreadItemStore['beginBatch']>>; timer?: ReturnType<typeof setTimeout> }
type Host = { connected: boolean; scope?: Scope; pending?: Pending }

/** Supplied-input only: production subscription and capability selection belong to #1908. */
export function createThreadQueryCoordinator(deps: ThreadQueryDeps) {
  const hosts = new Map<string, Host>()
  let disposed = false
  const store = () => deps.store.getState()
  const generation = (host: string, id: string) => store().hosts.get(host)?.get(id)?.generation
  function present(host: string, scope: Scope, state: ThreadQueryState): void {
    scope.state = state
    deps.onState(host, scope.id, state)
    deps.log?.event({ event: 'thread-query-state', code: state.type === 'failed' ? state.reason : state.type })
  }
  function release(h: Host, p: Pending): void {
    clearTimeout(p.timer); p.batch?.abandon()
    if (h.pending === p) h.pending = undefined
  }
  function fail(host: string, h: Host, p: Pending, reason: string, unfinished = false): void {
    if (h.pending !== p) return
    const visible = !p.cancelled && h.scope === p.scope
    if (unfinished) { p.cancelled = true; p.batch?.abandon() }
    else release(h, p)
    if (visible) {
      present(host, p.scope, { type: 'failed', purpose: p.query.type === 'thread_page' ? 'older' : 'catch-up', reason, retryable: true })
    }
    deps.log?.event({ event: 'thread-query-failed', code: reason })
    pump(host, h)
  }
  function deadline(host: string, h: Host, p: Pending): void {
    clearTimeout(p.timer)
    p.timer = setTimeout(() => fail(host, h, p, 'timeout'), 30000)
  }
  function pump(host: string, h: Host): void {
    const s = h.scope
    if (disposed || !h.connected || h.pending || !s || s.restorePending || s.state.type === 'failed') return
    const snapshot = store().snapshot(host, s.id)
    let query: ThreadQuery
    if (s.catchUp) {
      query = { type: 'thread_catch_up', payload: { conversation_id: s.id,
        epoch: snapshot?.epoch ?? '', version: snapshot?.checkpoint ?? 0 } }
      s.catchUp = false
    } else {
      const boundary = snapshot?.ranges.at(-1)?.start
      if (!s.older || !s.ready || snapshot?.repair || boundary === undefined || s.exhausted ||
        (snapshot?.ranges.length === 1 && snapshot.olderAvailable === false)) { s.older = false; return }
      query = { type: 'thread_page', payload: { conversation_id: s.id, before_order: boundary } }
      s.older = false
    }
    const p: Pending = { scope: s, requestId: deps.requestId(), query,
      generation: generation(host, s.id), recovery: s.recovery || Boolean(snapshot?.repair),
      resetRecovery: s.resetRecovery, cancelled: false, sent: false }
    h.pending = p
    deadline(host, h, p)
    present(host, s, { type: 'loading', purpose: query.type === 'thread_page' ? 'older' : 'catch-up' })
    if (disposed || h.pending !== p || p.cancelled) return
    p.sent = true
    deps.log?.event({ event: 'thread-query-dispatched', code: query.type })
    try { deps.sendCommand({ type: 'queryThread', serverId: host, requestId: p.requestId, query }) }
    catch { fail(host, h, p, 'send-failed') }
  }
  function repair(host: string, h: Host, id: string): void {
    const s = h.scope
    if (!s || s.id !== id) return
    s.catchUp = true; s.ready = false
    // A failed recovery remains explicit retry, even when more live facts arrive.
    if (!h.pending && s.state.type !== 'failed') s.recovery = true
    pump(host, h)
  }
  function receive(event: Extract<StampedDaemonEvent, { type: 'threadReply' | 'threadQueryFailed' }>, h: Host): void {
    const host = event.serverId, p = h.pending
    if (host === null) return
    if (!p || p.requestId !== event.requestId || p.scope.id !== event.conversationId) return
    if (event.type === 'threadQueryFailed') { fail(host, h, p, event.reason); return }
    const reply = event.reply, value = reply.payload
    if (value.conversation_id !== p.scope.id) return
    deadline(host, h, p)
    const terminal = reply.type === 'thread_reset' || reply.payload.final
    if (p.cancelled) { if (terminal) { release(h, p); pump(host, h) }; return }
    if (generation(host, p.scope.id) !== p.generation) { fail(host, h, p, 'generation', !terminal); return }
    const s = p.scope
    if (reply.type === 'thread_reset') {
      deps.log?.event({ event: 'thread-query-reset', code: 'reset' })
      release(h, p)
      store().deleteConversation(host, s.id)
      store().acceptEpoch(host, s.id, value.epoch)
      s.catchUp = true; s.ready = false; s.exhausted = false
      if (p.resetRecovery) {
        present(host, s, { type: 'failed', purpose: 'catch-up', reason: 'recovery', retryable: true })
      } else { s.recovery = true; s.resetRecovery = true; present(host, s, { type: 'idle' }); pump(host, h) }
      return
    }
    const v = reply.payload
    if (!p.captured) {
      if ((p.query.type === 'thread_page' || p.query.payload.version > 0) &&
        store().snapshot(host, s.id)?.epoch !== v.epoch) { fail(host, h, p, 'metadata', !terminal); return }
      store().acceptEpoch(host, s.id, v.epoch)
      p.generation = generation(host, s.id)
      p.captured = { epoch: v.epoch, version: v.version }
      p.batch = store().beginBatch(host, s.id, v.epoch) ?? undefined
    }
    if (!p.batch || p.captured.epoch !== v.epoch || p.captured.version !== v.version) { fail(host, h, p, 'metadata', !terminal); return }
    if (!v.final) {
      if (p.batch.applyItems(v.items, p.captured.version).some(result => result.type === 'repair')) repair(host, h, s.id)
      return
    }
    let certificate: ThreadBatchCertificate
    const from = p.query.type === 'thread_catch_up' ? p.query.payload.version : 0
    if ('from_version' in v) {
      if (p.query.type !== 'thread_catch_up' || from === 0 || v.from_version !== from) { fail(host, h, p, 'metadata'); return }
      certificate = { fromVersion: v.from_version, version: p.captured.version, ranges: [] }
    } else {
      if (from !== 0 || v.continuation !== v.lower_order ||
        (p.query.type === 'thread_page' && v.upper_order !== p.query.payload.before_order)) { fail(host, h, p, 'metadata'); return }
      certificate = { fromVersion: from, version: p.captured.version,
        ranges: [{ start: v.lower_order, end: v.upper_order }], olderAvailable: v.older_exists }
    }
    // A page can hold facts but cannot retire a recovery fence.
    const result = p.query.type === 'thread_page' && store().snapshot(host, s.id)?.repair
      ? { type: 'repair' } : p.batch.commit(certificate)
    if (result.type !== 'applied') {
      release(h, p)
      if (!p.recovery) {
        s.catchUp = true; s.recovery = true; present(host, s, { type: 'idle' }); pump(host, h)
      } else present(host, s, { type: 'failed', purpose: 'catch-up', reason: 'recovery', retryable: true })
      return
    }
    release(h, p)
    deps.log?.event({ event: 'thread-query-completed', code: p.query.type })
    if (p.query.type === 'thread_catch_up') { s.catchUp = false; s.ready = true; s.recovery = false; s.resetRecovery = false }
    if (p.query.type === 'thread_catch_up') deps.onComplete?.(host, s.id, v.epoch, v.version)
    if ('older_exists' in v) s.exhausted = !v.older_exists
    present(host, s, { type: 'idle' }); pump(host, h)
  }
  function input(value: ThreadQueryInput): void {
    if (disposed) return
    if (value.type === 'sync') {
      const host = value.serverId, h = hosts.get(host) ?? { connected: false }
      hosts.set(host, h)
      const changed = h.scope?.id !== (value.conversationId ?? undefined)
      if (changed) {
        if (h.pending && !h.pending.cancelled) {
          h.pending.cancelled = true; h.pending.batch?.abandon()
          const pending = h.pending
          if (!pending.sent) release(h, pending)
          present(host, pending.scope, { type: 'idle' })
        }
        h.scope = value.conversationId === null ? undefined : { id: value.conversationId,
          restorePending: value.restorePending ?? false, catchUp: value.connected, older: false,
          recovery: false, resetRecovery: false, ready: false, exhausted: false, state: { type: 'idle' } }
      }
      const s = h.scope
      if (s) {
        s.restorePending = value.restorePending ?? false
        if (!changed && value.connected && !h.connected) { s.catchUp = true; s.state = { type: 'idle' } }
      }
      h.connected = value.connected
      if (!h.connected) {
        if (s) { s.catchUp = false; s.older = false }
        if (h.pending) fail(host, h, h.pending, 'disconnected')
      }
      pump(host, h); return
    }
    if (value.type === 'daemon') {
      const e = value.event
      if (e.serverId === null) return
      const h = hosts.get(e.serverId)
      if (!h) return
      if (e.type === 'threadReply' || e.type === 'threadQueryFailed') receive(e, h)
      else if (e.type === 'threadUpdate') {
        if (e.conversationId !== e.update.payload.conversation_id) return
        const applied = store().applyUpdate(e.serverId, e.update)
        if (applied.type === 'repair') repair(e.serverId, h, e.conversationId)
        else if (applied.type === 'applied' && h.scope?.id === e.conversationId && h.scope.ready) {
          const snapshot = store().snapshot(e.serverId, e.conversationId)
          if (snapshot && !snapshot.repair) deps.onComplete?.(e.serverId, e.conversationId, snapshot.epoch, snapshot.checkpoint)
        }
      } else {
        const snapshot = store().snapshot(e.serverId, e.conversationId)
        if (snapshot) {
          store().requireRepair(e.serverId, e.conversationId, snapshot.epoch, snapshot.version)
          repair(e.serverId, h, e.conversationId)
        }
      }
      return
    }
    const h = hosts.get(value.serverId), s = h?.scope
    if (!h || !s) return
    if (value.type === 'retry') {
      if (s.state.type !== 'failed') return
      const snapshot = store().snapshot(value.serverId, s.id)
      if (s.state.purpose === 'catch-up' || snapshot?.repair || !s.ready) s.catchUp = true
      else s.older = true
      s.state = { type: 'idle' }
    } else {
      if (h.pending?.scope === s && h.pending.query.type === 'thread_page') return
      s.older = true
    }
    pump(value.serverId, h)
  }
  function cancelHost(host: string): void {
    const h = hosts.get(host)
    hosts.delete(host)
    if (h?.pending) release(h, h.pending)
    if (h?.scope) present(host, h.scope, { type: 'idle' })
  }
  // cancelHost is connection teardown; navigation instead retains an unfinished host slot.
  return { input, cancelHost, dispose(): void {
    disposed = true
    for (const host of hosts.keys()) cancelHost(host)
  } }
}
