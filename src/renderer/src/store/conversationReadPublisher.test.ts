import { describe, expect, it, vi } from 'vitest'
import { createReadPublisher, readTargetFor, type ThreadReadInputs } from './conversationReadPublisher'
import { createThreadItemStore } from './threadItemStore'
import { createThreadCompact } from './threadCompact'
import type { RendererCommand } from '../../../shared/ipc/commands'
import type { ThreadSnapshot } from './threadItemStore'

describe('read target diagnostics', () => {
  const valid = (): ThreadReadInputs => ({ snapshot: {
    hostId: 'HOST_SECRET', conversationId: 'CHAT_SECRET', epoch: 'EPOCH_SECRET',
    version: 10, checkpoint: 10, items: [{ id: 900, rev: 999, kind: 'assistant_message',
      order: 5, shown: true, status: 'done', active: false, summary: 'CONTENT_SECRET', content: { text: 'CONTENT_SECRET' } }],
    ranges: [{ start: 5, end: 6 }], repair: null
  }, completeThrough: 10, row: { id: 'CHAT_SECRET', serverId: 'HOST_SECRET', read_up_to: 0, last_shown_version: 10 } })
  const compact = (t: ThreadReadInputs): NonNullable<ThreadReadInputs['compact']> => t.compact = { snapshot: t.snapshot, through: 10,
    roots: new Set([900]), routeEpoch: 'ROUTE_SECRET', current: () => true }
  const cases: [string, (input: ThreadReadInputs) => void][] = [
    ['scope-unavailable', t => { t.row.serverId = undefined }],
    ['scope-unavailable', t => { t.row.serverId = null }],
    ['scope-mismatch', t => { t.row.serverId = 'other' }],
    ['scope-mismatch', t => { t.row.id = 'other' }],
    ['read-metadata-unavailable', t => { t.row.read_up_to = undefined }],
    ['read-metadata-unavailable', t => { t.row.last_shown_version = undefined }],
    ...[-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(n =>
      ['target-invalid', (t: ThreadReadInputs) => { t.row.last_shown_version = n }] as [string, (t: ThreadReadInputs) => void]),
    ['checkpoint-insufficient', t => { t.snapshot = { ...t.snapshot, checkpoint: 9 } }],
    ['completion-insufficient', t => { t.completeThrough = NaN }],
    ['completion-insufficient', t => { t.completeThrough = 9 }],
    ['repair-pending', t => { t.snapshot = { ...t.snapshot, repair: { fromVersion: 9, throughVersion: 12 } } }],
    ['tail-unavailable', t => { t.snapshot = { ...t.snapshot, items: [] } }],
    ['tail-unavailable', t => { t.snapshot = { ...t.snapshot, items: t.snapshot.items.map(i => ({ ...i, status: 'queued' })) } }],
    ['coverage-insufficient', t => { t.snapshot = { ...t.snapshot, ranges: [] } }],
    ['compact-snapshot-mismatch', t => { compact(t).snapshot = { ...t.snapshot } }],
    ['compact-stale', t => { compact(t).current = () => false }],
    ['compact-completion-insufficient', t => { compact(t).through = NaN }],
    ['compact-completion-insufficient', t => { compact(t).through = 9 }],
    ['compact-tail-uncovered', t => { compact(t).roots = new Set() }],
    ...[{ status: 'queued' }, { order: undefined }, { order: 0 }].map(fields =>
      ['shown-tail-pending', (t: ThreadReadInputs) => { t.snapshot = { ...t.snapshot,
        items: [...t.snapshot.items, { ...t.snapshot.items[0], id: 901, ...fields }] } }] as [string, (t: ThreadReadInputs) => void])
  ]
  it.each(cases)('emits one static %s rejection', (code, change) => {
    const input = valid(), log = vi.fn()
    change(input)
    expect(readTargetFor(input, log)).toBeUndefined()
    expect(log.mock.calls).toEqual([[{ event: 'read-target', code }]])
    const throwing = vi.fn(() => { throw new Error('diagnostic failure') })
    expect(readTargetFor(input, throwing)).toBeUndefined()
    expect(throwing.mock.calls).toEqual(log.mock.calls)
  })
  it.each([
    ['window unavailable', undefined], ['bridge unavailable', {}], ['method unavailable', { pyry: {} }],
    ['bridge access throws', Object.defineProperty({}, 'pyry', { get() { throw new Error('bridge access') } })],
    ['method access throws', { pyry: Object.defineProperty({}, 'sendDiagnostic', { get() { throw new Error('method access') } }) }],
    ['method throws', { pyry: { sendDiagnostic() { throw new Error('bridge send') } } }]
  ])('preserves target results when %s', (_name, bridge) => {
    vi.stubGlobal('window', bridge)
    try {
      const input = valid()
      expect(readTargetFor(input)).toBe(10)
      input.completeThrough = 0
      expect(readTargetFor(input)).toBeUndefined()
    } finally { vi.unstubAllGlobals() }
  })
  it('preserves compact precedence and does not swallow domain errors', () => {
    const input = valid(), log = vi.fn()
    compact(input).current = () => { throw new Error('domain failure') }
    input.snapshot = { ...input.snapshot, items: [] }
    expect(readTargetFor(input, log)).toBeUndefined()
    expect(log.mock.calls).toEqual([[{ event: 'read-target', code: 'tail-unavailable' }]])
    input.snapshot = input.compact!.snapshot
    expect(() => readTargetFor(input, log)).toThrow('domain failure')
  })
  it('preserves guard precedence and keeps success silent', () => {
    const input = valid(), log = vi.fn()
    expect(readTargetFor(input, log)).toBe(10)
    expect(log).not.toHaveBeenCalled()
    input.row.serverId = undefined; input.row.last_shown_version = -1; input.completeThrough = 0
    expect(readTargetFor(input, log)).toBeUndefined()
    expect(log.mock.calls).toEqual([[{ event: 'read-target', code: 'scope-unavailable' }]])
  })
})

it('pairs shown targets with completed immutable thread progress, never ids or held versions', () => {
  const store = createThreadItemStore().getState()
  store.acceptEpoch('a', 'c', 'e')
  const full = { id: 900, rev: 900, kind: 'assistant_message', order: 5, shown: true,
    status: 'done', active: false, summary: 'reply', content: { text: 'reply' } }
  const b = store.beginBatch('a', 'c', 'e')!
  b.applyItems([full], 10)
  const target = (shown: number) => readTargetFor({ snapshot: store.snapshot('a', 'c')!, completeThrough: 10, row: { ...row(), last_shown_version: shown } })
  expect(target(10)).toBeUndefined()
  b.abandon()
  expect(target(10)).toBeUndefined()
  store.beginBatch('a', 'c', 'e')!.commit({ fromVersion: 0, version: 10, ranges: [{ start: 5, end: 6 }] })
  const committed = store.snapshot('a', 'c')!
  expect(target(10)).toBe(10)
  store.applyUpdate('a', { type: 'thread_item_added', payload: { conversation_id: 'c', epoch: 'e', version: 11,
    item: { ...full, id: 999, order: 6, shown: false } } })
  expect(target(10)).toBe(10)
  store.requireRepair('a', 'c', 'e', 12)
  expect(target(12)).toBeUndefined()
  expect(target(10)).toBe(10)
  expect(readTargetFor({ snapshot: committed, completeThrough: 10, row: { ...row(), last_shown_version: 11 } })).toBeUndefined()
  expect(readTargetFor({ snapshot: committed, completeThrough: 10, row: { ...row('b'), last_shown_version: 10 } })).toBeUndefined()
  expect(readTargetFor({ snapshot: { ...committed, ranges: [] }, completeThrough: 10, row: { ...row(), last_shown_version: 10 } })).toBeUndefined()
  expect(readTargetFor({ snapshot: committed, completeThrough: 9, row: { ...row(), last_shown_version: 10 } })).toBeUndefined()
  const queued = { ...full, id: 1000, rev: 1000, order: 0, status: 'queued' }
  const input = { snapshot: { ...committed, items: [...committed.items, queued] }, completeThrough: 10,
    row: { ...row(), last_shown_version: 10 } }
  expect(readTargetFor(input)).toBeUndefined()
  expect(readTargetFor({ ...input, snapshot: { ...input.snapshot,
    items: [...committed.items, { ...queued, shown: false }] } })).toBe(10)
})

it('isolates thread pending targets by host and epoch and retries only evidenced versions', () => {
  let epoch: string | undefined = 'e', connected = true
  let rows = [{ ...row(), last_shown_version: 10 }, { ...row('b'), last_shown_version: 99 }]
  const send = vi.fn()
  const p = createReadPublisher({ rows: () => rows, connected: () => connected, send, epoch: () => epoch })
  p.observe('a', 'c', 10, 'e')
  expect(send.mock.calls.map(c => c[0].serverId)).toEqual(['a'])
  rows = rows.map(r => ({ ...r, last_shown_version: 50, read_up_to: r.serverId === 'a' ? 4 : 99 }))
  p.sync(); connected = false; p.sync(); connected = true; p.sync()
  expect(send.mock.calls.map(c => c[0].payload.up_to)).toEqual([10, 10])
  epoch = 'new'; p.sync(); connected = false; p.sync(); connected = true; p.sync()
  p.observe('a', 'c', 50, 'e')
  expect(send).toHaveBeenCalledTimes(2)
  p.observe('a', 'c', 50, 'new')
  expect(send).toHaveBeenCalledTimes(3)
  rows = rows.filter(r => r.serverId !== 'a'); p.sync()
  rows = [{ ...row(), last_shown_version: 99 }]; p.sync()
  expect(send).toHaveBeenCalledTimes(3)
})

const row = (host = 'a', latest = 20, read = 0) => ({ id: 'c', serverId: host,
  read_up_to: read, last_shown_version: latest, latest_entry_id: 999 })

it('uses compact authority paired with committed rows, never retained complete progress', () => {
  const snapshot = { hostId: 'a', conversationId: 'c', epoch: 'e', version: 0, checkpoint: 0,
    ranges: [], repair: null, items: [{ id: 5, rev: 1, kind: 'agent', order: 5, shown: true, status: 'done' }] }
  let current = true
  const compact = { snapshot, through: 10, roots: new Set([5]), routeEpoch: 'opening', current: () => current }
  const input = { snapshot, row: row('a', 10), completeThrough: 999, compact }
  expect(readTargetFor(input)).toBe(10)
  expect(readTargetFor({ ...input, row: row('a', 11) })).toBeUndefined()
  expect(readTargetFor({ ...input, snapshot: { ...snapshot } })).toBeUndefined()
  expect(readTargetFor({ ...input, compact: { ...compact, roots: new Set<number>() } })).toBeUndefined()
  expect(readTargetFor({ ...input, compact: { ...compact, through: 0 } })).toBeUndefined()
  current = false
  expect(readTargetFor(input)).toBeUndefined()
})

it('certifies compact roots only from newest completion and contiguous live progress, retiring reused scopes', () => {
  const sent: RendererCommand[] = []
  const compact = createThreadCompact({ send: c => sent.push(c), invalidate: () => {}, changed: () => {},
    failure: () => {}, detailEvent: () => false, admitDispatch: () => true, log: () => {} })
  const connect = () => compact.event({ type: 'connected', serverId: 'a', ack: { server_id: 'a',
    capabilities: ['interactive', 'thread', 'thread_expansion', 'thread_compact'] } } as any)
  const item = (id = 5, shown = true) => ({ id, rev: 1, kind: 'agent', order: id, shown, status: 'done', active: false, summary: '' })
  const request = () => sent.filter(c => c.type === 'queryThread').at(-1)!
  const reply = (version: number, final: boolean, extra = {}) => compact.event({ type: 'threadReply', serverId: 'a',
    conversationId: 'c', requestId: (request() as any).requestId, inReplyTo: 1,
    reply: { type: 'thread_items', payload: { conversation_id: 'c', epoch: 'e', projection: 'compact-v1',
      version, final, items: final ? [] : [item()], ...extra } } } as any)
  const update = (from: number, version: number, id: number, shown = true) => compact.event({ type: 'threadCompactUpdate', serverId: 'a', conversationId: 'c',
    update: { type: 'thread_compact_update', payload: { conversation_id: 'c', epoch: 'e', projection: 'compact-v1',
      from_version: from, version, progress: false, item: item(id, shown) } } } as any)
  const input = (target = 10) => {
    const held = compact.snapshot('a', 'c')!
    const snapshot: ThreadSnapshot = { hostId: 'a', conversationId: 'c', epoch: held.epoch,
      version: 999, checkpoint: 999, ranges: [{ start: 0, end: 100 }], repair: null, items: held.rows.map(r => ({ ...r })) }
    return { snapshot, compact: compact.readEvidence(snapshot, held), completeThrough: 999, row: row('a', target) }
  }
  connect(); compact.open('a', 'c')
  reply(10, false)
  expect(readTargetFor(input())).toBeUndefined()
  reply(10, true, { lower_order: 5, upper_order: 6, older_exists: true })
  const committed = input()
  expect(readTargetFor(committed)).toBe(10)
  compact.query('retry', 'a')
  update(10, 11, 6)
  expect(readTargetFor(input(11))).toBe(11)
  reply(10, false); reply(10, true, { from_version: 10 })
  expect(readTargetFor(input(11))).toBe(11) // An overlapping older capture cannot withdraw admitted live proof.
  expect(readTargetFor({ ...committed, row: row('a', 11) })).toBeUndefined()
  update(11, 12, 7, false)
  expect(readTargetFor(input(11))).toBe(11)
  update(14, 15, 8)
  expect(readTargetFor(input(15))).toBeUndefined()
  update(15, 16, 9)
  expect(readTargetFor(input(16))).toBeUndefined()
  reply(16, false)
  reply(16, true, { from_version: 10 })
  expect(readTargetFor(input(16))).toBe(16)
  compact.query('older', 'a')
  reply(99, false)
  reply(99, true, { lower_order: 1, upper_order: 5, older_exists: false })
  expect(readTargetFor(input(99))).toBeUndefined()
  const beforeClose = input(16)
  compact.close(); compact.open('a', 'c')
  expect(readTargetFor(beforeClose)).toBeUndefined()
  const beforeReset = input(16)
  compact.event({ type: 'threadReply', serverId: 'a', conversationId: 'c', requestId: (request() as any).requestId,
    inReplyTo: 1, reply: { type: 'thread_reset', payload: { conversation_id: 'c', epoch: 'e', projection: 'compact-v1' } } } as any)
  expect(readTargetFor(beforeReset)).toBeUndefined()
  expect(readTargetFor(input(16))).toBeUndefined()
  reply(20, false); reply(20, true, { lower_order: 5, upper_order: 6, older_exists: false })
  const beforeDisconnect = input(20)
  compact.event({ type: 'disconnected', serverId: 'a' } as any); connect()
  expect(readTargetFor(beforeDisconnect)).toBeUndefined()
  const beforeDelete = input(20)
  expect(readTargetFor(beforeDelete)).toBe(20)
  compact.retire('a', 'c', true); compact.open('a', 'c')
  expect(readTargetFor(beforeDelete)).toBeUndefined()
  reply(30, false); reply(30, true, { lower_order: 5, upper_order: 6, older_exists: false })
  const beforeUnpair = input(30)
  expect(readTargetFor(beforeUnpair)).toBe(30)
  compact.retire('a', undefined, true)
  expect(readTargetFor(beforeUnpair)).toBeUndefined()
  connect(); compact.open('a', 'c')
  reply(40, false); reply(40, true, { lower_order: 5, upper_order: 6, older_exists: false })
  const beforeSuspend = input(40)
  expect(readTargetFor(beforeSuspend)).toBe(40)
  compact.suspend()
  expect(readTargetFor(beforeSuspend)).toBeUndefined()
  connect(); compact.open('a', 'c')
  reply(40, false); reply(40, true, { from_version: 40 })
  const beforeDispose = input(40)
  expect(readTargetFor(beforeDispose)).toBe(40)
  compact.dispose()
  expect(readTargetFor(beforeDispose)).toBeUndefined()
})

describe('observed read publication', () => {
  it('coalesces offline targets, deduplicates attempts and resends once per reconnect', () => {
    let connected = false
    let rows = [row()]
    const send = vi.fn()
    const p = createReadPublisher({ rows: () => rows, connected: () => connected, send, epoch: () => 'e' })
    p.sync(); p.observe('a', 'c', 4, 'e'); p.observe('a', 'c', 8, 'e')
    expect(send).not.toHaveBeenCalled()
    connected = true; p.sync(); p.sync(); p.observe('a', 'c', 8, 'e')
    expect(send.mock.calls.map(c => c[0].payload.up_to)).toEqual([8])
    connected = false; p.sync(); connected = true; p.sync(); p.sync()
    expect(send).toHaveBeenCalledTimes(2)
    rows = [row('a', 20, 8)]; p.sync()
    connected = false; p.sync(); connected = true; p.sync()
    expect(send).toHaveBeenCalledTimes(2)
  })
  it('retains failed, refused and clamped targets without an automatic loop', () => {
    let rows = [row()]
    const send = vi.fn(() => { throw new Error('synthetic send failure') })
    const p = createReadPublisher({ rows: () => rows, connected: () => true, send, epoch: () => 'e' })
    p.sync(); p.observe('a', 'c', 12, 'e'); p.observe('a', 'c', 12, 'e'); p.sync()
    rows = [row('a', 20, 4)]; p.sync(); p.sync()
    expect(send).toHaveBeenCalledTimes(1)
    p.observe('a', 'c', 15, 'e')
    expect(send).toHaveBeenCalledTimes(2)
  })
  it('rejects bad numbers/duplicate owning rows and never redirects removed ownership', () => {
    let rows = [row()]
    const send = vi.fn()
    const p = createReadPublisher({ rows: () => rows, connected: () => true, send, epoch: () => 'e' })
    p.sync()
    for (const n of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) p.observe('a', 'c', n, 'e')
    rows = [row(), row()]; p.observe('a', 'c', 12, 'e')
    expect(send).not.toHaveBeenCalled()
    rows = [row()]; p.observe('a', 'c', 12, 'e')
    rows = [row('b')]; p.sync(); rows = [row()]; p.sync()
    expect(send).toHaveBeenCalledTimes(1)
    p.forget('a', 'c'); p.sync(); rows = []; p.sync()
    expect(send).toHaveBeenCalledTimes(1)
  })
})
