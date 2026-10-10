import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ThreadItem } from '../../../../shared/wire/thread'
import { createThreadItemStore } from '../../store/threadItemStore'
import { ThreadItemsTimeline } from './ConversationScreen'

const item = (id: number, kind: string, content: unknown = {}, fields: Partial<ThreadItem> = {}): ThreadItem => ({
  id, rev: id, kind, order: id, status: 'done', active: false, shown: true, summary: `summary ${id}`,
  content, ...fields
})
function render(items: ThreadItem[], foldTools = false) {
  const store = createThreadItemStore().getState()
  store.acceptEpoch('host', 'chat', 'epoch')
  const batch = store.beginBatch('host', 'chat', 'epoch')!
  batch.applyItems(items, 100)
  batch.commit({ fromVersion: 0, version: 100, ranges: [{ start: 1, end: 100 }] })
  return renderToStaticMarkup(createElement(ThreadItemsTimeline, {
    snapshot: store.snapshot('host', 'chat')!, foldTools
  }))
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
