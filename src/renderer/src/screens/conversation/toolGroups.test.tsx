import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { groupToolRows } from './groupToolRows'
import { Timeline } from './ConversationScreen'
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
