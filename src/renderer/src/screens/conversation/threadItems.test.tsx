import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ThreadItem } from '../../../../shared/wire/thread'
import { createThreadItemStore } from '../../store/threadItemStore'
import { ThreadItemsTimeline, ToolRow } from './ConversationScreen'
import { threadItemPresentations } from './threadItemPresentation'

const item = (id: number, kind: string, content: unknown = {}, fields: Partial<ThreadItem> = {}): ThreadItem => ({
  id, rev: id, kind, order: id, status: 'done', active: false, shown: true, summary: `summary ${id}`,
  content, ...fields
})
function snapshot(items: ThreadItem[]) {
  const store = createThreadItemStore().getState()
  store.acceptEpoch('host', 'chat', 'epoch')
  const batch = store.beginBatch('host', 'chat', 'epoch')!
  batch.applyItems(items, 100)
  batch.commit({ fromVersion: 0, version: 100, ranges: [{ start: 1, end: 100 }] })
  return store.snapshot('host', 'chat')!
}
function render(items: ThreadItem[], foldTools = false) {
  return renderToStaticMarkup(createElement(ThreadItemsTimeline, { snapshot: snapshot(items), foldTools }))
}

describe('daemon item presentation', () => {
  it('draws supplied kinds in order, including shown info notices and normal endings', () => {
    const html = render([
      item(1, 'user_message', { text: 'user supplied' }, { status: 'delivered' }),
      item(2, 'assistant_message', { text: '**assistant supplied**' }),
      item(3, 'tool_call', { name: 'Read', input_summary: 'tool supplied' }),
      item(4, 'session_divider', { reason: 'clear' }),
      item(5, 'compaction', { trigger: 'manual', pre_tokens: 1200, post_tokens: 400 }),
      item(6, 'turn_end', { stop_reason: 'end_turn' }),
      item(7, 'notice', { text: 'info supplied', level: 'info' }, { subtype: 'banner' })
    ])
    for (const token of ['user supplied', '<strong>assistant supplied</strong>', 'tool supplied',
      'Session reset', 'compaction-delimiter', 'summary 6', 'info supplied']) expect(html).toContain(token)
    expect(html.indexOf('user supplied')).toBeLessThan(html.indexOf('assistant supplied'))
    expect(html.indexOf('tool supplied')).toBeLessThan(html.indexOf('Session reset'))
    expect(html.indexOf('summary 6')).toBeLessThan(html.indexOf('info supplied'))
  })

  it('keeps hidden items held and uses escaped inert summaries for unsupported facts', () => {
    const html = render([
      item(1, 'assistant_message', { text: 'hidden text' }, { shown: false }),
      item(2, 'future', { text: 'never interpreted' }, { summary: '<script>unsafe</script>' }),
      item(3, 'tool_call', { name: 'Read' }, { status: 'future', summary: 'unknown status' }),
      item(4, 'notice', { text: 'answer contents' }, { subtype: 'prompt_answered' }),
      item(5, 'assistant_message', { text: 10 }),
      item(6, 'agent', { name: 'Agent' }),
    ])
    expect(html).not.toContain('hidden text')
    expect(html).toContain('&lt;script&gt;unsafe&lt;/script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('answer contents')
    for (const text of ['unknown status', 'summary 4', 'summary 5', 'summary 6']) expect(html).toContain(text)
    expect(html).not.toContain('<button')
  })

  it('takes assistant activity independently of status and row position', () => {
    const html = render([
      item(1, 'assistant_message', { text: 'active text' }, { active: true }),
      item(2, 'assistant_message', { text: 'settled text' }, { status: 'running' }),
      item(3, 'tool_call', { name: 'Read', input_summary: 'terminal tool' }, { status: 'interrupted' })
    ])
    expect(html.match(/bubble__cursor/g)).toHaveLength(1)
    expect(html.indexOf('bubble__cursor')).toBeLessThan(html.indexOf('settled text'))
    expect(html).toContain('tool-row--resolved')
    expect(html).not.toContain('Running')
    expect(html).not.toContain('No output')
  })

  it('associates usage by recorded session and turn across unrelated rows', () => {
    const html = render([
      item(1, 'assistant_message', { text: 'first session' }, { session: 'one', turn: 'same', agent: 'claude' }),
      item(2, 'assistant_message', { text: 'other session' }, { session: 'two', turn: 'same', agent: 'claude' }),
      item(3, 'turn_end', { input_tokens: 1200, output_tokens: 12, duration_ms: 4000 },
        { session: 'one', turn: 'same', agent: 'claude', shown: false }),
      item(4, 'assistant_message', { text: 'unattributed' }),
      item(5, 'turn_end', { output_tokens: 999 }),
    ])
    expect(html).toContain('1.2k in · 12 out · 4s')
    expect(html.indexOf('1.2k in')).toBeLessThan(html.indexOf('other session'))
    expect(html).not.toContain('999 out')
  })

  it('reuses recorded tool details, denials and known notice presentations', () => {
    const html = render([
      item(1, 'tool_call', { name: 'Read', input_summary: 'first', result: {
        is_error: false, result_summary: 'result', result_detail: '15 lines'
      } }),
      item(2, 'tool_call', { name: 'Write', input_summary: 'second', denial: {
        tool_name: 'Write', decision_reason_type: 'rule', decision_reason: 'blocked', message: 'Denied'
      } }, { status: 'denied' }),
      item(3, 'notice', { attachment_id: 'file-id', filename: 'report.pdf' }, { subtype: 'attachment_offered' }),
      item(4, 'notice', { site: 'line_type', message_type: 'unknown', raw: '<raw>', truncated: false },
        { subtype: 'unrecognized_message' }),
      item(5, 'notice', { original_model: 'opus', fallback_model: 'sonnet', scope: 'turn',
        refusal_category: 'policy', banner: 'refusal' }, { subtype: 'model_refusal_fallback' }),
    ])
    for (const text of ['15 lines', 'Denied', 'report.pdf', 'Unrecognized message', 'Refused']) expect(html).toContain(text)
    expect(render([item(1, 'tool_call', { name: 'Read' }), item(2, 'tool_call', { name: 'Write' })], true))
      .toContain('Using tools: 2')
  })
})

const agent = (id: number, fields: Partial<ThreadItem> = {}, content = {}) => item(id, 'agent', {
  name: 'Agent', tool_use_id: `call-${id}`, input_summary: `agent-${id}`, ...content
}, { status: 'running', active: true, ...fields })
const linked = (id: number) => ({ task_id: `task-${id}`, task_link: { task_id: `task-${id}`, tool_call_id: `call-${id}` } })
const rosterLinked = (id: number) => ({ task_id: `task-${id}`, task_link: { tasks: [
  { task_id: 'unrelated', tool_call_id: 'other', truncated_fields: ['tool_call_id'] },
  { task_id: `task-${id}`, tool_call_id: `call-${id}`, truncated_fields: ['description'] }
] } })

describe('supplied agents', () => {
  it('supplied ancestry repairs missing parents, caps depth and counts only distinct shown tools', () => {
    const input = [agent(10), agent(20, { parent: 10 }), agent(30, { parent: 20 }),
      item(40, 'tool_call', { name: 'Read', tool_use_id: 'same' }, { parent: 30 }),
      item(45, 'tool_call', { name: 'Read', tool_use_id: 'same' }, { parent: 30 }),
      item(50, 'assistant_message', { text: 'child text' }, { parent: 10 }),
      item(60, 'tool_call', { name: 'Read' }, { parent: 10, shown: false })]
    const rows = threadItemPresentations(snapshot(input))
    expect(rows.map(r => r.source.id)).toEqual([10, 20, 30, 40, 45, 50])
    expect(rows.find(r => r.source.id === 40)).toMatchObject({ depth: 2, ancestors: [10, 20, 30] })
    expect(rows[0]).toMatchObject({ count: 2, hasChildren: true })
    expect(rows[1]).toMatchObject({ count: 2 })
    expect(threadItemPresentations(snapshot([input[5]]))[0]).toMatchObject({ depth: 0, ancestors: [] })
    expect(threadItemPresentations(snapshot([input[5], agent(10)]))[1]).toMatchObject({ ancestors: [10] })
    expect(threadItemPresentations(snapshot([agent(10), agent(20), { ...input[5], parent: 20 }])).at(-1))
      .toMatchObject({ ancestors: [20] })
    expect(threadItemPresentations(snapshot([agent(10), input[5]]))[0]).toMatchObject({ count: 0, hasChildren: true })
  })

  it('keeps self/cyclic, hidden, missing and non-agent ownership flat without losing rows', () => {
    const rows = threadItemPresentations(snapshot([
      agent(10, { parent: 20 }), agent(20, { parent: 10 }), agent(30, { parent: 30 }),
      agent(40, { shown: false }), item(50, 'assistant_message', { text: 'hidden owner' }, { parent: 40 }),
      item(60, 'tool_call', { name: 'Agent' }), item(70, 'assistant_message', { text: 'ordinary owner' }, { parent: 60 }),
      item(80, 'assistant_message', { text: 'missing' }, { parent: 999 })
    ]))
    expect(rows.map(r => r.source.id)).toEqual([10, 20, 30, 50, 60, 70, 80])
    expect(rows.every(r => r.ancestors.length === 0)).toBe(true)
  })

  it('places linked cards and launch markers in their supplied sibling lanes', () => {
    const rows = threadItemPresentations(snapshot([
      agent(10, {}, linked(10)), agent(20, { active: false, status: 'finished', ended_order: 80 }, linked(20)),
      agent(30, { active: false, status: 'stopped', ended_order: 80 }, linked(30)),
      agent(40, { active: false, status: 'gone', ended_order: 0 }, linked(40)),
      item(50, 'assistant_message', { text: 'ordinary' }), agent(60, {}, linked(60)),
      agent(70, { parent: 10 }, linked(70)), item(75, 'assistant_message', { text: 'nested text' }, { parent: 10 }),
      item(90, 'assistant_message', { text: 'later' })
    ]))
    expect(rows.map(r => `${r.marker ? 'm' : ''}${r.source.id}`))
      .toEqual(['m10', 'm20', 'm30', 'm40', '40', '50', 'm60', '20', '30', '90', '10', 'm70', '75', '70', '60'])
    expect(rows.find(r => r.source.id === 70 && !r.marker)).toMatchObject({ ancestors: [10] })
  })

  it('uses only usable saved task-to-call links and keeps linked shells ordinary', () => {
    const rows = threadItemPresentations(snapshot([
      agent(10, {}, { input: { run_in_background: 'true' }, result: { is_error: false, result_summary: 'task-id' } }),
      agent(20, {}, { ...linked(20), task_link: { ...linked(20).task_link, truncated_fields: ['tool_call_id'] } }),
      agent(30, {}, { ...linked(30), task_link: { ...linked(30).task_link, dropped_fields: ['task_id'] } }),
      agent(40, {}, { ...linked(40), task_link: { task_id: 'task-40', tool_call_id: 'wrong' } }),
      item(50, 'tool_call', { name: 'Bash', tool_use_id: 'call-50', ...linked(50) }, { active: true, status: 'running' })
    ]))
    expect(rows).toHaveLength(5)
    expect(rows.every(r => !r.background && !r.marker)).toBe(true)
    expect(rows.at(-1)?.item).toMatchObject({ kind: 'toolCall', name: 'Bash' })
  })

  it('places roster-linked cards with matching launch-marker identity and keeps shell outcomes supplied', () => {
    const input = [agent(10, {}, rosterLinked(10)),
      agent(20, { active: false, status: 'finished', ended_order: 80 }, rosterLinked(20)),
      agent(30, { active: false, status: 'stopped', ended_order: 80 }, rosterLinked(30)),
      agent(40, { active: false, status: 'gone', ended_order: 0 }, rosterLinked(40)),
      item(50, 'assistant_message', { text: 'ordinary reply' }),
      item(60, 'tool_call', { name: 'Bash', tool_use_id: 'call-60', ...rosterLinked(60),
        result: { is_error: false, result_summary: 'immediate shell launch' }
      }, { status: 'stopped', ended_order: 95 }),
      item(90, 'assistant_message', { text: 'later reply' })]
    const rows = threadItemPresentations(snapshot(input))
    expect(rows.map(r => `${r.marker ? 'm' : ''}${r.source.id}`))
      .toEqual(['m10', 'm20', 'm30', 'm40', '40', '50', '60', '20', '30', '90', '10'])
    for (const id of [10, 20, 30, 40]) {
      const marker = rows.find(r => r.source.id === id && r.marker)!
      const card = rows.find(r => r.source.id === id && !r.marker)!
      expect(marker.source).toBe(card.source)
      expect(marker.item).toBe(card.item)
      expect(marker.outcome).toBe(card.outcome)
    }
    expect(rows.find(r => r.source.id === 60)).toMatchObject({ background: false, outcome: 'Stopped',
      item: { kind: 'toolCall', name: 'Bash' } })
    expect(render(input).match(/Go to agent/g)).toHaveLength(4)
    for (const [status, label] of [['running', 'Outcome pending'], ['stopping', 'Stopping'],
      ['finished', 'Finished'], ['failed', 'Failed'], ['denied', 'Denied'], ['stopped', 'Stopped'], ['gone', 'Outcome unknown']]) {
      const shell = { ...input[5], status, active: status === 'running' || status === 'stopping' }
      expect(threadItemPresentations(snapshot([shell]))[0].outcome).toBe(label)
      expect(render([shell])).toContain(label)
    }
  })

  it('rejects mismatched or damaged roster identities without combining separate entries', () => {
    const match = { task_id: 'task-10', tool_call_id: 'call-10' }
    const invalid = [[], [{ ...match, task_id: 'other' }], [{ ...match, tool_call_id: 'other' }],
      [{ ...match, tool_call_id: 'other' }, { ...match, task_id: 'other' }], [null, 'not an entry'],
      ...['task_id', 'tool_call_id'].flatMap(field => [
        [{ ...match, [field]: '' }], [{ ...match, [field]: 7 }],
        [{ ...match, truncated_fields: [field] }], [{ ...match, dropped_fields: [field] }]
      ]), [{ ...match, truncated_fields: 'task_id' }], [{ ...match, dropped_fields: [7] }]]
    for (const tasks of invalid) {
      const rows = threadItemPresentations(snapshot([agent(10, {}, { task_id: 'task-10', task_link: { tasks } })]))
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ background: false })
    }
    for (const field of ['task_id', 'tool_use_id']) {
      for (const marker of ['truncated_fields', 'dropped_fields']) {
        expect(threadItemPresentations(snapshot([agent(10, {}, { ...rosterLinked(10), [marker]: [field] })]))[0])
          .toMatchObject({ background: false })
      }
    }
  })

  it('supplied outcomes ignore launch results, child activity and session dividers', () => {
    for (const [status, label] of [['finished', 'Finished'], ['failed', 'Failed'], ['denied', 'Denied'],
      ['stopped', 'Stopped'], ['stopping', 'Stopping'], ['gone', 'Outcome unknown'], ['ended_with_session', 'Session ended: child_exit']]) {
      const html = render([agent(10, { status, active: status === 'stopping', session: 'prior', agent: 'codex' }, {
        result: { is_error: false, result_summary: 'immediate launch' }, ending: { cause: 'child_exit' }
      }), item(20, 'tool_call', { name: 'Read' }, { parent: 10, active: true }),
      item(30, 'session_divider', { reason: 'clear' })])
      expect(html).toContain(label)
      expect(html.includes('running ·')).toBe(status === 'stopping')
      expect(html).not.toContain('Agent finished')
    }
    const html = render([agent(10, {}, { result: { is_error: true, result_summary: 'launch failure' } })])
    expect(html).toContain('running ·')
    expect(html).not.toContain('tool-row--error')
  })

  it('falls back to bounded escaped summaries for unknown status or malformed required content', () => {
    for (const row of [agent(10, { status: 'future' }), agent(10, {}, { name: 7 }),
      agent(10, { status: 'ended_with_session' }), agent(10, {}, { result: { is_error: false } })]) {
      const html = render([{ ...row, summary: '<script>' + 'x'.repeat(5000) }])
      expect(html).toContain('&lt;script&gt;')
      expect(html).not.toContain('x'.repeat(4090))
      expect(html).not.toContain('running ·')
      expect(html).not.toContain('Finished')
    }
    const html = render([agent(10, { status: 'ended_with_session', active: false }, { ending: { cause: '<b>idle_sleep</b>' } })])
    expect(html).toContain('Session ended: &lt;b&gt;idle_sleep&lt;/b&gt;')
    expect(html).not.toContain('Claude')
  })

  it('leaves legacy result-driven ToolRow presentation unchanged', () => {
    const html = renderToStaticMarkup(createElement(ToolRow, { item: {
      kind: 'toolCall', name: 'Agent', turnId: 'turn', toolUseId: 'call', inputSummary: 'legacy',
      result: { isError: true, resultSummary: 'failure' }
    } }))
    expect(html).toContain('tool-row--error')
  })
})

it('keeps main reply usage independent of child traffic sharing a turn', () => {
  const rows = threadItemPresentations(snapshot([
    agent(10), item(20, 'assistant_message', { text: 'main' }, { session: 'session', agent: 'claude', turn: 'turn' }),
    item(30, 'assistant_message', { text: 'child' }, { session: 'session', agent: 'claude', turn: 'turn', parent: 10 }),
    item(40, 'turn_end', { output_tokens: 42 }, { session: 'session', agent: 'claude', turn: 'turn', shown: false })
  ]))
  expect(rows.find(r => r.source.id === 20)?.stats).toBe('42 out')
  expect(rows.find(r => r.source.id === 30)?.stats).toBeUndefined()
})
