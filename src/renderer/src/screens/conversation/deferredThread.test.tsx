import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ThreadItemsTimeline, ToolRow } from './ConversationScreen'
import { threadItemIndex, threadItemPresentation, threadItemPresentations } from './threadItemPresentation'
import type { ThreadSnapshot } from '../../store/threadItemStore'
import * as body from './toolBody'
import * as usage from './turnStats'

const agent = { id: 1, rev: 1, kind: 'agent', shown: true, order: 1, status: 'finished',
  content: { name: 'Agent', input: { description: 'Work' }, result: { is_error: false, result_summary: 'Finished' } } }
const snapshot = (items: ThreadSnapshot['items']): ThreadSnapshot => ({ hostId: 'host', conversationId: 'chat',
  epoch: 'epoch', items, version: 9000, checkpoint: 9000, ranges: [], repair: null })

describe('deferred thread presentation', () => {
  it('indexes 8333 held rows without adapting descendant messages or formatting timestamps', () => {
    const read = vi.fn(() => '2026-10-19T00:00:00Z')
    const children = Array.from({ length: 8332 }, (_, n) => ({ id: n + 2, rev: n + 2, kind: 'assistant_message',
      shown: true, parent: 1, order: n + 2, status: 'done', content: { text: 'Held child', get ts() { return read() } } }))
    const s = snapshot([agent, ...children])
    const rows = threadItemIndex(s)
    expect(rows).toHaveLength(8333)
    expect(rows[0].hasChildren).toBe(true)
    expect(rows.at(-1)?.ancestors).toEqual([1])
    const html = renderToStaticMarkup(<ThreadItemsTimeline snapshot={s} />)
    expect(html.match(/data-read-row=/g)).toHaveLength(1)
    expect(html).toContain('Work')
    expect(html).not.toContain('Held child')
    expect(read).not.toHaveBeenCalled()
    expect(threadItemPresentation(children[0], true)?.kind).toBe('assistantText')
    expect(read).toHaveBeenCalled()
  })

  it('keeps complete consumers and frozen-source reuse independent of header demand and revised closed sources', () => {
    const old = Object.freeze({ id: 2, rev: 2, kind: 'assistant_message', parent: 1, shown: true,
      status: 'done', content: { text: 'old' } })
    const s = snapshot([agent, old])
    const complete = threadItemPresentations(s)[1].item
    expect(threadItemPresentations(s)[1].item).toBe(complete)
    expect(threadItemIndex(s)[1].item).toBeNull()
    const revised = Object.freeze({ ...old, rev: 3, content: { text: 'new' } })
    expect(threadItemIndex(snapshot([agent, revised]))[1].source).toBe(revised)
    expect(threadItemPresentation(revised, true)).toMatchObject({ text: 'new' })
    expect(threadItemPresentation(old, true)).toBe(complete)
  })

  it('defers shell command formatting until the actual tool body is open', () => {
    const format = vi.spyOn(body, 'shellCommandBlock')
    const source = { ...agent, kind: 'tool_call', content: { name: 'Bash', input: { command: 'echo inert' },
      result: { is_error: false, result_summary: 'inert result' } } }
    const header = threadItemPresentation(source, false)
    expect(header?.kind).toBe('toolCall')
    if (header?.kind !== 'toolCall') throw new Error('Expected tool')
    const closed = renderToStaticMarkup(<ToolRow item={header} />)
    expect(closed).not.toContain('tool-row__result')
    expect(format).not.toHaveBeenCalled()
    const full = threadItemPresentation(source, true)
    if (full?.kind !== 'toolCall') throw new Error('Expected tool')
    expect(renderToStaticMarkup(<ToolRow item={full} defaultExpanded />)).toContain('inert result')
    expect(format).toHaveBeenCalledTimes(1)
    format.mockRestore()
  })

  it('reuses frozen headers independently of bodies and refreshes mutable or revised sources', () => {
    for (const kind of ['agent', 'tool_call']) {
      const source = Object.freeze({ ...agent, kind })
      const header = threadItemPresentation(source, false)
      expect(header).toMatchObject({ kind: 'toolCall', result: { resultSummary: '' } })
      expect(threadItemPresentation(source, false)).toBe(header)
      const full = threadItemPresentation(source, true)
      expect(full).not.toBe(header)
      expect(full).toMatchObject({ result: { resultSummary: 'Finished' } })
      expect(threadItemPresentation(source, false)).toBe(header)
      const revised = Object.freeze({ ...source, rev: 2, content: { ...source.content, input: { description: 'Revised' } } })
      expect(threadItemPresentation(revised, false)).not.toBe(header)
      const mutable = { ...source, content: { ...source.content } }
      const before = threadItemPresentation(mutable, false)
      mutable.content.input = { description: 'Mutable update' }
      expect(threadItemPresentation(mutable, false)).not.toBe(before)
      expect(threadItemPresentation(mutable, false)).toMatchObject({ input: { description: 'Mutable update' } })
    }
  })

  it('keeps metadata placement and counts identical and formats usage only on visible demand', () => {
    const stats = vi.spyOn(usage, 'formatTurnStats')
    const attribution = { session: 's', turn: 't', agent: 'claude' }
    const held = snapshot([{ ...agent, content: { ...agent.content, tool_use_id: 'call', task_id: 'task',
      task_link: { task_id: 'task', tool_call_id: 'call' } }, ended_order: 5 },
      { id: 2, rev: 2, kind: 'tool_call', shown: true, parent: 1, order: 2, status: 'done', content: { name: 'Read' } },
      { id: 3, rev: 3, kind: 'assistant_message', shown: true, order: 3, status: 'done', ...attribution, content: { text: 'Answer' } },
      { id: 4, rev: 4, kind: 'turn_end', shown: false, status: 'done', ...attribution, content: { output_tokens: 42 } },
      { id: 5, rev: 5, kind: 'turn_end', shown: false, status: 'done', ...attribution, content: {} }])
    const index = threadItemIndex(held)
    expect(stats).not.toHaveBeenCalled()
    const facts = (rows: ReturnType<typeof threadItemIndex>) => rows.map(({ source, ancestors, count, marker, background, outcome }) =>
      ({ id: source.id, ancestors, count, marker, background, outcome }))
    expect(facts(index)).toEqual(facts(threadItemPresentations(held)))
    stats.mockClear()
    expect(index.find(row => row.source.id === 3)?.stats).toBe('42 out')
    expect(stats).toHaveBeenCalledTimes(2)
    stats.mockRestore()
  })
})
