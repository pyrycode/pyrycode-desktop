import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { AgentSwitchDialog } from './AgentSwitchDialog'
import { ThinkingIndicator } from './ConversationScreen'
import type { AgentSwitchStatus } from '../../store/agentSwitchStore'

const pending: AgentSwitchStatus = { type: 'pending', conversationId: 'chat', serverId: 'host',
  outgoing: 'claude', target: 'codex', row: { agent: 'codex', value: '', display_name: '<Model>',
    resolved_model: '', effort_levels: [], supports_auto_mode: false, truncated_fields: null } }
const indicator = (status: AgentSwitchStatus, phase: 'wrapping_up' | 'restarting' | null = null) => renderToStaticMarkup(
  <ThinkingIndicator state={phase === null ? null : 'resetting'} toolName={null} retry={null}
    thinkingTokens={null} resetting={phase === null ? null : { phase, handoff: 'pending' }} switchStatus={status} />)

it('renders shared confirmation in both directions with model text escaped only as content', () => {
  const html = renderToStaticMarkup(<AgentSwitchDialog attempt={pending} onCancel={() => {}} onConfirm={() => {}} />)
  expect(html).toContain('Switch to Codex?')
  expect(html).toContain('This channel moves from Claude to &lt;Model&gt; on Codex. Claude writes a hand-over note first, and Codex continues from it. The first reply after the switch costs more, and full-bypass mode turns off.')
  expect(html).toContain('>Cancel</button>'); expect(html).toContain('>Switch</button>')
  expect(html).not.toContain('title="&lt;Model&gt;')
  const reverse = renderToStaticMarkup(<AgentSwitchDialog attempt={{ ...pending, outgoing: 'codex', target: 'claude', row: { ...pending.row, agent: undefined, value: 'sonnet' } }} onCancel={() => {}} onConfirm={() => {}} />)
  expect(reverse).toContain('Switch to Claude?'); expect(reverse).toContain('from Codex to Sonnet on Claude. Codex writes')
})
it('shows switching before/after phases and replaces every reset phase without a handoff suffix', () => {
  expect(indicator(pending)).toContain('>Switching to Codex…</span>')
  expect(indicator(pending, 'wrapping_up')).toContain('>Switching to Codex: Claude is writing a hand-over note…</span>')
  expect(indicator(pending, 'restarting')).toContain('>Switching to Codex: starting Codex…</span>')
  const reverse = { ...pending, outgoing: 'codex', target: 'claude' } satisfies AgentSwitchStatus
  expect(indicator(reverse, 'wrapping_up')).toContain('Switching to Claude: Codex is writing a hand-over note…')
  expect(indicator(reverse, 'restarting')).toContain('Switching to Claude: starting Claude…')
  expect(indicator(pending, 'restarting')).not.toContain('Reset')
})
it.each([true, false])('renders refusal retryable=%s without claiming wrap-up had no effects', retryable => {
  const html = indicator({ type: 'refused', serverId: 'host', retryable })
  expect(html).toContain(`>The agent did not change.${retryable ? ' Try again.' : ''}</span>`)
  expect(html).not.toContain('Switching'); expect(html).not.toContain('no effects')
})
