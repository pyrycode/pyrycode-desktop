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
const agentHeader = (headline: string, fields = {}) => ({ id: 1, rev: 1, order: 1, kind: 'agent',
  active: true, status: 'running', shown: true, session: 'current', detail_omitted: true, headline, ...fields })

describe('authoritative composer reports', () => {
  it.each([
    ['Agent: {"description":"Diagnose desktop older-messages error","prompt":"Read-only investigation, s…', 'Agent: Diagnose desktop older-messages error'],
    ['Agent {"description":"Complete input","prompt":"private"}', 'Agent: Complete input'],
    ['Agent: {"nested":{"description":"decoy"},"prompt":"quoted \\"description\\": \\"decoy\\"","description":"Top level","tail":"cut…', 'Agent: Top level'],
    ['Agent: {"descr\\u0069ption":"Read \\"quoted\\" \\u003ctext\\u003e \\\\ path","tail":"cut…', 'Agent: Read "quoted" <text> \\ path'],
    ['Agent: Investigate workspace', 'Agent: Investigate workspace'],
    ['Agent Investigate workspace', 'Agent Investigate workspace'],
    ['Inspect workspace', 'Inspect workspace'],
    ['Bash: {"description":"unchanged"}', 'Bash: {"description":"unchanged"}']
  ])('derives display facts from %s', (headline, expected) => {
    const source = Object.freeze(agentHeader(headline))
    expect(threadComposerReports(snapshot([source]), 'current').tool?.name).toBe(expected)
    expect(source.headline).toBe(headline)
  })

  it.each([
    '{}', '{"prompt":"only"}', '{"description":""}', '{"description":"   "}',
    '{"description":42}', '{"description":null}', '{"description":{"description":"nested"}}',
    '{"nested":{"description":"decoy"}}', '{"prompt":"\\"description\\": \\"decoy\\""}',
    '{"description":"cut…', '{"description":"bad\\q"}', '{bad,"description":"invalid"}',
    '{"nested":[},"description":"invalid"}', '{"description" "missing colon"}',
    '{"description":"cut escape\\', '[{"description":"array"}]'
  ])('falls back without exposing unusable input %s', json => {
    expect(threadComposerReports(snapshot([agentHeader(`Agent: ${json}`)]), 'current').tool?.name).toBe('Agent')
  })

  it('uses complete structured Agent descriptions and preserves elapsed seconds', () => {
    for (const kind of ['agent', 'tool_call']) {
      const source = item(1, kind, { name: 'Agent', input: { description: 'Investigate build', prompt: 'private' },
        elapsed_seconds: 72 }, { status: 'running', active: true })
      expect(threadComposerReports(snapshot([source]), 'current').tool).toEqual({ name: 'Agent: Investigate build', elapsedSeconds: 72 })
    }
    for (const description of [undefined, '', '   ', 42]) {
      const source = item(1, 'agent', { name: 'Agent', input: { description } }, { status: 'running', active: true })
      expect(threadComposerReports(snapshot([source]), 'current').tool?.name).toBe('Agent')
    }
    const source = item(1, 'tool_call', { name: 'Read', input: { description: 'ignored' } }, { status: 'running', active: true })
    expect(threadComposerReports(snapshot([source]), 'current').tool?.name).toBe('Read')
  })

  it('keeps Agent labels within existing foreground selection', () => {
    const own = agentHeader('Agent: {"description":"Foreground"}')
    const ignored = [agentHeader('Agent: child', { id: 2, order: 2, parent: 1 }),
      agentHeader('Agent: previous', { id: 3, order: 3, session: 'previous' }),
      agentHeader('Agent: inactive', { id: 4, order: 4, active: false }),
      item(5, 'tool_call', { name: 'Agent', input: { description: 'background' }, tool_use_id: 'call', task_id: 'task',
        task_link: { task_id: 'task', tool_call_id: 'call' } }, { active: true, status: 'running' })]
    expect(threadComposerReports(snapshot([own, ...ignored]), 'current').tool?.name).toBe('Agent: Foreground')
    expect(threadComposerReports(snapshot([own]), null).tool).toBeUndefined()
  })

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
