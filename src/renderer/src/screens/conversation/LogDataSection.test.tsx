import { afterEach, describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LogDataView, LogDataSection, requestDebugBundleFor } from './LogDataSection'
import { conversationListStore } from '../../store/conversationListStore'
import { sessionStore, type ConnectionStatus } from '../../store/sessionStore'

// No DOM harness (jsdom/Testing Library) — mirrors ConversationScreen.test.tsx. LogDataView is pure
// (state in, markup out), so a server-rendered string proves each visible state; the container is
// exercised only for "server-renders the idle view without touching window.pyry".
function buttonTag(markup: string): string {
  return markup.match(/<button[^>]*>/)?.[0] ?? ''
}

describe('LogDataView', () => {
  it('idle → a Log data header and a Download button, no status caption', () => {
    const markup = renderToStaticMarkup(<LogDataView state={{ phase: 'idle' }} available onDownload={() => {}} />)
    expect(markup).toContain('Log data')
    expect(markup).toContain('Download')
    expect(buttonTag(markup)).not.toContain('disabled')
    // No caption while idle.
    expect(markup).not.toContain('role="status"')
  })

  it('downloading → button disabled + aria-busy, a polite status caption showing the running count', () => {
    const markup = renderToStaticMarkup(
      <LogDataView state={{ phase: 'downloading', chunks: 3 }} available onDownload={() => {}} />
    )
    const tag = buttonTag(markup)
    expect(tag).toContain('disabled')
    expect(tag).toContain('aria-busy="true"')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('3')
  })

  it('saved → the saved path in the caption; the button stays pressable', () => {
    const path = '/Users/x/pyry-debug.tar.gz'
    const markup = renderToStaticMarkup(
      <LogDataView state={{ phase: 'saved', path }} available onDownload={() => {}} />
    )
    expect(markup).toContain(path)
    expect(buttonTag(markup)).not.toContain('disabled')
  })

  it('failed → the mapped sentence with the error class; the button stays pressable; no raw reason', () => {
    const markup = renderToStaticMarkup(
      <LogDataView state={{ phase: 'failed', reason: 'unavailable' }} available onDownload={() => {}} />
    )
    expect(markup).toContain('log-data__status--error')
    expect(buttonTag(markup)).not.toContain('disabled')
    // AC5: the raw reason token never reaches the surface.
    expect(markup).not.toContain('unavailable')
  })
})

describe('LogDataView availability (#1692)', () => {
  it('host unavailable → the idle button is disabled but not busy', () => {
    const tag = buttonTag(renderToStaticMarkup(
      <LogDataView state={{ phase: 'idle' }} available={false} onDownload={() => {}} />
    ))
    expect(tag).toContain('disabled')
    expect(tag).toContain('aria-busy="false"')
  })
})

describe('requestDebugBundleFor (#1692)', () => {
  const initialRows = conversationListStore.getState()
  const initialSession = sessionStore.getState()
  const row = { id: 'chat', name: null, is_promoted: false, is_archived: false,
    cwd: '/', last_message_ts: '', last_used_at: '', workspace_label: null }
  const connected: ConnectionStatus = { type: 'connected', ack: {
    protocol_version: '1', server_id: 'daemon', conn_id: 'connection', capabilities: []
  } }

  afterEach(() => {
    vi.unstubAllGlobals()
    conversationListStore.setState(initialRows, true)
    sessionStore.setState(initialSession, true)
  })

  function stubBridge() {
    const sendCommand = vi.fn()
    vi.stubGlobal('window', { pyry: { sendCommand, sendDiagnostic: vi.fn() } })
    return sendCommand
  }

  it("addresses the open conversation's host, never the other connected host", () => {
    const sendCommand = stubBridge()
    sessionStore.setState({ statuses: new Map([['first', connected], ['second', connected]]) })
    conversationListStore.getState().setConversations([], 'first')
    conversationListStore.getState().setConversations([row], 'second')
    expect(requestDebugBundleFor(row.id)).toBe('second')
    expect(sendCommand.mock.calls).toEqual([[{ type: 'requestDebugBundle', serverId: 'second' }]])
  })

  it('sends nothing while the owning host is disconnected', () => {
    const sendCommand = stubBridge()
    sessionStore.setState({ statuses: new Map<string, ConnectionStatus>([['first', connected], ['second', { type: 'disconnected' }]]) })
    conversationListStore.getState().setConversations([row], 'second')
    expect(requestDebugBundleFor(row.id)).toBeNull()
    expect(requestDebugBundleFor(null)).toBeNull()
    expect(sendCommand).not.toHaveBeenCalled()
  })

  it('single host: the request carries that host', () => {
    const sendCommand = stubBridge()
    sessionStore.setState({ statuses: new Map([['only', connected]]) })
    conversationListStore.getState().setConversations([row], 'only')
    expect(requestDebugBundleFor(row.id)).toBe('only')
    expect(sendCommand.mock.calls).toEqual([[{ type: 'requestDebugBundle', serverId: 'only' }]])
  })
})

describe('LogDataSection (container)', () => {
  it('server-renders the idle Download button without touching window.pyry', () => {
    // useEffect/handlers never run under server render, so the bridge is never dereferenced — the
    // same discipline as Composer.handleSubmit. No window.pyry mock is needed.
    let markup = ''
    expect(() => {
      markup = renderToStaticMarkup(<LogDataSection conversationId={null} available={false} />)
    }).not.toThrow()
    expect(markup).toContain('Download')
  })
})
