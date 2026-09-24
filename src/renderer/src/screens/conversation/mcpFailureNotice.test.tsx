import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ComposerErrorSlot, ComposerMcpFailure, mcpFailedCopy } from './ConversationScreen'
import type { ConnectionStatus } from '../../store/sessionStore'

const connected: ConnectionStatus = {
  type: 'connected', ack: { protocol_version: '1', server_id: 's', conn_id: 'c', capabilities: [] }
}
const failure = (name = 'docs') => <ComposerMcpFailure name={name} onOpen={() => {}} />
const render = (status: ConnectionStatus, overrides = {}) => renderToStaticMarkup(
  <ComposerErrorSlot onReconnect={() => {}} status={status} notice={null}
    mcpFailure={failure()} {...overrides} />)

describe('MCP failure status occupant', () => {
  it('is client-owned copy with one hole and no apostrophe', () => {
    expect(mcpFailedCopy('docs')).toBe('MCP server docs failed')
    expect(mcpFailedCopy('')).not.toContain("'")
  })

  it('renders one error-type small button whose name is escaped text only', () => {
    expect(renderToStaticMarkup(failure())).toBe(
      '<button type="button" class="button-small button-small--error composer-status__mcp-failure">' +
      'MCP server docs failed</button>')
    const hostile = renderToStaticMarkup(failure('<img src=x onerror=alert(1)>"'))
    expect(hostile).not.toContain('<img')
    expect(hostile).toContain('&lt;img src=x onerror=alert(1)&gt;&quot;')
  })

  it('bounds a long name the way the sheet does', () => {
    const markup = renderToStaticMarkup(failure('x'.repeat(300)))
    expect(markup).toContain(`MCP server ${'x'.repeat(256)}… failed`)
    expect(markup).not.toContain('x'.repeat(257))
  })

  it('outranks the task count and yields to every occupant above it', () => {
    const count = <span>Tasks</span>
    expect(render(connected, { taskCount: count })).toContain('MCP server docs failed')
    expect(render(connected, { mcpFailure: null, taskCount: count })).toBe('<span>Tasks</span>')
    for (const occupant of ['recovery', 'refusal', 'notice', 'history']) {
      expect(render(connected, { [occupant]: <span>Higher</span>, taskCount: count }))
        .toBe('<span>Higher</span>')
    }
  })

  it.each<ConnectionStatus>([
    { type: 'disconnected' }, { type: 'connecting' },
    { type: 'error', error: { code: 'offline', message: 'sentinel', retryable: true } },
    { type: 'error', error: { code: 'pairing', message: 'sentinel', retryable: false } }
  ])('never shows while $type', status => {
    expect(render(status)).not.toContain('MCP server')
  })
})
