import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { groupToolRows } from './groupToolRows'
import { Timeline } from './ConversationScreen'
import { parseChatHistorySnapshot } from '../../../../shared/chatHistory'
import { reduceHistoryPage } from '../../store/historyPageBridge'
import { initialTimelineState, reduceTimeline, type ThreadItem } from '../../store/threadTimeline'

const call = (id: string, parentToolUseId?: string, name = 'Agent'): Extract<ThreadItem, { kind: 'toolCall' }> => ({
  kind: 'toolCall', turnId: 't', toolUseId: id, parentToolUseId, name, inputSummary: id, result: null
})

it('groups interleaved siblings without mutating stored order', () => {
  const items = [call('a'), call('b'), call('a1', 'a', 'Read'), call('b1', 'b', 'Read'), call('a2', 'a', 'Bash')]
  const rows = groupToolRows(items)
  expect(rows.map((r) => r.index)).toEqual([0, 2, 4, 1, 3])
  expect(rows[0]).toMatchObject({ count: 2, running: true, depth: 0 })
  expect(rows[1]).toMatchObject({ ancestors: [0], depth: 1 })
  expect(items.map((i) => i.kind === 'toolCall' && i.toolUseId)).toEqual(['a', 'b', 'a1', 'b1', 'a2'])
})
it('caps depth and preserves missing parents until history supplies them', () => {
  const orphan = call('c', 'p', 'Read')
  expect(groupToolRows([orphan])[0]).toMatchObject({ depth: 0, ancestors: [] })
  expect(groupToolRows([call('p'), orphan])[1]).toMatchObject({ depth: 1, ancestors: [0] })
  const items = [call('a'), call('b', 'a'), call('c', 'b'), call('d', 'c', 'Read')]
  expect(groupToolRows(items).map((r) => r.depth)).toEqual([0, 1, 2, 2])
  const html = renderToStaticMarkup(<Timeline items={items} />)
  expect(html).toContain('3 tools · running')
  expect(html).toContain('tool-group-row--depth-2')
  expect(html).toContain('hidden=""')
  const fallback = renderToStaticMarkup(<Timeline items={[orphan]} />)
  expect(fallback).not.toContain('hidden=""')
})
it('counts distinct descendants, stops running after result or denial, and terminates cycles', () => {
  const done = { ...call('a'), result: { isError: false, resultSummary: 'done' } }
  const child = { ...call('b', 'a'), result: { isError: false, resultSummary: 'done' } }
  expect(groupToolRows([done, child, child])[0]).toMatchObject({ count: 1, running: false })
  const cycle = groupToolRows([call('a', 'b'), call('b', 'a')])
  expect(cycle).toHaveLength(2)
  expect(cycle.every((r) => r.depth === 0)).toBe(true)
})
it('results resolve by own id and never erase a known parent or add an orphan', () => {
  let state = reduceTimeline(initialTimelineState, { type: 'toolUse', turnId: 't', toolUseId: 'c', name: 'Read', inputSummary: '', parentToolUseId: 'p' })
  state = reduceTimeline(state, { type: 'toolResult', turnId: 't', toolUseId: 'c', isError: false, resultSummary: 'done' })
  expect(state.items).toHaveLength(1)
  expect(state.items[0]).toMatchObject({ parentToolUseId: 'p', result: { resultSummary: 'done' } })
  expect(reduceTimeline(state, { type: 'toolResult', turnId: 't', toolUseId: 'missing', isError: false, resultSummary: '' }).items).toHaveLength(1)
})

it('replays newest-first history through the actual bridge and preserves attribution', () => {
  const items = reduceHistoryPage([
    { id: 2, ts: 'new', event: { type: 'toolResult', turnId: 't', toolUseId: 'c', parentToolUseId: undefined, isError: false, resultSummary: 'done' } },
    { id: 1, ts: 'old', event: { type: 'toolUse', turnId: 't', toolUseId: 'c', parentToolUseId: 'p', name: 'Read', inputSummary: '' } }
  ])
  expect(items).toHaveLength(1)
  expect(items[0]).toMatchObject({ parentToolUseId: 'p', result: { resultSummary: 'done' } })
})
it('can learn a missing parent from a result without accepting a conflicting parent', () => {
  const use = { type: 'toolUse' as const, turnId: 't', toolUseId: 'c', name: 'Read', inputSummary: '' }
  const result = { type: 'toolResult' as const, turnId: 't', toolUseId: 'c', parentToolUseId: 'p', isError: false, resultSummary: '' }
  expect(reduceTimeline(reduceTimeline(initialTimelineState, use), result).items[0]).toMatchObject({ parentToolUseId: 'p' })
  expect(reduceTimeline(reduceTimeline(initialTimelineState, { ...use, parentToolUseId: 'known' }), result).items[0]).toMatchObject({ parentToolUseId: 'known' })
})
it('does not group under ordinary tools and keeps non-tool roots in relative order', () => {
  const text: ThreadItem = { kind: 'assistantText', turnId: 't', text: 'independent' }
  expect(groupToolRows([call('a', undefined, 'Read'), text, call('b', 'a')]).map((row) => row.index)).toEqual([0, 1, 2])
  expect(groupToolRows([call('a'), text, call('b', 'a')]).map((row) => row.index)).toEqual([0, 2, 1])
})
it('denied calls clear group running status without a result', () => {
  const denied = reduceTimeline(
    reduceTimeline(initialTimelineState, { type: 'toolUse', turnId: 't', toolUseId: 'child', parentToolUseId: 'a', name: 'Read', inputSummary: '' }),
    { type: 'toolDenied', turnId: 't', toolUseId: 'child', denial: {
      toolName: 'Read', decisionReasonType: 'rule', decisionReason: '', message: '',
      truncatedFields: null, droppedFields: null
    } }
  )
  expect(groupToolRows([{ ...call('a'), result: { isError: false, resultSummary: '' } }, ...denied.items])[0]).toMatchObject({ count: 1, running: false })
})

const text = (value: string, parentToolUseId?: string): ThreadItem => ({
  kind: 'assistantText', turnId: 't', text: value, parentToolUseId
})
it('projects assistant text with tools under two parents while main replies keep their order', () => {
  const items = [call('a'), text('main before'), call('b'), text('a reply', 'a'),
    call('child', 'a', 'Read'), text('b reply', 'b'), text('main after'), text('a later', 'a')]
  const rows = groupToolRows(items)
  expect(rows.map(row => row.index)).toEqual([0, 3, 4, 7, 1, 2, 5, 6])
  expect(rows[0]).toMatchObject({ count: 1, hasChildren: true })
  expect(rows.find(row => row.index === 2)).toMatchObject({ count: 0, hasChildren: true })
  expect(rows.find(row => row.index === 3)).toMatchObject({ ancestors: [0], depth: 1 })
})
it('coalesces only adjacent deltas with equal parent and turn and preserves the first stamp', () => {
  let state = initialTimelineState
  for (const [value, parentToolUseId, turnId] of [
    ['main', undefined, 't'], ['a', 'a', 't'], [' grows', 'a', 't'],
    ['b', 'b', 't'], ['main', undefined, 't'], [' grows', undefined, 't'],
    ['new turn', 'a', 'next']
  ] as const) state = reduceTimeline(state, { type: 'assistantDelta', turnId, seq: 0, text: value, parentToolUseId, createdAt: 12 })
  expect(state.items).toEqual([
    { ...text('main'), createdAt: 12 }, { ...text('a grows', 'a'), createdAt: 12 },
    { ...text('b', 'b'), createdAt: 12 }, { ...text('main grows'), createdAt: 12 },
    { ...text('new turn', 'a'), turnId: 'next', createdAt: 12 }
  ])
})
it('keeps orphan replies until history supplies a completed Agent owner, never an ordinary tool', () => {
  const reply = text('orphan reply', 'owner')
  expect(groupToolRows([reply])[0].ancestors).toEqual([])
  expect(groupToolRows([call('owner', undefined, 'Read'), reply])[1].ancestors).toEqual([])
  const older = reduceHistoryPage([
    { id: 2, ts: 'new', event: { type: 'toolResult', turnId: 't', toolUseId: 'owner', isError: false, resultSummary: 'done' } },
    { id: 1, ts: 'old', event: { type: 'toolUse', turnId: 't', toolUseId: 'owner', name: 'Task', inputSummary: '' } }
  ])
  const rows = groupToolRows([...older, reply])
  expect(rows).toHaveLength(2)
  expect(rows[0]).toMatchObject({ count: 0, running: false, hasChildren: true })
  expect(rows[1].ancestors).toEqual([0])
  const html = renderToStaticMarkup(<Timeline items={[...older, reply]} />)
  expect(html).toContain('tool-group-row--depth-1')
  expect(html).toContain('hidden=""')
  expect(html.match(/orphan reply/g)).toHaveLength(1)
})
it('gives a pending text-only owner a collapse control without counting text as tools', () => {
  const html = renderToStaticMarkup(<Timeline items={[call('a'), text('reply', 'a')]} />)
  expect(html).toContain('aria-expanded="false"')
  expect(html).toContain('0 tools · running')
  expect(html).toContain('hidden=""')
})
it('preserves assistant history attribution through the real history bridge', () => {
  const items = reduceHistoryPage([
    { id: 2, ts: 'new', event: { type: 'assistantDelta', turnId: 't', seq: 0, text: 'reply', parentToolUseId: 'owner' } },
    { id: 1, ts: 'old', event: { type: 'toolUse', turnId: 't', toolUseId: 'owner', name: 'Agent', inputSummary: '' } }
  ])
  expect(items[1]).toMatchObject({ parentToolUseId: 'owner' })
  expect(groupToolRows(items)[1].ancestors).toEqual([0])
})

it('restores identical grouping from a version-1 snapshot with parented and old parentless text', () => {
  const items = [call('a'), text('helper', 'a'), text('older main reply')]
  const restored = parseChatHistorySnapshot(JSON.parse(JSON.stringify({
    version: 1, kind: 'timeline', serverId: 'host', conversationId: 'chat', items,
    prependedRows: 0, coverage: { status: 'unknown' }
  })))
  expect(restored.kind).toBe('timeline')
  if (restored.kind !== 'timeline') throw new Error('expected timeline')
  expect(groupToolRows(restored.items)).toEqual(groupToolRows(items))
  expect(renderToStaticMarkup(<Timeline items={restored.items} saved />)).toContain('hidden=""')
})
