import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ThreadSnapshot } from '../../store/threadItemStore'
import { BackgroundTaskPanelView } from './BackgroundTaskPanel'
import { ComposerTaskCount } from './ConversationScreen'
import { threadTaskPresentations, type ThreadTaskInputs } from './threadTaskPresentation'

const scope = { hostId: 'host', conversationId: 'chat', epoch: 'epoch' }
const connected = { type: 'connected', ack: { server_id: 'host', conn_id: 'conn', protocol_version: '2', capabilities: ['stop_background_task'] } } as const
const inputs: ThreadTaskInputs = { connection: { hostId: 'host', status: { ...connected, ack: { ...connected.ack, capabilities: [...connected.ack.capabilities] } } }, onStopTask() {} }
const content = { task_id: 'raw-task', tool_use_id: 'call', input: { description: 'saved description' },
  task_link: { tasks: [{ task_id: 'raw-task', tool_call_id: 'call' }] }, result: { result_summary: 'launch completed' } }
const item = (id = 1, fields: Record<string, unknown> = {}) => ({ id, rev: id, kind: 'agent', shown: true,
  active: true, status: 'running', session: 'old-session', agent: 'claude', summary: 'safe fallback', content, ...fields })
const snapshot = (items: ThreadSnapshot['items'] = [item()], fields = {}): ThreadSnapshot => ({ ...scope, items, version: 100, checkpoint: 100, ranges: [], repair: null, ...fields })
const reading = { ...scope, session: 'old-session', agent: 'claude', taskId: 'raw-task' }
const progress = { currentActivity: 'live activity', subagentType: '', lastToolName: 'Read', totalTokens: 42, toolUses: 2, durationMs: 1000, truncatedFields: null }
const render = (s: ThreadSnapshot, live = inputs) => renderToStaticMarkup(createElement(BackgroundTaskPanelView,
  { entry: null, suppliedTasks: threadTaskPresentations(s, live), onStopTask() {}, onClose() {} }))

describe('supplied task controls', () => {
  it('requires shown usable saved links and uses the first linked representation everywhere', () => {
    const s = snapshot([item(), item(2, { kind: 'tool_call', active: false, status: 'finished' }),
      item(3, { shown: false }), item(4, { content: { ...content, task_link: null } }),
      item(5, { content: { ...content, truncated_fields: ['task_id'] } }),
      item(6, { content: { ...content, dropped_fields: ['tool_use_id'] } }),
      item(7, { content: { ...content, task_link: { task_id: 'raw-task', tool_call_id: 'other' } } }),
      item(8, { content: { name: 'Agent', run_in_background: true, result: 'task raw-task' } })])
    const rows = threadTaskPresentations(s, inputs)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ taskId: 'raw-task', description: 'saved description', active: true, canStop: true, outcomeLabel: 'Running' })
    expect(render(s)).toContain('Running · 1')
    expect(render(s)).not.toContain('Finished ·')
    const reversed = threadTaskPresentations(snapshot([s.items[1], s.items[0]]), inputs)
    expect(reversed[0]).toMatchObject({ active: false, canStop: false, outcomeLabel: 'Completed' })
  })

  it('keeps recorded attribution and distinct creators when attribution is unavailable', () => {
    const rows = threadTaskPresentations(snapshot([item(), item(2, { session: 'new-session' }),
      item(3, { session: undefined, agent: undefined }), item(4, { session: undefined, agent: undefined }),
      item(5, { agent: 'codex' }), item(6, { agent: 'future' }), item(7, { session: 42 }),
      item(8, { content: { ...content, truncated_fields: ['session'] } })]), inputs)
    expect(rows).toHaveLength(6)
    expect(new Set(rows.map(r => r.rowKey)).size).toBe(6)
    expect(rows.filter(r => r.canStop)).toHaveLength(2)
  })

  it.each([{ tasks: [] }, { tasks: [{ task_id: 'other', tool_call_id: 'other', description: 'wrong link' }] }])(
    'retains the matching direct description when tasks contains $tasks', ({ tasks }) => {
      const s = snapshot([item(1, { content: { ...content, task_link: {
        task_id: 'raw-task', tool_call_id: 'call', description: 'direct description', tasks
      } } })])
      expect(threadTaskPresentations(s, inputs)[0].description).toBe('direct description')
    })

  it.each(['nested', 'enclosing'])('omits dropped optional display fields marked on %s records', placement => {
    const marker = (field: string) => placement === 'nested' ? { dropped_fields: [field] } : {}
    const c = { ...content, task_link: { task_id: 'raw-task', tool_call_id: 'call',
      description: 'dropped description', ...marker('description') }, input: { command: 'dropped command', ...marker('command') },
      input_summary: 'dropped input summary', task_report: { summary: 'dropped report', ...marker('summary') },
      task_update: { patch: 'dropped patch', ...marker('patch') }, ending: { cause: 'dropped cause', ...marker('cause') },
      dropped_fields: placement === 'enclosing' ? ['task_link', 'input', 'input_summary', 'task_report', 'task_update', 'ending'] : ['input_summary'] }
    const s = snapshot([item(1, { status: 'ended_with_session', active: false, content: c })])
    expect(threadTaskPresentations(s, inputs)[0]).toMatchObject({ description: 'safe fallback',
      summary: null, latestUpdate: null, outcomeLabel: 'Ended with session' })
    expect(render(s)).not.toContain('dropped')
    expect(render(s)).not.toContain('Truncated by the daemon')
  })

  it.each(['nested', 'enclosing'])('pairs partial display fields with cut notices from %s records', placement => {
    const marker = (field: string) => placement === 'nested' ? { truncated_fields: [field] } : {}
    const s = snapshot([item(1, { status: 'ended_with_session', active: false, content: { ...content,
      task_link: { task_id: 'raw-task', tool_call_id: 'call', description: '<partial description>', ...marker('description') },
      task_report: { summary: '<partial report>', ...marker('summary') },
      task_update: { patch: '<partial patch>', ...marker('patch') }, ending: { cause: '<partial cause>', ...marker('cause') },
      truncated_fields: placement === 'enclosing' ? ['task_link', 'task_report', 'task_update', 'ending'] : []
    } })])
    const row = threadTaskPresentations(s, inputs)[0]
    expect(row.truncatedFields).toContain('description')
    expect(row.summary?.truncatedFields).toContain('summary')
    expect(row.latestUpdate?.truncatedFields).toContain('patch')
    const html = render(s)
    expect(html).toMatch(/&lt;partial description&gt;<\/span><span class="background-task-panel__cut-description">Truncated by the daemon/)
    expect(html).toMatch(/&lt;partial report&gt;<\/span><span class="background-task-panel__cut-summary">Truncated by the daemon/)
    expect(html).toMatch(/&lt;partial patch&gt;<\/span><\/div><span class="background-task-panel__cut-patch">Truncated by the daemon/)
    expect(html).toMatch(/Ended with session · &lt;partial cause&gt;.*?background-task-panel__cut-outcome">Truncated by the daemon/)
    expect(html.match(/Truncated by the daemon/g)).toHaveLength(4)
  })

  it.each([
    ['finished', 'Completed'], ['failed', 'Failed'], ['denied', 'Denied'], ['stopped', 'Stopped'],
    ['stopping', 'Stopping'], ['ended_with_session', 'Ended with session · capacity_eviction'], ['gone', 'Outcome unknown']
  ])('draws supplied %s independently of active and inert results', (status, label) => {
    const s = snapshot([item(1, { status, active: false, content: { ...content,
      ending: { cause: 'capacity_eviction' }, task_report: { summary: 'saved report', patch: 'patch data' } } }),
      item(2, { kind: 'session_divider' }), item(3, { kind: 'turn_end' })])
    const html = render(s)
    expect(html).toContain(label)
    expect(html).toContain('Finished · 1')
    expect(html).toContain('saved report')
    expect(html).toContain('patch data')
    expect(html).not.toContain('Stop task')
    expect(html).not.toContain('launch completed')
  })

  it('bounds and escapes fallback, omits malformed optional details, never infers success', () => {
    for (const fields of [{ status: 'future' }, { content: { ...content, input: 4, input_summary: null } }]) {
      const html = render(snapshot([item(1, { ...fields, summary: '<img>' + 'x'.repeat(5000) })]))
      expect(html).toContain('&lt;img&gt;')
      expect(html).not.toContain('<img>')
      expect(html).not.toContain('x'.repeat(4097))
      expect(html).not.toContain('Completed')
    }
    const rows = threadTaskPresentations(snapshot([item(1, { content: { ...content, task_report: { summary: 4, patch: [] } } })]), inputs)
    expect(rows[0].summary).toBeNull()
    expect(rows[0].latestUpdate).toBeNull()
    expect(threadTaskPresentations(snapshot([item(1, { content: { ...content, task_update: { summary: 'saved update' } } })]), inputs)[0].summary?.text).toBe('saved update')
    expect(render(snapshot([item(1, { content: { ...content, task_report: { summary: 'running saved report' } } })]))).toContain('running saved report')
    expect(render(snapshot([item(1, { status: 'finished', active: true })]))).toContain('Running · 1')
    expect(render(snapshot([item(1, { status: 'running', active: false })]))).toContain('Finished · 1')
  })

  it('joins separate scoped progress and pending/refusal without changing lifecycle', () => {
    const live = { ...inputs, progress: [{ ...reading, progress }], stops: [{ ...reading, pending: true }] }
    const rows = threadTaskPresentations(snapshot(), live)
    expect(rows[0]).toMatchObject({ active: true, pending: true, outcomeLabel: 'Running', progress })
    expect(render(snapshot(), live)).toContain('disabled=""')
    expect(render(snapshot(), live)).toContain('live activity')
    expect(threadTaskPresentations(snapshot(), { ...live, stops: [{ ...reading, pending: true, refused: true }] })[0].pending).toBe(false)
    for (const fields of [{ hostId: 'other' }, { conversationId: 'other' }, { epoch: 'other' }, { session: 'new' }, { agent: 'codex' }, { taskId: 'other' }]) {
      const isolated = threadTaskPresentations(snapshot(), { ...inputs, progress: [{ ...reading, ...fields, progress }], stops: [{ ...reading, ...fields, pending: true }] })[0]
      expect(isolated.progress).toBeNull()
      expect(isolated.pending).toBe(false)
    }
    expect(threadTaskPresentations(snapshot([]), live)).toEqual([])
    expect(threadTaskPresentations(snapshot([item(1, { active: false })]), live)[0]).toMatchObject({ active: false, canStop: false, progress: null })
  })

  it('gates Stop by callback, owning connection capability, activity and recorded Claude', () => {
    for (const live of [{}, { ...inputs, onStopTask: undefined }, { ...inputs, connection: { hostId: 'host', status: { type: 'disconnected' as const } } },
      { ...inputs, connection: { hostId: 'host', status: { ...connected, ack: { ...connected.ack, capabilities: [] } } } }]) {
      expect(threadTaskPresentations(snapshot(), live as ThreadTaskInputs)[0].canStop).toBe(false)
    }
    for (const agent of ['codex', 'unknown', undefined]) expect(render(snapshot([item(1, { agent })]))).not.toContain('Stop task')
    expect(threadTaskPresentations(snapshot(), inputs)[0].canStop).toBe(true)
    expect(threadTaskPresentations(snapshot(undefined, { hostId: 'second' }), inputs)[0].canStop).toBe(false)
    const pill = (count: number) => renderToStaticMarkup(createElement(ComposerTaskCount, { count, onToggle() {} }))
    expect(pill(0)).toBe('')
    expect(pill(2)).toContain('2 tasks running')
    const a = threadTaskPresentations(snapshot(), inputs)[0], b = threadTaskPresentations(snapshot(undefined, { hostId: 'second' }), inputs)[0]
    expect(a.rowKey).not.toBe(b.rowKey)
  })
})
