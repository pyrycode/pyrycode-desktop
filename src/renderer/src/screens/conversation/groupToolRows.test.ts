import { expect, it } from 'vitest'
import { groupToolRows } from './groupToolRows'
import type { ThreadItem } from '../../store/threadTimeline'
const tool = (toolUseId: string, name = 'Agent', parentToolUseId?: string): ThreadItem => ({
  kind: 'toolCall', turnId: 't', toolUseId, name, parentToolUseId, inputSummary: 'work', result: null
})
const text = (text: string): ThreadItem => ({ kind: 'userText', text })
const evidence = (finishBefore: number | null = null) => new Map([
  ['task', { toolCallId: 'a', confirmed: true, finishBefore }]
])

it('projects a marker and moves the whole group below ordinary and queued rows', () => {
  const items: ThreadItem[] = [tool('a'), tool('child', 'Read', 'a'), text('new'),
    { kind: 'assistantText', turnId: 't', text: 'attributed', parentToolUseId: 'a' }, tool('child', 'Read', 'a'), text('queued')]
  const rows = groupToolRows(items, evidence())
  expect(rows.map(r => [r.index, r.marker === true])).toEqual([[0, true], [2, false], [5, false], [0, false], [1, false], [3, false], [4, false]])
  expect(rows.find(r => r.index === 0 && !r.marker)).toMatchObject({ count: 1, running: true })
  expect(items[0]).toEqual(tool('a'))
})
it('places the first finish by retained chronological keys even with prepends and late launch', () => {
  const items = [text('old'), tool('a'), text('before'), text('after')]
  const rows = groupToolRows(items, evidence(7), [20, 21, 6, 7], 2)
  expect(rows.map(r => [r.index, r.marker === true])).toEqual([[0, false], [1, true], [2, false], [1, false], [3, false]])
  expect(rows.find(r => r.index === 1 && !r.marker)?.running).toBe(false)
})
it('requires confirmed exact Agent calls and preserves received start order over launch order', () => {
  const tasks = new Map([['b', { toolCallId: 'b', confirmed: true, finishBefore: null }],
    ['a', { toolCallId: 'a', confirmed: true, finishBefore: null }]])
  expect(groupToolRows([tool('a'), tool('b')], tasks).filter(r => !r.marker).map(r => r.index)).toEqual([1, 0])
  for (const name of ['Task', 'agent', 'Read']) expect(groupToolRows([tool('a', name)], evidence())).toHaveLength(1)
  expect(groupToolRows([tool('a')], new Map([['a', { toolCallId: 'a', confirmed: false, finishBefore: null }]]))).toHaveLength(1)
})

it('keeps descendants with the nearest relocated Agent and does not trim ids', () => {
  const tasks = new Map([['a', { toolCallId: 'a', confirmed: true, finishBefore: null }],
    ['b', { toolCallId: 'b', confirmed: true, finishBefore: null }]])
  const rows = groupToolRows([tool('a'), tool('b', 'Agent', 'a'), tool('child', 'Read', 'b')], tasks)
  expect(rows.filter(r => !r.marker).map(r => [r.index, r.ancestors])).toEqual([[0, []], [1, []], [2, [1]]])
  expect(groupToolRows([tool('a')], new Map([['a', { toolCallId: ' a', confirmed: true, finishBefore: null }]]))).toHaveLength(1)
})
