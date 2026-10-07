import { expect, it, vi } from 'vitest'
import { createConversationTimelineStore } from './conversationTimelineStore'
import { requestGapHistory, type HistoryAskDeps } from './historyPageBridge'
import { historyGapId, parseChatHistorySnapshot } from '@shared/chatHistory'
import type { HistoryTimelineEntry } from '@shared/ipc/events'

const entry = (id: number, messageId = `m-${id}`): HistoryTimelineEntry => ({ id, ts: 'same timestamp', event: {
  type: 'messageReceived', message: { role: 'user', message_id: messageId, text: `row-${id}` }
} })
function harness(legacy = true) {
  const store = createConversationTimelineStore(undefined, () => 'host')
  if (legacy) store.getState().beginLocalTimelineRead('host', 'c')!.complete({ version: 1, kind: 'timeline',
    serverId: 'host', conversationId: 'c', items: [{ kind: 'userText', messageId: 'm-1', text: 'held' }],
    prependedRows: 0, coverage: { status: 'received', cursor: 'oldest', atStart: true } })
  const held = () => store.getState().timelines.get('c')!
  const deps: HistoryAskDeps = { getHeld: () => held(), sendCommand: vi.fn(),
    markRequested: (_id, cursor, purpose, gapId) => store.getState().markHistoryRequested('c', 'host', cursor, purpose, gapId) }
  const receive = (entries: HistoryTimelineEntry[], cursor: string, atStart = false) => {
    store.getState().prependHistoryFor('c', [], false, entries)
    store.getState().recordHistoryPage('c', cursor, atStart, entries.map(e => e.id))
  }
  const newest = (ids: number[], cursor = 'newest', atStart = true) => {
    store.getState().markHistoryRequested('c', 'host', '', 'newest')
    receive(ids.map(id => entry(id)), cursor, atStart)
  }
  const demand = () => requestGapHistory(deps, 'c', historyGapId(held().gaps![0]))
  const refuse = () => store.getState().recordHistoryFailure('c', 'history-invalid-cursor', false)
  const snapshot = () => ({ version: 1, kind: 'timeline', serverId: 'host', conversationId: 'c',
    items: held().timeline.items, prependedRows: held().prependedRows, coverage: held().coverage,
    served: held().served, display: held().display, gaps: held().gaps, newestCursor: held().newestCursor,
    rowIdentity: { rowKeys: held().timeline.rowKeys, nextRowKey: held().timeline.nextRowKey } })
  return { store, held, deps, receive, newest, demand, refuse, snapshot }
}
it('legacy boundary survives held/newest atStart, covered walks and fresh restoration', () => {
  const h = harness(), row = h.held().timeline.items[0]
  h.newest([10, 11])
  expect(h.held().gaps).toEqual([{ legacyRowKeys: [0], newerId: 10, cursor: 'newest' }])
  expect(h.held().timeline.items[0]).toBe(row)
  expect(h.held().timeline.rowKeys?.[0]).toBe(0)
  h.demand(); h.demand()
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(1)
  h.receive([entry(10)], 'covered')
  expect(h.held().gaps?.[0].cursor).toBe('covered')
  h.demand()
  h.receive([entry(9)], 'walk')
  expect(h.held().timeline.items.map(i => 'text' in i ? i.text : '')).toEqual(['held', 'row-9', 'row-10', 'row-11'])
  expect(h.held().coverage).toEqual({ status: 'received', cursor: 'oldest', atStart: true })
  const fresh = harness(false)
  const parsed = parseChatHistorySnapshot(JSON.parse(JSON.stringify(h.snapshot())))
  if (parsed.kind !== 'timeline') throw new Error('Expected timeline')
  fresh.store.getState().beginLocalTimelineRead('host', 'c')!.complete(parsed)
  expect(fresh.held().gaps).toEqual(h.held().gaps)
  expect(fresh.held().history).toBeNull()
  fresh.demand(); fresh.receive([], 'beginning', true)
  expect(fresh.held().gaps).toEqual([])
})
it('only provable held identity overlap resolves unknown provenance', () => {
  const h = harness(); h.newest([10]); h.demand()
  h.receive(Array.from({ length: 9 }, (_, index) => entry(index + 1)), 'overlap')
  expect(h.held().gaps).toEqual([])
  expect(h.held().timeline.items.filter(i => i.kind === 'userText' && i.messageId === 'm-1')).toHaveLength(1)
  const unknown = harness()
  unknown.store.setState({ timelines: new Map([['c', { ...unknown.held(), timeline: { ...unknown.held().timeline, items: [{ kind: 'userText', text: 'held' }] } }]]) })
  unknown.newest([10]); unknown.demand(); unknown.receive(Array.from({ length: 9 }, (_, index) => entry(index + 1)), 'unproven')
  expect(unknown.held().gaps).toHaveLength(1)
})
it('refusal invalidates only its owned gap and uses a usable latest newest origin', () => {
  const h = harness(false); h.newest([1]); h.newest([4], 'first'); h.newest([7], 'latest')
  requestGapHistory(h.deps, 'c', 1)
  const rows = h.held().timeline.items, coverage = h.held().coverage
  h.refuse()
  expect(h.held().gaps).toEqual([{ olderId: 1, newerId: 4, refusedCursors: ['first'] }, { olderId: 4, newerId: 7, cursor: 'latest' }])
  expect(h.held().timeline.items).toBe(rows)
  expect(h.held().coverage).toBe(coverage)
  requestGapHistory(h.deps, 'c', 1)
  expect(h.deps.sendCommand).toHaveBeenLastCalledWith({ type: 'requestHistory', payload: { conversation_id: 'c', cursor: 'latest', limit: 200 } })
})
it('absent/refused origins acquire once per input without reusing refused replies or treating acquisition atStart as completion', () => {
  const h = harness(); h.newest([10]); h.demand(); h.refuse()
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(1)
  h.demand(); h.demand()
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(2)
  expect(h.held().history).toMatchObject({ purpose: 'gap-newest' })
  h.receive([entry(10)], 'newest', true)
  expect(h.held().gaps).toHaveLength(1)
  expect(h.held().gaps?.[0].cursor).toBeUndefined()
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(2)
  h.demand(); h.receive([entry(10)], 'fresh', true)
  expect(h.held().gaps?.[0].cursor).toBe('fresh')
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(3)
  h.demand(); h.refuse(); h.demand()
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(5)
  expect(h.held().gaps?.[0].refusedCursors).toEqual(['newest', 'fresh'])
  expect(h.held().coverage).toMatchObject({ cursor: 'oldest' })
})
it.each([
  { legacyRowKeys: [999], newerId: 10 }, { legacyRowKeys: [], newerId: 10 },
  { olderId: 1, newerId: 10, refusedCursors: [2] },
  { olderId: 1, newerId: 10, cursor: undefined },
  { olderId: 1, newerId: 10, refusedCursors: ['bad', 'bad'] },
  { olderId: 1, newerId: 10, cursor: 'bad', refusedCursors: ['bad'] },
])('rejects invalid declared recovery evidence %j', gap => {
  const h = harness(); h.newest([10])
  expect(() => parseChatHistorySnapshot({ ...h.snapshot(), gaps: [gap] })).toThrow()
})
it('projects evidence fields and validates optional newest origins', () => {
  const h = harness(); h.newest([10]); h.demand(); h.refuse()
  const parsed = parseChatHistorySnapshot({ ...h.snapshot(), ignored: 'x' })
  expect(parsed).toMatchObject({ newestCursor: 'newest', gaps: [{ legacyRowKeys: [0], refusedCursors: ['newest'] }] })
  expect(parsed).not.toHaveProperty('ignored')
  expect(() => parseChatHistorySnapshot({ ...h.snapshot(), newestCursor: 1 })).toThrow()
})

it('absent newest evidence acquires under the selected gap, retaining oldest coverage', () => {
  const h = harness(); h.newest([10]); h.demand(); h.refuse()
  h.store.setState({ timelines: new Map([['c', { ...h.held(), newestCursor: undefined }]]) })
  h.demand()
  expect(h.held().history).toMatchObject({ status: 'requested', purpose: 'gap-newest', gapId: 'legacy:0', cursor: '' })
  h.receive([], 'origin', true)
  expect(h.held().gaps).toHaveLength(1)
  expect(h.held().coverage).toMatchObject({ cursor: 'oldest', atStart: true })
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(2)
  h.demand()
  expect(h.held().history).toMatchObject({ purpose: 'gap', cursor: 'origin' })
})
it('ambiguous timestamps and duplicate message identities never prove a legacy join', () => {
  const h = harness()
  h.store.setState({ timelines: new Map([['c', { ...h.held(), timeline: { ...h.held().timeline,
    items: [{ kind: 'assistantText', turnId: 't', text: 'held' }], rowKeys: [0], nextRowKey: 1 } }]]) })
  h.newest([10]); h.demand()
  h.receive([1, 2].map(id => ({ id, ts: 'same', event: { type: 'assistantDelta', turnId: 't', seq: id, text: 'held' } })), 'ambiguous')
  expect(h.held().gaps?.some(g => g.legacyRowKeys !== undefined)).toBe(true)
  const duplicate = harness(); duplicate.newest([10]); duplicate.demand()
  duplicate.receive([entry(1, 'm-1'), entry(2, 'm-1')], 'duplicate')
  expect(duplicate.held().gaps?.some(g => g.legacyRowKeys !== undefined)).toBe(true)
})
it.each(['ts', ''])('legacy tool identity overlap preserves the held row through validation and restoration, ts=%j', ts => {
  const h = harness()
  const tool = { kind: 'toolCall', turnId: 't', toolUseId: 'tool', name: 'Read', inputSummary: 'held', result: null } as const
  h.store.setState({ timelines: new Map([['c', { ...h.held(), timeline: { ...h.held().timeline,
    items: [tool], rowKeys: [0], nextRowKey: 1 } }]]) })
  h.newest([10]); h.demand()
  h.receive([{ id: 1, ts, event: { type: 'toolUse', turnId: 't', toolUseId: 'tool', name: 'Read', inputSummary: 'held' } }], 'joined')
  expect(h.held().gaps?.some(g => g.legacyRowKeys !== undefined)).toBe(false)
  expect(h.held().timeline.items.filter(i => i.kind === 'toolCall')).toEqual([tool])
  expect(h.held().timeline.items[0]).toBe(tool)
  expect(h.held().timeline.rowKeys?.[0]).toBe(0)
  const parsed = parseChatHistorySnapshot(JSON.parse(JSON.stringify(h.snapshot())))
  if (parsed.kind !== 'timeline') throw new Error('Expected timeline')
  const fresh = harness(false)
  fresh.store.getState().beginLocalTimelineRead('host', 'c')!.complete(parsed)
  expect(fresh.held().gaps?.some(g => g.legacyRowKeys !== undefined)).toBe(false)
  expect(fresh.held().timeline.items).toEqual(h.held().timeline.items)
  expect(fresh.held().timeline.rowKeys).toEqual(h.held().timeline.rowKeys)
  expect(fresh.held().history).toBeNull()
})
it.each([false, true])('unresolved legacy recovery retains a live tool/result suffix, completed=%s', completed => {
  const h = harness(); h.newest([10]); h.demand()
  h.store.getState().dispatchFor('c', { type: 'toolUse', turnId: 'live', toolUseId: 'live-tool',
    name: 'Read', inputSummary: 'live input' }, 'toolUse call-ts')
  if (completed) h.store.getState().dispatchFor('c', { type: 'toolResult', turnId: 'live',
    toolUseId: 'live-tool', isError: false, resultSummary: 'held result' }, 'toolResult result-ts')
  const held = h.held().timeline, tool = held.items.at(-1)!, key = held.rowKeys!.at(-1)
  const entries: HistoryTimelineEntry[] = [
    { id: 12, ts: 'result-ts', event: { type: 'toolResult', turnId: 'live', toolUseId: 'live-tool',
      isError: false, resultSummary: 'page result' } },
    { id: 11, ts: 'call-ts', event: { type: 'toolUse', turnId: 'live', toolUseId: 'live-tool',
      name: 'Read', inputSummary: 'live input' } }
  ]
  h.receive(completed ? entries : [entries[1]], 'walk')
  if (!completed) {
    h.demand()
    h.receive([entries[0]], 'result')
  }
  expect(h.held().gaps?.some(g => g.legacyRowKeys !== undefined)).toBe(true)
  expect(h.held().timeline.items.filter(i => i.kind === 'toolCall')).toHaveLength(1)
  expect(h.held().timeline.rowKeys).toEqual(held.rowKeys)
  expect(h.held().timeline.items.at(-1)).toMatchObject({ ...tool,
    result: { resultSummary: completed ? 'held result' : 'page result' } })
  if (completed) expect(h.held().timeline.items.at(-1)).toBe(tool)
  expect(h.held().display?.find(d => d.id === 11)).toMatchObject({ kind: 'suppressed', rowKey: key })
  if (!completed) expect(h.held().display?.find(d => d.id === 12)).toMatchObject({ kind: 'patch', rowKey: key })
  const parsed = parseChatHistorySnapshot(JSON.parse(JSON.stringify(h.snapshot())))
  if (parsed.kind !== 'timeline') throw new Error('Expected timeline')
  const fresh = harness(false)
  fresh.store.getState().beginLocalTimelineRead('host', 'c')!.complete(parsed)
  fresh.receive(entries, 'repeat')
  expect(fresh.held().timeline.items).toEqual(h.held().timeline.items)
  expect(fresh.held().timeline.rowKeys).toEqual(held.rowKeys)
})
it('ordinary retryable failure blocks fresh gap demand and offline/pending gates remain shared', () => {
  const h = harness(); h.newest([10]); h.demand()
  h.store.getState().recordHistoryFailure('c', 'history-unavailable', true)
  const failed = h.held().history
  h.demand()
  expect(h.held().history).toBe(failed)
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(1)
  h.refuse()
  requestGapHistory({ ...h.deps, canRequest: () => false }, 'c', 'legacy:0')
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(1)
})
it('refusal evidence survives unrelated newest arrival without revalidating the rejected position', () => {
  const h = harness(); h.newest([10]); h.demand(); h.refuse()
  h.newest([10], 'newest')
  expect(h.held().gaps?.[0].cursor).toBeUndefined()
  h.demand()
  expect(h.held().history).toMatchObject({ purpose: 'gap-newest', cursor: '' })
  expect(h.held().gaps?.[0].refusedCursors).toEqual(['newest'])
})

it('bounds declared legacy/refusal metadata and validates owning host/conversation on restore', () => {
  const h = harness(); h.newest([10])
  expect(() => parseChatHistorySnapshot({ ...h.snapshot(), gaps: [{ olderId: 1, newerId: 10,
    refusedCursors: Array(100_001).fill('bad') }] })).toThrow()
  const parsed = parseChatHistorySnapshot(h.snapshot())
  if (parsed.kind !== 'timeline') throw new Error('Expected timeline')
  const wrongHost = harness(false)
  wrongHost.store.getState().beginLocalTimelineRead('other', 'c')!.complete(parsed)
  expect(wrongHost.held().gaps).toBeUndefined()
  const wrongChat = harness(false)
  wrongChat.store.getState().beginLocalTimelineRead('host', 'c')!.complete({ ...parsed, conversationId: 'other' })
  expect(wrongChat.held().gaps).toBeUndefined()
})

it('a foreign-host refusal cannot mutate the held gap evidence', () => {
  let host = 'host'
  const store = createConversationTimelineStore(undefined, () => host)
  store.getState().recordHistoryPage('c', 'oldest', true, [1])
  store.getState().markHistoryRequested('c', 'host', '', 'newest')
  store.getState().recordHistoryPage('c', 'newest', false, [4])
  store.getState().markHistoryRequested('c', 'host', 'newest', 'gap', 1)
  const held = store.getState().timelines.get('c')
  host = 'other'
  store.getState().recordHistoryFailure('c', 'history-invalid-cursor', false)
  expect(store.getState().timelines.get('c')).toBe(held)
})
