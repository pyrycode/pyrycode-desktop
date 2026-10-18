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
function bodyParts(id: number, payload: unknown = bodyData) {
  const json = JSON.stringify(payload), update_id = createHash('sha256').update('thread_tool_body').update('\0').update(json).digest('hex')
  let offset = 0
  return Array.from({ length: Math.ceil(json.length / 20000) }, (_, index) => {
    const data = json.slice(index * 20000, (index + 1) * 20000), start = offset
    offset += Buffer.byteLength(data)
    return frame('thread_tool_body', { conversation_id: 'c', epoch: 'e', version: 8, item_id: 1, rev: 8, data,
      continuation: { update_id, index, offset: start, total_bytes: Buffer.byteLength(json), final: offset === Buffer.byteLength(json) } }, id)
  })
}
async function bodyRuntime(expansion = true) {
  const h = await connected('a', expansion)
  routePreloadQueries(host => host === 'a' ? h.connection : null)
  const r = createThreadRuntime({ send: api.sendCommand, read: async () => ({ status: 'missing' }), log: () => {} })
  const off = api.onDaemonEvent(r.event)
  for (const event of h.events) if (event.type === 'connected') r.event(event)
  await r.open('a', 'c').done
  const initial = decodeEnvelope(h.sent.at(-1)!).id
  h.emit(frame('thread_items', { ...batch, items: [{ ...item, kind: 'tool_call', content: { original: true } }] }, initial))
  h.emit(frame('thread_items', windowDone, initial))
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
