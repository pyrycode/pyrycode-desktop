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
async function connected(serverId = 'a', expansion = false, compact = false) {
  const configs: NoiseRelayDriverConfig[] = [], events: StampedDaemonEvent[] = [], sent: Uint8Array[] = []
  const observations: Function[] = []
  const diagnostics: { event: string; code?: string }[] = []
  let drop = false, throws = false
  const connection = createDaemonConnection({ serverId, deviceName: 'test', clientVersion: 'test',
    diagnosticLog: { event: entry => { diagnostics.push(entry) } },
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
  const ack = encodeEnvelope({ id: 1, type: 'hello_ack', ts: 'stamp', payload: { protocol_version: 'v2', server_id: serverId, conn_id: 'conn', capabilities: compact ? ['thread', 'interactive', 'thread_expansion', 'thread_compact'] : expansion ? ['thread', 'interactive', 'thread_expansion'] : ['thread'] } })
  configs[0].onEvent({ type: 'handshake-complete', helloAck: ack })
  const emit = (bytes: Uint8Array) => configs.at(-1)!.onEvent({ type: 'message', plaintext: bytes })
  const ask = (q: ThreadQuery = query, requestId = 'request') => { connection.queryThread(q, requestId); return decodeEnvelope(sent.at(-1)!).id }
  const replies = () => events.filter(e => e.type === 'threadReply' || e.type === 'threadQueryFailed')
  return { connection, configs, events, sent, ack, emit, ask, replies, observations, diagnostics, failSend: (throwing = false) => { drop = true; throws = throwing } }
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
const compactScope = { projection: 'compact-v1' as const, conversation_id: 'c', epoch: 'e', version: 8 }
const root = (id = 1, subtree_version = 8) => ({ ...child(id, 5), parent: 0, rev: 8, kind: 'tool_call', subtree_version })
async function compactRuntime() {
  const h = await connected('a', true, true)
  routePreloadQueries(host => host === 'a' ? h.connection : null)
  const read = vi.fn(async () => ({ status: 'missing' as const }))
  const r = createThreadRuntime({ send: api.sendCommand, read, log: () => {} })
  const off = api.onDaemonEvent(r.event)
  h.events.filter(e => e.type === 'connected').forEach(r.event)
  await r.open('a', 'c', { projection: 'compact-v1' }).done
  const requests = () => h.sent.map(decodeEnvelope)
  const last = () => requests().at(-1)!.id
  const data = (id = last(), headers = [root()]) => h.emit(frame('thread_items', { ...compactScope, items: [], headers, final: false }, id))
  const done = (id = last(), extra = {}) => h.emit(frame('thread_items', { ...compactScope, items: [], final: true,
    lower_order: 5, upper_order: 10, continuation: 5, older_exists: true, ...extra }, id))
  const update = (version: number, header?: ReturnType<typeof root>, from_version = version - 1) =>
    h.emit(frame('thread_compact_update', { ...compactScope, version, from_version, progress: !header, ...(header ? { header } : {}) }, 0))
  return { ...h, r, read, requests, last, data, done, update, snapshot: () => r.compact.snapshot('a', 'c'),
    close() { r.dispose(); off(); h.connection.stop() } }
}
it('text send through main keeps contiguous compact history and Older usable', async () => {
  const h = await compactRuntime()
  try {
    h.data(); h.done()
    h.connection.send({ conversation_id: 'c', message_id: 'synthetic-send', text: 'Synthetic text' })
    expect(h.requests().at(-1)?.type).toBe('send_message')
    const pending = { ...item, id: 3, kind: 'user_message', status: 'queued', active: true,
      content: { text: 'Synthetic text', device_id: 'synthetic-device', message_id: 'synthetic-send' } }
    h.emit(frame('thread_compact_update', { ...compactScope, version: 9, from_version: 8, progress: false, item: pending }, 0))
    expect(h.snapshot()?.rows).toContainEqual(pending)
    const echo = { ...item, id: 3, rev: 9, order: 9, kind: 'user_message', shown: true,
      content: { text: 'Synthetic text', device_id: 'synthetic-device', message_id: 'synthetic-send' } }
    h.emit(frame('thread_compact_update', { ...compactScope, version: 10, from_version: 9, progress: false, item: echo }, 0))
    h.update(11, root(1, 11))
    expect(h.snapshot()).toMatchObject({ checkpoint: 8, consumed: 11 })
    expect(h.snapshot()?.failed).toBeUndefined()
    expect(h.snapshot()?.rows).toContainEqual(echo)
    expect(h.requests().filter(e => e.type === 'thread_catch_up')).toHaveLength(1)
    h.r.query('older', 'a')
    expect(h.requests().at(-1)).toMatchObject({ type: 'thread_page', payload: { before_order: 5, epoch: 'e', projection: 'compact-v1' } })
    h.done(h.last(), { version: 11, lower_order: 0, upper_order: 5, continuation: 0, older_exists: false })
    expect(h.snapshot()).toMatchObject({ checkpoint: 8, consumed: 11, ranges: [{ start: 0, end: 10 }] })
    expect(h.snapshot()?.failed).toBeUndefined()
    expect(h.r.compact.state.getState().pending.size).toBe(0)
  } finally { h.close() }
})
it.each(['connection', 'capability', 'command'] as const)('compact main refusal classifies %s without transport handoff', async cause => {
  const h = await connected('a', true, cause !== 'capability')
  try {
    if (cause === 'connection') h.connection.stop()
    const q: ThreadQuery = { type: 'thread_catch_up', payload: { ...compactScope, version: cause === 'command' ? -1 : 8 } }
    const count = h.sent.length
    h.connection.queryThread(q, 'refused')
    expect(h.sent).toHaveLength(count)
    expect(h.replies().at(-1)).toMatchObject({ type: 'threadQueryFailed', reason: 'unavailable' })
    expect(h.diagnostics).toContainEqual({ event: 'thread-query-refused', code: cause })
    expect(h.diagnostics.some(e => e.event === 'thread-query-sent')).toBe(false)
  } finally { h.connection.stop() }
})
it.each([undefined, 0])('compact query admits a pending send with order=%s and certifies only its final marker', async order => {
  const h = await compactRuntime()
  try {
    const pending = { ...item, kind: 'user_message', status: 'queued', active: true, ...(order === undefined ? {} : { order }) }
    h.emit(frame('thread_items', { ...compactScope, items: [pending], final: false }, h.last()))
    expect(h.snapshot()?.rows).toContainEqual(pending)
    expect(h.snapshot()?.checkpoint).toBe(0)
    h.done()
    expect(h.snapshot()?.checkpoint).toBe(8)
    expect(h.r.compact.state.getState().pending.size).toBe(0)
  } finally { h.close() }
})
it('locally unavailable compact recovery retains rows, settles once and works after explicit Retry', async () => {
  const h = await compactRuntime()
  try {
    h.data(); h.done()
    const rows = h.snapshot()?.rows
    routePreloadQueries(() => null)
    h.update(12, undefined, 10)
    expect(h.snapshot()).toMatchObject({ failed: 'unavailable', checkpoint: 8 })
    expect(h.snapshot()?.rows).toEqual(rows)
    expect(h.r.compact.state.getState().pending.size).toBe(0)
    const count = h.requests().length
    h.update(13); h.r.query('older', 'a')
    expect(h.requests()).toHaveLength(count)
    routePreloadQueries(() => h.connection)
    h.r.query('retry', 'a')
    expect(h.requests().at(-1)?.payload).toMatchObject({ version: 8, projection: 'compact-v1' })
    h.emit(frame('thread_items', { ...compactScope, version: 13, items: [], final: true, from_version: 8 }, h.last()))
    expect(h.snapshot()?.failed).toBeUndefined()
    expect(h.snapshot()?.checkpoint).toBe(13)
    expect(h.r.compact.state.getState().pending.size).toBe(0)
  } finally { h.close() }
})
it.each([-1, 1.5, 'invalid', null])('compact query still rejects an invalid present order=%s', async order => {
  const h = await compactRuntime()
  try {
    h.emit(frame('thread_items', { ...compactScope, items: [{ ...item, order }], final: false }, h.last()))
    expect(h.snapshot()).toMatchObject({ checkpoint: 0, failed: 'malformed' })
    expect(h.r.compact.state.getState().pending.size).toBe(0)
  } finally { h.close() }
})
it('compact child failure blocks queued limit variants until their explicit retry, including continuations', async () => {
  const h = await compactRuntime()
  try {
    h.data(); h.done()
    const first = h.r.children.demand(childRequest)
    const sibling = h.r.children.demand({ ...childRequest, limit: 1 })
    expect(childReads(h)).toHaveLength(1)
    const fail = () => h.emit(frame('error', { code: 'thread.query_failed', message: 'inert' }, childReads(h).at(-1)!.id))
    fail(); expect(first.getState().type).toBe('failed')
    expect(childReads(h)).toHaveLength(1)
    expect(sibling.getState().type).toBe('failed')
    h.update(9, root(1, 9)); await Promise.resolve()
    expect(childReads(h)).toHaveLength(1)
    sibling.retry(); expect(childReads(h)).toHaveLength(2)
    const cursor = { ...childCursor(2), version: 9 }
    h.emit(frame('thread_children', { ...childPage(), version: 9 }, childReads(h)[1].id))
    h.emit(frame('thread_children', { ...childEnd(true), version: 9, cursor }, childReads(h)[1].id))
    expect(sibling.getState()).toMatchObject({ type: 'ready', page: { more: true } })
    sibling.continue(cursor); expect(childReads(h)).toHaveLength(3)
    fail(); expect(sibling.getState().type).toBe('failed')
    first.retry(); expect(childReads(h)).toHaveLength(4)
    expect(childReads(h).at(-1)!.payload).not.toHaveProperty('cursor')
  } finally { h.close() }
})
it.each(['delete', 'dispose', 'disconnect', 'reopen'] as const)('compact live invalidation fences reentrant %s', async action => {
  const h = await compactRuntime()
  try {
    h.data(); h.done()
    let armed = false, called = false
    h.r.bodies.demand(bodyRequest, () => {
      if (!armed || called) return
      called = true
      if (action === 'delete') h.r.event({ type: 'conversationDeleted', serverId: 'a', id: 'c' })
      else if (action === 'dispose') h.r.dispose()
      else if (action === 'disconnect') h.r.event({ type: 'disconnected', serverId: 'a', reason: 'test' })
      else void h.r.open('a', 'c', { projection: 'compact-v1' }).done
    })
    armed = true
    h.update(9, root(1, 9))
    expect(called).toBe(true)
    if (action === 'delete' || action === 'dispose') expect(h.snapshot()).toBeUndefined()
    else expect(h.snapshot()).toMatchObject({ consumed: 8, rows: [{ subtree_version: 8 }] })
    await Promise.resolve()
    expect(h.snapshot()?.consumed).not.toBe(9)
  } finally { h.close() }
})
it.each(['data', 'marker', 'incompatible-open'] as const)('compact %s invalidation cannot republish after reentrant deletion', async path => {
  const h = await compactRuntime()
  try {
    // Missing freshness forces the success marker to invalidate retained detail again.
    const { subtree_version, ...unknown } = root()
    h.emit(frame('thread_items', { ...compactScope, items: [], headers: [unknown], final: false }, h.last()))
    if (path === 'incompatible-open') h.done()
    let armed = false, called = false
    h.r.bodies.demand(bodyRequest, () => {
      if (!armed || called) return
      called = true; h.r.event({ type: 'conversationDeleted', serverId: 'a', id: 'c' })
    })
    armed = true
    if (path === 'data') {
      h.data()
    } else if (path === 'marker') h.done()
    else { h.r.compact.complete('a', 'c'); h.r.compact.open('a', 'c') }
    expect(called).toBe(true)
    expect(h.snapshot()).toBeUndefined()
    await Promise.resolve(); expect(h.snapshot()).toBeUndefined()
  } finally { h.close() }
})
it('compact Older and reconnect preserve failed recovery admission until explicit Retry', async () => {
  const h = await compactRuntime()
  try {
    h.data(); h.done()
    h.update(12, root(1, 12), 10)
    h.emit(frame('error', { code: 'thread.query_failed', message: 'inert' }, h.last()))
    expect(h.snapshot()?.failed).toBe('daemon-error')
    const before = h.requests().length
    h.r.query('older', 'a'); expect(h.requests()).toHaveLength(before)
    h.configs[0].onEvent({ type: 'relay-link-down', code: 1006 })
    h.configs[0].onEvent({ type: 'handshake-complete', helloAck: h.ack })
    expect(h.requests()).toHaveLength(before)
    h.r.query('retry', 'a'); expect(h.requests()).toHaveLength(before + 1)
    expect(h.requests().at(-1)).toMatchObject({ type: 'thread_catch_up', payload: { version: 8, epoch: 'e' } })
    h.emit(frame('thread_items', { ...compactScope, version: 12, items: [], final: true, from_version: 8 }, h.last()))
    expect(h.snapshot()).toMatchObject({ checkpoint: 12, failed: undefined, repairThrough: undefined })
    h.r.query('older', 'a'); expect(h.requests().at(-1)?.type).toBe('thread_page')
  } finally { h.close() }
})
it('compact frames certify roots separately, sort mixed ties, page with epoch and consume hidden progress', async () => {
  const h = await compactRuntime(), id = h.last()
  expect(h.requests().at(-1)).toMatchObject({ type: 'thread_catch_up', payload: { projection: 'compact-v1', version: 0, epoch: '' } })
  h.emit(frame('thread_items', { ...compactScope, final: false, items: [{ ...item, id: 3, order: 5 }], headers: [root(2), root(1)] }, id))
  expect(h.snapshot()?.rows.map(row => row.id)).toEqual([1, 2, 3])
  expect(h.snapshot()?.checkpoint).toBe(0)
  expect(h.r.items.getState().snapshot('a', 'c')).toBeNull()
  h.done(id)
  expect(h.snapshot()).toMatchObject({ checkpoint: 8, ranges: [{ start: 5, end: 10 }] })
  h.update(10, root(1, 10), 8); h.update(10, root(2, 10), 8); h.update(11)
  expect(h.snapshot()).toMatchObject({ checkpoint: 8, consumed: 11 })
  expect(h.snapshot()?.rows.slice(0, 2)).toMatchObject([{ subtree_version: 10 }, { subtree_version: 10 }])
  h.r.query('older', 'a')
  expect(h.requests().at(-1)).toMatchObject({ type: 'thread_page', payload: { projection: 'compact-v1', epoch: 'e', before_order: 5 } })
  h.done(h.last(), { version: 11, lower_order: 0, upper_order: 5, continuation: 0, older_exists: false })
  expect(h.snapshot()?.ranges).toEqual([{ start: 0, end: 10 }])
  expect(h.snapshot()?.checkpoint).toBe(8)
  expect(h.read).not.toHaveBeenCalled(); h.close()
})
it.each(['tool_call', 'children'] as const)('same-rev freshness invalidates pending %s, fences late result and refreshes demanded first page', async kind => {
  const h = await compactRuntime(); h.data(); h.done()
  const lease = h.r.bodies.demand({ ...bodyRequest, kind })
  const old = h.last()
  if (kind === 'children') h.emit(frame('thread_children', { ...childPage(), version: 8 }, old))
  else h.emit(frame('thread_tool_body', bodyData, old))
  h.update(9, root(1, 9))
  await Promise.resolve()
  if (kind === 'children') h.emit(frame('thread_children', childEnd(), old))
  else h.emit(frame('thread_tool_body', bodyDone, old))
  const fresh = h.last(); expect(fresh).not.toBe(old)
  expect(h.requests().at(-1)?.payload).not.toHaveProperty('cursor')
  expect(lease.getState().stale).toBe(true)
  if (kind === 'children') h.emit(frame('thread_children', { ...childEnd(), version: 9 }, fresh))
  else { h.emit(frame('thread_tool_body', { ...bodyData, version: 9, content: { output: 'fresh' } }, fresh)); h.emit(frame('thread_tool_body', { ...bodyDone, version: 9 }, fresh)) }
  expect(lease.getState()).toMatchObject({ type: 'ready', stale: false })
  h.update(10, root(1, 10))
  await Promise.resolve()
  h.emit(frame('error', { code: 'thread.query_failed', message: 'private' }, h.last()))
  expect(lease.getState()).toMatchObject({ type: 'failed', stale: true })
  if (kind === 'tool_call') expect(lease.getState().content).toEqual({ output: 'fresh' })
  const count = h.requests().length; h.update(11, root(1, 11)); expect(h.requests()).toHaveLength(count)
  lease.retry(); expect(h.requests()).toHaveLength(count + 1)
  h.close()
})
it.each(['projection', 'epoch', 'summary', 'root-parent', 'full-tool', 'scope', 'headers-on-marker'])('compact malformed %s fails without certifying coverage', async mode => {
  const h = await compactRuntime(), id = h.last()
  const p: any = { ...compactScope, items: [], headers: [root()], final: false }
  if (mode === 'projection') p.projection = 'future'
  if (mode === 'epoch') p.epoch = ''
  if (mode === 'summary') p.headers[0].headline = 'private\npeer text'
  if (mode === 'root-parent') p.headers[0].parent = 2
  if (mode === 'full-tool') { p.headers = []; p.items = [{ ...item, kind: 'tool_call', order: 1 }] }
  if (mode === 'scope') p.conversation_id = 'other'
  if (mode === 'headers-on-marker') Object.assign(p, { final: true, lower_order: 0, upper_order: 10, continuation: 0, older_exists: false })
  h.emit(frame('thread_items', p, id))
  expect(h.events.at(-1)).toMatchObject({ type: 'threadQueryFailed' })
  expect(h.snapshot()?.checkpoint).toBe(0)
  expect(h.snapshot()?.failed).toBeDefined()
  const count = h.requests().length
  h.update(10, root(2, 10), 8)
  expect(h.requests()).toHaveLength(count)
  h.close()
})
it('compact assembly final holds facts but only the separate query marker certifies coverage', async () => {
  const h = await compactRuntime(), id = h.last()
  const p = { ...compactScope, items: [{ ...item, id: 2, order: 5, content: { text: 'é'.repeat(40000) } }], final: false }
  const raw = JSON.stringify(p), update_id = createHash('sha256').update('thread_items').update('\0').update(raw).digest('hex')
  const chunks = [raw.slice(0, 10000), raw.slice(10000)]
  let offset = 0
  chunks.forEach((data, index) => {
    h.emit(frame('thread_items', { ...compactScope, item_id: 2, rev: 8, data,
      continuation: { update_id, index, offset, total_bytes: Buffer.byteLength(raw), final: index === 1 } }, id))
    offset += Buffer.byteLength(data)
  })
  expect(h.snapshot()).toMatchObject({ checkpoint: 0, rows: [{ id: 2 }] })
  h.done(id); expect(h.snapshot()?.checkpoint).toBe(8); h.close()
})
it.each([false, true])('compact live assembly validates projection scope (mismatch=%s)', async mismatch => {
  const h = await compactRuntime(); h.data(); h.done()
  const payload = { ...compactScope, version: 9, from_version: 8, progress: false,
    item: { ...item, id: 2, order: 6, content: { text: 'é'.repeat(40000) } } }
  const raw = JSON.stringify(payload), update_id = createHash('sha256').update('thread_compact_update').update('\0').update(raw).digest('hex')
  const chunks = [raw.slice(0, 10000), raw.slice(10000)]
  let offset = 0
  chunks.forEach((data, index) => {
    const { item, ...scope } = payload
    h.emit(frame('thread_compact_update', { ...scope, ...(mismatch && index === 1 ? { projection: 'unknown' } : {}), item_id: 2, rev: 8, data,
      continuation: { update_id, index, offset, total_bytes: Buffer.byteLength(raw), final: index === 1 } }, 0))
    offset += Buffer.byteLength(data)
  })
  expect(h.snapshot()?.rows.map(row => row.id)).toEqual(mismatch ? [1] : [1, 2])
  expect(h.snapshot()?.checkpoint).toBe(8)
  expect(h.snapshot()?.consumed).toBe(mismatch ? 8 : 9)
  if (mismatch) expect(h.requests().at(-1)).toMatchObject({ type: 'thread_catch_up', payload: { version: 8 } })
  h.close()
})
it.each(['replacement', 'e'])('compact catch-up uses certified checkpoint after reconnect and %s reset replaces only compact scope', async epoch => {
  const h = await compactRuntime()
  h.r.items.getState().acceptEpoch('a', 'c', 'complete-epoch')
  h.r.items.getState().beginBatch('a', 'c', 'complete-epoch')?.commit({ fromVersion: 0, version: 77, ranges: [] })
  const complete = h.r.items.getState().snapshot('a', 'c')
  h.data(); h.done(); h.update(9)
  h.r.event({ type: 'disconnected', serverId: 'a', reason: 'test' })
  const before = h.requests().length
  await h.r.open('a', 'c', { projection: 'compact-v1' }).done
  expect(h.requests()).toHaveLength(before)
  expect(h.snapshot()).toMatchObject({ checkpoint: 8, consumed: 9, rows: [{ id: 1 }] })
  h.r.event(h.events.find(e => e.type === 'connected')!)
  expect(h.requests().at(-1)).toMatchObject({ payload: { version: 8, epoch: 'e', projection: 'compact-v1' } })
  const id = h.last()
  h.emit(frame('thread_items', { ...compactScope, version: 10, items: [], final: true, from_version: 8 }, id))
  expect(h.snapshot()?.checkpoint).toBe(10)
  h.r.event({ type: 'disconnected', serverId: 'a', reason: 'test' })
  h.r.event(h.events.find(e => e.type === 'connected')!)
  h.emit(frame('thread_reset', { ...compactScope, epoch, version: 97 }, h.last()))
  expect(h.requests().at(-1)).toMatchObject({ payload: { version: 0, epoch } })
  expect(h.snapshot()).toMatchObject({ checkpoint: 0, rows: [] })
  h.emit(frame('thread_items', { ...compactScope, version: 100, items: [{ ...item, id: 4, order: 1 }], final: false }, id))
  expect(h.snapshot()?.rows).toEqual([])
  expect(h.r.items.getState().snapshot('a', 'c')).toBe(complete)
  h.close()
})
it('compact gap recovery and query/live cancellation keep replacements newer than a delayed query', async () => {
  const h = await compactRuntime(); h.data(); h.done()
  h.update(12, root(1, 12), 10)
  expect(h.requests().at(-1)).toMatchObject({ payload: { version: 8 } })
  const repair = h.last()
  h.emit(frame('thread_items', { ...compactScope, version: 12, items: [], headers: [root(1, 8)], final: false }, repair))
  expect(h.snapshot()?.rows[0]).toMatchObject({ subtree_version: 12 })
  h.update(13, root(2, 13), 12)
  h.emit(frame('error', { code: 'thread.query_failed', message: 'private' }, repair))
  expect(h.snapshot()).toMatchObject({ checkpoint: 8, failed: 'daemon-error' })
  const count = h.requests().length
  h.update(14); expect(h.requests()).toHaveLength(count)
  h.r.query('retry', 'a'); expect(h.requests().at(-1)).toMatchObject({ payload: { version: 8 } })
  h.emit(frame('thread_items', { ...compactScope, version: 14, items: [], final: true, from_version: 8 }, h.last()))
  expect(h.snapshot()).toMatchObject({ checkpoint: 14, consumed: 14, repairThrough: undefined })
  h.close()
})
it('freshness restarts invalidated child enumeration without its consumed-version cursor and leaves next pages explicit', async () => {
  const h = await compactRuntime(); h.data(); h.done()
  const lease = h.r.children.demand(childRequest)
  h.emit(frame('thread_children', { ...childPage(), version: 8 }, h.last()))
  h.emit(frame('thread_children', { ...childEnd(true), version: 8, cursor: { ...childCursor(2), version: 8 } }, h.last()))
  expect(lease.getState()).toMatchObject({ page: { more: true, complete: false } })
  const count = h.requests().length; await Promise.resolve(); expect(h.requests()).toHaveLength(count)
  lease.continue({ ...childCursor(2), version: 8 }); const old = h.last()
  h.update(9, root(1, 9)); h.update(10, root(1, 10), 8); await Promise.resolve()
  h.emit(frame('thread_children', { ...childEnd(), version: 8 }, old))
  expect(h.requests().at(-1)?.payload).not.toHaveProperty('cursor')
  expect(h.requests()).toHaveLength(count + 2)
  h.emit(frame('thread_children', { ...childEnd(), version: 10 }, h.last()))
  expect(lease.getState()).toMatchObject({ type: 'ready', page: { children: [], complete: true } })
  lease.release(); h.update(11, root(1, 11)); await Promise.resolve()
  expect(h.requests()).toHaveLength(count + 2)
  h.close()
})
it('newer admitted revision refreshes an active body and refuses an obsolete demand', async () => {
  const h = await compactRuntime(); h.data(); h.done()
  const lease = h.r.bodies.demand(bodyRequest), old = h.last()
  h.update(9, { ...root(1, 9), rev: 9 }); await Promise.resolve()
  h.emit(frame('thread_tool_body', bodyData, old)); h.emit(frame('thread_tool_body', bodyDone, old))
  expect(h.requests().at(-1)?.payload).toMatchObject({ expected_rev: 9 })
  const fresh = h.last()
  h.emit(frame('thread_tool_body', { ...bodyData, rev: 9, version: 9, content: { output: 'new revision' } }, fresh))
  h.emit(frame('thread_tool_body', { ...bodyDone, rev: 9, version: 9 }, fresh))
  expect(lease.getState()).toMatchObject({ type: 'ready', content: { output: 'new revision' }, stale: false })
  const before = h.requests().length
  expect(h.r.bodies.demand(bodyRequest).getState()).toMatchObject({ type: 'failed', reason: 'invalid' })
  expect(h.requests()).toHaveLength(before)
  expect(lease.getState().stale).toBe(false); h.close()
})
it('colliding host identities and navigation hold the connection slot and fence retired root/detail replies', async () => {
  const h = await compactRuntime(); h.data(); h.done()
  const lease = h.r.bodies.demand(bodyRequest), old = h.last()
  const b = await connected('b', true, true)
  routePreloadQueries(host => host === 'a' ? h.connection : host === 'b' ? b.connection : null)
  await h.r.open('b', 'c', { projection: 'compact-v1' }).done
  const id = decodeEnvelope(b.sent.at(-1)!).id
  b.emit(frame('thread_items', { ...compactScope, items: [], headers: [root(2)], final: false }, id))
  b.emit(frame('thread_items', { ...compactScope, items: [], final: true, lower_order: 0, upper_order: 10, continuation: 0, older_exists: false }, id))
  expect(h.r.compact.snapshot('b', 'c')?.rows.map(row => row.id)).toEqual([2])
  expect(lease.getState()).toMatchObject({ type: 'missing', reason: 'retired' })
  await h.r.open('a', 'other', { projection: 'compact-v1' }).done
  // The original a body is still Core's unfinished query until its terminal arrives.
  expect(h.last()).toBe(old)
  h.emit(frame('thread_tool_body', bodyData, old)); h.emit(frame('thread_tool_body', bodyDone, old))
  expect(h.requests().at(-1)).toMatchObject({ type: 'thread_catch_up', payload: { conversation_id: 'other', version: 0 } })
  expect(h.r.compact.snapshot('b', 'c')?.rows.map(row => row.id)).toEqual([2])
  h.r.event({ type: 'conversationDeleted', serverId: 'a', id: 'c' })
  expect(h.snapshot()).toBeUndefined()
  const other = h.last()
  h.emit(frame('thread_items', { ...compactScope, conversation_id: 'other', items: [], headers: [root(4)], final: false }, other))
  h.emit(frame('thread_items', { ...compactScope, conversation_id: 'other', items: [], final: true,
    lower_order: 0, upper_order: 10, continuation: 0, older_exists: false }, other))
  expect(h.r.compact.snapshot('a', 'other')).toMatchObject({ checkpoint: 8, rows: [{ id: 4 }] })
  h.update(12, root(1, 12), 8)
  expect(h.snapshot()).toBeUndefined()
  h.close(); b.connection.stop()
})
it('offline compact reopen retains only session data and stale detail without disk reads', async () => {
  const h = await compactRuntime(); h.data(); h.done()
  const lease = h.r.bodies.demand(bodyRequest)
  h.emit(frame('thread_tool_body', bodyData, h.last())); h.emit(frame('thread_tool_body', bodyDone, h.last()))
  expect(lease.getState()).toMatchObject({ type: 'ready', stale: false })
  h.r.event({ type: 'disconnected', serverId: 'a', reason: 'test' })
  await h.r.open('a', 'c', { projection: 'compact-v1' }).done
  const count = h.requests().length
  expect(h.r.bodies.demand(bodyRequest).getState()).toMatchObject({ type: 'ready', stale: true, content: bodyData.content })
  expect(h.r.bodies.demand({ ...bodyRequest, itemId: 99 }).getState()).toMatchObject({ type: 'missing', reason: 'offline' })
  expect(h.requests()).toHaveLength(count); expect(h.read).not.toHaveBeenCalled()
  h.close()
})
it('advertisement leaves normal opening complete, and unsupported or unknown projection refuses', async () => {
  const h = await connected('a', true, true)
  routePreloadQueries(() => h.connection)
  const r = createThreadRuntime({ send: api.sendCommand, read: async () => ({ status: 'missing' }), log: () => {} })
  const off = api.onDaemonEvent(r.event); h.events.filter(e => e.type === 'connected').forEach(r.event)
  await r.open('a', 'c').done
  expect(decodeEnvelope(h.sent.at(-1)!).payload).not.toHaveProperty('projection')
  expect(isRendererCommand({ type: 'queryThread', serverId: 'a', requestId: 'q', query: { ...query, payload: { ...query.payload, projection: 'unknown' } } })).toBe(false)
  expect(isRendererCommand({ type: 'queryThread', serverId: 'a', requestId: 'q', query: { type: 'thread_page', payload: { conversation_id: 'c', before_order: 0, projection: 'compact-v1' } } })).toBe(false)
  r.dispose(); off(); h.connection.stop()
  const legacy = await connected('a', true)
  legacy.connection.queryThread({ ...query, payload: { ...query.payload, projection: 'compact-v1' } }, 'unsupported')
  expect(legacy.sent).toHaveLength(0)
  expect(legacy.replies().at(-1)).toMatchObject({ type: 'threadQueryFailed', reason: 'unavailable' }); legacy.connection.stop()
})
it('a detail capture older than admitted ancestor freshness fails and requires retry', async () => {
  const h = await compactRuntime(); h.data(); h.done()
  const lease = h.r.bodies.demand(bodyRequest)
  h.emit(frame('thread_tool_body', { ...bodyData, version: 7 }, h.last()))
  expect(lease.getState()).toMatchObject({ type: 'failed', reason: 'metadata' })
  const before = h.requests().length
  h.emit(frame('thread_tool_body', { ...bodyDone, version: 7 }, h.last()))
  expect(h.requests()).toHaveLength(before)
  lease.retry(); expect(h.requests()).toHaveLength(before + 1)
  h.emit(frame('thread_tool_body', bodyData, h.last())); h.emit(frame('thread_tool_body', bodyDone, h.last()))
  expect(lease.getState()).toMatchObject({ type: 'ready', stale: false }); h.close()
})
it('missing ancestor freshness invalidates known detail and unknown is distinct from zero', async () => {
  const h = await compactRuntime(); h.data(); h.done()
  const lease = h.r.bodies.demand(bodyRequest)
  h.emit(frame('thread_tool_body', bodyData, h.last())); h.emit(frame('thread_tool_body', bodyDone, h.last()))
  const { subtree_version, ...unknown } = root()
  h.update(9, unknown as ReturnType<typeof root>)
  await Promise.resolve()
  expect(h.snapshot()?.rows[0]).not.toHaveProperty('subtree_version')
  expect(lease.getState().stale).toBe(true)
  const old = h.last()
  h.update(10, { ...unknown, rev: 9 } as ReturnType<typeof root>); await Promise.resolve()
  h.emit(frame('thread_tool_body', { ...bodyData, version: 9 }, old))
  h.emit(frame('thread_tool_body', { ...bodyDone, version: 9 }, old))
  expect(lease.getState().stale).toBe(true)
  expect(h.requests().at(-1)?.payload).toMatchObject({ expected_rev: 9 })
  h.close()
})
it.each(['delete', 'unpair', 'dispose'] as const)('compact %s retires pending queries and ignores delayed frames', async mode => {
  const h = await compactRuntime(), id = h.last()
  h.data(id)
  if (mode === 'delete') h.r.event({ type: 'conversationDeleted', serverId: 'a', id: 'c' })
  if (mode === 'unpair') beginChatHistoryRemoval('a')(true)
  if (mode === 'dispose') h.r.dispose()
  expect(h.snapshot()).toBeUndefined()
  h.done(id); h.update(9, root(1, 9))
  expect(h.snapshot()).toBeUndefined()
  h.close()
})
it('admitted child revisions replace queued obsolete body demands before wire dispatch', async () => {
  const h = await compactRuntime(); h.data(); h.done()
  const children = h.r.children.demand(childRequest), first = h.last()
  const body = h.r.bodies.demand({ ...bodyRequest, itemId: 2, revision: 1 })
  h.emit(frame('thread_children', { ...childPage([{ ...child(2), rev: 9 }]), version: 8 }, first))
  await Promise.resolve()
  h.emit(frame('thread_children', { ...childEnd(), version: 8 }, first))
  expect(children.getState()).toMatchObject({ type: 'ready', page: { children: [{ id: 2, rev: 9 }] } })
  const reads = h.requests().filter(q => q.type === 'thread_read_tool_body')
  expect(reads).toHaveLength(1)
  expect(reads[0].payload).toMatchObject({ item_id: 2, expected_rev: 9 })
  h.emit(frame('thread_tool_body', { ...bodyData, item_id: 2, rev: 9 }, reads[0].id))
  h.emit(frame('thread_tool_body', { ...bodyDone, item_id: 2, rev: 9 }, reads[0].id))
  expect(body.getState()).toMatchObject({ type: 'ready', stale: false })
  h.close()
})
it('projection switches initialize at zero even with independently held complete checkpoints', async () => {
  const h = await compactRuntime(); h.data(); h.done()
  h.r.items.getState().acceptEpoch('a', 'c', 'complete')
  h.r.items.getState().beginBatch('a', 'c', 'complete')?.commit({ fromVersion: 0, version: 77, ranges: [] })
  await h.r.open('a', 'c').done
  expect(h.requests().at(-1)).toMatchObject({ payload: { version: 0 } })
  expect(h.requests().at(-1)?.payload).not.toHaveProperty('projection')
  h.emit(frame('thread_items', { ...windowDone, epoch: 'complete', version: 77 }, h.last()))
  await h.r.open('a', 'c', { projection: 'compact-v1' }).done
  expect(h.requests().at(-1)).toMatchObject({ payload: { projection: 'compact-v1', version: 0 } })
  expect(h.snapshot()).toMatchObject({ checkpoint: 0, ranges: [] })
  h.close()
})
it('an existing child lease continues with the refreshed parent revision', async () => {
  const h = await compactRuntime(); h.data(); h.done()
  const lease = h.r.children.demand(childRequest), old = h.last()
  h.update(9, { ...root(1, 9), rev: 9 }); await Promise.resolve()
  h.emit(frame('thread_children', { ...childEnd(), version: 8 }, old))
  const fresh = h.last(), cursor = { ...childCursor(2), version: 9, rev: 9 }
  h.emit(frame('thread_children', { ...childPage(), version: 9, rev: 9 }, fresh))
  h.emit(frame('thread_children', { ...childEnd(true), version: 9, rev: 9, cursor }, fresh))
  lease.continue(cursor)
  expect(h.requests().at(-1)?.payload).toMatchObject({ expected_rev: 9, cursor })
  expect(lease.getState().type).toBe('loading'); h.close()
})
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
it.each(['retained', 'evicted'])('changed child limits cannot bypass failed continuation with %s content', async mode => {
  const h = await bodyRuntime(), before = h.r.items.getState().snapshot('a', 'c')
  try {
    const lease = h.r.children.demand(childRequest), first = childReads(h)[0].id
    h.emit(frame('thread_children', childPage([child(2), child(3)]), first))
    h.emit(frame('thread_children', { ...childEnd(true), cursor: childCursor(3) }, first))
    expect(lease.getState()).toMatchObject({ type: 'ready', page: { children: [child(2), child(3)], more: true } })
    lease.continue(childCursor(3))
    h.emit(frame('error', { code: 'thread.query_failed', message: 'private' }, childReads(h)[1].id))
    expect(lease.getState()).toMatchObject({ type: 'failed', reason: 'daemon-error', page: { complete: false } })
    if (mode === 'evicted') {
      const content = { output: 'x'.repeat(6 * 1024 * 1024) }
      for (const itemId of [2, 3, 4]) {
        const body = h.r.bodies.demand({ ...bodyRequest, itemId }), id = h.reads().at(-1)!.id
        bodyParts(id, { ...bodyData, item_id: itemId, content }, itemId).forEach(h.emit)
        h.emit(frame('thread_tool_body', { ...bodyDone, item_id: itemId }, id))
        expect(body.getState().type).toBe('ready'); body.release()
      }
      expect(lease.getState()).toEqual({ type: 'failed', reason: 'daemon-error', stale: true })
    }
    lease.release()
    const changed = h.r.children.demand({ ...childRequest, limit: 1 })
    expect(changed.getState()).toMatchObject({ type: 'failed', reason: 'daemon-error' })
    changed.release()
    const reopened = h.r.children.demand({ ...childRequest, limit: 1 })
    expect(reopened.getState().type).toBe('failed'); expect(childReads(h)).toHaveLength(2)
    reopened.retry()
    expect(childReads(h)).toHaveLength(3)
    expect(childReads(h)[2].payload).toEqual({ conversation_id: 'c', epoch: 'e', item_id: 1, expected_rev: 8, limit: 1 })
    h.emit(frame('thread_children', childPage([child(4)]), childReads(h)[2].id))
    expect(reopened.getState()).toMatchObject({ type: 'loading', page: { children: [child(4)], complete: false } })
    h.emit(frame('thread_children', { ...childEnd(true), cursor: childCursor(4) }, childReads(h)[2].id))
    expect(reopened.getState()).toMatchObject({ type: 'ready', page: { children: [child(4)], more: true, complete: false } })
    const cursor = reopened.getState().page!.cursor!
    expect(cursor).toEqual(childCursor(4)); expect(Object.keys(cursor)).toHaveLength(7)
    reopened.continue(cursor); reopened.continue(cursor)
    expect(childReads(h)).toHaveLength(4)
    expect(childReads(h)[3].payload).toEqual({ ...childReads(h)[2].payload, cursor })
    const next = childReads(h)[3].id
    h.emit(frame('thread_children', childPage([child(99)]), childReads(h)[1].id))
    h.emit(frame('thread_children', childEnd(), childReads(h)[1].id))
    expect(reopened.getState()).toMatchObject({ type: 'loading', page: { children: [child(4)], complete: false } })
    h.emit(frame('thread_children', childPage([child(5)]), next))
    expect(reopened.getState()).toMatchObject({ type: 'loading', page: { children: [child(4), child(5)], complete: false } })
    h.emit(frame('thread_children', childEnd(), next))
    expect(reopened.getState()).toMatchObject({ type: 'ready', stale: false, page: { children: [child(4), child(5)], complete: true, more: false } })
    reopened.continue(cursor)
    expect(h.r.children.demand({ ...childRequest, limit: 1 }).getState().type).toBe('ready')
    expect(childReads(h)).toHaveLength(4)
    expect(h.r.items.getState().snapshot('a', 'c')).toBe(before)
    expect(h.sent.map(decodeEnvelope).filter(e => e.type === 'mark_conversation_read')).toHaveLength(0)
  } finally { h.close() }
})
it('replacement child retry acknowledges one failure across pages and requires retry after another', async () => {
  const h = await bodyRuntime()
  try {
    const first = h.r.children.demand(childRequest)
    h.emit(frame('thread_children', childPage(), childReads(h)[0].id))
    h.emit(frame('thread_children', childEnd(true), childReads(h)[0].id))
    first.continue(childCursor(2))
    const fail = (id: number) => h.emit(frame('error', { code: 'thread.query_failed', message: 'private' }, id))
    fail(childReads(h)[1].id); expect(first.getState().type).toBe('failed')
    const replacement = h.r.children.demand({ ...childRequest, limit: 1 })
    expect(replacement.getState().type).toBe('failed'); replacement.retry()
    h.emit(frame('thread_children', childPage([child(4)]), childReads(h)[2].id))
    h.emit(frame('thread_children', { ...childEnd(true), cursor: childCursor(4) }, childReads(h)[2].id))
    expect(replacement.getState()).toMatchObject({ type: 'ready', page: { more: true } })
    // A refused sibling demand acknowledges nothing and must not invent a new failure.
    expect(h.r.children.demand({ ...childRequest, limit: 3 }).getState().type).toBe('failed')
    replacement.continue(childCursor(4)); replacement.continue(childCursor(4))
    expect(childReads(h)).toHaveLength(4)
    fail(childReads(h)[3].id)
    expect(replacement.getState()).toMatchObject({ type: 'failed', page: { children: [child(4)], complete: false } })
    replacement.continue(childCursor(4))
    expect(h.r.children.demand({ ...childRequest, limit: 1 }).getState().type).toBe('failed')
    expect(h.r.children.demand({ ...childRequest, limit: 4 }).getState().type).toBe('failed')
    expect(childReads(h)).toHaveLength(4)
    replacement.retry(); expect(childReads(h)).toHaveLength(5)
    expect(childReads(h)[4].payload).not.toHaveProperty('cursor')
    h.emit(frame('thread_children', childPage([child(99)]), childReads(h)[3].id))
    h.emit(frame('thread_children', childEnd(), childReads(h)[3].id))
    expect(replacement.getState()).toMatchObject({ type: 'loading', page: { children: [child(4)], complete: false } })
    h.emit(frame('thread_children', childPage([child(6)]), childReads(h)[4].id))
    h.emit(frame('thread_children', { ...childEnd(true), cursor: childCursor(6) }, childReads(h)[4].id))
    expect(replacement.getState()).toMatchObject({ type: 'ready', page: { children: [child(6)], more: true } })
    replacement.continue(childCursor(6)); expect(childReads(h)).toHaveLength(6)
    expect(childReads(h)[5].payload).toEqual({ ...childReads(h)[4].payload, cursor: childCursor(6) })
    h.emit(frame('thread_children', childPage([child(7)]), childReads(h)[5].id))
    h.emit(frame('thread_children', childEnd(), childReads(h)[5].id))
    expect(replacement.getState()).toMatchObject({ type: 'ready', page: { children: [child(6), child(7)], complete: true, more: false } })
  } finally { h.close() }
})
it('a later in-flight sibling failure invalidates a replacement enumeration acknowledgment', async () => {
  const h = await bodyRuntime()
  try {
    const first = h.r.children.demand(childRequest)
    const sibling = h.r.children.demand({ ...childRequest, limit: 1 })
    const fail = (id: number) => h.emit(frame('error', { code: 'thread.query_failed', message: 'private' }, id))
    fail(childReads(h)[0].id); expect(first.getState().type).toBe('failed')
    first.retry(); expect(childReads(h)[2].payload).not.toHaveProperty('cursor')
    h.emit(frame('thread_children', childPage(), childReads(h)[2].id))
    h.emit(frame('thread_children', childEnd(true), childReads(h)[2].id))
    expect(first.getState()).toMatchObject({ type: 'ready', page: { more: true } })
    fail(childReads(h)[1].id); expect(sibling.getState().type).toBe('failed')
    first.continue(childCursor(2))
    expect(first.getState()).toMatchObject({ type: 'failed', page: { children: [child(2)], complete: false } })
    expect(childReads(h)).toHaveLength(3)
    first.retry(); expect(childReads(h)[3].payload).not.toHaveProperty('cursor')
    h.emit(frame('thread_children', childEnd(), childReads(h)[3].id))
    expect(first.getState()).toMatchObject({ type: 'ready', page: { children: [], complete: true } })
  } finally { h.close() }
})
it('queued child continuation rechecks a later sibling failure before dispatch', async () => {
  const h = await bodyRuntime(), before = h.r.items.getState().snapshot('a', 'c')
  try {
    const first = h.r.children.demand(childRequest)
    const sibling = h.r.children.demand({ ...childRequest, limit: 1 })
    const fail = (id: number) => h.emit(frame('error', { code: 'thread.query_failed', message: 'private' }, id))
    const original = childReads(h)[0].id, siblingId = childReads(h)[1].id
    fail(original); expect(first.getState().type).toBe('failed')
    first.retry()
    const retried = childReads(h)[2].id
    expect(childReads(h)[2].payload).not.toHaveProperty('cursor')
    h.emit(frame('thread_children', childPage(), retried))
    h.emit(frame('thread_children', childEnd(true), retried))
    expect(first.getState()).toMatchObject({ type: 'ready', page: { children: [child(2)], more: true } })
    const bodies = [10, 11, 12].map(itemId => h.r.bodies.demand({ ...bodyRequest, itemId }))
    expect(h.reads()).toHaveLength(3)
    bodies.forEach(lease => expect(lease.getState().type).toBe('loading'))
    // B plus three body reads occupy every active slot; A can only queue here.
    first.continue(childCursor(2)); first.continue(childCursor(2))
    expect(first.getState()).toMatchObject({ type: 'loading', page: { children: [child(2)], complete: false } })
    expect(childReads(h)).toHaveLength(3)
    fail(siblingId)
    expect(sibling.getState()).toMatchObject({ type: 'failed', reason: 'daemon-error' })
    expect(childReads(h)).toHaveLength(3)
    expect(first.getState()).toMatchObject({ type: 'failed', reason: 'daemon-error', stale: true,
      page: { children: [child(2)], complete: false } })
    first.continue(childCursor(2))
    expect(h.r.children.demand(childRequest).getState().type).toBe('failed')
    expect(childReads(h)).toHaveLength(3)
    first.retry()
    expect(childReads(h)).toHaveLength(4)
    const replacement = childReads(h)[3].id
    expect(childReads(h)[3].payload).toEqual({ conversation_id: 'c', epoch: 'e', item_id: 1, expected_rev: 8, limit: 2 })
    h.emit(frame('thread_children', childPage([child(99)]), original))
    h.emit(frame('thread_children', childEnd(), retried))
    h.emit(frame('thread_children', childEnd(), siblingId))
    expect(first.getState()).toMatchObject({ type: 'loading', page: { children: [child(2)], complete: false } })
    h.emit(frame('thread_children', childPage([child(4)]), replacement))
    h.emit(frame('thread_children', { ...childEnd(true), cursor: childCursor(4) }, replacement))
    expect(first.getState()).toMatchObject({ type: 'ready', page: { children: [child(4)], more: true } })
    const cursor = first.getState().page!.cursor!
    expect(cursor).toEqual(childCursor(4)); expect(Object.keys(cursor)).toHaveLength(7)
    first.continue(cursor); first.continue(cursor)
    expect(childReads(h)).toHaveLength(5)
    expect(childReads(h)[4].payload).toEqual({ ...childReads(h)[3].payload, cursor })
    const next = childReads(h)[4].id
    h.emit(frame('thread_children', childPage([child(5)]), next))
    h.emit(frame('thread_children', childEnd(), next))
    expect(first.getState()).toMatchObject({ type: 'ready', stale: false,
      page: { children: [child(4), child(5)], complete: true, more: false } })
    first.continue(cursor); expect(childReads(h)).toHaveLength(5)
    expect(h.reads()).toHaveLength(3)
    expect(h.r.items.getState().snapshot('a', 'c')).toBe(before)
    expect(h.sent.map(decodeEnvelope).filter(e => e.type === 'mark_conversation_read')).toHaveLength(0)
  } finally { h.close() }
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
  ['duplicate identity', { children: [child(2), child(2, 1)] }],
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
it.each(['version', 'tuple', 'identity', 'second-data', 'aggregate-bytes'])('child reply boundary rejects %s', async mode => {
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
    h.emit(frame('thread_children', { ...childPage(), children: [child(mode === 'tuple' || mode === 'identity' ? 2 : 3, mode === 'identity' ? 1 : 0)], version: mode === 'version' ? 1 : 0 }, next))
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
