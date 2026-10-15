import { afterEach, expect, it, vi } from 'vitest'
import type { Envelope, HostedAppRecord } from '../../shared/wire/types'
import { createHostedResources } from './hostedResources'
import { createHostedApps } from './hostedApps'
import { createHash } from 'node:crypto'

const app = '22222222-2222-4222-8222-222222222222', other = '33333333-3333-4333-8333-333333333333'
const ts = '2026-10-10T18:00:03Z'
const record = (app_id = app, revision = 1, patch = {}): HostedAppRecord => ({ app_id, revision,
  title: 'App', desired: 'available', state: 'running', active_release: '1.0.0', pending_release: null, last_error: null, ...patch })
const asset = { type: 'app_asset_request' as const, payload: { path: '/', navigation: true } }
function setup() {
  vi.useFakeTimers()
  let id = 2, dropped = false, held = false
  const observations: ((outcome: import('./sendObservation').SendOutcome) => void)[] = []
  const sent: Envelope[] = []
  const deps = { nextId: () => id++, now: () => ts, connected: () => true,
    send: (bytes: Uint8Array, observe: (outcome: import('./sendObservation').SendOutcome) => void) => {
      sent.push(JSON.parse(Buffer.from(bytes).toString()))
      if (held) observations.push(observe)
      else observe(dropped ? { type: 'dropped', reason: 'send-refused' } : { type: 'sent', connectionId: 'one' })
    } }
  const resources = createHostedResources(deps), apps = createHostedApps({ ...deps, resources })
  const receive = (type: string, payload: unknown, request?: number, extra = {}) => {
    const envelope = { id: 100, ts, type, payload, ...(request === undefined ? {} : { in_reply_to: request }), ...extra }
    return apps.receive(Buffer.from(JSON.stringify(envelope)), envelope)
  }
  const list = () => sent.filter(e => e.type === 'list_apps').at(-1)!.id
  const page = (items: HostedAppRecord[], revision = 1, next_cursor: string | null = null, request = list()) =>
    receive('apps', { items, revision, next_cursor }, request)
  resources.reset(true); apps.reset(true)
  return { apps, resources, sent, receive, page, list, observations, hold: () => { held = true }, drop: () => { dropped = true } }
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

it('publishes only complete ordered snapshots and coalesces refresh', () => {
  const h = setup(), listener = vi.fn(), off = h.apps.subscribe(listener)
  h.apps.refresh(); h.apps.refresh()
  expect(h.sent).toHaveLength(1)
  expect(h.apps.openView(app)).toEqual({ ok: false, error: 'unconfirmed' })
  h.page([record()], 2, 'cursor')
  expect(h.apps.read().type).toBe('loading')
  expect(h.sent.at(-1)?.payload).toEqual({ cursor: 'cursor' })
  h.page([record(other, 2, { desired: 'stopped', state: 'failed', active_release: null })], 2)
  expect(h.apps.read()).toMatchObject({ type: 'ready', revision: 2, items: [record(), { state: 'failed', desired: 'stopped' }] })
  const copy = h.apps.read()
  if (copy.type === 'ready') copy.items[0].active_release = 'evil'
  expect(h.apps.read()).toMatchObject({ items: [record(), {}] })
  expect(h.apps.openView(other).ok).toBe(false)
  off(); const calls = listener.mock.calls.length
  h.apps.refresh(); h.page([], 2)
  expect(h.apps.read()).toEqual({ type: 'ready', revision: 2, items: [] })
  expect(listener).toHaveBeenCalledTimes(calls)
  expect(vi.getTimerCount()).toBe(0)
})

it('applies contiguous whole records and retires only affected bindings', async () => {
  const h = setup()
  h.receive('app_updated', record(app, 3, { state: 'starting' }))
  h.receive('app_removed', { app_id: other, revision: 4 })
  h.page([record(), record(other, 2)], 2)
  expect(h.apps.read()).toMatchObject({ type: 'ready', revision: 4, items: [{ state: 'starting' }] })
  h.receive('app_updated', record(app, 5)); h.receive('app_updated', record(other, 6))
  const a = h.apps.openView(app), b = h.apps.openView(other)
  expect(a.ok && b.ok).toBe(true)
  if (!a.ok || !b.ok) throw new Error('expected bindings')
  const pending = a.view.request(asset)
  h.receive('app_updated', record(app, 7, { active_release: '2.0.0' }))
  expect(await pending).toMatchObject({ error: 'retired' })
  expect(await a.view.request(asset)).toMatchObject({ error: 'retired' })
  expect(h.apps.openView(app).ok).toBe(true)
  const unrelated = b.view.request(asset)
  h.receive('app_updated', record(app, 6)) // old revision cannot restore old release
  expect(h.sent.at(-1)?.type).toBe('app_asset_request')
  h.receive('app_removed', { app_id: other, revision: 8 })
  expect(await unrelated).toMatchObject({ error: 'retired' })
  expect(h.apps.openView(other).ok).toBe(false)
  h.apps.reset(); h.resources.reset()
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['release', 'removal', 'non-running', 'refresh', 'gap', 'invalid', 'reset'] as const)(
  'retires affected bindings before queue promotion: %s', async kind => {
    const h = setup(), peer = setup()
    h.page([record(), record(other)]); peer.page([record()])
    const a = h.apps.openView(app), b = h.apps.openView(app), c = h.apps.openView(other), remote = peer.apps.openView(app)
    if (!a.ok || !b.ok || !c.ok || !remote.ok) throw new Error('expected bindings')
    const reads = Array.from({ length: 8 }, () => a.view.request(asset))
    const mutation = b.view.request({ type: 'app_api_request', payload: { path: '/api/preferences', method: 'POST', headers: {}, body: '' } })
    const unrelated = c.view.request(asset), remoteRead = remote.view.request(asset)
    expect(h.sent.filter(e => e.type === 'app_asset_request')).toHaveLength(8)
    expect(h.sent.some(e => e.type === 'app_api_request')).toBe(false)
    switch (kind) {
      case 'release': h.receive('app_updated', record(app, 2, { active_release: '2.0.0' })); break
      case 'removal': h.receive('app_removed', { app_id: app, revision: 2 }); break
      case 'non-running': h.receive('app_updated', record(app, 2, { state: 'stopped', active_release: null })); break
      case 'refresh': h.apps.refresh(); break
      case 'gap': h.receive('app_updated', record(app, 3)); break
      case 'invalid': h.receive('app_updated', {}); break
      case 'reset': h.apps.reset(); break
    }
    expect(await mutation).toEqual({ ok: false, error: 'retired', uncertain: false })
    expect(h.sent.some(e => e.type === 'app_api_request')).toBe(false)
    expect((await Promise.all(reads)).every(r => !r.ok && r.error === 'retired')).toBe(true)
    expect(await a.view.request(asset)).toMatchObject({ error: 'retired' })
    expect(await b.view.request(asset)).toMatchObject({ error: 'retired' })
    const complete = (host: ReturnType<typeof setup>, appId: string): void => {
      const request = host.sent.at(-1)!
      expect(request.type).toBe('app_asset_request')
      const envelope = { id: 101, ts, type: 'app_response', in_reply_to: request.id, payload: {
        app_id: appId, release_version: '1.0.0', status: 200, headers: {}, size_bytes: 0,
        total_chunks: 0, sha256: createHash('sha256').update('').digest('hex') } }
      expect(host.resources.receive(Buffer.from(JSON.stringify(envelope)), envelope)).toBe(true)
    }
    if (['release', 'removal', 'non-running'].includes(kind)) {
      // Successful promotion/completion is a positive barrier for unaffected local work.
      expect(h.sent.filter(e => e.type === 'app_asset_request')).toHaveLength(9)
      complete(h, other); expect(await unrelated).toMatchObject({ ok: true })
    } else {
      expect(h.sent.filter(e => e.type === 'app_asset_request')).toHaveLength(8)
      expect(await unrelated).toEqual({ ok: false, error: 'retired', uncertain: false })
    }
    complete(peer, app); expect(await remoteRead).toMatchObject({ ok: true })
    const nextRemote = remote.view.request(asset)
    complete(peer, app); expect(await nextRemote).toMatchObject({ ok: true })
    h.apps.reset(); h.resources.reset(); peer.apps.reset(); peer.resources.reset()
    expect(vi.getTimerCount()).toBe(0)
  })

it.each(['expired', 'drift', 'order', 'gap'])('restarts invalid walks with exact independent cancellation: %s', kind => {
  const h = setup(), first = h.list()
  if (kind === 'gap') {
    h.receive('app_updated', record(app, 4)); h.page([record()], 1)
  } else if (kind === 'expired') h.receive('error', { code: 'apps.changed', message: 'changed', retryable: true }, first)
  else {
    h.page([record(other)], 1, 'cursor')
    h.page([record()], kind === 'drift' ? 2 : 1)
  }
  expect(h.apps.read().type).toBe('loading')
  vi.advanceTimersByTime(0)
  expect(h.sent.filter(e => e.type === 'list_apps').at(-1)?.payload).toEqual({})
  h.page([], 5)
  expect(h.apps.read()).toMatchObject({ type: 'ready', revision: 5 })
  h.apps.refresh(); const target = h.list()
  // An invalid owned frame retires the pending list and cancels without app scope.
  h.receive('apps', {}, target)
  const cancel = h.sent.at(-1)!
  expect(cancel).toMatchObject({ type: 'app_cancel', payload: { request_id: target } })
  expect(cancel.payload).not.toHaveProperty('app_id')
  h.receive('app_cancelled', { request_id: target }, cancel.id)
  expect(h.apps.read()).toMatchObject({ type: 'failed', error: 'invalid' })
  expect(h.receive('apps', { revision: 99, items: [record()], next_cursor: null }, target)).toBe(true)
  expect(h.apps.read().type).toBe('failed')
  h.apps.reset(); expect(vi.getTimerCount()).toBe(0)
})

it('bounds overflow and fixed deadlines across restarts', () => {
  const h = setup()
  for (let revision = 1; revision <= 257; revision++) h.receive('app_updated', record(app, revision))
  expect(h.sent.filter(e => e.type === 'list_apps')).toHaveLength(1)
  vi.advanceTimersByTime(0)
  expect(h.sent.filter(e => e.type === 'list_apps')).toHaveLength(2)
  for (let i = 0; i < 7; i++) {
    vi.advanceTimersByTime(4000)
    h.page([record()], 1, 'cursor')
    h.receive('error', { code: 'apps.changed', message: 'changed', retryable: true }, h.list())
    vi.advanceTimersByTime(0)
  }
  vi.advanceTimersByTime(2000)
  expect(h.apps.read()).toMatchObject({ type: 'failed', error: 'timeout' })
  vi.advanceTimersByTime(5000)
  expect(vi.getTimerCount()).toBe(0)
  h.apps.refresh(); vi.advanceTimersByTime(5000)
  expect(h.apps.read()).toMatchObject({ error: 'timeout' })
  h.apps.reset(); expect(vi.getTimerCount()).toBe(0)
})

it('rejects invalid correlations and bounds failure cleanup', () => {
  const h = setup(), first = h.list()
  h.page([record()], 1, null, first + 100)
  expect(h.apps.read().type).toBe('loading')
  expect(h.receive('error', { code: 'app.timeout', message: 'timeout', retryable: true }, 900)).toBe(false)
  h.page([record()], 1, null, first)
  const binding = h.apps.openView(app)
  if (!binding.ok) throw new Error('expected binding')
  h.receive('app_updated', record(other, 3)) // gap invalidates every binding immediately
  expect(h.apps.openView(app).ok).toBe(false)
  h.apps.reset(); h.resources.reset(true)
  h.apps.reset(true); h.drop()
  h.receive('apps', {}, h.list())
  h.apps.refresh()
  expect(h.apps.read()).toMatchObject({ type: 'failed', error: 'send-failed' })
  h.apps.reset(); h.resources.reset(); expect(vi.getTimerCount()).toBe(0)
})

it('enforces page and host bounds while retaining every desired and observed state', () => {
  const h = setup(), rows = Array.from({ length: 257 }, (_, i) => record(`${i.toString(16).padStart(8, '0')}-2222-4222-8222-222222222222`, 1))
  for (let i = 0; i < 256; i += 16) h.page(rows.slice(i, i + 16), 1, i === 240 ? null : `cursor-${i}`)
  expect(h.apps.read()).toMatchObject({ type: 'ready', items: expect.any(Array) })
  const snapshot = h.apps.read()
  expect(snapshot.type === 'ready' && snapshot.items.length).toBe(256)
  h.apps.refresh()
  for (let i = 0; i < 256; i += 16) h.page(rows.slice(i, i + 16), 1, `cursor-${i}`)
  h.page(rows.slice(256), 1)
  expect(h.apps.read()).toMatchObject({ type: 'failed', error: 'limit' })
  h.apps.refresh(); h.page(rows.slice(0, 17))
  expect(h.apps.read()).toMatchObject({ type: 'failed', error: 'invalid' })
  h.apps.reset(); h.resources.reset(true); h.apps.reset(true)
  const states = ['starting', 'running', 'stopped', 'failed'] as const
  h.page(states.map((state, i) => record(rows[i].app_id, 1, { state, desired: i % 2 ? 'stopped' : 'available', active_release: state === 'running' ? '1.0.0' : null })))
  const result = h.apps.read()
  expect(result.type === 'ready' && result.items.map(r => [r.desired, r.state])).toEqual([
    ['available', 'starting'], ['stopped', 'running'], ['available', 'stopped'], ['stopped', 'failed']])
  h.apps.reset(); h.resources.reset(); expect(vi.getTimerCount()).toBe(0)
})

it('does not extend inactivity for restart errors or unrelated notifications', () => {
  const h = setup()
  vi.advanceTimersByTime(4000)
  h.receive('error', { code: 'apps.changed', message: 'changed', retryable: true }, h.list())
  vi.advanceTimersByTime(0)
  h.receive('app_updated', record())
  vi.advanceTimersByTime(1000)
  expect(h.apps.read()).toMatchObject({ type: 'failed', error: 'timeout' })
  vi.advanceTimersByTime(5000); expect(vi.getTimerCount()).toBe(0)
})

it('fails discovery when shared control admission is exhausted', () => {
  const h = setup(), releases: (() => void)[] = []
  for (let i = 0; i < 15; i++) releases.push(h.resources.reserveControl()!)
  expect(h.resources.reserveControl()).toBeUndefined() // list owns the sixteenth
  h.receive('error', { code: 'apps.changed', message: 'changed', retryable: true }, h.list())
  vi.advanceTimersByTime(0)
  expect(h.apps.read()).toMatchObject({ type: 'failed', error: 'limit' })
  expect(h.sent.some(e => e.type === 'app_cancel')).toBe(false)
  const released = h.resources.reserveControl()
  expect(released).toBeTypeOf('function')
  expect(h.resources.reserveControl()).toBeUndefined()
  released?.()
  releases.forEach(release => release())
  h.apps.reset(); h.resources.reset(); expect(vi.getTimerCount()).toBe(0)
})

it.each(['wrong-target', 'malformed', 'app-scoped'])(
  'shares sixteen control slots with resources and releases independent cancellation acknowledgements: %s', kind => {
    const h = setup(), target = h.list()
    h.receive('apps', {}, target)
    const cancel = h.sent.at(-1)!
    expect(cancel).toMatchObject({ type: 'app_cancel', payload: { request_id: target } })
    const releases = Array.from({ length: 15 }, () => h.resources.reserveControl())
    expect(releases.every(Boolean)).toBe(true)
    expect(h.resources.reserveControl()).toBeUndefined() // Actual cancellation owns the sixteenth.
    const payload = kind === 'wrong-target' ? { request_id: target + 1 }
      : kind === 'malformed' ? {} : { request_id: target, app_id: app }
    expect(h.receive('app_cancelled', payload, cancel.id)).toBe(true)
    const released = h.resources.reserveControl()
    expect(released).toBeTypeOf('function')
    expect(h.resources.reserveControl()).toBeUndefined()
    h.page([record()], 1, null, target)
    h.receive('app_cancelled', { request_id: target }, cancel.id)
    expect(h.apps.read()).toEqual({ type: 'failed', error: 'invalid' })
    expect(vi.getTimerCount()).toBe(0)
    released?.(); releases.forEach(release => release?.())
    h.apps.reset(); h.resources.reset(true); h.apps.reset(true)
    h.receive('error', { code: 'apps.changed', message: 'changed', retryable: true }, h.list())
    const c = h.sent.at(-1)!
    expect(c.type).toBe('app_cancel')
    h.receive('app_cancelled', c.payload, c.id)
    vi.advanceTimersByTime(0); h.page([])
    expect(h.apps.read()).toMatchObject({ type: 'ready', items: [] })
    expect(vi.getTimerCount()).toBe(0)
  })

it('rejects malformed owned envelopes, stale generations and bridge errors without consuming resource replies', () => {
  const h = setup(), old = h.list()
  h.receive('apps', { revision: 1, items: [record()], next_cursor: null }, old, { session_id: 'foreign' })
  expect(h.apps.read()).toMatchObject({ type: 'failed', error: 'invalid' })
  h.apps.reset(); h.resources.reset(true); h.apps.reset(true)
  h.page([record()], 1, null, old)
  expect(h.apps.read().type).toBe('loading')
  expect(h.receive('app_response', {}, 999)).toBe(false)
  expect(h.receive('app_cancelled', { request_id: 999, app_id: app }, 998)).toBe(false)
  h.receive('error', { code: 'app.not_found', message: 'missing', retryable: false }, h.list())
  expect(h.apps.read()).toMatchObject({ type: 'failed', error: 'bridge' })
  h.apps.reset(); h.resources.reset(); expect(vi.getTimerCount()).toBe(0)
})

it('keeps held control sends bounded even after their target and acknowledgement expire', () => {
  const h = setup(); h.hold()
  for (let i = 0; i < 20 && h.apps.read().type === 'loading'; i++) {
    h.receive('error', { code: 'apps.changed', message: 'changed', retryable: true }, h.list())
    vi.advanceTimersByTime(0)
  }
  expect(h.apps.read()).toMatchObject({ type: 'failed', error: 'limit' })
  expect(h.observations.length).toBeLessThanOrEqual(16)
  const sent = h.sent.length
  vi.advanceTimersByTime(10000)
  expect(vi.getTimerCount()).toBe(0)
  h.apps.refresh()
  expect(h.observations.length).toBeLessThanOrEqual(16)
  h.apps.reset(); h.resources.reset()
  h.observations.forEach(observe => observe({ type: 'sent', connectionId: 'old' }))
  expect(h.apps.read().type).toBe('unavailable')
  expect(h.sent.length).toBeGreaterThanOrEqual(sent)
  const releases = Array.from({ length: 16 }, () => h.resources.reserveControl())
  expect(releases.every(Boolean)).toBe(true)
  releases.forEach(release => release?.())
})
