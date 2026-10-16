import { describe, expect, it, vi } from 'vitest'
import { createReadPublisher, readTargetFor } from './conversationReadPublisher'
import { createThreadItemStore } from './threadItemStore'

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
