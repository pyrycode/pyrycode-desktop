import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TimelineRow, stoppedTurnText, ComposerErrorSlot } from './ConversationScreen'

const end = { type: 'turnEnd' as const, turnId: 't', stopReason: 'end_turn', outcome: 'success', isError: true, terminalReason: 'prompt_too_long' }
const boundary = { kind: 'turnBoundary' as const, turnId: 't', stopReason: 'end_turn', isError: true }
describe('stopped turn presentation', () => {
  it('renders a visible stopped record', () => {
    const html = renderToStaticMarkup(<TimelineRow inProgress={false} item={boundary} />)
    expect(html).toContain('Stopped: error')
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
    const html = renderToStaticMarkup(<TimelineRow inProgress={false} item={{ ...boundary, terminalReason: '<img>\nfuture\u0000', errorCategory: '<b>bad</b>' }} />)
    expect(html).toContain('Stopped: &lt;img&gt;future')
    expect(html).not.toContain('<img>')
    expect(html).not.toContain('\u0000')
    expect(stoppedTurnText({ ...boundary, terminalReason: 'x'.repeat(257) })).toBe('Stopped: error')
  })
  it('names the conversation agent in the reported category (#1656)', () => {
    const item = { ...boundary, outcome: 'success', errorCategory: 'overloaded' }
    expect(stoppedTurnText(item, 'codex')).toBe('Stopped: API error (Codex reported: overloaded)')
    expect(stoppedTurnText(item, 'claude')).toBe('Stopped: API error (Claude reported: overloaded)')
    const html = renderToStaticMarkup(<TimelineRow agent="codex" inProgress={false} item={item} />)
    expect(html).toContain('Stopped: API error (Codex reported: overloaded)')
    expect(html).not.toContain('Claude')
    expect(renderToStaticMarkup(<TimelineRow agent="claude" inProgress={false} item={item} />))
      .toBe(renderToStaticMarkup(<TimelineRow inProgress={false} item={item} />))
  })
  it('places recovery behind connection failures and ahead of notices', () => {
    const props = { onRepair: () => {}, notice: <span>usage</span>, recovery: <span>recovery</span> }
    expect(renderToStaticMarkup(<ComposerErrorSlot {...props} status={{ type: 'connected', ack: { protocol_version: '1', server_id: 's', conn_id: 'c', capabilities: [] } }} />)).toBe('<span>recovery</span>')
    expect(renderToStaticMarkup(<ComposerErrorSlot {...props} status={{ type: 'disconnected' }} />)).toBe('')
  })
})
