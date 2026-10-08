import { describe, expect, it, vi } from 'vitest'
import { createReadPublisher, readTargetFor } from './conversationReadPublisher'
import { createConversationTimelineStore } from './conversationTimelineStore'
import { initialTimelineState } from './threadTimeline'
import { parseChatHistorySnapshot } from '@shared/chatHistory'

const row = (host = 'a', latest = 20, read = 0) => ({ id: 'c', serverId: host,
  read_up_to: read, latest_entry_id: latest })

describe('observed read publication', () => {
  it('coalesces offline targets, deduplicates attempts and resends once per reconnect', () => {
    let connected = false
    let rows = [row()]
    const send = vi.fn()
    const p = createReadPublisher({ rows: () => rows, connected: () => connected, send })
    p.sync(); p.observe('a', 'c', 4); p.observe('a', 'c', 8)
    expect(send).not.toHaveBeenCalled()
    connected = true; p.sync(); p.sync(); p.observe('a', 'c', 8)
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
    const p = createReadPublisher({ rows: () => rows, connected: () => true, send })
    p.sync(); p.observe('a', 'c', 12); p.observe('a', 'c', 12); p.sync()
    rows = [row('a', 20, 4)]; p.sync(); p.sync()
    expect(send).toHaveBeenCalledTimes(1)
    p.observe('a', 'c', 15)
    expect(send).toHaveBeenCalledTimes(2)
  })
  it('rejects bad numbers/ambiguous hosts and never redirects removed ownership', () => {
    let rows = [row()]
    const send = vi.fn()
    const p = createReadPublisher({ rows: () => rows, connected: () => true, send })
    p.sync()
    for (const n of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) p.observe('a', 'c', n)
    rows = [row(), row('b')]; p.observe('a', 'c', 12)
    expect(send).not.toHaveBeenCalled()
    rows = [row()]; p.observe('a', 'c', 12)
    rows = [row('b')]; p.sync(); rows = [row()]; p.sync()
    expect(send).toHaveBeenCalledTimes(1)
    p.forget('a', 'c'); p.sync(); rows = []; p.sync()
    expect(send).toHaveBeenCalledTimes(1)
  })
})

it('only committed retained contributions prove a target, including zero and folded live entries', () => {
  const store = createConversationTimelineStore()
  const delta = { type: 'assistantDelta' as const, turnId: 't', seq: 0, text: 'one' }
  store.getState().dispatchFor('c', delta, undefined, 0)
  const committed = store.getState().timelines.get('c')!
  expect(readTargetFor(committed)).toBe(0)
  store.getState().dispatchFor('c', { ...delta, seq: 1, text: 'two' }, undefined, 12)
  expect(readTargetFor(committed)).toBe(0)
  const current = store.getState().timelines.get('c')!
  expect(current.timeline.items).toHaveLength(1)
  expect(readTargetFor(current)).toBe(12)
  const snapshot = parseChatHistorySnapshot({ version: 1, kind: 'timeline', serverId: 'a',
    conversationId: 'c', items: current.timeline.items, prependedRows: 0,
    coverage: { status: 'unknown' }, display: current.display,
    rowIdentity: { rowKeys: current.timeline.rowKeys, nextRowKey: current.timeline.nextRowKey } })
  expect(snapshot.kind).toBe('timeline')
  if (snapshot.kind !== 'timeline') throw new Error('expected timeline')
  expect(readTargetFor({ ...current, display: snapshot.kind === 'timeline' ? snapshot.display : [] })).toBe(12)
  const restored = createConversationTimelineStore()
  restored.getState().beginLocalTimelineRead('a', 'c')?.complete(snapshot)
  expect(readTargetFor(restored.getState().timelines.get('c'))).toBe(12)
  expect(() => parseChatHistorySnapshot({ ...snapshot, display: [{ kind: 'row', id: 12, rowKey: 999, item: current.timeline.items[0] }] })).toThrow()
  expect(readTargetFor({ ...current, display: undefined, served: undefined })).toBeUndefined()
  expect(readTargetFor({ ...current, timeline: initialTimelineState })).toBeUndefined()
})

it('retains folded result and state evidence but not an orphan or ID-less change', () => {
  const store = createConversationTimelineStore()
  const result = { type: 'toolResult' as const, turnId: 't', toolUseId: 'tool', isError: false, resultSummary: 'done' }
  store.getState().dispatchFor('c', result, undefined, 99)
  expect(readTargetFor(store.getState().timelines.get('c'))).toBeUndefined()
  store.getState().dispatchFor('c', { type: 'assistantDelta', turnId: 't', seq: 0, text: 'reply' }, undefined, 1)
  store.getState().dispatchFor('c', { type: 'toolUse', turnId: 't', toolUseId: 'tool', name: 'Read', inputSummary: 'input' }, undefined, 2)
  store.getState().dispatchFor('c', result, undefined, 3)
  expect(readTargetFor(store.getState().timelines.get('c'))).toBe(3)
  store.getState().dispatchFor('c', { type: 'turnState', state: 'thinking' }, undefined, 4)
  expect(readTargetFor(store.getState().timelines.get('c'))).toBe(4)
  store.getState().dispatchFor('c', { type: 'turnState', state: 'idle' })
  expect(readTargetFor(store.getState().timelines.get('c'))).toBe(4)
})

it('keeps live fragment identity usable when history fills a missing fragment', () => {
  const store = createConversationTimelineStore()
  for (const [id, text] of [[1, 'one'], [3, 'three']] as const) {
    store.getState().dispatchFor('c', { type: 'assistantDelta', turnId: 't', seq: id, text }, undefined, id)
  }
  store.getState().prependHistoryFor('c', [], false, [1, 2, 3].map(id => ({ id, ts: `ts-${id}`,
    event: { type: 'assistantDelta', conversationId: 'c', turnId: 't', seq: id, text: ['one', 'two', 'three'][id - 1] } })))
  expect(store.getState().timelines.get('c')?.timeline.items[0]).toMatchObject({ text: 'onetwothree' })
})
