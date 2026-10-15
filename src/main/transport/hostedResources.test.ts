import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { Envelope } from '../../shared/wire/types'
import type { SendOutcome } from './sendObservation'
import { createHostedResources } from './hostedResources'

const app = '22222222-2222-4222-8222-222222222222'
const other = '33333333-3333-4333-8333-333333333333'
const ts = '2026-10-10T18:00:03Z'
const asset = { type: 'app_asset_request' as const, payload: { path: '/image.bin', navigation: false } }
const api = { type: 'app_api_request' as const, payload: { path: '/api/data', method: 'POST' as const, body: 'AP+A', headers: { 'content-type': 'application/octet-stream' }, query: 'x=%2f&x=&x=2' } }
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
function setup() {
  vi.useFakeTimers()
  let id = 2, connected = true, hold = false, throws = false
  const sent: Envelope[] = [], observations: ((outcome: SendOutcome) => void)[] = []
  const resources = createHostedResources({ nextId: () => id++, now: () => ts, connected: () => connected,
    send: (bytes, observe) => {
      if (throws) throw new Error('private send error')
      sent.push(JSON.parse(Buffer.from(bytes).toString()))
      if (hold) observations.push(observe)
      else observe({ type: 'sent', connectionId: 'current' })
    } })
  resources.reset(true)
  const view = resources.openView(app, '1.0.0')
  const receive = (type: string, request: number, payload: unknown, extra = {}) => {
    const envelope = { id: 100, ts, type, in_reply_to: request, payload, ...extra }
    return resources.receive(Buffer.from(JSON.stringify(envelope)), envelope)
  }
  const metadata = (request: number, body: Buffer, chunks = 1, patch = {}) => receive('app_response', request,
    { app_id: app, release_version: '1.0.0', status: 200, headers: {}, size_bytes: body.length,
      total_chunks: body.length ? chunks : 0, sha256: digest(body), ...patch })
  const chunk = (request: number, index: number, data: Buffer, appId = app) =>
    receive('app_response_chunk', request, { app_id: appId, index, data: data.toString('base64') })
  return { resources, view, sent, receive, metadata, chunk, observations,
    connected: (value: boolean) => { connected = value }, hold: () => { hold = true }, throw: () => { throws = true } }
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

it('assembles binary frames with one next credit and preserves POST bytes plus HTTP 204', async () => {
  const h = setup(), bytes = Buffer.from([0, 255, 128, 1, 2, 3, 4])
  const result = h.view.request(asset)
  expect(h.sent).toHaveLength(1)
  h.metadata(2, bytes, 3)
  h.chunk(2, 0, bytes.subarray(0, 3))
  expect(h.sent[1]).toMatchObject({ type: 'app_response_credit', payload: { request_id: 2, next_index: 1 } })
  h.chunk(2, 1, bytes.subarray(3, 5)); h.chunk(2, 2, bytes.subarray(5))
  expect(await result).toMatchObject({ ok: true, bytes })
  expect(h.sent).toHaveLength(3)
  const post = h.view.request(api), request = h.sent.at(-1)!
  expect(request.payload).toMatchObject(api.payload)
  h.metadata(request.id, Buffer.alloc(0), 0, { status: 204 })
  expect(await post).toMatchObject({ ok: true, metadata: { status: 204 }, bytes: Buffer.alloc(0) })
  expect(vi.getTimerCount()).toBe(0)
})

it('enforces active/view admission and reuses released reservations', async () => {
  const h = setup(), pending = Array.from({ length: 16 }, () => h.view.request(asset))
  expect(h.sent).toHaveLength(8)
  expect(await h.view.request(asset)).toMatchObject({ ok: false, error: 'limit' })
  const body = Buffer.alloc(8388608)
  h.metadata(2, body, 256); h.metadata(3, body, 256); h.metadata(4, Buffer.from([1]))
  expect(await pending[2]).toMatchObject({ error: 'limit' })
  const dispatched = h.sent.filter(frame => frame.type === 'app_asset_request').length
  h.view.retire()
  await Promise.all(pending)
  expect(h.sent.filter(frame => frame.type === 'app_asset_request')).toHaveLength(dispatched)
  const next = h.resources.openView(app, '2.0.0').request(asset), id = h.sent.at(-1)!.id
  h.metadata(id, Buffer.alloc(0), 0, { release_version: '2.0.0' })
  expect(await next).toMatchObject({ ok: true })
  h.resources.reset()
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const)('preserves API %s and HTTP error/empty status semantics', async method => {
  const h = setup(), result = h.view.request({ ...api, payload: { ...api.payload, method, body: '' } })
  const status = method === 'HEAD' ? 200 : 503
  h.metadata(2, Buffer.alloc(0), 0, { status })
  expect(await result).toMatchObject({ ok: true, metadata: { status } })
  expect(h.sent[0].payload).toMatchObject({ method, query: api.payload.query })
})

it.each([204, 205, 304])('accepts exact empty HTTP %s', async status => {
  const h = setup(), result = h.view.request(api)
  h.metadata(2, Buffer.alloc(0), 0, { status })
  expect(await result).toMatchObject({ ok: true, metadata: { status }, bytes: Buffer.alloc(0) })
})

it.each(['duplicate-meta', 'before-meta', 'index', 'duplicate-chunk', 'digest', 'short', 'overflow', 'app', 'release', 'forbidden', 'invalid-base64', 'api-size', 'chunk-count', 'head-body'])('rejects corrupt active streams: %s', async fault => {
  const h = setup(), result = h.view.request(fault.startsWith('api') || fault === 'head-body'
    ? { ...api, payload: { ...api.payload, ...(fault === 'head-body' ? { method: 'HEAD', body: '' } : {}) } } : asset)
  const bytes = Buffer.from([0, 128, 255, 1])
  if (fault !== 'before-meta') h.metadata(2, bytes, 2, {
    ...(fault === 'release' ? { release_version: '2.0.0' } : {}),
    ...(fault === 'api-size' ? { size_bytes: 1048577, total_chunks: 32 } : {}),
    ...(fault === 'chunk-count' ? { total_chunks: 5 } : {})
  })
  switch (fault) {
    case 'duplicate-meta': h.metadata(2, bytes, 2); break
    case 'before-meta': h.chunk(2, 0, bytes); break
    case 'index': h.chunk(2, 1, bytes); break
    case 'duplicate-chunk': h.chunk(2, 0, bytes.subarray(0, 2)); h.chunk(2, 0, bytes.subarray(2)); break
    case 'digest': h.chunk(2, 0, Buffer.from([1, 2])); h.chunk(2, 1, Buffer.from([3, 4])); break
    case 'short': h.chunk(2, 0, bytes.subarray(0, 1)); h.chunk(2, 1, bytes.subarray(1, 2)); break
    case 'overflow': h.chunk(2, 0, Buffer.alloc(5)); break
    case 'app': h.chunk(2, 0, bytes, other); break
    case 'forbidden': h.receive('app_response_chunk', 2, { app_id: app, index: 0, data: 'AA==' }, { session_id: 'forbidden' }); break
    case 'invalid-base64': h.receive('app_response_chunk', 2, { app_id: app, index: 0, data: '!' }); break
  }
  expect(await result).toMatchObject({ ok: false, error: 'corrupt' })
  expect(h.sent.at(-1)).toMatchObject({ type: 'app_cancel', payload: { request_id: 2, app_id: app } })
  const count = h.sent.length
  h.metadata(2, bytes); h.chunk(2, 0, bytes)
  expect(h.sent).toHaveLength(count)
  h.resources.reset(); expect(vi.getTimerCount()).toBe(0)
})

it('grants no future chunk until the next credit is written', async () => {
  const h = setup(), result = h.view.request(asset), bytes = Buffer.from([1, 2])
  h.metadata(2, bytes, 2); h.hold(); h.chunk(2, 0, bytes.subarray(0, 1))
  h.chunk(2, 1, bytes.subarray(1))
  expect(await result).toMatchObject({ error: 'corrupt' })
  h.observations[0]({ type: 'sent', connectionId: 'late' })
  h.resources.reset(); expect(vi.getTimerCount()).toBe(0)
})

it('retires scopes once and correlates cancels independently', async () => {
  const h = setup(), abort = new AbortController(), first = h.view.request(api, abort.signal)
  const untouched = h.resources.openView(other, '2.0.0'), second = untouched.request(asset)
  abort.abort(); h.view.retire(); h.view.retire()
  expect(await first).toMatchObject({ error: 'aborted', uncertain: true })
  const cancel = h.sent.find(frame => frame.type === 'app_cancel')!
  expect(cancel.id).not.toBe(2)
  h.receive('app_cancelled', cancel.id, { request_id: 2, app_id: app })
  expect(vi.getTimerCount()).toBe(2) // Only the other view's enqueue/idle timers remain.
  h.metadata(3, Buffer.alloc(0), 0, { app_id: other, release_version: '2.0.0' })
  expect(await second).toMatchObject({ ok: true })
  expect(vi.getTimerCount()).toBe(0)
})

it('bounds and expires cancellation bookkeeping without reviving retired targets', async () => {
  const h = setup()
  for (let i = 0; i < 20; i++) {
    const view = h.resources.openView(app, '1.0.0'), result = view.request(asset)
    view.retire(); expect(await result).toMatchObject({ error: 'retired' })
  }
  expect(h.sent.filter(frame => frame.type === 'app_cancel')).toHaveLength(20)
  expect(vi.getTimerCount()).toBe(16)
  vi.advanceTimersByTime(5000)
  expect(vi.getTimerCount()).toBe(0)
  h.receive('app_cancelled', h.sent[1].id, { request_id: h.sent[0].id, app_id: app })
  expect(vi.getTimerCount()).toBe(0)
})

it('keeps enqueue deadline fixed and ignores unrelated progress', async () => {
  const h = setup(), bytes = Buffer.alloc(9), active = Array.from({ length: 8 }, () => h.view.request(asset))
  const queued = h.view.request(asset)
  for (let id = 2; id <= 9; id++) h.metadata(id, bytes, 9)
  for (let index = 0; index < 7; index++) {
    vi.advanceTimersByTime(4000)
    for (let id = 2; id <= 9; id++) h.chunk(id, index, bytes.subarray(0, 1))
  }
  vi.advanceTimersByTime(2000)
  expect(await queued).toMatchObject({ error: 'timeout' })
  expect((await Promise.all(active)).every(result => !result.ok && result.error === 'timeout')).toBe(true)
  expect(h.sent.filter(frame => frame.type === 'app_asset_request')).toHaveLength(8)
  h.resources.reset()
  const idle = h.resources.openView(app, '1.0.0')
  h.resources.reset(true)
  expect(await idle.request(asset)).toMatchObject({ error: 'retired' })
  const pending = h.resources.openView(app, '1.0.0').request(asset)
  vi.advanceTimersByTime(4999)
  expect(h.receive('message', 0, {})).toBe(false)
  vi.advanceTimersByTime(1)
  expect(await pending).toMatchObject({ error: 'timeout' })
  h.resources.reset(); expect(vi.getTimerCount()).toBe(0)
})

it('settles correlated bridge errors and delayed send/drop failures only once', async () => {
  const h = setup(), first = h.view.request(api), second = h.view.request(asset)
  h.receive('error', 2, { code: 'app.busy', message: 'private diagnostic', retryable: true })
  expect(await first).toMatchObject({ error: 'bridge', uncertain: true })
  h.metadata(4, Buffer.alloc(0)) // cancellation used id 4; it cannot complete request 3.
  h.metadata(3, Buffer.alloc(0)); expect(await second).toMatchObject({ ok: true })
  h.hold()
  const dropped = h.view.request(api)
  h.observations[0]({ type: 'dropped', reason: 'write-failed' })
  expect(await dropped).toMatchObject({ error: 'send-failed', uncertain: true })
  h.observations[0]({ type: 'sent', connectionId: 'late' })
  h.resources.reset(); expect(vi.getTimerCount()).toBe(0)
})

it('isolates hosts and successor views, and never replays mutations', async () => {
  const a = setup(), b = setup(), mutation = a.view.request(api), read = b.view.request(asset)
  a.resources.reset(true)
  expect(await mutation).toMatchObject({ error: 'retired', uncertain: true })
  const successor = a.resources.openView(app, '2.0.0'), result = successor.request(asset)
  a.metadata(2, Buffer.alloc(0)); a.chunk(2, 0, Buffer.from([1]))
  b.metadata(2, Buffer.alloc(0)); expect(await read).toMatchObject({ ok: true })
  const request = a.sent.at(-1)!
  a.metadata(request.id, Buffer.alloc(0), 0, { release_version: '2.0.0' })
  expect(await result).toMatchObject({ ok: true })
  expect(a.sent.filter(frame => frame.type === 'app_api_request')).toHaveLength(1)
  a.resources.retire(); expect(await successor.request(asset)).toMatchObject({ error: 'retired' })
  a.resources.reset(); b.resources.reset(); expect(vi.getTimerCount()).toBe(0)
})

it('rejects unsupported/unavailable, pre-aborted and oversized input without sending', async () => {
  const h = setup()
  h.resources.reset()
  const view = h.resources.openView(app, '1.0.0')
  expect(await view.request(asset)).toMatchObject({ error: 'unavailable', uncertain: false })
  h.resources.reset(true)
  const next = h.resources.openView(app, '1.0.0'), abort = new AbortController()
  abort.abort()
  expect(await next.request(asset, abort.signal)).toMatchObject({ error: 'aborted' })
  expect(await next.request({ ...api, payload: { ...api.payload, body: Buffer.alloc(32769).toString('base64') } })).toMatchObject({ error: 'invalid' })
  h.connected(false)
  expect(await next.request(api)).toMatchObject({ error: 'unavailable', uncertain: false })
  expect(h.sent).toHaveLength(0)
  expect(vi.getTimerCount()).toBe(0)
})

it.each([false, true])('completes exact maximum resource and chunk bounds (API=%s)', async isApi => {
  const h = setup(), count = isApi ? 32 : 256, chunk = Buffer.alloc(32768, 255), bytes = Buffer.alloc(count * chunk.length, 255)
  const input = isApi ? { ...api, payload: { ...api.payload, body: chunk.toString('base64') } } : asset
  const result = h.view.request(input)
  if (isApi) expect(Buffer.from((h.sent[0].payload as { body: string }).body, 'base64')).toEqual(chunk)
  h.metadata(2, bytes, count)
  for (let index = 0; index < count; index++) h.chunk(2, index, chunk)
  const completed = await result
  expect(completed.ok).toBe(true)
  if (completed.ok) expect(completed.bytes.equals(bytes)).toBe(true)
  expect(h.sent.filter(frame => frame.type === 'app_response_credit')).toHaveLength(count - 1)
  expect(vi.getTimerCount()).toBe(0)
})

it('settles thrown sends and aborts queued mutations without claiming uncertainty or sending them', async () => {
  const h = setup(), active = Array.from({ length: 8 }, () => h.view.request(asset)), abort = new AbortController()
  const queued = h.view.request(api, abort.signal)
  abort.abort()
  expect(await queued).toMatchObject({ error: 'aborted', uncertain: false })
  h.view.retire(); await Promise.all(active)
  h.throw()
  const next = h.resources.openView(app, '1.0.0').request(api)
  expect(await next).toMatchObject({ error: 'send-failed', uncertain: true })
  expect(h.sent.some(frame => frame.type === 'app_api_request')).toBe(false)
  h.resources.reset(); expect(vi.getTimerCount()).toBe(0)
})

it('promotes one queued operation after completion and rejects progress past a delayed timer deadline', async () => {
  const h = setup(), active = Array.from({ length: 8 }, () => h.view.request(asset)), queued = h.view.request(asset)
  expect(h.sent).toHaveLength(8)
  h.metadata(2, Buffer.alloc(0))
  expect(await active[0]).toMatchObject({ ok: true })
  expect(h.sent.filter(frame => frame.type === 'app_asset_request')).toHaveLength(9)
  vi.setSystemTime(Date.now() + 5000) // Model an I/O callback running before an overdue timer callback.
  h.metadata(10, Buffer.alloc(0))
  expect(await queued).toMatchObject({ error: 'timeout' })
  h.view.retire(); await Promise.all(active)
  h.resources.reset(); expect(vi.getTimerCount()).toBe(0)
})
