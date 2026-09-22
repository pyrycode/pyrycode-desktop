import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChannelInfoSheetView } from './ConversationScreen'

const conversation = { id: 'a', name: 'A', cwd: '/fake', is_promoted: false, last_used_at: '2026-09-11T12:00:00Z', workspace_label: null }
const report = { claudeCodeVersion: '<script>preview</script>', permissionMode: 'futureMode', truncatedFields: ['permission_mode'] }

describe('Channel info Session', () => {
  it("shows the running cost as Claude's estimate only when one is held", () => {
    const withCost = renderToStaticMarkup(<ChannelInfoSheetView conversation={conversation} onClose={() => {}} sessionCostUsd={0.4213} />)
    expect(withCost).toContain('Cost (Claude&#x27;s estimate)')
    expect(withCost).toContain('$0.42 est.')
    expect(withCost.indexOf('>Session<')).toBeLessThan(withCost.indexOf('$0.42 est.'))
    expect(withCost.indexOf('$0.42 est.')).toBeLessThan(withCost.indexOf('>Actions<'))
    const without = renderToStaticMarkup(<ChannelInfoSheetView conversation={conversation} onClose={() => {}} />)
    expect(without).not.toContain('Cost (')
    expect(without).not.toContain('est.')
  })

  it('shows missing fields and keeps section ordering', () => {
    const markup = renderToStaticMarkup(<ChannelInfoSheetView conversation={conversation} onClose={() => {}} systemPromptSection={<p>System prompt</p>} />)
    expect(markup.match(/Not reported/g)).toHaveLength(2)
    expect(markup.indexOf('About')).toBeLessThan(markup.indexOf('>Session<'))
    expect(markup.indexOf('>Session<')).toBeLessThan(markup.indexOf('System prompt'))
    expect(markup).toContain('Claude version')
    expect(markup).toContain('Reported permission mode')
  })
  it('renders unknown claims as escaped inert text and marks the named field', () => {
    const markup = renderToStaticMarkup(<ChannelInfoSheetView conversation={conversation} onClose={() => {}} sessionFacts={report} />)
    expect(markup).toContain('&lt;script&gt;preview&lt;/script&gt;')
    expect(markup).not.toContain('<script>')
    expect(markup).toContain('futureMode')
    expect(markup.match(/Truncated/g)).toHaveLength(1)
    expect(markup).not.toContain('title="futureMode"')
  })
  it('bounds display, marks both local and reported cuts, and shows empty values', () => {
    const markup = renderToStaticMarkup(<ChannelInfoSheetView conversation={conversation} onClose={() => {}} sessionFacts={{ claudeCodeVersion: 'x'.repeat(257), permissionMode: '', truncatedFields: ['permission_mode', 'unknown'] }} />)
    expect(markup).toContain('x'.repeat(256))
    expect(markup).not.toContain('x'.repeat(257))
    expect(markup).toContain('Not reported')
    expect(markup.match(/Truncated/g)).toHaveLength(2)
  })
  it('preserves the no-conversation placeholder', () => {
    const markup = renderToStaticMarkup(<ChannelInfoSheetView conversation={null} onClose={() => {}} sessionFacts={report} />)
    expect(markup).toContain('No conversation details yet')
    expect(markup).not.toContain('Reported permission mode')
    expect(markup).not.toContain('futureMode')
  })
})
