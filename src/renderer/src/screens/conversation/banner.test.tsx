import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ComposerBannerReport, ComposerErrorSlot, ConversationScreen, TimelineRow } from './ConversationScreen'
import { activeConversationStore } from '../../store/activeConversationStore'
import { sessionStore } from '../../store/sessionStore'
import { conversationListStore } from '../../store/conversationListStore'
import { runSettingsWriteStore } from '../../store/runSettingsWriteStore'
import { usageLimitStore } from '../../store/usageLimitStore'

afterEach(() => vi.restoreAllMocks())

const report = { level: 'warning', text: 'hook blocked', stopsTurn: true, truncated: false }
const row = (value = report) => renderToStaticMarkup(<TimelineRow inProgress={false} item={{ kind: 'banner', ...value }} />)

describe('banner display surfaces', () => {
  it.each(['notice', 'suggestion', '', 'future', '__proto__', 'warning'])('renders level %j as a fixed muted or warning class', level => {
    const html = row({ ...report, level })
    expect(html).toContain('Claude: hook blocked')
    expect(html.includes('claude-banner--warning')).toBe(level === 'warning')
    expect(html).toContain('session-delimiter__title claude-banner')
    if (level === 'future' || level === '__proto__') expect(html).not.toContain(level)
    expect(html).not.toMatch(/data-thread-role|title=|aria-label=/)
  })
  it('hides info only from the timeline, including empty stopping reports', () => {
    const value = { ...report, level: 'info', text: '' }
    expect(row(value)).not.toContain('Claude:')
    expect(renderToStaticMarkup(<ComposerBannerReport report={value} />)).toContain('Claude: ')
  })
  it.each([false, true])('renders inert sanitized text on both surfaces, truncated=%s', truncated => {
    const value = { ...report, truncated, text: '\x1b[31m**/cost**\x1b[0m\n\t<script>x</script> https://example.test/' +
      '\x1b]8;;https://hidden.test\x07link\x1b]8;;\x1b\\\x1bPsecret-control\x1b\\\x1b(BA\x00\x08\x7f\x9dhidden\x9c' }
    for (const html of [row(value), renderToStaticMarkup(<ComposerBannerReport report={value} />)]) {
      expect(html).toContain('Claude: **/cost**\n\t&lt;script&gt;x&lt;/script&gt; https://example.test/linkA' + (truncated ? '…' : ''))
      expect(html).not.toMatch(/<script|<a |<strong|href=|hidden|secret-control|\x1b|\x00|\x08|\x7f|\x9d/)
    }
  })
  it('names the conversation agent on both surfaces (#1656)', () => {
    const codex = [
      renderToStaticMarkup(<TimelineRow agent="codex" inProgress={false} item={{ kind: 'banner', ...report }} />),
      renderToStaticMarkup(<ComposerBannerReport report={report} agent="codex" />)
    ]
    for (const html of codex) {
      expect(html).toContain('Codex: hook blocked')
      expect(html).not.toContain('Claude:')
    }
    expect(renderToStaticMarkup(<TimelineRow agent="claude" inProgress={false} item={{ kind: 'banner', ...report }} />)).toBe(row())
    expect(renderToStaticMarkup(<ComposerBannerReport report={report} agent="claude" />))
      .toBe(renderToStaticMarkup(<ComposerBannerReport report={report} />))
  })
  it('does not apply a second length cap or infer truncation', () => {
    const value = { ...report, text: 'x'.repeat(6000) }
    for (const html of [row(value), renderToStaticMarkup(<ComposerBannerReport report={value} />)]) {
      expect(html).toContain(value.text)
      expect(html).not.toContain('…')
    }
  })
  it('keeps connected gating and recovery priority for the report notice', () => {
    const props = { onRepair: () => {}, notice: <ComposerBannerReport report={report} /> }
    const connected = { type: 'connected' as const, ack: { protocol_version: '1', server_id: 's', conn_id: 'c', capabilities: [] } }
    expect(renderToStaticMarkup(<ComposerErrorSlot onReconnect={() => {}} {...props} status={connected} />)).toContain('Claude:')
    for (const type of ['disconnected', 'connecting'] as const) {
      expect(renderToStaticMarkup(<ComposerErrorSlot onReconnect={() => {}} {...props} status={{ type }} />)).toBe('')
    }
    expect(renderToStaticMarkup(<ComposerErrorSlot onReconnect={() => {}} {...props} status={connected} recovery={<span>stopped</span>} refusal={<span>switch</span>} />)).toBe('<span>stopped</span>')
    expect(renderToStaticMarkup(<ComposerErrorSlot onReconnect={() => {}} {...props} status={connected} refusal={<span>switch</span>} />)).toBe('<span>switch</span>')
    for (const retryable of [false, true]) {
      expect(renderToStaticMarkup(<ComposerErrorSlot onReconnect={() => {}} {...props} status={{ type: 'error', error: {
        code: 'transport', message: 'private-connection', retryable
      } }} />)).not.toMatch(/Claude:|private-connection/)
    }
  })
})
