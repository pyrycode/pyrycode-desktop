import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { Timeline } from './ConversationScreen'

it('renders escaped navigable launch marker and zero-child running row after newer text', () => {
  const markup = renderToStaticMarkup(createElement(Timeline, {
    items: [{ kind: 'toolCall', turnId: 't', toolUseId: 'a', name: 'Agent', inputSummary: '<img onerror=bad>',
      result: { isError: false, resultSummary: 'Async agent launched' } }, { kind: 'userText', text: 'newer message' }],
    backgroundAgents: new Map([['task', { toolCallId: 'a', confirmed: true, finishBefore: null, finishOrder: null }]])
  }))
  expect(markup).toContain('Agent started, still working')
  expect(markup).toContain('Go to agent')
  expect(markup).toContain('&lt;img onerror=bad&gt;')
  expect(markup).not.toContain('data-tool')
  expect(markup).toContain('running · 0 tools')
  expect(markup.indexOf('newer message')).toBeLessThan(markup.indexOf('tool-row__name'))
})

it('renders the bounded escaped historical description and places the settled row before later text', () => {
  const markup = renderToStaticMarkup(createElement(Timeline, {
    items: [{ kind: 'toolCall', turnId: 't', toolUseId: 'a', name: 'Agent', inputSummary: 'launch summary', result: null },
      { kind: 'userText', text: 'before finish' }, { kind: 'userText', text: 'after finish' }],
    rowKeys: [4, 3, 2], firstRowKey: -3,
    backgroundAgents: new Map([['task', { toolCallId: 'a', confirmed: true, historyOnly: true,
      description: '<img onerror=bad>' + 'x'.repeat(5000), finishBefore: 2, finishOrder: -1, finishFromHistory: true }]])
  }))
  expect(markup).toContain('Agent finished')
  expect(markup).toContain('Go to agent')
  expect(markup).toContain('&lt;img onerror=bad&gt;')
  expect(markup).not.toContain('x'.repeat(4097))
  expect(markup).not.toContain('<img onerror=bad>')
  expect(markup.indexOf('before finish')).toBeLessThan(markup.indexOf('tool-row__name'))
  expect(markup.indexOf('tool-row__name')).toBeLessThan(markup.indexOf('after finish'))
})
