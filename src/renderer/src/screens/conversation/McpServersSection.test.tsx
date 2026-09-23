import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { McpServersSectionView, requestMcpStatus } from './McpServersSection'
import type { MCPServerStatus } from '@shared/wire/types'

const server = (name: string, status: string, error = ''): MCPServerStatus =>
  ({ name, status, error, scope: 'user', version: '1' })
const render = (
  report: { servers: MCPServerStatus[]; droppedServers: number } | null,
  showBuiltIn = false,
  unavailable = false
) => renderToStaticMarkup(
  <McpServersSectionView
    report={report}
    showBuiltIn={showBuiltIn}
    unavailable={unavailable}
    onShowBuiltInChange={() => {}}
  />
)

const NO_REPORT = 'No MCP report has arrived yet.'
const NO_SERVERS = 'Claude reported no MCP servers.'
const ONLY_BUILT_IN = 'Only built-in servers are reported.'
const UNAVAILABLE = 'The daemon could not report MCP status right now.'

describe('McpServersSectionView', () => {
  it('says no report has arrived before any frame, with no rows, toggle or no-servers claim', () => {
    const markup = render(null)
    expect(markup).toContain('MCP servers')
    expect(markup).toContain(NO_REPORT)
    expect(markup).not.toContain(NO_SERVERS)
    expect(markup).not.toContain(ONLY_BUILT_IN)
    expect(markup).not.toContain('channel-info__row')
    expect(markup).not.toContain('Show built-in')
  })

  it('distinguishes a delivered empty list and a list the filter emptied from absence', () => {
    const empty = render({ servers: [], droppedServers: 0 })
    expect(empty).toContain(NO_SERVERS)
    expect(empty).not.toContain(NO_REPORT)
    const builtInOnly = render({ servers: [server('pyry_approve', 'connected'), server('pyry_files', 'connected')], droppedServers: 0 })
    expect(builtInOnly).toContain(ONLY_BUILT_IN)
    expect(builtInOnly).not.toContain('pyry_approve')
    expect(builtInOnly).not.toContain(NO_SERVERS)
    expect(builtInOnly).not.toContain(NO_REPORT)
  })

  it('draws rows in claude order with the status verbatim and a tone chosen by exact word', () => {
    const markup = render({
      servers: [
        server('zeta', 'connected'), server('pyry_files', 'connected'), server('alpha', 'failed'),
        server('mid', 'Connected'), server('late', 'pending')
      ],
      droppedServers: 0
    })
    const order = ['zeta', 'alpha', 'mid', 'late'].map((name) => markup.indexOf(`>${name}<`))
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((x, y) => x - y)).toEqual(order)
    expect(markup).not.toContain('pyry_files')
    const tones = [...markup.matchAll(/mcp-server-dot--(\w+)/g)].map((match) => match[1])
    expect(tones).toEqual(['connected', 'failed', 'other', 'other'])
    for (const word of ['>connected<', '>failed<', '>Connected<', '>pending<']) expect(markup).toContain(word)
    expect(markup).toContain('Show built-in')
    expect(markup).not.toContain('checked=""')
  })

  it('shows the built-in servers with the same row treatment when the toggle is on', () => {
    const markup = render({ servers: [server('pyry_approve', 'connected'), server('docs', 'failed')], droppedServers: 0 }, true)
    expect(markup).toContain('>pyry_approve<')
    expect(markup).toContain('>docs<')
    expect(markup).toContain('checked=""')
    expect(markup.match(/mcp-server-dot--/g)).toHaveLength(2)
    expect(markup).not.toContain(ONLY_BUILT_IN)
  })

  it('renders a non-empty error beneath the row as escaped text, newline kept', () => {
    const markup = render({
      servers: [server('bad<&>', 'failed', 'spawn failed\n<script>x</script>'), server('ok', 'connected')],
      droppedServers: 0
    })
    expect(markup).toContain('spawn failed\n&lt;script&gt;x&lt;/script&gt;')
    expect(markup).toContain('bad&lt;&amp;&gt;')
    expect(markup).not.toContain('<script>')
    expect(markup.match(/channel-info__mcp-error/g)).toHaveLength(1)
  })

  it('keeps every daemon string out of attributes', () => {
    const markup = render({ servers: [server('attr-name', 'attr-status', 'attr-error')], droppedServers: 0 })
    for (const tag of markup.match(/<[^>]*>/g) ?? []) expect(tag).not.toMatch(/attr-/)
  })

  it('says the list is partial only when the daemon dropped servers', () => {
    expect(render({ servers: [server('docs', 'connected')], droppedServers: 0 })).not.toContain('Partial list')
    expect(render({ servers: [server('docs', 'connected')], droppedServers: 4 }))
      .toContain('Partial list: 4 more servers were left out by the daemon.')
    expect(render({ servers: [], droppedServers: 1 })).toContain('Partial list')
  })

  it('bounds each displayed string to 256 code points', () => {
    const markup = render({ servers: [server('n'.repeat(300), 's'.repeat(257), 'e'.repeat(256))], droppedServers: 0 })
    expect(markup).toContain(`>${'n'.repeat(256)}…<`)
    expect(markup).toContain(`>${'s'.repeat(256)}…<`)
    expect(markup).toContain(`>${'e'.repeat(256)}<`)
  })

  it('appends the unavailable notice after the rows it leaves in place', () => {
    const markup = render({ servers: [server('docs', 'connected')], droppedServers: 2 }, false, true)
    expect(markup).toContain('>docs<')
    expect(markup).toContain('Partial list: 2')
    expect(markup).toContain('Show built-in')
    expect(markup.endsWith(`<p class="channel-info__empty">${UNAVAILABLE}</p>`)).toBe(true)
  })

  it('shows the notice beside the no-report line and never without the mark', () => {
    const markup = render(null, false, true)
    expect(markup).toContain(NO_REPORT)
    expect(markup).toContain(UNAVAILABLE)
    expect(render(null)).not.toContain(UNAVAILABLE)
    expect(render({ servers: [server('docs', 'connected')], droppedServers: 0 })).not.toContain(UNAVAILABLE)
  })
})

describe('requestMcpStatus', () => {
  it('asks once for the named conversation and never for a missing one', () => {
    const send = vi.fn()
    requestMcpStatus(send, null)
    requestMcpStatus(send, '')
    expect(send).not.toHaveBeenCalled()
    requestMcpStatus(send, 'chat-a')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ type: 'requestMcpStatus', payload: { conversation_id: 'chat-a' } })
  })
})
