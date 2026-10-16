import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ComposerErrorSlot, ComposerHistoryFailure, ConversationScreen } from './ConversationScreen'
import { sessionStore, type ConnectionStatus } from '../../store/sessionStore'
import { activeConversationStore } from '../../store/activeConversationStore'
import { conversationListStore } from '../../store/conversationListStore'
import { usageLimitStore } from '../../store/usageLimitStore'
import { runSettingsWriteStore } from '../../store/runSettingsWriteStore'
import { sessionIdStore } from '../../store/sessionIdStore'
import type { TimelineState } from '../../store/threadTimeline'

afterEach(() => vi.restoreAllMocks())

const history = (retryable = true) => <ComposerHistoryFailure retryable={retryable} onRetry={() => {}} />
const render = (status: ConnectionStatus, overrides = {}) => renderToStaticMarkup(
  <ComposerErrorSlot status={status} notice={null} history={history()} {...overrides} />)

describe('history status occupant', () => {
  it.each([false, true])('renders fixed error copy with Retry only when retryable=%s', retryable => {
    const markup = renderToStaticMarkup(history(retryable))
    expect(markup).toContain('Could not load older messages')
    expect(markup.includes('>Retry</button>')).toBe(retryable)
    expect(markup).toContain('role="status"')
  })

  it('falls back to history only when preceding occupants are absent', () => {
    expect(render({ type: 'connected', ack: { protocol_version: 'v2', server_id: 'host', conn_id: 'c', capabilities: ['thread'] } })).toContain('Could not load older messages')
    for (const occupant of ['recovery', 'refusal', 'notice']) {
      const markup = render({ type: 'connected', ack: { protocol_version: 'v2', server_id: 'host', conn_id: 'c', capabilities: ['thread'] } }, { [occupant]: <span>Higher priority</span> })
      expect(markup).toBe('<span>Higher priority</span>')
    }
    expect(render({ type: 'connected', ack: { protocol_version: 'v2', server_id: 'host', conn_id: 'c', capabilities: ['thread'] } }, { recovery: <span>Recovery</span>, refusal: <span>Refusal</span>, notice: <span>Notice</span> }))
      .toBe('<span>Recovery</span>')
    expect(render({ type: 'connected', ack: { protocol_version: 'v2', server_id: 'host', conn_id: 'c', capabilities: ['thread'] } }, { refusal: <span>Refusal</span>, notice: <span>Notice</span> }))
      .toBe('<span>Refusal</span>')
  })

  it.each<ConnectionStatus>([
    { type: 'disconnected' }, { type: 'connecting' },
    { type: 'error', error: { code: 'offline', message: 'sentinel', retryable: true } },
    { type: 'error', error: { code: 'pairing', message: 'sentinel', retryable: false } }
  ])('keeps connection and repair priority for $type', status => {
    expect(render(status)).not.toContain('Could not load older messages')
    expect(render(status)).not.toContain('>Retry</button>')
  })
})
