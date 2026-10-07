import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ToolRow, ThinkingIndicator } from './ConversationScreen'
import type { ThreadItem } from '../../store/threadTimeline'

const item: Extract<ThreadItem, { kind: 'toolCall' }> = {
  kind: 'toolCall', turnId: 't1', toolUseId: 'u1', name: 'Bash', inputSummary: 'build', result: null
}

describe('tool elapsed display', () => {
  it.each([[0, '0s'], [12, '12s'], [59, '59s'], [60, '1m 00s'], [65, '1m 05s'], [-12, '-12s'], [-65, '-1m 05s']])(
    'shows %s as %s in both surfaces', (seconds, expected) => {
      const elapsedSeconds = Number(seconds)
      const row = renderToStaticMarkup(<ToolRow item={{ ...item, elapsedSeconds }} />)
      expect(row).toContain(`<span class="tool-row__count">${expected}</span>`)
      expect(row).not.toContain('<button')
      expect(row).not.toContain('tool-row__chevron')
      const label = renderToStaticMarkup(<ThinkingIndicator state="working" toolName="Bash" retry={null} resetting={null} thinkingTokens={null} toolElapsedSeconds={elapsedSeconds} />)
      expect(label).toContain(`>Running Bash… ${expected}</span>`)
      expect(label.match(/<span/g)).toHaveLength(1)
    }
  )
  it('keeps the baseline text and no trailing slot without a reading', () => {
    expect(renderToStaticMarkup(<ToolRow item={item} />)).not.toContain('tool-row__right')
    expect(renderToStaticMarkup(<ThinkingIndicator state="working" toolName="Bash" retry={null} resetting={null} thinkingTokens={null} />)).toContain('>Running Bash…</span>')
  })
  it('shows progress on a pending group without losing its group count or toggle', () => {
    const row = renderToStaticMarkup(<ToolRow item={{ ...item, elapsedSeconds: 65 }} group={{ count: 2, running: true }} />)
    expect(row).toContain('1m 05s')
    expect(row).toContain('running · 2 tools')
    expect(row).toContain('<button')
  })
  it('puts the status word before the count, so the count stays last against the right-aligned edge', () => {
    const running = renderToStaticMarkup(<ToolRow item={item} group={{ count: 16, running: true }} />)
    expect(running).toContain('<span class="tool-row__count">running · 16 tools</span>')
    const finished = renderToStaticMarkup(<ToolRow item={item} group={{ count: 16, running: false }} />)
    expect(finished).toContain('<span class="tool-row__count">16 tools</span>')
  })
  it('hides a stale reading on a resolved or denied row', () => {
    for (const completion of [
      { result: { isError: false, resultSummary: 'done' } },
      { denial: { toolName: 'Bash', decisionReasonType: 'rule', decisionReason: '', message: '', truncatedFields: null, droppedFields: null } }
    ]) {
      expect(renderToStaticMarkup(<ToolRow item={{ ...item, elapsedSeconds: 65, ...completion }} />)).not.toContain('1m 05s')
    }
  })
  it.each(['stalled', 'compacting', 'retrying', 'resetting'] as const)('does not alter %s copy', (state) => {
    const props = { state, toolName: 'Bash', retry: { current: 1, total: 3 }, resetting: { phase: 'restarting', handoff: 'written' } as const, thinkingTokens: null }
    expect(renderToStaticMarkup(<ThinkingIndicator {...props} toolElapsedSeconds={65} />)).toBe(renderToStaticMarkup(<ThinkingIndicator {...props} />))
  })
})
