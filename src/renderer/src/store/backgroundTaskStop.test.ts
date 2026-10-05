import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { backgroundTaskRosterStore, createBackgroundTaskRosterStore, selectPendingTaskStopsFor } from './backgroundTaskRosterStore'
import { subscribeBackgroundTaskRoster } from './backgroundTaskRosterBridge'
import { sessionStore, createSessionStore, selectStatusFor } from './sessionStore'
import { BackgroundTaskPanel, backgroundTaskStopSupported } from '../screens/conversation/BackgroundTaskPanel'
import type { DaemonEvent } from '@shared/ipc/events'

const rows = (ids: string[]) => ids.map(task_id => ({ task_id, task_type: 'local_bash', description: 'Synthetic work', truncated_fields: null }))
const ack = { protocol_version: 'v2', server_id: 'untrusted-other-host', conn_id: 'conn', capabilities: ['stop_background_task'] }
function seeded() {
  const store = createBackgroundTaskRosterStore()
  for (const conversationId of ['a', 'b']) store.getState().setRoster({ conversationId, tasks: rows(['shared', 'second']), droppedTasks: 0 })
  return store
}
const update = (status: string) => ({ conversationId: 'a', taskId: 'shared', patch: 'Synthetic patch', status, summary: 'Synthetic outcome', truncatedFields: null })

describe('background task stop waits', () => {
  it('claims once per listed running pair and preserves other conversation slices', () => {
    const store = seeded()
    const state = store.getState()
    expect(state.beginTaskStop('a', 'shared')).toBe(true)
    const pendingA = selectPendingTaskStopsFor('a')(store.getState())
    expect(state.beginTaskStop('a', 'shared')).toBe(false)
    expect(state.beginTaskStop('b', 'shared')).toBe(true)
    expect(selectPendingTaskStopsFor('a')(store.getState())).toBe(pendingA)
    expect(state.beginTaskStop('a', 'second')).toBe(true)
    expect(state.beginTaskStop('missing', 'shared')).toBe(false)
    expect(state.beginTaskStop('a', 'missing')).toBe(false)
    expect(store.getState().rosters).toBe(state.rosters)
    expect(store.getState().finishedTasks.size).toBe(0)
    state.endTaskStopWait('a', 'shared')
    expect(selectPendingTaskStopsFor('a')(store.getState())).toEqual(new Set(['second']))
    expect(selectPendingTaskStopsFor('b')(store.getState())).toEqual(new Set(['shared']))
  })

  it('retains pending on progress, nonterminal updates and a roster still listing the task', () => {
    const store = seeded()
    store.getState().beginTaskStop('a', 'shared')
    const pending = selectPendingTaskStopsFor('a')(store.getState())
    store.getState().setUpdatedTask(update(''))
    store.getState().setUpdatedTask(update('working'))
    store.getState().setTaskProgress({ conversationId: 'a', taskId: 'shared', currentActivity: 'Synthetic activity', subagentType: '', lastToolName: '', totalTokens: 0, toolUses: 0, durationMs: 1, truncatedFields: null })
    store.getState().setRoster({ conversationId: 'a', tasks: rows(['shared']), droppedTasks: 0 })
    expect(selectPendingTaskStopsFor('a')(store.getState())).toEqual(pending)
    expect(store.getState().beginTaskStop('a', 'shared')).toBe(false)
  })

  it.each(['stopped', 'failed', 'completed'])('settles only the terminal pair on %s', status => {
    const store = seeded()
    store.getState().beginTaskStop('a', 'shared')
    store.getState().beginTaskStop('a', 'second')
    store.getState().beginTaskStop('b', 'shared')
    store.getState().setUpdatedTask(update(status))
    expect(selectPendingTaskStopsFor('a')(store.getState())).toEqual(new Set(['second']))
    expect(selectPendingTaskStopsFor('b')(store.getState())).toEqual(new Set(['shared']))
    expect(store.getState().beginTaskStop('a', 'shared')).toBe(false)
  })

  it('prunes omitted pairs and clears only reconnect scope, then all pairing state', () => {
    const store = seeded()
    for (const id of ['a', 'b']) store.getState().beginTaskStop(id, 'shared')
    store.getState().setRoster({ conversationId: 'a', tasks: rows(['second']), droppedTasks: 0 })
    expect(selectPendingTaskStopsFor('a')(store.getState())).toBeNull()
    expect(selectPendingTaskStopsFor('b')(store.getState())).toEqual(new Set(['shared']))
    store.getState().beginTaskStop('a', 'second')
    store.getState().resetRostersFor(new Set(['a']))
    expect(selectPendingTaskStopsFor('a')(store.getState())).toBeNull()
    expect(selectPendingTaskStopsFor('b')(store.getState())).toEqual(new Set(['shared']))
    store.getState().clearAllRosters()
    expect(store.getState().pendingStops.size).toBe(0)
  })

  it('refuses truncated task identity but accepts report-only truncation', () => {
    const store = seeded()
    store.getState().setRoster({ conversationId: 'a', tasks: [{ ...rows(['shared'])[0], truncated_fields: ['task_id'] }], droppedTasks: 0 })
    expect(store.getState().beginTaskStop('a', 'shared')).toBe(false)
    store.getState().setRoster({ conversationId: 'a', tasks: rows(['shared']), droppedTasks: 0 })
    store.getState().setUpdatedTask({ ...update(''), truncatedFields: ['task_id'] })
    expect(store.getState().beginTaskStop('a', 'shared')).toBe(true)
  })

  it('settles correlated refusals and stamped reconnects through the app bridge without a drawer', () => {
    const store = seeded()
    for (const id of ['a', 'b']) for (const task of ['shared', 'second']) store.getState().beginTaskStop(id, task)
    let listener: (event: DaemonEvent) => void = () => {}
    let detached = false
    const off = subscribeBackgroundTaskRoster(cb => { listener = cb; return () => { detached = true } },
      snapshot => store.getState().setRoster(snapshot),
      origin => store.getState().resetRostersFor(new Set(origin === 'host-a' ? ['a'] : ['b'])),
      snapshot => store.getState().setStartedTask(snapshot),
      snapshot => store.getState().setUpdatedTask(snapshot),
      snapshot => store.getState().setTaskProgress(snapshot),
      (conversationId, taskId) => store.getState().endTaskStopWait(conversationId, taskId))
    listener({ type: 'backgroundTaskStopRejected', conversationId: 'a', taskId: 'unknown' })
    listener({ type: 'backgroundTaskStopRejected', conversationId: 'a', taskId: 'shared' })
    expect(selectPendingTaskStopsFor('a')(store.getState())).toEqual(new Set(['second']))
    expect(selectPendingTaskStopsFor('b')(store.getState())).toEqual(new Set(['shared', 'second']))
    listener({ type: 'connected', ack, serverId: 'host-a' } as DaemonEvent)
    expect(selectPendingTaskStopsFor('a')(store.getState())).toBeNull()
    expect(selectPendingTaskStopsFor('b')(store.getState())).toEqual(new Set(['shared', 'second']))
    off()
    expect(detached).toBe(true)
  })

  it('wires the mounted panel to the owning host rather than the compatibility status cell', () => {
    const originalSession = sessionStore.getState()
    const originalRoster = backgroundTaskRosterStore.getState()
    // Zustand SSR reads getInitialState. Supply each current synthetic snapshot for this static render.
    const sessionSnapshot = vi.spyOn(sessionStore, 'getInitialState').mockImplementation(sessionStore.getState)
    const rosterSnapshot = vi.spyOn(backgroundTaskRosterStore, 'getInitialState').mockImplementation(backgroundTaskRosterStore.getState)
    const render = (agent: 'claude' | 'codex' = 'claude', serverId: string | null = 'host-a') =>
      renderToStaticMarkup(createElement(BackgroundTaskPanel, {
        conversationId: 'a', serverId, agent, turnRunning: false, onClose() {}
      }))
    try {
      backgroundTaskRosterStore.setState(seeded().getState())
      sessionStore.getState().dispatch({ type: 'connected', ack, serverId: 'host-b' })
      expect(render()).not.toContain('>Stop task</button>')
      sessionStore.getState().dispatch({ type: 'connected', ack: { ...ack, capabilities: [] }, serverId: 'host-a' })
      expect(render()).not.toContain('>Stop task</button>')
      sessionStore.getState().dispatch({ type: 'connected', ack, serverId: 'host-a' })
      expect(render()).toContain('>Stop task</button>')
      expect(render('codex')).not.toContain('>Stop task</button>')
      expect(render('claude', null)).not.toContain('>Stop task</button>')
      sessionStore.getState().dispatch({ type: 'disconnected', serverId: 'host-a' })
      sessionStore.getState().dispatch({ type: 'connected', ack, serverId: 'host-b' })
      expect(render()).not.toContain('>Stop task</button>')
    } finally {
      sessionStore.setState(originalSession)
      backgroundTaskRosterStore.setState(originalRoster)
      sessionSnapshot.mockRestore()
      rosterSnapshot.mockRestore()
    }
  })

  it('uses only the owning host status and capability, excluding Codex', () => {
    const session = createSessionStore()
    session.getState().dispatch({ type: 'connected', ack, serverId: 'host-b' })
    expect(backgroundTaskStopSupported(selectStatusFor('host-a')(session.getState()), 'claude')).toBe(false)
    session.getState().dispatch({ type: 'connected', ack: { ...ack, capabilities: [] }, serverId: 'host-a' })
    expect(backgroundTaskStopSupported(selectStatusFor('host-a')(session.getState()), 'claude')).toBe(false)
    session.getState().dispatch({ type: 'connected', ack, serverId: 'host-a' })
    expect(backgroundTaskStopSupported(selectStatusFor('host-a')(session.getState()), 'claude')).toBe(true)
    expect(backgroundTaskStopSupported(selectStatusFor('host-a')(session.getState()), 'codex')).toBe(false)
    session.getState().dispatch({ type: 'disconnected', serverId: 'host-a' })
    expect(backgroundTaskStopSupported(selectStatusFor('host-a')(session.getState()), 'claude')).toBe(false)
  })
})
