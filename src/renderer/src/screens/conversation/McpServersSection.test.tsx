import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { McpServersSectionView, reconnectMcpServer, requestMcpStatus, toggleMcpServer } from './McpServersSection'
import type { MCPServerStatus } from '@shared/wire/types'

const server = (name: string, status: string, error = ''): MCPServerStatus =>
  ({ name, status, error, scope: 'user', version: '1' })
const render = (
  report: { servers: MCPServerStatus[]; droppedServers: number } | null,
  showBuiltIn = false,
  unavailable = false,
  {
    reconnecting = false,
    reconnectRefused = false,
    toggling = false,
    toggleRefused = false
  }: { reconnecting?: boolean; reconnectRefused?: boolean; toggling?: boolean; toggleRefused?: boolean } = {}
) => renderToStaticMarkup(
  <McpServersSectionView
    report={report}
    showBuiltIn={showBuiltIn}
    unavailable={unavailable}
    reconnecting={reconnecting}
    reconnectRefused={reconnectRefused}
    toggling={toggling}
    toggleRefused={toggleRefused}
    onShowBuiltInChange={() => {}}
    onReconnect={() => {}}
    onToggle={() => {}}
  />
)

const NO_REPORT = 'No MCP report has arrived yet.'
const NO_SERVERS = 'Claude reported no MCP servers.'
const ONLY_BUILT_IN = 'Only built-in servers are reported.'
const UNAVAILABLE = 'The daemon could not report MCP status right now.'
const REFUSED = 'The daemon refused to reconnect the MCP server.'
const RECONNECT = /<button type="button" class="button-small channel-info__mcp-reconnect"( disabled="")?>Reconnect<\/button>/g

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

describe('McpServersSectionView reconnect', () => {
  const mixed = {
    servers: [server('up', 'connected'), server('down', 'failed'), server('waiting', 'pending'), server('odd', 'Connected')],
    droppedServers: 0
  }

  it('offers Reconnect on every row that is not exactly connected, and none on a connected row', () => {
    const markup = render(mixed)
    const buttons = [...markup.matchAll(RECONNECT)]
    expect(buttons).toHaveLength(3)
    expect(buttons.every((match) => match[1] === undefined)).toBe(true)
    const rows = markup.split('channel-info__mcp-server"').slice(1)
    expect(rows.map((chunk) => chunk.includes('channel-info__mcp-reconnect'))).toEqual([false, true, true, true])
    expect(render({ servers: [server('up', 'connected')], droppedServers: 0 })).not.toContain('Reconnect')
  })

  it('disables every Reconnect in the section while a reconnect is outstanding', () => {
    const buttons = [...render(mixed, false, false, { reconnecting: true }).matchAll(RECONNECT)]
    expect(buttons).toHaveLength(3)
    expect(buttons.every((match) => match[1] === ' disabled=""')).toBe(true)
  })

  it('keeps the server name out of the control\'s attributes', () => {
    const markup = render({ servers: [server('attr-name', 'failed')], droppedServers: 0 })
    expect(markup).toContain('>Reconnect<')
    for (const tag of markup.match(/<[^>]*>/g) ?? []) expect(tag).not.toMatch(/attr-/)
  })

  it('appends the refusal notice, rows held, and shows it without a report too', () => {
    const markup = render(mixed, false, false, { reconnectRefused: true })
    expect(markup).toContain('>down<')
    expect(markup.endsWith(`<p class="channel-info__empty">${REFUSED}</p>`)).toBe(true)
    expect(render(null, false, false, { reconnectRefused: true })).toContain(REFUSED)
    expect(render(mixed)).not.toContain(REFUSED)
    expect(render(mixed, false, true)).not.toContain(REFUSED)
    const both = render(mixed, false, true, { reconnectRefused: true })
    expect(both).toContain(UNAVAILABLE)
    expect(both).toContain(REFUSED)
  })
})

describe('McpServersSectionView toggle switch', () => {
  const TOGGLE_REFUSED = 'The daemon refused to change the MCP server.'
  const switches = (markup: string) => (markup.match(/<button type="button" role="switch"[^>]*>/g) ?? []).map((tag) => ({
    checked: /aria-checked="(\w+)"/.exec(tag)?.[1],
    labelledBy: /aria-labelledby="([^"]*)"/.exec(tag)?.[1],
    on: tag.includes('channel-info__mcp-switch--on'),
    disabled: tag.includes('disabled=""')
  }))
  const mixed = {
    servers: [server('up', 'connected'), server('off', 'disabled'), server('down', 'failed'), server('odd', 'Disabled')],
    droppedServers: 0
  }

  it('puts a switch on every row, connected included, reading off exactly for the word disabled', () => {
    const shown = switches(render(mixed))
    expect(shown.map((entry) => entry.checked)).toEqual(['true', 'false', 'true', 'true'])
    expect(shown.map((entry) => entry.on)).toEqual([true, false, true, true])
    expect(shown.every((entry) => !entry.disabled)).toBe(true)
    const rows = render(mixed).split('channel-info__mcp-server"').slice(1)
    expect(rows.every((chunk) => chunk.includes('role="switch"'))).toBe(true)
  })

  it('names each switch by reference to its rendered name, with an id that is not the name', () => {
    const markup = render({ servers: [server('attr-a', 'connected'), server('attr-b', 'disabled')], droppedServers: 0 })
    const ids = switches(markup).map((entry) => entry.labelledBy ?? '')
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    expect(markup).toContain(`id="${ids[0]}">attr-a<`)
    expect(markup).toContain(`id="${ids[1]}">attr-b<`)
    for (const tag of markup.match(/<[^>]*>/g) ?? []) expect(tag).not.toMatch(/attr-/)
  })

  it('disables every switch and Reconnect while a toggle or a reconnect is outstanding', () => {
    for (const busy of [{ toggling: true }, { reconnecting: true }]) {
      const markup = render(mixed, false, false, busy)
      expect(switches(markup).every((entry) => entry.disabled)).toBe(true)
      const reconnects = [...markup.matchAll(RECONNECT)]
      expect(reconnects).toHaveLength(3)
      expect(reconnects.every((match) => match[1] === ' disabled=""')).toBe(true)
    }
  })

  it('appends the toggle refusal notice, switches as reported, and shows it without a report too', () => {
    const markup = render(mixed, false, false, { toggleRefused: true })
    expect(markup.endsWith(`<p class="channel-info__empty">${TOGGLE_REFUSED}</p>`)).toBe(true)
    expect(switches(markup).map((entry) => entry.checked)).toEqual(['true', 'false', 'true', 'true'])
    expect(switches(markup).every((entry) => !entry.disabled)).toBe(true)
    expect(markup).not.toContain(REFUSED)
    expect(render(null, false, false, { toggleRefused: true })).toContain(TOGGLE_REFUSED)
    expect(render(mixed, false, false, { reconnectRefused: true })).not.toContain(TOGGLE_REFUSED)
  })
})

describe('toggleMcpServer', () => {
  it('begins the wait, then sends one command with the name unchanged and the requested state', () => {
    const calls: string[] = []
    const send = vi.fn(() => { calls.push('send') })
    const begin = vi.fn(() => { calls.push('begin') })
    toggleMcpServer(send, begin, 'chat-a', ' docs<&> ', false)
    expect(calls).toEqual(['begin', 'send'])
    expect(begin).toHaveBeenCalledWith('chat-a')
    expect(send).toHaveBeenCalledWith({
      type: 'toggleMcpServer',
      payload: { conversation_id: 'chat-a', server_name: ' docs<&> ', enabled: false }
    })
  })
})

describe('reconnectMcpServer', () => {
  it('begins the wait, then sends one command naming the conversation and the name unchanged', () => {
    const calls: string[] = []
    const send = vi.fn(() => { calls.push('send') })
    const begin = vi.fn(() => { calls.push('begin') })
    reconnectMcpServer(send, begin, 'chat-a', ' docs<&> ')
    expect(calls).toEqual(['begin', 'send'])
    expect(begin).toHaveBeenCalledWith('chat-a')
    expect(send).toHaveBeenCalledWith({
      type: 'reconnectMcpServer',
      payload: { conversation_id: 'chat-a', server_name: ' docs<&> ' }
    })
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
