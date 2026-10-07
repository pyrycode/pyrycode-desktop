import { expect, it, vi } from 'vitest'
import { createConversationTimelineStore } from './conversationTimelineStore'
import { requestGapHistory, requestOlderHistory, type HistoryAskDeps } from './historyPageBridge'
import { parseChatHistorySnapshot } from '@shared/chatHistory'
import type { HistoryTimelineEntry } from '@shared/ipc/events'
import { retryHistoryPage } from '../screens/conversation/historyRetry'

const entry = (id: number): HistoryTimelineEntry => ({ id, ts: `ts-${id}`, event: {
  type: 'messageReceived', message: { role: 'user', message_id: `m-${id}`, text: `row-${id}` }
} })
function harness() {
  const store = createConversationTimelineStore(undefined, () => 'host')
  const held = () => store.getState().timelines.get('c')!
  const deps: HistoryAskDeps = { getHeld: () => held(), sendCommand: vi.fn(),
    markRequested: (_id, cursor, purpose, gapId) => store.getState().markHistoryRequested('c', 'host', cursor, purpose, gapId) }
  const page = (ids: number[], cursor = 'position', purpose: 'older' | 'newest' | 'gap' = 'older', drawable = ids) => {
    store.getState().markHistoryRequested('c', 'host', cursor, purpose, purpose === 'gap' ? held().gaps?.[0].olderId : undefined)
    store.getState().prependHistoryFor('c', [], false, drawable.map(entry))
    store.getState().recordHistoryPage('c', cursor, true, ids)
  }
  const snapshot = () => ({ version: 1, kind: 'timeline', serverId: 'host', conversationId: 'c',
    items: held().timeline.items, prependedRows: held().prependedRows, coverage: held().coverage,
    served: held().served, display: held().display, gaps: held().gaps,
    rowIdentity: { rowKeys: held().timeline.rowKeys, nextRowKey: held().timeline.nextRowKey } })
  return { store, held, deps, page, snapshot }
}

it('places disjoint newest rows after held history and marks only missing served IDs', () => {
  const h = harness()
  h.page([1, 2], 'oldest')
  h.page([5, 6], 'newer', 'newest')
  expect(h.held().timeline.items.map(i => 'text' in i ? i.text : '')).toEqual(['row-1', 'row-2', 'row-5', 'row-6'])
  expect(h.held().gaps).toEqual([{ olderId: 2, newerId: 5, cursor: 'newer' }])
  expect(h.held().coverage).toEqual({ status: 'received', cursor: 'oldest', atStart: true })
})

it.each([[1, 2], [3, 4], [2, 3]].map(ids => [ids]))('first opening, adjacency and high-water overlap create no gaps: %j', ids => {
  const h = harness()
  h.page([1, 2])
  h.page(ids, 'newer', 'newest')
  expect(h.held().gaps ?? []).toEqual([])
})

it('first opening has no held boundary and newest high-water overlap creates no tail marker', () => {
  const first = harness(); first.page([2, 4], 'opening', 'newest')
  expect(first.held().gaps ?? []).toEqual([])
  const overlap = harness(); overlap.page([1, 2])
  overlap.page([2, 5, 6], 'overlap', 'newest')
  expect(overlap.held().gaps ?? []).toEqual([])
  expect(overlap.held().served?.ids).toEqual([1, 2, 5, 6])
})

it('walks a gap once per fresh ask despite held atStart and preserves older completion', () => {
  const h = harness()
  h.page([1, 2], 'oldest')
  h.page([6, 7], 'newer', 'newest')
  requestOlderHistory(h.deps, 'c', true)
  expect(h.deps.sendCommand).not.toHaveBeenCalled()
  requestGapHistory(h.deps, 'c', 2)
  requestGapHistory(h.deps, 'c', 2)
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(1)
  h.page([5, 6], 'step', 'gap', [])
  expect(h.held().gaps).toEqual([{ olderId: 2, newerId: 5, cursor: 'step' }])
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(1)
  requestGapHistory(h.deps, 'c', 2)
  expect(h.deps.sendCommand).toHaveBeenLastCalledWith({ type: 'requestHistory', payload: { conversation_id: 'c', cursor: 'step', limit: 200 } })
  h.page([3, 4], 'done', 'gap', [])
  expect(h.held().gaps ?? []).toEqual([])
  expect(h.held().coverage).toEqual({ status: 'received', cursor: 'oldest', atStart: true })
})

it('newest overlap keeps older holes and fallback walks covered newer pages', () => {
  const h = harness()
  h.page([1, 3], 'below')
  h.page([4, 5], 'above', 'newest')
  expect(h.held().gaps).toEqual([{ olderId: 1, newerId: 3 }])
  requestGapHistory(h.deps, 'c', 1)
  expect(h.deps.sendCommand).toHaveBeenLastCalledWith({ type: 'requestHistory', payload: { conversation_id: 'c', cursor: 'above', limit: 200 } })
  h.page([3], 'resume', 'gap', [])
  expect(h.held().gaps?.[0].cursor).toBe('resume')
})

it('valid skipped IDs cover holes and protected fresh restoration preserves resume only', () => {
  const h = harness()
  h.page([1, 2, 3], 'one', 'older', [1, 3])
  expect(h.held().gaps ?? []).toEqual([])
  h.page([6], 'two', 'newest')
  const parsed = parseChatHistorySnapshot(JSON.parse(JSON.stringify(h.snapshot())))
  const fresh = harness()
  if (parsed.kind !== 'timeline') throw new Error('Expected timeline')
  fresh.store.getState().beginLocalTimelineRead('host', 'c')!.complete(parsed)
  expect(fresh.held().gaps).toEqual(h.held().gaps)
  expect(fresh.held().history).toBeNull()
  requestGapHistory(fresh.deps, 'c', 3)
  expect(fresh.deps.sendCommand).toHaveBeenCalledTimes(1)
})

it.each([
  [{ olderId: -1, newerId: 6 }], [{ olderId: 3, newerId: 4 }], [{ olderId: 6, newerId: 3 }],
  [{ olderId: 3, newerId: 6, cursor: 1 }], [{ olderId: 3, newerId: 6 }, { olderId: 4, newerId: 8 }]
].map(gaps => [gaps]))('rejects invalid declared protected gaps %j', gaps => {
  const h = harness(); h.page([1, 3, 6])
  expect(() => parseChatHistorySnapshot({ ...h.snapshot(), gaps })).toThrow()
})

it('one-entry holes settle, while empty and covered pages advance only resume evidence', () => {
  const h = harness(); h.page([1]); h.page([3], 'newer', 'newest')
  h.page([], 'empty-step', 'gap')
  expect(h.held().gaps).toEqual([{ olderId: 1, newerId: 3, cursor: 'empty-step' }])
  h.page([2], 'done', 'gap', [])
  expect(h.held().gaps).toEqual([])
})

it('Retry targets only the current owned failed gap despite held atStart', () => {
  const h = harness(); h.page([1]); h.page([3], 'newer', 'newest')
  requestGapHistory(h.deps, 'c', 1)
  h.store.getState().recordHistoryFailure('c', 'unclassified', true)
  const failure = h.held().history!
  if (failure.status !== 'failed') throw new Error('Expected failure')
  const open = { id: 'c' }
  const deps = { ...h.deps, getOpen: () => open, getConnectedHost: () => 'host',
    getHeld: () => h.held(), logRequested: vi.fn() }
  retryHistoryPage(deps, open, 'other', failure)
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(1)
  retryHistoryPage(deps, open, 'host', failure)
  retryHistoryPage(deps, open, 'host', failure)
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(2)
  h.page([2], 'done', 'gap', [])
  retryHistoryPage(deps, open, 'host', failure)
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(2)
})

it.each(['gap', 'newest', 'older'] as const)('a failed %s ask leaves an unrelated gap eligible, including nonretryable failures', purpose => {
  for (const retryable of [true, false]) {
    const h = harness(); h.page([1]); h.page([3], 'first', 'newest'); h.page([5], 'second', 'newest')
    h.store.getState().markHistoryRequested('c', 'host', 'failed-position', purpose, purpose === 'gap' ? 3 : undefined)
    h.store.getState().recordHistoryFailure('c', retryable ? 'history-unavailable' : 'history-invalid-cursor', retryable)
    const failed = h.held().history
    if (purpose === 'gap') {
      requestGapHistory(h.deps, 'c', 3)
      expect(h.deps.sendCommand).not.toHaveBeenCalled()
      expect(h.held().history).toBe(failed)
    }
    requestGapHistory(h.deps, 'c', 1)
    requestGapHistory(h.deps, 'c', 3)
    expect(h.deps.sendCommand).toHaveBeenCalledTimes(1)
    expect(h.deps.sendCommand).toHaveBeenCalledWith({ type: 'requestHistory', payload: {
      conversation_id: 'c', cursor: 'first', limit: 200 } })
    expect(h.held().history).toMatchObject({ status: 'requested', purpose: 'gap', gapId: 1 })
  }
})

it('read/offline gates send nothing, replacement/removal/eviction discard in-memory evidence', () => {
  const h = harness(); h.page([1]); h.page([3], 'newer', 'newest')
  const saved = h.snapshot()
  requestGapHistory({ ...h.deps, canRequest: () => false }, 'c', 1)
  requestGapHistory({ ...h.deps, getHeld: () => ({ ...h.held(), localRead: 'loading' }) }, 'c', 1)
  expect(h.deps.sendCommand).not.toHaveBeenCalled()
  h.store.getState().markHistoryRequested('c', 'other', '', 'newest')
  expect(h.held().gaps).toBeUndefined()
  const restore = () => h.store.getState().beginLocalTimelineRead('host', 'c')!.complete(saved as any)
  restore()
  for (let index = 0; index < 11; index++) {
    h.store.getState().dispatchFor(`peer-${index}`, { type: 'userText', text: 'peer' })
    h.store.getState().markViewed(`peer-${index}`)
  }
  expect(h.store.getState().timelines.has('c')).toBe(false)
  restore()
  expect(h.held().gaps).toEqual(saved.gaps)
  h.store.getState().clearTimelineFor('c')
  expect(h.store.getState().timelines.has('c')).toBe(false)
  h.store.getState().clearAllTimelines()
  expect(h.store.getState().timelines.size).toBe(0)
})

it('receipt expiration makes exclusive coverage unknown and keeps its unresolved boundary', () => {
  const h = harness(); h.page([1]); h.page([3], 'newer', 'newest')
  h.store.getState().markHistoryRequested('c', 'host', 'newer', 'gap', 1)
  h.store.getState().recordHistoryPage('c', 'oversized', false, Array.from({ length: 100_001 }, (_, id) => id))
  expect(h.held().served).toBeUndefined()
  expect(h.held().gaps).toEqual([{ olderId: 1, newerId: 3, cursor: 'oversized' }])
  expect(() => parseChatHistorySnapshot(h.snapshot())).not.toThrow()
})

it('older disjoint spans use a newer saved position and keep their separate oldest end', () => {
  const h = harness(); h.page([7, 8], 'newer-position')
  h.page([1, 2], 'oldest-position')
  expect(h.held().gaps).toEqual([{ olderId: 2, newerId: 7 }])
  requestGapHistory(h.deps, 'c', 2)
  expect(h.deps.sendCommand).toHaveBeenLastCalledWith({ type: 'requestHistory', payload: {
    conversation_id: 'c', cursor: 'newer-position', limit: 200 } })
  h.page([5, 6], 'walking', 'gap')
  expect(h.held().coverage).toEqual({ status: 'received', cursor: 'oldest-position', atStart: true })
  expect(h.held().gaps).toEqual([{ olderId: 2, newerId: 5, cursor: 'walking' }])
})

it('allowlists optional gap metadata and keeps legacy provenance unknown', () => {
  const h = harness(); h.page([1]); h.page([3], 'position', 'newest')
  const parsed = parseChatHistorySnapshot({ ...h.snapshot(), gaps: [{ olderId: 1, newerId: 3, cursor: 'position', raw: 'discard' }] })
  expect(parsed.kind === 'timeline' && parsed.gaps).toEqual([{ olderId: 1, newerId: 3, cursor: 'position' }])
  const legacy = parseChatHistorySnapshot({ ...h.snapshot(), served: undefined, gaps: undefined })
  expect(legacy.kind === 'timeline' && legacy.gaps).toBeUndefined()
  expect(legacy.kind === 'timeline' && legacy.served).toBeUndefined()
})
