import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Timeline } from './ConversationScreen'
import type { ThreadItem } from '../../store/threadTimeline'

const call = (id: string, parentToolUseId?: string, name = 'Read'): Extract<ThreadItem, { kind: 'toolCall' }> => ({
  kind: 'toolCall', turnId: 't', toolUseId: id, parentToolUseId, name, inputSummary: id, result: null
})
const done = (id: string, isError = false) => ({ ...call(id), result: { isError, resultSummary: 'result' } })
const denied = { ...call('denied'), denial: {
  toolName: 'Read', decisionReasonType: 'rule', decisionReason: '', message: '',
  truncatedFields: null, droppedFields: null
} }
const render = (items: ThreadItem[], enabled = true) => renderToStaticMarkup(
  <Timeline items={items} foldTools={enabled} />
)
const headers = (html: string) => html.match(/Using tools: \d+/g) ?? []
const runHeader = (html: string) => html.slice(0, html.indexOf('</button>'))

it('keeps optional-off rendering and lone tools unchanged', () => {
  const items = [call('a'), call('b')]
  expect(render(items, false)).toBe(renderToStaticMarkup(<Timeline items={items} />))
  expect(headers(render(items, false))).toEqual([])
  expect(render([done('lone')])).toBe(render([done('lone')], false))
})

it.each<ThreadItem>([
  { kind: 'assistantText', turnId: 't', text: 'message' },
  { kind: 'userText', text: 'message' },
  { kind: 'banner', level: 'warning', text: 'notice', stopsTurn: false, truncated: false },
  { kind: 'unrecognizedMessage', site: 'undecodable', messageType: '', raw: 'notice', truncated: false },
  { kind: 'sessionBoundary', reason: 'clear', workspaceCwd: null, occurredAt: '2026-10-05T12:00:00Z' },
  { kind: 'compactionBoundary', failed: false, manual: false },
  { kind: 'turnBoundary', turnId: 't', stopReason: 'end_turn', isError: true, outcome: 'error_max_turns' }
])('ends runs at a drawn $kind', (boundary) => {
  const html = render([call('a'), call('b'), boundary, call('c'), call('d')])
  expect(headers(html)).toEqual(['Using tools: 2', 'Using tools: 2'])
  expect(html.match(/class="tool-group-row tool-run"/g)).toHaveLength(2)
})

it('keeps a queued message as a drawn boundary and leaves unmatched queued rows visible', () => {
  const html = renderToStaticMarkup(<Timeline foldTools items={[
    call('a'), call('b'), { kind: 'userText', text: 'queued', messageId: 'm' }, call('c'), call('d')
  ]} queued={[{ queued_msg_id: 1, message_id: 'm', text: 'queued', ts: '2026-10-05T12:00:00Z' }]} />)
  expect(headers(html)).toEqual(['Using tools: 2', 'Using tools: 2'])
  expect(html).toContain('data-thread-role="queued"')
})

it('joins across undrawn turn boundaries', () => {
  const html = render([call('a'), { kind: 'turnBoundary', turnId: 't', stopReason: 'end_turn' }, call('b')])
  expect(headers(html)).toEqual(['Using tools: 2'])
  expect(runHeader(html)).toContain('Running')
})

it('counts Agent roots once, keeps descendants mounted and uses their running reading', () => {
  const agent = { ...done('agent'), name: 'Agent' }
  const html = render([agent, done('other'), call('child', 'agent')])
  expect(headers(html)).toEqual(['Using tools: 2'])
  expect(runHeader(html)).toContain('Running')
  expect(html).toContain('tool-group-row--depth-1')
  expect(html.match(/hidden=""/g)).toHaveLength(3)
  const failedChild = { ...done('child', true), parentToolUseId: 'agent' }
  const completed = runHeader(render([agent, done('other'), failedChild]))
  expect(completed).toContain('Done')
  expect(completed).not.toContain('failed')
})

it.each([
  { items: [call('a'), done('b', true)], running: true, failed: 1, complete: false },
  { items: [done('a'), done('b')], running: false, failed: 0, complete: true },
  { items: [done('a', true), done('b', true)], running: false, failed: 2, complete: false },
  { items: [denied, call('b')], running: true, failed: 1, complete: false },
  { items: [{ ...denied, result: { isError: true, resultSummary: 'later' } }, done('b')], running: false, failed: 1, complete: false }
])('shows root status without double counting: $running/$failed/$complete', ({ items, running, failed, complete }) => {
  const html = runHeader(render(items))
  expect(html.includes('aria-label="Running"')).toBe(running)
  expect(html.includes('aria-label="Done"')).toBe(complete)
  expect(html.includes('aria-label="Failed"')).toBe(failed > 0)
  if (failed) expect(html).toContain(`${failed} failed`)
  else expect(html).not.toContain('failed')
})

it('skips an undrawn informational banner while folding', () => {
  expect(headers(render([call('a'), {
    kind: 'banner', level: 'info', text: 'undrawn', stopsTurn: false, truncated: false
  }, call('b')]))).toEqual(['Using tools: 2'])
})
