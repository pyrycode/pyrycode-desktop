import { describe, expect, it } from 'vitest'
import type { ThreadSnapshot } from '../../store/threadItemStore'
import { createThreadRefusalActions, threadComposerReports } from './threadComposerReports'
import { createThreadTaskStops } from './threadTaskPresentation'
import { latestThreadSessionCostUsd } from './sessionCost'

const item = (id: number, kind: string, content: unknown, fields = {}) => ({ id, rev: id, order: id, kind,
  status: 'done', active: false, shown: true, summary: '', content, session: 'current', agent: 'claude', ...fields })
const snapshot = (items: ThreadSnapshot['items']): ThreadSnapshot => ({ hostId: 'host', conversationId: 'chat', epoch: 'epoch',
  version: 100, checkpoint: 100, items, ranges: [], repair: null })
const banner = (id: number, fields = {}) => item(id, 'notice', { text: 'hook refused', level: 'warning', stops_turn: true }, { subtype: 'banner', ...fields })
const end = (id: number, fields = {}) => item(id, 'turn_end', { stop_reason: 'max_tokens', outcome: 'error',
  is_error: true, terminal_reason: 'prompt_too_long' }, { turn: 'turn', ...fields })

describe('authoritative composer reports', () => {
  it('uses the current session and clears transient reports without removing saved items', () => {
    const s = snapshot([banner(1, { session: 'previous' }), banner(2)])
    expect(threadComposerReports(s, 'current').banner?.text).toBe('hook refused')
    expect(threadComposerReports(s, null).banner).toBeUndefined()
    expect(threadComposerReports(s, 'current', 2).banner).toBeUndefined()
    expect(s.items).toHaveLength(2)
    expect(threadComposerReports(snapshot([...s.items, banner(3)]), 'current', 2).banner?.text).toBe('hook refused')
    expect(threadComposerReports(snapshot([...s.items, item(3, 'user_message', { text: 'accepted' })]), 'current').banner).toBeUndefined()
  })

  it('shows the latest stopped-turn recovery until later main activity or a normal ending', () => {
    expect(threadComposerReports(snapshot([end(2)]), 'current').latest?.terminalReason).toBe('prompt_too_long')
    expect(threadComposerReports(snapshot([end(2), item(3, 'assistant_message', { text: 'later' })]), 'current').latest).toBeUndefined()
    expect(threadComposerReports(snapshot([end(2), end(4, { shown: false })]), 'current').latest).toBeUndefined()
    expect(threadComposerReports(snapshot([end(2)]), 'current', 0, true).latest).toBeUndefined()
  })

  it('counts only active authoritative tasks with usable recorded links', () => {
    const content = { name: 'Bash', tool_use_id: 'call', task_id: 'task', task_link: { task_id: 'task', tool_call_id: 'call' } }
    const s = snapshot([item(1, 'tool_call', content, { active: true, status: 'running' }),
      item(2, 'tool_call', content, { status: 'finished' }), item(3, 'tool_call', { name: 'Bash' }, { active: true, status: 'running' })])
    expect(threadComposerReports(s, 'current').taskCount).toBe(1)
  })

  it('keeps refusal recovery attached to its owning host and session across navigation', () => {
    const s = snapshot([item(4, 'notice', { original_model: 'opus', fallback_model: 'sonnet', scope: 'session',
      refusal_category: 'unknown', banner: 'fallback' }, { subtype: 'model_refusal_fallback' })])
    const source = threadComposerReports(s, 'current').refusal!
    const store = createThreadRefusalActions()
    store.getState().observe(source); store.getState().begin(source, 'change')
    store.getState().observe({ ...source, host: 'other' })
    store.getState().event({ type: 'sessionSettingsRejected', serverId: 'other', changeId: 'change' })
    store.getState().event({ type: 'sessionSettingsUpdated', serverId: 'host', sessionId: 'previous', changeId: 'change' })
    expect(store.getState().entries.get('["host","chat"]')?.changeId).toBe('change')
    store.getState().event({ type: 'sessionSettingsRejected', serverId: 'host', changeId: 'change' })
    expect(store.getState().entries.get('["host","chat"]')).toMatchObject({ rejected: true })
    store.getState().begin(source, 'retry')
    store.getState().event({ type: 'sessionSettingsUpdated', serverId: 'host', sessionId: 'current', changeId: 'retry' })
    expect(store.getState().entries.get('["host","chat"]')).toMatchObject({ dismissed: true })
  })

  it('keeps the latest positive session cost from hidden main-turn endings', () => {
    const s = snapshot([item(1, 'turn_end', { cost_usd_total: 0.42 }, { shown: false }),
      item(2, 'turn_end', { cost_usd_total: 0 }),
      item(3, 'turn_end', { cost_usd_total: 9 }, { session: 'previous' }),
      item(4, 'turn_end', { cost_usd_total: 8 }, { parent: 20 })])
    expect(latestThreadSessionCostUsd(s, 'current')).toBe(0.42)
    expect(latestThreadSessionCostUsd(s, null)).toBeNull()
  })
  it('retains pending task stops through updates and releases only the matching owner', () => {
    const content = { name: 'Bash', tool_use_id: 'call', task_id: 'task', task_link: { task_id: 'task', tool_call_id: 'call' } }
    const active = snapshot([item(1, 'tool_call', content, { active: true, status: 'running' })])
    const stops = createThreadTaskStops()
    expect(stops.getState().begin(active, 'task')).toBe(true)
    expect(stops.getState().begin(active, 'task')).toBe(false)
    stops.getState().settle(active)
    expect(stops.getState().entries).toHaveLength(1)
    stops.getState().event({ type: 'backgroundTaskStopRejected', serverId: 'other', conversationId: 'chat', taskId: 'task' })
    expect(stops.getState().entries).toHaveLength(1)
    stops.getState().event({ type: 'backgroundTaskStopRejected', serverId: 'host', conversationId: 'chat', taskId: 'task' })
    expect(stops.getState().entries).toEqual([])
    expect(stops.getState().begin(active, 'task')).toBe(true)
    stops.getState().settle(snapshot([item(1, 'tool_call', content, { active: false, status: 'stopped' })]))
    expect(stops.getState().entries).toEqual([])
  })

})
