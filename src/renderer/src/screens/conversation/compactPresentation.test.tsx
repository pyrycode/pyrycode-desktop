import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { threadItemPresentation } from './threadItemPresentation'
import { ToolRow } from './ConversationScreen'
import { threadComposerReports } from './threadComposerReports'
import { threadTaskPresentations } from './threadTaskPresentation'

it('keeps supplied compact headlines expandable without inventing a tool body or handle', () => {
  const item = threadItemPresentation({ id: 1, kind: 'agent', rev: 1, status: 'running', shown: true,
    active: true, headline: 'Inspect workspace', detail_omitted: true, public_child_count: 0, has_public_children: false }, false)
  expect(item).toMatchObject({ kind: 'toolCall', name: 'Inspect workspace', result: null, toolUseId: '' })
  if (item?.kind !== 'toolCall') throw Error('expected header')
  const markup = renderToStaticMarkup(<ToolRow item={item} headerExpandable running expansion={{ expanded: false, onToggle() {} }} />)
  expect(markup).toContain('aria-expanded="false"')
  expect(markup).toContain('Inspect workspace')
  expect(markup).not.toContain('tool-row__body')
})

it('does not turn a child message summary into a complete message', () => {
  expect(threadItemPresentation({ id: 2, kind: 'assistant_message', rev: 1, status: 'done', shown: true,
    active: false, headline: '**summary**', detail_omitted: true }, true)).toBeNull()
})

it('keeps controlled complete pending headers inert without a supplied body', () => {
  const markup = renderToStaticMarkup(<ToolRow item={{ kind: 'toolCall', turnId: 'turn', toolUseId: 'call',
    name: 'Read', inputSummary: 'file', result: null }} running expansion={{ expanded: false, onToggle() {} }} />)
  expect(markup).not.toContain('<button')
  expect(markup).not.toContain('tool-row__chevron')
  expect(markup).not.toContain('tool-row__right')
})

it('keeps scoped reports available under closed headers without inventing task handles', () => {
  const snapshot = { hostId: 'host', conversationId: 'chat', epoch: 'epoch', version: 0, checkpoint: 0,
    ranges: [], repair: null, items: [
      { id: 1, kind: 'agent', rev: 1, order: 1, status: 'running', shown: true, active: true,
        headline: 'Inspect workspace', detail_omitted: true, session: 'current' },
      { id: 2, kind: 'notice', rev: 2, order: 2, parent: 1, subtype: 'banner', session: 'current',
        shown: true, status: 'done', active: false, summary: '', content: { text: 'Action required', level: 'warning', stops_turn: true } }
    ] }
  expect(threadComposerReports(snapshot, 'current').banner?.text).toBe('Action required')
  expect(threadTaskPresentations(snapshot)).toEqual([])
  expect(threadComposerReports(snapshot, 'other').banner).toBeUndefined()
})
