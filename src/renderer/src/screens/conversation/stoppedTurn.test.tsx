import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Timeline, stoppedTurnText, ComposerErrorSlot } from './ConversationScreen'
import { initialTimelineState, reduceTimeline, type ThreadEvent } from '../../store/threadTimeline'
import { translateTimelineEvent } from '../../store/timelineBridge'
import { reduceHistoryPage } from '../../store/historyPageBridge'
import { createConversationTimelineStore } from '../../store/conversationTimelineStore'

const end = { type: 'turnEnd' as const, turnId: 't', stopReason: 'end_turn', outcome: 'success', isError: true, terminalReason: 'prompt_too_long' }
const boundary = { kind: 'turnBoundary' as const, turnId: 't', stopReason: 'end_turn', isError: true }
describe('stopped turn presentation', () => {
  it('separates tool stacks with a visible stopped record', () => {
    const tool = { kind: 'toolCall' as const, turnId: 't', toolUseId: 'u', name: 'Read', inputSummary: '', result: null }
    const html = renderToStaticMarkup(<Timeline items={[tool, boundary, { ...tool, turnId: 'next', toolUseId: 'next' }]} />)
    expect(html).toContain('Stopped: error')
    expect(html).not.toContain('tool-group-row--joined-')
  })
  it.each([
    ['max_turns', 'Stopped: turn limit reached'], ['budget_exhausted', 'Stopped: budget exhausted'],
    ['prompt_too_long', 'Stopped: context too long, compact or reset'], ['api_error', 'Stopped: API error'],
    ['hook_stopped', 'Stopped by a hook'], ['stop_hook_prevented', 'Stopped by a hook'],
    ['model_error', 'Stopped: model error'], ['future', 'Stopped: future']
  ])('prefers terminal reason %s', (terminalReason, copy) => {
    expect(stoppedTurnText({ ...boundary, terminalReason, outcome: 'error_max_turns' })).toBe(copy)
  })
  it.each([
    ['error_max_turns', 'Stopped: turn limit reached'], ['error_max_budget_usd', 'Stopped: budget exhausted'],
    ['future', 'Stopped: future'], ['', 'Stopped: error'], ['success', 'Stopped: error']
  ])('uses fallback outcome %s', (outcome, copy) => {
    expect(stoppedTurnText({ ...boundary, outcome, terminalReason: 'completed' })).toBe(copy)
  })
  it('suppresses cancellation, legacy, and clean success', () => {
    for (const item of [{ ...boundary, isError: undefined }, { ...boundary, isError: false, outcome: 'success' }, { ...boundary, stopReason: 'cancelled', outcome: 'error_max_turns' }]) {
      expect(stoppedTurnText(item)).toBeNull()
    }
  })
  it('appends reported categories and renders hostile text only as bounded escaped text', () => {
    expect(stoppedTurnText({ ...boundary, outcome: 'success', errorCategory: 'overloaded' })).toBe('Stopped: API error (Claude reported: overloaded)')
    const html = renderToStaticMarkup(<Timeline items={[{ ...boundary, terminalReason: '<img>\nfuture\u0000', errorCategory: '<b>bad</b>' }]} />)
    expect(html).toContain('Stopped: &lt;img&gt;future')
    expect(html).not.toContain('<img>')
    expect(html).not.toContain('\u0000')
    expect(stoppedTurnText({ ...boundary, terminalReason: 'x'.repeat(257) })).toBe('Stopped: error')
  })
  it('carries live translation and history records', () => {
    const event = translateTimelineEvent({ ...end, conversationId: 'c' })
    expect(event).toMatchObject(end)
    expect(reduceHistoryPage([{ id: 1, ts: 'ts', event: end }])[0]).toMatchObject({ ...boundary, outcome: 'success', terminalReason: 'prompt_too_long' })
  })
  it('retains recovery on trailing idle and clears it on the next turn without removing the record', () => {
    const stopped = reduceTimeline(initialTimelineState, end)
    expect(stopped.latestTurnEnd).toMatchObject(end)
    expect(reduceTimeline(stopped, { type: 'turnState', state: 'idle' }).latestTurnEnd).toBe(stopped.latestTurnEnd)
    const starts: ThreadEvent[] = [
      { type: 'userText', text: 'next' }, { type: 'turnState', state: 'thinking' },
      { type: 'assistantDelta', turnId: 'next', seq: 0, text: 'next' },
      { type: 'toolUse', turnId: 'next', toolUseId: 'u', name: 'Read', inputSummary: '' }
    ]
    for (const event of starts) {
      const next = reduceTimeline(stopped, event)
      expect(next.latestTurnEnd).toBeUndefined()
      expect(next.items[0]).toMatchObject({ kind: 'turnBoundary', terminalReason: 'prompt_too_long' })
    }
  })
  it('keeps recovery per conversation and prevents old history from restoring it', () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('a', end)
    store.getState().dispatchFor('b', { type: 'userText', text: 'other' })
    expect(store.getState().timelines.get('a')?.timeline.latestTurnEnd).toBeDefined()
    expect(store.getState().timelines.get('b')?.timeline.latestTurnEnd).toBeUndefined()
    store.getState().dispatchFor('a', { type: 'userText', text: 'next' })
    store.getState().prependHistoryFor('a', reduceHistoryPage([{ id: 1, ts: 'old', event: end }]))
    store.getState().prependHistoryFor('c', reduceHistoryPage([{ id: 1, ts: 'old', event: end }]))
    expect(store.getState().timelines.get('a')?.timeline.latestTurnEnd).toBeUndefined()
    expect(store.getState().timelines.get('c')?.timeline.latestTurnEnd).toBeUndefined()
    expect(store.getState().timelines.get('c')?.timeline.items[0].kind).toBe('turnBoundary')
  })
  it('places recovery behind connection failures and ahead of notices', () => {
    const props = { onRepair: () => {}, notice: <span>usage</span>, recovery: <span>recovery</span> }
    expect(renderToStaticMarkup(<ComposerErrorSlot {...props} status={{ type: 'connected', ack: { protocol_version: '1', server_id: 's', conn_id: 'c', capabilities: [] } }} />)).toBe('<span>recovery</span>')
    expect(renderToStaticMarkup(<ComposerErrorSlot {...props} status={{ type: 'disconnected' }} />)).toBe('')
  })
})
