import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { dispatchThreadQuery } from './threadQueryCommand'
import { createServerRouter } from './serverRouter'
import { createConnectionRegistry } from './connectionRegistry'
import type { ThreadQuery } from '../shared/wire/thread'
import { createDaemonConnection } from './daemonConnection'
import { encodeEnvelope, decodeEnvelope, base64StdEncode } from './transport/codec'
import { isRendererCommand } from '../shared/ipc/commands'
import { DAEMON_EVENT_CHANNEL, type StampedDaemonEvent } from '../shared/ipc/events'
import type { NoiseRelayDriverConfig } from './transport/noiseRelayDriver'
import type { PyryApi } from '../preload'
const electron = vi.hoisted(() => ({ expose: vi.fn(), listeners: new Set<Function>(), send: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: electron.expose }, webUtils: {}, ipcRenderer: {
  send: electron.send, on: (_: string, listener: Function) => electron.listeners.add(listener),
  removeListener: (_: string, listener: Function) => electron.listeners.delete(listener)
} }))
import '../preload'
const api: PyryApi = electron.expose.mock.calls[0][1]
const query = { type: 'thread_catch_up' as const, payload: { conversation_id: 'c', epoch: 'e', version: 3 } }
const page = { type: 'thread_page' as const, payload: { conversation_id: 'c', before_order: 10 } }
const item = { id: 1, rev: 8, kind: 'future', status: 'future', active: false, shown: false,
  summary: '', content: JSON.parse('{"__proto__":{"polluted":true},"unknown":[false,0,null]}') }
const batch = { conversation_id: 'c', epoch: 'e', version: 8, items: [item], final: false }
const done = { ...batch, items: [], final: true, from_version: 3 }
const windowDone = { ...batch, items: [], final: true, lower_order: 0, upper_order: 10, continuation: 0, older_exists: false }
const frame = (type: string, payload: unknown, in_reply_to: number, extra = {}) =>
  encodeEnvelope({ id: 99, type, ts: 'stamp', payload, in_reply_to, session_id: 's', ...extra })
function fragments(id: number, payload = { ...batch, items: [{ ...item, summary: 'é'.repeat(50000) }] }) {
  const json = JSON.stringify(payload), update_id = createHash('sha256').update('thread_items').update('\0').update(json).digest('hex')
  let offset = 0
  return Array.from({ length: Math.ceil(json.length / 20000) }, (_, index) => {
    const data = json.slice(index * 20000, (index + 1) * 20000), start = offset
    offset += Buffer.byteLength(data)
    return frame('thread_items', { conversation_id: 'c', epoch: 'e', version: 8, item_id: 1, rev: 8, data,
      continuation: { update_id, index, offset: start, total_bytes: Buffer.byteLength(json), final: offset === Buffer.byteLength(json) } }, id)
  })
}
async function connected(serverId = 'a') {
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
  const ack = encodeEnvelope({ id: 1, type: 'hello_ack', ts: 'stamp', payload: { protocol_version: 'v2', server_id: serverId, conn_id: 'conn', capabilities: [] } })
  configs[0].onEvent({ type: 'handshake-complete', helloAck: ack })
  const emit = (bytes: Uint8Array) => configs.at(-1)!.onEvent({ type: 'message', plaintext: bytes })
  const ask = (q: ThreadQuery = query, requestId = 'request') => { connection.queryThread(q, requestId); return decodeEnvelope(sent.at(-1)!).id }
  const replies = () => events.filter(e => e.type === 'threadReply' || e.type === 'threadQueryFailed')
  return { connection, configs, events, sent, ack, emit, ask, replies, observations, failSend: (throwing = false) => { drop = true; throws = throwing } }
}
function routePreloadQueries(route: Parameters<typeof dispatchThreadQuery>[1]) {
  electron.send.mockImplementation((_channel, command) => {
    const cloned = structuredClone(command)
    if (isRendererCommand(cloned) && cloned.type === 'queryThread') dispatchThreadQuery(cloned, route, {
      isDestroyed: () => false, webContents: { send: (_channel, e) => electron.listeners.forEach(listener => listener({}, structuredClone(e))) }
    })
  })
}
afterEach(() => { electron.listeners.clear(); electron.send.mockReset(); vi.useRealTimers() })
it.each([undefined, 0])('initial empty-epoch catch-up reaches authenticated transport with limit %s', async limit => {
  const h = await connected()
  routePreloadQueries(id => id === 'a' ? h.connection : null)
  const q: ThreadQuery = { type: 'thread_catch_up', payload: { conversation_id: 'c', epoch: '', version: 0,
    ...(limit === undefined ? {} : { limit }) } }
  const command = { type: 'queryThread' as const, serverId: 'a', requestId: 'initial', query: q }
  expect(isRendererCommand(command)).toBe(true)
  expect(() => api.sendCommand(command)).not.toThrow()
  expect(h.sent).toHaveLength(1)
  const envelope = decodeEnvelope(h.sent[0])
  expect(envelope).toMatchObject({ type: 'thread_catch_up', payload: q.payload })
  expect(Object.hasOwn(envelope.payload as object, 'limit')).toBe(limit !== undefined)
  const received: StampedDaemonEvent[] = [], off = api.onDaemonEvent(e => received.push(e))
  h.emit(frame('thread_items', windowDone, envelope.id))
  expect(received).toMatchObject([{ type: 'threadReply', serverId: 'a', requestId: 'initial', reply: { payload: windowDone } }])
  off(); h.connection.stop()
})
it('catch-up epoch admission retains string type and length bounds', () => {
  const command = { type: 'queryThread', serverId: 'a', requestId: 'initial', query }
  for (const epoch of [null, undefined, 0, {}, 'e'.repeat(1025)]) {
    expect(isRendererCommand({ ...command, query: { ...query, payload: { ...query.payload, epoch } } })).toBe(false)
  }
  expect(isRendererCommand({ ...command, query: { ...query, payload: { ...query.payload, epoch: 'e'.repeat(1024) } } })).toBe(true)
})
it.each(['single-part', 'partial-assembly', 'invalid-utf8', 'invalid-json', 'oversized', 'invalid-session'])('parser rejection interrupts pending queries before success through preload: %s', async mode => {
  const a = await connected('a'), b = await connected('b'), received: StampedDaemonEvent[] = []
  const off = api.onDaemonEvent(e => received.push(e))
  routePreloadQueries(id => id === 'a' ? a.connection : id === 'b' ? b.connection : null)
  for (const [serverId, requestId] of [['a', 'broken'], ['a', 'same-host'], ['b', 'other-host']]) {
    api.sendCommand({ type: 'queryThread', serverId, requestId, query })
  }
  const id = decodeEnvelope(a.sent[0]).id, sibling = decodeEnvelope(a.sent[1]).id, other = decodeEnvelope(b.sent[0]).id
  vi.useFakeTimers()
  if (mode === 'partial-assembly') a.emit(fragments(id)[0])
  expect(vi.getTimerCount()).toBe(mode === 'partial-assembly' ? 1 : 0)
  // Even a rejected first, single-part assembly must fence its later success marker.
  const rejected: any = decodeEnvelope(fragments(id, batch)[0])
  rejected.ts = 123
  let bytes = encodeEnvelope(rejected)
  if (mode === 'invalid-utf8') bytes = Uint8Array.of(255)
  if (mode === 'invalid-json') bytes = new TextEncoder().encode('{broken')
  if (mode === 'oversized') bytes = new Uint8Array(65520)
  if (mode === 'invalid-session') bytes = frame('thread_items', batch, id, { session_id: 123 })
  a.emit(bytes)
  expect(received).toMatchObject([
    { type: 'threadQueryFailed', serverId: 'a', conversationId: 'c', requestId: 'broken', inReplyTo: id, reason: 'interrupted' },
    { type: 'threadQueryFailed', serverId: 'a', conversationId: 'c', requestId: 'same-host', inReplyTo: sibling, reason: 'interrupted' }
  ])
  expect(received).toHaveLength(2); expect(vi.getTimerCount()).toBe(0)
  fragments(id).forEach(f => a.emit(f)); a.emit(frame('thread_items', done, id)); a.emit(frame('thread_items', done, sibling))
  expect(received).toHaveLength(2)
  // Other hosts and freshly registered requests remain usable after conservative interruption.
  b.emit(frame('thread_items', done, other)); const next = a.ask(query, 'next')
  a.emit(frame('thread_items', done, id)); a.emit(frame('thread_items', done, next))
  expect(received.slice(2)).toMatchObject([
    { type: 'threadReply', serverId: 'b', requestId: 'other-host' }, { type: 'threadReply', serverId: 'a', requestId: 'next' }
  ])
  expect(received).toHaveLength(4)
  off(); a.connection.stop(); b.connection.stop(); expect(vi.getTimerCount()).toBe(0)
})
it('admits both typed preload requests and preserves omitted, zero and positive limits', async () => {
  const h = await connected()
  for (const q of [query, page]) for (const limit of [undefined, 0, 1, 300]) {
    const command: any = { type: 'queryThread', serverId: 'a', requestId: 'request', query: { ...q, payload: { ...q.payload, ...(limit === undefined ? {} : { limit }) } } }
    expect(isRendererCommand(command)).toBe(true); api.sendCommand(command)
    expect(electron.send.mock.calls.at(-1)?.[1]).toEqual(command)
    h.connection.queryThread(command.query, command.requestId)
    expect(decodeEnvelope(h.sent.at(-1)!)).toMatchObject({ type: q.type, payload: command.query.payload })
    expect(Object.hasOwn(decodeEnvelope(h.sent.at(-1)!).payload as object, 'limit')).toBe(limit !== undefined)
    for (const bad of [-1, .5, Number.MAX_SAFE_INTEGER + 1, null, '0']) {
      expect(isRendererCommand({ ...command, query: { ...q, payload: { ...q.payload, limit: bad } } })).toBe(false)
    }
  }
  for (const [q, field] of [[query, 'version'], [page, 'before_order']] as const) {
    for (const bad of [-1, .5, Number.MAX_SAFE_INTEGER + 1]) expect(isRendererCommand({ type: 'queryThread', serverId: 'a', requestId: 'r', query: { ...q, payload: { ...q.payload, [field]: bad } } })).toBe(false)
  }
  h.connection.stop()
})
it('empty and multibatch completion reaches preload exactly once and preserves out-of-range extras', async () => {
  const received: StampedDaemonEvent[] = [], off = api.onDaemonEvent(e => received.push(e)), h = await connected()
  const id = h.ask(); h.emit(frame('thread_items', done, id)); h.emit(frame('thread_items', done, id))
  expect(h.replies()).toHaveLength(1)
  const p = h.ask(page, 'page')
  const extras = { ...batch, items: [{ ...item, active: true, parent: 999 }, { ...item, id: 999, order: 1000 }] }
  h.emit(frame('thread_items', extras, p)); h.emit(frame('thread_items', batch, p)); h.emit(frame('thread_items', windowDone, p))
  expect(received.filter(e => e.type === 'threadReply')).toHaveLength(4)
  expect(h.replies().at(-1)).toMatchObject({ type: 'threadReply', serverId: 'a', requestId: 'page', reply: { type: 'thread_items', payload: windowDone }, correlation: { in_reply_to: p, session_id: 's' } })
  expect(h.replies()[1]).toMatchObject({ reply: { payload: extras } }); expect({}).not.toHaveProperty('polluted')
  off(); h.connection.stop()
})
it('oversized full-item assembly completes a batch but requires a separate success marker', async () => {
  const h = await connected(), id = h.ask(), f = fragments(id)
  f.slice(0, -1).forEach(x => h.emit(x)); expect(h.replies()).toEqual([])
  h.emit(f.at(-1)!); expect(h.replies()).toHaveLength(1)
  expect(h.replies()[0]).toMatchObject({ reply: { payload: { final: false, items: [{ summary: 'é'.repeat(50000) }] } } })
  h.emit(frame('thread_items', done, id)); expect(h.replies()).toHaveLength(2); h.connection.stop()
})
it.each(['missing', 'mixed', 'wrong-checkpoint', 'nonempty-final', 'missing-final', 'batch-coverage', 'epoch', 'version', 'range', 'continuation', 'older', 'reset-coverage'])('rejects coverage and captured metadata changes: %s', async mode => {
  const h = await connected(), id = h.ask(mode === 'range' || mode === 'continuation' || mode === 'older' ? page : query)
  h.emit(frame('thread_items', batch, id))
  const p: any = { ...(mode === 'range' || mode === 'continuation' || mode === 'older' ? windowDone : done) }
  if (mode === 'missing') delete p.from_version
  if (mode === 'mixed') p.lower_order = 0
  if (mode === 'wrong-checkpoint') p.from_version = 2
  if (mode === 'nonempty-final') p.items = [item]
  if (mode === 'missing-final') delete p.final
  if (mode === 'batch-coverage') p.final = false
  if (mode === 'epoch') p.epoch = 'other'
  if (mode === 'version') p.version = 9
  if (mode === 'range') p.lower_order = 11
  if (mode === 'continuation') p.continuation = 1
  if (mode === 'older') delete p.older_exists
  h.emit(frame(mode === 'reset-coverage' ? 'thread_reset' : 'thread_items', p, id))
  h.emit(frame('thread_items', done, id))
  expect(h.replies().map(e => e.type)).toEqual(['threadReply', 'threadQueryFailed']); h.connection.stop()
})
it.each(['index', 'offset', 'session', 'request', 'routing', 'rev', 'digest', 'identity', 'expiry', 'interrupted'])('invalid assembly cannot certify success: %s', async mode => {
  const h = await connected(), id = h.ask(), f = fragments(id)
  vi.useFakeTimers(); h.emit(f[0])
  const changed: any = decodeEnvelope(f[1]), p = changed.payload
  if (mode === 'index') p.continuation.index++
  if (mode === 'offset') p.continuation.offset++
  if (mode === 'session') changed.session_id = 'other'
  if (mode === 'request') changed.in_reply_to = id + 100
  if (mode === 'routing') p.epoch = 'other'
  if (mode === 'rev') p.rev++
  if (mode === 'digest') p.data = p.data.replace('é', 'x')
  if (mode === 'identity') p.item_id = 2
  if (mode === 'expiry') vi.advanceTimersByTime(30000)
  else if (mode !== 'interrupted') { h.emit(encodeEnvelope(changed)); f.slice(2).forEach(x => h.emit(x)) }
  h.emit(frame('thread_items', done, id))
  expect(h.replies().some(e => e.type === 'threadReply' && e.reply.type === 'thread_items' && e.reply.payload.final)).toBe(false)
  expect(h.replies().filter(e => e.type === 'threadQueryFailed')).toHaveLength(1)
  h.connection.stop(); expect(vi.getTimerCount()).toBe(0)
})
it('host isolation through preload and interleaved requests with equal item identities', async () => {
  const a = await connected('a'), b = await connected('b'), x = a.ask(query, 'x'), y = a.ask(query, 'y'), z = b.ask(query, 'z')
  const fx = fragments(x), fy = fragments(y), fz = fragments(z)
  fx.forEach((f, i) => { a.emit(f); a.emit(fy[i]); b.emit(fz[i]) })
  for (const [h, id] of [[a, x], [a, y], [b, z]] as const) h.emit(frame('thread_items', done, id))
  expect(a.replies().filter(e => e.type === 'threadReply')).toHaveLength(4)
  expect(b.replies().filter(e => e.type === 'threadReply')).toHaveLength(2)
  a.connection.stop(); b.connection.stop()
})
it.each(['reset', 'error', 'drop', 'throw', 'unavailable'])('terminal and send failure settle once: %s', async mode => {
  const h = await connected()
  if (mode === 'drop' || mode === 'throw') h.failSend(mode === 'throw')
  if (mode === 'unavailable') h.connection.stop()
  const id = mode === 'throw' || mode === 'unavailable' ? (h.connection.queryThread(query, 'request'), 2) : h.ask()
  if (mode === 'reset') h.emit(frame('thread_reset', { conversation_id: 'c', epoch: 'current', version: 9 }, id))
  if (mode === 'error') h.emit(frame('error', { code: 'unknown.code', message: 'never leak this', retryable: false }, id))
  h.emit(frame('thread_items', done, id)); expect(h.replies()).toHaveLength(1)
  expect(JSON.stringify(h.replies())).not.toContain('never leak this')
  expect(h.replies()[0]).toMatchObject(mode === 'reset' ? { type: 'threadReply', reply: { type: 'thread_reset', payload: { epoch: 'current', version: 9 } } } : { type: 'threadQueryFailed', requestId: 'request' })
  h.connection.stop()
})
it.each(['relay-drop', 'handshake', 'terminal', 'driver-error', 'reconnect', 'stop'])('lifecycle fences late replies and releases timers: %s', async mode => {
  const h = await connected(), id = h.ask(), old = h.configs[0]
  vi.useFakeTimers(); h.emit(fragments(id)[0])
  if (mode === 'relay-drop') old.onEvent({ type: 'relay-link-down', code: 1006 })
  if (mode === 'handshake') old.onEvent({ type: 'handshake-complete', helloAck: h.ack })
  if (mode === 'terminal') old.onEvent({ type: 'terminal', code: 4401, reason: '' })
  if (mode === 'driver-error') old.onEvent({ type: 'error', reason: 'handshake-read-failed' })
  if (mode === 'reconnect') { h.connection.reconnect(); await vi.waitFor(() => expect(h.configs).toHaveLength(2)) }
  if (mode === 'stop') h.connection.stop()
  expect(h.replies().filter(e => e.type === 'threadQueryFailed')).toHaveLength(1); expect(vi.getTimerCount()).toBe(0)
  if (mode !== 'stop') {
    h.configs.at(-1)!.onEvent({ type: 'handshake-complete', helloAck: h.ack }); const next = h.ask(query, 'next')
    expect(next).not.toBe(id); h.emit(frame('thread_items', done, id)); h.emit(frame('thread_items', done, next))
    expect(h.replies().at(-1)).toMatchObject({ type: 'threadReply', requestId: 'next' })
  }
  h.connection.stop()
})
it('the production command handler carries cloned preload commands through registry views to exactly one host', async () => {
  const a = await connected('a'), b = await connected('b'), received: StampedDaemonEvent[] = []
  const rows = ['a', 'b'].map(server => ({ server, relay: 'wss://relay.example/v1/client', token: 'fake', server_static_pubkey: base64StdEncode(new Uint8Array(32)) }))
  const registry = createConnectionRegistry({ store: { save: async () => {}, load: async () => null,
    loadById: async id => rows.find(row => row.server === id) ?? null, list: async () => rows },
    createConnection: spec => spec.serverId === 'b' ? b.connection : a.connection })
  await vi.waitFor(() => expect(registry.connectionFor('b')).not.toBeNull())
  const servers = createServerRouter({ connectionFor: id => registry.connectionFor(id), soleConnection: () => registry.soleConnection() })
  const off = api.onDaemonEvent(e => received.push(e))
  routePreloadQueries(id => servers.route(id))
  for (const serverId of ['a', 'b', 'missing']) api.sendCommand({ type: 'queryThread', serverId, requestId: serverId, query: page })
  expect(a.sent).toHaveLength(1); expect(b.sent).toHaveLength(1)
  for (const h of [a, b]) h.emit(frame('thread_items', windowDone, decodeEnvelope(h.sent[0]).id))
  expect(received.filter(e => e.type === 'threadReply').map(e => e.serverId)).toEqual(['a', 'b'])
  expect(received.find(e => e.type === 'threadQueryFailed')).toMatchObject({ serverId: 'missing', requestId: 'missing', reason: 'unavailable' })
  off(); registry.stop(); electron.send.mockReset()
})
it('newest-window catch-up accepts zero/false authoritative coverage without inferring it from rows', async () => {
  const h = await connected(), id = h.ask({ type: 'thread_catch_up', payload: { ...query.payload, epoch: 'old', version: 0 } })
  h.emit(frame('thread_items', windowDone, id)); expect(h.replies()[0]).toMatchObject({ type: 'threadReply', reply: { payload: windowDone } })
  h.connection.stop()
})
it('rejects every missing page coverage field, invalid history number and mixed batch certificate', async () => {
  const h = await connected()
  const invalid: any[] = []
  for (const key of ['lower_order', 'upper_order', 'continuation', 'older_exists']) {
    const p: any = { ...windowDone }; delete p[key]; invalid.push(p)
  }
  for (const key of ['lower_order', 'upper_order', 'continuation', 'version']) for (const bad of [-1, .5, Number.MAX_SAFE_INTEGER + 1, null, '0']) invalid.push({ ...windowDone, [key]: bad })
  invalid.push({ ...windowDone, older_exists: true }, { ...windowDone, lower_order: 10, continuation: 10 }, { ...windowDone, from_version: 3 })
  for (const p of invalid) {
    const id = h.ask(page); h.emit(frame('thread_items', p, id)); h.emit(frame('thread_items', windowDone, id))
    expect(h.replies().at(-1)?.type).toBe('threadQueryFailed')
  }
  expect(h.replies()).toHaveLength(invalid.length); h.connection.stop()
})
it('validates reconstructed single item identity and revision, JSON and exact final length/digest', async () => {
  const h = await connected()
  for (const mode of ['id', 'rev', 'json', 'length', 'digest', 'base_rev', 'empty-data', 'invalid-utf8']) {
    const id = h.ask(), logical = { ...batch, items: [{ ...item, ...(mode === 'id' ? { id: 2 } : mode === 'rev' ? { rev: 9 } : {}) }] }
    const text = mode === 'json' ? '{broken' : JSON.stringify(logical)
    const digest = createHash('sha256').update('thread_items').update('\0').update(text).digest('hex')
    h.emit(frame('thread_items', { conversation_id: 'c', epoch: 'e', version: 8, item_id: 1, rev: 8,
      ...(mode === 'base_rev' ? { base_rev: 0 } : {}), data: mode === 'empty-data' ? '' : mode === 'invalid-utf8' ? '\ud800' : text,
      continuation: { update_id: mode === 'digest' ? '0'.repeat(64) : digest, index: 0, offset: 0,
        total_bytes: Buffer.byteLength(text) + (mode === 'length' ? 1 : 0), final: true } }, id))
    h.emit(frame('thread_items', done, id)); expect(h.replies().at(-1)?.type).toBe('threadQueryFailed')
  }
  expect(h.replies()).toHaveLength(8); h.connection.stop()
})
it('live updates and query fragments share the eight-assembly allowance', async () => {
  const h = await connected(), id = h.ask()
  for (let i = 0; i < 8; i++) {
    const payload = { conversation_id: `live-${i}`, epoch: 'e', version: 8, item: { ...item, summary: 'x'.repeat(60000) } }
    const json = JSON.stringify(payload), update_id = createHash('sha256').update('thread_item_added').update('\0').update(json).digest('hex')
    h.emit(frame('thread_item_added', { conversation_id: payload.conversation_id, epoch: 'e', version: 8,
      item_id: item.id, rev: item.rev, data: json.slice(0, 10000), continuation: { update_id, index: 0, offset: 0, total_bytes: Buffer.byteLength(json), final: false } }, 999))
  }
  h.emit(fragments(id)[0]); h.emit(frame('thread_items', done, id))
  expect(h.replies()).toMatchObject([{ type: 'threadQueryFailed', reason: 'limit' }]); h.connection.stop()
})
it('terminal reset and correlated error release partial assembly without certification', async () => {
  const h = await connected(); vi.useFakeTimers()
  for (const type of ['thread_reset', 'error']) {
    const id = h.ask(); h.emit(fragments(id)[0]); expect(vi.getTimerCount()).toBe(1)
    h.emit(frame(type, type === 'thread_reset' ? { conversation_id: 'c', epoch: 'new', version: 9 } : { code: 'unknown', message: 'inert', retryable: true }, id))
    expect(vi.getTimerCount()).toBe(0); const count = h.replies().length
    fragments(id).forEach(f => h.emit(f)); h.emit(frame('thread_items', done, id)); expect(h.replies()).toHaveLength(count)
  }
  h.connection.stop()
})
it('late dropped-send observations and unmatched frames cannot settle a successor request', async () => {
  const h = await connected(), old = h.ask(); h.connection.reconnect()
  await vi.waitFor(() => expect(h.configs).toHaveLength(2)); h.configs[1].onEvent({ type: 'handshake-complete', helloAck: h.ack })
  const next = h.ask(query, 'next'), before = h.replies().length
  h.observations[0]({ type: 'dropped', reason: 'write-failed' }); h.emit(frame('thread_items', done, old))
  const noCorrelation: any = decodeEnvelope(frame('thread_items', done, next)); delete noCorrelation.in_reply_to
  h.emit(encodeEnvelope(noCorrelation)); expect(h.replies()).toHaveLength(before)
  h.emit(frame('thread_items', done, next)); expect(h.replies().at(-1)).toMatchObject({ type: 'threadReply', requestId: 'next' })
  h.observations[1]({ type: 'dropped', reason: 'write-failed' }); expect(h.replies()).toHaveLength(before + 1); h.connection.stop()
})
it('history admission reuses complete item validation and rejects malformed reset and batch fields', async () => {
  const h = await connected()
  const cases: [string, any][] = []
  for (const key of ['id', 'kind', 'rev', 'status', 'active', 'shown', 'summary', 'content']) {
    const missing: any = { ...item }; delete missing[key]; cases.push(['thread_items', { ...batch, items: [missing] }])
  }
  for (const key of ['from_version', 'lower_order', 'upper_order', 'continuation', 'older_exists']) cases.push(['thread_items', { ...batch, [key]: key === 'older_exists' ? false : 0 }])
  for (const p of [{ ...batch, items: null }, { ...batch, final: 'false' }, { ...batch, conversation_id: 'other' },
    { ...batch, epoch: null }, { ...batch, version: -.5 }]) cases.push(['thread_items', p])
  for (const key of ['items', 'final', 'from_version', 'lower_order', 'upper_order', 'continuation', 'older_exists', 'data']) {
    cases.push(['thread_reset', { conversation_id: 'c', epoch: 'e', version: 0, [key]: null }])
  }
  for (const [type, payload] of cases) {
    const id = h.ask(); h.emit(frame(type, payload, id)); h.emit(frame('thread_items', done, id))
    expect(h.replies().at(-1)?.type).toBe('threadQueryFailed')
  }
  expect(h.replies()).toHaveLength(cases.length); h.connection.stop()
})
