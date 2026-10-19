import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import type { ThreadItem } from '../../../../shared/wire/thread'
import { ThreadItemsTimeline } from './ConversationScreen'

const tool = (id: number, status = 'finished', fields: Partial<ThreadItem> = {}): ThreadItem => ({
  id, rev: id, order: id, kind: 'tool_call', shown: true, active: false, status,
  summary: 'tool', content: { result: status === 'running' ? null : { is_error: status === 'failed', result_summary: 'result' },
    ...(status === 'denied' ? { denial: { tool_name: 'Read', decision_reason_type: 'rule', decision_reason: '', message: '' } } : {}), name: 'Read', input_summary: `tool ${id}` }, ...fields
})
const render = (items: ThreadItem[], foldTools = true) => renderToStaticMarkup(createElement(ThreadItemsTimeline, {
  snapshot: { hostId: 'host', conversationId: 'chat', epoch: 'epoch', version: 100, checkpoint: 100,
    ranges: [], repair: null, items }, foldTools
}))
const headers = (html: string) => html.match(/Using tools: \d+/g) ?? []

it('folds supplied tools without mounting members and keeps lone tools ordinary', () => {
  const items = [tool(1), tool(2)]
  const ordinary = render(items, false)
  expect(headers(ordinary)).toEqual([])
  expect(ordinary).toContain('tool-group-row--joined-below')
  expect(ordinary).toContain('tool-group-row--joined-above')
  expect(headers(render(items))).toEqual(['Using tools: 2'])
  expect(render(items)).not.toContain('data-read-row=')
  expect(render([tool(1)])).toBe(render([tool(1)], false))
})

it.each(['user_message', 'assistant_message', 'notice', 'session_divider', 'compaction', 'turn_end'])(
  'ends runs at a shown supplied %s', kind => {
    const boundary = tool(3, 'done', { kind, content: kind === 'session_divider' ? { reason: 'clear' }
      : kind === 'compaction' ? { trigger: 'manual' } : { text: 'boundary', level: 'warning' },
      subtype: kind === 'notice' ? 'banner' : undefined })
    expect(headers(render([tool(1), tool(2), boundary, tool(4), tool(5)])))
      .toEqual(['Using tools: 2', 'Using tools: 2'])
    expect(headers(render([tool(1), { ...boundary, shown: false }, tool(2)])))
      .toEqual(['Using tools: 2'])
  }
)

it.each([
  ['finished', 'finished', 'Done', 0], ['running', 'failed', 'Running', 1],
  ['failed', 'failed', 'Failed', 2], ['denied', 'finished', 'Failed', 1]
])('draws supplied root status %s/%s without counting twice', (first, second, label, failures) => {
  const html = render([tool(1, first, { active: first === 'running' }), tool(2, second)])
  const header = html.slice(0, html.indexOf('</button>'))
  expect(header).toContain(`aria-label="${label}"`)
  if (failures) expect(header).toContain(`${failures} failed`)
  else expect(header).not.toContain('failed')
})
