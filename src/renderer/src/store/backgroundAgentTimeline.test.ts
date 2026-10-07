import { describe, expect, it } from 'vitest'
import { createBackgroundTaskRosterStore } from './backgroundTaskRosterStore'

const start = (taskId = 'a', toolCallId = taskId, taskType = 'local_agent') => ({
  conversationId: 'c', taskId, toolCallId, taskType, description: 'work', truncatedFields: null
})
const roster = (ids: string[]) => ({ conversationId: 'c', droppedTasks: 0,
  tasks: ids.map(task_id => ({ task_id, task_type: 'local_agent', description: 'work', truncated_fields: null })) })
const update = (status: string, taskId = 'a') => ({ conversationId: 'c', taskId, status,
  patch: '', summary: '', truncatedFields: null })

describe('background agent timeline evidence', () => {
  it('qualifies only usable starts confirmed by a local-agent roster, in received order', () => {
    const held = createBackgroundTaskRosterStore()
    held.getState().setStartedTask(start('a'))
    held.getState().setStartedTask(start('b'))
    held.getState().setStartedTask(start('empty', ''))
    held.getState().setStartedTask(start('shell', 'shell', 'shell'))
    held.getState().setRoster(roster(['b']))
    held.getState().setRoster(roster(['b', 'a', 'empty', 'shell', 'roster-only']))
    expect([...held.getState().agentTimeline.get('c')?.values() ?? []].map(x => [x.toolCallId, x.confirmed]))
      .toEqual([['a', true], ['b', true]])
  })

  it('retains first terminal anchor after removal, and never revives or shifts a finish', () => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setStartedTask(start())
    store.getState().setRoster(roster(['a']))
    store.getState().setRoster(roster([]))
    for (const status of ['', 'running', 'unknown', 'COMPLETED']) store.getState().setUpdatedTask(update(status), 5)
    expect(store.getState().agentTimeline.get('c')?.get('a')?.finishBefore).toBeNull()
    store.getState().setUpdatedTask(update('completed'), 7)
    store.getState().setUpdatedTask(update('failed'), 9)
    store.getState().setStartedTask(start('a', 'replacement'))
    store.getState().setRoster(roster(['a']))
    expect(store.getState().agentTimeline.get('c')?.get('a')).toEqual({ toolCallId: 'a', confirmed: true, finishBefore: 7, finishOrder: 1 })
    expect(store.getState().rosters.get('c')?.tasks.size).toBe(1)
    store.getState().resetRostersFor(new Set(['other']))
    expect(store.getState().agentTimeline.size).toBe(1)
    store.getState().resetRostersFor(new Set(['c']))
    expect(store.getState().agentTimeline.size).toBe(0)
    store.getState().setStartedTask(start())
    store.getState().clearAllRosters()
    expect(store.getState().agentTimeline.size).toBe(0)
  })

  it.each(['completed', 'failed', 'stopped'])('holds %s received before roster confirmation', status => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setStartedTask(start())
    store.getState().setUpdatedTask(update(status), 4)
    store.getState().setRoster(roster(['a']))
    expect(store.getState().agentTimeline.get('c')?.get('a')?.finishBefore).toBe(4)
  })

  it.each(['completed', 'failed', 'stopped'])('retains reverse terminal arrival order for %s at one boundary', status => {
    const store = createBackgroundTaskRosterStore()
    store.getState().setStartedTask(start('a'))
    store.getState().setStartedTask(start('b'))
    store.getState().setRoster(roster(['a', 'b']))
    store.getState().setRoster(roster([]))
    store.getState().setUpdatedTask(update('unknown', 'a'), 7)
    store.getState().setUpdatedTask(update(status, 'b'), 7)
    const firstFinish = store.getState().agentTimeline.get('c')?.get('b')
    store.getState().setUpdatedTask(update('failed', 'b'), 99)
    store.getState().setStartedTask(start('b', 'replacement'))
    store.getState().setUpdatedTask(update(status, 'a'), 7)
    store.getState().setUpdatedTask(update('running', 'b'), 99)
    store.getState().setRoster(roster(['b', 'a']))
    const evidence = store.getState().agentTimeline.get('c')
    expect([...evidence?.keys() ?? []]).toEqual(['a', 'b'])
    expect(evidence?.get('b')).toBe(firstFinish)
    expect(evidence?.get('b')).toMatchObject({ toolCallId: 'b', finishBefore: 7, finishOrder: 1 })
    expect(evidence?.get('a')).toMatchObject({ finishBefore: 7, finishOrder: 2 })
  })
})
