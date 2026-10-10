import { describe, expect, it, vi } from 'vitest'
import type { ThreadItem, ThreadUpdate } from '../../../shared/wire/thread'
import { createThreadItemStore, type ThreadBatchCertificate } from './threadItemStore'

const item = (id = 1, rev = 10, extra: Partial<ThreadItem> = {}): ThreadItem => ({
  id, rev, kind: 'assistant_message', status: 'done', active: false, shown: true,
  summary: '', content: { text: 'hello', preserved: true }, ...extra
})
const added = (value = item(), version = value.rev, conversation_id = 'c', epoch = 'e'): ThreadUpdate => ({
  type: 'thread_item_added', payload: { conversation_id, epoch, version, item: value }
})
const append = (base_rev = 10, rev = 20, text = '!', version = rev): ThreadUpdate => ({
  type: 'thread_text_append', payload: { conversation_id: 'c', epoch: 'e', version, item_id: 1, base_rev, rev, text }
})
const changed = (changes: Record<string, unknown>, base_rev = 10, rev = 20): ThreadUpdate => ({
  type: 'thread_item_changed', payload: { conversation_id: 'c', epoch: 'e', version: rev, item_id: 1, base_rev, rev, changes }
})
const certificate = (version = 30, extra: Partial<ThreadBatchCertificate> = {}): ThreadBatchCertificate => ({
  fromVersion: 0, version, ranges: [{ start: 10, end: 30 }], olderAvailable: true, ...extra
})
function setup() {
  const store = createThreadItemStore()
  const api = store.getState()
  api.acceptEpoch('h', 'c', 'e')
  const snapshot = () => api.snapshot('h', 'c')!
  const batch = () => api.beginBatch('h', 'c', 'e')!
  return { store, api, snapshot, batch }
}

describe('daemon thread item retention', () => {
  it('sorts only by order, retaining hidden/unknown facts and stable unordered arrival', () => {
    const { api, snapshot } = setup()
    api.applyUpdate('h', added(item(9, 10, { shown: false, active: true, status: 'future', kind: 'future', parent: 8 })))
    api.applyUpdate('h', added(item(2, 10)))
    api.applyUpdate('h', added(item(7, 10, { order: 50, session: 's', agent: 'codex', turn: 't' })))
    api.applyUpdate('h', added(item(3, 10, { order: 20 })))
    expect(snapshot().items.map(i => i.id)).toEqual([3, 7, 9, 2])
    expect(snapshot().items[2]).toMatchObject({ shown: false, active: true, status: 'future', parent: 8 })
    expect(snapshot().items[1]).toMatchObject({ session: 's', agent: 'codex', turn: 't' })
    api.applyUpdate('h', added(item(9, 30, { kind: 'future', order: 10 })))
    expect(snapshot().items.map(i => i.id)).toEqual([9, 3, 7, 2])
    api.applyUpdate('h', added(item(7, 40, { order: 20 })))
    expect(snapshot().items.map(i => i.id)).toEqual([9, 7, 3, 2])
  })

  it('applies a suffix once, rejects replay, and accepts an empty suffix', () => {
    const { api, snapshot } = setup()
    api.applyUpdate('h', added())
    expect(api.applyUpdate('h', append())).toEqual({ type: 'applied' })
    const held = snapshot().items[0]
    expect(held.content).toEqual({ text: 'hello!', preserved: true })
    expect(api.applyUpdate('h', append())).toMatchObject({ type: 'repair', reason: 'base', hostId: 'h', conversationId: 'c', epoch: 'e' })
    expect(snapshot().items[0]).toBe(held)
    expect(snapshot().checkpoint).toBe(20)
    api.applyUpdate('h', append(20, 50, ''))
    expect(snapshot().items[0]).toMatchObject({ rev: 50, content: { text: 'hello!' } })
    expect(snapshot().checkpoint).toBe(20)
  })

  it.each([['missing', false, 10], ['base', true, 5]] as const)('repairs %s without changing item/version/checkpoint', (reason, seed, base) => {
    const { api, snapshot } = setup()
    if (seed) api.applyUpdate('h', added())
    const before = snapshot()
    expect(api.applyUpdate('h', changed({ content: {} }, base))).toMatchObject({ type: 'repair', reason })
    expect(snapshot().items).toBe(before.items)
    expect(snapshot().version).toBe(before.version)
    expect(snapshot().checkpoint).toBe(before.checkpoint)
  })

  it('replaces own supplied fields wholesale and retains omitted ones', () => {
    const { api, snapshot } = setup()
    api.applyUpdate('h', added(item(1, 10, { order: 100, session: 's', parent: 4, no_child: true, future: 'old' })))
    api.applyUpdate('h', changed({ summary: '', active: false, shown: false, order: 0, parent: null, no_child: false, future: null, content: {} }))
    expect(snapshot().items[0]).toMatchObject({ id: 1, kind: 'assistant_message', rev: 20, summary: '', active: false, shown: false, order: 0, parent: null, no_child: false, future: null, session: 's', content: {} })
    api.applyUpdate('h', changed({ content: null }, 20, 30))
    expect(snapshot().items[0].content).toBeNull()
  })

  it.each([{ id: 1 }, { kind: 'assistant_message' }])('rejects immutable field replacement atomically: %j', changes => {
    const { api, snapshot } = setup()
    api.applyUpdate('h', added())
    const before = snapshot().items[0]
    expect(api.applyUpdate('h', changed({ summary: 'bad', ...changes }))).toMatchObject({ type: 'repair', reason: 'incompatible' })
    expect(snapshot().items[0]).toBe(before)
  })

  it.each([
    item(1, 10, { kind: 'tool_call' }), item(1, 10, { content: {} }),
    item(1, 10, { content: { text: null } }), item(1, 10, { content: 'text' }),
    item(1, 10, { content: ['text'] })
  ])('rejects append on incompatible held content %j', value => {
    const { api, snapshot } = setup()
    api.applyUpdate('h', added(value))
    const held = snapshot().items[0]
    expect(api.applyUpdate('h', append())).toMatchObject({ type: 'repair', reason: 'incompatible' })
    expect(snapshot().items[0]).toBe(held)
    expect(snapshot().checkpoint).toBe(10)
  })

  it('appends to user messages and rejects a non-increasing revision', () => {
    const { api, snapshot } = setup()
    api.applyUpdate('h', added(item(1, 10, { kind: 'user_message' })))
    expect(api.applyUpdate('h', append(10, 10))).toMatchObject({ type: 'repair', reason: 'incompatible' })
    api.applyUpdate('h', append())
    expect(snapshot().items[0].content).toEqual({ text: 'hello!', preserved: true })
  })

  it('merges full items by revision, removes omitted fields, and never regresses version', () => {
    const { api, snapshot, batch } = setup()
    api.applyUpdate('h', added(item(1, 10, { parent: 3, order: 10, future: 7 }), 100))
    api.applyUpdate('h', append(10, 50, '! ', 200))
    const held = snapshot().items[0]
    const b = batch()
    b.applyItems([item(1, 20, { content: { text: 'delayed' } }), item(2, 5)], 30)
    b.applyItems([item(1, 50, { content: null })], 50)
    expect(snapshot().items[0]).toBe(held)
    expect(snapshot().version).toBe(200)
    expect(snapshot().ranges).toEqual([])
    api.applyUpdate('h', added(item(1, 60), 60))
    expect(snapshot().items.find(i => i.id === 1)).toEqual(item(1, 60))
    expect(snapshot().checkpoint).toBe(200)
  })

  it('signals full-item kind conflict even on an old revision', () => {
    const { api, snapshot, batch } = setup()
    api.applyUpdate('h', added())
    const held = snapshot().items[0]
    expect(api.applyUpdate('h', added(item(1, 5, { kind: 'tool_call' })))).toMatchObject({ type: 'repair', reason: 'kind' })
    const b = batch()
    expect(b.applyItems([item(1, 30, { kind: 'tool_call' })], 30)[0]).toMatchObject({ type: 'repair', reason: 'kind' })
    expect(b.commit(certificate())).toEqual({ type: 'stale' })
    expect(snapshot().items[0]).toBe(held)
  })

  it('detaches and freezes unknown JSON including prototype-like keys without pollution', () => {
    const { api, snapshot } = setup()
    const value = item(1, 10, JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1},"content":{"text":"hello","__proto__":{"a":1}}}'))
    api.applyUpdate('h', added(value))
    value.summary = 'mutated'
    expect(snapshot().items[0].summary).toBe('')
    api.applyUpdate('h', changed(JSON.parse('{"__proto__":{"p":2},"constructor":null}')))
    api.applyUpdate('h', append(20, 30))
    const held = snapshot().items[0]
    expect(Object.prototype.hasOwnProperty.call(held, '__proto__')).toBe(true)
    expect(held.__proto__).toEqual({ p: 2 })
    expect(held.constructor).toBeNull()
    expect(Object.prototype.hasOwnProperty.call(held.content, '__proto__')).toBe(true)
    expect(Object.isFrozen(held.content)).toBe(true)
    expect(Object.getPrototypeOf(held)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('complete progress and batch ownership', () => {
  it('publishes only completed batches and retains newer live facts through delayed completion', () => {
    const { api, snapshot, batch } = setup()
    const b = batch()
    b.applyItems([item(1, 10, { order: 10 }), item(2, 10, { order: 999, active: true, parent: 3 }), item(3, 10, { order: 1 })], 30)
    expect(snapshot()).toMatchObject({ version: 30, checkpoint: 0, ranges: [] })
    api.applyUpdate('h', append(10, 50, 'live', 50))
    expect(snapshot().checkpoint).toBe(0)
    const held = snapshot().items
    expect(b.commit(certificate())).toEqual({ type: 'applied' })
    expect(snapshot().items).toBe(held)
    expect(snapshot()).toMatchObject({ version: 50, checkpoint: 30, ranges: [{ start: 10, end: 30 }], olderAvailable: true })
    expect(b.commit(certificate(100))).toEqual({ type: 'stale' })
  })


  it('cannot certify unfinished progress indirectly through later live successes', () => {
    const { api, snapshot, batch } = setup()
    const incomplete = batch()
    incomplete.applyItems([item()], 30)
    incomplete.abandon()
    api.applyUpdate('h', append(10, 50))
    expect(snapshot()).toMatchObject({ version: 50, checkpoint: 0 })
    batch().commit(certificate(20))
    api.applyUpdate('h', append(50, 60))
    expect(snapshot().checkpoint).toBe(20)
    batch().commit(certificate(30))
    expect(snapshot().checkpoint).toBe(30)
    api.applyUpdate('h', append(60, 70))
    expect(snapshot().checkpoint).toBe(70)
  })

  it('does not reopen exhausted older history from a delayed certificate at the same boundary', () => {
    const { snapshot, batch } = setup()
    batch().commit(certificate(30, { olderAvailable: false }))
    batch().commit(certificate(20, { olderAvailable: true }))
    expect(snapshot().olderAvailable).toBe(false)
  })

  it('abandoned batches retain received items without publishing coverage or checkpoints', () => {
    const { snapshot, batch } = setup()
    const b = batch()
    b.applyItems([item()], 30)
    b.abandon()
    expect(b.commit(certificate())).toEqual({ type: 'stale' })
    expect(b.applyItems([item(2)], 50)).toEqual([{ type: 'stale' }])
    expect(snapshot()).toMatchObject({ version: 30, checkpoint: 0, ranges: [] })
    expect(snapshot().items).toHaveLength(1)
  })

  it('fences live checkpoint progress until a repair completion covers all missing progress', () => {
    const { api, snapshot, batch } = setup()
    api.applyUpdate('h', added())
    api.applyUpdate('h', append(5, 30))
    api.applyUpdate('h', append(10, 50))
    expect(snapshot()).toMatchObject({ version: 50, checkpoint: 10, repair: { fromVersion: 10, throughVersion: 30 } })
    const partial = batch()
    partial.applyItems([item(1, 60)], 60)
    expect(partial.commit(certificate(60, { fromVersion: 30 }))).toMatchObject({ type: 'repair', reason: 'coverage' })
    expect(snapshot().checkpoint).toBe(10)
    api.requireRepair('h', 'c', 'e', 70)
    const short = batch()
    short.applyItems([item(1, 65)], 65)
    expect(short.commit(certificate(65, { fromVersion: 10 }))).toMatchObject({ type: 'repair', reason: 'coverage' })
    const repair = batch()
    repair.applyItems([item(1, 80)], 80)
    expect(repair.commit(certificate(80, { fromVersion: 10 }))).toEqual({ type: 'applied' })
    expect(snapshot()).toMatchObject({ version: 80, checkpoint: 80, repair: null })
    api.applyUpdate('h', append(80, 100))
    expect(snapshot().checkpoint).toBe(100)
  })

  it('uses only certified ranges and keeps availability from the oldest certified boundary', () => {
    const { snapshot, batch } = setup()
    batch().commit(certificate(100, { ranges: [{ start: 50, end: 100 }], olderAvailable: true }))
    batch().commit(certificate(90, { ranges: [{ start: 20, end: 60 }], olderAvailable: false }))
    batch().commit(certificate(110, { ranges: [{ start: 80, end: 110 }], olderAvailable: true }))
    expect(snapshot()).toMatchObject({ checkpoint: 110, version: 110, ranges: [{ start: 20, end: 110 }], olderAvailable: false })
    batch().commit(certificate(120, { ranges: [{ start: 150, end: 200 }] }))
    expect(snapshot().ranges).toEqual([{ start: 20, end: 110 }, { start: 150, end: 200 }])
  })

  it.each([
    certificate(-1), certificate(30, { fromVersion: 40 }), certificate(30, { fromVersion: 10 }),
    certificate(30, { ranges: [{ start: 40, end: 10 }] })
  ])('rejects invalid certification without publishing progress', cert => {
    const { snapshot, batch } = setup()
    expect(batch().commit(cert)).toMatchObject({ type: 'repair', reason: 'coverage' })
    expect(snapshot()).toMatchObject({ checkpoint: 0, ranges: [] })
  })
})

describe('scope cleanup and epoch identity', () => {
  it('isolates equal identities across hosts and conversations and keeps untouched references', () => {
    const { api, snapshot } = setup()
    for (const [h, c] of [['other', 'c'], ['h', 'other']]) {
      api.acceptEpoch(h, c, 'e')
      api.applyUpdate(h, added(item(), 10, c))
    }
    const otherHost = api.snapshot('other', 'c'), otherConversation = api.snapshot('h', 'other')
    api.applyUpdate('h', added())
    api.applyUpdate('h', append())
    expect(api.snapshot('other', 'c')).toBe(otherHost)
    expect(api.snapshot('h', 'other')).toBe(otherConversation)
    expect(snapshot().items[0].content).toMatchObject({ text: 'hello!' })
    expect(api.snapshot('absent', 'c')).toBeNull()
  })

  it('accepts the same epoch idempotently, clears all facts on replacement, and rejects old work', () => {
    const { api, snapshot, batch } = setup()
    api.applyUpdate('h', added())
    batch().commit(certificate())
    api.requireRepair('h', 'c', 'e', 40)
    const old = batch(), before = snapshot()
    api.acceptEpoch('h', 'c', 'e')
    expect(snapshot()).toBe(before)
    api.acceptEpoch('h', 'c', 'new')
    expect(snapshot()).toMatchObject({ epoch: 'new', items: [], checkpoint: 0, version: 0, ranges: [], repair: null })
    expect(api.applyUpdate('h', added())).toEqual({ type: 'stale' })
    api.acceptEpoch('h', 'c', 'e')
    expect(old.applyItems([item()], 100)).toEqual([{ type: 'stale' }])
    expect(old.commit(certificate(100))).toEqual({ type: 'stale' })
    expect(snapshot().items).toEqual([])
  })

  it.each(['conversation', 'host', 'pairing'] as const)('cannot revive cleared %s state, even after identical epoch reuse', mode => {
    const { api, snapshot, batch } = setup()
    api.acceptEpoch('other', 'c', 'e')
    api.applyUpdate('other', added())
    api.applyUpdate('h', added())
    const stale = batch(), survivor = api.snapshot('other', 'c')
    if (mode === 'conversation') api.deleteConversation('h', 'c')
    if (mode === 'host') api.removeHost('h')
    if (mode === 'pairing') api.clearAll()
    expect(api.snapshot('h', 'c')).toBeNull()
    expect(stale.commit(certificate())).toEqual({ type: 'stale' })
    expect(api.snapshot('h', 'c')).toBeNull()
    api.acceptEpoch('h', 'c', 'e')
    expect(stale.applyItems([item(1, 100)], 100)).toEqual([{ type: 'stale' }])
    expect(snapshot().items).toEqual([])
    expect(api.snapshot('other', 'c')).toBe(mode === 'pairing' ? null : survivor)
  })

  it('uses hostile scope strings as Map keys and emits content-free diagnostics', () => {
    const log = { event: vi.fn() }, store = createThreadItemStore(log), api = store.getState()
    api.acceptEpoch('__proto__', 'constructor', 'secret-epoch')
    api.applyUpdate('__proto__', added(item(1, 10, { summary: 'secret text' }), 10, 'constructor', 'secret-epoch'))
    api.requireRepair('__proto__', 'constructor', 'secret-epoch', 20)
    expect(api.snapshot('__proto__', 'constructor')?.items).toHaveLength(1)
    api.removeHost('__proto__')
    expect(JSON.stringify(log.event.mock.calls)).not.toMatch(/secret|__proto__|constructor/)
    expect(log.event.mock.calls.length).toBeGreaterThanOrEqual(4)
  })
})
