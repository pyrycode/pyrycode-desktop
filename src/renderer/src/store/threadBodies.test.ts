import { afterEach, expect, it, vi } from 'vitest'
import { createThreadBodies } from './threadBodies'
import type { RendererCommand } from '../../../shared/ipc/commands'
import type { StampedDaemonEvent } from '../../../shared/ipc/events'

const request = { serverId: 'a', conversationId: 'c', epoch: 'e', itemId: 1, revision: 8, kind: 'tool_call' as const }
const connected = (serverId = 'a'): StampedDaemonEvent => ({ type: 'connected', serverId,
  ack: { protocol_version: 'v2', server_id: serverId, conn_id: 'reused', capabilities: ['interactive', 'thread', 'thread_expansion'] } })
function fixture(limits = { active: 4, queued: 28, entries: 64, bytes: 16 * 1024 * 1024, leases: 128 }) {
  const commands: RendererCommand[] = []
  let generation = Symbol()
  const cache = createThreadBodies({ send: c => commands.push(c), log: () => {},
    scope: () => ({ epoch: 'e', generation, selected: true }) }, limits)
  cache.event(connected())
  const reads = () => commands.filter((c): c is Extract<RendererCommand, { type: 'queryThread' }> => c.type === 'queryThread')
  const settle = (index: number, content: Record<string, unknown> = {}) => {
    const c = reads()[index], q = c.query
    if (q.type !== 'thread_read_tool_body') throw Error('expected body query')
    const payload = { conversation_id: q.payload.conversation_id, epoch: q.payload.epoch, version: 8,
      item_id: q.payload.item_id, rev: q.payload.expected_rev, kind: 'tool_call' as const }
    cache.event({ type: 'threadReply', serverId: c.serverId, conversationId: q.payload.conversation_id, requestId: c.requestId,
      correlation: { id: 99, ts: '' }, reply: { type: 'thread_tool_body', payload: { ...payload, content, final: false } } })
    cache.event({ type: 'threadReply', serverId: c.serverId, conversationId: q.payload.conversation_id, requestId: c.requestId,
      correlation: { id: 99, ts: '' }, reply: { type: 'thread_tool_body', payload: { ...payload, final: true } } })
  }
  return { cache, commands, reads, settle, replace() { generation = Symbol(); cache.reconcile() } }
}
afterEach(() => vi.useRealTimers())
const childRequest = { ...request, kind: 'children' as const }
const child = { id: 2, order: 0, rev: 1, parent: 1, kind: 'unknown', status: 'unknown', active: false,
  shown: true, headline: 'é', detail_omitted: true as const }
it('child demand shares normalized limits and separates distinct page ceilings', () => {
  const h = fixture()
  h.cache.demand(childRequest); h.cache.demand({ ...childRequest, limit: 0 })
  h.cache.demand({ ...childRequest, limit: 1 })
  expect(h.reads()).toHaveLength(2)
  expect(h.reads()[1].query.payload).toMatchObject({ limit: 1 }); h.cache.dispose()
})
function childReply(h: ReturnType<typeof fixture>, index: number, final = true) {
  const command = h.reads()[index], q = command.query
  if (q.type !== 'thread_read_children') throw Error('child expected')
  const route = { conversation_id: q.payload.conversation_id, epoch: q.payload.epoch, version: 0,
    item_id: q.payload.item_id, rev: q.payload.expected_rev }
  h.cache.event({ type: 'threadReply', serverId: command.serverId, conversationId: route.conversation_id,
    requestId: command.requestId, correlation: { id: 99, ts: '' }, reply: { type: 'thread_children',
      payload: final ? { ...route, children: [], final: true, more: false } :
        { ...route, children: [{ ...child, parent: route.item_id }], final: false } } })
}
it('child failure admission preserves limit-specific successes and stays within the shared record bound', () => {
  const h = fixture({ active: 4, queued: 28, entries: 3, bytes: 240, leases: 128 })
  const cached = h.cache.demand({ ...childRequest, limit: 1 }); childReply(h, 0)
  const failed = h.cache.demand({ ...childRequest, limit: 2 }), command = h.reads()[1]
  h.cache.event({ type: 'threadQueryFailed', serverId: 'a', conversationId: 'c', requestId: command.requestId,
    inReplyTo: 1, reason: 'daemon-error' })
  expect(failed.getState().type).toBe('failed'); failed.release()
  expect(h.cache.demand({ ...childRequest, limit: 1 }).getState().type).toBe('ready')
  const changed = h.cache.demand({ ...childRequest, limit: 3 })
  expect(changed.getState()).toMatchObject({ type: 'failed', reason: 'daemon-error' }); changed.release()
  expect(h.cache.demand({ ...childRequest, limit: 4 }).getState()).toMatchObject({ type: 'missing', reason: 'limit' })
  expect(h.reads()).toHaveLength(2)
  cached.release(); h.cache.dispose()
})
it('body and child work share active, queue, record and lease bounds', () => {
  const h = fixture(), leases = Array.from({ length: 32 }, (_, i) => h.cache.demand({
    ...request, itemId: i + 1, kind: i % 2 ? 'children' : 'tool_call' }))
  expect(h.reads()).toHaveLength(4)
  expect(h.cache.demand({ ...childRequest, itemId: 33 }).getState()).toMatchObject({ type: 'failed', reason: 'limit' })
  leases[0].release(); expect(h.reads()).toHaveLength(5)
  for (let i = 0; i < 96; i++) h.cache.demand(childRequest)
  expect(h.cache.demand(childRequest).getState()).toMatchObject({ type: 'missing', reason: 'limit' })
  h.cache.dispose()
})
it('partial child bytes and cursor metadata count, and eviction cannot bypass failed admission', () => {
  const h = fixture({ active: 4, queued: 28, entries: 3, bytes: 240, leases: 128 })
  const a = h.cache.demand(childRequest)
  childReply(h, 0, false); expect(a.getState().page?.children).toHaveLength(1)
  const command = h.reads()[0]
  h.cache.event({ type: 'threadQueryFailed', serverId: 'a', conversationId: 'c', requestId: command.requestId,
    inReplyTo: 1, reason: 'daemon-error' })
  expect(a.getState()).toMatchObject({ type: 'failed', page: { complete: false } })
  const body = h.cache.demand({ ...request, itemId: 3 }); h.settle(1, { output: 'x'.repeat(230) })
  expect(a.getState()).toMatchObject({ type: 'failed', reason: 'daemon-error' })
  expect(a.getState().page).toBeUndefined(); a.release(); body.release()
  const reopened = h.cache.demand(childRequest)
  expect(reopened.getState().type).toBe('failed'); expect(h.reads()).toHaveLength(2)
  reopened.retry(); expect(h.reads()).toHaveLength(3); childReply(h, 2)
  expect(reopened.getState()).toMatchObject({ type: 'ready', page: { children: [], complete: true } }); h.cache.dispose()
})
it('successful child byte eviction reopens, while failed records survive mixed record pressure', () => {
  const h = fixture({ active: 4, queued: 28, entries: 2, bytes: 240, leases: 128 })
  const a = h.cache.demand(childRequest); childReply(h, 0, false); childReply(h, 0); a.release()
  const b = h.cache.demand({ ...request, itemId: 3 }); h.settle(1, { output: 'x'.repeat(230) }); b.release()
  const again = h.cache.demand(childRequest); expect(again.getState().type).toBe('loading')
  const command = h.reads()[2]
  h.cache.event({ type: 'threadQueryFailed', serverId: 'a', conversationId: 'c', requestId: command.requestId,
    inReplyTo: 1, reason: 'daemon-error' }); again.release()
  h.cache.demand({ ...request, itemId: 4 }); h.settle(3)
  expect(h.cache.demand(childRequest).getState().type).toBe('failed')
  expect(h.reads()).toHaveLength(4); h.cache.dispose()
})
it('child generation replacement revokes all leases before reentrant callbacks and late data', () => {
  const h = fixture(), seen: string[] = []
  const a = h.cache.demand(childRequest, s => {
    if (s.type === 'missing') { b.retry(); seen.push(h.cache.demand(childRequest).getState().type) }
  }), b = h.cache.demand(childRequest)
  h.replace(); expect(a.getState().type).toBe('missing'); expect(seen).toEqual(['failed'])
  const next = h.cache.demand(childRequest); childReply(h, 0)
  expect(next.getState().type).toBe('loading'); childReply(h, 1)
  expect(next.getState().type).toBe('ready'); h.cache.dispose()
})
it('child active deadline requires explicit first-page retry and clears timers on disposal', () => {
  vi.useFakeTimers()
  const h = fixture(), lease = h.cache.demand(childRequest)
  childReply(h, 0, false)
  vi.advanceTimersByTime(29999); expect(lease.getState().type).toBe('loading')
  vi.advanceTimersByTime(1); expect(lease.getState()).toMatchObject({ type: 'failed', reason: 'expired', page: { complete: false } })
  h.cache.demand(childRequest); expect(h.reads()).toHaveLength(1)
  lease.retry(); expect(h.reads()).toHaveLength(2); childReply(h, 0)
  expect(lease.getState().type).toBe('loading'); childReply(h, 1)
  expect(lease.getState()).toMatchObject({ type: 'ready', page: { children: [], complete: true } })
  h.cache.dispose(); expect(vi.getTimerCount()).toBe(0)
})
it('invalid identities settle without a command or subscription', () => {
  const h = fixture()
  for (const change of [{ epoch: '' }, { itemId: 0 }, { revision: 0 }, { itemId: Number.MAX_SAFE_INTEGER + 1 }]) {
    expect(h.cache.demand({ ...request, ...change }).getState()).toMatchObject({ type: 'failed', reason: 'invalid' })
  }
  expect(h.commands).toHaveLength(0); h.cache.dispose()
})
it('retirement notifications cannot reenter demand and revive a leaving scope', () => {
  const h = fixture(), states: string[] = []
  h.cache.demand(request, state => {
    if (state.type === 'missing') states.push(h.cache.demand(request).getState().type)
  })
  h.cache.retire('a', 'c', true)
  expect(states).toEqual(['failed']); expect(h.reads()).toHaveLength(1)
  h.cache.dispose()
})
it.each([1, 2])('retirement disables every existing lease before callbacks retry item %s', itemId => {
  vi.useFakeTimers()
  const h = fixture(), observed: string[] = []
  const first = h.cache.demand(request, state => {
    if (state.type !== 'missing') return
    observed.push(second.getState().type)
    second.retry()
  })
  const second = h.cache.demand({ ...request, itemId })
  for (const c of h.reads()) h.cache.event({ type: 'threadQueryFailed', serverId: 'a', conversationId: 'c',
    requestId: c.requestId, inReplyTo: 1, reason: 'daemon-error' })
  const reads = h.reads().length
  h.cache.retire('a', 'c')
  expect(observed).toEqual(['missing'])
  expect(h.reads()).toHaveLength(reads)
  expect(first.getState().type).toBe('missing')
  const reopened = h.cache.demand({ ...request, itemId })
  for (let i = 0; i < reads; i++) h.settle(i)
  expect(reopened.getState()).toMatchObject({ type: 'failed', reason: 'daemon-error' })
  expect(vi.getTimerCount()).toBe(0)
  reopened.retry(); expect(h.reads()).toHaveLength(reads + 1)
  h.settle(reads); expect(reopened.getState().type).toBe('ready')
  h.cache.dispose(); expect(vi.getTimerCount()).toBe(0)
})
it('admits exactly four active plus 28 queued demands, and releases only the last consumer', () => {
  const h = fixture(), leases = Array.from({ length: 32 }, (_, i) => h.cache.demand({ ...request, itemId: i + 1 }))
  expect(h.reads()).toHaveLength(4)
  const excess = h.cache.demand({ ...request, itemId: 33 })
  expect(excess.getState()).toMatchObject({ type: 'failed', reason: 'limit' })
  const duplicate = h.cache.demand(request)
  leases[0].release(); expect(h.reads()).toHaveLength(4)
  duplicate.release(); expect(h.reads()).toHaveLength(5)
  expect(h.commands.filter(c => c.type === 'cancelThreadQuery')).toHaveLength(1)
  h.cache.dispose()
})
it('bounds all leases, including demand without a listener, at 128 and reuses released capacity', () => {
  const h = fixture(), leases = Array.from({ length: 128 }, () => h.cache.demand(request))
  expect(h.reads()).toHaveLength(1)
  expect(h.cache.demand(request).getState()).toMatchObject({ type: 'missing', reason: 'limit' })
  leases[0].release()
  expect(h.cache.demand(request).getState().type).toBe('loading')
  h.cache.retire('a')
  expect(h.cache.demand(request).getState().type).toBe('loading')
  h.cache.dispose()
})
it('bounds entry records at 64 even for subscribed ready and failed entries', () => {
  const h = fixture()
  for (let i = 0; i < 64; i++) { h.cache.demand({ ...request, itemId: i + 1 }); h.settle(i) }
  expect(h.cache.demand({ ...request, itemId: 65 }).getState()).toMatchObject({ type: 'missing', reason: 'limit' })
  h.cache.retire('a')
  expect(h.cache.demand({ ...request, itemId: 65 }).getState().type).toBe('loading')
  h.cache.dispose()
})
it('evicts at the exact retained byte boundary and exposes evicted state to subscribed readers', () => {
  const content = { output: 'é' }, bytes = new TextEncoder().encode(JSON.stringify(content)).length
  const h = fixture({ active: 4, queued: 28, entries: 64, bytes, leases: 128 })
  const first = h.cache.demand(request), seen = vi.fn()
  h.settle(0, content); expect(first.getState().type).toBe('ready')
  const second = h.cache.demand({ ...request, itemId: 2 }, seen)
  h.settle(1, content)
  expect(first.getState()).toMatchObject({ type: 'missing', reason: 'evicted' })
  expect(second.getState()).toMatchObject({ type: 'ready', content })
  first.release()
  expect(h.cache.demand(request).getState().type).toBe('loading')
  expect(h.reads()).toHaveLength(3); h.cache.dispose()
})
it('times out once, never retries automatically, and an explicit retry gets a fresh identity', () => {
  vi.useFakeTimers()
  const h = fixture(), lease = h.cache.demand(request), first = h.reads()[0].requestId
  vi.advanceTimersByTime(29999); expect(lease.getState().type).toBe('loading')
  vi.advanceTimersByTime(1); expect(lease.getState()).toMatchObject({ type: 'failed', reason: 'expired' })
  vi.advanceTimersByTime(300000); h.cache.demand(request); expect(h.reads()).toHaveLength(1)
  lease.retry(); expect(h.reads()[1].requestId).not.toBe(first)
  h.settle(0); expect(lease.getState().type).toBe('loading')
  h.settle(1); expect(lease.getState().type).toBe('ready')
  h.cache.dispose(); expect(vi.getTimerCount()).toBe(0)
})
it('byte eviction preserves failed revalidation until explicit retry', () => {
  const content = { output: 'é' }, bytes = new TextEncoder().encode(JSON.stringify(content)).length
  const h = fixture({ active: 4, queued: 28, entries: 64, bytes, leases: 128 })
  const first = h.cache.demand(request)
  h.settle(0, content); first.release()
  h.cache.event({ type: 'disconnected', serverId: 'a' }); h.cache.event(connected())
  const revalidation = h.cache.demand(request), failed = h.reads()[1]
  h.cache.event({ type: 'threadQueryFailed', serverId: 'a', conversationId: 'c', requestId: failed.requestId,
    inReplyTo: 1, reason: 'daemon-error' })
  expect(revalidation.getState()).toMatchObject({ type: 'failed', content })
  h.cache.demand({ ...request, itemId: 2 }); h.settle(2, content)
  expect(revalidation.getState()).toEqual({ type: 'failed', reason: 'daemon-error', stale: true })
  const reopened = h.cache.demand(request)
  expect(h.reads()).toHaveLength(3)
  reopened.retry(); expect(h.reads()).toHaveLength(4)
  expect(h.reads()[3].requestId).not.toBe(failed.requestId)
  h.settle(1); expect(reopened.getState().type).toBe('loading')
  h.settle(3, content); expect(reopened.getState()).toEqual({ type: 'ready', content, stale: false })
  h.cache.dispose()
})
it('record eviction preserves failed admission until explicit retry', () => {
  const h = fixture({ active: 4, queued: 28, entries: 2, bytes: 1024, leases: 128 })
  const first = h.cache.demand(request), failed = h.reads()[0]
  h.cache.event({ type: 'threadQueryFailed', serverId: 'a', conversationId: 'c', requestId: failed.requestId,
    inReplyTo: 1, reason: 'daemon-error' })
  first.release()
  const other = h.cache.demand({ ...request, itemId: 2 }); h.settle(1); other.release()
  const pressure = h.cache.demand({ ...request, itemId: 3 })
  expect(pressure.getState().type).toBe('loading')
  const reopened = h.cache.demand(request)
  expect(reopened.getState()).toMatchObject({ type: 'failed', reason: 'daemon-error' })
  expect(h.reads()).toHaveLength(3)
  reopened.retry(); expect(h.reads()).toHaveLength(4)
  expect(h.reads()[3].requestId).not.toBe(failed.requestId)
  h.settle(0); expect(reopened.getState().type).toBe('loading')
  h.settle(3); expect(reopened.getState().type).toBe('ready')
  h.cache.dispose()
})
it.each(['clear', 'generation'])('saturated failed admission stays bounded and clears only with its lifecycle scope: %s', mode => {
  vi.useFakeTimers()
  const h = fixture()
  for (let itemId = 1; itemId <= 64; itemId++) {
    const lease = h.cache.demand({ ...request, itemId }), c = h.reads()[itemId - 1]
    h.cache.event({ type: 'threadQueryFailed', serverId: 'a', conversationId: 'c', requestId: c.requestId,
      inReplyTo: 1, reason: 'daemon-error' })
    lease.release()
  }
  h.cache.retire('a', 'c')
  h.cache.event({ type: 'disconnected', serverId: 'a' }); h.cache.event(connected())
  for (let itemId = 65; itemId <= 128; itemId++) {
    expect(h.cache.demand({ ...request, itemId }).getState()).toMatchObject({ type: 'missing', reason: 'limit' })
  }
  for (let itemId = 1; itemId <= 64; itemId++) {
    const lease = h.cache.demand({ ...request, itemId })
    expect(lease.getState()).toEqual({ type: 'failed', reason: 'daemon-error', stale: true }); lease.release()
  }
  expect(h.reads()).toHaveLength(64); expect(vi.getTimerCount()).toBe(0)
  if (mode === 'clear') h.cache.retire('a', 'c', true)
  else h.replace()
  const next = h.cache.demand(request)
  expect(h.reads()).toHaveLength(65)
  h.settle(0); expect(next.getState().type).toBe('loading')
  h.settle(64); expect(next.getState().type).toBe('ready')
  h.cache.dispose(); expect(vi.getTimerCount()).toBe(0)
})
it('equal host/conversation/epoch strings cannot revive retired ownership or generation', () => {
  const h = fixture(), old = h.cache.demand(request), listener = vi.fn()
  h.replace()
  const next = h.cache.demand(request, listener)
  h.settle(0); expect(old.getState().type).toBe('missing'); expect(next.getState().type).toBe('loading')
  h.settle(1); expect(next.getState().type).toBe('ready')
  h.cache.retire('a', 'c', true)
  const after = h.cache.demand(request)
  h.settle(1); expect(after.getState().type).toBe('loading')
  expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'missing', reason: 'retired' }))
  h.cache.dispose()
})
it('colliding IDs on two hosts retain independent demand and connection freshness', () => {
  const h = fixture(); h.cache.event(connected('b'))
  const a = h.cache.demand(request), b = h.cache.demand({ ...request, serverId: 'b' })
  h.settle(0, { host: 'a' }); h.settle(1, { host: 'b' })
  h.cache.event({ type: 'disconnected', serverId: 'a' })
  expect(a.getState().type).toBe('missing'); expect(b.getState()).toMatchObject({ type: 'ready', content: { host: 'b' }, stale: false })
  const offline = h.cache.demand(request)
  expect(offline.getState()).toMatchObject({ type: 'ready', content: { host: 'a' }, stale: true })
  h.cache.event(connected('a')); expect(h.reads()).toHaveLength(2)
  h.cache.demand(request); expect(h.reads()).toHaveLength(3)
  h.cache.dispose()
})
it.each(['release', 'navigation'])('cancelled reconnect validation stays stale across %s and requires a new read', mode => {
  const h = fixture(), first = h.cache.demand(request)
  h.settle(0, { retained: true }); first.release()
  h.cache.event({ type: 'disconnected', serverId: 'a' }); h.cache.event(connected())
  const pending = h.cache.demand(request)
  expect(pending.getState()).toMatchObject({ type: 'loading', stale: true })
  if (mode === 'release') pending.release()
  else h.cache.retire('a', 'c')
  const reopened = h.cache.demand(request)
  expect(h.reads()).toHaveLength(3)
  expect(reopened.getState()).toMatchObject({ type: 'loading', stale: true, content: { retained: true } })
  h.settle(1); expect(reopened.getState().type).toBe('loading')
  h.settle(2); expect(reopened.getState()).toMatchObject({ type: 'ready', stale: false })
  h.cache.dispose()
})
it('navigation cannot silently retry a retained failure', () => {
  const h = fixture(), first = h.cache.demand(request), c = h.reads()[0]
  h.cache.event({ type: 'threadQueryFailed', serverId: 'a', conversationId: 'c', requestId: c.requestId, inReplyTo: 1, reason: 'daemon-error' })
  first.release(); h.cache.retire('a', 'c')
  const reopened = h.cache.demand(request)
  expect(reopened.getState()).toMatchObject({ type: 'failed', reason: 'daemon-error' })
  expect(h.reads()).toHaveLength(1)
  reopened.retry(); expect(h.reads()).toHaveLength(2); h.cache.dispose()
})
