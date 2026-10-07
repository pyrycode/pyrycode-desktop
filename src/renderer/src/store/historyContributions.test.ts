import { describe, expect, it } from 'vitest'
import { createConversationTimelineStore } from './conversationTimelineStore'
import type { HistoryTimelineEntry } from '@shared/ipc/events'
import { parseChatHistorySnapshot } from '@shared/chatHistory'

const text = (id: number, value: string, parentToolUseId?: string): HistoryTimelineEntry => ({ id, ts: `ts-${id}`,
  event: { type: 'assistantDelta', turnId: 't', seq: id, text: value, parentToolUseId } })
const call = (id: number): HistoryTimelineEntry => ({ id, ts: `ts-${id}`,
  event: { type: 'toolUse', turnId: 't', toolUseId: 'tool', name: 'Read', inputSummary: 'input' } })
const result = (id: number): HistoryTimelineEntry => ({ id, ts: `ts-${id}`,
  event: { type: 'toolResult', turnId: 't', toolUseId: 'tool', isError: false, resultSummary: 'done' } })
function harness() {
  const store = createConversationTimelineStore(undefined, () => 'host')
  const page = (entries: HistoryTimelineEntry[]) => {
    store.getState().prependHistoryFor('c', [], false, entries)
    store.getState().recordHistoryPage('c', 'opaque', false, entries.map(e => e.id))
  }
  const held = () => store.getState().timelines.get('c')!
  return { store, page, held }
}

describe('durable history contributions', () => {
  it('joins partial overlap in durable order and preserves the held text identity', () => {
    const h = harness()
    h.page([text(3, 'world'), text(2, ' ' )])
    const key = h.held().timeline.rowKeys![0]
    h.page([text(2, ' '), text(1, 'hello')])
    h.page([text(3, 'world'), text(2, ' '), text(1, 'hello')])
    expect(h.held().timeline.items).toMatchObject([{ text: 'hello world' }])
    expect(h.held().timeline.rowKeys).toEqual([key])
  })

  it('retains an orphan across a validated fresh restoration and fills the call once', () => {
    const h = harness()
    h.page([result(3)])
    const slice = h.held()
    const snapshot = parseChatHistorySnapshot({ version: 1, kind: 'timeline', serverId: 'host', conversationId: 'c',
      items: slice.timeline.items, prependedRows: slice.prependedRows, coverage: slice.coverage,
      display: slice.display, rowIdentity: { rowKeys: slice.timeline.rowKeys ?? [], nextRowKey: slice.timeline.nextRowKey ?? 0 } })
    const fresh = harness()
    fresh.store.getState().beginLocalTimelineRead('host', 'c')!.complete(JSON.parse(JSON.stringify(snapshot)))
    fresh.page([result(3), call(2)])
    fresh.page([call(2)])
    expect(fresh.held().timeline.items).toMatchObject([{ kind: 'toolCall', result: { resultSummary: 'done' } }])
  })

  it('keeps text separated by a tool row or a different parent distinct', () => {
    const h = harness()
    h.page([text(5, 'child', 'tool'), text(4, 'after'), call(3)])
    h.page([text(2, 'before'), text(1, 'start ')])
    expect(h.held().timeline.items).toMatchObject([
      { text: 'start before' }, { kind: 'toolCall' }, { text: 'after' }, { text: 'child' }
    ])
  })
})

it('preserves live state, held tool identity, and live suffix content through later pages', () => {
  const h = harness()
  h.page([call(2), text(1, 'old')])
  const toolKey = h.held().timeline.rowKeys![1]
  h.store.getState().dispatchFor('c', { type: 'turnState', state: 'responding' })
  h.store.getState().dispatchFor('c', { type: 'userText', text: 'pending', messageId: 'pending' })
  const pending = h.held().timeline.localSendPending
  h.page([result(3), call(2)])
  expect(h.held().timeline.rowKeys![1]).toBe(toolKey)
  expect(h.held().timeline.phase).toBe('responding')
  expect(h.held().timeline.localSendPending).toBe(pending)
  expect(h.held().timeline.items).toMatchObject([{ text: 'old' }, { result: { resultSummary: 'done' } }, { text: 'pending' }])
  const other = harness()
  other.page([text(2, 'history')])
  other.store.getState().dispatchFor('c', { type: 'assistantDelta', turnId: 't', seq: 3, text: ' live' })
  other.page([text(1, 'older ')])
  expect(other.held().timeline.items).toMatchObject([{ text: 'older history live' }])
})

it('suppresses unique live timestamps in both orders, while ambiguous page keys draw both', () => {
  const first = harness()
  first.store.getState().dispatchFor('c', { type: 'assistantDelta', turnId: 't', seq: 1, text: 'once' }, 'assistantDelta ts-1')
  first.page([text(1, 'once')])
  expect(first.held().timeline.items).toMatchObject([{ text: 'once' }])
  const second = harness()
  second.page([text(1, 'once')])
  second.store.getState().dispatchFor('c', { type: 'assistantDelta', turnId: 't', seq: 1, text: 'once' }, 'assistantDelta ts-1')
  expect(second.held().timeline.items).toMatchObject([{ text: 'once' }])
  second.page([{ ...text(2, 'ambiguous'), ts: 'ts-1' }])
  second.store.getState().dispatchFor('c', { type: 'assistantDelta', turnId: 't', seq: 3, text: ' live' }, 'assistantDelta ts-1')
  expect(second.held().timeline.items).toMatchObject([{ text: 'onceambiguous live' }])
  const third = harness()
  third.store.getState().dispatchFor('c', { type: 'assistantDelta', turnId: 't', seq: 1, text: 'live' }, 'assistantDelta same')
  third.page([{ ...text(2, 'b'), ts: 'same' }, { ...text(1, 'a'), ts: 'same' }])
  expect(third.held().timeline.items).toMatchObject([{ text: 'ab' }, { text: 'live' }])
})

it('joins operator IDs in both arrival orders without settling pending send from history', () => {
  const message: HistoryTimelineEntry = { id: 4, ts: 'same', event: {
    type: 'messageReceived', message: { message_id: 'm', role: 'user', text: 'operator' } } }
  const h = harness()
  h.store.getState().dispatchLocalEcho('host', 'c', { type: 'userText', messageId: 'm', text: 'operator' })
  const before = h.held().timeline
  h.page([message])
  expect(h.held().timeline.items).toEqual(before.items)
  expect(h.held().timeline.rowKeys).toEqual(before.rowKeys)
  expect(h.held().timeline.localSendPending).toBe(before.localSendPending)
  const fresh = harness()
  fresh.page([message])
  fresh.store.getState().dispatchFor('c', { type: 'userText', received: true, messageId: 'm', text: 'operator' })
  expect(fresh.held().timeline.items).toHaveLength(1)
})

it('does not infer display retention from receipts or legacy row timestamps', () => {
  const h = harness()
  h.store.getState().beginLocalTimelineRead('host', 'c')!.complete({ version: 1, kind: 'timeline', serverId: 'host',
    conversationId: 'c', items: [{ kind: 'assistantText', turnId: 'legacy', text: 'unknown', createdAt: 123 }],
    prependedRows: 0, coverage: { status: 'received', cursor: 'old', atStart: false },
    served: { ids: [1], highestId: 1, receipts: [{ ids: [1], cursor: 'old', atStart: false }] } })
  expect(h.held().display).toBeUndefined()
  h.page([text(1, 'known')])
  expect(h.held().timeline.items).toMatchObject([{ text: 'known' }, { text: 'unknown', createdAt: 123 }])
  h.page([text(1, 'known')])
  expect(h.held().timeline.items).toHaveLength(2)
})

it('keeps display evidence when receipts expire and isolates host replacement and eviction', () => {
  let host = 'a'
  const store = createConversationTimelineStore(undefined, () => host)
  store.getState().prependHistoryFor('c', [], false, [text(1, 'a')])
  store.getState().recordHistoryPage('c', 'one', false, [1])
  store.getState().recordHistoryPage('c', 'large', false, Array.from({ length: 100_001 }, (_, i) => i))
  expect(store.getState().timelines.get('c')?.served).toBeUndefined()
  store.getState().prependHistoryFor('c', [], false, [text(1, 'a')])
  expect(store.getState().timelines.get('c')?.timeline.items).toHaveLength(1)
  host = 'b'
  store.getState().prependHistoryFor('c', [], false, [text(1, 'b')])
  expect(store.getState().timelines.get('c')?.timeline.items).toMatchObject([{ text: 'b' }])
  store.getState().clearTimelineFor('c')
  expect(store.getState().timelines.has('c')).toBe(false)
})

it('rejects malformed declared contribution IDs, operations and retained-row references', () => {
  const base = { version: 1, kind: 'timeline', serverId: 'host', conversationId: 'c', prependedRows: 0,
    coverage: { status: 'unknown' }, items: [{ kind: 'assistantText', turnId: 't', text: 'kept' }],
    rowIdentity: { rowKeys: [3], nextRowKey: 4 } }
  const valid = { id: 0, kind: 'row', rowKey: 3, item: base.items[0] }
  for (const malformed of [
    { ...valid, id: -1 }, { ...valid, id: 0.1 }, { ...valid, id: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, lastId: -1 }, { ...valid, lastId: 0.1 },
    { ...valid, lastId: 2, joinKey: 'assistantDelta ts' },
    { ...valid, rowKey: 2 }, { ...valid, rowKey: undefined }, { ...valid, kind: 'permission' },
    { ...valid, item: { ...base.items[0], turnId: 'wrong' } },
    { id: 1, kind: 'patch', toolUseId: 'tool', result: null },
    { id: 1, kind: 'patch', toolUseId: 'tool', result: { isError: false, resultSummary: 'done' }, rowKey: 3 }
  ]) expect(() => parseChatHistorySnapshot({ ...base, display: [malformed] })).toThrow()
  expect(() => parseChatHistorySnapshot({ ...base, display: [valid, valid] })).toThrow()
  expect(() => parseChatHistorySnapshot({ ...base, display: null })).toThrow()
  const parsed = parseChatHistorySnapshot({ ...base, display: [{ ...valid, token: 'drop', item: { ...base.items[0], token: 'drop' } }] })
  expect(JSON.stringify(parsed)).not.toContain('drop')
})

it('bounds fragment retention before capture without retiring evidence on receipt expiry', () => {
  const h = harness()
  h.page(Array.from({ length: 100_001 }, (_, id) => text(id + 1, id === 0 ? 'first' : 'x')))
  expect(h.held().display!.length).toBeLessThanOrEqual(100_000)
  expect(h.held().timeline.items).toMatchObject([{ text: 'first' + 'x'.repeat(100_000) }])
  h.store.getState().dispatchFor('c', { type: 'userText', text: 'later' })
  const slice = h.held()
  expect(() => parseChatHistorySnapshot({ version: 1, kind: 'timeline', serverId: 'host', conversationId: 'c',
    items: slice.timeline.items, prependedRows: slice.prependedRows, coverage: slice.coverage,
    display: slice.display, rowIdentity: { rowKeys: slice.timeline.rowKeys, nextRowKey: slice.timeline.nextRowKey } })).not.toThrow()
  expect(slice.timeline.items.at(-1)).toMatchObject({ text: 'later' })
  expect(slice.display).toMatchObject([{ id: 1, lastId: 100_001, rowKey: slice.timeline.rowKeys![0] }])
  const fresh = harness()
  fresh.store.getState().beginLocalTimelineRead('host', 'c')!.complete(JSON.parse(JSON.stringify({ version: 1, kind: 'timeline', serverId: 'host', conversationId: 'c',
    items: slice.timeline.items, prependedRows: slice.prependedRows, coverage: slice.coverage,
    display: slice.display, rowIdentity: { rowKeys: slice.timeline.rowKeys, nextRowKey: slice.timeline.nextRowKey } })))
  fresh.page([text(100_000, 'x'), text(0, 'older ')])
  expect(fresh.held().timeline.items).toMatchObject([{ text: 'older first' + 'x'.repeat(100_000) }, { text: 'later' }])
})


it('a later history join preserves live settlement of an echoed operator row', () => {
  const h = harness()
  h.store.getState().dispatchLocalEcho('host', 'c', { type: 'userText', messageId: 'echo', text: 'operator' })
  const message: HistoryTimelineEntry = { id: 4, ts: 'operator', event: {
    type: 'messageReceived', message: { message_id: 'echo', role: 'user', text: 'operator' } } }
  h.page([message, text(1, 'history')])
  h.store.getState().dispatchFor('c', { type: 'messageDelivery', messageId: 'echo', status: 'waiting' })
  h.store.getState().dispatchFor('c', { type: 'assistantDelta', turnId: 'live', seq: 0, text: 'live response' })
  h.store.getState().dispatchFor('c', { type: 'userText', received: true, sentNow: true, queuedMsgId: 7, messageId: 'echo', text: 'operator' })
  const settled = h.held().timeline
  h.page([message, text(1, 'history')])
  expect(h.held().timeline.items).toEqual(settled.items)
  expect(h.held().timeline.rowKeys).toEqual(settled.rowKeys)
  expect(h.held().timeline.localEchoes).toEqual(settled.localEchoes)
  expect(h.held().timeline.items).toMatchObject([{ text: 'history' }, { text: 'live response' }, { text: 'operator' }])
})
