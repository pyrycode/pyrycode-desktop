import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PairedShellView } from './PairedShell'
import { HostRow } from './screens/channels/ChannelList'
import { daemonLeg } from './screens/conversation/ConversationScreen'
import type { ConnectionStatus } from './store/sessionStore'

const rejected: ConnectionStatus = {
  type: 'error', error: { code: 'pairing-rejected', message: 'unused', retryable: false }
}
const offline: ConnectionStatus = { type: 'disconnected' }
const noop = (): void => {}
afterEach(() => vi.unstubAllGlobals())

describe('host repair presentation', () => {
  it('distinguishes rejection, connecting and ordinary offline status', () => {
    expect(daemonLeg(rejected).label).toBe('Pyrycode Pairing rejected')
    expect(daemonLeg(offline).label).toBe('Pyrycode Offline')
    expect(daemonLeg({ type: 'connecting' }).label).toBe('Pyrycode Connecting')
  })

  it('renders a named repair button and failed host treatment', () => {
    // #1507's three fold props are required on the pure view, and a FAILED row ignores all three: it is
    // not a disclosure, so it draws neither the button nor the chevron. Passed at their production values
    // rather than at values chosen to make this case pass.
    const markup = renderToStaticMarkup(<HostRow label="Host" serverId="a" failed onRepair={noop}
      expanded hasWorkspaces onToggle={noop} />)
    expect(markup).toContain('channel-list__host--failed')
    expect(markup).toContain('aria-label="Repair host"')
    expect(markup).toContain('type="button"')
  })

  it('renders recovery in a modal over the sidebar without a selected conversation', () => {
    vi.stubGlobal('window', { pyry: {} })
    const markup = renderToStaticMarkup(<PairedShellView route="pairServer" paneKey={null}
      recoveryServerId="a" recoveryRejected
      onOpen={noop} onBack={noop} onOpenSettings={noop} onOpenArchive={noop}
      onUnpaired={noop} onOpenPairServer={noop} onPairServerPaired={noop} onPairServerCancelled={noop}
    />)
    expect(markup).toContain('paired-shell__sidebar')
    expect(markup).toContain('class="modal"')
    expect(markup).toContain('aria-label="Pairing code"')
    expect(markup).toContain('Your pairing has expired or is no longer valid. Enter a new pairing code to reconnect.')
    expect(markup).not.toContain('aria-label="Send"')
  })
})
