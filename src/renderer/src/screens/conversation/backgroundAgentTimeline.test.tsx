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
  expect(markup).toContain('0 tools · running')
  expect(markup.indexOf('newer message')).toBeLessThan(markup.indexOf('tool-row__name'))
})
