import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ToolRow, openToolName } from './ConversationScreen'
import { initialTimelineState, reduceTimeline, type ThreadEvent, type ThreadItem } from '../../store/threadTimeline'
import { translateTimelineEvent, timelineTargetFor } from '../../store/timelineBridge'
import { translateDaemonEvent } from '../../store/daemonEventBridge'
import { translateModalEvent } from '../../store/modalBridge'
import { translateQuestionEvent } from '../../store/questionBridge'

const marker = {
  type: 'toolDenied' as const, conversationId: 'c1', turnId: 't1', toolUseId: 'u1',
  toolName: 'Bash', decisionReasonType: 'classifier', decisionReason: 'Unsafe command',
  message: 'Permission required', truncatedFields: ['message'], droppedFields: null
}
const call: ThreadEvent = { type: 'toolUse', turnId: 't1', toolUseId: 'u1', name: 'Bash', inputSummary: 'command' }
const result: ThreadEvent = { type: 'toolResult', turnId: 't1', toolUseId: 'u1', isError: true, resultSummary: 'Actual result' }
function deniedEvent(value = marker): ThreadEvent {
  const event = translateTimelineEvent(value)
  if (!event) throw new Error('denial was ignored')
  return event
}
function row(events: ThreadEvent[]): Extract<ThreadItem, { kind: 'toolCall' }> {
  const state = events.reduce(reduceTimeline, initialTimelineState)
  const item = state.items.find((entry) => entry.kind === 'toolCall')
  if (!item || item.kind !== 'toolCall') throw new Error('missing call')
  return item
}

describe('tool denial correlation and presentation', () => {
  it('routes only to the explicit conversation', () => {
    expect(timelineTargetFor(marker)).toBe('c1')
    expect(timelineTargetFor({ ...marker, conversationId: '' })).toBeNull()
    expect(translateTimelineEvent({ ...marker, conversationId: '' })).toBeNull()
  })
  it('is explicitly ignored by non-owning bridges', () => {
    expect(translateDaemonEvent(marker)).toBeNull()
    expect(translateModalEvent(marker, () => new Set())).toBeNull()
    expect(translateQuestionEvent(marker)).toBeNull()
  })
  it('commutes with the result, retaining both records', () => {
    const early = row([call, deniedEvent(), result])
    expect(row([call, result, deniedEvent()])).toEqual(early)
    expect(early.result?.resultSummary).toBe('Actual result')
    expect(early.denial).toMatchObject({ decisionReasonType: 'classifier', truncatedFields: ['message'], droppedFields: null })
  })
  it('ignores duplicate, unmatched and empty joins without changing state', () => {
    const state = [call, deniedEvent()].reduce(reduceTimeline, initialTimelineState)
    expect(reduceTimeline(state, deniedEvent())).toBe(state)
    expect(reduceTimeline(state, deniedEvent({ ...marker, decisionReason: 'Replacement' }))).toBe(state)
    for (const update of [{ turnId: 'other' }, { toolUseId: 'other' }, { turnId: '' }, { toolUseId: '' }]) {
      const pending = reduceTimeline(initialTimelineState, call)
      expect(reduceTimeline(pending, deniedEvent({ ...marker, ...update }))).toBe(pending)
    }
  })
  it('selects the matching turn when tool-use ids repeat', () => {
    const state = [call, { ...call, turnId: 't2' }, deniedEvent()].reduce(reduceTimeline, initialTimelineState)
    const [first, second] = state.items
    expect(first.kind === 'toolCall' && first.denial).toBeDefined()
    expect(second.kind === 'toolCall' && second.denial).toBeUndefined()
  })
  it.each([
    ['classifier', 'the auto classifier'], ['rule', 'a permission rule'],
    ['mode', 'the permission mode'], ['asyncAgent', 'an async agent'],
    ['', 'the permission gate'], ['future', 'the permission gate']
  ])('renders source %s without exposing unknown tokens', (source, copy) => {
    const item = row([call, deniedEvent({ ...marker, decisionReasonType: source })])
    const html = renderToStaticMarkup(<ToolRow item={item} defaultExpanded />)
    expect(html).toContain(`Denied by ${copy}: Unsafe command`)
    expect(html).toContain('Permission required')
    expect(html).toContain('>Denied</span>')
    expect(html).toContain('aria-expanded="true"')
    expect(html).not.toContain('tool-row--error')
    expect(html).not.toContain('future')
  })
  it('omits the reason separator for an empty reason', () => {
    const html = renderToStaticMarkup(<ToolRow item={row([call, deniedEvent({ ...marker, decisionReason: '' })])} defaultExpanded />)
    expect(html).toContain('Denied by the auto classifier</')
  })
  it('bounds and escapes prose and strips terminal/control sequences', () => {
    const item = row([call, deniedEvent({ ...marker, decisionReason: '<script>\u001b[31mred\u001b[0m\u0000', message: 'x'.repeat(5000) })])
    const html = renderToStaticMarkup(<ToolRow item={item} defaultExpanded />)
    expect(html).toContain('&lt;script&gt;red')
    expect(html).not.toContain('\u001b')
    expect(html).not.toContain('\u0000')
    expect(html).not.toContain('x'.repeat(4097))
  })
  it('shows attribution above the actual result, replacing the provisional message', () => {
    const html = renderToStaticMarkup(<ToolRow item={row([call, result, deniedEvent()])} defaultExpanded />)
    expect(html.indexOf('Denied by')).toBeLessThan(html.indexOf('Actual result'))
    expect(html).not.toContain('Permission required')
    expect(html).not.toContain('tool-row--error')
  })
  it('bounds a denied result for display while retaining its actual contents in state', () => {
    const actual = '\u001b[31m' + 'x'.repeat(5000)
    const item = row([call, deniedEvent(), { ...result, resultSummary: actual }])
    expect(item.result?.resultSummary).toBe(actual)
    const html = renderToStaticMarkup(<ToolRow item={item} defaultExpanded />)
    expect(html).not.toContain('\u001b')
    expect(html).not.toContain('x'.repeat(4097))
  })
  it('leaves ordinary error and success presentation intact', () => {
    expect(renderToStaticMarkup(<ToolRow item={row([call, result])} defaultExpanded />)).toContain('tool-row--error')
    const html = renderToStaticMarkup(<ToolRow item={row([call, { ...result, isError: false }])} defaultExpanded />)
    expect(html).not.toContain('Denied')
    expect(html).not.toContain('tool-row--error')
  })
  it('skips denied calls while preserving other pending tools', () => {
    const denied = row([call, deniedEvent()])
    expect(openToolName([denied])).toBeNull()
    expect(openToolName([row([{ ...call, toolUseId: 'u2', name: 'Read' }]), denied])).toBe('Read')
  })
})
