import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Timeline } from './ConversationScreen'
import type { ConversationSlice } from '../../store/conversationTimelineStore'

const items = [{ kind: 'assistantText' as const, turnId: 't', text: 'joined reply' }]
const base: Pick<ConversationSlice, 'gaps' | 'display' | 'history'> = {
  gaps: [{ olderId: 1, newerId: 3, cursor: 'position' }], history: null,
  display: [{ id: 1, kind: 'row', rowKey: 9, item: items[0] },
    { id: 3, kind: 'row', rowKey: 9, item: items[0] }]
}
it('places a gap inside a joined reply before its single bubble without an envelope count', () => {
  const markup = renderToStaticMarkup(<Timeline items={items} rowKeys={[9]} gapState={base} />)
  expect(markup.indexOf('Load earlier messages')).toBeLessThan(markup.indexOf('joined reply'))
  expect(markup.match(/class="bubble /g)).toHaveLength(1)
  expect(markup).not.toContain('missing')
})
it.each([true, false])('uses existing failure/Retry treatment with retryable=%s', retryable => {
  const markup = renderToStaticMarkup(<Timeline items={items} rowKeys={[9]} gapState={{ ...base,
    history: { status: 'failed', purpose: 'gap', gapId: 1, retryable, reason: 'unclassified' } }} onRetryGap={() => {}} />)
  expect(markup).toContain('Could not load older messages')
  expect(markup.includes('>Retry</button>')).toBe(retryable)
})
it('shows loading only for the targeted gap and keeps other boundaries idle', () => {
  const markup = renderToStaticMarkup(<Timeline items={items} rowKeys={[9]} gapState={{ ...base,
    gaps: [...base.gaps!, { olderId: 4, newerId: 6 }],
    history: { status: 'requested', purpose: 'gap', gapId: 1 } }} />)
  expect(markup).toContain('Loading earlier messages…')
  expect(markup).toContain('Load earlier messages')
  expect(markup).toContain('role="status"')
})
