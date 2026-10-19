import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { dispatchThreadQuery } from '../src/main/threadQueryCommand'
import type { ThreadQuery } from '../src/shared/wire/thread'
import { createDaemonConnection } from '../src/main/daemonConnection'
import { encodeEnvelope, decodeEnvelope, base64StdEncode } from '../src/main/transport/codec'
import { isRendererCommand } from '../src/shared/ipc/commands'
import { DAEMON_EVENT_CHANNEL, type StampedDaemonEvent } from '../src/shared/ipc/events'
import type { NoiseRelayDriverConfig } from '../src/main/transport/noiseRelayDriver'
import type { PyryApi } from '../src/preload'
import { createThreadRuntime } from '../src/renderer/src/store/threadRuntime'
import { beginChatHistoryRemoval } from '../src/renderer/src/store/chatHistoryRemoval'
const electron = vi.hoisted(() => ({ expose: vi.fn(), listeners: new Set<Function>(), send: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: electron.expose }, webUtils: {}, ipcRenderer: {
  send: electron.send, on: (_: string, listener: Function) => electron.listeners.add(listener),
  removeListener: (_: string, listener: Function) => electron.listeners.delete(listener)
} }))
import '../src/preload'
const api: PyryApi = electron.expose.mock.calls[0][1]
const query = { type: 'thread_catch_up' as const, payload: { conversation_id: 'c', epoch: 'e', version: 3 } }
const item = { id: 1, rev: 8, kind: 'future', status: 'future', active: false, shown: false,
  summary: '', content: JSON.parse('{"__proto__":{"polluted":true},"unknown":[false,0,null]}') }
const batch = { conversation_id: 'c', epoch: 'e', version: 8, items: [item], final: false }
const windowDone = { ...batch, items: [], final: true, lower_order: 0, upper_order: 10, continuation: 0, older_exists: false }
const frame = (type: string, payload: unknown, in_reply_to: number, extra = {}) =>
  encodeEnvelope({ id: 99, type, ts: 'stamp', payload, in_reply_to, session_id: 's', ...extra })
async function connected(serverId = 'a', expansion = false) {
  const configs: NoiseRelayDriverConfig[] = [], events: StampedDaemonEvent[] = [], sent: Uint8Array[] = []
  const observations: Function[] = []
  let drop = false, throws = false
  const connection = createDaemonConnection({ serverId, deviceName: 'test', clientVersion: 'test',
    pairedServer: { load: async () => ({ server: serverId, relay: 'wss://relay.example/v1/client', token: 'fake', server_static_pubkey: base64StdEncode(new Uint8Array(32)) }), save: async () => {} },
    deviceKeypair: { ensure: async () => ({ publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) }) },
    sink: { isDestroyed: () => false, webContents: { send: (channel, event) => {
      const cloned = structuredClone(event) as StampedDaemonEvent; events.push(cloned)
      if (channel === DAEMON_EVENT_CHANNEL) electron.listeners.forEach(listener => listener({}, cloned))
    } } }, createDriver: config => { configs.push(config); return { stop: () => {}, sendMessage: (bytes, observe) => {
      if (throws) throw Error('untrusted error'); sent.push(bytes)
      if (observe) observations.push(observe)
      if (drop) observe?.({ type: 'dropped', reason: 'write-failed' })
    } } }
  })
  connection.start(); await vi.waitFor(() => expect(configs).toHaveLength(1))
  const ack = encodeEnvelope({ id: 1, type: 'hello_ack', ts: 'stamp', payload: { protocol_version: 'v2', server_id: serverId, conn_id: 'conn', capabilities: expansion ? ['thread', 'interactive', 'thread_expansion'] : ['thread'] } })
  configs[0].onEvent({ type: 'handshake-complete', helloAck: ack })
  const emit = (bytes: Uint8Array) => configs.at(-1)!.onEvent({ type: 'message', plaintext: bytes })
  const ask = (q: ThreadQuery = query, requestId = 'request') => { connection.queryThread(q, requestId); return decodeEnvelope(sent.at(-1)!).id }
  const replies = () => events.filter(e => e.type === 'threadReply' || e.type === 'threadQueryFailed')
  return { connection, configs, events, sent, ack, emit, ask, replies, observations, failSend: (throwing = false) => { drop = true; throws = throwing } }
}
function routePreloadQueries(route: Parameters<typeof dispatchThreadQuery>[1]) {
  electron.send.mockImplementation((_channel, command) => {
    const cloned = structuredClone(command)
    if (isRendererCommand(cloned) && (cloned.type === 'queryThread' || cloned.type === 'cancelThreadQuery')) dispatchThreadQuery(cloned, route, {
      isDestroyed: () => false, webContents: { send: (_channel, e) => electron.listeners.forEach(listener => listener({}, structuredClone(e))) }
    })
  })
}
afterEach(() => { electron.listeners.clear(); electron.send.mockReset(); vi.useRealTimers() })
const bodyRequest = { serverId: 'a', conversationId: 'c', epoch: 'e', itemId: 1, revision: 8, kind: 'tool_call' as const }
const bodyQuery = { type: 'thread_read_tool_body' as const, payload: { conversation_id: 'c', epoch: 'e', item_id: 1, expected_rev: 8 } }
const bodyData = { conversation_id: 'c', epoch: 'e', version: 8, item_id: 1, rev: 8, kind: 'tool_call', content: { input: '', output: '' }, final: false }
const bodyDone = { conversation_id: 'c', epoch: 'e', version: 8, item_id: 1, rev: 8, kind: 'tool_call', final: true }
const childRequest = { serverId: 'a', conversationId: 'c', epoch: 'e', itemId: 1, revision: 8, limit: 2 }
const child = (id = 2, order = 0) => ({ id, order, rev: 1, parent: 1, kind: 'future', status: 'future',
  active: false, shown: false, headline: '', detail_omitted: true, public_child_count: 0,
  has_public_children: false, subtree_version: 0, error_summary: '' })
const childRoute = { conversation_id: 'c', epoch: 'e', version: 0, item_id: 1, rev: 8 }
const childCursor = (id = 3, order = 0) => ({ ...childRoute, id, order })
const childReads = (h: { sent: Uint8Array[] }) => h.sent.map(decodeEnvelope).filter(e => e.type === 'thread_read_children')
const childPage = (children = [child(2)]) => ({ ...childRoute, children, final: false })
const childEnd = (more = false) => ({ ...childRoute, children: [], final: true, more, ...(more ? { cursor: childCursor(2) } : {}) })
it('marker-only empty success is cached, and unknown optional facts remain absent', async () => {
  const h = await bodyRuntime(), lease = h.r.children.demand(childRequest)
  h.emit(frame('thread_children', childEnd(), childReads(h)[0].id))
  expect(lease.getState()).toMatchObject({ type: 'ready', page: { children: [], complete: true } })
  lease.release(); expect(h.r.children.demand(childRequest).getState().type).toBe('ready')
  expect(childReads(h)).toHaveLength(1); h.close()
  const other = await bodyRuntime(), next = other.r.children.demand(childRequest)
  const { public_child_count, has_public_children, subtree_version, error_summary, ...unknown } = child()
  other.emit(frame('thread_children', childPage([unknown as ReturnType<typeof child>]), childReads(other)[0].id))
  other.emit(frame('thread_children', childEnd(), childReads(other)[0].id))
  expect(next.getState().page?.children).toEqual([unknown]); other.close()
})
it('failed continuation retains incomplete summaries and retry starts a replacement first page', async () => {
  const h = await bodyRuntime(), lease = h.r.children.demand(childRequest)
  h.emit(frame('thread_children', childPage(), childReads(h)[0].id))
  h.emit(frame('thread_children', childEnd(true), childReads(h)[0].id))
  lease.continue(childCursor(2))
  const failed = childReads(h)[1].id
  h.emit(frame('error', { code: 'thread.query_failed', message: 'private peer text' }, failed))
  expect(lease.getState()).toMatchObject({ type: 'failed', page: { children: [child(2)], complete: false }, stale: true })
  expect(h.r.children.demand(childRequest).getState().type).toBe('failed')
  expect(childReads(h)).toHaveLength(2)
  lease.retry(); expect(childReads(h)[2].payload).not.toHaveProperty('cursor')
  h.emit(frame('thread_children', childEnd(), failed))
  expect(lease.getState().type).toBe('loading')
  h.emit(frame('thread_children', childEnd(), childReads(h)[2].id))
  expect(lease.getState()).toMatchObject({ type: 'ready', page: { children: [], complete: true } })
  h.close()
})
it('two hosts with colliding child identities stay isolated through connection and preload', async () => {
  const a = await connected('a', true), b = await connected('b', true)
  routePreloadQueries(host => host === 'a' ? a.connection : b.connection)
  const r = createThreadRuntime({ send: api.sendCommand, read: async () => ({ status: 'missing' }), log: () => {} })
  const off = api.onDaemonEvent(r.event)
  for (const h of [a, b]) {
    h.events.filter(e => e.type === 'connected').forEach(r.event); await r.open(h === a ? 'a' : 'b', 'c').done
    const id = decodeEnvelope(h.sent.at(-1)!).id
    h.emit(frame('thread_items', batch, id)); h.emit(frame('thread_items', windowDone, id))
  }
  const target = r.children.demand({ ...childRequest, serverId: 'b' }), id = childReads(b)[0].id
  const owner = electron.send.mock.calls.map(call => call[1]).find(c => c.type === 'queryThread' && c.query.type === 'thread_read_children')
  // Equal local request IDs must still be isolated by the authenticated owning host.
  a.ask({ type: 'thread_read_children', payload: { conversation_id: 'c', epoch: 'e', item_id: 1, expected_rev: 8 } }, owner.requestId)
  a.emit(frame('thread_children', childPage([child(99)]), childReads(a)[0].id))
  a.emit(frame('thread_children', childEnd(), childReads(a)[0].id))
  expect(a.replies().at(-1)).toMatchObject({ type: 'threadReply', reply: { type: 'thread_children' } })
  expect(target.getState().type).toBe('loading')
  b.emit(frame('thread_children', childPage(), id)); b.emit(frame('thread_children', childEnd(), id))
  expect(target.getState().page?.children).toEqual([child(2)])
  r.dispose(); off(); a.connection.stop(); b.connection.stop()
})
it('mixed body/child saturation leaves complete queries progressing without prefetch', async () => {
  const h = await bodyRuntime(true, true)
  for (let i = 0; i < 32; i++) {
    if (i % 2) h.r.children.demand({ ...childRequest, itemId: i + 1 })
    else h.r.bodies.demand({ ...bodyRequest, itemId: i + 1 })
  }
  expect(h.reads().length + childReads(h).length).toBe(4)
  expect(h.r.children.demand({ ...childRequest, itemId: 33 }).getState()).toMatchObject({ type: 'failed', reason: 'limit' })
  h.r.query('older', 'a')
  const query = h.sent.map(decodeEnvelope).find(e => e.type === 'thread_page')!
  expect(query).toBeDefined()
  h.emit(frame('thread_items', { ...windowDone, upper_order: 5 }, query.id))
  expect(h.replies().at(-1)).toMatchObject({ type: 'threadReply', requestId: expect.any(String) })
  expect(h.r.state.getState().queries.get(JSON.stringify(['a', 'c']))).toEqual({ type: 'idle' })
  expect(h.reads().length + childReads(h).length).toBe(4); h.close()
})
it('child cached success is stale offline and reconnect waits for explicit demand', async () => {
  const h = await bodyRuntime(), lease = h.r.children.demand(childRequest)
  h.emit(frame('thread_children', childPage(), childReads(h)[0].id)); h.emit(frame('thread_children', childEnd(), childReads(h)[0].id))
  lease.release(); h.configs[0].onEvent({ type: 'relay-link-down', code: 1006 })
  const offline = h.r.children.demand(childRequest)
  expect(offline.getState()).toMatchObject({ type: 'ready', stale: true, page: { children: [child(2)], complete: false } })
  expect(h.r.children.demand({ ...childRequest, itemId: 8 }).getState()).toMatchObject({ type: 'missing', reason: 'offline' })
  expect(childReads(h)).toHaveLength(1)
  h.configs[0].onEvent({ type: 'handshake-complete', helloAck: h.ack })
  expect(h.events.at(-1)).toMatchObject({ type: 'connected' }); expect(childReads(h)).toHaveLength(1)
  const fresh = h.r.children.demand(childRequest)
  expect(childReads(h)).toHaveLength(2)
  expect(childReads(h)[1].payload).not.toHaveProperty('cursor')
  expect(fresh.getState()).toMatchObject({ type: 'loading', stale: true }); h.close()
})
it('new explicitly demanded parent revision retires old leases and late replies', async () => {
  const h = await bodyRuntime(), old = h.r.children.demand(childRequest), id = childReads(h)[0].id
  const fresh = h.r.children.demand({ ...childRequest, revision: 9 })
  expect(old.getState().type).toBe('missing')
  h.emit(frame('thread_children', childPage(), id)); h.emit(frame('thread_children', childEnd(), id))
  expect(fresh.getState().type).toBe('loading')
  h.emit(frame('thread_children', { ...childEnd(), rev: 9 }, childReads(h)[1].id))
  expect(fresh.getState().type).toBe('ready'); h.close()
})
it.each(['other', 'c', 'disconnect'])('revision retirement callbacks cannot admit a new child read after %s', async target => {
  const h = await bodyRuntime()
  let leaving: ReturnType<typeof h.r.open> | undefined
  h.r.children.demand(childRequest, state => {
    if (state.type !== 'missing' || leaving) return
    if (target === 'disconnect') h.configs[0].onEvent({ type: 'relay-link-down', code: 1006 })
    else leaving = h.r.open('a', target)
  })
  const fresh = h.r.children.demand({ ...childRequest, revision: 9 })
  await leaving?.done
  expect(fresh.getState()).toMatchObject({ type: 'missing', reason: 'retired' })
  expect(childReads(h)).toHaveLength(1); h.close()
})
it.each(['conversation_id', 'epoch', 'item_id', 'rev', 'version', 'order', 'id'])('main rejects missing cursor field %s before sending', async field => {
  const h = await connected('a', true), cursor = childCursor()
  delete (cursor as Record<string, unknown>)[field]
  const query = { type: 'thread_read_children', payload: { conversation_id: 'c', epoch: 'e', item_id: 1, expected_rev: 8, cursor } }
  expect(isRendererCommand({ type: 'queryThread', serverId: 'a', requestId: 'invalid', query })).toBe(false)
  h.connection.queryThread(query as ThreadQuery, 'invalid')
  expect(h.replies().at(-1)).toMatchObject({ type: 'threadQueryFailed', reason: 'unavailable' })
  expect(childReads(h)).toHaveLength(0); h.connection.stop()
})
it('invalid continuation fails admission without losing partial pages or silently refetching', async () => {
  const h = await bodyRuntime(), lease = h.r.children.demand(childRequest)
  h.emit(frame('thread_children', childPage(), childReads(h)[0].id)); h.emit(frame('thread_children', childEnd(true), childReads(h)[0].id))
  lease.continue({ ...childCursor(2), version: 1 })
  expect(lease.getState()).toMatchObject({ type: 'failed', page: { children: [child(2)], complete: false } })
  expect(h.r.children.demand(childRequest).getState().type).toBe('failed')
  expect(childReads(h)).toHaveLength(1); lease.retry()
  expect(childReads(h)[1].payload).not.toHaveProperty('cursor'); h.close()
})
it('received child record eviction reopens successes and never readmits a failed continuation', async () => {
  const h = await bodyRuntime(), first = h.r.children.demand(childRequest)
  h.emit(frame('thread_children', childPage(), childReads(h)[0].id)); h.emit(frame('thread_children', childEnd(true), childReads(h)[0].id))
  first.continue(childCursor(2)); h.emit(frame('error', { code: 'thread.query_failed', message: '' }, childReads(h)[1].id))
  expect(first.getState().type).toBe('failed'); first.release()
  for (let itemId = 2; itemId <= 65; itemId++) {
    const next = h.r.children.demand({ ...childRequest, itemId }), id = childReads(h).at(-1)!.id
    h.emit(frame('thread_children', { ...childEnd(), item_id: itemId }, id))
    expect(next.getState().type).toBe('ready'); next.release()
  }
  const count = childReads(h).length
  expect(h.r.children.demand(childRequest).getState().type).toBe('failed')
  expect(childReads(h)).toHaveLength(count)
  expect(h.r.children.demand({ ...childRequest, itemId: 2 }).getState().type).toBe('loading')
  expect(childReads(h)).toHaveLength(count + 1); h.close()
})
it('last child release cancels once and late data cannot complete replacement leases', async () => {
  const h = await bodyRuntime(), a = h.r.children.demand(childRequest), b = h.r.children.demand(childRequest), id = childReads(h)[0].id
  a.release(); expect(h.replies().filter(e => e.type === 'threadQueryFailed')).toHaveLength(0)
  b.release(); b.release()
  expect(h.replies().filter(e => e.type === 'threadQueryFailed')).toHaveLength(1)
  const fresh = h.r.children.demand(childRequest)
  h.emit(frame('thread_children', childPage(), id)); h.emit(frame('thread_children', childEnd(), id))
  expect(fresh.getState()).toMatchObject({ type: 'loading' }); expect(fresh.getState().page).toBeUndefined()
  h.emit(frame('thread_children', childEnd(), childReads(h)[1].id))
  expect(fresh.getState().type).toBe('ready'); h.close()
})
it('disconnect and reconnect preserve child failure admission with retained partial summaries', async () => {
  const h = await bodyRuntime(), lease = h.r.children.demand(childRequest), id = childReads(h)[0].id
  h.emit(frame('thread_children', childPage(), id)); h.emit(frame('error', { code: 'thread.query_failed', message: '' }, id))
  expect(lease.getState().type).toBe('failed')
  h.configs[0].onEvent({ type: 'relay-link-down', code: 1006 })
  expect(h.r.children.demand(childRequest).getState()).toMatchObject({ type: 'failed', page: { children: [child(2)], complete: false } })
  h.configs[0].onEvent({ type: 'handshake-complete', helloAck: h.ack })
  const reopened = h.r.children.demand(childRequest)
  expect(reopened.getState().type).toBe('failed'); expect(childReads(h)).toHaveLength(1)
  reopened.retry(); expect(childReads(h)).toHaveLength(2); h.close()
})
it.each([
  ['missing required', { order: undefined }], ['unsafe ID', { id: Number.MAX_SAFE_INTEGER + 1 }],
  ['null count', { public_child_count: null }], ['count inconsistency', { has_public_children: true }],
  ['body', { content: {} }], ['descendants', { children: [] }], ['false omitted', { detail_omitted: false }],
  ['wrong parent', { parent: 2 }], ['multiline headline', { headline: 'a\nb' }],
  ['long headline', { headline: 'é'.repeat(201) }], ['long error', { error_summary: '😀'.repeat(201) }],
  ['null optional', { subtree_version: null }], ['empty attribution', { agent: '' }], ['false no-child', { no_child: false }]
])('malformed summary fails closed: %s', async (_name, change) => {
  const h = await bodyRuntime(), before = h.r.items.getState().snapshot('a', 'c'), lease = h.r.children.demand(childRequest)
  h.emit(frame('thread_children', { ...childPage(), children: [{ ...child(), ...change }] }, childReads(h)[0].id))
  expect(lease.getState().type).toBe('failed')
  expect(h.r.items.getState().snapshot('a', 'c')).toBe(before); expect(childReads(h)).toHaveLength(1); h.close()
})
it.each([
  ['descending ties', { children: [child(3), child(2)] }], ['duplicate tuple', { children: [child(2), child(2)] }],
  ['over row limit', { children: [child(2), child(3), child(4)] }], ['data more', { more: false }],
  ['fragment', { continuation: { index: 0 }, data: 'x' }], ['wrong epoch', { epoch: 'other' }],
  ['wrong rev', { rev: 9 }], ['wrong conversation', { conversation_id: 'other' }]
])('malformed page fails closed: %s', async (_name, change) => {
  const h = await bodyRuntime(), lease = h.r.children.demand(childRequest)
  h.emit(frame('thread_children', { ...childPage(), ...change }, childReads(h)[0].id))
  expect(lease.getState().type).toBe('failed'); expect(childReads(h)).toHaveLength(1); h.close()
})
it.each([
  ['capture', { version: 1 }, {}], ['routing presence', {}, { conversation_id: 'c' }],
  ['session', {}, { session_id: 'changed' }], ['scope', {}, { conversation_id: 'other' }],
  ['missing more', { more: undefined }, {}], ['cursor on exhausted', { cursor: childCursor(2) }, {}],
  ['wrong last ID', { more: true, cursor: childCursor(3) }, {}],
  ['missing cursor', { more: true }, {}], ['wrong cursor version', { more: true, cursor: { ...childCursor(2), version: 1 } }, {}],
  ['null cursor', { more: true, cursor: null }, {}], ['missing cursor order', { more: true, cursor: { ...childCursor(2), order: undefined } }, {}]
])('invalid marker retains partial content: %s', async (_name, change, envelope) => {
  const h = await bodyRuntime(), lease = h.r.children.demand(childRequest), id = childReads(h)[0].id
  h.emit(frame('thread_children', childPage(), id))
  expect(lease.getState().page?.children).toHaveLength(1)
  h.emit(frame('thread_children', { ...childEnd(), ...change }, id, envelope))
  expect(lease.getState()).toMatchObject({ type: 'failed', page: { children: [child(2)], complete: false } }); h.close()
})
it.each(['version', 'tuple', 'second-data', 'aggregate-bytes'])('child reply boundary rejects %s', async mode => {
  const h = await bodyRuntime(), lease = h.r.children.demand({ ...childRequest, limit: 256 }), id = childReads(h)[0].id
  if (mode === 'aggregate-bytes') {
    // Each summary stays valid; two envelopes together exceed the page budget.
    const rows = Array.from({ length: 128 }, (_, i) => ({ ...child(i + 2), headline: 'é'.repeat(30) }))
    const data = { ...childPage(), children: rows }
    const session_id = 's'.repeat(65000 - frame('thread_children', data, id).length)
    h.emit(frame('thread_children', data, id, { session_id }))
    expect(lease.getState().type).toBe('loading')
    h.emit(frame('thread_children', childEnd(), id, { session_id }))
  } else {
    h.emit(frame('thread_children', childPage(), id)); h.emit(frame('thread_children', childEnd(true), id))
    lease.continue(childCursor(2)); const next = childReads(h)[1].id
    h.emit(frame('thread_children', { ...childPage(), children: [child(mode === 'tuple' ? 2 : 3)], version: mode === 'version' ? 1 : 0 }, next))
    if (mode === 'second-data') h.emit(frame('thread_children', childPage([child(4)]), next))
  }
  expect(lease.getState().type).toBe('failed'); h.close()
})
it('child aggregate budget counts the original received JSON bytes before normalization', async () => {
  const h = await bodyRuntime(), lease = h.r.children.demand(childRequest), id = childReads(h)[0].id
  const padded = (bytes: Uint8Array) => Buffer.concat([Buffer.from(' '.repeat(40000 - bytes.length)), bytes])
  h.emit(padded(frame('thread_children', childPage(), id)))
  expect(lease.getState().page?.children).toHaveLength(1)
  h.emit(padded(frame('thread_children', childEnd(), id)))
  expect(lease.getState()).toMatchObject({ type: 'failed', page: { children: [child(2)], complete: false } })
  h.close()
})
it.each([undefined, 0, 999])('child limit normalizes %s and capability gates preserve complete reads', async limit => {
  const h = await bodyRuntime(), lease = h.r.children.demand({ ...childRequest, limit })
  expect(childReads(h)[0].payload).toMatchObject({ limit: limit === 999 ? 256 : 50 })
  lease.release(); h.close()
  const unsupported = await bodyRuntime(false), denied = unsupported.r.children.demand(childRequest)
  expect(denied.getState()).toMatchObject({ type: 'failed', reason: 'unsupported' })
  expect(childReads(unsupported)).toHaveLength(0)
  expect(unsupported.r.items.getState().snapshot('a', 'c')?.items).toHaveLength(1); unsupported.close()
})
it.each(['release', 'navigation', 'disconnect', 'reset', 'delete', 'unpair', 'dispose'])('child retirement fences reused identity after %s', async mode => {
  const h = await bodyRuntime(), lease = h.r.children.demand(childRequest), id = childReads(h)[0].id
  const mark = vi.fn(); h.r.children.demand(childRequest, mark)
  if (mode === 'release') { lease.release(); h.r.bodies.retire('a', 'c') }
  if (mode === 'navigation') await h.r.open('a', 'other').done
  if (mode === 'disconnect') h.configs[0].onEvent({ type: 'relay-link-down', code: 1006 })
  if (mode === 'reset') h.r.items.getState().acceptEpoch('a', 'c', 'replacement')
  if (mode === 'delete') h.emit(frame('conversation_deleted', { id: 'c' }, 0))
  if (mode === 'unpair') { const finish = beginChatHistoryRemoval('a'); finish(true) }
  if (mode === 'dispose') h.r.dispose()
  expect(lease.getState().type).toBe('missing')
  const count = mark.mock.calls.length
  h.emit(frame('thread_children', childPage(), id)); h.emit(frame('thread_children', childEnd(), id))
  expect(mark.mock.calls).toHaveLength(count); expect(childReads(h)).toHaveLength(1); h.close()
})
it('child pages traverse production frames and preload, preserve zero ties and continue only on demand', async () => {
  const h = await bodyRuntime(), before = h.r.items.getState().snapshot('a', 'c')
  const a = h.r.children.demand(childRequest), b = h.r.children.demand(childRequest)
  expect(childReads(h)).toHaveLength(1)
  const id = childReads(h)[0].id
  h.emit(frame('thread_children', { ...childRoute, children: [child(2), child(3)], final: false }, id))
  expect(a.getState()).toMatchObject({ type: 'loading', page: { children: [child(2), child(3)], complete: false } })
  h.emit(frame('thread_children', { ...childRoute, children: [], final: true, more: true, cursor: childCursor() }, id))
  expect(a.getState()).toMatchObject({ type: 'ready', page: { more: true, complete: false, cursor: childCursor() } })
  expect(childReads(h)).toHaveLength(1); expect(h.reads()).toHaveLength(0)
  a.release(); b.continue(childCursor()); b.continue(childCursor())
  expect(childReads(h)).toHaveLength(2)
  expect(childReads(h)[1].payload).toMatchObject({ cursor: childCursor(), limit: 2 })
  h.emit(frame('thread_children', { ...childRoute, children: [child(4)], final: false }, childReads(h)[1].id))
  h.emit(frame('thread_children', { ...childRoute, children: [], final: true, more: false }, childReads(h)[1].id))
  expect(b.getState()).toMatchObject({ type: 'ready', page: { children: [child(2), child(3), child(4)], complete: true } })
  b.continue(childCursor())
  expect(b.getState().type).toBe('ready'); expect(childReads(h)).toHaveLength(2)
  b.release(); expect(h.r.children.demand(childRequest).getState().type).toBe('ready')
  expect(childReads(h)).toHaveLength(2)
  expect(h.r.items.getState().snapshot('a', 'c')).toBe(before)
  expect(h.sent.map(decodeEnvelope).filter(e => e.type === 'mark_conversation_read')).toHaveLength(0)
  h.close()
})
function bodyParts(id: number, payload: unknown = bodyData, itemId = 1) {
  const json = JSON.stringify(payload), update_id = createHash('sha256').update('thread_tool_body').update('\0').update(json).digest('hex')
  let offset = 0
  return Array.from({ length: Math.ceil(json.length / 20000) }, (_, index) => {
    const data = json.slice(index * 20000, (index + 1) * 20000), start = offset
    offset += Buffer.byteLength(data)
    return frame('thread_tool_body', { conversation_id: 'c', epoch: 'e', version: 8, item_id: itemId, rev: 8, data,
      continuation: { update_id, index, offset: start, total_bytes: Buffer.byteLength(json), final: offset === Buffer.byteLength(json) } }, id)
  })
}
async function bodyRuntime(expansion = true, older = false) {
  const h = await connected('a', expansion)
  routePreloadQueries(host => host === 'a' ? h.connection : null)
  const r = createThreadRuntime({ send: api.sendCommand, read: async () => ({ status: 'missing' }), log: () => {} })
  const off = api.onDaemonEvent(r.event)
  for (const event of h.events) if (event.type === 'connected') r.event(event)
  await r.open('a', 'c').done
  const initial = decodeEnvelope(h.sent.at(-1)!).id
  h.emit(frame('thread_items', { ...batch, items: [{ ...item, kind: 'tool_call', content: { original: true } }] }, initial))
  h.emit(frame('thread_items', older ? { ...windowDone, lower_order: 5, continuation: 5, older_exists: true } : windowDone, initial))
  const reads = () => h.sent.map(decodeEnvelope).filter(e => e.type === 'thread_read_tool_body')
  return { ...h, r, reads, close() { r.dispose(); off(); h.connection.stop() } }
}
it.each(['tool_call', 'agent'])('runtime body %s traverses frames and preload, completes only at marker and reopens from cache', async kind => {
  const h = await bodyRuntime(), before = h.r.items.getState().snapshot('a', 'c')
  const a = h.r.bodies.demand({ ...bodyRequest, kind: kind as 'tool_call' | 'agent' }), b = h.r.bodies.demand({ ...bodyRequest, kind: kind as 'tool_call' | 'agent' })
  expect(h.reads()).toHaveLength(1); expect(h.reads()[0]).toMatchObject({ payload: bodyQuery.payload })
  const id = h.reads()[0].id
  a.release()
  const content = JSON.parse('{"input":"","output":"","__proto__":{"polluted":true},"future":[0,false,null]}')
  bodyParts(id, { ...bodyData, kind, content }).forEach(h.emit)
  expect(b.getState().type).toBe('loading')
  h.emit(frame('thread_tool_body', { ...bodyDone, kind }, id))
  expect(b.getState()).toEqual({ type: 'ready', content, stale: false })
  expect({}).not.toHaveProperty('polluted')
  expect(h.r.items.getState().snapshot('a', 'c')).toBe(before)
  b.release()
  const again = h.r.bodies.demand({ ...bodyRequest, kind: kind as 'tool_call' | 'agent' })
  expect(again.getState().type).toBe('ready'); expect(h.reads()).toHaveLength(1)
  h.close()
})
it('unsupported runtime and main independently refuse body demand without sending', async () => {
  const h = await bodyRuntime(false)
  expect(h.r.bodies.demand(bodyRequest).getState()).toMatchObject({ type: 'failed', reason: 'unsupported' })
  h.connection.queryThread(bodyQuery, 'direct')
  expect(h.reads()).toHaveLength(0)
  expect(h.replies().at(-1)).toMatchObject({ type: 'threadQueryFailed', requestId: 'direct', reason: 'unavailable' })
  expect(decodeEnvelope(h.configs[0].session.hello).payload).toMatchObject({ capabilities: expect.arrayContaining(['interactive', 'thread', 'thread_expansion']) })
  h.close()
})
it.each(['absent', 'null', 'array', 'marker-first', 'version', 'kind', 'revision', 'epoch', 'item', 'session', 'conversation', 'marker-content', 'marker-continuation', 'refused'])('malformed body %s fails content-free and requires explicit retry', async mode => {
  const h = await bodyRuntime(), lease = h.r.bodies.demand(bodyRequest), id = h.reads()[0].id
  if (mode === 'refused') h.emit(frame('error', { code: 'thread.query_failed', message: 'secret body', retryable: true }, id))
  else if (mode === 'marker-first') h.emit(frame('thread_tool_body', bodyDone, id))
  else if (mode === 'absent' || mode === 'null' || mode === 'array') {
    const p: any = { ...bodyData }; delete p.content
    if (mode !== 'absent') p.content = mode === 'null' ? null : []
    h.emit(frame('thread_tool_body', p, id))
  } else {
    h.emit(frame('thread_tool_body', bodyData, id))
    const p: any = { ...bodyDone }
    if (mode === 'version') p.version++
    if (mode === 'kind') p.kind = 'agent'
    if (mode === 'revision') p.rev++
    if (mode === 'epoch') p.epoch = 'other'
    if (mode === 'item') p.item_id++
    if (mode === 'conversation') p.conversation_id = 'other'
    if (mode === 'marker-content') p.content = {}
    if (mode === 'marker-continuation') p.continuation = null
    h.emit(frame('thread_tool_body', p, id, mode === 'session' ? { session_id: 'other' } : {}))
  }
  expect(lease.getState().type).toBe('failed')
  expect(JSON.stringify(lease.getState())).not.toContain('secret body')
  const duplicate = h.r.bodies.demand(bodyRequest)
  expect(h.reads()).toHaveLength(1)
  duplicate.retry(); expect(h.reads()).toHaveLength(2)
  const next = h.reads()[1].id
  h.emit(frame('thread_tool_body', bodyData, id)); h.emit(frame('thread_tool_body', bodyDone, id))
  expect(duplicate.getState().type).toBe('loading')
  h.emit(frame('thread_tool_body', bodyData, next)); h.emit(frame('thread_tool_body', bodyDone, next))
  expect(duplicate.getState()).toEqual({ type: 'ready', content: { input: '', output: '' }, stale: false })
  h.close()
})
it.each(['release', 'navigation', 'disconnect', 'reset', 'epoch', 'delete', 'unpair', 'dispose'])('late body fragments/data/marker cannot revive runtime after %s', async mode => {
  const h = await bodyRuntime(), lease = h.r.bodies.demand(bodyRequest), id = h.reads()[0].id
  vi.useFakeTimers()
  const parts = bodyParts(id, { ...bodyData, content: { output: 'é'.repeat(40000) } })
  h.emit(parts[0]); expect(vi.getTimerCount()).toBeGreaterThan(0)
  if (mode === 'release') lease.release()
  if (mode === 'navigation') await h.r.open('a', 'other').done
  if (mode === 'disconnect') h.configs[0].onEvent({ type: 'relay-link-down', code: 1006 })
  if (mode === 'reset') h.r.items.getState().acceptEpoch('a', 'c', 'e', true)
  if (mode === 'epoch') h.r.items.getState().acceptEpoch('a', 'c', 'replacement')
  if (mode === 'delete') h.r.event({ type: 'conversationDeleted', serverId: 'a', id: 'c' })
  if (mode === 'dispose') h.r.dispose()
  if (mode === 'unpair') beginChatHistoryRemoval('a')(true)
  expect(lease.getState().type).toBe('missing')
  const cancelled = electron.send.mock.calls.map(c => c[1]).filter(c => c.type === 'cancelThreadQuery')
  if (mode !== 'disconnect') expect(cancelled).toHaveLength(1)
  parts.slice(1).forEach(h.emit); h.emit(frame('thread_tool_body', bodyData, id)); h.emit(frame('thread_tool_body', bodyDone, id))
  expect(lease.getState().type).toBe('missing')
  h.close(); expect(vi.getTimerCount()).toBe(0)
})
it('navigation back to the same strings creates new demand ownership and never adopts a late old failure', async () => {
  const h = await bodyRuntime(), old = h.r.bodies.demand(bodyRequest), id = h.reads()[0].id
  await h.r.open('a', 'c').done
  const next = h.r.bodies.demand(bodyRequest), fresh = h.reads()[1].id
  expect(fresh).not.toBe(id)
  h.emit(frame('error', { code: 'thread.query_failed', message: 'peer content', retryable: true }, id))
  h.emit(frame('thread_tool_body', bodyData, id)); h.emit(frame('thread_tool_body', bodyDone, id))
  expect(old.getState().type).toBe('missing'); expect(next.getState().type).toBe('loading')
  h.emit(frame('thread_tool_body', bodyData, fresh)); h.emit(frame('thread_tool_body', bodyDone, fresh))
  expect(next.getState()).toMatchObject({ type: 'ready', stale: false }); h.close()
})
it('navigation cannot restart failed body work through a second existing lease in a retirement callback', async () => {
  const h = await bodyRuntime()
  const first = h.r.bodies.demand(bodyRequest, state => {
    if (state.type === 'missing') second.retry()
  })
  const second = h.r.bodies.demand(bodyRequest), id = h.reads()[0].id
  h.emit(frame('error', { code: 'thread.query_failed', message: 'peer content', retryable: true }, id))
  expect(second.getState().type).toBe('failed')
  await h.r.open('a', 'other').done
  expect(h.reads()).toHaveLength(1)
  expect(first.getState().type).toBe('missing'); expect(second.getState().type).toBe('missing')
  await h.r.open('a', 'c').done
  const reopened = h.r.bodies.demand(bodyRequest)
  bodyParts(id).forEach(h.emit)
  h.emit(frame('thread_tool_body', bodyData, id)); h.emit(frame('thread_tool_body', bodyDone, id))
  expect(reopened.getState()).toMatchObject({ type: 'failed', reason: 'daemon-error' })
  expect(h.reads()).toHaveLength(1)
  reopened.retry()
  const fresh = h.reads()[1].id
  expect(fresh).not.toBe(id)
  h.emit(frame('thread_tool_body', bodyData, fresh)); h.emit(frame('thread_tool_body', bodyDone, fresh))
  expect(reopened.getState()).toMatchObject({ type: 'ready', stale: false }); h.close()
})
it('two hosts with colliding identities keep frame results isolated through the real bridge and runtime', async () => {
  const a = await bodyRuntime(), b = await connected('b', true)
  routePreloadQueries(host => host === 'a' ? a.connection : host === 'b' ? b.connection : null)
  const first = a.r.bodies.demand(bodyRequest), id = a.reads()[0].id
  a.emit(frame('thread_tool_body', bodyData, id)); a.emit(frame('thread_tool_body', bodyDone, id))
  await a.r.open('b', 'c').done
  const opening = decodeEnvelope(b.sent.at(-1)!).id
  b.emit(frame('thread_items', batch, opening)); b.emit(frame('thread_items', windowDone, opening))
  const second = a.r.bodies.demand({ ...bodyRequest, serverId: 'b' }), next = decodeEnvelope(b.sent.at(-1)!).id
  b.emit(frame('thread_tool_body', { ...bodyData, content: { host: 'b' } }, next)); b.emit(frame('thread_tool_body', bodyDone, next))
  expect(first.getState().type).toBe('missing')
  expect(second.getState()).toMatchObject({ type: 'ready', content: { host: 'b' } })
  await a.r.open('a', 'c').done
  const again = a.r.bodies.demand(bodyRequest)
  expect(again.getState()).toMatchObject({ type: 'ready', content: bodyData.content })
  expect(a.reads()).toHaveLength(1); a.close(); b.connection.stop()
})
it('byte eviction through frames and preload retains failed admission until retry', async () => {
  const h = await bodyRuntime(), content = { output: 'x'.repeat(6 * 1024 * 1024) }
  const complete = (id: number, itemId: number) => {
    bodyParts(id, { ...bodyData, item_id: itemId, content }, itemId).forEach(h.emit)
    h.emit(frame('thread_tool_body', { ...bodyDone, item_id: itemId }, id))
  }
  const first = h.r.bodies.demand(bodyRequest), original = h.reads()[0].id
  complete(original, 1); expect(first.getState().type).toBe('ready'); first.release()
  h.configs[0].onEvent({ type: 'relay-link-down', code: 1006 })
  h.configs[0].onEvent({ type: 'handshake-complete', helloAck: h.ack })
  const validation = h.r.bodies.demand(bodyRequest), failed = h.reads()[1].id
  h.emit(frame('error', { code: 'thread.query_failed', message: 'private', retryable: true }, failed))
  expect(validation.getState()).toMatchObject({ type: 'failed', content })
  for (const itemId of [2, 3]) {
    const other = h.r.bodies.demand({ ...bodyRequest, itemId })
    complete(h.reads().at(-1)!.id, itemId); expect(other.getState().type).toBe('ready'); other.release()
  }
  expect(validation.getState()).toEqual({ type: 'failed', reason: 'daemon-error', stale: true })
  const reopened = h.r.bodies.demand(bodyRequest)
  expect(h.reads()).toHaveLength(4)
  reopened.retry(); expect(h.reads()).toHaveLength(5)
  const fresh = h.reads()[4].id
  expect(fresh).not.toBe(failed)
  bodyParts(failed).forEach(h.emit)
  h.emit(frame('thread_tool_body', bodyDone, original))
  h.emit(frame('error', { code: 'thread.query_failed', message: 'late', retryable: true }, failed))
  expect(reopened.getState().type).toBe('loading')
  h.emit(frame('thread_tool_body', bodyData, fresh)); h.emit(frame('thread_tool_body', bodyDone, fresh))
  expect(reopened.getState()).toEqual({ type: 'ready', content: bodyData.content, stale: false }); h.close()
})
it('record pressure through frames and preload cannot retry a released failure', async () => {
  const h = await bodyRuntime(), first = h.r.bodies.demand(bodyRequest), failed = h.reads()[0].id
  h.emit(frame('error', { code: 'thread.query_failed', message: 'private', retryable: true }, failed))
  first.release()
  for (let itemId = 2; itemId <= 65; itemId++) {
    const other = h.r.bodies.demand({ ...bodyRequest, itemId }), id = h.reads().at(-1)!.id
    h.emit(frame('thread_tool_body', { ...bodyData, item_id: itemId }, id))
    h.emit(frame('thread_tool_body', { ...bodyDone, item_id: itemId }, id))
    expect(other.getState().type).toBe('ready'); other.release()
  }
  const reopened = h.r.bodies.demand(bodyRequest)
  expect(reopened.getState()).toEqual({ type: 'failed', reason: 'daemon-error', stale: true })
  expect(h.reads()).toHaveLength(65)
  reopened.retry(); expect(h.reads()).toHaveLength(66)
  const fresh = h.reads()[65].id
  expect(fresh).not.toBe(failed)
  h.emit(frame('thread_tool_body', bodyData, failed)); h.emit(frame('thread_tool_body', bodyDone, failed))
  expect(reopened.getState().type).toBe('loading')
  h.emit(frame('thread_tool_body', bodyData, fresh)); h.emit(frame('thread_tool_body', bodyDone, fresh))
  expect(reopened.getState()).toMatchObject({ type: 'ready', stale: false }); h.close()
})
it.each(['reset', 'epoch', 'delete', 'unpair'])('failed admission clears on runtime lifecycle %s even when identifiers are reused', async mode => {
  const h = await bodyRuntime(), old = h.r.bodies.demand(bodyRequest), failed = h.reads()[0].id
  h.emit(frame('error', { code: 'thread.query_failed', message: 'private', retryable: true }, failed))
  expect(old.getState().type).toBe('failed')
  if (mode === 'reset') h.r.items.getState().acceptEpoch('a', 'c', 'e', true)
  if (mode === 'epoch') {
    h.r.items.getState().acceptEpoch('a', 'c', 'replacement')
    h.r.items.getState().acceptEpoch('a', 'c', 'e')
  }
  if (mode === 'delete') h.r.event({ type: 'conversationDeleted', serverId: 'a', id: 'c' })
  if (mode === 'unpair') beginChatHistoryRemoval('a')(true)
  await h.r.open('a', 'c').done
  h.r.items.getState().acceptEpoch('a', 'c', 'e')
  const next = h.r.bodies.demand(bodyRequest)
  expect(h.reads()).toHaveLength(2)
  const fresh = h.reads()[1].id
  h.emit(frame('thread_tool_body', bodyData, failed)); h.emit(frame('thread_tool_body', bodyDone, failed))
  expect(old.getState().type).toBe('missing'); expect(next.getState().type).toBe('loading')
  h.emit(frame('thread_tool_body', bodyData, fresh)); h.emit(frame('thread_tool_body', bodyDone, fresh))
  expect(next.getState()).toMatchObject({ type: 'ready', stale: false }); h.close()
})
it.each([['thread'], ['thread', 'thread_expansion'], ['thread', 'interactive']].map(capabilities => ({ capabilities })))('current handshake prerequisites $capabilities independently gate main and runtime', async ({ capabilities }) => {
  const h = await bodyRuntime()
  const ack = encodeEnvelope({ id: 1, type: 'hello_ack', ts: 'stamp', payload: { protocol_version: 'v2', server_id: 'a', conn_id: 'conn', capabilities } })
  h.configs[0].onEvent({ type: 'handshake-complete', helloAck: ack })
  expect(h.r.bodies.demand(bodyRequest).getState()).toMatchObject({ type: 'failed', reason: 'unsupported' })
  h.connection.queryThread(bodyQuery, 'direct')
  expect(h.reads()).toHaveLength(0); h.close()
})
it('main caps body correlations at 32, cancels partial assemblies and expires marker waits after 30 seconds', async () => {
  const h = await connected('a', true)
  vi.useFakeTimers()
  const ids = Array.from({ length: 32 }, (_, i) => h.ask(bodyQuery, String(i)))
  h.connection.queryThread(bodyQuery, 'overflow')
  expect(h.sent).toHaveLength(32)
  expect(h.replies().at(-1)).toMatchObject({ type: 'threadQueryFailed', requestId: 'overflow', reason: 'limit' })
  const p = bodyParts(ids[0], { ...bodyData, content: { output: 'x'.repeat(30000) } })
  h.emit(p[0]); expect(vi.getTimerCount()).toBe(33)
  h.connection.cancelThreadQuery?.('0'); expect(vi.getTimerCount()).toBe(31)
  h.connection.queryThread(bodyQuery, 'replacement'); expect(h.sent).toHaveLength(33)
  const next = decodeEnvelope(h.sent.at(-1)!).id
  h.emit(frame('thread_tool_body', bodyData, next))
  vi.advanceTimersByTime(29999)
  expect(h.replies().filter(e => e.type === 'threadQueryFailed')).toHaveLength(2)
  vi.advanceTimersByTime(1)
  expect(h.replies().filter(e => e.type === 'threadQueryFailed')).toHaveLength(34)
  h.emit(p[1]); h.emit(frame('thread_tool_body', bodyDone, next))
  expect(h.replies().filter(e => e.type === 'threadReply')).toHaveLength(1)
  h.connection.stop(); expect(vi.getTimerCount()).toBe(0)
})
it.each(['base-rev', 'digest', 'index', 'offset', 'session', 'route', 'identity', 'logical-limit', 'assembly-limit'])('body assembly refuses %s without accepting a later marker', async mode => {
  const h = await connected('a', true), id = h.ask(bodyQuery), parts = bodyParts(id, { ...bodyData, content: { output: 'x'.repeat(40000) } })
  vi.useFakeTimers()
  if (mode === 'assembly-limit') {
    for (let i = 0; i < 8; i++) {
      const sibling = h.ask(bodyQuery, `sibling-${i}`)
      h.emit(bodyParts(sibling, { ...bodyData, content: { output: 'x'.repeat(40000) } })[0])
    }
  }
  const p: any = decodeEnvelope(parts[0])
  if (mode === 'base-rev') p.payload.base_rev = 0
  if (mode === 'logical-limit') p.payload.continuation.total_bytes = 8 * 1024 * 1024 + 1
  h.emit(encodeEnvelope(p))
  if (!['base-rev', 'logical-limit', 'assembly-limit'].includes(mode)) {
    const next: any = decodeEnvelope(parts[1])
    if (mode === 'digest') next.payload.data = next.payload.data.replace('x', 'y')
    if (mode === 'index') next.payload.continuation.index++
    if (mode === 'offset') next.payload.continuation.offset++
    if (mode === 'session') next.session_id = 'other'
    if (mode === 'route') next.conversation_id = 'other'
    if (mode === 'identity') next.payload.item_id++
    h.emit(encodeEnvelope(next)); parts.slice(2).forEach(h.emit)
  }
  h.emit(frame('thread_tool_body', bodyDone, id))
  expect(h.replies().some(e => e.type === 'threadQueryFailed' && e.requestId === 'request')).toBe(true)
  expect(h.replies().some(e => e.type === 'threadReply' && e.requestId === 'request')).toBe(false)
  h.connection.stop(); expect(vi.getTimerCount()).toBe(0)
})
it('reconnect leaves retained bodies stale until explicit fresh demand, and offline missing sends nothing', async () => {
  const h = await bodyRuntime(), lease = h.r.bodies.demand(bodyRequest), id = h.reads()[0].id
  h.emit(frame('thread_tool_body', bodyData, id)); h.emit(frame('thread_tool_body', bodyDone, id))
  h.configs[0].onEvent({ type: 'relay-link-down', code: 1006 })
  const offline = h.r.bodies.demand(bodyRequest), missing = h.r.bodies.demand({ ...bodyRequest, itemId: 2 })
  expect(offline.getState()).toMatchObject({ type: 'ready', stale: true }); expect(missing.getState()).toMatchObject({ type: 'missing', reason: 'offline' })
  expect(h.reads()).toHaveLength(1)
  h.configs[0].onEvent({ type: 'handshake-complete', helloAck: h.ack })
  expect(h.reads()).toHaveLength(1)
  const fresh = h.r.bodies.demand(bodyRequest)
  expect(fresh.getState()).toMatchObject({ type: 'loading', stale: true, content: bodyData.content })
  const next = h.reads()[1].id
  h.emit(frame('thread_tool_body', bodyData, id)); h.emit(frame('thread_tool_body', bodyDone, id))
  expect(fresh.getState().type).toBe('loading')
  h.emit(frame('thread_tool_body', bodyData, next)); h.emit(frame('thread_tool_body', bodyDone, next))
  expect(fresh.getState()).toMatchObject({ type: 'ready', stale: false }); h.close()
})
