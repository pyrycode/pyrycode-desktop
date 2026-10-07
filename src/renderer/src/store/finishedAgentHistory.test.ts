import { describe, expect, it } from 'vitest'
import type { HistoryTimelineEntry } from '@shared/ipc/events'
import { createBackgroundTaskRosterStore } from './backgroundTaskRosterStore'
import { createConversationTimelineStore } from './conversationTimelineStore'
import { joinKeyFor } from './timelineBridge'
import { reduceHistoryPage } from './historyPageBridge'
import { groupToolRows, withProvisionalAgents } from '../screens/conversation/groupToolRows'

const entry = (id: number, event: HistoryTimelineEntry['event']): HistoryTimelineEntry => ({ id, ts: `ts-${id}`, event })
const start = (taskId = 'a', toolCallId = taskId, taskType = 'local_agent') => entry(2, {
  type: 'backgroundTaskStarted', taskId, toolCallId, taskType, description: 'held description'
})
const finish = (taskId = 'a', status = 'completed') => entry(4, { type: 'backgroundTaskUpdated', taskId, status })
const user = (id: number) => entry(id, { type: 'messageReceived', message: { message_id: `m${id}`, role: 'user', text: `user${id}` } })
const launch = (id = 'a', parentToolUseId?: string, name = 'Agent') => entry(1, {
  type: 'toolUse', turnId: 'turn', toolUseId: id, parentToolUseId, name, inputSummary: id
})

function harness() {
  const agents = createBackgroundTaskRosterStore()
  const timelines = createConversationTimelineStore()
  const page = (entries: HistoryTimelineEntry[]) => {
    const placements: { event: Extract<HistoryTimelineEntry['event'], { type: 'backgroundTaskStarted' | 'backgroundTaskUpdated' }>; before: number }[] = []
    const items = reduceHistoryPage(entries, timelines.getState().timelines.get('c')?.liveKeys, p => placements.push(p))
    const keys = timelines.getState().prependHistoryFor('c', items, placements.length > 0)
    agents.getState().recordHistoryPlacements('c', placements.map(p => ({ ...p, before: keys[p.before] })))
  }
  const state = () => timelines.getState().timelines.get('c')!
  const project = () => groupToolRows(state().timeline.items, agents.getState().agentTimeline.get('c'), state().timeline.rowKeys, state().prependedRows)
  return { agents, timelines, page, state, project }
}

describe('finished Agent history', () => {
  it('joins finish, start and late launch/children across pages without live membership or turn-state replay', () => {
    const h = harness()
    h.page([user(5), finish(), user(3)])
    h.page([start()])
    expect(withProvisionalAgents(h.state().timeline.items, h.agents.getState().agentTimeline.get('c'))).toHaveLength(2)
    const identity = h.agents.getState().agentTimeline.get('c')?.get('a')?.identity
    h.page([launch('child', 'a', 'Read'), launch()])
    expect(h.project().map(r => [r.index, !!r.marker])).toEqual([[0, true], [2, false], [0, false], [1, false], [3, false]])
    expect(h.agents.getState().agentTimeline.get('c')?.get('a')?.identity).toBe(identity)
    expect(h.agents.getState().rosters.size).toBe(0)
    expect(h.agents.getState().finishedTasks.size).toBe(0)
    expect(h.state().timeline.phase).toEqual('idle')
  })

  it('keeps tied finishes in entry order across older pages and does not move repeated finishes', () => {
    const h = harness()
    h.page([user(9), finish('b'), finish('a'), user(3)])
    const a = h.agents.getState().agentTimeline.get('c')?.get('a')
    h.page([finish('a', 'failed'), start('b'), start('a'), launch('b'), launch('a')])
    expect(h.project().filter(r => r.background).map(r => h.state().timeline.items[r.index])).toMatchObject([
      { toolUseId: 'a' }, { toolUseId: 'b' }
    ])
    expect(h.agents.getState().agentTimeline.get('c')?.get('a')?.finishBefore).toBe(a?.finishBefore)
  })

  it.each([['shell', 'local_bash', 'completed'], ['', 'local_agent', 'completed'], ['a', 'local_agent', 'COMPLETED']])(
    'does not relocate an invalid historical join %s/%s/%s', (id, type, status) => {
      const h = harness()
      h.page([user(5), finish('a', status), start('a', id, type), launch()])
      expect(h.project().some(r => r.marker || r.background)).toBe(false)
    }
  )

  it('does not relocate matching non-Agent calls or unmatched starts', () => {
    const h = harness()
    h.page([finish(), start(), launch('a', undefined, 'Read')])
    expect(h.project().some(r => r.marker)).toBe(false)
    h.page([start('other')])
    expect(withProvisionalAgents(h.state().timeline.items, h.agents.getState().agentTimeline.get('c'))).toHaveLength(1)
  })

  it('maps a deduplicated user echo anchor to its surviving row', () => {
    const h = harness()
    h.timelines.getState().dispatchFor('c', { type: 'userText', text: 'user5', messageId: 'm5' })
    h.page([user(5), finish(), start(), launch()])
    expect(h.state().timeline.items).toHaveLength(2)
    expect(h.project().map(r => [r.index, !!r.marker])).toEqual([[0, true], [0, false], [1, false]])
  })

  it('retains an empty-page finish before future live rows without anchoring to older prepends', () => {
    const h = harness()
    h.page([finish()])
    h.page([start(), launch()])
    h.timelines.getState().dispatchFor('c', { type: 'userText', text: 'later' })
    expect(h.project().map(r => [r.index, !!r.marker])).toEqual([[0, true], [0, false], [1, false]])
  })

  it('joins suppressed live lifecycle evidence without duplicating launch or changing the live slice', () => {
    const h = harness()
    h.timelines.getState().dispatchFor('c', { type: 'toolUse', turnId: 'turn', toolUseId: 'a', name: 'Agent', inputSummary: 'a' }, joinKeyFor('toolUse', 'ts-1'))
    h.agents.getState().setStartedTask({ conversationId: 'c', taskId: 'a', toolCallId: 'a', taskType: 'local_agent', description: 'live', truncatedFields: null })
    h.timelines.getState().recordPlacementJoin('c', joinKeyFor('backgroundTaskStarted', 'ts-2'))
    h.agents.getState().setUpdatedTask({ conversationId: 'c', taskId: 'a', status: 'completed', patch: '', summary: '', truncatedFields: null }, 1)
    h.timelines.getState().recordPlacementJoin('c', joinKeyFor('backgroundTaskUpdated', 'ts-4'))
    const before = h.state().timeline
    h.page([finish(), start(), launch()])
    expect(h.state().timeline.items).toEqual(before.items)
    expect(h.state().timeline.phase).toBe(before.phase)
    expect(h.project().filter(r => r.marker)).toHaveLength(1)
    expect(h.project().filter(r => r.background)).toHaveLength(1)
    expect(h.agents.getState().agentTimeline.get('c')?.get('a')?.finishBefore).toBe(1)
    expect(h.agents.getState().rosters.size).toBe(0)
  })

  it.each(['completed', 'failed', 'stopped'])('qualifies a historical start on live %s and preserves it through terminal replay', status => {
    const h = harness()
    h.page([user(3), start(), launch()])
    h.timelines.getState().dispatchFor('c', { type: 'turnState', state: 'thinking' })
    const prior = h.agents.getState().agentTimeline.get('c')?.get('a')
    const membership = h.agents.getState()
    const boundary = h.state().timeline.nextRowKey
    expect(prior).toMatchObject({ historyStarted: true, confirmed: false, finishBefore: null })
    expect(h.project().some(r => r.marker || r.background)).toBe(false)

    h.agents.getState().setUpdatedTask({ conversationId: 'c', taskId: 'a', status,
      patch: '', summary: '', truncatedFields: null }, boundary)
    h.timelines.getState().recordPlacementJoin('c', joinKeyFor('backgroundTaskUpdated', 'ts-4'))
    h.timelines.getState().dispatchFor('c', { type: 'userText', text: 'after live finish' })
    const settled = h.agents.getState().agentTimeline.get('c')?.get('a')
    const assertFinished = () => {
      expect(h.agents.getState().agentTimeline.get('c')?.get('a')).toMatchObject({
        identity: prior?.identity, toolCallId: 'a', confirmed: true, finishBefore: boundary, finishOrder: 1
      })
      expect(h.project().map(r => [r.index, !!r.marker])).toEqual([
        [0, true], [1, false], [0, false], [2, false]
      ])
      expect(h.project().filter(r => r.background)).toMatchObject([{ running: false }])
      for (const key of ['rosters', 'rosterAgentIds', 'unlistedStarts', 'finishedTasks', 'pendingStops'] as const) {
        expect(h.agents.getState()[key]).toBe(membership[key])
      }
      expect(h.state().timeline.phase).toBe('thinking')
    }
    assertFinished()
    const items = h.state().timeline.items
    h.page([finish('a', status)])
    expect(h.agents.getState().agentTimeline.get('c')?.get('a')).toBe(settled)
    expect(h.state().timeline.items).toEqual(items)
    assertFinished()
  })

  it('keeps historical qualification on the exact start id and never replays live turn state', () => {
    const h = harness()
    h.agents.getState().setStartedTask({ conversationId: 'c', taskId: 'a', toolCallId: 'different', taskType: 'local_agent', description: 'live', truncatedFields: null })
    h.timelines.getState().dispatchFor('c', { type: 'turnState', state: 'thinking' })
    h.page([entry(6, { type: 'turnState', state: 'idle' }), user(5), finish(), start(), launch('different')])
    expect(h.state().timeline.phase).toBe('thinking')
    expect(h.project().some(r => r.marker)).toBe(false)
    const other = h.agents.getState().agentTimeline
    h.agents.getState().recordHistoryPlacements('other', [{ event: finish().event as Extract<HistoryTimelineEntry['event'], { type: 'backgroundTaskUpdated' }>, before: 0 }])
    expect(h.agents.getState().agentTimeline.get('c')).toBe(other.get('c'))
    h.agents.getState().clearAllRosters()
    expect(h.agents.getState().agentTimeline.size).toBe(0)
  })

  it('preserves live identity, finish and running order, and clears retained unmatched evidence', () => {
    const h = harness()
    h.agents.getState().setRoster({ conversationId: 'c', droppedTasks: 0, tasks: ['b', 'a'].map(task_id => ({
      task_id, tool_call_id: task_id, task_type: 'local_agent', description: task_id, truncated_fields: null
    })) })
    h.agents.getState().setUpdatedTask({ conversationId: 'c', taskId: 'a', status: 'stopped', patch: '', summary: '', truncatedFields: null }, 50)
    const prior = h.agents.getState().agentTimeline.get('c')?.get('a')
    h.page([finish(), start(), launch()])
    expect(h.agents.getState().agentTimeline.get('c')?.get('a')).toMatchObject(prior!)
    expect([...h.agents.getState().agentTimeline.get('c')!.keys()]).toEqual(['b', 'a'])
    h.page([finish('unmatched')])
    h.agents.getState().resetRostersFor(new Set(['c']))
    expect(h.agents.getState().agentTimeline.size).toBe(0)
  })
})
