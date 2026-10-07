import { expect, it } from 'vitest'
import { groupToolRows } from './groupToolRows'
import type { ThreadItem } from '../../store/threadTimeline'
import { initialTimelineState, markLocalSendQueued, reduceTimeline } from '../../store/threadTimeline'
import { createBackgroundTaskRosterStore } from '../../store/backgroundTaskRosterStore'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Timeline } from './ConversationScreen'
const tool = (toolUseId: string, name = 'Agent', parentToolUseId?: string): ThreadItem => ({
  kind: 'toolCall', turnId: 't', toolUseId, name, parentToolUseId, inputSummary: 'work', result: null
})
const text = (text: string): ThreadItem => ({ kind: 'userText', text })
const evidence = (finishBefore: number | null = null) => new Map([
  ['task', { toolCallId: 'a', confirmed: true, finishBefore, finishOrder: finishBefore === null ? null : 1 }]
])

it.each(['completed', 'failed', 'stopped'])('keeps a %s Agent above a later queued receipt without replacing row identity', status => {
  const store = createBackgroundTaskRosterStore()
  store.getState().setStartedTask({ conversationId: 'c', taskId: 'task', toolCallId: 'a',
    taskType: 'local_agent', description: 'work', truncatedFields: null })
  store.getState().setRoster({ conversationId: 'c', droppedTasks: 0, tasks: [
    { task_id: 'task', task_type: 'local_agent', description: 'work', truncated_fields: null }
  ] })
  let timeline = reduceTimeline(initialTimelineState, { type: 'toolUse', turnId: 't', toolUseId: 'a', name: 'Agent', inputSummary: 'work' })
  timeline = reduceTimeline(timeline, { type: 'userText', text: 'queued', messageId: 'q' })
  timeline = markLocalSendQueued(timeline, [{ queued_msg_id: 1, message_id: 'q', text: 'queued', ts: '' }])
  const echo = timeline.items[1]
  const key = timeline.rowKeys?.[1]
  expect(timeline.nextRowKey).toBe(2)
  store.getState().setUpdatedTask({ conversationId: 'c', taskId: 'task', status, patch: '', summary: '', truncatedFields: null }, timeline.nextRowKey)
  const receipt = { type: 'userText', text: 'receipt', messageId: 'q', queuedMsgId: 1, received: true, sentNow: true } as const
  timeline = reduceTimeline(timeline, receipt)
  const project = () => groupToolRows(timeline.items, store.getState().agentTimeline.get('c'),
    timeline.rowKeys?.map(key => timeline.rowArrivalOrder?.get(key) ?? key))
    .map(row => [row.index, row.marker === true])
  expect(project()).toEqual([[0, true], [0, false], [1, false]])
  expect(timeline.items[1]).toBe(echo)
  expect(timeline.rowKeys?.[1]).toBe(key)
  const markup = renderToStaticMarkup(createElement(Timeline, { ...timeline, backgroundAgents: store.getState().agentTimeline.get('c') }))
  expect(markup.indexOf('tool-row__name')).toBeLessThan(markup.indexOf('data-thread-role="user"'))
  expect(reduceTimeline(timeline, receipt)).toBe(timeline)
  timeline = reduceTimeline(timeline, { type: 'userText', text: 'later', received: true })
  expect(project()).toEqual([[0, true], [0, false], [1, false], [2, false]])
  expect(reduceTimeline(timeline, { type: 'reset' }).rowArrivalOrder).toBeUndefined()
})

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
it('keeps an established finish before a newer launch after late roster confirmation', () => {
  const items = [text('history'), tool('a'), tool('b'), text('after b')]
  const tasks = new Map([
    ['a', { toolCallId: 'a', confirmed: true, finishBefore: 1, finishOrder: 1 }],
    ['b', { toolCallId: 'b', confirmed: false, finishBefore: null, finishOrder: null }]
  ])
  const project = () => groupToolRows(items, tasks, [99, 0, 1, 2], 1)
    .map(row => [row.index, row.marker === true])
  expect(project()).toEqual([[0, false], [1, true], [1, false], [2, false], [3, false]])
  tasks.set('b', { toolCallId: 'b', confirmed: true, finishBefore: null, finishOrder: null })
  expect(project()).toEqual([[0, false], [1, true], [1, false], [2, true], [3, false], [2, false]])
})
it('orders equal finish boundaries by terminal arrival even when an earlier finish loads its launch late', () => {
  const tasks = new Map([
    ['a', { toolCallId: 'a', confirmed: true, finishBefore: 2, finishOrder: 2 }],
    ['b', { toolCallId: 'b', confirmed: true, finishBefore: 2, finishOrder: 1 }]
  ])
  const items = [tool('a'), text('before'), text('after')]
  expect(groupToolRows(items, tasks).map(row => [row.index, row.marker === true]))
    .toEqual([[0, true], [1, false], [0, false], [2, false]])
  const withHistory = [tool('b'), tool('b-child', 'Read', 'b'), ...items]
  const rows = groupToolRows(withHistory, tasks, [9, 10, 0, 1, 2], 2)
  expect(rows.map(row => [row.index, row.marker === true]))
    .toEqual([[0, true], [2, true], [3, false], [0, false], [1, false], [2, false], [4, false]])
})
it('requires confirmed exact Agent calls and preserves received start order over launch order', () => {
  const tasks = new Map([['b', { toolCallId: 'b', confirmed: true, finishBefore: null, finishOrder: null }],
    ['a', { toolCallId: 'a', confirmed: true, finishBefore: null, finishOrder: null }]])
  expect(groupToolRows([tool('a'), tool('b')], tasks).filter(r => !r.marker).map(r => r.index)).toEqual([1, 0])
  for (const name of ['Task', 'agent', 'Read']) expect(groupToolRows([tool('a', name)], evidence())).toHaveLength(1)
  expect(groupToolRows([tool('a')], new Map([['a', { toolCallId: 'a', confirmed: false, finishBefore: null, finishOrder: null }]]))).toHaveLength(1)
})

it('keeps descendants with the nearest relocated Agent and does not trim ids', () => {
  const tasks = new Map([['a', { toolCallId: 'a', confirmed: true, finishBefore: null, finishOrder: null }],
    ['b', { toolCallId: 'b', confirmed: true, finishBefore: null, finishOrder: null }]])
  const rows = groupToolRows([tool('a'), tool('b', 'Agent', 'a'), tool('child', 'Read', 'b')], tasks)
  expect(rows.filter(r => !r.marker).map(r => [r.index, r.ancestors])).toEqual([[0, []], [1, []], [2, [1]]])
  expect(groupToolRows([tool('a')], new Map([['a', { toolCallId: ' a', confirmed: true, finishBefore: null, finishOrder: null }]]))).toHaveLength(1)
})
